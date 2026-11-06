// The viewer page's 3D view: a map's blocks meshed in workers and grouped into region meshes
// (4x4x4 sections each, so a whole map is about 100 draw calls), one shader for every block face
// (shading baked in; corner darkening, brightness variation, darkening below the cut and the cut
// layer's grid as uniforms, so toggling them costs nothing), cuts as clipping planes with a cap
// of the cut layer (nothing is meshed again: docs/spike-results.md, "Map viewer"), Faded as the
// same meshes drawn again see-through on the other side of the cuts, and the camera with its views.
// Everything is placed in world coordinates (Minecraft's: +x east, +y up, +z south).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { paddedSection, SHADE, type SectionMesh } from "./mesher.ts";
import { EAST, lookAtSpot, pick, UP, WEST, NORTH, SOUTH, type Hit, type Keep, type Volume } from "./volume.ts";

/** Sections per region side. */
const REGION = 4;
/** A plane's constant for "no cut": far past every block. */
const FAR = 1e6;
/** How see-through Faded is. */
const FADED_OPACITY = 0.15;

const VERTEX = /* glsl */ `
attribute vec4 tint;
attribute float occlusion;
varying vec4 vTint;
varying float vOcclusion;
varying vec3 vWorld;
#include <clipping_planes_pars_vertex>
void main() {
  vTint = tint;
  vOcclusion = occlusion;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform float aoStrength;
uniform float variation;
uniform float darkenBelow;
uniform float cutTop;
uniform float opacity;
uniform float grid;
varying vec4 vTint;
varying float vOcclusion;
varying vec3 vWorld;
#include <clipping_planes_pars_fragment>
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  #include <clipping_planes_fragment>
  // The face's normal, turned toward the camera (out of its block), finds the block it belongs to.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, cameraPosition - vWorld) < 0.0) n = -n;
  vec3 block = floor(vWorld - n * 0.5);
  float light = mix(1.0, 0.5 + 0.5 * vOcclusion, aoStrength);
  light *= 1.0 + variation * (hash(block) * 2.0 - 1.0);
  if (darkenBelow > 0.0) light *= clamp(1.0 - max(cutTop - vWorld.y, 0.0) * darkenBelow, 0.35, 1.0);
  if (grid > 0.5) {
    // A faint line along each block's edge, fading out once blocks are under about 6 pixels across.
    vec3 perPixel = max(fwidth(vWorld), vec3(1e-4));
    vec3 lines = abs(fract(vWorld + 0.5) - 0.5) / perPixel;
    float edge = 1e3;
    float size = 0.0;
    if (abs(n.x) < 0.5) { edge = min(edge, lines.x); size = max(size, perPixel.x); }
    if (abs(n.y) < 0.5) { edge = min(edge, lines.y); size = max(size, perPixel.y); }
    if (abs(n.z) < 0.5) { edge = min(edge, lines.z); size = max(size, perPixel.z); }
    float strength = 1.0 - smoothstep(1.0 / 10.0, 1.0 / 5.0, size);
    light *= mix(1.0 - 0.22 * strength, 1.0, smoothstep(0.0, 1.2, edge));
  }
  gl_FragColor = vec4(vTint.rgb * light, opacity);
}`;

export interface Toggles {
  /** Corner darkening. */
  occlusion: boolean;
  /** Each block a little brighter or darker, so big floors don't look like plastic. */
  variation: boolean;
  /** The layers below the height cut darker the deeper they are. */
  darkenBelow: boolean;
  /** Past the cut: drawn see-through, or not at all. */
  faded: boolean;
}

/** The cuts, in world coordinates: the top layer kept, and x and z planes with the side kept. */
export interface Cuts {
  top?: number;
  x?: { at: number; side: "below" | "above" };
  z?: { at: number; side: "below" | "above" };
}

export type ViewName = "home" | "top" | "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

/** Where each view looks from, as a direction from the map's middle. */
const VIEW_DIRECTIONS: Record<Exclude<ViewName, "top">, [number, number, number]> = {
  home: [1, 0.8, 1],
  north: [0, 0.35, -1],
  south: [0, 0.35, 1],
  east: [1, 0.35, 0],
  west: [-1, 0.35, 0],
  northeast: [1, 0.7, -1],
  northwest: [-1, 0.7, -1],
  southeast: [1, 0.7, 1],
  southwest: [-1, 0.7, 1],
};

export interface MeshStats {
  sections: number;
  quads: number;
  regions: number;
  ms: number;
}

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly orthographic: THREE.OrthographicCamera;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  private readonly uniforms = {
    aoStrength: { value: 1 },
    variation: { value: 0.03 },
    darkenBelow: { value: 0 },
    cutTop: { value: FAR },
  };
  private readonly planes = { top: new THREE.Plane(new THREE.Vector3(0, -1, 0), FAR), x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), FAR), z: new THREE.Plane(new THREE.Vector3(0, 0, -1), FAR) };
  private readonly opposite = { top: new THREE.Plane(), x: new THREE.Plane(), z: new THREE.Plane() };
  private readonly solid: THREE.ShaderMaterial;
  private readonly faded: THREE.ShaderMaterial;
  private readonly capMaterials: Record<"top" | "x" | "z", THREE.ShaderMaterial>;
  private readonly caps: Partial<Record<"top" | "x" | "z", THREE.Mesh>> = {};
  private readonly regions: THREE.Mesh[] = [];
  private readonly ghosts: THREE.Mesh[] = [];
  private cuts: Cuts = {};
  private toggles: Toggles = { occlusion: true, variation: true, darkenBelow: false, faded: true };
  private pending = false;
  /** Called after each frame drawn (the page updates its compass). */
  onRender: () => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement, readonly volume: Volume) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x9bb8d3);
    this.perspective = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 4000);
    this.camera = this.perspective;
    this.controls = new OrbitControls(this.perspective, canvas);
    // Right drag turns, Shift + right drag or middle drag pans, the wheel zooms where it points; left clicks are the tools'.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.zoomToCursor = true;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.addEventListener("change", () => this.requestRender());
    const material = (opacity: number, planes: THREE.Plane[], grid = false) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, opacity: { value: opacity }, grid: { value: grid ? 1 : 0 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        clipping: true,
        clippingPlanes: planes,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
      });
    this.solid = material(1, [this.planes.top, this.planes.x, this.planes.z]);
    this.faded = material(FADED_OPACITY, [this.opposite.top, this.opposite.x, this.opposite.z]);
    // Past any cut: everything the solid meshes leave out (kept only where every opposite plane clips).
    this.faded.clipIntersection = true;
    this.capMaterials = {
      top: material(1, [this.planes.x, this.planes.z], true),
      x: material(1, [this.planes.top, this.planes.z], true),
      z: material(1, [this.planes.top, this.planes.x], true),
    };
    this.updatePlanes();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Meshes every section in the workers, then builds the region meshes. */
  async build(workers: Worker[]): Promise<MeshStats> {
    const started = performance.now();
    const { volume } = this;
    const looks = { drawn: volume.drawn, colors: volume.colors };
    for (const worker of workers) worker.postMessage({ looks });
    const jobs: { key: string; blocks: Uint16Array; offset: [number, number, number] }[] = [];
    const [nx, ny, nz] = volume.sections;
    for (let cx = 0; cx < nx; cx++) {
      for (let cy = 0; cy < ny; cy++) {
        for (let cz = 0; cz < nz; cz++) {
          const blocks = paddedSection(volume.blocks, volume.size, volume.drawn, cx, cy, cz);
          if (blocks) jobs.push({ key: `${cx},${cy},${cz}`, blocks, offset: [(cx % REGION) * 16, (cy % REGION) * 16, (cz % REGION) * 16] });
        }
      }
    }
    const meshes = await meshInWorkers(workers, jobs);
    const byRegion = new Map<string, SectionMesh[]>();
    let quads = 0;
    for (const [key, mesh] of meshes) {
      if (mesh.quads === 0) continue;
      quads += mesh.quads;
      const [cx, cy, cz] = key.split(",").map(Number);
      const region = `${Math.floor(cx / REGION)},${Math.floor(cy / REGION)},${Math.floor(cz / REGION)}`;
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region)!.push(mesh);
    }
    for (const [key, parts] of byRegion) {
      const [rx, ry, rz] = key.split(",").map(Number);
      const geometry = regionGeometry(parts);
      const solid = new THREE.Mesh(geometry, this.solid);
      const ghost = new THREE.Mesh(geometry, this.faded);
      for (const mesh of [solid, ghost]) {
        mesh.position.set(volume.origin[0] + rx * REGION * 16, volume.origin[1] + ry * REGION * 16, volume.origin[2] + rz * REGION * 16);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.scene.add(mesh);
      }
      ghost.renderOrder = 1;
      this.regions.push(solid);
      this.ghosts.push(ghost);
    }
    this.updateGhosts();
    this.view("home");
    return { sections: jobs.length, quads, regions: byRegion.size, ms: performance.now() - started };
  }

  setToggles(toggles: Toggles): void {
    this.toggles = toggles;
    this.uniforms.aoStrength.value = toggles.occlusion ? 1 : 0;
    this.uniforms.variation.value = toggles.variation ? 0.03 : 0;
    this.uniforms.darkenBelow.value = toggles.darkenBelow ? 0.045 : 0;
    this.updateGhosts();
    this.requestRender();
  }

  setCuts(cuts: Cuts): void {
    const before = this.cuts;
    this.cuts = cuts;
    this.updatePlanes();
    if (before.top !== cuts.top) this.rebuildCap("top");
    if (before.x?.at !== cuts.x?.at || before.x?.side !== cuts.x?.side) this.rebuildCap("x");
    if (before.z?.at !== cuts.z?.at || before.z?.side !== cuts.z?.side) this.rebuildCap("z");
    this.updateGhosts();
    this.requestRender();
  }

  private updatePlanes(): void {
    const { top, x, z } = this.cuts;
    // A plane keeps where normal . p + constant >= 0. A hair past the cut keeps the kept faces on it.
    this.planes.top.set(new THREE.Vector3(0, -1, 0), top === undefined ? FAR : top + 1.001);
    this.planes.x.set(new THREE.Vector3(x?.side === "above" ? 1 : -1, 0, 0), !x ? FAR : x.side === "below" ? x.at + 1.001 : -x.at + 0.001);
    this.planes.z.set(new THREE.Vector3(0, 0, z?.side === "above" ? 1 : -1), !z ? FAR : z.side === "below" ? z.at + 1.001 : -z.at + 0.001);
    for (const key of ["top", "x", "z"] as const) this.opposite[key].copy(this.planes[key]).negate();
    this.uniforms.cutTop.value = top === undefined ? FAR : top + 1;
  }

  private updateGhosts(): void {
    const cut = this.cuts.top !== undefined || this.cuts.x !== undefined || this.cuts.z !== undefined;
    for (const ghost of this.ghosts) ghost.visible = this.toggles.faded && cut;
  }

  /**
   * A cut's cap: the faces on the cut that the blocks past it hid, from one layer of the grid,
   * merged into rectangles of one look. Faces whose other side is open are already in the meshes.
   */
  private rebuildCap(axis: "top" | "x" | "z"): void {
    const old = this.caps[axis];
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      delete this.caps[axis];
    }
    const { volume } = this;
    const [sx, sy, sz] = volume.size;
    const at = (x: number, y: number, z: number) => volume.drawn[lookAtSpot(volume, x, y, z)];
    // The layer (in grid spots), the axis along it, the step to the hidden side, and the face drawn.
    let layer: number;
    let normalAxis: number;
    let toward: number;
    let face: number;
    if (axis === "top") {
      if (this.cuts.top === undefined) return;
      [layer, normalAxis, toward, face] = [this.cuts.top - volume.origin[1], 1, 1, UP];
    } else {
      const cut = this.cuts[axis];
      if (!cut) return;
      normalAxis = axis === "x" ? 0 : 2;
      toward = cut.side === "below" ? 1 : -1;
      layer = cut.at - volume.origin[normalAxis];
      face = axis === "x" ? (toward > 0 ? EAST : WEST) : toward > 0 ? SOUTH : NORTH;
    }
    if (layer < 0 || layer >= volume.size[normalAxis]) return;
    // The two axes across the layer, u then v.
    const [u, v] = [0, 1, 2].filter((a) => a !== normalAxis);
    const [nu, nv] = [volume.size[u], volume.size[v]];
    const mask = new Int32Array(nu * nv);
    const p = [0, 0, 0];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        p[normalAxis] = layer;
        p[u] = i;
        p[v] = j;
        const look = lookAtSpot(volume, p[0], p[1], p[2]);
        if (!volume.drawn[look]) continue;
        p[normalAxis] += toward;
        if (at(p[0], p[1], p[2])) mask[j * nu + i] = look;
      }
    }
    const positions: number[] = [];
    const tints: number[] = [];
    const indices: number[] = [];
    const shade = SHADE[face];
    const plane = layer + (toward > 0 ? 1 : 0);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; ) {
        const look = mask[j * nu + i];
        if (!look) {
          i++;
          continue;
        }
        let width = 1;
        while (i + width < nu && mask[j * nu + i + width] === look) width++;
        let height = 1;
        grow: while (j + height < nv) {
          for (let k = 0; k < width; k++) if (mask[(j + height) * nu + i + k] !== look) break grow;
          height++;
        }
        for (let h = 0; h < height; h++) for (let k = 0; k < width; k++) mask[(j + h) * nu + i + k] = 0;
        const base = positions.length / 3;
        for (const [du, dv] of [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ]) {
          const c = [0, 0, 0];
          c[normalAxis] = plane;
          c[u] = i + du;
          c[v] = j + dv;
          positions.push(c[0], c[1], c[2]);
          const color = look * 24 + face * 4;
          tints.push(volume.colors[color] * shade, volume.colors[color + 1] * shade, volume.colors[color + 2] * shade, 255);
        }
        // Facing toward the hidden side: counterclockwise seen from there. u x v points along +x
        // (y, z) and +z (x, y), but along -y for the height cut's (x, z).
        const forward = (normalAxis === 1 ? -1 : 1) * toward > 0;
        if (forward) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        i += width;
      }
    }
    if (indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Uint16Array.from(positions), 3));
    geometry.setAttribute("tint", new THREE.BufferAttribute(Uint8Array.from(tints), 4, true));
    geometry.setAttribute("occlusion", new THREE.BufferAttribute(new Uint8Array(positions.length / 3).fill(255), 1, true));
    geometry.setIndex(positions.length / 3 < 65536 ? new THREE.BufferAttribute(Uint16Array.from(indices), 1) : new THREE.BufferAttribute(Uint32Array.from(indices), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(sx / 2, sy / 2, sz / 2), Math.hypot(sx, sy, sz) / 2);
    const mesh = new THREE.Mesh(geometry, this.capMaterials[axis]);
    mesh.position.set(...volume.origin);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.caps[axis] = mesh;
    this.scene.add(mesh);
  }

  /** The middle of the map's blocks, and the radius of a ball around them. */
  private bounds(): { center: THREE.Vector3; radius: number } {
    const { min, max } = this.volume.box;
    const center = new THREE.Vector3((min[0] + max[0] + 1) / 2, (min[1] + max[1] + 1) / 2, (min[2] + max[2] + 1) / 2);
    return { center, radius: Math.hypot(max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1) / 2 };
  }

  /** Moves the camera to a view of the whole map. Top is straight down and flat (orthographic), north up. */
  view(name: ViewName): void {
    const { center, radius } = this.bounds();
    if (name === "top") {
      const box = this.volume.box;
      this.camera = this.orthographic;
      this.controls.object = this.orthographic;
      this.controls.enableRotate = false;
      this.orthographic.position.set(center.x, box.max[1] + 50, center.z + 1e-3);
      this.orthographic.zoom = 1;
      this.orthographic.userData.extent = Math.max(box.max[0] - box.min[0] + 1, box.max[2] - box.min[2] + 1) * 0.55;
      this.controls.target.set(center.x, box.min[1], center.z);
    } else {
      this.camera = this.perspective;
      this.controls.object = this.perspective;
      this.controls.enableRotate = true;
      const direction = new THREE.Vector3(...VIEW_DIRECTIONS[name]).normalize();
      this.perspective.position.copy(center).addScaledVector(direction, this.fitDistance(center, direction, radius));
      this.controls.target.copy(center);
    }
    this.resize();
    this.controls.update();
    this.requestRender();
  }

  /**
   * How far from the map's middle the camera goes, looking back along `direction`, for all eight
   * corners of its box to be in view with a margin: a corner c is in view while its distance
   * sideways (or up) is within tan(fov / 2) of its depth, d - c . direction.
   */
  private fitDistance(center: THREE.Vector3, direction: THREE.Vector3, radius: number): number {
    const { min, max } = this.volume.box;
    const forward = direction.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const tan = Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)) * 0.88;
    let distance = radius * 0.5;
    for (const x of [min[0], max[0] + 1]) {
      for (const y of [min[1], max[1] + 1]) {
        for (const z of [min[2], max[2] + 1]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          const depth = corner.dot(direction);
          distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / (tan * this.perspective.aspect), depth + Math.abs(corner.dot(up)) / tan);
        }
      }
    }
    return distance;
  }

  /** Whether the camera is the Top view's. */
  get isTop(): boolean {
    return this.camera === this.orthographic;
  }

  /** The camera's compass heading, in degrees (0 looking north, 90 east). */
  get heading(): number {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    if (Math.abs(direction.x) < 1e-6 && Math.abs(direction.z) < 1e-6) return 0;
    return (THREE.MathUtils.radToDeg(Math.atan2(direction.x, -direction.z)) + 360) % 360;
  }

  /** Centers the view on a world spot, keeping how the camera looks at it. */
  centerOn(point: [number, number, number]): void {
    const target = new THREE.Vector3(...point);
    const offset = target.clone().sub(this.controls.target);
    this.camera.position.add(offset);
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
  }

  /** The block under a spot on the canvas (pixels from its top left), not counting what's past a cut. */
  pickAt(clientX: number, clientY: number): (Hit & { world: [number, number, number] }) | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const { origin } = this.volume;
    const from = [ray.ray.origin.x - origin[0], ray.ray.origin.y - origin[1], ray.ray.origin.z - origin[2]];
    const direction = [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z];
    const keep: Keep = {
      ...(this.cuts.top !== undefined ? { top: this.cuts.top - origin[1] } : {}),
      ...(this.cuts.x ? { x: { at: this.cuts.x.at - origin[0], side: this.cuts.x.side } } : {}),
      ...(this.cuts.z ? { z: { at: this.cuts.z.at - origin[2], side: this.cuts.z.side } } : {}),
    };
    const hit = pick(this.volume, from, direction, keep);
    if (!hit) return undefined;
    return { ...hit, world: [hit.block[0] + origin[0], hit.block[1] + origin[1], hit.block[2] + origin[2]] };
  }

  /** Draws on the next frame (only then: nothing is drawn while nothing changes). */
  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderer.render(this.scene, this.camera);
      this.onRender();
    });
  }

  private resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    const extent = (this.orthographic.userData.extent as number | undefined) ?? 64;
    const aspect = width / height;
    const [w, h] = aspect >= 1 ? [extent * aspect, extent] : [extent, extent / aspect];
    Object.assign(this.orthographic, { left: -w, right: w, top: h, bottom: -h });
    this.orthographic.updateProjectionMatrix();
    this.requestRender();
  }

  /** Triangles drawn in the last frame, and draw calls. */
  get info(): { triangles: number; calls: number } {
    return { triangles: this.renderer.info.render.triangles, calls: this.renderer.info.render.calls };
  }
}

/** A region's mesh: its sections' meshes in one geometry (positions as bytes, 16-bit indices when they fit). */
function regionGeometry(parts: SectionMesh[]): THREE.BufferGeometry {
  const vertices = parts.reduce((sum, part) => sum + part.positions.length / 3, 0);
  const count = parts.reduce((sum, part) => sum + part.indices.length, 0);
  const positions = new Uint8Array(vertices * 3);
  const tints = new Uint8Array(vertices * 4);
  const occlusion = new Uint8Array(vertices);
  const indices = vertices < 65536 ? new Uint16Array(count) : new Uint32Array(count);
  let v = 0;
  let i = 0;
  for (const part of parts) {
    positions.set(part.positions, v * 3);
    tints.set(part.tints, v * 4);
    occlusion.set(part.occlusion, v);
    for (let k = 0; k < part.indices.length; k++) indices[i + k] = part.indices[k] + v;
    v += part.positions.length / 3;
    i += part.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("tint", new THREE.BufferAttribute(tints, 4, true));
  geometry.setAttribute("occlusion", new THREE.BufferAttribute(occlusion, 1, true));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const half = (REGION * 16) / 2;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, half, half), half * Math.sqrt(3));
  return geometry;
}

/** Meshes sections in the workers, each kept busy until all are done. */
function meshInWorkers(workers: Worker[], jobs: { key: string; blocks: Uint16Array; offset: [number, number, number] }[]): Promise<Map<string, SectionMesh>> {
  const results = new Map<string, SectionMesh>();
  return new Promise((resolve) => {
    if (jobs.length === 0) return resolve(results);
    let next = 0;
    let done = 0;
    const feed = (worker: Worker) => {
      if (next >= jobs.length) return;
      const job = jobs[next];
      worker.postMessage({ id: next++, blocks: job.blocks, offset: job.offset }, [job.blocks.buffer]);
    };
    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent) => {
        const { id, mesh } = event.data as { id: number; mesh: SectionMesh };
        results.set(jobs[id].key, mesh);
        if (++done === jobs.length) resolve(results);
        else feed(worker);
      };
      feed(worker);
    }
  });
}

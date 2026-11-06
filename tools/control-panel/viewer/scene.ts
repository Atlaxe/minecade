// The viewer page's 3D view: a map's blocks meshed in workers and grouped into region meshes
// (4x4x4 sections each, so a whole map is about 100 draw calls, and as many again for see-through
// blocks, drawn blended after the rest), one shader for every block face (shading baked in; corner
// darkening, brightness variation, darkening below the cut and the cut layer's grid as uniforms, so
// toggling them costs nothing), cuts as clipping planes with a cap of the cut layer (nothing is
// meshed again: docs/spike-results.md, "Map viewer"), Faded as the same meshes drawn again
// see-through on the other side of the cuts, outlines of hidden blocks (barriers, invisible
// bedrock, light) when asked, and the camera with its views. Everything is placed in world
// coordinates (Minecraft's: +x east, +y up, +z south); the meshes' positions are sixteenths of a
// block, scaled down.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { paddedSection, paddedWater, prepareLooks, SHADE, type Looks, type MeshPart, type Prepared, type SectionMesh } from "./mesher.ts";
import { covered, OPPOSITE, SEE_THROUGH, type Rect } from "./shapes.ts";
import { EAST, lookAtSpot, OUTLINED, pick, spotsOf, UP, WEST, NORTH, SOUTH, type Hit, type Keep, type Volume } from "./volume.ts";

/** Sections per region side. */
const REGION = 4;
/** A plane's constant for "no cut": far past every block. */
const FAR = 1e6;
/**
 * Blocks whose middle is this close to the camera aren't drawn, and clicks pass through them, so a
 * camera inside a wall sees and works on what's beyond it.
 */
export const CLIP_NEAR = 1;
/** How see-through Faded is. */
const FADED_OPACITY = 0.15;
/** Mesh positions are sixteenths of a block. */
const UNIT = 1 / 16;
/** The Hidden blocks outlines' colors: barriers, invisible bedrock, light blocks. */
const OUTLINE_COLORS = [0xf0505a, 0xa078ff, 0xffd23c];
/** The most hidden blocks outlined (a map walled in barriers has tens of thousands). */
const MAX_OUTLINED = 300_000;

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
uniform float clipNear;
uniform float useAlpha;
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
  vec3 block = floor(vWorld - n * 0.01);
  // A block the camera is in (or all but in) isn't drawn: flying through walls shows what's beyond.
  if (distance(block + 0.5, cameraPosition) < clipNear) discard;
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
  gl_FragColor = vec4(vTint.rgb * light, useAlpha > 0.5 ? vTint.a * opacity : opacity);
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
    clipNear: { value: CLIP_NEAR },
  };
  private readonly planes = { top: new THREE.Plane(new THREE.Vector3(0, -1, 0), FAR), x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), FAR), z: new THREE.Plane(new THREE.Vector3(0, 0, -1), FAR) };
  private readonly opposite = { top: new THREE.Plane(), x: new THREE.Plane(), z: new THREE.Plane() };
  private readonly solid: THREE.ShaderMaterial;
  private readonly glass: THREE.ShaderMaterial;
  private readonly faded: THREE.ShaderMaterial;
  private readonly fadedGlass: THREE.ShaderMaterial;
  private readonly prepared: Prepared;
  private outlines: THREE.Group | undefined;
  private readonly capMaterials: Record<"top" | "x" | "z", THREE.ShaderMaterial>;
  private readonly caps: Partial<Record<"top" | "x" | "z", THREE.Mesh>> = {};
  private readonly regions: THREE.Mesh[] = [];
  private readonly ghosts: THREE.Mesh[] = [];
  private cuts: Cuts = {};
  private toggles: Toggles = { occlusion: true, variation: true, darkenBelow: false, faded: true };
  private pending = false;
  /** Called after each frame drawn (the page's compass, the markers' names). */
  private readonly renderListeners: (() => void)[] = [];

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
    this.prepared = prepareLooks(this.looks());
    const material = (opacity: number, planes: THREE.Plane[], grid = false, alpha = false) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, opacity: { value: opacity }, grid: { value: grid ? 1 : 0 }, useAlpha: { value: alpha ? 1 : 0 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        clipping: true,
        clippingPlanes: planes,
        transparent: opacity < 1 || alpha,
        depthWrite: opacity >= 1 && !alpha,
      });
    this.solid = material(1, [this.planes.top, this.planes.x, this.planes.z]);
    this.glass = material(1, [this.planes.top, this.planes.x, this.planes.z], false, true);
    this.faded = material(FADED_OPACITY, [this.opposite.top, this.opposite.x, this.opposite.z]);
    this.fadedGlass = material(FADED_OPACITY, [this.opposite.top, this.opposite.x, this.opposite.z], false, true);
    // Past any cut: everything the solid meshes leave out (kept only where every opposite plane clips).
    this.faded.clipIntersection = true;
    this.fadedGlass.clipIntersection = true;
    this.capMaterials = {
      top: material(1, [this.planes.x, this.planes.z], true),
      x: material(1, [this.planes.top, this.planes.z], true),
      z: material(1, [this.planes.top, this.planes.x], true),
    };
    this.updatePlanes();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** What the mesher needs to know about the looks. */
  private looks(): Looks {
    return { drawn: this.volume.drawn, colors: this.volume.colors, table: this.volume.table };
  }

  /** Meshes every section in the workers, then builds the region meshes. */
  async build(workers: Worker[]): Promise<MeshStats> {
    const started = performance.now();
    const { volume } = this;
    const looks = this.looks();
    for (const worker of workers) worker.postMessage({ looks });
    const jobs: MeshJob[] = [];
    const [nx, ny, nz] = volume.sections;
    for (let cx = 0; cx < nx; cx++) {
      for (let cy = 0; cy < ny; cy++) {
        for (let cz = 0; cz < nz; cz++) {
          const blocks = paddedSection(volume.blocks, volume.size, volume.drawn, cx, cy, cz);
          if (!blocks) continue;
          const water = volume.water.size > 0 ? paddedWater(volume.water, volume.sections, cx, cy, cz) : undefined;
          jobs.push({ key: `${cx},${cy},${cz}`, blocks, water, offset: [(cx % REGION) * 16, (cy % REGION) * 16, (cz % REGION) * 16] });
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
    for (const [key, sections] of byRegion) {
      const [rx, ry, rz] = key.split(",").map(Number);
      // Solid faces, then see-through ones drawn blended after them (the Faded copies after both).
      for (const [part, material, faded, order] of [
        ["solid", this.solid, this.faded, 0],
        ["glass", this.glass, this.fadedGlass, 1],
      ] as const) {
        const parts = sections.map((section) => section[part]).filter((mesh) => mesh.indices.length > 0);
        if (parts.length === 0) continue;
        const geometry = regionGeometry(parts);
        const mesh = new THREE.Mesh(geometry, material);
        const ghost = new THREE.Mesh(geometry, faded);
        for (const each of [mesh, ghost]) {
          each.position.set(volume.origin[0] + rx * REGION * 16, volume.origin[1] + ry * REGION * 16, volume.origin[2] + rz * REGION * 16);
          each.scale.setScalar(UNIT);
          each.matrixAutoUpdate = false;
          each.updateMatrix();
          this.scene.add(each);
        }
        mesh.renderOrder = order;
        ghost.renderOrder = 2 + order;
        this.regions.push(mesh);
        this.ghosts.push(ghost);
      }
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
    const { cover, full, rects } = this.prepared;
    const { shapeOf, flags } = volume.table;
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
    // Cubes whose face the next layer hid are merged into rectangles (by look); other shapes add
    // the parts of their side that a neighbor hid, as the mesher left them out.
    const mask = new Int32Array(nu * nv);
    const pieces: { look: number; rect: Rect; i: number; j: number }[] = [];
    const p = [0, 0, 0];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        p[normalAxis] = layer;
        p[u] = i;
        p[v] = j;
        const look = lookAtSpot(volume, p[0], p[1], p[2]);
        if (!cover[look] || flags[look] & SEE_THROUGH) continue;
        p[normalAxis] += toward;
        const beyond = lookAtSpot(volume, p[0], p[1], p[2]);
        if (shapeOf[look] === 0) {
          if (full[beyond * 6 + OPPOSITE[face]]) mask[j * nu + i] = look;
          continue;
        }
        if (!cover[beyond]) continue;
        for (const rect of rects[shapeOf[look]][face]) if (covered(rects[shapeOf[beyond]][OPPOSITE[face]], rect)) pieces.push({ look, rect, i, j });
      }
    }
    const positions: number[] = [];
    const tints: number[] = [];
    const indices: number[] = [];
    const shade = SHADE[face];
    const plane = (layer + (toward > 0 ? 1 : 0)) * 16;
    // Facing toward the hidden side: counterclockwise seen from there. u x v points along +x
    // (y, z) and +z (x, y), but along -y for the height cut's (x, z).
    const forward = (normalAxis === 1 ? -1 : 1) * toward > 0;
    const quad = (look: number, u0: number, v0: number, u1: number, v1: number) => {
      const base = positions.length / 3;
      for (const [du, dv] of [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ]) {
        const c = [0, 0, 0];
        c[normalAxis] = plane;
        c[u] = du;
        c[v] = dv;
        positions.push(c[0], c[1], c[2]);
        const color = look * 24 + face * 4;
        tints.push(volume.colors[color] * shade, volume.colors[color + 1] * shade, volume.colors[color + 2] * shade, 255);
      }
      if (forward) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    for (const { look, rect, i, j } of pieces) quad(look, i * 16 + rect[0], j * 16 + rect[1], i * 16 + rect[2], j * 16 + rect[3]);
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
        quad(look, i * 16, j * 16, (i + width) * 16, (j + height) * 16);
        i += width;
      }
    }
    if (indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Uint16Array.from(positions), 3));
    geometry.setAttribute("tint", new THREE.BufferAttribute(Uint8Array.from(tints), 4, true));
    geometry.setAttribute("occlusion", new THREE.BufferAttribute(new Uint8Array(positions.length / 3).fill(255), 1, true));
    geometry.setIndex(positions.length / 3 < 65536 ? new THREE.BufferAttribute(Uint16Array.from(indices), 1) : new THREE.BufferAttribute(Uint32Array.from(indices), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(sx * 8, sy * 8, sz * 8), Math.hypot(sx, sy, sz) * 8);
    const mesh = new THREE.Mesh(geometry, this.capMaterials[axis]);
    mesh.position.set(...volume.origin);
    mesh.scale.setScalar(UNIT);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.caps[axis] = mesh;
    this.scene.add(mesh);
  }

  /** Shows or hides outlines of the hidden blocks a game uses: barriers, invisible bedrock, light blocks. */
  setOutlines(on: boolean): void {
    if (on && !this.outlines) this.outlines = this.buildOutlines();
    if (this.outlines) this.outlines.visible = on;
    this.requestRender();
  }

  /** How many hidden blocks the outlines show (after setOutlines(true)), and whether some were left out. */
  get outlined(): { blocks: number; capped: boolean } {
    return (this.outlines?.userData as { blocks: number; capped: boolean } | undefined) ?? { blocks: 0, capped: false };
  }

  /** Each outlined block's faces that don't touch another of its kind: a faint fill and its edges, in the kind's color. */
  private buildOutlines(): THREE.Group {
    const { volume } = this;
    const kinds = volume.looks.map((look) => (!OUTLINED.test(look.name) ? -1 : look.name.includes("barrier") ? 0 : look.name.includes("bedrock") ? 1 : 2));
    const spots = spotsOf(volume, (look) => kinds[look] >= 0, MAX_OUTLINED + 1);
    const capped = spots.length > MAX_OUTLINED;
    if (capped) spots.length = MAX_OUTLINED;
    const fill: number[] = [];
    const fillColors: number[] = [];
    const lines: number[] = [];
    const lineColors: number[] = [];
    const color = new THREE.Color();
    const [ox, oy, oz] = volume.origin;
    const steps: [number, number, number][] = [
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, -1],
      [0, 0, 1],
      [-1, 0, 0],
      [1, 0, 0],
    ];
    for (const [x, y, z] of spots) {
      const kind = kinds[lookAtSpot(volume, x, y, z)];
      color.setHex(OUTLINE_COLORS[kind]);
      for (let face = 0; face < 6; face++) {
        const [dx, dy, dz] = steps[face];
        if (kinds[lookAtSpot(volume, x + dx, y + dy, z + dz)] === kind) continue;
        const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
        const [u, v] = [0, 1, 2].filter((a) => a !== axis);
        const corners = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ].map(([cu, cv]) => {
          const c = [x + ox, y + oy, z + oz];
          c[axis] += steps[face][axis] > 0 ? 1 : 0;
          c[u] += cu;
          c[v] += cv;
          return c;
        });
        for (const index of [0, 1, 2, 0, 2, 3]) {
          fill.push(...corners[index]);
          fillColors.push(color.r, color.g, color.b);
        }
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ]) {
          lines.push(...corners[a], ...corners[b]);
          lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
    }
    const group = new THREE.Group();
    group.userData = { blocks: spots.length, capped };
    const planes = this.cutPlanes;
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fill, 3));
    fillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fillColors, 3));
    group.add(new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: planes })));
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    group.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, clippingPlanes: planes })));
    for (const child of group.children) child.renderOrder = 4;
    this.scene.add(group);
    return group;
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
   * Moves the camera to look at the whole map from a direction (the view cube's face, edge or
   * corner): straight down is Top's flat floor plan, anything else the perspective camera.
   */
  viewFrom(direction: [number, number, number]): void {
    const look = new THREE.Vector3(...direction);
    if (look.lengthSq() === 0) return;
    look.normalize();
    if (look.y > 0.999) return this.view("top");
    // Straight up from below would sit on the orbit's pole: tilt it a hair.
    if (look.y < -0.97) look.set(look.x, -0.97, look.z === 0 && look.x === 0 ? 0.24 : look.z).normalize();
    const { center, radius } = this.bounds();
    this.camera = this.perspective;
    this.controls.object = this.perspective;
    this.controls.enableRotate = true;
    this.perspective.position.copy(center).addScaledVector(look, this.fitDistance(center, look, radius));
    this.controls.target.copy(center);
    this.resize();
    this.controls.update();
    this.requestRender();
  }

  /** Which way the camera is turned (the view cube follows it). */
  get cameraQuaternion(): THREE.Quaternion {
    return this.camera.quaternion;
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

  /** Calls `listener` after every frame drawn. */
  addRenderListener(listener: () => void): void {
    this.renderListeners.push(listener);
  }

  /** Adds something to the scene (the markers' overlay). */
  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  /** The camera drawing now: the perspective one, or Top's. */
  get activeCamera(): THREE.Camera {
    return this.camera;
  }

  /** The planes that cut the blocks, for anything else that's cut with them (box faces). */
  get cutPlanes(): THREE.Plane[] {
    return [this.planes.top, this.planes.x, this.planes.z];
  }

  /** Whether what's past the cuts is drawn see-through (Faded) rather than not at all (Gone). */
  get isFaded(): boolean {
    return this.toggles.faded;
  }

  /**
   * Whether a point (a marker's feet) is kept by the cuts: the block it stands on is. A spawn on a
   * floor stays when the cut is at that floor.
   */
  isKept(at: { x: number; y: number; z: number }): boolean {
    const block = [Math.floor(at.x), Math.floor(at.y - 0.01), Math.floor(at.z)];
    const { top, x, z } = this.cuts;
    if (top !== undefined && block[1] > top) return false;
    if (x && (x.side === "below" ? block[0] > x.at : block[0] < x.at)) return false;
    if (z && (z.side === "below" ? block[2] > z.at : block[2] < z.at)) return false;
    return true;
  }

  /** Whether a height (a plane between layers) is at or under the top of the height cut. */
  isHeightKept(y: number): boolean {
    return this.cuts.top === undefined || y <= this.cuts.top + 1;
  }

  /** The box sheets across the map span: the blocks' box. */
  planeExtent(): { min: [number, number, number]; max: [number, number, number] } {
    return this.volume.box;
  }

  /** A ray from the camera through a spot on the canvas (pixels from the window's top left). */
  rayAt(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /**
   * Frames a spot: the view centers on it and moves in or out until a ball of `radius` around it
   * fills about two thirds of the view, keeping the direction it looks from.
   */
  frame(center: THREE.Vector3, radius: number): void {
    if (this.camera === this.orthographic) {
      const extent = (this.orthographic.userData.extent as number | undefined) ?? 64;
      this.orthographic.zoom = Math.max(0.05, extent / (radius * 1.5));
      this.orthographic.updateProjectionMatrix();
      this.orthographic.position.set(center.x, this.orthographic.position.y, center.z + 1e-3);
      this.controls.target.set(center.x, this.controls.target.y, center.z);
    } else {
      const direction = this.perspective.position.clone().sub(this.controls.target).normalize();
      const distance = Math.max(4, (radius * 1.5) / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
      this.controls.target.copy(center);
      this.perspective.position.copy(center).addScaledVector(direction, distance);
    }
    this.controls.update();
    this.requestRender();
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
  pickAt(clientX: number, clientY: number): (Hit & { world: [number, number, number]; distance: number }) | undefined {
    const ray = this.rayAt(clientX, clientY);
    const { origin } = this.volume;
    const from = [ray.ray.origin.x - origin[0], ray.ray.origin.y - origin[1], ray.ray.origin.z - origin[2]];
    const direction = [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z];
    const keep: Keep = {
      ...(this.cuts.top !== undefined ? { top: this.cuts.top - origin[1] } : {}),
      ...(this.cuts.x ? { x: { at: this.cuts.x.at - origin[0], side: this.cuts.x.side } } : {}),
      ...(this.cuts.z ? { z: { at: this.cuts.z.at - origin[2], side: this.cuts.z.side } } : {}),
    };
    const hit = pick(this.volume, from, direction, keep, CLIP_NEAR);
    if (!hit) return undefined;
    const distance = Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]);
    return { ...hit, world: [hit.block[0] + origin[0], hit.block[1] + origin[1], hit.block[2] + origin[2]], distance };
  }

  /** Draws on the next frame (only then: nothing is drawn while nothing changes). */
  requestRender(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderer.render(this.scene, this.camera);
      for (const listener of this.renderListeners) listener();
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

/** A region's mesh: its sections' meshes in one geometry (positions in sixteenths, 16-bit indices when they fit). */
function regionGeometry(parts: MeshPart[]): THREE.BufferGeometry {
  const vertices = parts.reduce((sum, part) => sum + part.positions.length / 3, 0);
  const count = parts.reduce((sum, part) => sum + part.indices.length, 0);
  const positions = new Uint16Array(vertices * 3);
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
  const half = (REGION * 16 * 16) / 2;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, half, half), half * Math.sqrt(3));
  return geometry;
}

interface MeshJob {
  key: string;
  blocks: Uint16Array;
  /** Layer 1 with its border, when there's any near. */
  water: Uint16Array | undefined;
  offset: [number, number, number];
}

/** Meshes sections in the workers, each kept busy until all are done. */
function meshInWorkers(workers: Worker[], jobs: MeshJob[]): Promise<Map<string, SectionMesh>> {
  const results = new Map<string, SectionMesh>();
  return new Promise((resolve) => {
    if (jobs.length === 0) return resolve(results);
    let next = 0;
    let done = 0;
    const feed = (worker: Worker) => {
      if (next >= jobs.length) return;
      const job = jobs[next];
      worker.postMessage({ id: next++, blocks: job.blocks, water: job.water, offset: job.offset }, job.water ? [job.blocks.buffer, job.water.buffer] : [job.blocks.buffer]);
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

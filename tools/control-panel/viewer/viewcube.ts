// The view cube in the viewport's top right corner, as Autodesk's tools have it: a cube turned the
// way the camera looks, its faces named for the compass (N, S, E, W) and Top and Bottom. A face, an
// edge or a corner under the pointer lights up; clicking it turns the view to look from that side
// (Top is the flat floor plan). Drawn by a small renderer of its own, only when the view changes.
import * as THREE from "three";

/** How close to an edge (in the cube's units, its side being 1) a point counts as on the edge. */
const EDGE = 0.17;
const LABELS = ["E", "W", "TOP", "BOTTOM", "S", "N"];

/** A spot on the cube as a direction: each axis -1, 0 or 1 (one for a face, two for an edge, three for a corner). */
export function cubeRegion(point: { x: number; y: number; z: number }): [number, number, number] {
  return [point.x, point.y, point.z].map((value) => (Math.abs(value) > 0.5 - EDGE ? Math.sign(value) : 0)) as [number, number, number];
}

/** The region's name, for its tooltip: "Top", "North", "Top north-east". */
export function regionName([x, y, z]: [number, number, number]): string {
  const height = y > 0 ? "top" : y < 0 ? "bottom" : "";
  const compass = `${z < 0 ? "north" : z > 0 ? "south" : ""}${z !== 0 && x !== 0 ? "-" : ""}${x > 0 ? "east" : x < 0 ? "west" : ""}`;
  const words = [height, compass].filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export class ViewCube {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 10);
  private readonly cube: THREE.Mesh;
  private readonly highlight: THREE.Mesh;
  private readonly ray = new THREE.Raycaster();
  private hovered: [number, number, number] | undefined;
  private queued = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onPick: (direction: [number, number, number]) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(devicePixelRatio);
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) => style.getPropertyValue(name).trim() || "#888888";
    const materials = LABELS.map((label) => new THREE.MeshBasicMaterial({ map: faceTexture(label, color("--surface"), color("--text"), color("--line-strong")) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
    this.scene.add(this.cube);
    this.cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: color("--line-strong") })));
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: color("--primary"), transparent: true, opacity: 0.55, depthWrite: false }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    const size = () => {
      const { clientWidth, clientHeight } = canvas;
      this.renderer.setSize(clientWidth || 1, clientHeight || 1, false);
      this.draw();
    };
    new ResizeObserver(size).observe(canvas);
    size();
    canvas.addEventListener("pointermove", (event) => this.hover(this.regionAt(event)));
    canvas.addEventListener("pointerleave", () => this.hover(undefined));
    canvas.addEventListener("click", (event) => {
      const region = this.regionAt(event);
      if (region) this.onPick(region);
    });
    document.fonts?.ready.then(() => {
      // Labels drawn before the heading font arrived are drawn again in it.
      materials.forEach((material, i) => {
        material.map?.dispose();
        material.map = faceTexture(LABELS[i], color("--surface"), color("--text"), color("--line-strong"));
        material.needsUpdate = true;
      });
      this.draw();
    });
  }

  /**
   * Turns the cube the way the main camera looks. Top's and Bottom's labels turn a quarter at a
   * time with the camera's heading, so they read upright from whichever side it looks.
   */
  sync(quaternion: THREE.Quaternion): void {
    this.camera.quaternion.copy(quaternion);
    this.camera.position.set(0, 0, 3).applyQuaternion(quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    // Looking straight down or up, the screen's up is the heading; otherwise the view's direction is.
    const heading = Math.abs(forward.y) > 0.99 ? up : forward;
    const quarter = Math.round(Math.atan2(heading.x, -heading.z) / (Math.PI / 2));
    const materials = this.cube.material as THREE.MeshBasicMaterial[];
    for (const [face, sign] of [[2, -1], [3, 1]] as const) {
      const map = materials[face].map;
      if (!map) continue;
      const rotation = sign * quarter * (Math.PI / 2);
      if (map.rotation !== rotation) {
        map.center.set(0.5, 0.5);
        map.rotation = rotation;
      }
    }
    this.draw();
  }

  private regionAt(event: PointerEvent | MouseEvent): [number, number, number] | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.cube, false)[0];
    return hit ? cubeRegion(hit.point) : undefined;
  }

  private hover(region: [number, number, number] | undefined): void {
    if (region?.join() === this.hovered?.join()) return;
    this.hovered = region;
    this.canvas.style.cursor = region ? "pointer" : "";
    this.canvas.title = region ? `View from ${regionName(region).toLowerCase()}` : "";
    this.highlight.visible = region !== undefined;
    if (region) {
      // A face's middle, an edge's strip or a corner's block, a hair outside the cube.
      const scale = region.map((axis) => (axis === 0 ? 1 - EDGE * 2 : EDGE + 0.01));
      this.highlight.scale.set(scale[0], scale[1], scale[2]);
      this.highlight.position.set(...(region.map((axis) => axis * (0.5 - EDGE / 2 + 0.006)) as [number, number, number]));
    }
    this.draw();
  }

  private draw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.renderer.render(this.scene, this.camera);
    });
  }
}

/** A face's texture: its label on the face's color, with a rule inside its edge. */
function faceTexture(label: string, fill: string, ink: string, rule: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const context = canvas.getContext("2d")!;
  context.fillStyle = fill;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = rule;
  context.lineWidth = 4;
  context.strokeRect(10, 10, size - 20, size - 20);
  context.fillStyle = ink;
  context.font = `600 ${label.length > 3 ? 26 : 44}px "Chakra Petch", "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, size / 2, size / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

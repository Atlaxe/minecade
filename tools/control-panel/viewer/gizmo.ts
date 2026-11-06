// The picked entry's gizmo, as Blockbench and Axiom draw theirs, X red, Y green and Z blue:
// - Move: a cube in the middle with an arrow out of it each way along X, Y and Z. Dragging an
//   arrow moves the entry along its axis; clicking one steps it a block that way; dragging the cube
//   moves it across, at the same height.
// - Expand (boxes): a square on each face, opposite faces joined by a line along their axis.
//   Dragging a square moves that face.
// It's drawn over everything and keeps about the same size on the screen whatever the zoom.
import * as THREE from "three";
import type { Box } from "@minecade/minigame-core/config";
import type { Face } from "./boxes.ts";
import type { MapScene } from "./scene.ts";

export type GizmoPart = { kind: "arrow"; axis: 0 | 1 | 2; sign: 1 | -1 } | { kind: "center" } | { kind: "face"; face: Face };

/** The gizmo's size: an arrow reaches about this many pixels out from the middle. */
const ARROW_PIXELS = 78;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export class Gizmo {
  private readonly root = new THREE.Group();
  private readonly move = new THREE.Group();
  private readonly expand = new THREE.Group();
  private readonly colors: number[];
  private readonly white: number;
  private readonly hot: number;
  private box: Box | undefined;
  private active: string | undefined;

  constructor(private readonly scene: MapScene) {
    const style = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => new THREE.Color(style.getPropertyValue(name).trim() || fallback).getHex();
    this.colors = [color("--axis-x", "#f0605a"), color("--axis-y", "#5ccf6e"), color("--axis-z", "#4f8ff7")];
    this.white = 0xf4f8fb;
    this.hot = 0xffe066;
    this.root.visible = false;
    this.root.add(this.move, this.expand);
    scene.add(this.root);
    this.buildMove();
    this.buildExpand();
    scene.addRenderListener(() => this.fit());
  }

  /** Shows the move gizmo at a spot, with arrows along these axes (all three when not given). */
  showMove(center: THREE.Vector3, axes: (0 | 1 | 2)[] = [0, 1, 2]): void {
    this.root.visible = true;
    this.move.visible = true;
    this.expand.visible = false;
    this.root.position.copy(center);
    this.box = undefined;
    for (const child of this.move.children) {
      const part = child.userData.part as GizmoPart | undefined;
      child.visible = !part || part.kind !== "arrow" || axes.includes(part.axis);
      if (part?.kind === "center") child.visible = axes.length > 1;
    }
    this.fit();
  }

  /** Shows the expand gizmo on a box's faces. */
  showExpand(box: Box): void {
    this.root.visible = true;
    this.move.visible = false;
    this.expand.visible = true;
    this.box = box;
    const center = [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis] + 1) / 2);
    this.root.position.set(center[0], center[1], center[2]);
    for (const child of this.expand.children) {
      const face = child.userData.part?.face as Face | undefined;
      const axis = child.userData.line as number | undefined;
      const half = (a: number) => (box.max[a] - box.min[a] + 1) / 2 + 0.02;
      if (face) {
        const spot = new THREE.Vector3();
        spot.setComponent(face.axis, (face.side === "max" ? 1 : -1) * half(face.axis));
        child.position.copy(spot);
      } else if (axis !== undefined) {
        child.scale.set(1, 1, 1);
        child.scale.setComponent(axis, half(axis));
      }
    }
    this.fit();
  }

  hide(): void {
    this.root.visible = false;
    this.scene.requestRender();
  }

  /** Lights up a part (the face the arrow keys move, or the part being dragged), or none. */
  setActive(part: GizmoPart | undefined): void {
    this.active = part ? partKey(part) : undefined;
    for (const group of [this.move, this.expand]) {
      group.traverse((object) => {
        const own = object.userData.part as GizmoPart | undefined;
        if (!own || !(object instanceof THREE.Mesh) || object.userData.color === undefined) return;
        const hot = partKey(own) === this.active;
        (object.material as THREE.MeshBasicMaterial).color.setHex(hot ? this.hot : (object.userData.color as number));
      });
    }
    this.scene.requestRender();
  }

  /** The part under a spot on the canvas, if the gizmo shows. */
  partAt(clientX: number, clientY: number): GizmoPart | undefined {
    if (!this.root.visible) return undefined;
    const group = this.move.visible ? this.move : this.expand;
    const targets = group.children.filter((child) => child.visible && child.userData.part);
    const hit = this.scene.rayAt(clientX, clientY).intersectObjects(targets, true)[0];
    let object: THREE.Object3D | null = hit?.object ?? null;
    while (object && !object.userData.part) object = object.parent;
    return object?.userData.part as GizmoPart | undefined;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** The gizmo's middle in the world. */
  get center(): THREE.Vector3 {
    return this.root.position.clone();
  }

  private buildMove(): void {
    const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.62, 10).translate(0, 0.51, 0);
    const head = new THREE.ConeGeometry(0.12, 0.3, 14).translate(0, 0.95, 0);
    const hitbox = new THREE.CylinderGeometry(0.16, 0.16, 0.95, 8).translate(0, 0.65, 0);
    for (const axis of [0, 1, 2] as const) {
      for (const sign of [1, -1] as const) {
        const part: GizmoPart = { kind: "arrow", axis, sign };
        const color = this.colors[axis];
        const material = this.material(color);
        const arrow = new THREE.Group();
        arrow.userData.part = part;
        arrow.userData.color = color;
        const meshes = [new THREE.Mesh(shaft, material), new THREE.Mesh(head, material)];
        for (const mesh of meshes) {
          mesh.userData.part = part;
          mesh.userData.color = color;
          arrow.add(mesh);
        }
        // An invisible, fatter shape to grab.
        const grab = new THREE.Mesh(hitbox, new THREE.MeshBasicMaterial({ visible: false }));
        grab.userData.part = part;
        arrow.add(grab);
        // The arrows point up (+y) as built: turn each onto its axis and side.
        const to = AXES[axis].clone().multiplyScalar(sign);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to);
        this.move.add(arrow);
      }
    }
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), this.material(this.white));
    cube.userData.part = { kind: "center" } satisfies GizmoPart;
    cube.userData.color = this.white;
    this.move.add(cube);
    for (const child of this.move.children) child.traverse((object) => (object.renderOrder = 20));
  }

  private buildExpand(): void {
    for (const axis of [0, 1, 2] as const) {
      // The line joining the axis's two faces: a unit line along the axis, stretched to the box.
      const points = [new THREE.Vector3(), new THREE.Vector3()];
      points[0].setComponent(axis, -1);
      points[1].setComponent(axis, 1);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: this.colors[axis], depthTest: false, transparent: true, opacity: 0.8 }));
      line.userData.line = axis;
      line.renderOrder = 19;
      this.expand.add(line);
      for (const side of ["min", "max"] as const) {
        const part: GizmoPart = { kind: "face", face: { axis, side } };
        const square = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), this.material(this.colors[axis]));
        square.userData.part = part;
        square.userData.color = this.colors[axis];
        square.renderOrder = 20;
        this.expand.add(square);
      }
    }
  }

  private material(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  }

  /** Scales the arrows and squares so they keep their size on the screen. */
  private fit(): void {
    if (!this.root.visible) return;
    const camera = this.scene.activeCamera;
    const height = this.scene.renderer.domElement.clientHeight || 1;
    let perPixel: number;
    if (camera instanceof THREE.OrthographicCamera) perPixel = (camera.top - camera.bottom) / camera.zoom / height;
    else {
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
      perPixel = (2 * camera.position.distanceTo(this.root.position) * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / height;
    }
    const size = ARROW_PIXELS * perPixel;
    let changed = Math.abs(this.move.scale.x - size) > size * 0.01;
    this.move.scale.setScalar(size);
    for (const child of this.expand.children) {
      if (child.userData.part) {
        const before = child.scale.x;
        child.scale.setScalar(size);
        if (Math.abs(before - size) > size * 0.01) changed = true;
      }
    }
    if (changed) this.scene.requestRender();
  }
}

function partKey(part: GizmoPart): string {
  return part.kind === "arrow" ? `arrow${part.axis}${part.sign}` : part.kind === "face" ? `face${part.face.axis}${part.face.side}` : "center";
}

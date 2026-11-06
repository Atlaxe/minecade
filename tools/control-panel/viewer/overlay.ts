// The viewer's markup over the blocks (markup.ts's data): each point as game Edit draws it (its
// mannequin or post in the list's color, or the game's own model with its "tint" bones in the
// team's color) with a red facing line and its name over it; each box as edges (also faintly
// through blocks) and see-through faces; kill Y and the build limit as sheets across the map.
// Points past a cut are faded or gone with the blocks; box faces are cut with them. While a tool
// works, a see-through ghost shows where a new point goes, a dragged point moves with the pointer,
// and the picked point has a knob on the floor that turns its facing. A box being drawn or dragged
// shows as a preview with its size. The move and resize handles are the gizmo's (gizmo.ts).
import * as THREE from "three";
import { geoHeight, parseGeo, type FaceName, type Geo, type GeoBone } from "./geo.ts";
import type { Box } from "@minecade/minigame-core/config";
import { FACING_COLOR, type BoxMark, type Markup, type PlaneMark, type PointMark, type Shape } from "./markup.ts";
import type { MapScene } from "./scene.ts";

/** Game Edit's shapes and the game's models, as the Panel sends them (map-data.ts). */
export interface MarkerAssets {
  shapes: { player: unknown; post: unknown };
  models: Record<string, { geometry: unknown; texture: string }>;
}

/** How bright each face of a marker is (blocks' shading, a little softer). */
const FACE_SHADE: Record<FaceName, number> = { up: 1, down: 0.55, north: 0.85, south: 0.85, east: 0.7, west: 0.7 };
/** Facing line heights in blocks: a mannequin's at its eyes, every other marker's lower (editor_marker_line_low). */
const LINE_HEIGHT = { player: 28 / 16, other: 14 / 16 };
const LINE_LENGTH = 2;
const FADED = 0.2;
/** How see-through a point that's being placed is. */
const GHOST = 0.45;
/** How far from a picked point's feet its facing knob is, in blocks. */
export const KNOB_DISTANCE = 1.6;
/** How far box faces and edges stand off the blocks they enclose, so they don't flicker on them. */
const BOX_GAP = 0.02;
/** A preview box that can't be saved (smaller than its region's minSize). */
const BAD_COLOR = 0xff3b30;

interface ShapeModel {
  geo: Geo;
  texture?: THREE.Texture;
  /** Its top, in blocks above the feet. */
  height: number;
}

interface PointObject {
  mark: PointMark;
  group: THREE.Group;
  materials: THREE.Material[];
  tag: HTMLDivElement;
  /** Where its name goes, above its head. */
  anchor: THREE.Vector3;
}

interface BoxObject {
  mark: BoxMark;
  faces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  through: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface PlaneObject {
  mark: PlaneMark;
  sheet: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

export class Overlay {
  private readonly root = new THREE.Group();
  private readonly shapes = new Map<string, ShapeModel>();
  private points: PointObject[] = [];
  private boxes: BoxObject[] = [];
  private planes: PlaneObject[] = [];
  private readonly ring: THREE.Mesh;
  private readonly knob: THREE.Mesh;
  private ghost: { group: THREE.Group; materials: THREE.Material[] } | undefined;
  private picked: string | undefined;
  private names = true;
  /** A box drawn or dragged: edges, faces and its size over it. */
  private readonly preview: { faces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; through: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> };
  private previewBox: Box | undefined;
  private readonly sizeTag: HTMLDivElement;
  /** A box or height drawn by the preview while it's dragged (its own drawing is hidden). */
  private editing: string | undefined;

  constructor(
    private readonly scene: MapScene,
    assets: MarkerAssets,
    private readonly tags: HTMLElement,
  ) {
    scene.add(this.root);
    this.shapes.set("player", shapeModel(parseGeo(assets.shapes.player)));
    this.shapes.set("post", shapeModel(parseGeo(assets.shapes.post)));
    for (const [name, model] of Object.entries(assets.models)) {
      try {
        const texture = new THREE.TextureLoader().load(model.texture, () => scene.requestRender());
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.shapes.set(`model:${name}`, { ...shapeModel(parseGeo(model.geometry)), texture });
      } catch {
        // A model that can't be read is drawn as a post, as game Edit does for one it doesn't have.
      }
    }
    // The picked point's ring, around its feet.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.root.add(this.ring);
    // The picked point's facing knob: drag it around the point to turn it.
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: FACING_COLOR, depthTest: false, transparent: true, opacity: 0.95 }));
    this.knob.renderOrder = 11;
    this.knob.visible = false;
    this.root.add(this.knob);
    // The preview box: a unit box, moved and scaled to the box shown.
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    const outline = new THREE.EdgesGeometry(unit);
    this.preview = {
      faces: new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })),
      edges: new THREE.LineSegments(outline, new THREE.LineBasicMaterial({})),
      through: new THREE.LineSegments(outline, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthTest: false })),
    };
    this.preview.faces.renderOrder = 4;
    this.preview.through.renderOrder = 4;
    for (const object of Object.values(this.preview)) {
      object.visible = false;
      this.root.add(object);
    }
    this.sizeTag = document.createElement("div");
    this.sizeTag.className = "tag size";
    this.sizeTag.hidden = true;
    tags.append(this.sizeTag);
    scene.addRenderListener(() => {
      this.placeTags();
      this.placeSizeTag();
    });
  }

  /** Shows a box being drawn or dragged, red when it can't be saved, with its size over it (or none). */
  showBox(box: Box | undefined, color: number, size?: string, bad = false): void {
    this.previewBox = box;
    for (const object of Object.values(this.preview)) object.visible = box !== undefined;
    if (box) {
      const shown = bad ? BAD_COLOR : color;
      const extent = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis] + 1 + BOX_GAP * 2);
      for (const object of Object.values(this.preview)) {
        object.position.set(box.min[0] - BOX_GAP, box.min[1] - BOX_GAP, box.min[2] - BOX_GAP);
        object.scale.set(extent[0], extent[1], extent[2]);
        object.material.color.setHex(shown);
      }
    }
    this.sizeTag.textContent = size ?? "";
    this.sizeTag.classList.toggle("bad", bad);
    this.scene.requestRender();
  }

  /** Hides a box's or height's own drawing while the preview shows it (or none). */
  hideWhileEditing(key: string | undefined): void {
    this.editing = key;
    this.refresh();
  }

  /** Draws a height's sheet at another height while it's dragged (the map isn't changed). */
  previewHeight(key: string, y: number): void {
    const plane = this.planes.find((candidate) => candidate.mark.key === key);
    if (!plane) return;
    plane.sheet.position.y = y - plane.mark.y;
    plane.edge.position.y = y - plane.mark.y;
    this.scene.requestRender();
  }

  /** The middle of a height's sheet, at a height (its gizmo goes there). */
  heightSpot(key: string, y: number): THREE.Vector3 | undefined {
    const plane = this.planes.find((candidate) => candidate.mark.key === key);
    if (!plane) return undefined;
    const bounds = plane.sheet.geometry.boundingBox ?? (plane.sheet.geometry.computeBoundingBox(), plane.sheet.geometry.boundingBox!);
    const middle = new THREE.Vector3();
    bounds.getCenter(middle);
    return middle.setY(y);
  }

  /** Draws a map's markup, replacing what was drawn. */
  set(markup: Markup): void {
    this.clear();
    for (const mark of markup.points) this.points.push(this.point(mark));
    for (const mark of markup.boxes) this.boxes.push(this.box(mark));
    for (const mark of markup.planes) this.planes.push(this.plane(mark));
    this.refresh();
  }

  /** Shows an entry as picked (or none): a ring around a point, brighter edges and faces on a box. */
  pick(key: string | undefined): void {
    this.picked = key;
    this.refresh();
  }

  /** Names over the points, or none. */
  showNames(on: boolean): void {
    this.names = on;
    this.refresh();
  }

  /** The point under a spot on the canvas, and how far along the ray it is (faded ones aren't clicked). */
  pointAt(clientX: number, clientY: number): { key: string; distance: number } | undefined {
    const ray = this.scene.rayAt(clientX, clientY);
    const kept = this.points.filter((point) => point.group.visible && this.scene.isKept(point.mark.at));
    const hits = ray.intersectObjects(
      kept.map((point) => point.group),
      true,
    );
    const hit = hits.find((candidate) => candidate.object.userData.pickable === true);
    if (!hit) return undefined;
    let object: THREE.Object3D | null = hit.object;
    while (object && object.userData.key === undefined) object = object.parent;
    return object ? { key: object.userData.key as string, distance: hit.distance } : undefined;
  }

  /** How far along the ray from a spot on the canvas the picked point's facing knob is, if the ray meets it. */
  knobAt(clientX: number, clientY: number): number | undefined {
    if (!this.knob.visible) return undefined;
    const hit = this.scene.rayAt(clientX, clientY).intersectObject(this.knob)[0];
    return hit?.distance;
  }

  /** Shows a see-through point where a new entry would go (or none). */
  setGhost(mark: PointMark | undefined): void {
    if (this.ghost) {
      this.root.remove(this.ghost.group);
      this.ghost.group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      for (const material of this.ghost.materials) material.dispose();
      this.ghost = undefined;
    }
    if (mark) {
      const built = this.buildPoint(mark);
      for (const material of built.materials) Object.assign(material, { transparent: true, opacity: GHOST, depthWrite: false });
      built.group.renderOrder = 5;
      built.group.visible = false;
      this.root.add(built.group);
      this.ghost = { group: built.group, materials: built.materials };
    }
    this.scene.requestRender();
  }

  /** Puts the ghost at a spot, turned to a yaw, or hides it (undefined). */
  moveGhost(at: { x: number; y: number; z: number } | undefined, yaw: number): void {
    if (!this.ghost) return;
    this.ghost.group.visible = at !== undefined;
    if (at) {
      this.ghost.group.position.set(at.x, at.y, at.z);
      this.ghost.group.rotation.y = THREE.MathUtils.degToRad(-yaw);
    }
    this.scene.requestRender();
  }

  /** Draws a point somewhere else, or turned another way, while it's dragged (the map isn't changed). */
  previewPoint(key: string, at: { x: number; y: number; z: number }, yaw: number): void {
    const point = this.points.find((candidate) => candidate.mark.key === key);
    if (!point) return;
    point.group.position.set(at.x, at.y, at.z);
    point.group.rotation.y = THREE.MathUtils.degToRad(-yaw);
    point.anchor.set(at.x, at.y + point.anchor.y - point.mark.at.y, at.z);
    point.mark = { ...point.mark, at: { ...at }, yaw };
    this.refresh();
  }

  /** Where an entry is, to frame it: a middle and a radius. */
  extent(key: string): { center: THREE.Vector3; radius: number; floor: number } | undefined {
    const point = this.points.find((candidate) => candidate.mark.key === key);
    if (point) {
      const { x, y, z } = point.mark.at;
      return { center: new THREE.Vector3(x, y + 1, z), radius: 5, floor: Math.floor(y) };
    }
    const box = this.boxes.find((candidate) => candidate.mark.key === key);
    if (box) {
      const { min, max } = box.mark.box;
      const center = new THREE.Vector3((min[0] + max[0] + 1) / 2, (min[1] + max[1] + 1) / 2, (min[2] + max[2] + 1) / 2);
      return { center, radius: Math.max(2, Math.hypot(max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1) / 2), floor: max[1] };
    }
    const plane = this.planes.find((candidate) => candidate.mark.key === key);
    if (plane) {
      const box = plane.sheet.geometry.boundingBox ?? plane.sheet.geometry.computeBoundingBox() ?? plane.sheet.geometry.boundingBox;
      const center = new THREE.Vector3();
      box?.getCenter(center);
      center.y = plane.mark.y;
      const size = new THREE.Vector3();
      box?.getSize(size);
      return { center, radius: Math.max(4, Math.hypot(size.x, size.z) / 2), floor: plane.mark.y };
    }
    return undefined;
  }

  /** Puts the size over the box being drawn or dragged. */
  private placeSizeTag(): void {
    const box = this.previewBox;
    this.sizeTag.hidden = !box || !this.sizeTag.textContent;
    if (!box || this.sizeTag.hidden) return;
    const spot = new THREE.Vector3((box.min[0] + box.max[0] + 1) / 2, box.max[1] + 1.2, (box.min[2] + box.max[2] + 1) / 2).project(this.scene.activeCamera);
    this.sizeTag.style.transform = `translate(${((spot.x + 1) / 2) * this.tags.clientWidth}px, ${((1 - spot.y) / 2) * this.tags.clientHeight}px) translate(-50%, -100%)`;
  }

  /** Shows what's past the cuts faded or not at all, as the blocks are. Called after a cut or toggle changes. */
  refresh(): void {
    const faded = this.scene.isFaded;
    let ring: PointObject | undefined;
    for (const point of this.points) {
      const kept = this.scene.isKept(point.mark.at);
      point.group.visible = kept || faded;
      for (const material of point.materials) {
        material.transparent = !kept;
        material.opacity = kept ? 1 : FADED;
        material.depthWrite = kept;
      }
      if (point.mark.key === this.picked && point.group.visible) ring = point;
    }
    this.ring.visible = ring !== undefined;
    this.knob.visible = ring !== undefined && this.scene.isKept(ring.mark.at);
    if (ring) {
      const { x, y, z } = ring.mark.at;
      this.ring.position.set(x, y + 0.03, z);
      const yaw = THREE.MathUtils.degToRad(ring.mark.yaw);
      this.knob.position.set(x - Math.sin(yaw) * KNOB_DISTANCE, y + 0.15, z + Math.cos(yaw) * KNOB_DISTANCE);
    }
    for (const box of this.boxes) {
      const picked = box.mark.key === this.picked;
      for (const object of [box.faces, box.edges, box.through]) object.visible = box.mark.key !== this.editing;
      box.faces.material.opacity = picked ? 0.16 : 0.05;
      box.through.material.opacity = picked ? 0.85 : 0.22;
      box.edges.material.color.setHex(picked ? 0xffffff : box.mark.color);
    }
    for (const plane of this.planes) {
      const kept = this.scene.isHeightKept(plane.mark.y);
      const picked = plane.mark.key === this.picked;
      plane.sheet.visible = kept || faded || plane.mark.key === this.editing;
      plane.edge.visible = plane.sheet.visible;
      if (plane.mark.key !== this.editing) {
        plane.sheet.position.y = 0;
        plane.edge.position.y = 0;
      }
      plane.sheet.material.opacity = (picked ? 0.4 : 0.2) * (kept ? 1 : 0.4);
      plane.edge.material.color.setHex(picked ? 0xffffff : plane.mark.color);
    }
    this.scene.requestRender();
  }

  private clear(): void {
    for (const point of this.points) {
      this.root.remove(point.group);
      point.group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
      for (const material of point.materials) material.dispose();
      point.tag.remove();
    }
    for (const box of this.boxes) {
      for (const object of [box.faces, box.edges, box.through]) {
        this.root.remove(object);
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    for (const plane of this.planes) {
      for (const object of [plane.sheet, plane.edge]) {
        this.root.remove(object);
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    this.points = [];
    this.boxes = [];
    this.planes = [];
  }

  private point(mark: PointMark): PointObject {
    const { group, materials, height } = this.buildPoint(mark);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.line !== true) object.userData.pickable = true;
    });
    this.root.add(group);
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = mark.label;
    tag.style.setProperty("--tag-color", `#${mark.color.toString(16).padStart(6, "0")}`);
    this.tags.append(tag);
    const anchor = new THREE.Vector3(mark.at.x, mark.at.y + Math.max(height, 1) + 0.3, mark.at.z);
    return { mark, group, materials, tag, anchor };
  }

  /** A point's marker: its shape turned to its yaw at its spot, and the facing line. */
  private buildPoint(mark: PointMark): { group: THREE.Group; materials: THREE.Material[]; height: number } {
    const shape = this.shapeFor(mark.shape);
    const group = new THREE.Group();
    group.userData.key = mark.key;
    group.position.set(mark.at.x, mark.at.y, mark.at.z);
    // Yaw 0 faces south (+z); a model's front is its file's -z, so the file's z is mirrored.
    group.rotation.y = THREE.MathUtils.degToRad(-mark.yaw);
    const materials: THREE.Material[] = [];
    const model = new THREE.Group();
    model.scale.set(1 / 16, 1 / 16, -1 / 16);
    group.add(model);
    const isModel = mark.shape.kind === "model" && shape.texture !== undefined;
    const body = new THREE.MeshBasicMaterial(isModel ? { map: shape.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide } : { color: mark.color, vertexColors: true, side: THREE.DoubleSide });
    const tint = new THREE.MeshBasicMaterial({ color: mark.color, side: THREE.DoubleSide });
    materials.push(body, tint);
    addBones(model, shape.geo, (bone) => (bone.name === "tint" ? tint : body));
    // The facing line: from the marker's eyes (a post's middle), two blocks long, tilted by the pitch.
    const lineMaterial = new THREE.MeshBasicMaterial({ color: FACING_COLOR });
    materials.push(lineMaterial);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, LINE_LENGTH).translate(0, 0, LINE_LENGTH / 2), lineMaterial);
    line.position.y = mark.shape.kind === "player" ? LINE_HEIGHT.player : LINE_HEIGHT.other;
    line.rotation.x = THREE.MathUtils.degToRad(mark.pitch);
    line.userData.line = true;
    group.add(line);
    return { group, materials, height: shape.height };
  }

  private shapeFor(shape: Shape): ShapeModel {
    return (shape.kind === "model" ? this.shapes.get(`model:${shape.model}`) : this.shapes.get(shape.kind)) ?? this.shapes.get("post")!;
  }

  private box(mark: BoxMark): BoxObject {
    const { min, max } = mark.box;
    const size = [0, 1, 2].map((axis) => max[axis] - min[axis] + 1 + BOX_GAP * 2);
    const center = [0, 1, 2].map((axis) => (min[axis] + max[axis] + 1) / 2);
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]).translate(center[0], center[1], center[2]);
    const faces = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: mark.color, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: this.scene.cutPlanes }));
    const outline = new THREE.EdgesGeometry(geometry);
    const edges = new THREE.LineSegments(outline, new THREE.LineBasicMaterial({ color: mark.color }));
    const through = new THREE.LineSegments(outline.clone(), new THREE.LineBasicMaterial({ color: mark.color, transparent: true, opacity: 0.22, depthTest: false }));
    faces.renderOrder = 2;
    through.renderOrder = 3;
    this.root.add(faces, edges, through);
    return { mark, faces, edges, through };
  }

  private plane(mark: PlaneMark): PlaneObject {
    const { min, max } = this.scene.planeExtent();
    const [x0, z0, x1, z1] = [min[0] - 1, min[2] - 1, max[0] + 2, max[2] + 2];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([x0, mark.y, z0, x1, mark.y, z0, x1, mark.y, z1, x0, mark.y, z1], 3));
    geometry.setIndex([0, 2, 1, 0, 3, 2]);
    geometry.computeBoundingBox();
    const sheet = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: mark.color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
    const edge = new THREE.LineLoop(geometry.clone().setIndex(null), new THREE.LineBasicMaterial({ color: mark.color }));
    sheet.renderOrder = 2;
    this.root.add(sheet, edge);
    return { mark, sheet, edge };
  }

  /** Puts each name over its point on the canvas (after every frame). */
  private placeTags(): void {
    const camera = this.scene.activeCamera;
    const width = this.tags.clientWidth;
    const height = this.tags.clientHeight;
    const spot = new THREE.Vector3();
    for (const point of this.points) {
      const shown = this.names && point.group.visible && this.scene.isKept(point.mark.at);
      spot.copy(point.anchor).project(camera);
      const onScreen = shown && spot.z < 1 && spot.z > -1 && Math.abs(spot.x) < 1.1 && Math.abs(spot.y) < 1.1;
      point.tag.hidden = !onScreen;
      point.tag.classList.toggle("picked", point.mark.key === this.picked);
      if (onScreen) point.tag.style.transform = `translate(${((spot.x + 1) / 2) * width}px, ${((1 - spot.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }
}

function shapeModel(geo: Geo): ShapeModel {
  return { geo, height: geoHeight(geo).high / 16 };
}

/** Adds a geometry's bones as groups turned around their pivots, each bone's cubes as one mesh. */
function addBones(parent: THREE.Group, geo: Geo, material: (bone: GeoBone) => THREE.Material): void {
  const byName = new Map(geo.bones.map((bone) => [bone.name, bone]));
  const placed = new Map<string, { group: THREE.Group; pivot: [number, number, number] }>();
  // Each bone under its parent's group (placed first), at its pivot; a missing parent puts it at the root.
  const place = (bone: GeoBone, depth: number): { group: THREE.Group; pivot: [number, number, number] } => {
    const done = placed.get(bone.name);
    if (done) return done;
    const upper = bone.parent ? byName.get(bone.parent) : undefined;
    const above = upper && upper !== bone && depth < 32 ? place(upper, depth + 1) : undefined;
    const group = new THREE.Group();
    const base = above?.pivot ?? [0, 0, 0];
    group.position.set(bone.pivot[0] - base[0], bone.pivot[1] - base[1], bone.pivot[2] - base[2]);
    if (bone.rotation) group.rotation.set(...(bone.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees)) as [number, number, number]), "ZYX");
    (above?.group ?? parent).add(group);
    const entry = { group, pivot: bone.pivot };
    placed.set(bone.name, entry);
    const geometry = boneGeometry(bone);
    if (geometry) group.add(new THREE.Mesh(geometry, material(bone)));
    return entry;
  };
  for (const bone of geo.bones) place(bone, 0);
}

/** A bone's cubes as one geometry, around the bone's pivot, each face shaded by its side. */
function boneGeometry(bone: GeoBone): THREE.BufferGeometry | undefined {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const corner = new THREE.Vector3();
  for (const cube of bone.cubes) {
    const turn = cube.rotation
      ? new THREE.Matrix4()
          .makeTranslation(cube.pivot![0], cube.pivot![1], cube.pivot![2])
          .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(cube.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees)) as [number, number, number]), "ZYX")))
          .multiply(new THREE.Matrix4().makeTranslation(-cube.pivot![0], -cube.pivot![1], -cube.pivot![2]))
      : undefined;
    for (const face of cube.faces) {
      const base = positions.length / 3;
      const shade = bone.name === "tint" ? 1 : FACE_SHADE[face.name];
      face.corners.forEach((point, i) => {
        corner.set(point[0], point[1], point[2]);
        if (turn) corner.applyMatrix4(turn);
        positions.push(corner.x - bone.pivot[0], corner.y - bone.pivot[1], corner.z - bone.pivot[2]);
        uvs.push(face.uvs[i][0], 1 - face.uvs[i][1]);
        colors.push(shade, shade, shade);
      });
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  if (indices.length === 0) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

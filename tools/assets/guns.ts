// Writes the shared guns pack (packs/guns): the pistol, rifle, shotgun and paint grenade as items
// held as 3D models (attachables) with a recoil when they fire, the ball and thrown grenade
// entities, the pickup that floats over a map spot, and the splash particle. The models are lists
// of boxes below; the generator turns each into a Blockbench-ready geometry (box UV), a shaded
// texture from the box colors, and a side-view icon for the hotbar, so any of it can be redrawn by
// hand later. The guns' numbers come from packages/minigame-core/src/gun-defs.ts, which the games'
// scripts read too. Rerun after changing either, and commit the files:
//
//     npx tsx tools/assets/guns.ts
//
// A test checks the committed files match (tools/build/test/guns-pack.test.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLOR_PROPERTY,
  DYES,
  GRENADE,
  GUNS,
  GUN_PICKUP,
  KIND_PROPERTY,
  PAINTBALL,
  PAINT_RGB,
  PAINT_SPLASH,
  PICKUP_KINDS,
  THROWN_GRENADE,
  type GunDef,
  type PickupKind,
} from "../../packages/minigame-core/src/gun-defs.ts";
import { blankImage, encodePng, type Image } from "../skins/png.ts";

const pack = (path: string) => fileURLToPath(new URL(`../../packs/guns/${path}`, import.meta.url));

/** The models' colors (0xRRGGBB). Every team holds the same guns: the paint carries the team color. */
const PALETTE = {
  body: 0x3b4047,
  metal: 0x9aa3ab,
  grip: 0x232427,
  hopper: 0xe4e6e8,
  tank: 0x55636f,
  wood: 0x6b4a2b,
  accent: 0xc9a227,
} as const;
type Paint = keyof typeof PALETTE;

/** A box in pixels (16 to a block): its low corner, its size, its color. */
interface Box {
  from: [number, number, number];
  size: [number, number, number];
  paint: Paint;
}

const box = (from: [number, number, number], size: [number, number, number], paint: Paint): Box => ({ from, size, paint });

/**
 * The models, built facing north (-z, the way a model faces in Bedrock), top up, with the hand at
 * the origin: the grip runs down from it, the barrel points north.
 */
const MODELS: Record<PickupKind, Box[]> = {
  pistol: [
    box([-1, -6, -1], [2, 6, 3], "grip"),
    box([-1.5, 0, -7], [3, 3, 10], "body"),
    box([-1, 0.5, -12], [2, 2, 5], "metal"),
    box([-1.5, 3, -5], [3, 4, 4], "hopper"),
    box([-0.5, -2, -4], [1, 1, 3], "grip"),
    box([-0.5, -1, -3], [1, 1, 1], "accent"),
    box([-0.5, 3, 1], [1, 1, 1], "metal"),
  ],
  rifle: [
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1.5, 0, -11], [3, 4, 17], "body"),
    box([-1, 1, -23], [2, 2, 12], "metal"),
    box([-1.5, 0.5, -15], [3, 3, 4], "body"),
    box([-2, 4, -8], [4, 6, 6], "hopper"),
    box([-1, -4, -9], [2, 4, 2], "grip"),
    box([-0.5, -2, -4], [1, 1, 4], "grip"),
    box([-0.5, -1, -2], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 9], "tank"),
    box([-1.5, -2, 15], [3, 6, 1], "grip"),
  ],
  shotgun: [
    box([-1, -6, 1], [2, 6, 3], "grip"),
    box([-2, 0, -8], [4, 4, 14], "body"),
    box([-2, 1, -20], [2, 2, 12], "metal"),
    box([0, 1, -20], [2, 2, 12], "metal"),
    box([-2, -1, -17], [4, 2, 6], "wood"),
    box([-1.5, 4, -5], [3, 4, 4], "hopper"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 8], "wood"),
    box([-1.5, -3, 14], [3, 7, 1], "grip"),
  ],
  grenade: [
    box([-2, -3, -2], [4, 5, 4], "hopper"),
    box([-2.5, -1, -2.5], [5, 1, 5], "tank"),
    box([-1, 2, -1], [2, 1, 2], "metal"),
    box([2, -1, -0.5], [1, 3, 1], "grip"),
    box([-0.5, 3, -0.5], [1, 1, 1], "accent"),
  ],
};

/**
 * Where a held model sits, in degrees and pixels, on the "gun" bone the hand carries. Third person:
 * the arm hangs, so a model facing north already points ahead. First person turns it the way the
 * trident's first-person wield turns its pole (vanilla animation.trident.wield_first_person).
 * Tuning numbers: change, regenerate, look.
 */
const HOLD: Record<PickupKind, { firstPerson: Transform; thirdPerson: Transform }> = {
  pistol: { firstPerson: { rotation: [65, 0, 0], position: [-4, -10, -2] }, thirdPerson: { rotation: [0, 0, 0], position: [0, 0, 0] } },
  rifle: { firstPerson: { rotation: [65, 0, 0], position: [-4, -10, 0] }, thirdPerson: { rotation: [0, 0, 0], position: [0, 0, 0] } },
  shotgun: { firstPerson: { rotation: [65, 0, 0], position: [-4, -10, 0] }, thirdPerson: { rotation: [0, 0, 0], position: [0, 0, 0] } },
  grenade: { firstPerson: { rotation: [20, 0, 0], position: [-4, -10, -2] }, thirdPerson: { rotation: [0, 0, 0], position: [0, -1, 0] } },
};

interface Transform {
  rotation: [number, number, number];
  position: [number, number, number];
}

/** A shot's kick on the "body" bone: back toward the player and the muzzle up, then home. */
const RECOIL: Record<keyof typeof GUNS, { seconds: number; back: number; lift: number }> = {
  pistol: { seconds: 0.15, back: 1.5, lift: 8 },
  rifle: { seconds: GUNS.rifle.everyTicks / 20, back: 1, lift: 4 },
  shotgun: { seconds: 0.3, back: 2.5, lift: 14 },
};

const ICON_SIZE = 32;
const TEXTURE_WIDTH = 64;
const BALL_SIZE = 16;
const GUN_TEXTURES = "textures/minecade/guns";

const heldGeometry = (kind: PickupKind) => `geometry.minecade.gun_${kind}`;
const displayGeometry = (kind: PickupKind) => `geometry.minecade.gun_${kind}_display`;
const iconKey = (kind: PickupKind) => `minecade_gun_${kind}`;
const gunOf = (kind: PickupKind): GunDef | undefined => (kind === "grenade" ? undefined : GUNS[kind as keyof typeof GUNS]);

// ---- Textures --------------------------------------------------------------------------------

/** Where each box's net sits in the model's texture (box UV), and the texture's size. */
function uvLayout(boxes: Box[]): { uvs: [number, number][]; height: number } {
  const uvs: [number, number][] = [];
  let [x, y, rowHeight] = [0, 0, 0];
  for (const { size } of boxes) {
    const [w, h, d] = size;
    const [netWidth, netHeight] = [2 * (w + d), h + d];
    if (x + netWidth > TEXTURE_WIDTH) [x, y, rowHeight] = [0, y + rowHeight, 0];
    uvs.push([x, y]);
    x += netWidth;
    rowHeight = Math.max(rowHeight, netHeight);
  }
  let height = 16;
  while (height < y + rowHeight) height *= 2;
  return { uvs, height };
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Sets a pixel to `rgb` scaled by `light`, with a little fixed grain so faces don't look flat. */
function paintPixel(image: Image, x: number, y: number, rgb: number, light: number): void {
  const grain = 1 + (((x * 73 + y * 151) % 17) - 8) / 220;
  const [r, g, b] = [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff].map((channel) => clamp(channel * light * grain));
  image.data.set([r, g, b, 255], (y * image.width + x) * 4);
}

/** Fills one face of a box's net, its rim a shade darker so edges read. */
function paintFace(image: Image, [x0, y0, w, h]: [number, number, number, number], rgb: number, light: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const rim = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      paintPixel(image, x, y, rgb, light * (rim && w > 2 && h > 2 ? 0.82 : 1));
    }
  }
}

/** The model's texture: each box's net in its color, the top lit, the bottom in shade. */
function modelTexture(boxes: Box[]): Buffer {
  const { uvs, height } = uvLayout(boxes);
  const image = blankImage(TEXTURE_WIDTH, height);
  boxes.forEach(({ size: [w, h, d], paint }, i) => {
    const [u, v] = uvs[i];
    const rgb = PALETTE[paint];
    paintFace(image, [u + d, v, w, d], rgb, 1.18); // top
    paintFace(image, [u + d + w, v, w, d], rgb, 0.66); // bottom
    paintFace(image, [u, v + d, d, h], rgb, 0.86); // east
    paintFace(image, [u + d, v + d, w, h], rgb, 1); // north
    paintFace(image, [u + d + w, v + d, d, h], rgb, 0.86); // west
    paintFace(image, [u + 2 * d + w, v + d, w, h], rgb, 0.92); // south
  });
  return encodePng(image);
}

/** How far a gun's icon turns up from level, barrel up and to the right like a sword's. */
const ICON_TILT_DEGREES = 40;

/**
 * The hotbar icon: the model seen from its right side (east), barrel to the right, tilted up so a
 * long gun fills the slot's diagonal, drawn nearest box last, with a dark outline.
 */
function modelIcon(boxes: Box[], tiltDegrees: number): Buffer {
  const image = blankImage(ICON_SIZE, ICON_SIZE);
  const [, yMiddle, zMiddle] = middleOf(boxes);
  const [cos, sin] = [Math.cos((tiltDegrees * Math.PI) / 180), Math.sin((tiltDegrees * Math.PI) / 180)];
  // Along the barrel (north) and up, around the model's middle, turned onto the screen.
  const toScreen = (z: number, y: number) => {
    const [along, up] = [zMiddle - z, y - yMiddle];
    return [along * cos - up * sin, along * sin + up * cos];
  };
  const corners = boxes.flatMap(({ from, size }) =>
    [from[2], from[2] + size[2]].flatMap((z) => [from[1], from[1] + size[1]].map((y) => toScreen(z, y))),
  );
  const scale = (ICON_SIZE - 3) / (2 * Math.max(...corners.flat().map(Math.abs)));
  const nearestLast = [...boxes].sort((a, b) => a.from[0] + a.size[0] - (b.from[0] + b.size[0]));
  for (let py = 0; py < ICON_SIZE; py++) {
    for (let px = 0; px < ICON_SIZE; px++) {
      // Screen right and up, back onto the model's side.
      const [right, up] = [(px + 0.5 - ICON_SIZE / 2) / scale, (ICON_SIZE / 2 - py - 0.5) / scale];
      const z = zMiddle - (right * cos + up * sin);
      const y = yMiddle + (-right * sin + up * cos);
      for (const { from, size, paint } of nearestLast) {
        if (z < from[2] || z > from[2] + size[2] || y < from[1] || y > from[1] + size[1]) continue;
        const nearTop = y > from[1] + size[1] - 1 / scale;
        paintPixel(image, px, py, PALETTE[paint], nearTop ? 1.2 : 0.95);
      }
    }
  }
  outline(image);
  return encodePng(image);
}

/** Darkens every drawn pixel that touches an empty one, so the shape reads on any slot. */
function outline(image: Image): void {
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= image.width || y >= image.height ? 0 : image.data[(y * image.width + x) * 4 + 3]);
  const edges: number[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alpha(x, y) && (!alpha(x - 1, y) || !alpha(x + 1, y) || !alpha(x, y - 1) || !alpha(x, y + 1))) edges.push((y * image.width + x) * 4);
    }
  }
  for (const at of edges) for (let c = 0; c < 3; c++) image.data[at + c] = Math.round(image.data[at + c] * 0.45);
}

/** A ball: a round blob in the paint color, lit from the top left, like the snowball. */
function ballTexture(rgb: number): Buffer {
  const image = blankImage(BALL_SIZE, BALL_SIZE);
  const [cx, cy, radius] = [7.5, 7.5, 4.6];
  for (let y = 0; y < BALL_SIZE; y++) {
    for (let x = 0; x < BALL_SIZE; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const rim = distance > radius - 1;
      const shine = Math.hypot(x - (cx - 1.6), y - (cy - 1.6)) < 1.3;
      const light = rim ? 0.62 : shine ? 1.55 : 1.1 - ((x - cx + (y - cy)) / radius) * 0.18;
      paintPixel(image, x, y, rgb, light);
    }
  }
  return encodePng(image);
}

/** The splash particle: a soft white drop the particle tints. */
function splashTexture(): Buffer {
  const image = blankImage(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const distance = Math.hypot(x - 3.5, y - 3.5);
      if (distance > 3.6) continue;
      image.data.set([255, 255, 255, distance > 2.6 ? 150 : 255], (y * 8 + x) * 4);
    }
  }
  return encodePng(image);
}

// ---- Geometry and animations -----------------------------------------------------------------

/** A box as a Bedrock cube: Blockbench's own coordinates, box UV. */
function cube({ from, size }: Box, uv: [number, number]): unknown {
  return { origin: from, size, uv };
}

function geometries(): unknown {
  const all: unknown[] = [];
  for (const kind of PICKUP_KINDS) {
    const boxes = MODELS[kind];
    const { uvs, height } = uvLayout(boxes);
    const cubes = boxes.map((piece, i) => cube(piece, uvs[i]));
    const description = (identifier: string) => ({
      identifier,
      texture_width: TEXTURE_WIDTH,
      texture_height: height,
      visible_bounds_width: 3,
      visible_bounds_height: 3,
      visible_bounds_offset: [0, 0.75, 0],
    });
    // Held: the root follows the hand; "body" carries the boxes, so the recoil moves them on the hold.
    all.push({
      description: description(heldGeometry(kind)),
      bones: [
        { name: "gun", binding: "q.item_slot_to_bone_name(c.item_slot)", pivot: [0, 0, 0] },
        { name: "body", parent: "gun", pivot: [0, 0, 0], cubes },
      ],
    });
    // Floating or flying on its own: turns around its middle.
    const middle = middleOf(boxes);
    all.push({
      description: description(displayGeometry(kind)),
      bones: [
        { name: "display", pivot: middle },
        { name: "body", parent: "display", pivot: middle, cubes },
      ],
    });
  }
  return { format_version: "1.16.0", "minecraft:geometry": all };
}

function middleOf(boxes: Box[]): [number, number, number] {
  return [0, 1, 2].map((axis) => {
    const low = Math.min(...boxes.map((piece) => piece.from[axis]));
    const high = Math.max(...boxes.map((piece) => piece.from[axis] + piece.size[axis]));
    return (low + high) / 2;
  }) as [number, number, number];
}

const holdAnimation = (kind: PickupKind, view: "first_person" | "third_person") => `animation.minecade.gun_${kind}.hold_${view}`;
const recoilAnimation = (kind: PickupKind) => `animation.minecade.gun_${kind}.recoil`;
const PICKUP_ANIMATION = "animation.minecade.gun_pickup.float";
const TUMBLE_ANIMATION = "animation.minecade.paint_grenade.tumble";
/** A tap gun's item cooldown runs from each shot (the script starts it), so it times the kick. */
const TAP_CONTROLLER = "controller.animation.minecade.gun.fire_tap";
/** A held gun fires while use is held. */
const HOLD_CONTROLLER = "controller.animation.minecade.gun.fire_hold";
const COOLING = "q.cooldown_time_remaining('slot.weapon.mainhand') > 0";

function animations(): unknown {
  const all: Record<string, unknown> = {};
  for (const kind of PICKUP_KINDS) {
    const hold = HOLD[kind];
    all[holdAnimation(kind, "first_person")] = { loop: true, bones: { gun: hold.firstPerson } };
    all[holdAnimation(kind, "third_person")] = { loop: true, bones: { gun: hold.thirdPerson } };
    const gun = gunOf(kind);
    if (!gun) continue;
    const { seconds, back, lift } = RECOIL[gun.id as keyof typeof GUNS];
    const peak = Math.round(seconds * 0.25 * 100) / 100;
    all[recoilAnimation(kind)] = {
      loop: gun.fire === "hold",
      animation_length: seconds,
      bones: {
        body: {
          position: { "0.0": [0, 0, 0], [peak.toFixed(2)]: [0, 0, back], [seconds.toFixed(2)]: [0, 0, 0] },
          rotation: { "0.0": [0, 0, 0], [peak.toFixed(2)]: [-lift, 0, 0], [seconds.toFixed(2)]: [0, 0, 0] },
        },
      },
    };
  }
  all[PICKUP_ANIMATION] = {
    loop: true,
    bones: { display: { rotation: [0, "q.life_time * 120", 0], position: [0, "10 + math.sin(q.life_time * 150) * 1.5", 0], scale: 1.6 } },
  };
  all[TUMBLE_ANIMATION] = { loop: true, bones: { display: { rotation: ["q.life_time * 600", 0, "q.life_time * 300"] } } };
  return { format_version: "1.8.0", animations: all };
}

function animationControllers(): unknown {
  const controller = (start: string, stop: string) => ({
    initial_state: "default",
    states: {
      default: { transitions: [{ fire: start }] },
      fire: { animations: ["recoil"], transitions: [{ default: stop }] },
    },
  });
  return {
    format_version: "1.10.0",
    animation_controllers: {
      [TAP_CONTROLLER]: controller(COOLING, `!(${COOLING})`),
      [HOLD_CONTROLLER]: controller("q.is_using_item", "!q.is_using_item"),
    },
  };
}

function attachable(kind: PickupKind, item: string): unknown {
  const gun = gunOf(kind);
  const animationsOf: Record<string, string> = {
    first_person: holdAnimation(kind, "first_person"),
    third_person: holdAnimation(kind, "third_person"),
  };
  const animate: unknown[] = [{ first_person: "c.is_first_person" }, { third_person: "!c.is_first_person" }];
  if (gun) {
    animationsOf.recoil = recoilAnimation(kind);
    animationsOf.fire = gun.fire === "hold" ? HOLD_CONTROLLER : TAP_CONTROLLER;
    animate.push("fire");
  }
  return {
    format_version: "1.10.0",
    "minecraft:attachable": {
      description: {
        identifier: item,
        materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
        textures: { default: `${GUN_TEXTURES}/${kind}`, enchanted: "textures/misc/enchanted_item_glint" },
        geometry: { default: heldGeometry(kind) },
        animations: animationsOf,
        scripts: { animate },
        render_controllers: ["controller.render.item_default"],
      },
    },
  };
}

// ---- Behavior pack -----------------------------------------------------------------------------

function item(kind: PickupKind, identifier: string, name: string): unknown {
  const gun = gunOf(kind);
  const components: Record<string, unknown> = {
    "minecraft:icon": { textures: { default: iconKey(kind) } },
    "minecraft:display_name": { value: name },
    "minecraft:max_stack_size": gun ? 1 : 16,
    "minecraft:hand_equipped": true,
    "minecraft:can_destroy_in_creative": false,
  };
  if (!gun) components["minecraft:cooldown"] = { category: `minecade:${kind}`, duration: 0.5 };
  else if (gun.fire === "tap") components["minecraft:cooldown"] = { category: `minecade:${kind}`, duration: gun.everyTicks / 20 };
  // Held guns are "used" while use is held, so the script hears it start and stop.
  else components["minecraft:use_modifiers"] = { use_duration: 3600, movement_modifier: 1 };
  return {
    format_version: "1.21.60",
    "minecraft:item": { description: { identifier, menu_category: { category: "none" } }, components },
  };
}

function projectileEntity(identifier: string, size: number, gravity: number, knockback: boolean): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: {
        identifier,
        is_spawnable: false,
        is_summonable: true,
        properties: { [COLOR_PROPERTY]: { type: "int", range: [0, DYES.length - 1], default: 0, client_sync: true } },
      },
      components: {
        "minecraft:collision_box": { width: size, height: size },
        // The script decides what a hit does; a ball only pushes, like a snowball.
        "minecraft:projectile": {
          on_hit: knockback ? { impact_damage: { damage: 0, knockback: true, destroy_on_hit: true }, remove_on_hit: {} } : { remove_on_hit: {} },
          power: 1.5,
          gravity,
          anchor: 1,
          offset: [0, -0.1, 0],
          angle_offset: 0,
        },
        "minecraft:physics": {},
        "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
        "minecraft:conditional_bandwidth_optimization": {
          default_values: { max_optimized_distance: 80, max_dropped_ticks: 5, use_motion_prediction_hints: true },
        },
      },
    },
  };
}

function pickupEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: {
        identifier: GUN_PICKUP,
        is_spawnable: false,
        is_summonable: true,
        properties: { [KIND_PROPERTY]: { type: "int", range: [0, PICKUP_KINDS.length - 1], default: 0, client_sync: true } },
      },
      components: {
        "minecraft:collision_box": { width: 0.01, height: 0.01 },
        "minecraft:physics": { has_gravity: false, has_collision: false },
        "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
        "minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
        "minecraft:health": { value: 1, max: 1 },
        "minecraft:knockback_resistance": { value: 1 },
        "minecraft:fire_immune": true,
      },
    },
  };
}

// ---- Resource pack client entities and particle ----------------------------------------------

function clientEntities(): Record<string, unknown> {
  const client = (description: Record<string, unknown>) => ({ format_version: "1.10.0", "minecraft:client_entity": { description } });
  return {
    "resource_pack/entity/paintball.entity.json": client({
      identifier: PAINTBALL,
      // The snowball's own setup: a flat sprite that always faces the camera.
      materials: { default: "snowball" },
      textures: Object.fromEntries(DYES.map((dye) => [dye, `${GUN_TEXTURES}/balls/${dye}`])),
      geometry: { default: "geometry.item_sprite" },
      render_controllers: ["controller.render.minecade.paintball"],
      animations: { flying: "animation.actor.billboard" },
      scripts: { animate: ["flying"] },
    }),
    "resource_pack/entity/paint_grenade.entity.json": client({
      identifier: THROWN_GRENADE,
      materials: { default: "entity_alphatest" },
      textures: { default: `${GUN_TEXTURES}/grenade` },
      geometry: { default: displayGeometry("grenade") },
      render_controllers: ["controller.render.default"],
      animations: { tumble: TUMBLE_ANIMATION },
      scripts: { animate: ["tumble"] },
    }),
    "resource_pack/entity/gun_pickup.entity.json": client({
      identifier: GUN_PICKUP,
      materials: { default: "entity_alphatest" },
      textures: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, `${GUN_TEXTURES}/${kind}`])),
      geometry: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, displayGeometry(kind)])),
      render_controllers: ["controller.render.minecade.gun_pickup"],
      animations: { float: PICKUP_ANIMATION },
      scripts: { animate: ["float"] },
    }),
  };
}

function renderControllers(): unknown {
  const pick = (array: string, property: string) => `${array}[q.property('${property}')]`;
  return {
    format_version: "1.10.0",
    render_controllers: {
      "controller.render.minecade.paintball": {
        arrays: { textures: { "Array.dyes": DYES.map((dye) => `Texture.${dye}`) } },
        geometry: "Geometry.default",
        materials: [{ "*": "Material.default" }],
        textures: [pick("Array.dyes", COLOR_PROPERTY)],
      },
      "controller.render.minecade.gun_pickup": {
        arrays: {
          textures: { "Array.kinds": PICKUP_KINDS.map((kind) => `Texture.${kind}`) },
          geometries: { "Array.kinds": PICKUP_KINDS.map((kind) => `Geometry.${kind}`) },
        },
        geometry: pick("Array.kinds", KIND_PROPERTY),
        materials: [{ "*": "Material.default" }],
        textures: [pick("Array.kinds", KIND_PROPERTY)],
        ignore_lighting: true,
      },
    },
  };
}

/** Drops thrown out from the hit, falling, in `variable.color`. */
function splashParticle(): unknown {
  return {
    format_version: "1.10.0",
    particle_effect: {
      description: {
        identifier: PAINT_SPLASH,
        basic_render_parameters: { material: "particles_alpha", texture: `${GUN_TEXTURES}/splash` },
      },
      components: {
        "minecraft:emitter_rate_instant": { num_particles: 14 },
        "minecraft:emitter_lifetime_once": { active_time: 0.05 },
        "minecraft:emitter_shape_sphere": { radius: 0.15, direction: "outwards" },
        "minecraft:particle_lifetime_expression": { max_lifetime: "0.35 + v.particle_random_1 * 0.3" },
        "minecraft:particle_initial_speed": "2 + v.particle_random_2 * 2.5",
        "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -14, 0], linear_drag_coefficient: 2.5 },
        "minecraft:particle_motion_collision": { collision_radius: 0.05, coefficient_of_restitution: 0, collision_drag: 6 },
        "minecraft:particle_appearance_billboard": {
          size: ["0.05 + v.particle_random_3 * 0.05", "0.05 + v.particle_random_3 * 0.05"],
          facing_camera_mode: "rotate_xyz",
          uv: { texture_width: 8, texture_height: 8, uv: [0, 0], uv_size: [8, 8] },
        },
        "minecraft:particle_appearance_tinting": { color: ["v.color.r", "v.color.g", "v.color.b", 1] },
        "minecraft:particle_appearance_lighting": {},
      },
    },
  };
}

// ---- The pack ----------------------------------------------------------------------------------

/** Every generated file, by path under packs/guns (the manifests are hand-written). */
export function gunsPackFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const items: [PickupKind, string, string][] = [
    ...Object.values(GUNS).map((gun): [PickupKind, string, string] => [gun.id, gun.item, gun.name]),
    ["grenade", GRENADE.item, GRENADE.name],
  ];
  const files: Record<string, string | Buffer> = {
    "behavior_pack/entities/paintball.json": json(projectileEntity(PAINTBALL, 0.25, 0.03, true)),
    "behavior_pack/entities/paint_grenade.json": json(projectileEntity(THROWN_GRENADE, 0.3, 0.05, false)),
    "behavior_pack/entities/gun_pickup.json": json(pickupEntity()),
    "resource_pack/models/entity/guns.geo.json": json(geometries()),
    "resource_pack/animations/guns.animation.json": json(animations()),
    "resource_pack/animation_controllers/guns.animation_controllers.json": json(animationControllers()),
    "resource_pack/render_controllers/guns.render_controllers.json": json(renderControllers()),
    "resource_pack/particles/paint_splash.json": json(splashParticle()),
    "resource_pack/textures/item_texture.json": json({
      resource_pack_name: "minecade_guns",
      texture_name: "atlas.items",
      texture_data: Object.fromEntries(PICKUP_KINDS.map((kind) => [iconKey(kind), { textures: `${GUN_TEXTURES}/${kind}_icon` }])),
    }),
    [`resource_pack/${GUN_TEXTURES}/splash.png`]: splashTexture(),
    ...Object.fromEntries(Object.entries(clientEntities()).map(([path, value]) => [path, json(value)])),
  };
  for (const [kind, identifier, name] of items) {
    const file = identifier.replace("minecade:", "");
    files[`behavior_pack/items/${file}.json`] = json(item(kind, identifier, name));
    files[`resource_pack/attachables/${file}.json`] = json(attachable(kind, identifier));
  }
  for (const kind of PICKUP_KINDS) {
    files[`resource_pack/${GUN_TEXTURES}/${kind}.png`] = modelTexture(MODELS[kind]);
    files[`resource_pack/${GUN_TEXTURES}/${kind}_icon.png`] = modelIcon(MODELS[kind], kind === "grenade" ? 0 : ICON_TILT_DEGREES);
  }
  for (const dye of DYES) files[`resource_pack/${GUN_TEXTURES}/balls/${dye}.png`] = ballTexture(PAINT_RGB[dye]);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(gunsPackFiles())) {
    mkdirSync(dirname(pack(path)), { recursive: true });
    writeFileSync(pack(path), content);
  }
  console.log("wrote the guns pack's files");
}

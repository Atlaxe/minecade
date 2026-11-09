// Writes the shared guns pack (packs/guns): Paintball's pistol, rifle, shotgun and paint grenade as
// items in each of the 16 paint colors, and the arsenal's real guns, grenades, knife and stimpack as
// one item each, all held as 3D models (attachables) that come up to the middle of the screen while
// aiming and kick back when they fire; the ball, rocket, thrown and landed grenade entities; the
// pickups that float over a map spot; and the particles (the paint splash, and the arsenal's
// streaks, beams, blasts, flames and smoke). The models are lists of boxes below; the generator
// turns each into a Blockbench-ready geometry (box UV) and a shaded texture (per paint color for
// Paintball's: a box painted "paint" takes the color). Each item places a hidden block holding its
// model, so the hotbar shows the model in 3D the way it shows a wall or a banner; the kit pictures
// get icons drawn from the models (packs/guns/icons). Where the models sit in the hand is a
// hand-edited file (HOLD_FILE: a shared pose a view for every gun, one for the grenades, knife and
// stimpack, and each model's own on top): this writes it when it's missing, and otherwise only adds
// the poses of models it doesn't have yet, leaving every other line as it is. The guns' names and numbers come
// from packages/guns/src/defs.ts, which the games' scripts read too. Rerun after changing either, and
// commit the files:
//
//     npx tsx tools/assets/guns.ts
//
// A test checks the committed files match (tools/build/test/guns-pack.test.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARSENAL_GUNS,
  ARSENAL_GUN_DEFS,
  ARSENAL_MODELS,
  ARSENAL_PICKUP,
  ARSENAL_THROWABLE_DEFS,
  COLOR_PROPERTY,
  DYES,
  GRENADE,
  GUNS,
  GUN_KINDS,
  GUN_PICKUP,
  KIND_PROPERTY,
  MODEL_PROPERTY,
  PAINTBALL,
  PAINT_RGB,
  PAINT_SPLASH,
  PARTICLES,
  PICKUP_KINDS,
  PRIMED_ARSENAL,
  PRIMED_GRENADE,
  ROCKET,
  STIM,
  THROWN_ARSENAL,
  THROWN_GRENADE,
  AIM_MARKER,
  AIM_RECOIL,
  arsenalItem,
  canAim,
  arsenalModelBlock,
  gunCooldown,
  gunDef,
  gunItem,
  gunModelBlock,
  isArsenalGun,
  type ArsenalModel,
  type Dye,
  type PickupKind,
} from "../../packages/guns/src/defs.ts";
import { blankImage, encodePng } from "../skins/png.ts";

const pack = (path: string) => fileURLToPath(new URL(`../../packs/guns/${path}`, import.meta.url));

/** The models' fixed colors (0xRRGGBB). A box painted "paint" takes the item's paint color instead. */
const PALETTE = {
  body: 0x3b4047,
  metal: 0x9aa3ab,
  grip: 0x232427,
  tank: 0x55636f,
  wood: 0x6b4a2b,
  accent: 0xc9a227,
  // The arsenal's: darker steel, army green, a Molotov's bottle and rag, the rail gun's coils, the
  // stimpack's dose, a flashbang's white and a knife's blade.
  steel: 0x5f666e,
  olive: 0x4f5a2e,
  glass: 0x5f8f6a,
  cloth: 0xd8c9a3,
  flame: 0xe8781e,
  glow: 0x3fd7e6,
  dose: 0xb3262b,
  white: 0xdde1e4,
  blade: 0xc4ccd3,
} as const;
type Paint = keyof typeof PALETTE | "paint";

/** A box in pixels (16 to a block): its low corner, its size, its color. */
interface Box {
  from: Vec3;
  size: Vec3;
  paint: Paint;
}
type Vec3 = [number, number, number];

const box = (from: Vec3, size: Vec3, paint: Paint): Box => ({ from, size, paint });

/**
 * The models, built facing north (-z, the way a model faces in Bedrock), top up, with the top of the
 * grip at the origin: the grip runs down from it, the barrel points north.
 */
const MODELS: Record<PickupKind, Box[]> = {
  pistol: [
    box([-1, -6, -1], [2, 6, 3], "grip"),
    box([-1.5, 0, -7], [3, 3, 10], "body"),
    box([-1, 0.5, -12], [2, 2, 5], "metal"),
    box([-1.5, 3, -5], [3, 4, 4], "paint"),
    box([-0.5, -2, -4], [1, 1, 3], "grip"),
    box([-0.5, -1, -3], [1, 1, 1], "accent"),
    box([-0.5, 3, 1], [1, 1, 1], "metal"),
  ],
  rifle: [
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1.5, 0, -11], [3, 4, 17], "body"),
    box([-1, 1, -23], [2, 2, 12], "metal"),
    box([-1.5, 0.5, -15], [3, 3, 4], "body"),
    box([-2, 4, -8], [4, 6, 6], "paint"),
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
    box([-1.5, 4, -5], [3, 4, 4], "paint"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 8], "wood"),
    box([-1.5, -3, 14], [3, 7, 1], "grip"),
  ],
  grenade: [
    box([-2, -3, -2], [4, 5, 4], "paint"),
    box([-2.5, -1, -2.5], [5, 1, 5], "tank"),
    box([-1, 2, -1], [2, 1, 2], "metal"),
    box([2, -1, -0.5], [1, 3, 1], "grip"),
    box([-0.5, 3, -0.5], [1, 1, 1], "accent"),
  ],
};

/**
 * The arsenal's models, built the same way: the real pistol, rifle and shotgun are Paintball's
 * without the hopper (a sight or a bead where it sat), the rest new in the same style.
 */
const ARSENAL_BOXES: Record<ArsenalModel, Box[]> = {
  handgun: [
    box([-1, -6, -1], [2, 6, 3], "grip"),
    box([-1.5, 0, -7], [3, 3, 10], "body"),
    box([-1, 0.5, -12], [2, 2, 5], "metal"),
    box([-0.5, -2, -4], [1, 1, 3], "grip"),
    box([-0.5, -1, -3], [1, 1, 1], "accent"),
    box([-0.5, 3, 1], [1, 1, 1], "metal"),
    box([-0.5, 3, -6], [1, 1, 1], "metal"),
  ],
  smg: [
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1.5, 0, -9], [3, 4, 12], "body"),
    box([-1, 1, -14], [2, 2, 5], "metal"),
    box([-1, -8, -6], [2, 8, 2], "steel"),
    box([-0.5, -2, -3], [1, 1, 3], "grip"),
    box([-0.5, -1, -2], [1, 1, 1], "accent"),
    box([-0.5, 4, -3], [1, 1, 3], "metal"),
    box([-1, 1, 3], [2, 1, 8], "steel"),
    box([-1, -2, 11], [2, 4, 1], "steel"),
  ],
  assault_rifle: [
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1.5, 0, -11], [3, 4, 17], "body"),
    box([-1, 1, -23], [2, 2, 12], "metal"),
    box([-1.5, 0.5, -15], [3, 3, 4], "body"),
    box([-1, 4, -7], [2, 2, 5], "steel"),
    box([-0.5, 4, -11], [1, 1, 1], "metal"),
    box([-1, -5, -8], [2, 5, 3], "steel"),
    box([-0.5, -2, -4], [1, 1, 4], "grip"),
    box([-0.5, -1, -2], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 9], "body"),
    box([-1.5, -2, 15], [3, 6, 1], "grip"),
  ],
  burst_rifle: [
    box([-1, -6, 2], [2, 6, 3], "grip"),
    box([-1.5, 0, -12], [3, 4, 22], "body"),
    box([-1, 1, -19], [2, 2, 7], "metal"),
    box([-1, 4, -9], [2, 2, 9], "steel"),
    box([-0.5, 4.5, -10], [1, 1, 1], "glow"),
    box([-1, -5, 6], [2, 5, 3], "steel"),
    box([-0.5, -2, -2], [1, 1, 4], "grip"),
    box([-0.5, -1, 0], [1, 1, 1], "accent"),
    box([-1.5, -1, -12], [3, 1, 6], "grip"),
    box([-1.5, -1, 10], [3, 5, 1], "grip"),
  ],
  pump_shotgun: [
    box([-1, -6, 1], [2, 6, 3], "grip"),
    box([-1.5, 0, -6], [3, 4, 12], "body"),
    box([-1, 2, -22], [2, 2, 16], "metal"),
    box([-1, 0, -20], [2, 2, 14], "steel"),
    box([-1.5, -0.5, -16], [3, 3, 6], "wood"),
    box([-0.5, 4, -21], [1, 1, 1], "accent"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 8], "wood"),
    box([-1.5, -3, 14], [3, 7, 1], "grip"),
  ],
  double_barrel: [
    box([-1, -6, 1], [2, 6, 3], "grip"),
    box([-2, 0, -8], [4, 4, 14], "body"),
    box([-2, 1, -20], [2, 2, 12], "metal"),
    box([0, 1, -20], [2, 2, 12], "metal"),
    box([-2, -1, -17], [4, 2, 6], "wood"),
    box([-0.5, 3, -19], [1, 1, 1], "accent"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 8], "wood"),
    box([-1.5, -3, 14], [3, 7, 1], "grip"),
  ],
  sniper_rifle: [
    box([-1, -6, 1], [2, 6, 3], "grip"),
    box([-1.5, 0, -8], [3, 4, 14], "body"),
    box([-1, 1, -30], [2, 2, 22], "metal"),
    box([-1.5, 0.5, -32], [3, 3, 2], "steel"),
    box([-1, 5, -10], [2, 2, 12], "steel"),
    box([-1.5, 4.5, -12], [3, 3, 2], "steel"),
    box([-1.5, 4.5, 2], [3, 3, 2], "steel"),
    box([-0.5, 4, -7], [1, 1, 1], "metal"),
    box([-0.5, 4, -1], [1, 1, 1], "metal"),
    box([1.5, 2, 1], [2, 1, 1], "metal"),
    box([-1, -3, -7], [2, 3, 3], "steel"),
    box([-0.5, -2, -3], [1, 1, 4], "grip"),
    box([-0.5, -1, -1], [1, 1, 1], "accent"),
    box([-1.5, -1, 6], [3, 4, 10], "wood"),
    box([-1.5, -3, 16], [3, 7, 1], "grip"),
  ],
  rail_gun: [
    box([-1, -6, 2], [2, 6, 3], "grip"),
    box([-2, 0, -10], [4, 5, 18], "body"),
    box([-1.5, 4, -24], [3, 1, 14], "metal"),
    box([-1.5, 0, -24], [3, 1, 14], "metal"),
    box([-1, 1, -22], [2, 3, 2], "glow"),
    box([-1, 1, -17], [2, 3, 2], "glow"),
    box([-1, 1, -12], [2, 3, 2], "glow"),
    box([-1.5, -3, -7], [3, 3, 4], "glow"),
    box([2, 1, -6], [1, 3, 8], "glow"),
    box([-0.5, -2, -2], [1, 1, 4], "grip"),
    box([-0.5, -1, 0], [1, 1, 1], "accent"),
    box([-1.5, 0, 8], [3, 4, 6], "body"),
    box([-1.5, -2, 14], [3, 6, 1], "grip"),
  ],
  rpg: [
    box([-2, 0, -12], [4, 4, 26], "olive"),
    box([-2.5, -0.5, -17], [5, 5, 5], "steel"),
    box([-1.5, 0.5, -20], [3, 3, 3], "steel"),
    box([-0.5, 1.5, -21], [1, 1, 1], "accent"),
    box([-2.5, -0.5, 14], [5, 5, 1], "steel"),
    box([-1, -6, 0], [2, 6, 3], "grip"),
    box([-1, -5, -7], [2, 5, 2], "grip"),
    box([-0.5, -2, -3], [1, 1, 3], "grip"),
    box([-0.5, -1, -2], [1, 1, 1], "accent"),
    box([-3, 3, -4], [1, 2, 2], "metal"),
  ],
  frag_grenade: [
    box([-2, -3, -2], [4, 5, 4], "olive"),
    box([-2.5, -1, -2.5], [5, 1, 5], "steel"),
    box([-1, 2, -1], [2, 1, 2], "metal"),
    box([2, -1, -0.5], [1, 3, 1], "metal"),
    box([-0.5, 3, -0.5], [1, 1, 1], "accent"),
  ],
  molotov: [
    box([-2, -4, -2], [4, 6, 4], "glass"),
    box([-2, -2, -3], [4, 2, 1], "cloth"),
    box([-1.5, 2, -1.5], [3, 1, 3], "glass"),
    box([-1, 3, -1], [2, 2, 2], "glass"),
    box([-1, 5, -1], [2, 2, 2], "cloth"),
    box([-0.5, 7, -0.5], [1, 1, 1], "flame"),
  ],
  flashbang: [
    box([-1.5, -3, -1.5], [3, 6, 3], "white"),
    box([-2, -1, -2], [4, 1, 4], "grip"),
    box([-2, -4, -2], [4, 1, 4], "steel"),
    box([-2, 3, -2], [4, 1, 4], "steel"),
    box([-0.5, 4, -0.5], [1, 1, 1], "metal"),
    box([2, -2, -0.5], [1, 5, 1], "metal"),
  ],
  smoke_grenade: [
    box([-1.5, -4, -1.5], [3, 7, 3], "tank"),
    box([-2, 0, -2], [4, 1, 4], "white"),
    box([-2, 3, -2], [4, 1, 4], "metal"),
    box([-0.5, 4, -0.5], [1, 1, 1], "metal"),
    box([2, -2, -0.5], [1, 5, 1], "metal"),
    box([-0.5, 5, -0.5], [1, 1, 1], "accent"),
  ],
  throwing_knife: [
    box([-0.5, -1, 0], [1, 2, 5], "grip"),
    box([-1.5, -1.5, -1], [3, 3, 1], "metal"),
    box([-0.5, -1, -10], [1, 2, 9], "blade"),
    box([-0.5, -0.5, -11], [1, 1, 1], "blade"),
    box([-1, -1.5, 5], [2, 3, 1], "metal"),
  ],
  stimpack: [
    box([-1, -1, -4], [2, 2, 1], "white"),
    box([-1, -1, -3], [2, 2, 5], "dose"),
    box([-1, -1, 2], [2, 2, 2], "white"),
    box([-2, -0.5, 2], [4, 1, 1], "white"),
    box([-0.5, -0.5, 4], [1, 1, 3], "metal"),
    box([-1.5, -1.5, 7], [3, 3, 1], "grip"),
    box([-0.5, -0.5, -7], [1, 1, 3], "metal"),
  ],
};

/** The RPG's rocket in flight, pointing north like the guns. */
const ROCKET_BOXES: Box[] = [
  box([-1, -1, -6], [2, 2, 8], "steel"),
  box([-1.5, -1.5, -9], [3, 3, 3], "olive"),
  box([-0.5, -0.5, -10], [1, 1, 1], "accent"),
  box([-2, -0.5, 1], [4, 1, 2], "metal"),
  box([-0.5, -2, 1], [1, 4, 2], "metal"),
];

/** Every model the pack draws, by id: Paintball's and the arsenal's. */
type ModelId = PickupKind | ArsenalModel;
const boxesOf = (model: ModelId): Box[] => (model in MODELS ? MODELS[model as PickupKind] : ARSENAL_BOXES[model as ArsenalModel]);
const isGunModel = (model: ModelId): boolean => (GUN_KINDS as readonly string[]).includes(model) || isArsenalGun(model);

/**
 * A shot's kick on the "body" bone (defs.ts's RecoilDef): back toward the player with the muzzle
 * up, then home over `seconds`, the gun's own cooldown (its fire rate), so it settles just as the
 * gun can fire again.
 */
function recoilOf(kind: ModelId): { seconds: number; back: number; lift: number } {
  const gun = gunDef(kind)!;
  return { seconds: gun.everyTicks / 20, back: gun.recoil?.back ?? 0, lift: gun.recoil?.lift ?? 0 };
}

/** How long a kick takes to reach its full height; the rest of it eases home. */
const KICK_RISE_SECONDS = 0.04;
/** The most of a kick spent rising, for the fastest guns. */
const KICK_RISE_MOST = 0.3;

/**
 * Where each model first sat in the hand, as places on the screen and around the fist (the solver
 * below turns them into the rotations and positions HOLD_FILE starts with; the file is edited by
 * hand since). The guns all start in the same place (GUN_HIP, GUN_THIRD), so their own poses start
 * as nothing but their size. Pixels, degrees.
 * - scale: its size in first person.
 * - hip: the grip's top this far from the fist (right, up, ahead), the barrel turned in toward the
 *   crosshair and tipped up, so the stock drops out of view.
 * - aim (a gun that aims, raised by a right click): centered, its top `under` the crosshair (a fraction of half the
 *   screen's height), the grip's top `depth` pixels ahead of the eye.
 * - third: third person, the grip's top this far from the fist (right, up, ahead), level.
 */
const GUN_HIP: Place = { fromFist: [-1, 6, 4], turnIn: 4, tipUp: 10 };
const GUN_THIRD: Vec3 = [0, 4.5, 1];
const HOLD: Record<ModelId, Hold> = {
  pistol: { scale: 1.35, hip: GUN_HIP, third: GUN_THIRD },
  rifle: { scale: 1.1, hip: GUN_HIP, third: GUN_THIRD },
  shotgun: { scale: 1.15, hip: GUN_HIP, third: GUN_THIRD },
  grenade: { scale: 1.3, hip: { fromFist: [0, 3.2, 2], turnIn: 20, tipUp: 10 }, third: [0, 1.5, 1] },
  // The arsenal's first guesses, from the paint guns' (the user moves them in Blockbench).
  handgun: { scale: 1.35, hip: GUN_HIP, third: GUN_THIRD },
  smg: { scale: 1.2, hip: GUN_HIP, third: GUN_THIRD },
  assault_rifle: { scale: 1.1, hip: GUN_HIP, third: GUN_THIRD },
  burst_rifle: { scale: 1.1, hip: GUN_HIP, third: GUN_THIRD },
  pump_shotgun: { scale: 1.1, hip: GUN_HIP, third: GUN_THIRD },
  double_barrel: { scale: 1.15, hip: GUN_HIP, third: GUN_THIRD },
  // Aiming the sniper hides it: the zoom is the scope.
  sniper_rifle: { scale: 0.95, hip: GUN_HIP, aim: { under: 0.07, depth: 22, hidden: true }, third: GUN_THIRD },
  rail_gun: { scale: 1, hip: GUN_HIP, aim: { under: 0.07, depth: 20 }, third: GUN_THIRD },
  rpg: { scale: 1, hip: GUN_HIP, aim: { under: 0.1, depth: 18 }, third: GUN_THIRD },
  frag_grenade: { scale: 1.3, hip: { fromFist: [0, 3.2, 2], turnIn: 20, tipUp: 10 }, third: [0, 1.5, 1] },
  molotov: { scale: 1.2, hip: { fromFist: [0, 3.6, 2], turnIn: 20, tipUp: 10 }, third: [0, 2, 1] },
  flashbang: { scale: 1.3, hip: { fromFist: [0, 3.2, 2], turnIn: 20, tipUp: 10 }, third: [0, 1.5, 1] },
  smoke_grenade: { scale: 1.3, hip: { fromFist: [0, 3.6, 2], turnIn: 20, tipUp: 10 }, third: [0, 2, 1] },
  throwing_knife: { scale: 1.2, hip: { fromFist: [0, 3, 3], turnIn: 10, tipUp: 30 }, third: [0, 1.5, 2] },
  stimpack: { scale: 1.3, hip: { fromFist: [0, 3, 3], turnIn: 20, tipUp: 20 }, third: [0, 1.5, 1] },
};

interface Hold {
  scale: number;
  hip: Place;
  /** Guns only. `hidden`: scaled to nothing while aiming. */
  aim?: { under: number; depth: number; hidden?: boolean };
  third: Vec3;
}

interface Place {
  fromFist: Vec3;
  turnIn: number;
  tipUp: number;
}

const ICON_SIZE = 128;
/** Each icon pixel is the average of this many samples squared, for smooth edges. */
const ICON_SAMPLES = 3;
const TEXTURE_WIDTH = 64;
const BALL_SIZE = 16;
/** A gun's swing on a left click, which fires it or raises it: short enough to barely show. */
const GUN_SWING_SECONDS = 0.05;
/**
 * A gun is used like a bow while right click is down, so Bedrock says when the button goes down and
 * when it comes up, and Guns fires a held gun all that time: an hour's use (it never finishes), at
 * full walking speed.
 */
const GUN_USE = { use_duration: 3600, movement_modifier: 1 };
const GUN_TEXTURES = "textures/minecade/guns";

const heldGeometry = (kind: ModelId) => `geometry.minecade.gun_${kind}`;
const iconGeometry = (kind: ModelId) => `geometry.minecade.gun_${kind}_icon`;
const displayGeometry = (kind: ModelId) => `geometry.minecade.gun_${kind}_display`;
const ROCKET_GEOMETRY = "geometry.minecade.rocket";
const modelTexturePath = (kind: PickupKind, dye: Dye) => `${GUN_TEXTURES}/${kind}/${dye}`;
const terrainKey = (kind: PickupKind, dye: Dye) => `minecade_gun_${kind}_${dye}`;
/** The arsenal's models have one texture each (no paint). */
const arsenalTexturePath = (model: ArsenalModel) => `${GUN_TEXTURES}/arsenal/${model}`;
const arsenalTerrainKey = (model: ArsenalModel) => `minecade_arsenal_${model}`;
const ROCKET_TEXTURE = `${GUN_TEXTURES}/arsenal/rocket`;
const PUFF_TEXTURE = `${GUN_TEXTURES}/puff`;
const itemFile = (identifier: string) => identifier.replace("minecade:", "");
const isGun = (kind: ModelId): boolean => isGunModel(kind);
/** A gun that aims (defs.ts's canAim): it has an aim pose, raised by a right click. */
const aims = (kind: ModelId): boolean => isGun(kind) && canAim(gunDef(kind)!);

// ---- Textures --------------------------------------------------------------------------------

/**
 * Where each box's net sits in the model's texture (box UV), and the texture's size: TEXTURE_WIDTH
 * wide, or wider when that would make it taller than wide. The icon's model block takes its texture
 * from the block atlas, which seems to keep only a square of a tall texture: the Sniper Rifle's icon
 * (64 by 128) was missing parts, and its stock's sides were the faces below row 64.
 */
function uvLayout(boxes: Box[]): { uvs: [number, number][]; width: number; height: number } {
  for (let width = TEXTURE_WIDTH; ; width *= 2) {
    const uvs: [number, number][] = [];
    let [x, y, rowHeight] = [0, 0, 0];
    for (const { size } of boxes) {
      const [w, h, d] = size;
      const [netWidth, netHeight] = [2 * (w + d), h + d];
      if (x + netWidth > width) [x, y, rowHeight] = [0, y + rowHeight, 0];
      uvs.push([x, y]);
      x += netWidth;
      rowHeight = Math.max(rowHeight, netHeight);
    }
    let height = 16;
    while (height < y + rowHeight) height *= 2;
    if (height <= width) return { uvs, width, height };
  }
}

/** A box's six faces: where each sits in its net (box UV), how lit the texture paints it, and its corner and edges in the model. */
function boxFaces({ from, size }: Box, [u, v]: [number, number]): { rect: [number, number, number, number]; light: number; corner: Vec3; across: Vec3; down: Vec3; normal: Vec3 }[] {
  const [w, h, d] = size;
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = [x0 + w, y0 + h, z0 + d];
  return [
    { rect: [u + d, v, w, d], light: 1.18, corner: [x1, y1, z1], across: [-w, 0, 0], down: [0, 0, -d], normal: [0, 1, 0] },
    { rect: [u + d + w, v, w, d], light: 0.66, corner: [x1, y0, z0], across: [-w, 0, 0], down: [0, 0, d], normal: [0, -1, 0] },
    { rect: [u, v + d, d, h], light: 0.86, corner: [x1, y1, z1], across: [0, 0, -d], down: [0, -h, 0], normal: [1, 0, 0] },
    { rect: [u + d, v + d, w, h], light: 1, corner: [x1, y1, z0], across: [-w, 0, 0], down: [0, -h, 0], normal: [0, 0, -1] },
    { rect: [u + d + w, v + d, d, h], light: 0.86, corner: [x0, y1, z0], across: [0, 0, d], down: [0, -h, 0], normal: [-1, 0, 0] },
    { rect: [u + 2 * d + w, v + d, w, h], light: 0.92, corner: [x0, y1, z1], across: [w, 0, 0], down: [0, -h, 0], normal: [0, 0, 1] },
  ];
}

/** A model's texture before it's colored: each pixel's paint and light (its face's, a darker rim, a little grain). */
interface TextureLayers {
  width: number;
  height: number;
  paint: (Paint | undefined)[];
  light: Float32Array;
}

function textureLayers(boxes: Box[]): TextureLayers {
  const { uvs, width, height } = uvLayout(boxes);
  const layers: TextureLayers = { width, height, paint: Array(width * height).fill(undefined), light: new Float32Array(width * height) };
  boxes.forEach((piece, i) => {
    for (const { rect: [x0, y0, w, h], light } of boxFaces(piece, uvs[i])) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const rim = (x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1) && w > 2 && h > 2;
          const grain = 1 + (((x * 73 + y * 151) % 17) - 8) / 220;
          layers.paint[y * width + x] = piece.paint;
          layers.light[y * width + x] = light * (rim ? 0.82 : 1) * grain;
        }
      }
    }
  });
  return layers;
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const rgbOf = (paint: Paint, dye: Dye) => (paint === "paint" ? PAINT_RGB[dye] : PALETTE[paint]);

/** The color of texture pixel `at` in a paint color, as [r, g, b] (0 to 255), or undefined where no box is. */
function texel(layers: TextureLayers, at: number, dye: Dye): [number, number, number] | undefined {
  const paint = layers.paint[at];
  if (!paint) return undefined;
  const rgb = rgbOf(paint, dye);
  const light = layers.light[at];
  return [(rgb >> 16) * light, ((rgb >> 8) & 0xff) * light, (rgb & 0xff) * light];
}

function modelTexture(layers: TextureLayers, dye: Dye): Buffer {
  const image = blankImage(layers.width, layers.height);
  for (let at = 0; at < layers.paint.length; at++) {
    const color = texel(layers, at, dye);
    if (color) image.data.set([...color.map(clamp), 255], at * 4);
  }
  return encodePng(image);
}

// ---- Icons: the model drawn in 3D --------------------------------------------------------------

type Matrix = [Vec3, Vec3, Vec3];

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const rotX = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotY = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const rotZ = (degrees: number): Matrix => {
  const [c, s] = [Math.cos(radians(degrees)), Math.sin(radians(degrees))];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const times = (a: Matrix, b: Matrix): Matrix =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Matrix;
const apply = (m: Matrix, [x, y, z]: Vec3): Vec3 => [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
const transpose = (m: Matrix): Matrix => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]) as Matrix;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** How a kit picture's icon sees its model: from above a front corner, as the hotbar shows a block. */
const ICON_VIEW: Matrix = times(rotX(30), rotY(-45));
/** The icons' light: from the upper left, in front. */
const ICON_LIGHT: Vec3 = [-0.45, 0.75, 0.5];

/** Where each icon sample landed on the model (a texture pixel, -1 for none) and how much light it takes there. */
interface IconSamples {
  texel: Int32Array;
  light: Float32Array;
}

/** Draws the model's faces into ICON_SIZE * ICON_SAMPLES samples a side, nearest face wins (seen from +z, orthographic). */
function iconSamples(boxes: Box[], view: Matrix): IconSamples {
  const size = ICON_SIZE * ICON_SAMPLES;
  const { uvs, width } = uvLayout(boxes);
  const samples: IconSamples = { texel: new Int32Array(size * size).fill(-1), light: new Float32Array(size * size) };
  const depth = new Float32Array(size * size).fill(-Infinity);
  const corners = boxes.flatMap(({ from, size: [w, h, d] }) =>
    [0, w].flatMap((dx) => [0, h].flatMap((dy) => [0, d].map((dz) => apply(view, [from[0] + dx, from[1] + dy, from[2] + dz])))),
  );
  const [minX, maxX] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))];
  const [minY, maxY] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))];
  const margin = 3 * ICON_SAMPLES;
  const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
  const toSample = ([x, y, z]: Vec3): Vec3 => [size / 2 + (x - (minX + maxX) / 2) * scale, size / 2 - (y - (minY + maxY) / 2) * scale, z];
  const lightLength = Math.hypot(...ICON_LIGHT);
  boxes.forEach((piece, i) => {
    for (const face of boxFaces(piece, uvs[i])) {
      const normal = apply(view, face.normal);
      if (normal[2] <= 1e-6) continue;
      const facing = Math.max(0, (normal[0] * ICON_LIGHT[0] + normal[1] * ICON_LIGHT[1] + normal[2] * ICON_LIGHT[2]) / lightLength);
      const light = 0.7 + 0.45 * facing;
      const at = (a: number, b: number): Vec3 => toSample(apply(view, add(face.corner, add(face.across.map((c) => c * a) as Vec3, face.down.map((c) => c * b) as Vec3))));
      const quad = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
      const params: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [p, q, r] of [[0, 1, 2], [0, 2, 3]]) {
        const [a, b, c] = [quad[p], quad[q], quad[r]];
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-9) continue;
        const [left, right] = [Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])))];
        const [top, bottom] = [Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])))];
        for (let sy = top; sy <= bottom; sy++) {
          for (let sx = left; sx <= right; sx++) {
            const [px, py] = [sx + 0.5, sy + 0.5];
            const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
            const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
            const wc = 1 - wa - wb;
            if (wa < 0 || wb < 0 || wc < 0) continue;
            const z = wa * a[2] + wb * b[2] + wc * c[2];
            const sample = sy * size + sx;
            if (z <= depth[sample]) continue;
            depth[sample] = z;
            const s = wa * params[p][0] + wb * params[q][0] + wc * params[r][0];
            const t = wa * params[p][1] + wb * params[q][1] + wc * params[r][1];
            const [rx, ry, rw, rh] = face.rect;
            const tx = Math.min(rx + rw - 1, Math.floor(rx + s * rw));
            const ty = Math.min(ry + rh - 1, Math.floor(ry + t * rh));
            samples.texel[sample] = ty * width + tx;
            samples.light[sample] = light;
          }
        }
      }
    }
  });
  return samples;
}

/** The icon in a paint color: each pixel the average of its samples, see-through where the model isn't. */
function modelIcon(samples: IconSamples, layers: TextureLayers, dye: Dye): Buffer {
  const image = blankImage(ICON_SIZE, ICON_SIZE);
  const size = ICON_SIZE * ICON_SAMPLES;
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      let [r, g, b, covered] = [0, 0, 0, 0];
      for (let dy = 0; dy < ICON_SAMPLES; dy++) {
        for (let dx = 0; dx < ICON_SAMPLES; dx++) {
          const sample = (y * ICON_SAMPLES + dy) * size + x * ICON_SAMPLES + dx;
          const color = samples.texel[sample] >= 0 ? texel(layers, samples.texel[sample], dye) : undefined;
          if (!color) continue;
          const light = samples.light[sample];
          [r, g, b, covered] = [r + color[0] * light, g + color[1] * light, b + color[2] * light, covered + 1];
        }
      }
      if (covered) image.data.set([clamp(r / covered), clamp(g / covered), clamp(b / covered), clamp((255 * covered) / ICON_SAMPLES ** 2)], (y * ICON_SIZE + x) * 4);
    }
  }
  return encodePng(image);
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
      const grain = 1 + (((x * 73 + y * 151) % 17) - 8) / 220;
      image.data.set([...[rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff].map((channel) => clamp(channel * light * grain)), 255], (y * BALL_SIZE + x) * 4);
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

// ---- Where a held model sits ------------------------------------------------------------------
//
// A held model's root bone is bound to the hand (q.item_slot_to_bone_name). The math here works in
// Blockbench's space (a Bedrock file's x mirrored; rotations (-x, -y, z), turned z after y after
// x), using the setup Blockbench's attachable preview draws (js/formats/bedrock/attachable_preview.js)
// and the vanilla arm poses: a bound model's point p lands at SHOULDER + ARM * (p + bind), the arm
// turned as vanilla's animations turn it. In first person the camera looks along +z; in third
// person the player faces -z with their right hand on +x.
//
// Where a bound model's origin is: 24 pixels under the hand (the player's rightItem locator, (1,
// -7, 1) from the shoulder), as Blockbench's preview and the Bedrock Wiki have it and vanilla's
// spear shows (it lifts its bound bone 24). Seen in game on 2026-11-08 with Probe's test axes, whose
// boxes are in the bound bone: with no pose they sat by the feet in third person, and right of the
// crosshair in first person, about where this puts them and turned within about 25 degrees of
// this (docs/spike-results.md, "Holding in third person"). A pose moves only the bound bone's own
// boxes, not a child bone's, so each held model keeps all its boxes in the bound bone.

/** From the shoulder to a bound model's origin, before the arm turns: the 24-pixel drop under the hand. */
const BIND: Vec3 = [1, -31, -1];
/** The middle of the fist, the arm's end. */
const FIST: Vec3 = [6, 12.5, 0];
const SHOULDER: Vec3 = [5, 22, 0];
/** First person: vanilla's animation.player.first_person.empty_hand turns the arm (95, -45, 115) and moves it (13.5, -10, 12). */
const FIRST_PERSON = { arm: times(times(rotZ(115), rotY(45)), rotX(-95)), shoulder: add(SHOULDER, [-13.5, -10, 12]) };
/** Third person: vanilla's animation.player.holding raises the arm 18 degrees. */
const THIRD_PERSON = { arm: rotX(18), shoulder: SHOULDER };
/** Blockbench's first-person camera: at the eyes, looking along +z, a 70.25 degree field of view on a 16:9 screen. */
const EYE: Vec3 = [0, 27.41, 0];
const VIEW_SLOPE = Math.tan(radians(70.25 / 2));
const ASPECT = 16 / 9;

interface Transform {
  rotation: Vec3;
  position: Vec3;
}

/** The bone rotation and position (a Bedrock file's, pivot at the origin) that put the model at `place` (a turn, then a point) on `chain`'s arm. */
function solve(turn: Matrix, point: Vec3, chain: { arm: Matrix; shoulder: Vec3 }): Transform {
  const back = transpose(chain.arm);
  const bone = times(back, turn);
  const offset = minus(apply(back, minus(point, chain.shoulder)), BIND);
  // bone = rotZ(c) * rotY(b) * rotX(a)
  const b = Math.asin(Math.max(-1, Math.min(1, -bone[2][0])));
  const a = Math.atan2(bone[2][1], bone[2][2]);
  const c = Math.atan2(bone[1][0], bone[0][0]);
  const round = (value: number) => Math.round(value * 100) / 100 + 0;
  return {
    rotation: [round((-a * 180) / Math.PI), round((-b * 180) / Math.PI), round((c * 180) / Math.PI)],
    position: [round(-offset[0]), round(offset[1]), round(offset[2])],
  };
}

const fistIn = (chain: { arm: Matrix; shoulder: Vec3 }) => add(chain.shoulder, apply(chain.arm, minus(FIST, SHOULDER)));

/** First person from the hip: by the fist, the model turned to face away from the camera, in and up a little. */
function hipHold(kind: ModelId): Transform {
  const { hip } = HOLD[kind];
  const [right, up, ahead] = hip.fromFist;
  return solve(times(rotY(180 - hip.turnIn), rotX(hip.tipUp)), add(fistIn(FIRST_PERSON), [-right, up, ahead]), FIRST_PERSON);
}

/** First person aiming: in the middle, straight ahead, its top just under the crosshair. */
function aimHold(kind: ModelId): Transform | undefined {
  const { aim, scale } = HOLD[kind];
  if (!aim) return undefined;
  const top = Math.max(...boxesOf(kind).map(({ from, size }) => from[1] + size[1])) * scale;
  const point: Vec3 = add(EYE, [0, -aim.under * VIEW_SLOPE * aim.depth - top, aim.depth]);
  return solve(rotY(180), point, FIRST_PERSON);
}

/** Third person: in the fist, barrel ahead and level. */
function thirdHold(kind: ModelId): Transform {
  const [right, up, ahead] = HOLD[kind].third;
  return solve(rotX(0), add(fistIn(THIRD_PERSON), [right, up, -ahead]), THIRD_PERSON);
}

// ---- Geometry and animations -----------------------------------------------------------------

/** A box as a Bedrock cube: Blockbench's own coordinates, box UV. */
function cube({ from, size }: Box, uv: [number, number]): unknown {
  return { origin: from, size, uv };
}

/** The most a model block's model spans, in pixels: a block's geometry must fit in 30. */
const ICON_BLOCK_SPAN = 28;
const FACE_NAMES = ["up", "down", "east", "north", "west", "south"] as const;

/**
 * The model for its item's icon (a block's): shrunk to fit a block, centered on it and standing on
 * its floor, each face keeping its own place in the texture (per-face UV, as box UV would shrink).
 */
function iconCubes(boxes: Box[]): unknown[] {
  const { uvs } = uvLayout(boxes);
  const low = [0, 1, 2].map((axis) => Math.min(...boxes.map(({ from }) => from[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...boxes.map(({ from, size }) => from[axis] + size[axis])));
  const scale = Math.min(1, ICON_BLOCK_SPAN / Math.max(...high.map((value, axis) => value - low[axis])));
  const at = (value: number, axis: number) => Math.round((axis === 1 ? (value - low[1]) * scale + 1 : (value - (low[axis] + high[axis]) / 2) * scale) * 1000) / 1000;
  return boxes.map((piece, i) => ({
    origin: piece.from.map(at),
    size: piece.size.map((value) => Math.round(value * scale * 1000) / 1000),
    uv: Object.fromEntries(boxFaces(piece, uvs[i]).map(({ rect: [u, v, w, h] }, face) => [FACE_NAMES[face], { uv: [u, v], uv_size: [w, h] }])),
  }));
}

function geometries(): unknown {
  const all: unknown[] = [];
  for (const kind of [...PICKUP_KINDS, ...ARSENAL_MODELS]) {
    const boxes = boxesOf(kind);
    const { uvs, width, height } = uvLayout(boxes);
    const cubes = boxes.map((piece, i) => cube(piece, uvs[i]));
    const description = (identifier: string) => ({
      identifier,
      texture_width: width,
      texture_height: height,
      visible_bounds_width: 3,
      visible_bounds_height: 3,
      visible_bounds_offset: [0, 0.75, 0],
    });
    // Held: one bone, bound to the hand, holding every box; the hold poses and the recoil both move
    // it. (A pose on a bound bone doesn't move a child bone's boxes: seen in game, the guns' child
    // "body" never followed a pose.)
    all.push({
      description: description(heldGeometry(kind)),
      bones: [{ name: "gun", binding: "q.item_slot_to_bone_name(c.item_slot)", pivot: [0, 0, 0], cubes }],
    });
    // Floating, flying or sitting on its own: turns and swells around its middle. The arsenal's
    // stand on their floor (one entity shows any of them, so they can't each be lifted their own way).
    const shown = kind in ARSENAL_BOXES ? grounded(boxes) : boxes;
    const middle = middleOf(shown);
    all.push({
      description: description(displayGeometry(kind)),
      bones: [
        { name: "display", pivot: middle },
        { name: "body", parent: "display", pivot: middle, cubes: shown.map((piece, i) => cube(piece, uvs[i])) },
      ],
    });
    // Its model block's, which the game draws as the item's icon.
    all.push({
      description: { identifier: iconGeometry(kind), texture_width: width, texture_height: height },
      bones: [{ name: "model", pivot: [0, 0, 0], cubes: iconCubes(boxes) }],
    });
  }
  // The aim marker in a hand: nothing.
  all.push({
    description: { identifier: BLANK_GEOMETRY, texture_width: 16, texture_height: 16 },
    bones: [{ name: "blank", binding: "q.item_slot_to_bone_name(c.item_slot)", pivot: [0, 0, 0] }],
  });
  // The rocket in flight: turned along its flight around its middle.
  const { uvs, width, height } = uvLayout(ROCKET_BOXES);
  const middle = middleOf(ROCKET_BOXES);
  all.push({
    description: { identifier: ROCKET_GEOMETRY, texture_width: width, texture_height: height, visible_bounds_width: 2, visible_bounds_height: 2 },
    bones: [
      { name: "display", pivot: middle },
      { name: "body", parent: "display", pivot: middle, cubes: ROCKET_BOXES.map((piece, i) => cube(piece, uvs[i])) },
    ],
  });
  return { format_version: "1.16.0", "minecraft:geometry": all };
}

/** Boxes moved to stand on y 0, centered across: a model sitting on the ground. */
function grounded(boxes: Box[]): Box[] {
  const low = [0, 1, 2].map((axis) => Math.min(...boxes.map(({ from }) => from[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...boxes.map(({ from, size }) => from[axis] + size[axis])));
  const shift: Vec3 = [-(low[0] + high[0]) / 2, -low[1], -(low[2] + high[2]) / 2];
  return boxes.map(({ from, size, paint }) => ({ from: add(from, shift), size, paint }));
}

function middleOf(boxes: Box[]): Vec3 {
  return [0, 1, 2].map((axis) => {
    const low = Math.min(...boxes.map((piece) => piece.from[axis]));
    const high = Math.max(...boxes.map((piece) => piece.from[axis] + piece.size[axis]));
    return (low + high) / 2;
  }) as Vec3;
}

// The hold animations (HOLD_FILE) are plain poses of the "gun" bone. Each view has a shared pose
// for every gun, and one for every grenade, the knife and the stimpack (a HoldGroup), and each model
// has its own pose for the view on top. The game plays both and adds their rotations and positions,
// as Blockbench does with two animations playing, so moving a shared pose moves every model in its
// group, and a model's own moves just that model. The generator's first guesses keep each model's
// size in its own pose; a size in the shared pose too multiplies with it, as Blockbench shows (the
// game is expected to do the same, not yet seen).

type HoldPose = "first_person_hip" | "first_person_aim" | "third_person";
const holdPoses = (kind: ModelId): HoldPose[] => (aims(kind) ? ["first_person_hip", "first_person_aim", "third_person"] : ["first_person_hip", "third_person"]);
type HoldGroup = "guns" | "throwables";
const HOLD_GROUPS: HoldGroup[] = ["guns", "throwables"];
const holdGroup = (kind: ModelId): HoldGroup => (isGun(kind) ? "guns" : "throwables");
const groupPoses = (group: HoldGroup): HoldPose[] => (group === "guns" ? ["first_person_hip", "first_person_aim", "third_person"] : ["first_person_hip", "third_person"]);
/** A group's shared pose for a view. */
const sharedHold = (group: HoldGroup, pose: HoldPose) => `animation.minecade.all_${group}.${pose}`;
/** A model's own pose for a view, on top of its group's. */
const holdAnimation = (kind: ModelId, pose: HoldPose) => `animation.minecade.gun_${kind}.${pose}`;
/** The models each group's shared poses first came from: the Pistol's or the frag grenade's place, and the Rail Gun's aim. */
const GROUP_SEED: Record<HoldGroup, { model: ModelId; aim?: ModelId }> = { guns: { model: "handgun", aim: "rail_gun" }, throwables: { model: "frag_grenade" } };
const recoilAnimation = (kind: ModelId) => `animation.minecade.gun_${kind}.recoil`;
const ROCKET_ANIMATION = "animation.minecade.rocket.fly";
/**
 * The rocket's heading, worked out on the client from its own flight (q.movement_direction, its
 * normalized move, as vanilla's elytra reads it), in degrees as a player's rotation has them (yaw:
 * 0 is south, 90 west; pitch: positive is down). Not a property from the script: the rocket flies
 * as a snowball (runtime_identifier), and the client gives such an entity no property component,
 * so q.property on it is an error. Between moves (the frame it appears, say) it keeps the last.
 */
const ROCKET_SCRIPTS = {
  initialize: ["v.yaw = 0;", "v.pitch = 0;"],
  pre_animation: [
    "v.moving = math.abs(q.movement_direction(0)) + math.abs(q.movement_direction(1)) + math.abs(q.movement_direction(2)) > 0.5;",
    "v.yaw = v.moving ? math.atan2(-q.movement_direction(0), q.movement_direction(2)) : v.yaw;",
    "v.pitch = v.moving ? math.asin(math.clamp(-q.movement_direction(1), -1, 1)) : v.pitch;",
  ],
};
/** Every model the held animations cover, Paintball's first. */
const ALL_MODELS: ModelId[] = [...PICKUP_KINDS, ...ARSENAL_MODELS];
const GUN_MODELS: ModelId[] = [...GUN_KINDS, ...ARSENAL_GUNS];
const PICKUP_ANIMATION = "animation.minecade.gun_pickup.float";
const TUMBLE_ANIMATION = "animation.minecade.paint_grenade.tumble";
const SWELL_ANIMATION = "animation.minecade.paint_grenade.swell";
/** How much bigger a landed grenade gets by the end of its fuse. */
const SWELL = 0.8;
/**
 * Where the held models sit: edited by hand (in Blockbench), so the generator writes it only when
 * it's missing, from the solver's poses. Delete it and rerun to start over from those.
 */
export const HOLD_FILE = "resource_pack/animations/guns_hold.animation.json";

const fixed = (value: number) => Number(value.toFixed(2));

/** The solver's pose for a model in a view, at full size. */
function solvedHold(kind: ModelId, pose: HoldPose): Transform {
  if (pose === "first_person_hip") return hipHold(kind);
  if (pose === "third_person") return thirdHold(kind);
  return aimHold(kind)!;
}

/** A shared pose's first guess: its group's seed model's, at full size. */
function sharedSeed(group: HoldGroup, pose: HoldPose): Transform {
  const seed = GROUP_SEED[group];
  return solvedHold(pose === "first_person_aim" ? seed.aim! : seed.model, pose);
}

/**
 * A model's own pose's first guess: the solver's pose for it less its group's shared one (the game
 * adds the two up), and its size (none while a hidden gun aims).
 */
function ownSeed(kind: ModelId, pose: HoldPose): { rotation: Vec3; position: Vec3; scale?: number } {
  const whole = solvedHold(kind, pose);
  const shared = sharedSeed(holdGroup(kind), pose);
  const turn = (degrees: number) => fixed(((((degrees + 180) % 360) + 360) % 360) - 180) + 0;
  const own = {
    rotation: whole.rotation.map((value, axis) => turn(value - shared.rotation[axis])) as Vec3,
    position: whole.position.map((value, axis) => fixed(value - shared.position[axis]) + 0) as Vec3,
  };
  const { scale, aim } = HOLD[kind];
  const size = pose === "third_person" ? 1 : pose === "first_person_aim" && aim?.hidden ? 0 : scale;
  return size === 1 ? own : { ...own, scale: size };
}

/** The hold animations as the solver places them: the first version of HOLD_FILE, the shared poses first. */
export function holdAnimationsSeed(): { format_version: string; animations: Record<string, unknown> } {
  const all: Record<string, unknown> = {};
  const posed = (gun: object) => ({ loop: true, bones: { gun } });
  for (const group of HOLD_GROUPS) for (const pose of groupPoses(group)) all[sharedHold(group, pose)] = posed(sharedSeed(group, pose));
  for (const kind of ALL_MODELS) for (const pose of holdPoses(kind)) all[holdAnimation(kind, pose)] = posed(ownSeed(kind, pose));
  return { format_version: "1.8.0", animations: all };
}

/** Every hold animation an attachable names, for the check that HOLD_FILE still has them all. */
export function holdAnimationNames(): string[] {
  return [
    ...HOLD_GROUPS.flatMap((group) => groupPoses(group).map((pose) => sharedHold(group, pose))),
    ...ALL_MODELS.flatMap((kind) => holdPoses(kind).map((pose) => holdAnimation(kind, pose))),
  ];
}

/**
 * HOLD_FILE's text with the solver's poses added for every hold animation it doesn't have yet (a
 * new model's), inserted after its last one in the file's own layout and line endings. Every
 * character already there stays as it is: the poses in it are the user's.
 */
export function withMissingHolds(text: string): { text: string; added: string[] } {
  const have = (JSON.parse(text) as { animations?: Record<string, unknown> }).animations ?? {};
  const seed = holdAnimationsSeed().animations;
  const added = Object.keys(seed).filter((name) => !(name in have));
  if (added.length === 0) return { text, added };
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  // The file ends with the animations object's closing brace, then the root's.
  const rootClose = text.lastIndexOf("}");
  const animationsClose = text.lastIndexOf("}", rootClose - 1);
  let last = animationsClose - 1;
  while (last >= 0 && /\s/.test(text[last])) last--;
  const empty = text[last] === "{";
  const entries = added.map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(seed[name], null, 2).replace(/\n/g, "\n    ")}`.replace(/\n/g, newline));
  return { text: `${text.slice(0, last + 1)}${empty ? "" : ","}${newline}${entries.join(`,${newline}`)}${text.slice(last + 1)}`, added };
}

/** The generated animations: recoil, the pickup's float, and the grenade's tumble and swell. */
function animations(): unknown {
  const all: Record<string, unknown> = {};
  for (const kind of GUN_KINDS) all[recoilAnimation(kind)] = recoilPose(kind);
  all[PICKUP_ANIMATION] = {
    loop: true,
    bones: { display: { rotation: [0, "q.life_time * 120", 0], position: [0, "10 + math.sin(q.life_time * 150) * 1.5", 0], scale: 1.6 } },
  };
  all[TUMBLE_ANIMATION] = { loop: true, bones: { display: { rotation: ["q.life_time * 600", 0, "q.life_time * 300"] } } };
  // Sits on the ground as it swells, wobbling harder as the fuse runs out.
  const grenade = MODELS.grenade;
  const [, middle] = middleOf(grenade);
  const below = middle - Math.min(...grenade.map(({ from }) => from[1]));
  all[SWELL_ANIMATION] = {
    loop: true,
    bones: {
      display: {
        scale: "v.swell",
        position: [0, `v.swell * ${fixed(below)} - ${fixed(middle)}`, 0],
        rotation: [0, 0, "math.sin(q.life_time * 1600) * 8 * (v.swell - 1)"],
      },
    },
  };
  for (const kind of ARSENAL_GUNS) all[recoilAnimation(kind)] = recoilPose(kind);
  // Points the rocket along its flight by the heading its client entity works out (ROCKET_SCRIPTS),
  // with vanilla's arrow's signs ("-pitch", "-yaw" from q.target_x_rotation and q.target_y_rotation,
  // which only a vanilla projectile's own flight keeps: the rocket flies as a snowball, so it always
  // pointed one way).
  all[ROCKET_ANIMATION] = { loop: true, bones: { display: { rotation: ["-v.pitch", "-v.yaw", 0] } } };
  return { format_version: "1.8.0", animations: all };
}

/**
 * A gun's recoil animation, on its held bone on top of the hold pose: its kick (0 to 1, kickMolang)
 * tips the muzzle up about the grip and moves the gun back along its barrel. The pose turns the
 * barrel, so which way is back comes from the solver's pose for each view (first person from the
 * hip or aiming, third person); the hold file's poses stay close to those.
 */
function recoilPose(kind: ModelId): unknown {
  const { back, lift } = recoilOf(kind);
  const kick = kickMolang(kind);
  const hip = barrelBack(hipHold(kind).rotation);
  const third = barrelBack(thirdHold(kind).rotation);
  const aim = aimHold(kind);
  const aimed = aim && barrelBack(aim.rotation);
  const first = (axis: number) => (aimed ? `(${AIMING} ? ${fixed(aimed[axis] * back)} : ${fixed(hip[axis] * back)})` : `${fixed(hip[axis] * back)}`);
  const along = (axis: number) => `${kick} * (c.is_first_person ? ${first(axis)} : ${fixed(third[axis] * back)})`;
  return { loop: true, bones: { gun: { position: [along(0), along(1), along(2)], rotation: [`${kick} * ${-lift}`, 0, 0] } } };
}

/**
 * Back along the barrel (the model's +z) in the bone's parent space, for a pose's rotation as the
 * file has it: the game turns x, then y, then z, its file's x mirrored (Blockbench's reading).
 */
export function barrelBack([x, y, z]: Vec3): Vec3 {
  return apply(times(times(rotZ(-z), rotY(y)), rotX(-x)), [0, 0, 1]);
}

/**
 * True while the player aims: Guns puts the aim marker in their off hand. Asked of the held model
 * and of its holder (c.owning_entity, as vanilla's spear asks its holder), since a right click
 * zoomed but the aim pose didn't come up when only the first was asked.
 */
const OFF_HAND_MARKER = `is_item_name_any('slot.weapon.offhand', 0, '${AIM_MARKER.item}')`;
const AIMING = `(q.${OFF_HAND_MARKER} || c.owning_entity->q.${OFF_HAND_MARKER})`;
/** How long a gun that aims takes to come up or go down. */
const AIM_EASE_SECONDS = 0.2;

/**
 * A held gun's kick in Molang, 0 to 1: kickHeight over the gun's own cooldown, read off the main
 * hand (the item this model is), and smaller while aiming a gun that aims. It's written out in full
 * in each channel, with no variables: a held model's animations look variables up on the player
 * holding it, so the ones its own scripts set were unknown to them (the client said so, and the
 * guns never kicked; docs/spike-results.md, "Holding in third person").
 */
function kickMolang(kind: ModelId): string {
  const { seconds } = recoilOf(kind);
  const rise = kickRise(seconds);
  const t = `(1 - math.clamp(q.cooldown_time_remaining('slot.weapon.mainhand') / ${seconds}, 0, 1))`;
  const kick = `(${t} < ${rise} ? ${t} / ${rise} : math.pow((1 - ${t}) / ${fixed(1 - rise)}, 2))`;
  return aims(kind) ? `${kick} * (${AIMING} ? ${AIM_RECOIL} : 1)` : kick;
}

/** The part of a kick of `seconds` spent rising to its full height. */
export function kickRise(seconds: number): number {
  return fixed(Math.min(KICK_RISE_MOST, KICK_RISE_SECONDS / seconds));
}

/**
 * How high a kick of `seconds` is `elapsed` seconds after its shot, 0 to 1: up fast, then easing
 * home (the square of what's left), back at 0 when the next shot can come. The recoil animation
 * works it out the same way in Molang (kickMolang).
 */
export function kickHeight(elapsed: number, seconds: number): number {
  const t = Math.min(1, Math.max(0, elapsed / seconds));
  const rise = kickRise(seconds);
  return t < rise ? t / rise : ((1 - t) / (1 - rise)) ** 2;
}

/** A view's two poses in an attachable: its group's shared one (`pose`) and the model's own (`pose_own`), played together. */
const posesFor = (pose: HoldPose, when: string) => [{ [pose]: when }, { [`${pose}_own`]: when }];

/**
 * The attachable's script: no variables (see kickMolang), only what to animate. The hold poses
 * by first or third person; a gun that aims eases between its hip and aim poses through its hold
 * controller (holdControllers); a gun's recoil plays all the time, still until a shot.
 */
function attachableScripts(kind: ModelId): Record<string, unknown> {
  const hold = aims(kind) ? ["hold"] : [...posesFor("first_person_hip", "c.is_first_person"), ...posesFor("third_person", "!c.is_first_person")];
  return { animate: isGun(kind) ? [...hold, "recoil"] : hold };
}

/** A gun that aims: its hold controller, named in its attachable as "hold". */
const holdController = (kind: ModelId) => `controller.animation.minecade.gun_${kind}.hold`;

/**
 * The hold controllers of the guns that aim: the hip and aim poses as two states, the gun easing
 * from one to the other (blend_transition) as the aim marker comes into the off hand and goes.
 */
function holdControllers(): unknown {
  const all: Record<string, unknown> = {};
  for (const kind of GUN_MODELS.filter(aims)) {
    const state = (pose: HoldPose, next: string, when: string) => ({
      animations: [...posesFor(pose, "c.is_first_person"), ...posesFor("third_person", "!c.is_first_person")],
      transitions: [{ [next]: when }],
      blend_transition: AIM_EASE_SECONDS,
    });
    all[holdController(kind)] = {
      initial_state: "hip",
      states: { hip: state("first_person_hip", "aim", AIMING), aim: state("first_person_aim", "hip", `!${AIMING}`) },
    };
  }
  return { format_version: "1.10.0", animation_controllers: all };
}

function attachable(kind: PickupKind, dye: Dye): unknown {
  return attachableOf(kind, gunItem(kind, dye), modelTexturePath(kind, dye));
}

function attachableOf(kind: ModelId, identifier: string, texture: string): unknown {
  const animationsOf: Record<string, string> = {};
  for (const pose of holdPoses(kind)) {
    animationsOf[pose] = sharedHold(holdGroup(kind), pose);
    animationsOf[`${pose}_own`] = holdAnimation(kind, pose);
  }
  if (isGun(kind)) animationsOf.recoil = recoilAnimation(kind);
  if (aims(kind)) animationsOf.hold = holdController(kind);
  return {
    format_version: "1.10.0",
    "minecraft:attachable": {
      description: {
        identifier,
        materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
        textures: { default: texture, enchanted: "textures/misc/enchanted_item_glint" },
        geometry: { default: heldGeometry(kind) },
        animations: animationsOf,
        scripts: attachableScripts(kind),
        render_controllers: ["controller.render.item_default"],
      },
    },
  };
}

// ---- Behavior pack -----------------------------------------------------------------------------

const ITEM_FORMAT = "1.21.120";

function item(kind: PickupKind, dye: Dye): unknown {
  const model = gunModelBlock(kind, dye);
  const components: Record<string, unknown> = {
    // No icon: an item that places a block shows that block, which is the model drawn in 3D. It
    // can only be placed on that block, which is never in the world, so it places nothing.
    "minecraft:block_placer": { block: model, use_on: [model] },
    "minecraft:display_name": { value: isGun(kind) ? GUNS[kind as keyof typeof GUNS].name : GRENADE.name },
    "minecraft:max_stack_size": isGun(kind) ? 1 : 16,
    "minecraft:hand_equipped": true,
    "minecraft:can_destroy_in_creative": false,
  };
  if (isGun(kind)) {
    // Right click fires, held in use until it comes up; a left click fires once or raises the gun
    // (a swing), so the swing is kept short. Each shot starts this cooldown, which shades the hotbar
    // slot until the gun can fire again.
    components["minecraft:use_modifiers"] = GUN_USE;
    components["minecraft:swing_duration"] = { value: GUN_SWING_SECONDS };
    components["minecraft:cooldown"] = { category: gunCooldown(kind), duration: GUNS[kind as keyof typeof GUNS].everyTicks / 20 };
  }
  return { format_version: ITEM_FORMAT, "minecraft:item": { description: { identifier: gunItem(kind, dye), menu_category: { category: "none" } }, components } };
}

/** An arsenal item: as a paint gun's (a hidden model block for its icon; for a gun, its use, a short swing and its fire rate's cooldown), one of each. */
function arsenalItemFile(model: ArsenalModel): unknown {
  const block = arsenalModelBlock(model);
  const gun = isArsenalGun(model) ? ARSENAL_GUN_DEFS[model] : undefined;
  const name = gun?.name ?? (model === "stimpack" ? STIM.name : (ARSENAL_THROWABLE_DEFS as Record<string, { name: string }>)[model].name);
  const components: Record<string, unknown> = {
    "minecraft:block_placer": { block, use_on: [block] },
    "minecraft:display_name": { value: name },
    "minecraft:max_stack_size": gun ? 1 : 4,
    "minecraft:hand_equipped": true,
    "minecraft:can_destroy_in_creative": false,
  };
  if (gun) {
    components["minecraft:use_modifiers"] = GUN_USE;
    components["minecraft:swing_duration"] = { value: GUN_SWING_SECONDS };
    components["minecraft:cooldown"] = { category: gunCooldown(model), duration: gun.everyTicks / 20 };
  }
  return { format_version: ITEM_FORMAT, "minecraft:item": { description: { identifier: arsenalItem(model), menu_category: { category: "none" } }, components } };
}

/**
 * The aim marker (AIM_MARKER): an item Guns puts in the off hand while a player aims, which the held
 * models read. Its icon and its look in a hand (blankAttachable) are blank, so the off hand shows nothing.
 */
function aimMarkerItem(): unknown {
  return {
    format_version: ITEM_FORMAT,
    "minecraft:item": {
      description: { identifier: AIM_MARKER.item, menu_category: { category: "none" } },
      components: {
        "minecraft:icon": { textures: { default: MARKER_ICON } },
        "minecraft:allow_off_hand": { value: true },
        "minecraft:max_stack_size": 1,
      },
    },
  };
}

const MARKER_ICON = "minecade_gun_marker";
/** A fully clear texture: the aim marker's icon, and what its blank model is drawn with. */
const BLANK_TEXTURE = `${GUN_TEXTURES}/blank`;
/** A geometry with no boxes: the aim marker in a hand draws nothing. */
const BLANK_GEOMETRY = "geometry.minecade.blank";

/** The aim marker held (in the off hand): a model with nothing to draw. */
function blankAttachable(): unknown {
  return {
    format_version: "1.10.0",
    "minecraft:attachable": {
      description: {
        identifier: AIM_MARKER.item,
        // The item render controller names an enchanted look too, and logs an error without one.
        materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
        textures: { default: BLANK_TEXTURE, enchanted: "textures/misc/enchanted_item_glint" },
        geometry: { default: BLANK_GEOMETRY },
        render_controllers: ["controller.render.item_default"],
      },
    },
  };
}

function blankTexture(): Buffer {
  return encodePng(blankImage(16, 16));
}

/** The hidden block an item shows as its icon (iconGeometry). */
function modelBlock(kind: PickupKind, dye: Dye): unknown {
  return {
    format_version: "1.21.60",
    "minecraft:block": {
      description: { identifier: gunModelBlock(kind, dye), menu_category: { category: "none" } },
      components: {
        "minecraft:geometry": iconGeometry(kind),
        "minecraft:material_instances": { "*": { texture: terrainKey(kind, dye), render_method: "alpha_test" } },
      },
    },
  };
}

function arsenalBlock(model: ArsenalModel): unknown {
  return {
    format_version: "1.21.60",
    "minecraft:block": {
      description: { identifier: arsenalModelBlock(model), menu_category: { category: "none" } },
      components: {
        "minecraft:geometry": iconGeometry(model),
        "minecraft:material_instances": { "*": { texture: arsenalTerrainKey(model), render_method: "alpha_test" } },
      },
    },
  };
}

const colorProperty = { [COLOR_PROPERTY]: { type: "int", range: [0, DYES.length - 1], default: 0, client_sync: true } };
/** Which arsenal model an arsenal entity shows: an index into ARSENAL_MODELS. */
const modelProperty = { [MODEL_PROPERTY]: { type: "int", range: [0, ARSENAL_MODELS.length - 1], default: 0, client_sync: true } };
/** Nothing hurts, pushes or burns these: the script places and removes them. */
const UNTOUCHABLE = {
  "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
  "minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
  "minecraft:health": { value: 1, max: 1 },
  "minecraft:knockback_resistance": { value: 1 },
  "minecraft:fire_immune": true,
};

/**
 * A projectile the script shoots. Without a vanilla runtime, it moves as a plain entity does (it
 * keeps 0.91 of its speed a tick and falls under the world's gravity: Paintball's balls and
 * grenades, as the user has them). `straight` borrows the snowball's runtime, which keeps the
 * projectile's own numbers: it holds its speed and only falls by its own small gravity (the
 * rocket). Measured on BDS: spike/arsenal.
 */
function projectileEntity(identifier: string, size: number, gravity: number, knockback: boolean, properties: Record<string, unknown> | null = colorProperty, straight = false): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier, ...(straight ? { runtime_identifier: "minecraft:snowball" } : {}), is_spawnable: false, is_summonable: true, ...(properties ? { properties } : {}) },
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
          ...(straight ? { inertia: 1 } : {}),
        },
        "minecraft:physics": straight ? { has_gravity: false } : {},
        "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
        "minecraft:conditional_bandwidth_optimization": {
          default_values: { max_optimized_distance: 80, max_dropped_ticks: 5, use_motion_prediction_hints: true },
        },
      },
    },
  };
}

/** A grenade that landed: it falls to the ground and sits there until the script bursts it. */
function primedGrenadeEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier: PRIMED_GRENADE, is_spawnable: false, is_summonable: true, properties: colorProperty },
      components: { "minecraft:collision_box": { width: 0.3, height: 0.3 }, "minecraft:physics": {}, ...UNTOUCHABLE },
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
        ...UNTOUCHABLE,
      },
    },
  };
}

/** An arsenal grenade that landed: it falls to the ground and sits there until the script bursts it. */
function primedArsenalEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier: PRIMED_ARSENAL, is_spawnable: false, is_summonable: true, properties: modelProperty },
      components: { "minecraft:collision_box": { width: 0.3, height: 0.3 }, "minecraft:physics": {}, ...UNTOUCHABLE },
    },
  };
}

/** An arsenal item floating over a spot (a thrown knife where it came to rest). */
function arsenalPickupEntity(): unknown {
  return {
    format_version: "1.21.100",
    "minecraft:entity": {
      description: { identifier: ARSENAL_PICKUP, is_spawnable: false, is_summonable: true, properties: modelProperty },
      components: {
        "minecraft:collision_box": { width: 0.01, height: 0.01 },
        "minecraft:physics": { has_gravity: false, has_collision: false },
        ...UNTOUCHABLE,
      },
    },
  };
}

// ---- Resource pack client entities and particle ----------------------------------------------

function clientEntities(): Record<string, unknown> {
  const client = (description: Record<string, unknown>) => ({ format_version: "1.10.0", "minecraft:client_entity": { description } });
  const grenadeTextures = Object.fromEntries(DYES.map((dye) => [dye, modelTexturePath("grenade", dye)]));
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
      textures: grenadeTextures,
      geometry: { default: displayGeometry("grenade") },
      render_controllers: ["controller.render.minecade.paint_grenade"],
      animations: { tumble: TUMBLE_ANIMATION },
      scripts: { animate: ["tumble"] },
    }),
    "resource_pack/entity/paint_grenade_primed.entity.json": client({
      identifier: PRIMED_GRENADE,
      materials: { default: "entity_alphatest" },
      textures: grenadeTextures,
      geometry: { default: displayGeometry("grenade") },
      render_controllers: ["controller.render.minecade.paint_grenade_primed"],
      animations: { swell: SWELL_ANIMATION },
      scripts: {
        pre_animation: [`v.swell = 1 + math.min(q.life_time / ${GRENADE.fuseTicks / 20}, 1) * ${SWELL};`],
        animate: ["swell"],
      },
    }),
    "resource_pack/entity/gun_pickup.entity.json": client({
      identifier: GUN_PICKUP,
      materials: { default: "entity_alphatest" },
      textures: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, modelTexturePath(kind, "white")])),
      geometry: Object.fromEntries(PICKUP_KINDS.map((kind) => [kind, displayGeometry(kind)])),
      render_controllers: ["controller.render.minecade.gun_pickup"],
      animations: { float: PICKUP_ANIMATION },
      scripts: { animate: ["float"] },
    }),
    "resource_pack/entity/arsenal_thrown.entity.json": client({
      identifier: THROWN_ARSENAL,
      ...arsenalLooks,
      render_controllers: ["controller.render.minecade.arsenal_model"],
      animations: { tumble: TUMBLE_ANIMATION },
      scripts: { animate: ["tumble"] },
    }),
    "resource_pack/entity/arsenal_primed.entity.json": client({
      identifier: PRIMED_ARSENAL,
      ...arsenalLooks,
      render_controllers: ["controller.render.minecade.arsenal_primed"],
    }),
    "resource_pack/entity/arsenal_pickup.entity.json": client({
      identifier: ARSENAL_PICKUP,
      ...arsenalLooks,
      render_controllers: ["controller.render.minecade.arsenal_pickup"],
      animations: { float: PICKUP_ANIMATION },
      scripts: { animate: ["float"] },
    }),
    "resource_pack/entity/rocket.entity.json": client({
      identifier: ROCKET,
      materials: { default: "entity_alphatest" },
      textures: { default: ROCKET_TEXTURE },
      geometry: { default: ROCKET_GEOMETRY },
      render_controllers: ["controller.render.minecade.rocket"],
      animations: { fly: ROCKET_ANIMATION },
      scripts: { ...ROCKET_SCRIPTS, animate: ["fly"] },
    }),
  };
}

/** The arsenal entities' models and textures, one of each per model, picked by the model property. */
const arsenalLooks = {
  materials: { default: "entity_alphatest" },
  textures: Object.fromEntries(ARSENAL_MODELS.map((model) => [model, arsenalTexturePath(model)])),
  geometry: Object.fromEntries(ARSENAL_MODELS.map((model) => [model, displayGeometry(model)])),
};

function renderControllers(): unknown {
  const pick = (array: string, property: string) => `${array}[q.property('${property}')]`;
  const byColor = { arrays: { textures: { "Array.dyes": DYES.map((dye) => `Texture.${dye}`) } }, geometry: "Geometry.default", materials: [{ "*": "Material.default" }], textures: [pick("Array.dyes", COLOR_PROPERTY)] };
  const byModel = {
    arrays: {
      textures: { "Array.models": ARSENAL_MODELS.map((model) => `Texture.${model}`) },
      geometries: { "Array.models": ARSENAL_MODELS.map((model) => `Geometry.${model}`) },
    },
    geometry: pick("Array.models", MODEL_PROPERTY),
    materials: [{ "*": "Material.default" }],
    textures: [pick("Array.models", MODEL_PROPERTY)],
  };
  return {
    format_version: "1.10.0",
    render_controllers: {
      "controller.render.minecade.paintball": byColor,
      "controller.render.minecade.paint_grenade": byColor,
      // Flashes white faster and faster, like lit TNT.
      "controller.render.minecade.paint_grenade_primed": {
        ...byColor,
        overlay_color: { r: 1, g: 1, b: 1, a: "math.mod(q.life_time * (2 + q.life_time * 5), 1) > 0.5 ? 0.55 : 0" },
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
      "controller.render.minecade.arsenal_model": byModel,
      // Flashes white faster and faster, like lit TNT.
      "controller.render.minecade.arsenal_primed": {
        ...byModel,
        overlay_color: { r: 1, g: 1, b: 1, a: "math.mod(q.life_time * (2 + q.life_time * 5), 1) > 0.5 ? 0.55 : 0" },
      },
      "controller.render.minecade.arsenal_pickup": { ...byModel, ignore_lighting: true },
      "controller.render.minecade.rocket": { geometry: "Geometry.default", materials: [{ "*": "Material.default" }], textures: ["Texture.default"] },
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

// ---- The arsenal's particles -------------------------------------------------------------------
//
// Each draws the soft puff (PUFF_TEXTURE) tinted, and reads the Molang variables the scripts set
// (defs.ts's PARTICLES says which). A streak or beam runs from the muzzle along v.dir for v.dist
// blocks: every particle leaves the muzzle along it, the streak's each at its own speed and gone as
// it reaches the end, the beam's slowed by drag to rest at its own point of the line.

const AGE = "v.particle_age / v.particle_lifetime";
const FADE = `1 - ${AGE}`;

function arsenalParticle(identifier: string, material: "particles_add" | "particles_blend", components: Record<string, unknown>): unknown {
  return {
    format_version: "1.10.0",
    particle_effect: { description: { identifier, basic_render_parameters: { material, texture: PUFF_TEXTURE } }, components },
  };
}

function puffs(size: string | number): unknown {
  return { size: [size, size], facing_camera_mode: "rotate_xyz", uv: { texture_width: 16, texture_height: 16, uv: [0, 0], uv_size: [16, 16] } };
}

/** A burst all at once: `count` particles, then the emitter is done. */
const once = (count: number | string) => ({
  "minecraft:emitter_rate_instant": { num_particles: count },
  "minecraft:emitter_lifetime_once": { active_time: 0.05 },
});
/** Fire's colors: yellow at first, red as it goes, fading out. */
const flameColor = { color: [1, `math.lerp(0.85, 0.25, ${AGE})`, `math.lerp(0.35, 0.05, ${AGE})`, FADE] };

function arsenalParticles(): Record<string, unknown> {
  const along = { "minecraft:emitter_shape_point": { direction: ["v.dir.x", "v.dir.y", "v.dir.z"] } };
  const list = [
    arsenalParticle(PARTICLES.streak, "particles_add", {
      ...once(10),
      ...along,
      "minecraft:particle_initial_speed": "v.speed * (0.7 + v.particle_random_1 * 0.3)",
      "minecraft:particle_lifetime_expression": { max_lifetime: "v.dist / (v.speed * (0.7 + v.particle_random_1 * 0.3))" },
      "minecraft:particle_motion_dynamic": {},
      "minecraft:particle_appearance_billboard": puffs(0.04),
      "minecraft:particle_appearance_tinting": { color: [1, 0.86, 0.55, 1] },
    }),
    arsenalParticle(PARTICLES.impact, "particles_blend", {
      ...once(6),
      "minecraft:emitter_shape_sphere": { radius: 0.05, direction: "outwards" },
      "minecraft:particle_initial_speed": "1 + v.particle_random_1 * 1.5",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.3 + v.particle_random_2 * 0.3" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -4, 0], linear_drag_coefficient: 4 },
      "minecraft:particle_appearance_billboard": puffs("0.05 + v.particle_random_3 * 0.05"),
      "minecraft:particle_appearance_tinting": { color: [0.55, 0.52, 0.48, FADE] },
      "minecraft:particle_appearance_lighting": {},
    }),
    arsenalParticle(PARTICLES.hit, "particles_blend", {
      ...once(8),
      "minecraft:emitter_shape_sphere": { radius: 0.1, direction: "outwards" },
      "minecraft:particle_initial_speed": "1.5 + v.particle_random_1 * 2",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.25 + v.particle_random_2 * 0.15" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, -6, 0], linear_drag_coefficient: 3 },
      "minecraft:particle_appearance_billboard": puffs(0.06),
      "minecraft:particle_appearance_tinting": { color: [0.75, 0.06, 0.06, FADE] },
    }),
    arsenalParticle(PARTICLES.beam, "particles_add", {
      ...once("math.min(v.dist * 4, 480)"),
      ...along,
      "minecraft:particle_initial_speed": "v.dist * 25 * v.particle_random_1",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.6 + v.particle_random_2 * 0.3" },
      "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 25 },
      "minecraft:particle_appearance_billboard": puffs(`0.12 * (${FADE}) + 0.02`),
      "minecraft:particle_appearance_tinting": { color: [0.35, 0.9, 1, 1] },
    }),
    arsenalParticle(PARTICLES.trail, "particles_blend", {
      ...once(2),
      "minecraft:emitter_shape_sphere": { radius: 0.08, direction: "outwards" },
      "minecraft:particle_initial_speed": 0.2,
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.9 + v.particle_random_1 * 0.4" },
      "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 1 },
      "minecraft:particle_appearance_billboard": puffs("0.12 + v.particle_age * 0.35"),
      "minecraft:particle_appearance_tinting": {
        color: [`math.lerp(1, 0.33, math.min(1, ${AGE} * 3))`, `math.lerp(0.7, 0.32, math.min(1, ${AGE} * 3))`, `math.lerp(0.3, 0.31, math.min(1, ${AGE} * 3))`, `0.85 * (${FADE})`],
      },
    }),
    arsenalParticle(PARTICLES.explosion, "particles_blend", {
      ...once("16 + v.radius * 6"),
      "minecraft:emitter_shape_sphere": { radius: "v.radius * 0.2", direction: "outwards" },
      "minecraft:particle_initial_speed": "v.radius * (1.2 + v.particle_random_1 * 1.6)",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.5 + v.particle_random_2 * 0.8" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 0.8, 0], linear_drag_coefficient: 3.5 },
      "minecraft:particle_appearance_billboard": puffs("(0.35 + v.particle_random_3 * 0.45) * (1 + v.particle_age * 1.5)"),
      "minecraft:particle_appearance_tinting": {
        color: [`math.lerp(1, 0.3, math.min(1, ${AGE} * 2.5))`, `math.lerp(0.75, 0.29, math.min(1, ${AGE} * 2.5))`, `math.lerp(0.3, 0.28, math.min(1, ${AGE} * 2.5))`, FADE],
      },
    }),
    arsenalParticle(PARTICLES.fire, "particles_add", {
      "minecraft:emitter_rate_steady": { spawn_rate: "v.radius * v.radius * 10", max_particles: 300 },
      "minecraft:emitter_lifetime_once": { active_time: "v.seconds" },
      "minecraft:emitter_shape_disc": { radius: "v.radius", plane_normal: [0, 1, 0], offset: [0, 0.1, 0], direction: [0, 1, 0] },
      "minecraft:particle_initial_speed": "0.3 + v.particle_random_1 * 0.6",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.5 + v.particle_random_2 * 0.5" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 1.2, 0], linear_drag_coefficient: 1 },
      "minecraft:particle_appearance_billboard": puffs(`0.28 * (${FADE}) + 0.06`),
      "minecraft:particle_appearance_tinting": flameColor,
    }),
    arsenalParticle(PARTICLES.burning, "particles_add", {
      ...once(6),
      "minecraft:emitter_shape_box": { half_dimensions: [0.3, 0.9, 0.3], offset: [0, 0.9, 0], direction: [0, 1, 0] },
      "minecraft:particle_initial_speed": 0.4,
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.35 + v.particle_random_1 * 0.2" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 2, 0] },
      "minecraft:particle_appearance_billboard": puffs(`0.14 * (${FADE}) + 0.03`),
      "minecraft:particle_appearance_tinting": flameColor,
    }),
    arsenalParticle(PARTICLES.smoke, "particles_blend", {
      "minecraft:emitter_rate_steady": { spawn_rate: "v.radius * 7", max_particles: 220 },
      "minecraft:emitter_lifetime_once": { active_time: "math.max(1, v.seconds - 3)" },
      "minecraft:emitter_shape_sphere": { radius: "v.radius * 0.75", offset: [0, "v.radius * 0.45", 0], direction: "outwards" },
      "minecraft:particle_initial_speed": "0.2 + v.particle_random_1 * 0.4",
      "minecraft:particle_lifetime_expression": { max_lifetime: "3 + v.particle_random_2" },
      "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 1.5 },
      "minecraft:particle_appearance_billboard": puffs("1.2 + v.particle_random_3 + v.particle_age * 0.15"),
      "minecraft:particle_appearance_tinting": {
        color: [0.74, 0.74, 0.76, "0.92 * math.min(1, v.particle_age * 2) * math.min(1, (v.particle_lifetime - v.particle_age) * 1.2)"],
      },
      "minecraft:particle_appearance_lighting": {},
    }),
    arsenalParticle(PARTICLES.flash, "particles_add", {
      ...once(18),
      "minecraft:emitter_shape_sphere": { radius: 0.1, direction: "outwards" },
      "minecraft:particle_initial_speed": "4 + v.particle_random_1 * 5",
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.18 + v.particle_random_2 * 0.12" },
      "minecraft:particle_motion_dynamic": { linear_drag_coefficient: 5 },
      "minecraft:particle_appearance_billboard": puffs(`0.35 * (${FADE}) + 0.05`),
      "minecraft:particle_appearance_tinting": { color: [1, 1, 1, 1] },
    }),
    arsenalParticle(PARTICLES.stim, "particles_add", {
      ...once(14),
      "minecraft:emitter_shape_box": { half_dimensions: [0.3, 0.9, 0.3], offset: [0, 0.9, 0], direction: [0, 1, 0] },
      "minecraft:particle_initial_speed": 0.3,
      "minecraft:particle_lifetime_expression": { max_lifetime: "0.7 + v.particle_random_1 * 0.4" },
      "minecraft:particle_motion_dynamic": { linear_acceleration: [0, 0.8, 0] },
      "minecraft:particle_appearance_billboard": puffs(0.07),
      "minecraft:particle_appearance_tinting": { color: [0.45, 1, 0.55, FADE] },
    }),
  ];
  return Object.fromEntries(list.map((particle) => [`resource_pack/particles/${itemFile((particle as { particle_effect: { description: { identifier: string } } }).particle_effect.description.identifier)}.json`, particle]));
}

/** The arsenal particles' soft white puff, which they tint. */
function puffTexture(): Buffer {
  const image = blankImage(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      if (distance >= 1) continue;
      image.data.set([255, 255, 255, clamp(255 * (1 - distance * distance))], (y * 16 + x) * 4);
    }
  }
  return encodePng(image);
}

// ---- The pack ----------------------------------------------------------------------------------

/** Every generated file, by path under packs/guns (the manifests are hand-written). */
export function gunsPackFiles(): Record<string, string | Buffer> {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const files: Record<string, string | Buffer> = {
    "behavior_pack/entities/paintball.json": json(projectileEntity(PAINTBALL, 0.25, 0.03, true)),
    "behavior_pack/entities/paint_grenade.json": json(projectileEntity(THROWN_GRENADE, 0.3, 0.05, false)),
    "behavior_pack/entities/paint_grenade_primed.json": json(primedGrenadeEntity()),
    "behavior_pack/entities/gun_pickup.json": json(pickupEntity()),
    "behavior_pack/entities/arsenal_thrown.json": json(projectileEntity(THROWN_ARSENAL, 0.3, 0.05, false, modelProperty)),
    "behavior_pack/entities/arsenal_primed.json": json(primedArsenalEntity()),
    "behavior_pack/entities/arsenal_pickup.json": json(arsenalPickupEntity()),
    "behavior_pack/entities/rocket.json": json(projectileEntity(ROCKET, 0.3, 0.005, false, null, true)),
    "resource_pack/models/entity/guns.geo.json": json(geometries()),
    "resource_pack/animations/guns.animation.json": json(animations()),
    "resource_pack/animation_controllers/guns.animation_controllers.json": json(holdControllers()),
    "resource_pack/render_controllers/guns.render_controllers.json": json(renderControllers()),
    "resource_pack/particles/paint_splash.json": json(splashParticle()),
    // The aim marker's icon: blank, as the off hand's slot shows it while a player aims.
    "resource_pack/textures/item_texture.json": json({
      resource_pack_name: "minecade_guns",
      texture_name: "atlas.items",
      texture_data: { [MARKER_ICON]: { textures: BLANK_TEXTURE } },
    }),
    // The model blocks' textures: the models' own.
    "resource_pack/textures/terrain_texture.json": json({
      resource_pack_name: "minecade_guns",
      texture_name: "atlas.terrain",
      padding: 8,
      num_mip_levels: 4,
      texture_data: Object.fromEntries([
        ...PICKUP_KINDS.flatMap((kind) => DYES.map((dye) => [terrainKey(kind, dye), { textures: modelTexturePath(kind, dye) }])),
        ...ARSENAL_MODELS.map((model) => [arsenalTerrainKey(model), { textures: arsenalTexturePath(model) }]),
      ]),
    }),
    [`resource_pack/${GUN_TEXTURES}/splash.png`]: splashTexture(),
    ...Object.fromEntries(Object.entries(clientEntities()).map(([path, value]) => [path, json(value)])),
  };
  files[`behavior_pack/items/${itemFile(AIM_MARKER.item)}.json`] = json(aimMarkerItem());
  files[`resource_pack/attachables/${itemFile(AIM_MARKER.item)}.json`] = json(blankAttachable());
  files[`resource_pack/${BLANK_TEXTURE}.png`] = blankTexture();
  for (const kind of PICKUP_KINDS) {
    const layers = textureLayers(MODELS[kind]);
    const samples = iconSamples(MODELS[kind], ICON_VIEW);
    for (const dye of DYES) {
      const file = itemFile(gunItem(kind, dye));
      files[`behavior_pack/items/${file}.json`] = json(item(kind, dye));
      files[`behavior_pack/blocks/${itemFile(gunModelBlock(kind, dye))}.json`] = json(modelBlock(kind, dye));
      files[`resource_pack/attachables/${file}.json`] = json(attachable(kind, dye));
      files[`resource_pack/${modelTexturePath(kind, dye)}.png`] = modelTexture(layers, dye);
      // Kit pictures' icons, beside the packs (the game draws the hotbar's from the model block).
      files[`icons/${file}.png`] = modelIcon(samples, layers, dye);
    }
  }
  for (const dye of DYES) files[`resource_pack/${GUN_TEXTURES}/balls/${dye}.png`] = ballTexture(PAINT_RGB[dye]);
  // The arsenal: one of each, no paint.
  for (const model of ARSENAL_MODELS) {
    const boxes = ARSENAL_BOXES[model];
    const layers = textureLayers(boxes);
    const file = itemFile(arsenalItem(model));
    files[`behavior_pack/items/${file}.json`] = json(arsenalItemFile(model));
    files[`behavior_pack/blocks/${itemFile(arsenalModelBlock(model))}.json`] = json(arsenalBlock(model));
    files[`resource_pack/attachables/${file}.json`] = json(attachableOf(model, arsenalItem(model), arsenalTexturePath(model)));
    files[`resource_pack/${arsenalTexturePath(model)}.png`] = modelTexture(layers, "white");
    files[`icons/${file}.png`] = modelIcon(iconSamples(boxes, ICON_VIEW), layers, "white");
  }
  files[`resource_pack/${ROCKET_TEXTURE}.png`] = modelTexture(textureLayers(ROCKET_BOXES), "white");
  files[`resource_pack/${PUFF_TEXTURE}.png`] = puffTexture();
  for (const [path, value] of Object.entries(arsenalParticles())) files[path] = json(value);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [path, content] of Object.entries(gunsPackFiles())) {
    mkdirSync(dirname(pack(path)), { recursive: true });
    writeFileSync(pack(path), content);
  }
  if (!existsSync(pack(HOLD_FILE))) {
    writeFileSync(pack(HOLD_FILE), `${JSON.stringify(holdAnimationsSeed(), null, 2)}\n`);
    console.log(`wrote ${HOLD_FILE} from the solver's poses`);
  } else {
    const { text, added } = withMissingHolds(readFileSync(pack(HOLD_FILE), "utf8"));
    if (added.length > 0) {
      writeFileSync(pack(HOLD_FILE), text);
      console.log(`added ${added.length} poses to ${HOLD_FILE} for new models, leaving the rest as they were`);
    }
  }
  console.log("wrote the guns pack's files");
}

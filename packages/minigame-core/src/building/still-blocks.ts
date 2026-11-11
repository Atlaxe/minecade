// Blocks that stay where they're put: the building games' twin of every vanilla block that falls
// (concrete powder, sand, gravel, anvils, the dragon egg), looking the same, with no gravity. A
// builder's gravity block becomes its twin the tick it's placed (it would fall two ticks later),
// and the selection commands fill with twins, so nothing in a build falls. Measured on BDS
// (docs/spike-results.md, "Block physics"): a gravity block a script puts in the air falls too,
// whether by setType, setPermutation, /setblock, fillBlocks or a structure, and so does one put
// back after its falling block entity is removed, so the twin is the only way it stays. Pure data,
// so the asset generator (tools/assets/still-blocks.ts) and tests can read it. Rerun the generator
// after changing it.

export type StillShape = "cube" | "anvil" | "egg";

export interface StillBlock {
  /** The vanilla block that falls. */
  vanilla: string;
  /** Its twin, which doesn't. */
  still: string;
  /** Its name in the game (the twin's item, if a builder picks one). */
  name: string;
  shape: StillShape;
  /** Vanilla texture paths: `all` faces, or an anvil's `side` and `top`. */
  textures: { all?: string; side?: string; top?: string };
  /** blocks.json's sound. */
  sound: string;
  /** For an anvil: the vanilla "damage" state that means this one (an older anvil keeps its damage as a state). */
  damage?: string;
}

/** The 16 dyes: id, the name in Bedrock's texture files (light gray is silver), and the name. */
const DYES: readonly (readonly [string, string, string])[] = [
  ["white", "white", "White"],
  ["orange", "orange", "Orange"],
  ["magenta", "magenta", "Magenta"],
  ["light_blue", "light_blue", "Light Blue"],
  ["yellow", "yellow", "Yellow"],
  ["lime", "lime", "Lime"],
  ["pink", "pink", "Pink"],
  ["gray", "gray", "Gray"],
  ["light_gray", "silver", "Light Gray"],
  ["cyan", "cyan", "Cyan"],
  ["purple", "purple", "Purple"],
  ["blue", "blue", "Blue"],
  ["brown", "brown", "Brown"],
  ["green", "green", "Green"],
  ["red", "red", "Red"],
  ["black", "black", "Black"],
];

const still = (id: string) => `minecade:still_${id}`;

export const STILL_BLOCKS: readonly StillBlock[] = [
  ...DYES.map(([id, texture, name]): StillBlock => ({
    vanilla: `minecraft:${id}_concrete_powder`,
    still: still(`${id}_concrete_powder`),
    name: `${name} Concrete Powder`,
    shape: "cube",
    textures: { all: `textures/blocks/concrete_powder_${texture}` },
    sound: "sand",
  })),
  { vanilla: "minecraft:sand", still: still("sand"), name: "Sand", shape: "cube", textures: { all: "textures/blocks/sand" }, sound: "sand" },
  { vanilla: "minecraft:red_sand", still: still("red_sand"), name: "Red Sand", shape: "cube", textures: { all: "textures/blocks/red_sand" }, sound: "sand" },
  { vanilla: "minecraft:gravel", still: still("gravel"), name: "Gravel", shape: "cube", textures: { all: "textures/blocks/gravel" }, sound: "gravel" },
  {
    vanilla: "minecraft:anvil",
    still: still("anvil"),
    name: "Anvil",
    shape: "anvil",
    textures: { side: "textures/blocks/anvil_base", top: "textures/blocks/anvil_top_damaged_0" },
    sound: "anvil",
    damage: "undamaged",
  },
  {
    vanilla: "minecraft:chipped_anvil",
    still: still("chipped_anvil"),
    name: "Chipped Anvil",
    shape: "anvil",
    textures: { side: "textures/blocks/anvil_base", top: "textures/blocks/anvil_top_damaged_1" },
    sound: "anvil",
    damage: "slightly_damaged",
  },
  {
    vanilla: "minecraft:damaged_anvil",
    still: still("damaged_anvil"),
    name: "Damaged Anvil",
    shape: "anvil",
    textures: { side: "textures/blocks/anvil_base", top: "textures/blocks/anvil_top_damaged_2" },
    sound: "anvil",
    damage: "very_damaged",
  },
  { vanilla: "minecraft:dragon_egg", still: still("dragon_egg"), name: "Dragon Egg", shape: "egg", textures: { all: "textures/blocks/dragon_egg" }, sound: "stone" },
];

const BY_VANILLA = new Map(STILL_BLOCKS.map((block) => [block.vanilla, block]));
const STILL_IDS = new Set(STILL_BLOCKS.map((block) => block.still));

/** The state an anvil twin turns by, as the block's own: the placement_direction trait's. */
export const ANVIL_FACING = "minecraft:cardinal_direction";
/** An older anvil's facing, 0 to 3 (south, west, north, east), and its damage, kept as states. */
const LEGACY_FACING = ["south", "west", "north", "east"] as const;

/** A block's twin for a vanilla block that falls (an anvil by its damage state, when it keeps one); undefined for any other. */
export function stillTwin(typeId: string, states: Readonly<Record<string, string | number | boolean>> = {}): StillBlock | undefined {
  if (typeId === "minecraft:anvil" && typeof states.damage === "string") return STILL_BLOCKS.find((block) => block.shape === "anvil" && block.damage === states.damage) ?? BY_VANILLA.get(typeId);
  return BY_VANILLA.get(typeId);
}

/** Whether a block is one of the twins. */
export function isStill(typeId: string): boolean {
  return STILL_IDS.has(typeId);
}

/** A twin's states from its vanilla block's: an anvil's facing (cardinal, or an older anvil's number); none for the rest. */
export function stillStates(twin: StillBlock, states: Readonly<Record<string, string | number | boolean>>): Record<string, string> {
  if (twin.shape !== "anvil") return {};
  const cardinal = states[ANVIL_FACING];
  if (typeof cardinal === "string") return { [ANVIL_FACING]: cardinal };
  const legacy = states.direction;
  return { [ANVIL_FACING]: typeof legacy === "number" ? (LEGACY_FACING[legacy & 3] ?? "south") : "south" };
}

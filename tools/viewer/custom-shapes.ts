// The shapes of the blocks pack's custom blocks (packs\blocks), for the map viewer's page
// (shapes.ts draws them): each look's collision boxes, else its selection box, else a cube, and a
// plant for no collision at all, with the permutations its states pick and their quarter turns
// (minecraft:transformation turns the boxes with the geometry). Bedrock's block coordinates mirror
// x (docs/spike-results.md, "Painted shapes"), so a box at origin x 5 to 8 is x 0 to 3 here. Read
// only for the looks a map uses, from the pack's files, which never go to git or the page whole.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { lookKey, type Box16, type CustomShape } from "../control-panel/viewer/shapes.ts";
import { readPackJson } from "./looks.ts";
import { decodeView, type ViewLook } from "./view-format.ts";

type Components = Record<string, unknown>;

export interface BlockDefinition {
  components: Components;
  permutations: { condition: string; components: Components }[];
}

type BedrockBox = { origin?: number[]; size?: number[] };

let index: { key: string; blocks: Map<string, BlockDefinition> } | undefined;

/** Every custom block's definition by its name, read once and again when the pack changes. */
export function blockDefinitions(blocksPack: string): Map<string, BlockDefinition> {
  const dir = join(blocksPack, "behavior_pack", "blocks");
  if (!existsSync(dir)) return new Map();
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  const manifest = join(blocksPack, "behavior_pack", "manifest.json");
  const key = `${dir} ${files.length} ${existsSync(manifest) ? statSync(manifest).mtimeMs : 0}`;
  if (index?.key === key) return index.blocks;
  const blocks = new Map<string, BlockDefinition>();
  for (const file of files) {
    try {
      const block = (readPackJson(join(dir, file)) as { "minecraft:block"?: { description?: { identifier?: string }; components?: Components; permutations?: BlockDefinition["permutations"] } })["minecraft:block"];
      const name = block?.description?.identifier;
      if (name) blocks.set(name, { components: block.components ?? {}, permutations: block.permutations ?? [] });
    } catch {
      // A file that doesn't read is a block drawn as a cube.
    }
  }
  index = { key, blocks };
  return blocks;
}

/** One term of a permutation's condition: q.block_state('name') == 'value' (or !=, a number, true or false). */
const TERM = /^q(?:uery)?\.block_state\(\s*'([^']+)'\s*\)\s*(==|!=)\s*(?:'([^']*)'|(-?[\d.]+)|(true|false))$/;

/** Whether a permutation's condition holds for a block's states: terms joined by && and ||; anything else doesn't. */
export function conditionHolds(condition: string, states: Record<string, string | number>): boolean {
  return condition.split("||").some((either) =>
    either.split("&&").every((part) => {
      const match = TERM.exec(part.trim().replace(/^\(+/, "").replace(/\)+$/, "").trim());
      if (!match) return false;
      const [, name, operator, text, number, bool] = match;
      const expected = text ?? number ?? bool;
      const actual = states[name];
      const same = String(actual) === expected || (expected === "true" && actual === 1) || (expected === "false" && actual === 0);
      return operator === "==" ? same : !same;
    }),
  );
}

/** A Bedrock box (origin from the block's bottom middle, x mirrored) in sixteenths, x east, kept inside the block. */
function fromBedrock(box: BedrockBox): Box16 {
  const [ox, oy, oz] = box.origin ?? [-8, 0, -8];
  const [sx, sy, sz] = box.size ?? [16, 16, 16];
  const clamp = (value: number) => Math.max(0, Math.min(16, Math.round(value)));
  return [clamp(8 - (ox + sx)), clamp(oy), clamp(oz + 8), clamp(8 - ox), clamp(oy + sy), clamp(oz + sz + 8)];
}

/**
 * A box turned by a transformation's rotation (degrees, quarter turns): Bedrock turns about x
 * first, then y. In this frame (x not mirrored) that's Java's blockstate rotation x then -y: a
 * quarter turn about x takes the top to the north, one about y turns the block clockwise seen from
 * above.
 */
export function turnBox(box: Box16, rotation: number[]): Box16 {
  let [x0, y0, z0, x1, y1, z1] = box;
  const quarters = (degrees: number) => ((Math.round(degrees / 90) % 4) + 4) % 4;
  for (let n = quarters(rotation[0] ?? 0); n > 0; n--) [y0, z0, y1, z1] = [z0, 16 - y1, z1, 16 - y0];
  for (let n = quarters(-(rotation[1] ?? 0)); n > 0; n--) [x0, z0, x1, z1] = [16 - z1, x0, 16 - z0, x1];
  return [x0, y0, z0, x1, y1, z1];
}

/** How a custom block with these states is drawn. */
export function customShape(definition: BlockDefinition, states: Record<string, string | number>): CustomShape {
  const merged: Components = { ...definition.components };
  // Later permutations override earlier ones, as the game applies them.
  for (const permutation of definition.permutations) if (conditionHolds(permutation.condition, states)) Object.assign(merged, permutation.components);
  const instances = (merged["minecraft:material_instances"] ?? {}) as Record<string, unknown>;
  const seeThrough = Object.values(instances).some((instance) => typeof instance === "object" && instance !== null && (instance as { render_method?: string }).render_method === "blend");
  const extra = seeThrough ? { seeThrough: true } : {};
  const collision = merged["minecraft:collision_box"];
  const selection = merged["minecraft:selection_box"];
  if (collision === false) return { plant: true, ...extra };
  const given = collision !== undefined && collision !== true ? collision : selection !== undefined && typeof selection === "object" ? selection : undefined;
  if (!given) return { cube: true, ...extra };
  const rotation = ((merged["minecraft:transformation"] as { rotation?: number[] } | undefined)?.rotation ?? [0, 0, 0]).map(Number);
  const boxes = (Array.isArray(given) ? (given as BedrockBox[]) : [given as BedrockBox]).map((box) => turnBox(fromBedrock(box), rotation));
  return { boxes, ...extra };
}

/** The custom shapes of a set of looks (the custom blocks among them), by lookKey. */
export function customShapes(looks: ViewLook[], blocksPack: string): Record<string, CustomShape> {
  const out: Record<string, CustomShape> = {};
  const custom = looks.filter((look) => !look.name.startsWith("minecraft:"));
  if (custom.length === 0) return out;
  const blocks = blockDefinitions(blocksPack);
  for (const look of custom) {
    const definition = blocks.get(look.name);
    if (definition) out[lookKey(look)] = customShape(definition, look.states ?? {});
  }
  return out;
}

/** The custom shapes of a map's view file (gzipped), by lookKey. */
export function viewShapes(gzipped: Buffer, blocksPack: string): Record<string, CustomShape> {
  const view = decodeView(new Uint8Array(gunzipSync(gzipped)));
  return customShapes(view.looks, blocksPack);
}

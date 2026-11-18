// Block Party's items, from games/blockparty/items.json (the user asked for the items' config and
// textures in one file, like the dice's; docs/plans/block-party.md, "The items file"). What each item
// does is code (item-play.ts), so the file can't add one: it has an entry for each of ITEM_IDS, and
// says for each:
//   - name, and letters: one or two capitals (and digits) naming it on the screens, and its icon's
//     file name (ICON_FOLDER/<letters>), which the cards and the item panel show by its letters;
//   - texture: its icon's picture, a path in Block Party's pack or Minecraft's own
//     ("textures/items/totem"). The build copies it to its icon's place (tools/blockparty/item-icons.ts);
//   - description: what it does, under its name in the item panel;
//   - value: what the Shop works from (it pays half to buy it back).
// Pure (no Minecraft), so the tests and the build read it too.
import file from "../../items.json";

/** Every item the game knows how to use, in the menu's order when the file doesn't say. */
export const ITEM_IDS = ["stone_totem", "golden_totem", "ender_pearl", "cursed_totem", "glove", "lightning", "zombie", "iron_golem", "villager"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export interface ItemDef {
  id: ItemId;
  name: string;
  letters: string;
  /** Its icon's picture (a pack path, no .png), if it has one. */
  texture?: string;
  description: string;
  value: number;
}

/** Where the build puts each item's icon, by its letters: the screens' pictures read `<ICON_FOLDER>/{{row.item1}}`. */
export const ICON_FOLDER = "textures/blockparty/icons";

/** An item's icon in the pack (no .png). */
export function iconPath(item: Pick<ItemDef, "letters">): string {
  return `${ICON_FOLDER}/${item.letters}`;
}

/** The items in an items file, and what's wrong with it (each problem in words; an item with one is left out). */
export function readItems(raw: unknown): { items: ItemDef[]; problems: string[] } {
  const problems: string[] = [];
  const items: ItemDef[] = [];
  const list = (raw as { items?: unknown } | undefined)?.items;
  if (!list || typeof list !== "object" || Array.isArray(list)) return { items, problems: ['the file needs "items": { "<id>": { ... } }'] };
  for (const [id, value] of Object.entries(list as Record<string, unknown>)) {
    const before = problems.length;
    const item = readItem(id, value, (problem) => problems.push(`${id}: ${problem}`));
    if (item && problems.length === before) items.push(item);
  }
  const ids = Object.keys(list);
  for (const id of ITEM_IDS) if (!ids.includes(id)) problems.push(`${id}: missing (the game has this item, so the file needs an entry for it)`);
  const seen = new Map<string, string>();
  for (const item of items) {
    const other = seen.get(item.letters);
    if (other) problems.push(`${item.id}: "letters" ${item.letters} are ${other}'s too (they name its icon, so each item needs its own)`);
    else seen.set(item.letters, item.id);
  }
  return { items, problems };
}

function readItem(id: string, entry: unknown, problem: (text: string) => void): ItemDef | undefined {
  if (!(ITEM_IDS as readonly string[]).includes(id)) {
    problem(`the game has no item by this id (what an item does is code; the items are ${ITEM_IDS.join(", ")})`);
    return undefined;
  }
  if (!entry || typeof entry !== "object") {
    problem("each item is an object");
    return undefined;
  }
  const item = entry as Record<string, unknown>;
  const text = (key: string): string => {
    const got = item[key];
    if (typeof got !== "string" || got === "") problem(`"${key}" must be some text`);
    return typeof got === "string" ? got : "";
  };
  const name = text("name");
  const letters = text("letters");
  if (!/^[A-Z][A-Z0-9]?$/.test(letters)) problem('"letters" must be one or two capitals (a digit can be the second)');
  const texture = item.texture === undefined || item.texture === "" ? undefined : text("texture");
  if (texture !== undefined && (!/^textures\/[\w/.-]+$/.test(texture) || texture.endsWith(".png"))) problem('"texture" is a path in a pack, like "textures/items/totem" or "textures/blockparty/items/stone_totem" (no .png)');
  const description = text("description");
  const value = item.value ?? 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 999) problem('"value" must be a whole number from 1 to 999');
  return { id: id as ItemId, name, letters, ...(texture !== undefined ? { texture } : {}), description, value: typeof value === "number" ? value : 0 };
}

const read = readItems(file);
/** What's wrong with items.json (the game logs it; the tests fail on it). */
export const ITEM_PROBLEMS: readonly string[] = read.problems;
const IN_FILE = new Map(read.items.map((item) => [item.id, item]));

/** Whether an item is in the file without problems (one that isn't never comes up). */
export function itemInFile(id: ItemId): boolean {
  return IN_FILE.has(id);
}

/** Every item by id, the file's first and in its order; one it lacks stands in with its id for a name. */
export const ITEMS: Readonly<Record<ItemId, ItemDef>> = Object.fromEntries([
  ...read.items.map((item) => [item.id, item] as const),
  ...ITEM_IDS.filter((id) => !IN_FILE.has(id)).map((id) => [id, { id, name: id, letters: "?", description: "", value: 1 }] as const),
]) as Record<ItemId, ItemDef>;

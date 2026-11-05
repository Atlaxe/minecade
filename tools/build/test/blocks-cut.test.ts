import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cutBlocksPack } from "../blocks-cut.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, files: Record<string, unknown>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
}

const block = (id: string, components: Record<string, unknown>) => ({ format_version: "1.26.0", "minecraft:block": { description: { identifier: `minecade:${id}` }, components } });
const look = (geometry: string, texture: string, extra: Record<string, unknown> = {}) => ({
  "minecraft:geometry": { identifier: `geometry.minecade.${geometry}`, culling: `minecade:culling.${geometry}` },
  "minecraft:material_instances": { "*": { texture } },
  ...extra,
});
const geometry = (id: string) => ({ format_version: "1.21.0", "minecraft:geometry": [{ description: { identifier: `geometry.minecade.${id}` }, bones: [] }] });
const culling = (id: string) => ({ format_version: "1.21.0", "minecraft:block_culling_rules": { description: { identifier: `minecade:culling.${id}` }, rules: [] } });
const item = (id: string, icon: string) => ({
  format_version: "1.26.0",
  "minecraft:item": { description: { identifier: `minecade:${id}` }, components: { "minecraft:icon": { textures: { default: icon } }, "minecraft:block_placer": { block: `minecade:${id}` } } },
});
const manifest = (uuid: string, module: string) => ({ format_version: 2, header: { name: "Minecade Blocks", uuid, version: [1, 0, 1] }, modules: [{ type: "data", uuid: module, version: [1, 0, 1] }] });

/** A small blocks pack: chairs (one dropping a cushion), a lamp and its pole, a torch and its wall variant, and a block no map uses. */
function pack(): string {
  const root = mkdtempSync(join(tmpdir(), "minecade-blocks-"));
  dirs.push(root);
  write(join(root, "behavior_pack"), {
    "manifest.json": manifest("3af7ac90-0996-50ca-b782-9a1d0b315193", "00ef757e-869e-5091-a36b-36099840f764"),
    "blocks/oak_chair.json": block("oak_chair", look("chair", "oak", { "minecraft:loot": "loot_tables/blocks/minecade/oak_chair.json" })),
    "blocks/cushion.json": block("cushion", look("cushion", "wool")),
    "blocks/red_lamp.json": block("red_lamp", look("lamp", "red")),
    "blocks/red_lamp_connector.json": block("red_lamp_connector", look("pole", "red")),
    "blocks/torch.json": block("torch", look("torch", "flame")),
    "blocks/wall_torch.json": block("wall_torch", look("wall_torch", "flame")),
    "blocks/unused.json": block("unused", look("unused", "gold")),
    "items/oak_chair.json": item("oak_chair", "icon_chair"),
    "items/unused.json": item("unused", "icon_unused"),
    "loot_tables/blocks/minecade/oak_chair.json": { pools: [{ rolls: 1, entries: [{ type: "item", name: "minecade:cushion" }] }] },
    "loot_tables/blocks/minecade/unused.json": { pools: [] },
    "item_catalog/crafting_item_catalog.json": {
      "minecraft:crafting_items_catalog": {
        categories: [
          {
            category_name: "construction",
            groups: [
              { group_identifier: { icon: "minecade:unused", name: "chairs" }, items: ["minecade:unused", "minecade:oak_chair"] },
              { group_identifier: { icon: "minecade:unused", name: "gold" }, items: ["minecade:unused"] },
            ],
          },
        ],
      },
    },
    "entities/seat.json": { "minecraft:entity": {} },
    "scripts/main.js": "import { BLOCKS } from './data.js';",
    "scripts/data.js": `// Generated.\nexport const BLOCKS = ${JSON.stringify({ "minecade:torch": { k: "torch", w: "minecade:wall_torch" } })};\nexport const SIDE_TABLES = [];\n`,
  });
  const textures = ["oak", "wool", "red", "flame", "gold"];
  write(join(root, "resource_pack"), {
    "manifest.json": manifest("9c90fe30-8668-514d-935a-5b9a1a928c04", "866dde41-26c3-5e3b-a541-cd84e3c81c5f"),
    ...Object.fromEntries(["chair", "cushion", "lamp", "pole", "torch", "wall_torch", "unused"].flatMap((id) => [
      [`models/blocks/minecade/${id}.geo.json`, geometry(id)],
      [`block_culling/${id}.json`, culling(id)],
    ])),
    ...Object.fromEntries(textures.map((name) => [`textures/minecade/block/${name}.png`, name])),
    "textures/minecade/item/icon_chair.png": "icon",
    "textures/minecade/item/icon_unused.png": "icon",
    "textures/terrain_texture.json": { texture_name: "atlas.terrain", texture_data: Object.fromEntries(textures.map((name) => [name, { textures: `textures/minecade/block/${name}` }])) },
    "textures/item_texture.json": { texture_name: "atlas.items", texture_data: { icon_chair: { textures: "textures/minecade/item/icon_chair" }, icon_unused: { textures: "textures/minecade/item/icon_unused" } } },
    "textures/flipbook_textures.json": [{ flipbook_texture: "textures/minecade/block/flame", atlas_tile: "flame" }, { flipbook_texture: "textures/minecade/block/gold", atlas_tile: "gold" }],
    "blocks.json": { format_version: [1, 1, 0], "minecade:oak_chair": { sound: "wood" }, "minecade:unused": { sound: "metal" } },
    "texts/en_US.lang": "tile.minecade:unused.name=Unused\n",
  });
  return root;
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("cutBlocksPack", () => {
  it("keeps the blocks named, what they turn into, and the files and entries they name", async () => {
    const src = pack();
    const out = join(src, "cut");
    // A map's world names its blocks, their states and an entity too.
    expect(await cutBlocksPack(src, out, ["minecade:oak_chair", "minecade:red_lamp", "minecade:torch", "minecade:facing", "minecade:seat"])).toEqual({ kept: 6, of: 7 });
    const bp = join(out, "behavior_pack");
    const rp = join(out, "resource_pack");
    for (const id of ["oak_chair", "cushion", "red_lamp", "red_lamp_connector", "torch", "wall_torch"]) expect(existsSync(join(bp, "blocks", `${id}.json`))).toBe(true);
    expect(existsSync(join(bp, "blocks", "unused.json"))).toBe(false);
    expect(existsSync(join(bp, "items", "oak_chair.json"))).toBe(true);
    expect(existsSync(join(bp, "items", "unused.json"))).toBe(false);
    expect(existsSync(join(bp, "loot_tables", "blocks", "minecade", "oak_chair.json"))).toBe(true);
    expect(existsSync(join(bp, "loot_tables", "blocks", "minecade", "unused.json"))).toBe(false);
    // The script, its table and the entities stay whole.
    for (const file of ["scripts/main.js", "scripts/data.js", "entities/seat.json"]) expect(existsSync(join(bp, file))).toBe(true);
    expect(existsSync(join(rp, "models", "blocks", "minecade", "pole.geo.json"))).toBe(true);
    expect(existsSync(join(rp, "models", "blocks", "minecade", "unused.geo.json"))).toBe(false);
    expect(existsSync(join(rp, "block_culling", "wall_torch.json"))).toBe(true);
    expect(existsSync(join(rp, "block_culling", "unused.json"))).toBe(false);
    expect(existsSync(join(rp, "textures", "minecade", "block", "gold.png"))).toBe(false);
    expect(existsSync(join(rp, "textures", "minecade", "item", "icon_chair.png"))).toBe(true);
    expect(existsSync(join(rp, "textures", "minecade", "item", "icon_unused.png"))).toBe(false);
    expect(existsSync(join(rp, "texts", "en_US.lang"))).toBe(true);
    // The lists keep just those blocks' entries.
    expect(Object.keys(json(join(rp, "textures", "terrain_texture.json")).texture_data).sort()).toEqual(["flame", "oak", "red", "wool"]);
    expect(Object.keys(json(join(rp, "textures", "item_texture.json")).texture_data)).toEqual(["icon_chair"]);
    expect(json(join(rp, "textures", "flipbook_textures.json"))).toEqual([{ flipbook_texture: "textures/minecade/block/flame", atlas_tile: "flame" }]);
    expect(json(join(rp, "blocks.json"))).toEqual({ format_version: [1, 1, 0], "minecade:oak_chair": { sound: "wood" } });
    const groups = json(join(bp, "item_catalog", "crafting_item_catalog.json"))["minecraft:crafting_items_catalog"].categories[0].groups;
    expect(groups).toEqual([{ group_identifier: { icon: "minecade:oak_chair", name: "chairs" }, items: ["minecade:oak_chair"] }]);
  });

  it("gives the cut packs uuids of their own, the same every time", async () => {
    const src = pack();
    await cutBlocksPack(src, join(src, "one"), ["minecade:oak_chair"]);
    await cutBlocksPack(src, join(src, "two"), ["minecade:torch"]);
    const one = json(join(src, "one", "behavior_pack", "manifest.json"));
    const two = json(join(src, "two", "behavior_pack", "manifest.json"));
    expect(one.header.uuid).not.toBe("3af7ac90-0996-50ca-b782-9a1d0b315193");
    expect(one.header.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(one.header.uuid).toBe(two.header.uuid);
    expect(one.modules[0].uuid).not.toBe("00ef757e-869e-5091-a36b-36099840f764");
    expect(json(join(src, "one", "resource_pack", "manifest.json")).header.uuid).not.toBe(one.header.uuid);
  });
});

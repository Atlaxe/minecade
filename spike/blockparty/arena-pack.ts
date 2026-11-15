// Installs published maps' arenas into Block Party's private arenas pack, for the spike's Arenas
// test: each map's box around its bounds becomes a .mcstructure file (mcstructure.ts, read from the
// map store with no server) named minecade:arena_<game>_<map>, in
// games/blockparty/private_packs/arenas/behavior_pack/structures/minecade/ (git-ignored: maps aren't
// in git). The build ships the pack with Block Party's server; Start the network again after.
// Until the game marks arenas of its own (the plan's "Minigame arena maps"), any game's map stands in.
//   npx tsx spike/blockparty/arena-pack.ts [<game>/<map> ...]     (default: a few small ones)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../../tools/maps/paths.ts";
import { worldToStructure } from "./mcstructure.ts";
import { publishedMap } from "./published.ts";

const DEFAULTS = ["sumo/sinkhole", "sumo/sewer", "gunfight/kgb", "buildswap/roman"];
const PACK = join(repoRoot, "games", "blockparty", "private_packs", "arenas", "behavior_pack");

const MANIFEST = {
  format_version: 2,
  header: {
    name: "Block Party arenas (private)",
    description: "Published maps' arenas as structures, for the Block Party spike (spike/blockparty/arena-pack.ts)",
    uuid: "c40df225-0d2e-46b2-abbc-dd39502a5331",
    version: [1, 0, 0],
    min_engine_version: [1, 26, 60],
  },
  modules: [{ type: "data", uuid: "aa8bafc6-dfe8-4373-83a9-9c2e6300827c", version: [1, 0, 0] }],
};

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const maps = wanted.length > 0 ? wanted : DEFAULTS;
  const structures = join(PACK, "structures", "minecade");
  await rm(structures, { recursive: true, force: true });
  await mkdir(structures, { recursive: true });
  await writeFile(join(PACK, "manifest.json"), JSON.stringify(MANIFEST, null, 2) + "\n");
  for (const spec of maps) {
    const [game, map] = spec.split("/");
    if (!game || !map) throw new Error(`"${spec}": name maps as <game>/<map>`);
    const source = publishedMap(game, map);
    const { file, stats } = worldToStructure(source.world, source.box);
    const id = `arena_${game}_${map}`;
    await writeFile(join(structures, `${id}.mcstructure`), file);
    console.log(`minecade:${id}: ${stats.size.join(" x ")}, ${stats.blocks} blocks, ${stats.blockEntities} block entities, ${(file.length / 1e6).toFixed(1)} MB`);
  }
  console.log(`Installed in ${PACK}. Start the network again (the Panel's Start) to put them on Block Party's server.`);
}

await main();

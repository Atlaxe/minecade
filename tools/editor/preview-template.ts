// A Preview's server template: one game, with only the map open in Edit, built from this checkout
// the way npm run build builds a game (template.ts does the same for the editor's own servers).
// It adds a small resource pack holding the editor's mode box (editor/resource_pack/ui/
// hud_screen.json), so "Preview" shows top center there too. Drafts are fine: a preview is how a
// map gets checked before it's published.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { enableBetaApis, patchLevelDat } from "../build/leveldat.ts";
import { addSharedPacks, buildBehaviorPack, buildResourcePack, readPinnedManifest, sharedPacks } from "../build/packs.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The preview HUD pack's ids, fixed so a client keeps its cached copy between previews. */
const HUD_PACK = { header: "5d7c2e1a-9b4f-4a63-8e2d-1f6b3c9a7e40", module: "c8a41f3e-2d7b-4e95-b061-7f3e9d2c5a18" };

export interface PreviewMap {
  /** The game's id (games/<id>/). */
  game: string;
  mapId: string;
  /** The map's folder (its world/ is copied). */
  mapDir: string;
  config: MapConfig;
}

/** Builds the template into `out` (a server's templates/servers/<game>/). */
export async function buildPreviewTemplate(map: PreviewMap, out: string): Promise<void> {
  const gameDir = join(root, "games", map.game);
  const bp = join(gameDir, "behavior_pack");
  // A game's pack reads neither the registry nor the skins.
  await buildBehaviorPack(bp, join(out, "behavior_packs", `${map.game}_bp`), await readPinnedManifest(bp), { games: [] }, []);
  const shared = [];
  for (const pack of await sharedPacks()) shared.push({ pack, manifest: await readPinnedManifest(pack.dir) });
  await addSharedPacks(out, shared);
  const rp = join(gameDir, "resource_pack");
  if (existsSync(join(rp, "manifest.json"))) await buildResourcePack(rp, join(out, "resource_packs", `${map.game}_rp`), await readPinnedManifest(rp));
  await buildHudPack(join(out, "resource_packs", "preview_hud"));

  const mapOut = join(out, "maps", map.mapId);
  await cp(join(map.mapDir, "world"), join(mapOut, "world"), { recursive: true });
  // Worlds built by hand in the client usually lack Beta APIs, which every pack needs.
  await patchLevelDat(join(mapOut, "world", "level.dat"), enableBetaApis);
  await writeFile(join(mapOut, "map.json"), JSON.stringify(runtimeMapConfig(map.config), null, 2));
}

/** The editor's mode box override, alone in a pack of its own. */
async function buildHudPack(out: string): Promise<void> {
  const editorRp = join(root, "editor", "resource_pack");
  const manifest = await readPinnedManifest(editorRp);
  Object.assign(manifest.header, { name: "Minecade preview HUD", description: "The mode box top center", uuid: HUD_PACK.header });
  manifest.modules = manifest.modules.map((module) => ({ ...module, uuid: HUD_PACK.module }));
  const src = await mkdtemp(join(tmpdir(), "minecade-preview-hud-"));
  try {
    await mkdir(join(src, "ui"), { recursive: true });
    await cp(join(editorRp, "ui", "hud_screen.json"), join(src, "ui", "hud_screen.json"));
    await buildResourcePack(src, out, manifest);
  } finally {
    await rm(src, { recursive: true, force: true });
  }
}

// A Preview's server template: one game, with only the map open in Edit, built from this checkout
// the way npm run build builds a game (template.ts does the same for the editor's own servers).
// It adds the preview's own packs (editor/preview/): the fake players (/fake), and a resource pack
// that also carries the editor's mode box (editor/resource_pack/ui/hud_screen.json, so "Preview"
// shows top center) and its side panel forms (the fake player's panel). Drafts are fine: a
// preview is how a map gets checked before it's published.
import { existsSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeMapConfig, type GameConfig, type MapConfig } from "@minecade/minigame-core/config";
import { addGameKitPictures } from "../build/kit-pictures.ts";
import { enableBetaApis, patchLevelDat } from "../build/leveldat.ts";
import { addSharedPacks, buildBehaviorPack, buildResourcePack, readPinnedManifest, sharedPacks } from "../build/packs.ts";
import { addFakeSkins } from "./fake-player.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** What the preview's resource pack takes from the editor's: the mode box, the side panel forms and their art. */
const EDITOR_UI = ["ui/_ui_defs.json", "ui/hud_screen.json", "ui/server_form.json", "ui/editor_forms.json", "textures/minecade/editor"];

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
  if (existsSync(join(rp, "manifest.json"))) {
    // With the kit form's pictures, for a game whose players pick kits.
    const game = (await import(pathToFileURL(join(gameDir, "game.config.ts")).href)).default as GameConfig;
    await buildResourcePack(rp, join(out, "resource_packs", `${map.game}_rp`), await readPinnedManifest(rp), async (pack) => {
      await addGameKitPictures(pack, game, [{ id: map.mapId, config: map.config }]);
    });
  }
  await buildPreviewPacks(out);

  const mapOut = join(out, "maps", map.mapId);
  await cp(join(map.mapDir, "world"), join(mapOut, "world"), { recursive: true });
  // Worlds built by hand in the client usually lack Beta APIs, which every pack needs.
  await patchLevelDat(join(mapOut, "world", "level.dat"), enableBetaApis);
  await writeFile(join(mapOut, "map.json"), JSON.stringify(runtimeMapConfig(map.config), null, 2));
}

/** editor/preview/'s packs: the fake player's entity, and its look (Minecraft's skins copied in) with the editor's UI added. */
async function buildPreviewPacks(out: string): Promise<void> {
  const bp = join(root, "editor", "preview", "behavior_pack");
  const bpOut = join(out, "behavior_packs", "preview_bp");
  await cp(bp, bpOut, { recursive: true, filter: (path) => path !== join(bp, "manifest.json") });
  await writeFile(join(bpOut, "manifest.json"), JSON.stringify(await readPinnedManifest(bp), null, 2));
  const rp = join(root, "editor", "preview", "resource_pack");
  const editorRp = join(root, "editor", "resource_pack");
  await buildResourcePack(rp, join(out, "resource_packs", "preview_rp"), await readPinnedManifest(rp), async (pack) => {
    for (const path of EDITOR_UI) await cp(join(editorRp, path), join(pack, path), { recursive: true });
    await addFakeSkins(pack);
  });
}

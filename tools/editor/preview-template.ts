// A Preview's server template: one game, with only the map open in Edit, built from this checkout
// the way npm run build builds a game (template.ts does the same for the editor's own servers).
// It adds the preview's own packs (editor/preview/): the fake players (/fake), and a resource pack
// that also carries the editor's mode box (editor/resource_pack/ui/hud_screen.json, so "Preview"
// shows top center) and its side panel forms (the fake player's panel). Drafts are fine: a
// preview is how a map gets checked before it's published. A map whose mannequins show in its
// previews (Edit's Mannequin tool) gets them in its map.json as previewMannequins, each look worked
// out for the preview's pack (which gets the players' skins for them).
import { existsSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FAKE_COLORS,
  FAKE_SKINS,
  kitItemId,
  lookFromIds,
  lookProperties,
  runtimeMapConfig,
  type FakeSkin,
  type GameConfig,
  type MapConfig,
  type MapMannequin,
  type PreviewMannequin,
} from "@minecade/minigame-core/config";
import { addGameKitPictures } from "../build/kit-pictures.ts";
import { enableBetaApis, patchLevelDat } from "../build/leveldat.ts";
import { buildBehaviorPack, buildResourcePack, readPinnedManifest, writePackLists } from "../build/packs.ts";
import { EDITOR_SHARED } from "./editor-image.ts";
import { addFakeSkins, addPlayerSkins, mannequinSkins, type MannequinSkin } from "./fake-player.ts";

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
  const rp = join(gameDir, "resource_pack");
  if (existsSync(join(rp, "manifest.json"))) {
    // With the kit form's pictures, for a game whose players pick kits.
    const game = (await import(pathToFileURL(join(gameDir, "game.config.ts")).href)).default as GameConfig;
    await buildResourcePack(rp, join(out, "resource_packs", `${map.game}_rp`), await readPinnedManifest(rp), async (pack) => {
      await addGameKitPictures(pack, game, [{ id: map.mapId, config: map.config }]);
    });
  }
  const players = map.config.mannequinsInPreview === true ? await mannequinSkins() : [];
  await buildPreviewPacks(out, players);
  // The shared packs are the editor image's (editor-image.ts).
  await writePackLists(out, EDITOR_SHARED);

  const mapOut = join(out, "maps", map.mapId);
  await cp(join(map.mapDir, "world"), join(mapOut, "world"), { recursive: true });
  // Worlds built by hand in the client usually lack Beta APIs, which every pack needs.
  await patchLevelDat(join(mapOut, "world", "level.dat"), enableBetaApis);
  const runtime = runtimeMapConfig(map.config);
  const mannequins = map.config.mannequinsInPreview === true ? previewMannequins(map.config, players) : [];
  if (mannequins.length > 0) runtime.previewMannequins = mannequins;
  await writeFile(join(mapOut, "map.json"), JSON.stringify(runtime, null, 2));
}

/**
 * The map's mannequins as a preview's server stands them (minigame-core preview-mannequins.ts): the
 * skin by its place in the preview pack's list (the fake player's own, then `players`), the plain
 * color's tint, the pose, and the item in hand in the plain color's dye.
 */
export function previewMannequins(config: MapConfig, players: MannequinSkin[]): PreviewMannequin[] {
  const skins: FakeSkin[] = [...FAKE_SKINS, ...players.map(({ skin }) => ({ id: skin.key, label: skin.name, slim: skin.slim === true }))];
  const mannequins = Object.values(config.mannequins ?? {}).filter((mannequin): mannequin is MapMannequin => Array.isArray(mannequin?.at) && mannequin.at.length === 4);
  return mannequins.map((mannequin) => {
    const look = lookFromIds(mannequin, skins);
    const { skin, tint, pose } = lookProperties(look, skins);
    const dye = skins[skin]?.id === "color" ? (FAKE_COLORS[look.color] ?? FAKE_COLORS[0]).code : undefined;
    return { at: mannequin.at, skin, tint, pose, ...(look.hold ? { hold: kitItemId({ item: look.hold }, dye) } : {}) };
  });
}

/** editor/preview/'s packs: the fake player's entity, and its look (Minecraft's skins and `players` copied in) with the editor's UI added. */
async function buildPreviewPacks(out: string, players: MannequinSkin[]): Promise<void> {
  const bp = join(root, "editor", "preview", "behavior_pack");
  const bpOut = join(out, "behavior_packs", "preview_bp");
  await cp(bp, bpOut, { recursive: true, filter: (path) => path !== join(bp, "manifest.json") });
  await writeFile(join(bpOut, "manifest.json"), JSON.stringify(await readPinnedManifest(bp), null, 2));
  const rp = join(root, "editor", "preview", "resource_pack");
  const editorRp = join(root, "editor", "resource_pack");
  await buildResourcePack(rp, join(out, "resource_packs", "preview_rp"), await readPinnedManifest(rp), async (pack) => {
    for (const path of EDITOR_UI) await cp(join(editorRp, path), join(pack, path), { recursive: true });
    await addFakeSkins(pack);
    await addPlayerSkins(bpOut, pack, players);
  });
}

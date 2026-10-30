// The editor server's template (editor/'s packs and the shared packs), built fresh at every start
// so the editor always runs the code checked out here, whatever the network's images hold. Unlike
// npm run build, it doesn't check the maps: a map being fixed may well have problems.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { addSharedPacks, buildBehaviorPack, buildResourcePack, readPinnedManifest, sharedPacks } from "../build/packs.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function buildEditorTemplate(out: string): Promise<void> {
  const editor = join(root, "editor");
  const bp = join(editor, "behavior_pack");
  // The editor pack reads neither the registry nor the skins.
  await buildBehaviorPack(bp, join(out, "behavior_packs", "editor_bp"), await readPinnedManifest(bp), { games: [] }, []);
  const shared = [];
  for (const pack of await sharedPacks()) shared.push({ pack, manifest: await readPinnedManifest(pack.dir) });
  await addSharedPacks(out, shared);
  const rp = join(editor, "resource_pack");
  await buildResourcePack(rp, join(out, "resource_packs", "editor_rp"), await readPinnedManifest(rp));
}

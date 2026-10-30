// npm run skins: renders every skin the watcher saved (skins/<xuid>/) into the same folder, to look
// at without deploying: skin.png (the skin itself), holo.png, portrait.png and head.png (as the
// lobby uses them, see skin-set.ts).
// npm run skins -- <skin.png> [slim]: renders one skin file instead, next to it.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.ts";
import { RENDERS, renderSkinSet } from "./skin-set.ts";
import { readSkins, type StoredSkin } from "./store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [file, arms] = process.argv.slice(2);

if (file) {
  const image = decodePng(await readFile(file));
  const skin: StoredSkin = {
    meta: { xuid: "file", name: file, width: image.width, height: image.height, armSize: arms === "slim" ? "slim" : "wide", hash: "", updatedAt: "" },
    image,
  };
  const renders = renderSkinSet(skin);
  for (const kind of RENDERS) await writeFile(file.replace(/\.png$/i, `.${kind}.png`), encodePng(renders[kind]));
  console.log(`rendered ${file}`);
} else {
  const dir = join(root, "skins");
  const skins = await readSkins(dir);
  for (const skin of skins) {
    const folder = join(dir, skin.meta.xuid);
    await writeFile(join(folder, "skin.png"), encodePng(skin.image));
    const renders = renderSkinSet(skin);
    for (const kind of RENDERS) await writeFile(join(folder, `${kind}.png`), encodePng(renders[kind]));
    console.log(`rendered ${skin.meta.name} (${skin.meta.xuid})${skin.meta.persona ? ", character creator" : ""}`);
  }
  if (skins.length === 0) console.log(`no skins in ${dir} yet: the watcher saves them as players join`);
}

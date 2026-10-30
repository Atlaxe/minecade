// npm run skins: renders every skin the watcher saved (skins/<xuid>/) into the same folder, to look
// at without deploying: skin.png (the skin itself), holo.png and holo-head.png (as the lobby pack
// has them, see skin-set.ts), and portrait.png and head.png (the same in color).
// npm run skins -- <skin.png> [slim]: renders one skin file instead, next to it.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.ts";
import { renderPreviews } from "./skin-set.ts";
import { readSkins, type StoredSkin } from "./store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [file, arms] = process.argv.slice(2);

if (file) {
  const image = decodePng(await readFile(file));
  const skin: StoredSkin = {
    meta: { xuid: "file", name: file, width: image.width, height: image.height, armSize: arms === "slim" ? "slim" : "wide", hash: "", updatedAt: "" },
    image,
  };
  for (const [name, render] of Object.entries(renderPreviews(skin))) await writeFile(file.replace(/\.png$/i, `.${name}.png`), encodePng(render));
  console.log(`rendered ${file}`);
} else {
  const dir = join(root, "skins");
  const skins = await readSkins(dir);
  for (const skin of skins) {
    const folder = join(dir, skin.meta.xuid);
    await writeFile(join(folder, "skin.png"), encodePng(skin.image));
    for (const [name, render] of Object.entries(renderPreviews(skin))) await writeFile(join(folder, `${name}.png`), encodePng(render));
    console.log(`rendered ${skin.meta.name} (${skin.meta.xuid})${skin.meta.persona ? ", character creator" : ""}`);
  }
  if (skins.length === 0) console.log(`no skins in ${dir} yet: the watcher saves them as players join`);
}

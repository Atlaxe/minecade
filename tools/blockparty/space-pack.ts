// Writes Block Party's space markers from the model and games/blockparty/spaces.json (space-model.ts
// says how; docs/plans/block-party.md, "Space markers"):
//
//   - the model (resource_pack/models/entity/space.geo.json), cut on the block grid in place, its
//     faces mapped onto the block textures;
//   - the client entity's textures (resource_pack/entity/space.entity.json) and its four render
//     controllers (resource_pack/render_controllers/blockparty.render_controllers.json);
//   - the pedestal's floor block (behavior_pack/blocks/space_floor.json), its clear texture and its
//     terrain texture entry;
//   - games/blockparty/space-model.json, what the game reads: the types' order, the floor's blocks
//     and the sizes.
//
// Run it after changing the model in Blockbench or spaces.json:
//
//   npx tsx tools/blockparty/space-pack.ts
//
// It checks both first and writes nothing if they have problems. games/blockparty/test/spaces.test.ts
// fails while the files and the two disagree.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VanillaTextures } from "../build/vanilla-textures.ts";
import { blankImage, encodePng } from "../skins/png.ts";
import { decodeAnyPng } from "../viewer/png.ts";
import {
  CONTROLLERS_FILE,
  ENTITY_FILE,
  FLOOR_FILE,
  FLOOR_TEXTURE,
  INFO_FILE,
  MODEL_FILE,
  OWN_PICTURES,
  PACK,
  PARTS,
  TERRAIN_FILE,
  bonesOf,
  clientEntity,
  cutModel,
  floorBlock,
  floorCells,
  json,
  markerGeometry,
  measure,
  modelInfo,
  modelProblems,
  modelText,
  ownPicture,
  readSpaces,
  renderControllers,
  spacesProblems,
  terrainTextures,
  type GeometryFile,
} from "./space-model.ts";

const spaces = readSpaces();
const model = JSON.parse(readFileSync(MODEL_FILE, "utf8")) as GeometryFile;
const problems = spacesProblems(spaces).map((problem) => `spaces.json: ${problem}`);
const checked = modelProblems(model);
problems.push(...checked.problems.map((problem) => `The model: ${problem}`));

// Each texture: a picture of the user's own in the pack, else Minecraft's. A picture that isn't
// square is likely an animated texture (its frames one under another), which a model shows squashed.
const vanilla = VanillaTextures.load();
const notes: string[] = [...checked.warnings];
for (const [type, textures] of Object.entries(spaces.types ?? {})) {
  for (const part of PARTS) {
    const path = textures?.[part];
    if (typeof path !== "string") continue;
    const own = ownPicture(path);
    if (path.startsWith(`${OWN_PICTURES}/`) && !own) {
      problems.push(`spaces.json: ${type}'s ${part} is ${path}, but there's no ${path}.png in Block Party's resource pack.`);
      continue;
    }
    const image = own ? decodeAnyPng(readFileSync(own)) : vanilla?.picture(path);
    if (!image) {
      notes.push(`${type}'s ${part}, ${path}, isn't one this tool can look at (Minecraft's textures/blocks pictures it can); check it shows in game.`);
      continue;
    }
    if (image.width !== image.height) problems.push(`spaces.json: ${type}'s ${part}, ${path}, is ${image.width} x ${image.height}: a model needs a square picture (an animated texture's frames stand one under another).`);
  }
}

if (problems.length > 0) {
  console.error(`Nothing was written:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const cut = cutModel(model);
const geometry = markerGeometry(cut)!;
const size = measure(geometry);
const cells = floorCells(size);
writeFileSync(MODEL_FILE, modelText(cut));
writeFileSync(ENTITY_FILE, json(clientEntity(spaces)));
const controllers = JSON.parse(readFileSync(CONTROLLERS_FILE, "utf8"));
Object.assign(controllers.render_controllers, renderControllers(spaces, bonesOf(geometry)));
writeFileSync(CONTROLLERS_FILE, json(controllers));
mkdirSync(dirname(FLOOR_FILE), { recursive: true });
writeFileSync(FLOOR_FILE, json(floorBlock(cells)));
const clear = join(PACK, `${FLOOR_TEXTURE}.png`);
mkdirSync(dirname(clear), { recursive: true });
writeFileSync(clear, encodePng(blankImage(16, 16)));
writeFileSync(TERRAIN_FILE, json(terrainTextures(existsSync(TERRAIN_FILE) ? JSON.parse(readFileSync(TERRAIN_FILE, "utf8")) : undefined)));
writeFileSync(INFO_FILE, json(modelInfo(size, cells)));

const cubes = geometry.bones.reduce((sum, bone) => sum + (bone.cubes?.length ?? 0), 0);
console.log(`Space marker written: ${cubes} cubes, ${size.reach[0] * 2} x ${size.reach[1] * 2} pixels across, the pedestal ${size.pedestal.reach[0] * 2} x ${size.pedestal.reach[1] * 2} with its top ${size.pedestal.top} up, its floor ${cells.length} block${cells.length === 1 ? "" : "s"}.`);
for (const note of notes) console.log(`Note: ${note}`);

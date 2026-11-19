// Writes Block Party's die model from games/blockparty/dice.json (dice-model.ts says how the model is
// made): every die with a texture gets its body texture and its faces geometry in the model's client
// entity (resource_pack/entity/die.entity.json), a place in its render controllers' arrays (the
// blockparty:die property picks it; dice.ts, modelIndex) and its burst particle (particles/); the
// faces' values are drawn in the game's Minecraft Ten font, read from Minecraft on this PC
// (ten-font.ts), or from the face pictures in resource_pack/textures/blockparty/dice/faces. It also
// writes the numbers over heads (the moves left and a transfer's count): the atlas of every number in
// the file's "number", "gain" and "loss" looks (textures/blockparty/numbers.png) and the particle that
// shows one (particles/number.json); and the glyphs the build draws the dice icons' numbers with
// (tools/blockparty/ten-glyphs.json). Run it after changing a die's texture, ink, shadow or faces, a
// number's look, or a face picture:
//
//   npx tsx tools/blockparty/dice-pack.ts
//
// It checks the dice file first and writes nothing if it has problems. games/blockparty/test/dice.test.ts
// fails while the files and the dice file disagree.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DICE, DICE_PROBLEMS } from "../../games/blockparty/behavior_pack/scripts/dice.ts";
import { encodePng } from "../skins/png.ts";
import { NUMBER_ATLAS } from "../../games/blockparty/behavior_pack/scripts/numbers.ts";
import { NUMBER_PARTICLE_FILE, PACK, PALETTE, PLAN_FILE, buildFaces, burstEffect, burstFile, modelFiles, modelPlan, numberAtlas, numberParticle } from "./dice-model.ts";
import { GLYPH_FILE, glyphTable, loadTenFont } from "./ten-font.ts";

const ENTITY = join(PACK, "entity", "die.entity.json");
const CONTROLLERS = join(PACK, "render_controllers", "blockparty.render_controllers.json");
const FACES = join(PACK, "models", "entity", "die_faces.geo.json");
/** What the numbers over heads were before they were particles: taken out of the pack if they're there. */
const GONE = ["models/entity/count.geo.json", "models/entity/tally.geo.json", "textures/blockparty/number_palette.png"].map((path) => join(PACK, path));
const GONE_CONTROLLERS = ["controller.render.blockparty.count", "controller.render.blockparty.tally"];
const PARTICLES = join(PACK, "particles");
const BODY = "controller.render.blockparty.die";
const FACE_LAYER = "controller.render.blockparty.die_faces";

if (DICE_PROBLEMS.length > 0) {
  console.error(`games/blockparty/dice.json has problems, so nothing was written:\n- ${DICE_PROBLEMS.join("\n- ")}`);
  process.exit(1);
}
const { plan, problems } = modelPlan();
if (problems.length > 0) {
  console.error(`The dice's pictures have problems, so nothing was written:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const font = loadTenFont();
const { geometries, palette } = buildFaces(plan, font);
const files = modelFiles(plan);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
/** JSON with anything that fits in `width` characters on one line (a cube a line). */
const compact = (value: unknown, indent = "", width = 320): string => {
  const flat = JSON.stringify(value);
  if (typeof value !== "object" || value === null || flat.length + indent.length <= width) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => inner + compact(item, inner, width)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${compact(item, inner, width)}`).join(",\n")}\n${indent}}`;
};

writeFileSync(FACES, `${compact({ format_version: "1.12.0", "minecraft:geometry": geometries })}\n`);
for (const file of GONE) rmSync(file, { force: true });
for (const [path, image] of [
  [PALETTE, palette],
  [NUMBER_ATLAS, numberAtlas(plan, font)],
] as const) {
  const file = join(PACK, `${path}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePng(image));
}

const entity = JSON.parse(readFileSync(ENTITY, "utf8"));
const description = entity["minecraft:client_entity"].description;
description.materials = { default: "entity_alphatest", faces: "entity" };
description.textures = files.textures;
description.geometry = files.geometry;
description.render_controllers = [BODY, FACE_LAYER];
writeFileSync(ENTITY, json(entity));

const controllers = JSON.parse(readFileSync(CONTROLLERS, "utf8"));
const die = "q.property('blockparty:die')";
controllers.render_controllers[BODY] = {
  arrays: { textures: { "Array.dice": files.dice }, geometries: { "Array.bodies": files.bodies } },
  geometry: `Array.bodies[${die}]`,
  materials: [{ "*": "Material.default" }],
  textures: [`Array.dice[${die}]`],
};
controllers.render_controllers[FACE_LAYER] = {
  arrays: { geometries: { "Array.faces": files.faces } },
  geometry: `Array.faces[${die}]`,
  materials: [{ "*": "Material.faces" }],
  textures: ["Texture.palette"],
};
for (const name of GONE_CONTROLLERS) delete controllers.render_controllers[name];
writeFileSync(CONTROLLERS, json(controllers));

// Each die's burst, and none for a die that's gone.
mkdirSync(PARTICLES, { recursive: true });
const bursts = new Set(plan.dice.map((entry) => burstFile(entry.id)));
for (const name of readdirSync(PARTICLES)) {
  if (name.startsWith("die_burst_") && !bursts.has(`particles/${name}`)) rmSync(join(PARTICLES, name));
}
for (const entry of plan.dice) writeFileSync(join(PACK, burstFile(entry.id)), json(burstEffect(entry)));
writeFileSync(join(PACK, NUMBER_PARTICLE_FILE), json(numberParticle()));

writeFileSync(PLAN_FILE, `${compact({ about: "What tools/blockparty/dice-pack.ts last made Block Party's die model from (the tests compare it with dice.json).", ...plan }, "", 200)}
`);

// The glyphs for every digit and every face's text (the dice icons' numbers, drawn by the build).
const chars = ["0123456789", ...Object.values(DICE).flatMap((entry) => entry.faces.map((face) => face.show))].join("");
writeFileSync(
  GLYPH_FILE,
  `${compact({ about: "Minecraft Ten's glyphs for the characters Block Party's dice draw, written by tools/blockparty/dice-pack.ts from the game's font so the build can draw the dice icons' numbers (tools/blockparty/item-icons.ts). Each is its columns, and its filled pixels as [column, row], row 0 on the baseline.", glyphs: glyphTable(font, chars) }, "", 200)}\n`,
);

const cubes = geometries.reduce((sum, geometry) => sum + ((geometry as { bones: { cubes?: unknown[] }[] }).bones[0].cubes?.length ?? 0), 0);
console.log(
  plan.dice.length === 0
    ? "No die has a texture yet: every die floats as its block."
    : `The die model shows ${plan.dice.map((entry) => `${entry.id} (${entry.texture}, ${entry.layout === "six" ? "six faces" : "one square on every face"})`).join(", ")}, with ${cubes} cubes of face values.`,
);

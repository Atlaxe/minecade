// Writes Block Party's die model from games/blockparty/dice.json (dice-model.ts says how the model is
// made): every die with a texture gets its body texture and its faces geometry in the model's client
// entity (resource_pack/entity/die.entity.json) and a place in its render controllers' arrays (the
// blockparty:die property picks it; dice.ts, modelIndex); the faces' values are drawn in the game's
// Minecraft Ten font, read from Minecraft on this PC (ten-font.ts), or from the face pictures in
// resource_pack/textures/blockparty/dice/faces. Run it after changing a die's texture, ink or faces,
// or a face picture:
//
//   npx tsx tools/blockparty/dice-pack.ts
//
// It checks the dice file first and writes nothing if it has problems. games/blockparty/test/dice.test.ts
// fails while the files and the dice file disagree.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DICE_PROBLEMS } from "../../games/blockparty/behavior_pack/scripts/dice.ts";
import { encodePng } from "../skins/png.ts";
import { PACK, PALETTE, PLAN_FILE, buildFaces, modelFiles, modelPlan } from "./dice-model.ts";
import { loadTenFont } from "./ten-font.ts";

const ENTITY = join(PACK, "entity", "die.entity.json");
const CONTROLLERS = join(PACK, "render_controllers", "blockparty.render_controllers.json");
const FACES = join(PACK, "models", "entity", "die_faces.geo.json");
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
const paletteFile = join(PACK, `${PALETTE}.png`);
mkdirSync(dirname(paletteFile), { recursive: true });
writeFileSync(paletteFile, encodePng(palette));

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
writeFileSync(CONTROLLERS, json(controllers));

writeFileSync(PLAN_FILE, `${compact({ about: "What tools/blockparty/dice-pack.ts last made Block Party's die model from (the tests compare it with dice.json).", ...plan }, "", 200)}
`);

const cubes = geometries.reduce((sum, geometry) => sum + ((geometry as { bones: { cubes?: unknown[] }[] }).bones[0].cubes?.length ?? 0), 0);
console.log(
  plan.dice.length === 0
    ? "No die has a texture yet: every die floats as its block."
    : `The die model shows ${plan.dice.map((entry) => `${entry.id} (${entry.texture}, ${entry.layout === "six" ? "six faces" : "one square on every face"})`).join(", ")}, with ${cubes} cubes of face values.`,
);

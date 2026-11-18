// Writes Block Party's die model's texture list from games/blockparty/dice.json: each die with a
// texture gets a name in the model's client entity (resource_pack/entity/die.entity.json) and a
// place in its render controller's Array.dice (the blockparty:die property picks it; dice.ts,
// modelIndex). Run it after giving a die a texture, or taking one away:
//
//   npx tsx tools/blockparty/dice-pack.ts
//
// It checks the dice file first and writes nothing if it has problems. games/blockparty/test/dice.test.ts
// fails while the files and the dice file disagree.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DICE_PROBLEMS, modelDice, modelFiles } from "../../games/blockparty/behavior_pack/scripts/dice.ts";

const pack = join(fileURLToPath(new URL("../../games/blockparty/resource_pack/", import.meta.url)));
const ENTITY = join(pack, "entity", "die.entity.json");
const CONTROLLERS = join(pack, "render_controllers", "blockparty.render_controllers.json");
const CONTROLLER = "controller.render.blockparty.die";

if (DICE_PROBLEMS.length > 0) {
  console.error(`games/blockparty/dice.json has problems, so nothing was written:\n- ${DICE_PROBLEMS.join("\n- ")}`);
  process.exit(1);
}

const { textures, list } = modelFiles();
const entity = JSON.parse(await readFile(ENTITY, "utf8"));
entity["minecraft:client_entity"].description.textures = textures;
await writeFile(ENTITY, `${JSON.stringify(entity, null, 2)}\n`);
const controllers = JSON.parse(await readFile(CONTROLLERS, "utf8"));
controllers.render_controllers[CONTROLLER].arrays.textures["Array.dice"] = list;
await writeFile(CONTROLLERS, `${JSON.stringify(controllers, null, 2)}\n`);

const dice = modelDice();
console.log(dice.length === 0 ? "No die has a texture yet: every die floats as its block." : `The die model shows ${dice.map((die) => `${die.name} (${die.texture})`).join(", ")}.`);

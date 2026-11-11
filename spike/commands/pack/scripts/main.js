// Command name check: registers custom commands under names a WorldEdit player would type
// ("//wand" reaches the server as a command named "/wand") and reports which the registry takes.
// Driven from spike/commands/run.ts, which then runs each from the console.
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, system } from "@minecraft/server";

const out = (obj) => console.log(`CMD|${JSON.stringify(obj)}`);
const NAMES = ["minecade:/wand", "minecade://wand", "minecade:wand", "minecade:set", "minecade:replace", "minecade:fix", "minecade:-set"];

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  for (const name of NAMES) {
    try {
      customCommandRegistry.registerCommand(
        { name, description: "check", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false, optionalParameters: [{ name: "block", type: CustomCommandParamType.BlockType }] },
        (origin, block) => {
          out({ ran: name, block: block?.id });
          return { status: CustomCommandStatus.Success };
        },
      );
      out({ registered: name });
    } catch (error) {
      out({ registered: name, error: String(error) });
    }
  }
});

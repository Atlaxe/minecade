// Map editor server script. tools/editor starts the server with the map being edited; once the
// world has loaded, the editor (editor.ts) reads what the host staged and starts.
import { world } from "@minecraft/server";
import { Scope, describeError, log } from "@minecade/minigame-core";
import { Editor } from "./editor.ts";
import { readEditorVars } from "./vars.ts";

const loaded = world.afterEvents.worldLoad.subscribe(() => {
  world.afterEvents.worldLoad.unsubscribe(loaded);
  const vars = readEditorVars();
  if (!vars) return;
  try {
    new Editor(new Scope("editor"), vars.info, vars.map).start();
    log.info(`map editor: ${vars.info.target}/${vars.info.map}, map editors: ${vars.info.editors.join(", ") || "none"}`);
  } catch (error) {
    log.error(`the map editor failed to start: ${describeError(error)}`);
  }
});

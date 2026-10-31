// Map editor server script. tools/editor starts each server in one of four modes; once the world
// has loaded, the script reads what the host staged and starts that mode: the editor lobby
// (home.ts, the form that opens maps and worlds), Edit (editor.ts, one map), Select (selector.ts,
// boxing maps in a converted world) or Extract (extractor.ts, the host's throwaway server that
// moves one map to the middle).
import { world } from "@minecraft/server";
import { Scope, describeError, log } from "@minecade/minigame-core";
import { Editor } from "./editor.ts";
import { Extractor } from "./extractor.ts";
import { Home } from "./home.ts";
import { Selector } from "./selector.ts";
import { readEditorVars } from "./vars.ts";

const loaded = world.afterEvents.worldLoad.subscribe(() => {
  world.afterEvents.worldLoad.unsubscribe(loaded);
  const vars = readEditorVars();
  if (!vars) return;
  const { info, map } = vars;
  try {
    const scope = new Scope("editor");
    if (info.mode === "home") {
      new Home(scope, info).start();
      log.info(`map editor: the editor lobby, map editors: ${info.editors.join(", ") || "none"}`);
    } else if (info.mode === "edit") {
      new Editor(scope, info, map).start();
      log.info(`map editor: ${info.target}/${info.map}, map editors: ${info.editors.join(", ") || "none"}`);
    } else if (info.mode === "select") {
      new Selector(scope, info).start();
      log.info(`map editor: Select mode on "${info.world}", map editors: ${info.editors.join(", ") || "none"}`);
    } else {
      new Extractor(scope).start();
      log.info("map editor: extract mode");
    }
  } catch (error) {
    log.error(`the map editor failed to start: ${describeError(error)}`);
  }
});

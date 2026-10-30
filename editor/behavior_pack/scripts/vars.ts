// The editor's server variables, written by the container entrypoint: what the host staged
// (editor.json, as the "editor" variable) and the map being edited ("mapConfig").
import { variables } from "@minecraft/server-admin";
import { describeError, log, readServerVars, type EditorInfo, type MapConfig } from "@minecade/minigame-core";

export interface EditorVars {
  info: EditorInfo;
  map: MapConfig;
}

/** The editor's settings, or undefined (and a log line) when the server wasn't started as the editor. */
export function readEditorVars(): EditorVars | undefined {
  const raw = variables.get("editor");
  if (typeof raw !== "string" || raw === "") {
    log.error('no "editor" server variable: start this server with npm run editor');
    return undefined;
  }
  try {
    return { info: JSON.parse(raw) as EditorInfo, map: readServerVars().mapConfig };
  } catch (error) {
    log.error(`the "editor" server variable is not valid JSON: ${describeError(error)}`);
    return undefined;
  }
}

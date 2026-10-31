// The map editor's host tool: runs the editor server on port 19134 with one map, keeps map.json in
// step with the game, and saves the world back into the map when it stops. See docs/editor.md.
//   npm run editor -- <target> <map> [--new] [--verbose]     for example: npm run editor -- sumo arena_1
//   npm run editor -- status | save | stop
// The Panel starts the same tool in the background (its output goes to work/editor/editor.log).
// Either way it answers on 127.0.0.1:8097, which the Panel and `npm run editor -- stop` use.
import { fileURLToPath } from "node:url";
import { editorStatus, saveEditor, serveControl, stopEditor } from "./control.ts";
import { USAGE, parseArgs } from "./editor-core.ts";
import { EditorSession } from "./session.ts";
import { loadTarget } from "./targets.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = parseArgs(process.argv.slice(2));

if (args.command === "help") {
  if (args.error) console.error(args.error);
  console.log(USAGE);
  process.exit(args.error ? 1 : 0);
}

if (args.command === "status") {
  const status = await editorStatus();
  if (!status) console.log("No map editor is running.");
  else {
    console.log(`${status.targetName}, ${status.mapName} (${status.map}): ${status.state}. Join ${status.join}.`);
    const world = status.saving ? "is being saved" : status.unsaved ? "has unsaved block changes (Save, or stopping, saves them)" : "is saved";
    console.log(`Online: ${status.players.join(", ") || "nobody"}. The world ${world}.`);
    for (const row of status.checklist.rows) console.log(`  ${row.done ? "ok     " : "missing"} ${row.label} ${row.have}/${row.need}`);
    for (const problem of status.checklist.problems) console.log(`  ${problem}`);
  }
  process.exit(0);
}

if (args.command === "save") {
  if (!(await saveEditor())) {
    console.log("No map editor is running.");
    process.exit(0);
  }
  console.log("Saving the map editor's world into the map...");
  // Wait for the save to start, then for it to finish.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  let status = await editorStatus();
  while (status?.saving) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await editorStatus();
  }
  console.log(status?.log.at(-1) ?? "The editor stopped.");
  process.exit(0);
}

if (args.command === "stop") {
  if (!(await stopEditor())) {
    console.log("No map editor is running.");
    process.exit(0);
  }
  console.log("Stopping the map editor (it saves first)...");
  // It answers until it has finished saving and stopping.
  while (await editorStatus()) await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("Stopped.");
  process.exit(0);
}

if (args.command === "edit") {
  const running = await editorStatus();
  if (running) {
    console.error(`A map editor is already running (${running.targetName}, ${running.mapName}: ${running.state}). Stop it first: npm run editor -- stop`);
    process.exit(1);
  }
  let session: EditorSession;
  try {
    session = new EditorSession({ target: await loadTarget(root, args.target), mapId: args.map, fresh: args.fresh, verbose: args.verbose });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const control = await serveControl({ status: () => session.status(), save: () => void session.save("this PC"), stop: () => void session.stop() }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
  session.onEnd = (ok) => {
    control.close();
    process.exit(ok ? 0 : 1);
  };
  let interrupts = 0;
  process.on("SIGINT", () => {
    if (++interrupts === 1) {
      console.log("Stopping (it saves first; press Ctrl+C again to quit without saving the world)...");
      void session.stop();
    } else {
      void session.forceStop();
    }
  });
  // A failed start has already been reported, and onEnd exits.
  await session.start().catch(() => {});
}

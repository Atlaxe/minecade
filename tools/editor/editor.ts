// The map editor's host tool: runs the editor server on port 19134, in Edit mode on one map (it
// keeps map.json in step with the game and saves the world back into the map) or in Select mode
// on a converted world (boxing maps, which are extracted in the background). One session runs at a
// time; a switch (from the game, the Panel or the terminal) stops it and starts the next in this
// same process, and extractions carry on across switches. See docs/editor.md.
//   npm run editor -- <target> <map> [--new] [--verbose]     for example: npm run editor -- sumo arena_1
//   npm run editor -- select "<world>" [--verbose]
//   npm run editor -- status | save | stop
// The Panel starts the same tool in the background (its output goes to work/editor/editor.log).
// Either way it answers on 127.0.0.1:8097, which the Panel and `npm run editor -- stop` use.
import { fileURLToPath } from "node:url";
import { editorStatus, saveEditor, serveControl, stopEditor } from "./control.ts";
import { USAGE, parseArgs, type EditorStatus, type NextSession } from "./editor-core.ts";
import { SelectSession } from "./select-session.ts";
import { Selections } from "./selections.ts";
import type { ServerSession } from "./server-session.ts";
import { EditorSession } from "./session.ts";
import { loadTarget } from "./targets.ts";
import { resolveWorld } from "./worlds.ts";

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
  else printStatus(status);
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
  while (status?.mode === "edit" && status.saving) {
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

if (args.command !== "edit" && args.command !== "select") process.exit(1);
const running = await editorStatus();
if (running) {
  console.error(`A map editor is already running (${describe(running)}: ${running.state}). Stop it first: npm run editor -- stop`);
  process.exit(1);
}

const verbose = args.verbose;
// Extractions outlive sessions: their lines go to whichever session runs now.
const selections = new Selections(root, { verbose, note: (text) => session.log(text) });
let session: ServerSession;
/** The session to start once this one has stopped (a switch). */
let next: NextSession | undefined;
let stopping = false;

/** Makes the session for a start or a switch; throws (with the reason) when it can't. */
async function create(launch: NextSession & { fresh?: boolean }): Promise<ServerSession> {
  if (launch.mode === "edit") return new EditorSession({ target: await loadTarget(root, launch.target), mapId: launch.map, fresh: launch.fresh ?? false, verbose });
  return new SelectSession({ world: await resolveWorld(launch.world, selections.unzipDir), selections, verbose });
}

async function run(made: ServerSession): Promise<void> {
  session = made;
  session.onSwitch = (to) => {
    next = to;
    void session.stop();
  };
  session.onEnd = (ok) => void ended(ok);
  // A failed start has already been reported, and onEnd follows.
  await session.start().catch(() => {});
}

async function ended(ok: boolean): Promise<void> {
  const to = next;
  next = undefined;
  if (to && !stopping) {
    try {
      return await run(await create(to));
    } catch (error) {
      console.error(`Could not switch: ${error instanceof Error ? error.message : String(error)}`);
      ok = false;
    }
  }
  if (selections.busy > 0) {
    console.log(`Waiting for ${selections.busy} extraction${selections.busy === 1 ? "" : "s"} to finish before quitting...`);
    await selections.idle();
  }
  control.close();
  process.exit(ok ? 0 : 1);
}

let first: ServerSession;
try {
  first = await create(args.command === "edit" ? { mode: "edit", target: args.target, map: args.map, fresh: args.fresh } : { mode: "select", world: args.world });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
session = first;
const control = await serveControl({
  status: () => session.status(),
  save: () => {
    if (session instanceof EditorSession) void session.save("this PC");
  },
  stop: () => {
    stopping = true;
    void session.stop();
  },
  switchTo: async (to) => {
    if (next) return "a switch is under way already";
    // Check the target or world before stopping the session that runs now.
    if (to.mode === "select") {
      try {
        await resolveWorld(to.world, selections.unzipDir);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    } else if (session instanceof SelectSession) {
      const problem = session.editProblem(to.target, to.map);
      if (problem) return problem;
    }
    next = to;
    void session.stop();
    return undefined;
  },
  selection: async ({ action, target, map }) => {
    if (!(session instanceof SelectSession)) return "the editor isn't in Select mode";
    return session.mapAction("this PC", action, target, map);
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

let interrupts = 0;
process.on("SIGINT", () => {
  stopping = true;
  if (++interrupts === 1) {
    console.log("Stopping (it saves first; press Ctrl+C again to quit without saving the world)...");
    void session.stop();
  } else {
    void session.forceStop();
  }
});
await run(first);

function describe(status: EditorStatus): string {
  return status.mode === "edit" ? `${status.targetName}, ${status.mapName}` : `Select mode on "${status.world}"`;
}

function printStatus(status: EditorStatus): void {
  console.log(`${describe(status)}${status.mode === "edit" ? ` (${status.map})` : ""}: ${status.state}. Join ${status.join}.`);
  if (status.mode === "select") {
    console.log(`Online: ${status.players.join(", ") || "nobody"}. Maps from this world:`);
    for (const item of status.selections) console.log(`  ${item.status.padEnd(10)} ${item.targetName}, ${item.name} (${item.map})${item.error ? `: ${item.error}` : ""}`);
    if (status.selections.length === 0) console.log("  none yet");
    return;
  }
  const world = status.saving ? "is being saved" : status.unsaved ? "has unsaved block changes (Save, or stopping, saves them)" : "is saved";
  console.log(`Online: ${status.players.join(", ") || "nobody"}. The world ${world}.`);
  for (const row of status.checklist.rows) console.log(`  ${row.done ? "ok     " : "missing"} ${row.label} ${row.have}/${row.need}`);
  for (const problem of status.checklist.problems) console.log(`  ${problem}`);
}

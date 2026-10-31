// The map editor's host tool: boots the editor's three servers (runner.ts) on the network's ports:
// the editor lobby on 19132, where everyone joins and picks a map or a world to open, Select on
// 19133 and Edit on 19134. See docs/editor.md.
//   npm run editor [--verbose]                               boot it
//   npm run editor -- <target> <map> [--new] [--verbose]     boot it (or use the running one) and open a map
//   npm run editor -- select "<world>" [--verbose]           the same with a world in Select
//   npm run editor -- status | save | publish | stop
// The Panel starts the same tool in the background (its output goes to work/editor/editor.log).
// Either way it answers on 127.0.0.1:8097, which the Panel and `npm run editor -- stop` use.
import { fileURLToPath } from "node:url";
import { editorStatus, openInEditor, publishEditor, saveEditor, serveControl, stopEditor } from "./control.ts";
import { USAGE, parseArgs, type EditorStatus } from "./editor-core.ts";
import { EditorRunner } from "./runner.ts";

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
  const result = await saveEditor();
  if (!result.ok) {
    console.log(result.error === "no map editor is running" ? "No map editor is running." : `Can't save: ${result.error}.`);
    process.exit(0);
  }
  console.log("Saving the map open in Edit...");
  // Wait for the save to start, then for it to finish.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  let status = await editorStatus();
  while (status?.edit?.saving) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await editorStatus();
  }
  console.log(status?.log.at(-1) ?? "The editor stopped.");
  process.exit(0);
}

if (args.command === "publish") {
  const result = await publishEditor();
  if (!result.ok) {
    console.log(result.error === "no map editor is running" ? "No map editor is running." : `Can't publish: ${result.error}.`);
    process.exit(0);
  }
  console.log("Publishing the map open in Edit (saving, then commit and push)...");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  let status = await editorStatus();
  while (status?.edit?.publishing) {
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
  console.log("Shutting the map editor down (Edit saves first)...");
  // It answers until every server has stopped.
  while (await editorStatus()) await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("Stopped.");
  process.exit(0);
}

if (args.command !== "boot") process.exit(1);
const running = await editorStatus();
if (running) {
  if (!running.booted) {
    console.error("An older map editor is running: stop it first (npm run editor -- stop).");
    process.exit(1);
  }
  if (!args.open) {
    console.log(`The map editor is running already: join ${running.join}.`);
    process.exit(0);
  }
  const result = await openInEditor(args.open);
  console.log(result.ok ? "Opening it in the running editor: watch with npm run editor -- status." : `Can't open it: ${result.error}.`);
  process.exit(result.ok ? 0 : 1);
}

const runner = new EditorRunner({ root, verbose: args.verbose });
runner.onExit = (ok) => {
  control.close();
  process.exit(ok ? 0 : 1);
};
const control = await serveControl({
  status: () => runner.status(),
  save: () => runner.save(),
  publish: () => runner.publish(),
  stop: () => void runner.shutdown(),
  open: (request) => runner.request("this PC", request),
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

let interrupts = 0;
process.on("SIGINT", () => {
  if (++interrupts === 1) {
    console.log("Shutting down (Edit saves first; press Ctrl+C again to quit without saving the world)...");
    void runner.shutdown();
  } else {
    void runner.shutdown(true);
  }
});

try {
  await runner.boot();
} catch (error) {
  console.error(`Could not boot the map editor: ${error instanceof Error ? error.message : String(error)}`);
  control.close();
  process.exit(1);
}
if (args.open) {
  const problem = await runner.request("this PC", args.open);
  if (problem) console.error(`Can't open it: ${problem}`);
}

function printStatus(status: EditorStatus): void {
  if (!status.booted) {
    console.log("An older map editor is running (from before the editor lobby): stop it with npm run editor -- stop.");
    return;
  }
  console.log(`Map editor: ${status.state}. Join ${status.join}.`);
  console.log(`  Lobby:  ${status.home.state}, ${status.home.players.join(", ") || "nobody"}`);
  const select = status.select;
  if (select) {
    console.log(`  Select: "${select.world}", ${select.state}, ${select.players.join(", ") || "nobody"}`);
    for (const item of select.selections) console.log(`    ${item.status.padEnd(10)} ${item.targetName}, ${item.name} (${item.map})${item.error ? `: ${item.error}` : ""}`);
  }
  const edit = status.edit;
  if (edit) {
    const world = edit.saving ? "being saved" : edit.unsaved ? "has unsaved block changes" : "saved";
    const draft = edit.draft ? ", a draft" : "";
    console.log(`  Edit:   ${edit.targetName}, ${edit.mapName} (${edit.map})${draft}, ${edit.state}, ${edit.players.join(", ") || "nobody"}; the world is ${world}${edit.publishing ? "; publishing" : ""}`);
    for (const row of edit.checklist.rows) console.log(`    ${row.done ? "ok     " : "missing"} ${row.label} ${row.have}/${row.need}`);
  }
  for (const entry of status.waiting) console.log(`  ${entry.name} is waiting for ${entry.label}`);
}

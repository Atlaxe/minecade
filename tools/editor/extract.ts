// Cuts one map out of a converted world (Select mode's extraction, also Update from world):
//   1. Chunker prunes a copy of the world to the box's chunks.
//   2. A throwaway BDS (minecade-extract: no ports, no players) runs the editor pack in extract mode,
//      with the shared block pack, so custom blocks survive. It moves the box so its middle sits
//      at x 0, z 0, clearing everything else in those chunks (neighbors spill in at chunk edges).
//   3. Chunker prunes to the moved box's chunks.
//   4. The bake settings go into level.dat, and the world replaces the map's world/ (map.json too,
//      for a new map).
// The spike proved each step on the user's world (docs/spike-results.md, "Map editor").
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Docker from "dockerode";
import * as tar from "tar";
import {
  EDIT_SCRIPT_EVENT_ID,
  extractEditPayload,
  formatMapConfig,
  parseEditorEvent,
  type Box,
  type EditorEvent,
  type ExtractInfo,
  type HostMessage,
  type MapConfig,
  type Vec3,
} from "@minecade/minigame-core/config";
import { bakeSettings } from "../build/bake-core.ts";
import { BASE_IMAGE } from "../build/base-image.ts";
import { attachConsole, copyDirFromContainer, findContainerByName, type ServerConsole } from "../build/docker-util.ts";
import { enableBetaApis, patchLevelDat } from "../build/leveldat.ts";
import { prune } from "./chunker.ts";
import { chunkRange, moveBox } from "./select-core.ts";
import { buildEditorTemplate } from "./template.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const NAME = "minecade-extract";
/** Files BDS adds to a running world that a map's world doesn't keep. */
const RUNTIME_FILES = ["level.dat_old", "world_behavior_packs.json", "world_resource_packs.json"];
const READY_TIMEOUT_MS = 240_000;
/** Moving a big map takes a while: columns are captured, the chunks cleared and the columns placed twice. */
const MOVE_TIMEOUT_MS = 15 * 60_000;
const STOP_TIMEOUT_MS = 60_000;

export interface ExtractJob {
  /** The converted world's folder. It's never opened: Chunker gets a copy. */
  world: string;
  box: Box;
  offset: Vec3;
  /** The map's folder: its world/ is replaced. */
  mapDir: string;
  /** A new map's map.json, written with the world. Update leaves map.json alone. */
  config?: MapConfig;
  /** The map's name, for levelname.txt when the map has none yet. */
  name: string;
  /** The map's first spawn (moved), for the world spawn in level.dat. */
  spawn: Vec3;
}

export interface ExtractOptions {
  docker: Docker;
  /** .env, for the server's addresses. */
  env: Record<string, string>;
  verbose: boolean;
  /** Progress, one line at a time. */
  note(text: string): void;
}

/** Runs one extraction to the end; throws with the reason when a step fails. */
export async function extract(job: ExtractJob, options: ExtractOptions): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "minecade-extract-"));
  try {
    const pruned = join(scratch, "pruned");
    options.note("cutting the world down to the box's chunks...");
    await prune(options.docker, job.world, chunkRange(job.box), pruned);
    // Chunker drops the void layers: without them, chunks next to the box could generate land.
    await patchLevelDat(join(pruned, "level.dat"), (dat) => {
      bakeSettings(dat, { name: job.name, spawns: [middleTop(job.box)] });
      enableBetaApis(dat);
    });

    const moved = join(scratch, "moved");
    options.note("moving it to the middle...");
    const result = await moveInServer(pruned, job, moved, options);
    options.note(`moved ${result.tiles} columns${result.drops ? `, ${result.drops} dropped items removed` : ""}.`);

    const final = join(scratch, "final");
    options.note("cutting it down to the moved box's chunks...");
    await prune(options.docker, moved, chunkRange(moveBox(job.box, job.offset)), final);
    for (const file of RUNTIME_FILES) await rm(join(final, file), { force: true });
    await patchLevelDat(join(final, "level.dat"), (dat) => bakeSettings(dat, { name: job.name, spawns: [job.spawn] }));
    const nameFile = join(job.mapDir, "world", "levelname.txt");
    if (existsSync(nameFile)) await cp(nameFile, join(final, "levelname.txt"));
    else await writeFile(join(final, "levelname.txt"), job.name);

    await mkdir(job.mapDir, { recursive: true });
    const worldDir = join(job.mapDir, "world");
    const fresh = `${worldDir}.new`;
    await rm(fresh, { recursive: true, force: true });
    await cp(final, fresh, { recursive: true });
    // Retries cover Windows file watchers (VS Code) briefly holding files in the old world.
    await rm(worldDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rename(fresh, worldDir);
    if (job.config) await writeFile(join(job.mapDir, "map.json"), formatMapConfig(job.config));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The middle of a box's top, for the world spawn while it's moved. */
function middleTop(box: Box): Vec3 {
  return [Math.floor((box.min[0] + box.max[0]) / 2), box.max[1] + 1, Math.floor((box.min[2] + box.max[2]) / 2)];
}

/** Runs the throwaway server on `world`, has the pack move the box, stops it (saving) and copies the world to `out`. */
async function moveInServer(world: string, job: ExtractJob, out: string, options: ExtractOptions): Promise<{ tiles: number; drops: number }> {
  const { docker } = options;
  const stale = await findContainerByName(docker, NAME);
  if (stale) await stale.remove({ force: true });
  const staging = await mkdtemp(join(tmpdir(), "minecade-extract-server-"));
  let container: Docker.Container | undefined;
  let serverConsole: ServerConsole | undefined;
  try {
    await buildEditorTemplate(join(staging, "templates", "servers", "editor"));
    const dir = join(staging, "editor");
    await cp(world, join(dir, "world"), { recursive: true });
    await writeFile(join(dir, "map.json"), JSON.stringify({ name: job.name, spawns: [middleTop(job.box)] }));
    const info: ExtractInfo = { mode: "extract" };
    await writeFile(join(dir, "editor.json"), JSON.stringify(info));
    await cp(join(root, "docker", "bds", "entrypoint.sh"), join(dir, "entrypoint.sh"));
    container = await docker.createContainer(containerOptions(options.env));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["templates", "editor"]) as unknown as NodeJS.ReadableStream, { path: "/" });

    serverConsole = await attachConsole(container, options.verbose);
    const recent: string[] = [];
    const events = new EventWaiter();
    serverConsole.onLine((line) => {
      const payload = extractEditPayload(line);
      const event = payload === undefined ? undefined : parseEditorEvent(payload);
      if (event) events.feed(event);
      else if (payload === undefined) {
        recent.push(line);
        if (recent.length > 30) recent.shift();
      }
    });
    const ready = events.next("ready", READY_TIMEOUT_MS);
    await container.start();
    const exited = container.wait();
    const stopped = exited.then(() => {
      throw new Error(`the extraction server stopped. Last lines:\n  ${recent.slice(-10).join("\n  ")}`);
    });
    await Promise.race([ready, stopped]);
    await warmUp(serverConsole);
    const moved = events.next("extracted", MOVE_TIMEOUT_MS);
    await send(serverConsole, { t: "extract", box: job.box, offset: job.offset });
    const result = (await Promise.race([moved, stopped])) as Extract<EditorEvent, { t: "extracted" }>;
    if (!result.ok) throw new Error(`moving the box failed: ${result.error ?? "no reason given"}`);
    serverConsole.send("stop");
    await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    stopped.catch(() => {});
    await rm(out, { recursive: true, force: true });
    await copyDirFromContainer(container, "/bds/worlds/active", out);
    return { tiles: result.tiles ?? 0, drops: result.drops ?? 0 };
  } finally {
    serverConsole?.close();
    await container?.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

function containerOptions(env: Record<string, string>): Docker.ContainerCreateOptions {
  const vars: Record<string, string> = {
    GAME: "editor",
    MAP: "extract",
    SERVER_ID: "extract",
    SERVER_NAME: "Minecade map extraction",
    TRANSPORT: "log",
    EDITOR_MODE: "extract",
    // No ports are published and nobody joins, but the entrypoint wants addresses; the LAN one
    // spares it a lookup of the public one.
    LAN_HOST: env.LAN_HOST ?? "127.0.0.1",
    PUBLIC_HOST: env.LAN_HOST ?? "127.0.0.1",
  };
  return {
    name: NAME,
    Image: BASE_IMAGE,
    Entrypoint: ["/bin/bash", "/editor/entrypoint.sh"],
    Env: Object.entries(vars).map(([key, value]) => `${key}=${value}`),
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
    Labels: { "minecade.role": "editor-extract" },
  };
}

/** The first command after start can arrive garbled ("Unknown command: {"), so the console is warmed up first. */
async function warmUp(serverConsole: ServerConsole): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const answer = serverConsole.waitFor(/There are \d+\/\d+ players online|Unknown command/, 5000).catch(() => "");
    serverConsole.send("list");
    if (/There are/.test(await answer)) return;
  }
  throw new Error("the extraction server's console does not answer");
}

async function send(serverConsole: ServerConsole, message: HostMessage): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = serverConsole.waitFor(/Script event minecade:edit has been sent/, 5000).catch(() => undefined);
    // JSON.stringify escapes control characters, so a message can never spill onto a second console line.
    serverConsole.send(`scriptevent ${EDIT_SCRIPT_EVENT_ID} ${JSON.stringify(message)}`);
    if (await answer) return;
  }
  throw new Error(`the extraction server didn't take the "${message.t}" message`);
}

/** Waits for the pack's events by type. */
class EventWaiter {
  private readonly seen: EditorEvent[] = [];
  private readonly waiting = new Map<string, (event: EditorEvent) => void>();

  feed(event: EditorEvent): void {
    const waiter = this.waiting.get(event.t);
    if (waiter) {
      this.waiting.delete(event.t);
      waiter(event);
    } else {
      this.seen.push(event);
    }
  }

  next(type: EditorEvent["t"], timeoutMs: number): Promise<EditorEvent> {
    const index = this.seen.findIndex((event) => event.t === type);
    if (index >= 0) return Promise.resolve(this.seen.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(type);
        reject(new Error(`the extraction server didn't answer (${type}) within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      this.waiting.set(type, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


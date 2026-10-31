// What every editor server shares, the editor lobby (home-session.ts), Select (select-session.ts)
// or Edit (session.ts): starting its server (on its slot's port, with the editor's packs built from
// this checkout and a folder staged at /editor), talking to the pack over the console, opping map
// editors as they join, sending players on, and stopping. The runner (runner.ts) runs all three.
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Docker from "dockerode";
import * as tar from "tar";
import { EDIT_SCRIPT_EVENT_ID, extractEditPayload, parseEditorEvent, type EditorEvent, type HostMessage, type OpenRequest } from "@minecade/minigame-core/config";
import { BASE_IMAGE, buildBaseImage } from "../build/base-image.ts";
import { attachConsole, connectDocker, findContainerByName, type ServerConsole } from "../build/docker-util.ts";
import { PlayerLog, playerEvent, readEnv } from "../control-panel/core.ts";
import { editorPlayers, type ServerState, type ServerStatus, type Slot } from "./editor-core.ts";
import { buildEditorTemplate } from "./template.ts";

export const root = fileURLToPath(new URL("../../", import.meta.url));
/** Files BDS adds to a running world that a map's world doesn't keep. */
export const RUNTIME_FILES = ["level.dat_old", "world_behavior_packs.json", "world_resource_packs.json"];
const START_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 60_000;
const CLEAN_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 5000;
const OP_ATTEMPTS = 5;

export interface SessionBase {
  slot: Slot;
  /** Echo the server console. */
  verbose: boolean;
  /** Where the session's log lines go (the runner's log). */
  note(text: string): void;
}

export abstract class ServerSession {
  readonly slot: Slot;
  protected readonly verbose: boolean;
  protected state: ServerState = "starting";
  protected error: string | undefined;
  protected env: Record<string, string> = {};
  protected readonly players = new PlayerLog();
  /** The last server console lines, for a failure message. */
  protected readonly recent: string[] = [];
  protected readonly startedAt = new Date().toISOString();
  protected container: Docker.Container | undefined;
  protected console: ServerConsole | undefined;
  protected exited: Promise<number> | undefined;
  protected stopping: Promise<void> | undefined;
  private readonly sink: (text: string) => void;
  private readonly waiters = new Map<string, (event: EditorEvent) => void>();
  private commands: Promise<unknown> = Promise.resolve();
  private cleanupId = 0;
  /** Called once the session is over: stopped (true) or failed (false). */
  onEnd: (ok: boolean) => void = () => {};
  /** A player asked (in the pack) to open a map or a world, or to go to the editor lobby. */
  onOpen: (request: OpenRequest, by: string) => void = () => {};
  /** A player joined or left this server. */
  onPlayer: (name: string, kind: "connected" | "disconnected") => void = () => {};

  constructor(options: SessionBase) {
    this.slot = options.slot;
    this.verbose = options.verbose;
    this.sink = options.note;
  }

  abstract status(): ServerStatus & { mode: string };
  /** What the server shows in the log while starting ("Sumo, Arena (arena_1)"). */
  protected abstract label(): string;
  /** Reads what the session works on (the map or the world), before the server is made. */
  protected abstract prepare(): Promise<void>;
  /** Fills the folder staged at /editor: world/, map.json, editor.json (and the entrypoint, added here). */
  protected abstract stage(dir: string): Promise<void>;
  /** The pack's events other than "ready", "clean" and "open". */
  protected abstract onEvent(event: EditorEvent): void;
  /** Runs once the pack is ready and the console answers. */
  protected abstract afterReady(): Promise<void>;
  /** Stops the server; `save` is false for a quit without saving. Must end with endSession(). */
  protected abstract shutdown(save: boolean): Promise<void>;

  async start(): Promise<void> {
    try {
      await this.boot();
    } catch (error) {
      this.state = "failed";
      this.error = message(error);
      this.note(`Could not start: ${this.error}`);
      if (this.recent.length > 0) this.note(`Last server lines:\n  ${this.recent.slice(-15).join("\n  ")}`);
      await this.removeContainer();
      this.onEnd(false);
      throw error;
    }
  }

  /** Stops (saving where the mode saves). Safe to call more than once. */
  stop(): Promise<void> {
    this.stopping ??= this.shutdown(true);
    return this.stopping;
  }

  /** Stops at once without saving. */
  async forceStop(): Promise<void> {
    this.stopping ??= this.shutdown(false);
    await this.stopping;
  }

  /** A line in this server's log, for work that outlives it (extractions) and the runner's notes. */
  log(text: string): void {
    this.note(text);
  }

  /** Who is on this server now. */
  online(): string[] {
    return this.players.players ?? [];
  }

  /** Sends these players to the editor server on `port`, through the pack. */
  async goto(players: string[], port: number, label: string): Promise<void> {
    if (players.length > 0 && this.state === "ready") await this.send({ t: "goto", players, port, label });
  }

  say(text: string, to?: string): Promise<unknown> {
    return this.send({ t: "say", text, ...(to ? { to } : {}) });
  }

  send(message: HostMessage): Promise<string | undefined> {
    // JSON.stringify escapes control characters, so a message can never spill onto a second console line.
    return this.command(`scriptevent ${EDIT_SCRIPT_EVENT_ID} ${JSON.stringify(message)}`, /Script event minecade:edit has been sent/);
  }

  /** The join address and who is on, for status(). */
  protected common(): ServerStatus {
    return {
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      join: `${this.env.LAN_HOST ?? "?"}:${this.slot.port}`,
      players: this.online(),
      startedAt: this.startedAt,
    };
  }

  // ---- Starting ---------------------------------------------------------------------------

  private async boot(): Promise<void> {
    const envPath = join(root, ".env");
    if (!existsSync(envPath)) throw new Error("no .env file: copy .env.example to .env and fill it in");
    this.env = readEnv(await readFile(envPath, "utf8"));
    if (!this.env.LAN_HOST) throw new Error("set LAN_HOST in .env");
    if (editorPlayers(this.env).length === 0) throw new Error("nobody could join: put your gamertag in LAN_PLAYERS in .env");
    await this.prepare();

    const docker = connectDocker();
    const old = await findContainerByName(docker, this.slot.container);
    if (old) {
      if ((await old.inspect()).State.Running) throw new Error(`${this.slot.container} is already running: stop it first (npm run editor -- stop)`);
      await old.remove({ force: true });
    }
    buildBaseImage(root, this.verbose);
    const staging = await mkdtemp(join(tmpdir(), "minecade-editor-"));
    try {
      this.note("Building the editor's packs...");
      await buildEditorTemplate(join(staging, "templates", "servers", "editor"));
      await this.stage(join(staging, "editor"));
      await cp(join(root, "docker", "bds", "entrypoint.sh"), join(staging, "editor", "entrypoint.sh"));
      this.container = await docker.createContainer(this.containerOptions());
      await this.container.putArchive(tar.c({ cwd: staging, portable: true }, ["templates", "editor"]) as unknown as NodeJS.ReadableStream, { path: "/" });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }

    const container = this.container;
    this.console = await attachConsole(container, this.verbose);
    this.console.onLine((line) => this.onLine(line));
    const ready = this.waitFor("ready", START_TIMEOUT_MS + READY_TIMEOUT_MS);
    const started = this.console.waitFor(/Server started\./, START_TIMEOUT_MS);
    this.note(`Starting: ${this.label()}...`);
    await container.start();
    this.exited = container.wait().then((result: { StatusCode: number }) => result.StatusCode);
    void this.exited.then((code) => this.onExit(code));
    await this.untilExit(started);
    await this.untilExit(ready);
    // The first command after start can arrive garbled ("Unknown command: {"), so warm the console up first.
    let warm = false;
    for (let attempt = 0; attempt < 5 && !warm; attempt++) {
      warm = /There are/.test((await this.command("list", /There are \d+\/\d+ players online|Unknown command/)) ?? "");
    }
    if (!warm) throw new Error("the server console does not answer");
    await this.afterReady();
    this.state = "ready";
    this.note(`Ready on port ${this.slot.port}.`);
  }

  private containerOptions(): Docker.ContainerCreateOptions {
    const port = String(this.slot.port);
    const status = this.status();
    const env: Record<string, string> = {
      GAME: "editor",
      MAP: "map" in status && typeof status.map === "string" ? status.map : status.mode,
      SERVER_ID: this.slot.container,
      IDENTITY: this.slot.identity,
      SERVER_PORT: port,
      SERVER_NAME: "Minecade map editor",
      TRANSPORT: "log",
      EDITOR_MODE: status.mode,
      LAN_HOST: this.env.LAN_HOST,
      PUBLIC_HOST: this.env.PUBLIC_HOST || "auto",
      LAN_PLAYERS: this.env.LAN_PLAYERS ?? "",
    };
    return {
      name: this.slot.container,
      Image: BASE_IMAGE,
      // The plain BDS image has no Minecade entrypoint: the staged copy is this checkout's.
      Entrypoint: ["/bin/bash", "/editor/entrypoint.sh"],
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      ExposedPorts: { [`${port}/tcp`]: {}, [`${port}/udp`]: {} },
      HostConfig: {
        PortBindings: { [`${port}/tcp`]: [{ HostPort: port }], [`${port}/udp`]: [{ HostPort: port }] },
        // The saved identities, so players accept each server's trust once.
        Binds: ["minecade-keys:/keys"],
      },
      // Never managed-by=orchestrator, so the orchestrator's cleanup leaves it alone.
      Labels: { "minecade.role": "editor", "minecade.editor": `${this.slot.id}: ${this.label()}` },
    };
  }

  // ---- Talking to the pack ----------------------------------------------------------------

  private onLine(line: string): void {
    const payload = extractEditPayload(line);
    if (payload !== undefined) {
      const event = parseEditorEvent(payload);
      if (!event) this.note(`Ignored a malformed editor event: ${payload.slice(0, 120)}`);
      else if (event.t === "ready") this.resolve("ready", event);
      else if (event.t === "clean") this.resolve(`clean:${event.id}`, event);
      else if (event.t === "open") this.onOpen(event.request, event.by);
      else this.onEvent(event);
      return;
    }
    this.recent.push(line);
    if (this.recent.length > 40) this.recent.shift();
    this.players.feed(line);
    const joined = playerEvent(line);
    if (joined) {
      this.note(`${joined.name} ${joined.kind === "connected" ? "joined" : "left"}.`);
      if (joined.kind === "connected") void this.op(joined.name);
      this.onPlayer(joined.name, joined.kind);
      return;
    }
    // The pack's own log lines and any errors, without the time stamp.
    if (/\[Scripting\]| ERROR\]/.test(line) && !this.verbose) this.note(`server: ${line.replace(/^\[[^\]]*\]\s*/, "")}`);
  }

  /**
   * Sends a console command, one at a time, and resolves with the line that answered it (tried up
   * to 3 times), or undefined when none did.
   */
  protected command(line: string, reply: RegExp): Promise<string | undefined> {
    const run = async (): Promise<string | undefined> => {
      const serverConsole = this.console;
      if (!serverConsole) return undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = serverConsole.waitFor(reply, REPLY_TIMEOUT_MS).catch(() => undefined);
        serverConsole.send(line);
        const answered = await answer;
        if (answered !== undefined) return answered;
        if (this.state === "stopped" || this.state === "failed") return undefined;
      }
      this.note(`The server didn't answer "${line.slice(0, 80)}"`);
      return undefined;
    };
    const result = this.commands.then(run, run);
    this.commands = result;
    return result;
  }

  /**
   * Everyone here is an operator, so they can use commands. A player who just connected may need a
   * moment ("No targets matched"); one who is an operator already gets "Could not op".
   */
  private async op(name: string): Promise<void> {
    for (let attempt = 0; attempt < OP_ATTEMPTS; attempt++) {
      const answer = await this.command(`op "${name}"`, /Opped|already|Could not op|No targets matched/i);
      if (answer === undefined) return;
      if (!/No targets matched/i.test(answer)) {
        this.note(`${name} is an operator.`);
        return;
      }
      await delay(2000);
    }
    this.note(`Could not make ${name} an operator.`);
  }

  protected waitFor(key: string, timeoutMs: number): Promise<EditorEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error(`the editor pack didn't answer (${key}) within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      this.waiters.set(key, (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  private resolve(key: string, event: EditorEvent): void {
    const waiter = this.waiters.get(key);
    this.waiters.delete(key);
    waiter?.(event);
  }

  /** Waits for `promise`, failing early if the server stops first. */
  private async untilExit<T>(promise: Promise<T>): Promise<T> {
    const exited = this.exited!.then((code) => {
      throw new Error(`the server stopped while starting (exit code ${code})`);
    });
    return Promise.race([promise, exited]);
  }

  private onExit(code: number): void {
    if (this.state !== "ready") return;
    this.state = "failed";
    this.error = `the server stopped unexpectedly (exit code ${code})`;
    this.note(`${this.error}. Last server lines:\n  ${this.recent.slice(-15).join("\n  ")}`);
    this.stopping ??= this.shutdown(false);
  }

  // ---- Stopping ---------------------------------------------------------------------------

  /** Whether the server is still running (it may have crashed). */
  protected async running(): Promise<boolean> {
    return this.container !== undefined && (await this.container.inspect()).State.Running;
  }

  protected async stopServer(): Promise<void> {
    this.console?.send("stop");
    const stopped = await Promise.race([this.exited!.then(() => true), delay(STOP_TIMEOUT_MS).then(() => false)]);
    if (!stopped) {
      this.note("The server didn't stop in time; stopping it hard.");
      await this.container?.kill().catch(() => {});
    }
  }

  /** Asks the pack to remove every marker before a save. True when none are left; otherwise says why. */
  protected async removeMarkers(): Promise<boolean> {
    this.note("Removing the markers before saving the world...");
    const id = ++this.cleanupId;
    const answer = this.waitFor(`clean:${id}`, CLEAN_TIMEOUT_MS).catch(() => undefined);
    await this.send({ t: "cleanup", id });
    const event = (await answer) as Extract<EditorEvent, { t: "clean" }> | undefined;
    if (event?.left === 0) return true;
    const why = !event ? "the pack didn't answer" : (event.error ?? `${event.left} markers are still in it`);
    this.note(`The world was NOT saved (${why}). map.json has every change.`);
    return false;
  }

  /** Stops a server that has nothing to save (the editor lobby, Select). */
  protected async plainShutdown(last: string): Promise<void> {
    const failed = this.state === "failed";
    if (!failed) this.state = "stopping";
    try {
      if (await this.running()) await this.stopServer();
    } catch (error) {
      this.note(`Stopping went wrong: ${message(error)}`);
    } finally {
      await this.endSession(failed, () => this.note(last));
    }
  }

  /** The end of every shutdown: the container goes, and the runner hears about it. */
  protected async endSession(failed: boolean, last?: () => void): Promise<void> {
    this.console?.close();
    await this.removeContainer();
    if (!failed) this.state = "stopped";
    last?.();
    this.onEnd(!failed);
  }

  protected async removeContainer(): Promise<void> {
    await this.container?.remove({ force: true }).catch(() => {});
  }

  protected note(text: string): void {
    this.sink(`${this.slot.label}: ${text}`);
  }
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

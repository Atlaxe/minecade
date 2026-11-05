// A Preview: the real game on a map (the one open in Edit, or one from the editor lobby's Recent),
// on Select's port (the network's game port and identity, so no trust prompt), started by the
// editor itself while the network is down. The game talks over the console (the log transport) the
// way it talks to the orchestrator: it says server_ready once it can take players, and end_game
// once it has sent everyone back: map editors to LOBBY_PORT, which is Edit's (or the editor
// lobby's, for a preview started there), and guests to GUEST_LOBBY_PORT, the editor lobby's
// second entrance. A match that's over asks each player what's next first; end_game then says who picked
// Replay and Edit. The runner (runner.ts) moves the players there and back.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import * as tar from "tar";
import { NET_SCRIPT_EVENT_ID, encodeMessage, parseOutboundEvent } from "@minecade/minigame-core/protocol";
import { attachConsole, connectDocker, findContainerByName, type ServerConsole } from "../build/docker-util.ts";
import { PlayerLog, playerEvent } from "../control-panel/core.ts";
import { EDITOR_IMAGE, editorImage } from "./editor-image.ts";
import { buildPreviewTemplate, type PreviewMap } from "./preview-template.ts";
import { delay, message, root } from "./server-session.ts";

const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 5000;
/** BDS's answers to allowlist add and remove, and to kick. */
const ALLOW_REPLY = /allow ?list|Unknown command|Syntax error/i;
const KICK_REPLY = /Kicked|No targets matched|Unknown command|Syntax error/i;
/** The game prints its events as "[NET] {json}" through the script console (see orchestrator/src/links/logstdin-link.ts). */
const NET_LINE = /^\[[^\]]*\] \[Scripting\] \[NET\] (.*)$/;

export type PreviewState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface PreviewOptions {
  /** Select's port, where the game runs, and the container's name. */
  port: number;
  container: string;
  /** Where the game sends map editors when it ends: Edit's port, or the editor lobby's for a preview started there. */
  returnPort: number;
  /** Where it sends guests: the editor lobby's second entrance. */
  guestPort: number;
  /** The guests it lets in, besides LAN_PLAYERS. */
  guests: string[];
  map: PreviewMap;
  /** "Sumo: Arena", for the mode box and messages. */
  label: string;
  /** The game's player limit, plus room for one more. */
  maxPlayers: number;
  /** Who is expected: the game starts as soon as they're all in. */
  players: string[];
  /** Fake players the match starts with (picked before the preview loads). */
  fakes: number;
  env: Record<string, string>;
  verbose: boolean;
  note(text: string): void;
}

export class PreviewSession {
  state: PreviewState = "starting";
  error: string | undefined;
  /** The game ended (or stopped on its own): the reason, in a few words, and who picked Replay and Edit. Called once. */
  onEnd: ((why: string, next: { replay: string[]; edit: string[] }) => void) | undefined;
  /** A player joined or left the game. */
  onPlayer: () => void = () => {};
  private readonly options: PreviewOptions;
  private container: Docker.Container | undefined;
  private console: ServerConsole | undefined;
  private exited: Promise<number> | undefined;
  private ended = false;
  private serverReady: (() => void) | undefined;
  private readonly players = new PlayerLog();
  private commands: Promise<unknown> = Promise.resolve();

  constructor(options: PreviewOptions) {
    this.options = options;
  }

  /** Builds the game, starts its server and waits until it takes players. Throws (with the reason) when it can't. */
  async start(): Promise<void> {
    const { options } = this;
    const docker = connectDocker();
    const old = await findContainerByName(docker, options.container);
    if (old) await old.remove({ force: true });
    await editorImage(options.note, options.verbose);
    const staging = await mkdtemp(join(tmpdir(), "minecade-preview-"));
    try {
      options.note(`Preview: building ${options.label}...`);
      await buildPreviewTemplate(options.map, join(staging, "templates", "servers", options.map.game));
      await mkdir(join(staging, "editor"), { recursive: true });
      await cp(join(root, "docker", "bds", "entrypoint.sh"), join(staging, "editor", "entrypoint.sh"));
      this.container = await docker.createContainer(this.containerOptions());
      await this.container.putArchive(tar.c({ cwd: staging, portable: true }, ["templates", "editor"]) as unknown as NodeJS.ReadableStream, { path: "/" });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    const container = this.container;
    this.console = await attachConsole(container, options.verbose);
    this.console.onLine((line) => this.onLine(line));
    const ready = new Promise<void>((resolve) => (this.serverReady = resolve));
    const started = this.console.waitFor(/Server started\./, START_TIMEOUT_MS);
    options.note(`Preview: starting ${options.label} on port ${options.port}...`);
    await container.start();
    this.exited = container.wait().then((result: { StatusCode: number }) => result.StatusCode);
    void this.exited.then((code) => this.finish(this.state === "stopping" ? "it was ended" : `the server stopped (code ${code})`));
    const stopped = this.exited.then((code) => Promise.reject(new Error(`the game's server stopped while starting (code ${code}): see the editor's log`)));
    const timeout = delay(START_TIMEOUT_MS).then(() => Promise.reject(new Error("the game's server didn't get ready in time")));
    try {
      await Promise.race([Promise.all([started, ready]), stopped, timeout]);
      // The first command after start can arrive garbled ("Unknown command: {"), and the next one
      // may be End preview or stop, so warm the console up first (as server-session.ts does).
      let warm = false;
      for (let attempt = 0; attempt < 5 && !warm; attempt++) {
        const answer = this.console.waitFor(/There are \d+\/\d+ players online|Unknown command/, REPLY_TIMEOUT_MS).catch(() => "");
        this.console.send("list");
        warm = /There are/.test(await answer);
      }
      if (!warm) throw new Error("the game's server console does not answer");
    } catch (error) {
      this.state = "failed";
      this.error = message(error);
      await this.stop();
      throw error;
    }
    this.state = "ready";
    options.note(`Preview: ${options.label} is ready on port ${options.port}.`);
  }

  /** Ends the match now: the game sends everyone back to Edit, then says end_game. */
  async end(): Promise<void> {
    if (this.state !== "ready") return this.stop();
    this.send({ t: "return_all", reason: "the preview was ended" });
    // A game that doesn't answer (stuck before it can) is stopped instead.
    await Promise.race([this.exited, delay(STOP_TIMEOUT_MS)]);
    if (!this.ended) await this.stop();
  }

  /** Removes the server. */
  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    if (this.state !== "failed") this.state = "stopping";
    const container = this.container;
    if (container) {
      this.console?.send("stop");
      const stopped = await Promise.race([this.exited?.then(() => true) ?? Promise.resolve(true), delay(STOP_TIMEOUT_MS).then(() => false)]);
      if (!stopped) await container.kill().catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    }
    this.console?.close();
    if (this.state !== "failed") this.state = "stopped";
  }

  status(): { state: PreviewState; label: string; port: number; players: string[]; error?: string } {
    return { state: this.state, label: this.options.label, port: this.options.port, players: this.online(), ...(this.error ? { error: this.error } : {}) };
  }

  /** Who is in the game now. */
  online(): string[] {
    return this.players.players ?? [];
  }

  /** Lets a guest in (on), or no longer, while the game runs. */
  async allow(name: string, on: boolean): Promise<void> {
    if (this.state === "ready") await this.command(`allowlist ${on ? "add" : "remove"} "${name}"`, ALLOW_REPLY);
  }

  /** Disconnects a player, with the reason on their screen (nothing happens when they aren't here). */
  async kick(name: string, reason: string): Promise<void> {
    if (this.state === "ready" && this.online().some((online) => online.toLowerCase() === name.toLowerCase())) await this.command(`kick "${name}" ${reason}`, KICK_REPLY);
  }

  /** A console command, one at a time, answered by a line matching `reply` (or given up on). */
  private command(line: string, reply: RegExp): Promise<unknown> {
    const run = async () => {
      const serverConsole = this.console;
      if (!serverConsole) return;
      const answer = serverConsole.waitFor(reply, REPLY_TIMEOUT_MS).catch(() => undefined);
      serverConsole.send(line);
      if ((await answer) === undefined) this.options.note(`Preview: the game didn't answer "${line.slice(0, 80)}"`);
    };
    const result = this.commands.then(run, run);
    this.commands = result;
    return result;
  }

  private onLine(line: string): void {
    this.players.feed(line);
    if (playerEvent(line)) {
      this.onPlayer();
      return;
    }
    const payload = NET_LINE.exec(line.trimEnd())?.[1];
    if (payload === undefined) {
      if (/ ERROR\]|\[Scripting\].*(error|Error)/.test(line) && !this.options.verbose) this.options.note(`preview: ${line.replace(/^\[[^\]]*\]\s*/, "")}`);
      return;
    }
    const event = parseOutboundEvent(payload);
    if (event?.t === "server_ready") this.serverReady?.();
    else if (event?.t === "end_game") {
      this.options.note(`Preview: the game ended (${event.reason}).`);
      this.finish(event.reason === "finished" ? "the match is over" : `the game ended (${event.reason})`, { replay: event.replay ?? [], edit: event.edit ?? [] });
    }
  }

  private finish(why: string, next = { replay: [] as string[], edit: [] as string[] }): void {
    if (this.ended) return;
    this.ended = true;
    this.onEnd?.(why, next);
  }

  private send(message: Parameters<typeof encodeMessage>[0]): void {
    // encodeMessage escapes control characters, so a message never spills onto a second console line.
    this.console?.send(`scriptevent ${NET_SCRIPT_EVENT_ID} ${encodeMessage(message)}`);
  }

  private containerOptions(): Docker.ContainerCreateOptions {
    const { options } = this;
    const port = String(options.port);
    const env: Record<string, string> = {
      GAME: options.map.game,
      MAP: options.map.mapId,
      SERVER_ID: options.container,
      SESSION_ID: "preview",
      IDENTITY: "game",
      SERVER_PORT: port,
      LOBBY_PORT: String(options.returnPort),
      SERVER_NAME: "Minecade preview",
      TRANSPORT: "log",
      LAN_HOST: options.env.LAN_HOST ?? "",
      PUBLIC_HOST: options.env.PUBLIC_HOST || "auto",
      LAN_PLAYERS: options.env.LAN_PLAYERS ?? "",
      ALLOW_LIST: [options.env.LAN_PLAYERS ?? "", ...options.guests].filter(Boolean).join(","),
      GUEST_LOBBY_PORT: String(options.guestPort),
      DEV_MIN_PLAYERS: "1",
      EXPECTED_PLAYERS: options.players.join(","),
      MAX_PLAYERS: String(options.maxPlayers),
      PREVIEW: options.label,
      PREVIEW_FAKES: String(options.fakes),
    };
    return {
      name: options.container,
      Image: EDITOR_IMAGE,
      // The editor image has no Minecade entrypoint: the staged copy is this checkout's.
      Entrypoint: ["/bin/bash", "/editor/entrypoint.sh"],
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      ExposedPorts: { [`${port}/tcp`]: {}, [`${port}/udp`]: {} },
      HostConfig: {
        PortBindings: { [`${port}/tcp`]: [{ HostPort: port }], [`${port}/udp`]: [{ HostPort: port }] },
        Binds: ["minecade-keys:/keys"],
      },
      // Never managed-by=orchestrator, so the orchestrator's cleanup leaves it alone.
      Labels: { "minecade.role": "editor", "minecade.editor": `preview: ${options.label}` },
    };
  }
}

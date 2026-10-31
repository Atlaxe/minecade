// A Preview: the real game on the map open in Edit, on Select's port (the network's game port and
// identity, so no trust prompt), started by the editor itself while the network is down. The game
// talks over the console (the log transport) the way it talks to the orchestrator: it says
// server_ready once it can take players, and end_game once it has sent everyone back to
// LOBBY_PORT, which is Edit's. The runner (runner.ts) moves the players there and back.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import * as tar from "tar";
import { NET_SCRIPT_EVENT_ID, encodeMessage, parseOutboundEvent } from "@minecade/minigame-core/protocol";
import { BASE_IMAGE, buildBaseImage } from "../build/base-image.ts";
import { attachConsole, connectDocker, findContainerByName, type ServerConsole } from "../build/docker-util.ts";
import { buildPreviewTemplate, type PreviewMap } from "./preview-template.ts";
import { delay, message, root } from "./server-session.ts";

const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 5000;
/** The game prints its events as "[NET] {json}" through the script console (see orchestrator/src/links/logstdin-link.ts). */
const NET_LINE = /^\[[^\]]*\] \[Scripting\] \[NET\] (.*)$/;

export type PreviewState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface PreviewOptions {
  /** Select's port, where the game runs, and the container's name. */
  port: number;
  container: string;
  /** Where the game sends everyone when it ends: Edit's port. */
  returnPort: number;
  map: PreviewMap;
  /** "Sumo: Arena", for the mode box and messages. */
  label: string;
  /** The game's player limit, plus room for one more. */
  maxPlayers: number;
  /** Who is expected: the game starts as soon as they're all in. */
  players: string[];
  env: Record<string, string>;
  verbose: boolean;
  note(text: string): void;
}

export class PreviewSession {
  state: PreviewState = "starting";
  error: string | undefined;
  /** The game ended (or stopped on its own): the reason, in a few words. Called once. */
  onEnd: ((why: string) => void) | undefined;
  private readonly options: PreviewOptions;
  private container: Docker.Container | undefined;
  private console: ServerConsole | undefined;
  private exited: Promise<number> | undefined;
  private ended = false;
  private serverReady: (() => void) | undefined;

  constructor(options: PreviewOptions) {
    this.options = options;
  }

  /** Builds the game, starts its server and waits until it takes players. Throws (with the reason) when it can't. */
  async start(): Promise<void> {
    const { options } = this;
    const docker = connectDocker();
    const old = await findContainerByName(docker, options.container);
    if (old) await old.remove({ force: true });
    buildBaseImage(root, options.verbose);
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

  status(): { state: PreviewState; label: string; port: number; error?: string } {
    return { state: this.state, label: this.options.label, port: this.options.port, ...(this.error ? { error: this.error } : {}) };
  }

  private onLine(line: string): void {
    const payload = NET_LINE.exec(line.trimEnd())?.[1];
    if (payload === undefined) {
      if (/ ERROR\]|\[Scripting\].*(error|Error)/.test(line) && !this.options.verbose) this.options.note(`preview: ${line.replace(/^\[[^\]]*\]\s*/, "")}`);
      return;
    }
    const event = parseOutboundEvent(payload);
    if (event?.t === "server_ready") this.serverReady?.();
    else if (event?.t === "end_game") {
      this.options.note(`Preview: the game ended (${event.reason}).`);
      this.finish(event.reason === "finished" ? "the match is over" : `the game ended (${event.reason})`);
    }
  }

  private finish(why: string): void {
    if (this.ended) return;
    this.ended = true;
    this.onEnd?.(why);
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
      ALLOW_LIST: options.env.LAN_PLAYERS ?? "",
      DEV_MIN_PLAYERS: "1",
      EXPECTED_PLAYERS: options.players.join(","),
      MAX_PLAYERS: String(options.maxPlayers),
      PREVIEW: options.label,
    };
    return {
      name: options.container,
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
        Binds: ["minecade-keys:/keys"],
      },
      // Never managed-by=orchestrator, so the orchestrator's cleanup leaves it alone.
      Labels: { "minecade.role": "editor", "minecade.editor": `preview: ${options.label}` },
    };
  }
}

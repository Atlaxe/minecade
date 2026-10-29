// Runs one game session at a time: idle -> starting -> running -> stopping -> idle. It starts the
// game container, waits until the game is ready, tells the lobby, relays the game's events, and
// removes the container when the game ends, fails or crashes.
import { randomBytes } from "node:crypto";
import {
  PROTOCOL_VERSION,
  type InboundMessage,
  type MatchStats,
  type OutboundEvent,
  type StartGame,
  type StatusSnapshot,
} from "@minecade/minigame-core/protocol";
import type { Config } from "./config.ts";
import { LABELS, MANAGED_BY, type DockerAdapter, type GameSpec, type ServerHandle } from "./docker.ts";
import type { ServerLink } from "./links/server-link.ts";
import { describeError, log } from "./log.ts";
import { resolveGameMap, type Registry, type RegistryGame, type RegistryMap } from "./registry.ts";
import type { WarmPool } from "./warm-pool.ts";

const SERVER_STARTED = /^\[[^\]]*\] Server started\./;
const SCRIPT_LINE = /^\[[^\]]*\] \[Scripting\] /;
/** BDS logs each player's Xbox account id as they connect, which keeps stats across gamertag changes. */
const PLAYER_CONNECTED = /\] Player connected: (.+), xuid: (\d+)/;
const START_ATTEMPTS = 4;
const EMPTY_CHECK_MS = 10_000;
/** How long a game gets to send its players home after return_all. */
const RETURN_ALL_WAIT_MS = 10_000;
/** Leftover games may still be backing off from the orchestrator being down (up to 10 s). */
const LEFTOVER_WAIT_MS = 15_000;

export interface SessionDeps {
  config: Config;
  registry: Registry;
  docker: DockerAdapter;
  warmPool: WarmPool;
  /** Opens the transport link to a game server, keyed by its session id. */
  openLink(serverId: string, handle: ServerHandle): ServerLink;
  /** Sends a message to the lobby. Dropped if no lobby is connected. */
  toLobby(message: InboundMessage): void;
  /** The public address players are sent to, resolved from PUBLIC_HOST. */
  publicIp(): Promise<string>;
  /** A stats part from the running game. `xuids` maps lowercase gamertags to Xbox account ids. */
  onMatchStats?(part: MatchStats, context: { game: RegistryGame; xuids: ReadonlyMap<string, string> }): void;
  newSessionId?: () => string;
  random?: () => number;
}

export type StartRequest = Omit<StartGame, "t">;
export type StartResult = { ok: true; sessionId: string } | { ok: false; reason: string };

interface Session {
  id: string;
  requestId: string;
  game: RegistryGame;
  map: RegistryMap;
  state: "starting" | "running" | "stopping";
  publicIp: string;
  players: string[];
  /** Lowercase gamertag to xuid, from the game's console. */
  xuids: Map<string, string>;
  handle?: ServerHandle;
  link?: ServerLink;
  packReady: boolean;
  logReady: boolean;
  lastPlayersAt: number;
  timers: NodeJS.Timeout[];
  cleanup: (() => void)[];
}

export class SessionManager {
  private readonly deps: SessionDeps;
  private session: Session | undefined;
  private idleWaiters: (() => void)[] = [];
  /** True while leftover games from an earlier run are being removed: they still hold the game port. */
  private cleaningUp = false;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  status(): StatusSnapshot {
    const session = this.session;
    if (!session) return { state: "idle", players: [] };
    return { state: session.state, sessionId: session.id, game: session.game.id, map: session.map.id, players: [...session.players] };
  }

  pushStatus(): void {
    this.deps.toLobby({ t: "status", ...this.status() });
  }

  onLobbyEvent(event: OutboundEvent): void {
    if (event.t === "start_game") void this.start(event);
    else if (event.t === "status_request" || event.t === "server_ready") this.pushStatus();
    else log.warn(`lobby sent an unexpected "${event.t}"`);
  }

  async start(request: StartRequest): Promise<StartResult> {
    if (this.cleaningUp) return this.reject(request.requestId, "the network is still starting up; try again in a few seconds");
    if (this.session) return this.reject(request.requestId, `busy: ${this.session.game.name} is ${this.session.state}`);
    const resolved = resolveGameMap(this.deps.registry, request.game, request.map, this.deps.random);
    if (!resolved.ok) return this.reject(request.requestId, resolved.reason);

    const session: Session = {
      id: this.deps.newSessionId?.() ?? randomBytes(6).toString("hex"),
      requestId: request.requestId,
      game: resolved.game,
      map: resolved.map,
      state: "starting",
      publicIp: "",
      players: [],
      xuids: new Map(),
      packReady: false,
      logReady: false,
      lastPlayersAt: Date.now(),
      timers: [],
      cleanup: [],
    };
    this.session = session;
    log.info(`session ${session.id}: starting ${session.game.id} on ${session.map.id} for [${request.players.join(", ")}]`);
    this.deps.toLobby({ t: "game_starting", requestId: session.requestId, sessionId: session.id, game: session.game.id, map: session.map.id });
    this.pushStatus();
    session.timers.push(
      setTimeout(() => void this.finish(session, "the game server did not become ready in time"), this.deps.config.readyTimeoutMs),
    );

    try {
      session.publicIp = await this.deps.publicIp();
      const handle = await this.launch(this.gameSpec(session, request.players));
      if (this.session !== session || session.state === "stopping") {
        // The session ended (aborted or timed out) while the container was starting.
        await handle.remove();
        return { ok: false, reason: "the session ended while starting" };
      }
      session.handle = handle;
      this.watch(session, handle);
      return { ok: true, sessionId: session.id };
    } catch (error) {
      const reason = `could not start the game server: ${describeError(error)}`;
      await this.finish(session, reason);
      return { ok: false, reason };
    }
  }

  /** Ends the current session. Returns false if there is none. */
  end(reason: string): boolean {
    if (!this.session) return false;
    void this.finish(this.session, reason);
    return true;
  }

  /** Startup: sends leftover games from an earlier run home, then removes them. */
  async cleanupLeftovers(): Promise<void> {
    this.cleaningUp = true;
    try {
      await this.removeLeftovers();
    } finally {
      this.cleaningUp = false;
    }
  }

  private async removeLeftovers(): Promise<void> {
    const leftovers = await this.deps.docker.listGames();
    if (leftovers.length === 0) return;
    log.info(`found ${leftovers.length} leftover game container(s); sending players back to the lobby`);
    const links: ServerLink[] = [];
    for (const container of leftovers.filter((candidate) => candidate.running)) {
      try {
        const handle = await this.deps.docker.attach(container.id);
        const link = this.deps.openLink(container.labels[LABELS.session] ?? container.name, handle);
        link.send({ t: "return_all", reason: "The network restarted." });
        links.push(link);
      } catch (error) {
        log.warn(`could not reach leftover ${container.name}: ${describeError(error)}`);
      }
    }
    if (links.length > 0) await delay(LEFTOVER_WAIT_MS);
    for (const link of links) link.close();
    for (const container of leftovers) {
      await this.deps.docker.removeContainer(container.id).catch((error: unknown) => {
        log.error(`could not remove leftover ${container.name}: ${describeError(error)}`);
      });
    }
  }

  /** SIGTERM: sends the players of a running game home, then removes the container. */
  async shutdown(): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.link && session.state !== "stopping") {
      session.link.send({ t: "return_all", reason: "The network is shutting down." });
      await Promise.race([delay(RETURN_ALL_WAIT_MS), this.whenIdle()]);
    }
    if (this.session === session) await this.finish(session, "the orchestrator is shutting down");
    await this.whenIdle();
  }

  private whenIdle(): Promise<void> {
    if (!this.session) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private reject(requestId: string, reason: string): StartResult {
    log.info(`start rejected: ${reason}`);
    this.deps.toLobby({ t: "start_rejected", requestId, reason, status: this.status() });
    return { ok: false, reason };
  }

  private gameSpec(session: Session, players: string[]): GameSpec {
    const config = this.deps.config;
    return {
      name: `minecade-game-${session.id}`,
      image: config.serverImage,
      network: config.network,
      port: config.gamePort,
      env: {
        GAME: session.game.id,
        MAP: session.map.id,
        SERVER_ID: session.id,
        // Every game runs on the game port under one saved identity, so players trust it once.
        IDENTITY: "game",
        SESSION_ID: session.id,
        SERVER_PORT: String(config.gamePort),
        LOBBY_PORT: String(config.lobbyPort),
        TRANSPORT: config.transport,
        ORCH_URL: config.orchestratorUrl,
        LAN_HOST: config.lanHost,
        PUBLIC_HOST: session.publicIp || config.publicHost,
        LAN_PLAYERS: config.lanPlayers,
        ALLOW_LIST: config.allowList,
        DEV_MIN_PLAYERS: config.devMinPlayers,
        EXPECTED_PLAYERS: players.join(","),
        MAX_PLAYERS: String(session.game.maxPlayers + 2),
        SERVER_NAME: `Minecade ${session.game.name}`,
      },
      labels: {
        [LABELS.role]: "game",
        [LABELS.session]: session.id,
        [LABELS.game]: session.game.id,
        [LABELS.managedBy]: MANAGED_BY,
      },
      volumes: config.keysVolume ? { [config.keysVolume]: "/keys" } : {},
    };
  }

  private async launch(spec: GameSpec): Promise<ServerHandle> {
    const warm = await this.deps.warmPool.take(spec.env.GAME, spec.env.MAP);
    if (warm) return warm;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.deps.docker.startGame(spec);
      } catch (error) {
        // Docker Desktop can hold a port for a moment after the previous container is removed.
        if (attempt >= START_ATTEMPTS || !isPortBusy(error)) throw error;
        log.warn(`port ${spec.port} still busy (attempt ${attempt}); retrying`);
        await delay(attempt * 1000);
      }
    }
  }

  private watch(session: Session, handle: ServerHandle): void {
    const link = this.deps.openLink(session.id, handle);
    session.link = link;
    session.cleanup.push(link.onEvent((event) => this.onGameEvent(session, event)));
    session.cleanup.push(
      handle.console.onLine((line) => {
        // Game containers are deleted when the session ends, so keep their script output here.
        if (SCRIPT_LINE.test(line) && !line.includes("[NET]")) log.info(`game ${session.id}: ${line}`);
        const connected = PLAYER_CONNECTED.exec(line);
        if (connected) session.xuids.set(connected[1].toLowerCase(), connected[2]);
        if (session.logReady || !SERVER_STARTED.test(line)) return;
        session.logReady = true;
        this.checkReady(session);
      }),
    );
    void handle.exited.then((code) => {
      if (this.session !== session || session.state === "stopping") return;
      const reason = session.state === "running" ? "crashed" : `the game server crashed while starting (exit code ${code})`;
      void this.finish(session, reason);
    });
  }

  private onGameEvent(session: Session, event: OutboundEvent): void {
    if (this.session !== session || session.state === "stopping") return;
    switch (event.t) {
      case "server_ready": {
        const problem =
          event.protocol !== PROTOCOL_VERSION
            ? `the game speaks protocol ${event.protocol}, the orchestrator ${PROTOCOL_VERSION}`
            : event.transport !== this.deps.config.transport
              ? `the game uses the ${event.transport} transport, the orchestrator ${this.deps.config.transport}`
              : undefined;
        if (problem) {
          void this.finish(session, problem);
          return;
        }
        session.packReady = true;
        this.checkReady(session);
        return;
      }
      case "player_count": {
        const players = Array.isArray(event.players) ? event.players.map(String) : [];
        // Someone was online until now, so the empty clock starts here.
        if (session.players.length > 0 || players.length > 0) session.lastPlayersAt = Date.now();
        session.players = players;
        this.pushStatus();
        return;
      }
      case "match_stats":
        // One raw line per part, whether or not it's stored.
        console.log(`[STATS] ${JSON.stringify(event)}`);
        if (event.sessionId !== session.id) {
          log.warn(`session ${session.id} sent stats for session ${String(event.sessionId)}; ignored`);
          return;
        }
        try {
          this.deps.onMatchStats?.(event, { game: session.game, xuids: session.xuids });
        } catch (error) {
          log.error(`session ${session.id}: could not store stats: ${describeError(error)}`);
        }
        return;
      case "end_game":
        void this.finish(session, String(event.reason));
        return;
      default:
        log.warn(`session ${session.id} sent an unexpected "${event.t}"`);
    }
  }

  /** Ready means both the pack's server_ready and the BDS "Server started." line. */
  private checkReady(session: Session): void {
    if (session.state !== "starting" || !session.packReady || !session.logReady) return;
    session.state = "running";
    session.lastPlayersAt = Date.now();
    for (const timer of session.timers) clearTimeout(timer);
    session.timers = [setInterval(() => this.checkEmpty(session), EMPTY_CHECK_MS)];
    log.info(`session ${session.id}: ready`);
    this.deps.toLobby({
      t: "game_ready",
      requestId: session.requestId,
      sessionId: session.id,
      game: session.game.id,
      map: session.map.id,
      port: this.deps.config.gamePort,
      hosts: { public: session.publicIp, lan: this.deps.config.lanHost },
    });
    this.pushStatus();
  }

  /** Backstop only: games end themselves when empty. This catches a game that doesn't. */
  private checkEmpty(session: Session): void {
    if (session.state !== "running") return;
    if (session.players.length > 0) {
      session.lastPlayersAt = Date.now();
      return;
    }
    if (Date.now() - session.lastPlayersAt >= this.deps.config.emptyBackstopMs) {
      void this.finish(session, "empty for too long");
    }
  }

  /** Ends a session once: removes the container and tells the lobby. */
  private async finish(session: Session, reason: string): Promise<void> {
    if (this.session !== session || session.state === "stopping") return;
    const wasRunning = session.state === "running";
    session.state = "stopping";
    for (const timer of session.timers) clearTimeout(timer);
    for (const off of session.cleanup) off();
    log.info(`session ${session.id}: ending (${reason})`);
    this.pushStatus();
    session.link?.close();
    try {
      await session.handle?.remove();
    } catch (error) {
      log.error(`session ${session.id}: could not remove the container: ${describeError(error)}`);
    }
    session.handle?.console.close();
    this.session = undefined;
    this.deps.toLobby(
      wasRunning
        ? { t: "game_ended", sessionId: session.id, reason }
        : { t: "game_failed", requestId: session.requestId, sessionId: session.id, reason },
    );
    this.pushStatus();
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

function isPortBusy(error: unknown): boolean {
  return /port is already allocated|ports are not available|address already in use/i.test(describeError(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

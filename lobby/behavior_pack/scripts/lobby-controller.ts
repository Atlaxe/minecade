// Starting games from the lobby, as plain logic. It never touches the Minecraft API itself: main.ts
// passes in ports for players and the orchestrator, so this file is unit-tested with plain data.
// The terminal (terminal-controller.ts) shows the choices and calls request() on Start.
//
// Two pieces of state are kept apart on purpose:
//   status   mirrors the orchestrator's latest status. It decides whether a game can start. It
//            never triggers transfers.
//   pending  this lobby's own start request. Replies for any other requestId are ignored, which
//            also covers stale messages queued from before a lobby restart.
import { Scope, nameOf, say, type Chime, type InboundMessage, type OutboundEvent, type Registry, type RegistryGame, type StatusSnapshot } from "@minecade/minigame-core";
import { isDemoGame } from "./demo-games.ts";
import { settingsFor } from "./game-screen.ts";
import { TeamPickController, type TeamPickPorts } from "./team-pick-controller.ts";

export interface GameChoice {
  game: RegistryGame;
  playable: boolean;
  /** Why it can't be played right now, shown on the button. */
  reason?: string;
}

export interface LobbyPorts {
  send(event: OutboundEvent): void;
  onlinePlayers(): string[];
  transfer(name: string, port: number): void;
  notify(to: string | "all", text: string): void;
  chime(to: string, chime: Chime): void;
  closeForms(name: string): void;
  /** The live team forms and the hologram, for team games where players pick in the lobby. */
  teamPicks?: TeamPickPorts;
  /** The hologram's countdown screen: while the game's server boots, then each second before everyone is sent. */
  countdown?(view: CountdownView): void;
  /** A start is over (the players were sent, or it failed): the terminal's hologram can show its last screen again. */
  startEnded?(): void;
}

/** A game that's starting, for the hologram: `left` is unset while its server boots, then the seconds before everyone is sent. */
export interface CountdownView {
  game: string;
  /** The map's name, or "a random map". */
  map: string;
  left?: number;
}

export interface LobbyOptions {
  registry: Registry;
  /** Replaces every game's minimum player count when set (solo testing). */
  devMinPlayers?: number;
  /** Made-up games listed after the real ones (menu testing); they can't start. See demo-games.ts. */
  demoGames?: RegistryGame[];
  newRequestId?: () => string;
  /** Longer than the orchestrator's 120 s ready timeout, so its answer normally comes first. */
  startTimeoutTicks?: number;
  countdownSeconds?: number;
}

interface Pending {
  requestId: string;
  game: RegistryGame;
  mapName: string;
  players: string[];
  sessionId?: string;
  /** The timeout, the team picking and the countdown live here, so clearing the request stops them all. */
  scope: Scope;
  /** Team picking, for team games set to Pick; the players are sent once it ends. */
  teamPick?: TeamPickController;
  /** The game's port, once it's ready. */
  port?: number;
}

export class LobbyController {
  private readonly ports: LobbyPorts;
  private readonly scope: Scope;
  private readonly games: RegistryGame[];
  private readonly devMinPlayers: number | undefined;
  private readonly newRequestId: () => string;
  private readonly startTimeoutTicks: number;
  private readonly countdownSeconds: number;
  private status: StatusSnapshot = { state: "idle", players: [] };
  private pending: Pending | undefined;

  constructor(ports: LobbyPorts, scope: Scope, options: LobbyOptions) {
    this.ports = ports;
    this.scope = scope;
    this.games = [...options.registry.games, ...(options.demoGames ?? [])];
    this.devMinPlayers = options.devMinPlayers;
    this.newRequestId = options.newRequestId ?? randomId;
    this.startTimeoutTicks = options.startTimeoutTicks ?? 150 * 20;
    this.countdownSeconds = options.countdownSeconds ?? 3;
  }

  onMessage(message: InboundMessage): void {
    const pending = this.pending;
    switch (message.t) {
      case "status":
        this.status = message;
        // The orchestrator moved on to a session that isn't ours: our request is gone.
        if (pending?.sessionId && message.sessionId !== pending.sessionId) this.clearPending();
        return;
      case "game_starting":
        if (pending?.requestId === message.requestId) pending.sessionId = message.sessionId;
        return;
      case "game_ready":
        if (pending?.requestId === message.requestId && pending.teamPick) {
          pending.sessionId = message.sessionId;
          pending.port = message.port;
          pending.teamPick.ready();
          return;
        }
        if (pending?.requestId === message.requestId) void this.sendPlayers(pending, message.port);
        return;
      case "start_rejected":
        if (pending?.requestId !== message.requestId) return;
        this.ports.notify("all", say.error(`Couldn't start ${pending.game.name}: ${message.reason}`));
        this.clearPending();
        return;
      case "game_failed":
        if (pending?.requestId !== message.requestId) return;
        this.ports.notify("all", say.error(`${pending.game.name} failed to start: ${message.reason}`));
        this.clearPending();
        return;
      case "game_ended":
        if (pending?.sessionId === message.sessionId) this.clearPending();
        this.ports.notify("all", say.minor(`The last game ended (${message.reason}). Use the terminal to start another.`));
        return;
      default:
        return;
    }
  }

  /** Every game, and whether there are enough players in the lobby for it right now. */
  choices(): GameChoice[] {
    const online = this.ports.onlinePlayers().length;
    return this.games.map((game) => {
      const needed = this.devMinPlayers ?? game.minPlayers;
      return online >= needed ? { game, playable: true } : { game, playable: false, reason: `needs at least ${needed} players` };
    });
  }

  /** Why no game can start right now (one is starting, running or wrapping up), if so. */
  busy(): string | undefined {
    if (this.pending) return say.info(`Starting ${this.pending.game.name}, hang on.`);
    const game = this.gameName(this.status.game);
    if (this.status.state === "starting" || this.status.state === "running") {
      return say.info(`${game} is in progress (${this.status.players.length} playing). You'll join the next round.`);
    }
    if (this.status.state === "stopping") return say.minor("Wrapping up the last game. Try again in a moment.");
    return undefined;
  }

  /**
   * Starts a game for everyone in the lobby. Checks again first, since someone else may have
   * started a game, or players may have left, while the menus were open. Returns why not, if so.
   */
  request(starter: string, gameId: string, mapId: string, settings: Record<string, string> = {}): string | undefined {
    const busy = this.busy();
    if (busy) return busy;
    const picked = this.choices().find((candidate) => candidate.game.id === gameId);
    if (!picked) return say.error(`There's no game called ${gameId}.`);
    if (!picked.playable) return say.warn(`${picked.game.name} ${picked.reason}.`);
    if (isDemoGame(gameId)) return say.warn(`${picked.game.name} is a demo game, so it can't start.`);
    this.start(starter, picked.game, mapId, settings);
    return undefined;
  }

  /** True while this lobby is starting a game (from the request until everyone is sent). */
  get starting(): boolean {
    return this.pending !== undefined;
  }

  onPlayerJoined(name: string): void {
    const busy = this.busy();
    if (busy) this.ports.notify(name, busy);
  }

  onPlayerLeft(name: string): void {
    this.pending?.teamPick?.leave(name);
  }

  /** A player joined a team on their team form (or went back to random, with `team` undefined). */
  pickTeam(name: string, team: string | undefined): void {
    this.pending?.teamPick?.pick(name, team);
  }

  /** Brings a player's team form back while teams are being picked. False if there's none for them. */
  reopenTeamPick(name: string): boolean {
    return this.pending?.teamPick?.reopen(name) ?? false;
  }

  private start(starter: string, game: RegistryGame, mapId: string, settings: Record<string, string>): void {
    const players = this.ports.onlinePlayers().slice(0, game.maxPlayers);
    const mapName = mapId === "random" ? "a random map" : (game.maps.find((map) => map.id === mapId)?.name ?? mapId);
    const pending: Pending = { requestId: this.newRequestId(), game, mapName, players, scope: this.scope.child("pending") };
    this.pending = pending;
    // No answer at all (orchestrator down): ask for the real state instead of guessing.
    pending.scope.timeout(() => {
      this.ports.notify("all", say.error(`${game.name} didn't start in time. Try again.`));
      this.clearPending();
      this.ports.send({ t: "status_request" });
    }, this.startTimeoutTicks);
    this.ports.notify("all", say.important(`${nameOf(starter)} is starting ${game.name} on ${mapName}.`));
    // Team games set to Pick: the players pick here while the game server boots ("pick" tells the
    // game to wait for these picks instead of handing out its own picker). The team view owns the
    // hologram until then; otherwise it shows the countdown screen while the server boots.
    const picking = lobbyPicksTeams(game, settings) && this.ports.teamPicks !== undefined;
    if (!picking) this.ports.countdown?.({ game: game.name, map: mapName });
    const sent = picking ? { ...settings, teams: "pick" } : settings;
    this.ports.send({ t: "start_game", requestId: pending.requestId, game: game.id, map: mapId, players, settings: sent });
    if (picking && game.teams && this.ports.teamPicks) {
      pending.teamPick = new TeamPickController(this.ports.teamPicks, pending.scope.child("teams"), {
        game: game.name,
        players,
        teams: game.teams,
        online: () => this.ports.onlinePlayers(),
        done: (picks) => this.picksDone(pending, picks),
      });
    }
  }

  /** Picking ended (the game server is ready): pass the picks on, then send everyone. */
  private picksDone(pending: Pending, picks: Record<string, string>): void {
    if (this.pending !== pending || pending.sessionId === undefined || pending.port === undefined) return;
    this.ports.send({ t: "team_picks", sessionId: pending.sessionId, picks });
    void this.sendPlayers(pending, pending.port);
  }

  private async sendPlayers(pending: Pending, port: number): Promise<void> {
    const online = new Set(this.ports.onlinePlayers());
    for (const name of pending.players) if (online.has(name)) this.ports.closeForms(name);
    for (let left = this.countdownSeconds; left > 0; left--) {
      this.ports.countdown?.({ game: pending.game.name, map: pending.mapName, left });
      for (const name of pending.players) if (online.has(name)) this.ports.chime(name, left <= 3 ? "bell" : "tick");
      await pending.scope.wait(20);
    }
    // Look players up now: some may have left during the countdown.
    const stillHere = new Set(this.ports.onlinePlayers());
    for (const name of pending.players) if (stillHere.has(name)) this.ports.transfer(name, port);
    for (const name of stillHere) {
      if (!pending.players.includes(name)) this.ports.notify(name, say.minor(`${pending.game.name} started without you. You'll join the next round.`));
    }
    if (this.pending === pending) this.clearPending();
  }

  private clearPending(): void {
    this.pending?.scope.dispose();
    this.pending = undefined;
    this.ports.startEnded?.();
  }

  private gameName(id: string | undefined): string {
    return this.games.find((game) => game.id === id)?.name ?? id ?? "A game";
  }
}

/** Team games whose players pick their own team, with Teams set to Pick on the game screen. */
export function lobbyPicksTeams(game: RegistryGame, settings: Record<string, string>): boolean {
  return settingsFor(game).some((setting) => setting.id === "teams") && settings.teams !== "random";
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

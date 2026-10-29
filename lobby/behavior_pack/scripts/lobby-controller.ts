// The lobby's game selector, as plain logic. It never touches the Minecraft API itself: main.ts
// passes in ports for players, forms and the orchestrator, so this file is unit-tested with
// plain data.
//
// Two pieces of state are kept apart on purpose:
//   status   mirrors the orchestrator's latest status. It decides whether a game can start and
//            what the action bar says. It never triggers transfers.
//   pending  this lobby's own start request. Replies for any other requestId are ignored, which
//            also covers stale messages queued from before a lobby restart.
import { COLOR, Scope, nameOf, say, type Chime, type InboundMessage, type OutboundEvent, type Registry, type RegistryGame, type StatusSnapshot } from "@minecade/minigame-core";

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
  title(to: string | "all", title: string, subtitle?: string): void;
  chime(to: string, chime: Chime): void;
  closeForms(name: string): void;
  /**
   * Walks a player through picking a game and map and confirming. Resolves undefined if they
   * back out. Never settles if `scope` is disposed first.
   */
  chooseGame(name: string, scope: Scope, choices: GameChoice[]): Promise<{ game: string; map: string } | undefined>;
}

export interface LobbyOptions {
  registry: Registry;
  /** Replaces every game's minimum player count when set (solo testing). */
  devMinPlayers?: number;
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
  /** The timeout and the countdown live here, so clearing the request stops both. */
  scope: Scope;
}

export class LobbyController {
  private readonly ports: LobbyPorts;
  private readonly scope: Scope;
  private readonly registry: Registry;
  private readonly devMinPlayers: number | undefined;
  private readonly newRequestId: () => string;
  private readonly startTimeoutTicks: number;
  private readonly countdownSeconds: number;
  private status: StatusSnapshot = { state: "idle", players: [] };
  private pending: Pending | undefined;
  /** Players with the selector open, each with a scope that closes it. */
  private readonly selectors = new Map<string, Scope>();

  constructor(ports: LobbyPorts, scope: Scope, options: LobbyOptions) {
    this.ports = ports;
    this.scope = scope;
    this.registry = options.registry;
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

  /** A player used the compass. */
  async openSelector(name: string): Promise<void> {
    if (this.selectors.has(name)) return;
    const busy = this.busyMessage();
    if (busy) {
      this.ports.notify(name, busy);
      return;
    }
    const scope = this.scope.child(`selector:${name}`);
    this.selectors.set(name, scope);
    scope.add(() => this.selectors.delete(name));
    const choice = await this.ports.chooseGame(name, scope, this.gameChoices());
    scope.dispose();
    if (!choice) return;

    // Someone else may have started a game, or players may have left, while the forms were open.
    const busyNow = this.busyMessage();
    if (busyNow) {
      this.ports.notify(name, busyNow);
      return;
    }
    const picked = this.gameChoices().find((candidate) => candidate.game.id === choice.game);
    if (!picked) return;
    if (!picked.playable) {
      this.ports.notify(name, say.warn(`${picked.game.name} ${picked.reason}.`));
      return;
    }
    this.start(name, picked.game, choice.map);
  }

  /** True while this lobby is starting a game (from the request until everyone is sent). */
  get starting(): boolean {
    return this.pending !== undefined;
  }

  onPlayerJoined(name: string): void {
    const busy = this.busyMessage();
    if (busy) this.ports.notify(name, busy);
  }

  onPlayerLeft(name: string): void {
    this.selectors.get(name)?.dispose();
  }

  private start(starter: string, game: RegistryGame, mapId: string): void {
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
    this.ports.title("all", say.info(`Starting ${game.name}`), say.minor(mapName));
    this.ports.send({ t: "start_game", requestId: pending.requestId, game: game.id, map: mapId, players });
  }

  private async sendPlayers(pending: Pending, port: number): Promise<void> {
    const online = new Set(this.ports.onlinePlayers());
    for (const name of pending.players) if (online.has(name)) this.ports.closeForms(name);
    for (let left = this.countdownSeconds; left > 0; left--) {
      for (const name of pending.players) {
        if (!online.has(name)) continue;
        this.ports.title(name, `${COLOR.highlight}${left}`, say.minor(`Joining ${pending.game.name}`));
        this.ports.chime(name, left <= 3 ? "bell" : "tick");
      }
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
  }

  private busyMessage(): string | undefined {
    if (this.pending) return say.info(`Starting ${this.pending.game.name}, hang on.`);
    const game = this.gameName(this.status.game);
    if (this.status.state === "starting" || this.status.state === "running") {
      return say.info(`${game} is in progress (${this.status.players.length} playing). You'll join the next round.`);
    }
    if (this.status.state === "stopping") return say.minor("Wrapping up the last game. Try again in a moment.");
    return undefined;
  }

  private gameChoices(): GameChoice[] {
    const online = this.ports.onlinePlayers().length;
    return this.registry.games.map((game) => {
      const needed = this.devMinPlayers ?? game.minPlayers;
      return online >= needed ? { game, playable: true } : { game, playable: false, reason: `needs at least ${needed} players` };
    });
  }

  private gameName(id: string | undefined): string {
    return this.registry.games.find((game) => game.id === id)?.name ?? id ?? "A game";
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// The lobby terminal, as plain logic: one player at a time uses it, and the hologram above it
// shows everyone what they're doing. main.ts passes in ports for forms, players, the lobby and
// the hologram, so this file is unit-tested with plain data.
//
// The user keeps the terminal until they close the menu, start a game, leave, walk away, or
// leave it untouched for a while; then the hologram goes back to the idle screen.
//
//   main menu ── Play ──> game grid ──> game screen (map, settings) ── Start ──> the game starts
//             └─ Stats ─> the stats screens
// Closing a menu goes back one step; closing the main menu ends the session.
//
// The terminal remembers each player's place (see Memory): however a session ends (the X, Esc on
// the main menu, walking away, timing out, leaving, or a game starting), their next tap opens the
// menu they were on, with their choices on each game's screen. The stats screens keep their own
// place (stats-controller.ts).
import { Scope, say, type RegistryGame } from "@minecade/minigame-core";
import { CLOSE, defaultSettings, gameAction, nextSetting, settingsFor } from "./game-screen.ts";
import { gameContent, gamesContent, idleContent, mainContent, type HoloContent } from "./holo-content.ts";
import { previewContent, type PreviewScreen } from "./holo-preview.ts";
import type { GameChoice } from "./lobby-controller.ts";
import type { GameView } from "./menus.ts";

export interface TerminalPorts {
  /**
   * The themed main menu. Resolves the choice, undefined if closed, or CLOSE for the X (as every
   * themed menu does). Never settles if `scope` is disposed first.
   */
  mainMenu(name: string, scope: Scope): Promise<"play" | "stats" | "preview" | typeof CLOSE | undefined>;
  /** DEV_HOLO_PREVIEW: the list of hologram screens to preview. Resolves the picked one, or undefined to go back. */
  previewMenu(name: string, scope: Scope): Promise<PreviewScreen | undefined>;
  /** The game grid. Resolves the index of the chosen game, or undefined to go back. */
  gamesMenu(name: string, scope: Scope, choices: GameChoice[]): Promise<number | typeof CLOSE | undefined>;
  /** The game screen. Resolves the index of the pressed button, or undefined to go back. */
  gameMenu(name: string, scope: Scope, view: GameView): Promise<number | typeof CLOSE | undefined>;
  /**
   * The stats screens. Resolves when the player is done with them: true if they pressed the X.
   * They show content on the hologram through `show`. Never settles if `scope` is disposed first.
   */
  stats(name: string, scope: Scope, show: (content: HoloContent) => void): Promise<boolean>;
  /** Every game, and whether there are enough players for it. */
  choices(): GameChoice[];
  /** Why no game can start right now, if so. */
  busy(): string | undefined;
  /** True while the lobby is starting a game: the terminal waits, and the hologram is the start's. */
  starting(): boolean;
  /** Brings back a player's team form while teams are being picked; false if there's none for them. */
  reopenTeamPick(name: string): boolean;
  /** Starts a game; returns why not, if it can't. */
  request(name: string, game: string, map: string, settings: Record<string, string>): string | undefined;
  notify(name: string, text: string): void;
  closeForms(name: string): void;
  /** Blocks from the player to the terminal, or undefined if they're not here. */
  distance(name: string): number | undefined;
  hologram(content: HoloContent): void;
}

export interface TerminalOptions {
  /** Walking further than this ends the session. */
  maxDistance?: number;
  /** A session with no new screen for this long ends. */
  idleTicks?: number;
  now(): number;
}

/** A game screen's choices: the Random switch, the chosen map and the settings. */
type GamePicks = Pick<GameView, "random" | "map" | "settings">;

/**
 * What the terminal keeps for each player between taps, by name. It lives as long as the lobby's
 * script does, so it outlasts a trip to a game and back, but not a lobby restart.
 */
interface Memory {
  /** The menu they were on last. */
  screen: "main" | "games" | "game" | "stats";
  /** The game whose screen they opened last. */
  game?: string;
  /** Their choices on each game's screen they've opened. */
  games: Map<string, GamePicks>;
}

export class TerminalController {
  private readonly ports: TerminalPorts;
  private readonly scope: Scope;
  private readonly maxDistance: number;
  private readonly idleTicks: number;
  private readonly now: () => number;
  private user: string | undefined;
  private session: Scope | undefined;
  /** A previewed screen that stays on the hologram until the terminal is tapped again. */
  private pinned: HoloContent | undefined;
  private lastActivity = 0;
  private readonly memory = new Map<string, Memory>();

  constructor(ports: TerminalPorts, scope: Scope, options: TerminalOptions) {
    this.ports = ports;
    this.scope = scope;
    this.maxDistance = options.maxDistance ?? 8;
    this.idleTicks = options.idleTicks ?? 120 * 20;
    this.now = options.now;
  }

  /** Who is using the terminal, if anyone. */
  get current(): string | undefined {
    return this.user;
  }

  /** A player tapped the terminal. */
  async tap(name: string): Promise<void> {
    if (this.user !== undefined) {
      if (this.user !== name) this.ports.notify(name, say.minor(`${this.user} is using the terminal.`));
      return;
    }
    if (this.ports.starting()) {
      if (!this.ports.reopenTeamPick(name)) this.ports.notify(name, say.info("A game is starting, hang on."));
      return;
    }
    const scope = this.scope.child(`terminal:${name}`);
    this.pinned = undefined;
    this.user = name;
    this.session = scope;
    scope.add(() => {
      this.user = undefined;
      this.session = undefined;
      this.refresh();
    });
    scope.interval(() => this.watch(name), 10);
    const memory = this.memoryOf(name);
    try {
      // The first pass opens the menu the player was on last; after that, the main menu.
      for (let resume = memory.screen !== "main"; ; resume = false) {
        let choice: "play" | "stats" | "preview";
        if (resume) choice = memory.screen === "stats" ? "stats" : "play";
        else {
          memory.screen = "main";
          this.show(mainContent());
          const picked = await this.ports.mainMenu(name, scope);
          if (picked === undefined || picked === CLOSE) return;
          choice = picked;
        }
        if (choice === "play") {
          this.show(mainContent("play"));
          if (await this.play(name, scope, memory, resume)) return;
        } else if (choice === "preview") {
          const screen = await this.ports.previewMenu(name, scope);
          if (screen === undefined) continue;
          // The session ends and the screen stays up (refresh shows it) until the next tap.
          this.pinned = previewContent(screen, this.ports.choices(), name);
          return;
        } else {
          memory.screen = "stats";
          this.show(mainContent("stats"));
          if (await scope.guard(this.ports.stats(name, scope, (content) => this.show(content)))) return;
        }
      }
    } finally {
      scope.dispose();
    }
  }

  /**
   * Shows the idle screen (or a pinned preview) unless someone is using the terminal or a game is
   * starting (at boot, when the terminal frees up, and when a start ends). While a game starts, the
   * hologram keeps the game's screen, or shows the team picks.
   */
  refresh(): void {
    if (this.user === undefined && !this.ports.starting()) this.ports.hologram(this.pinned ?? idleContent());
  }

  onPlayerLeft(name: string): void {
    if (this.user === name) this.session?.dispose();
  }

  /**
   * The game grid, then a game's screen. Resolves true when the session is over: a game is
   * starting, or the player pressed the X. Resuming on a game's screen opens it first; going back
   * from it shows the grid.
   */
  private async play(name: string, scope: Scope, memory: Memory, resume: boolean): Promise<boolean> {
    let open = resume && memory.screen === "game" ? memory.game : undefined;
    for (;;) {
      const busy = this.ports.busy();
      if (busy) {
        this.ports.notify(name, busy);
        return false;
      }
      if (open === undefined) {
        memory.screen = "games";
        const choices = this.ports.choices();
        this.show(gamesContent(choices));
        const index = await this.ports.gamesMenu(name, scope, choices);
        if (index === undefined) return false;
        if (index === CLOSE) return true;
        open = choices[index]?.game.id;
      }
      if (open !== undefined && (await this.gameScreen(name, scope, open, memory))) return true;
      open = undefined;
    }
  }

  /**
   * One game's screen: Random map or a chosen one, the settings, then Start. Resolves true when the
   * session is over: the game is starting, or the player pressed the X. Picking a map tile turns
   * Random off. The player's choices are kept for their next visit.
   */
  private async gameScreen(name: string, scope: Scope, gameId: string, memory: Memory): Promise<boolean> {
    memory.screen = "game";
    memory.game = gameId;
    for (;;) {
      // Look the game up each time: players may have joined or left since.
      const choice = this.ports.choices().find((candidate) => candidate.game.id === gameId);
      if (!choice) return false;
      const picks = picksFor(memory, choice.game);
      const view = { choice, ...picks };
      this.show(gameContent(view));
      const selection = await this.ports.gameMenu(name, scope, view);
      if (selection === undefined) return false;
      if (selection === CLOSE) return true;
      const action = gameAction(choice.game, selection);
      if (action?.kind === "random") picks.random = !picks.random;
      else if (action?.kind === "map") {
        picks.random = false;
        picks.map = action.map;
      } else if (action?.kind === "setting") {
        const setting = settingsFor(choice.game).find((candidate) => candidate.id === action.id);
        if (setting) picks.settings = { ...picks.settings, [setting.id]: nextSetting(setting, picks.settings[setting.id]) };
      } else if (action?.kind === "start") {
        const refusal = this.ports.request(name, gameId, picks.random ? "random" : picks.map, picks.settings);
        if (refusal === undefined) return true;
        this.ports.notify(name, refusal);
        if (this.ports.busy()) return false;
      }
    }
  }

  private memoryOf(name: string): Memory {
    let memory = this.memory.get(name);
    if (!memory) {
      memory = { screen: "main", games: new Map() };
      this.memory.set(name, memory);
    }
    return memory;
  }

  private show(content: HoloContent): void {
    this.lastActivity = this.now();
    this.ports.hologram(content);
  }

  /** Ends the session when its player walks away or leaves it alone too long. */
  private watch(name: string): void {
    const distance = this.ports.distance(name);
    const idle = this.now() - this.lastActivity >= this.idleTicks;
    if (distance !== undefined && distance <= this.maxDistance && !idle) return;
    if (distance !== undefined) {
      this.ports.closeForms(name);
      this.ports.notify(name, say.minor(idle ? "The terminal timed out." : "You walked away from the terminal."));
    }
    this.session?.dispose();
  }
}

/** A player's choices on a game's screen: the ones they made last time, or Random on, the first map and the default settings. */
function picksFor(memory: Memory, game: RegistryGame): GamePicks {
  let picks = memory.games.get(game.id);
  if (!picks) {
    picks = { random: true, map: game.maps[0]?.id ?? "random", settings: defaultSettings(game) };
    memory.games.set(game.id, picks);
  }
  return picks;
}

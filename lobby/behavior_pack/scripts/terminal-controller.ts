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
import { Scope, say } from "@minecade/minigame-core";
import { defaultSettings, gameAction, nextSetting, settingsFor } from "./game-screen.ts";
import { gameContent, gamesContent, idleContent, mainContent, type HoloContent } from "./holo-content.ts";
import type { GameChoice } from "./lobby-controller.ts";
import type { GameView } from "./menus.ts";

export interface TerminalPorts {
  /** The themed main menu. Resolves the choice, or undefined if closed. Never settles if `scope` is disposed first. */
  mainMenu(name: string, scope: Scope): Promise<"play" | "stats" | undefined>;
  /** The game grid. Resolves the index of the chosen game, or undefined to go back. */
  gamesMenu(name: string, scope: Scope, choices: GameChoice[]): Promise<number | undefined>;
  /** The game screen. Resolves the index of the pressed button, or undefined to go back. */
  gameMenu(name: string, scope: Scope, view: GameView): Promise<number | undefined>;
  /** The stats screens (resolves when the player is done with them). They show content on the hologram through `show`. */
  stats(name: string, show: (content: HoloContent) => void): Promise<void>;
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

export class TerminalController {
  private readonly ports: TerminalPorts;
  private readonly scope: Scope;
  private readonly maxDistance: number;
  private readonly idleTicks: number;
  private readonly now: () => number;
  private user: string | undefined;
  private session: Scope | undefined;
  private lastActivity = 0;

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
    this.user = name;
    this.session = scope;
    scope.add(() => {
      this.user = undefined;
      this.session = undefined;
      this.refresh();
    });
    scope.interval(() => this.watch(name), 10);
    try {
      for (;;) {
        this.show(mainContent());
        const choice = await this.ports.mainMenu(name, scope);
        if (choice === undefined) return;
        if (choice === "play") {
          this.show(mainContent("play"));
          if (await this.play(name, scope)) return;
        } else {
          this.show(mainContent("stats"));
          await scope.guard(this.ports.stats(name, (content) => this.show(content)));
        }
      }
    } finally {
      scope.dispose();
    }
  }

  /**
   * Shows the idle screen unless someone is using the terminal or a game is starting (at boot, when
   * the terminal frees up, and when a start ends). While a game starts, the hologram keeps the
   * game's screen, or shows the team picks.
   */
  refresh(): void {
    if (this.user === undefined && !this.ports.starting()) this.ports.hologram(idleContent());
  }

  onPlayerLeft(name: string): void {
    if (this.user === name) this.session?.dispose();
  }

  /** The game grid, then a game's screen. Resolves true once a game is starting. */
  private async play(name: string, scope: Scope): Promise<boolean> {
    for (;;) {
      const busy = this.ports.busy();
      if (busy) {
        this.ports.notify(name, busy);
        return false;
      }
      const choices = this.ports.choices();
      this.show(gamesContent(choices));
      const index = await this.ports.gamesMenu(name, scope, choices);
      if (index === undefined) return false;
      const choice = choices[index];
      if (choice && (await this.gameScreen(name, scope, choice.game.id))) return true;
    }
  }

  /**
   * One game's screen: Random map or a chosen one, the settings, then Start. Resolves true once the
   * game is starting. Picking a map tile turns Random off.
   */
  private async gameScreen(name: string, scope: Scope, gameId: string): Promise<boolean> {
    let random = true;
    let map: string | undefined;
    let settings: Record<string, string> | undefined;
    for (;;) {
      // Look the game up each time: players may have joined or left since.
      const choice = this.ports.choices().find((candidate) => candidate.game.id === gameId);
      if (!choice) return false;
      settings ??= defaultSettings(choice.game);
      map ??= choice.game.maps[0]?.id ?? "random";
      const view = { choice, random, map, settings };
      this.show(gameContent(view));
      const selection = await this.ports.gameMenu(name, scope, view);
      if (selection === undefined) return false;
      const action = gameAction(choice.game, selection);
      if (action?.kind === "random") random = !random;
      else if (action?.kind === "map") {
        random = false;
        map = action.map;
      } else if (action?.kind === "setting") {
        const setting = settingsFor(choice.game).find((candidate) => candidate.id === action.id);
        if (setting) settings = { ...settings, [setting.id]: nextSetting(setting, settings[setting.id]) };
      } else if (action?.kind === "start") {
        const refusal = this.ports.request(name, gameId, random ? "random" : map, settings);
        if (refusal === undefined) return true;
        this.ports.notify(name, refusal);
        if (this.ports.busy()) return false;
      }
    }
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

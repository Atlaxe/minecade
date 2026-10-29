// The lobby terminal, as plain logic: one player at a time uses it, and the hologram above it
// shows everyone what they're doing. main.ts passes in ports for forms, players and the hologram,
// so this file is unit-tested with plain data.
//
// The user keeps the terminal until they close the menu, start a game, leave, walk away, or
// leave it untouched for a while; then the hologram goes back to the idle screen.
import { Scope, say } from "@minecade/minigame-core";

/** What the hologram shows. Must match the screen order in the lobby resource pack. */
export type HoloScreen = "idle" | "main" | "main_play" | "main_stats";

export interface TerminalPorts {
  /** The themed main menu. Resolves the choice, or undefined if closed. Never settles if `scope` is disposed first. */
  mainMenu(name: string, scope: Scope): Promise<"play" | "stats" | undefined>;
  /** The game picker (resolves when the player is done with it). */
  play(name: string): Promise<void>;
  /** The stats screens (resolves when the player is done with them). */
  stats(name: string): Promise<void>;
  /** True while the lobby is starting a game. */
  starting(): boolean;
  /** One line about the network for the idle hologram ("Sumo in progress (3 playing)"). */
  statusLine(): string;
  notify(name: string, text: string): void;
  closeForms(name: string): void;
  /** Blocks from the player to the terminal, or undefined if they're not here. */
  distance(name: string): number | undefined;
  hologram(screen: HoloScreen, caption: string): void;
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
      this.ports.notify(name, say.info("A game is starting, hang on."));
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
        this.show("main", `${name} is at the terminal`);
        const choice = await this.ports.mainMenu(name, scope);
        if (choice === undefined) return;
        if (choice === "play") {
          this.show("main_play", `${name} is picking a game`);
          await scope.guard(this.ports.play(name));
          if (this.ports.starting()) return;
        } else {
          this.show("main_stats", `${name} is browsing stats`);
          await scope.guard(this.ports.stats(name));
        }
      }
    } finally {
      scope.dispose();
    }
  }

  /** The idle hologram's status line changed (or the terminal just freed up). */
  refresh(): void {
    if (this.user === undefined) this.ports.hologram("idle", this.ports.statusLine());
  }

  onPlayerLeft(name: string): void {
    if (this.user === name) this.session?.dispose();
  }

  private show(screen: HoloScreen, caption: string): void {
    this.lastActivity = this.now();
    this.ports.hologram(screen, caption);
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

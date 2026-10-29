// Team picking in the lobby, as plain logic: after Start, every player in the match gets a live
// team form while the game server boots, and the hologram shows the teams. main.ts passes in
// ports for the forms and the hologram, so this file is unit-tested with plain data.
//
// Picking ends once the game server is ready and everyone has picked, or 20 s have passed (at
// least 5 s either way). Then the picks go to the game server (lobby-controller.ts).
import type { Scope, TeamsConfig } from "@minecade/minigame-core";
import { TeamPicks, type TeamPicksView } from "./team-picks.ts";

export interface TeamPickView extends TeamPicksView {
  game: string;
  /** "Teams lock in 12 s", or "Waiting for the server...". */
  status: string;
}

export interface TeamPickPorts {
  /** Shows the live team form, or brings it back if the player closed it. */
  open(name: string, view: TeamPickView): void;
  /** Updates an open form (nothing if the player closed it). */
  update(name: string, view: TeamPickView): void;
  close(name: string): void;
  hologram(view: TeamPickView): void;
}

export interface TeamPickOptions {
  game: string;
  players: string[];
  teams: TeamsConfig;
  online(): string[];
  /** The picks, once picking ends. */
  done(picks: Record<string, string>): void;
  /** Picking lasts at least this long. */
  minTicks?: number;
  /** After this long, picking ends as soon as the server is ready, even if not everyone picked. */
  maxTicks?: number;
}

export class TeamPickController {
  private readonly ports: TeamPickPorts;
  private readonly options: TeamPickOptions;
  private readonly picks: TeamPicks;
  private readonly minTicks: number;
  private readonly maxTicks: number;
  private elapsed = 0;
  private serverReady = false;
  private finished = false;

  constructor(ports: TeamPickPorts, scope: Scope, options: TeamPickOptions) {
    this.ports = ports;
    this.options = options;
    this.picks = new TeamPicks(options.players, options.teams);
    this.minTicks = options.minTicks ?? 5 * 20;
    this.maxTicks = options.maxTicks ?? 20 * 20;
    // A failed start disposes the scope: the forms close.
    scope.add(() => {
      if (!this.finished) this.closeAll();
    });
    const view = this.view();
    for (const name of this.here()) ports.open(name, view);
    ports.hologram(view);
    scope.interval(() => {
      this.elapsed += 20;
      this.refresh();
      this.check();
    }, 20);
  }

  /** The game server is ready: picking ends as soon as the rules allow. */
  ready(): void {
    this.serverReady = true;
    this.refresh();
    this.check();
  }

  pick(name: string, team: string | undefined): void {
    if (this.finished || !this.picks.pick(name, team)) return;
    this.refresh();
    this.check();
  }

  leave(name: string): void {
    if (this.finished) return;
    this.picks.remove(name);
    this.refresh();
    this.check();
  }

  /** Brings the form back for a player in the match. False if they aren't, or picking has ended. */
  reopen(name: string): boolean {
    if (this.finished || !this.options.players.includes(name)) return false;
    this.ports.open(name, this.view());
    return true;
  }

  private view(): TeamPickView {
    return { game: this.options.game, status: this.status(), ...this.picks.view() };
  }

  private status(): string {
    if (!this.serverReady) return "Waiting for the server...";
    const lockAt = this.picks.allPicked(this.options.online()) ? this.minTicks : Math.max(this.minTicks, this.maxTicks);
    return `Teams lock in ${Math.max(1, Math.ceil((lockAt - this.elapsed) / 20))} s`;
  }

  private check(): void {
    if (this.finished || !this.serverReady || this.elapsed < this.minTicks) return;
    if (this.elapsed < this.maxTicks && !this.picks.allPicked(this.options.online())) return;
    this.finished = true;
    this.closeAll();
    this.options.done(this.picks.picks());
  }

  private refresh(): void {
    const view = this.view();
    for (const name of this.here()) this.ports.update(name, view);
    this.ports.hologram(view);
  }

  private closeAll(): void {
    for (const name of this.options.players) this.ports.close(name);
  }

  /** Players in the match who are in the lobby. */
  private here(): string[] {
    const online = new Set(this.options.online());
    return this.options.players.filter((name) => online.has(name));
  }
}

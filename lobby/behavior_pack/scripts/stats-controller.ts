// The lobby's Stats book, as plain logic like the selector: main.ts passes in ports for forms
// and the orchestrator. Tapping the book asks the orchestrator for the player's totals, shows
// them with a button per game played, and each game's page has its own counters.
import { Scope, killDeathRatio, winRate, type InboundMessage, type OutboundEvent, type Registry, type StatsReply, type StatsTotals } from "@minecade/minigame-core";

export interface StatsForm {
  title: string;
  body: string;
  buttons: string[];
}

export interface StatsPorts {
  send(event: OutboundEvent): void;
  notify(name: string, text: string): void;
  /** Shows a form. Resolves the picked button's index, or undefined if closed. Never settles if `scope` is disposed first. */
  show(name: string, scope: Scope, form: StatsForm): Promise<number | undefined>;
}

export interface StatsOptions {
  registry: Registry;
  newRequestId?: () => string;
  /** How long to wait for the orchestrator before giving up. */
  replyTimeoutTicks?: number;
}

export class StatsController {
  private readonly ports: StatsPorts;
  private readonly scope: Scope;
  private readonly registry: Registry;
  private readonly newRequestId: () => string;
  private readonly replyTimeoutTicks: number;
  /** Players with the book open, each with a scope that closes it. */
  private readonly open = new Map<string, Scope>();
  private readonly waiting = new Map<string, (reply: StatsReply) => void>();

  constructor(ports: StatsPorts, scope: Scope, options: StatsOptions) {
    this.ports = ports;
    this.scope = scope;
    this.registry = options.registry;
    this.newRequestId = options.newRequestId ?? randomId;
    this.replyTimeoutTicks = options.replyTimeoutTicks ?? 5 * 20;
  }

  onMessage(message: InboundMessage): void {
    if (message.t === "stats_reply") this.waiting.get(message.requestId)?.(message);
  }

  onPlayerLeft(name: string): void {
    this.open.get(name)?.dispose();
  }

  /** A player tapped the Stats book. */
  async openStats(name: string): Promise<void> {
    if (this.open.has(name)) return;
    const scope = this.scope.child(`stats:${name}`);
    this.open.set(name, scope);
    scope.add(() => this.open.delete(name));
    try {
      const overview = await this.ask(scope, name);
      if (!overview?.totals) return;
      const games = overview.games ?? [];
      for (;;) {
        const body = overview.totals.games > 0 ? describe(overview.totals) : "No solo or team games yet.";
        const buttons = [...games.map((game) => `${this.gameName(game.id)}\n${plural(game.games, "game")}`), "Close"];
        const pick = await this.ports.show(name, scope, { title: "Your stats", body, buttons });
        if (pick === undefined || pick >= games.length) return;
        const id = games[pick].id;
        const detail = await this.ask(scope, name, id);
        if (!detail?.totals) return;
        const page = { title: this.gameName(id), body: describe(detail.totals, this.extraLabels(id)), buttons: ["Back", "Close"] };
        if ((await this.ports.show(name, scope, page)) !== 0) return;
      }
    } finally {
      scope.dispose();
    }
  }

  /** Sends a query and waits for its reply. Tells the player when there's nothing to show. */
  private async ask(scope: Scope, name: string, game?: string): Promise<StatsReply | undefined> {
    const requestId = this.newRequestId();
    const answer = new Promise<StatsReply | undefined>((resolve) => {
      this.waiting.set(requestId, resolve);
      scope.timeout(() => resolve(undefined), this.replyTimeoutTicks);
    });
    const forget = scope.add(() => this.waiting.delete(requestId));
    this.ports.send({ t: "stats_query", requestId, player: name, ...(game === undefined ? {} : { game }) });
    const reply = await scope.guard(answer);
    forget();
    this.waiting.delete(requestId);
    if (!reply || reply.status === "unavailable") {
      this.ports.notify(name, "Stats are unavailable right now. Try again later.");
      return undefined;
    }
    if (reply.status === "none") {
      this.ports.notify(name, game === undefined ? "No stats yet. Matches with at least 2 players count." : "No stats for that game yet.");
      return undefined;
    }
    return reply;
  }

  private gameName(id: string): string {
    return this.registry.games.find((game) => game.id === id)?.name ?? id;
  }

  private extraLabels(id: string): [key: string, label: string][] {
    const extras = this.registry.games.find((game) => game.id === id)?.stats?.extras ?? [];
    return extras.map((extra) => [extra.key, extra.label]);
  }
}

/** The form body for a set of totals, plus any of the game's own counters. */
export function describe(totals: StatsTotals, extras: [key: string, label: string][] = []): string {
  const lines = [
    `Games: ${totals.games}   Wins: ${totals.wins}   Losses: ${totals.losses}${totals.draws > 0 ? `   Draws: ${totals.draws}` : ""}`,
    `Win rate: ${winRate(totals.wins, totals.games)}%`,
    `Kills: ${totals.kills}   Deaths: ${totals.deaths}   K/D: ${killDeathRatio(totals.kills, totals.deaths)}`,
    `Damage dealt: ${totals.dealt}   Damage taken: ${totals.taken}`,
    `Best kill streak: ${totals.bestStreak}   Time played: ${formatDuration(totals.seconds)}`,
  ];
  if (totals.left > 0) lines.push(`Left early: ${totals.left}`);
  for (const [key, label] of extras) lines.push(`${label}: ${totals.extras?.[key] ?? 0}`);
  return lines.join("\n");
}

/** "45s", "12m" or "1h 05m". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

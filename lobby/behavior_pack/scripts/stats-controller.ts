// The terminal's stats screens, as plain logic: main.ts passes in ports for forms and the
// orchestrator. A list of everyone with stats (the viewer first), then one player's screen with a
// tab for Global and each game they've played, each with the player's rank. The hologram shows
// what's open, through the terminal.
//
//   players list ──> a player's screen (Global, Sumo, ...) ── back ──> players list ── back ──> done
//
// A viewer who leaves a player's screen any way but back (the X, walking away, leaving) gets that
// player and tab again the next time they open the stats screens.
import { Scope, say, type InboundMessage, type OutboundEvent, type Registry, type StatsReply } from "@minecade/minigame-core";
import { CLOSE } from "./game-screen.ts";
import { statsContent, statsListContent, type HoloContent } from "./holo-content.ts";
import { GLOBAL_TAB, playersView, statColumns, statsBody, statsTabAt, type PlayersView, type StatsTab, type StatsView } from "./stats-screens.ts";

export interface StatsPorts {
  send(event: OutboundEvent): void;
  notify(name: string, text: string): void;
  /** The players list. Resolves the picked row's index, undefined if closed, or CLOSE for the X. Never settles if `scope` is disposed first. */
  playersMenu(name: string, scope: Scope, view: PlayersView): Promise<number | typeof CLOSE | undefined>;
  /** A player's screen. Resolves the pressed button's index, undefined to go back, or CLOSE for the X. */
  statsMenu(name: string, scope: Scope, view: StatsView): Promise<number | typeof CLOSE | undefined>;
}

export interface StatsOptions {
  registry: Registry;
  newRequestId?: () => string;
  /** How long to wait for the orchestrator before giving up. */
  replyTimeoutTicks?: number;
}

type Query = { player: string; game?: string } | { kind: "players" };

export class StatsController {
  private readonly ports: StatsPorts;
  private readonly scope: Scope;
  private readonly registry: Registry;
  private readonly newRequestId: () => string;
  private readonly replyTimeoutTicks: number;
  /** Players with the stats screens open, each with a scope that closes them. */
  private readonly open = new Map<string, Scope>();
  private readonly waiting = new Map<string, (reply: StatsReply) => void>();
  /** The player's screen and tab each viewer has open, kept until they go back to the list. */
  private readonly places = new Map<string, { player: string; tab: string }>();

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

  /**
   * Opens the stats screens; resolves when the player is done, true if they pressed the X. `show`
   * puts content on the hologram. Disposing `within` (the terminal session) closes them, and the
   * promise never settles.
   */
  async openStats(name: string, show: (content: HoloContent) => void = () => {}, within: Scope = this.scope): Promise<boolean> {
    if (this.open.has(name)) return false;
    const scope = within.child(`stats:${name}`);
    this.open.set(name, scope);
    scope.add(() => this.open.delete(name));
    try {
      const list = await this.ask(scope, name, { kind: "players" });
      if (!list) return false;
      // The player's screen the viewer left open last time, if any, comes first.
      let player = this.places.get(name)?.player;
      for (;;) {
        if (player === undefined) {
          const view = playersView(name, list.players ?? [], list.more ?? 0);
          show(statsListContent(view));
          const pick = await this.ports.playersMenu(name, scope, view);
          if (pick === CLOSE) return true;
          player = pick === undefined ? undefined : view.players[pick];
          if (player === undefined) return false;
        }
        const after = await this.playerScreen(name, scope, player, show);
        if (after === CLOSE) return true;
        if (!after) return false;
        player = undefined;
      }
    } finally {
      scope.dispose();
    }
  }

  /** One player's screen, a tab at a time. Resolves true to go back to the list, false if stats became unavailable, or CLOSE for the X. */
  private async playerScreen(viewer: string, scope: Scope, player: string, show: (content: HoloContent) => void): Promise<boolean | typeof CLOSE> {
    const overview = await this.ask(scope, viewer, { player });
    if (!overview) return false;
    const tabs: StatsTab[] = [GLOBAL_TAB, ...(overview.games ?? []).map((game) => ({ id: game.id, name: this.gameName(game.id) }))];
    // Each tab is asked for once while the screen is open.
    const replies = new Map<string, StatsReply>([[GLOBAL_TAB.id, overview]]);
    const place = this.places.get(viewer);
    let tab = (place?.player === player ? tabs.find((candidate) => candidate.id === place.tab) : undefined) ?? GLOBAL_TAB;
    for (;;) {
      this.places.set(viewer, { player, tab: tab.id });
      let reply = replies.get(tab.id);
      if (!reply) {
        reply = await this.ask(scope, viewer, { player, game: tab.id });
        if (!reply) return false;
        replies.set(tab.id, reply);
      }
      const placement = reply.rank !== undefined && reply.of !== undefined ? { rank: reply.rank, of: reply.of } : undefined;
      const extras = tab.id === GLOBAL_TAB.id ? [] : this.extraLabels(tab.id);
      const view: StatsView = { player, tabs, tab: tab.id, body: statsBody(reply.totals, placement), columns: statColumns(reply.totals, extras), ...(placement ? { placement } : {}) };
      show(statsContent(view));
      const selection = await this.ports.statsMenu(viewer, scope, view);
      if (selection === CLOSE) return CLOSE;
      if (selection === undefined) {
        this.places.delete(viewer);
        return true;
      }
      tab = statsTabAt(view, selection) ?? tab;
    }
  }

  /**
   * Sends a query and waits for its reply. "none" is a reply too (a player with no stats yet).
   * Undefined, after telling the player, when stats storage is off or doesn't answer.
   */
  private async ask(scope: Scope, name: string, query: Query): Promise<StatsReply | undefined> {
    const requestId = this.newRequestId();
    const answer = new Promise<StatsReply | undefined>((resolve) => {
      this.waiting.set(requestId, resolve);
      scope.timeout(() => resolve(undefined), this.replyTimeoutTicks);
    });
    const forget = scope.add(() => this.waiting.delete(requestId));
    this.ports.send({ t: "stats_query", requestId, player: name, ...query });
    const reply = await scope.guard(answer);
    forget();
    this.waiting.delete(requestId);
    if (!reply || reply.status === "unavailable") {
      this.ports.notify(name, say.warn("Stats are unavailable right now. Try again later."));
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

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

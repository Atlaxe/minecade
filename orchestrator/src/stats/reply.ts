// Answers the lobby's stats_query: a player's overall totals, rank and the games they've played,
// one game's totals and rank, or (kind "players") everyone with stats. Replies are trimmed to fit
// the message size limit.
import { encodeMessage, type StatsQuery, type StatsReply, type StatsTotals } from "@minecade/minigame-core/protocol";
import { describeError, log } from "../log.ts";
import type { StatsLine, StatsStore } from "./store.ts";

export function answerStatsQuery(store: StatsStore | undefined, query: StatsQuery): StatsReply {
  const reply: StatsReply = { t: "stats_reply", requestId: String(query.requestId), player: String(query.player), status: "unavailable" };
  if (!store) return reply;
  if (query.kind === "players") {
    try {
      return fit({ ...reply, status: "ok", players: store.playerNames() });
    } catch (error) {
      log.error(`stats player list failed: ${describeError(error)}`);
      return reply;
    }
  }
  let summary;
  let rank;
  const game = typeof query.game === "string" ? query.game : undefined;
  try {
    summary = typeof query.player === "string" ? store.summary(query.player) : undefined;
    rank = summary ? store.rank(summary.name, game) : undefined;
  } catch (error) {
    log.error(`stats lookup for ${query.player} failed: ${describeError(error)}`);
    return reply;
  }
  const placed = rank ? { rank: rank.rank, of: rank.of } : {};
  if (game !== undefined) {
    const totalsForGame = summary?.games[game];
    return totalsForGame ? fit({ ...reply, status: "ok", totals: totals(totalsForGame), ...placed }) : { ...reply, status: "none" };
  }
  const games = Object.entries(summary?.games ?? {})
    .map(([id, line]) => ({ id, games: line.games }))
    .sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));
  if (!summary || games.length === 0) return { ...reply, status: "none" };
  const { extras: _extras, ...overall } = totals(summary.overall);
  return fit({ ...reply, status: "ok", totals: overall, games, ...placed });
}

function totals(line: StatsLine): StatsTotals {
  const { kd: _kd, winRate: _winRate, ...rest } = line;
  return rest;
}

/** Drops names from the end of a player list, the least-played games, then the extras, until the reply fits one message. */
function fit(reply: StatsReply): StatsReply {
  const trimmed = { ...reply, ...(reply.games ? { games: [...reply.games] } : {}), ...(reply.players ? { players: [...reply.players] } : {}) };
  for (;;) {
    try {
      encodeMessage(trimmed);
      return trimmed;
    } catch (error) {
      if (trimmed.players && trimmed.players.length > 0) {
        trimmed.players.pop();
        trimmed.more = (trimmed.more ?? 0) + 1;
      } else if (trimmed.games && trimmed.games.length > 0) trimmed.games.pop();
      else if (trimmed.totals?.extras) {
        const { extras: _extras, ...rest } = trimmed.totals;
        trimmed.totals = rest;
      } else throw error;
    }
  }
}

// Answers the lobby's stats_query: a player's overall totals and the games they've played, or
// one game's totals. Replies are trimmed to fit the message size limit.
import { encodeMessage, type StatsQuery, type StatsReply, type StatsTotals } from "@minecade/minigame-core/protocol";
import { describeError, log } from "../log.ts";
import type { StatsLine, StatsStore } from "./store.ts";

export function answerStatsQuery(store: StatsStore | undefined, query: StatsQuery): StatsReply {
  const reply: StatsReply = { t: "stats_reply", requestId: String(query.requestId), player: String(query.player), status: "unavailable" };
  if (!store) return reply;
  let summary;
  try {
    summary = typeof query.player === "string" ? store.summary(query.player) : undefined;
  } catch (error) {
    log.error(`stats lookup for ${query.player} failed: ${describeError(error)}`);
    return reply;
  }
  if (typeof query.game === "string") {
    const game = summary?.games[query.game];
    return game ? fit({ ...reply, status: "ok", totals: totals(game) }) : { ...reply, status: "none" };
  }
  const games = Object.entries(summary?.games ?? {})
    .map(([id, line]) => ({ id, games: line.games }))
    .sort((a, b) => b.games - a.games || a.id.localeCompare(b.id));
  if (!summary || games.length === 0) return { ...reply, status: "none" };
  const { extras: _extras, ...overall } = totals(summary.overall);
  return fit({ ...reply, status: "ok", totals: overall, games });
}

function totals(line: StatsLine): StatsTotals {
  const { kd: _kd, winRate: _winRate, ...rest } = line;
  return rest;
}

/** Drops the least-played games, then the extras, until the reply fits one message. */
function fit(reply: StatsReply): StatsReply {
  const trimmed = { ...reply, ...(reply.games ? { games: [...reply.games] } : {}) };
  for (;;) {
    try {
      encodeMessage(trimmed);
      return trimmed;
    } catch (error) {
      if (trimmed.games && trimmed.games.length > 0) trimmed.games.pop();
      else if (trimmed.totals?.extras) {
        const { extras: _extras, ...rest } = trimmed.totals;
        trimmed.totals = rest;
      } else throw error;
    }
  }
}

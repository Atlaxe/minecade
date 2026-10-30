// Made-up stats for testing the lobby's stats screens alone (DEV_DEMO_STATS=1): a few dozen
// matches between made-up players and the given names, recorded into a store through the normal
// record() path. Deterministic, so the same names always get the same stats.
import type { MatchStats, StatsRow } from "@minecade/minigame-core/protocol";
import type { Registry } from "@minecade/minigame-core/config";
import type { StatsStore } from "./store.ts";

export const DEMO_PLAYERS = ["Nova", "Pixel", "Blaze", "Echo", "Rook", "Zephyr", "Moss", "Quill"];
const MATCHES = 48;

/** Records the demo matches; every name in `names` and DEMO_PLAYERS plays in some. */
export function seedDemoStats(store: StatsStore, registry: Registry, names: string[]): void {
  const random = seeded(42);
  const everyone = [...new Set([...names.filter(Boolean), ...DEMO_PLAYERS])];
  const games = registry.games.filter((game) => game.maps.length > 0);
  if (games.length === 0) return;
  for (let match = 0; match < MATCHES; match++) {
    const game = games[match % games.length];
    const size = Math.min(everyone.length, 2 + Math.floor(random() * 3));
    // Rotate who plays, so everyone gets matches; shuffle the rest of the seats.
    const first = everyone[match % everyone.length];
    const others = shuffle(everyone.filter((name) => name !== first), random).slice(0, size - 1);
    const players = [first, ...others];
    // Some players win more often than others: each has a fixed "skill".
    const winner = players.reduce((best, name) => (skill(name) + random() > skill(best) + random() ? name : best));
    const draw = random() < 0.08;
    const seconds = 60 + Math.floor(random() * 240);
    const rows = players.map((name): StatsRow => {
      const kills = Math.floor(random() * (name === winner ? 6 : 3));
      return {
        n: name,
        r: draw ? "d" : name === winner ? "w" : "l",
        k: kills,
        d: name === winner ? Math.floor(random() * 2) : 1 + Math.floor(random() * 3),
        dd: kills * 20 + Math.floor(random() * 15),
        dt: Math.floor(random() * 40),
        s: seconds,
        bs: Math.min(kills, 1 + Math.floor(random() * 3)),
      };
    });
    const part: MatchStats = {
      t: "match_stats",
      sessionId: `demo${match}`,
      matchId: `demo${match}.1`,
      part: 1,
      parts: 1,
      game: game.id,
      map: game.maps[0].id,
      mode: game.stats?.mode ?? (game.teams ? "team" : "solo"),
      durationSec: seconds,
      ...(draw ? {} : { winner }),
      rows,
    };
    store.record(part, new Map());
  }
}

function skill(name: string): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return (hash % 100) / 100;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A small deterministic random number generator (an LCG), in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

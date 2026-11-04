import { defineGame } from "@minecade/minigame-core/config";

/** The lobby's Build time setting: minutes for the first build (the twist is always TWIST_MINUTES). The first is the default. */
const BUILD_MINUTES = [5, 10];

// Build Swap: before the match everyone writes a prompt to build and a twist (or skips), for this
// match and the prompt bank. Each player gets a prompt nobody else has and builds it in their own
// building area, then everyone moves to someone else's build and adds a twist to it. Then everyone
// votes on every build, first as it was, then with its twist, and the most points wins. Points
// come from both: your build and your twist.
export default defineGame({
  id: "buildswap",
  name: "Build Swap",
  description: "Build a prompt, then swap and add a twist to someone else's build. Everyone votes; the most points wins.",
  minPlayers: 3,
  maxPlayers: 8,
  countdownSeconds: 5,
  // The rounds keep their own clocks (and voting has none), so the match has no clock over them.
  timeLimitSeconds: 0,
  // Long enough to look over the winner's build.
  endDelaySeconds: 15,
  lateJoin: "spectate",
  nameTags: true,
  // Nobody can hurt anybody, and leaving a building area brings you back to it (the game's own
  // check), so core's bounds never put anyone down.
  combat: { damage: "none", fall: false, outOfBounds: "ignore" },
  win: "custom",
  gameRules: {
    tntExplodes: false,
    doFireTick: false,
    mobGriefing: false,
    doMobSpawning: false,
    doWeatherCycle: false,
    doDayLightCycle: false,
    doTileDrops: false,
    doEntityDrops: false,
    projectilesCanBreakBlocks: false,
  },
  options: [{ id: "buildTime", label: "Build time", values: BUILD_MINUTES.map((minutes) => ({ value: String(minutes), label: `${minutes} minutes` })) }],
  // A spawn for every player and a building area (at least 24 blocks on every side) for each one.
  // The game pairs each spawn with the building area it's in, or the nearest. Spectators watch from
  // the spectator or queue spawn (core's default: one or the other).
  map: {
    spawns: { min: "maxPlayers" },
    regions: { plot: { label: "Build boundary", count: 8, minSize: 24 } },
    // How far builders may go past their building boundary before they're put back, per map (the
    // map editor's Game settings tool).
    settings: { buildPadding: { label: "Build padding", hint: "how far builders can go past their boundary", default: 2, min: 0, max: 32, unit: "blocks" } },
  },
  stats: {
    mode: "solo",
    pvp: false,
    extras: [
      { key: "points", label: "Points", agg: "sum" },
      { key: "bestScore", label: "Best score", agg: "max" },
    ],
  },
  /** The prompt form before the match: seconds until it closes, skipping whoever hasn't answered. */
  promptSeconds: 120,
  /** Seconds to read a prompt and look around before building starts, each round. */
  prepSeconds: 10,
  /** The twist round's minutes, whatever the lobby's Build time. */
  twistMinutes: 5,
  /** Once everyone has voted on a build, seconds until the next one (votes can still change). */
  voteGraceSeconds: 10,
  /** A build nobody can vote on (only its builders are here) shows this long. */
  showSeconds: 5,
  /** How far (blocks) players may go past the building area being voted on (while building, the map's buildPadding). */
  voteMargin: 16,
});

import { BUILDING_MAP, defineGame } from "@minecade/minigame-core/config";

/** The lobby's Build time setting: minutes for each build. The first is the default. */
const BUILD_MINUTES = [3, 5];

// Guess the Build: telephone with building. Before the match everyone writes a prompt (or skips).
// Then everyone builds someone else's prompt in a copy of the map's arena, moves on and guesses what
// someone else's build is, moves on and builds that guess, and so on round the circle, until every
// chain has been through everyone but its own writer. Then the showcase: chain by chain, each build
// with what it was built from and each guess by name, and everyone votes 1 to 5 on every build. The
// most points wins.
export default defineGame({
  id: "guessbuild",
  name: "Guess the Build",
  description: "Telephone with building: build a prompt, guess what someone else built, build their guess, and round it goes. Then see every chain and vote on every build.",
  minPlayers: 3,
  maxPlayers: 8,
  // No frozen countdown at the spawns: the first prompt and its prep time start at once.
  countdownSeconds: 0,
  // Each step keeps its own clock (and voting has none), so the match has no clock over them.
  timeLimitSeconds: 0,
  // Long enough to look over the winner's build.
  endDelaySeconds: 15,
  lateJoin: "spectate",
  nameTags: true,
  // Builders take blocks from creative's menu, so they get every custom block.
  blocks: "full",
  // Nobody can hurt anybody, and leaving a build area brings you back to it (the game's own check).
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
  // Build Swap's kind of map (one arena with a build area and a spawn in it, copied once per player
  // at the start), and Build Swap's maps too, as the user asked: a map made once plays both.
  map: { ...BUILDING_MAP, borrow: ["buildswap"] },
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
  /** Seconds to read what to build and look around before building starts, each build. */
  prepSeconds: 10,
  /** How long a guess takes: looking at the build, then writing what it is. */
  guessSeconds: 45,
  /** The guess form comes up on its own this long into a guess (the paper brings it up sooner). */
  guessLookSeconds: 15,
  /** How long the showcase shows each guess (and, at a chain's end, its prompt). */
  revealSeconds: 4,
  /** Once everyone has voted on a build, seconds until the next one (votes can still change). */
  voteGraceSeconds: 3,
  /** A voter who hasn't voted this long after a build shows gets a big "Vote!" title and a wither's roar, again each time it passes. */
  voteNagSeconds: 10,
  /** A build nobody can vote on (only its builder is here, or its builder left) shows this long. */
  showSeconds: 5,
});

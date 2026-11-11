// What a building game's maps need (Build Swap, Guess the Build), for their game.config.ts: pure, so
// it loads under Node too ("@minecade/minigame-core/config"). The map holds one arena, a box with a
// build area (at least 24 blocks on every side) and a spawn inside it; the game copies the arena once
// per player at the start (game/arenas.ts).

/** The region a tiled map's arena is drawn as. */
export const ARENA_REGION = "arena";
/** The map's region of the box players build in, inside its arena. */
export const PLOT_REGION = "plot";
/** The map setting for how far builders, and voters, may go past a build area. */
export const BUILD_PADDING = "buildPadding";
/** The map setting for how long (seconds) builders may stay past the padding before they're put back. */
export const RETURN_DELAY = "returnDelay";
/**
 * The most blocks an arena spans along a side. BDS keeps at most 300 chunks ticking, and every copy
 * keeps a ticking area of its own: 8 arenas 80 blocks across take at most 6 by 6 chunks each (288 in
 * all), leaving a few for a preview's fake players (docs/spike-results.md, "Arena tiles").
 */
export const ARENA_MAX_SIZE = 80;
/** The fewest blocks a build area spans along every side. */
export const BUILD_AREA_MIN_SIZE = 24;

/** The two settings every building game declares in its config's map.settings. */
export const BUILDING_SETTINGS = {
  [BUILD_PADDING]: { label: "Build padding", hint: "how far builders and voters can go past a build area", default: 2, min: 0, max: 32, unit: "blocks" },
  [RETURN_DELAY]: { label: "Return delay", hint: "how long builders can stay past the padding before they're put back", default: 0, min: 0, max: 30, unit: "seconds" },
};

/** The map block of every building game's config: one arena, its build area and its spawn, and the two settings. */
export const BUILDING_MAP = {
  spawns: { min: 1, inside: ARENA_REGION },
  regions: {
    [ARENA_REGION]: { label: "Arena", maxSize: ARENA_MAX_SIZE },
    [PLOT_REGION]: { label: "Build area", minSize: BUILD_AREA_MIN_SIZE, inside: ARENA_REGION },
  },
  settings: BUILDING_SETTINGS,
};

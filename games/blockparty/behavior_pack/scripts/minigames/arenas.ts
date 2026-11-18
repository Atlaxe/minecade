// Block Party's minigame arenas (docs/plans/block-party.md, "Minigame arena maps"), as the game's
// config lists them (GameConfig.arenas, core's arena-map.ts): each minigame's arena map is its own
// entry in the map editor's list ("Hot Floor (Block Party)", blockparty-hotfloor) with its own
// checklist. Every arena map has the Arena box, at most the arena slot's 40 x 60 across (either way
// round: the game turns it to fit the slot) and 48 tall; Publish cuts it out as a structure, which
// the game places in the slot, fresh each time. Plain data, read by game.config.ts (the editors, the
// build) and by the minigames (the markup names below).
import { ARENA_SLOT_FOOTPRINT, STRUCTURE_REGION, type ArenaConfig } from "@minecade/minigame-core/config";

/** How tall an Arena box may be, from the slot's floor (the plan's proposal). */
export const ARENA_HEIGHT = 48;

/** The markup the minigames read, by name. */
export const MARKUP = {
  /** Hot Floor: where its tiles go, 3 x 3 each (the box's lowest layer). Co-op Painters: the floor that gets painted (its lowest layer). */
  floor: "floor",
  /** Hunter: where the runners are home. */
  goal: "goal",
  /** Hunter: the hunter's spawn, and the runners'. */
  hunter: "hunter",
  runners: "runners",
  /** Every minigame: the minigame podium, where the players stand for its results, 1st to 4th (minigame-podium.ts), and the camera on it. */
  podium: "podium",
  podiumCamera: "podiumCamera",
} as const;

/**
 * Every arena map's minigame podium (the user, 2026-11-18): 4 spots, 1st place to 4th in order, each
 * placed standing where a player stands with their facing taken; and the Podium camera, placed the
 * same way where the camera goes (Take my facing). A map can do without the camera (Checklist
 * Features): the shot then stands in front of the podium. An arena with no podium plays its results
 * at its spawns.
 */
const PODIUM = {
  [MARKUP.podium]: { label: "Minigame podium", count: 4, marker: "player" },
  [MARKUP.podiumCamera]: { label: "Podium camera" },
} as const;
const PODIUM_ADJUSTABLE = { [`points.${MARKUP.podiumCamera}`]: { off: true } };

/** Co-op Painters' sides, as its team spawns are keyed. */
export const PAINTER_TEAMS = [
  { id: "red", name: "Red", color: "§c" },
  { id: "blue", name: "Blue", color: "§9" },
];

const box = { footprint: ARENA_SLOT_FOOTPRINT, height: ARENA_HEIGHT };
const inside = { inside: STRUCTURE_REGION };

export const ARENAS: ArenaConfig[] = [
  {
    id: "hotfloor",
    name: "Hot Floor",
    maxPlayers: 4,
    box,
    // 4 spawns on the floor (a duel uses the first 2), where the players who fall watch from, and the floor's tiles.
    map: { spawns: { min: 4, ...inside }, spectatorSpawn: true, points: { ...PODIUM }, regions: { [MARKUP.floor]: { label: "Floor (tiles)", ...inside } }, adjustable: PODIUM_ADJUSTABLE },
  },
  {
    id: "painters",
    name: "Co-op Painters",
    maxPlayers: 4,
    teams: { count: 2, pick: false, defs: PAINTER_TEAMS },
    box,
    map: { spawns: false, teamSpawns: { perTeam: 2 }, spectatorSpawn: true, points: { ...PODIUM }, regions: { [MARKUP.floor]: { label: "Floor", ...inside } }, adjustable: PODIUM_ADJUSTABLE },
  },
  {
    id: "hunter",
    name: "Hunter",
    maxPlayers: 4,
    box,
    // The hunter's spawn, 3 runners' (1v2 uses the first 2), and the runners' goal.
    map: {
      spawns: false,
      spectatorSpawn: true,
      points: { [MARKUP.hunter]: { label: "Hunter spawn", marker: "player" }, [MARKUP.runners]: { label: "Runner spawns", count: 3, marker: "player" }, ...PODIUM },
      regions: { [MARKUP.goal]: { label: "Goal", ...inside } },
      adjustable: PODIUM_ADJUSTABLE,
    },
  },
];

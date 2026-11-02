import { defineGame } from "@minecade/minigame-core/config";

/** The lobby's Best of setting: how many rounds a match can last. The first is the default. */
const BEST_OF = [5, 3, 7];

// Bridges: two teams, each with a hole by its spawn. Get into the other team's hole to win the round,
// and keep them out of yours; the first team to win more than half the rounds (3 of 5) takes the
// match. Everyone has a wooden sword, a bow, 64 wool in their team's color and one arrow, which comes
// back 10 seconds after it's gone or at once with a kill, and picks Snowballs or a Leap before the
// match. Nobody builds in either team's spawn guard. Deaths are quick respawns at your team's spawn.
export default defineGame({
  id: "bridges",
  name: "Bridges",
  description: "Build across, jump into the other team's hole, and guard your own. Best of 5 rounds.",
  minPlayers: 2,
  maxPlayers: 4,
  countdownSeconds: 5,
  // A clock over all the rounds: when it runs out, the team with the most rounds wins (a tie draws).
  timeLimitSeconds: 900,
  endDelaySeconds: 6,
  teams: { count: 2 },
  combat: { fall: false, killCreditSeconds: 8 },
  respawn: { mode: "unlimited", delaySeconds: 2 },
  bestOf: { rounds: BEST_OF[0], display: "icons", option: "bestOf" },
  kits: {
    select: "match",
    // Everyone's, back in full every life.
    base: {
      id: "bridges",
      name: "Bridges",
      items: [
        { item: "minecraft:wooden_sword", slot: 0 },
        { item: "minecraft:bow", slot: 1 },
        { item: "minecraft:{color}_wool", count: 64, slot: 2 },
        { item: "minecraft:arrow", slot: 8 },
      ],
    },
    // Picked before the match; back in full each round, and what's left is kept through a respawn.
    list: [
      { id: "snowballs", name: "Snowballs", refill: "round", items: [{ item: "minecraft:snowball", count: 8, slot: 3 }] },
      { id: "leap", name: "Leap", refill: "round", items: [{ item: "minecraft:feather", count: 1, slot: 3, name: "Leap" }] },
    ],
  },
  // Each team's spawn guard (a region per team, drawn in the map editor) is closed to building for
  // everyone, and so are the holes and the air above them.
  build: { noBuild: ["spawnGuard"] },
  options: [
    { id: "bestOf", label: "Best of", values: BEST_OF.map((rounds) => ({ value: String(rounds), label: `${rounds} rounds` })) },
    {
      id: "blocks",
      label: "Placed blocks",
      values: [
        { value: "keep", label: "Kept all match" },
        { value: "clear", label: "Cleared each round" },
      ],
    },
  ],
  // A hole is a point at the middle of its floor: the hole (3 blocks square, 3 tall) stands there,
  // in the pit the map has for it, and the map editor draws it there (markers/hole.geo.json, its rim
  // in the team's color). Players watch from the spectator or queue spawn (core's default). Blocks go
  // between the build limit's two heights (set with the Kill Y tool).
  map: {
    teamSpawns: true,
    bounds: true,
    killY: true,
    buildLimit: true,
    points: { hole: { label: "Hole", perTeam: true, marker: { model: "hole" } } },
    regions: { spawnGuard: { label: "Spawn guard", perTeam: true } },
  },
  stats: { mode: "team", pvp: true, extras: [{ key: "goals", label: "Goals", agg: "sum" }] },
  /** The arrow: at most `max`, and one back `regenSeconds` after the last is gone (a kill gives one at once). */
  arrow: { max: 1, regenSeconds: 10 },
  /**
   * The Leap feather throws you the way you look: on a level look, `forward` along the ground and
   * `lift` up; looking up, less forward and more up, to `up` straight up.
   */
  leap: { forward: 3.2, lift: 0.55, up: 1 },
  /** The hole: half its width and its height, in blocks. */
  hole: { halfWidth: 1.5, height: 3 },
});

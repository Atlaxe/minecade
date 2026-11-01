import { defineGame } from "@minecade/minigame-core/config";

/** The lobby's First to setting: the kills that win the match. The first is the default. */
const KILL_TARGETS = [15, 20, 25, 10];

// One in the Quiver: everyone has a sword, a bow and one arrow, and an arrow kills in one hit.
// Every kill (with either) earns an arrow; a missed arrow is gone. Respawns are unlimited, at a
// spawn away from everyone else, and the first to the kill target wins. When time runs out, the
// most kills wins (a tie is a draw).
export default defineGame({
  id: "quiver",
  name: "One in the Quiver",
  description: "One arrow, one kill. Every kill earns another arrow. First to the kill target wins.",
  minPlayers: 2,
  maxPlayers: 8,
  countdownSeconds: 5,
  timeLimitSeconds: 480,
  endDelaySeconds: 6,
  lateJoin: "join",
  combat: { fall: false, killCreditSeconds: 6 },
  respawn: { mode: "unlimited", delaySeconds: 2, protectSeconds: 2 },
  // Each player sees only their own kills, top right beside the clock: no sidebar.
  scoring: { per: "player", perKill: 1, title: "Kills", display: "own" },
  kits: {
    list: [
      {
        id: "archer",
        name: "Archer",
        items: [
          { item: "minecraft:stone_sword", slot: 0 },
          { item: "minecraft:bow", slot: 1 },
        ],
      },
    ],
  },
  options: [{ id: "target", label: "First to", values: KILL_TARGETS.map((kills) => ({ value: String(kills), label: `${kills} kills` })) }],
  // More spawns than players, so a respawn can always land away from everyone. Respawning players
  // watch from the spectator spawn for the 2 second delay, or from the queue spawn when the map has
  // no spectator spawn (core's default: one or the other).
  map: { spawns: { min: 10 }, killY: true },
  stats: {
    mode: "solo",
    pvp: true,
    extras: [
      { key: "bowKills", label: "Bow kills", agg: "sum" },
      { key: "longestShot", label: "Longest shot", agg: "max" },
    ],
  },
  /** Arrows (in the last hotbar slot): how many each life starts with, and how many a kill earns. */
  arrows: { perLife: 1, perKill: 1 },
});

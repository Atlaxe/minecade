import { teamGunItem, type PickupKind } from "@minecade/guns/defs";
import { WAYPOINTS_OPTION, defineGame } from "@minecade/minigame-core/config";

/** What a power-up can be, picked at random each time one appears. */
const POWER_UPS: PickupKind[] = ["rifle", "shotgun", "grenade"];

// Paintball: Red against Blue with paint guns. Everyone has a pistol; a rifle, a shotgun and a paint
// grenade float on the map's power-up spots, two at a time, moving on their own timers. Each ball
// that hits colors the armor piece it hit, mixing in the shooter's color, and four hits put a player
// out until they respawn. Every ball paints where it lands in its team's color: full blocks become
// concrete, other shapes concrete-colored shapes. The first team to 10 kills wins; when time runs
// out, the most kills wins (a tie is a draw).
export default defineGame({
  id: "paintball",
  name: "Paintball",
  description: "Red against Blue with paint guns. Four hits and you're out until you respawn. First team to 10 kills wins.",
  minPlayers: 2,
  maxPlayers: 8,
  countdownSeconds: 5,
  timeLimitSeconds: 600,
  endDelaySeconds: 6,
  lateJoin: "join",
  // Names over heads in the team's color, so teammates know each other under the paint.
  nameTags: true,
  teams: {
    count: 2,
    defs: [
      { id: "red", name: "Red", color: "§c" },
      { id: "blue", name: "Blue", color: "§9" },
    ],
  },
  combat: { killCreditSeconds: 8 },
  respawn: { mode: "unlimited", delaySeconds: 3, protectSeconds: 2 },
  // Each team's kills top right in its color, "R | B".
  scoring: { per: "team", perKill: 1, target: 10, title: "Kills", display: "sides" },
  // Health shows the hits left, and only paint takes it away (paintball.ts). Painting a block can
  // break what stood on it for a moment (a door's other half, crops on farmland): nothing drops.
  gameRules: { naturalRegeneration: false, doTileDrops: false },
  deathMessages: { verbs: ["painted", "splattered"] },
  kits: {
    list: [
      {
        id: "paintball",
        name: "Paintball",
        items: [{ item: teamGunItem("pistol"), slot: 0 }],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
        // Hunger stays full, so everyone can sprint (it doesn't heal: see gameRules).
        effects: [{ id: "saturation" }],
      },
    ],
  },
  // The map editor's mannequins can hold the power-ups too (the kit's pistol is already theirs), in
  // the mannequin's color.
  mannequinItems: POWER_UPS.map((kind) => teamGunItem(kind)),
  // Waypoints: On shows everyone on the locator bar over the hotbar (Off at first).
  options: [WAYPOINTS_OPTION],
  // Spawns for Red and Blue. Players watch from the spectator or queue spawn while they wait to
  // respawn (core's default: one or the other).
  map: {
    teamSpawns: { perTeam: 2 },
    bounds: true,
    points: { powerup: { label: "Power-up spot", count: 8, marker: { model: "powerup" } } },
  },
  stats: { mode: "team", pvp: true, extras: [{ key: "painted", label: "Blocks painted", agg: "sum" }] },
  /** Hits that put a player out; each one takes an equal share of their health. */
  hitsToOut: 4,
  /** The hotbar slots: the gun (the pistol, or a power-up gun in its place), and a grenade. */
  slots: { gun: 0, grenade: 1 },
  powerUps: {
    /** Two timers, each owning one power-up: every this many seconds it moves to a free random spot, untaken or not. */
    everySeconds: [26, 34],
    kinds: POWER_UPS,
    /** A rifle or shotgun lasts this long, counted down on the level over the hotbar; then the pistol comes back. */
    gunSeconds: 30,
    /** How close (blocks, from the spot's middle to the player's feet) takes one. */
    radius: 1.5,
  },
  /** A burst grenade paints a ball of `paintRadius` blocks and hits every enemy within `hitRadius` `hits` times. */
  grenade: { paintRadius: 4, hitRadius: 3, hits: 2 },
  /** A ball paints the block it hits and a few touching blocks of the same surface: `min` to `max` in all. */
  splash: { min: 3, max: 5 },
});

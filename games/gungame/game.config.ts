import { arsenalItem } from "@minecade/guns/defs";
import { WAYPOINTS_OPTION, defineGame } from "@minecade/minigame-core/config";

/**
 * The lobby's Ladder setting: the weapons a match climbs, light to heavy, the Netherite Sword last.
 * The first is the default.
 */
const LADDERS = {
  full: [
    arsenalItem("handgun"),
    arsenalItem("smg"),
    arsenalItem("assault_rifle"),
    arsenalItem("burst_rifle"),
    arsenalItem("pump_shotgun"),
    arsenalItem("double_barrel"),
    arsenalItem("sniper_rifle"),
    arsenalItem("rail_gun"),
    arsenalItem("rpg"),
    "minecraft:crossbow",
    "minecraft:netherite_sword",
  ],
  short: [arsenalItem("handgun"), arsenalItem("assault_rifle"), arsenalItem("pump_shotgun"), arsenalItem("sniper_rifle"), arsenalItem("rpg"), "minecraft:netherite_sword"],
};

// Gun Game: a free-for-all up a ladder of weapons. Everyone starts on the first; a kill with the
// weapon you're on moves you to the next, and the first kill with the last (the Netherite Sword,
// which kills in one hit) wins. A melee hit (a fist, or a bash with whatever's in hand) takes a
// quarter of your health, and a melee death puts you back one weapon; so does dying by yourself
// (falling out of the map, your own rocket). Respawns are unlimited, at a spawn away from everyone
// else. When time runs out, whoever is furthest up wins, then the most kills (a tie is a draw).
// It plays One in the Quiver's maps as they are.
export default defineGame({
  id: "gungame",
  name: "Gun Game",
  description: "Every kill moves you to the next gun. The first kill with the last weapon, the Netherite Sword, wins.",
  minPlayers: 2,
  maxPlayers: 8,
  countdownSeconds: 5,
  timeLimitSeconds: 600,
  endDelaySeconds: 6,
  lateJoin: "join",
  combat: { fall: false, killCreditSeconds: 6 },
  respawn: { mode: "unlimited", delaySeconds: 2, protectSeconds: 2 },
  // Each player sees how far up the ladder they are (the kills that counted), top right in the
  // skull box beside the clock: no sidebar. gungame.ts sets it; kills alone add nothing.
  scoring: { per: "player", title: "Kills", display: "own" },
  // Health comes back only by respawning, so four melee hits are always four.
  gameRules: { naturalRegeneration: false },
  deathMessages: { verbs: ["shot", "gunned down", "dropped", "outgunned"] },
  kits: {
    list: [
      {
        id: "gungame",
        name: "Gun Game",
        // The weapon is the ladder's (gungame.ts).
        items: [],
        // Hunger stays full, so everyone can sprint (it doesn't heal: see gameRules).
        effects: [{ id: "saturation" }],
      },
    ],
  },
  // Waypoints: On shows everyone on the locator bar over the hotbar (Off at first).
  options: [
    {
      id: "ladder",
      label: "Ladder",
      values: [
        { value: "full", label: `${LADDERS.full.length} weapons` },
        { value: "short", label: `${LADDERS.short.length} weapons` },
      ],
    },
    WAYPOINTS_OPTION,
  ],
  // One in the Quiver asks the same of a map (10 spawns, kill Y, a spectator or queue spawn), so
  // every Quiver map will do.
  map: { spawns: { min: 10 }, killY: true, borrow: ["quiver"] },
  stats: { mode: "solo", pvp: true, extras: [{ key: "headshots", label: "Headshots", agg: "sum" }] },
  ladders: LADDERS,
  /** Melee hits (fist or bash) that put a player at full health down: each takes 20 / 4 = 5 health. */
  meleeHits: 4,
  /** The hotbar: the ladder's weapon in the first slot, a crossbow's arrows just above the hotbar. */
  slots: { weapon: 0, arrows: 9 },
});

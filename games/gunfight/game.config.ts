import { STIMPACK, arsenalItem, arsenalItemName } from "@minecade/guns/defs";
import { defineGame } from "@minecade/minigame-core/config";

/**
 * The flag: the map point it stands on and its name in the map editor (Siege's maps carry it too:
 * games/siege), and how it's taken when a round's clock runs out, for `seconds`: players standing
 * within `radius` blocks of it (across; from a block below to 2 above), one team alone there for
 * `holdSeconds` in a row, take the round.
 */
const FLAG = { point: "flag", label: "Flag (Gunfight)", radius: 2, holdSeconds: 5, seconds: 20 } as const;

/** Round wins that take the match: best of 10, first to 5, as the user asked. */
const FIRST_TO = 5;

/** What a round's loadout is dealt from: one of each, the same for everyone. */
const LOADOUTS = {
  primary: [
    arsenalItem("assault_rifle"),
    arsenalItem("smg"),
    arsenalItem("burst_rifle"),
    arsenalItem("pump_shotgun"),
    arsenalItem("double_barrel"),
    arsenalItem("sniper_rifle"),
    arsenalItem("rail_gun"),
    "minecraft:crossbow",
  ],
  secondary: [arsenalItem("handgun"), arsenalItem("rpg"), "minecraft:netherite_sword"],
  grenade: [arsenalItem("frag_grenade"), arsenalItem("molotov"), arsenalItem("flashbang"), arsenalItem("smoke_grenade"), arsenalItem("throwing_knife")],
};

// Gunfight: two teams of one or two, one life a round, everyone with the same guns. Each round
// deals one loadout to everyone: a primary (each comes up once before any comes again), a
// secondary, a grenade and a stimpack, all from the arsenal (packages/guns) or vanilla's one-hit
// crossbow and netherite sword. The teams take each other's spawns every other round. The last team
// standing takes the round, the first to 5 round wins takes the match (best of 10, shown as each
// team's wins, "R | B"). A round lasts 4 minutes; then the flag's circle comes up for 20 seconds,
// and a team that holds it alone for 5 seconds takes the round. Nobody does: the team with more
// health left takes it, then the one that dealt more damage that round. It plays Siege's maps, each
// with a flag (Siege's maps ask for one for Gunfight).
export default defineGame({
  id: "gunfight",
  name: "Gunfight",
  description: "Two teams, one life a round, everyone with the same guns. The guns and the sides change every round. First to 5 rounds.",
  minPlayers: 2,
  // Two a team at most, as the user asked; a preview's fake players and the player fill 4 at most.
  maxPlayers: 4,
  countdownSeconds: 5,
  // No clock over the match: each round has its own (bestOf.roundSeconds).
  timeLimitSeconds: 0,
  endDelaySeconds: 6,
  // Names over heads in the team's color.
  nameTags: true,
  teams: { count: 2 },
  combat: { killCreditSeconds: 8 },
  respawn: { mode: "none" },
  // Each round's clock: 4 minutes, then the flag (flag below).
  bestOf: { firstTo: FIRST_TO, display: "score", roundSeconds: 240, swapSides: true },
  flag: FLAG,
  // Health comes back only from a stimpack.
  gameRules: { naturalRegeneration: false },
  deathMessages: { verbs: ["shot", "gunned down", "dropped", "outgunned"] },
  kits: {
    list: [
      {
        id: "gunfight",
        name: "Gunfight",
        // The guns are the round's loadout (gunfight.ts): the kit is the team's leather.
        items: [],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
        // Hunger stays full, so everyone can sprint (it doesn't heal: see gameRules).
        effects: [{ id: "saturation" }],
      },
    ],
  },
  // Players watch from the spectator or queue spawn once they're out (core's default). Siege asks
  // the same of a map, the flag too, so every Siege map will do.
  map: { teamSpawns: true, bounds: true, points: { [FLAG.point]: { label: FLAG.label } }, borrow: ["siege"] },
  stats: { mode: "team", pvp: true, extras: [{ key: "headshots", label: "Headshots", agg: "sum" }] },
  loadouts: LOADOUTS,
  // The map editor's mannequins can hold every weapon a loadout can deal, and the stimpack.
  mannequinItems: [...LOADOUTS.primary, ...LOADOUTS.secondary, ...LOADOUTS.grenade, arsenalItem(STIMPACK)].map((item) => ({ item, name: arsenalItemName(item) })),
  /** The hotbar: the loadout's three, and everyone's stimpack in the last slot. */
  slots: { primary: 0, secondary: 1, grenade: 2, stimpack: 8 },
});

import { arsenalItem } from "@minecade/guns/defs";
import { defineGame } from "@minecade/minigame-core/config";

/** The lobby's Best of setting: how many rounds a match can last. The first is the default. */
const BEST_OF = [5, 3, 7];

// Gunfight: two teams, one life a round, everyone with the same guns. Each round deals one loadout
// to everyone: a primary (each comes up once before any comes again), a secondary, a grenade and a
// stimpack, all from the arsenal (packages/guns) or vanilla's one-hit crossbow and netherite sword.
// The teams take each other's spawns every other round. The last team standing takes the round, the
// first to win more than half (3 of 5) takes the match; a round that runs out of time goes to the
// team with more players standing, then more health left. It plays Siege's maps as they are.
export default defineGame({
  id: "gunfight",
  name: "Gunfight",
  description: "Two teams, one life a round, everyone with the same guns. The guns and the sides change every round. Best of 5.",
  minPlayers: 2,
  maxPlayers: 8,
  countdownSeconds: 5,
  // No clock over the match: each round has its own (bestOf.roundSeconds).
  timeLimitSeconds: 0,
  endDelaySeconds: 6,
  // Names over heads in the team's color.
  nameTags: true,
  teams: { count: 2 },
  combat: { killCreditSeconds: 8 },
  respawn: { mode: "none" },
  bestOf: { rounds: BEST_OF[0], display: "icons", option: "bestOf", roundSeconds: 90, swapSides: true },
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
  options: [{ id: "bestOf", label: "Best of", values: BEST_OF.map((rounds) => ({ value: String(rounds), label: `${rounds} rounds` })) }],
  // Players watch from the spectator or queue spawn once they're out (core's default). Siege asks
  // the same of a map, so every Siege map will do.
  map: { teamSpawns: true, bounds: true, borrow: ["siege"] },
  stats: { mode: "team", pvp: true, extras: [{ key: "headshots", label: "Headshots", agg: "sum" }] },
  /** What a round's loadout is dealt from: one of each, the same for everyone. */
  loadouts: {
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
  },
  /** The hotbar: the loadout's three, and everyone's stimpack in the last slot. */
  slots: { primary: 0, secondary: 1, grenade: 2, stimpack: 8 },
});

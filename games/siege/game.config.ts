import { defineGame } from "@minecade/minigame-core/config";

/** The lobby's Best of setting: how many rounds a match can last. The first is the default. */
const BEST_OF = [5, 3, 7];
/** Every class's ability item sits in the last hotbar slot. */
const ABILITY_SLOT = 8;

// Siege: two teams of two to four. Before every round each player picks one of seven classes, each
// with its own gear and an ability (the item in the last hotbar slot; the level over the hotbar
// counts down until it's ready again). One life a round: the last team standing takes it, and the
// first team to win more than half the rounds (3 of 5) takes the match. A round that runs out of
// time goes to the team with more players standing, then more health left. Water hurts everyone but
// a Seaman, and health comes back only from a Medic. The classes are the same on every map.
export default defineGame({
  id: "siege",
  name: "Siege",
  description: "Two teams, seven classes, one life a round. The last team standing takes the round. Best of 5 rounds.",
  minPlayers: 4,
  maxPlayers: 8,
  countdownSeconds: 5,
  // No clock over the match: each round has its own (bestOf.roundSeconds).
  timeLimitSeconds: 0,
  endDelaySeconds: 6,
  // Names over heads in the team's color, so teammates know each other in any armor.
  nameTags: true,
  teams: { count: 2, minPerTeam: 2 },
  combat: { killCreditSeconds: 8 },
  respawn: { mode: "none" },
  bestOf: { rounds: BEST_OF[0], display: "icons", option: "bestOf", roundSeconds: 180 },
  gameRules: { naturalRegeneration: false },
  kits: {
    select: "round",
    mapKits: false,
    // Everyone's: hunger stays full, so everyone can sprint all round (it doesn't heal: see gameRules).
    base: { id: "siege", name: "Siege", items: [], effects: [{ id: "saturation" }] },
    list: [
      {
        id: "soldier",
        name: "Soldier",
        items: [
          { item: "minecraft:iron_sword", slot: 0 },
          { item: "minecraft:blaze_powder", name: "Rally", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate", legs: "minecraft:iron_leggings", feet: "minecraft:iron_boots" },
      },
      {
        id: "archer",
        name: "Archer",
        items: [
          { item: "minecraft:bow", slot: 0 },
          { item: "minecraft:wooden_sword", slot: 1 },
          { item: "minecraft:arrow", count: 32, slot: 2 },
          { item: "minecraft:flint", name: "Volley", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:chainmail_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
        enchantments: [{ item: "minecraft:bow", enchantment: "minecraft:power", level: 1 }],
      },
      {
        id: "seaman",
        name: "Seaman",
        items: [
          { item: "minecraft:trident", slot: 0 },
          { item: "minecraft:heart_of_the_sea", name: "Tidal Wave", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:turtle_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:chainmail_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
        effects: [{ id: "water_breathing" }],
        // Loyalty brings a thrown trident back; Depth Strider walks the bottom of the water at land speed.
        enchantments: [
          { item: "minecraft:trident", enchantment: "minecraft:loyalty", level: 3 },
          { item: "minecraft:leather_boots", enchantment: "minecraft:depth_strider", level: 3 },
        ],
      },
      {
        id: "tank",
        name: "Tank",
        items: [
          { item: "minecraft:stone_sword", slot: 0 },
          { item: "minecraft:shulker_shell", name: "Fortify", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:iron_helmet", chest: "minecraft:diamond_chestplate", legs: "minecraft:diamond_leggings", feet: "minecraft:iron_boots" },
        effects: [{ id: "slowness" }],
      },
      {
        id: "medic",
        name: "Medic",
        items: [
          { item: "minecraft:wooden_sword", slot: 0 },
          { item: "minecraft:glistering_melon_slice", name: "Heal", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:chainmail_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
      },
      {
        id: "scout",
        name: "Scout",
        items: [
          { item: "minecraft:stone_sword", slot: 0 },
          { item: "minecraft:feather", name: "Leap", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
        effects: [{ id: "speed" }],
      },
      {
        id: "assassin",
        name: "Assassin",
        items: [
          { item: "minecraft:diamond_sword", slot: 0 },
          { item: "minecraft:ink_sac", name: "Vanish", slot: ABILITY_SLOT },
        ],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
      },
    ],
  },
  options: [{ id: "bestOf", label: "Best of", values: BEST_OF.map((rounds) => ({ value: String(rounds), label: `${rounds} rounds` })) }],
  // Players watch from the spectator or queue spawn once they're out (core's default).
  map: { teamSpawns: true, bounds: true },
  stats: { mode: "team", pvp: true },
  /** The hotbar slot every class's ability item is in. */
  abilitySlot: ABILITY_SLOT,
  /** Each class's ability: the seconds before it can be used again, and what it does (siege.ts). */
  abilities: {
    /** Rally: Strength I and Speed I for the Soldier and every teammate within `radius` blocks, for `seconds`. */
    soldier: { cooldownSeconds: 25, radius: 8, seconds: 6 },
    /** Volley: `arrows` arrows at once, `spreadDegrees` apart in a fan, flying at `speed` (a full bow draw is about 3). */
    archer: { cooldownSeconds: 15, arrows: 5, spreadDegrees: 7, speed: 3 },
    /** Tidal Wave: every enemy within `radius` is pushed away (`push` along the ground, `lift` up), slowed, and soaked: water hurts them for `soakSeconds`. */
    seaman: { cooldownSeconds: 20, radius: 6, push: 2, lift: 0.4, soakSeconds: 3 },
    /** Fortify: for `seconds`, Resistance at `resistance` (0 is Resistance I), and no hit pushes the Tank. */
    tank: { cooldownSeconds: 25, seconds: 6, resistance: 1 },
    /** Heal: `health` back (2 is a heart) for the Medic and every teammate within `radius`. */
    medic: { cooldownSeconds: 20, radius: 8, health: 8 },
    /** Leap: a push the way the Scout looks, as Bridges' Leap feather. The Scout never takes fall damage. */
    scout: { cooldownSeconds: 8, forward: 3.2, lift: 0.55, up: 1 },
    /** Vanish: invisible, armor and name too, for `seconds`, or until the Assassin hits someone or is hit. */
    assassin: { cooldownSeconds: 25, seconds: 6 },
  },
  /** Water hurts everyone but a Seaman, `damage` (2 is a heart) every second. A Seaman in it has Speed at `seamanSpeed` (0 is Speed I). */
  water: { damage: 2, seamanSpeed: 1 },
  /** A Seaman whose trident hasn't come back (Loyalty brings it) gets a new one after this many seconds. */
  tridentBackSeconds: 5,
});

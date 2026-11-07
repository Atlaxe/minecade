import { ARSENAL_GUNS, arsenalItem, teamGunItem } from "@minecade/guns/defs";
import { defineGame } from "@minecade/minigame-core/config";

// The test game: everyone waits, counts down, plays one short stage with no damage, and is sent
// back to the lobby. Exercises the whole framework lifecycle without game rules of its own. It has
// two teams and a Round setting to test the lobby's game screen and team picking, and three kits to
// test the kit form's pictures (a full hotbar with armor, a full hotbar without, a few items with
// leather in the team's color), plus a Painter kit to try the shared guns, and Gunner and Grenadier
// kits to try the arsenal (its real guns; its grenades, knife, stimpack, crossbow and sword): set
// DEV_MIN_PLAYERS=1 to play it alone. Probe says what it got in chat when the match starts. The lobby lists it only
// while DEV_TEST_GAMES is 1.
export default defineGame({
  id: "probe",
  name: "Probe",
  description: "Test game: a short round on two teams, then everyone goes back to the lobby.",
  minPlayers: 2,
  maxPlayers: 8,
  test: true,
  waitForPlayersSeconds: 20,
  countdownSeconds: 3,
  timeLimitSeconds: 15,
  endDelaySeconds: 3,
  combat: { damage: "none" },
  win: "custom",
  teams: { count: 2 },
  kits: {
    select: "match",
    pickSeconds: 20,
    list: [
      // Nine items and armor: the picture shows the first eight, then the armor.
      {
        id: "soldier",
        name: "Soldier",
        items: [
          { item: "minecraft:iron_sword" },
          { item: "minecraft:bow" },
          { item: "minecraft:arrow", count: 32 },
          { item: "minecraft:golden_apple", count: 3 },
          { item: "minecraft:cooked_beef", count: 16 },
          { item: "minecraft:ender_pearl", count: 4 },
          { item: "minecraft:water_bucket" },
          { item: "minecraft:iron_pickaxe" },
          { item: "minecraft:cobblestone", count: 64 },
        ],
        armor: { head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate", legs: "minecraft:iron_leggings", feet: "minecraft:iron_boots" },
      },
      // Nine items and no armor: all nine.
      {
        id: "builder",
        name: "Builder",
        items: [
          { item: "minecraft:{color}_wool", count: 64 },
          { item: "minecraft:cobblestone", count: 64 },
          { item: "minecraft:oak_planks", count: 64 },
          { item: "minecraft:glass", count: 32 },
          { item: "minecraft:stone_pickaxe" },
          { item: "minecraft:iron_axe" },
          { item: "minecraft:shears" },
          { item: "minecraft:water_bucket" },
          { item: "minecraft:bread", count: 8 },
        ],
      },
      // A few items, empty slots, and leather in the team's color in the last slot.
      {
        id: "scout",
        name: "Scout",
        items: [{ item: "minecraft:stone_sword" }, { item: "minecraft:bow" }, { item: "minecraft:arrow", count: 16 }],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
      },
      // The shared guns pack's guns and grenades (packs/guns) in the team's paint: their balls splash in it.
      {
        id: "painter",
        name: "Painter",
        items: [
          { item: teamGunItem("pistol") },
          { item: teamGunItem("rifle") },
          { item: teamGunItem("shotgun") },
          { item: teamGunItem("grenade"), count: 16 },
        ],
        armor: { head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate", legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots" },
        teamArmor: true,
      },
      // The arsenal's nine guns, one a slot.
      { id: "gunner", name: "Gunner", items: ARSENAL_GUNS.map((gun) => ({ item: arsenalItem(gun) })) },
      // The arsenal's grenades, knife and stimpack, and the one-hit vanilla weapons (arrows come by themselves).
      {
        id: "grenadier",
        name: "Grenadier",
        items: [
          { item: arsenalItem("frag_grenade"), count: 4 },
          { item: arsenalItem("molotov"), count: 4 },
          { item: arsenalItem("flashbang"), count: 4 },
          { item: arsenalItem("smoke_grenade"), count: 4 },
          { item: arsenalItem("throwing_knife"), count: 4 },
          { item: arsenalItem("stimpack"), count: 4 },
          { item: "minecraft:crossbow" },
          { item: "minecraft:netherite_sword" },
        ],
      },
    ],
  },
  options: [
    {
      id: "round",
      label: "Round",
      values: [
        { value: "15", label: "15 s" },
        { value: "30", label: "30 s" },
        { value: "60", label: "60 s" },
      ],
    },
  ],
});

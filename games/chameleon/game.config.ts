import { arsenalItem } from "@minecade/guns/defs";
import { defineGame } from "@minecade/minigame-core/config";

/**
 * Each side's hotbar, slot by slot. The hiders' abilities are the chameleon pack's
 * (private_packs/chameleon, from the workshop's chameleon-test), which knows them by item and name,
 * so these must match it; wool until they get icons of their own. The hiders' first slot is left
 * free to hit seekers with.
 */
export const HOTBARS = {
  hiders: [
    { item: "minecraft:lime_wool", name: "Wear block", slot: 1 },
    { item: "minecraft:yellow_wool", name: "Pose", slot: 2 },
    { item: "minecraft:purple_wool", name: "Lock position", slot: 3 },
    { item: "minecraft:orange_wool", name: "Taunt", slot: 5 },
    { item: "minecraft:light_blue_wool", name: "Free look", slot: 8 },
  ],
  seekers: [
    { item: arsenalItem("pump_shotgun"), slot: 0 },
    { item: "minecraft:cyan_wool", name: "Detector", slot: 1 },
  ],
} as const;

// Chameleon: hide and seek where the hiders wear the blocks around them. One seeker (picked in the
// lobby, else dealt) waits blinded while the hiders hide (the map's Hide time), then hunts them
// with an unlimited Pump Shotgun and a Detector that says how near the nearest hider is. A hider
// shot down is found, and joins the seekers 3 seconds later at their spawn. The seekers win when
// every hider is found; the hiders win when the clock runs out with any of them still hidden. A
// hider's hit on a seeker throws them far and takes half a heart, never the last; seekers only
// find with the shotgun. The hiders' side (wearing blocks, poses, the camera, free look, being
// unseen by other hiders, the costumes on the right) is the chameleon pack's; without it installed
// the hiders are themselves.
export default defineGame({
  id: "chameleon",
  name: "Chameleon",
  description: "Hiders wear the blocks around them. A seeker hunts them down, and everyone found joins the hunt.",
  minPlayers: 2,
  maxPlayers: 8,
  countdownSeconds: 5,
  // The seek, after the hide (map setting hideSeconds).
  timeLimitSeconds: 300,
  endDelaySeconds: 6,
  lateJoin: "spectate",
  teams: {
    count: 2,
    defs: [
      { id: "seekers", name: "Seekers", color: "§c", size: 1 },
      { id: "hiders", name: "Hiders", color: "§a", size: "rest" },
    ],
  },
  combat: { fall: false, killCreditSeconds: 10 },
  // A found hider comes back as a seeker; a seeker who falls out comes back too.
  respawn: { mode: "unlimited", delaySeconds: 3 },
  win: "custom",
  timeUp: { team: "hiders" },
  // A hider shot down "was found by" the seeker who did it.
  deathMessages: { verbs: ["found"], replace: true },
  map: {
    teamSpawns: true,
    settings: {
      hideSeconds: { label: "Hide time", hint: "How long the seekers wait, blinded, while the hiders hide", default: 30, min: 10, max: 120, unit: "seconds" },
    },
  },
  hotbars: HOTBARS,
  // The hotbars are handed out by script, not a kit: the map editor's mannequins can hold them.
  mannequinItems: [...HOTBARS.seekers, ...HOTBARS.hiders].map((entry) => ("name" in entry ? { item: entry.item, name: entry.name } : entry.item)),
  /** A hider's hit on a seeker: thrown about as far as knockback 5 would, half a heart, then a pause before that seeker can be hit again. */
  hiderHit: { damage: 1, horizontal: 2.5, vertical: 0.5, pauseTicks: 10 },
  /**
   * The Detector: how near the nearest hider (or their stand-in) is, as beeps (more and quicker the
   * nearer) and a word in chat, then a wait before it works again.
   */
  detector: {
    cooldownSeconds: 10,
    bands: [
      { within: 8, word: "Hot", text: "a hider is within 8 blocks", beeps: 5, gapTicks: 3, pitch: 2 },
      { within: 16, word: "Warm", text: "the nearest hider is 8 to 16 blocks away", beeps: 4, gapTicks: 5, pitch: 1.6 },
      { within: 32, word: "Cool", text: "the nearest hider is 16 to 32 blocks away", beeps: 3, gapTicks: 8, pitch: 1.2 },
      { within: 100000, word: "Cold", text: "the nearest hider is more than 32 blocks away", beeps: 2, gapTicks: 12, pitch: 0.8 },
    ],
  },
});

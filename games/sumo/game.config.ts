import { defineGame } from "@minecade/minigame-core/config";

// Sumo: hits push but never hurt, and anyone knocked below the platform (the map's killY) or out
// of its bounds is out, credited to whoever hit them last. No respawns: the last player on the
// platform wins. A stalemate ends in a draw when time runs out.
export default defineGame({
  id: "sumo",
  name: "Sumo",
  description: "Knock everyone off the platform. Last one standing wins.",
  minPlayers: 2,
  maxPlayers: 6,
  countdownSeconds: 5,
  timeLimitSeconds: 180,
  endDelaySeconds: 6,
  lateJoin: "return",
  combat: { fall: false, outOfBounds: "down", killCreditSeconds: 8 },
  respawn: { mode: "none" },
  win: "last",
  timeUp: "draw",
  stats: { mode: "solo", pvp: true },
  /**
   * "vanilla" (default): a player's hit lands with 0 damage, which keeps Minecraft's own
   * knockback (sprint bonus included) and its 10-tick hit cooldown.
   * "scripted": the hit is canceled and the victim is pushed by script, at most once per
   * `cooldownTicks` per victim. The defaults match vanilla as measured on BDS 1.26.60 (see
   * docs/spike-results.md, "Knockback"); raise them for a bouncier Sumo.
   */
  knockback: {
    mode: "vanilla" as "vanilla" | "scripted",
    horizontal: 1.0,
    vertical: 0.4,
    sprintHorizontal: 1.5,
    sprintVertical: 0.32,
    cooldownTicks: 10,
  },
});

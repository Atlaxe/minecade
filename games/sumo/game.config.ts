import { defineGame } from "@minecade/minigame-core/config";

// Sumo: hits push but never hurt, twice as far as vanilla's, and anyone knocked below the platform
// (the map's killY) or out of its bounds is out, credited to whoever hit them last. Everyone can
// jump once more in the air. No respawns: the last player on the platform wins. A stalemate ends in
// a draw when time runs out.
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
   * knockback (sprint bonus included), its hurt flash and its 10-tick hit cooldown; with a
   * `strength` over 1 a push on top of each hit that lands makes it that many times as far.
   * "scripted": the hit is canceled and the victim is pushed by script, at most once per
   * `cooldownTicks` per victim. The numbers below match vanilla as measured on BDS 1.26.60 (see
   * docs/spike-results.md, "Knockback"); scripted mode multiplies their horizontal by `strength`.
   */
  knockback: {
    mode: "vanilla" as "vanilla" | "scripted",
    /** How far a hit throws, as a multiple of vanilla's (the user's ask, 2026-11-11: double). */
    strength: 2,
    horizontal: 1.0,
    vertical: 0.4,
    sprintHorizontal: 1.5,
    sprintVertical: 0.32,
    cooldownTicks: 10,
  },
  /**
   * Jump again in the air (the user's ask, 2026-11-11), once until you land: you rise at `up`
   * blocks a tick (a ground jump is 0.42; 0.5 peaks about 1.7 blocks up), and holding forward or
   * back adds `forward` along the ground the way you look (applyKnockback's horizontal: 0.75 is 0.3
   * blocks a tick, about a sprint), while half your speed in the air is kept.
   */
  doubleJump: { enabled: true, up: 0.5, forward: 0.75 },
});

import { defineGame } from "@minecade/minigame-core/config";

// The test game: everyone waits, counts down, plays one 15 second stage with no damage, and is
// sent back to the lobby. Exercises the whole framework lifecycle without game rules of its own.
export default defineGame({
  id: "probe",
  name: "Probe",
  description: "Test game: a 15 second round, then everyone goes back to the lobby.",
  minPlayers: 1,
  maxPlayers: 8,
  waitForPlayersSeconds: 20,
  countdownSeconds: 3,
  timeLimitSeconds: 15,
  endDelaySeconds: 3,
  combat: { damage: "none" },
  win: "custom",
});

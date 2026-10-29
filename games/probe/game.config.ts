import { defineGame } from "@minecade/minigame-core/config";

// The test game: everyone waits, counts down, plays one short stage with no damage, and is sent
// back to the lobby. Exercises the whole framework lifecycle without game rules of its own. It has
// two teams and a Round setting to test the lobby's game screen and team picking: set
// DEV_MIN_PLAYERS=1 to play it alone. Probe says what it got in chat when the match starts.
export default defineGame({
  id: "probe",
  name: "Probe",
  description: "Test game: a short round on two teams, then everyone goes back to the lobby.",
  minPlayers: 2,
  maxPlayers: 8,
  waitForPlayersSeconds: 20,
  countdownSeconds: 3,
  timeLimitSeconds: 15,
  endDelaySeconds: 3,
  combat: { damage: "none" },
  win: "custom",
  teams: { count: 2 },
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

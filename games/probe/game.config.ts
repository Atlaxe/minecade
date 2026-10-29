import { defineGame } from "@minecade/minigame-core/config";

export default defineGame({
  id: "probe",
  name: "Probe",
  description: "Test game: greets you, then sends everyone back to the lobby.",
  minPlayers: 1,
  maxPlayers: 8,
});

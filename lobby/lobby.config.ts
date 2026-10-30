import { defineLobby } from "@minecade/minigame-core/config";

// The lobby's definition: what every lobby map (lobby/maps/<id>/) needs. The build checks each map
// against it, and the map editor lists it as the map's checklist. The live lobby map is picked by
// LOBBY_MAP in .env.
export default defineLobby({
  map: {
    spawns: { min: 1 },
    // The middle block of the terminal's 3x3 console; the hologram floats above it.
    points: { terminal: { label: "Terminal", count: 1 } },
  },
});

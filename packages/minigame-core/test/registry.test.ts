import { describe, expect, it } from "vitest";
import { PLACEHOLDER_PICTURES, holoPictures, type Registry } from "../src/definitions.ts";

describe("holoPictures", () => {
  it("lists none, the placeholders, then each game's picture and map previews, once each", () => {
    const registry: Registry = {
      games: [
        {
          id: "sumo",
          name: "Sumo",
          minPlayers: 2,
          maxPlayers: 6,
          icon: "textures/minecade/games/sumo",
          maps: [
            { id: "arena_1", name: "Arena" },
            { id: "pit", name: "Pit", preview: "textures/minecade/maps/sumo/pit" },
          ],
        },
        { id: "probe", name: "Probe", minPlayers: 1, maxPlayers: 8, maps: [{ id: "default", name: "Default", preview: PLACEHOLDER_PICTURES.map }] },
      ],
    };
    expect(holoPictures(registry)).toEqual([
      PLACEHOLDER_PICTURES.none,
      PLACEHOLDER_PICTURES.game,
      PLACEHOLDER_PICTURES.map,
      "textures/minecade/games/sumo",
      "textures/minecade/maps/sumo/pit",
    ]);
    expect(holoPictures({ games: [] })).toHaveLength(3);
  });
});

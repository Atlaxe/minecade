import { describe, expect, it } from "vitest";
import { PLACEHOLDER_PICTURES, badgeFor, holoPictures, holoPortraits, skinTexture, type Registry } from "../src/definitions.ts";

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

describe("holoPortraits", () => {
  it("lists none, then every badge, and every badge a name can get is in it", () => {
    const portraits = holoPortraits();
    expect(portraits[0]).toBe(PLACEHOLDER_PICTURES.none);
    expect(portraits).toHaveLength(1 + 36 + 1);
    for (const name of ["Steve", "zed", "7even", "_x", ""]) expect(portraits).toContain(badgeFor(name));
  });

  it("adds each player's hologram render after the badges", () => {
    const portraits = holoPortraits([
      { name: "Steve", key: "111" },
      { name: "Alex", key: "222" },
    ]);
    expect(portraits).toHaveLength(1 + 36 + 1 + 2);
    expect(portraits.slice(-2)).toEqual([skinTexture("111", "holo"), skinTexture("222", "holo")]);
    expect(skinTexture("111", "holo_head")).toBe("textures/minecade/skins/111_holo_head");
  });
});

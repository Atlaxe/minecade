// The building games' blocks that stay where they're put: the twin of each vanilla block that falls,
// and the files tools/assets/still-blocks.ts writes for them into each game's packs.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STILL_BLOCK_GAMES, stillBlockFiles } from "../../../tools/assets/still-blocks.ts";
import { ANVIL_FACING, STILL_BLOCKS, isStill, stillStates, stillTwin } from "../src/building/still-blocks.ts";

describe("the building games' blocks that stay put", () => {
  it("has a twin for every block that falls: the 16 concrete powders, sand, red sand, gravel, the three anvils and the dragon egg", () => {
    expect(STILL_BLOCKS).toHaveLength(23);
    expect(stillTwin("minecraft:light_gray_concrete_powder")).toMatchObject({ still: "minecade:still_light_gray_concrete_powder", textures: { all: "textures/blocks/concrete_powder_silver" } });
    expect(stillTwin("minecraft:sand")?.still).toBe("minecade:still_sand");
    expect(stillTwin("minecraft:stone")).toBeUndefined();
    expect(stillTwin("minecade:still_sand")).toBeUndefined();
    expect(isStill("minecade:still_gravel")).toBe(true);
    expect(isStill("minecraft:gravel")).toBe(false);
  });

  it("keeps an anvil's damage and facing, as BDS gives them (a damage state, a cardinal direction or an older number)", () => {
    expect(stillTwin("minecraft:chipped_anvil")?.still).toBe("minecade:still_chipped_anvil");
    expect(stillTwin("minecraft:anvil", { damage: "very_damaged" })?.still).toBe("minecade:still_damaged_anvil");
    expect(stillTwin("minecraft:anvil", { damage: "undamaged" })?.still).toBe("minecade:still_anvil");
    const anvil = stillTwin("minecraft:anvil")!;
    expect(stillStates(anvil, { direction: 1, [ANVIL_FACING]: "west", damage: "undamaged" })).toEqual({ [ANVIL_FACING]: "west" });
    expect(stillStates(anvil, { direction: 3 })).toEqual({ [ANVIL_FACING]: "east" });
    expect(stillStates(stillTwin("minecraft:red_sand")!, { color: "red" })).toEqual({});
  });

  it("match what tools/assets/still-blocks.ts writes into Build Swap's and Guess the Build's packs (rerun it after changing still-blocks.ts)", () => {
    expect(STILL_BLOCK_GAMES).toEqual(["buildswap", "guessbuild"]);
    for (const game of STILL_BLOCK_GAMES) {
      for (const [path, content] of Object.entries(stillBlockFiles(game))) {
        const file = fileURLToPath(new URL(`../../../games/${game}/${path}`, import.meta.url));
        expect(existsSync(file), `${game}/${path}`).toBe(true);
        expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), `${game}/${path}`).toBe(content);
      }
    }
    const files = stillBlockFiles("guessbuild");
    expect(files["resource_pack/texts/en_US.lang"]).toContain("tile.minecade:still_red_concrete_powder.name=Red Concrete Powder");
    expect(files["resource_pack/textures/terrain_texture.json"]).toContain('"resource_pack_name": "minecade_guessbuild"');
  });
});

// Build Swap's blocks that stay where they're put: the twin of each vanilla block that falls, and the
// files tools/assets/still-blocks.ts writes for them.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stillBlockFiles } from "../../../tools/assets/still-blocks.ts";
import { ANVIL_FACING, STILL_BLOCKS, isStill, stillStates, stillTwin } from "../behavior_pack/scripts/still-blocks.ts";

describe("Build Swap's blocks that stay put", () => {
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

  it("match what tools/assets/still-blocks.ts writes (rerun it after changing still-blocks.ts)", () => {
    for (const [path, content] of Object.entries(stillBlockFiles())) {
      const file = fileURLToPath(new URL(`../${path}`, import.meta.url));
      expect(existsSync(file), path).toBe(true);
      expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), path).toBe(content);
    }
    const lang = stillBlockFiles()["resource_pack/texts/en_US.lang"];
    expect(lang).toContain("tile.minecade:still_red_concrete_powder.name=Red Concrete Powder");
  });
});

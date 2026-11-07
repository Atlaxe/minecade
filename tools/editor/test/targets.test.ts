import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTarget } from "../targets.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("the editor's targets", () => {
  it("know the games that borrow a game's maps, which a preview can play its maps as", async () => {
    expect((await loadTarget(root, "siege")).borrowers).toEqual([{ id: "gunfight", name: "Gunfight", maxPlayers: 8 }]);
    expect((await loadTarget(root, "quiver")).borrowers).toBeUndefined();
    expect((await loadTarget(root, "lobby")).borrowers).toBeUndefined();
  });
});

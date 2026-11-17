import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listTargets, loadTarget } from "../targets.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("the editor's targets", () => {
  it("know the games that borrow a game's maps, which a preview can play its maps as", async () => {
    expect((await loadTarget(root, "siege")).borrowers).toEqual([{ id: "gunfight", name: "Gunfight", maxPlayers: 4 }]);
    expect((await loadTarget(root, "quiver")).borrowers).toEqual([{ id: "gungame", name: "Gun Game", maxPlayers: 8 }]);
    expect((await loadTarget(root, "bridges")).borrowers).toBeUndefined();
    expect((await loadTarget(root, "lobby")).borrowers).toBeUndefined();
  });

  it("give each of a game's arenas an entry of its own, after the game, checked against the arena's rules", async () => {
    const ids = (await listTargets(root)).map((target) => target.id);
    const game = ids.indexOf("blockparty");
    expect(ids.slice(game, game + 4)).toEqual(["blockparty", "blockparty-hotfloor", "blockparty-painters", "blockparty-hunter"]);
    const painters = await loadTarget(root, "blockparty-painters");
    expect(painters).toMatchObject({ name: "Co-op Painters (Block Party)", arena: { game: "blockparty", gameName: "Block Party", id: "painters" }, rules: { kind: "game", maxPlayers: 4 } });
    expect(painters.rules.teams?.map((team) => team.id)).toEqual(["red", "blue"]);
    expect(painters.mapsDir.endsWith(join("working", "blockparty-painters"))).toBe(true);
    expect(Object.keys((painters.rules.requires?.regions ?? {}) as object)).toEqual(["structure", "floor"]);
    await expect(loadTarget(root, "blockparty-nothing")).rejects.toThrow('there is no game "blockparty-nothing"');
  });

  it("give the gun games' mannequins the guns the games hand out, not only their kits' items", async () => {
    const labels = async (id: string) => (await loadTarget(root, id)).rules.items?.map(({ label }) => label);
    expect(await labels("gunfight")).toEqual([
      "Assault Rifle",
      "SMG",
      "Burst Rifle",
      "Pump Shotgun",
      "Double Barrel",
      "Sniper Rifle",
      "Rail Gun",
      "Crossbow",
      "Pistol",
      "RPG",
      "Netherite Sword",
      "Frag Grenade",
      "Molotov",
      "Flashbang",
      "Smoke Grenade",
      "Throwing Knife",
      "Stimpack",
    ]);
    expect(await labels("gungame")).toEqual(["Pistol", "SMG", "Assault Rifle", "Burst Rifle", "Pump Shotgun", "Double Barrel", "Sniper Rifle", "Rail Gun", "RPG", "Crossbow", "Netherite Sword"]);
    expect((await loadTarget(root, "paintball")).rules.items).toEqual([
      { item: "minecade:{color}_paintball_pistol", label: "Paintball Pistol" },
      { item: "minecade:{color}_paintball_rifle", label: "Paintball Rifle" },
      { item: "minecade:{color}_paintball_shotgun", label: "Paintball Shotgun" },
      { item: "minecade:{color}_paint_grenade", label: "Paint Grenade" },
    ]);
  });
});

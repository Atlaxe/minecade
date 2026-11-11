import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTarget } from "../targets.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("the editor's targets", () => {
  it("know the games that borrow a game's maps, which a preview can play its maps as", async () => {
    expect((await loadTarget(root, "siege")).borrowers).toEqual([{ id: "gunfight", name: "Gunfight", maxPlayers: 8 }]);
    expect((await loadTarget(root, "quiver")).borrowers).toEqual([{ id: "gungame", name: "Gun Game", maxPlayers: 8 }]);
    expect((await loadTarget(root, "bridges")).borrowers).toBeUndefined();
    expect((await loadTarget(root, "lobby")).borrowers).toBeUndefined();
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

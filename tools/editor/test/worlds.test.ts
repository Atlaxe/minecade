import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientWorlds, pickWorld, resolveWorld } from "../worlds.ts";

describe("worlds Select mode can open", () => {
  let appData: string;
  let worlds: string;

  beforeAll(async () => {
    appData = await mkdtemp(join(tmpdir(), "minecade-worlds-test-"));
    worlds = join(appData, "Minecraft Bedrock", "Users", "1234", "games", "com.mojang", "minecraftWorlds");
    for (const [folder, name] of [["abc=", "Arenas"], ["def=", "My World"], ["ghi=", "arenas"]] as const) {
      await mkdir(join(worlds, folder), { recursive: true });
      await writeFile(join(worlds, folder, "level.dat"), "");
      await writeFile(join(worlds, folder, "levelname.txt"), name);
    }
    // Not a world: no level.dat.
    await mkdir(join(worlds, "junk"), { recursive: true });
  });

  afterAll(async () => {
    await rm(appData, { recursive: true, force: true });
  });

  it("lists the client's worlds by the name the game shows", async () => {
    const list = await clientWorlds(appData);
    expect(list.map((world) => world.name)).toEqual(["arenas", "Arenas", "My World"].sort((a, b) => a.localeCompare(b)));
    expect(await clientWorlds(join(appData, "nowhere"))).toEqual([]);
  });

  it("picks a world by name, in any case, unless two share it", async () => {
    const list = await clientWorlds(appData);
    expect(pickWorld(list, " my world ")).toMatchObject({ name: "My World", path: join(worlds, "def=") });
    expect(pickWorld(list, "Arenas")).toContain("more than one world");
    expect(pickWorld(list, "Castle")).toContain("no world called");
  });

  it("opens a world folder by its path", async () => {
    expect(await resolveWorld(join(worlds, "def="), join(appData, "unzip"), appData)).toEqual({ name: "My World", path: join(worlds, "def=") });
    await expect(resolveWorld(join(worlds, "junk"), join(appData, "unzip"), appData)).rejects.toThrow("no level.dat");
  });
});

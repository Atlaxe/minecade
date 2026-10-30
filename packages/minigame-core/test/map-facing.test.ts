// Saved facings through a real match in the fake world: spawns at a saved facing face that way,
// the others face the middle of the map, and spectators get the spectator spawn's facing.
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { GameConfig } from "../src/config.ts";
import { Minigame } from "../src/game/minigame.ts";
import type { MapConfig } from "../src/map-config.ts";
import { world } from "./fake-mc-server.ts";
import { createHarness, playToEnd, snapshot, ticks, type Harness } from "./game-harness.ts";

class TestGame extends Minigame {}

const MAP: MapConfig = {
  name: "Facing",
  spawns: [[0, 65, 0, 90, 10], [4, 65, 0]],
  spectatorSpawn: [0, 75, 0, -45, 30],
  bounds: { min: [-20, 40, -20], max: [20, 100, 20] },
};
const config: GameConfig = { id: "facing", name: "Facing", minPlayers: 2, maxPlayers: 2, countdownSeconds: 1, endDelaySeconds: 1 };

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

it("spawns at a saved facing, else facing the middle, and spectates at the spectator spawn's facing", async () => {
  const [a, b] = ["A", "B"].map((name) => world.join(name));
  const game = new TestGame(harness.context(["A", "B"], MAP), config);
  await playToEnd(game, harness.root, snapshot(harness.root), async () => {
    for (let i = 0; i < 200 && game.phase !== "playing"; i++) await ticks(1);
    expect(game.phase).toBe("playing");
    expect(a.teleportFacings.at(-1)).toEqual({ rotation: { x: 10, y: 90 } });
    const facing = b.teleportFacings.at(-1) as { facingLocation: { x: number; y: number; z: number } };
    expect(facing.facingLocation.x).toBe(0.5);
    expect(facing.facingLocation.y).toBeCloseTo(66.62);
    expect(facing.facingLocation.z).toBe(0.5);
    world.kill(b);
    await ticks(2);
    expect(b.teleportFacings.at(-1)).toEqual({ rotation: { x: 30, y: -45 } });
  });
});

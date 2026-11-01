// A game previewed from the map editor: fake players (/fake) wait, spawn and go down like players,
// right clicking one asks whether it should kill you, and /exit ends the preview for a map editor (a guest just
// leaves). Outside previews there are no fake players.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameConfig } from "../src/config.ts";
import { FAKE_PLAYER, FakePlayers } from "../src/game/fakes.ts";
import { Minigame } from "../src/game/minigame.ts";
import { DANGER_BUTTON, SIDE_TITLE } from "../src/game/preview.ts";
import { stripColors } from "../src/text.ts";
import { transfers } from "./fake-mc-server-admin.ts";
import { world, type FakeMob } from "./fake-mc-server.ts";
import { queueFormResponses, shownForms } from "./fake-mc-server-ui.ts";
import { ARENA, createHarness, everyoneLeaves, expectBaseline, playToEnd, snapshot, ticks, type Harness } from "./game-harness.ts";

class TestGame extends Minigame {}

const FFA: GameConfig = { id: "ffa", name: "FFA", minPlayers: 2, maxPlayers: 4, countdownSeconds: 3, endDelaySeconds: 1, lateJoin: "join" };
const COUNTDOWN_TICKS = 3 * 20 + 25;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
  everyoneLeaves();
});

/** A preview of `config` with `names` (all map editors unless `guests` says otherwise). */
function preview(names: string[], config: GameConfig, guests: string[] = []) {
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const context = harness.context(names);
  context.vars.preview = "FFA: Arena";
  context.vars.lanPlayers = names.filter((name) => !guests.includes(name));
  current = new TestGame(context, config);
  return { players, baseline, game: current };
}

/** The game the test is previewing. */
let current: Minigame | undefined;

/** A fake player's body now (its name tag is hidden during a match, so the game says which it is). */
function bodyOf(name: string): FakeMob | undefined {
  return current?.body(name) as FakeMob | undefined;
}

describe("fake players in a preview", () => {
  it("wait at spawns, start the match with the player, die to hits and to a confirmed right click", async () => {
    const { players, baseline, game } = preview(["A"], FFA);
    const [a] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(1);
      expect(game.addFakes(2)).toContain("Added Fake 1, Fake 2");
      await ticks(1); // placed once their chunks tick (a ticking area each)
      expect(world.tickingAreaManager.areas.size).toBe(2);
      // They wait at spawns of their own: the player has the first.
      expect(bodyOf("Fake 1")?.location).toEqual({ x: 4.5, y: 65, z: 0.5 });
      expect(bodyOf("Fake 2")?.location).toEqual({ x: -3.5, y: 65, z: 0.5 });
      expect(stripColors(bodyOf("Fake 2")?.nameTag ?? "")).toBe("Fake 2");
      await ticks(20 + COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(game.roster.all().map((participant) => participant.name)).toEqual(["A", "Fake 1", "Fake 2"]);
      // Name tags are hidden during a match (the game doesn't ask for them), fakes' as well as players'.
      expect(bodyOf("Fake 2")?.nameTag).toBe("");
      expect(players[0].nameTag).toBe("");

      // A sword kill: the hit is intercepted like a player's, and the fake is out (no respawns).
      const fake1 = bodyOf("Fake 1");
      world.hurt(fake1!, 25, "entityAttack", { attacker: a });
      expect(fake1!.health.currentValue).toBe(20);
      await ticks(1);
      expect(fake1!.isValid).toBe(false);
      expect(game.roster.get("Fake 1")?.state).toBe("out");
      expect(stripColors(world.chat.at(-1) ?? "")).toMatch(/^Fake 1 .* A$/);

      // Right click: the side panel asks first. Cancel leaves everyone be; confirming lets the fake
      // kill the player, credited to it.
      queueFormResponses({ canceled: false, selection: 1 });
      world.afterEvents.playerInteractWithEntity.emit({ player: a, target: bodyOf("Fake 2")! });
      await ticks(2);
      expect(shownForms.at(-1)?.titleText).toBe(`${SIDE_TITLE}Fake 2`);
      expect(shownForms.at(-1)?.buttons).toEqual([`${DANGER_BUTTON}Fake 2 kills you`, "Cancel"]);
      expect(game.roster.get("A")?.state).toBe("alive");
      queueFormResponses({ canceled: false, selection: 0 });
      world.afterEvents.playerInteractWithEntity.emit({ player: a, target: bodyOf("Fake 2")! });
      await ticks(2);
      expect(game.roster.get("A")?.state).toBe("out");
      expect(game.roster.get("Fake 2")?.state).toBe("alive");
      expect(world.chat.map(stripColors)).toContainEqual(expect.stringMatching(/^A .* Fake 2$/));
    });
    expect(result).toMatchObject({ kind: "win", players: ["Fake 2"] });
    // Nothing is left of them once the match is over.
    expect(world.overworld.spawned.filter((mob) => mob.isValid)).toEqual([]);
    expect(world.tickingAreaManager.areas.size).toBe(0);
    expectBaseline(harness.root, baseline);
  });

  it("join a running match as late joiners, up to the game's limit, when the game lets anyone in", async () => {
    const { players, baseline, game } = preview(["A", "B"], { ...FFA, respawn: { mode: "unlimited", delaySeconds: 1 }, timeLimitSeconds: 0, win: "custom" });
    const [a] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(game.addFakes(5)).toContain("Added Fake 1, Fake 2.");
      expect(game.addFakes(1)).toContain("FFA is full: 4 players.");
      await ticks(1);
      expect(game.roster.get("Fake 2")?.state).toBe("alive");
      expect(bodyOf("Fake 2")).toBeDefined();
      // Down and back at a spawn after the respawn delay.
      world.hurt(bodyOf("Fake 2")!, 30, "entityAttack", { attacker: a });
      await ticks(1);
      expect(bodyOf("Fake 2")).toBeUndefined();
      await ticks(25);
      expect(game.roster.get("Fake 2")?.state).toBe("alive");
      expect(bodyOf("Fake 2")).toBeDefined();
      game.exitPreview(a as never);
    });
    expect(result).toMatchObject({ kind: "aborted" });
    expect(world.chat.map(stripColors)).toContain("A ended the preview.");
    expectBaseline(harness.root, baseline);
  });

  it("can't join a running match that lets nobody in; a guest's /exit only sends them home", async () => {
    transfers.length = 0;
    const { players, baseline, game } = preview(["A", "Guest"], { ...FFA, lateJoin: "spectate", win: "custom", timeLimitSeconds: 2 }, ["Guest"]);
    const [, guest] = players;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(COUNTDOWN_TICKS);
      expect(game.addFakes(1)).toContain("FFA lets nobody in once it has started");
      game.exitPreview(guest as never);
      expect(transfers.map((transfer) => transfer.player)).toEqual(["Guest"]);
      expect(game.phase).toBe("playing");
    });
    expectBaseline(harness.root, baseline);
  });

  it("start with the match when picked before the preview loaded, leaving room for everyone expected", async () => {
    const { baseline, game } = preview(["A", "B"], { ...FFA, win: "custom", timeLimitSeconds: 0 });
    game.ctx.vars.previewFakes = 5;
    await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      // FFA takes 4 and the preview expects A and B: room for 2 of the 5.
      expect(game.roster.all().length === 0 && ["Fake 1", "Fake 2"].every((name) => bodyOf(name) !== undefined)).toBe(true);
      expect(bodyOf("Fake 3")).toBeUndefined();
      game.abort();
    });
    expectBaseline(harness.root, baseline);
  });

  it("never appear when they went down while their chunk was loading", async () => {
    const fakes = new FakePlayers(world.getDimension("overworld") as never);
    const name = fakes.add();
    const placed = fakes.place(name, { x: 0, y: 65, z: 0 }, name);
    fakes.hide(name);
    expect(await placed).toBeUndefined();
    expect(fakes.body(name)).toBeUndefined();
    expect(world.tickingAreaManager.areas.size).toBe(0);
    // Placed again, it moves its ticking area along: one at a time.
    await fakes.place(name, { x: 0, y: 65, z: 0 }, name);
    await fakes.place(name, { x: 40, y: 65, z: 0 }, name);
    expect(fakes.body(name)?.location).toEqual({ x: 40, y: 65, z: 0 });
    expect(world.tickingAreaManager.areas.size).toBe(1);
    fakes.clear();
    expect(world.tickingAreaManager.areas.size).toBe(0);
  });

  it("are only for previews", () => {
    world.join("A");
    const game = new TestGame(harness.context(["A"]), FFA);
    expect(game.fakes).toBeUndefined();
    expect(stripColors(game.addFakes(1))).toBe("Fake players are only for previews.");
  });
});

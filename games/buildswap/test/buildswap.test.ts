// Build Swap against the fake world, on a row of eight 24-block building areas: the prompt form,
// the deal (nobody gets their own prompt), building only in your area, the swap, voting on each
// build before and after its twist, and the winner by points.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dealPrompts, promptReplyParts, runtimeMapConfig, stripColors, validateMapConfig, type MapConfig, type MapPosition } from "@minecade/minigame-core/config";
import { encodeMessage, type PromptRequest } from "@minecade/minigame-core/protocol";
import { Direction, ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { openLiveForm } from "../../../packages/minigame-core/test/fake-mc-server-ui.ts";
import { CLOCK_PLACES, HUD_MARK, NOTES_MARK } from "../../../packages/minigame-core/src/hud.ts";
import { createHarness, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import config from "../game.config.ts";
import { BuildSwap, standings } from "../behavior_pack/scripts/buildswap.ts";
import { clampInto, pairPlots, shell, swapPlots, tiles } from "../behavior_pack/scripts/plots.ts";
import { WAND, boxVolume, clipBox, cornersBox, fillPieces, fixCells, sizeText, type FixCell } from "../behavior_pack/scripts/selection.ts";
import { Ballot, VOTES } from "../behavior_pack/scripts/votes.ts";

/** Eight building areas in a row along x, 40 blocks apart, each 24 blocks on a side, with a floor under it at y 63. */
const PLOTS = Array.from({ length: 8 }, (_, i) => ({ min: [i * 40, 64, 0] as [number, number, number], max: [i * 40 + 23, 87, 23] as [number, number, number] }));
const SPAWNS: MapPosition[] = PLOTS.map((plot) => [plot.min[0] + 12, 64, 12]);
const ROW: MapConfig = runtimeMapConfig({
  name: "Row",
  spawns: SPAWNS,
  spectatorSpawn: [150, 110, 12],
  regions: { plot: PLOTS },
});
const COUNTDOWN_TICKS = config.countdownSeconds * 20 + 5;

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

function start(names: string[], overrides: Partial<typeof config> = {}, settings: Record<string, string> = {}, map: MapConfig = ROW, editors: string[] = []) {
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const context = harness.context(names, map, settings);
  if (editors.length > 0) {
    context.vars.preview = "Build Swap: Row";
    context.vars.lanPlayers = editors;
  }
  const game = new BuildSwap(context, { ...config, ...overrides });
  return { players, baseline, from, game };
}

/** The prompt request the game sent since `from`, answered with `prompts` (one reply part). */
function answerBank(from: number, prompts: { id: number; k: "starter" | "twist"; x: string; by: string }[]): void {
  const request = harness.sent.slice(from).find((event): event is PromptRequest => event.t === "prompt_request");
  expect(request, "a prompt request").toBeDefined();
  for (const part of promptReplyParts(request!.requestId, prompts)) harness.deliver(part);
}

/** Types into a player's prompt form and presses Submit. */
async function write(name: string, starter: string, twist: string): Promise<void> {
  const form = openLiveForm(name);
  expect(form, `${name}'s prompt form`).toBeDefined();
  form!.type("Build prompt", starter);
  form!.type("Twist prompt", twist);
  form!.click("Submit");
  await ticks(1);
}

/** Every voter votes on the part under way: `points(builder)` each. */
async function voteAll(game: BuildSwap, players: FakePlayer[], points: (builder: string) => number): Promise<void> {
  const voting = game.voting!;
  for (const player of players) {
    if (player.name === voting.builder) continue;
    world.afterEvents.itemUse.emit({ source: player, itemStack: new ItemStack(VOTES[points(voting.builder) - 1].item) });
  }
  await ticks(6);
}

const placeOn = (player: FakePlayer, x: number, z: number, y = 63) => world.placeBlock(player, { x, y, z }, Direction.Up, "minecraft:stone");
/** Everyone skips the prompts, the bank answers with none, and the match starts. */
async function skipPrompts(names: string[], from: number): Promise<void> {
  await ticks(2);
  for (const name of names) openLiveForm(name)!.click("Skip");
  await ticks(12);
  answerBank(from, []);
  await ticks(COUNTDOWN_TICKS + 2);
}
/** A right click on a block with what's in the hand: whether the game canceled it. */
function rightClick(player: FakePlayer, at: { x: number; y: number; z: number }): boolean {
  const event = { player, block: world.overworld.getBlock(at), blockFace: Direction.Up, itemStack: player.inventory.slots[player.selectedSlotIndex], isFirstEvent: true, cancel: false };
  world.beforeEvents.playerInteractWithBlock.emit(event);
  return event.cancel;
}
const lastMessage = (player: FakePlayer) => stripColors(player.messages.at(-1) ?? "");

describe("Build Swap's config and map", () => {
  it("passes the build's checks; its maps need 8 spawns and 8 building boundaries at least 24 blocks on every side", () => {
    expect(validateGameConfig(config, "buildswap")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map };
    expect(validateMapConfig(ROW, rules)).toEqual([]);
    const small = { ...ROW, regions: { plot: [{ min: [0, 64, 0], max: [22, 87, 23] }, ...PLOTS.slice(1)] } };
    expect(validateMapConfig(small, rules)).toEqual([
      "regions.plot[0] is 23x24x24, smaller than 24 on a side",
      'this game needs 8 "regions.plot" entries, has 7',
    ]);
    expect(validateMapConfig({ ...ROW, spawns: SPAWNS.slice(0, 7) }, rules)[0]).toContain("8");
    // The build padding is each map's own (the map editor's Game settings tool), 2 when it doesn't say.
    expect(validateMapConfig({ ...ROW, buildPadding: 6 }, rules)).toEqual([]);
    expect(validateMapConfig({ ...ROW, buildPadding: 99 }, rules)).toEqual(['"buildPadding" must be a whole number from 0 to 32']);
    expect(config.map.settings.buildPadding.default).toBe(2);
  });

  it("pairs each spawn with the area it's in, or the nearest one left", () => {
    const plots = pairPlots([[52, 64, 12], [12, 64, 12], [100, 64, 12]], PLOTS.slice(0, 3));
    expect(plots.map((plot) => [plot.index, plot.box.min[0]])).toEqual([
      [0, 40],
      [1, 0],
      [2, 80],
    ]);
    expect(clampInto({ x: -5, y: 70, z: 30 }, PLOTS[0])).toEqual({ x: 0.5, y: 70, z: 23.5 });
    expect(tiles({ min: [0, 0, 0], max: [99, 10, 63] }).map((tile) => [tile.min[0], tile.max[0]])).toEqual([
      [0, 63],
      [64, 99],
    ]);
    // A slab that cuts into the next area is left out.
    expect(shell({ min: [0, 0, 0], max: [3, 3, 3] }, [{ min: [4, 0, 0], max: [8, 3, 3] }])).toHaveLength(5);
  });

  it("swaps everyone onto someone else's build", () => {
    for (let seed = 1; seed < 20; seed++) {
      let state = seed;
      const random = () => ((state = (state * 48271) % 2147483647) / 2147483647);
      const swap = swapPlots(["A", "B", "C", "D"], random);
      expect([...swap.keys()].sort()).toEqual(["A", "B", "C", "D"]);
      expect([...swap.values()].sort()).toEqual(["A", "B", "C", "D"]);
      for (const [twister, owner] of swap) expect(twister).not.toBe(owner);
    }
  });

  it("deals nobody their own prompt, and finds a way when the first try wouldn't", () => {
    const dealt = dealPrompts(["A", "B"], [{ text: "A castle", by: "c" }, { text: "A boat", by: "b" }]);
    expect(dealt.get("A")?.text).toBe("A boat");
    expect(dealt.get("B")?.text).toBe("A castle");
    // The same prompt twice counts once; a player with nothing left gets nothing.
    expect(dealPrompts(["A", "B"], [{ text: "A cat", by: "b" }, { text: "a  CAT", by: "c" }]).size).toBe(1);
    // A reply too big for one message comes in parts that each fit.
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i, k: "starter" as const, x: `${"x".repeat(45)} ${i}`, by: "someone" }));
    const parts = promptReplyParts("r1", many);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(() => encodeMessage(part)).not.toThrow();
    expect(parts.flatMap((part) => part.prompts)).toHaveLength(40);
  });

  it("selects a box from two corners, keeps it in an area, and cuts it into pieces a fill takes", () => {
    expect(cornersBox({ first: [5, 70, 1], second: [1, 64, 3] })).toEqual({ min: [1, 64, 1], max: [5, 70, 3] });
    expect(cornersBox({ first: [2, 2, 2] })).toEqual({ min: [2, 2, 2], max: [2, 2, 2] });
    expect(cornersBox({})).toBeUndefined();
    expect(clipBox({ min: [-5, 60, 0], max: [5, 70, 3] }, PLOTS[0])).toEqual({ min: [0, 64, 0], max: [5, 70, 3] });
    expect(clipBox({ min: [30, 64, 0], max: [35, 70, 3] }, PLOTS[0])).toBeUndefined();
    expect(sizeText({ min: [0, 0, 0], max: [2, 1, 0] })).toBe("3 x 2 x 1 (6 blocks)");
    // A 24-block area fills in one go; a big one in layers, each within the limit.
    expect(fillPieces(PLOTS[0])).toEqual([PLOTS[0]]);
    const big = { min: [0, 0, 0] as [number, number, number], max: [99, 49, 99] as [number, number, number] };
    const pieces = fillPieces(big);
    expect(pieces.every((piece) => boxVolume(piece) <= 32768)).toBe(true);
    expect(pieces.reduce((sum, piece) => sum + boxVolume(piece), 0)).toBe(boxVolume(big));
    const wide = { min: [0, 0, 0] as [number, number, number], max: [299, 0, 199] as [number, number, number] };
    expect(fillPieces(wide).reduce((sum, piece) => sum + boxVolume(piece), 0)).toBe(300 * 200);
    expect(fillPieces(wide).every((piece) => boxVolume(piece) <= 32768)).toBe(true);
  });

  it("fixes the pool you stand in: its liquid and air joined to you, no higher, within 7 blocks and the area", () => {
    // A floor at y 63, a wall along x = 4, and water at y 64 and 65.
    const kindAt = (at: [number, number, number]): FixCell => (at[1] <= 63 || at[0] === 4 ? "other" : "air");
    const area = { min: [-20, 60, -20] as [number, number, number], max: [20, 80, 20] as [number, number, number] };
    const cells = fixCells([0, 64, 0], kindAt, area);
    expect(cells.every(([x, y, z]) => y === 64 && x < 4 && Math.hypot(x, z) <= 7)).toBe(true);
    expect(cells).toContainEqual([3, 64, 0]);
    expect(cells).toContainEqual([0, 64, -7]);
    expect(cells).not.toContainEqual([5, 64, 0]);
    // The area cuts it short too.
    expect(fixCells([0, 64, 0], kindAt, { min: [-2, 64, -2], max: [2, 64, 2] })).toHaveLength(25);
  });

  it("counts votes from everyone but the builder, who can change them, and ranks by points", () => {
    const ballot = new Ballot("A", ["A", "B", "C"]);
    expect(ballot.needed).toBe(2);
    expect(ballot.vote("A", 5)).toBe(false);
    ballot.vote("B", 2);
    ballot.vote("B", 4);
    expect(ballot.done).toBe(false);
    ballot.remove("C");
    expect(ballot.done).toBe(true);
    expect(ballot.total).toBe(4);
    expect(standings(new Map([["a", 9], ["b", 12], ["c", 9]]), ["A", "B", "C"]).map((row) => [row.name, row.place])).toEqual([
      ["B", 1],
      ["A", 2],
      ["C", 2],
    ]);
  });
});

describe("a match of Build Swap", () => {
  it("takes prompts, deals them, builds, swaps for the twist, votes on every build before and after, and shows the winner", async () => {
    // The map's own water beside A's area stays; water that runs out of it doesn't.
    world.overworld.blocks.set("-1,64,5", "minecraft:water");
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const [a, b, c] = players;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("picking");
      // Everyone must submit or skip: A writes both, B only a twist with a filtered word, C skips.
      openLiveForm("B")!.click("Submit");
      await ticks(1);
      expect(openLiveForm("B")!.texts()).toContain("Write a prompt, or skip.");
      await write("A", "  A tiny §ahouse ", "Make it pink");
      await write("B", "", "Add a filtered dragon");
      openLiveForm("C")!.click("Skip");
      await ticks(1);
      expect(openLiveForm("A")).toBeUndefined();
      expect(harness.sent.slice(from).filter((event) => event.t === "prompt_submit")).toEqual([
        { t: "prompt_submit", sessionId: "s1", game: "buildswap", by: "a", prompts: [{ kind: "starter", text: "A tiny house" }, { kind: "twist", text: "Make it pink" }] },
        { t: "prompt_submit", sessionId: "s1", game: "buildswap", by: "b", prompts: [{ kind: "twist", text: "Add a ******** dragon" }] },
      ]);
      await ticks(12);
      // The bank has one of A's own from an earlier match, which A must not get.
      answerBank(from, [
        { id: 7, k: "starter", x: "A bank castle", by: "a" },
        { id: 8, k: "twist", x: "Add a bank flag", by: "zed" },
      ]);
      await ticks(COUNTDOWN_TICKS);
      expect(game.phase).toBe("playing");
      expect(a.gameMode).toBe("Creative");

      // Round 1: everyone in their own area, a prompt nobody else has and that they didn't write.
      await ticks(2);
      const builds = game.allBuilds;
      expect(builds.map((build) => [build.builder, build.plot.index])).toEqual([
        ["A", 0],
        ["B", 1],
        ["C", 2],
      ]);
      const starters = builds.map((build) => build.starter);
      expect(new Set(starters).size).toBe(3);
      expect(builds.find((build) => build.builder === "A")!.starter).not.toMatch(/tiny house|bank castle/i);
      expect(starters).toContain("A tiny house");
      expect(harness.sent.slice(from).some((event) => event.t === "prompt_used")).toBe(true);
      // Nobody builds while reading the prompt.
      expect(game.activeStage?.name).toBe("Get ready");
      expect(placeOn(a, 5, 5)).toBe(false);
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Build");
      expect(game.activeStage?.secondsLeft).toBe(5 * 60);
      expect(placeOn(a, 5, 5)).toBe(true);
      expect(placeOn(b, 45, 5)).toBe(true);
      expect(placeOn(a, 45, 6)).toBe(false); // B's area
      expect(placeOn(a, 30, 5)).toBe(false); // between areas
      expect(world.breakBlock(a, { x: 30, y: 63, z: 5 })).toBe(false); // the map
      // Water run out of A's area is cleared; the map's own stays.
      world.overworld.blocks.set("24,64,5", "minecraft:flowing_water");
      await ticks(21);
      expect(world.overworld.blocks.has("24,64,5")).toBe(false);
      expect(world.overworld.blocks.get("-1,64,5")).toBe("minecraft:water");
      // Wandering off puts you back.
      a.location = { x: 60, y: 70, z: 12 };
      await ticks(11);
      expect(a.location.x).toBeLessThanOrEqual(26);
      game.skipStage();
      await ticks(2);

      // The twist: everyone on someone else's build, and they can change anything there.
      expect(game.activeStage?.name).toBe("Get ready for the twist");
      const onB = game.allBuilds.find((build) => build.builder === "B")!;
      expect(onB.twister).toBeDefined();
      expect(onB.twister).not.toBe("B");
      for (const build of game.allBuilds) expect(build.twist).toBeTruthy();
      expect(new Set(game.allBuilds.map((build) => build.twist)).size).toBe(3);
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.secondsLeft).toBe(config.twistMinutes * 60);
      const twisterOfB = players.find((player) => player.name === onB.twister)!;
      expect(world.breakBlock(twisterOfB, { x: 45, y: 64, z: 5 })).toBe(true);
      expect(placeOn(twisterOfB, 46, 6)).toBe(true);
      expect(placeOn(b, 45, 7)).toBe(false); // B's own area isn't B's to work on now
      game.skipStage();
      await ticks(2);

      // Voting: each build as it was, then with its twist. Everyone gives A's parts 5, others 1.
      const seen: string[] = [];
      for (let part = 0; part < 6; part++) {
        expect(game.activeStage?.name).toBe("Vote");
        const voting = game.voting!;
        seen.push(`${voting.build.builder}:${voting.kind}`);
        if (voting.build.builder === "B") {
          // B's block is back for the first vote, and gone (the twist broke it) for the second.
          expect(world.overworld.blocks.get("45,64,5")).toBe(voting.kind === "starter" ? "minecraft:stone" : undefined);
          expect(world.overworld.blocks.get("46,64,6")).toBe(voting.kind === "starter" ? undefined : "minecraft:stone");
        }
        // Its prompt top left, and its twist under it once that's voted on.
        const notes = [`Prompt: ${voting.build.starter}`, ...(voting.kind === "twist" ? [`Twist: ${voting.build.twist}`] : [])];
        expect(world.scoreboard.sidebar?.displayName).toBe(NOTES_MARK);
        expect([...world.scoreboard.sidebar!.scores].sort((x, y) => y[1] - x[1]).map(([line]) => stripColors(line))).toEqual(notes);
        const builder = players.find((player) => player.name === voting.builder)!;
        const voter = players.find((player) => player.name !== voting.builder)!;
        await ticks(11); // the action bar's next refresh
        // The vote's line is top right from the start, with no clock until everyone has voted.
        expect(stripColors(builder.actionBar)).toContain("Your build");
        expect(voter.actionBar.startsWith(HUD_MARK)).toBe(true);
        expect(voter.actionBar).not.toContain(CLOCK_PLACES[3]);
        expect(stripColors(voter.actionBar)).toContain("Vote with a number   0/2 voted");
        expect(builder.inventory.items()).toHaveLength(0);
        expect(voter.inventory.items().map((item) => item.nameTag)).toEqual(VOTES.map((vote) => vote.name));
        await voteAll(game, players, (who) => (who === "A" ? 5 : 1));
        expect(game.activeStage?.name).toBe("Next build");
        await ticks(11);
        expect(voter.actionBar.startsWith(HUD_MARK)).toBe(true);
        expect(voter.actionBar).toContain(CLOCK_PLACES[3]);
        expect(stripColors(voter.actionBar)).toMatch(/Your vote: .+ {3}2\/2 voted/);
        game.skipStage();
        await ticks(2);
      }
      expect(seen.sort()).toEqual(["A:starter", "A:twist", "B:starter", "B:twist", "C:starter", "C:twist"]);
    });
    // A's build and A's twist each got 5 from two voters.
    expect(result).toEqual({ kind: "win", players: ["A"], reason: "20 points" });
    expect(game.pointsOf("B")).toBe(4);
    const chat = stripColors(world.chat.join("\n"));
    // Only the standings in chat; each player hears what their own prompt and twist earned.
    expect(chat).not.toContain("The builds:");
    expect(chat).toContain("1st A: 20 points");
    const ownA = game.allBuilds.find((build) => build.builder === "A")!;
    const twistedByA = game.allBuilds.find((build) => build.twister === "A")!;
    const toA = stripColors(a.messages.join("\n"));
    expect(toA).toContain(`Your prompt ${ownA.starter}: 10 points`);
    expect(toA).toContain(`Your twist ${twistedByA.twist} on ${twistedByA.starter}: 10 points`);
    expect(stripColors(b.messages.join("\n"))).toMatch(/Your prompt .+: 2 points/);
    expect(world.scoreboard.sidebar).toBeUndefined();
    expect(stripColors(c.messages.join("\n"))).toContain("You skipped the prompts.");
    const rows = statsRows(harness.sent, from);
    expect(rows.find((row) => row.n === "A")).toMatchObject({ r: "w", x: { points: 20, bestScore: 20 } });
    expect(world.structureManager.saved.size).toBe(0);
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });

  it("skips whoever hasn't answered when the time is up, and deals from its own list", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"], { promptSeconds: 2 });
    let builds: readonly { starter: string }[] = [];
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      expect(openLiveForm("A")).toBeDefined();
      // A closes the form: it comes back.
      openLiveForm("A")!.dismiss();
      await ticks(11);
      expect(openLiveForm("A")).toBeDefined();
      await ticks(40);
      expect([openLiveForm("A"), openLiveForm("B"), openLiveForm("C")]).toEqual([undefined, undefined, undefined]);
      answerBank(from, []);
      await ticks(COUNTDOWN_TICKS + 2);
      builds = game.allBuilds;
      // Then everyone leaves but A, who wins.
      world.leave("B");
      world.leave("C");
      await ticks(25);
    });
    expect(builds.map((build) => build.starter).every((starter) => starter.length > 0)).toBe(true);
    expect(result).toEqual({ kind: "win", players: ["A"], reason: "everyone else left" });
    expectBaseline(harness.root, baseline);
    for (const player of players) world.leave(player.name);
  });

  it("keeps blocks that fall where they're put, and has a selection wand with /set, /replace and /fix inside your own area", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const [a, b] = players;
    const blocks = world.overworld.blocks;
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await skipPrompts(["A", "B", "C"], from);
      expect(stripColors(game.wand(a as never))).toBe("The wand works while you're building.");
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Build");

      // Concrete powder, sand and anvils stay up: each becomes its twin that doesn't fall.
      expect(world.placeBlock(a, { x: 5, y: 70, z: 5 }, Direction.Up, "minecraft:red_concrete_powder")).toBe(true);
      expect(blocks.get("5,71,5")).toBe("minecade:still_red_concrete_powder");
      world.placeBlock(a, { x: 6, y: 70, z: 5 }, Direction.Up, "minecraft:anvil");
      expect(blocks.get("6,71,5")).toBe("minecade:still_anvil");
      expect(world.overworld.blockStates.get("6,71,5")).toEqual({ "minecraft:cardinal_direction": "south" });
      world.placeBlock(a, { x: 7, y: 70, z: 5 }, Direction.Up, "minecraft:stone");
      expect(blocks.get("7,71,5")).toBe("minecraft:stone");

      // The wand: no selection yet, then a corner with each click, inside A's area only.
      expect(stripColors(game.wand(a as never))).toBe("Left click a block for the first corner, right click one for the second.");
      const wandSlot = a.inventory.slots.findIndex((item) => item?.typeId === WAND);
      expect(a.inventory.slots[wandSlot]?.nameTag).toBe("Selection Wand");
      a.selectedSlotIndex = wandSlot;
      expect(stripColors(game.set(a as never, "minecraft:stone"))).toBe("Pick two corners with the wand first (/wand).");
      blocks.set("1,64,1", "minecraft:dirt");
      expect(world.breakBlock(a, { x: 1, y: 64, z: 1 })).toBe(false); // the wand doesn't break it
      expect(blocks.get("1,64,1")).toBe("minecraft:dirt");
      await ticks(1);
      expect(lastMessage(a)).toBe("First corner set.");
      expect(rightClick(a, { x: 45, y: 64, z: 2 })).toBe(true);
      await ticks(1);
      expect(lastMessage(a)).toBe("Pick a block inside your building area.");
      expect(rightClick(a, { x: 3, y: 65, z: 2 })).toBe(true);
      await ticks(1);
      expect(lastMessage(a)).toBe("Second corner set: 3 x 2 x 2 (12 blocks).");
      // Its dots show to A alone (looking its way: dots behind a player aren't drawn).
      a.viewDirection = { x: -0.7, y: 0, z: -0.7 };
      await ticks(10);
      expect(a.particles.some((particle) => particle.id === "minecade:outline")).toBe(true);
      expect(b.particles).toEqual([]);

      // /set fills it (a block that falls as its twin), /replace swaps one block for another.
      expect(stripColors(game.set(a as never, "minecraft:stone"))).toBe("Set 12 blocks.");
      for (const at of ["1,64,1", "3,65,2", "2,64,2"]) expect(blocks.get(at)).toBe("minecraft:stone");
      expect(blocks.has("4,64,1")).toBe(false);
      expect(stripColors(game.set(a as never, "minecraft:sand"))).toBe("Set 12 blocks.");
      expect(blocks.get("2,65,1")).toBe("minecade:still_sand");
      blocks.set("2,64,2", "minecraft:sand");
      expect(stripColors(game.replace(a as never, "minecraft:sand", "minecraft:oak_planks"))).toBe("Replaced 12 blocks.");
      expect(blocks.get("2,64,2")).toBe("minecraft:oak_planks");
      expect(stripColors(game.replace(a as never, "minecraft:dirt", "minecraft:stone"))).toBe("Nothing in your selection was that block.");
      // B has no selection of their own, and can't reach A's.
      expect(stripColors(game.set(b as never, "minecraft:stone"))).toBe("Pick two corners with the wand first (/wand).");

      // /fix: standing in the water, the pool turns still and level, walls and floor left alone.
      for (let x = 8; x <= 12; x++) for (let z = 8; z <= 12; z++) {
        blocks.set(`${x},63,${z}`, "minecraft:stone");
        if (x === 8 || x === 12 || z === 8 || z === 12) blocks.set(`${x},64,${z}`, "minecraft:stone");
      }
      a.location = { x: 10.5, y: 64, z: 10.5 };
      expect(stripColors(game.fix(a as never))).toBe("Stand in the water or lava to fix, then /fix.");
      blocks.set("10,64,10", "minecraft:flowing_water");
      blocks.set("9,64,10", "minecraft:flowing_water");
      expect(stripColors(game.fix(a as never))).toBe("Fixed 9 blocks of water.");
      for (const at of ["9,64,9", "10,64,10", "11,64,11"]) expect(blocks.get(at)).toBe("minecraft:water");
      expect(blocks.get("8,64,10")).toBe("minecraft:stone");
      expect(blocks.has("10,65,10")).toBe(false);
      expect(stripColors(game.fix(a as never))).toBe("The water is already still.");
      world.leave("B");
      world.leave("C");
      await ticks(25);
    });
    expect(result).toMatchObject({ kind: "win", players: ["A"] });
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });

  it("calls a voter who hasn't voted after 10 seconds, loudly, and again until they do", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await skipPrompts(["A", "B", "C"], from);
      for (let skip = 0; skip < 4; skip++) {
        game.skipStage();
        await ticks(2);
      }
      expect(game.activeStage?.name).toBe("Vote");
      const builder = players.find((player) => player.name === game.voting!.builder)!;
      const [first, second] = players.filter((player) => player !== builder);
      const nags = (player: FakePlayer) => player.titles.map(stripColors).filter((title) => title === "Vote! | Pick a number from 1 to 5").length;
      const roars = (player: FakePlayer) => player.sounds.filter((sound) => sound.id === "mob.wither.spawn").length;
      await ticks(config.voteNagSeconds * 20 - 5);
      expect(nags(first)).toBe(0);
      world.afterEvents.itemUse.emit({ source: first, itemStack: new ItemStack(VOTES[2].item) });
      await ticks(10);
      // The one who voted and the builder are left alone.
      expect([nags(first), roars(first), nags(builder), roars(builder)]).toEqual([0, 0, 0, 0]);
      expect([nags(second), roars(second)]).toEqual([1, 1]);
      await ticks(config.voteNagSeconds * 20);
      expect(nags(second)).toBe(2);
      world.afterEvents.itemUse.emit({ source: second, itemStack: new ItemStack(VOTES[2].item) });
      await ticks(config.voteNagSeconds * 20);
      expect(nags(second)).toBe(2);
      world.leave("B");
      world.leave("C");
      await ticks(25);
    });
    expect(result.kind).toBe("win");
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });

  it("lays a /floor of the block in hand, keeps builders within the map's padding and return delay (voters within the padding), and takes creative's items away out of their rounds", async () => {
    // A preview, with A its map editor: /skip moves it along.
    const { players, baseline, from, game } = start(["A", "B", "C"], {}, {}, { ...ROW, buildPadding: 6, returnDelay: 2 }, ["A"]);
    const [a, b] = players;
    const give = (player: FakePlayer, slot: number, item: string) => player.inventory.setItem(slot, new ItemStack(item));
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("picking");
      expect(stripColors(game.skipPreview(b as never) ?? "")).toBe("Only a map editor can skip.");
      expect(game.skipPreview(a as never)).toBeUndefined();
      await ticks(12);
      expect(openLiveForm("A")).toBeUndefined();
      answerBank(from, []);
      await ticks(COUNTDOWN_TICKS + 2);
      expect(game.activeStage?.name).toBe("Get ready");
      // While reading the prompt, blocks can be taken from creative's inventory, but not placed, and no floor yet.
      give(a, 0, "minecraft:stone");
      expect(stripColors(game.floor(a as never))).toBe("Lay a floor while you're building.");
      await ticks(11);
      expect(a.inventory.items().map((item) => item.typeId)).toEqual(["minecraft:stone"]);
      game.skipStage();
      await ticks(2);

      // Building: what's taken stays, /floor lays the block in hand across the area's bottom layer.
      a.selectedSlotIndex = 1;
      expect(stripColors(game.floor(a as never))).toBe("Hold the block for the floor, then /floor.");
      a.selectedSlotIndex = 0;
      expect(stripColors(game.floor(a as never))).toBe("Floor laid.");
      for (const at of ["0,64,0", "23,64,23", "12,64,7"]) expect(world.overworld.blocks.get(at)).toBe("minecraft:stone");
      expect(world.overworld.blocks.has("12,65,7")).toBe(false);
      expect(world.overworld.blocks.has("24,64,0")).toBe(false);
      // This map's padding is 6 blocks: 4 past the area is fine, 17 past it isn't.
      a.location = { x: 27, y: 70, z: 12 };
      await ticks(11);
      expect(a.location.x).toBe(27);
      expect(a.inventory.items().map((item) => item.typeId)).toEqual(["minecraft:stone"]);
      // Past it, the map's return delay (2 seconds) comes first.
      a.location = { x: 40, y: 70, z: 12 };
      await ticks(21);
      expect(a.location.x).toBe(40);
      await ticks(30);
      expect(a.location.x).toBe(29.5);
      for (let skip = 0; skip < 3; skip++) {
        game.skipPreview(a as never);
        await ticks(2);
      }

      // Voting: a voter keeps their vote blocks and nothing else, worn or held; the builder keeps nothing.
      expect(game.activeStage?.name).toBe("Vote");
      const builder = players.find((player) => player.name === game.voting!.builder)!;
      const voter = players.find((player) => player !== builder)!;
      // Voters are kept within the same padding of the build, and put back at once (no return delay).
      const { min, max } = game.voting!.build.plot.box;
      const middle = (min[2] + max[2]) / 2;
      voter.location = { x: max[0] + 4, y: 70, z: middle };
      await ticks(11);
      expect(voter.location.x).toBe(max[0] + 4);
      voter.location = { x: max[0] + 12, y: 70, z: middle };
      await ticks(11);
      expect(voter.location.x).toBe(max[0] + 6.5);
      give(voter, 6, "minecraft:diamond_block");
      voter.equipment.set("Head", new ItemStack("minecraft:diamond_helmet"));
      give(builder, 0, "minecraft:stone");
      await ticks(11);
      expect(voter.inventory.items().map((item) => item.typeId)).toEqual(VOTES.map((vote) => vote.item));
      expect(voter.equipment.get("Head")).toBeUndefined();
      expect(builder.inventory.items()).toHaveLength(0);
      game.exitPreview(a as never);
    });
    expect(result).toMatchObject({ kind: "aborted" });
    expect(stripColors(world.chat.join("\n"))).toContain("A skipped ahead.");
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });
});

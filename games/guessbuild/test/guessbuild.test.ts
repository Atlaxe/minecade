// Guess the Build against the fake world, on Build Swap's kind of map (one 40-block arena around a
// 24-block build area, copied once per player): the circle and its chains, building the chain you're
// on, guessing (the paper, the form coming up on its own, a guess typed but not submitted, no guess at
// all), building the guess, the showcase with a vote on every build and each guess by name, and the
// winner by points.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mapRequirements, promptReplyParts, runtimeMapConfig, stripColors, uncoveredRequirements, validateMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { Direction, ItemStack, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { openLiveForm } from "../../../packages/minigame-core/test/fake-mc-server-ui.ts";
import { NOTES_MARK } from "../../../packages/minigame-core/src/hud.ts";
import { createHarness, expectBaseline, playToEnd, snapshot, statsRows, ticks, type Harness } from "../../../packages/minigame-core/test/game-harness.ts";
import type { PromptRequest } from "@minecade/minigame-core/protocol";
import { DEFAULT_STARTERS, VOTES } from "@minecade/minigame-core/building";
import { validateGameConfig } from "../../../tools/build/validate.ts";
import buildSwapConfig from "../../buildswap/game.config.ts";
import config from "../game.config.ts";
import { GUESS_ITEM, GuessBuild } from "../behavior_pack/scripts/guessbuild.ts";
import { buildToGuess, chainOf, nextText, stepCount, stepKind, workerSeat, type Chain } from "../behavior_pack/scripts/chains.ts";

type Vec3 = [number, number, number];
const ARENA = { min: [0, 63, 0] as Vec3, max: [39, 90, 39] as Vec3 };
const PLOT = { min: [0, 64, 0] as Vec3, max: [23, 87, 23] as Vec3 };
const MAP: MapConfig = runtimeMapConfig({
  name: "Arena",
  spawns: [[12, 64, 12]],
  spectatorSpawn: [150, 110, 12],
  regions: { arena: [ARENA], plot: [PLOT] },
});
/** Where tile `index`'s build area starts: 3 to a row along x, the rows along z, 40 blocks apart. */
const corner = (index: number): Vec3 => [(index % 3) * 40, 64, Math.floor(index / 3) * 40];

let harness: Harness;

beforeAll(() => {
  harness = createHarness();
});

afterEach(() => {
  vi.mocked(console.warn).mockClear();
});

function start(names: string[], settings: Record<string, string> = {}) {
  const players = names.map((name) => world.join(name));
  const baseline = snapshot(harness.root);
  const from = harness.sent.length;
  const game = new GuessBuild(harness.context(names, MAP, settings), config);
  return { players, baseline, from, game };
}

/** The prompt request the game sent since `from`, answered with no prompts. */
function answerBank(from: number): void {
  const request = harness.sent.slice(from).find((event): event is PromptRequest => event.t === "prompt_request");
  expect(request, "a prompt request").toBeDefined();
  for (const part of promptReplyParts(request!.requestId, [])) harness.deliver(part);
}

const byName = (players: FakePlayer[], name: string) => players.find((player) => player.name === name)!;
/** Places stone on the floor of tile `index`'s build area, `x` blocks in. */
const placeIn = (player: FakePlayer, index: number, x = 5) => world.placeBlock(player, { x: corner(index)[0] + x, y: 63, z: corner(index)[2] + 5 }, Direction.Up, "minecraft:stone");
const blockIn = (index: number, x = 5) => world.overworld.blocks.get(`${corner(index)[0] + x},64,${corner(index)[2] + 5}`);

/** Every voter votes on the build under way: `points(builder)` each. */
async function voteAll(game: GuessBuild, players: FakePlayer[], points: (builder: string) => number): Promise<void> {
  const voting = game.voting!;
  for (const player of players) {
    if (player.name === voting.builder) continue;
    world.afterEvents.itemUse.emit({ source: player, itemStack: new ItemStack(VOTES[points(voting.builder) - 1].item) });
  }
  await ticks(6);
}

describe("Guess the Build's config and its circle", () => {
  it("passes the build's checks, needs Build Swap's kind of map, and plays Build Swap's maps", () => {
    expect(validateGameConfig(config, "guessbuild")).toEqual([]);
    const rules = { kind: "game" as const, maxPlayers: config.maxPlayers, requires: config.map };
    expect(validateMapConfig(MAP, rules)).toEqual([]);
    expect(config.map.borrow).toEqual(["buildswap"]);
    const needs = mapRequirements(config.map, { kind: "game", maxPlayers: config.maxPlayers });
    expect(uncoveredRequirements(needs, mapRequirements(buildSwapConfig.map, { kind: "game", maxPlayers: buildSwapConfig.maxPlayers }))).toEqual([]);
    expect(config.options[0].values.map((value) => value.value)).toEqual(["3", "5"]);
  });

  it("has everyone work once on every chain but their own: a build, then a guess, in turn", () => {
    for (const seats of [3, 4, 5, 8]) {
      const steps = stepCount(seats);
      expect(steps).toBe(seats - 1);
      for (let seat = 0; seat < seats; seat++) {
        const chains = Array.from({ length: steps }, (_, i) => chainOf(seat, i + 1, seats));
        expect(new Set(chains).size).toBe(steps);
        expect(chains).not.toContain(seat);
      }
      for (let step = 1; step <= steps; step++) {
        const workers = Array.from({ length: seats }, (_, chain) => workerSeat(chain, step, seats));
        expect(new Set(workers).size).toBe(seats);
        workers.forEach((worker, chain) => expect(chainOf(worker, step, seats)).toBe(chain));
      }
    }
    expect([1, 2, 3, 4].map(stepKind)).toEqual(["build", "guess", "build", "guess"]);
    expect(stepCount(1)).toBe(1);
  });

  it("builds from the last guess, or with none given, from what the build before was built from", () => {
    const chain: Chain = { index: 0, owner: "A", prompt: "A castle", entries: [] };
    expect(nextText(chain)).toBe("A castle");
    chain.entries.push({ kind: "build", step: 1, by: "B", from: "A castle", snapshot: "c0_s1" });
    expect(buildToGuess(chain, 2)?.by).toBe("B");
    expect(buildToGuess(chain, 4)).toBeUndefined();
    chain.entries.push({ kind: "guess", step: 2, by: "C", text: undefined });
    expect(nextText(chain)).toBe("A castle");
    chain.entries.push({ kind: "build", step: 3, by: "D", from: "A castle", snapshot: "c0_s3" });
    chain.entries.push({ kind: "guess", step: 4, by: "E", text: "A fort" });
    expect(nextText(chain)).toBe("A fort");
  });
});

describe("a match of Guess the Build", () => {
  it("builds, guesses and builds the guess round the circle, then shows each chain with a vote on every build", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C", "D"]);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      expect(game.phase).toBe("picking");
      // One prompt each: A, B and D write one, C skips.
      for (const [name, prompt] of [["A", "A pirate ship"], ["B", "A volcano"], ["D", "A big snowman"]]) {
        const form = openLiveForm(name)!;
        form.type("Build prompt", prompt);
        form.click("Submit");
      }
      openLiveForm("C")!.click("Skip");
      await ticks(12);
      expect(stripColors(byName(players, "C").messages.join("\n"))).toContain("You skipped the prompt.");
      expect(harness.sent.slice(from).filter((event) => event.t === "prompt_submit")).toHaveLength(3);
      answerBank(from);
      await ticks(5);
      expect(game.phase).toBe("playing");
      expect(world.tickingAreaManager.areas.size).toBe(4);

      // Each chain is its owner's prompt, C's a dealt one nobody wrote this match.
      const chains = game.allChains;
      const seats = game.circle;
      expect(chains.map((chain) => chain.owner)).toEqual(seats);
      const promptOf = (owner: string) => chains.find((chain) => chain.owner === owner)!.prompt;
      expect([promptOf("A"), promptOf("B"), promptOf("D")]).toEqual(["A pirate ship", "A volcano", "A big snowman"]);
      expect(DEFAULT_STARTERS).toContain(promptOf("C"));
      const seatOf = (name: string) => seats.indexOf(name);
      /** The chain (and tile) `name` works on at `step`. */
      const onAt = (name: string, step: number) => (seatOf(name) + step) % 4;

      // Step 1: everyone builds the next seat's prompt, in that seat's arena, and only there.
      expect(game.activeStage?.name).toBe("Get ready");
      game.skipStage();
      await ticks(11);
      expect(game.activeStage?.name).toBe("Build");
      for (const player of players) {
        const tile = onAt(player.name, 1);
        expect(stripColors(player.actionBar)).toContain(`Build: ${chains[tile].prompt}`);
        expect(placeIn(player, tile)).toBe(true);
        expect(placeIn(player, (tile + 1) % 4, 7)).toBe(false);
      }
      game.skipStage();
      await ticks(2);

      // Step 2: everyone guesses the build two seats on, the paper in their first slot.
      expect(game.activeStage?.name).toBe("Guess");
      for (const player of players) {
        const chain = game.guessingOf(player.name)!;
        expect(chain.index).toBe(onAt(player.name, 2));
        expect(player.inventory.slots[0]).toMatchObject({ typeId: GUESS_ITEM, nameTag: "Guess" });
        expect(placeIn(player, chain.index, 9)).toBe(false);
      }
      expect(blockIn(onAt("A", 2))).toBe("minecraft:stone");
      // A uses the paper and guesses; B guesses and changes it; C types but never submits; D does nothing.
      world.afterEvents.itemUse.emit({ source: byName(players, "A"), itemStack: new ItemStack(GUESS_ITEM) });
      await ticks(1);
      const formA = openLiveForm("A")!;
      formA.click("Submit");
      await ticks(1);
      expect(formA.texts()).toContain("Write what you think it is.");
      formA.type("Your guess", "  A §cboat ");
      formA.click("Submit");
      await ticks(11); // the action bar's next refresh
      expect(openLiveForm("A")).toBeUndefined();
      expect(stripColors(byName(players, "A").actionBar)).toContain("Your guess: A boat");
      expect(openLiveForm("D")).toBeUndefined();
      // The forms come up on their own a while in, for whoever hasn't guessed.
      await ticks(config.guessLookSeconds * 20);
      expect(openLiveForm("A")).toBeUndefined();
      expect(openLiveForm("D")).toBeDefined();
      openLiveForm("B")!.type("Your guess", "A tower");
      openLiveForm("B")!.click("Submit");
      await ticks(1);
      expect(openLiveForm("B")).toBeUndefined();
      world.afterEvents.itemUse.emit({ source: byName(players, "B"), itemStack: new ItemStack(GUESS_ITEM) });
      await ticks(1);
      openLiveForm("B")!.type("Your guess", "A lighthouse");
      openLiveForm("B")!.click("Submit");
      openLiveForm("C")!.type("Your guess", "A rocket");
      openLiveForm("D")!.dismiss();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Guess");
      game.skipStage();
      await ticks(5);
      const guessOf = (name: string) => chains[onAt(name, 2)].entries.find((entry) => entry.kind === "guess");
      expect(guessOf("A")).toMatchObject({ by: "A", text: "A boat" });
      expect(guessOf("B")).toMatchObject({ by: "B", text: "A lighthouse" });
      expect(guessOf("C")).toMatchObject({ by: "C", text: "A rocket" });
      expect(guessOf("D")).toMatchObject({ by: "D", text: undefined });
      expect(byName(players, "A").inventory.items()).toHaveLength(0);

      // Step 3: everyone builds the guess three seats on, the arena cleared first; D gave no guess, so
      // that chain's builder builds what the first build was built from.
      expect(game.activeStage?.name).toBe("Get ready");
      await ticks(11);
      for (let tile = 0; tile < 4; tile++) expect(blockIn(tile)).toBeUndefined();
      const third = (name: string) => chains[onAt(name, 3)];
      expect(third("A").index).toBe(onAt("A", 3));
      for (const player of players) {
        const chain = third(player.name);
        const [guess, build] = chain.entries.slice(-2);
        expect([guess.kind, build.kind, build.by]).toEqual(["guess", "build", player.name]);
        const expected = guess.kind === "guess" && guess.text ? guess.text : chain.prompt;
        expect(build.kind === "build" && build.from).toBe(expected);
        expect(stripColors(player.actionBar)).toContain(`Build: ${expected}`);
      }
      game.skipStage();
      await ticks(2);
      for (const player of players) expect(placeIn(player, onAt(player.name, 3), 11)).toBe(true);
      game.skipStage();
      await ticks(2);

      // The showcase: every chain, its builds back in its arena, a vote on each; A's builds get 5s.
      const seen: string[] = [];
      for (let chain = 0; chain < 4; chain++) {
        expect(game.activeStage?.name).toBe("Vote");
        const first = game.voting!;
        expect(first.entry.step).toBe(1);
        expect(blockIn(first.chain.index)).toBe("minecraft:stone");
        expect(blockIn(first.chain.index, 11)).toBeUndefined();
        expect(world.scoreboard.sidebar?.displayName).toBe(NOTES_MARK);
        expect([...world.scoreboard.sidebar!.scores].map(([line]) => stripColors(line))).toEqual([`Prompt: ${first.chain.prompt}`]);
        seen.push(first.chain.owner);
        await voteAll(game, players, (builder) => (builder === "A" ? 5 : 1));
        game.skipStage();
        await ticks(2);
        // The guess, by name.
        expect(game.activeStage?.name).toBe("Guessed");
        const guess = first.chain.entries[1];
        const said = guess.kind === "guess" && guess.text ? `${guess.by} guessed it was ${guess.text}` : `${guess.by} didn't guess`;
        expect(stripColors(world.chat.at(-1) ?? "")).toBe(said);
        game.skipStage();
        await ticks(2);
        // The build of the guess.
        expect(game.activeStage?.name).toBe("Vote");
        expect(game.voting!.entry.step).toBe(3);
        expect(blockIn(first.chain.index, 11)).toBe("minecraft:stone");
        expect([...world.scoreboard.sidebar!.scores].length).toBe(2);
        await voteAll(game, players, (builder) => (builder === "A" ? 5 : 1));
        game.skipStage();
        await ticks(2);
      }
      expect(seen.sort()).toEqual(["A", "B", "C", "D"]);
    });
    // A built twice and got 5 from three voters each time.
    expect(result).toEqual({ kind: "win", players: ["A"], reason: "30 points" });
    expect(game.pointsOf("B")).toBe(6);
    const chat = stripColors(world.chat.join("\n"));
    expect(chat).toContain("1st A: 30 points");
    const toA = stripColors(byName(players, "A").messages.join("\n"));
    expect(toA.match(/Your build of .+: 15 points/g)).toHaveLength(2);
    expect(world.scoreboard.sidebar).toBeUndefined();
    expect(statsRows(harness.sent, from).find((row) => row.n === "A")).toMatchObject({ r: "w", x: { points: 30, bestScore: 30 } });
    expect(world.structureManager.saved.size).toBe(0);
    expect(world.tickingAreaManager.areas.size).toBe(0);
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });

  it("ends a chain of three on a guess, then shows what it started as", async () => {
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      for (const name of ["A", "B", "C"]) openLiveForm(name)!.click("Skip");
      await ticks(12);
      answerBank(from);
      await ticks(5);
      // Build, then guess: two steps for three players.
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Build");
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Guess");
      for (const name of ["A", "B", "C"]) game.submitGuess(name, `${name}'s guess`);
      await ticks(GUESS_TICKS);
      // Everyone guessed: the showcase starts.
      expect(game.activeStage?.name).toBe("Vote");
      await voteAll(game, players, () => 3);
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Guessed");
      game.skipStage();
      await ticks(2);
      expect(game.activeStage?.name).toBe("Started as");
      expect(stripColors(byName(players, "A").titles.at(-1) ?? "")).toContain("It started as");
      world.leave("B");
      world.leave("C");
      await ticks(25);
    });
    expect(result).toEqual({ kind: "win", players: ["A"], reason: "everyone else left" });
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });

  it("stops when the arena can't be copied for everyone", async () => {
    // Room to keep only two copies loaded.
    const room = vi.spyOn(world.tickingAreaManager, "hasCapacity").mockImplementation(() => world.tickingAreaManager.areas.size < 2);
    const { players, baseline, from, game } = start(["A", "B", "C"]);
    const result = await playToEnd(game, harness.root, baseline, async () => {
      await ticks(2);
      for (const name of ["A", "B", "C"]) openLiveForm(name)!.click("Skip");
      await ticks(12);
      answerBank(from);
      await ticks(70);
    });
    room.mockRestore();
    expect(result).toEqual({ kind: "aborted", reason: "error" });
    expect(stripColors(world.chat.join("\n"))).toContain("This map's arena is too big to copy for 3 players.");
    expect(world.tickingAreaManager.areas.size).toBe(0);
    expectBaseline(harness.root, baseline);
    world.overworld.reset();
    for (const player of players) world.leave(player.name);
  });
});

/** A guess step's check, and a little more. */
const GUESS_TICKS = 8;

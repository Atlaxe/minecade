// The results screen (results.ts) going on at a jump once its changes have played (the user,
// 2026-11-18: skippable after the place changes), and its jump prompt in the pack.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { GO_ON_WORD, ResultsScreen, resultFrames, type ResultSeat } from "../behavior_pack/scripts/results.ts";
import { codesOf } from "../behavior_pack/scripts/screen-codes.ts";
import { GameSidebar } from "../behavior_pack/scripts/sidebar-rows.ts";

async function ticks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    system.advanceTicks(1);
    await flushPromises(2);
  }
}

const before: ResultSeat[] = [
  { key: "alex", name: "Alex", stars: 0, coins: 10 },
  { key: "sam", name: "Sam", stars: 0, coins: 5 },
];
const after: ResultSeat[] = [
  { key: "alex", name: "Alex", stars: 0, coins: 10 },
  { key: "sam", name: "Sam", stars: 1, coins: 5 },
];

describe("the results screen", () => {
  let scope: Scope;
  let screen: ResultsScreen;
  let alex: FakePlayer;
  let sam: FakePlayer;

  beforeEach(() => {
    world.reset();
    scope = new Scope("results test");
    screen = new ResultsScreen({ scope, sidebar: new GameSidebar(scope), headOf: () => undefined, mayGoOn: (player) => player.name === "Alex" });
    alex = world.join("Alex");
    sam = world.join("Sam");
  });

  afterEach(() => scope.dispose());

  const title = () => world.scoreboard.sidebar?.displayName ?? "";
  /** The ticks every frame but the last takes. */
  const changes = () => {
    const frames = resultFrames(before, after);
    return frames.slice(0, -1).reduce((sum, frame) => sum + frame.ticks, 0);
  };

  it("takes no jump while the changes play, then shows its prompt and goes on at the leader's", async () => {
    let done = false;
    void screen.show(before, after).then(() => (done = true));
    await ticks(2);
    expect(title()).not.toContain(codesOf(GO_ON_WORD));
    expect(screen.jumped(alex as never)).toBe(false);
    await ticks(changes());
    expect(title()).toContain(codesOf(GO_ON_WORD));
    // Someone else's jump does nothing (the screen takes it, though).
    expect(screen.jumped(sam as never)).toBe(true);
    await ticks(3);
    expect(done).toBe(false);
    expect(screen.jumped(alex as never)).toBe(true);
    await ticks(3);
    expect(done).toBe(true);
    expect(screen.jumped(alex as never)).toBe(false);
  });

  it("goes by itself after its hold when nobody jumps", async () => {
    let done = false;
    void screen.show(before, after).then(() => (done = true));
    const all = resultFrames(before, after).reduce((sum, frame) => sum + frame.ticks, 0);
    await ticks(all + 3);
    expect(done).toBe(true);
  });

  it("has the jump prompt in the pack, shown by the word", () => {
    const ui = readFileSync(new URL("../resource_pack/ui/jui_blockparty_results.json", import.meta.url), "utf8");
    expect(ui).toContain(`'${codesOf(GO_ON_WORD)}'`);
  });
});

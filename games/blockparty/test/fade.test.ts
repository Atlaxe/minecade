// The turn fade (fade.ts): on a turn everyone else fades (players go invisible at once, the game's
// own entities ease out by their property and then go invisible), a follower fades with its owner
// and stays with the player whose turn it is, and everyone comes back when the turn is over.
import { beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { FakeMob, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { whoOf, type Who } from "../behavior_pack/scripts/bots.ts";
import { FADED_PROPERTY, FADE_TICKS, TurnFade, fadedKeys } from "../behavior_pack/scripts/fade.ts";

describe("who fades on a turn", () => {
  it("is everyone but the seat whose turn it is, and nobody without a turn", () => {
    expect([...fadedKeys(["alex", "sam", "bot 1"], "sam")]).toEqual(["alex", "bot 1"]);
    expect(fadedKeys(["alex", "sam"], undefined).size).toBe(0);
    // The seats a turn's scene is about (an item's rival) stay in sight.
    expect([...fadedKeys(["alex", "sam", "bot 1"], "sam", ["bot 1"])]).toEqual(["alex"]);
  });
});

describe("the turn fade", () => {
  let scope: Scope;
  let tick: number;
  let fade: TurnFade;
  let alex: FakePlayer;
  let sam: FakePlayer;
  let bot: FakeMob;
  let seats: Who[];

  const invisible = (body: { getEffect(id: string): unknown }) => body.getEffect("invisibility") !== undefined;
  const step = (turn: string | undefined, ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      tick++;
      fade.update(seats, turn);
    }
  };

  beforeEach(() => {
    world.reset();
    scope = new Scope("test");
    tick = 0;
    fade = new TurnFade(scope, () => tick);
    alex = world.join("Alex");
    sam = world.join("Sam");
    bot = new FakeMob("blockparty:bot", { x: 0, y: 65, z: 0 });
    seats = [whoOf(alex as never), whoOf(sam as never), { name: "Bot 1", key: "bot 1", body: bot as never }];
  });

  it("makes the other players invisible at once and eases a bot out before it goes invisible", () => {
    step("alex");
    expect(invisible(alex)).toBe(false);
    expect(invisible(sam)).toBe(true);
    expect(bot.properties.get(FADED_PROPERTY)).toBe(true);
    // The bot's own client fades it; its shadow goes once it has.
    expect(invisible(bot)).toBe(false);
    step("alex", FADE_TICKS);
    expect(invisible(bot)).toBe(true);
  });

  it("brings everyone back when the turn is over, and swaps who's faded between turns", () => {
    step("alex", FADE_TICKS + 1);
    step("sam");
    expect(invisible(alex)).toBe(true);
    expect(invisible(sam)).toBe(false);
    step(undefined);
    expect([alex, sam, bot].map(invisible)).toEqual([false, false, false]);
    expect(bot.properties.get(FADED_PROPERTY)).toBe(false);
  });

  it("keeps a follower with the player whose turn it is, and fades one following someone else", () => {
    const onAlex = new FakeMob("blockparty:zombie", { x: 0, y: 65, z: 0 });
    const onSam = new FakeMob("blockparty:zombie", { x: 0, y: 65, z: 0 });
    fade.follow(onAlex as never, "alex");
    fade.follow(onSam as never, "sam");
    step("alex", FADE_TICKS + 1);
    expect(onAlex.properties.get(FADED_PROPERTY)).not.toBe(true);
    expect(invisible(onAlex)).toBe(false);
    expect(onSam.properties.get(FADED_PROPERTY)).toBe(true);
    expect(invisible(onSam)).toBe(true);
    // It stops following: it comes back.
    fade.unfollow(onSam as never);
    expect(invisible(onSam)).toBe(false);
  });

  it("takes away an invisibility a player wore from before, and brings everyone back when the game ends", () => {
    sam.addEffect("invisibility", 100);
    step(undefined);
    expect(invisible(sam)).toBe(false);
    step("alex", FADE_TICKS + 1);
    scope.dispose();
    expect([alex, sam, bot].map(invisible)).toEqual([false, false, false]);
  });
});

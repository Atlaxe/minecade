// Block Party's animations (animations.ts, moves.ts): the pack's own animations found by their
// names, each touching only bones its model has, every action the dialogue tool lists playing
// something, the moods coins and Stars bring, who celebrates after a minigame, and a line's actions
// played as the card comes in, seconds in, and once it's gone on.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Scope } from "@minecade/minigame-core";
import { system, world, type FakePlayer } from "../../../packages/minigame-core/test/fake-mc-server.ts";
import { flushPromises } from "../../../packages/minigame-core/test/util.ts";
import { CLIPS, NPC_MOVES, PLAYER, PLAYER_SETS, SHOWN, clipsIn, moodOf, movesOf, npcMove, pickClip, playerClips, roleOf, slug, talks, variantsOf, withTalk, type LineAction } from "../behavior_pack/scripts/animations.ts";
import { Dialogue, type SaidLine } from "../behavior_pack/scripts/dialogue.ts";
import { actionsOf, moment, pickLine } from "../behavior_pack/scripts/lines.ts";
import { minigameMoods } from "../behavior_pack/scripts/minigame-rules.ts";
import { NPC_ROLES } from "../behavior_pack/scripts/npcs.ts";
import dialogue from "../dialogue.json";
import wardenBehavior from "../behavior_pack/entities/warden.json";
import wardenClient from "../resource_pack/entity/warden.entity.json";
import playerPack from "../resource_pack/animations/blockparty.player.animation.json";
import npcPack from "../resource_pack/animations/blockparty.npc.animation.json";
import gamePack from "../resource_pack/animations/blockparty.animation.json";

/**
 * The dialogue tool's actions (its seed list, block-party-ui.md "Player animations"): each must
 * play something in game. The user can add more there; a new one plays the pack's animation named
 * after it, or is skipped (and logged) until there is one.
 */
const TOOL_ACTIONS: Record<string, string[]> = {
  Player: ["Celebration", "Sad", "Dice roll", "Select"],
  Chris: ["Talk", "Look at the player", "Celebrate", "Fall in"],
  Villager: ["Talk", "Nod", "Shake head"],
  Witch: ["Talk", "Drink a potion", "Laugh"],
  Warden: ["Roar", "Sonic boom", "Sniff", "Emerge", "Dig away"],
  Enderman: ["Scream", "Teleport"],
  "Wandering Trader": ["Talk", "Nod", "Drink a potion"],
  Referee: ["Talk", "Cheer", "Point"],
  Allay: ["Fly in", "Drop a Star", "Dance"],
  "Iron Golem": ["Offer a flower", "Attack"],
  Zombie: ["Arms up", "Attack"],
};

/**
 * The bones of each owner's model (the vanilla geometries the client entities name, read from the
 * game's own files), so an animation can't name a bone that isn't there: Bedrock would just leave
 * it still. Names are matched without case, as Bedrock does.
 */
const BONES: Record<string, string[]> = {
  // geometry.humanoid.custom: the players, and the bots.
  player: ["root", "waist", "body", "head", "hat", "cape", "jacket", "leftArm", "leftSleeve", "leftItem", "rightArm", "rightSleeve", "rightItem", "leftLeg", "leftPants", "rightLeg", "rightPants"],
  // geometry.pig.v3
  chris: ["root", "head", "body", "leg0", "leg1", "leg2", "leg3"],
  // geometry.villager_v2
  villager: ["head", "helmet", "brim", "nose", "body", "arms", "held_item", "leg0", "leg1"],
  wandering_trader: ["head", "helmet", "brim", "nose", "body", "arms", "held_item", "leg0", "leg1"],
  // geometry.villager.witch.v1.8, on geometry.villager.v1.8
  witch: ["head", "nose", "body", "arms", "leg0", "leg1", "hat", "hat2", "hat3", "hat4"],
  // geometry.vindicator.v1.8
  referee: ["head", "nose", "body", "arms", "leg0", "leg1", "rightArm", "rightItem", "leftArm", "leftItem"],
  // geometry.irongolem
  iron_golem: ["body", "head", "arm0", "arm1", "leg0", "leg1"],
  // geometry.zombie.v1.8
  zombie: ["waist", "body", "head", "hat", "rightArm", "rightItem", "leftArm", "leftItem", "rightLeg", "leftLeg"],
  // geometry.enderman.v1.8
  enderman: ["body", "head", "hat", "rightArm", "rightItem", "leftArm", "rightLeg", "leftLeg"],
  // geometry.allay
  allay: ["root", "head", "look_at", "body", "rightItem", "right_arm", "left_arm", "left_wing", "right_wing"],
  // the Star's own model: one bone
  star: ["root"],
};

type Animations = Record<string, { bones?: Record<string, unknown> }>;

describe("Block Party's animation names", () => {
  it("turn the dialogue tool's names into a name's parts", () => {
    expect(slug("Dice roll")).toBe("dice_roll");
    expect(slug("Wandering Trader")).toBe("wandering_trader");
    expect(slug(" Look at the player ")).toBe("look_at_the_player");
    expect(roleOf("Iron Golem")).toBe("iron_golem");
    // Every character with moves is an NPC role of the game's.
    for (const character of Object.keys(TOOL_ACTIONS)) if (character !== PLAYER) expect(NPC_ROLES.map((role) => role.id)).toContain(roleOf(character));
  });

  it("find an action's animation and its variants, but not another action's that starts the same", () => {
    const clips = clipsIn([
      {
        animations: {
          "animation.blockparty.chris.talk": { animation_length: 1 },
          "animation.blockparty.chris.talk.fast": { bones: { head: { rotation: { "0.0": [0, 0, 0], "0.6": [5, 0, 0] } } } },
          "animation.blockparty.chris.talk.fast.more": { animation_length: 2 },
          "animation.blockparty.chris.talkative": { animation_length: 2 },
          "animation.blockparty.chris.wave": { animation_length: 2, loop: true },
        },
      },
    ]);
    expect(variantsOf(clips, "Chris", "Talk").map((clip) => clip.name)).toEqual(["animation.blockparty.chris.talk", "animation.blockparty.chris.talk.fast"]);
    // A length from its last keyframe when it has none of its own.
    expect(clips.get("animation.blockparty.chris.talk.fast")?.seconds).toBe(0.6);
    expect(clips.get("animation.blockparty.chris.wave")?.loops).toBe(true);
    const found = variantsOf(clips, "Chris", "Talk");
    expect(pickClip(found, () => 0)?.name).toBe(found[0].name);
    expect(pickClip(found, () => 0.999)?.name).toBe(found[1].name);
    expect(pickClip([], () => 0)).toBeUndefined();
  });

  it("have every player set, with 4 or more ways to hit the die", () => {
    for (const set of PLAYER_SETS) expect(variantsOf(CLIPS, PLAYER, set).length, set).toBeGreaterThanOrEqual(1);
    expect(variantsOf(CLIPS, PLAYER, "Dice roll").length).toBeGreaterThanOrEqual(4);
    // Each plays a while and ends (none loops, or it would never finish).
    for (const set of PLAYER_SETS) for (const clip of variantsOf(CLIPS, PLAYER, set)) expect(clip.seconds > 0 && !clip.loops, clip.name).toBe(true);
  });

  it("play something for every action in the dialogue tool's list", () => {
    for (const [owner, actions] of Object.entries(TOOL_ACTIONS)) {
      for (const action of actions) {
        if (owner === PLAYER) continue;
        const { clips, move } = npcMove(CLIPS, owner, action);
        expect(clips.length > 0 || move !== undefined, `${owner}: ${action}`).toBe(true);
      }
    }
    // The table names only actions the tool has.
    for (const [owner, moves] of Object.entries(NPC_MOVES)) for (const action of Object.keys(moves)) expect(TOOL_ACTIONS[owner], `${owner}: ${action}`).toContain(action);
  });

  it("play something for every action a line has in dialogue.json", () => {
    const actions = (dialogue as { actions?: Record<string, LineAction[][]> }).actions ?? {};
    for (const [id, lists] of Object.entries(actions)) {
      const character = moment(id).character;
      for (const action of lists.flat()) {
        const owner = action.who === "Speaker" ? character : ["Player", "Other", "Every player"].includes(action.who) ? PLAYER : action.who;
        const plays = owner === PLAYER ? variantsOf(CLIPS, PLAYER, action.action).length > 0 : npcMove(CLIPS, owner, action.action).clips.length > 0 || npcMove(CLIPS, owner, action.action).move !== undefined;
        expect(plays, `${id}: ${action.who} ${action.action}`).toBe(true);
      }
    }
  });

  it("list every move of each character for the Tests' NPC menus, and every player animation", () => {
    for (const [owner, actions] of Object.entries(TOOL_ACTIONS)) if (owner !== PLAYER) expect(movesOf(CLIPS, owner), owner).toEqual(expect.arrayContaining(actions));
    expect(movesOf(CLIPS, "Chris").filter((move) => move === "Look at the player")).toHaveLength(1);
    expect(playerClips(CLIPS).length).toBe(PLAYER_SETS.reduce((sum, set) => sum + variantsOf(CLIPS, PLAYER, set).length, 0));
  });

  it("keep the Warden hidden until his emerge is under way, and hide him again as his dig has him down", () => {
    const property = (wardenBehavior["minecraft:entity"].description as { properties?: Record<string, { default: unknown }> }).properties?.[SHOWN];
    expect(property?.default).toBe(false);
    const client = wardenClient["minecraft:client_entity"].description;
    expect((client.animations as Record<string, string>).hide).toBe("animation.blockparty.hide");
    expect(client.scripts.animate).toContainEqual({ hide: `!q.property('${SHOWN}')` });
    expect(NPC_MOVES.Warden.Emerge.appear).toBe(true);
    expect(NPC_MOVES.Warden["Dig away"]).toMatchObject({ hold: "stays" });
    // Vanilla's dig leaves him 2.5 blocks down with the top of his head out: the pack's sink, played
    // with it, carries him 3 blocks further by 5 s, held, and he's hidden only after that.
    const sink = NPC_MOVES.Warden["Dig away"].also;
    expect(sink).toBe("animation.blockparty.warden.sink");
    const clip = (gamePack.animations as Record<string, { loop?: unknown; animation_length?: number; bones: Record<string, { position: Record<string, number[]> }> }>)[sink!];
    expect(clip.loop).toBe("hold_on_last_frame");
    for (const bone of ["body", "right_leg", "left_leg"]) expect(Object.values(clip.bones[bone].position).at(-1)![1]).toBeLessThanOrEqual(-48);
    expect(NPC_MOVES.Warden["Dig away"].vanish).toBeGreaterThanOrEqual(clip.animation_length!);
  });

  it("move only bones each model has", () => {
    for (const file of [playerPack, npcPack]) {
      for (const [name, animation] of Object.entries((file as { animations: Animations }).animations)) {
        const owner = name.split(".")[2];
        const bones = BONES[owner];
        expect(bones, `${name}: no model known for "${owner}"`).toBeDefined();
        const known = new Set(bones.map((bone) => bone.toLowerCase()));
        for (const bone of Object.keys(animation.bones ?? {})) expect(known.has(bone.toLowerCase()), `${name}: ${bone}`).toBe(true);
      }
    }
  });

  it("give a talking speaker Talk as the line starts, unless the line gives them something then", () => {
    const end: LineAction = { who: "Player", action: "Sad", when: "End" };
    expect(withTalk([end], "Chris", true)).toEqual([{ who: "Speaker", action: "Talk", when: "Start" }, end]);
    const start: LineAction = { who: "Speaker", action: "Celebrate", when: "Start" };
    expect(withTalk([start], "Chris", true)).toEqual([start]);
    expect(withTalk([], "Game", true)).toEqual([]);
    expect(withTalk([], "Warden", talks(CLIPS, "Warden"))).toEqual([]);
    expect(talks(CLIPS, "Chris") && talks(CLIPS, "Villager") && talks(CLIPS, "Witch") && talks(CLIPS, "Referee") && talks(CLIPS, "Wandering Trader")).toBe(true);
  });
});

describe("Block Party's moods", () => {
  it("celebrate a Star gained, and are sad for a Star or coins lost but not spent", () => {
    expect(moodOf({ coins: 20, stars: 0 }, { coins: 0, stars: 1 })).toBe("Celebration");
    expect(moodOf({ coins: 5, stars: 2 }, { coins: 9, stars: 1 })).toBe("Sad");
    expect(moodOf({ coins: 10, stars: 0 }, { coins: 7, stars: 0 })).toBe("Sad");
    expect(moodOf({ coins: 10, stars: 0 }, { coins: 7, stars: 0 }, 3)).toBeUndefined();
    expect(moodOf({ coins: 10, stars: 0 }, { coins: 5, stars: 0 }, 3)).toBe("Sad");
    expect(moodOf({ coins: 10, stars: 0 }, { coins: 13, stars: 0 })).toBeUndefined();
  });

  it("after a minigame: the winners celebrate, and last place, the losing side or a Battle's losers are sad", () => {
    const ffa = minigameMoods("ffa", [["a"], ["b"], ["c"], ["d"]], { places: [["a"], ["b"], ["c"], ["d"]] });
    expect(Object.fromEntries(ffa)).toEqual({ a: "Celebration", d: "Sad" });
    const tieLast = minigameMoods("ffa", [["a"], ["b"], ["c"]], { places: [["a"], ["b", "c"]] });
    expect(Object.fromEntries(tieLast)).toEqual({ a: "Celebration", b: "Sad", c: "Sad" });
    const battle = minigameMoods("battle", [["a"], ["b"], ["c"]], { places: [["a"], ["b"], ["c"]] });
    expect(Object.fromEntries(battle)).toEqual({ a: "Celebration", b: "Sad", c: "Sad" });
    const team = minigameMoods("2v2", [["a", "b"], ["c", "d"]], { winner: 1 });
    expect(Object.fromEntries(team)).toEqual({ a: "Sad", b: "Sad", c: "Celebration", d: "Celebration" });
    expect(minigameMoods("1v3", [["a"], ["b", "c"]], { winner: undefined }).size).toBe(0);
    expect(minigameMoods("ffa", [["a"], ["b"]], { places: [] }).size).toBe(0);
    expect(Object.fromEntries(minigameMoods("ffa", [["a"], ["b"]], { places: [["a", "b"]] }))).toEqual({ a: "Celebration", b: "Celebration" });
  });
});

describe("a line's actions", () => {
  let scope: Scope;
  let box: Dialogue;
  let alex: FakePlayer;
  let acted: { action: LineAction; said: SaidLine; tick: number }[];

  async function ticks(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      system.advanceTicks(1);
      await flushPromises(2);
    }
  }

  /** Runs ticks until `promise` settles (at most `most`). */
  async function until(promise: Promise<unknown>, most = 200): Promise<void> {
    let done = false;
    void promise.then(() => (done = true));
    for (let i = 0; i < most && !done; i++) await ticks(1);
    expect(done).toBe(true);
  }

  beforeEach(() => {
    world.reset();
    system.reset();
    scope = new Scope("test");
    acted = [];
    box = new Dialogue({
      scope,
      random: () => 0,
      show: () => {},
      leader: () => world.getAllPlayers()[0] as never,
      act: (action, said) => acted.push({ action, said, tick: system.currentTick }),
    });
    alex = world.join("Alex");
  });

  afterEach(() => scope.dispose());

  it("are carried for every alternate of a moment, in its texts' order", () => {
    const actions = (dialogue as { actions?: Record<string, LineAction[][]> }).actions ?? {};
    for (const [id, lists] of Object.entries(actions)) expect(lists.length, id).toBe((dialogue.lines as Record<string, string[]>)[id]?.length);
  });

  it("play as the card comes in, and the End ones once the leader goes on", async () => {
    const actions = (dialogue as { actions?: Record<string, LineAction[][]> }).actions ?? {};
    const id = Object.keys(actions).find((key) => actions[key][0].some((action) => action.when === "End") && (dialogue.lines as Record<string, string[]>)[key]?.[0]);
    if (!id) return;
    const { index } = pickLine(id, { player: "Alex" }, () => 0);
    const expected = withTalk(actionsOf(id, index), moment(id).character, talks(CLIPS, moment(id).character));
    const done = box.say(id, { player: "Alex" });
    await ticks(2);
    expect(acted.map((one) => one.action)).toEqual(expected.filter((action) => action.when === "Start"));
    expect(acted[0]?.said).toMatchObject({ id, character: moment(id).character, fills: { player: "Alex" } });
    await ticks(10);
    box.jumped(alex as never);
    await until(done);
    expect(acted.map((one) => one.action)).toEqual([...expected.filter((action) => action.when === "Start"), ...expected.filter((action) => action.when === "End")]);
  });

  it("play the speaker's Talk on a line with no actions, and nothing for a Game line", async () => {
    const lines = dialogue.lines as Record<string, string[]>;
    const actions = (dialogue as { actions?: Record<string, LineAction[][]> }).actions ?? {};
    const chris = Object.keys(lines).find((key) => moment(key).character === "Chris" && !actions[key] && moment(key).delivery === "Dialogue box");
    const game = Object.keys(lines).find((key) => moment(key).character === "Game" && !actions[key] && moment(key).delivery === "Dialogue box");
    if (chris) {
      const done = box.say(chris, { player: "Alex" });
      await ticks(10);
      box.jumped(alex as never);
      await until(done);
      expect(acted.map((one) => one.action)).toEqual([{ who: "Speaker", action: "Talk", when: "Start" }]);
    }
    acted.length = 0;
    if (game) {
      const done = box.say(game, { player: "Alex" });
      await ticks(10);
      box.jumped(alex as never);
      await until(done);
      expect(acted).toEqual([]);
    }
  });
});

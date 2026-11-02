import { describe, expect, it } from "vitest";
import type { KitDef } from "../src/config.ts";
import { KitPicker, listNames, type KitPickView } from "../src/game/kit-picker.ts";
import { dyeName, itemLabel, kitItemId, kitLines, kitPicturePath, matchKits, pictureDyes, refillOnSpawn, teamColored } from "../src/kit-defs.ts";

const SNOW: KitDef = { id: "snow", name: "Snowballs", refill: "round", items: [{ item: "minecraft:snowball", count: 8 }] };
const LEAP: KitDef = { id: "leap", name: "Leap", refill: "round", items: [{ item: "minecraft:feather", name: "Leap" }] };
const BASE: KitDef = {
  id: "bridges",
  name: "Bridges",
  items: [{ item: "minecraft:wooden_sword" }, { item: "minecraft:bow" }, { item: "minecraft:{color}_wool", count: 64 }, { item: "minecraft:arrow" }],
};

describe("kit items", () => {
  it("puts the team's dye in {color}, white without a team", () => {
    expect(kitItemId({ item: "minecraft:{color}_wool" }, "§c")).toBe("minecraft:red_wool");
    expect(kitItemId({ item: "minecraft:{color}_wool" }, "§9")).toBe("minecraft:blue_wool");
    expect(kitItemId({ item: "minecraft:{color}_wool" }, "§a")).toBe("minecraft:lime_wool");
    expect(kitItemId({ item: "minecraft:{color}_wool" })).toBe("minecraft:white_wool");
    expect(kitItemId({ item: "minecraft:bow" }, "§c")).toBe("minecraft:bow");
    expect(dyeName("§x")).toBe("white");
    expect(teamColored(BASE)).toBe(true);
    expect(teamColored(SNOW)).toBe(false);
  });

  it("names items for the kit form, with counts", () => {
    expect(itemLabel({ item: "minecraft:wooden_sword" })).toBe("Wooden Sword");
    expect(itemLabel({ item: "minecraft:feather", name: "Leap" })).toBe("Leap");
    expect(itemLabel({ item: "minecraft:{color}_wool" })).toBe("Wool");
    expect(kitLines(BASE, "§c")).toEqual(["Wooden Sword", "Bow", "64x Red Wool", "Arrow"]);
    expect(kitLines(SNOW)).toEqual(["8x Snowball"]);
  });

  it("files pictures by kit, by dye for team-colored kits, and under the map for a map's own", () => {
    expect(kitPicturePath("snow")).toBe("textures/minecade/kits/snow");
    expect(kitPicturePath("bridges", { colored: true, teamColor: "§9" })).toBe("textures/minecade/kits/bridges_blue");
    expect(kitPicturePath("bridges", { colored: true })).toBe("textures/minecade/kits/bridges_white");
    expect(kitPicturePath("ice", { map: "glacier" })).toBe("textures/minecade/kits/glacier/ice");
    expect(pictureDyes(["§c", "§9", "§c"])).toEqual(["red", "blue"]);
    expect(pictureDyes([])).toEqual(["white"]);
  });
});

describe("refills", () => {
  it("gives a life kit on every spawn, a round kit each round, a match kit once; respawns get what was left", () => {
    expect((["start", "round", "respawn", "join"] as const).map((why) => refillOnSpawn(undefined, why))).toEqual(["full", "full", "full", "full"]);
    expect((["start", "round", "respawn", "join"] as const).map((why) => refillOnSpawn("round", why))).toEqual(["full", "full", "kept", "kept"]);
    expect((["start", "round", "respawn", "join"] as const).map((why) => refillOnSpawn("match", why))).toEqual(["full", "kept", "kept", "kept"]);
  });
});

describe("matchKits", () => {
  const game = { select: "match" as const, base: BASE, list: [SNOW, LEAP] };

  it("adds a map's kits after the game's, a same-named one in its place", () => {
    const ice: KitDef = { id: "ice", name: "Ice", items: [{ item: "minecraft:ice", count: 16 }] };
    const leap: KitDef = { ...LEAP, items: [{ item: "minecraft:feather", count: 2, name: "Leap" }] };
    const kits = matchKits(game, { list: [leap, ice] });
    expect(kits.list.map((kit) => kit.id)).toEqual(["snow", "leap", "ice"]);
    expect(kits.list[1].items[0].count).toBe(2);
    expect([...kits.fromMap]).toEqual(["leap", "ice"]);
    expect(kits.base).toBe(BASE);
    expect(kits.select).toBe("match");
    expect(kits.pickSeconds).toBe(30);
  });

  it("replaces the game's kits, and its base, when the map says so", () => {
    const base: KitDef = { ...BASE, id: "short", items: BASE.items.slice(0, 2) };
    const kits = matchKits(game, { mode: "replace", base, list: [SNOW] });
    expect(kits.list.map((kit) => kit.id)).toEqual(["snow"]);
    expect(kits.base?.id).toBe("short");
    expect(kits.fromMap.has("short")).toBe(true);
  });

  it("is the game's alone without map kits, and empty without any", () => {
    expect(matchKits(game, undefined).list).toEqual([SNOW, LEAP]);
    expect(matchKits(undefined, undefined)).toMatchObject({ list: [], base: undefined, select: undefined });
  });
});

/** Plain kit choices, like Kits keeps them. */
function choices() {
  const chosen = new Map<string, string>();
  return {
    list: [{ id: "snow" }, { id: "leap" }],
    choose: (player: string, id: string) => (["snow", "leap"].includes(id) ? (chosen.set(player, id), true) : false),
    chosenId: (player: string) => chosen.get(player),
    chosen,
  };
}

function ports() {
  const log: string[] = [];
  const views = new Map<string, KitPickView>();
  return {
    log,
    views,
    show: (name: string, view: KitPickView) => {
      log.push(`show ${name}`);
      views.set(name, view);
    },
    update: (name: string, view: KitPickView) => views.set(name, view),
    close: (name: string) => log.push(`close ${name}`),
  };
}

describe("KitPicker", () => {
  it("shows everyone the form, keeps showing it, and ends once everyone has picked", () => {
    const kits = choices();
    const port = ports();
    let online = ["A", "B"];
    const picker = new KitPicker(port, { players: ["A", "B"], kits, seconds: 30, online: () => online, display: (name) => `§c${name}` });
    expect(port.log).toEqual(["show A", "show B"]);
    expect(port.views.get("A")?.status).toBe("Waiting for §cA§r and §cB§r: 30 s");
    picker.pick("A", "leap");
    expect(port.views.get("B")).toMatchObject({ pickedBy: { snow: [], leap: ["§cA"] }, picks: { A: "leap" } });
    picker.tick();
    expect(port.log.slice(2)).toEqual(["show A", "show B"]); // a closed form comes back each second
    expect(port.views.get("A")?.status).toBe("Waiting for §cB§r: 29 s");
    picker.pick("A", "snow"); // changing your mind is fine
    expect(kits.chosen.get("A")).toBe("snow");
    picker.pick("B", "nope");
    expect(picker.finished).toBe(false);
    picker.pick("B", "leap");
    expect(picker.finished).toBe(true);
    expect(port.log.slice(-2)).toEqual(["close A", "close B"]);
    online = [];
  });

  it("gives whoever hasn't picked the first kit when time runs out", () => {
    const kits = choices();
    const picker = new KitPicker(ports(), { players: ["A", "B"], kits, seconds: 3, online: () => ["A", "B"], display: (name) => name });
    picker.pick("B", "leap");
    picker.tick();
    picker.tick();
    expect(picker.finished).toBe(false);
    picker.tick();
    expect(picker.finished).toBe(true);
    expect(Object.fromEntries(kits.chosen)).toEqual({ A: "snow", B: "leap" });
  });

  it("doesn't wait for someone who left, and a cancel decides nothing", () => {
    const kits = choices();
    let online = ["A", "B", "C"];
    const port = ports();
    const picker = new KitPicker(port, { players: ["A", "B", "C"], kits, seconds: 30, online: () => online, display: (name) => name });
    picker.pick("A", "snow");
    online = ["A", "C"];
    picker.tick();
    expect(port.views.get("A")?.status).toBe("Waiting for C§r: 29 s");
    picker.cancel();
    expect(picker.finished).toBe(true);
    expect(Object.fromEntries(kits.chosen)).toEqual({ A: "snow" });
    picker.pick("C", "leap");
    expect(kits.chosen.has("C")).toBe(false);
  });

  it("lists names in a line", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B", "C"])).toBe("A§r, B§r and C");
    expect(listNames(["A", "B", "C", "D", "E"])).toBe("A§r, B§r and 3 more");
  });
});

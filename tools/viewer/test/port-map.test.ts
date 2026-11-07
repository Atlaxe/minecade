import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorStatus } from "../../editor/editor-core.ts";
import { MapStore } from "../../maps/store.ts";
import { portChoices, portMap, portProblem, portedConfig, suggestId, takenIds, type PortGame } from "../port-map.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
let store: string;
const before = process.env.MAP_STORE;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-port-"));
  process.env.MAP_STORE = store;
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  rmSync(store, { recursive: true, force: true });
});

/** A map in the store's working folder, with a world and a picture. */
function storeMap(target: string, map: string, config: object): string {
  const dir = join(store, "working", target, map);
  mkdirSync(join(dir, "world", "db"), { recursive: true });
  writeFileSync(join(dir, "world", "level.dat"), "level");
  writeFileSync(join(dir, "world", "levelname.txt"), map);
  writeFileSync(join(dir, "world", "db", "000001.ldb"), "blocks");
  writeFileSync(join(dir, "preview.png"), "picture");
  writeFileSync(join(dir, "map.json"), JSON.stringify(config));
  return dir;
}

const KGB = {
  name: "KGB",
  spawns: [[23.75, -43, 0.54, 90, -5]],
  queueSpawn: [-21.06, -33, 15.84],
  queue: { mode: "free", countdown: 5 },
  bounds: { min: [-29, -44, -19], max: [29, -12, 18] },
  killY: -51,
  time: "sunset",
  cameras: { "Camera 1": { at: [-23.84, -35.91, -6.34, -66.7, 7.2], kind: "map" } },
  source: { world: "Minecade Maps", box: { min: [-65, -44, -154], max: [-7, -24, -117] }, offset: [36, 0, 135] },
};

const noEditor = async (): Promise<EditorStatus | undefined> => undefined;
/** A map editor with `open` in Edit, its blocks saved or not. */
const editing = (target: string, map: string, unsaved: boolean) => async () => ({ edit: { target, map, mapName: "KGB", unsaved, saving: false, publishing: false } }) as unknown as EditorStatus;

const GAMES: PortGame[] = [
  { id: "lobby", name: "Lobby", maps: ["spaceship"] },
  { id: "gunfight", name: "Gunfight", maps: ["yard"], borrow: ["siege", "bridges"] },
  { id: "quiver", name: "One in the Quiver", maps: ["kgb", "ruins"] },
  { id: "siege", name: "Siege", maps: ["strife"] },
  { id: "bridges", name: "Bridges", maps: ["temples"] },
];

describe("Port to another game: which ids a game can't take", () => {
  it("counts the game's own maps, the maps it plays too, and those of games that play its maps", () => {
    expect(takenIds("quiver", GAMES)).toEqual({
      kgb: 'One in the Quiver has a map "kgb" already.',
      ruins: 'One in the Quiver has a map "ruins" already.',
    });
    expect(takenIds("gunfight", GAMES)).toEqual({
      yard: 'Gunfight has a map "yard" already.',
      strife: `Gunfight plays Siege's maps too, and Siege has a map "strife".`,
      temples: `Gunfight plays Bridges's maps too, and Bridges has a map "temples".`,
    });
    // Gunfight lists Siege's maps beside its own and Bridges's, so a new Siege map can't take any of their ids.
    expect(takenIds("siege", GAMES)).toEqual({
      strife: 'Siege has a map "strife" already.',
      yard: `Gunfight plays Siege's maps, and has a map "yard" of its own.`,
      temples: `Gunfight plays Siege's maps and Bridges's, which has a map "temples".`,
    });
  });

  it("counts maps still being cut out of a world for the game", () => {
    expect(takenIds("lobby", GAMES, ["hub"])).toEqual({ spaceship: 'Lobby has a map "spaceship" already.', hub: 'A map "hub" is being cut out of a world for Lobby.' });
  });

  it("suggests the map's own id, else one with -2, -3 and so on, within 48 characters", () => {
    expect(suggestId("kgb", {})).toBe("kgb");
    expect(suggestId("kgb", { kgb: "x" })).toBe("kgb-2");
    expect(suggestId("kgb", { kgb: "x", "kgb-2": "x" })).toBe("kgb-3");
    const long = "a".repeat(48);
    expect(suggestId(long, { [long]: "x" })).toBe(`${"a".repeat(46)}-2`);
  });

  it("checks the id and the name", () => {
    const taken = takenIds("gunfight", GAMES);
    expect(portProblem("kgb", "KGB", taken)).toBeUndefined();
    expect(portProblem("strife", "Strife", taken)).toMatch(/plays Siege's maps too/);
    expect(portProblem("KGB", "KGB", taken)).toMatch(/lower case letters/);
    expect(portProblem("kgb", "  ", taken)).toBe("The map needs a name.");
    expect(portProblem("kgb", "x".repeat(49), taken)).toMatch(/1 to 48 characters/);
    expect(portProblem("kgb", "§cRed", taken)).toMatch(/without color codes/);
  });

  it("starts the new map with its name only, as a draft", () => {
    expect(portedConfig(" KGB ")).toEqual({ name: "KGB", draft: true, spawns: [] });
  });
});

describe("Port to another game in the map store", () => {
  it("lists every other game, the lobby last, each with an id it can take", async () => {
    storeMap("quiver", "kgb", KGB);
    storeMap("siege", "kgb", { name: "Siege KGB", spawns: [] });
    const answer = await portChoices(root, "quiver", "kgb");
    expect(answer.status).toBe(200);
    if (answer.status !== 200) return;
    expect(answer).toMatchObject({ name: "KGB", targetName: "One in the Quiver" });
    const ids = answer.games.map((game) => game.id);
    expect(ids).not.toContain("quiver");
    expect(ids.at(-1)).toBe("lobby");
    const gunfight = answer.games.find((game) => game.id === "gunfight")!;
    // Gunfight plays Siege's maps, and Siege has a "kgb".
    expect(gunfight.suggested).toBe("kgb-2");
    expect(gunfight.taken.kgb).toMatch(/plays Siege's maps too/);
    expect(answer.games.find((game) => game.id === "sumo")?.suggested).toBe("kgb");
    expect(await portChoices(root, "quiver", "nowhere")).toMatchObject({ status: 404 });
    expect(await portChoices(root, "..", "kgb")).toMatchObject({ status: 400 });
  });

  it("copies the world alone into a new draft map of the other game, kept as its first version", async () => {
    const from = storeMap("quiver", "kgb", KGB);
    const answer = await portMap(root, { target: "quiver", map: "kgb", to: "gunfight", id: "kgb", name: "KGB" }, noEditor);
    expect(answer).toMatchObject({ status: 200, target: "gunfight", targetName: "Gunfight", map: "kgb", name: "KGB" });
    const dir = join(store, "working", "gunfight", "kgb");
    expect(JSON.parse(readFileSync(join(dir, "map.json"), "utf8"))).toEqual({ name: "KGB", draft: true, spawns: [] });
    expect(readFileSync(join(dir, "world", "db", "000001.ldb"), "utf8")).toBe("blocks");
    expect(readFileSync(join(dir, "world", "level.dat"), "utf8")).toBe("level");
    // Its picture stays with the old map, and no half-made folder is left.
    expect(existsSync(join(dir, "preview.png"))).toBe(false);
    expect(readdirSync(join(store, "working", "gunfight"))).toEqual(["kgb"]);
    // The old map is as it was.
    expect(JSON.parse(readFileSync(join(from, "map.json"), "utf8"))).toEqual(KGB);
    const maps = MapStore.open(store);
    try {
      expect(maps.versions("gunfight", "kgb")).toMatchObject([{ n: 1, kind: "save", by: "Port from quiver/kgb", published: false }]);
    } finally {
      maps.close();
    }
    // The id is taken now.
    expect(await portMap(root, { target: "quiver", map: "kgb", to: "gunfight", id: "kgb", name: "KGB" }, noEditor)).toMatchObject({ status: 422, error: 'Gunfight has a map "kgb" already.' });
  });

  it("refuses its own game, ids another game's list has, bad names and missing maps", async () => {
    storeMap("quiver", "kgb", KGB);
    storeMap("siege", "strife", { name: "Strife", spawns: [] });
    const port = (body: object) => portMap(root, { target: "quiver", map: "kgb", to: "gunfight", id: "kgb", name: "KGB", ...body }, noEditor);
    expect(await port({ to: "quiver", id: "kgb2" })).toMatchObject({ status: 422, error: /port it to another game/ });
    expect(await port({ id: "strife" })).toMatchObject({ status: 422, error: /plays Siege's maps too/ });
    expect(await port({ id: "Bad Id" })).toMatchObject({ status: 422 });
    expect(await port({ name: "" })).toMatchObject({ status: 422, error: "The map needs a name." });
    expect(await port({ map: "nowhere" })).toMatchObject({ status: 404 });
    expect(await port({ to: "nogame" })).toMatchObject({ status: 404 });
    expect(await port({ to: "../x" })).toMatchObject({ status: 400 });
    expect(existsSync(join(store, "working", "gunfight"))).toBe(false);
  });

  it("waits for game Edit to save blocks it has open, and takes them once saved", async () => {
    storeMap("quiver", "kgb", KGB);
    const body = { target: "quiver", map: "kgb", to: "gunfight", id: "kgb", name: "KGB" };
    expect(await portMap(root, body, editing("quiver", "kgb", true))).toMatchObject({ status: 409, error: /hasn't saved yet: Save it first/ });
    expect(existsSync(join(store, "working", "gunfight", "kgb"))).toBe(false);
    expect(await portMap(root, body, editing("quiver", "kgb", false))).toMatchObject({ status: 200 });
  });
});

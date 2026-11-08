import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nbt from "prismarine-nbt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeLevelDat } from "../../build/leveldat.ts";
import { MapStore } from "../../maps/store.ts";
import { deleteMap, type DeleteLinks } from "../delete-map.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
/** A real level.dat: publishing writes the world servers read, Beta APIs on. */
const LEVEL_DAT = encodeLevelDat({ storageVersion: 10, root: { ...nbt.comp({ LevelName: nbt.string("Test") }), name: "" } as nbt.NBT });
let store: string;
const before = process.env.MAP_STORE;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "minecade-viewer-delete-"));
  process.env.MAP_STORE = store;
});
afterEach(() => {
  if (before === undefined) delete process.env.MAP_STORE;
  else process.env.MAP_STORE = before;
  rmSync(store, { recursive: true, force: true });
});

/** A map in the store's working folder, kept as its first version (published when asked). */
function storeMap(target: string, map: string, name: string, publish = false): string {
  const dir = join(store, "working", target, map);
  mkdirSync(join(dir, "world", "db"), { recursive: true });
  writeFileSync(join(dir, "world", "level.dat"), LEVEL_DAT);
  writeFileSync(join(dir, "map.json"), JSON.stringify({ name, spawns: [] }));
  const maps = MapStore.open(store);
  try {
    if (publish) maps.publish(target, map, "test");
    else maps.saveVersion(target, map, "save", "test");
  } finally {
    maps.close();
  }
  return dir;
}

/** Links with no editor running, noting what the Panel's own Select lists were told. */
function links(editor: DeleteLinks["editor"] = async () => undefined, lobbyMap = "spaceship"): DeleteLinks & { forgotten: string[] } {
  const forgotten: string[] = [];
  return { editor, lobbyMap: () => lobbyMap, forgotten, forgetSelections: async (target, map) => void forgotten.push(`${target}/${map}`) };
}

describe("Delete in the Panel", () => {
  it("deletes a map itself when no map editor runs: its folder goes, and Select's lists hear of it", async () => {
    const dir = storeMap("quiver", "doomed", "Doomed");
    const link = links();
    expect(await deleteMap(root, { target: "quiver", map: "doomed" }, link)).toEqual({ status: 200, published: false, message: "Deleted Doomed (One in the Quiver)." });
    expect(existsSync(dir)).toBe(false);
    expect(link.forgotten).toEqual(["quiver/doomed"]);
    const maps = MapStore.open(store);
    try {
      expect(maps.versions("quiver", "doomed")).toEqual([]);
    } finally {
      maps.close();
    }
    // Gone now.
    expect(await deleteMap(root, { target: "quiver", map: "doomed" }, link)).toMatchObject({ status: 404 });
  });

  it("unpublishes a published map, which leaves the lobby at the network's next start", async () => {
    storeMap("quiver", "doomed", "Doomed", true);
    const exported = join(store, "published", "worlds", "quiver", "doomed");
    const maps = MapStore.open(store);
    try {
      maps.exportPublished();
    } finally {
      maps.close();
    }
    expect(existsSync(exported)).toBe(true);
    const answer = await deleteMap(root, { target: "quiver", map: "doomed" }, links());
    expect(answer).toMatchObject({ status: 200, published: true, message: /leaves the lobby at the network's next start/ });
    expect(existsSync(exported)).toBe(false);
  });

  it("leaves the deleting to a running map editor, and says what it said", async () => {
    const dir = storeMap("quiver", "doomed", "Doomed");
    const asked: string[] = [];
    const link = links(async (target, map) => {
      asked.push(`${target}/${map}`);
      return { published: true };
    });
    expect(await deleteMap(root, { target: "quiver", map: "doomed" }, link)).toMatchObject({ status: 200, published: true });
    expect(asked).toEqual(["quiver/doomed"]);
    // The editor deletes the folder; the Panel's own Select lists still hear of it.
    expect(existsSync(dir)).toBe(true);
    expect(link.forgotten).toEqual(["quiver/doomed"]);
    const refused = links(async () => ({ error: "a preview of it is running: end the preview first" }));
    expect(await deleteMap(root, { target: "quiver", map: "doomed" }, refused)).toEqual({ status: 409, error: "The map editor didn't delete it: a preview of it is running: end the preview first." });
    expect(refused.forgotten).toEqual([]);
  });

  it("refuses the live lobby, bad ids and missing maps", async () => {
    const dir = storeMap("lobby", "station", "Station", true);
    expect(await deleteMap(root, { target: "lobby", map: "station" }, links(undefined, "station"))).toEqual({
      status: 409,
      error: "Station is the live lobby (LOBBY_MAP): pick another lobby map on the Servers page first.",
    });
    expect(existsSync(dir)).toBe(true);
    // Another lobby map is live: it goes, and leaves the lobby map picker.
    expect(await deleteMap(root, { target: "lobby", map: "station" }, links())).toMatchObject({ status: 200, message: "Deleted Station (Lobby). It leaves the Panel's lobby map picker." });
    expect(await deleteMap(root, { target: "../x", map: "doomed" }, links())).toMatchObject({ status: 400 });
    expect(await deleteMap(root, { target: "quiver", map: "nowhere" }, links())).toMatchObject({ status: 404 });
  });
});

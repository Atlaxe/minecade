import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importConfig } from "../import-config.ts";
import { listTargets, type BrokenTarget } from "../targets.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minecade-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a file and moves its modified time on, as an edit some seconds later would. */
function write(path: string, text: string, secondsLater = 0): void {
  writeFileSync(path, text);
  const time = new Date(Date.now() - 60_000 + secondsLater * 1000);
  utimesSync(path, time, time);
}

describe("importConfig", () => {
  it("reads the files a config imports as they are now, not as first imported", async () => {
    const config = join(dir, "game.config.ts");
    write(join(dir, "rules.ts"), "export const LENGTHS = [15, 10];\n");
    write(config, 'import { LENGTHS } from "./rules.ts";\nexport default { lengths: LENGTHS };\n');
    expect(await importConfig(config)).toEqual({ lengths: [15, 10] });
    // Block Party's pass 5: the rules gain an export and the config starts using it.
    write(join(dir, "rules.ts"), "export const LENGTHS = [15, 10, 20];\nexport const BOT_COUNTS = [3, 2, 1, 0];\n", 5);
    write(config, 'import { BOT_COUNTS, LENGTHS } from "./rules.ts";\nexport default { lengths: LENGTHS, bots: BOT_COUNTS };\n', 5);
    expect(await importConfig(config)).toEqual({ lengths: [15, 10, 20], bots: [3, 2, 1, 0] });
  });

  it("keeps a config until one of its files changes", async () => {
    const config = join(dir, "game.config.ts");
    write(join(dir, "rules.ts"), "export const SEATS = 4;\n");
    write(config, 'import { SEATS } from "./rules.ts";\nexport default { seats: SEATS };\n');
    const first = await importConfig(config);
    expect(await importConfig(config)).toBe(first);
    write(join(dir, "rules.ts"), "export const SEATS = 6;\n", 5);
    expect(await importConfig(config)).toEqual({ seats: 6 });
  });

  it("says what's wrong, by file and line, when a config doesn't build", async () => {
    const config = join(dir, "game.config.ts");
    write(join(dir, "rules.ts"), "export const LENGTHS = [15];\n");
    write(config, 'import { BOT_COUNTS } from "./rules.ts";\nexport default { bots: BOT_COUNTS };\n');
    await expect(importConfig(config)).rejects.toThrow('game.config.ts:1: No matching export in "rules.ts" for import "BOT_COUNTS"');
  });
});

describe("listTargets", () => {
  it("leaves out a game whose config doesn't load, says why, and still lists the rest", async () => {
    const root = join(dir, "network");
    for (const id of ["bad", "good", "taker"]) mkdirSync(join(root, "games", id), { recursive: true });
    write(join(root, "games", "bad", "game.config.ts"), 'import { MISSING } from "./nowhere.ts";\nexport default { name: "Bad", maxPlayers: MISSING };\n');
    write(join(root, "games", "good", "game.config.ts"), 'export default { name: "Good", maxPlayers: 4 };\n');
    write(join(root, "games", "taker", "game.config.ts"), 'export default { name: "Taker", maxPlayers: 8, map: { borrow: ["good"] } };\n');
    const broken: BrokenTarget[] = [];
    const targets = await listTargets(root, (target) => broken.push(target));
    expect(targets.map(({ id }) => id)).toEqual(["lobby", "good", "taker"]);
    expect(targets.find(({ id }) => id === "good")?.borrowers).toEqual([{ id: "taker", name: "Taker", maxPlayers: 8 }]);
    expect(broken).toEqual([{ id: "bad", file: "games/bad/game.config.ts", error: expect.stringContaining('Could not resolve "./nowhere.ts"') }]);
  });
});

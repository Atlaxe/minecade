import { describe, expect, it } from "vitest";
import { unpublishedFolders } from "../catalog.ts";
import type { Git } from "../publish.ts";

/** git answering status and log as given (each trimmed, as gitIn returns them). */
function fakeGit(status: string, log: { code: number; out: string } = { code: 0, out: "" }): Git {
  return async (args) => (args[0] === "status" ? { code: 0, out: status.trim() } : log);
}

describe("the editor lobby's unpublished maps", () => {
  const folders = ["games/sumo/maps/arena_1", "games/sumo/maps/arena_10", "games/sumo/maps/pit", "lobby/maps/spaceship", "games/quiver/maps/mansion"];

  it("are the folders with changed or new files, or commits not pushed yet", async () => {
    const status = [" M games/sumo/maps/arena_10/map.json", "?? games/sumo/maps/pit/world/db/000001.log", "R  lobby/maps/old/a.txt -> lobby/maps/spaceship/a.txt"].join("\n");
    const found = await unpublishedFolders(fakeGit(status, { code: 0, out: "games/quiver/maps/mansion/world/level.dat\n" }), folders);
    expect([...found].sort()).toEqual(["games/quiver/maps/mansion", "games/sumo/maps/arena_10", "games/sumo/maps/pit", "lobby/maps/spaceship"]);
  });

  it("read the first status line, whose leading space the trimmed output loses", async () => {
    expect([...(await unpublishedFolders(fakeGit(" D games/sumo/maps/arena_1/world/db/000088.log"), folders))]).toEqual(["games/sumo/maps/arena_1"]);
  });

  it("are none when nothing changed or git can't tell (no upstream)", async () => {
    expect((await unpublishedFolders(fakeGit("", { code: 128, out: "fatal: no upstream configured" }), folders)).size).toBe(0);
    expect((await unpublishedFolders(fakeGit(""), [])).size).toBe(0);
  });
});

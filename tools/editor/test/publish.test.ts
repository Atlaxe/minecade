import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitIn, publishMap, publishMessage } from "../publish.ts";

const MAP = "games/sumo/maps/castle";

describe("publishMessage", () => {
  it("names the game, the map and the time here", () => {
    expect(publishMessage("Sumo", "Sewer", new Date(2026, 9, 31, 8, 5))).toBe("Automated Map Build : Sumo Sewer 2026-10-31 08:05");
  });
});

// A throwaway checkout with a bare repo standing in for GitHub, and a second clone that pushes too.
describe("publishMap", () => {
  let dir: string;
  let work: string;
  let other: string;
  let remote: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
  const setUp = (cwd: string) => {
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.invalid");
    git(cwd, "config", "commit.gpgsign", "false");
    git(cwd, "config", "core.autocrlf", "false");
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "minecade-publish-test-"));
    remote = join(dir, "remote.git");
    work = join(dir, "work");
    other = join(dir, "other");
    git(dir, "init", "--quiet", "--bare", "-b", "main", remote);
    git(dir, "init", "--quiet", "-b", "main", work);
    setUp(work);
    await mkdir(join(work, MAP), { recursive: true });
    await writeFile(join(work, MAP, "map.json"), '{ "name": "Castle", "draft": true }\n');
    await writeFile(join(work, "README.md"), "readme\n");
    git(work, "add", "--all");
    git(work, "commit", "--quiet", "-m", "start");
    git(work, "remote", "add", "origin", remote);
    git(work, "push", "--quiet", "-u", "origin", "main");
    git(dir, "clone", "--quiet", "-c", "core.autocrlf=false", remote, other);
    setUp(other);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("commits only the map's folder, new world files too, and pushes it", async () => {
    await writeFile(join(work, MAP, "map.json"), '{ "name": "Castle" }\n');
    await mkdir(join(work, MAP, "world", "db"), { recursive: true });
    await writeFile(join(work, MAP, "world", "db", "000001.log"), Buffer.from([0, 1, 2, 13, 10, 255]));
    // Someone else's work in the same checkout: a change, and a staged new file.
    await writeFile(join(work, "README.md"), "readme, changed\n");
    await writeFile(join(work, "staged.txt"), "staged\n");
    git(work, "add", "staged.txt");

    const result = await publishMap(gitIn(work), MAP, "Automated Map Build : Sumo Castle 2026-10-31 18:42");
    expect(result).toEqual({ outcome: "pushed", commit: git(work, "rev-parse", "--short", "HEAD") });
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("Automated Map Build : Sumo Castle 2026-10-31 18:42");
    expect(git(remote, "show", "--name-only", "--format=", "main").split("\n").sort()).toEqual([`${MAP}/map.json`, `${MAP}/world/db/000001.log`]);
    // The other changes are still there, as they were.
    expect(git(work, "status", "--porcelain")).toBe(" M README.md\nA  staged.txt");
  });

  it("says when nothing changed since the last publish", async () => {
    expect(await publishMap(gitIn(work), MAP, "again")).toEqual({ outcome: "unchanged" });
  });

  it("catches up with commits pushed from elsewhere first", async () => {
    git(other, "pull", "--quiet");
    await writeFile(join(other, "elsewhere.txt"), "from another clone\n");
    git(other, "add", "elsewhere.txt");
    git(other, "commit", "--quiet", "-m", "elsewhere");
    git(other, "push", "--quiet");
    await writeFile(join(work, MAP, "map.json"), '{ "name": "Castle Keep" }\n');

    const result = await publishMap(gitIn(work), MAP, "Automated Map Build : Sumo Castle Keep 2026-10-31 18:50");
    expect(result.outcome).toBe("pushed");
    expect(git(remote, "log", "--format=%s", "-3", "main").split("\n")).toEqual([
      "Automated Map Build : Sumo Castle Keep 2026-10-31 18:50",
      "elsewhere",
      "Automated Map Build : Sumo Castle 2026-10-31 18:42",
    ]);
  });

  it("keeps the commit when the push fails, and pushes it on the next publish", async () => {
    await writeFile(join(work, MAP, "map.json"), '{ "name": "Castle Gate" }\n');
    git(work, "remote", "set-url", "origin", join(dir, "nowhere.git"));
    const failed = await publishMap(gitIn(work), MAP, "gate");
    expect(failed.outcome).toBe("failed");
    expect(failed.outcome === "failed" && failed.commit).toBe(git(work, "rev-parse", "--short", "HEAD"));
    expect(failed.outcome === "failed" && failed.error).toMatch(/^git push: /);

    git(work, "remote", "set-url", "origin", remote);
    expect(await publishMap(gitIn(work), MAP, "gate")).toEqual({ outcome: "pushed" });
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("gate");
  });
});

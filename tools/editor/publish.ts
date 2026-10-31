// Publish: commits one map's folder and pushes it. Start the network builds from this checkout, so a
// published map (no longer a draft) is in the lobby's game list from the network's next start, and
// every other clone gets it from GitHub. Only the map's folder goes into the commit, whatever else
// is changed or staged in the checkout.
import { execFile } from "node:child_process";

/** Fetching and pushing can wait on the network (or a sign-in window), the rest is local. */
const LOCAL_MS = 30_000;
const NETWORK_MS = 120_000;

/** Runs git in the checkout: its exit code (-1 when it didn't run) and what it printed. */
export type Git = (args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>;

export type PublishResult =
  /** Committed (unless nothing in the map changed since its last commit) and pushed. */
  | { outcome: "pushed"; commit?: string }
  /** Nothing in the map changed since its last commit, and nothing was waiting to be pushed. */
  | { outcome: "unchanged" }
  /** Stopped. `commit` is set when the commit was made but the push failed. */
  | { outcome: "failed"; error: string; commit?: string };

/** "Automated Map Build : Sumo Sewer 2026-10-31 18:42", the time in this PC's time zone. */
export function publishMessage(gameName: string, mapName: string, at: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const time = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
  return `Automated Map Build : ${gameName} ${mapName} ${time}`;
}

/** git in `cwd`, never asking for anything on the console. */
export function gitIn(cwd: string): Git {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        "git",
        args,
        { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
        (error, stdout, stderr) => {
          const out = `${stdout}${stderr}`.trim();
          if (!error) return resolve({ code: 0, out });
          const code = typeof error.code === "number" ? error.code : -1;
          resolve({ code, out: out || error.message });
        },
      );
    });
}

/**
 * Commits `path` (a map's folder, relative to the checkout) with `message` and pushes the branch.
 * It catches up with GitHub first when it can, so the push goes through; a push that fails leaves
 * the commit here, and publishing again pushes it.
 */
export async function publishMap(git: Git, path: string, message: string): Promise<PublishResult> {
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], LOCAL_MS);
  // Fails when local changes are in the way; the push below then says what's wrong.
  if (upstream.code === 0 && (await git(["fetch", "--quiet"], NETWORK_MS)).code === 0) {
    await git(["merge", "--ff-only", "--quiet", "@{upstream}"], LOCAL_MS);
  }

  const added = await git(["add", "--all", "--", path], LOCAL_MS);
  if (added.code !== 0) return { outcome: "failed", error: `git add: ${firstLine(added.out)}` };
  const diff = await git(["diff", "--cached", "--quiet", "--", path], LOCAL_MS);
  if (diff.code !== 0 && diff.code !== 1) return { outcome: "failed", error: `git diff: ${firstLine(diff.out)}` };
  let commit: string | undefined;
  if (diff.code === 1) {
    // Naming the path commits only it, even with other changes staged.
    const committed = await git(["commit", "--quiet", "-m", message, "--", path], LOCAL_MS);
    if (committed.code !== 0) return { outcome: "failed", error: `git commit: ${firstLine(committed.out)}` };
    commit = (await git(["rev-parse", "--short", "HEAD"], LOCAL_MS)).out;
  }

  if (upstream.code !== 0) return { outcome: "failed", error: "this checkout's branch has nowhere to push to (no upstream)", ...(commit ? { commit } : {}) };
  const ahead = await git(["rev-list", "--count", "@{upstream}..HEAD"], LOCAL_MS);
  if (!commit && ahead.code === 0 && ahead.out === "0") return { outcome: "unchanged" };
  const pushed = await git(["push", "--quiet"], NETWORK_MS);
  if (pushed.code !== 0) {
    const behind = /rejected|non-fast-forward|fetch first/i.test(pushed.out);
    const error = behind ? "GitHub has newer commits that couldn't be merged here: pull them, then publish again" : `git push: ${firstLine(pushed.out)}`;
    return { outcome: "failed", error, ...(commit ? { commit } : {}) };
  }
  return { outcome: "pushed", ...(commit ? { commit } : {}) };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "failed";
}

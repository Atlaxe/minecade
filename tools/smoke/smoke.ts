// End-to-end smoke test that needs no players: (re)builds and starts the stack, starts a Sumo
// session through the debug API, checks the game container and its port bindings, lets the
// game give up waiting for players, then checks the session ended cleanly, the container is
// gone and stats storage answers.
//   npm run smoke                 rebuild and start the stack first (docker compose up -d --build)
//   npm run smoke -- --no-build   use the stack that is already running
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connectDocker, findContainerByName } from "../build/docker-util.ts";

const API = "http://127.0.0.1:8080";
const GAME = "sumo";
const MAP = "arena_1";
const GAME_PORT = 19133;
const root = fileURLToPath(new URL("../../", import.meta.url));
const docker = connectDocker();
let failures = 0;
// Right after a restart, Docker's port proxy accepts connections before the orchestrator listens,
// so a request can hang on fetch's unref'd timeout timer alone; Node would then exit mid-wait.
setInterval(() => {}, 60_000);

function pass(text: string): void {
  console.log(`  PASS  ${text}`);
}

function fail(text: string): void {
  failures++;
  console.log(`  FAIL  ${text}`);
}

function stop(text: string): never {
  fail(text);
  console.log(`\nSmoke test FAILED (${failures} failure${failures === 1 ? "" : "s"}).`);
  process.exit(1);
}

async function api(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

async function status(): Promise<{ state?: string; sessionId?: string; transport?: string } | undefined> {
  try {
    return (await api("GET", "/v1/status")).body;
  } catch {
    return undefined;
  }
}

/** Polls every second until `check` returns something, or gives up after `seconds`. */
async function waitUntil<T>(seconds: number, check: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let elapsed = 0; elapsed < seconds; elapsed++) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

function orchestratorLog(since: Date): string {
  const result = spawnSync("docker", ["logs", "--since", since.toISOString(), "minecade-orchestrator"], { encoding: "utf8" });
  return `${result.stdout}${result.stderr}`;
}

console.log("Minecade smoke test\n");

if (!process.argv.includes("--no-build")) {
  console.log("Building and starting the stack (docker compose up -d --build)...");
  const up = spawnSync("docker", ["compose", "--env-file", ".env", "up", "-d", "--build"], { cwd: root, stdio: "inherit" });
  if (up.status !== 0) stop("docker compose up failed");
}

const ready = await waitUntil(120, status);
if (!ready) stop(`the orchestrator debug API (${API}) didn't answer within 120 s`);
pass(`orchestrator answers (transport ${ready.transport})`);
if (ready.state !== "idle") stop(`a game is ${ready.state} (session ${ready.sessionId}); end it first`);

const lobby = await findContainerByName(docker, "minecade-lobby");
if ((await lobby?.inspect())?.State.Running) pass("lobby container is running");
else fail("lobby container is not running");

const startedAt = new Date(Date.now() - 1000);
// Right after a restart the orchestrator may still be removing leftover games; it says so.
const start = (await waitUntil(60, async () => {
  const attempt = await api("POST", "/v1/start", { game: GAME, map: MAP });
  return attempt.status === 409 && String(attempt.body.error).includes("starting up") ? undefined : attempt;
}));
if (!start) stop("the orchestrator was still starting up after 60 s");
const sessionId = start.body.sessionId;
if (start.status !== 202 || typeof sessionId !== "string") stop(`starting ${GAME} failed: HTTP ${start.status} ${JSON.stringify(start.body)}`);
pass(`started ${GAME} on ${MAP} (session ${sessionId})`);

const running = await waitUntil(180, async () => {
  const now = await status();
  if (now?.state === "running") return true;
  if (now?.state === "idle") return false;
  return undefined;
});
if (running !== true) stop(`the session never became ready${running === false ? " (it ended while starting)" : " within 180 s"}\n${orchestratorLog(startedAt)}`);
pass("the game server is ready");

const container = await findContainerByName(docker, `minecade-game-${sessionId}`);
const info = await container?.inspect();
if (!info?.State.Running) {
  fail(`container minecade-game-${sessionId} is not running`);
} else {
  pass(`container ${info.Name.slice(1)} is running`);
  if (info.Config.Labels["minecade.session"] === sessionId) pass("container is labeled with the session");
  else fail(`container label minecade.session is ${info.Config.Labels["minecade.session"]}`);
  for (const protocol of ["tcp", "udp"]) {
    const bindings = info.NetworkSettings.Ports[`${GAME_PORT}/${protocol}`] ?? [];
    if (bindings.some((binding) => binding.HostPort === String(GAME_PORT))) pass(`port ${GAME_PORT}/${protocol} is published`);
    else fail(`port ${GAME_PORT}/${protocol} is not published (${JSON.stringify(bindings)})`);
  }
}

console.log("  ....  waiting for the game to give up on players (about 40 s)");
const idle = await waitUntil(150, async () => ((await status())?.state === "idle" ? true : undefined));
if (!idle) stop("the session didn't end within 150 s");
const log = orchestratorLog(startedAt);
const ending = new RegExp(`session ${sessionId}: ending \\(([^)]*)\\)`).exec(log);
if (ending?.[1] === "empty") pass("the game ended itself: empty");
else fail(`the session ended with "${ending?.[1] ?? "no ending line"}", expected "empty"`);

const gone = await waitUntil(15, async () => ((await findContainerByName(docker, `minecade-game-${sessionId}`)) ? undefined : true));
if (gone) pass("the game container was removed");
else fail(`container minecade-game-${sessionId} still exists`);

const stats = await api("GET", "/v1/stats").catch(() => undefined);
if (stats?.status === 200) pass(`stats storage answers (${(stats.body.players as unknown[]).length} players recorded)`);
else fail(`GET /v1/stats answered ${stats ? `HTTP ${stats.status} ${JSON.stringify(stats.body)}` : "nothing"}`);

// A dev setting (DEV_*) is on on purpose; the orchestrator says so at startup, which can land in the window.
const problems = log.split("\n").filter((line) => /\] (WARN|ERROR) /.test(line) && !/\bDEV_[A-Z_]+ is on\b/.test(line));
if (problems.length === 0) pass("no warnings or errors in the orchestrator log");
else fail(`the orchestrator logged problems:\n        ${problems.join("\n        ")}`);

console.log(failures === 0 ? "\nSmoke test passed." : `\nSmoke test FAILED (${failures} failure${failures === 1 ? "" : "s"}).`);
process.exit(failures === 0 ? 0 : 1);

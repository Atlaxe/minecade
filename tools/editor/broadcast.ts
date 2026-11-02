// The Friends tab broadcast while the map editor runs (BROADCAST in .env, the same switch as the
// network's): the network's bot (broadcaster/), signed in as the same spare account (the
// minecade-broadcaster volume keeps its sign-in), showing "Minecade map editor" in its friends'
// Friends tab and relaying their joins to the editor lobby. Anyone may add the account as a friend;
// the editor lobby's allow list still lets in only map editors and the guests set on the Panel.
import { spawn } from "node:child_process";
import type Docker from "dockerode";
import { connectDocker, findContainerByName, followLogs } from "../build/docker-util.ts";
import { BroadcastLog } from "../control-panel/core.ts";
import type { BroadcastStatus } from "./editor-core.ts";

/** The image docker compose builds from broadcaster/ for the network. */
const IMAGE = "minecade/broadcaster:local";
const CONTAINER = "minecade-editor-broadcaster";
/** Where the network's broadcast keeps its sign-in: the account signs in once for both. */
const VOLUME = "minecade-broadcaster";
/** The name friends see in their Friends tab. */
export const WORLD_NAME = "Minecade map editor";
const STOP_SECONDS = 5;

export class EditorBroadcast {
  private readonly root: string;
  private readonly note: (text: string) => void;
  private container: Docker.Container | undefined;
  private state: BroadcastStatus["container"] = null;
  private log = new BroadcastLog();
  private stopFollowing: (() => void) | undefined;
  /** Starting and stopping run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { root: string; note(text: string): void }) {
    this.root = options.root;
    this.note = (text) => options.note(`Friends tab: ${text}`);
  }

  status(): BroadcastStatus {
    const { phase, account, signIn, lastJoin, lastError } = this.log;
    return { container: this.state, phase: this.state ? phase : null, account, signIn, lastJoin, lastError };
  }

  /** Starts it, relaying joins to the editor lobby on `host`:`port`. Never throws: a failure is in the log. */
  start(host: string, port: number): Promise<void> {
    return this.enqueue(async () => {
      await this.remove();
      try {
        await this.launch(host, port);
      } catch (error) {
        this.state = null;
        // The Panel shows it beside the switch.
        this.log.lastError = error instanceof Error ? error.message : String(error);
        this.note(`could not start: ${this.log.lastError}`);
      }
    });
  }

  /** Stops it (nothing happens when it isn't running). */
  stop(): Promise<void> {
    return this.enqueue(() => this.remove());
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work, work);
    this.queue = result;
    return result;
  }

  private async launch(host: string, port: number): Promise<void> {
    const docker = connectDocker();
    if (!(await docker.getImage(IMAGE).inspect().then(() => true, () => false))) {
      this.note("building the bot's image (the network builds it too)...");
      await buildImage(this.root);
    }
    // One left over from an editor that didn't shut down.
    await (await findContainerByName(docker, CONTAINER))?.remove({ force: true });
    const container = await docker.createContainer({
      name: CONTAINER,
      Image: IMAGE,
      Env: ["BROADCAST=1", `LOBBY_HOST=${host}`, `LOBBY_PORT=${port}`, `WORLD_NAME=${WORLD_NAME}`],
      OpenStdin: true,
      Tty: false,
      HostConfig: { Binds: [`${VOLUME}:/data`] },
      // The Panel lists it with the editor's servers, and never takes it for the network's.
      Labels: { "minecade.role": "broadcaster", "minecade.editor": "Friends tab" },
    });
    this.container = container;
    await container.start();
    this.state = "running";
    this.note(`starting: joins go to the editor lobby (${host}:${port}).`);
    this.stopFollowing = await followLogs(container, (line) => this.feed(line));
    void container.wait().then(
      (result: { StatusCode: number }) => {
        // A stop asked for forgets the container first.
        if (this.container !== container) return;
        this.state = "exited";
        const why = this.log.lastError ? `: ${this.log.lastError}` : "";
        this.note(`the bot stopped (exit code ${result.StatusCode})${why}. Turn the Friends tab off and on again to restart it.`);
      },
      () => {},
    );
  }

  /** Reads its log, and notes what changed: the sign-in it asks for, signed in, live, a join, an error. */
  private feed(line: string): void {
    const before = { ...this.log };
    this.log.feed(line);
    const after = this.log;
    if (after.phase === "sign-in" && after.signIn && after.signIn.code !== before.signIn?.code) {
      this.note(`sign in with the spare account at ${after.signIn.url} with the code ${after.signIn.code}.`);
    } else if (after.phase === "signed-in" && before.phase !== "signed-in") {
      this.note(`signed in as ${after.account}.`);
    } else if (after.phase === "live" && before.phase !== "live") {
      this.note(`live: friends of ${after.account} see "${WORLD_NAME}".`);
    }
    if (after.joins > before.joins) this.note(`relayed ${after.lastJoin}'s join to the editor lobby.`);
    if (after.lastError && after.lastError !== before.lastError) this.note(after.lastError);
  }

  private async remove(): Promise<void> {
    const container = this.container;
    this.container = undefined;
    this.stopFollowing?.();
    this.stopFollowing = undefined;
    this.log = new BroadcastLog();
    if (!container) return;
    const wasRunning = this.state === "running";
    this.state = null;
    await container.stop({ t: STOP_SECONDS }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
    if (wasRunning) this.note("stopped.");
  }
}

/** Builds the bot's image the way docker compose does for the network. */
function buildImage(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["build", "-t", IMAGE, "broadcaster"], { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => (errors = (errors + chunk.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker build failed:\n${errors}`))));
  });
}

// The Docker operations the orchestrator needs, behind an interface so the session logic can be
// tested without Docker. DockerodeAdapter is the real implementation.
import type Docker from "dockerode";
import { attachConsole, connectDocker } from "../../tools/build/docker-util.ts";
import type { LineConsole } from "./links/logstdin-link.ts";

export const LABELS = {
  role: "minecade.role",
  session: "minecade.session",
  game: "minecade.game",
  managedBy: "minecade.managed-by",
} as const;
export const MANAGED_BY = "orchestrator";

export interface GameSpec {
  name: string;
  image: string;
  network: string;
  /** TCP and UDP port, the same number inside and outside the container. */
  port: number;
  env: Record<string, string>;
  labels: Record<string, string>;
  /** Named Docker volumes to mount, as { volume name: path in the container }. */
  volumes: Record<string, string>;
}

export interface ServerHandle {
  readonly id: string;
  /** For a started game: attached before start, and replays its early lines to every new listener. */
  readonly console: LineConsole;
  /** Resolves with the exit code when the container stops. */
  readonly exited: Promise<number>;
  /** Stops the container (5 s grace) and removes it. Safe to call more than once. */
  remove(): Promise<void>;
}

export interface ContainerSummary {
  id: string;
  name: string;
  labels: Record<string, string>;
  running: boolean;
}

export interface DockerAdapter {
  /** Creates, attaches and starts a game server. Removes the container again if starting fails. */
  startGame(spec: GameSpec): Promise<ServerHandle>;
  /** Game containers created by an orchestrator, in any state. */
  listGames(): Promise<ContainerSummary[]>;
  /** The running lobby container of the main stack, if any. */
  findLobby(): Promise<ContainerSummary | undefined>;
  /** Attaches to a running container. Only output from now on is seen. */
  attach(id: string): Promise<ServerHandle>;
  removeContainer(id: string): Promise<void>;
}

/** Lines kept for replay: enough to cover a server's whole startup. */
const REPLAY_LINES = 500;

export class DockerodeAdapter implements DockerAdapter {
  private readonly docker: Docker;
  private readonly composeProject: string;

  constructor(composeProject: string, docker: Docker = connectDocker()) {
    this.composeProject = composeProject;
    this.docker = docker;
  }

  async startGame(spec: GameSpec): Promise<ServerHandle> {
    const tcp = `${spec.port}/tcp`;
    const udp = `${spec.port}/udp`;
    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
      Labels: spec.labels,
      OpenStdin: true,
      StdinOnce: false,
      Tty: false,
      ExposedPorts: { [tcp]: {}, [udp]: {} },
      HostConfig: {
        NetworkMode: spec.network,
        Mounts: Object.entries(spec.volumes).map(([source, target]) => ({ Type: "volume" as const, Source: source, Target: target })),
        // The Engine API takes one entry per port; there are no ranges.
        PortBindings: { [tcp]: [{ HostPort: String(spec.port) }], [udp]: [{ HostPort: String(spec.port) }] },
      },
    });
    try {
      const serverConsole = replaying(await attachConsole(container));
      await container.start();
      return this.handle(container, serverConsole);
    } catch (error) {
      await container.remove({ force: true }).catch(() => {});
      throw error;
    }
  }

  async listGames(): Promise<ContainerSummary[]> {
    const list = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABELS.managedBy}=${MANAGED_BY}`] },
    });
    return list.map(summarize);
  }

  async findLobby(): Promise<ContainerSummary | undefined> {
    const list = await this.docker.listContainers({
      filters: { label: [`${LABELS.role}=lobby`, `com.docker.compose.project=${this.composeProject}`], status: ["running"] },
    });
    return list[0] ? summarize(list[0]) : undefined;
  }

  async attach(id: string): Promise<ServerHandle> {
    const container = this.docker.getContainer(id);
    return this.handle(container, await attachConsole(container));
  }

  async removeContainer(id: string): Promise<void> {
    await removeQuietly(this.docker.getContainer(id));
  }

  private handle(container: Docker.Container, serverConsole: LineConsole): ServerHandle {
    let removal: Promise<void> | undefined;
    return {
      id: container.id,
      console: serverConsole,
      exited: container.wait().then(
        (result: { StatusCode: number }) => result.StatusCode,
        () => -1,
      ),
      remove: () => (removal ??= removeQuietly(container)),
    };
  }
}

async function removeQuietly(container: Docker.Container): Promise<void> {
  await container.stop({ t: 5 }).catch(() => {});
  try {
    await container.remove({ force: true });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  }
}

function summarize(info: Docker.ContainerInfo): ContainerSummary {
  return {
    id: info.Id,
    name: info.Names[0]?.replace(/^\//, "") ?? info.Id,
    labels: info.Labels,
    running: info.State === "running",
  };
}

/**
 * Keeps a server's first lines and replays them to each new listener, so listeners added just
 * after container.start() still see everything since the attach.
 */
function replaying(inner: LineConsole): LineConsole {
  const history: string[] = [];
  const listeners = new Set<(line: string) => void>();
  inner.onLine((line) => {
    if (history.length < REPLAY_LINES) history.push(line);
    for (const listener of listeners) listener(line);
  });
  return {
    send: (line) => inner.send(line),
    onLine(listener) {
      for (const line of history) listener(line);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => inner.close(),
  };
}

// Test doubles for the orchestrator: Docker, server consoles and transport links, plus a
// SessionManager wired to them.
import { vi } from "vitest";
import type { InboundMessage, OutboundEvent } from "@minecade/minigame-core/protocol";
import { loadConfig, type Config } from "../src/config.ts";
import type { ContainerSummary, DockerAdapter, GameSpec, ServerHandle } from "../src/docker.ts";
import type { LineConsole } from "../src/links/logstdin-link.ts";
import type { ServerLink } from "../src/links/server-link.ts";
import type { Registry } from "../src/registry.ts";
import { SessionManager } from "../src/session-manager.ts";
import { NoopWarmPool } from "../src/warm-pool.ts";

export const SERVER_STARTED_LINE = "[2026-10-29 00:47:10:058 INFO] Server started.";

export class FakeConsole implements LineConsole {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Set<(line: string) => void>();

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.closed = true;
  }

  emit(line: string): void {
    for (const cb of [...this.listeners]) cb(line);
  }
}

export class FakeHandle implements ServerHandle {
  readonly id: string;
  readonly console = new FakeConsole();
  readonly exited: Promise<number>;
  readonly remove = vi.fn(async () => {});
  exit!: (code: number) => void;

  constructor(id: string) {
    this.id = id;
    this.exited = new Promise((resolve) => (this.exit = resolve));
  }
}

export class FakeLink implements ServerLink {
  readonly serverId: string;
  readonly kind = "http";
  readonly sent: InboundMessage[] = [];
  closed = false;
  private readonly handlers = new Set<(event: OutboundEvent) => void>();

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  send(message: InboundMessage): boolean {
    if (this.closed) return false;
    this.sent.push(message);
    return true;
  }

  onEvent(handler: (event: OutboundEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: OutboundEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }
}

export class FakeDocker implements DockerAdapter {
  readonly specs: GameSpec[] = [];
  readonly handles: FakeHandle[] = [];
  /** Errors thrown by the next startGame calls, in order. */
  readonly startErrors: Error[] = [];
  games: ContainerSummary[] = [];
  lobby: ContainerSummary | undefined;
  readonly attached = new Map<string, FakeHandle>();
  readonly removeContainer = vi.fn(async (_id: string) => {});

  async startGame(spec: GameSpec): Promise<ServerHandle> {
    this.specs.push(spec);
    const error = this.startErrors.shift();
    if (error) throw error;
    const handle = new FakeHandle(`container-${this.handles.length + 1}`);
    this.handles.push(handle);
    return handle;
  }

  async listGames(): Promise<ContainerSummary[]> {
    return this.games;
  }

  async findLobby(): Promise<ContainerSummary | undefined> {
    return this.lobby;
  }

  async attach(id: string): Promise<ServerHandle> {
    const handle = new FakeHandle(id);
    this.attached.set(id, handle);
    return handle;
  }
}

export const registry: Registry = {
  games: [
    {
      id: "probe",
      name: "Probe",
      minPlayers: 1,
      maxPlayers: 8,
      maps: [
        { id: "default", name: "Default" },
        { id: "other", name: "Other" },
      ],
    },
  ],
};

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ LAN_HOST: "192.168.40.98", LAN_PLAYERS: "Steve" }), ...overrides };
}

export function setupSessions(overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const docker = new FakeDocker();
  const links: FakeLink[] = [];
  const lobby: InboundMessage[] = [];
  const sessions = new SessionManager({
    config,
    registry,
    docker,
    warmPool: new NoopWarmPool(config.sparePort),
    openLink: (serverId) => {
      const link = new FakeLink(serverId);
      links.push(link);
      return link;
    },
    toLobby: (message) => lobby.push(message),
    publicIp: async () => "203.0.113.7",
    newSessionId: () => "s1",
    random: () => 0.99,
  });
  return { config, docker, links, lobby, sessions };
}

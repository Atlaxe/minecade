// The orchestrator's connection to the lobby server. HTTP: a fixed link the lobby polls.
// Log/stdin: attach to the running lobby container, and attach again whenever it restarts.
import type { InboundMessage, OutboundEvent, TransportKind } from "@minecade/minigame-core/protocol";
import type { DockerAdapter } from "./docker.ts";
import type { HttpLinkHub } from "./links/http-link.ts";
import { LogStdinServerLink } from "./links/logstdin-link.ts";
import type { ServerLink } from "./links/server-link.ts";
import { describeError, log } from "./log.ts";

export interface LobbyDeps {
  transport: TransportKind;
  hub: HttpLinkHub;
  docker: DockerAdapter;
  onEvent(event: OutboundEvent): void;
  /** Called whenever a lobby link (re)opens. */
  onConnect(): void;
  scanIntervalMs?: number;
}

export class LobbyChannel {
  private readonly deps: LobbyDeps;
  private link: ServerLink | undefined;
  private scanTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private warnedNoLobby = false;

  constructor(deps: LobbyDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.deps.transport === "http") this.connect(this.deps.hub.open("lobby"));
    else void this.scan();
  }

  send(message: InboundMessage): void {
    if (this.link?.send(message)) return;
    if (!this.warnedNoLobby) log.warn(`no lobby connected; dropping "${message.t}" (further drops are not logged)`);
    this.warnedNoLobby = true;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.scanTimer);
    this.link?.close();
    this.link = undefined;
  }

  private connect(link: ServerLink): void {
    this.link = link;
    this.warnedNoLobby = false;
    link.onEvent((event) => this.deps.onEvent(event));
    this.deps.onConnect();
  }

  private async scan(): Promise<void> {
    if (this.stopped) return;
    if (!this.link) {
      try {
        const lobby = await this.deps.docker.findLobby();
        if (lobby && !this.stopped) {
          const handle = await this.deps.docker.attach(lobby.id);
          const link = new LogStdinServerLink("lobby", handle.console);
          log.info(`attached to the lobby (${lobby.name})`);
          this.connect(link);
          void handle.exited.then(() => {
            if (this.link !== link) return;
            log.info("the lobby stopped; waiting for it to come back");
            link.close();
            this.link = undefined;
          });
        }
      } catch (error) {
        log.warn(`could not attach to the lobby: ${describeError(error)}`);
      }
    }
    this.scanTimer = setTimeout(() => void this.scan(), this.deps.scanIntervalMs ?? 3000);
  }
}

// A pre-warmed spare game server, not built yet. Intended design: keep one container booted on
// the spare port (19134) with the most likely next game, hand it over on start_game so players
// skip the boot wait, then warm the next one. NoopWarmPool keeps the hook and the reserved port.
import type { ServerHandle } from "./docker.ts";

export interface WarmPool {
  readonly port: number;
  /** A ready server for this game and map, or undefined to start one normally. */
  take(game: string, map: string): Promise<ServerHandle | undefined>;
  dispose(): Promise<void>;
}

export class NoopWarmPool implements WarmPool {
  readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  async take(): Promise<ServerHandle | undefined> {
    return undefined;
  }

  async dispose(): Promise<void> {}
}

// Orchestrator settings, read from the environment. docker-compose.yml passes the .env values.
import type { TransportKind } from "@minecade/minigame-core/protocol";

export interface Config {
  transport: TransportKind;
  /** "auto", an IPv4 address or a hostname. */
  publicHost: string;
  lanHost: string;
  /** Passed through to every server as-is (comma-separated gamertags). */
  lanPlayers: string;
  allowList: string;
  devMinPlayers: string;
  serverImage: string;
  /** Docker network shared with the lobby; game containers join it too. */
  network: string;
  /** Compose project of the main stack, used to find the lobby container. */
  composeProject: string;
  /** How servers on the network reach this orchestrator. */
  orchestratorUrl: string;
  httpPort: number;
  lobbyPort: number;
  gamePort: number;
  /** Reserved for the pre-warmed spare server (not used yet). */
  sparePort: number;
  readyTimeoutMs: number;
  emptyBackstopMs: number;
  registryPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const transport = env.TRANSPORT || "http";
  if (transport !== "http" && transport !== "log") throw new Error(`TRANSPORT must be http or log, got "${transport}"`);
  if (!env.LAN_HOST) throw new Error("LAN_HOST is required");
  return {
    transport,
    publicHost: env.PUBLIC_HOST || "auto",
    lanHost: env.LAN_HOST,
    lanPlayers: env.LAN_PLAYERS ?? "",
    allowList: env.ALLOW_LIST ?? "",
    devMinPlayers: env.DEV_MIN_PLAYERS ?? "",
    serverImage: env.SERVER_IMAGE || "minecade/bds:local",
    network: env.NETWORK || "minecade",
    composeProject: env.COMPOSE_PROJECT || "minecade",
    orchestratorUrl: env.ORCH_URL || "http://orchestrator:8080",
    httpPort: integer(env.HTTP_PORT, 8080),
    lobbyPort: integer(env.LOBBY_PORT, 19132),
    gamePort: integer(env.GAME_PORT, 19133),
    sparePort: integer(env.SPARE_PORT, 19134),
    readyTimeoutMs: integer(env.READY_TIMEOUT_S, 120) * 1000,
    emptyBackstopMs: integer(env.EMPTY_BACKSTOP_S, 180) * 1000,
    registryPath: env.REGISTRY_PATH || "/app/registry.json",
  };
}

function integer(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`expected a positive whole number, got "${raw}"`);
  return value;
}

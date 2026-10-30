// Server variables written by the container entrypoint (config/default/variables.json) and
// read through @minecraft/server-admin. Lists and objects arrive as JSON strings.
import { variables } from "@minecraft/server-admin";
import { log } from "./log.ts";
import type { MapConfig } from "./map-config.ts";
import type { ServerRole, TransportKind } from "./protocol/index.ts";

export interface ServerVars {
  serverId: string;
  role: ServerRole;
  game: string;
  map: string;
  /** Empty on the lobby. */
  sessionId: string;
  orchestratorUrl: string;
  transport: TransportKind;
  /** Resolved IPv4 addresses. */
  lanHost: string;
  publicHost: string;
  serverPort: number;
  lobbyPort: number;
  lanPlayers: string[];
  /** Players the lobby sent to this game. */
  expectedPlayers: string[];
  mapConfig: MapConfig;
  /** Overrides every game's minimum player count when set (solo testing). */
  devMinPlayers: number | undefined;
  /** The lobby adds this many made-up games to its menus (menu testing); 0 for none. */
  devDemoGames: number;
  /** The lobby terminal's main menu gets a Preview button for the hologram's screens (layout tuning). */
  devHoloPreview: boolean;
  /** Choices from the lobby's game screen, such as { teams: "random" }. */
  settings: Record<string, string>;
}

export function readServerVars(): ServerVars {
  const devMinPlayers = Number(text("devMinPlayers"));
  const devDemoGames = Number(text("devDemoGames"));
  return {
    serverId: text("serverId"),
    role: text("role") === "lobby" ? "lobby" : "game",
    game: text("game"),
    map: text("map"),
    sessionId: text("sessionId"),
    orchestratorUrl: text("orchestratorUrl"),
    transport: text("transport") === "log" ? "log" : "http",
    lanHost: text("lanHost"),
    publicHost: text("publicHost"),
    serverPort: Number(text("serverPort")) || 19132,
    lobbyPort: Number(text("lobbyPort")) || 19132,
    lanPlayers: json("lanPlayers", []),
    expectedPlayers: json("expectedPlayers", []),
    mapConfig: json("mapConfig", { name: "", spawns: [] }),
    devMinPlayers: Number.isInteger(devMinPlayers) && devMinPlayers > 0 ? devMinPlayers : undefined,
    devDemoGames: Number.isInteger(devDemoGames) && devDemoGames > 0 ? devDemoGames : 0,
    devHoloPreview: ["1", "true", "yes"].includes(text("devHoloPreview").toLowerCase()),
    settings: json("settings", {}),
  };
}

function text(name: string): string {
  const value = variables.get(name);
  return value === undefined || value === null ? "" : String(value);
}

function json<T>(name: string, fallback: T): T {
  const raw = text(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    log.warn(`server variable "${name}" is not valid JSON; using the default`);
    return fallback;
  }
}

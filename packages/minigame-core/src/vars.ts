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
  /** The lobby lists test games (Probe), which it hides otherwise. */
  devTestGames: boolean;
  /** The lobby terminal's main menu gets a Preview button for the hologram's screens (layout tuning). */
  devHoloPreview: boolean;
  /** A game previewed from the map editor: the map's label ("Sumo: Arena"), shown in its mode box; empty otherwise. */
  preview: string;
  /** A preview's fake players to add as it starts (picked before the preview loads); 0 for none. */
  previewFakes: number;
  /**
   * A preview's guests (players outside LAN_PLAYERS, set on the Panel) go home here, the editor
   * lobby's second entrance, since Edit (lobbyPort) is only for map editors; undefined everywhere else.
   */
  guestLobbyPort: number | undefined;
  /** The skin watcher's gamertag (WATCHER_GAMERTAG), which the lobby keeps invisible and out of games; empty when there's none. */
  watcher: string;
  /** Choices from the lobby's game screen, such as { teams: "random" }. */
  settings: Record<string, string>;
  /**
   * Booted ahead while a player looked at the game's screen (AWAIT_START): the settings and the
   * players come later, in the orchestrator's configure, and the match is built then.
   */
  awaitStart: boolean;
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
    devTestGames: ["1", "true", "yes"].includes(text("devTestGames").toLowerCase()),
    devHoloPreview: ["1", "true", "yes"].includes(text("devHoloPreview").toLowerCase()),
    preview: text("preview").trim(),
    previewFakes: Math.max(0, Math.trunc(Number(text("previewFakes")) || 0)),
    guestLobbyPort: Number(text("guestLobbyPort")) || undefined,
    watcher: text("watcher").trim(),
    settings: json("settings", {}),
    awaitStart: ["1", "true", "yes"].includes(text("awaitStart").toLowerCase()),
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

/** Where a player goes home from a game: the lobby, or for a map editor's guest in a preview, the editor lobby. */
export function homePort(vars: Pick<ServerVars, "lobbyPort" | "guestLobbyPort" | "lanPlayers">, name: string): number {
  if (vars.guestLobbyPort === undefined) return vars.lobbyPort;
  const lan = vars.lanPlayers.some((player) => player.toLowerCase() === name.toLowerCase());
  return lan ? vars.lobbyPort : vars.guestLobbyPort;
}

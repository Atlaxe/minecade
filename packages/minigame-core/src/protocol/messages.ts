// Wire protocol between the servers' behavior packs and the orchestrator. Pure TypeScript with
// no runtime imports: bundled into packs by esbuild and imported by the orchestrator under Node.

export const PROTOCOL_VERSION = 3;

/**
 * Upper bound for one encoded message, in either direction and over either transport, so no
 * message depends on which transport carries it. BDS drops scriptevent payloads over 2048
 * chars; the margin covers the command prefix.
 */
export const MAX_MESSAGE_CHARS = 1800;

// Log/stdin transport wire format: the pack writes `[NET] {json}` to the server log, and the
// orchestrator writes `scriptevent minecade:net {json}` to the server console.
export const NET_NAMESPACE = "minecade";
export const NET_SCRIPT_EVENT_ID = "minecade:net";
export const NET_LOG_MARKER = "[NET] ";

export type TransportKind = "http" | "log";
export type ServerRole = "lobby" | "game";
export type SessionState = "idle" | "starting" | "running" | "stopping";
export type EndReason = "finished" | "not_enough_players" | "empty" | "aborted" | "error";

export interface StatusSnapshot {
  state: SessionState;
  sessionId?: string;
  game?: string;
  map?: string;
  players: string[];
}

// ---- Server -> orchestrator ----------------------------------------------------------------

/** First event from every server, sent once its world has loaded. */
export interface ServerReady {
  t: "server_ready";
  protocol: number;
  role: ServerRole;
  transport: TransportKind;
  sessionId?: string;
}

/** The lobby asks for a game. `map` is a map id or "random". */
export interface StartGame {
  t: "start_game";
  requestId: string;
  game: string;
  map: string;
  players: string[];
}

export interface StatusRequest {
  t: "status_request";
}

export interface PlayerCount {
  t: "player_count";
  sessionId: string;
  players: string[];
}

/** One player's line in a finished match. Short keys keep a part under MAX_MESSAGE_CHARS. */
export interface StatsRow {
  /** Gamertag. */
  n: string;
  /** Win, loss or draw. */
  r: "w" | "l" | "d";
  /** Team id, in team games. */
  tm?: string;
  /** Kills and deaths against players. */
  k: number;
  d: number;
  /** Damage dealt to players and taken from anything, in health points. */
  dd: number;
  dt: number;
  /** Seconds in the match. */
  s: number;
  /** Best kill streak. */
  bs: number;
  /** Left before the end. */
  q?: 1;
  /** Game-specific counters, as declared in the game's stats config. */
  x?: Record<string, number>;
}

/**
 * A finished match's stats, possibly split into several parts (each repeats the header) so
 * every part fits the message size limit. matchId + part identifies a part, so a retried
 * send is recorded once.
 */
export interface MatchStats {
  t: "match_stats";
  sessionId: string;
  matchId: string;
  part: number;
  parts: number;
  game: string;
  map: string;
  mode: "solo" | "team" | "coop";
  durationSec: number;
  /** Winning player or team, if any. */
  winner?: string;
  rows: StatsRow[];
}

export interface EndGame {
  t: "end_game";
  sessionId: string;
  reason: EndReason;
}

/** The lobby asks for a player's stats: overall, or for one game. */
export interface StatsQuery {
  t: "stats_query";
  requestId: string;
  player: string;
  game?: string;
}

export type OutboundEvent = ServerReady | StartGame | StatusRequest | PlayerCount | MatchStats | EndGame | StatsQuery;

// ---- Orchestrator -> server ----------------------------------------------------------------

export interface StartRejected {
  t: "start_rejected";
  requestId: string;
  reason: string;
  status: StatusSnapshot;
}

export interface GameStarting {
  t: "game_starting";
  requestId: string;
  sessionId: string;
  game: string;
  map: string;
}

export interface GameReady {
  t: "game_ready";
  requestId: string;
  sessionId: string;
  game: string;
  map: string;
  port: number;
  hosts: { public: string; lan: string };
}

export interface GameFailed {
  t: "game_failed";
  requestId: string;
  sessionId?: string;
  reason: string;
}

export interface GameEnded {
  t: "game_ended";
  sessionId: string;
  reason: string;
}

export interface Status extends StatusSnapshot {
  t: "status";
}

/** Tells a game server to send everyone back to the lobby now (orchestrator shutdown). */
export interface ReturnAll {
  t: "return_all";
  reason: string;
}

/** A player's totals over the matches that count (2+ players, or co-op). */
export interface StatsTotals {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  kills: number;
  deaths: number;
  /** Damage dealt to players and taken from anything, in health points. */
  dealt: number;
  taken: number;
  /** Seconds played. */
  seconds: number;
  bestStreak: number;
  /** Matches left before the end. */
  left: number;
  /** The game's own counters by key, in per-game totals. */
  extras?: Record<string, number>;
}

export interface StatsReply {
  t: "stats_reply";
  requestId: string;
  player: string;
  /** "none": no matches that count yet. "unavailable": stats storage is off or failed. */
  status: "ok" | "none" | "unavailable";
  totals?: StatsTotals;
  /** Only when no game was asked for: the games this player has played, most played first. */
  games?: { id: string; games: number }[];
}

export type InboundMessage = StartRejected | GameStarting | GameReady | GameFailed | GameEnded | Status | ReturnAll | StatsReply;

// ---- Encoding --------------------------------------------------------------------------------

const OUTBOUND_TYPES: ReadonlySet<string> = new Set<OutboundEvent["t"]>([
  "server_ready",
  "start_game",
  "status_request",
  "player_count",
  "match_stats",
  "end_game",
  "stats_query",
]);

const INBOUND_TYPES: ReadonlySet<string> = new Set<InboundMessage["t"]>([
  "start_rejected",
  "game_starting",
  "game_ready",
  "game_failed",
  "game_ended",
  "status",
  "return_all",
  "stats_reply",
]);

export class MessageTooLargeError extends Error {
  readonly length: number;

  constructor(type: string, length: number) {
    super(`message "${type}" is ${length} chars; the limit is ${MAX_MESSAGE_CHARS}`);
    this.name = "MessageTooLargeError";
    this.length = length;
  }
}

/** Serializes a message. Throws MessageTooLargeError if it would not fit every transport. */
export function encodeMessage(message: OutboundEvent | InboundMessage): string {
  const json = JSON.stringify(message);
  if (json.length > MAX_MESSAGE_CHARS) throw new MessageTooLargeError(message.t, json.length);
  return json;
}

// Validation checks the type tag only. Each receiver checks the fields it acts on.
export function isOutboundEvent(value: unknown): value is OutboundEvent {
  return hasType(value, OUTBOUND_TYPES);
}

export function isInboundMessage(value: unknown): value is InboundMessage {
  return hasType(value, INBOUND_TYPES);
}

/** Returns undefined for malformed JSON or an unknown type. */
export function parseOutboundEvent(json: string): OutboundEvent | undefined {
  const value = parseJson(json);
  return isOutboundEvent(value) ? value : undefined;
}

/** Returns undefined for malformed JSON or an unknown type. */
export function parseInboundMessage(json: string): InboundMessage | undefined {
  const value = parseJson(json);
  return isInboundMessage(value) ? value : undefined;
}

function hasType(value: unknown, types: ReadonlySet<string>): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const type = (value as { t?: unknown }).t;
  return typeof type === "string" && types.has(type);
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

// minigame-core for pack scripts. Not loadable under Node (it imports the @minecraft/* script
// modules); game.config.ts files use "@minecade/minigame-core/config" instead. Servers start
// through "@minecade/minigame-core/bootstrap" (the lobby) or "/game" (runGameServer), which pull
// in the transport, so a log-transport bundle never imports @minecraft/server-net.
export * from "./protocol/index.ts";
export * from "./definitions.ts";
export type { Transport, TransportFactory, TransportOptions } from "./transport/transport.ts";
export { describeError, log } from "./log.ts";
export { inBeforeEvent, Scope, type ScopeCounts, type Signal } from "./scope.ts";
export { readServerVars, type ServerVars } from "./vars.ts";
export { TransferService } from "./transfer.ts";
export { showForm } from "./ui.ts";
export { normalizePlayer } from "./player.ts";
export { killDeathRatio, winRate } from "./stats-math.ts";
export {
  Minigame,
  type Down,
  type DownDecision,
  type GameContext,
  type Phase,
  type SpawnReason,
  type Stage,
  type StageResult,
} from "./game/minigame.ts";
export type { Hit } from "./game/combat.ts";
export { aborted, draw, type Result } from "./game/results.ts";
export { Score } from "./game/score.ts";
export { MapView, inside } from "./game/map-view.ts";
export type { Participant, ParticipantState } from "./game/roster.ts";

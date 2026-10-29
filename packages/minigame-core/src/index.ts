// minigame-core public API. The transport implementations are not exported here: each pack
// bundle gets exactly one of them through "#transport" (see tools/build/transport-plugin.ts),
// so a log-transport bundle never imports @minecraft/server-net.
export * from "./protocol/index.ts";
export type { Transport, TransportFactory, TransportOptions } from "./transport/transport.ts";
export { describeError, log } from "./log.ts";

// Log/stdin transport: events go out as "[NET] {json}" lines on the server log, which the
// orchestrator tails, and messages come in as "scriptevent minecade:net {json}" typed into the
// server console. Needs no extra script modules or permissions.
import { ScriptEventSource, system, type ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import {
  encodeMessage,
  HandlerSet,
  NET_LOG_MARKER,
  NET_NAMESPACE,
  NET_SCRIPT_EVENT_ID,
  parseInboundMessage,
  type InboundMessage,
  type TransportKind,
} from "../protocol/index.ts";
import { describeError, log } from "../log.ts";
import type { TransportFactory } from "./transport.ts";

export const kind: TransportKind = "log";

export const createTransport: TransportFactory = () => {
  const handlers = new HandlerSet<InboundMessage>();
  let subscription: ((event: ScriptEventCommandMessageAfterEvent) => void) | undefined;
  let disposed = false;

  const receive = (event: ScriptEventCommandMessageAfterEvent) => {
    if (event.id !== NET_SCRIPT_EVENT_ID) return;
    // Only the server console speaks for the orchestrator, never a player or a command block.
    if (event.sourceType !== ScriptEventSource.Server) {
      log.warn(`Ignoring ${NET_SCRIPT_EVENT_ID} from source ${event.sourceType}`);
      return;
    }
    const message = parseInboundMessage(event.message);
    if (!message) {
      log.warn(`Ignoring malformed orchestrator message: ${event.message.slice(0, 120)}`);
      return;
    }
    handlers.emit(message, (error) => log.error(`Handler for "${message.t}" failed: ${describeError(error)}`));
  };

  return {
    kind,
    send(event) {
      try {
        console.warn(`${NET_LOG_MARKER}${encodeMessage(event)}`);
      } catch (error) {
        log.warn(`Dropped "${event.t}": ${describeError(error)}`);
      }
    },
    onMessage(handler) {
      if (disposed) return () => {};
      subscription ??= system.afterEvents.scriptEventReceive.subscribe(receive, { namespaces: [NET_NAMESPACE] });
      return handlers.add(handler);
    },
    dispose() {
      disposed = true;
      handlers.clear();
      if (subscription) system.afterEvents.scriptEventReceive.unsubscribe(subscription);
      subscription = undefined;
    },
  };
};

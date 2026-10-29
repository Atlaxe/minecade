// The orchestrator's end of a transport: one link per server (the lobby, or a game session).
// Everything above this layer talks to servers through ServerLink and never sees the transport.
import type { InboundMessage, OutboundEvent, TransportKind } from "@minecade/minigame-core/protocol";

export interface ServerLink {
  readonly serverId: string;
  readonly kind: TransportKind;
  /** Queues a message for the server. Returns false if it was dropped (too large, or link closed). */
  send(message: InboundMessage): boolean;
  /** Registers a handler for events from the server. Returns a function that removes it. */
  onEvent(handler: (event: OutboundEvent) => void): () => void;
  close(): void;
}

// The link between a server's behavior pack and the orchestrator. Lobby and game code only see
// this interface. Which implementation runs is decided when the container starts: the build
// bundles every pack once per transport, and the entrypoint loads the bundle for TRANSPORT.
import type { InboundMessage, OutboundEvent, TransportKind } from "../protocol/index.ts";

export interface Transport {
  readonly kind: TransportKind;
  /** Queues an event for the orchestrator. Never throws: an oversized event is logged and dropped. */
  send(event: OutboundEvent): void;
  /** Registers a handler for orchestrator messages. Returns a function that removes it. */
  onMessage(handler: (message: InboundMessage) => void): () => void;
  /** Stops receiving messages. Events already passed to send() are still delivered. */
  dispose(): void;
}

export interface TransportOptions {
  /** This server's id as the orchestrator knows it: "lobby", or the game's session id. */
  serverId: string;
  /** Orchestrator base URL, such as http://orchestrator:8080. Only the HTTP transport uses it. */
  orchestratorUrl: string;
}

export type TransportFactory = (options: TransportOptions) => Transport;

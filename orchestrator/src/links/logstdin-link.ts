// Log/stdin link: reads the "[NET] {json}" lines a pack writes to the BDS log, and answers with
// "scriptevent minecade:net {json}" on the server console's stdin.
import {
  encodeMessage,
  HandlerSet,
  NET_SCRIPT_EVENT_ID,
  parseOutboundEvent,
  type InboundMessage,
  type OutboundEvent,
} from "@minecade/minigame-core/protocol";
import { describeError, log } from "../log.ts";
import type { ServerLink } from "./server-link.ts";

/** The parts of an attached container console this link needs. The link owns it and closes it. */
export interface LineConsole {
  send(line: string): void;
  onLine(cb: (line: string) => void): () => void;
  close(): void;
}

// BDS prints script console output as "[<time> <LEVEL>] [Scripting] <text>". Requiring that
// prefix means "[NET]" anywhere else in the log is never mistaken for a message.
const NET_LINE = /^\[[^\]]*\] \[Scripting\] \[NET\] (.*)$/;

/** Returns the JSON payload of a "[NET]" line, or undefined for any other log line. */
export function extractNetPayload(line: string): string | undefined {
  return NET_LINE.exec(line.trimEnd())?.[1];
}

export class LogStdinServerLink implements ServerLink {
  readonly kind = "log";
  readonly serverId: string;
  private readonly serverConsole: LineConsole;
  private readonly handlers = new HandlerSet<OutboundEvent>();
  private readonly offLine: () => void;
  private closed = false;

  constructor(serverId: string, serverConsole: LineConsole) {
    this.serverId = serverId;
    this.serverConsole = serverConsole;
    this.offLine = serverConsole.onLine((line) => this.receive(line));
  }

  send(message: InboundMessage): boolean {
    if (this.closed) return false;
    let json: string;
    try {
      json = encodeMessage(message);
    } catch (error) {
      log.warn(`${this.serverId}: dropped "${message.t}": ${describeError(error)}`);
      return false;
    }
    // JSON.stringify escapes control characters, so a payload can never spill onto a second
    // console line and run as a separate command.
    this.serverConsole.send(`scriptevent ${NET_SCRIPT_EVENT_ID} ${json}`);
    return true;
  }

  onEvent(handler: (event: OutboundEvent) => void): () => void {
    return this.handlers.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.offLine();
    this.handlers.clear();
    this.serverConsole.close();
  }

  private receive(line: string): void {
    const payload = extractNetPayload(line);
    if (payload === undefined) return;
    const event = parseOutboundEvent(payload);
    if (!event) {
      log.warn(`${this.serverId}: ignoring malformed event: ${payload.slice(0, 120)}`);
      return;
    }
    this.handlers.emit(event, (error) =>
      log.error(`${this.serverId}: handler for "${event.t}" failed: ${describeError(error)}`),
    );
  }
}

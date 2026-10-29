// HTTP link: a pack POSTs events to /v1/servers/<id>/events and long-polls
// /v1/servers/<id>/messages?wait=<seconds> for messages. HttpLinkHub owns these routes for every
// link; the orchestrator's HTTP server offers each request to the hub first.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  encodeMessage,
  HandlerSet,
  parseOutboundEvent,
  type InboundMessage,
  type OutboundEvent,
} from "@minecade/minigame-core/protocol";
import { describeError, log } from "../log.ts";
import type { ServerLink } from "./server-link.ts";

const ROUTE = /^\/v1\/servers\/([^/]+)\/(events|messages)$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_WAIT_SECONDS = 25;
const MAX_QUEUED_MESSAGES = 100;

export class HttpLinkHub {
  private readonly links = new Map<string, HttpServerLink>();

  /** Opens the link for a server, closing any earlier link with the same id. */
  open(serverId: string): HttpServerLink {
    this.links.get(serverId)?.close();
    const link = new HttpServerLink(serverId, () => {
      if (this.links.get(serverId) === link) this.links.delete(serverId);
    });
    this.links.set(serverId, link);
    return link;
  }

  get(serverId: string): HttpServerLink | undefined {
    return this.links.get(serverId);
  }

  /** Handles a link route. Returns false, without touching the response, for any other path. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", "http://orchestrator");
    const match = ROUTE.exec(url.pathname);
    if (!match) return false;
    const [, rawId, route] = match;
    const link = this.links.get(decodeURIComponent(rawId));
    if (!link) {
      // The pack keeps retrying, which covers the moment before a link is opened.
      respondJson(res, 404, { error: "unknown server" });
    } else if (route === "events" && req.method === "POST") {
      receiveEvent(link, req, res);
    } else if (route === "messages" && req.method === "GET") {
      link.poll(res, parseWait(url.searchParams.get("wait")));
    } else {
      respondJson(res, 405, { error: "method not allowed" });
    }
    return true;
  }
}

export class HttpServerLink implements ServerLink {
  readonly kind = "http";
  readonly serverId: string;
  private readonly onClose: () => void;
  private readonly handlers = new HandlerSet<OutboundEvent>();
  private readonly queue: InboundMessage[] = [];
  private waiting: { res: ServerResponse; timer: NodeJS.Timeout } | undefined;
  private closed = false;

  constructor(serverId: string, onClose: () => void) {
    this.serverId = serverId;
    this.onClose = onClose;
  }

  send(message: InboundMessage): boolean {
    if (this.closed) return false;
    try {
      // Same size limit as the log transport, so a message never depends on the transport.
      encodeMessage(message);
    } catch (error) {
      log.warn(`${this.serverId}: dropped "${message.t}": ${describeError(error)}`);
      return false;
    }
    if (this.queue.length >= MAX_QUEUED_MESSAGES) {
      const dropped = this.queue.shift();
      log.warn(`${this.serverId}: message queue full; dropped the oldest "${dropped?.t}"`);
    }
    this.queue.push(message);
    this.release();
    return true;
  }

  onEvent(handler: (event: OutboundEvent) => void): () => void {
    return this.handlers.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.release();
    this.handlers.clear();
    this.onClose();
  }

  /** Delivers one POSTed event. Called by the hub. */
  receive(event: OutboundEvent): void {
    this.handlers.emit(event, (error) =>
      log.error(`${this.serverId}: handler for "${event.t}" failed: ${describeError(error)}`),
    );
  }

  /** Answers now if messages are queued, otherwise holds the poll for up to `waitSeconds`. Called by the hub. */
  poll(res: ServerResponse, waitSeconds: number): void {
    this.release(); // a newer poll replaces an older one
    if (this.queue.length > 0 || waitSeconds <= 0 || this.closed) {
      this.reply(res);
      return;
    }
    const timer = setTimeout(() => this.release(), waitSeconds * 1000);
    this.waiting = { res, timer };
    // If the pack gives up mid-poll, its messages stay queued for the next poll.
    res.on("close", () => {
      if (this.waiting?.res !== res) return;
      clearTimeout(timer);
      this.waiting = undefined;
    });
  }

  /** Answers the waiting poll, if any, with whatever is queued (possibly nothing). */
  private release(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.waiting = undefined;
    this.reply(waiting.res);
  }

  private reply(res: ServerResponse): void {
    if (res.destroyed) return;
    respondJson(res, 200, this.queue.splice(0));
  }
}

function receiveEvent(link: HttpServerLink, req: IncomingMessage, res: ServerResponse): void {
  readBody(req, MAX_BODY_BYTES).then(
    (body) => {
      if (body === undefined) return respondJson(res, 413, { error: "body too large" });
      const event = parseOutboundEvent(body);
      if (!event) return respondJson(res, 400, { error: "not a valid event" });
      // Answer first, so a slow handler never delays the pack's next send.
      res.writeHead(204).end();
      link.receive(event);
    },
    (error: unknown) => {
      log.warn(`${link.serverId}: failed to read event body: ${describeError(error)}`);
      if (!res.headersSent) respondJson(res, 400, { error: "unreadable body" });
    },
  );
}

/** Resolves with the body, or undefined once it passes `limit` bytes (the rest is discarded). */
function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size <= limit ? Buffer.concat(chunks).toString("utf8") : undefined));
    req.on("error", reject);
  });
}

function parseWait(raw: string | null): number {
  const seconds = Number(raw ?? 0);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MAX_WAIT_SECONDS) : 0;
}

function respondJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

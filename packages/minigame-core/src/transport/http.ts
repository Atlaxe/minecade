// HTTP transport over @minecraft/server-net. Events are POSTed one at a time, in order, and
// retried with backoff while the orchestrator is unreachable. Messages arrive through a
// long-poll. Needs the server-net manifest dependency and the permissions.json entry that the
// container entrypoint writes for TRANSPORT=http.
import { system } from "@minecraft/server";
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";
import {
  encodeMessage,
  HandlerSet,
  isInboundMessage,
  type InboundMessage,
  type TransportKind,
} from "../protocol/index.ts";
import { describeError, log } from "../log.ts";
import type { TransportFactory } from "./transport.ts";

export const kind: TransportKind = "http";

const POLL_WAIT_SECONDS = 20;
const POLL_TIMEOUT_SECONDS = POLL_WAIT_SECONDS + 5;
const SEND_TIMEOUT_SECONDS = 10;
const MAX_QUEUED_EVENTS = 100;
/** Retry delays: 1 s doubling to a 10 s cap. */
const BACKOFF_TICKS = [20, 40, 80, 160, 200];
/** A run of failures is logged on the first and every Nth retry, not on every retry. */
const LOG_EVERY_N_FAILURES = 10;

interface QueuedEvent {
  t: string;
  json: string;
}

type PostOutcome = { result: "sent" } | { result: "rejected" | "retry"; detail: string };

export const createTransport: TransportFactory = ({ serverId, orchestratorUrl }) => {
  const base = `${orchestratorUrl.replace(/\/+$/, "")}/v1/servers/${encodeURIComponent(serverId)}`;
  const handlers = new HandlerSet<InboundMessage>();
  const queue: QueuedEvent[] = [];
  /** The event being sent or waiting to be retried. It stays at queue[0] until it is done. */
  let current: QueuedEvent | undefined;
  let polling = false;
  let disposed = false;

  async function pump(): Promise<void> {
    if (current) return;
    let failures = 0;
    try {
      while (queue.length > 0) {
        current = queue[0];
        const outcome = await post(current.json);
        if (outcome.result === "retry") {
          noteFailure("send", ++failures, outcome.detail);
          await system.waitTicks(backoffTicks(failures));
          continue;
        }
        if (outcome.result === "rejected") log.warn(`Orchestrator rejected "${current.t}": ${outcome.detail}`);
        if (failures > 0) log.info(`Orchestrator reachable again after ${failures} failed sends`);
        failures = 0;
        queue.shift();
      }
    } finally {
      current = undefined;
    }
  }

  async function post(json: string): Promise<PostOutcome> {
    const request = new HttpRequest(`${base}/events`);
    request.method = HttpRequestMethod.Post;
    request.body = json;
    request.headers = [new HttpHeader("Content-Type", "application/json")];
    request.timeout = SEND_TIMEOUT_SECONDS;
    try {
      const response = await http.request(request);
      if (response.status >= 200 && response.status < 300) return { result: "sent" };
      // 400 and 413 will never succeed. Anything else (404 while the orchestrator starts, 5xx) may.
      const detail = `HTTP ${response.status}`;
      return { result: response.status === 400 || response.status === 413 ? "rejected" : "retry", detail };
    } catch (error) {
      return { result: "retry", detail: describeError(error) };
    }
  }

  async function poll(): Promise<void> {
    let failures = 0;
    while (!disposed) {
      let detail: string;
      try {
        const request = new HttpRequest(`${base}/messages?wait=${POLL_WAIT_SECONDS}`);
        request.method = HttpRequestMethod.Get;
        request.timeout = POLL_TIMEOUT_SECONDS;
        const response = await http.request(request);
        if (disposed) return;
        if (response.status === 200) {
          if (failures > 0) log.info(`Orchestrator reachable again after ${failures} failed polls`);
          failures = 0;
          deliver(response.body);
          continue;
        }
        detail = `HTTP ${response.status}`;
      } catch (error) {
        if (disposed) return;
        detail = describeError(error);
      }
      noteFailure("poll", ++failures, detail);
      await system.waitTicks(backoffTicks(failures));
    }
  }

  function deliver(body: string): void {
    let messages: unknown;
    try {
      messages = JSON.parse(body);
    } catch {
      log.warn(`Ignoring malformed poll response: ${body.slice(0, 120)}`);
      return;
    }
    if (!Array.isArray(messages)) {
      log.warn(`Ignoring poll response that is not an array: ${body.slice(0, 120)}`);
      return;
    }
    for (const message of messages) {
      if (!isInboundMessage(message)) {
        log.warn(`Ignoring malformed orchestrator message: ${JSON.stringify(message).slice(0, 120)}`);
        continue;
      }
      handlers.emit(message, (error) => log.error(`Handler for "${message.t}" failed: ${describeError(error)}`));
    }
  }

  return {
    kind,
    send(event) {
      let json: string;
      try {
        json = encodeMessage(event);
      } catch (error) {
        log.warn(`Dropped "${event.t}": ${describeError(error)}`);
        return;
      }
      if (queue.length >= MAX_QUEUED_EVENTS) {
        // Drop the oldest event that is not already on its way.
        const [dropped] = queue.splice(queue[0] === current ? 1 : 0, 1);
        log.warn(`Send queue full; dropped the oldest waiting event "${dropped.t}"`);
      }
      queue.push({ t: event.t, json });
      void pump();
    },
    onMessage(handler) {
      if (disposed) return () => {};
      if (!polling) {
        polling = true;
        void poll();
      }
      return handlers.add(handler);
    },
    dispose() {
      // An in-flight poll is left to finish and its result ignored. http.cancelAll() would also
      // cancel pending sends, such as a final end_game.
      disposed = true;
      handlers.clear();
    },
  };
};

function backoffTicks(failures: number): number {
  return BACKOFF_TICKS[Math.min(failures, BACKOFF_TICKS.length) - 1];
}

function noteFailure(what: "send" | "poll", failures: number, detail: string): void {
  if (failures === 1 || failures % LOG_EVERY_N_FAILURES === 0) {
    log.warn(`Orchestrator ${what} failed (${failures} in a row): ${detail}`);
  }
}

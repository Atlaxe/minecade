// A game's link to the prompt bank, the orchestrator's prompts.db (see prompts.ts and the
// orchestrator's prompts/store.ts): it sends what players wrote, asks for prompts to deal, and says
// which of the bank's it dealt. A preview has no orchestrator, and a bank that's off answers with
// nothing, so a game deals from its own list whenever the bank's prompts don't come.
import { cleanPrompt, type DealablePrompt } from "../prompts.ts";
import type { BankPrompt, InboundMessage, PromptKind } from "../protocol/index.ts";
import type { Scope } from "../scope.ts";
import type { GameContext } from "./minigame.ts";

export class PromptBank {
  private readonly ctx: GameContext;
  private readonly game: string;
  private requestId: string | undefined;
  private requests = 0;
  private readonly parts = new Map<number, BankPrompt[]>();
  private expectedParts = 0;

  /** Listens for the bank's replies until `scope` is disposed. */
  constructor(ctx: GameContext, scope: Scope, game: string) {
    this.ctx = ctx;
    this.game = game;
    scope.add(ctx.transport.onMessage((message) => this.received(message)));
  }

  /** What `by` wrote, cleaned up (empty prompts left out), for the bank. */
  submit(by: string, prompts: { kind: PromptKind; text: string }[]): void {
    const clean = prompts.map((prompt) => ({ kind: prompt.kind, text: cleanPrompt(prompt.text) })).filter((prompt) => prompt.text !== "");
    if (clean.length === 0) return;
    this.ctx.transport.send({ t: "prompt_submit", sessionId: this.ctx.vars.sessionId, game: this.game, by: by.toLowerCase(), prompts: clean });
  }

  /** Asks for up to this many prompts of each kind; a new request replaces one still waiting. */
  request(counts: Partial<Record<PromptKind, number>>): void {
    this.requests++;
    this.requestId = `${this.ctx.vars.sessionId}.prompts.${this.requests}`;
    this.parts.clear();
    this.expectedParts = 0;
    this.ctx.transport.send({ t: "prompt_request", requestId: this.requestId, sessionId: this.ctx.vars.sessionId, counts });
  }

  /** True once every part of the reply to the last request is in. */
  get answered(): boolean {
    return this.expectedParts > 0 && this.parts.size >= this.expectedParts;
  }

  /** The bank's prompts of a kind that have come so far, in the bank's order; fresh ones (never dealt) say so. */
  prompts(kind: PromptKind): DealablePrompt[] {
    return [...this.parts.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([, list]) => list)
      .filter((prompt) => prompt.k === kind)
      .map((prompt) => ({ text: cleanPrompt(prompt.x), by: String(prompt.by ?? "").toLowerCase(), id: prompt.id, fresh: prompt.u === 0 }));
  }

  /** The bank's prompts a game dealt (its own list's have no id), counted so the less used come up first. */
  used(prompts: readonly DealablePrompt[]): void {
    const ids = prompts.flatMap((prompt) => (prompt.id === undefined ? [] : [prompt.id]));
    if (ids.length > 0) this.ctx.transport.send({ t: "prompt_used", sessionId: this.ctx.vars.sessionId, ids });
  }

  private received(message: InboundMessage): void {
    if (message.t !== "prompt_reply" || message.requestId !== this.requestId || !Array.isArray(message.prompts)) return;
    this.expectedParts = Math.max(1, Number(message.parts) || 1);
    this.parts.set(Number(message.part) || 1, message.prompts.filter((prompt) => typeof prompt?.x === "string"));
  }
}

// The viewer page's side of changing a map: each edit shows at once (applied here with the same
// code the Panel and game Edit use), then goes to the Panel in order (POST /api/viewer/edit), which
// makes it (through game Edit when it has the map open) and answers with the map as it is; the
// last answer is what the page keeps. Undo and redo are the Panel's (or game Edit's) history, and
// Save and Publish are its too. A change to map.json made elsewhere comes in through the event
// stream; while edits are under way it waits, and the map is read again once they're done.
import { MapEditError, applyEdit, type MapConfig, type MapEdit } from "@minecade/minigame-core/config";

export interface ChangeHandlers {
  /** The map as it is now (after an edit here, an answer, or a change made elsewhere). */
  config(config: MapConfig): void;
  /** Something to tell the person: a refusal (bad), or a note. */
  message(text: string, bad?: boolean): void;
  /** What undo and redo would do now. */
  labels(undo?: string, redo?: string): void;
}

interface Answer {
  config?: MapConfig;
  stamp?: string;
  undo?: string;
  redo?: string;
  note?: string;
  message?: string;
  error?: string;
}

export class MapChangesClient {
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;
  /** map.json's stamps the Panel wrote for this page: their change events are this page's own. */
  private readonly own = new Set<string>();
  /** A change made elsewhere came in while edits were under way. */
  private missed = false;

  constructor(
    private readonly target: string,
    private readonly map: string,
    private readonly handlers: ChangeHandlers,
  ) {}

  /** Applies an edit here at once and sends it; the map after it, or undefined when it doesn't fit. */
  edit(config: MapConfig, edit: MapEdit): MapConfig | undefined {
    let next: MapConfig;
    try {
      next = applyEdit(config, edit);
    } catch (error) {
      if (error instanceof MapEditError) {
        this.handlers.message(error.message, true);
        return undefined;
      }
      throw error;
    }
    this.handlers.config(next);
    this.send("edit", { edit });
    return next;
  }

  undo(): void {
    this.send("undo", {});
  }

  redo(): void {
    this.send("redo", {});
  }

  /** Save or Publish; the answer's message is shown. */
  async act(action: "save" | "publish"): Promise<boolean> {
    await this.chain;
    const answer = await this.post(action, {});
    if (answer.error) this.handlers.message(answer.error, true);
    else if (answer.message) this.handlers.message(answer.message);
    if (answer.config && this.inFlight === 0) this.handlers.config(answer.config);
    return !answer.error;
  }

  /** A change to map.json the event stream brought: shown unless it's this page's own, or edits are under way. */
  external(stamp: string, config: MapConfig): void {
    if (this.inFlight > 0) {
      this.missed = true;
      return;
    }
    if (this.own.has(stamp)) return;
    this.handlers.config(config);
  }

  /** Whether edits are on their way to the Panel. */
  get busy(): boolean {
    return this.inFlight > 0;
  }

  private send(action: "edit" | "undo" | "redo", body: Record<string, unknown>): void {
    this.inFlight++;
    this.chain = this.chain
      .then(async () => {
        const answer = await this.post(action, body);
        if (answer.stamp) this.own.add(answer.stamp);
        if (answer.error) this.handlers.message(answer.error, true);
        else if (answer.note) this.handlers.message(answer.note);
        // The last answer is the map as it is; an earlier one would undo edits shown since.
        if (answer.config && this.inFlight === 1) this.handlers.config(answer.config);
        if (answer.config) this.handlers.labels(answer.undo, answer.redo);
      })
      .finally(() => {
        this.inFlight--;
        if (this.inFlight === 0 && this.missed) {
          this.missed = false;
          void this.reload();
        }
      });
  }

  /** Reads the map again (after a change made elsewhere came in during edits). */
  private async reload(): Promise<void> {
    const query = `target=${encodeURIComponent(this.target)}&map=${encodeURIComponent(this.map)}&configOnly=1`;
    const response = await fetch(`/api/viewer/map?${query}`).catch(() => undefined);
    if (!response?.ok) return;
    const answer = (await response.json()) as { config: MapConfig; stamp: string };
    if (this.inFlight === 0) this.handlers.config(answer.config);
  }

  private async post(action: string, body: Record<string, unknown>): Promise<Answer> {
    try {
      const response = await fetch(`/api/viewer/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-minecade-panel": "1" },
        body: JSON.stringify({ target: this.target, map: this.map, ...body }),
      });
      const answer = (await response.json().catch(() => ({}))) as Answer;
      return response.ok ? answer : { ...answer, error: answer.error ?? `HTTP ${response.status}` };
    } catch {
      return { error: "The Panel didn't answer: is it still running?" };
    }
  }
}

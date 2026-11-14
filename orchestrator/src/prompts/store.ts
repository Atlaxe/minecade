// The prompt bank: prompts players wrote before their matches (Build Swap's and Guess the Build's
// prompt forms), kept in node:sqlite under DATA_DIR (prompts.db, beside stats.db) for later matches
// of any game that deals prompts (those two now, Pictionary later). Each kind keeps at most
// KEEP_PER_KIND prompts, the oldest going first. A prompt is never dealt in the match (session) it was
// written in, only later (the user's ask, 2026-11-13). A request gets two piles of each kind: fresh
// prompts no match has had yet, in a random order, and prompts played before, the least used first;
// the game deals from them at even odds. Nobody is ever dealt their own: replies say who wrote each
// prompt, and the game deals around it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cleanPrompt, promptKey, promptReplyParts } from "@minecade/minigame-core/config";
import type { BankPrompt, InboundMessage, PromptKind, PromptRequest, PromptSubmit, PromptUsed } from "@minecade/minigame-core/protocol";

/** Per kind: 500 starters and 500 twists, 1,000 in all. */
export const KEEP_PER_KIND = 500;
/** The most prompts of a kind one request gets in each pile (fresh, and played before). */
const MAX_PER_REQUEST = 40;
export const PROMPT_KINDS: readonly PromptKind[] = ["starter", "twist"];

// Each entry upgrades the schema by one version (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    key TEXT NOT NULL,
    author TEXT NOT NULL,
    game TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER
  );
  CREATE UNIQUE INDEX prompts_by_key ON prompts (kind, key);
  `,
  // The session (match) a prompt was written in: it isn't dealt there.
  `ALTER TABLE prompts ADD COLUMN session TEXT;`,
];

export interface StoredPrompt {
  id: number;
  kind: PromptKind;
  text: string;
  /** Lowercase gamertag. */
  author: string;
  game: string;
  createdAt: number;
  uses: number;
}

export interface PromptStoreOptions {
  now?: () => number;
  random?: () => number;
}

export class PromptStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly random: () => number;

  /** Opens (or creates) prompts.db in `dir`. */
  static open(dir: string): PromptStore {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, "prompts.db"));
    try {
      db.exec("PRAGMA journal_mode = WAL");
      return new PromptStore(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Brings the schema up to date. Throws for a database from a newer orchestrator. */
  constructor(db: DatabaseSync, options: PromptStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.migrate();
  }

  /**
   * Adds a prompt, cleaned up (color codes out, at most PROMPT_MAX_CHARS), written in `session` (it
   * isn't dealt there). One that says the same as a prompt already kept is a duplicate, and the first
   * writer stays its author. Past KEEP_PER_KIND, the oldest of the kind goes.
   */
  add(kind: PromptKind, text: string, author: string, game: string, session?: string): "stored" | "duplicate" | "empty" {
    const clean = cleanPrompt(text);
    if (!clean) return "empty";
    const result = this.db
      .prepare("INSERT OR IGNORE INTO prompts (kind, text, key, author, game, created_at, session) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(kind, clean, promptKey(clean), author.toLowerCase(), game, this.now(), session ?? null);
    if (Number(result.changes) === 0) return "duplicate";
    this.db
      .prepare("DELETE FROM prompts WHERE kind = ? AND id NOT IN (SELECT id FROM prompts WHERE kind = ? ORDER BY id DESC LIMIT ?)")
      .run(kind, kind, KEEP_PER_KIND);
    return "stored";
  }

  /**
   * Prompts of a kind to deal, never one written in `session`: up to `count` fresh ones (never dealt)
   * in a random order, then up to `count` played before, the least used first and in a random order
   * among the equally used. Each says how often it's been dealt (u).
   */
  pick(kind: PromptKind, count: number, session?: string): BankPrompt[] {
    const wanted = Math.max(0, Math.min(MAX_PER_REQUEST, Math.floor(count)));
    if (wanted === 0) return [];
    const rows = this.db
      .prepare("SELECT id, text, author, uses FROM prompts WHERE kind = ? AND session IS NOT ?")
      .all(kind, session ?? null) as { id: number; text: string; author: string; uses: number }[];
    const shuffled = rows.map((row) => ({ row, order: this.random() }));
    shuffled.sort((a, b) => a.row.uses - b.row.uses || a.order - b.order);
    const fresh = shuffled.filter(({ row }) => row.uses === 0).slice(0, wanted);
    const played = shuffled.filter(({ row }) => row.uses > 0).slice(0, wanted);
    return [...fresh, ...played].map(({ row }) => ({ id: row.id, k: kind, x: row.text, by: row.author, u: row.uses }));
  }

  /** Counts a deal of each prompt, so it comes up after the less used ones. */
  markUsed(ids: readonly number[]): void {
    const update = this.db.prepare("UPDATE prompts SET uses = uses + 1, last_used = ? WHERE id = ?");
    const now = this.now();
    for (const id of ids) if (Number.isInteger(id)) update.run(now, id);
  }

  /** Every prompt, newest first (for a look at what's in the bank). */
  list(kind?: PromptKind): StoredPrompt[] {
    const rows = this.db
      .prepare("SELECT id, kind, text, author, game, created_at AS createdAt, uses FROM prompts WHERE (:kind IS NULL OR kind = :kind) ORDER BY id DESC")
      .all({ kind: kind ?? null }) as unknown as StoredPrompt[];
    return rows.map((row) => ({ ...row }));
  }

  count(kind?: PromptKind): number {
    return (this.db.prepare("SELECT count(*) AS n FROM prompts WHERE (:kind IS NULL OR kind = :kind)").get({ kind: kind ?? null }) as { n: number }).n;
  }

  /** Takes a prompt out of the bank. False when there was none with that id. */
  remove(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM prompts WHERE id = ?").run(id).changes) > 0;
  }

  get schemaVersion(): number {
    return (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = this.schemaVersion;
    if (version > MIGRATIONS.length) {
      throw new Error(`prompts.db has schema version ${version}, newer than this orchestrator knows (${MIGRATIONS.length})`);
    }
    for (let next = version; next < MIGRATIONS.length; next++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[next]);
        this.db.exec(`PRAGMA user_version = ${next + 1}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}

/**
 * A game's prompt message, answered: submissions go into the bank, a request gets the bank's prompts
 * (in parts; with no bank, an empty reply, so the game deals its own at once), and deals are counted.
 */
export function promptEvent(store: PromptStore | undefined, event: PromptSubmit | PromptRequest | PromptUsed, game: string): InboundMessage[] {
  switch (event.t) {
    case "prompt_submit": {
      if (!store || typeof event.by !== "string" || !Array.isArray(event.prompts)) return [];
      for (const prompt of event.prompts) {
        if (prompt && PROMPT_KINDS.includes(prompt.kind) && typeof prompt.text === "string") store.add(prompt.kind, prompt.text, event.by, game, String(event.sessionId));
      }
      return [];
    }
    case "prompt_request": {
      const requestId = String(event.requestId);
      const counts = typeof event.counts === "object" && event.counts !== null ? event.counts : {};
      const prompts = store ? PROMPT_KINDS.flatMap((kind) => store.pick(kind, Number(counts[kind] ?? 0) || 0, String(event.sessionId))) : [];
      return promptReplyParts(requestId, prompts);
    }
    case "prompt_used":
      if (store && Array.isArray(event.ids)) store.markUsed(event.ids.map(Number));
      return [];
  }
}

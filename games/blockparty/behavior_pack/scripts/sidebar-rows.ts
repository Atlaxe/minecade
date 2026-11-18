// Block Party's one sidebar (docs/plans/block-party-ui.md, "How the HUD gets its data"): everything
// everyone sees alike rides the scoreboard sidebar under the core's GAME_SIDEBAR_MARK (the core pack
// hides the vanilla sidebar for it), and the game's pack draws it. The dialogue box (dialogue.ts),
// the player cards, the board menu, the item panel and the results (screens.ts) each hand their part
// here, and this puts them on one sidebar:
//   - the title: the mark, each screen's word that's up (screen-codes.ts), then the dialogue box's
//     part (its codes, then §r and the speaker's name, which is what shows);
//   - the rows: the dialogue box's first, then the cards, the round, the menu, the item panel, the
//     results, each part's rows in its own order. Each kind of row has its own codes, so each screen
//     picks out its own rows.
// While the item panel is up (a die or an item to pick), the dialogue box makes way: neither its
// title part nor its rows go on (the user, 2026-11-18), and it comes back as the panel goes.
// The client shows only the top 15 rows (by score), so the parts are budgeted in that order and what
// doesn't fit is left out (and logged). Bedrock can't rename an objective, so a new title is a new
// objective with every row on it again.
import { GAME_SIDEBAR_MARK, Sidebar, describeError, log, type Scope } from "@minecade/minigame-core";

/** Most rows the client shows. */
export const MAX_ROWS = 15;

/** The parts, in the order their rows go (the first gets the top rows). */
export const PARTS = ["dialogue", "cards", "round", "menu", "panel", "results"] as const;
export type PartId = (typeof PARTS)[number];

export interface SidebarPart {
  /** What the part adds to the title: codes (never shown), and for the dialogue box its "§r" and the name. */
  title: string;
  rows: readonly string[];
}

/** The sidebar's title and rows (top first) for these parts. */
export function compose(given: Partial<Record<PartId, SidebarPart>>): { title: string; rows: string[]; dropped: number } {
  // The dialogue box makes way for the item panel.
  const parts: Partial<Record<PartId, SidebarPart>> = given.panel ? { ...given, dialogue: undefined } : given;
  // The dialogue's part goes last in the title: its speaker's name is the title's only text. A part's
  // title may start with the mark already (the dialogue box's boxTitle does): it's there once.
  const own = (id: PartId) => {
    const text = parts[id]?.title ?? "";
    return text.startsWith(GAME_SIDEBAR_MARK) ? text.slice(GAME_SIDEBAR_MARK.length) : text;
  };
  const title = GAME_SIDEBAR_MARK + PARTS.filter((id) => id !== "dialogue").map(own).join("") + own("dialogue");
  const rows: string[] = [];
  let dropped = 0;
  for (const id of PARTS) {
    for (const row of parts[id]?.rows ?? []) {
      // Two rows the same would be one participant: the second is left out, as one too many would be.
      if (rows.length >= MAX_ROWS || rows.includes(row)) dropped++;
      else rows.push(row);
    }
  }
  return { title, rows, dropped };
}

export class GameSidebar {
  private readonly scope: Scope;
  private readonly parts: Partial<Record<PartId, SidebarPart>> = {};
  private shown: { scope: Scope; sidebar: Sidebar; title: string } | undefined;
  private serial = 0;
  private pending = false;
  private warned = false;

  constructor(scope: Scope) {
    this.scope = scope;
    scope.add(() => this.hide());
  }

  /**
   * A part's title codes and rows (undefined: the part is gone). Drawn once the code running now is
   * done (a promise's turn, still this tick), so parts set together are drawn together.
   */
  set(id: PartId, part: SidebarPart | undefined): void {
    if (part) this.parts[id] = part;
    else delete this.parts[id];
    if (this.pending || this.scope.disposed) return;
    this.pending = true;
    void Promise.resolve().then(() => {
      if (!this.pending) return;
      this.pending = false;
      this.draw();
    });
  }

  /** Draws it now (a part that must be on screen this tick). */
  flush(): void {
    this.pending = false;
    this.draw();
  }

  private draw(): void {
    if (this.scope.disposed) return;
    const { title, rows, dropped } = compose(this.parts);
    if (dropped > 0 && !this.warned) {
      this.warned = true;
      log.warn(`blockparty: the sidebar had ${dropped} row${dropped === 1 ? "" : "s"} too many (the client shows ${MAX_ROWS})`);
    }
    try {
      if (title === GAME_SIDEBAR_MARK && rows.length === 0) {
        this.hide();
        return;
      }
      if (!this.shown || this.shown.title !== title) {
        const old = this.shown;
        const scope = this.scope.child(`sidebar ${++this.serial}`);
        this.shown = { scope, sidebar: new Sidebar(scope, `bp_screens_${this.serial}`, title), title };
        old?.scope.dispose();
      }
      this.shown.sidebar.show(rows.map((row, i): [string, number] => [row, rows.length - i]));
    } catch (error) {
      log.warn(`blockparty: drawing the sidebar failed: ${describeError(error)}`);
    }
  }

  private hide(): void {
    const shown = this.shown;
    this.shown = undefined;
    try {
      shown?.scope.dispose();
    } catch (error) {
      log.warn(`blockparty: the sidebar didn't go: ${describeError(error)}`);
    }
  }
}

// The Kill Y tool. Players below kill Y are out. On a game's map it also sets the build limit, one
// side at a time: no blocks above one height, none below another. A use sets the one picked in its
// screen at once (kill Y one block below your feet, a build limit at your feet; no tool opens a menu
// where it's aimed). With the tool picked, the map menu opens its screen: tiles for kill Y and the
// build limit's sides, then type a height or nudge it, with its plane drawn there (outlines.ts), and
// Set saves it; and it removes it.
import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { BuildLimitSide } from "@minecade/minigame-core";
import { showHeight } from "./box-picker.ts";
import { MAX_HEIGHT, MIN_HEIGHT, parseHeight } from "./boxes.ts";
import { blockPosition } from "./lists.ts";
import { sideTitle } from "./marks.ts";
import { HEIGHT_LINES, NUDGE_STEPS, killYScreenEntries } from "./menu.ts";
import type { HeightLine } from "./regions.ts";
import type { ToolHost } from "./tool-host.ts";

/** A build limit can be one block over the world's top (nothing above it then). */
const MAX_LIMIT = MAX_HEIGHT + 1;

export class KillYTool {
  private readonly host: ToolHost;
  /** What a use sets, by lowercased gamertag: the line last picked in the screen. */
  private readonly lines = new Map<string, HeightLine>();

  constructor(host: ToolHost) {
    this.host = host;
  }

  /** Puts the tool in hand, for the checklist's Kill Y and build limit rows, set to that line. */
  equip(player: Player, line: HeightLine = "killY"): void {
    this.lines.set(key(player), line);
    this.host.equip(player, "killY");
    if (line === "killY") this.host.tell(player, "Kill Y tool: use it to set the height players are out below to one block below your feet; fine-tune it in the map menu. While you hold it, the plane shows in red.");
    else this.host.tell(player, `Kill Y tool, set to the build limit ${line}: use it to put it at your feet (no blocks ${line} it); fine-tune it in the map menu. While you hold it, the planes show in orange.`);
  }

  /** A use: the line picked in the screen, at once (Undo takes it back). */
  use(player: Player): void {
    const line = this.lineOf(player);
    this.set(player, line, start(player, line));
  }

  /** The screen: what it sets (on a game's map), the height (typed or nudged, the plane drawn there), Remove, and Set at the bottom. */
  async screen(player: Player, line?: HeightLine, back?: () => Promise<void>): Promise<void> {
    if (line) this.lines.set(key(player), line);
    let current = this.lineOf(player);
    let y = this.heightOf(current) ?? start(player, current);
    let step: number = NUDGE_STEPS[0];
    try {
      for (;;) {
        showHeight(player, { line: current, y });
        const set = this.heightOf(current) !== undefined;
        const entries = killYScreenEntries({ line: current, buildLimit: this.buildLimit(), y, set, step, back: back !== undefined });
        const form = new ActionFormData().title(sideTitle("Kill Y"));
        for (const entry of entries) form.button(entry.text, entry.icon);
        const response = await this.host.show(player, form);
        const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
        if (!action || !player.isValid) return;
        if (action.kind === "back") return back?.();
        if (action.kind === "save") return this.set(player, current, y);
        if (action.kind === "remove") return this.remove(player, current);
        if (action.kind === "line") {
          current = action.line;
          this.lines.set(key(player), current);
          y = this.heightOf(current) ?? start(player, current);
        } else if (action.kind === "type") y = (await this.typeHeight(player, current, y)) ?? y;
        else if (action.kind === "height") y = Math.min(maxOf(current), Math.max(MIN_HEIGHT, y + action.by * step));
        else if (action.kind === "step") step = action.step;
      }
    } finally {
      showHeight(player, undefined);
    }
  }

  /** The action bar line while the tool is held: what a use does. */
  hint(player: Player): string {
    const line = this.lineOf(player);
    const now = this.heightOf(line);
    const at = start(player, line);
    const does = line === "killY" ? `set kill Y to ${at}, one below your feet` : `set the build limit ${line} to ${at}, at your feet`;
    return `Use: ${does}   Now: ${now === undefined ? "not set" : now}`;
  }

  /** Removes kill Y (from the map menu), or a side of the build limit. */
  remove(player: Player, line: HeightLine = "killY"): void {
    const name = nameOf(line);
    if (this.heightOf(line) === undefined) this.host.tell(player, `This map has no ${name}.`);
    else if (line === "killY") this.host.edit(player, { op: "killY" }, "Kill Y removed.");
    else this.host.edit(player, { op: "buildLimit", side: line }, `${capitalized(name)} removed.`);
  }

  /** The line a use sets: the one picked last, or kill Y (always kill Y on a lobby map). */
  private lineOf(player: Player): HeightLine {
    const line = this.lines.get(key(player)) ?? "killY";
    return this.buildLimit() ? line : "killY";
  }

  /** Whether the build limit is offered: on a game's map. */
  private buildLimit(): boolean {
    return this.host.rules.kind === "game";
  }

  private heightOf(line: HeightLine): number | undefined {
    const map = this.host.map();
    return line === "killY" ? map.killY : map.buildLimit?.[line];
  }

  /** A height typed into a side form; undefined (and why) when it isn't one. */
  private async typeHeight(player: Player, line: HeightLine, start: number): Promise<number | undefined> {
    const max = maxOf(line);
    const form = new ModalFormData()
      .title(sideTitle("Kill Y"))
      .textField(`Height (a whole number from ${MIN_HEIGHT} to ${max})`, String(start), { defaultValue: String(start) })
      .submitButton("Done");
    const response = await this.host.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const y = parseHeight(String(response.formValues[0] ?? ""), max);
    if (y === undefined) this.host.tell(player, `§c${capitalized(nameOf(line))} must be a whole number from ${MIN_HEIGHT} to ${max}.`);
    return y;
  }

  private set(player: Player, line: HeightLine, y: number): void {
    const name = capitalized(nameOf(line));
    if (this.heightOf(line) === y) return this.host.tell(player, `${name} is already ${y}.`);
    if (line === "killY") {
      this.host.edit(player, { op: "killY", y }, `Kill Y set to ${y}.`);
      return;
    }
    const other: BuildLimitSide = line === "above" ? "below" : "above";
    const otherY = this.heightOf(other);
    if (otherY !== undefined && (line === "above" ? y <= otherY : y >= otherY)) {
      this.host.tell(player, `§c${name} must be ${line === "above" ? "over" : "under"} the build limit ${other} (${otherY}), or nothing can be built.`);
      return;
    }
    this.host.edit(player, { op: "buildLimit", side: line, y }, `${name} set to ${y}.`);
  }
}

/** Where a use puts a line: kill Y one block below the player's feet, a build limit at them. */
function start(player: Player, line: HeightLine): number {
  const feet = blockPosition(player.location)[1];
  return line === "killY" ? feet - 1 : feet;
}

function maxOf(line: HeightLine): number {
  return line === "killY" ? MAX_HEIGHT : MAX_LIMIT;
}

/** "kill Y", "build limit above". */
function nameOf(line: HeightLine): string {
  return line === "killY" ? "kill Y" : (HEIGHT_LINES.find((candidate) => candidate.line === line)?.name ?? "build limit").toLowerCase();
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function key(player: Player): string {
  return player.name.toLowerCase();
}

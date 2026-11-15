// The Spaces tool: a board's spaces, for a game whose config has map.board (Block Party's boards;
// minigame-core's board kit, docs/plans/block-party.md "Board maps"). Spaces are chained by
// clicking:
//   - A use on a block places a space there (on the block's middle), linked from the player's
//     previous space (the one placed or picked last), and dealt its type (the one furthest under its
//     share that breaks no placement rule there; the first space is Start). It becomes the previous.
//   - Hitting a space opens its screen: its type, Lock (Deal again leaves it alone), Star candidate,
//     Opening spot, Make it the previous (the next space placed links from it: from a space that
//     already leads somewhere, that starts a branch), Link the previous here (closes the loop,
//     rejoins a shortcut), a button per link to take it away, and Delete.
//   - The map menu's settings for the tool: Deal again (every unlocked space), Board check (the
//     report in chat, as /boardcheck), and every space (tap one for its screen).
// Spaces are markers in their type's color; while the tool is out, dots show each link with an
// arrowhead at the space it leads to, and a ring of dots marks the player's previous space.
import { world, type Player, type Vector3 } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  checkBoard,
  dealAgain,
  drawDots,
  outlineColor,
  reportLines,
  retypeSpaces,
  spacesOf,
  typeForNewSpace,
  worldPoint,
  type BoardConfig,
  type BoardSpace,
  type MapConfig,
  type Scope,
} from "@minecade/minigame-core";
import { MARKER_KINDS, MARKER_STYLES, type MarkerShape } from "./lists.ts";
import { dangerText, headingText, sideTitle, switchText } from "./marks.ts";
import { BACK_TEXT, ICONS, type MenuEntry } from "./menu.ts";
import { actionBar, heldTool, type ToolHost } from "./tool-host.ts";

/** A space's marker: the MarkerShape the editor draws, with the space's id. */
export interface SpaceMarker extends MarkerShape {
  space: number;
}

/** Ticks between drawings of the links (the dots last about a second). */
const ARROW_TICKS = 10;
/** Links further than this from a player aren't drawn for them. */
const ARROW_REACH = 48;
/** Blocks between dots along a link, and the most dots one player gets a drawing. */
const DOT_SPACING = 0.5;
const DOT_BUDGET = 400;
const DOT_SIZE = 0.12;
/** How high over a space's floor its links run. */
const LINK_HEIGHT = 0.35;
const LINK_COLOR = outlineColor(0xffffff);
const PREVIOUS_COLOR = outlineColor(0x7cf06c);

type SpaceAction =
  | { kind: "back" }
  | { kind: "type" }
  | { kind: "flag"; flag: "locked" | "star" | "opening" }
  | { kind: "previous" }
  | { kind: "linkHere" }
  | { kind: "unlink"; to: number }
  | { kind: "delete" };

export class SpacesTool {
  /** Each player's previous space (the next placed links from it), by lowercased gamertag. */
  private readonly previous = new Map<string, number>();

  constructor(
    scope: Scope,
    private readonly host: ToolHost,
    /** Where a use of a placing tool aims (the editor's own aim: on top of a block, or the floor in front of its side). */
    private readonly aim: (player: Player) => Vector3 | undefined,
  ) {
    scope.interval(() => this.drawLinks(), ARROW_TICKS);
  }

  /** The game's board, if its maps have spaces. */
  get board(): BoardConfig | undefined {
    return this.host.rules.requires?.board;
  }

  private spaces(): BoardSpace[] {
    return spacesOf(this.host.map());
  }

  /** The player's previous space, while it's still on the map. */
  previousOf(player: Player): number | undefined {
    const id = this.previous.get(player.name.toLowerCase());
    return id !== undefined && this.spaces().some((space) => space.id === id) ? id : undefined;
  }

  private typeName(type: string | undefined): string {
    return this.board?.types.find((candidate) => candidate.id === type)?.name ?? type ?? "no type";
  }

  /** The action bar line while the tool is held. */
  hint(player: Player): string {
    if (!this.board) return "This map's game has no board";
    const previous = this.previousOf(player);
    return previous === undefined ? "Use: place a space   Hit a space: its screen" : `Use: place a space after space ${previous}   Hit a space: its screen`;
  }

  /** A use: a space where the player aims, after their previous one, its type dealt. */
  use(player: Player): void {
    const board = this.board;
    if (!board) return this.host.tell(player, "This map's game has no board.");
    const aimed = this.aim(player);
    if (!aimed) return actionBar(player, "Aim at a block to place a space");
    const at: [number, number, number] = [Math.floor(aimed.x), Math.round(aimed.y), Math.floor(aimed.z)];
    const spaces = this.spaces();
    if (spaces.some((space) => Math.floor(space.at[0]) === at[0] && Math.floor(space.at[2]) === at[2] && Math.abs(space.at[1] - at[1]) < 2)) return actionBar(player, "There's a space on that block already: hit it for its screen");
    const from = spaces.length === 0 ? undefined : this.previousOf(player);
    const type = typeForNewSpace(spaces, at, board, from);
    const id = spaces.reduce((most, space) => Math.max(most, space.id), 0) + 1;
    if (this.host.edit(player, { op: "addSpace", at, type, ...(from === undefined ? {} : { from }) }, `Space ${id}: ${this.typeName(type)}${from === undefined ? "" : `, after space ${from}`}`)) {
      this.previous.set(player.name.toLowerCase(), id);
    }
  }

  /** Every space's marker, in its type's color. */
  markers(config: MapConfig): SpaceMarker[] {
    const types = new Map((this.board?.types ?? []).map((type) => [type.id, type]));
    return spacesOf(config).map((space) => {
      const flags = [space.star ? (space.opening ? "Star candidate, opening spot" : "Star candidate") : "", space.locked ? "locked" : ""].filter(Boolean).join(", ");
      const type = types.get(space.type ?? "");
      return {
        key: `space:${space.id}`,
        space: space.id,
        label: `Space ${space.id}: ${type?.name ?? "no type"}${flags ? `\n§7${flags}` : ""}`,
        at: worldPoint(space.at),
        kind: MARKER_KINDS.points,
        style: MARKER_STYLES.post,
        ...(type ? { tint: type.color } : {}),
      };
    });
  }

  /** The map menu's settings for the tool: Deal again, Board check, then every space. */
  settings(): MenuEntry[] {
    const spaces = this.spaces();
    return [
      { action: { kind: "dealAgain" }, text: switchText("Deal again", "new types for every unlocked space", false) },
      { action: { kind: "boardCheck" }, text: switchText("Board check", "the board's errors and warnings, in chat", false) },
      { action: { kind: "none" }, text: headingText(spaces.length > 0 ? `Spaces (${spaces.length})` : "No spaces yet") },
      ...spaces.map((space): MenuEntry => ({ action: { kind: "space", id: space.id }, text: `Space ${space.id}: ${this.typeName(space.type)}\n§7${space.at.slice(0, 3).join(", ")}` })),
    ];
  }

  /** A space's screen (it was hit, or picked in the map menu, which `back` opens again). */
  async menu(player: Player, id: number, back?: () => Promise<void>): Promise<void> {
    const board = this.board;
    if (!board) return;
    for (;;) {
      const space = this.spaces().find((candidate) => candidate.id === id);
      if (!space || !player.isValid) return;
      const previous = this.previousOf(player);
      const entries: { action: SpaceAction; text: string; icon?: string }[] = back ? [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }] : [];
      entries.push({ action: { kind: "type" }, text: `Type: ${this.typeName(space.type)}\n§7pick another` });
      entries.push({ action: { kind: "flag", flag: "locked" }, text: switchText("Lock", "Deal again leaves it alone", space.locked === true) });
      entries.push({ action: { kind: "flag", flag: "star" }, text: switchText("Star candidate", "the Star can be here", space.star === true) });
      if (space.star) entries.push({ action: { kind: "flag", flag: "opening" }, text: switchText("Opening spot", "the first Star can be here", space.opening === true) });
      entries.push({ action: { kind: "previous" }, text: previous === id ? "The previous space\n§7the next one placed links from it" : "Make it the previous\n§7the next space placed links from it" });
      if (previous !== undefined && previous !== id && !this.spaces().find((candidate) => candidate.id === previous)?.next?.includes(id)) {
        entries.push({ action: { kind: "linkHere" }, text: `Link space ${previous} here\n§7closes a loop, rejoins a shortcut` });
      }
      for (const to of space.next ?? []) entries.push({ action: { kind: "unlink", to }, text: `Leads to space ${to}\n§7tap to take the link away` });
      entries.push({ action: { kind: "delete" }, text: dangerText("Delete space") });
      const form = new ActionFormData().title(sideTitle(`Space ${id}`));
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await this.host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      switch (action.kind) {
        case "back":
          return back?.();
        case "type": {
          const type = await this.pickType(player, board, space.type);
          if (type && type !== space.type) this.host.edit(player, { op: "setSpace", id, type }, `Space ${id}: ${this.typeName(type)}`);
          break;
        }
        case "flag":
          this.host.edit(player, { op: "setSpace", id, [action.flag]: !(space[action.flag] === true) });
          break;
        case "previous":
          this.previous.set(player.name.toLowerCase(), id);
          actionBar(player, `Space ${id} is your previous space`);
          return;
        case "linkHere":
          if (previous !== undefined) this.host.edit(player, { op: "linkSpace", from: previous, to: id }, `Space ${previous} leads to space ${id}`);
          break;
        case "unlink":
          this.host.edit(player, { op: "unlinkSpace", from: id, to: action.to }, `Space ${id} no longer leads to space ${action.to}`);
          break;
        case "delete":
          this.host.edit(player, { op: "removeSpace", id }, `Space ${id} deleted`);
          return back?.();
      }
    }
  }

  private async pickType(player: Player, board: BoardConfig, now: string | undefined): Promise<string | undefined> {
    const form = new ActionFormData().title(sideTitle("Type"));
    for (const type of board.types) form.button(type.id === now ? `${type.name}\n§7now` : type.name);
    const response = await this.host.show(player, form);
    return response?.selection === undefined ? undefined : board.types[response.selection]?.id;
  }

  /** Deal again: every unlocked space other than Start, the try with the fewest warnings. */
  dealAgain(player: Player): void {
    const board = this.board;
    if (!board) return this.host.tell(player, "This map's game has no board.");
    const spaces = this.spaces();
    const types = dealAgain(spaces, board);
    const count = Object.keys(types).length;
    if (count === 0) return this.host.tell(player, "Dealt again: no space changed.");
    const warnings = checkBoard(retypeSpaces(spaces, types), board).warnings.length;
    this.host.edit(player, { op: "retypeSpaces", types }, `Dealt again: ${count} space${count === 1 ? "" : "s"} changed, ${warnings} warning${warnings === 1 ? "" : "s"} left`);
  }

  /** The board check in chat (/boardcheck): errors, warnings, then the counts and the routes. */
  check(player: Player): void {
    const board = this.board;
    if (!board) return this.host.tell(player, "This map's game has no board.");
    const spaces = this.spaces();
    if (spaces.length === 0) return this.host.tell(player, "Board check: no spaces yet. Place them with the Spaces tool.");
    const where = (id: number) => {
      const space = spaces.find((candidate) => candidate.id === id);
      return space ? `space ${id} at ${space.at.slice(0, 3).join(", ")}` : `space ${id}`;
    };
    this.host.tell(player, "Board check:");
    for (const line of reportLines(checkBoard(spaces, board), where)) player.sendMessage(`§7${line}`);
  }

  /** Dots along each link, with an arrowhead, for everyone holding the tool; a ring at their previous space. */
  private drawLinks(): void {
    if (!this.board) return;
    const spaces = this.spaces();
    if (spaces.length === 0) return;
    const at = new Map(spaces.map((space) => [space.id, worldPoint(space.at)]));
    for (const player of world.getAllPlayers()) {
      if (heldTool(player) !== "spaces") continue;
      const eye = player.location;
      const near = (point: Vector3) => Math.hypot(point.x - eye.x, point.z - eye.z) < ARROW_REACH;
      const dots: { x: number; y: number; z: number; size: number }[] = [];
      for (const space of spaces) {
        const from = at.get(space.id)!;
        for (const id of space.next ?? []) {
          const to = at.get(id);
          if (!to || (!near(from) && !near(to))) continue;
          dots.push(...linkDots(from, to));
          if (dots.length > DOT_BUDGET) break;
        }
      }
      drawDots(player, dots.slice(0, DOT_BUDGET), LINK_COLOR);
      const previous = this.previousOf(player);
      const ring = previous === undefined ? undefined : at.get(previous);
      if (ring && near(ring)) drawDots(player, ringDots(ring), PREVIOUS_COLOR);
    }
  }
}

/** Dots from one space toward another, stopping short of it, with an arrowhead there. */
export function linkDots(from: Vector3, to: Vector3): { x: number; y: number; z: number; size: number }[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1.5) return [];
  const ux = dx / length;
  const uz = dz / length;
  const start = 0.9;
  const end = length - 0.9;
  const dots: { x: number; y: number; z: number; size: number }[] = [];
  const y = (t: number) => from.y + (to.y - from.y) * (t / length) + LINK_HEIGHT;
  for (let t = start; t <= end; t += DOT_SPACING) dots.push({ x: from.x + ux * t, y: y(t), z: from.z + uz * t, size: DOT_SIZE });
  // The arrowhead: two short strokes back from the tip, 35 degrees either side.
  const tip = { x: from.x + ux * end, z: from.z + uz * end };
  for (const side of [-1, 1]) {
    const angle = Math.atan2(uz, ux) + Math.PI + side * 0.6;
    for (let k = 1; k <= 3; k++) dots.push({ x: tip.x + Math.cos(angle) * k * 0.25, y: y(end), z: tip.z + Math.sin(angle) * k * 0.25, size: DOT_SIZE });
  }
  return dots;
}

/** A ring of dots around a space: the player's previous one. */
function ringDots(at: Vector3): { x: number; y: number; z: number; size: number }[] {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return { x: at.x + Math.cos(angle) * 1.2, y: at.y + LINK_HEIGHT, z: at.z + Math.sin(angle) * 1.2, size: DOT_SIZE };
  });
}

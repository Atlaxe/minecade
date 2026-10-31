// The marks the editor's resource pack reads (resource_pack/ui/editor_forms.json): formatting codes
// that never render, at the start of a form's title (which layout it gets) or of a button's text
// (how that button is drawn, and where). Each must match the pack's UI files (a test checks).

/** Title marks: the layout a form gets. */
export const LAYOUT = {
  /** A dark panel down the right side: the title, the X, then the body and buttons scrolling. */
  side: "§s§i§d§e",
  /** The map menu: the quick icons, the tool grid, the tool's settings (scrolling) and Save. */
  map: "§m§a§p",
} as const;

/** Button marks. */
export const MARK = {
  /** A switch: drawn with an on or off picture on the right. */
  toggle: "§t§g§r",
  /** Added to a switch while it's on, and to the tool in hand in the map menu's grid. */
  on: "§o§n§r",
  /** The checklist pill in the map menu's quick row: its icon and the first line of its text. */
  pill: "§q§p§r",
  /** A square icon in the map menu's quick row. */
  quick: "§q§i§r",
  /** A tool's square icon in the map menu's grid (with one of COLUMNS). */
  tool: "§t§l§r",
  /** Plain text between buttons, such as "Place into". */
  heading: "§h§d§r",
  /** Red, with white text: deleting or removing something. */
  danger: "§d§g§r",
  /** The option in use among several, outlined (the spawn tool's list). */
  picked: "§p§k§r",
  /** A quick icon with nothing to do now (Undo with nothing to undo). */
  dim: "§d§m§r",
  /** The map menu's green Save bar, under the scrolling settings. */
  save: "§s§v§r",
} as const;

/** The tool grid's columns, left to right: tool n goes in column n % COLUMNS.length. */
export const COLUMNS = ["§c§0§r", "§c§1§r", "§c§2§r", "§c§3§r", "§c§4§r"] as const;

/** A title that gets the side layout. */
export function sideTitle(title: string): string {
  return `${LAYOUT.side}§r${title}`;
}

/** A title that gets the map menu's layout. */
export function mapTitle(title: string): string {
  return `${LAYOUT.map}§r${title}`;
}

/** A switch's button text: the name, and a hint under it. */
export function switchText(label: string, hint: string, on: boolean): string {
  return `${MARK.toggle}${on ? MARK.on : ""}${label}\n§7${hint}`;
}

/** A red button's text. */
export function dangerText(text: string): string {
  return `${MARK.danger}${text}`;
}

/** Plain text between buttons. */
export function headingText(text: string): string {
  return `${MARK.heading}${text}`;
}

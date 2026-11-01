// The marks the editor's resource pack reads (resource_pack/ui/editor_forms.json): formatting codes
// that never render, at the start of a form's title (which layout it gets) or of a button's text
// (how that button is drawn, and where). Each must match the pack's UI files (a test checks).

/** Title marks: the layout a form gets. */
export const LAYOUT = {
  /** A dark panel down the right side: the title, the X, then the body and buttons scrolling. */
  side: "§s§i§d§e",
  /** The map menu: the quick icons, the tool grid, the tool's settings (scrolling) and Save. */
  map: "§m§a§p",
  /** The editor lobby's menu: a row of icons (New map, Players, Leave), then Recent and the map cards scrolling. */
  home: "§h§o§m§e",
  /** A row of icons (with their tooltips), the list scrolling, and a button pinned at the bottom (Back to Lobby). */
  icons: "§i§c§o§n",
} as const;

/** Added to a side layout's title: five dots after it light up one at a time, while something loads. */
export const LOADING = "§l§o§a§d";

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
  /** A square icon at the right end of the editor lobby's icon row (Leave). */
  end: "§q§e§r",
  /** A full-width button with its icon on the left and its text beside it (Select's maps from this world). */
  card: "§i§c§r",
  /** Green, with white text: the step that finishes something (Export to Map, Nudge, Edit). */
  go: "§g§o§r",
  /** Pinned under the scrolling list, so it's always at the bottom (Back to Lobby). */
  bottom: "§b§t§r",
  /** A nudge row: the minus button with the side's name and how far it moved beside it. */
  minus: "§s§m§r",
  /** A nudge row's plus button, on the right. */
  plus: "§s§p§r",
  /** Taller, showing both lines (a card's status); other buttons show their first line, the second in a tooltip. */
  twoLine: "§t§w§r",
  /** Before the nudge rows, after the toggle (a tool screen's position and facing). */
  lead: "§l§d§r",
  /** A toggle's tile (with one of SEGMENT_COLUMNS): tiles touch, and the one that's on is green. */
  segment: "§s§g§r",
  /** A toggle's tile showing its icon (and its text as a tooltip) instead of its text. */
  iconOnly: "§i§o§r",
  /** A link: aqua text with no face (Help). */
  link: "§h§l§r",
  /** Stays put above the scrolling list (Export's Name and Map id). */
  fixed: "§f§x§r",
  /** A tile of the Step toggle, right before the nudge rows (with one of SEGMENT_COLUMNS). */
  stepTile: "§s§t§r",
  /** The back arrow left of the title, opposite the X: back to the menu this one came from. */
  back: "§b§c§r",
  /** A wider toggle tile, for a toggle of two (with segment). */
  wide: "§w§d§r",
  /** A card's title, on the left of its row (the editor lobby's maps): plain, not a button. */
  cardTitle: "§c§t§r",
  /** One of a card's icons, right of its title (with one of CARD_COLUMNS); faded with dim. */
  cardIcon: "§c§n§r",
  /** The heading over the cards, on the left of its row (Recent). */
  cardHead: "§c§h§r",
  /** A link with an icon at the right of the cards' heading (Search). */
  cardLink: "§s§c§r",
  /** A picture tile (with one of SEGMENT_COLUMNS' first two): the picture, its name under it, and a green outline while on. */
  picture: "§p§c§r",
} as const;

/** A card's icon columns, left to right: a card has one icon in each. */
export const CARD_COLUMNS = ["§v§0§r", "§v§1§r", "§v§2§r"] as const;

/** A toggle's columns: tile n goes in column n % 3, so the tiles fill rows of three. */
export const SEGMENT_COLUMNS = ["§g§0§r", "§g§1§r", "§g§2§r"] as const;

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

/** A title that gets the editor lobby's layout. */
export function homeTitle(title: string): string {
  return `${LAYOUT.home}§r${title}`;
}

/** A title that gets the icon row layout. */
export function iconsTitle(title: string): string {
  return `${LAYOUT.icons}§r${title}`;
}

/** A green button's text. */
export function goText(text: string): string {
  return `${MARK.go}${text}`;
}

/** A picture tile `index` (two to a row), outlined green while `on` (the picture in use). */
export function pictureText(text: string, index: number, on: boolean): string {
  return `${MARK.picture}${SEGMENT_COLUMNS[index % 2]}${on ? MARK.on : ""}${text}`;
}

/** A card's title. */
export function cardTitleText(text: string): string {
  return `${MARK.cardTitle}${text}`;
}

/** A card's icon in column `index`, faded (its step isn't done) unless `on`. */
export function cardIconText(text: string, index: number, on: boolean): string {
  return `${MARK.cardIcon}${CARD_COLUMNS[index]}${on ? "" : MARK.dim}${text}`;
}

/** A side layout's title with the loading dots after it. */
export function loadingTitle(title: string): string {
  return `${LAYOUT.side}${LOADING}§r${title}`;
}

/** A switch's button text: the name, and a hint under it. */
export function switchText(label: string, hint: string, on: boolean): string {
  return `${MARK.toggle}${on ? MARK.on : ""}${label}\n§7${hint}`;
}

/** A red button's text. */
export function dangerText(text: string): string {
  return `${MARK.danger}${text}`;
}

/** A toggle's tile `index`, green while `on`. */
export function segmentText(text: string, index: number, on: boolean, iconOnly = false, wide = false): string {
  return `${MARK.segment}${SEGMENT_COLUMNS[index % SEGMENT_COLUMNS.length]}${iconOnly ? MARK.iconOnly : ""}${wide ? MARK.wide : ""}${on ? MARK.on : ""}${text}`;
}

/** A Step toggle tile `index`, green while `on`. */
export function stepTileText(text: string, index: number, on: boolean): string {
  return `${MARK.stepTile}${SEGMENT_COLUMNS[index % SEGMENT_COLUMNS.length]}${on ? MARK.on : ""}${text}`;
}

/** A link's text: aqua. */
export function linkText(text: string): string {
  return `${MARK.link}§b${text}`;
}

/** The green button pinned at the bottom: what saves a tool screen. */
export function saveBarText(text: string): string {
  return `${MARK.bottom}${MARK.go}${text}`;
}

/** Plain text between buttons. */
export function headingText(text: string): string {
  return `${MARK.heading}${text}`;
}

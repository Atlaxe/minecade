// What the map menu, the checklist and the editor lobby's form offer, as plain data: the editor
// turns these into forms. The map menu has its own layout (resource_pack/ui/editor_forms.json,
// picked by LAYOUT.map): the quick icons (the checklist pill, Undo, Redo, Map settings), the tool
// grid, the picked tool's settings (scrolling) and a green Save bar. So does the editor lobby's
// menu (LAYOUT.home): a row of icons, then what's open and Recent as cards with an icon each. Each
// button's mark (marks.ts) says where it goes.
import {
  QUEUE_COUNTDOWN,
  listOf,
  openKey,
  positionText,
  queueSettings,
  type Box,
  type Facing,
  type Catalog,
  type Checklist,
  type ChecklistRow,
  type GuestInfo,
  type HomeState,
  type MapCamera,
  type MapConfig,
  type PictureInfo,
  type RecentEntry,
  type SelectionInfo,
  type ServerInfo,
} from "@minecade/minigame-core/config";
import { relativeSide, sizeText, type Cardinal, type Sides } from "./boxes.ts";
import { SNAPS, compass, type Snap, type SpawnList } from "./lists.ts";
import { COLUMNS, MARK, cardIconText, cardTitleText, dangerText, goText, headingText, linkText, pictureText, saveBarText, segmentText, stepTileText, switchText } from "./marks.ts";
import { CAMERA_KINDS, cameraPlace, camerasOf, type CameraKind } from "./cameras.ts";
import { ALL_BOUNDARIES, outlineShown, type BoundaryRow, type RegionEntry, type RegionTarget, type SelectionAction } from "./regions.ts";
import { EDITOR_TOOLS, SELECT_TOOL, type ToolId } from "./tools.ts";

/** The quick icons' pictures (editor/resource_pack/textures/minecade/editor/). */
export const ICONS = {
  check: "textures/minecade/editor/icon_check",
  checkDone: "textures/minecade/editor/icon_check_done",
  undo: "textures/minecade/editor/icon_undo",
  redo: "textures/minecade/editor/icon_redo",
  settings: "textures/minecade/editor/icon_settings",
  play: "textures/minecade/editor/icon_play",
  boundaries: "textures/minecade/editor/icon_boundaries",
  /** The editor lobby: a pencil (Edit a map), a plus (New map), a crop mark (Select its world), and Leave. */
  edit: "textures/minecade/editor/icon_edit",
  new: "textures/minecade/editor/icon_new",
  select: "textures/minecade/editor/icon_select",
  leave: "textures/minecade/editor/icon_leave",
  /** Players (every icon row), a nudge row's minus (its plus is `new`), Back to Lobby (a house), and the back arrow. */
  players: "textures/minecade/editor/icon_players",
  minus: "textures/minecade/editor/icon_minus",
  lobby: "textures/minecade/editor/icon_lobby",
  back: "textures/minecade/editor/icon_back",
  /** The editor lobby's Search link (a magnifying glass). */
  search: "textures/minecade/editor/icon_search",
} as const;

/** Where the editor's pack keeps the pictures (tools/editor/pictures.ts): a shot used before, a map's preview, a game's picture. */
export function shotTexture(id: string): string {
  return `textures/minecade/shots/${id}`;
}

export function mapPictureTexture(target: string, map: string): string {
  return `textures/minecade/maps/${target}/${map}`;
}

export function gamePictureTexture(target: string): string {
  return `textures/minecade/games/${target}`;
}

export type MenuAction =
  | { kind: "checklist" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "settings" }
  /** The Boundaries view: a switch per boundary, to see it whatever you hold. */
  | { kind: "boundaries" }
  /** Play the map as its game (Preview), then come back. */
  | { kind: "preview" }
  | { kind: "tool"; tool: ToolId }
  /** A heading: nothing happens but the menu opening again. */
  | { kind: "none" }
  /** The picked tool's how-to, in chat. */
  | { kind: "help" }
  /** The spawn tool: an entry's screen, by "<list key>#<index>". */
  | { kind: "entry"; key: string }
  | { kind: "selection"; action: SelectionAction }
  | { kind: "box"; key: string }
  /** The Kill Y tool's screen. */
  | { kind: "killY" }
  | { kind: "removeKillY" }
  /** The camera tool: the kind of new cameras, and a camera's form. */
  | { kind: "cameraKind" }
  | { kind: "camera"; name: string }
  /** The Snapshot tool: look through a camera to take its picture. */
  | { kind: "snapshot"; name: string }
  | { kind: "save" }
  /** Select mode: something to do with the selection. */
  | { kind: "pick"; action: PickAction }
  /** Select mode: a map from this world (its own menu). */
  | { kind: "map"; target: string; map: string }
  /** Go to the editor lobby, to open another map or world. */
  | { kind: "lobby" }
  /** The Players menu: invite friends to Select and previews. */
  | { kind: "players" };

/** What Select mode's selection offers. */
export type PickAction = "saveMap" | "nudge" | "back" | "clear";

export interface MenuEntry {
  action: MenuAction;
  text: string;
  /** A picture for the quick icons and the tool grid. */
  icon?: string;
}

/** The spawn tool's settings, as a map editor last picked them. */
export interface SpawnSettings {
  list: string;
  /** Whole blocks (the middle of the block), not exactly where the player aims. */
  center: boolean;
  keepFacing: boolean;
  snap: Snap;
}

export interface MapMenuView {
  config: MapConfig;
  checklist: Checklist;
  /** The game's name, for Preview; none for a lobby map (which can't be previewed yet). */
  game?: string;
  /** The tool this player has out, if any. */
  tool?: ToolId;
  /** What undo and redo would change, when there is something to undo or redo. */
  undo?: string;
  redo?: string;
  /** Blocks changed since the world was last saved. */
  unsaved: boolean;
  saving: boolean;
  /** For the spawn tool's settings. */
  spawn: { lists: SpawnList[]; settings: SpawnSettings };
  /** For the region tool's settings: the player's selection, and the map's boxes. */
  region: { selection?: { box: Box; editing?: string; steps: number }; entries: RegionEntry[] };
  /** For the camera tool's settings: the kind new cameras get. */
  camera?: { kind: CameraKind };
}

/** The map menu's buttons: the quick icons, the tools, the picked tool's settings, then Save. */
export function mapMenuEntries(view: MapMenuView): MenuEntry[] {
  const { done, total } = progress(view.checklist);
  const entries: MenuEntry[] = [
    {
      action: { kind: "checklist" },
      text: `${MARK.pill}${done}/${total}\n§7Checklist: ${view.checklist.ready && view.config.draft === true ? "ready to publish" : problemCount(view.checklist)}`,
      icon: view.checklist.ready ? ICONS.checkDone : ICONS.check,
    },
    { action: { kind: "undo" }, text: `${MARK.quick}${view.undo ? "" : MARK.dim}Undo\n§7${view.undo ?? "nothing to undo"}`, icon: ICONS.undo },
    { action: { kind: "redo" }, text: `${MARK.quick}${view.redo ? "" : MARK.dim}Redo\n§7${view.redo ?? "nothing to redo"}`, icon: ICONS.redo },
    { action: { kind: "boundaries" }, text: `${MARK.quick}Boundaries\n§7see the bounds and regions you pick`, icon: ICONS.boundaries },
  ];
  if (view.game) {
    const ready = view.checklist.ready;
    entries.push({ action: { kind: "preview" }, text: `${MARK.quick}${ready ? "" : MARK.dim}Preview\n§7${ready ? `play it as ${view.game}, then come back` : "finish the checklist first"}`, icon: ICONS.play });
  }
  entries.push({ action: { kind: "settings" }, text: `${MARK.quick}Map settings\n§7name, game settings, build commands`, icon: ICONS.settings });
  EDITOR_TOOLS.forEach((tool, i) => {
    const picked = tool.id === view.tool ? MARK.on : "";
    entries.push({ action: { kind: "tool", tool: tool.id }, text: `${MARK.tool}${COLUMNS[i % COLUMNS.length]}${picked}${tool.label}\n§7${tool.hint}`, icon: tool.icon });
  });
  // How to use the tool is a link: it goes to chat.
  if (view.tool) entries.push({ action: { kind: "help" }, text: linkText("Help") });
  if (view.tool === "spawn") entries.push(...spawnSettings(view.config, view.spawn.lists));
  else if (view.tool === "region") entries.push(...regionSettings(view.region.selection, view.region.entries));
  else if (view.tool === "killY") entries.push(...killYSettings(view.config.killY));
  else if (view.tool === "camera") entries.push(...cameraSettings(view.config, view.camera?.kind ?? "map"));
  else if (view.tool === "snapshot") entries.push(...snapshotSettings(view.config));
  entries.push({ action: { kind: "save" }, text: `${MARK.save}${saveText(view)}` });
  return entries;
}

/** The camera tool's settings: the kind of new cameras, then the map's cameras (tap one for its form). */
export function cameraSettings(config: MapConfig, kind: CameraKind): MenuEntry[] {
  const cameras = camerasOf(config);
  return [
    { action: { kind: "none" }, text: headingText("New cameras") },
    { action: { kind: "cameraKind" }, text: switchText("Game picture", kind === "game" ? CAMERA_KINDS.game.hint : `off: a map preview, ${CAMERA_KINDS.map.hint.split(", ")[1]}`, kind === "game") },
    { action: { kind: "none" }, text: headingText(cameras.length > 0 ? `Cameras (${cameras.length})` : "No cameras yet") },
    ...cameras.map(([name, camera]): MenuEntry => ({ action: { kind: "camera", name }, text: `${name}\n§7${CAMERA_KINDS[camera.kind].label}` })),
  ];
}

/** The Snapshot tool's settings: the map's cameras (tap one to look through it). */
export function snapshotSettings(config: MapConfig): MenuEntry[] {
  const cameras = camerasOf(config);
  return [
    { action: { kind: "none" }, text: headingText(cameras.length > 0 ? `Cameras (${cameras.length})` : "No cameras yet: place one with the Camera tool") },
    ...cameras.map(([name, camera]): MenuEntry => ({ action: { kind: "snapshot", name }, text: `${name}\n§7${CAMERA_KINDS[camera.kind].label}` })),
  ];
}

/** The Boundaries view's text: what a switch does. */
export const BOUNDARIES_BODY =
  "A boundary switched on shows to you all the time, whatever you hold. Holding the Region or Kill Y tool shows every one, as always.";

/** The Boundaries view's switches: Show all, then one per boundary the map has. */
export function boundaryEntries(rows: BoundaryRow[], shown: ReadonlySet<string>): { group: string; text: string }[] {
  return [
    { group: ALL_BOUNDARIES, text: switchText("Show all", "every boundary on this map", shown.has(ALL_BOUNDARIES)) },
    ...rows.map((row) => ({ group: row.group, text: switchText(row.label, row.detail, outlineShown(row.group, shown)) })),
  ];
}

/** The spawn tool's settings: every spawn and point the map has, by list (tap one for its screen). */
export function spawnSettings(config: MapConfig, lists: SpawnList[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const list of lists) {
    const positions = listOf(config, list.target);
    entries.push({ action: { kind: "none" }, text: headingText(positions.length === 0 ? `${list.label}: none yet` : list.single ? list.label : `${list.label} (${positions.length})`) });
    positions.forEach((position, index) => {
      const name = list.single ? list.entry : `${list.entry} ${index + 1}`;
      entries.push({ action: { kind: "entry", key: `${list.key}#${index}` }, text: `${name}\n§7${positionText(position)}` });
    });
  }
  return entries;
}

/** The region tool's settings: the selection (Save opens its screen), then the map's bounds and regions. */
export function regionSettings(selection: MapMenuView["region"]["selection"], boxes: RegionEntry[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (selection) {
    entries.push(
      { action: { kind: "none" }, text: headingText(`Selection: ${sizeText(selection.box)}`) },
      { action: { kind: "selection", action: "saveAs" }, text: goText(selection.editing ? `Save ${selection.editing}` : "Save the selection") },
      { action: { kind: "selection", action: "clear" }, text: dangerText("Clear selection") },
    );
  }
  entries.push({ action: { kind: "none" }, text: headingText(boxes.length > 0 ? `Bounds and regions (${boxes.length})` : "No bounds or regions yet") });
  for (const box of boxes) entries.push({ action: { kind: "box", key: box.key }, text: `${box.label}\n§7${sizeText(box.box)}: edit, nudge, go to, delete` });
  return entries;
}

/** The Kill Y tool's settings: the height now, its screen, and removing it. */
export function killYSettings(killY: number | undefined): MenuEntry[] {
  return [
    { action: { kind: "none" }, text: headingText(killY === undefined ? "Kill Y: not set" : `Kill Y: ${killY}`) },
    { action: { kind: "killY" }, text: goText("Set kill Y") },
    ...(killY === undefined ? [] : [{ action: { kind: "removeKillY" } as const, text: dangerText("Remove kill Y") }]),
  ];
}

/** Save: just "Save" (or "Saving..."); whether blocks changed is its tooltip. */
function saveText(view: MapMenuView): string {
  if (view.saving) return "Saving...\n§7the map and the world";
  return `Save\n§7${view.unsaved ? "blocks changed since the last save" : "saves the map and the world"}`;
}

// ---- Tool screens -------------------------------------------------------------------------------
// What a tool sets up opens in its own side screen: a toggle first, then its settings, nudge rows,
// and a green button pinned at the bottom that saves it. Closing the screen keeps nothing.

/** How far each nudge of a spawn or point moves it: Step cycles through these. */
export const POINT_STEPS = [1, 0.5, 5] as const;

/** A spawn or point's screen: new (placed with the Spawn tool) or one the map has (its marker hit). */
export interface EntryScreenView {
  lists: SpawnList[];
  /** The picked list's key. */
  list: string;
  at: { x: number; y: number; z: number };
  facing?: Facing;
  snap: Snap;
  center: boolean;
  step: number;
  /** One the map has: its number in its list, and how many the list holds. */
  existing?: { index: number; count: number };
  /** The queue spawn's settings, when that's the list. */
  queue?: { mode: "lock" | "free"; countdown: number };
  /** Opened from the map menu: the back arrow goes back to it. */
  back?: boolean;
}

export type EntryScreenAction =
  | { kind: "list"; key: string }
  | { kind: "type" }
  | { kind: "here" }
  | { kind: "center" }
  | { kind: "face" }
  | { kind: "unface" }
  | { kind: "snap" }
  | { kind: "axis"; axis: 0 | 1 | 2; by: 1 | -1 }
  | { kind: "step"; step: number }
  | { kind: "queueMode" }
  | { kind: "queueCountdown" }
  | { kind: "renumber" }
  | { kind: "delete" }
  | { kind: "save" }
  | { kind: "back" }
  | { kind: "none" };

const AXES = [
  { axis: 0, name: "X", plus: "east" },
  { axis: 1, name: "Y", plus: "up" },
  { axis: 2, name: "Z", plus: "south" },
] as const;

/** A number as a position shows it: up to two decimals. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A list's name on its toggle tile: "Spawn", "Spectator", "Queue", "Red", "Bomb site A". */
export function shortListName(list: SpawnList): string {
  return list.entry.replace(/ spawn$/, "");
}

/**
 * A spawn or point's screen: which list (a toggle), its position and facing, the queue's settings
 * for the queue spawn, nudge rows for each axis, Step, Renumber and Delete (one the map has), and
 * Place or Save, green, at the bottom.
 */
export function entryScreenEntries(view: EntryScreenView): { action: EntryScreenAction; text: string; icon?: string }[] {
  const entries: { action: EntryScreenAction; text: string; icon?: string }[] = view.back ? [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }] : [];
  view.lists.forEach((list, i) => entries.push({ action: { kind: "list", key: list.key }, text: segmentText(shortListName(list), i, list.key === view.list) }));
  const lead = (action: EntryScreenAction, text: string) => entries.push({ action, text: `${MARK.lead}${text}` });
  const snap = SNAPS.find((candidate) => candidate.snap === view.snap)?.label ?? "Exact";
  lead({ kind: "none" }, headingText("Position"));
  lead({ kind: "type" }, `${[view.at.x, view.at.y, view.at.z].map(coordinate).join(" ")}\n§7tap to type a position`);
  lead({ kind: "here" }, "Move here\n§7where you stand");
  lead({ kind: "center" }, switchText("Center on block", "the middle of the block, not the exact spot", view.center));
  lead({ kind: "none" }, headingText(`Facing: ${view.facing ? compass(view.facing.yaw) : "the middle of the map"}`));
  lead({ kind: "face" }, "Take my facing\n§7the way you look now");
  if (view.facing) lead({ kind: "unface" }, "Clear facing\n§7face the middle of the map");
  lead({ kind: "snap" }, `Snap: ${snap}\n§7tap for ${SNAPS.filter((candidate) => candidate.label !== snap).map((candidate) => candidate.label).join(" or ")}`);
  if (view.queue) {
    lead({ kind: "none" }, headingText("Queue"));
    lead({ kind: "queueMode" }, switchText("Lock in", "players look around but don't move, invisible", view.queue.mode === "lock"));
    lead({ kind: "queueCountdown" }, `Countdown: ${view.queue.countdown} s\n§7once everyone's in, before the spawns; tap to type it`);
  }
  for (const { axis, name, plus } of AXES) {
    const value = [view.at.x, view.at.y, view.at.z][axis];
    entries.push(
      { action: { kind: "axis", axis, by: -1 }, text: `${MARK.minus}${name} (${plus} +): ${coordinate(value)}`, icon: ICONS.minus },
      { action: { kind: "axis", axis, by: 1 }, text: `${MARK.plus}${name} ${plus}`, icon: ICONS.new },
    );
  }
  entries.push(...stepEntries(POINT_STEPS, view.step));
  if (view.existing && view.existing.count > 1) entries.push({ action: { kind: "renumber" }, text: "Renumber" });
  if (view.existing) entries.push({ action: { kind: "delete" }, text: dangerText("Delete") });
  const list = view.lists.find((candidate) => candidate.key === view.list);
  entries.push({ action: { kind: "save" }, text: saveBarText(view.existing ? "Save" : `Place ${list?.entry ?? "it"}`) });
  return entries;
}

/** The selection's screen (Save the selection, in the map menu). */
export interface RegionScreenView {
  targets: RegionTarget[];
  /** The picked target's key; "editing" saves over the box the selection came from. */
  target: string;
  /** The saved box the selection came from, by its label. */
  editing?: string;
  /** A new region's name, as typed so far. */
  name: string;
  box: Box;
  steps: number;
  killY?: number;
  step: number;
  /** Opened from the map menu: the back arrow goes back to it. */
  back?: boolean;
}

export type RegionScreenAction =
  | { kind: "target"; key: string }
  | { kind: "name" }
  | { kind: "floor" }
  | { kind: "undo" }
  | { kind: "side"; side: keyof Sides; by: 1 | -1 }
  | { kind: "step"; step: number }
  | { kind: "clear" }
  | { kind: "save" }
  | { kind: "back" }
  | { kind: "none" };

/** A region target's name on its toggle tile. */
function targetTile(target: RegionTarget): string {
  if (target.kind === "addBounds") return "Add bounds";
  if (target.kind === "new") return "New region";
  return target.kind === "bounds" ? "Bounds" : target.label;
}

/**
 * The selection's screen: what to save it as (a toggle, with the box it came from first), a new
 * region's name, Floor at kill Y and Back one step, nudge rows for each side, Step, Clear (red), and
 * Save, green, at the bottom.
 */
export function regionScreenEntries(view: RegionScreenView): { action: RegionScreenAction; text: string; icon?: string }[] {
  const tiles = [...(view.editing ? [{ key: "editing", text: "This box" }] : []), ...view.targets.map((target) => ({ key: target.key, text: targetTile(target) }))];
  const entries: { action: RegionScreenAction; text: string; icon?: string }[] = view.back ? [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }] : [];
  tiles.forEach((tile, i) => entries.push({ action: { kind: "target", key: tile.key }, text: segmentText(tile.text, i, tile.key === view.target) }));
  const lead = (action: RegionScreenAction, text: string) => entries.push({ action, text: `${MARK.lead}${text}` });
  lead({ kind: "none" }, headingText(`Selection: ${sizeText(view.box)}${view.target === "editing" && view.editing ? `, ${view.editing}` : ""}`));
  if (view.target === "new") lead({ kind: "name" }, `Name: ${view.name || "§8none yet"}\n§7letters, digits and _, starting with a letter`);
  if (view.killY !== undefined) lead({ kind: "floor" }, `Floor at kill Y\n§7put the bottom at ${view.killY}`);
  if (view.steps > 0) lead({ kind: "undo" }, "Back one step\n§7undo the last change to the selection");
  for (const { side, name } of NUDGE_SIDES) {
    entries.push(
      { action: { kind: "side", side, by: -1 }, text: `${MARK.minus}${name}`, icon: ICONS.minus },
      { action: { kind: "side", side, by: 1 }, text: `${MARK.plus}${name} out`, icon: ICONS.new },
    );
  }
  entries.push(...stepEntries(NUDGE_STEPS, view.step), { action: { kind: "clear" }, text: dangerText("Clear selection") });
  entries.push({ action: { kind: "save" }, text: saveBarText(view.target === "editing" && view.editing ? `Save ${view.editing}` : "Save") });
  return entries;
}

export type KillYScreenAction = { kind: "type" } | { kind: "height"; by: 1 | -1 } | { kind: "step"; step: number } | { kind: "remove" } | { kind: "save" } | { kind: "back" } | { kind: "none" };

/** The Kill Y tool's screen: the height (typed, or nudged), Step, Remove (red, once it's set), and Set kill Y, green, at the bottom. */
export function killYScreenEntries(view: { y: number; set: boolean; step: number; back?: boolean }): { action: KillYScreenAction; text: string; icon?: string }[] {
  return [
    ...(view.back ? [{ action: { kind: "back" } as const, text: BACK_TEXT, icon: ICONS.back }] : []),
    { action: { kind: "none" }, text: `${MARK.lead}${headingText(`Kill Y: ${view.y}`)}` },
    { action: { kind: "type" }, text: `${MARK.lead}Type a height\n§7from -64 to 319` },
    { action: { kind: "height", by: -1 }, text: `${MARK.minus}Height: ${view.y}`, icon: ICONS.minus },
    { action: { kind: "height", by: 1 }, text: `${MARK.plus}Height up`, icon: ICONS.new },
    ...stepEntries(NUDGE_STEPS, view.step),
    ...(view.set ? [{ action: { kind: "remove" } as const, text: dangerText("Remove kill Y") }] : []),
    { action: { kind: "save" }, text: saveBarText("Set kill Y") },
  ];
}

// ---- Snapshot ---------------------------------------------------------------------------------
// The Snapshot tool: pick a camera, look through it with the 16:9 frame, nudge it, then take the
// screenshot with Minecraft's own keys and use it.

/** How far each nudge moves a camera and turns or tilts it: Step's tiles. */
export const SNAPSHOT_STEPS = [
  { label: "Small", move: 0.1, turn: 1 },
  { label: "Medium", move: 0.5, turn: 5 },
  { label: "Large", move: 2, turn: 15 },
] as const;

export type SnapshotAction =
  | { kind: "back" }
  | { kind: "shoot" }
  | { kind: "use" }
  | { kind: "stop" }
  | { kind: "kind" }
  | { kind: "move"; axis: 0 | 1 | 2; by: 1 | -1 }
  | { kind: "turn"; by: 1 | -1 }
  | { kind: "tilt"; by: 1 | -1 }
  | { kind: "step"; step: number }
  | { kind: "none" };

/** The Snapshot's list of cameras: tap one to look through it. */
export function snapshotListEntries(config: MapConfig): { camera?: string; text: string }[] {
  const cameras = camerasOf(config);
  if (cameras.length === 0) return [{ text: headingText("No cameras yet: use the Camera tool to place one") }];
  return cameras.map(([name, camera]) => ({ camera: name, text: `${name}\n§7${CAMERA_KINDS[camera.kind].label}` }));
}

/**
 * The Snapshot while looking through a camera: the back arrow (to the cameras), where it is, Take
 * a screenshot, Back to my view and the Game picture switch; nudge rows to move it along each axis,
 * turn it and tilt it; Step; and Use latest screenshot, green, at the bottom. A lobby map has no
 * picture, so there it only nudges.
 */
export function snapshotEntries(view: { camera: MapCamera; step: number; lobby: boolean }): { action: SnapshotAction; text: string; icon?: string }[] {
  const [x, y, z, yaw, pitch] = view.camera.at;
  const place = cameraPlace(view.camera);
  const entries: { action: SnapshotAction; text: string; icon?: string }[] = [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }];
  const lead = (action: SnapshotAction, text: string) => entries.push({ action, text: `${MARK.lead}${text}` });
  lead({ kind: "none" }, headingText(`At ${place.at}, looking ${place.looks}`));
  if (!view.lobby) lead({ kind: "shoot" }, "Take a screenshot\n§7F1 hides everything, F2 takes it, F1 brings it back");
  lead({ kind: "stop" }, "Back to my view");
  lead({ kind: "kind" }, switchText("Game picture", view.camera.kind === "game" ? CAMERA_KINDS.game.hint : `off: a map preview, ${CAMERA_KINDS.map.hint.split(", ")[1]}`, view.camera.kind === "game"));
  const rows: [SnapshotAction, SnapshotAction, string, string][] = [
    [{ kind: "move", axis: 0, by: -1 }, { kind: "move", axis: 0, by: 1 }, `X (east +): ${coordinate(x)}`, "X east"],
    [{ kind: "move", axis: 1, by: -1 }, { kind: "move", axis: 1, by: 1 }, `Y (up +): ${coordinate(y)}`, "Y up"],
    [{ kind: "move", axis: 2, by: -1 }, { kind: "move", axis: 2, by: 1 }, `Z (south +): ${coordinate(z)}`, "Z south"],
    [{ kind: "turn", by: -1 }, { kind: "turn", by: 1 }, `Turn (right +): ${coordinate(yaw)}`, "Turn right"],
    [{ kind: "tilt", by: -1 }, { kind: "tilt", by: 1 }, `Tilt (down +): ${coordinate(pitch)}`, "Tilt down"],
  ];
  for (const [minus, plus, label, more] of rows) {
    entries.push({ action: minus, text: `${MARK.minus}${label}`, icon: ICONS.minus }, { action: plus, text: `${MARK.plus}${more}`, icon: ICONS.new });
  }
  SNAPSHOT_STEPS.forEach((step, i) => entries.push({ action: { kind: "step", step: i }, text: stepTileText(step.label, i, i === view.step) }));
  if (!view.lobby) entries.push({ action: { kind: "use" }, text: saveBarText(`Use latest screenshot\n§7as ${view.camera.kind === "map" ? "the map's thumbnail" : "the game's thumbnail"}`) });
  return entries;
}

// ---- Thumbnails -------------------------------------------------------------------------------

export type ThumbnailAction = { kind: "back" } | { kind: "import" } | { kind: "shot"; id: string } | { kind: "none" };

/**
 * A thumbnail menu (Map settings' Edit Map Thumbnail or Edit Minigame Thumbnail): the back arrow,
 * Import from another minigame for a map's (it stays put), then every picture used before, two to a
 * row, the one in use outlined green. A picture that isn't one of them (made before they were kept)
 * comes first when it's the one in use.
 */
export function thumbnailEntries(view: { kind: "map" | "game"; pictures: PictureInfo; own?: string }): { action: ThumbnailAction; text: string; icon?: string }[] {
  const entries: { action: ThumbnailAction; text: string; icon?: string }[] = [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }];
  if (view.kind === "map") entries.push({ action: { kind: "import" }, text: `${MARK.fixed}${linkText("Import from another minigame")}` });
  const current = view.pictures.current[view.kind];
  const tiles: { action: ThumbnailAction; label: string; icon: string; on: boolean }[] = [];
  if (current === "own" && view.own) tiles.push({ action: { kind: "none" }, label: "In use now", icon: view.own, on: true });
  for (const shot of view.pictures.shots) tiles.push({ action: { kind: "shot", id: shot.id }, label: shot.label, icon: shotTexture(shot.id), on: shot.id === current });
  if (tiles.length === 0) entries.push({ action: { kind: "none" }, text: headingText("No pictures yet: the Snapshot tool takes them") });
  tiles.forEach((tile, i) => entries.push({ action: tile.action, text: pictureText(`${tile.label}${tile.on ? "\n§7in use" : ""}`, i, tile.on), icon: tile.icon }));
  return entries;
}

/** Import from another minigame: the games with maps that have a picture (not this one, nor the lobby). */
export function importTargetEntries(pictures: PictureInfo, here: string): { target: string; text: string }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const map of pictures.maps) {
    if (map.target === here || map.target === "lobby") continue;
    const entry = counts.get(map.target) ?? { name: map.targetName, count: 0 };
    entry.count++;
    counts.set(map.target, entry);
  }
  return [...counts].map(([target, { name, count }]) => ({ target, text: `${name}\n§7${count} map${count === 1 ? "" : "s"} with a picture` }));
}

export type ImportMapAction = { kind: "back" } | { kind: "map"; map: string; name: string };

/** A game's maps with a picture, as cards: the picture and the map's name, two to a row. */
export function importMapEntries(pictures: PictureInfo, target: string): { action: ImportMapAction; text: string; icon?: string }[] {
  const maps = pictures.maps.filter((map) => map.target === target);
  return [
    { action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back },
    ...maps.map((map, i) => ({ action: { kind: "map" as const, map: map.map, name: map.name }, text: pictureText(`${map.name}\n§7${map.map}`, i, false), icon: mapPictureTexture(target, map.map) })),
  ];
}

// ---- Preview ----------------------------------------------------------------------------------

/** The most fake players the preview menu offers. */
export const MAX_PREVIEW_FAKES = 7;

export type PreviewAction = { kind: "back" } | { kind: "fakes"; fakes: number } | { kind: "start" } | { kind: "none" };

/**
 * Before a preview loads: how many fake players the match starts with, as a toggle (0 up to what
 * fits beside the players going), and Start preview, green, at the bottom.
 */
export function previewEntries(view: { fakes: number; most: number; back: boolean }): { action: PreviewAction; text: string; icon?: string }[] {
  const most = Math.max(0, Math.min(MAX_PREVIEW_FAKES, view.most));
  return [
    ...(view.back ? [{ action: { kind: "back" } as const, text: BACK_TEXT, icon: ICONS.back }] : []),
    { action: { kind: "none" }, text: `${MARK.lead}${headingText("Fake players")}` },
    ...Array.from({ length: most + 1 }, (_, fakes) => ({ action: { kind: "fakes", fakes } as const, text: stepTileText(String(fakes), fakes, fakes === Math.min(view.fakes, most)) })),
    { action: { kind: "start" }, text: saveBarText("Start preview") },
  ];
}

/** The menu's first line: the map, the game, and whether it's a draft. */
export function menuBody(targetName: string, mapId: string, config: MapConfig): string {
  return `${config.name} (${mapId}), ${targetName}${config.draft === true ? ", draft" : ""}`;
}

/** A checklist button: green when done, red with the count when not. */
export function rowText(row: ChecklistRow): string {
  return `${row.done ? "§a" : "§c"}${row.label}\n§7${row.have} of ${row.need}`;
}

/** The checklist's text above its buttons: what the build would refuse, then warnings. */
export function checklistBody(checklist: Checklist): string {
  if (checklist.ready && checklist.warnings.length === 0) return "§aNothing missing. Tap an entry for its tool.";
  const lines = [...checklist.problems.map((problem) => `§c- ${problem}`), ...checklist.warnings.map((warning) => `§e- ${warning}`)];
  return `${lines.join("\n")}\n§rTap an entry for its tool.`;
}

/** The queue countdown typed in its form: whole seconds within the limits, else undefined. */
export function parseCountdown(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= QUEUE_COUNTDOWN.min && value <= QUEUE_COUNTDOWN.max ? value : undefined;
}

/** Publish, under the checklist's rows: commit and push the map, which stops being a draft. */
export function publishText(checklist: Checklist, draft: boolean, publishing: boolean): string {
  if (publishing) return "Publishing...\n§7saving, then commit and push";
  if (!checklist.ready) return "Publish\n§7finish the checklist first";
  return draft ? "Publish\n§7put it in the lobby: commit and push" : "Publish changes\n§7commit and push this version";
}

/** What Publish's confirm says it does. */
export function publishBody(target: string, targetName: string, mapId: string, config: MapConfig): string {
  const where = target === "lobby" ? "the Panel's lobby map picker has it" : `it's in ${targetName}'s map list in the lobby`;
  return [
    `Publish ${config.name} (${mapId}) for ${targetName}?`,
    "",
    `The map and its world are saved, then its folder is committed ("Automated Map Build") and pushed to GitHub.`,
    `${config.draft === true ? "It stops being a draft, and " : ""}${where} from the network's next start.`,
  ].join("\n");
}

/**
 * A game setting typed into the settings form, as the type it had: a number, true or false, or
 * text. Undefined when it doesn't read as that type.
 */
export function parseSetting(text: string, old: string | number | boolean): string | number | boolean | undefined {
  if (typeof old === "string") return text;
  const trimmed = text.trim();
  if (typeof old === "boolean") return /^(true|false)$/i.test(trimmed) ? trimmed.toLowerCase() === "true" : undefined;
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) ? value : undefined;
}

function progress(checklist: Checklist): { done: number; total: number } {
  return { done: checklist.rows.filter((row) => row.done).length, total: checklist.rows.length };
}

function problemCount(checklist: Checklist): string {
  const count = checklist.problems.length;
  return count === 0 ? "ready" : `${count} problem${count === 1 ? "" : "s"}`;
}

// ---- Select mode ------------------------------------------------------------------------------

export interface SelectMenuView {
  selection?: { box: Box; steps: number };
  maps: SelectionInfo[];
}

/** How to box a map: Select's Help link puts it in chat. */
export const SELECT_HELP = `${SELECT_TOOL.howTo} Spawns are placed in Edit.`;

/** Select mode's map menu: the icon row (Back one step, Players, Back to Lobby at the right end), Help, the selection's actions, and the maps from this world. */
export function selectMenuEntries(view: SelectMenuView): MenuEntry[] {
  const entries: MenuEntry[] = [backEntry(view.selection?.steps ?? 0), PLAYERS_ENTRY, LOBBY_ENTRY, HELP_ENTRY];
  if (view.selection) entries.push(...selectionEntries(view.selection.box));
  else entries.push({ action: { kind: "none" }, text: headingText("No selection yet") });
  entries.push({ action: { kind: "none" }, text: headingText(view.maps.length > 0 ? `Maps from this world (${view.maps.length})` : "No maps from this world yet") });
  for (const map of view.maps) {
    // A ready one is just its name: tapping it asks whether to edit it.
    const status = map.status === "ready" ? "" : `${MARK.twoLine}`;
    const line = map.status === "ready" ? "" : `\n${statusLine(map)}`;
    entries.push({ action: { kind: "map", target: map.target, map: map.map }, text: `${MARK.card}${status}${map.name} (${map.map})${line}`, icon: ICONS.edit });
  }
  return entries;
}

/** The selection's size, then Export to Map (green), Nudge sides and Clear selection (red). */
function selectionEntries(box: Box): MenuEntry[] {
  return [
    { action: { kind: "none" }, text: headingText(`Selection: ${sizeText(box)}`) },
    { action: { kind: "pick", action: "saveMap" }, text: goText("Export to Map") },
    { action: { kind: "pick", action: "nudge" }, text: "Nudge sides" },
    { action: { kind: "pick", action: "clear" }, text: dangerText("Clear selection") },
  ];
}

/** Back one step, an icon (faded with nothing to step back). */
function backEntry(steps: number): MenuEntry {
  return { action: { kind: "pick", action: "back" }, text: `${MARK.quick}${steps > 0 ? "" : MARK.dim}Back one step\n§7${steps > 0 ? "undo the selection's last change" : "nothing to step back"}`, icon: ICONS.undo };
}

/** A Help link: how something works, in chat. */
const HELP_ENTRY: MenuEntry = { action: { kind: "help" }, text: linkText("Help") };

/** Back to Lobby: an icon at the right end of the icon row (Select's map menu, Edit's gear). */
export const LOBBY_TEXT = `${MARK.end}Back to Lobby`;
const LOBBY_ENTRY: MenuEntry = { action: { kind: "lobby" }, text: LOBBY_TEXT, icon: ICONS.lobby };

/** The Players icon (Select's map menu, Edit's gear, the editor lobby's menu): its tooltip says what it's for. */
export const PLAYERS_TEXT = `${MARK.quick}Players\n§7invite friends to Select and previews`;
const PLAYERS_ENTRY: MenuEntry = { action: { kind: "players" }, text: PLAYERS_TEXT, icon: ICONS.players };

/** Edit's gear: Players and Back to Lobby (right end) in the icon row, then the map's settings and the red ones. */
export type GearAction = "settings" | "players" | "dropBuild" | "delete" | "lobby" | "back" | "mapThumbnail" | "gameThumbnail";

/** Edit's gear: the icon row, Name and game settings, the thumbnails (a game's map), then the red ones. */
export function gearEntries(view: { build: boolean; game: boolean }): { action: GearAction; text: string; icon?: string }[] {
  const entries: { action: GearAction; text: string; icon?: string }[] = [
    { action: "back", text: BACK_TEXT, icon: ICONS.back },
    { action: "players", text: PLAYERS_TEXT, icon: ICONS.players },
    { action: "lobby", text: LOBBY_TEXT, icon: ICONS.lobby },
    { action: "settings", text: "Name and game settings" },
  ];
  if (view.game) entries.push({ action: "mapThumbnail", text: "Edit Map Thumbnail" }, { action: "gameThumbnail", text: "Edit Minigame Thumbnail" });
  if (view.build) entries.push({ action: "dropBuild", text: dangerText("Drop build commands") });
  entries.push({ action: "delete", text: dangerText("Delete map") });
  return entries;
}

/** What Export to Map has so far: the name, the map id when typed (else it comes from the name), and the target. */
export interface ExportDraft {
  name: string;
  map?: string;
  target: string;
}

/** The back arrow left of a sub-menu's title. */
export const BACK_TEXT = `${MARK.back}Back`;

/** How far each tap moves a side: Step's tiles. */
export const NUDGE_STEPS = [1, 5, 10] as const;

/** The Step toggle: a tile per distance, the one in use green. */
export function stepEntries(steps: readonly number[], step: number): { action: { kind: "step"; step: number }; text: string }[] {
  return steps.map((value, i) => ({ action: { kind: "step", step: value }, text: stepTileText(`${value} block${value === 1 ? "" : "s"}`, i, value === step) }));
}

export type NudgeAction = { kind: "side"; side: keyof Sides; by: 1 | -1 } | { kind: "step"; step: number } | { kind: "reset" } | { kind: "nudge" } | { kind: "back" } | { kind: "none" };

/** The sides in Nudge's order, with their names and, for the four around, their compass direction. */
const NUDGE_SIDES: { side: keyof Sides; name: string; compass?: Cardinal }[] = [
  { side: "north", name: "North", compass: "north" },
  { side: "south", name: "South", compass: "south" },
  { side: "west", name: "West", compass: "west" },
  { side: "east", name: "East", compass: "east" },
  { side: "up", name: "Top" },
  { side: "down", name: "Bottom" },
];

/**
 * Nudge sides: for each side a minus (in) and a plus (out), the minus showing the side's name,
 * where it is from the player, and how far it moved; then Step, Reset (once something moved) and
 * Nudge (green), which keeps it.
 */
export function nudgeEntries(view: { sides: Sides; step: number; facing: Cardinal }): { action: NudgeAction; text: string; icon?: string }[] {
  const entries: { action: NudgeAction; text: string; icon?: string }[] = [{ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back }];
  for (const { side, name, compass } of NUDGE_SIDES) {
    const where = compass ? ` (${relativeSide(view.facing, compass)})` : "";
    const moved = view.sides[side];
    entries.push(
      { action: { kind: "side", side, by: -1 }, text: `${MARK.minus}${name}${where}: ${moved > 0 ? `+${moved}` : moved}`, icon: ICONS.minus },
      { action: { kind: "side", side, by: 1 }, text: `${MARK.plus}${name} out`, icon: ICONS.new },
    );
  }
  entries.push(...stepEntries(NUDGE_STEPS, view.step));
  if (Object.values(view.sides).some((value) => value !== 0)) entries.push({ action: { kind: "reset" }, text: "Reset\n§7put every side back" });
  entries.push({ action: { kind: "nudge" }, text: saveBarText("Nudge") });
  return entries;
}

/** The action bar while Nudge sides is open: the way the player faces. */
export function facingLine(facing: Cardinal): string {
  return `Facing ${facing[0].toUpperCase()}${facing.slice(1)}   + moves a side out, - moves it in`;
}

/** The Players menu's text: who guests are, and where they can go. */
export const PLAYERS_BODY =
  "Invite friends by gamertag. They join this PC's address on port 19132, as for the network, and go to Select or the preview, whichever is open (they wait in the editor lobby when neither is). Edit stays yours. Tap a guest to remove them.";

/** Where a guest is, in a few words. */
export function guestWhere(guest: GuestInfo): string {
  switch (guest.on) {
    case "home":
      return "waiting in the editor lobby";
    case "select":
      return "on Select";
    case "preview":
      return "in the preview";
    default:
      return "not on";
  }
}

/** The Players menu: Invite, then each guest (tap to remove). */
export function guestEntries(guests: GuestInfo[]): { name?: string; text: string }[] {
  return [{ text: "Invite a player...\n§7by gamertag" }, ...guests.map((guest) => ({ name: guest.name, text: `${MARK.twoLine}${guest.name}\n§7${guestWhere(guest)}` }))];
}

/** How a map's extraction is going, in a few words. */
export function statusLine(map: SelectionInfo): string {
  switch (map.status) {
    case "queued":
      return "§equeued";
    case "extracting":
      return "§ebeing cut out...";
    case "updating":
      return "§ebeing updated...";
    case "ready":
      return "§aready";
    case "failed":
      return "§cfailed: tap for why";
  }
}

export type MapAction = "edit" | "retry" | "forget" | "cancel";

/**
 * What tapping a map from this world offers: Edit (green) or Cancel when it's ready; Try again, or
 * taking it off the list, when its export failed (there's no map to delete in Edit then). A ready
 * map is deleted from Edit only.
 */
export function mapActions(map: SelectionInfo): { action: MapAction; text: string }[] {
  if (map.status === "ready") return [{ action: "edit", text: goText("Edit") }, { action: "cancel", text: "Cancel" }];
  if (map.status === "failed") return [{ action: "retry", text: "Try again" }, { action: "forget", text: dangerText("Remove from this list") }, { action: "cancel", text: "Cancel" }];
  return [];
}

/** The question before editing a map from this world. */
export function editBody(map: SelectionInfo): string {
  return `${map.name} (${map.map}), a ${map.targetName} map, ${sizeText(map.box)} blocks. It opens on the Edit server, and you're moved there.`;
}

// ---- The editor lobby ---------------------------------------------------------------------------

/** A map id from a name: "Castle Keep" is castle_keep. */
export function mapIdFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);
}

/** How many cards the editor lobby's menu shows. */
const CARDS_SHOWN = 8;

export type HomeAction =
  /** Open a map in Edit or a world in Select, or go to the server that has it open. */
  | { kind: "open"; request: Extract<RecentEntry["request"], { to: "edit" | "select" }> }
  /** Preview a map from its folder (after picking how many fake players). */
  | { kind: "preview"; target: string; map: string }
  /** Search: pick the lobby or a game, then one of its maps. */
  | { kind: "maps" }
  /** New map: pick a world to copy builds from (or an empty world). */
  | { kind: "new" }
  /** Disconnect from the map editor (after a confirm). */
  | { kind: "leave" }
  /** The Players menu: invite friends to Select and previews. */
  | { kind: "players" }
  /** A faded icon: its step isn't done, so it only says why. */
  | { kind: "off"; why: string }
  /** A heading or a card's title: nothing happens but the menu opening again. */
  | { kind: "none" };

export interface HomeEntry {
  action: HomeAction;
  text: string;
  /** The icon in the icon row, or on a card. */
  icon?: string;
}

/** A card: a map (newest first by when it was opened), or a world opened in Select with no map of its own among the cards. */
export type HomeCard =
  | { kind: "map"; target: Catalog["targets"][number]; map: Catalog["targets"][number]["maps"][number] }
  | { kind: "world"; world: Catalog["worlds"][number] };

/** The cards from Recent: one per map (Edit and Preview entries alike), then worlds whose maps have none. */
export function homeCards(catalog: Catalog): HomeCard[] {
  const cards: HomeCard[] = [];
  const seen = new Set<string>();
  for (const entry of catalog.recent) {
    const request = entry.request;
    if (request.to === "select") {
      const world = catalog.worlds.find((candidate) => candidate.id === request.world);
      if (world && !seen.has(`world:${world.id}`)) cards.push({ kind: "world", world });
      if (world) seen.add(`world:${world.id}`);
      continue;
    }
    const target = catalog.targets.find((candidate) => candidate.id === request.target);
    const map = target?.maps.find((candidate) => candidate.id === request.map);
    if (!target || !map || seen.has(`map:${target.id}/${map.id}`)) continue;
    seen.add(`map:${target.id}/${map.id}`);
    cards.push({ kind: "map", target, map });
  }
  const mapWorlds = new Set(cards.flatMap((card) => (card.kind === "map" && card.map.world ? [card.map.world] : [])));
  return cards.filter((card) => card.kind === "map" || !mapWorlds.has(card.world.id)).slice(0, CARDS_SHOWN);
}

/**
 * The editor lobby's menu: the icon row (New map, Players, and Leave at the right end), then Recent
 * with Search on its right, and the cards: each map's game, with Select (the world it came from),
 * Edit and Preview icons on its right, faded when that step isn't done, and the map's name under
 * them. A world with no map yet has Select only.
 */
export function homeEntries(state: HomeState): HomeEntry[] {
  const entries: HomeEntry[] = [
    { action: { kind: "new" }, text: `${MARK.quick}New map\n§7copy builds from one of your worlds, or start from an empty one`, icon: ICONS.new },
    { action: { kind: "players" }, text: PLAYERS_TEXT, icon: ICONS.players },
    { action: { kind: "leave" }, text: `${MARK.end}Leave\n§7disconnect from the map editor`, icon: ICONS.leave },
    { action: { kind: "none" }, text: `${MARK.cardHead}${headingText("Recent")}` },
    { action: { kind: "maps" }, text: `${MARK.cardLink}Search\n§7the lobby's and every game's maps`, icon: ICONS.search },
  ];
  const cards = homeCards(state.catalog);
  if (cards.length === 0) entries.push({ action: { kind: "none" }, text: headingText("§8Nothing opened yet") });
  for (const card of cards) entries.push(...cardEntries(card, state.catalog));
  return entries;
}

/** A card's buttons: its title, then its Select, Edit and Preview icons. */
function cardEntries(card: HomeCard, catalog: Catalog): HomeEntry[] {
  if (card.kind === "world") {
    const { world } = card;
    return [
      { action: { kind: "none" }, text: cardTitleText("World", world.name) },
      { action: { kind: "open", request: { to: "select", world: world.id } }, text: cardIconText(`Select\n§7box maps in ${world.name}`, 0, true), icon: ICONS.select },
      { action: { kind: "off", why: "Box a map in Select and export it first." }, text: cardIconText("Edit\n§7box a map and export it first", 1, false), icon: ICONS.edit },
      { action: { kind: "off", why: "Export a map, then finish its checklist in Edit." }, text: cardIconText("Preview\n§7export a map and finish its checklist first", 2, false), icon: ICONS.play },
    ];
  }
  const { target, map } = card;
  const world = map.world ? catalog.worlds.find((candidate) => candidate.id === map.world) : undefined;
  const lobby = target.id === "lobby";
  const why = lobby ? "A lobby map can't be previewed yet: publish it, then start the network." : "Open it in Edit and finish its checklist first.";
  return [
    { action: { kind: "none" }, text: cardTitleText(target.name, map.name) },
    world
      ? { action: { kind: "open", request: { to: "select", world: world.id } }, text: cardIconText(`Select\n§7box more maps in ${world.name}`, 0, true), icon: ICONS.select }
      : { action: { kind: "off", why: "This map didn't come from a world on this PC." }, text: cardIconText("Select\n§7its world isn't on this PC", 0, false), icon: ICONS.select },
    { action: { kind: "open", request: { to: "edit", target: target.id, map: map.id } }, text: cardIconText(`Edit\n§7${map.id}${map.draft ? ", a draft" : ""}`, 1, true), icon: ICONS.edit },
    !lobby && map.ready
      ? { action: { kind: "preview", target: target.id, map: map.id }, text: cardIconText("Preview\n§7play it, with fake players if you like", 2, true), icon: ICONS.play }
      : { action: { kind: "off", why }, text: cardIconText(`Preview\n§7${lobby ? "lobby maps can't be previewed yet" : "finish its checklist first"}`, 2, false), icon: ICONS.play },
  ];
}

/** Search: the lobby and each game, with how many maps each has. */
export function targetEntries(catalog: Catalog): { target: string; text: string }[] {
  return catalog.targets.map((target) => {
    const count = target.maps.length;
    return { target: target.id, text: `${target.name}\n§7${count === 0 ? "no maps yet" : `${count} map${count === 1 ? "" : "s"}`}` };
  });
}

/** A target's maps, drafts marked. */
export function mapEntries(target: Catalog["targets"][number]): { map: string; text: string }[] {
  return target.maps.map((map) => ({ map: map.id, text: `${map.name} (${map.id})\n§7${map.draft ? "draft" : "ready for games"}` }));
}

/** New map: the client's worlds (how many maps came from each), then an empty world. */
export function worldEntries(catalog: Catalog): { world?: string; text: string }[] {
  const entries: { world?: string; text: string }[] = catalog.worlds.map((world) => ({
    world: world.id,
    text: `${world.name}\n§7${world.maps === 0 ? "no maps from it yet" : `${world.maps} map${world.maps === 1 ? "" : "s"} from it`}`,
  }));
  entries.push({ text: "Empty world\n§7a glass pad in the void, for a quick test map" });
  return entries;
}

/** Why opening `request` should be confirmed: who it moves off a server that has something else open. */
export function switchWarning(state: HomeState, request: RecentEntry["request"]): string | undefined {
  if (request.to === "preview") {
    const select = state.servers.select;
    if (!select || select.players.length === 0) return undefined;
    const who = select.players.length === 1 ? `${select.players[0]} is` : `${select.players.length} players are`;
    return `${who} in Select on ${select.label}. Select closes while the preview runs: map editors wait in the editor lobby, and Select opens again when it ends.`;
  }
  const mode = request.to === "edit" ? "Edit" : "Select";
  const info = request.to === "edit" ? state.servers.edit : state.servers.select;
  if (!info || openKey(info.request) === openKey(request) || info.players.length === 0) return undefined;
  const who = info.players.length === 1 ? `${info.players[0]} is` : `${info.players.length} players are`;
  const saves = request.to === "edit" ? " (it saves first)" : "";
  return `${who} in ${mode} on ${info.label}. They wait in the editor lobby while ${mode} switches${saves}, then come back with you.`;
}

/**
 * What a guest in the editor lobby sees: the preview or Select loading, or waiting for one (the
 * host moves them as soon as one is ready).
 */
export function guestWaitText(servers: HomeState["servers"]): string {
  const preview = servers.preview;
  if (preview) return `Loading the preview of ${preview.label}...\n\nYou'll be moved there as soon as it's ready.`;
  const select = servers.select;
  if (select) return `${select.state === "ready" ? "Moving you to" : "Loading"} ${select.label} (Select)...\n\nYou'll be moved there as soon as it's ready.`;
  return "Waiting for the map editor to open Select or start a preview.\n\nYou'll be moved there as soon as one is ready.";
}

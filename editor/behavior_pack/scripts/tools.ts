// The map editor's tools, as plain data. Each is an item a map editor picks from the map menu's
// tool grid: it goes in hotbar slot 1, unlocked, and only one tool is out at a time. A new tool
// adds a row here and gets its icon in the grid. The Game marker tool is only there for a game (or
// the lobby) whose config asks for points.

export type ToolId = "spawn" | "marker" | "region" | "killY" | "camera" | "snapshot" | "select";

export interface EditorTool {
  id: ToolId;
  /** The item (editor/behavior_pack/items). */
  item: string;
  /** Its icon in the map menu's grid: the item's texture. */
  icon: string;
  /** Its tooltip in the grid: the name, then a hint under it. */
  label: string;
  hint: string;
  /** How to use it, at the top of its settings in the map menu. */
  howTo: string;
}

export const EDITOR_TOOLS: EditorTool[] = [
  {
    id: "spawn",
    item: "minecade:spawn_tool",
    icon: "textures/items/spawn_tool",
    label: "Spawn tool",
    hint: "spawns, spectator and queue spawns",
    howTo: "Use it on a block to place a spawn exactly where you aim: a spawn (with its team, in a team game), the spectator spawn or the queue spawn. Hit a marker to change it.",
  },
  {
    id: "marker",
    item: "minecade:marker_tool",
    icon: "textures/items/marker_tool",
    label: "Game marker tool",
    hint: "the game's own markers",
    howTo: "Use it on a block to place one of the game's markers (picked in its screen's Marker list, with its team when it has one) exactly where you aim. Hit a marker to change it.",
  },
  {
    id: "region",
    item: "minecade:region_tool",
    icon: "textures/items/region_tool",
    label: "Region tool",
    hint: "bounds, regions, kill regions",
    howTo: "Hit a block to start a box. Use the tool on blocks (up to 64 away) to grow the box to them. Save it here, in the map menu.",
  },
  {
    id: "killY",
    item: "minecade:kill_y_tool",
    icon: "textures/items/kill_y_tool",
    label: "Kill Y tool",
    hint: "the height players are out below",
    howTo: "Players below kill Y are out. Use the tool to set it one block below your feet; Set kill Y here fine-tunes it.",
  },
  {
    id: "camera",
    item: "minecade:camera_tool",
    icon: "textures/items/camera_tool",
    label: "Camera tool",
    hint: "pictures for the lobby",
    howTo: "Use it to place a camera at your eyes, looking where you look. Hit a camera to look through it and take its picture; right click it to change its kind or delete it.",
  },
  {
    id: "snapshot",
    item: "minecade:snapshot",
    icon: "textures/items/snapshot",
    label: "Snapshot tool",
    hint: "take a camera's picture",
    howTo: "Use it to pick a camera (or hit one with anything) and look through it. Frame the picture, take the screenshot (F1, F2, F1), use the tool again, then Use latest screenshot.",
  },
];

/** Select mode's only tool: boxes a map in a converted world. */
export const SELECT_TOOL: EditorTool = {
  id: "select",
  item: "minecade:select_tool",
  icon: "textures/items/select_tool",
  label: "Select tool",
  hint: "box a map to cut out",
  howTo: "Hit a block to start a box around a map. Use the tool on blocks (up to 64 away) to grow the box to them. Export it from the map menu.",
};

/** The tool an item is, if it is one (in either mode). */
export function toolOf(item: string): EditorTool | undefined {
  return [...EDITOR_TOOLS, SELECT_TOOL].find((tool) => tool.item === item);
}

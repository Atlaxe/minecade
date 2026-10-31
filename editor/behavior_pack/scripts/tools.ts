// The map editor's tools, as plain data. Each is an item a map editor picks from the map menu's
// tool grid: it goes in hotbar slot 1, unlocked, and only one tool is out at a time. A new tool
// adds a row here and gets its icon in the grid.

export type ToolId = "spawn" | "region" | "killY";

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
    hint: "spawns and points",
    howTo: "Use it where you stand to place an entry there, into the list picked below. Hit a marker to change it.",
  },
  {
    id: "region",
    item: "minecade:region_tool",
    icon: "textures/items/region_tool",
    label: "Region tool",
    hint: "bounds, regions, kill regions",
    howTo: "Hit a block to start a box. Use the tool on blocks (up to 64 away) to grow the box to them. Use it at the sky to save the box.",
  },
  {
    id: "killY",
    item: "minecade:kill_y_tool",
    icon: "textures/items/kill_y_tool",
    label: "Kill Y tool",
    hint: "the height players are out below",
    howTo: "Players below kill Y are out. Use the tool to set it one block below your feet.",
  },
];

/** The tool an item is, if it is one. */
export function toolOf(item: string): EditorTool | undefined {
  return EDITOR_TOOLS.find((tool) => tool.item === item);
}

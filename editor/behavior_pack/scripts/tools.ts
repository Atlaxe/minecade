// The map editor's tools, as plain data. Each is an item a map editor switches on from the map
// menu: it goes in hotbar slot 1, unlocked, and only one tool is out at a time. A new tool adds a
// row here and gets its switch in the menu.

export type ToolId = "spawn";

export interface EditorTool {
  id: ToolId;
  /** The item (editor/behavior_pack/items). */
  item: string;
  /** Its switch in the map menu: the name, then a hint under it. */
  label: string;
  hint: string;
}

export const EDITOR_TOOLS: EditorTool[] = [{ id: "spawn", item: "minecade:spawn_tool", label: "Spawn tool", hint: "spawns and points" }];

/** The tool an item is, if it is one. */
export function toolOf(item: string): EditorTool | undefined {
  return EDITOR_TOOLS.find((tool) => tool.item === item);
}

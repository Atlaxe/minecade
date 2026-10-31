import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapChecklist, stripColors, type MapConfig } from "@minecade/minigame-core/config";
import { LAYOUT, MARK, checklistBody, menuEntries, parseSetting, rowText, sideTitle, switchText } from "../behavior_pack/scripts/menu.ts";
import { EDITOR_TOOLS, toolOf } from "../behavior_pack/scripts/tools.ts";

const draft: MapConfig = { name: "Arena", draft: true, spawns: [[0, 65, 0]], build: { commands: ["fill 0 64 0 1 64 1 stone"] }, bounds: { min: [-5, 60, -5], max: [5, 70, 5] } };

describe("map menu", () => {
  it("offers undo and redo only when there is something to undo or redo, and Mark ready only for drafts", () => {
    const checklist = mapChecklist(draft, { kind: "game", maxPlayers: 2 });
    const entries = menuEntries({ config: draft, checklist, tools: [], undo: "add spawns", saveWorld: false });
    expect(entries.map((entry) => entry.action)).toEqual(["checklist", "tool", "tool", "tool", "regions", "undo", "markReady", "settings", "saveWorld", "dropBuild"]);
    expect(entries[0].text).toBe("Checklist (0 of 1)\n§c1 problem");
    expect(entries.find((entry) => entry.action === "markReady")?.text).toContain("finish the checklist first");
    const ready = { ...draft, draft: undefined, build: undefined, spawns: [[0, 65, 0], [1, 65, 0]] } as MapConfig;
    const actions = menuEntries({ config: ready, checklist: mapChecklist(ready, { kind: "game", maxPlayers: 2 }), tools: [], redo: "add spawns", saveWorld: true }).map((entry) => entry.action);
    expect(actions).toEqual(["checklist", "tool", "tool", "tool", "regions", "redo", "settings", "saveWorld"]);
  });

  it("offers the player's selection, and the map's boxes when it has any, after the tools", () => {
    const bare: MapConfig = { name: "Void", spawns: [[0, 65, 0]] };
    const view = (config: MapConfig, selection?: string) =>
      menuEntries({ config, checklist: mapChecklist(config, { kind: "game", maxPlayers: 1 }), tools: ["region"], saveWorld: false, selection });
    expect(view(bare).map((entry) => entry.action)).toEqual(["checklist", "tool", "tool", "tool", "settings", "saveWorld"]);
    const boxes: MapConfig = { ...bare, bounds: { min: [-5, 50, -5], max: [5, 70, 5] }, regions: { kill: [{ min: [0, 50, 0], max: [1, 51, 1] }, { min: [2, 50, 2], max: [3, 51, 3] }] } };
    const entries = view(boxes, "12 x 5 x 30");
    expect(entries.map((entry) => entry.action).slice(4, 6)).toEqual(["selection", "regions"]);
    expect(entries.find((entry) => entry.action === "selection")?.text).toBe("Selection\n§712 x 5 x 30: save or nudge it");
    expect(entries.find((entry) => entry.action === "regions")?.text).toBe("Bounds and regions (3)\n§7edit, nudge, go to, delete");
  });

  it("shows every tool and the world as switches, on while they're on", () => {
    const checklist = mapChecklist(draft, { kind: "game", maxPlayers: 2 });
    const off = menuEntries({ config: draft, checklist, tools: [], saveWorld: false });
    const on = menuEntries({ config: draft, checklist, tools: ["spawn"], saveWorld: true });
    expect(off.filter((entry) => entry.action === "tool").map((entry) => entry.tool)).toEqual(EDITOR_TOOLS.map((tool) => tool.id));
    expect(off.find((entry) => entry.tool === "spawn")?.text).toBe(`${MARK.toggle}Spawn tool\n§7spawns and points`);
    expect(on.find((entry) => entry.tool === "spawn")?.text).toBe(`${MARK.toggle}${MARK.on}Spawn tool\n§7spawns and points`);
    expect(off.find((entry) => entry.action === "saveWorld")?.text).toBe(switchText("Save the world at stop", "kept as it was", false));
    expect(on.find((entry) => entry.action === "saveWorld")?.text).toBe(switchText("Save the world at stop", "block changes are kept", true));
  });

  it("knows each tool by its item", () => {
    expect(toolOf("minecade:spawn_tool")?.id).toBe("spawn");
    expect(toolOf("minecade:region_tool")?.id).toBe("region");
    expect(toolOf("minecade:kill_y_tool")?.id).toBe("killY");
    expect(toolOf("minecade:map_menu")).toBeUndefined();
  });

  it("shows checklist rows and problems", () => {
    const checklist = mapChecklist(draft, { kind: "game", maxPlayers: 2 });
    expect(rowText(checklist.rows[0])).toBe("§cSpawns\n§71 of 2");
    expect(checklistBody(checklist)).toContain("§c- needs at least 2 spawns (one per player slot), has 1");
  });

  it("reads game settings as the type they had", () => {
    expect(parseSetting(" 50 ", 58)).toBe(50);
    expect(parseSetting("", 58)).toBeUndefined();
    expect(parseSetting("ten", 58)).toBeUndefined();
    expect(parseSetting("TRUE", false)).toBe(true);
    expect(parseSetting("yes", false)).toBeUndefined();
    expect(parseSetting(" red ", "blue")).toBe(" red ");
  });
});

describe("side layout", () => {
  const pack = (file: string) => readFileSync(new URL(`../resource_pack/ui/${file}`, import.meta.url), "utf8");

  it("uses marks the editor's resource pack knows, and that never render", () => {
    for (const mark of Object.values(LAYOUT)) {
      expect(stripColors(mark)).toBe("");
      expect(pack("server_form.json")).toContain(`'${mark}'`);
      expect(pack("editor_forms.json")).toContain(`'${mark}'`);
    }
    for (const mark of Object.values(MARK)) {
      expect(stripColors(mark)).toBe("");
      expect(pack("editor_forms.json")).toContain(`'${mark}'`);
    }
    expect(stripColors(sideTitle("Map menu"))).toBe("Map menu");
  });
});

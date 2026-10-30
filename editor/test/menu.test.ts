import { describe, expect, it } from "vitest";
import { mapChecklist, type MapConfig } from "@minecade/minigame-core/config";
import { checklistBody, menuEntries, parseSetting, rowText } from "../behavior_pack/scripts/menu.ts";

const draft: MapConfig = { name: "Arena", draft: true, spawns: [[0, 65, 0]], build: { commands: ["fill 0 64 0 1 64 1 stone"] }, bounds: { min: [-5, 60, -5], max: [5, 70, 5] } };

describe("map menu", () => {
  it("offers undo and redo only when there is something to undo or redo, and Mark ready only for drafts", () => {
    const checklist = mapChecklist(draft, { kind: "game", maxPlayers: 2 });
    const entries = menuEntries({ config: draft, checklist, undo: "add spawns", saveWorld: false });
    expect(entries.map((entry) => entry.action)).toEqual(["checklist", "spawnTool", "undo", "markReady", "settings", "saveWorld", "dropBuild"]);
    expect(entries[0].text).toBe("Checklist (0 of 1)\n§c1 problem");
    expect(entries.find((entry) => entry.action === "markReady")?.text).toContain("finish the checklist first");
    const ready = { ...draft, draft: undefined, build: undefined, spawns: [[0, 65, 0], [1, 65, 0]] } as MapConfig;
    const actions = menuEntries({ config: ready, checklist: mapChecklist(ready, { kind: "game", maxPlayers: 2 }), redo: "add spawns", saveWorld: true }).map((entry) => entry.action);
    expect(actions).toEqual(["checklist", "spawnTool", "redo", "settings", "saveWorld"]);
  });

  it("shows checklist rows and problems", () => {
    const checklist = mapChecklist(draft, { kind: "game", maxPlayers: 2 });
    expect(rowText(checklist.rows[0])).toBe("§4Spawns\n§81 of 2");
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

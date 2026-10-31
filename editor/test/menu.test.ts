import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapChecklist, stripColors, type MapConfig } from "@minecade/minigame-core/config";
import { spawnLists } from "../behavior_pack/scripts/lists.ts";
import { COLUMNS, LAYOUT, MARK, dangerText, headingText, mapTitle, sideTitle, switchText } from "../behavior_pack/scripts/marks.ts";
import {
  ICONS,
  checklistBody,
  killYSettings,
  mapMenuBody,
  mapMenuEntries,
  markReadyText,
  parseSetting,
  regionSettings,
  rowText,
  spawnSettings,
  type MapMenuView,
} from "../behavior_pack/scripts/menu.ts";
import { regionEntries } from "../behavior_pack/scripts/regions.ts";
import { EDITOR_TOOLS, toolOf } from "../behavior_pack/scripts/tools.ts";

const rules = { kind: "game" as const, maxPlayers: 2 };
const draft: MapConfig = { name: "Arena", draft: true, spawns: [[0, 65, 0]], build: { commands: ["fill 0 64 0 1 64 1 stone"] }, bounds: { min: [-5, 60, -5], max: [5, 70, 5] } };

function view(config: MapConfig, extra: Partial<MapMenuView> = {}): MapMenuView {
  return {
    config,
    checklist: mapChecklist(config, rules),
    unsaved: false,
    saving: false,
    spawn: { lists: spawnLists(config, rules), settings: { list: "spawns", keepFacing: false, snap: "exact" } },
    region: { entries: regionEntries(config, rules) },
    ...extra,
  };
}

describe("map menu", () => {
  it("has the quick icons, then the tools, then Save, with no tool out", () => {
    const entries = mapMenuEntries(view(draft));
    expect(entries.map((entry) => entry.action.kind)).toEqual(["checklist", "undo", "redo", "settings", "tool", "tool", "tool", "save"]);
    expect(entries[0].text).toBe(`${MARK.pill}0/1\n§7Checklist: 1 problem`);
    expect(entries[0].icon).toBe(ICONS.check);
    expect(entries.at(-1)?.text).toBe(`${MARK.save}Save\nthe map and the world`);
  });

  it("dims Undo and Redo when there's nothing to undo or redo", () => {
    const [, undo, redo] = mapMenuEntries(view(draft, { undo: "add spawns" }));
    expect(undo.text).toBe(`${MARK.quick}Undo\n§7add spawns`);
    expect(redo.text).toBe(`${MARK.quick}${MARK.dim}Redo\n§7nothing to redo`);
  });

  it("puts each tool in a grid column with its icon, the one out marked", () => {
    const tools = mapMenuEntries(view(draft, { tool: "region" })).filter((entry) => entry.action.kind === "tool");
    expect(tools.map((entry) => entry.icon)).toEqual(EDITOR_TOOLS.map((tool) => tool.icon));
    expect(tools[0].text).toBe(`${MARK.tool}${COLUMNS[0]}Spawn tool\n§7spawns and points`);
    expect(tools[1].text).toBe(`${MARK.tool}${COLUMNS[1]}${MARK.on}Region tool\n§7bounds, regions, kill regions`);
  });

  it("shows the tool out's settings between the tools and Save", () => {
    const kinds = (tool: MapMenuView["tool"]) => mapMenuEntries(view({ ...draft, killY: 50 }, { tool })).map((entry) => entry.action.kind).slice(7, -1);
    expect(kinds("spawn")).toEqual(["none", "list", "list", "none", "keepFacing", "snap"]);
    expect(kinds("region")).toEqual(["none", "box"]);
    expect(kinds("killY")).toEqual(["none", "typeKillY", "removeKillY"]);
    expect(kinds(undefined)).toEqual([]);
  });

  it("says how to use the tool out, under the map", () => {
    expect(mapMenuBody("Sumo", "arena_1", draft, undefined)).toBe("Arena (arena_1), Sumo, draft\n\n§fPick a tool above. Hit a marker to change it.");
    expect(mapMenuBody("Sumo", "arena_1", draft, "region")).toContain("Hit a block to start a box.");
  });

  it("says when blocks changed since the last save, and while saving", () => {
    expect(mapMenuEntries(view(draft, { unsaved: true })).at(-1)?.text).toBe(`${MARK.save}Save\nunsaved block changes`);
    expect(mapMenuEntries(view(draft, { saving: true })).at(-1)?.text).toBe(`${MARK.save}Saving...\nthe map and the world`);
  });

  it("knows each tool by its item", () => {
    expect(toolOf("minecade:spawn_tool")?.id).toBe("spawn");
    expect(toolOf("minecade:region_tool")?.id).toBe("region");
    expect(toolOf("minecade:kill_y_tool")?.id).toBe("killY");
    expect(toolOf("minecade:map_menu")).toBeUndefined();
  });
});

describe("tool settings", () => {
  it("lists the spawn tool's lists with counts, the picked one marked, then facing", () => {
    const entries = spawnSettings(draft, mapChecklist(draft, rules), spawnLists(draft, rules), { list: "spectatorSpawn", keepFacing: true, snap: "45" });
    expect(entries.map((entry) => entry.text)).toEqual([
      headingText("Place into"),
      "Spawns\n§71 of 2",
      `${MARK.picked}Spectator spawn\n§70`,
      headingText("Facing"),
      switchText("Save my facing", "the way you look", true),
      "Snap: 45 degrees\n§7tap for Exact or 90 degrees",
    ]);
  });

  it("offers the selection's actions, then the map's boxes", () => {
    const boxes = regionEntries(draft, rules);
    const entries = regionSettings({ box: { min: [0, 60, 0], max: [11, 64, 29] }, editing: "Bounds", steps: 1 }, boxes, 58);
    expect(entries.map((entry) => entry.text)).toEqual([
      headingText("Selection: 12 x 5 x 30"),
      "Save changes\n§7to Bounds",
      "Save as...\n§7bounds, a region or a kill region",
      "Nudge sides",
      "Floor at kill Y\n§7bottom at y 58",
      "Back one step",
      dangerText("Clear selection"),
      headingText("Bounds and regions (1)"),
      "Bounds\n§711 x 11 x 11: edit, nudge, go to, delete",
    ]);
    expect(entries.at(-1)?.action).toEqual({ kind: "box", key: "bounds" });
    expect(regionSettings(undefined, [], undefined).map((entry) => entry.text)).toEqual([headingText("No bounds or regions yet")]);
  });

  it("offers removing kill Y only when it's set", () => {
    expect(killYSettings(undefined).map((entry) => entry.text)).toEqual([headingText("Kill Y: not set"), "Type a height"]);
    expect(killYSettings(58).map((entry) => entry.text)).toEqual([headingText("Kill Y: 58"), "Type a height", dangerText("Remove kill Y")]);
  });
});

describe("checklist", () => {
  it("shows checklist rows, problems, and Mark ready", () => {
    const checklist = mapChecklist(draft, rules);
    expect(rowText(checklist.rows[0])).toBe("§cSpawns\n§71 of 2");
    expect(checklistBody(checklist)).toContain("§c- needs at least 2 spawns (one per player slot), has 1");
    expect(markReadyText(checklist)).toBe("Mark ready\n§7finish the checklist first");
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

describe("layouts", () => {
  const pack = (file: string) => readFileSync(new URL(`../resource_pack/ui/${file}`, import.meta.url), "utf8");

  it("uses marks the editor's resource pack knows, and that never render", () => {
    for (const mark of Object.values(LAYOUT)) {
      expect(stripColors(mark)).toBe("");
      expect(pack("server_form.json")).toContain(`'${mark}'`);
      expect(pack("editor_forms.json")).toContain(`'${mark}'`);
    }
    for (const mark of [...Object.values(MARK), ...COLUMNS]) {
      expect(stripColors(mark)).toBe("");
      expect(pack("editor_forms.json")).toContain(`'${mark}'`);
    }
    expect(stripColors(sideTitle("Checklist"))).toBe("Checklist");
    expect(stripColors(mapTitle("Map menu"))).toBe("Map menu");
  });

  it("never lets one mark read as another", () => {
    const marks = [...Object.values(MARK), ...COLUMNS];
    for (const mark of marks) for (const other of marks) if (mark !== other) expect(other.includes(mark)).toBe(false);
  });
});

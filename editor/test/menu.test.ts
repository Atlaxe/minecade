import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapChecklist, stripColors, type HomeState, type MapConfig } from "@minecade/minigame-core/config";
import { spawnLists } from "../behavior_pack/scripts/lists.ts";
import { COLUMNS, LAYOUT, MARK, dangerText, headingText, mapTitle, sideTitle, switchText } from "../behavior_pack/scripts/marks.ts";
import {
  ICONS,
  LOBBY_TEXT,
  checklistBody,
  homeEntries,
  mapActions,
  mapEntries,
  mapIdFrom,
  killYSettings,
  mapMenuBody,
  mapMenuEntries,
  parseCountdown,
  publishBody,
  publishText,
  queueActions,
  parseSetting,
  regionSettings,
  rowText,
  selectMenuBody,
  selectMenuEntries,
  spawnSettings,
  statusLine,
  switchWarning,
  targetEntries,
  worldEntries,
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
    spawn: { lists: spawnLists(config, rules), settings: { list: "spawns", center: false, keepFacing: false, snap: "exact" } },
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
    expect(kinds("spawn")).toEqual(["none", "list", "list", "list", "none", "center", "none", "keepFacing", "snap"]);
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
    const entries = spawnSettings(draft, mapChecklist(draft, rules), spawnLists(draft, rules), { list: "spectatorSpawn", center: true, keepFacing: true, snap: "45" });
    expect(entries.map((entry) => entry.text)).toEqual([
      headingText("Place into"),
      "Spawns\n§71 of 2",
      `${MARK.picked}Spectator spawn\n§70`,
      "Queue spawn\n§70",
      headingText("Position"),
      switchText("Center on block", "the middle of the block", true),
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
  it("shows checklist rows, problems, and Publish", () => {
    const checklist = mapChecklist(draft, rules);
    expect(rowText(checklist.rows[0])).toBe("§cSpawns\n§71 of 2");
    expect(checklistBody(checklist)).toContain("§c- needs at least 2 spawns (one per player slot), has 1");
    expect(publishText(checklist, true, false)).toBe("Publish\n§7finish the checklist first");
    const done = mapChecklist({ ...draft, spawns: [[0, 65, 0], [2, 65, 0]] }, rules);
    expect(done.ready).toBe(true);
    expect(publishText(done, true, false)).toBe("Publish\n§7put it in the lobby: commit and push");
    expect(publishText(done, false, false)).toBe("Publish changes\n§7commit and push this version");
    expect(publishText(done, false, true)).toBe("Publishing...\n§7saving, then commit and push");
  });

  it("says what Publish does, and where the map shows", () => {
    const body = publishBody("sumo", "Sumo", "castle", { ...draft, name: "Castle" });
    expect(body.split("\n")[0]).toBe("Publish Castle (castle) for Sumo?");
    expect(body).toContain("committed (\"Automated Map Build\") and pushed to GitHub");
    expect(body).toContain("It stops being a draft, and it's in Sumo's map list in the lobby from the network's next start.");
    expect(publishBody("lobby", "Lobby", "space", { name: "Space", spawns: [] })).toContain("\nthe Panel's lobby map picker has it");
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

describe("Select mode's map menu", () => {
  const box = { min: [96, -64, -80] as [number, number, number], max: [207, 0, 47] as [number, number, number] };
  const ready = { target: "sumo", targetName: "Sumo", map: "castle", name: "Castle", box, status: "ready" as const };
  const failed = { ...ready, map: "keep", name: "Keep", status: "failed" as const, error: "Chunker stopped" };

  it("has the Select tool, the selection's actions, then the maps from the world", () => {
    const entries = selectMenuEntries({ world: "Arenas", toolOut: true, selection: { box, steps: 1 }, maps: [ready, failed] });
    expect(entries.map((entry) => entry.action)).toEqual([
      { kind: "tool", tool: "select" },
      { kind: "none" },
      { kind: "pick", action: "saveMap" },
      { kind: "pick", action: "nudge" },
      { kind: "pick", action: "back" },
      { kind: "pick", action: "clear" },
      { kind: "none" },
      { kind: "map", target: "sumo", map: "castle" },
      { kind: "map", target: "sumo", map: "keep" },
      { kind: "none" },
      { kind: "lobby" },
    ]);
    expect(entries[0].text).toBe(`${MARK.tool}${COLUMNS[0]}${MARK.on}Select tool\n§7box a map to cut out`);
    expect(entries[1].text).toBe(headingText("Selection: 112 x 65 x 128"));
    expect(entries.at(-4)?.text).toBe("Castle (castle)\n§7Sumo: §aready: tap to edit it");
    expect(selectMenuEntries({ world: "Arenas", toolOut: false, maps: [] }).map((entry) => entry.text)).toEqual([
      `${MARK.tool}${COLUMNS[0]}Select tool\n§7box a map to cut out`,
      headingText("No maps from this world yet"),
      headingText("Elsewhere"),
      LOBBY_TEXT,
    ]);
  });

  it("says how each extraction is going, and offers what fits", () => {
    expect(statusLine({ ...ready, status: "extracting" })).toBe("§ebeing cut out...");
    expect(mapActions(ready).map((entry) => entry.action)).toEqual(["edit", "update", "forget"]);
    expect(mapActions(ready)[1].text).toContain(MARK.danger);
    expect(mapActions(failed).map((entry) => entry.action)).toEqual(["retry", "forget"]);
    expect(mapActions({ ...ready, status: "queued" })).toEqual([]);
    expect(selectMenuBody("Arenas", false)).toBe('Select mode on "Arenas"\n\n§fPick the Select tool above.');
  });
});

describe("the editor lobby's menu", () => {
  const empty: HomeState = {
    catalog: {
      targets: [
        { id: "lobby", name: "Lobby", maps: [{ id: "spaceship", name: "Spaceship", draft: false }] },
        { id: "sumo", name: "Sumo", maps: [] },
      ],
      worlds: [
        { id: "abc=", name: "Datapacking (imported)", maps: 2 },
        { id: "def=", name: "My World", maps: 0 },
      ],
      recent: [],
    },
    servers: { waiting: [] },
  };
  const arena = { to: "edit" as const, target: "sumo", map: "arena_1" };
  const datapacking = { to: "select" as const, world: "abc=" };

  it("offers Open a map and New map when nothing is open", () => {
    expect(homeEntries(empty).map((entry) => entry.action)).toEqual([{ kind: "none" }, { kind: "maps" }, { kind: "new" }]);
  });

  it("puts what's open first, then recent maps and worlds that aren't open", () => {
    const state: HomeState = {
      catalog: {
        ...empty.catalog,
        recent: [
          { request: arena, label: "Sumo: Arena (arena_1)" },
          { request: datapacking, label: "Datapacking (imported)" },
          { request: { to: "edit", target: "lobby", map: "spaceship" }, label: "Lobby: Spaceship (spaceship)" },
        ],
      },
      servers: { edit: { request: arena, label: "Sumo: Arena (arena_1)", state: "ready", players: ["Friend"] }, waiting: [] },
    };
    const entries = homeEntries(state);
    expect(entries.map((entry) => entry.action)).toEqual([
      { kind: "none" },
      { kind: "open", request: arena },
      { kind: "none" },
      { kind: "open", request: datapacking },
      { kind: "open", request: { to: "edit", target: "lobby", map: "spaceship" } },
      { kind: "none" },
      { kind: "maps" },
      { kind: "new" },
    ]);
    expect(entries[1].text).toBe("Sumo: Arena (arena_1)\n§7Edit: open: Friend");
    expect(entries[3].text).toBe("Datapacking (imported)\n§7box maps in this world");
  });

  it("lists targets, maps and worlds, with an empty world last", () => {
    expect(targetEntries(empty.catalog).map((entry) => stripColors(entry.text))).toEqual(["Lobby\n1 map", "Sumo\nno maps yet"]);
    expect(mapEntries(empty.catalog.targets[0])).toEqual([{ map: "spaceship", text: "Spaceship (spaceship)\n§7ready for games" }]);
    expect(worldEntries(empty.catalog).map((entry) => entry.world)).toEqual(["abc=", "def=", undefined]);
    expect(worldEntries(empty.catalog)[0].text).toBe("Datapacking (imported)\n§72 maps from it");
  });

  it("asks before moving others off a server that has something else open", () => {
    const busy: HomeState = { ...empty, servers: { edit: { request: arena, label: "Sumo: Arena (arena_1)", state: "ready", players: ["Friend"] }, waiting: [] } };
    expect(switchWarning(busy, { to: "edit", target: "sumo", map: "castle" })).toBe(
      "Friend is in Edit on Sumo: Arena (arena_1). They wait in the editor lobby while Edit switches (it saves first), then come back with you.",
    );
    expect(switchWarning(busy, arena)).toBeUndefined();
    expect(switchWarning(busy, datapacking)).toBeUndefined();
    expect(switchWarning({ ...busy, servers: { edit: { ...busy.servers.edit!, players: [] }, waiting: [] } }, { to: "edit", target: "sumo", map: "castle" })).toBeUndefined();
  });

  it("makes map ids from names", () => {
    expect(mapIdFrom("Castle Keep!")).toBe("castle_keep");
  });
});

describe("the queue spawn's marker", () => {
  it("adds Lock in and the countdown to its form", () => {
    expect(queueActions({ name: "M", spawns: [], queueSpawn: [0, 80, 30] })).toEqual([
      { action: "queueMode", text: switchText("Lock in", "look around, can't move, invisible", true) },
      { action: "queueCountdown", text: "Countdown: 5 s\n§7once everyone's in, before the spawns" },
    ]);
    expect(queueActions({ name: "M", spawns: [], queueSpawn: [0, 80, 30], queue: { mode: "free", countdown: 12 } })[0].text).toBe(
      switchText("Lock in", "off: free to roam", false),
    );
  });

  it("reads a typed countdown as whole seconds within the limits", () => {
    expect(parseCountdown(" 10 ")).toBe(10);
    for (const text of ["", "0", "61", "2.5", "ten"]) expect(parseCountdown(text)).toBeUndefined();
  });
});

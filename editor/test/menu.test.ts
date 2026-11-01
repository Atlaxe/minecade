import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapChecklist, stripColors, type HomeState, type MapConfig } from "@minecade/minigame-core/config";
import { DANGER_BUTTON, SIDE_TITLE } from "../../packages/minigame-core/src/game/preview.ts";
import { spawnLists } from "../behavior_pack/scripts/lists.ts";
import { COLUMNS, LAYOUT, LOADING, MARK, SEGMENT_COLUMNS, dangerText, goText, headingText, homeTitle, iconsTitle, linkText, loadingTitle, mapTitle, saveBarText, segmentText, sideTitle, stepTileText, switchText } from "../behavior_pack/scripts/marks.ts";
import {
  BACK_TEXT,
  ICONS,
  LOBBY_TEXT,
  PLAYERS_TEXT,
  RECENT_KINDS,
  SELECT_HELP,
  boundaryEntries,
  editBody,
  exportEntries,
  facingLine,
  gearEntries,
  nudgeEntries,
  guestEntries,
  guestWaitText,
  cameraScreenEntries,
  checklistBody,
  entryScreenEntries,
  killYScreenEntries,
  regionScreenEntries,
  homeEntries,
  mapActions,
  mapEntries,
  mapIdFrom,
  killYSettings,
  mapMenuEntries,
  parseCountdown,
  publishBody,
  publishText,
  parseSetting,
  regionSettings,
  rowText,
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
    expect(entries.map((entry) => entry.action.kind)).toEqual(["checklist", "undo", "redo", "boundaries", "settings", "tool", "tool", "tool", "tool", "save"]);
    expect(entries[3]).toEqual({ action: { kind: "boundaries" }, text: `${MARK.quick}Boundaries\n§7see the bounds and regions you pick`, icon: ICONS.boundaries });
    expect(entries[0].text).toBe(`${MARK.pill}0/1\n§7Checklist: 1 problem`);
    expect(entries[0].icon).toBe(ICONS.check);
    expect(entries.at(-1)?.text).toBe(`${MARK.save}Save\n§7saves the map and the world`);
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

  it("shows the tool out's settings, after a Help link, between the tools and Save", () => {
    const kinds = (tool: MapMenuView["tool"]) => mapMenuEntries(view({ ...draft, killY: 50 }, { tool })).map((entry) => entry.action.kind).slice(9, -1);
    // Spawn: Help, then each list with its entries (Spawns has one, the spectator and queue spawns none).
    expect(kinds("spawn")).toEqual(["help", "none", "entry", "none", "none"]);
    expect(kinds("region")).toEqual(["help", "none", "box"]);
    expect(kinds("killY")).toEqual(["help", "none", "killY", "removeKillY"]);
    expect(kinds(undefined)).toEqual([]);
    expect(mapMenuEntries(view(draft, { tool: "spawn" }))[9].text).toBe(linkText("Help"));
  });

  it("keeps whether blocks changed in Save's tooltip, and says when it's saving", () => {
    expect(mapMenuEntries(view(draft, { unsaved: true })).at(-1)?.text).toBe(`${MARK.save}Save\n§7blocks changed since the last save`);
    expect(mapMenuEntries(view(draft, { saving: true })).at(-1)?.text).toBe(`${MARK.save}Saving...\n§7the map and the world`);
  });

  it("knows each tool by its item", () => {
    expect(toolOf("minecade:spawn_tool")?.id).toBe("spawn");
    expect(toolOf("minecade:region_tool")?.id).toBe("region");
    expect(toolOf("minecade:kill_y_tool")?.id).toBe("killY");
    expect(toolOf("minecade:camera_tool")?.id).toBe("camera");
    expect(toolOf("minecade:map_menu")).toBeUndefined();
  });
});

describe("the Players menu", () => {
  it("has Invite, then each guest and where they are", () => {
    expect(guestEntries([{ name: "Friend", on: "select" }, { name: "Pal" }, { name: "Mate", on: "home" }, { name: "Bud", on: "preview" }])).toEqual([
      { text: "Invite a player...\n§7by gamertag" },
      { name: "Friend", text: `${MARK.twoLine}Friend\n§7on Select` },
      { name: "Pal", text: `${MARK.twoLine}Pal\n§7not on` },
      { name: "Mate", text: `${MARK.twoLine}Mate\n§7waiting in the editor lobby` },
      { name: "Bud", text: `${MARK.twoLine}Bud\n§7in the preview` },
    ]);
    expect(PLAYERS_TEXT).toBe(`${MARK.quick}Players\n§7invite friends to Select and previews`);
  });

  it("tells a guest in the editor lobby what they wait for", () => {
    const select = { request: { to: "select" as const, world: "w" }, label: "Arenas", state: "ready" as const, players: [] };
    expect(guestWaitText({ waiting: [] })).toContain("Waiting for the map editor to open Select or start a preview.");
    expect(guestWaitText({ waiting: [], select })).toContain("Moving you to Arenas (Select)...");
    expect(guestWaitText({ waiting: [], select: { ...select, state: "starting" } })).toContain("Loading Arenas (Select)...");
    expect(guestWaitText({ waiting: [], preview: { label: "Sumo: Arena", state: "starting" } })).toContain("Loading the preview of Sumo: Arena...");
  });
});

describe("the Boundaries view", () => {
  it("has Show all, then a switch per boundary, on when it or all is on", () => {
    const rows = [
      { group: "bounds", label: "Bounds", detail: "white, 1 box" },
      { group: "killY", label: "Kill Y", detail: "red plane, y 50" },
    ];
    expect(boundaryEntries(rows, new Set(["killY"]))).toEqual([
      { group: "all", text: switchText("Show all", "every boundary on this map", false) },
      { group: "bounds", text: switchText("Bounds", "white, 1 box", false) },
      { group: "killY", text: switchText("Kill Y", "red plane, y 50", true) },
    ]);
    expect(boundaryEntries(rows, new Set(["all"])).every((entry) => entry.text.includes(MARK.on))).toBe(true);
  });
});

describe("tool settings", () => {
  it("lists every spawn and point the map has, by list (each opens its screen)", () => {
    const config: MapConfig = { ...draft, spawns: [[0, 65, 0], [3.5, 65, -2]], spectatorSpawn: [0, 80, 0] };
    const entries = spawnSettings(config, spawnLists(config, rules));
    expect(entries.map((entry) => entry.text)).toEqual([
      headingText("Spawns (2)"),
      "Spawn 1\n§70 65 0",
      "Spawn 2\n§73.5 65 -2",
      headingText("Spectator spawn"),
      "Spectator spawn\n§70 80 0",
      headingText("Queue spawn: none yet"),
    ]);
    expect(entries[2].action).toEqual({ kind: "entry", key: "spawns#1" });
  });

  it("offers saving or clearing the selection, then the map's boxes", () => {
    const boxes = regionEntries(draft, rules);
    const entries = regionSettings({ box: { min: [0, 60, 0], max: [11, 64, 29] }, editing: "Bounds", steps: 1 }, boxes);
    expect(entries.map((entry) => entry.text)).toEqual([
      headingText("Selection: 12 x 5 x 30"),
      goText("Save Bounds"),
      dangerText("Clear selection"),
      headingText("Bounds and regions (1)"),
      "Bounds\n§711 x 11 x 11: edit, nudge, go to, delete",
    ]);
    expect(entries.at(-1)?.action).toEqual({ kind: "box", key: "bounds#0" });
    expect(regionSettings(undefined, []).map((entry) => entry.text)).toEqual([headingText("No bounds or regions yet")]);
  });

  it("offers removing kill Y only when it's set", () => {
    expect(killYSettings(undefined).map((entry) => entry.text)).toEqual([headingText("Kill Y: not set"), goText("Set kill Y")]);
    expect(killYSettings(58).map((entry) => entry.text)).toEqual([headingText("Kill Y: 58"), goText("Set kill Y"), dangerText("Remove kill Y")]);
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
    for (const mark of [...Object.values(MARK), ...COLUMNS, ...SEGMENT_COLUMNS]) {
      expect(stripColors(mark)).toBe("");
      expect(pack("editor_forms.json")).toContain(`'${mark}'`);
    }
    expect(stripColors(LOADING)).toBe("");
    expect(pack("editor_forms.json")).toContain(`'${LOADING}'`);
    expect(stripColors(sideTitle("Checklist"))).toBe("Checklist");
    expect(stripColors(mapTitle("Map menu"))).toBe("Map menu");
    expect(stripColors(homeTitle("Map editor"))).toBe("Map editor");
    expect(stripColors(iconsTitle("Map menu"))).toBe("Map menu");
    expect(stripColors(loadingTitle("Loading"))).toBe("Loading");
    expect(loadingTitle("Loading").startsWith(LAYOUT.side)).toBe(true);
  });

  it("gives a preview's fake player confirm the side panel and a red button", () => {
    expect(SIDE_TITLE).toBe(LAYOUT.side);
    expect(DANGER_BUTTON).toBe(MARK.danger);
  });

  it("never lets one mark read as another", () => {
    const marks = [...Object.values(MARK), ...COLUMNS, ...SEGMENT_COLUMNS];
    for (const mark of marks) for (const other of marks) if (mark !== other) expect(other.includes(mark)).toBe(false);
    const titles = [...Object.values(LAYOUT), LOADING];
    for (const mark of titles) for (const other of titles) if (mark !== other) expect(other.includes(mark)).toBe(false);
  });

  it("has every icon the menus use in the pack", () => {
    for (const icon of Object.values(ICONS)) expect(readFileSync(new URL(`../resource_pack/${icon}.png`, import.meta.url)).length).toBeGreaterThan(0);
    expect(pack("editor_forms.json")).toContain("textures/minecade/editor/loading_dots");
  });
});

describe("Select mode's map menu", () => {
  const box = { min: [96, -64, -80] as [number, number, number], max: [207, 0, 47] as [number, number, number] };
  const ready = { target: "sumo", targetName: "Sumo", map: "castle", name: "Castle", box, status: "ready" as const };
  const failed = { ...ready, map: "keep", name: "Keep", status: "failed" as const, error: "Chunker stopped" };

  it("has the icon row (Back one step, Players, how-to), the selection, the maps, and Back to Lobby at the bottom", () => {
    const entries = selectMenuEntries({ selection: { box, steps: 1 }, maps: [ready, failed] });
    expect(entries.map((entry) => entry.action)).toEqual([
      { kind: "pick", action: "back" },
      { kind: "players" },
      { kind: "lobby" },
      { kind: "help" },
      { kind: "none" },
      { kind: "pick", action: "saveMap" },
      { kind: "pick", action: "nudge" },
      { kind: "pick", action: "clear" },
      { kind: "none" },
      { kind: "map", target: "sumo", map: "castle" },
      { kind: "map", target: "sumo", map: "keep" },
    ]);
    expect(entries.slice(0, 3).map((entry) => entry.icon)).toEqual([ICONS.undo, ICONS.players, ICONS.lobby]);
    expect(entries.slice(0, 2).every((entry) => entry.text.startsWith(MARK.quick))).toBe(true);
    // Back to Lobby is at the right end of the icon row; Help is a link that goes to chat.
    expect(entries[2].text).toBe(`${MARK.end}Back to Lobby`);
    expect(entries[3].text).toBe(linkText("Help"));
    expect(entries[0].text).toBe(`${MARK.quick}Back one step\n§7undo the selection's last change`);
    expect(entries[4].text).toBe(headingText("Selection: 112 x 65 x 128"));
    expect(entries[5].text).toBe(goText("Export to Map"));
    // A ready map is just its name; one that isn't says how it's going.
    expect(entries[9]).toEqual({ action: { kind: "map", target: "sumo", map: "castle" }, text: `${MARK.card}Castle (castle)`, icon: ICONS.edit });
    expect(entries[10].text).toBe(`${MARK.card}${MARK.twoLine}Keep (keep)\n§cfailed: tap for why`);
    const none = selectMenuEntries({ maps: [] });
    expect(none[0].text).toBe(`${MARK.quick}${MARK.dim}Back one step\n§7nothing to step back`);
    expect(none.slice(4).map((entry) => entry.text)).toEqual([headingText("No selection yet"), headingText("No maps from this world yet")]);
    expect(SELECT_HELP).not.toMatch(/stand inside/i);
  });

  it("asks before editing a ready map; a failed one can be tried again or taken off the list", () => {
    expect(statusLine({ ...ready, status: "extracting" })).toBe("§ebeing cut out...");
    expect(mapActions(ready)).toEqual([
      { action: "edit", text: goText("Edit") },
      { action: "cancel", text: "Cancel" },
    ]);
    expect(editBody(ready)).toBe("Castle (castle), a Sumo map, 112 x 65 x 128 blocks. It opens on the Edit server, and you're moved there.");
    expect(mapActions(failed).map((entry) => entry.action)).toEqual(["retry", "forget", "cancel"]);
    expect(mapActions(failed)[1].text).toContain(MARK.danger);
    expect(mapActions({ ...ready, status: "queued" })).toEqual([]);
  });

  it("exports with Name, Map id and For staying put, the targets scrolling, and Export pinned at the bottom", () => {
    const targets = [
      { id: "lobby", name: "Lobby" },
      { id: "sumo", name: "Sumo" },
    ];
    const blank = exportEntries({ name: "", target: "sumo" }, targets);
    expect(blank.map((entry) => entry.text)).toEqual([
      BACK_TEXT,
      `${MARK.fixed}Name: §8none yet`,
      `${MARK.fixed}Map id: §8from the name`,
      `${MARK.fixed}${headingText("For")}`,
      "Lobby",
      `${MARK.picked}Sumo`,
      saveBarText("Export to Map"),
    ]);
    expect(blank.map((entry) => entry.action.kind)).toEqual(["back", "name", "id", "none", "target", "target", "export"]);
    expect(blank[0].icon).toBe(ICONS.back);
    expect(exportEntries({ name: "Castle Keep", target: "lobby" }, targets).slice(1, 3).map((entry) => entry.text)).toEqual([`${MARK.fixed}Name: Castle Keep`, `${MARK.fixed}Map id: §8castle_keep`]);
    expect(exportEntries({ name: "Castle Keep", map: "keep", target: "lobby" }, targets)[2].text).toBe(`${MARK.fixed}Map id: keep`);
  });
});

describe("Nudge sides", () => {
  const sides = { west: 0, east: 2, down: 0, up: -1, north: 0, south: 0 };

  it("has a minus and a plus per side, the minus saying where the side is and how far it moved", () => {
    const entries = nudgeEntries({ sides, step: 1, facing: "north" });
    const minus = entries.filter((entry) => entry.text.startsWith(MARK.minus));
    const plus = entries.filter((entry) => entry.text.startsWith(MARK.plus));
    expect(minus.map((entry) => entry.text.slice(MARK.minus.length))).toEqual([
      "North (ahead): 0",
      "South (behind): 0",
      "West (left): 0",
      "East (right): +2",
      "Top: -1",
      "Bottom: 0",
    ]);
    expect(plus.map((entry) => entry.action)).toEqual(minus.map((entry) => ({ ...entry.action, by: 1 })));
    expect(minus.every((entry) => entry.icon === ICONS.minus) && plus.every((entry) => entry.icon === ICONS.new)).toBe(true);
    expect(entries[0]).toEqual({ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back });
    // Step is a toggle of tiles, the one in use green.
    expect(entries.slice(13).map((entry) => entry.text)).toEqual([stepTileText("1 block", 0, true), stepTileText("5 blocks", 1, false), stepTileText("10 blocks", 2, false), "Reset\n§7put every side back", saveBarText("Nudge")]);
    expect(entries[14].action).toEqual({ kind: "step", step: 5 });
  });

  it("says where each side is from the way the player faces, and leaves Reset out with nothing moved", () => {
    const unmoved = { west: 0, east: 0, down: 0, up: 0, north: 0, south: 0 };
    const entries = nudgeEntries({ sides: unmoved, step: 5, facing: "east" });
    expect(entries[1].text).toBe(`${MARK.minus}North (left): 0`);
    expect(entries[7].text).toBe(`${MARK.minus}East (ahead): 0`);
    expect(entries.slice(13).map((entry) => entry.text)).toEqual([stepTileText("1 block", 0, false), stepTileText("5 blocks", 1, true), stepTileText("10 blocks", 2, false), saveBarText("Nudge")]);
    expect(facingLine("west")).toBe("Facing West   + moves a side out, - moves it in");
  });
});

describe("Edit's gear", () => {
  it("has Players and Back to Lobby (right end) in its icon row, then the settings and the red ones", () => {
    expect(gearEntries({ build: true })).toEqual([
      { action: "back", text: BACK_TEXT, icon: ICONS.back },
      { action: "players", text: PLAYERS_TEXT, icon: ICONS.players },
      { action: "lobby", text: LOBBY_TEXT, icon: ICONS.lobby },
      { action: "settings", text: "Name and game settings" },
      { action: "dropBuild", text: dangerText("Drop build commands") },
      { action: "delete", text: dangerText("Delete map") },
    ]);
    expect(gearEntries({ build: false }).map((entry) => entry.action)).toEqual(["back", "players", "lobby", "settings", "delete"]);
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
  const arenaPreview = { to: "preview" as const, target: "sumo", map: "arena_1" };
  const iconRow = [
    { kind: "maps" },
    { kind: "new" },
    { kind: "players" },
    { kind: "filter", filter: "edit" },
    { kind: "filter", filter: "select" },
    { kind: "filter", filter: "preview" },
    { kind: "leave" },
  ];
  const withRecent: HomeState = {
    catalog: {
      ...empty.catalog,
      recent: [
        { request: arena, label: "Sumo: Arena (arena_1)" },
        { request: arenaPreview, label: "Sumo: Arena (arena_1)" },
        { request: datapacking, label: "Datapacking (imported)" },
        { request: { to: "edit", target: "lobby", map: "spaceship" }, label: "Lobby: Spaceship (spaceship)" },
      ],
    },
    servers: { edit: { request: arena, label: "Sumo: Arena (arena_1)", state: "ready", players: ["Friend"] }, waiting: [] },
  };

  it("starts with the icon row: Open a map, New map, Players, the Recent filters and Leave", () => {
    const entries = homeEntries(empty);
    expect(entries.slice(0, 7).map((entry) => entry.action)).toEqual(iconRow);
    expect(entries[0]).toEqual({ action: { kind: "maps" }, text: `${MARK.quick}Open a map\n§7the lobby's and every game's maps`, icon: ICONS.edit });
    expect(entries[1].icon).toBe(ICONS.new);
    expect(entries[2]).toEqual({ action: { kind: "players" }, text: PLAYERS_TEXT, icon: ICONS.players });
    expect(entries.slice(3, 6).map((entry) => entry.icon)).toEqual([ICONS.edit, ICONS.select, ICONS.play]);
    // The filters are a toggle of icon tiles, none on.
    expect(entries.slice(3, 6).map((entry) => entry.text.slice(0, 12))).toEqual(SEGMENT_COLUMNS.map((column) => `${MARK.segment}${column}`));
    expect(entries.slice(3, 6).every((entry) => entry.text.includes(MARK.iconOnly) && !entry.text.includes(MARK.on))).toBe(true);
    expect(entries[6]).toEqual({ action: { kind: "leave" }, text: `${MARK.end}Leave\n§7disconnect from the map editor`, icon: ICONS.leave });
    expect(entries.slice(7).map((entry) => entry.text)).toEqual([headingText("Recent"), headingText("§8Nothing opened yet")]);
  });

  it("puts what's open first, then Recent as cards with an icon for their kind", () => {
    const entries = homeEntries(withRecent).slice(7);
    expect(entries.map((entry) => entry.action)).toEqual([
      { kind: "none" },
      { kind: "open", request: arena },
      { kind: "none" },
      { kind: "open", request: arenaPreview },
      { kind: "open", request: datapacking },
      { kind: "open", request: { to: "edit", target: "lobby", map: "spaceship" } },
    ]);
    // Open now says only that it's loading or closing: not who's on it.
    expect(entries[1]).toEqual({ action: { kind: "open", request: arena }, text: `${MARK.card}Sumo: Arena (arena_1)`, icon: ICONS.edit });
    expect(entries.slice(3, 6).map((entry) => [entry.text, entry.icon])).toEqual([
      [`${MARK.card}Sumo: Arena (arena_1)`, ICONS.play],
      [`${MARK.card}Datapacking (imported)`, ICONS.select],
      [`${MARK.card}Lobby: Spaceship (spaceship)`, ICONS.edit],
    ]);
  });

  it("shows only one kind in Recent with its filter on, outlined", () => {
    const entries = homeEntries(withRecent, "preview");
    const filters = entries.filter((entry) => entry.action.kind === "filter");
    expect(filters.map((entry) => entry.text.includes(MARK.on))).toEqual([false, false, true]);
    expect(filters[2].text).toBe(segmentText("Recent: Preview only\n§7on: tap again to show everything", 2, true, true));
    const recent = entries.slice(entries.findIndex((entry) => entry.text === headingText("Recent: Preview only")));
    expect(recent.map((entry) => entry.action)).toEqual([{ kind: "none" }, { kind: "open", request: arenaPreview }]);
    // What's open stays listed; an empty kind says so.
    expect(homeEntries(withRecent, "select").some((entry) => entry.text === `${MARK.card}Sumo: Arena (arena_1)`)).toBe(true);
    expect(homeEntries(empty, "preview").map((entry) => entry.text)).toContain(headingText("§8No previews yet"));
    expect(RECENT_KINDS.map((kind) => kind.kind)).toEqual(["edit", "select", "preview"]);
  });

  it("shows five recent entries, or ten of one kind", () => {
    const recent = Array.from({ length: 12 }, (_, i) => ({ request: { to: "edit" as const, target: "sumo", map: `m${i}` }, label: `m${i}` }));
    const state: HomeState = { ...empty, catalog: { ...empty.catalog, recent } };
    const cards = (filter?: "edit") => homeEntries(state, filter).filter((entry) => entry.text.startsWith(MARK.card)).length;
    expect(cards()).toBe(5);
    expect(cards("edit")).toBe(10);
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
    expect(switchWarning(busy, arenaPreview)).toBeUndefined();
    const selecting: HomeState = { ...empty, servers: { select: { request: datapacking, label: "Datapacking (imported)", state: "ready", players: ["Friend"] }, waiting: [] } };
    expect(switchWarning(selecting, arenaPreview)).toBe(
      "Friend is in Select on Datapacking (imported). Select closes while the preview runs: map editors wait in the editor lobby, and Select opens again when it ends.",
    );
    expect(switchWarning({ ...busy, servers: { edit: { ...busy.servers.edit!, players: [] }, waiting: [] } }, { to: "edit", target: "sumo", map: "castle" })).toBeUndefined();
  });

  it("makes map ids from names", () => {
    expect(mapIdFrom("Castle Keep!")).toBe("castle_keep");
  });
});

describe("tool screens", () => {
  const lists = spawnLists(draft, rules);
  const at = { x: 3.25, y: 65, z: -2 };

  it("opens a spawn with the list toggle first, then position and facing, nudge rows, and Place at the bottom", () => {
    const entries = entryScreenEntries({ lists, list: "spawns", at, snap: "exact", center: false, step: 1 });
    expect(entries.slice(0, 3).map((entry) => entry.text)).toEqual([segmentText("Spawn", 0, true), segmentText("Spectator", 1, false), segmentText("Queue", 2, false)]);
    const lead = entries.filter((entry) => entry.text.startsWith(MARK.lead)).map((entry) => entry.text.slice(MARK.lead.length));
    expect(lead).toEqual([
      headingText("Position"),
      "3.25 65 -2\n§7tap to type a position",
      "Move here\n§7where you stand",
      switchText("Center on block", "the middle of the block, not the exact spot", false),
      headingText("Facing: the middle of the map"),
      "Take my facing\n§7the way you look now",
      "Snap: Exact\n§7tap for 45 degrees or 90 degrees",
    ]);
    const rows = entries.filter((entry) => entry.text.startsWith(MARK.minus)).map((entry) => entry.text.slice(MARK.minus.length));
    expect(rows).toEqual(["X (east +): 3.25", "Y (up +): 65", "Z (south +): -2"]);
    expect(entries.at(-1)?.text).toBe(saveBarText("Place Spawn"));
    expect(entries.some((entry) => entry.action.kind === "delete")).toBe(false);
  });

  it("offers the queue's settings, Renumber and Delete on one the map has, and Save at the bottom", () => {
    const entries = entryScreenEntries({ lists, list: "queueSpawn", at, facing: { yaw: 180, pitch: 0 }, snap: "90", center: true, step: 0.5, existing: { index: 0, count: 2 }, queue: { mode: "lock", countdown: 5 } });
    const kinds = entries.map((entry) => entry.action.kind);
    expect(kinds).toContain("unface");
    expect(kinds).toContain("queueMode");
    expect(kinds.slice(-6)).toEqual(["step", "step", "step", "renumber", "delete", "save"]);
    expect(entries.filter((entry) => entry.action.kind === "step").map((entry) => entry.text)).toEqual([stepTileText("1 block", 0, false), stepTileText("0.5 blocks", 1, true), stepTileText("5 blocks", 2, false)]);
    expect(entries.at(-1)?.text).toBe(saveBarText("Save"));
  });

  it("saves a selection as a target picked on a toggle, with a name for a new region", () => {
    const targets = [
      { key: "bounds", label: "Bounds", kind: "bounds" as const },
      { key: "regions.kill", label: "Kill region", kind: "region" as const, name: "kill" },
      { key: "new", label: "New region...", kind: "new" as const },
    ];
    const box = { min: [0, 60, 0] as [number, number, number], max: [11, 64, 29] as [number, number, number] };
    const fresh = regionScreenEntries({ targets, target: "new", name: "", box, steps: 0, killY: 58, step: 1 });
    expect(fresh.slice(0, 3).map((entry) => entry.text)).toEqual([segmentText("Bounds", 0, false), segmentText("Kill region", 1, false), segmentText("New region", 2, true)]);
    expect(fresh.filter((entry) => entry.text.startsWith(MARK.lead)).map((entry) => entry.action.kind)).toEqual(["none", "name", "floor"]);
    expect(fresh.at(-1)?.text).toBe(saveBarText("Save"));
    const editing = regionScreenEntries({ targets, target: "editing", editing: "Bounds", name: "", box, steps: 2, step: 1 });
    expect(editing[0].text).toBe(segmentText("This box", 0, true));
    expect(editing.at(-1)?.text).toBe(saveBarText("Save Bounds"));
    expect(editing.filter((entry) => entry.text.startsWith(MARK.minus))).toHaveLength(6);
    // Back one step undoes, and the back arrow (opened from the map menu) leaves: two different actions.
    const fromMenu = regionScreenEntries({ targets, target: "editing", editing: "Bounds", name: "", box, steps: 2, step: 1, back: true });
    expect(fromMenu[0].action.kind).toBe("back");
    expect(fromMenu.find((entry) => entry.text.includes("Back one step"))?.action.kind).toBe("undo");
  });

  it("sets kill Y and places a camera from their own screens", () => {
    expect(killYScreenEntries({ y: 57, set: true, step: 1 }).map((entry) => entry.action.kind)).toEqual(["none", "type", "height", "height", "step", "step", "step", "remove", "save"]);
    expect(killYScreenEntries({ y: 57, set: false, step: 1 }).at(-1)?.text).toBe(saveBarText("Set kill Y"));
    const camera = cameraScreenEntries({ kind: "game", at: "At 0 70 0", looks: "Looking north, level" });
    // Two wide tiles, then where it is and looks on two short lines.
    expect(camera.slice(0, 2).map((entry) => entry.text)).toEqual([segmentText("Map preview", 0, false, false, true), segmentText("Game picture", 1, true, false, true)]);
    expect(camera.slice(2, 4).map((entry) => entry.text)).toEqual([`${MARK.lead}${headingText("At 0 70 0")}`, `${MARK.lead}${headingText("Looking north, level")}`]);
    expect(camera.at(-1)?.text).toBe(saveBarText("Place camera"));
  });

  it("reads a typed countdown as whole seconds within the limits", () => {
    expect(parseCountdown(" 10 ")).toBe(10);
    for (const text of ["", "0", "61", "2.5", "ten"]) expect(parseCountdown(text)).toBeUndefined();
  });
});

describe("Preview in the map menu", () => {
  it("is a quick icon on a game's map, faded until the checklist is done, and none on a lobby map", () => {
    const icon = (config: MapConfig) => mapMenuEntries(view(config, { game: "Sumo" })).find((entry) => entry.action.kind === "preview");
    expect(icon(draft)).toEqual({ action: { kind: "preview" }, text: `${MARK.quick}${MARK.dim}Preview
§7finish the checklist first`, icon: ICONS.play });
    const done = { ...draft, spawns: [[0, 65, 0], [2, 65, 0]] } as MapConfig;
    expect(icon(done)?.text).toBe(`${MARK.quick}Preview
§7play it as Sumo, then come back`);
    expect(mapMenuEntries(view(done)).some((entry) => entry.action.kind === "preview")).toBe(false);
    expect(readFileSync(new URL(`../resource_pack/${ICONS.play}.png`, import.meta.url)).length).toBeGreaterThan(0);
  });
});

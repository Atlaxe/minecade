import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapChecklist, stripColors, type HomeState, type MapCamera, type MapConfig } from "@minecade/minigame-core/config";
import { DANGER_BUTTON, SIDE_TITLE } from "../../packages/minigame-core/src/game/preview.ts";
import { spawnLists, toolLists } from "../behavior_pack/scripts/lists.ts";
import { CARD_COLUMNS, COLUMNS, LAYOUT, LOADING, MARK, SEGMENT_COLUMNS, cardIconText, cardTitleText, dangerText, dropdownText, goText, headingText, homeTitle, iconsTitle, linkText, loadingTitle, mapTitle, optionText, pictureText, saveBarText, segmentText, sideTitle, stepTileText, switchText } from "../behavior_pack/scripts/marks.ts";
import {
  BACK_TEXT,
  ICONS,
  LOBBY_TEXT,
  PLAYERS_TEXT,
  SNAPSHOT_STEPS,
  SELECT_HELP,
  boundaryEntries,
  editBody,
  facingLine,
  gearEntries,
  nudgeEntries,
  guestEntries,
  guestWaitText,
  homeCards,
  importMapEntries,
  importTargetEntries,
  uniqueMapId,
  editorTools,
  previewEntries,
  snapshotEntries,
  snapshotListEntries,
  thumbnailEntries,
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
const draft: MapConfig = { name: "Arena", draft: true, spawns: [[0, 65, 0]], spectatorSpawn: [0, 69, 0], build: { commands: ["fill 0 64 0 1 64 1 stone"] }, bounds: { min: [-5, 60, -5], max: [5, 70, 5] } };

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
    expect(entries.map((entry) => entry.action.kind)).toEqual(["checklist", "undo", "redo", "boundaries", "settings", "tool", "tool", "tool", "tool", "tool", "save"]);
    expect(entries[3]).toEqual({ action: { kind: "boundaries" }, text: `${MARK.quick}Boundaries\n§7see the bounds and regions you pick`, icon: ICONS.boundaries });
    expect(entries[0].text).toBe(`${MARK.pill}1/2\n§7Checklist: 1 problem`);
    expect(entries[0].icon).toBe(ICONS.check);
    expect(entries.at(-1)?.text).toBe(`${MARK.save}Save\n§7saves the map and the world`);
  });

  it("dims Undo and Redo when there's nothing to undo or redo", () => {
    const [, undo, redo] = mapMenuEntries(view(draft, { undo: "add spawns" }));
    expect(undo.text).toBe(`${MARK.quick}Undo\n§7add spawns`);
    expect(redo.text).toBe(`${MARK.quick}${MARK.dim}Redo\n§7nothing to redo`);
  });

  it("puts each tool in a grid column with its icon, the one out marked, the Game marker tool only for a game with markers", () => {
    const tools = mapMenuEntries(view(draft, { tool: "region" })).filter((entry) => entry.action.kind === "tool");
    expect(tools.map((entry) => entry.icon)).toEqual(EDITOR_TOOLS.filter((tool) => tool.id !== "marker").map((tool) => tool.icon));
    expect(tools[0].text).toBe(`${MARK.tool}${COLUMNS[0]}Spawn tool\n§7spawns, spectator and queue spawns`);
    expect(tools[1].text).toBe(`${MARK.tool}${COLUMNS[1]}${MARK.on}Region tool\n§7bounds, regions, kill regions`);
    expect(tools[4].text).toBe(`${MARK.tool}${COLUMNS[4]}Snapshot tool\n§7take a camera's picture`);
    const withMarkers = spawnLists(draft, { ...rules, requires: { points: { hole: { label: "Hole" } } } });
    expect(editorTools(withMarkers).map((tool) => tool.id)).toEqual(["spawn", "marker", "region", "killY", "camera", "snapshot"]);
    // Its settings list the game's markers, and the Spawn tool's leave them out.
    const settings = (tool: "spawn" | "marker") => mapMenuEntries({ ...view(draft, { tool }), spawn: { lists: withMarkers, settings: { list: "spawns", center: false, keepFacing: false, snap: "exact" } } }).map((entry) => entry.text);
    expect(settings("marker")).toContain(headingText("Hole: none yet"));
    expect(settings("spawn")).not.toContain(headingText("Hole: none yet"));
  });

  it("shows the tool out's settings, after a Help link, between the tools and Save", () => {
    const cameras: Record<string, MapCamera> = { "Camera 1": { at: [0, 70, 0, 0, 0], kind: "game" } };
    const kinds = (tool: MapMenuView["tool"]) => mapMenuEntries(view({ ...draft, killY: 50, cameras }, { tool })).map((entry) => entry.action.kind).slice(10, -1);
    // Spawn: Help, then each list with its entries (Spawns and the spectator spawn have one, the queue spawn none).
    expect(kinds("spawn")).toEqual(["help", "none", "entry", "none", "entry", "none"]);
    expect(kinds("region")).toEqual(["help", "none", "box"]);
    expect(kinds("killY")).toEqual(["help", "none", "killY", "removeKillY"]);
    // The Snapshot tool: the cameras, each one to look through.
    expect(kinds("snapshot")).toEqual(["help", "none", "snapshot"]);
    expect(mapMenuEntries(view({ ...draft, cameras }, { tool: "snapshot" })).at(-2)).toEqual({ action: { kind: "snapshot", name: "Camera 1" }, text: "Camera 1\n§7Game picture" });
    expect(kinds(undefined)).toEqual([]);
    expect(mapMenuEntries(view(draft, { tool: "spawn" }))[10].text).toBe(linkText("Help"));
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
    expect(toolOf("minecade:snapshot")?.id).toBe("snapshot");
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
    for (const mark of [...Object.values(MARK), ...COLUMNS, ...SEGMENT_COLUMNS, ...CARD_COLUMNS]) {
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
    const marks = [...Object.values(MARK), ...COLUMNS, ...SEGMENT_COLUMNS, ...CARD_COLUMNS];
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
  it("has Players and Back to Lobby (right end) in its icon row, then the settings, the thumbnails and the red ones", () => {
    expect(gearEntries({ build: true, game: true })).toEqual([
      { action: "back", text: BACK_TEXT, icon: ICONS.back },
      { action: "players", text: PLAYERS_TEXT, icon: ICONS.players },
      { action: "lobby", text: LOBBY_TEXT, icon: ICONS.lobby },
      { action: "settings", text: "Name and game settings" },
      { action: "mapThumbnail", text: "Edit Map Thumbnail" },
      { action: "gameThumbnail", text: "Edit Minigame Thumbnail" },
      { action: "dropBuild", text: dangerText("Drop build commands") },
      { action: "publish", text: goText("Publish") },
      { action: "delete", text: dangerText("Delete map") },
    ]);
    // A lobby map has no thumbnails.
    expect(gearEntries({ build: false, game: false }).map((entry) => entry.action)).toEqual(["back", "players", "lobby", "settings", "publish", "delete"]);
  });
});

describe("thumbnails", () => {
  const pictures = {
    shots: [
      { id: "s1", label: "Sumo: Arena" },
      { id: "s2", label: "not used yet" },
    ],
    current: { map: "s2", game: "own" },
    maps: [
      { target: "sumo", targetName: "Sumo", map: "arena_1", name: "Arena" },
      { target: "sumo", targetName: "Sumo", map: "pit", name: "Pit" },
      { target: "quiver", targetName: "One in the Quiver", map: "mansion", name: "Mansion" },
      { target: "lobby", targetName: "Lobby", map: "spaceship", name: "Spaceship" },
    ],
  };

  it("shows the pictures used before two to a row, the one in use green, and Import for a map's", () => {
    const map = thumbnailEntries({ kind: "map", pictures, own: "textures/minecade/maps/quiver/mansion" });
    expect(map[0]).toEqual({ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back });
    expect(map[1]).toEqual({ action: { kind: "import" }, text: `${MARK.fixed}${linkText("Import from another minigame")}` });
    expect(map.slice(2)).toEqual([
      { action: { kind: "shot", id: "s1" }, text: pictureText("Sumo: Arena", 0, false), icon: "textures/minecade/shots/s1" },
      { action: { kind: "shot", id: "s2" }, text: pictureText("not used yet\n§7in use", 1, true), icon: "textures/minecade/shots/s2" },
    ]);
    // A game's picture that isn't one of them comes first, in use; no Import.
    const game = thumbnailEntries({ kind: "game", pictures, own: "textures/minecade/games/quiver" });
    expect(game.map((entry) => entry.action.kind)).toEqual(["back", "none", "shot", "shot"]);
    expect(game[1]).toEqual({ action: { kind: "none" }, text: pictureText("In use now\n§7in use", 0, true), icon: "textures/minecade/games/quiver" });
    expect(thumbnailEntries({ kind: "game", pictures: { shots: [], current: {}, maps: [] } }).at(-1)?.text).toBe(headingText("No pictures yet: the Snapshot tool takes them"));
  });

  it("imports from another game's maps with a picture, as picture cards", () => {
    expect(importTargetEntries(pictures, "quiver")).toEqual([{ target: "sumo", text: "Sumo\n§72 maps with a picture" }]);
    expect(importTargetEntries(pictures, "sumo").map((entry) => entry.target)).toEqual(["quiver"]);
    const cards = importMapEntries(pictures, "sumo");
    expect(cards[0].action).toEqual({ kind: "back" });
    expect(cards.slice(1)).toEqual([
      { action: { kind: "map", map: "arena_1", name: "Arena" }, text: pictureText("Arena\n§7arena_1", 0, false), icon: "textures/minecade/maps/sumo/arena_1" },
      { action: { kind: "map", map: "pit", name: "Pit" }, text: pictureText("Pit\n§7pit", 1, false), icon: "textures/minecade/maps/sumo/pit" },
    ]);
  });
});

describe("the editor lobby's menu", () => {
  const empty: HomeState = {
    catalog: {
      targets: [
        { id: "lobby", name: "Lobby", maps: [{ id: "spaceship", name: "Spaceship", draft: false, ready: true }] },
        {
          id: "sumo",
          name: "Sumo",
          maxPlayers: 6,
          maps: [
            { id: "arena_1", name: "Arena", draft: false, ready: true, world: "abc=" },
            { id: "pit", name: "Pit", draft: true, ready: false },
          ],
        },
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
  const myWorld = { to: "select" as const, world: "def=" };
  const arenaPreview = { to: "preview" as const, target: "sumo", map: "arena_1" };
  const withRecent: HomeState = {
    catalog: {
      ...empty.catalog,
      recent: [
        { request: arena, label: "Sumo: Arena (arena_1)" },
        { request: arenaPreview, label: "Sumo: Arena (arena_1)" },
        { request: datapacking, label: "Datapacking (imported)" },
        { request: myWorld, label: "My World" },
        { request: { to: "edit", target: "sumo", map: "pit" }, label: "Sumo: Pit (pit)" },
        { request: { to: "edit", target: "lobby", map: "spaceship" }, label: "Lobby: Spaceship (spaceship)" },
        { request: { to: "edit", target: "sumo", map: "gone" }, label: "Sumo: Gone (gone)" },
      ],
    },
    servers: { waiting: [] },
  };

  it("starts with the icon row (New map, Players, Leave at the right end), then Recent with Search on its right", () => {
    const entries = homeEntries(empty);
    expect(entries.slice(0, 5).map((entry) => entry.action)).toEqual([{ kind: "new" }, { kind: "players" }, { kind: "leave" }, { kind: "none" }, { kind: "maps" }]);
    expect(entries[0].icon).toBe(ICONS.new);
    expect(entries[1]).toEqual({ action: { kind: "players" }, text: PLAYERS_TEXT, icon: ICONS.players });
    expect(entries[2]).toEqual({ action: { kind: "leave" }, text: `${MARK.end}Leave\n§7disconnect from the map editor`, icon: ICONS.leave });
    expect(entries[3].text).toBe(`${MARK.cardHead}${headingText("Recent")}`);
    expect(entries[4]).toEqual({ action: { kind: "maps" }, text: `${MARK.cardLink}Search`, icon: ICONS.search });
    expect(entries.slice(5).map((entry) => entry.text)).toEqual([headingText("§8Nothing opened yet")]);
  });

  it("shows one card per map (its title, then Select, Edit and Preview), and a world with no map card of its own", () => {
    const cards = homeCards(withRecent.catalog);
    // Arena's Edit and Preview entries make one card; Datapacking has Arena's card; a gone map has none.
    expect(cards.map((card) => (card.kind === "map" ? `${card.target.id}/${card.map.id}` : card.world.id))).toEqual(["sumo/arena_1", "def=", "sumo/pit", "lobby/spaceship"]);
    const entries = homeEntries(withRecent).slice(5);
    expect(entries).toHaveLength(16);
    const [title, select, edit, preview] = entries;
    expect(title).toEqual({ action: { kind: "none" }, text: cardTitleText("Sumo", "Arena") });
    expect(select).toEqual({ action: { kind: "open", request: datapacking }, text: cardIconText("Select\n§7box more maps in Datapacking (imported)", 0, true), icon: ICONS.select });
    expect(edit).toEqual({ action: { kind: "open", request: arena }, text: cardIconText("Edit\n§7arena_1", 1, true), icon: ICONS.edit });
    expect(preview).toEqual({ action: { kind: "preview", target: "sumo", map: "arena_1" }, text: cardIconText("Preview\n§7play it, with fake players if you like", 2, true), icon: ICONS.play });
    // A world with no map yet: Select only.
    expect(entries.slice(4, 8).map((entry) => entry.action.kind)).toEqual(["none", "open", "off", "off"]);
    expect(entries[6].text).toContain(MARK.dim);
    // A draft whose checklist isn't done, from no world on this PC: Select and Preview faded.
    expect(entries.slice(8, 12).map((entry) => [entry.action.kind, entry.text.includes(MARK.dim)])).toEqual([
      ["none", false],
      ["off", true],
      ["open", false],
      ["off", true],
    ]);
    expect(entries[10].text).toBe(cardIconText("Edit\n§7pit, a draft", 1, true));
    // A lobby map can't be previewed yet.
    expect(entries[15].action).toEqual({ kind: "off", why: "A lobby map can't be previewed yet: publish it, then start the network." });
  });

  it("shows eight cards at most", () => {
    const maps = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, draft: false, ready: true }));
    const recent = maps.map((map) => ({ request: { to: "edit" as const, target: "sumo", map: map.id }, label: map.name }));
    const state: HomeState = { ...empty, catalog: { ...empty.catalog, targets: [{ id: "sumo", name: "Sumo", maps }], recent } };
    expect(homeEntries(state).filter((entry) => entry.text.startsWith(MARK.cardTitle))).toHaveLength(8);
  });

  it("offers fake players before a preview: none up to what fits, then Start preview", () => {
    const entries = previewEntries({ fakes: 2, most: 5, back: true });
    expect(entries[0]).toEqual({ action: { kind: "back" }, text: BACK_TEXT, icon: ICONS.back });
    expect(entries[1].text).toBe(`${MARK.lead}${headingText("Fake players")}`);
    const tiles = entries.filter((entry) => entry.action.kind === "fakes");
    expect(tiles.map((entry) => entry.action)).toEqual([0, 1, 2, 3, 4, 5].map((fakes) => ({ kind: "fakes", fakes })));
    expect(tiles.map((entry) => entry.text.includes(MARK.on))).toEqual([false, false, true, false, false, false]);
    expect(entries.at(-1)).toEqual({ action: { kind: "start" }, text: saveBarText("Start preview") });
    expect(previewEntries({ fakes: 0, most: 20, back: false }).filter((entry) => entry.action.kind === "fakes")).toHaveLength(8);
    expect(previewEntries({ fakes: 3, most: 1, back: false }).filter((entry) => entry.text.includes(MARK.on)).map((entry) => entry.action)).toEqual([{ kind: "fakes", fakes: 1 }]);
  });

  it("lists targets, maps and worlds, with an empty world last", () => {
    expect(targetEntries(empty.catalog).map((entry) => stripColors(entry.text))).toEqual(["Lobby\n1 map", "Sumo\n2 maps"]);
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

  it("makes map ids from names, unique among the ones taken", () => {
    expect(mapIdFrom("Castle Keep!")).toBe("castle_keep");
    expect(uniqueMapId("Castle Keep!", [])).toBe("castle_keep");
    expect(uniqueMapId("Castle Keep!", ["castle_keep", "castle_keep_2"])).toBe("castle_keep_3");
    expect(uniqueMapId("!!!", [])).toBe("map");
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

  it("picks a team spawn's team in a Team list under the toggle, open or closed", () => {
    const teamRules = { kind: "game" as const, maxPlayers: 4, teams: [{ id: "red", name: "Red", color: "§c" }, { id: "blue", name: "Blue", color: "§9" }], requires: { teamSpawns: true } };
    const teamLists = toolLists(spawnLists({ ...draft, spawns: [] }, teamRules), "spawn");
    const closed = entryScreenEntries({ lists: teamLists, list: "teamSpawns.blue", at, snap: "exact", center: false, step: 1 });
    // Spawn, Spectator and Queue are the tiles; the team is a list.
    expect(closed.slice(0, 3).map((entry) => entry.text)).toEqual([segmentText("Spawn", 0, true), segmentText("Spectator", 1, false), segmentText("Queue", 2, false)]);
    expect(closed[3]).toEqual({ action: { kind: "open", which: "team" }, text: `${MARK.lead}${dropdownText("Team", "Blue", false)}` });
    const open = entryScreenEntries({ lists: teamLists, list: "teamSpawns.blue", open: "team", at, snap: "exact", center: false, step: 1 });
    expect(open.slice(3, 6)).toEqual([
      { action: { kind: "open", which: "team" }, text: `${MARK.lead}${dropdownText("Team", "Blue", true)}` },
      { action: { kind: "list", key: "teamSpawns.red" }, text: `${MARK.lead}${optionText("Red", false)}` },
      { action: { kind: "list", key: "teamSpawns.blue" }, text: `${MARK.lead}${optionText("Blue", true)}` },
    ]);
    // The spectator spawn has no team.
    const spectator = entryScreenEntries({ lists: teamLists, list: "spectatorSpawn", at, snap: "exact", center: false, step: 1 });
    expect(spectator.some((entry) => entry.action.kind === "open")).toBe(false);
    expect(spectator[0].action).toEqual({ kind: "list", key: "teamSpawns.red" });
  });

  it("picks a game marker in a Marker list, then its team when it has one", () => {
    const markerRules = { kind: "game" as const, maxPlayers: 4, teams: [{ id: "red", name: "Red", color: "§c" }, { id: "blue", name: "Blue", color: "§9" }], requires: { teamSpawns: true, points: { hole: { label: "Hole", perTeam: true }, flag: { label: "Flag" } } } };
    const markers = toolLists(spawnLists({ ...draft, spawns: [] }, markerRules), "marker");
    const entries = entryScreenEntries({ lists: markers, list: "points.hole.blue", open: "group", at, snap: "exact", center: false, step: 1 });
    expect(entries.some((entry) => entry.text.startsWith(MARK.segment))).toBe(false);
    expect(entries.slice(0, 4)).toEqual([
      { action: { kind: "open", which: "group" }, text: `${MARK.lead}${dropdownText("Marker", "Hole", true)}` },
      { action: { kind: "list", key: "points.hole.blue" }, text: `${MARK.lead}${optionText("Hole", true)}` },
      { action: { kind: "list", key: "points.flag" }, text: `${MARK.lead}${optionText("Flag", false)}` },
      { action: { kind: "open", which: "team" }, text: `${MARK.lead}${dropdownText("Team", "Blue", false)}` },
    ]);
    expect(entries.at(-1)?.text).toBe(saveBarText("Place Hole (Blue)"));
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

  it("sets kill Y from its own screen", () => {
    expect(killYScreenEntries({ y: 57, set: true, step: 1 }).map((entry) => entry.action.kind)).toEqual(["none", "type", "height", "height", "step", "step", "step", "remove", "save"]);
    expect(killYScreenEntries({ y: 57, set: false, step: 1 }).at(-1)?.text).toBe(saveBarText("Set kill Y"));
  });

  it("has the Snapshot: the cameras to pick, then nudge rows, Step, and Use latest screenshot at the bottom", () => {
    expect(snapshotListEntries({ ...draft, cameras: { "Camera 1": { at: [0, 70, 0, 0, 0], kind: "game" } } })).toEqual([{ camera: "Camera 1", text: "Camera 1\n§7Game picture" }]);
    expect(snapshotListEntries(draft)).toEqual([{ text: headingText("No cameras yet: use the Camera tool to place one") }]);
    const entries = snapshotEntries({ camera: { at: [1, 70, -2, 90, 10], kind: "map" }, step: 1, lobby: false });
    expect(entries[0].action).toEqual({ kind: "back" });
    expect(entries.slice(1, 5).map((entry) => entry.action.kind)).toEqual(["none", "shoot", "stop", "kind"]);
    expect(entries[1].text).toBe(`${MARK.lead}${headingText("At 1 70 -2, looking west, 10 degrees down")}`);
    expect(entries[4].text).not.toContain(MARK.on);
    const rows = entries.filter((entry) => entry.text.startsWith(MARK.minus));
    expect(rows.map((entry) => entry.text)).toEqual([
      `${MARK.minus}X (east +): 1`,
      `${MARK.minus}Y (up +): 70`,
      `${MARK.minus}Z (south +): -2`,
      `${MARK.minus}Turn (right +): 90`,
      `${MARK.minus}Tilt (down +): 10`,
    ]);
    expect(entries.filter((entry) => entry.action.kind === "step").map((entry) => entry.text)).toEqual(SNAPSHOT_STEPS.map((step, i) => stepTileText(step.label, i, i === 1)));
    expect(entries.at(-1)).toEqual({ action: { kind: "use" }, text: saveBarText("Use latest screenshot\n§7as the map's thumbnail") });
    // A lobby map has no picture: only the nudges.
    const lobby = snapshotEntries({ camera: { at: [1, 70, -2, 90, 10], kind: "map" }, step: 0, lobby: true });
    expect(lobby.some((entry) => entry.action.kind === "shoot" || entry.action.kind === "use")).toBe(false);
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

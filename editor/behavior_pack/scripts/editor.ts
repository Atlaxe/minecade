// The map editor in game (Edit mode): the map menu and its checklist, the spawn tool and the
// markers (the region and Kill Y tools have their own files, and get what they need through a
// ToolHost). A change shows here at once and goes to the host (tools/editor), which writes
// map.json and answers; MapState keeps the two copies in step. Save asks the host to save the
// world into the map while it runs. Everyone here is a map editor (the server lets in LAN_PLAYERS
// only). Every control is a hit, a use or a form, never sneaking: players fly in creative, and
// sneaking while flying flies down.
import {
  BlockVolume,
  EntityComponentTypes,
  GameMode,
  ItemLockMode,
  ItemStack,
  system,
  world,
  type Container,
  type Dimension,
  type Player,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
  MapEditError,
  describeError,
  isMapKey,
  listOf,
  log,
  mapChecklist,
  mapTimeTicks,
  QUEUE_COUNTDOWN,
  positionText,
  positionXyz,
  queueSettings,
  showForm,
  type EditInfo,
  type HostMessage,
  type MapConfig,
  type MapEdit,
  type Facing,
  type MapPosition,
  type Scope,
  chatMapName,
  playChime,
} from "@minecade/minigame-core";
import { goto } from "./goto.ts";
import { keepModeLine, modeLine } from "./hud.ts";
import { KillYTool } from "./kill-y-tool.ts";
import { LoadingScreens } from "./loading.ts";
import { onReset } from "./commands.ts";
import { HostLink } from "./link.ts";
import { Outlines } from "./outlines.ts";
import { boundaryRows, boundsAround, outlineBoxes, toggleBoundary } from "./regions.ts";
import { CameraTool } from "./camera-tool.ts";
import { cameraMarkers, type CameraMarker } from "./cameras.ts";
import { RegionTool } from "./region-tool.ts";
import { actionBar, heldTool, hintBar, notice, type ToolHost } from "./tool-host.ts";
import { REACH, blockInView, nudgePreview } from "./box-picker.ts";
import { facingOf, type Point } from "./boxes.ts";
import { Cursors, type CursorAim } from "./cursor.ts";
import { aimedPoint, compass, entryPosition, lookAt, mapMiddle, markerSpecs, snapFacing, SNAPS, spawnLists, type AimedFace, type MarkerSpec, type SpawnList } from "./lists.ts";
import { MapState } from "./map-state.ts";
import { PlayersMenu } from "./players.ts";
import { MARKER, Markers } from "./markers.ts";
import { dangerText, iconsTitle, mapTitle, sideTitle } from "./marks.ts";
import {
  BACK_TEXT,
  BOUNDARIES_BODY,
  ICONS,
  boundaryEntries,
  gearEntries,
  checklistBody,
  entryScreenEntries,
  mapMenuEntries,
  POINT_STEPS,
  parseCountdown,
  parseSetting,
  publishBody,
  publishText,
  rowText,
  type MenuAction,
  type SpawnSettings,
} from "./menu.ts";
import { EDITOR_TOOLS, SELECT_TOOL, toolOf, type EditorTool, type ToolId } from "./tools.ts";

const MAP_MENU = "minecade:map_menu";
/** Every editor item: none breaks the block it hits. */
const TOOLS = new Set([MAP_MENU, ...EDITOR_TOOLS.map((tool) => tool.item), SELECT_TOOL.item]);
/** The map menu's hotbar slot (0-based): the last one, slot 9 on screen. */
const MENU_SLOT = 8;
/** Where a tool goes when it's picked: slot 1 on screen, never locked. */
const TOOL_SLOT = 0;
const PREFIX = "§b[Editor]§r ";
const NOON = 6000;
/** A new map's glass pad reaches this far from its first spawn, one block below it. */
const PAD_RADIUS = 4;
/** How often the held tool's hint is put back on the action bar (it fades otherwise). */
const HINT_TICKS = 10;
/** Block changes are reported to the host at most this often. */
const CHANGED_TICKS = 100;
/** How far below a block side the Spawn tool looks for the floor to stand an entry on. */
const FLOOR_REACH = 8;
/** How often map editors are checked for the map menu (a command block may have cleared it). */
const ITEMS_TICKS = 200;
/** How often the facing line goes back on the action bar while a spawn's screen is open. */
const FACING_TICKS = 20;
/** Undo and Redo open the map menu again once the host answers, or after this long. */
const REOPEN_TICKS = 40;

/** No boundary switched on. */
const NONE_SHOWN: ReadonlySet<string> = new Set();


export class Editor {
  private readonly scope: Scope;
  private readonly info: EditInfo;
  private readonly state: MapState;
  private readonly link: HostLink;
  private readonly markers: Markers<MarkerSpec | CameraMarker>;
  private readonly regionTool: RegionTool;
  private readonly killYTool: KillYTool;
  private readonly cameraTool: CameraTool;
  private readonly players: PlayersMenu;
  private readonly loading: LoadingScreens;
  private readonly cursors: Cursors;
  /** The spawn or point each player's screen is setting up: the cursor shows it there. */
  private readonly entryPreview = new Map<string, { at: Point; yaw: number; style: number }>();
  private readonly dimension: Dimension;
  private readonly settings = new Map<string, SpawnSettings>();
  private readonly formOpen = new Set<string>();
  /** Players with the map menu open and the Region or Kill Y tool picked: the outlines show for them. */
  private readonly menuTool = new Set<string>();
  /** Players whose map menu opens again when the host answers (after Undo or Redo). */
  private readonly reopen = new Set<string>();
  /** Each player's Boundaries switches, by lower-case name (kept by the host between maps). */
  private readonly shown = new Map<string, Set<string>>();
  private status: { undo?: string; redo?: string; unsaved: boolean; saving: boolean; publishing?: boolean };
  /** When block changes were last reported to the host, in ticks. */
  private changedAt = -CHANGED_TICKS;

  constructor(scope: Scope, info: EditInfo, map: MapConfig) {
    this.scope = scope;
    this.info = info;
    this.state = new MapState(map);
    this.dimension = world.getDimension("overworld");
    this.status = { unsaved: info.fresh, saving: false };
    for (const [name, groups] of Object.entries(info.view ?? {})) this.shown.set(name.toLowerCase(), new Set(groups));
    this.markers = new Markers<MarkerSpec | CameraMarker>(this.dimension, scope);
    this.link = new HostLink(scope, {
      config: (config, seq) => {
        this.state.replace(config, seq);
        this.refresh();
      },
      message: (message) => this.receive(message),
    });
    this.players = new PlayersMenu(this.link, (player, form) => this.show(player, form));
    const host: ToolHost = {
      map: () => this.state.current,
      rules: info.rules,
      edit: (player, edit, done) => this.edit(player, edit, done),
      show: (player, form) => this.show(player, form),
      tell,
      equip: (player, id) => {
        const tool = EDITOR_TOOLS.find((candidate) => candidate.id === id);
        if (tool) this.equipTool(player, tool);
      },
    };
    this.regionTool = new RegionTool(scope, host);
    this.killYTool = new KillYTool(host);
    this.loading = new LoadingScreens(scope, (player, form) => this.show(player, form));
    this.cursors = new Cursors(scope, this.dimension, (player) => this.cursorAim(player));
    this.cameraTool = new CameraTool({
      ...host,
      targetName: info.targetName,
      picture: (player, kind) => this.link.send({ t: "picture", by: player.name, kind }),
      lookChanged: () => (this.cameraTool.anyoneLooking() ? this.markers.hide() : this.markers.unhide()),
    });
    new Outlines(
      scope,
      {
        selection: (player) => this.regionTool.selectionOf(player),
        boxes: () => outlineBoxes(this.state.current, info.rules),
        killY: () => {
          const y = this.state.current.killY;
          return typeof y === "number" ? { y, over: boundsAround(this.state.current) } : undefined;
        },
        shown: (player) => this.shown.get(player.name.toLowerCase()) ?? NONE_SHOWN,
        hidden: (player) => this.cameraTool.isLooking(player),
        // With the Region or Kill Y tool picked, every boundary shows while the map menu is open.
        showing: (player) => this.menuTool.has(player.name.toLowerCase()),
        killYOver: () => boundsAround(this.state.current),
      },
      ["region", "killY"],
    );
  }

  start(): void {
    const scope = this.scope;
    // Steady light and weather to build in; the map's own time when it has one.
    world.gameRules.doDayLightCycle = false;
    world.gameRules.doWeatherCycle = false;
    world.gameRules.doMobSpawning = false;
    world.setTimeOfDay(mapTimeTicks(this.state.current.time) ?? NOON);

    scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      if (initialSpawn) scope.defer(() => this.welcome(player));
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.cameraTool.forget(playerName);
      this.settings.delete(playerName.toLowerCase());
      this.formOpen.delete(playerName.toLowerCase());
      this.reopen.delete(playerName.toLowerCase());
    });
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!TOOLS.has(itemStack.typeId)) return;
      // Looking through a camera, any use comes back first.
      if (this.cameraTool.isLooking(source)) {
        this.cameraTool.stop(source);
        return;
      }
      const tool = toolOf(itemStack.typeId)?.id;
      if (itemStack.typeId === MAP_MENU) void this.mapMenu(source);
      else if (tool === "spawn") this.spawnTool(source);
      else if (tool === "region") void this.regionTool.use(source);
      else if (tool === "killY") void this.killYTool.use(source);
      else if (tool === "camera") void this.cameraTool.use(source);
    });
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (hitEntity.typeId !== MARKER || damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      const spec = this.markers.specOf(hitEntity);
      if (spec) void ("camera" in spec ? this.cameraTool.menu(player, spec.camera) : this.markerMenu(player, spec));
    });
    // A tool never breaks the block it hits, which creative mode would.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      if (event.itemStack && TOOLS.has(event.itemStack.typeId)) event.cancel = true;
    });
    scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player }) => this.blocksChanged(player.name));
    scope.subscribe(world.afterEvents.playerBreakBlock, ({ player }) => this.blocksChanged(player.name));
    scope.interval(() => this.hints(), HINT_TICKS);
    scope.interval(() => this.checkItems(), ITEMS_TICKS);
    onReset((player) => this.reset(player));
    keepModeLine(scope, () => modeLine("edit", `${this.info.targetName}: ${this.state.current.name}`), (player) => this.cameraTool.isLooking(player));
    this.refresh();
    void this.prepareWorld();
  }

  /** Sweeps up markers an earlier run left, lays a new map's pad, then tells the host the editor is ready. */
  private async prepareWorld(): Promise<void> {
    try {
      const left = await this.markers.clear();
      if (left > 0) log.warn(`${left} markers from an earlier run could not be removed`);
      if (this.info.fresh) await this.layPad();
    } catch (error) {
      log.error(`preparing the world failed: ${describeError(error)}`);
    }
    this.markers.resume();
    this.link.send({ t: "ready" });
  }

  private async layPad(): Promise<void> {
    const [x, y, z] = this.state.current.spawns[0] ?? [0, 65, 0];
    const from = { x: x - PAD_RADIUS, y: y - 1, z: z - PAD_RADIUS };
    const to = { x: x + PAD_RADIUS, y: y - 1, z: z + PAD_RADIUS };
    const manager = world.tickingAreaManager;
    await manager.createTickingArea("minecade:pad", { dimension: this.dimension, from, to });
    try {
      this.dimension.fillBlocks(new BlockVolume(from, to), "minecraft:glass");
    } finally {
      manager.removeTickingArea("minecade:pad");
    }
    log.info(`laid a glass pad at ${x} ${y - 1} ${z}`);
  }

  private receive(message: Exclude<HostMessage, { t: "config" | "home" }>): void {
    switch (message.t) {
      case "ack":
        if (!this.state.ack(message.seq, message.hash)) {
          log.warn("the host's copy of the map differs; asking for it again");
          this.link.send({ t: "resync" });
        }
        return;
      case "status":
        this.status = { undo: message.undo, redo: message.redo, unsaved: message.unsaved, saving: message.saving, publishing: message.publishing };
        for (const key of [...this.reopen]) this.reopenMenu(key);
        return;
      case "say":
        for (const player of world.getAllPlayers()) if (!message.to || player.name === message.to) tell(player, message.text);
        return;
      case "notice":
        for (const player of world.getAllPlayers()) notice(this.scope, player, message.text);
        return;
      case "goto":
        goto(message.players, message.port, message.label, tell);
        return;
      case "guests":
        this.players.update(message.guests);
        return;
      case "loading":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) void this.loading.wait(player, message.label);
        return;
      case "loaded":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) this.loading.stop(player);
        return;
      case "cleanup":
        // The aim cursors aren't saved with the world either.
        this.cursors.pause();
        void this.markers.clear().then(
          (left) => this.link.send({ t: "clean", id: message.id, left }),
          (error: unknown) => this.link.send({ t: "clean", id: message.id, left: -1, error: describeError(error) }),
        );
        return;
      case "resume":
        this.markers.resume();
        this.cursors.resume();
        return;
    }
  }

  private refresh(): void {
    this.markers.show([...markerSpecs(this.state.current, this.lists()), ...cameraMarkers(this.state.current)]);
  }

  private lists(): SpawnList[] {
    return spawnLists(this.state.current, this.info.rules);
  }

  private settingsOf(player: Player): SpawnSettings {
    const key = player.name.toLowerCase();
    let settings = this.settings.get(key);
    if (!settings) {
      settings = { list: "spawns", center: false, keepFacing: false, snap: "exact" };
      this.settings.set(key, settings);
    }
    return settings;
  }

  /** The list the spawn tool places into: the one picked, or the first when that one is gone. */
  private spawnList(player: Player): SpawnList | undefined {
    const lists = this.lists();
    const settings = this.settingsOf(player);
    const list = lists.find((candidate) => candidate.key === settings.list) ?? lists[0];
    if (list) settings.list = list.key;
    return list;
  }

  private welcome(player: Player): void {
    if (!player.isValid) return;
    // Saved player data in the world could hold another game mode.
    player.setGameMode(GameMode.Creative);
    const where = `${chatMapName(this.info.targetName, this.state.current.name)}.`;
    this.giveMenu(player);
    tell(player, `${where} The map menu in slot 9 has the checklist, the tools and Save. Hit a marker to change it.`);
  }

  private giveMenu(player: Player): void {
    const menu = new ItemStack(MAP_MENU, 1);
    menu.lockMode = ItemLockMode.slot;
    menu.keepOnDeath = true;
    inventoryOf(player)?.setItem(MENU_SLOT, menu);
  }

  /** /reset: creative mode and the map menu, at once. */
  private reset(player: Player): void {
    if (!player.isValid) return;
    player.setGameMode(GameMode.Creative);
    const inventory = inventoryOf(player);
    if (inventory && !holds(inventory, MAP_MENU)) this.giveMenu(player);
    tell(player, "Reset: creative mode, and your map menu.");
  }

  /** Players missing the map menu get it back (a command block may have cleared it). */
  private checkItems(): void {
    for (const player of world.getAllPlayers()) {
      const inventory = inventoryOf(player);
      if (!inventory || holds(inventory, MAP_MENU)) continue;
      this.giveMenu(player);
      tell(player, "Your map menu was gone: it's back. /reset also brings back creative mode.");
    }
  }

  /** Tells the host blocks changed, so Save or stopping saves the world. At most every few seconds. */
  private blocksChanged(by: string): void {
    // Once the host knows, there's nothing to tell, unless a save is running (the change may miss it).
    if (this.status.unsaved && !this.status.saving) return;
    if (system.currentTick - this.changedAt < CHANGED_TICKS) return;
    this.changedAt = system.currentTick;
    this.status = { ...this.status, unsaved: true };
    this.link.send({ t: "changed", by });
  }

  /** Applies an edit and sends it to the host; tells the player why when it doesn't fit. */
  private edit(player: Player, edit: MapEdit, done?: string): boolean {
    let seq: number;
    try {
      seq = this.state.apply(edit);
    } catch (error) {
      tell(player, `§c${error instanceof MapEditError ? error.message : describeError(error)}`);
      return false;
    }
    this.link.send({ t: "edit", seq, by: player.name, edit });
    this.refresh();
    if (done) tell(player, done);
    return true;
  }

  /** Shows a form unless this player has one of the editor's open already. */
  private async show<R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }): Promise<R | undefined> {
    const key = player.name.toLowerCase();
    if (this.formOpen.has(key)) return undefined;
    this.formOpen.add(key);
    try {
      return await showForm(this.scope, player, form);
    } finally {
      this.formOpen.delete(key);
    }
  }

  /** The held tool's hint on the action bar: what a use will do. */
  private hints(): void {
    for (const player of world.getAllPlayers()) {
      const tool = heldTool(player);
      // Nudge sides puts the way the player faces there instead.
      if (!tool || this.cameraTool.isLooking(player) || nudgePreview(player)) continue;
      if (tool === "spawn") hintBar(player, this.spawnHint(player));
      else if (tool === "region") hintBar(player, this.regionTool.hint(player));
      else if (tool === "killY") hintBar(player, this.killYTool.hint(player));
      else if (tool === "camera") hintBar(player, this.cameraTool.hint(player));
    }
  }

  private spawnHint(player: Player): string {
    const list = this.spawnList(player);
    if (!list) return "There's nothing to place on this map";
    const settings = this.settingsOf(player);
    const count = listOf(this.state.current, list.target).length;
    const what = list.single ? `${count > 0 ? "move" : "place"} ${list.entry}` : `place ${list.entry} ${count + 1}`;
    const facing = settings.keepFacing ? `, facing your way (${SNAPS.find((snap) => snap.snap === settings.snap)?.label ?? "Exact"})` : "";
    const where = settings.center ? "in the block you aim at" : "where you aim";
    return `Use: ${what} ${where}${facing}   Hit a marker: change it`;
  }

  // ---- Map menu ---------------------------------------------------------------------------

  /** The tool the player has out: the one in hand, or else the one in their inventory. */
  private toolOut(player: Player): ToolId | undefined {
    const held = heldTool(player);
    if (held) return held;
    const inventory = inventoryOf(player);
    return EDITOR_TOOLS.find((tool) => inventory && holds(inventory, tool.item))?.id;
  }

  private async mapMenu(player: Player): Promise<void> {
    const config = this.state.current;
    const tool = this.toolOut(player);
    if (tool === "spawn") this.spawnList(player);
    const entries = mapMenuEntries({
      config,
      checklist: mapChecklist(config, this.info.rules),
      ...(this.info.rules.kind === "game" ? { game: this.info.targetName } : {}),
      tool,
      ...this.status,
      spawn: { lists: this.lists(), settings: this.settingsOf(player) },
      region: { selection: this.regionTool.menuSelection(player), entries: tool === "region" ? this.regionTool.entries() : [] },
      camera: { kind: this.cameraTool.kindOf(player) },
    });
    // The map and game are in the mode box top center, and how to use the tool is behind Help.
    const form = new ActionFormData().title(mapTitle("Map menu"));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const key = player.name.toLowerCase();
    if (tool === "region" || tool === "killY") this.menuTool.add(key);
    let response;
    try {
      response = await this.show(player, form);
    } finally {
      this.menuTool.delete(key);
    }
    const entry = response?.selection === undefined ? undefined : entries[response.selection];
    if (entry && player.isValid) await this.menuAction(player, entry.action);
  }

  private async menuAction(player: Player, action: MenuAction): Promise<void> {
    switch (action.kind) {
      case "checklist":
        return this.checklistMenu(player);
      case "undo":
      case "redo":
        if (!(action.kind === "undo" ? this.status.undo : this.status.redo)) {
          actionBar(player, `Nothing to ${action.kind}`);
          return this.mapMenu(player);
        }
        this.link.send({ t: action.kind, by: player.name });
        this.reopenAfterHost(player);
        return;
      case "settings":
        return this.settingsMenu(player);
      case "boundaries":
        return this.boundariesMenu(player);
      case "preview": {
        const checklist = mapChecklist(this.state.current, this.info.rules);
        if (!checklist.ready) {
          tell(player, `§cFinish the checklist first:§r ${checklist.problems.join("; ")}`);
          return;
        }
        this.link.send({ t: "preview", by: player.name });
        actionBar(player, "Starting the preview...");
        return;
      }
      case "tool":
        this.pickTool(player, action.tool);
        return this.mapMenu(player);
      case "none":
        return this.mapMenu(player);
      case "help": {
        // How to use the tool, in chat, with a chime.
        const tool = EDITOR_TOOLS.find((candidate) => candidate.id === this.toolOut(player));
        if (tool) {
          tell(player, `§f${tool.label}: ${tool.howTo}`);
          playChime(player, "go");
        }
        return this.mapMenu(player);
      }
      case "entry": {
        const spec = markerSpecs(this.state.current, this.lists()).find((candidate) => candidate.key === action.key);
        if (spec) return this.markerMenu(player, spec, () => this.mapMenu(player));
        tell(player, "That entry changed since the menu opened. Open the map menu again.");
        return;
      }
      case "selection":
        return this.regionTool.selectionAction(player, action.action, () => this.mapMenu(player));
      case "box":
        return this.regionTool.boxMenu(player, action.key, () => this.mapMenu(player));
      case "killY":
        return this.killYTool.screen(player, undefined, () => this.mapMenu(player));
      case "removeKillY":
        this.killYTool.remove(player);
        return;
      case "cameraKind":
        this.cameraTool.toggleKind(player);
        return this.mapMenu(player);
      case "camera":
        return this.cameraTool.menu(player, action.name, () => this.mapMenu(player));
      case "save":
        this.save(player);
        return;
    }
  }

  /** Opens the map menu again once the host has answered (its status comes after undo and redo). */
  private reopenAfterHost(player: Player): void {
    const key = player.name.toLowerCase();
    this.reopen.add(key);
    this.scope.timeout(() => this.reopenMenu(key), REOPEN_TICKS);
  }

  private reopenMenu(key: string): void {
    if (!this.reopen.delete(key)) return;
    const player = world.getAllPlayers().find((candidate) => candidate.name.toLowerCase() === key);
    if (player) void this.mapMenu(player);
  }

  private save(player: Player): void {
    if (this.status.saving) {
      tell(player, "The world is being saved already.");
      return;
    }
    this.status = { ...this.status, saving: true };
    this.link.send({ t: "save", by: player.name });
    tell(player, "Saving the map and the world. The markers go away for a moment while it saves.");
  }

  private async checklistMenu(player: Player): Promise<void> {
    const checklist = mapChecklist(this.state.current, this.info.rules);
    const form = new ActionFormData().title(sideTitle("Checklist")).body(checklistBody(checklist)).button(BACK_TEXT, ICONS.back);
    for (const row of checklist.rows) form.button(rowText(row));
    form.button(publishText(checklist, this.state.current.draft === true, this.status.publishing === true));
    const response = await this.show(player, form);
    if (response?.selection === undefined || !player.isValid) return;
    if (response.selection === 0) return this.mapMenu(player);
    if (response.selection === checklist.rows.length + 1) return this.publish(player);
    const row = checklist.rows[response.selection - 1];
    if (!row) return;
    if (row.field === "bounds" || row.field === "regions") {
      this.regionTool.equip(player, row.key);
      return;
    }
    if (row.field === "killY") {
      this.killYTool.equip(player);
      return;
    }
    const list = this.lists().find((candidate) => candidate.key === row.key);
    if (!list) {
      tell(player, `There's no tool for ${row.label} yet: set it in map.json, and the editor picks up the change.`);
      return;
    }
    this.settingsOf(player).list = list.key;
    const tool = EDITOR_TOOLS.find((candidate) => candidate.id === "spawn");
    if (tool) this.equipTool(player, tool);
    tell(player, `Spawn tool set to ${list.label}: use it where the entry goes.`);
  }

  /** A tool's icon in the map menu: puts the tool away when it's out, else puts it in hand. */
  private pickTool(player: Player, id: ToolId): void {
    const tool = EDITOR_TOOLS.find((candidate) => candidate.id === id);
    const inventory = inventoryOf(player);
    if (!tool || !inventory) return;
    if (holds(inventory, tool.item)) {
      removeItems(inventory, new Set([tool.item]));
      actionBar(player, `${tool.label} put away`);
      return;
    }
    this.equipTool(player, tool);
    actionBar(player, `${tool.label} in slot 1`);
  }

  /**
   * Puts a tool in slot 1, unlocked, and selects it. Only one tool is out at a time: the others go
   * away, and whatever else was in slot 1 moves to a free slot (creative mode has more if there's none).
   */
  private equipTool(player: Player, tool: EditorTool): void {
    const inventory = inventoryOf(player);
    if (!inventory) return;
    for (let slot = 0; slot < inventory.size; slot++) {
      if (slot !== TOOL_SLOT && toolOf(inventory.getItem(slot)?.typeId ?? "")) inventory.setItem(slot, undefined);
    }
    const old = inventory.getItem(TOOL_SLOT);
    if (old?.typeId !== tool.item) {
      const item = new ItemStack(tool.item, 1);
      item.keepOnDeath = true;
      inventory.setItem(TOOL_SLOT, item);
      if (old && !toolOf(old.typeId)) inventory.addItem(old);
    }
    player.selectedSlotIndex = TOOL_SLOT;
  }

  /** Publish, after a confirm: the host saves, then commits and pushes the map's folder. */
  private async publish(player: Player): Promise<void> {
    if (this.status.publishing) {
      tell(player, "It's being published already.");
      return;
    }
    const checklist = mapChecklist(this.state.current, this.info.rules);
    if (!checklist.ready) {
      tell(player, `§cNot ready to publish:§r ${checklist.problems.join("; ")}`);
      return;
    }
    const form = new ActionFormData()
      .title(sideTitle("Publish?"))
      .body(publishBody(this.info.target, this.info.targetName, this.info.map, this.state.current))
      .button("Publish\n§7save, commit and push")
      .button("Cancel");
    const response = await this.show(player, form);
    if (response?.selection !== 0 || !player.isValid) return;
    this.status = { ...this.status, publishing: true };
    this.link.send({ t: "publish", by: player.name });
  }

  /** A switch per boundary the map has: switched on, it shows to this player whatever they hold. */
  private async boundariesMenu(player: Player): Promise<void> {
    const key = player.name.toLowerCase();
    const rows = boundaryRows(this.state.current, this.info.rules);
    const entries = boundaryEntries(rows, this.shown.get(key) ?? NONE_SHOWN);
    const body = rows.length > 0 ? BOUNDARIES_BODY : `${BOUNDARIES_BODY}\n\nThis map has no boundaries yet: the Region tool and the Kill Y tool make them.`;
    const form = new ActionFormData().title(sideTitle("Boundaries")).body(body).button(BACK_TEXT, ICONS.back);
    for (const entry of entries) form.button(entry.text);
    const response = await this.show(player, form);
    if (response?.selection === 0 && player.isValid) return this.mapMenu(player);
    const picked = response?.selection === undefined ? undefined : entries[response.selection - 1];
    if (!picked || !player.isValid) return;
    const next = toggleBoundary(
      this.shown.get(key) ?? NONE_SHOWN,
      picked.group,
      rows.map((row) => row.group),
    );
    this.shown.set(key, next);
    this.link.send({ t: "view", by: player.name, shown: [...next] });
    return this.boundariesMenu(player);
  }

  /** The gear: Players in its icon row, the map's settings, Back to Select, the red ones, and Back to Lobby at the bottom. */
  private async settingsMenu(player: Player): Promise<void> {
    const entries = gearEntries({ build: this.state.current.build !== undefined });
    const form = new ActionFormData().title(iconsTitle("Map settings")).body(`${this.state.current.name} (${this.info.map}), ${this.info.targetName}`);
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action === "back") return this.mapMenu(player);
    if (action === "settings") return this.settingsForm(player);
    if (action === "dropBuild") return this.dropBuild(player);
    if (action === "delete") return this.deleteMap(player);
    if (action === "players") return this.players.open(player, () => this.settingsMenu(player));
    this.link.send({ t: "open", by: player.name, request: { to: "home" } });
  }

  /**
   * Delete map, after a confirm: the host closes Edit, deletes the map's folder (and pushes its
   * removal when it was published), and takes it off its world's list in Select.
   */
  private async deleteMap(player: Player): Promise<void> {
    const config = this.state.current;
    const published = config.draft !== true;
    const body =
      `${config.name} (${this.info.map}) and its world are deleted from this PC, and it leaves its world's list in Select.` +
      (published ? " It's published, so its removal is committed and pushed too: it leaves the lobby at the network's next start." : "") +
      " Everyone in Edit goes to the editor lobby.";
    const form = new ActionFormData().title(sideTitle(`Delete ${config.name}?`)).body(body).button(dangerText("Delete it")).button("Cancel");
    const response = await this.show(player, form);
    if (response?.selection !== 0 || !player.isValid) return;
    this.link.send({ t: "deleteMap", by: player.name });
  }

  private async settingsForm(player: Player): Promise<void> {
    const config = this.state.current;
    // Game settings are a game's own top-level keys with a plain value, such as Sumo's eliminationY.
    const extras = Object.entries(config).filter(
      (entry): entry is [string, string | number | boolean] => !isMapKey(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1]),
    );
    const form = new ModalFormData().title(sideTitle("Map settings")).textField("Name", "The map's name", { defaultValue: config.name });
    for (const [key, value] of extras) form.textField(`${key} (${typeof value})`, String(value), { defaultValue: String(value) });
    form.submitButton("Save");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const [name, ...values] = response.formValues.map((value) => String(value ?? ""));
    const edits: MapEdit[] = [];
    if (name.trim() && name.trim() !== config.name) edits.push({ op: "name", name: name.trim() });
    extras.forEach(([key, old], i) => {
      const value = parseSetting(values[i] ?? "", old);
      if (value === undefined) tell(player, `§c${key} must be ${typeof old === "boolean" ? "true or false" : `a ${typeof old}`}; kept ${String(old)}.`);
      else if (value !== old) edits.push({ op: "extra", key, value });
    });
    if (edits.length > 0) this.edit(player, edits.length === 1 ? edits[0] : { op: "batch", edits }, "Map settings saved.");
  }

  private async dropBuild(player: Player): Promise<void> {
    const form = new ActionFormData()
      .title(sideTitle("Drop build commands"))
      .body("This map's world is built from its build commands by npm run bake, which would replace block changes made here. Drop them to keep the world as you change it.")
      .button(dangerText("Drop them"))
      .button("Cancel");
    const response = await this.show(player, form);
    if (response?.selection !== 0 || !player.isValid) return;
    this.edit(player, { op: "dropBuild" }, "Build commands dropped: the world is kept as you change it.");
  }

  // ---- Spawn tool and markers -------------------------------------------------------------

  /**
   * Where a use of the Spawn tool aims: on top of a block, exactly there; at a block's side, just
   * in front of that spot on the floor below it; at the sky, where the player stands.
   */
  private aimedAt(player: Player): { x: number; y: number; z: number } {
    const hit = player.getBlockFromViewDirection({ maxDistance: REACH, includeLiquidBlocks: true, includePassableBlocks: true });
    if (!hit) return player.location;
    const { point, onTop } = aimedPoint({ block: hit.block.location, face: hit.face as AimedFace["face"], faceLocation: hit.faceLocation });
    if (onTop) return point;
    try {
      const floor = this.dimension.getBlockBelow({ x: point.x, y: point.y + 0.5, z: point.z }, { maxDistance: FLOOR_REACH });
      return floor ? { ...point, y: floor.location.y + 1 } : point;
    } catch {
      return point;
    }
  }

  /** The Spawn tool: a new entry's screen, where the player aims, in the list they placed into last. */
  private spawnTool(player: Player): Promise<void> {
    const list = this.spawnList(player);
    if (!list) {
      tell(player, "This map's game has no spawns or points to place.");
      return Promise.resolve();
    }
    const settings = this.settingsOf(player);
    const view = player.getRotation();
    // Sneaking: where the player stands, the way they look.
    if (player.isSneaking) {
      return this.entryScreen(player, { list, at: pointOf(entryPosition(player.location, settings.center)), facing: snapFacing({ yaw: view.y, pitch: view.x }, settings.snap) });
    }
    const facing = settings.keepFacing ? snapFacing({ yaw: view.y, pitch: view.x }, settings.snap) : undefined;
    return this.entryScreen(player, { list, at: pointOf(entryPosition(this.aimedAt(player), settings.center)), facing });
  }

  /** A marker's screen (it was hit, or picked in the map menu, which `back` opens again). */
  private markerMenu(player: Player, spec: MarkerSpec, back?: () => Promise<void>): Promise<void> {
    const position = listOf(this.state.current, spec.list.target)[spec.index];
    if (!position) return Promise.resolve();
    return this.entryScreen(player, { list: spec.list, at: pointOf(position), facing: spec.facing, existing: { index: spec.index, position } }, back);
  }

  /**
   * Where a player's aim cursor goes: the spawn their screen sets up; else, holding the Spawn tool,
   * where a use would place one (sneaking: where they stand); holding the Region tool, the block a
   * use would grow the selection to. None while anyone looks through a camera.
   */
  private cursorAim(player: Player): CursorAim | undefined {
    if (this.cameraTool.anyoneLooking()) return undefined;
    const preview = this.entryPreview.get(player.name.toLowerCase());
    if (preview) return { kind: "point", at: preview.at, yaw: preview.yaw, style: preview.style };
    const tool = heldTool(player);
    if (tool === "spawn") {
      const settings = this.settingsOf(player);
      const at = pointOf(entryPosition(player.isSneaking ? player.location : this.aimedAt(player), settings.center));
      const yaw = player.isSneaking || settings.keepFacing ? player.getRotation().y : lookAt(at, mapMiddle(this.state.current)).yaw;
      return { kind: "point", at, yaw, style: this.spawnList(player)?.style ?? 0 };
    }
    if (tool === "region") {
      const block = blockInView(player);
      return block ? { kind: "block", at: block.location } : undefined;
    }
    return undefined;
  }

  /**
   * A spawn or point's screen: which list (a toggle), its position (typed, here, centered, or nudged
   * an axis at a time) and facing, the queue's settings for the queue spawn, Renumber and Delete for
   * one the map has, and Place or Save at the bottom. Nothing changes until then; the block it's in
   * is outlined meanwhile.
   */
  private async entryScreen(player: Player, start: { list: SpawnList; at: Point; facing?: Facing; existing?: { index: number; position: MapPosition } }, back?: () => Promise<void>): Promise<void> {
    const settings = this.settingsOf(player);
    let listKey = start.list.key;
    let at = start.at;
    let facing = start.facing;
    let step: number = POINT_STEPS[0];
    const name = start.existing ? (start.list.single ? start.list.entry : `${start.list.entry} ${start.existing.index + 1}`) : undefined;
    const facingBar = () => player.isValid && actionBar(player, `Facing ${titleCase(facingOf(player.getRotation().y))}   X+ is east, Z+ is south`);
    facingBar();
    const bar = system.runInterval(facingBar, FACING_TICKS);
    try {
      for (;;) {
        const lists = this.lists();
        const list = lists.find((candidate) => candidate.key === listKey) ?? lists[0];
        if (!list) return;
        // The cursor shows it where it will go, turned the way it will face.
        this.entryPreview.set(player.name.toLowerCase(), { at, yaw: (facing ?? lookAt(at, mapMiddle(this.state.current))).yaw, style: list.style });
        const existing = start.existing && { index: start.existing.index, count: listOf(this.state.current, start.list.target).length };
        const entries = entryScreenEntries({
          lists,
          list: list.key,
          at,
          facing,
          snap: settings.snap,
          center: settings.center,
          step,
          back: back !== undefined,
          existing,
          ...(list.key === "queueSpawn" ? { queue: queueSettings(this.state.current) } : {}),
        });
        const form = new ActionFormData().title(sideTitle(name ?? `New ${list.entry.toLowerCase()}`));
        for (const entry of entries) form.button(entry.text, entry.icon);
        const response = await this.show(player, form);
        const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
        if (!action || !player.isValid) return;
        if (action.kind === "back" && back) return back();
        if (start.existing && name && !this.unchanged(player, { list: start.list, index: start.existing.index }, start.existing.position, name)) return;
        switch (action.kind) {
          case "list":
            listKey = action.key;
            settings.list = action.key;
            break;
          case "type":
            at = (await this.typedPosition(player, at)) ?? at;
            break;
          case "here":
            at = pointOf(entryPosition(player.location, settings.center));
            break;
          case "center":
            settings.center = !settings.center;
            if (settings.center) at = pointOf(entryPosition(at, true));
            break;
          case "face": {
            const view = player.getRotation();
            facing = snapFacing({ yaw: view.y, pitch: view.x }, settings.snap);
            settings.keepFacing = true;
            break;
          }
          case "unface":
            facing = undefined;
            settings.keepFacing = false;
            break;
          case "snap":
            settings.snap = SNAPS[(SNAPS.findIndex((snap) => snap.snap === settings.snap) + 1) % SNAPS.length].snap;
            if (facing) facing = snapFacing(facing, settings.snap);
            break;
          case "axis": {
            const moved = [at.x, at.y, at.z];
            moved[action.axis] = Math.round((moved[action.axis] + action.by * step) * 100) / 100;
            at = { x: moved[0], y: moved[1], z: moved[2] };
            break;
          }
          case "step":
            step = action.step;
            break;
          case "queueMode": {
            const mode = queueSettings(this.state.current).mode === "lock" ? "free" : "lock";
            this.edit(player, { op: "queue", mode }, mode === "lock" ? "Queue: lock in. Players wait on the spot, invisible." : "Queue: free. Players roam until they're put at their spawns.");
            break;
          }
          case "queueCountdown":
            await this.queueCountdown(player);
            break;
          case "renumber":
            if (start.existing && name) await this.renumber(player, { list: start.list, index: start.existing.index }, listOf(this.state.current, start.list.target).length, name);
            return;
          case "delete":
            if (start.existing && name) this.edit(player, { op: "remove", target: start.list.target, index: start.existing.index }, `${name} deleted.`);
            return;
          case "save":
            this.saveEntry(player, list, at, facing, start.existing && name ? { list: start.list, index: start.existing.index, name } : undefined);
            return;
        }
      }
    } finally {
      this.entryPreview.delete(player.name.toLowerCase());
      system.clearRun(bar);
    }
  }

  /** Writes a spawn or point from its screen: a new one into `list`, or one the map has (moved, turned, or into another list). */
  private saveEntry(player: Player, list: SpawnList, at: Point, facing: Facing | undefined, existing?: { list: SpawnList; index: number; name: string }): void {
    const position = entryPosition(at, false, facing);
    const where = `${positionText(position)}${facing ? `, facing ${compass(facing.yaw)}` : ""}`;
    const count = listOf(this.state.current, list.target).length;
    const into = (): MapEdit => (list.single && count > 0 ? { op: "set", target: list.target, index: 0, at: position } : { op: "add", target: list.target, at: position });
    if (!existing) {
      const name = list.single ? list.entry : `${list.entry} ${count + 1}`;
      const done = `${name} ${list.single && count > 0 ? "moved" : "placed"} at ${where}`;
      if (this.edit(player, into(), `${done}.`)) actionBar(player, done);
      return;
    }
    const { target, index } = { target: existing.list.target, index: existing.index };
    if (existing.list.key === list.key) {
      const edits: MapEdit[] = [
        { op: "move", target, index, at: positionXyz(position) },
        facing ? { op: "face", target, index, facing } : { op: "face", target, index },
      ];
      this.edit(player, { op: "batch", edits }, `${existing.name} saved at ${where}.`);
      return;
    }
    this.edit(player, { op: "batch", edits: [{ op: "remove", target, index }, into()] }, `${existing.name} is now in ${list.label}, at ${where}.`);
  }

  /** A position typed in a side form ("x y z"); undefined (and why) when it isn't one. */
  private async typedPosition(player: Player, at: Point): Promise<Point | undefined> {
    const now = [at.x, at.y, at.z].join(" ");
    const form = new ModalFormData().title(sideTitle("Position")).textField("x y z (decimals are fine)", now, { defaultValue: now }).submitButton("Done");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return undefined;
    const values = String(response.formValues[0] ?? "").trim().split(/[\s,]+/).map(Number);
    if (values.length !== 3 || !values.every(Number.isFinite)) {
      tell(player, "§cA position is three numbers: x y z.");
      return undefined;
    }
    return { x: values[0], y: values[1], z: values[2] };
  }

  /** False (and a message) when the marker's entry changed while a form was open. */
  private unchanged(player: Player, spec: Pick<MarkerSpec, "list" | "index">, position: MapPosition, name: string): boolean {
    const now = listOf(this.state.current, spec.list.target)[spec.index];
    if (JSON.stringify(now) === JSON.stringify(position)) return true;
    tell(player, `${name} changed while the menu was open. Hit its marker again.`);
    return false;
  }

  private async queueCountdown(player: Player): Promise<void> {
    const now = queueSettings(this.state.current).countdown;
    const form = new ModalFormData()
      .title(sideTitle("Queue countdown"))
      .textField(`Seconds (${QUEUE_COUNTDOWN.min} to ${QUEUE_COUNTDOWN.max}), once everyone's in, before the spawns`, String(now), { defaultValue: String(now) })
      .submitButton("Save");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const countdown = parseCountdown(String(response.formValues[0] ?? ""));
    if (countdown === undefined) {
      tell(player, `§cThe countdown is whole seconds from ${QUEUE_COUNTDOWN.min} to ${QUEUE_COUNTDOWN.max}; kept ${now}.`);
      return;
    }
    if (countdown !== now) this.edit(player, { op: "queue", countdown }, `Queue countdown: ${countdown} s.`);
  }

  private async renumber(player: Player, spec: Pick<MarkerSpec, "list" | "index">, count: number, name: string): Promise<void> {
    const form = new ModalFormData()
      .title(sideTitle(`Renumber ${name}`))
      .dropdown("New number", Array.from({ length: count }, (_, i) => String(i + 1)), { defaultValueIndex: spec.index })
      .submitButton("Renumber");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const to = response.formValues[0] as number;
    const position = listOf(this.state.current, spec.list.target)[spec.index];
    if (to === spec.index || !position || !this.unchanged(player, spec, position, name)) return;
    this.edit(player, { op: "renumber", target: spec.list.target, from: spec.index, to }, `${name} is now number ${to + 1}.`);
  }
}

function tell(player: Player, text: string): void {
  player.sendMessage(`${PREFIX}${text}`);
}

/** A point from a map position (its x, y and z). */
function pointOf(position: MapPosition): Point {
  return { x: position[0], y: position[1], z: position[2] };
}

function titleCase(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function inventoryOf(player: Player): Container | undefined {
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

function holds(inventory: Container, typeId: string): boolean {
  for (let slot = 0; slot < inventory.size; slot++) if (inventory.getItem(slot)?.typeId === typeId) return true;
  return false;
}

function removeItems(inventory: Container, typeIds: Set<string>): void {
  for (let slot = 0; slot < inventory.size; slot++) {
    const item = inventory.getItem(slot);
    if (item && typeIds.has(item.typeId)) inventory.setItem(slot, undefined);
  }
}

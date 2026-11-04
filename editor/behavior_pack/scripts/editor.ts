// The map editor in game (Edit mode): the map menu and its checklist, the spawn tool and the
// markers (the region and Kill Y tools have their own files, and get what they need through a
// ToolHost). A change shows here at once and goes to the host (tools/editor), which writes
// map.json and answers; MapState keeps the two copies in step. Save asks the host to save the
// world into the map while it runs. Everyone here is a map editor (the server lets in LAN_PLAYERS
// only). Every control is a hit, a use or a form, never sneaking: players fly in creative, and
// sneaking while flying flies down.
import {
  BlockVolume,
  ButtonState,
  EntityComponentTypes,
  GameMode,
  InputButton,
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
  FAKE_PLAYER,
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
  type Box,
  type MapConfig,
  type MapEdit,
  type Facing,
  type MapPosition,
  type PictureInfo,
  type Scope,
  chatMapName,
  playChime,
} from "@minecade/minigame-core";
import { goto } from "./goto.ts";
import { keepModeLine, modeLine } from "./hud.ts";
import { KillYTool } from "./kill-y-tool.ts";
import { LoadingScreens } from "./loading.ts";
import { onGameSettings, onReplace, onReset } from "./commands.ts";
import { GameSettingsTool } from "./game-settings-tool.ts";
import { HostLink } from "./link.ts";
import { Overlay } from "./planes.ts";
import { PLANE_BLOCK } from "./sheets.ts";
import { boundaryRows, boundsAround, heightPlanes, outlineBoxes, toggleBoundary } from "./regions.ts";
import { CameraTool } from "./camera-tool.ts";
import { cameraMarkers, type CameraMarker } from "./cameras.ts";
import { MannequinBodies, MannequinTool } from "./mannequin-tool.ts";
import { mannequinsOf } from "./mannequins.ts";
import { RegionTool } from "./region-tool.ts";
import { REPLACE_LINE, ReplaceMode } from "./replace-mode.ts";
import { NOON, TimeTool } from "./time-tool.ts";
import { actionBar, heldTool, hintBar, notice, type ToolHost } from "./tool-host.ts";
import { REACH, blockInView, heightPreview, nudgePreview, previewEditing } from "./box-picker.ts";
import { facingOf, type Point } from "./boxes.ts";
import { Cursors, type CursorAim } from "./cursor.ts";
import { MARKER_STYLES, aimedPoint, compass, entryPosition, lookAt, mapMiddle, markerSpecs, snapFacing, SNAPS, spawnLists, toolLists, type AimedFace, type MarkerSpec, type PlaceTool, type SpawnList } from "./lists.ts";
import { MapState } from "./map-state.ts";
import { MARKER, Markers } from "./markers.ts";
import { dangerText, goText, iconsTitle, mapTitle, sideTitle } from "./marks.ts";
import {
  BACK_TEXT,
  BOUNDARIES_BODY,
  ICONS,
  boundaryEntries,
  gamePictureTexture,
  gearEntries,
  checklistBody,
  entryScreenEntries,
  importMapEntries,
  importTargetEntries,
  mapIdFrom,
  mapMenuEntries,
  mapPictureTexture,
  POINT_STEPS,
  parseCountdown,
  parseSetting,
  previewEntries,
  publishBody,
  publishText,
  rowText,
  thumbnailEntries,
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
/** A joining map editor is put in creative again this long after the welcome. */
const CREATIVE_AGAIN_TICKS = 20;

/** No boundary switched on. */
const NONE_SHOWN: ReadonlySet<string> = new Set();
/** On the world: the token of the save under way, for the host to find in the world's files. */
const SAVE_TOKEN = "minecade:saveToken";
/** How far the heights' planes reach around the first spawn on a map without bounds. */
const HEIGHT_REACH = 24;


export class Editor {
  private readonly scope: Scope;
  private readonly info: EditInfo;
  private readonly state: MapState;
  private readonly link: HostLink;
  private readonly markers: Markers<MarkerSpec | CameraMarker>;
  private readonly mannequins: MannequinBodies;
  private readonly regionTool: RegionTool;
  private readonly killYTool: KillYTool;
  private readonly timeTool: TimeTool;
  private readonly gameSettingsTool: GameSettingsTool;
  private readonly cameraTool: CameraTool;
  private readonly mannequinTool: MannequinTool;
  private readonly loading: LoadingScreens;
  private readonly cursors: Cursors;
  /** The boundaries, as plane blocks. */
  private readonly overlay: Overlay;
  private readonly replaceMode: ReplaceMode;
  /** The spawn or point each player's screen is setting up: the cursor shows it there. */
  private readonly entryPreview = new Map<string, { at: Point; yaw: number; style: number }>();
  private readonly dimension: Dimension;
  private readonly settings = new Map<string, SpawnSettings>();
  private readonly formOpen = new Set<string>();
  /** Players with the map menu open and the Region or Kill Y tool picked, and which: the boundaries show as if they held it. */
  private readonly menuTool = new Map<string, ToolId>();
  /** Players whose map menu opens again when the host answers (after Undo or Redo). */
  private readonly reopen = new Set<string>();
  /** Each player's Boundaries switches, by lower-case name (kept by the host between maps). */
  private readonly shown = new Map<string, Set<string>>();
  /** The pictures in the pack for the thumbnail menus, with which ones the map and game use now. */
  private readonly pictures: PictureInfo;
  private status: { undo?: string; redo?: string; unsaved: boolean; saving: boolean; publishing?: boolean };
  /** The time of day the world shows: the map's. */
  private shownTime?: number;
  /** When block changes were last reported to the host, in ticks. */
  private changedAt = -CHANGED_TICKS;

  constructor(scope: Scope, info: EditInfo, map: MapConfig) {
    this.scope = scope;
    this.info = info;
    this.state = new MapState(map);
    this.dimension = world.getDimension("overworld");
    this.status = { unsaved: info.fresh, saving: false };
    for (const [name, groups] of Object.entries(info.view ?? {})) this.shown.set(name.toLowerCase(), new Set(groups));
    this.pictures = JSON.parse(JSON.stringify(info.pictures ?? { shots: [], current: {}, maps: [] })) as PictureInfo;
    this.markers = new Markers<MarkerSpec | CameraMarker>(this.dimension, scope);
    this.mannequins = new MannequinBodies(this.dimension, scope);
    this.link = new HostLink(scope, {
      config: (config, seq) => {
        this.state.replace(config, seq);
        this.refresh();
      },
      message: (message) => this.receive(message),
    });
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
    this.timeTool = new TimeTool(host);
    this.gameSettingsTool = new GameSettingsTool(host);
    this.mannequinTool = new MannequinTool({ ...host, aimedAt: (player) => this.aimedAt(player) });
    this.loading = new LoadingScreens(scope, (player, form) => this.show(player, form));
    this.cursors = new Cursors(scope, this.dimension, (player) => this.cursorAim(player));
    this.cameraTool = new CameraTool({
      ...host,
      targetName: info.targetName,
      picture: (player, kind) => this.link.send({ t: "picture", by: player.name, kind }),
      lookChanged: () => {
        if (this.cameraTool.anyoneLooking()) this.markers.hide();
        else this.markers.unhide();
        if (this.cameraTool.anyoneLookingAt("map")) this.mannequins.hide();
        else this.mannequins.unhide();
      },
      holdSnapshot: (player) => {
        const tool = EDITOR_TOOLS.find((candidate) => candidate.id === "snapshot");
        if (tool && heldTool(player) !== "snapshot") this.equipTool(player, tool);
      },
    });
    this.replaceMode = new ReplaceMode(scope, TOOLS, (player, block) => {
      this.blocksChanged(player.name);
      this.overlay.blockChanged([block.location.x, block.location.y, block.location.z]);
    });
    this.overlay = new Overlay(this.dimension, scope, {
      views: () =>
        world.getAllPlayers().map((player) => {
          const key = player.name.toLowerCase();
          const nudged = nudgePreview(player);
          const height = heightPreview(player);
          const selection = this.regionTool.selectionOf(player)?.box;
          // With the Region or Kill Y tool picked, the map menu shows what holding it would.
          const tool = heldTool(player) ?? this.menuTool.get(key);
          return {
            shown: this.shown.get(key) ?? NONE_SHOWN,
            ...(tool ? { tool } : {}),
            ...(selection ? { selection } : {}),
            ...(nudged ? { nudged: { box: nudged, editing: previewEditing(player) } } : {}),
            ...(height ? { height } : {}),
          };
        }),
      boxes: () => outlineBoxes(this.state.current, info.rules),
      heights: () => heightPlanes(this.state.current),
      over: () => boundsAround(this.state.current) ?? aroundSpawn(this.state.current),
      hidden: () => this.cameraTool.anyoneLooking(),
    });
  }

  start(): void {
    const scope = this.scope;
    // Steady light and weather to build in; the map's own time when it has one.
    world.gameRules.doDayLightCycle = false;
    world.gameRules.doWeatherCycle = false;
    world.gameRules.doMobSpawning = false;
    // The map's command blocks could clear the map menu or change game modes.
    world.gameRules.commandBlocksEnabled = false;
    world.setTimeOfDay(mapTimeTicks(this.state.current.time) ?? NOON);

    scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      // Creative at every spawn, not only the first: a mode saved with the player in this world
      // can come back after the welcome, and then blocks can't be broken.
      if (initialSpawn) scope.defer(() => this.welcome(player));
      else scope.defer(() => this.creative(player));
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.cameraTool.forget(playerName);
      this.settings.delete(playerName.toLowerCase());
      this.formOpen.delete(playerName.toLowerCase());
      this.reopen.delete(playerName.toLowerCase());
    });
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!TOOLS.has(itemStack.typeId)) return;
      // Looking through a camera, any use brings the Snapshot menu back (Back to my view is in it).
      if (this.cameraTool.isLooking(source)) {
        void this.cameraTool.snapshot(source);
        return;
      }
      const tool = toolOf(itemStack.typeId)?.id;
      if (itemStack.typeId === MAP_MENU) void this.mapMenu(source);
      else if (tool === "spawn" || tool === "marker") void this.spawnTool(source, tool);
      else if (tool === "region") this.regionTool.use(source);
      else if (tool === "killY") void this.killYTool.use(source, () => this.mapMenu(source));
      else if (tool === "time") void this.timeTool.use(source, () => this.mapMenu(source));
      else if (tool === "gameSettings") void this.gameSettingsTool.use(source, () => this.mapMenu(source));
      else if (tool === "camera") this.cameraTool.use(source);
      else if (tool === "snapshot") void this.cameraTool.snapshot(source);
      else if (tool === "mannequin") this.mannequinTool.use(source);
    });
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      // A mannequin, hit with anything: its screen.
      const mannequin = this.mannequins.nameOf(hitEntity);
      if (mannequin) return void this.mannequinTool.screen(player, mannequin);
      if (hitEntity.typeId !== MARKER) return;
      const spec = this.markers.specOf(hitEntity);
      if (spec) void ("camera" in spec ? this.cameraTool.snapshotOf(player, spec.camera) : this.markerMenu(player, spec));
    });
    // Shift brings a player looking through a camera back to their own view (the button, so it works
    // while flying, where shift doesn't sneak).
    scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => {
        if (this.cameraTool.isLooking(player)) this.cameraTool.stop(player);
      },
      { buttons: [InputButton.Sneak], state: ButtonState.Pressed },
    );
    // A right click on a camera's marker: its kind and Delete (only cameras' markers can be right
    // clicked); on a mannequin, its screen, or sneaking, its next pose.
    scope.subscribe(world.afterEvents.playerInteractWithEntity, ({ player, target }) => {
      const mannequin = this.mannequins.nameOf(target);
      if (mannequin) return void (player.isSneaking ? this.mannequinTool.nextPose(player, mannequin) : this.mannequinTool.screen(player, mannequin));
      if (target.typeId !== MARKER) return;
      const spec = this.markers.specOf(target);
      if (spec && "camera" in spec) void this.cameraTool.menu(player, spec.camera);
    });
    // A tool never breaks the block it hits, which creative mode would.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      if (event.itemStack && TOOLS.has(event.itemStack.typeId)) event.cancel = true;
    });
    scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player }) => this.blocksChanged(player.name));
    scope.subscribe(world.afterEvents.playerBreakBlock, ({ player, block }) => {
      this.blocksChanged(player.name);
      // A boundary through that block shows there again.
      this.overlay.blockChanged([block.location.x, block.location.y, block.location.z]);
    });
    scope.interval(() => this.hints(), HINT_TICKS);
    scope.interval(() => this.checkItems(), ITEMS_TICKS);
    onReset((player) => this.reset(player));
    onReplace((player) => this.replaceMode.toggle(player));
    onGameSettings((player) => void this.gameSettingsTool.screen(player));
    keepModeLine(scope, () => modeLine("edit", `${this.info.targetName}: ${this.state.current.name}`), (player) => this.cameraTool.isLooking(player));
    this.refresh();
    void this.prepareWorld();
  }

  /**
   * Sweeps up markers, mannequins and boundary planes an earlier run left (in the world, so it needs
   * a save without them), lays a new map's pad, then tells the host the editor is ready.
   */
  private async prepareWorld(): Promise<void> {
    try {
      const leftovers = this.markers.remembered || this.mannequins.remembered || this.overlay.remembered;
      const left = await this.markers.clear();
      if (left > 0) log.warn(`${left} markers from an earlier run could not be removed`);
      const bodies = await this.mannequins.clear();
      if (bodies > 0) log.warn(`${bodies} mannequins from an earlier run could not be removed`);
      const planes = await this.overlay.clear();
      if (planes > 0) log.warn(`boundary planes from an earlier run could not be removed in ${planes} chunks`);
      if (leftovers) {
        this.status = { ...this.status, unsaved: true };
        this.link.send({ t: "changed", by: "the editor", leftovers: true });
      }
      if (this.info.fresh) await this.layPad();
    } catch (error) {
      log.error(`preparing the world failed: ${describeError(error)}`);
    }
    this.markers.resume();
    this.mannequins.resume();
    this.overlay.resume();
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
      case "loading":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) void this.loading.wait(player, message.label);
        return;
      case "loaded":
        for (const player of world.getAllPlayers()) if (message.players.includes(player.name)) this.loading.stop(player);
        return;
      case "cleanup":
        // The aim cursors, mannequins and boundary planes aren't saved with the world either.
        this.cursors.pause();
        // One after the other: each loads chunks with ticking areas, which share one budget.
        void this.markers
          .clear()
          .then(async (markers) => markers + (await this.mannequins.clear()))
          .then(async (left) => left + (await this.overlay.clear()))
          .then(
          (left) => {
            // The host copies the world once the save's write has the token (tools/editor/world-log.ts).
            if (message.token) world.setDynamicProperty(SAVE_TOKEN, message.token);
            this.link.send({ t: "clean", id: message.id, left });
          },
          (error: unknown) => this.link.send({ t: "clean", id: message.id, left: -1, error: describeError(error) }),
        );
        return;
      case "resume":
        world.setDynamicProperty(SAVE_TOKEN, undefined);
        this.markers.resume();
        this.mannequins.resume();
        this.overlay.resume();
        this.cursors.resume();
        return;
    }
  }

  private refresh(): void {
    this.markers.show([...markerSpecs(this.state.current, this.lists()), ...cameraMarkers(this.state.current)]);
    this.mannequins.show(mannequinsOf(this.state.current));
    // The map's time, when it changed (the Time tool, Undo).
    const time = mapTimeTicks(this.state.current.time) ?? NOON;
    if (time !== this.shownTime) {
      this.shownTime = time;
      world.setTimeOfDay(time);
    }
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

  /** The list the Spawn tool (or the Game marker tool) places into: the one picked, or the first when that one is gone. */
  private spawnList(player: Player, tool: PlaceTool = "spawn"): SpawnList | undefined {
    const lists = toolLists(this.lists(), tool);
    const settings = this.settingsOf(player);
    const picked = tool === "spawn" ? settings.list : settings.marker;
    const list = lists.find((candidate) => candidate.key === picked) ?? lists[0];
    if (list && tool === "spawn") settings.list = list.key;
    else if (list) settings.marker = list.key;
    return list;
  }

  private welcome(player: Player): void {
    if (!player.isValid) return;
    // Saved player data in the world could hold another game mode, and can be applied a moment
    // after the first spawn: creative again a second later.
    this.creative(player);
    this.scope.timeout(() => this.creative(player), CREATIVE_AGAIN_TICKS);
    const where = `${chatMapName(this.info.targetName, this.state.current.name)}.`;
    this.giveItems(player);
    tell(player, `${where} The map menu in slot 9 has the checklist, the tools and Save. Hit a marker to change it.`);
  }

  private creative(player: Player): void {
    try {
      if (player.isValid && player.getGameMode() !== GameMode.Creative) player.setGameMode(GameMode.Creative);
    } catch {
      // left meanwhile
    }
  }

  /** The map menu (slot 9), locked in place, for a player missing it. */
  private giveItems(player: Player): void {
    const inventory = inventoryOf(player);
    if (!inventory) return;
    if (!holds(inventory, MAP_MENU)) {
      const menu = new ItemStack(MAP_MENU, 1);
      menu.lockMode = ItemLockMode.slot;
      menu.keepOnDeath = true;
      inventory.setItem(MENU_SLOT, menu);
    }
  }

  /** /reset: creative mode and the map menu, at once. */
  private reset(player: Player): void {
    if (!player.isValid) return;
    player.setGameMode(GameMode.Creative);
    this.giveItems(player);
    tell(player, "Reset: creative mode, and your map editor items.");
  }

  /** Players missing the map menu get it back (a command block may have cleared it). */
  private checkItems(): void {
    for (const player of world.getAllPlayers()) {
      const inventory = inventoryOf(player);
      if (!inventory || holds(inventory, MAP_MENU)) continue;
      this.giveItems(player);
      tell(player, "Your map editor items were gone: they're back. /reset also brings back creative mode.");
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
      // Replace mode's box top right, while no tool's hint is up.
      if (!tool && this.replaceMode.has(player) && !this.cameraTool.isLooking(player)) hintBar(player, REPLACE_LINE);
      // Nudge sides puts the way the player faces there instead.
      if (!tool || this.cameraTool.isLooking(player) || nudgePreview(player)) continue;
      if (tool === "spawn" || tool === "marker") hintBar(player, this.spawnHint(player, tool));
      else if (tool === "region") hintBar(player, this.regionTool.hint(player));
      else if (tool === "killY") hintBar(player, this.killYTool.hint(player));
      else if (tool === "time") hintBar(player, this.timeTool.hint());
      else if (tool === "gameSettings") hintBar(player, this.gameSettingsTool.hint(player));
      else if (tool === "camera") hintBar(player, this.cameraTool.hint(player));
      else if (tool === "mannequin") hintBar(player, this.mannequinTool.hint());
      else if (tool === "snapshot") hintBar(player, "Use: pick a camera to take its picture   Hit a camera: the same");
    }
  }

  private spawnHint(player: Player, tool: PlaceTool): string {
    const list = this.spawnList(player, tool);
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
    if (tool === "spawn" || tool === "marker") this.spawnList(player, tool);
    const entries = mapMenuEntries({
      config,
      checklist: mapChecklist(config, this.info.rules),
      ...(this.info.rules.kind === "game" ? { game: this.info.targetName } : {}),
      tool,
      ...this.status,
      spawn: { lists: this.lists(), settings: this.settingsOf(player) },
      region: { selection: this.regionTool.menuSelection(player), entries: tool === "region" ? this.regionTool.entries() : [] },
      camera: { kind: this.cameraTool.kindOf(player) },
      items: this.info.rules.items ?? [],
      gameSettings: this.gameSettingsTool.settings,
    });
    // The map and game are in the mode box top center, and how to use the tool is behind Help.
    const form = new ActionFormData().title(mapTitle("Map menu"));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const key = player.name.toLowerCase();
    if (tool === "region" || tool === "killY") this.menuTool.set(key, tool);
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
        return this.previewMenu(player);
      }
      case "tool":
        // The menu stays closed: the tool is in hand (or put away).
        this.pickTool(player, action.tool);
        return;
      case "none":
        return this.mapMenu(player);
      case "help": {
        // How to use the tool, in chat, with a chime; the menu stays closed so the chat can be read.
        const tool = EDITOR_TOOLS.find((candidate) => candidate.id === this.toolOut(player));
        if (tool) {
          tell(player, `§f${tool.label}: ${tool.howTo}`);
          playChime(player, "go");
        }
        return;
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
        return this.killYTool.screen(player, action.line, () => this.mapMenu(player));
      case "time":
        return this.timeTool.screen(player, () => this.mapMenu(player));
      case "gameSetting":
        return this.gameSettingsTool.screen(player, action.key, () => this.mapMenu(player));
      case "cameraKind":
        this.cameraTool.toggleKind(player);
        return this.mapMenu(player);
      case "camera":
        return this.cameraTool.menu(player, action.name, () => this.mapMenu(player));
      case "snapshot":
        return this.cameraTool.snapshotOf(player, action.name);
      case "mannequin":
        return this.mannequinTool.screen(player, action.name, () => this.mapMenu(player));
      case "mannequinsInPreview": {
        const on = this.state.current.mannequinsInPreview !== true;
        this.edit(player, { op: "mannequinsInPreview", on }, on ? "Mannequins stand in this map's previews now." : "Previews of this map have no mannequins now.");
        return this.mapMenu(player);
      }
      case "save":
        this.save(player);
        return;
    }
  }

  /**
   * Before a preview loads: how many fake players its match starts with (none up to what fits
   * beside everyone here, who all go), then Start preview.
   */
  private async previewMenu(player: Player, fakes = 0): Promise<void> {
    const most = Math.max(0, (this.info.rules.maxPlayers ?? 1) - world.getAllPlayers().length);
    const entries = previewEntries({ fakes, most, back: true });
    const form = new ActionFormData().title(sideTitle("Preview"));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action.kind === "back") return this.mapMenu(player);
    if (action.kind === "fakes") return this.previewMenu(player, action.fakes);
    if (action.kind === "none") return this.previewMenu(player, fakes);
    this.link.send({ t: "preview", by: player.name, fakes: Math.min(fakes, most) });
    actionBar(player, "Starting the preview...");
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
    if (row.field === "killY" || row.field === "buildLimit") {
      this.killYTool.equip(player, row.field === "buildLimit" && (row.name === "above" || row.name === "below") ? row.name : "killY");
      return;
    }
    const list = this.lists().find((candidate) => candidate.key === row.key);
    if (!list) {
      tell(player, `There's no tool for ${row.label} yet: set it in map.json, and the editor picks up the change.`);
      return;
    }
    const settings = this.settingsOf(player);
    if (list.tool === "spawn") settings.list = list.key;
    else settings.marker = list.key;
    const tool = EDITOR_TOOLS.find((candidate) => candidate.id === list.tool);
    if (tool) this.equipTool(player, tool);
    tell(player, `${tool?.label ?? "Spawn tool"} set to ${list.label}: use it where the entry goes.`);
  }

  /** A tool's icon in the map menu: puts the tool away when it's out, else puts it in hand. */
  private pickTool(player: Player, id: ToolId): void {
    const tool = EDITOR_TOOLS.find((candidate) => candidate.id === id);
    const inventory = inventoryOf(player);
    if (!tool || !inventory) return;
    if (holds(inventory, tool.item)) {
      removeItems(inventory, new Set([tool.item]));
      if (tool.id === "snapshot") this.cameraTool.stop(player);
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
    if (tool.id !== "snapshot") this.cameraTool.stop(player);
    this.putItem(inventory, TOOL_SLOT, tool.item);
    player.selectedSlotIndex = TOOL_SLOT;
  }

  /** An editor item in `slot` (kept on death), moving whatever else was there to a free slot. */
  private putItem(inventory: Container, slot: number, typeId: string): void {
    const old = inventory.getItem(slot);
    if (old?.typeId === typeId) return;
    const item = new ItemStack(typeId, 1);
    item.keepOnDeath = true;
    inventory.setItem(slot, item);
    if (old && !toolOf(old.typeId)) inventory.addItem(old);
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

  /** The gear: Back to Lobby in its icon row, Name and map id, the thumbnails (a game's map), then the red ones. */
  private async settingsMenu(player: Player): Promise<void> {
    const entries = gearEntries({ build: this.state.current.build !== undefined, game: this.info.rules.kind === "game" });
    const form = new ActionFormData().title(iconsTitle("Map settings")).body(`${this.state.current.name} (${this.info.map}), ${this.info.targetName}`);
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action === "back") return this.mapMenu(player);
    if (action === "settings") return this.settingsForm(player);
    if (action === "dropBuild") return this.dropBuild(player);
    if (action === "publish") return this.publish(player);
    if (action === "delete") return this.deleteMap(player);
    if (action === "mapThumbnail") return this.thumbnailMenu(player, "map");
    if (action === "gameThumbnail") return this.thumbnailMenu(player, "game");
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
    // Other keys of a game's own with a plain value, as text: the settings its config names are the
    // Game settings tool's.
    const declared = new Set(this.gameSettingsTool.settings.map((setting) => setting.key));
    const extras = Object.entries(config).filter(
      (entry): entry is [string, string | number | boolean] => !isMapKey(entry[0]) && !declared.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1]),
    );
    // The map id shows once the map has a name: the form opens again with it after a first name.
    const named = config.name.trim() !== "";
    const form = new ModalFormData().title(sideTitle("Map settings")).textField("Name", "The map's name", { defaultValue: config.name });
    if (named) form.textField("Map id", this.info.map, { defaultValue: this.info.map });
    for (const [key, value] of extras) form.textField(`${key} (${typeof value})`, String(value), { defaultValue: String(value) });
    form.submitButton("Save");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const [name, ...rest] = response.formValues.map((value) => String(value ?? ""));
    const id = named ? (rest.shift() ?? "").trim() : this.info.map;
    const edits: MapEdit[] = [];
    if (name.trim() && name.trim() !== config.name) edits.push({ op: "name", name: name.trim() });
    extras.forEach(([key, old], i) => {
      const value = parseSetting(rest[i] ?? "", old);
      if (value === undefined) tell(player, `§c${key} must be ${typeof old === "boolean" ? "true or false" : `a ${typeof old}`}; kept ${String(old)}.`);
      else if (value !== old) edits.push({ op: "extra", key, value });
    });
    if (edits.length > 0) this.edit(player, edits.length === 1 ? edits[0] : { op: "batch", edits }, "Map settings saved.");
    if (id && id !== this.info.map) this.renameMap(player, id);
    else if (!named && name.trim()) return this.settingsForm(player);
  }

  /** Gives the map another id: the host saves, closes Edit and opens it again under that id. */
  private renameMap(player: Player, id: string): void {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) {
      tell(player, `§c"${id}" is not a map id: use lower case letters, digits, _ and -.`);
      return;
    }
    this.link.send({ t: "renameMap", by: player.name, map: id });
    tell(player, `The map id becomes ${id}: Edit saves, then opens it again under that id.`);
  }

  // ---- Thumbnails ---------------------------------------------------------------------------

  /**
   * Edit Map Thumbnail or Edit Minigame Thumbnail: the pictures used before, two to a row, the one
   * in use outlined green; tap one to use it. A map's also offers Import from another minigame.
   */
  private async thumbnailMenu(player: Player, kind: "map" | "game"): Promise<void> {
    const own = kind === "map" ? mapPictureTexture(this.info.target, this.info.map) : gamePictureTexture(this.info.target);
    const entries = thumbnailEntries({ kind, pictures: this.pictures, own });
    const form = new ActionFormData().title(sideTitle(kind === "map" ? "Map thumbnail" : "Minigame thumbnail"));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action.kind === "back") return this.settingsMenu(player);
    if (action.kind === "import") return this.importMenu(player);
    if (action.kind === "shot") {
      this.link.send({ t: "thumbnail", by: player.name, kind, shot: action.id });
      this.pictures.current[kind] = action.id;
    }
    return this.thumbnailMenu(player, kind);
  }

  /** Import from another minigame: the games with maps that have a picture. */
  private async importMenu(player: Player): Promise<void> {
    const targets = importTargetEntries(this.pictures, this.info.target);
    const form = new ActionFormData().title(sideTitle("Import a thumbnail")).button(BACK_TEXT, ICONS.back);
    if (targets.length === 0) form.body("No other game has a map with a picture yet.");
    for (const { text } of targets) form.button(text);
    const response = await this.show(player, form);
    if (response?.selection === undefined || !player.isValid) return;
    if (response.selection === 0) return this.thumbnailMenu(player, "map");
    const target = targets[response.selection - 1]?.target;
    if (target) return this.importMapMenu(player, target);
  }

  /**
   * A game's maps with a picture, as cards. Picking one asks first, then uses its picture, then
   * asks whether this map takes its name and map id too (Edit opens it again under that id).
   */
  private async importMapMenu(player: Player, target: string): Promise<void> {
    const entries = importMapEntries(this.pictures, target);
    const targetName = this.pictures.maps.find((map) => map.target === target)?.targetName ?? target;
    const form = new ActionFormData().title(sideTitle(targetName));
    for (const entry of entries) form.button(entry.text, entry.icon);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action.kind === "back") return this.importMenu(player);
    const here = this.state.current.name;
    const confirm = new ActionFormData()
      .title(sideTitle("Use its thumbnail?"))
      .body(`${targetName}'s ${action.name} picture becomes ${here}'s thumbnail.`)
      .button(goText("Use it"))
      .button("Cancel");
    if ((await this.show(player, confirm))?.selection !== 0 || !player.isValid) return this.importMapMenu(player, target);
    this.link.send({ t: "importPicture", by: player.name, target, map: action.map });
    this.pictures.current.map = undefined;
    const sameName = action.name === here && action.map === this.info.map;
    if (sameName) return;
    const naming = new ActionFormData()
      .title(sideTitle("Import map name?"))
      .body(`Call this map ${action.name} (${action.map}) too? ${action.map === this.info.map ? "" : "Edit saves, then opens it again under that map id."}`.trim())
      .button(goText("Import name"))
      .button("Keep mine");
    if ((await this.show(player, naming))?.selection !== 0 || !player.isValid) return;
    if (action.name !== here) this.edit(player, { op: "name", name: action.name }, `Named ${action.name}.`);
    if (action.map !== this.info.map) this.renameMap(player, mapIdFrom(action.map));
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
   * in front of that spot on the floor below it; at the sky, nowhere (no tool opens a menu there).
   */
  private aimedAt(player: Player): { x: number; y: number; z: number } | undefined {
    const hit = player.getBlockFromViewDirection({ maxDistance: REACH, includeLiquidBlocks: true, includePassableBlocks: true, excludeTypes: [PLANE_BLOCK] });
    if (!hit) return undefined;
    const { point, onTop } = aimedPoint({ block: hit.block.location, face: hit.face as AimedFace["face"], faceLocation: hit.faceLocation });
    if (onTop) return point;
    try {
      const floor = this.dimension.getBlockBelow({ x: point.x, y: point.y + 0.5, z: point.z }, { maxDistance: FLOOR_REACH, excludeTypes: [PLANE_BLOCK] });
      return floor ? { ...point, y: floor.location.y + 1 } : point;
    } catch {
      return point;
    }
  }

  /** The Spawn tool or the Game marker tool: a new entry's screen, where the player aims, in the list they placed into last. */
  private spawnTool(player: Player, tool: PlaceTool): Promise<void> {
    const list = this.spawnList(player, tool);
    if (!list) {
      tell(player, tool === "spawn" ? "This map's game has no spawns to place." : "This map's game has no markers of its own.");
      return Promise.resolve();
    }
    const settings = this.settingsOf(player);
    const view = player.getRotation();
    // Sneaking: where the player stands, the way they look.
    if (player.isSneaking) {
      return this.entryScreen(player, { list, at: pointOf(entryPosition(player.location, settings.center)), facing: snapFacing({ yaw: view.y, pitch: view.x }, settings.snap) });
    }
    const aimed = this.aimedAt(player);
    if (!aimed) {
      actionBar(player, "Aim at a block to place it");
      return Promise.resolve();
    }
    const facing = settings.keepFacing ? snapFacing({ yaw: view.y, pitch: view.x }, settings.snap) : undefined;
    return this.entryScreen(player, { list, at: pointOf(entryPosition(aimed, settings.center)), facing });
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
    if (tool === "spawn" || tool === "marker") {
      const settings = this.settingsOf(player);
      const aimed = player.isSneaking ? player.location : this.aimedAt(player);
      if (!aimed) return undefined;
      const at = pointOf(entryPosition(aimed, settings.center));
      const yaw = player.isSneaking || settings.keepFacing ? player.getRotation().y : lookAt(at, mapMiddle(this.state.current)).yaw;
      return { kind: "point", at, yaw, style: this.spawnList(player, tool)?.style ?? 0 };
    }
    if (tool === "region") {
      const block = blockInView(player);
      return block ? { kind: "block", at: block.location } : undefined;
    }
    if (tool === "mannequin") {
      // A see-through mannequin where a use would place one, facing the player.
      const aimed = this.aimedAt(player);
      return aimed ? { kind: "point", at: aimed, yaw: player.getRotation().y + 180, style: MARKER_STYLES.player } : undefined;
    }
    // Replace mode, a block in hand: the block a right click would replace.
    const held = this.replaceMode.has(player) ? inventoryOf(player)?.getItem(player.selectedSlotIndex)?.typeId : undefined;
    if (held && this.replaceMode.isBlock(held)) {
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
    const tool = start.list.tool;
    let listKey = start.list.key;
    let open: "group" | "team" | undefined;
    let at = start.at;
    let facing = start.facing;
    let step: number = POINT_STEPS[0];
    const name = start.existing ? (start.list.single ? start.list.entry : `${start.list.entry} ${start.existing.index + 1}`) : undefined;
    const facingBar = () => player.isValid && actionBar(player, `Facing ${titleCase(facingOf(player.getRotation().y))}   X+ is east, Z+ is south`);
    facingBar();
    const bar = system.runInterval(facingBar, FACING_TICKS);
    try {
      for (;;) {
        const lists = toolLists(this.lists(), tool);
        const list = lists.find((candidate) => candidate.key === listKey) ?? lists[0];
        if (!list) return;
        // The cursor shows it where it will go, turned the way it will face.
        this.entryPreview.set(player.name.toLowerCase(), { at, yaw: (facing ?? lookAt(at, mapMiddle(this.state.current))).yaw, style: list.style });
        const existing = start.existing && { index: start.existing.index, count: listOf(this.state.current, start.list.target).length };
        const entries = entryScreenEntries({
          lists,
          list: list.key,
          ...(open ? { open } : {}),
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
            if (tool === "spawn") settings.list = action.key;
            else settings.marker = action.key;
            open = undefined;
            break;
          case "open":
            open = open === action.which ? undefined : action.which;
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
            // Placed: the next new one starts over, from the first choices.
            if (!start.existing) this.settings.delete(player.name.toLowerCase());
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

/** Where the heights stretch on a map without bounds: around its first spawn. */
function aroundSpawn(config: MapConfig): Box {
  const [x, y, z] = (config.spawns[0] ?? [0, 64, 0]).map(Math.floor);
  return { min: [x - HEIGHT_REACH, y, z - HEIGHT_REACH], max: [x + HEIGHT_REACH, y, z + HEIGHT_REACH] };
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

// The map editor in game (Edit mode): roles, the map menu and its checklist, the spawn tool and
// the markers. A change shows here at once and goes to the host (tools/editor), which writes
// map.json and answers; MapState keeps the two copies in step. Map editors (EditorInfo.editors)
// get the tools; everyone else builds in creative. Every control is a hit, a use or a form, never
// sneaking: players fly in creative, and sneaking while flying flies down.
import {
  BlockVolume,
  EntityComponentTypes,
  GameMode,
  ItemLockMode,
  ItemStack,
  world,
  type Container,
  type Dimension,
  type Player,
} from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import {
  MapEditError,
  describeError,
  isMapKey,
  listOf,
  log,
  mapChecklist,
  mapTimeTicks,
  showForm,
  type EditorInfo,
  type HostMessage,
  type MapConfig,
  type MapEdit,
  type MapPosition,
  type Scope,
} from "@minecade/minigame-core";
import { HostLink } from "./link.ts";
import { blockPosition, compass, markerSpecs, snapFacing, SNAPS, spawnLists, type MarkerSpec, type Snap, type SpawnList } from "./lists.ts";
import { MapState } from "./map-state.ts";
import { MARKER, Markers } from "./markers.ts";
import { checklistBody, menuBody, menuEntries, parseSetting, rowText, sideTitle, type MenuEntry } from "./menu.ts";
import { EDITOR_TOOLS, toolOf, type EditorTool, type ToolId } from "./tools.ts";

const MAP_MENU = "minecade:map_menu";
/** Every editor item: builders never keep one, and none breaks the block it hits. */
const TOOLS = new Set([MAP_MENU, ...EDITOR_TOOLS.map((tool) => tool.item)]);
/** The map menu's hotbar slot (0-based): the last one, slot 9 on screen. */
const MENU_SLOT = 8;
/** Where a tool goes when it's switched on: slot 1 on screen, never locked. */
const TOOL_SLOT = 0;
const PREFIX = "§b[Editor]§r ";
const NOON = 6000;
/** A new map's glass pad reaches this far from its first spawn, one block below it. */
const PAD_RADIUS = 4;

/** Said when a tool is switched on. */
const TOOL_NOTES: Record<ToolId, string> = {
  spawn: "use it where a spawn or point goes. Hit a marker to change it.",
};

/** What a map editor last picked in the spawn tool's form. */
interface ToolSettings {
  list: string;
  keepFacing: boolean;
  snap: Snap;
}

type MarkerAction = "move" | "face" | "unface" | "list" | "number" | "delete";

export class Editor {
  private readonly scope: Scope;
  private readonly info: EditorInfo;
  private readonly state: MapState;
  private readonly link: HostLink;
  private readonly markers: Markers;
  private readonly dimension: Dimension;
  private readonly editors: Set<string>;
  private readonly settings = new Map<string, ToolSettings>();
  private readonly formOpen = new Set<string>();
  private status: { undo?: string; redo?: string; saveWorld: boolean };

  constructor(scope: Scope, info: EditorInfo, map: MapConfig) {
    this.scope = scope;
    this.info = info;
    this.state = new MapState(map);
    this.dimension = world.getDimension("overworld");
    this.editors = new Set(info.editors.map((name) => name.toLowerCase()));
    this.status = { saveWorld: info.fresh };
    this.markers = new Markers(this.dimension, scope);
    this.link = new HostLink(scope, {
      config: (config, seq) => {
        this.state.replace(config, seq);
        this.refresh();
      },
      message: (message) => this.receive(message),
    });
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
      this.settings.delete(playerName.toLowerCase());
      this.formOpen.delete(playerName.toLowerCase());
    });
    scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      if (!TOOLS.has(itemStack.typeId)) return;
      if (!this.isEditor(source)) {
        takeTools(source);
        return;
      }
      if (itemStack.typeId === MAP_MENU) void this.mapMenu(source);
      else if (toolOf(itemStack.typeId)?.id === "spawn") void this.spawnTool(source);
    });
    scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (hitEntity.typeId !== MARKER || damagingEntity.typeId !== "minecraft:player") return;
      const player = damagingEntity as Player;
      const spec = this.markers.specOf(hitEntity);
      if (spec && this.isEditor(player)) void this.markerMenu(player, spec);
    });
    // A tool never breaks the block it hits, which creative mode would.
    scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      if (event.itemStack && TOOLS.has(event.itemStack.typeId)) event.cancel = true;
    });
    scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player }) => this.blocksChanged(player.name));
    scope.subscribe(world.afterEvents.playerBreakBlock, ({ player }) => this.blocksChanged(player.name));
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

  private receive(message: Exclude<HostMessage, { t: "config" }>): void {
    switch (message.t) {
      case "ack":
        if (!this.state.ack(message.seq, message.hash)) {
          log.warn("the host's copy of the map differs; asking for it again");
          this.link.send({ t: "resync" });
        }
        return;
      case "status":
        this.status = { undo: message.undo, redo: message.redo, saveWorld: message.saveWorld };
        return;
      case "say":
        for (const player of world.getAllPlayers()) if (!message.to || player.name === message.to) tell(player, message.text);
        return;
      case "cleanup":
        void this.markers.clear().then(
          (left) => this.link.send({ t: "clean", id: message.id, left }),
          (error: unknown) => this.link.send({ t: "clean", id: message.id, left: -1, error: describeError(error) }),
        );
        return;
    }
  }

  private refresh(): void {
    this.markers.show(markerSpecs(this.state.current, this.lists()));
  }

  private lists(): SpawnList[] {
    return spawnLists(this.state.current, this.info.rules);
  }

  private isEditor(player: Player): boolean {
    return this.editors.has(player.name.toLowerCase());
  }

  private settingsOf(player: Player): ToolSettings {
    const key = player.name.toLowerCase();
    let settings = this.settings.get(key);
    if (!settings) {
      settings = { list: "spawns", keepFacing: false, snap: "exact" };
      this.settings.set(key, settings);
    }
    return settings;
  }

  private welcome(player: Player): void {
    if (!player.isValid) return;
    // Saved player data in the world could hold another game mode.
    player.setGameMode(GameMode.Creative);
    const where = `${this.state.current.name}, ${this.info.targetName}.`;
    if (this.isEditor(player)) {
      const menu = new ItemStack(MAP_MENU, 1);
      menu.lockMode = ItemLockMode.slot;
      menu.keepOnDeath = true;
      inventoryOf(player)?.setItem(MENU_SLOT, menu);
      tell(player, `${where} You're a map editor: the map menu in slot 9 has the checklist and the tools. Hit a marker to change it.`);
    } else {
      takeTools(player);
      tell(player, `${where} You're a builder: build in creative. Map editors place the spawns and other map data.`);
    }
  }

  /** The world is saved at stop once a block changes. Tells the host the first time. */
  private blocksChanged(by: string): void {
    if (this.status.saveWorld) return;
    this.status = { ...this.status, saveWorld: true };
    this.link.send({ t: "saveWorld", by, save: true });
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

  // ---- Map menu ---------------------------------------------------------------------------

  private async mapMenu(player: Player): Promise<void> {
    const config = this.state.current;
    const inventory = inventoryOf(player);
    const tools = EDITOR_TOOLS.filter((tool) => inventory && holds(inventory, tool.item)).map((tool) => tool.id);
    const entries = menuEntries({ config, checklist: mapChecklist(config, this.info.rules), tools, ...this.status });
    const form = new ActionFormData().title(sideTitle("Map menu")).body(menuBody(this.info.targetName, this.info.map, config));
    for (const entry of entries) form.button(entry.text);
    const response = await this.show(player, form);
    const entry = response?.selection === undefined ? undefined : entries[response.selection];
    if (entry && player.isValid) await this.menuAction(player, entry);
  }

  private async menuAction(player: Player, { action, tool }: MenuEntry): Promise<void> {
    switch (action) {
      case "checklist":
        return this.checklistMenu(player);
      case "tool":
        if (tool) this.switchTool(player, tool);
        return;
      case "undo":
      case "redo":
        this.link.send({ t: action, by: player.name });
        return;
      case "markReady":
        return this.markReady(player);
      case "settings":
        return this.settingsForm(player);
      case "saveWorld": {
        const save = !this.status.saveWorld;
        this.status = { ...this.status, saveWorld: save };
        this.link.send({ t: "saveWorld", by: player.name, save });
        tell(player, save ? "The world will be saved when the editor stops." : "The world will be kept as it was when the editor stops: block changes are dropped.");
        // Open again, so the switch shows its new state.
        return this.mapMenu(player);
      }
      case "dropBuild":
        return this.dropBuild(player);
    }
  }

  private async checklistMenu(player: Player): Promise<void> {
    const checklist = mapChecklist(this.state.current, this.info.rules);
    const form = new ActionFormData().title(sideTitle("Checklist")).body(checklistBody(checklist));
    for (const row of checklist.rows) form.button(rowText(row));
    const response = await this.show(player, form);
    const row = response?.selection === undefined ? undefined : checklist.rows[response.selection];
    if (!row || !player.isValid) return;
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

  /** The map menu's tool switch: takes the tool away when it's out, else puts it in hand. */
  private switchTool(player: Player, id: ToolId): void {
    const tool = EDITOR_TOOLS.find((candidate) => candidate.id === id);
    const inventory = inventoryOf(player);
    if (!tool || !inventory) return;
    if (holds(inventory, tool.item)) {
      removeItems(inventory, new Set([tool.item]));
      tell(player, `${tool.label} off.`);
      return;
    }
    this.equipTool(player, tool);
    tell(player, `${tool.label} on: ${TOOL_NOTES[tool.id]}`);
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

  private async markReady(player: Player): Promise<void> {
    const checklist = mapChecklist(this.state.current, this.info.rules);
    if (!checklist.ready) {
      tell(player, `§cNot ready yet:§r ${checklist.problems.join("; ")}`);
      return;
    }
    this.edit(player, { op: "draft", draft: false }, "Marked ready: the next build includes this map.");
  }

  private async settingsForm(player: Player): Promise<void> {
    const config = this.state.current;
    // Game settings are a game's own top-level keys with a plain value, such as Sumo's eliminationY.
    const extras = Object.entries(config).filter(
      (entry): entry is [string, string | number | boolean] => !isMapKey(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1]),
    );
    const form = new ModalFormData().title("Map settings").textField("Name", "The map's name", { defaultValue: config.name });
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
    const form = new MessageFormData()
      .title("Drop build commands")
      .body("This map's world is built from its build commands by npm run bake, which would replace block changes made here. Drop them to keep the world as you change it.")
      .button1("Drop them")
      .button2("Cancel");
    const response = await this.show(player, form);
    if (response?.selection !== 0 || !player.isValid) return;
    this.edit(player, { op: "dropBuild" }, "Build commands dropped: the world is kept as you change it.");
  }

  // ---- Spawn tool and markers -------------------------------------------------------------

  /** Places an entry where the player stands, into the list picked in the form. */
  private async spawnTool(player: Player): Promise<void> {
    // Where they are and look now, before the form opens.
    const at = blockPosition(player.location);
    const view = player.getRotation();
    const lists = this.lists();
    const settings = this.settingsOf(player);
    const form = new ModalFormData()
      .title(`Place at ${at.join(" ")}`)
      .dropdown(
        "List",
        lists.map((list) => `${list.label} (${listOf(this.state.current, list.target).length})`),
        { defaultValueIndex: Math.max(0, lists.findIndex((list) => list.key === settings.list)) },
      )
      .toggle("Save my facing (off: it faces the middle of the map)", { defaultValue: settings.keepFacing })
      .dropdown(
        "Facing",
        SNAPS.map((snap) => snap.label),
        { defaultValueIndex: Math.max(0, SNAPS.findIndex((snap) => snap.snap === settings.snap)) },
      )
      .submitButton("Place");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const [listIndex, keepFacing, snapIndex] = response.formValues as [number, boolean, number];
    const list = lists[listIndex];
    if (!list) return;
    const snap = SNAPS[snapIndex]?.snap ?? "exact";
    Object.assign(settings, { list: list.key, keepFacing, snap });
    const facing = keepFacing ? snapFacing({ yaw: view.y, pitch: view.x }, snap) : undefined;
    const position: MapPosition = facing ? [...at, facing.yaw, facing.pitch] : at;
    const count = listOf(this.state.current, list.target).length;
    const replace = list.single && count > 0;
    const edit: MapEdit = replace ? { op: "set", target: list.target, index: 0, at: position } : { op: "add", target: list.target, at: position };
    const name = list.single ? list.entry : `${list.entry} ${count + 1}`;
    this.edit(player, edit, `${name} ${replace ? "moved" : "placed"} at ${at.join(" ")}${facing ? `, facing ${compass(facing.yaw)}` : ""}.`);
  }

  private async markerMenu(player: Player, spec: MarkerSpec): Promise<void> {
    const { list, index } = spec;
    const entries = listOf(this.state.current, list.target);
    const position = entries[index];
    if (!position) return;
    const name = list.single ? list.entry : `${list.entry} ${index + 1}`;
    const actions: { action: MarkerAction; text: string }[] = [
      { action: "move", text: "Move here" },
      { action: "face", text: "Take my facing" },
      ...(spec.facing ? [{ action: "unface" as const, text: "Clear facing\n§7face the middle again" }] : []),
      { action: "list", text: "Change list" },
      ...(entries.length > 1 ? [{ action: "number" as const, text: "Renumber" }] : []),
      { action: "delete", text: "§cDelete" },
    ];
    const facing = spec.facing ? `facing ${compass(spec.facing.yaw)} (yaw ${spec.facing.yaw}, pitch ${spec.facing.pitch})` : "facing the middle of the map";
    const form = new ActionFormData().title(sideTitle(name)).body(`At ${position.slice(0, 3).join(" ")}, ${facing}.`);
    for (const { text } of actions) form.button(text);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : actions[response.selection]?.action;
    if (!action || !player.isValid || !this.unchanged(player, spec, position, name)) return;
    const target = list.target;
    switch (action) {
      case "move": {
        const at = blockPosition(player.location);
        this.edit(player, { op: "move", target, index, at }, `${name} moved to ${at.join(" ")}.`);
        return;
      }
      case "face": {
        const view = player.getRotation();
        const facing = snapFacing({ yaw: view.y, pitch: view.x }, this.settingsOf(player).snap);
        this.edit(player, { op: "face", target, index, facing }, `${name} faces ${compass(facing.yaw)}.`);
        return;
      }
      case "unface":
        this.edit(player, { op: "face", target, index }, `${name} faces the middle of the map.`);
        return;
      case "list":
        return this.changeList(player, spec, position, name);
      case "number":
        return this.renumber(player, spec, entries.length, name);
      case "delete":
        this.edit(player, { op: "remove", target, index }, `${name} deleted.`);
        return;
    }
  }

  /** False (and a message) when the marker's entry changed while a form was open. */
  private unchanged(player: Player, spec: MarkerSpec, position: MapPosition, name: string): boolean {
    const now = listOf(this.state.current, spec.list.target)[spec.index];
    if (JSON.stringify(now) === JSON.stringify(position)) return true;
    tell(player, `${name} changed while the menu was open. Hit its marker again.`);
    return false;
  }

  private async changeList(player: Player, spec: MarkerSpec, position: MapPosition, name: string): Promise<void> {
    const lists = this.lists().filter((list) => list.key !== spec.list.key);
    const form = new ModalFormData()
      .title(`Move ${name}`)
      .dropdown("To the list", lists.map((list) => list.label))
      .submitButton("Move");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid || !this.unchanged(player, spec, position, name)) return;
    const list = lists[response.formValues[0] as number];
    if (!list) return;
    const taken = list.single && listOf(this.state.current, list.target).length > 0;
    const add: MapEdit = taken ? { op: "set", target: list.target, index: 0, at: position } : { op: "add", target: list.target, at: position };
    this.edit(player, { op: "batch", edits: [{ op: "remove", target: spec.list.target, index: spec.index }, add] }, `${name} is now in ${list.label}.`);
  }

  private async renumber(player: Player, spec: MarkerSpec, count: number, name: string): Promise<void> {
    const form = new ModalFormData()
      .title(`Renumber ${name}`)
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

/** Builders never keep a tool, even one left from when they were a map editor. */
function takeTools(player: Player): void {
  const inventory = inventoryOf(player);
  if (inventory) removeItems(inventory, TOOLS);
}

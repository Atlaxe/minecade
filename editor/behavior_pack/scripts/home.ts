// The editor lobby in game: where everyone joins. Players are shut in a small dark cell (blind, in
// adventure, unable to move or look around, with no HUD), and map editors get the Map editor form,
// which opens again whenever it closes: open a map in Edit, copy builds from one of the client's
// worlds in Select, or go to what's open now. The host (tools/editor/runner.ts) starts the server
// that's picked and moves the player there once it's ready; meanwhile the form says what's loading.
// Builders wait here until a map editor opens a map in Edit.
import {
  BlockVolume,
  GameMode,
  HudVisibility,
  InputPermissionCategory,
  system,
  world,
  type Dimension,
  type Player,
} from "@minecraft/server";
import { ActionFormData, ModalFormData, uiManager } from "@minecraft/server-ui";
import { describeError, log, showForm, type HomeInfo, type HomeState, type OpenRequest, type Scope } from "@minecade/minigame-core";
import type { HostMessage } from "@minecade/minigame-core/config";
import { goto } from "./goto.ts";
import { HostLink } from "./link.ts";
import { dangerText, headingText, sideTitle } from "./marks.ts";
import { homeEntries, mapEntries, mapIdFrom, switchWarning, targetEntries, worldEntries } from "./menu.ts";

const PREFIX = "§b[Editor]§r ";
/** Where players stand: the world's spawn, inside the cell. */
const CELL = { x: 0, y: 100, z: 0 };
const MIDNIGHT = 18000;
/** The form opens again this soon after it closes. */
const REOPEN_TICKS = 5;
/** What a player picked shows as loading for this long, until the host's state says more. */
const PENDING_TICKS = 100;
/** How often the open forms are checked against what each player should see. */
const VIEW_TICKS = 20;
/** Long enough to last the whole visit. */
const BLIND_TICKS = 1_000_000;
const MENU_BODY = "Open a map to edit it, or copy builds from one of your worlds to make new maps.";

type Request = Extract<OpenRequest, { to: "edit" | "select" }>;
type View = { kind: "menu" } | { kind: "wait"; label: string } | { kind: "builder" };

export class Home {
  private readonly scope: Scope;
  private readonly link: HostLink;
  private readonly editors: Set<string>;
  private readonly dimension: Dimension;
  private state: HomeState;
  /** Players whose form loop runs, with the view their open form shows. */
  private readonly shown = new Map<string, string>();
  /** What each player picked last, shown as loading until the host's state takes over. */
  private readonly pending = new Map<string, { label: string; until: number }>();
  private readonly formOpen = new Set<string>();

  constructor(scope: Scope, info: HomeInfo) {
    this.scope = scope;
    this.state = info.home;
    this.editors = new Set(info.editors.map((name) => name.toLowerCase()));
    this.dimension = world.getDimension("overworld");
    this.link = new HostLink(scope, {
      config: () => {},
      home: (state) => {
        this.state = state;
        this.refreshViews();
      },
      message: (message) => this.receive(message),
    });
  }

  start(): void {
    const scope = this.scope;
    world.gameRules.doDayLightCycle = false;
    world.gameRules.doWeatherCycle = false;
    world.gameRules.doMobSpawning = false;
    world.setTimeOfDay(MIDNIGHT);
    scope.subscribe(world.afterEvents.playerSpawn, ({ player }) => scope.defer(() => this.welcome(player)));
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      const key = playerName.toLowerCase();
      this.shown.delete(key);
      this.pending.delete(key);
      this.formOpen.delete(key);
    });
    scope.interval(() => this.refreshViews(), VIEW_TICKS);
    void this.buildCell();
  }

  /** The cell: black concrete around a two-block space at the spawn. Then the host hears the lobby is ready. */
  private async buildCell(): Promise<void> {
    const from = { x: CELL.x - 1, y: CELL.y - 1, z: CELL.z - 1 };
    const to = { x: CELL.x + 1, y: CELL.y + 2, z: CELL.z + 1 };
    const manager = world.tickingAreaManager;
    try {
      await manager.createTickingArea("minecade:cell", { dimension: this.dimension, from, to });
      try {
        this.dimension.fillBlocks(new BlockVolume(from, to), "minecraft:black_concrete");
        this.dimension.fillBlocks(new BlockVolume(CELL, { x: CELL.x, y: CELL.y + 1, z: CELL.z }), "minecraft:air");
      } finally {
        manager.removeTickingArea("minecade:cell");
      }
    } catch (error) {
      log.error(`building the editor lobby's cell failed: ${describeError(error)}`);
    }
    this.link.send({ t: "ready" });
  }

  private receive(message: Exclude<HostMessage, { t: "config" | "home" }>): void {
    switch (message.t) {
      case "say":
        for (const player of world.getAllPlayers()) if (!message.to || player.name === message.to) tell(player, message.text);
        return;
      case "goto":
        goto(message.players, message.port, message.label, tell);
        return;
      case "cleanup":
        // The editor lobby has no markers.
        this.link.send({ t: "clean", id: message.id, left: 0 });
        return;
    }
  }

  private isEditor(player: Player): boolean {
    return this.editors.has(player.name.toLowerCase());
  }

  /** Into the cell, in the dark, then the form. */
  private welcome(player: Player): void {
    if (!player.isValid) return;
    try {
      player.setGameMode(GameMode.Adventure);
      player.teleport({ x: CELL.x + 0.5, y: CELL.y, z: CELL.z + 0.5 }, { dimension: this.dimension, rotation: { x: 0, y: 0 } });
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide);
      player.addEffect("blindness", BLIND_TICKS, { showParticles: false });
    } catch (error) {
      log.warn(`could not shut ${player.name} in: ${describeError(error)}`);
    }
    void this.loop(player);
  }

  // ---- The form that stays open -------------------------------------------------------------

  private async loop(player: Player): Promise<void> {
    const key = keyOf(player);
    if (this.shown.has(key)) return;
    this.shown.set(key, "");
    try {
      while (player.isValid && this.shown.has(key)) {
        const view = this.viewOf(player);
        this.shown.set(key, viewKey(view));
        if (view.kind === "menu") await this.menu(player);
        else await this.notice(player, view);
        await this.scope.wait(REOPEN_TICKS);
      }
    } catch (error) {
      if (!this.scope.disposed) log.error(`the editor lobby's form for ${player.name}: ${describeError(error)}`);
    } finally {
      this.shown.delete(key);
    }
  }

  /** What this player should see now: the menu, what's loading for them, or the builders' wait. */
  private viewOf(player: Player): View {
    if (!this.isEditor(player)) return { kind: "builder" };
    const key = keyOf(player);
    const waiting = this.state.servers.waiting.find((entry) => entry.name.toLowerCase() === key);
    if (waiting) return { kind: "wait", label: waiting.label };
    const pending = this.pending.get(key);
    if (pending && system.currentTick < pending.until) return { kind: "wait", label: pending.label };
    this.pending.delete(key);
    return { kind: "menu" };
  }

  /** Closes the form of anyone whose view changed, so their loop opens the right one. */
  private refreshViews(): void {
    for (const player of world.getAllPlayers()) {
      const shown = this.shown.get(keyOf(player));
      if (shown && shown !== viewKey(this.viewOf(player))) uiManager.closeAllForms(player);
    }
  }

  private async notice(player: Player, view: Exclude<View, { kind: "menu" }>): Promise<void> {
    const form =
      view.kind === "wait"
        ? new ActionFormData()
            .title(sideTitle("Loading"))
            .body(`Loading ${view.label}...\n\nYou'll be moved there as soon as it's ready: that takes about 20 seconds.`)
            .button(headingText("Please wait"))
        : new ActionFormData()
            .title(sideTitle("Map editor"))
            .body("Waiting for a map editor to open a map. You'll be moved there to build as soon as one is open.")
            .button(headingText("Please wait"));
    await this.show(player, form);
  }

  /** Shows a form unless this player has one open already. */
  private async show<R extends { canceled: boolean }>(player: Player, form: { show(player: Player): Promise<R> }): Promise<R | undefined> {
    const key = keyOf(player);
    if (this.formOpen.has(key)) return undefined;
    this.formOpen.add(key);
    try {
      return await showForm(this.scope, player, form);
    } finally {
      this.formOpen.delete(key);
    }
  }

  // ---- The menu -----------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const entries = homeEntries(this.state);
    const form = new ActionFormData().title(sideTitle("Map editor")).body(MENU_BODY);
    for (const entry of entries) form.button(entry.text);
    const response = await this.show(player, form);
    const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
    if (!action || !player.isValid) return;
    if (action.kind === "open") await this.open(player, action.request);
    else if (action.kind === "maps") await this.pickMap(player);
    else if (action.kind === "new") await this.pickWorld(player);
  }

  /** Open a map: the lobby or a game, then one of its maps. */
  private async pickMap(player: Player): Promise<void> {
    const targets = targetEntries(this.state.catalog);
    const form = new ActionFormData().title(sideTitle("Open a map")).body("Whose map?");
    for (const { text } of targets) form.button(text);
    const picked = await this.show(player, form);
    const target = this.state.catalog.targets.find((candidate) => candidate.id === targets[picked?.selection ?? -1]?.target);
    if (!target || !player.isValid) return;
    if (target.maps.length === 0) {
      tell(player, `${target.name} has no maps yet: make one with New map.`);
      return;
    }
    const maps = mapEntries(target);
    const mapForm = new ActionFormData().title(sideTitle(target.name)).body("Which map? It opens on the Edit server.");
    for (const { text } of maps) mapForm.button(text);
    const response = await this.show(player, mapForm);
    const map = maps[response?.selection ?? -1]?.map;
    if (map && player.isValid) await this.open(player, { to: "edit", target: target.id, map });
  }

  /** New map: a world to copy builds from (it opens in Select), or an empty world. */
  private async pickWorld(player: Player): Promise<void> {
    const worlds = worldEntries(this.state.catalog);
    const form = new ActionFormData()
      .title(sideTitle("New map"))
      .body("Copy builds from which world? A copy opens on the Select server (your world is never changed): box each build there and save it as a map.");
    for (const { text } of worlds) form.button(text);
    const response = await this.show(player, form);
    const picked = worlds[response?.selection ?? -1];
    if (!picked || !player.isValid) return;
    if (picked.world !== undefined) await this.open(player, { to: "select", world: picked.world });
    else await this.emptyWorld(player);
  }

  /** An empty world: the map's target, name and id, for a draft map on a glass pad. */
  private async emptyWorld(player: Player): Promise<void> {
    const targets = this.state.catalog.targets;
    const form = new ModalFormData()
      .title("Empty world")
      .dropdown("For", targets.map((target) => target.name))
      .textField("Name", "Castle", { defaultValue: "" })
      .textField("Map id (empty: from the name)", "castle", { defaultValue: "" })
      .submitButton("Make it");
    const response = await this.show(player, form);
    if (!response?.formValues || !player.isValid) return;
    const target = targets[response.formValues[0] as number];
    const name = String(response.formValues[1] ?? "").trim();
    const map = String(response.formValues[2] ?? "").trim() || mapIdFrom(name);
    if (!target) return;
    if (!name) {
      tell(player, "§cThe map needs a name.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(map)) {
      tell(player, `§c"${map}" is not a map id: use lower case letters, digits, _ and -.`);
      return;
    }
    if (target.maps.some((candidate) => candidate.id === map)) {
      tell(player, `§c${target.name} has a map "${map}" already: pick another id.`);
      return;
    }
    await this.open(player, { to: "edit", target: target.id, map, fresh: { name } });
  }

  /** Asks the host to open it, after a confirm when that moves others off their server. */
  private async open(player: Player, request: Request): Promise<void> {
    const warning = switchWarning(this.state, request);
    if (warning) {
      const form = new ActionFormData().title(sideTitle("Switch?")).body(warning).button(dangerText("Switch")).button("Cancel");
      const response = await this.show(player, form);
      if (response?.selection !== 0 || !player.isValid) return;
    }
    this.pending.set(keyOf(player), { label: this.labelOf(request), until: system.currentTick + PENDING_TICKS });
    this.link.send({ t: "open", by: player.name, request });
  }

  /** What a request opens, the way the host names it ("Sumo: Arena (arena_1)", or the world's name). */
  private labelOf(request: Request): string {
    if (request.to === "select") return this.state.catalog.worlds.find((world) => world.id === request.world)?.name ?? "the world";
    const target = this.state.catalog.targets.find((candidate) => candidate.id === request.target);
    const name = request.fresh?.name ?? target?.maps.find((map) => map.id === request.map)?.name ?? request.map;
    return `${target?.name ?? request.target}: ${name} (${request.map})`;
  }
}

function viewKey(view: View): string {
  return view.kind === "wait" ? `wait:${view.label}` : view.kind;
}

function keyOf(player: Player): string {
  return player.name.toLowerCase();
}

function tell(player: Player, text: string): void {
  player.sendMessage(`${PREFIX}${text}`);
}

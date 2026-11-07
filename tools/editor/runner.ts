// The map editor's three servers, run together (docs/editor.md, "Starting"): the editor lobby on
// 19132, where everyone joins and picks what to open; Select on 19133, a copy of a converted world
// to box maps in; Edit on 19134, one map. Opening something starts its server (or restarts it on
// the new map or world). Players move between the servers by transfer, never by rejoining: whoever
// asked waits where they are, and anyone on a server that restarts waits in the editor lobby, until
// the server is ready. The guests set on the Panel (guests.ts) may be on the editor lobby and on
// whatever runs on Select's port (Select, or a preview), never Edit: they're moved on to that as
// soon as it's ready, and come back to the editor lobby through its second entrance (19135). With
// BROADCAST on, the Friends tab bot (broadcast.ts) relays console friends' joins to the editor lobby.
// Extractions (selections.ts) run in the background and outlive the servers.
import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  MapEditError,
  chatMapName,
  mapChecklist,
  openKey,
  type GuestInfo,
  type HomeState,
  type MapConfig,
  type MapEdit,
  type OpenRequest,
  type RecentEntry,
  type SelectionInfo,
  type ServerInfo,
} from "@minecade/minigame-core/config";
import { connectDocker } from "../build/docker-util.ts";
import { readEnv } from "../control-panel/core.ts";
import { storeDir } from "../maps/paths.ts";
import { MapStore } from "../maps/store.ts";
import { EditorBroadcast } from "./broadcast.ts";
import { buildCatalog, forgetRecent, mapLabel, noteRecent, renameRecent, requestedWorld, worldId } from "./catalog.ts";
import type { OuterAnswer } from "./control.ts";
import { BRING_MS, SLOTS, editorPlayers, isMapId, planOpen, portHolders, warmPlan, type EditorStatus, type Slot, type SlotId } from "./editor-core.ts";
import { addGuest, readGuests, removeGuest, writeGuests } from "./guests.ts";
import { HomeSession } from "./home-session.ts";
import { PreviewSession } from "./preview-session.ts";
import type { PreviewMap } from "./preview-template.ts";
import { SelectSession } from "./select-session.ts";
import { Selections } from "./selections.ts";
import { StartCanceled, delay, message, type ServerSession } from "./server-session.ts";
import { EditorSession } from "./session.ts";
import { loadTarget, mapsDirOf } from "./targets.ts";
import { clientWorlds } from "./worlds.ts";

const LOG_KEPT = 300;
/** How long players get to leave a server that is about to stop. */
const LEAVE_MS = 2000;
/** Changes to the lobby's state are sent at most this often. */
const HOME_UPDATE_MS = 300;
/** After a preview, players are back in Edit about this long after the game ends. */
const BACK_MS = 6000;
/** A guest who just joined the editor lobby is moved on after this long (once they're in the world). */
const GUEST_ON_MS = 2000;

type WorkSlot = "select" | "edit";
type Opened = { request: Extract<OpenRequest, { to: "edit" | "select" }>; label: string };

/** What an open request turned into: a server, and how to make its session. */
interface Launch extends Opened {
  slot: WorkSlot;
  make(): ServerSession;
  /** How chat names it: "[Sumo : Arena]" for a map (chatMapName), the world's name for Select. */
  chat: string;
}

/** What a preview plays, the Recent entry it leaves, and where it was started (where everyone comes back to). */
interface PreviewPlan {
  source: { map: PreviewMap; label: string; maxPlayers: number };
  recent: RecentEntry;
  /** Edit (the map menu's Preview, or the Panel's), or the editor lobby (a preview card in Recent). */
  from: "edit" | "home";
  /** Fake players the match starts with. */
  fakes: number;
}

export interface RunnerOptions {
  root: string;
  verbose: boolean;
  /** The servers' ports and containers (a headless test passes its own). */
  slots?: Record<SlotId, Slot>;
  /** The map store (a headless test passes its own): maps\ beside the checkout, or MAP_STORE. */
  store?: MapStore;
  /** The Panel booted it (MINECADE_EDITOR_FROM=panel): its status says so. */
  fromPanel?: boolean;
}

export class EditorRunner {
  readonly selections: Selections;
  private readonly root: string;
  private readonly verbose: boolean;
  private readonly slots: Record<SlotId, Slot>;
  private readonly store: MapStore;
  private readonly lines: string[] = [];
  private readonly startedAt = new Date().toISOString();
  private state: EditorStatus["state"] = "starting";
  private error: string | undefined;
  private env: Record<string, string> = {};
  /** Map editors (LAN_PLAYERS): everyone else on the servers is a guest. */
  private players: string[] = [];
  /** The guests (work/editor/guests.json). */
  private guests: string[] = [];
  /** The Friends tab bot, while BROADCAST is on. */
  private readonly broadcast: EditorBroadcast;
  private home: HomeSession | undefined;
  private readonly work: { select?: SelectSession; edit?: EditorSession } = {};
  /** What each work server has open. */
  private readonly opened = new Map<WorkSlot, Opened>();
  /** Players waiting for a server (or a preview started from the editor lobby) to be ready, by lower-case name. */
  private readonly waiting = new Map<string, { name: string; slot: WorkSlot | "preview"; label: string }>();
  /** Opening runs one at a time on each server. */
  private readonly queues: Record<WorkSlot, Promise<unknown>> = { select: Promise.resolve(), edit: Promise.resolve() };
  private homeTimer: NodeJS.Timeout | undefined;
  private shutting: Promise<void> | undefined;
  /** A Preview running on Select's port, and what Select had open before it, to open again after. */
  private previewing: PreviewSession | undefined;
  /** A preview was asked for and is getting under way (saving, closing Select). */
  private previewAsked = false;
  /** Where the running preview was started, and by whom: it comes back there. */
  private previewFrom: { from: PreviewPlan["from"]; by: string } | undefined;
  /** What the running preview plays, for a Replay. */
  private previewPlan: PreviewPlan | undefined;
  private selectBefore: Opened | undefined;
  /** Exports to open in Edit once they're cut out ("<target>/<map>"), and who exported each. */
  private readonly editAfterExport = new Map<string, string>();
  private readonly fromPanel: boolean;
  /** Opens in Edit asked for (by players or this PC) that haven't finished: the Panel's warm-up waits for them. */
  private editAsked = 0;
  /** The Panel's warm-up: the newest map it asked for (an older one still to run is skipped), and the Edit session it is starting. */
  private warmCount = 0;
  private warming: EditorSession | undefined;
  /** Open in game: map editors who join the editor lobby go straight to this map in Edit (once each) until `until`. */
  private bring: { request: Extract<OpenRequest, { to: "edit" }>; key: string; until: number; brought: Set<string> } | undefined;
  /** Called once everything has stopped: true when it went well. */
  onExit: (ok: boolean) => void = () => {};

  constructor(options: RunnerOptions) {
    this.root = options.root;
    this.verbose = options.verbose;
    this.slots = options.slots ?? SLOTS;
    this.store = options.store ?? MapStore.open(storeDir(this.root));
    this.fromPanel = options.fromPanel === true;
    this.selections = new Selections(this.root, { verbose: this.verbose, note: (text) => this.log(`Extract: ${text}`) });
    this.broadcast = new EditorBroadcast({ root: this.root, note: (text) => this.log(text) });
    this.selections.onChange((world, info, gone) => {
      // Forget takes a map off a list as it is, ready or failed.
      if (gone || (info.status !== "ready" && info.status !== "failed")) return;
      // A map that's ready shows in the lobby's lists.
      if (info.status === "ready") this.homeChanged();
      // Exported with Open in Edit: it opens there, and whoever exported it is moved there.
      const key = `${info.target}/${info.map}`;
      const by = this.editAfterExport.get(key);
      this.editAfterExport.delete(key);
      if (by !== undefined && info.status === "ready") {
        void this.request(by, { to: "edit", target: info.target, map: info.map });
        return;
      }
      void this.announce(world, info).catch((error: unknown) => this.log(`Could not announce ${info.target}/${info.map}: ${message(error)}`));
    });
  }

  /** Starts the editor lobby. Throws (with the reason) when it can't. */
  async boot(): Promise<void> {
    const envPath = join(this.root, ".env");
    if (existsSync(envPath)) this.env = readEnv(await readFile(envPath, "utf8"));
    this.players = editorPlayers(this.env);
    this.guests = await readGuests(this.root);
    const docker = connectDocker();
    // This editor holds the control port, so no other one runs: editor servers still running were
    // left by one that stopped without shutting them down (its process ended). They'd hold the
    // ports for good, so they go; map.json has every change, and only block changes since their
    // last save are lost.
    for (const info of await docker.listContainers({ filters: { label: ["minecade.role=editor"] } })) {
      this.log(`Removing ${info.Names[0]?.replace(/^\//, "") ?? info.Id.slice(0, 12)}, left running by an earlier map editor that stopped without it (block changes since its last save are lost; map.json has every change).`);
      await docker.getContainer(info.Id).remove({ force: true }).catch((error: unknown) => this.log(`Could not remove it: ${message(error)}`));
    }
    const ports = Object.values(this.slots).flatMap((slot) => (slot.entrance ? [slot.port, slot.entrance] : [slot.port]));
    const holders = portHolders(await docker.listContainers(), ports);
    if (holders.length > 0) {
      throw new Error(`the editor's ports are in use by ${holders.join(", ")}. Stop the network first (the Panel's Servers page, or docker compose down).`);
    }
    // Stopped editor servers from an earlier run (or an older editor) only take up names.
    for (const info of await docker.listContainers({ all: true, filters: { label: ["minecade.role=editor"] } })) {
      if (info.State !== "running") await docker.getContainer(info.Id).remove({ force: true }).catch(() => {});
    }
    const home = new HomeSession({ slot: this.slots.home, verbose: this.verbose, note: (text) => this.log(text), home: () => this.homeState(), guests: () => this.guests });
    this.home = home;
    home.onOpen = (request, by) => void this.request(by, request);
    home.onLeave = (by) => void home.kick(by, "You left the map editor. Join again to come back.").catch((error: unknown) => this.log(`Could not let ${by} leave: ${message(error)}`));
    home.onPlayer = (name, kind) => this.joined(home, name, kind);
    home.onEnd = () => {
      if (this.state === "ready") {
        this.log("The editor lobby stopped: shutting the editor down.");
        void this.shutdown();
      }
    };
    try {
      await home.start();
    } catch (error) {
      this.state = "stopping";
      this.error = message(error);
      throw error;
    }
    this.state = "ready";
    this.log(`Ready: join ${home.status().join}. Map editors: ${this.players.join(", ") || "nobody (set LAN_PLAYERS)"}.${this.guests.length > 0 ? ` Guests: ${this.guests.join(", ")}.` : ""}`);
    if (this.env.BROADCAST === "1") this.setBroadcast(true);
  }

  status(): EditorStatus {
    return {
      booted: true,
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      join: this.home?.status().join ?? `?:${this.slots.home.port}`,
      startedAt: this.startedAt,
      log: [...this.lines],
      home: this.home?.status() ?? { mode: "home", state: "starting", join: "", players: [], startedAt: this.startedAt },
      ...(this.work.select ? { select: this.work.select.status() } : {}),
      ...(this.work.edit ? { edit: this.work.edit.status() } : {}),
      ...(this.previewing ? { preview: this.previewing.status() } : {}),
      waiting: [...this.waiting.values()].map(({ name, label }) => ({ name, label })),
      guests: this.guestInfo(),
      broadcast: this.broadcast.status(),
      ...(this.fromPanel ? { fromPanel: true } : {}),
      ...(this.bring && this.bring.until > Date.now() ? { bring: `${this.bring.request.target}/${this.bring.request.map}`, bringUntil: new Date(this.bring.until).toISOString() } : {}),
    };
  }

  /**
   * Starts the Friends tab bot (on), relaying joins to the editor lobby, or stops it: BROADCAST in
   * .env at boot, and the Panel's Friends tab switch. Undefined when it's under way, or why not.
   */
  setBroadcast(on: boolean): string | undefined {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    if (on && !this.env.LAN_HOST) return "set LAN_HOST in .env";
    void (on ? this.broadcast.start(this.env.LAN_HOST, this.slots.home.port) : this.broadcast.stop());
    return undefined;
  }

  /**
   * A map viewer's edit to the map open in Edit (control.ts POST /edit). Until Edit is ready (or
   * once it's stopping), the Panel changes map.json itself, and Edit picks the change up when it's ready.
   */
  outerEdit(target: string, map: string, edit: MapEdit, by: string): OuterAnswer {
    const session = this.work.edit;
    if (!session || !session.isMap(target, map) || session.status().state !== "ready") return { outcome: "notOpen" };
    try {
      return { outcome: "done", ...session.outerEdit(edit, by) };
    } catch (error) {
      if (error instanceof MapEditError) return { outcome: "refused", error: error.message };
      throw error;
    }
  }

  /** A map viewer's undo or redo on the map open in Edit (control.ts POST /undo and /redo). */
  outerStep(target: string, map: string, kind: "undo" | "redo", by: string): OuterAnswer {
    const session = this.work.edit;
    if (!session || !session.isMap(target, map) || session.status().state !== "ready") return { outcome: "notOpen" };
    const done = session.outerStep(kind, by);
    return done ? { outcome: "done", ...done } : { outcome: "refused", error: `Nothing to ${kind}.` };
  }

  /** Saves the map open in Edit now. False when none is. */
  save(): boolean {
    if (!this.work.edit || this.work.edit.status().state !== "ready") return false;
    void this.work.edit.save("this PC");
    return true;
  }

  /** Publishes the map open in Edit (saved, then committed and pushed). False when none is. */
  publish(): boolean {
    if (!this.work.edit || this.work.edit.status().state !== "ready") return false;
    void this.work.edit.publish("this PC");
    return true;
  }

  /**
   * Plays the map open in Edit as its game on Select's port (from a player there, or this PC), then
   * brings everyone back. Answers at once: undefined when it's under way, or why it can't be.
   */
  preview(by: string, fakes = 0, as?: string): string | undefined {
    const problem = this.isGuest(by) ? "only map editors can start a preview" : this.previewProblem();
    if (problem) {
      this.log(`${by}: can't preview: ${problem}`);
      void this.tell(by, `§c${problem}`);
      return problem;
    }
    this.previewAsked = true;
    this.queues.select = this.queues.select
      .then(() => this.runPreview(by, fakes, as))
      .catch((error: unknown) => this.log(`The preview went wrong: ${message(error)}`))
      .finally(() => (this.previewAsked = false));
    return undefined;
  }

  /**
   * Saves the newest screenshot on this PC as the preview picture of the map open in Edit
   * ("map"), or as its game's picture ("game"). Undefined when it's saved, or why not.
   */
  async picture(kind: "map" | "game"): Promise<string | undefined> {
    const edit = this.work.edit;
    if (!edit || edit.status().state !== "ready") return "no map is open in Edit";
    return edit.picture("this PC", kind);
  }

  /** Ends the preview now: the game sends everyone back to Edit. False when none runs. */
  endPreview(): boolean {
    if (!this.previewing) return false;
    this.log("Ending the preview...");
    void this.previewing.end();
    return true;
  }

  /**
   * Opens a map or a world (from a player, or from this PC when `by` is "this PC"), or sends the
   * player to the editor lobby. Answers at once: undefined when it's under way, or why it can't be.
   */
  async request(by: string, request: OpenRequest): Promise<string | undefined> {
    const problem = await this.tryRequest(by, request);
    if (problem) {
      this.log(`${by}: can't open that: ${problem}`);
      void this.tell(by, `§c${problem}`);
    }
    return problem;
  }

  /**
   * The Panel's warm-up (control.ts POST /warm): a map picked on its Maps page, or open in its
   * viewer, opened in Edit ahead of time while nobody uses Edit (warmPlan), so going in game is
   * quick. A newer one calls off an older one: still to run, it's skipped; starting, it stops.
   * Says whether it's opening, and why not.
   */
  warm(target: string, map: string): { opening: boolean; why?: string } {
    if (this.state !== "ready") return { opening: false, why: this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting" };
    if (!isMapId(target) || !isMapId(map)) return { opening: false, why: "not a map id" };
    const request: Extract<OpenRequest, { to: "edit" }> = { to: "edit", target, map };
    const key = openKey(request);
    const plan = this.warmPlanFor(key);
    if (!plan.open) return { opening: false, why: plan.why };
    const count = ++this.warmCount;
    const opened = this.opened.get("edit");
    if (this.warming && opened && openKey(opened.request) !== key) this.warming.cancel();
    this.queues.edit = this.queues.edit
      .then(async () => {
        // Skipped when a newer pick came, or Edit got busy meanwhile.
        if (count !== this.warmCount || !this.warmPlanFor(key).open) return;
        const launch = await this.editLaunch(request);
        this.log(`The Panel: warming up ${launch.label} in Edit`);
        await this.launch("this PC", launch, true);
      })
      .catch((error: unknown) => this.log(`Warming ${target}/${map} up went wrong: ${message(error)}`));
    return { opening: true };
  }

  /**
   * Open in game from the Panel's map viewer: opens the map in Edit, and moves the map editors in the
   * editor lobby there once it's ready, and any who join it in the next minutes (once each).
   */
  async openInGame(target: string, map: string): Promise<string | undefined> {
    const request: Extract<OpenRequest, { to: "edit" }> = { to: "edit", target, map };
    const problem = await this.request("this PC", request);
    if (problem) return problem;
    this.bring = { request, key: openKey(request), until: Date.now() + BRING_MS, brought: new Set() };
    const opened = this.opened.get("edit");
    const label = opened && openKey(opened.request) === this.bring.key ? opened.label : `${target}/${map}`;
    for (const name of this.home?.online() ?? []) {
      if (this.isGuest(name)) continue;
      this.bring.brought.add(name.toLowerCase());
      this.waiting.set(name.toLowerCase(), { name, slot: "edit", label });
    }
    this.homeChanged();
    // Already open and ready: they go now; else once it's ready.
    await this.deliver("edit");
    return undefined;
  }

  /** warmPlan for the Panel's warm-up, against Edit and who is using it now. */
  private warmPlanFor(key: string): { open: boolean; why?: string } {
    const session = this.work.edit;
    const opened = this.opened.get("edit");
    const current = session && opened ? { key: openKey(opened.request), state: session.status().state, players: session.online() } : undefined;
    const waiting = [...this.waiting.values()].filter((entry) => entry.slot === "edit").length;
    return warmPlan(key, current, { waiting, asked: this.editAsked, preview: this.previewing !== undefined || this.previewAsked });
  }

  /**
   * Adds a guest (on), or removes one, from the Panel. Guests may join the editor lobby and
   * whatever runs on Select's port, never Edit; removing one disconnects them. Undefined when it's
   * done, or why it can't be.
   */
  async setGuest(name: string, on: boolean): Promise<string | undefined> {
    const problem = await this.trySetGuest(name.trim(), on);
    if (problem) this.log(`Can't ${on ? "add" : "remove"} the guest ${name}: ${problem}`);
    return problem;
  }

  /** Stops every server (Edit saves first), waits for extractions, and exits. Safe to call more than once. */
  shutdown(force = false): Promise<void> {
    this.shutting ??= (async () => {
      this.state = "stopping";
      this.log(force ? "Shutting down without saving the world..." : "Shutting down (Edit saves first)...");
      const stop = (session: ServerSession | undefined) => (session ? (force ? session.forceStop() : session.stop()) : Promise.resolve());
      await this.broadcast.stop();
      await this.previewing?.stop();
      await Promise.all([stop(this.work.edit), stop(this.work.select)]);
      await stop(this.home);
      if (this.selections.busy > 0) {
        this.log(`Waiting for ${this.selections.busy} extraction${this.selections.busy === 1 ? "" : "s"} to finish...`);
        await this.selections.idle();
      }
      this.log("Shut down.");
      this.store.close();
      this.onExit(this.error === undefined);
    })();
    return this.shutting;
  }

  /** A line in the editor's log (the Panel shows it). */
  log(text: string): void {
    const line = `${new Date().toISOString().slice(11, 19)}  ${text}`;
    console.log(line);
    this.lines.push(line);
    if (this.lines.length > LOG_KEPT) this.lines.shift();
  }

  // ---- Opening ----------------------------------------------------------------------------

  private async tryRequest(by: string, request: OpenRequest): Promise<string | undefined> {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    if (this.isGuest(by)) return "only map editors can open maps and worlds";
    if (request.to === "home") {
      const on = this.whereIs(by);
      if (on && on !== this.home) await this.sendHome(on, [by]);
      return undefined;
    }
    if (request.to === "preview") return this.previewFromLobby(by, request);
    if (request.to === "select" && this.previewing) return "a preview is running on Select's port: end it first";
    let launch: Launch;
    try {
      launch = request.to === "edit" ? await this.editLaunch(request) : await this.selectLaunch(by, request.world);
    } catch (error) {
      return message(error);
    }
    if (by !== "this PC") {
      this.waiting.set(by.toLowerCase(), { name: by, slot: launch.slot, label: launch.label });
      // Off the editor lobby (which shows its own), they get the loading screen until they're moved.
      const on = this.whereIs(by);
      if (on && on !== this.home) void on.send({ t: "loading", players: [by], label: launch.label });
    }
    this.log(`${by}: open ${launch.label}`);
    this.homeChanged();
    if (launch.slot === "edit") {
      this.editAsked++;
      // The Panel's warm-up starting another map gives way.
      const opened = this.opened.get("edit");
      if (this.warming && opened && openKey(opened.request) !== openKey(launch.request)) this.warming.cancel();
    }
    this.queues[launch.slot] = this.queues[launch.slot]
      .then(() => this.launch(by, launch))
      .catch((error: unknown) => this.log(`Opening ${launch.label} went wrong: ${message(error)}`))
      .finally(() => {
        if (launch.slot === "edit") this.editAsked--;
      });
    return undefined;
  }

  private async editLaunch(request: Extract<OpenRequest, { to: "edit" }>): Promise<Launch> {
    const target = await loadTarget(this.root, request.target);
    if (!isMapId(request.map)) throw new Error(`"${request.map}" is not a map id: use lower case letters, digits, _ and -`);
    const path = join(target.mapsDir, request.map, "map.json");
    let name: string;
    if (request.fresh) {
      if (existsSync(path)) throw new Error(`${target.name} has a map "${request.map}" already`);
      name = request.fresh.name.trim() || request.map;
    } else {
      if (!existsSync(path)) throw new Error(`${target.name} has no map "${request.map}"`);
      if (this.selections.extracting(request.target, request.map)) throw new Error(`${request.map} is still being cut out: wait until it's ready`);
      name = ((JSON.parse(await readFile(path, "utf8")) as { name?: string }).name || request.map).trim();
    }
    return {
      slot: "edit",
      request: { to: "edit", target: request.target, map: request.map },
      label: mapLabel(target.name, name, request.map),
      chat: chatMapName(target.name, name),
      make: () => new EditorSession({ slot: this.slots.edit, verbose: this.verbose, note: (text) => this.log(text), target, mapId: request.map, fresh: request.fresh, store: this.store }),
    };
  }

  /** Select on a world: from the catalog (its id), a name, a folder or a .mcworld; none means the world the map in Edit came from. */
  private async selectLaunch(by: string, input: string | undefined): Promise<Launch> {
    let world;
    if (input === undefined) {
      const back = this.work.edit && this.whereIs(by) === this.work.edit ? this.work.edit.backToSelect() : "open a world from the editor lobby";
      if (typeof back === "string") throw new Error(back);
      world = back;
    } else {
      world = await requestedWorld(input, this.selections.unzipDir);
    }
    // A client world goes by its id, so the lobby's lists match it; any other by its folder.
    const client = (await clientWorlds()).some((candidate) => candidate.path === world.path);
    return {
      slot: "select",
      request: { to: "select", world: client ? worldId(world) : world.path },
      label: world.name,
      chat: world.name,
      make: () => new SelectSession({ slot: this.slots.select, verbose: this.verbose, note: (text) => this.log(text), world, selections: this.selections, guests: () => this.guests }),
    };
  }

  /**
   * Runs one open on its server: moves whoever is on it to the lobby, restarts it, then delivers the
   * waiting players. `warm` is the Panel's warm-up, which a newer open may call off while it starts.
   */
  private async launch(by: string, launch: Launch, warm = false): Promise<void> {
    if (this.state !== "ready") return;
    const { slot } = launch;
    const current = this.work[slot];
    const opened = this.opened.get(slot);
    const plan = planOpen(slot, openKey(launch.request), current && opened ? { key: openKey(opened.request), state: current.status().state, players: current.online() } : undefined);
    if (!plan.restart) {
      await this.deliver(slot);
      return;
    }
    if (current) {
      for (const name of plan.evict) this.waiting.set(name.toLowerCase(), { name, slot, label: launch.label });
      if (plan.evict.length > 0) {
        await current.say(`${by === "this PC" ? "This PC" : by} is opening ${launch.chat} here: wait in the editor lobby, and you'll be back when it's ready.`);
        await this.sendHome(current, plan.evict);
        await delay(LEAVE_MS);
      }
      this.homeChanged();
      await current.stop();
    }
    if (this.state !== "ready") return;
    const session = launch.make();
    this.setWork(slot, session);
    this.opened.set(slot, { request: launch.request, label: launch.label });
    session.onOpen = (request, who) => void this.request(who, request);
    if (session instanceof EditorSession) {
      session.onPreview = (who, fakes, as) => void this.preview(who, fakes, as);
      session.onDelete = (who) => this.deleteMap(who, session);
      session.onRename = (who, map) => this.renameMap(who, session, map);
    }
    if (session instanceof SelectSession) session.onExportEdit = (who, target, map) => this.exportEdit(who, target, map);
    session.onPlayer = (name, kind) => this.joined(session, name, kind);
    session.onEnd = (ok) => {
      if (this.work[slot] !== session) return;
      // It stopped on its own: a crash, or a failed start (reported where it started).
      if (!ok && session.status().state === "failed") this.log(`${launch.label} stopped: ${session.status().error ?? "see above"}`);
      this.setWork(slot, undefined);
      this.opened.delete(slot);
      this.homeChanged();
    };
    this.homeChanged();
    if (warm && session instanceof EditorSession) this.warming = session;
    try {
      await session.start();
    } catch (error) {
      // Called off for another map: whoever waits for Edit waits for that one.
      if (error instanceof StartCanceled) {
        this.log(`Stopped warming up ${launch.label}: another map was asked for.`);
        this.homeChanged();
        return;
      }
      for (const [key, entry] of this.waiting) {
        if (entry.slot !== slot) continue;
        this.waiting.delete(key);
        void this.tell(entry.name, `§cCould not open ${launch.chat}§c: ${message(error)}`);
        void this.whereIs(entry.name)?.send({ t: "loaded", players: [entry.name] });
      }
      this.homeChanged();
      return;
    } finally {
      if (this.warming === session) this.warming = undefined;
    }
    await noteRecent(this.root, { request: launch.request, label: launch.label }).catch((error: unknown) => this.log(`Could not note it as recent: ${message(error)}`));
    this.homeChanged();
    await this.deliver(slot);
  }

  /**
   * An export to open in Edit once it's cut out. Meanwhile an Edit server nobody is on (or waiting
   * for) stops, saving first, so the new map's server starts as soon as the map is ready.
   */
  private exportEdit(by: string, target: string, map: string): void {
    this.editAfterExport.set(`${target}/${map}`, by);
    const edit = this.work.edit;
    const idle = () => this.work.edit === edit && edit?.status().state === "ready" && edit.online().length === 0 && ![...this.waiting.values()].some((entry) => entry.slot === "edit");
    if (!edit || !idle()) return;
    this.queues.edit = this.queues.edit
      .then(async () => {
        if (!idle()) return;
        this.log(`${by}: stopping Edit while ${target}/${map} is cut out, to open it there next.`);
        await edit.stop();
      })
      .catch((error: unknown) => this.log(`Stopping Edit went wrong: ${message(error)}`));
  }

  // ---- Deleting ---------------------------------------------------------------------------------

  /**
   * Deletes the map open in Edit (its gear's Delete map): everyone there waits in the editor lobby,
   * Edit stops without saving, the map's folder goes (its removal committed and pushed when it was
   * published), and it leaves its world's list in Select and Recent.
   */
  private deleteMap(by: string, edit: EditorSession): void {
    if (this.isGuest(by) || this.work.edit !== edit) return;
    if (this.previewing || this.previewAsked) {
      void this.tell(by, "§cEnd the preview first: it may be playing this map.");
      return;
    }
    const { target, targetName, map, mapName } = edit.status();
    const label = mapLabel(targetName, mapName, map);
    const chat = chatMapName(targetName, mapName);
    this.log(`${by}: delete ${label}`);
    this.queues.edit = this.queues.edit
      .then(async () => {
        if (this.work.edit !== edit) return;
        const players = edit.online();
        await edit.say(`${by} is deleting ${chat}: everyone here goes to the editor lobby.`);
        if (players.length > 0) {
          await this.sendHome(edit, players);
          await delay(LEAVE_MS);
        }
        this.setWork("edit", undefined);
        this.opened.delete("edit");
        this.homeChanged();
        await edit.forceStop();
        // Its versions stay in the map store: npm run maps -- restore brings it back.
        const { published } = this.store.remove(target, map);
        if (published) this.store.exportPublished();
        await this.selections.removeMap(target, map);
        await forgetRecent(this.root, (entry) => entry.request.to !== "select" && entry.request.target === target && entry.request.map === map);
        this.homeChanged();
        let text = `Deleted ${chat}.`;
        if (published) text += " It leaves the lobby at the network's next start.";
        this.log(`Deleted ${label}.${text.slice(`Deleted ${chat}.`.length)}`);
        void this.tell(by, text);
      })
      .catch((error: unknown) => {
        this.log(`Deleting ${label} went wrong: ${message(error)}`);
        void this.tell(by, `§cDeleting ${chat}§c went wrong: ${message(error)}`);
      });
  }

  /**
   * Gives the map open in Edit another map id (Map settings' Map id, or a picture imported with its
   * map's name): everyone there waits in the editor lobby, Edit saves and stops, the folder moves
   * and its history in the map store follows (a published map stays published under its old id
   * until its next Publish), Select's lists and Recent follow, and the map opens again under its
   * new id with everyone back.
   */
  private renameMap(by: string, edit: EditorSession, to: string): void {
    if (this.isGuest(by) || this.work.edit !== edit) return;
    if (this.previewing || this.previewAsked) {
      void this.tell(by, "§cEnd the preview first: it may be playing this map.");
      return;
    }
    const { target, targetName, map, mapName } = edit.status();
    if (to === map) return;
    const dir = mapsDirOf(this.root, target);
    if (!isMapId(to)) {
      void this.tell(by, `§c"${to}" is not a map id: use lower case letters, digits, _ and -.`);
      return;
    }
    if (existsSync(join(dir, to))) {
      void this.tell(by, `§c${targetName} has a map "${to}" already: pick another id.`);
      return;
    }
    const label = mapLabel(targetName, mapName, to);
    this.log(`${by}: ${map} becomes ${to} (${targetName})`);
    this.queues.edit = this.queues.edit
      .then(async () => {
        if (this.work.edit !== edit) return;
        const players = edit.online();
        if (edit.status().unsaved && !(await edit.save(by))) {
          void this.tell(by, "§cThe map id didn't change: the world didn't save.");
          return;
        }
        for (const name of players) this.waiting.set(name.toLowerCase(), { name, slot: "edit", label });
        await edit.say(`${by} is giving ${chatMapName(targetName, mapName)} the map id ${to}: wait in the editor lobby, and you'll be back when it's ready.`);
        if (players.length > 0) {
          await this.sendHome(edit, players);
          await delay(LEAVE_MS);
        }
        this.setWork("edit", undefined);
        this.opened.delete("edit");
        this.homeChanged();
        await edit.stop();
        const published = this.store.published().some((entry) => entry.target === target && entry.map === map);
        await rename(join(dir, map), join(dir, to));
        this.store.rename(target, map, to);
        await this.selections.renameMap(target, map, to, mapName);
        await renameRecent(this.root, target, map, to);
        this.log(`Moved ${target}/${map} to ${target}/${to}${published ? `: it stays published as ${map} until its next Publish` : ""}.`);
        this.queues.edit = this.queues.edit.then(async () => this.launch(by, await this.editLaunch({ to: "edit", target, map: to })));
      })
      .catch((error: unknown) => {
        this.log(`Renaming ${map} went wrong: ${message(error)}`);
        void this.tell(by, `§cGiving it the map id ${to} went wrong: ${message(error)}`);
      });
  }

  // ---- Preview --------------------------------------------------------------------------------

  /** Why no preview can start now (the editor isn't ready, or one runs); `asked` leaves out the one that was just asked for. */
  private previewBusy(asked = false): string | undefined {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    if (this.previewing || (this.previewAsked && !asked)) return "a preview is running already";
    return undefined;
  }

  /** Why the map open in Edit can't be previewed now; `asked` leaves out the one that was just asked for. */
  private previewProblem(asked = false): string | undefined {
    const busy = this.previewBusy(asked);
    if (busy) return busy;
    const status = this.work.edit?.status();
    if (!status || status.state !== "ready") return "no map is open in Edit";
    if (status.target === "lobby") return "a lobby map can't be previewed yet: publish it, then start the network";
    if (!status.checklist.ready) return `finish the checklist first: ${status.checklist.problems.join("; ")}`;
    return undefined;
  }

  /** Saves Edit's world, then plays the map open there, moving everyone in Edit to it. */
  private async runPreview(by: string, fakes: number, as?: string): Promise<void> {
    const edit = this.work.edit;
    if (!edit || this.previewProblem(true)) return;
    const source = edit.previewSource(as);
    const status = edit.status();
    this.log(`${by}: preview ${source.label}`);
    await edit.say(`${by === "this PC" ? "This PC" : by} is starting a preview of ${chatMapName(status.targetName, status.mapName)}: everyone here goes as soon as it's ready (about 30 seconds).`);
    await edit.send({ t: "notice", text: `§dStarting the preview of ${source.label}` });
    // Everyone here goes, so everyone gets the loading screen.
    await edit.send({ t: "loading", players: edit.online(), label: `the preview of ${source.label}` });
    if (status.unsaved && !(await edit.save(by))) {
      await edit.say("§cThe preview didn't start: the world didn't save.");
      await edit.send({ t: "loaded", players: edit.online() });
      return;
    }
    const recent: RecentEntry = { request: { to: "preview", target: status.target, map: status.map }, label: mapLabel(status.targetName, status.mapName, status.map) };
    await this.playPreview(by, { source, recent, from: "edit", fakes });
  }

  /**
   * A preview of a map from its folder (a preview card in the editor lobby's Recent): whoever asked
   * waits in the editor lobby, and the game sends them back there. Edit keeps running; when it has
   * this map open, it saves first, so the preview has its newest blocks.
   */
  private async previewFromLobby(by: string, request: Extract<OpenRequest, { to: "preview" }>): Promise<string | undefined> {
    const busy = this.previewBusy();
    if (busy) return busy;
    let plan: PreviewPlan;
    try {
      plan = await this.lobbyPreviewPlan(request);
    } catch (error) {
      return message(error);
    }
    this.previewAsked = true;
    if (by !== "this PC") this.waiting.set(by.toLowerCase(), { name: by, slot: "preview", label: `the preview of ${plan.source.label}` });
    this.log(`${by}: preview ${plan.source.label} (from the editor lobby)`);
    this.homeChanged();
    this.queues.select = this.queues.select
      .then(async () => {
        const edit = this.work.edit;
        const here = this.opened.get("edit");
        const same = here !== undefined && openKey(here.request) === openKey({ to: "edit", target: request.target, map: request.map });
        if (edit && same && edit.status().state === "ready" && edit.status().unsaved && !(await edit.save(by))) {
          this.dropPreviewWaiting("§cThe preview didn't start: Edit's world didn't save.");
          return;
        }
        await this.playPreview(by, plan);
      })
      .catch((error: unknown) => this.log(`The preview went wrong: ${message(error)}`))
      .finally(() => (this.previewAsked = false));
    return undefined;
  }

  /** What a preview card plays: the map's folder as it is, once its checklist is done. */
  private async lobbyPreviewPlan(request: Extract<OpenRequest, { to: "preview" }>): Promise<PreviewPlan> {
    const target = await loadTarget(this.root, request.target);
    if (target.id === "lobby") throw new Error("a lobby map can't be previewed yet: publish it, then start the network");
    if (!isMapId(request.map)) throw new Error(`"${request.map}" is not a map id`);
    const mapDir = join(target.mapsDir, request.map);
    const path = join(mapDir, "map.json");
    if (!existsSync(path)) throw new Error(`${target.name} has no map "${request.map}"`);
    if (this.selections.extracting(request.target, request.map)) throw new Error(`${request.map} is still being cut out: wait until it's ready`);
    const config = JSON.parse(await readFile(path, "utf8")) as MapConfig;
    const checklist = mapChecklist(config, target.rules);
    if (!checklist.ready) throw new Error(`open it in Edit and finish its checklist first: ${checklist.problems.join("; ")}`);
    const name = (config.name || request.map).trim();
    return {
      source: { map: { game: target.id, mapId: request.map, mapDir, config }, label: `${target.name}: ${name}`, maxPlayers: target.rules.maxPlayers ?? 1 },
      recent: { request: { to: "preview", target: target.id, map: request.map }, label: mapLabel(target.name, name, request.map) },
      from: "home",
      fakes: request.fakes ?? 0,
    };
  }

  /**
   * Closes Select, starts the game on its port, and moves its players there: everyone in Edit, or
   * whoever asked from the editor lobby. Guests on Select, or waiting in the lobby, come along. A
   * Replay names its players (`replay`: they wait in the editor lobby), guests among them.
   */
  private async playPreview(by: string, plan: PreviewPlan, replay?: string[]): Promise<void> {
    const { source, from } = plan;
    const guests = replay ? [] : [...(this.home?.online() ?? []), ...(this.work.select?.online() ?? [])].filter((name) => this.isGuest(name));
    await this.closeSelect(by);
    const env = readEnv(await readFile(join(this.root, ".env"), "utf8"));
    const asked = replay ?? (from === "home" ? (this.home?.online() ?? []).filter((name) => this.waiting.get(name.toLowerCase())?.slot === "preview") : []);
    const session = new PreviewSession({
      port: this.slots.select.port,
      container: `${this.slots.select.container.replace(/-select$/, "")}-preview`,
      returnPort: from === "edit" ? this.slots.edit.port : this.slots.home.port,
      guestPort: this.slots.home.entrance ?? this.slots.home.port,
      guests: this.guests,
      map: source.map,
      label: source.label,
      maxPlayers: source.maxPlayers + 1,
      players: [...(from === "edit" && !replay ? (this.work.edit?.online() ?? []) : asked), ...guests],
      fakes: plan.fakes,
      env,
      verbose: this.verbose,
      note: (text) => this.log(text),
    });
    this.previewing = session;
    this.previewFrom = { from, by };
    this.previewPlan = plan;
    this.homeChanged();
    try {
      await session.start();
    } catch (error) {
      this.log(`The preview didn't start: ${message(error)}`);
      if (from === "edit") {
        await this.work.edit?.say(`§cThe preview didn't start: ${message(error)}`);
        await this.work.edit?.send({ t: "loaded", players: this.work.edit.online() });
      }
      this.dropPreviewWaiting(`§cThe preview didn't start: ${message(error)}`);
      this.previewing = undefined;
      this.previewFrom = undefined;
      this.previewPlan = undefined;
      this.homeChanged();
      this.reopenSelect();
      return;
    }
    session.onEnd = (why, next) => void this.previewEnded(session, why, next);
    session.onPlayer = () => this.homeChanged();
    await noteRecent(this.root, plan.recent).catch((error: unknown) => this.log(`Could not note it as recent: ${message(error)}`));
    const label = `the preview of ${source.label}`;
    if (replay) {
      const names = (this.home?.online() ?? []).filter((name) => replay.some((player) => player.toLowerCase() === name.toLowerCase()));
      if (names.length > 0) await this.home?.goto(names, this.slots.select.port, label);
    } else if (from === "edit") {
      const players = this.work.edit?.online() ?? [];
      if (players.length > 0) await this.work.edit?.goto(players, this.slots.select.port, label);
    } else {
      const names = (this.home?.online() ?? []).filter((name) => this.waiting.get(name.toLowerCase())?.slot === "preview");
      if (names.length > 0) await this.home?.goto(names, this.slots.select.port, label);
    }
    // Anyone who left the lobby meanwhile stops waiting for it.
    for (const [key, entry] of this.waiting) if (entry.slot === "preview") this.waiting.delete(key);
    await this.sendGuests();
    this.homeChanged();
  }

  /** Whoever waits in the editor lobby for a preview stops waiting, and hears why. */
  private dropPreviewWaiting(text: string): void {
    for (const [key, entry] of this.waiting) {
      if (entry.slot !== "preview") continue;
      this.waiting.delete(key);
      void this.tell(entry.name, text);
    }
    this.homeChanged();
  }

  /** Select gives its port to the preview: whoever is on it waits in the editor lobby. */
  private async closeSelect(by: string): Promise<void> {
    const select = this.work.select;
    const opened = this.opened.get("select");
    if (!select || !opened) return;
    this.selectBefore = opened;
    const players = select.online();
    if (players.length > 0) {
      await select.say(`${by === "this PC" ? "This PC" : by} started a preview on this port: Select closes until it ends, and opens again after.`);
      await this.sendHome(select, players);
      await delay(LEAVE_MS);
    }
    this.setWork("select", undefined);
    this.opened.delete("select");
    this.homeChanged();
    await select.stop();
  }

  /**
   * The preview ended: its server stops. Players who picked Edit after a preview from the editor
   * lobby get the map opened there; players who picked Replay wait in the editor lobby while it
   * starts again (Select stays closed until that one ends).
   */
  private async previewEnded(session: PreviewSession, why: string, next: { replay: string[]; edit: string[] } = { replay: [], edit: [] }): Promise<void> {
    if (this.previewing !== session) return;
    this.log(`The preview is over: ${why}.`);
    await session.stop();
    this.previewing = undefined;
    const back = this.previewFrom;
    const plan = this.previewPlan;
    this.previewFrom = undefined;
    this.previewPlan = undefined;
    this.homeChanged();
    const { target, map } = plan?.recent.request.to === "preview" ? plan.recent.request : { target: undefined, map: undefined };
    if (target !== undefined && map !== undefined) for (const name of next.edit) void this.request(name, { to: "edit", target, map });
    if (plan && back && next.replay.length > 0 && this.state === "ready") {
      this.replay(back.by, plan, next.replay);
      return;
    }
    const text = `Back from the preview: ${why}.`;
    setTimeout(() => void (back?.from === "home" ? this.tell(back.by, text) : this.work.edit?.say(text)), BACK_MS);
    this.reopenSelect();
  }

  /** Replay: the same preview again (the map as it was, the same fake players) for `players`, who wait in the editor lobby meanwhile. */
  private replay(by: string, plan: PreviewPlan, players: string[]): void {
    const label = `the preview of ${plan.source.label}`;
    for (const name of players) this.waiting.set(name.toLowerCase(), { name, slot: "preview", label });
    this.previewAsked = true;
    this.log(`${players.join(", ")}: replay ${plan.source.label}`);
    this.homeChanged();
    this.queues.select = this.queues.select
      .then(() => this.playPreview(by, plan, players))
      .catch((error: unknown) => this.log(`The replay went wrong: ${message(error)}`))
      .finally(() => (this.previewAsked = false));
  }

  /** Opens again what Select had open before a preview took its port. */
  private reopenSelect(): void {
    const before = this.selectBefore;
    this.selectBefore = undefined;
    if (before && this.state === "ready") void this.request("this PC", before.request);
  }

  /** Sends everyone waiting for this server to it, once it's ready. */
  private async deliver(slot: WorkSlot): Promise<void> {
    const session = this.work[slot];
    const opened = this.opened.get(slot);
    if (!session || !opened || session.status().state !== "ready") return;
    const port = this.slots[slot].port;
    for (const server of this.servers()) {
      if (server === session) continue;
      const names = server.online().filter((name) => this.waiting.get(name.toLowerCase())?.slot === slot);
      if (names.length === 0) continue;
      for (const name of names) this.waiting.delete(name.toLowerCase());
      await server.goto(names, port, opened.label);
    }
    // Whoever asked from this server itself is there already.
    for (const name of session.online()) this.waiting.delete(name.toLowerCase());
    if (slot === "select") await this.sendGuests();
    this.homeChanged();
  }

  /** A player joined or left one of the servers. */
  private joined(server: ServerSession, name: string, kind: "connected" | "disconnected"): void {
    this.homeChanged();
    if (kind !== "connected" || server !== this.home) return;
    // A guest goes on to Select or the preview, if one is ready (or waits here until one is).
    if (this.isGuest(name)) {
      setTimeout(() => void this.sendGuests().catch((error: unknown) => this.log(`Could not move ${name} on: ${message(error)}`)), GUEST_ON_MS);
      return;
    }
    // Back in the lobby: on to a server that's waiting for them (a preview moves its players once it's ready).
    const entry = this.waiting.get(name.toLowerCase());
    if (entry && entry.slot !== "preview") {
      void this.deliver(entry.slot);
      return;
    }
    // Open in game, from the Panel: a map editor joining goes straight to that map in Edit (once).
    const bring = this.bring;
    const opened = this.opened.get("edit");
    if (!bring || bring.until < Date.now() || bring.brought.has(name.toLowerCase()) || !opened || openKey(opened.request) !== bring.key) return;
    bring.brought.add(name.toLowerCase());
    this.waiting.set(name.toLowerCase(), { name, slot: "edit", label: opened.label });
    this.homeChanged();
    void this.deliver("edit");
  }

  // ---- The lobby's state ------------------------------------------------------------------

  private async homeState(): Promise<HomeState> {
    const info = (slot: WorkSlot): ServerInfo | undefined => {
      const session = this.work[slot];
      const opened = this.opened.get(slot);
      const state = session?.status().state;
      if (!session || !opened || (state !== "starting" && state !== "ready" && state !== "stopping")) return undefined;
      return { request: opened.request, label: opened.label, state, players: session.online() };
    };
    const select = info("select");
    const edit = info("edit");
    const previewState = this.previewing?.state;
    const preview =
      this.previewing && (previewState === "starting" || previewState === "ready" || previewState === "stopping") ? { label: this.previewing.status().label, state: previewState } : undefined;
    return {
      catalog: await buildCatalog(this.root, this.store),
      servers: {
        ...(select ? { select } : {}),
        ...(edit ? { edit } : {}),
        ...(preview ? { preview } : {}),
        waiting: [...this.waiting.values()].map(({ name, label }) => ({ name, label })),
      },
    };
  }

  /** Sends the lobby its state again soon (several changes in a row go as one). */
  private homeChanged(): void {
    if (this.homeTimer) return;
    this.homeTimer = setTimeout(() => {
      this.homeTimer = undefined;
      void this.home?.update().catch((error: unknown) => this.log(`Could not update the editor lobby: ${message(error)}`));
    }, HOME_UPDATE_MS);
  }

  // ---- Guests -----------------------------------------------------------------------------

  private async trySetGuest(name: string, on: boolean): Promise<string | undefined> {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    const result = on ? addGuest(this.guests, name, this.players) : removeGuest(this.guests, name);
    if (typeof result === "string") return result;
    const tag = on ? result[result.length - 1] : (this.guests.find((guest) => guest.toLowerCase() === name.toLowerCase()) ?? name);
    this.guests = result;
    await writeGuests(this.root, this.guests);
    for (const server of this.guestServers()) await server.allow(tag, on);
    if (on) {
      this.log(`${tag} is a guest now: they may join the editor lobby, Select and previews.`);
    } else {
      this.log(`${tag} is no longer a guest.`);
      for (const server of this.guestServers()) await server.kick(tag, "You're no longer a guest of the map editor.");
    }
    this.homeChanged();
    return undefined;
  }

  /** Anyone who isn't a map editor (LAN_PLAYERS) is a guest ("this PC" is the host itself). */
  private isGuest(name: string): boolean {
    return name !== "this PC" && !this.players.some((player) => player.toLowerCase() === name.toLowerCase());
  }

  /**
   * Sends players on `server` to the editor lobby: map editors to its port, and guests through its
   * second entrance (a console sent back to 19132 by address never got there).
   */
  private async sendHome(server: ServerSession, players: string[]): Promise<void> {
    const guests = players.filter((name) => this.isGuest(name));
    await server.goto(players.filter((name) => !this.isGuest(name)), this.slots.home.port, "the editor lobby");
    await server.goto(guests, this.slots.home.entrance ?? this.slots.home.port, "the editor lobby");
  }

  /** The guests, and where each one is. */
  private guestInfo(): GuestInfo[] {
    const on = (name: string, players: string[] | undefined) => players?.some((player) => player.toLowerCase() === name.toLowerCase()) === true;
    return this.guests.map((name): GuestInfo => {
      if (on(name, this.previewing?.online())) return { name, on: "preview" };
      if (on(name, this.work.select?.online())) return { name, on: "select" };
      if (on(name, this.home?.online())) return { name, on: "home" };
      return { name };
    });
  }

  /** The servers that let guests in now: the editor lobby, and Select or the preview. */
  private guestServers(): { allow(name: string, on: boolean): Promise<void>; kick(name: string, reason: string): Promise<void> }[] {
    return [this.home, this.work.select, this.previewing].filter((server) => server !== undefined);
  }

  /** Where guests go now: Select's port, once Select or a preview is ready there. */
  private guestTarget(): { port: number; label: string } | undefined {
    if (this.previewing || this.previewAsked) {
      return this.previewing?.state === "ready" ? { port: this.slots.select.port, label: `the preview of ${this.previewing.status().label}` } : undefined;
    }
    const select = this.work.select;
    const opened = this.opened.get("select");
    return select && opened && select.status().state === "ready" ? { port: this.slots.select.port, label: opened.label } : undefined;
  }

  /** Moves guests in the editor lobby on to Select or the preview, if one is ready. */
  private async sendGuests(): Promise<void> {
    const target = this.guestTarget();
    const home = this.home;
    if (!target || !home) return;
    const names = home.online().filter((name) => this.isGuest(name));
    if (names.length > 0) await home.goto(names, target.port, target.label);
  }

  // ---- Players ----------------------------------------------------------------------------

  private servers(): ServerSession[] {
    const servers: (ServerSession | undefined)[] = [this.home, this.work.select, this.work.edit];
    return servers.filter((server) => server !== undefined);
  }

  private whereIs(name: string): ServerSession | undefined {
    return this.servers().find((server) => server.online().some((online) => online.toLowerCase() === name.toLowerCase()));
  }

  private tell(name: string, text: string): Promise<unknown> {
    return this.whereIs(name)?.say(text, name) ?? Promise.resolve();
  }

  /**
   * Tells everyone on Select and Edit that a map cut out of `world` is ready to load (in
   * chat, and above the hotbar), or, on Select with that world open, that it failed.
   */
  private async announce(world: string, info: SelectionInfo): Promise<void> {
    const name = chatMapName(info.targetName, info.name);
    for (const session of [this.work.select, this.work.edit]) {
      if (!session || session.status().state !== "ready") continue;
      const status = session.status();
      const here = status.mode === "select" && status.world === world;
      let text: string;
      if (info.status === "failed") {
        if (!here) continue;
        text = `§c${name} failed: ${info.error ?? "see the editor's log"}`;
      } else {
        text = `§a${name} is ready: ${here ? `Edit ${info.map} in the map menu loads it.` : `open it from the editor lobby (Search, ${info.targetName}).`}`;
      }
      for (const player of session.online()) await session.say(text, player);
      if (info.status === "ready") await session.send({ t: "notice", text: `§a${info.name} is ready to load in Edit` });
    }
  }

  private setWork(slot: WorkSlot, session: ServerSession | undefined): void {
    if (slot === "select") this.work.select = session as SelectSession | undefined;
    else this.work.edit = session as EditorSession | undefined;
  }
}

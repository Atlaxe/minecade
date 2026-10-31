// The map editor's three servers, run together (docs/editor.md, "Starting"): the editor lobby on
// 19132, where everyone joins and picks what to open; Select on 19133, a copy of a converted world
// to box maps in; Edit on 19134, one map. Opening something starts its server (or restarts it on
// the new map or world). Players move between the servers by transfer, never by rejoining: whoever
// asked waits where they are, and anyone on a server that restarts waits in the editor lobby, until
// the server is ready. Players a map editor invited (guests.ts) may be on the editor lobby and on
// whatever runs on Select's port (Select, or a preview), never Edit: they're moved on to that as
// soon as it's ready. Extractions (selections.ts) run in the background and outlive the servers.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openKey, type GuestInfo, type HomeState, type OpenRequest, type SelectionInfo, type ServerInfo } from "@minecade/minigame-core/config";
import { connectDocker } from "../build/docker-util.ts";
import { readEnv } from "../control-panel/core.ts";
import { buildCatalog, mapLabel, noteRecent, requestedWorld, worldId } from "./catalog.ts";
import { SLOTS, editorPlayers, isMapId, planOpen, portHolders, type EditorStatus, type Slot, type SlotId } from "./editor-core.ts";
import { addGuest, readGuests, removeGuest, writeGuests } from "./guests.ts";
import { HomeSession } from "./home-session.ts";
import { PreviewSession } from "./preview-session.ts";
import type { Git } from "./publish.ts";
import { SelectSession } from "./select-session.ts";
import { Selections } from "./selections.ts";
import { delay, message, type ServerSession } from "./server-session.ts";
import { EditorSession } from "./session.ts";
import { loadTarget } from "./targets.ts";
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
}

export interface RunnerOptions {
  root: string;
  verbose: boolean;
  /** The servers' ports and containers (a headless test passes its own). */
  slots?: Record<SlotId, Slot>;
  /** How Publish runs git (a headless test passes one that never pushes to GitHub). */
  git?: Git;
}

export class EditorRunner {
  readonly selections: Selections;
  private readonly root: string;
  private readonly verbose: boolean;
  private readonly slots: Record<SlotId, Slot>;
  private readonly git: Git | undefined;
  private readonly lines: string[] = [];
  private readonly startedAt = new Date().toISOString();
  private state: EditorStatus["state"] = "starting";
  private error: string | undefined;
  private env: Record<string, string> = {};
  /** Map editors (LAN_PLAYERS): everyone else on the servers is an invited guest. */
  private players: string[] = [];
  /** The invited players (work/editor/guests.json). */
  private guests: string[] = [];
  /** The guest list each server heard last, so it hears only of changes. */
  private readonly guestsSent = new WeakMap<ServerSession, string>();
  private home: HomeSession | undefined;
  private readonly work: { select?: SelectSession; edit?: EditorSession } = {};
  /** What each work server has open. */
  private readonly opened = new Map<WorkSlot, Opened>();
  /** Players waiting for a server to be ready, by lower-case name. */
  private readonly waiting = new Map<string, { name: string; slot: WorkSlot; label: string }>();
  /** Opening runs one at a time on each server. */
  private readonly queues: Record<WorkSlot, Promise<unknown>> = { select: Promise.resolve(), edit: Promise.resolve() };
  private homeTimer: NodeJS.Timeout | undefined;
  private shutting: Promise<void> | undefined;
  /** A Preview running on Select's port, and what Select had open before it, to open again after. */
  private previewing: PreviewSession | undefined;
  /** A preview was asked for and is getting under way (saving, closing Select). */
  private previewAsked = false;
  private selectBefore: Opened | undefined;
  /** Called once everything has stopped: true when it went well. */
  onExit: (ok: boolean) => void = () => {};

  constructor(options: RunnerOptions) {
    this.root = options.root;
    this.verbose = options.verbose;
    this.slots = options.slots ?? SLOTS;
    this.git = options.git;
    this.selections = new Selections(this.root, { verbose: this.verbose, note: (text) => this.log(`Extract: ${text}`) });
    this.selections.onChange((world, info, gone) => {
      // Forget takes a map off a list as it is, ready or failed.
      if (gone || (info.status !== "ready" && info.status !== "failed")) return;
      // A map that's ready shows in the lobby's lists.
      if (info.status === "ready") this.homeChanged();
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
    const holders = portHolders(await docker.listContainers(), Object.values(this.slots).map((slot) => slot.port));
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
    home.onInvite = (name, on, by) => void this.invite(by, name, on);
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
    this.log(`Ready: join ${home.status().join}. Map editors: ${this.players.join(", ") || "nobody (set LAN_PLAYERS)"}.${this.guests.length > 0 ? ` Invited: ${this.guests.join(", ")}.` : ""}`);
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
    };
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
  preview(by: string): string | undefined {
    const problem = this.isGuest(by) ? "only map editors can start a preview" : this.previewProblem();
    if (problem) {
      this.log(`${by}: can't preview: ${problem}`);
      void this.tell(by, `§c${problem}`);
      return problem;
    }
    this.previewAsked = true;
    this.queues.select = this.queues.select
      .then(() => this.runPreview(by))
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
   * Invites a player (on), or takes the invitation back, from a map editor in game or this PC.
   * Guests may join the editor lobby and whatever runs on Select's port, never Edit; taking an
   * invitation back disconnects them. Undefined when it's done, or why it can't be.
   */
  async invite(by: string, name: string, on: boolean): Promise<string | undefined> {
    const problem = await this.tryInvite(by, name.trim(), on);
    if (problem) {
      this.log(`${by}: can't ${on ? "invite" : "remove"} ${name}: ${problem}`);
      void this.tell(by, `§c${problem}`);
    }
    return problem;
  }

  /** Stops every server (Edit saves first), waits for extractions, and exits. Safe to call more than once. */
  shutdown(force = false): Promise<void> {
    this.shutting ??= (async () => {
      this.state = "stopping";
      this.log(force ? "Shutting down without saving the world..." : "Shutting down (Edit saves first)...");
      const stop = (session: ServerSession | undefined) => (session ? (force ? session.forceStop() : session.stop()) : Promise.resolve());
      await this.previewing?.stop();
      await Promise.all([stop(this.work.edit), stop(this.work.select)]);
      await stop(this.home);
      if (this.selections.busy > 0) {
        this.log(`Waiting for ${this.selections.busy} extraction${this.selections.busy === 1 ? "" : "s"} to finish...`);
        await this.selections.idle();
      }
      this.log("Shut down.");
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
      if (on && on !== this.home) await on.goto([by], this.slots.home.port, "the editor lobby");
      return undefined;
    }
    if (request.to === "select" && this.previewing) return "a preview is running on Select's port: end it first";
    let launch: Launch;
    try {
      launch = request.to === "edit" ? await this.editLaunch(request) : await this.selectLaunch(by, request.world);
    } catch (error) {
      return message(error);
    }
    if (by !== "this PC") {
      this.waiting.set(by.toLowerCase(), { name: by, slot: launch.slot, label: launch.label });
      if (this.whereIs(by) !== this.home) void this.tell(by, `Opening ${launch.label}: you'll be moved there when it's ready.`);
    }
    this.log(`${by}: open ${launch.label}`);
    this.homeChanged();
    this.queues[launch.slot] = this.queues[launch.slot].then(() => this.launch(by, launch)).catch((error: unknown) => this.log(`Opening ${launch.label} went wrong: ${message(error)}`));
    return undefined;
  }

  private async editLaunch(request: Extract<OpenRequest, { to: "edit" }>): Promise<Launch> {
    const target = await loadTarget(this.root, request.target);
    if (!isMapId(request.map)) throw new Error(`"${request.map}" is not a map id: use lower case letters, digits, _ and -`);
    const path = join(target.dir, "maps", request.map, "map.json");
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
      make: () => new EditorSession({ slot: this.slots.edit, verbose: this.verbose, note: (text) => this.log(text), target, mapId: request.map, fresh: request.fresh, git: this.git }),
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
      make: () => new SelectSession({ slot: this.slots.select, verbose: this.verbose, note: (text) => this.log(text), world, selections: this.selections, guests: () => this.guests }),
    };
  }

  /** Runs one open on its server: moves whoever is on it to the lobby, restarts it, then delivers the waiting players. */
  private async launch(by: string, launch: Launch): Promise<void> {
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
        await current.say(`${by === "this PC" ? "This PC" : by} is opening ${launch.label} here: wait in the editor lobby, and you'll be back when it's ready.`);
        await current.goto(plan.evict, this.slots.home.port, "the editor lobby");
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
    session.onInvite = (name, on, who) => void this.invite(who, name, on);
    if (session instanceof EditorSession) session.onPreview = (who) => void this.preview(who);
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
    try {
      await session.start();
    } catch (error) {
      for (const [key, entry] of this.waiting) {
        if (entry.slot !== slot) continue;
        this.waiting.delete(key);
        void this.tell(entry.name, `§cCould not open ${launch.label}: ${message(error)}`);
      }
      this.homeChanged();
      return;
    }
    await noteRecent(this.root, { request: launch.request, label: launch.label }).catch((error: unknown) => this.log(`Could not note it as recent: ${message(error)}`));
    this.homeChanged();
    await this.deliver(slot);
  }

  // ---- Preview --------------------------------------------------------------------------------

  /** Why a preview can't start now; `asked` leaves out the one that was just asked for. */
  private previewProblem(asked = false): string | undefined {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    if (this.previewing || (this.previewAsked && !asked)) return "a preview is running already";
    const status = this.work.edit?.status();
    if (!status || status.state !== "ready") return "no map is open in Edit";
    if (status.target === "lobby") return "a lobby map can't be previewed yet: publish it, then start the network";
    if (!status.checklist.ready) return `finish the checklist first: ${status.checklist.problems.join("; ")}`;
    return undefined;
  }

  /** Saves Edit's world, closes Select, starts the game on its port, and moves everyone in Edit there. */
  private async runPreview(by: string): Promise<void> {
    const edit = this.work.edit;
    if (!edit || this.previewProblem(true)) return;
    const source = edit.previewSource();
    this.log(`${by}: preview ${source.label}`);
    await edit.say(`${by === "this PC" ? "This PC" : by} is starting a preview of ${source.label}: everyone here goes as soon as it's ready (about 30 seconds).`);
    await edit.send({ t: "notice", text: `§dStarting the preview of ${source.label}` });
    if (edit.status().unsaved && !(await edit.save(by))) {
      await edit.say("§cThe preview didn't start: the world didn't save.");
      return;
    }
    // Guests on Select, or waiting in the lobby, come along.
    const guests = [...(this.home?.online() ?? []), ...(this.work.select?.online() ?? [])].filter((name) => this.isGuest(name));
    await this.closeSelect(by);
    const env = readEnv(await readFile(join(this.root, ".env"), "utf8"));
    const session = new PreviewSession({
      port: this.slots.select.port,
      container: `${this.slots.select.container.replace(/-select$/, "")}-preview`,
      returnPort: this.slots.edit.port,
      guestPort: this.slots.home.port,
      guests: this.guests,
      map: source.map,
      label: source.label,
      maxPlayers: source.maxPlayers + 1,
      players: [...edit.online(), ...guests],
      env,
      verbose: this.verbose,
      note: (text) => this.log(text),
    });
    this.previewing = session;
    this.homeChanged();
    try {
      await session.start();
    } catch (error) {
      this.log(`The preview didn't start: ${message(error)}`);
      await this.work.edit?.say(`§cThe preview didn't start: ${message(error)}`);
      this.previewing = undefined;
      this.reopenSelect();
      return;
    }
    session.onEnd = (why) => void this.previewEnded(session, why);
    session.onPlayer = () => this.homeChanged();
    const players = this.work.edit?.online() ?? [];
    if (players.length > 0) await this.work.edit?.goto(players, this.slots.select.port, `the preview of ${source.label}`);
    await this.sendGuests();
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
      await select.goto(players, this.slots.home.port, "the editor lobby");
      await delay(LEAVE_MS);
    }
    this.setWork("select", undefined);
    this.opened.delete("select");
    this.homeChanged();
    await select.stop();
  }

  private async previewEnded(session: PreviewSession, why: string): Promise<void> {
    if (this.previewing !== session) return;
    this.log(`The preview is over: ${why}.`);
    await session.stop();
    this.previewing = undefined;
    this.homeChanged();
    setTimeout(() => void this.work.edit?.say(`Back from the preview: ${why}.`), BACK_MS);
    this.reopenSelect();
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
    // Back in the lobby: on to a server that's waiting for them.
    const entry = this.waiting.get(name.toLowerCase());
    if (entry) void this.deliver(entry.slot);
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
      catalog: await buildCatalog(this.root),
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
      void this.sendGuestLists().catch((error: unknown) => this.log(`Could not send the guest list: ${message(error)}`));
    }, HOME_UPDATE_MS);
  }

  // ---- Guests -----------------------------------------------------------------------------

  private async tryInvite(by: string, name: string, on: boolean): Promise<string | undefined> {
    if (this.state !== "ready") return this.state === "stopping" ? "the editor is shutting down" : "the editor is still starting";
    if (this.isGuest(by)) return "only map editors can invite players";
    const result = on ? addGuest(this.guests, name, this.players) : removeGuest(this.guests, name);
    if (typeof result === "string") return result;
    const tag = on ? result[result.length - 1] : (this.guests.find((guest) => guest.toLowerCase() === name.toLowerCase()) ?? name);
    this.guests = result;
    await writeGuests(this.root, this.guests);
    for (const server of this.guestServers()) await server.allow(tag, on);
    if (on) {
      this.log(`${by}: invited ${tag}.`);
      const where = this.guestTarget() ? "they go straight to what's open on Select's port" : "they wait in the editor lobby until you open Select or start a preview";
      void this.tell(by, `Invited ${tag}: they join ${this.guestAddress()}, as for the network, and ${where}. Edit stays yours.`);
    } else {
      this.log(`${by}: ${tag} is no longer invited.`);
      for (const server of this.guestServers()) await server.kick(tag, "You're no longer invited to the map editor.");
      void this.tell(by, `${tag} is no longer invited.`);
    }
    this.homeChanged();
    return undefined;
  }

  /** Anyone who isn't a map editor (LAN_PLAYERS) is an invited guest ("this PC" is the host itself). */
  private isGuest(name: string): boolean {
    return name !== "this PC" && !this.players.some((player) => player.toLowerCase() === name.toLowerCase());
  }

  /** The invited players, and where each one is. */
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

  /** Tells every server that changed its view of the guests (for the Players menu). */
  private async sendGuestLists(): Promise<void> {
    const guests = this.guestInfo();
    const text = JSON.stringify(guests);
    for (const server of this.servers()) {
      if (server.status().state !== "ready" || this.guestsSent.get(server) === text) continue;
      this.guestsSent.set(server, text);
      await server.send({ t: "guests", guests });
    }
  }

  /** The address guests join: the network's public one, on the editor lobby's port. */
  private guestAddress(): string {
    const host = this.env.PUBLIC_HOST && this.env.PUBLIC_HOST !== "auto" ? this.env.PUBLIC_HOST : "this PC's public address";
    return `${host}:${this.slots.home.port}`;
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
    const name = `${info.name} (${info.map})`;
    for (const session of [this.work.select, this.work.edit]) {
      if (!session || session.status().state !== "ready") continue;
      const status = session.status();
      const here = status.mode === "select" && status.world === world;
      let text: string;
      if (info.status === "failed") {
        if (!here) continue;
        text = `§c${name} failed: ${info.error ?? "see the editor's log"}`;
      } else {
        text = `§a${name} is ready: ${here ? `Edit ${info.map} in the map menu loads it.` : `open it from the editor lobby (Open a map, ${info.targetName}).`}`;
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

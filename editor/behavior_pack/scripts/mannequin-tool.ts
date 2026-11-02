// The Mannequin tool (Edit, on a game's map): stand-ins for players in the game's picture. A use on
// a block places a mannequin there at once ("Mannequin 1", "Mannequin 2" and on), facing you, in the
// first choices (a plain red, standing, holding nothing). Hit or right click one for its screen
// (menu.ts mannequinScreenEntries): its skin (a plain color, Steve or Alex, or a player's), what it
// holds (the game's kit items), its pose, and where it stands; each tap changes it at once (Undo
// takes it back). Sneaking, a right click gives it its next pose instead (the first again after the
// last). The tool's settings in the map menu list them.
//
// A mannequin is the preview's fake player (minecade:fake_player, its "minecade:mannequin" group:
// no gravity, can't be hurt or pushed), without a name tag, and it stays in a game picture's shot
// (the markers hide), but not a map preview's (nobody's in those). Like the markers, the bodies live only while the editor runs: every chunk one was
// in is remembered, and clear() removes them all before the world is saved.
import { world, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { FAKE_PLAYER, FAKE_POSES, NEW_MANNEQUIN_LOOK, describeError, dressFake, log, nextPose, type MapMannequin, type Scope } from "@minecade/minigame-core";
import { facingMannequin, itemColorOf, mannequinAt, mannequinLook, mannequinSkins, mannequinsOf, nextMannequinName, nudgeMannequin, withLook } from "./mannequins.ts";
import { chunkOf, sweepChunks } from "./markers.ts";
import { sideTitle } from "./marks.ts";
import { MANNEQUIN_TURN, POINT_STEPS, mannequinScreenEntries, type MannequinList } from "./menu.ts";
import { actionBar, type ToolHost } from "./tool-host.ts";

/** On each body: its mannequin's name, and the look and place it was last given (JSON). */
const NAME_PROPERTY = "minecade:mannequin";
const SHOWN_PROPERTY = "minecade:shown";
/** Its behavior pack group: floats where it's put, and can't be hurt or pushed. */
const MANNEQUIN_EVENT = "minecade:mannequin";
/** On the world: the chunks mannequins were in, as JSON ["x,z", ...]. */
const CHUNKS_PROPERTY = "minecade:mannequinChunks";
const SYNC_TICKS = 20;

export interface MannequinHost extends ToolHost {
  /** Where a use aims: on top of a block, or the floor in front of its side; none at the sky. */
  aimedAt(player: Player): Vector3 | undefined;
}

/** The mannequins' bodies: one per mannequin in map.json, wherever its chunk is loaded. */
export class MannequinBodies {
  private readonly dimension: Dimension;
  private mannequins = new Map<string, MapMannequin>();
  private readonly chunks = new Set<string>();
  /** Cleared for a save, until resume(). */
  private paused = false;
  /** Out of a map preview's shot, until unhide(). */
  private hidden = false;

  constructor(dimension: Dimension, scope: Scope) {
    this.dimension = dimension;
    const saved = world.getDynamicProperty(CHUNKS_PROPERTY);
    if (typeof saved === "string") {
      try {
        for (const chunk of JSON.parse(saved) as string[]) this.chunks.add(chunk);
      } catch {
        // Unreadable: clear() still removes every body in the loaded chunks.
      }
    }
    scope.interval(() => this.sync(), SYNC_TICKS);
  }

  /** Whether bodies were placed and never cleared (by an earlier run whose save missed them, until clear()). */
  get remembered(): boolean {
    return this.chunks.size > 0;
  }

  /** Shows these mannequins, and only these. */
  show(mannequins: [string, MapMannequin][]): void {
    this.mannequins = new Map(mannequins);
    this.sync();
  }

  /** The mannequin a body is, if it's a current one's. */
  nameOf(entity: Entity): string | undefined {
    try {
      if (entity.typeId !== FAKE_PLAYER) return undefined;
      const name = entity.getDynamicProperty(NAME_PROPERTY);
      return typeof name === "string" && this.mannequins.has(name) ? name : undefined;
    } catch {
      return undefined; // gone
    }
  }

  /** Removes every body, loading each chunk one was ever in, and stops showing them. Resolves with how many are left (0 when it's safe to save). */
  async clear(): Promise<number> {
    this.paused = true;
    await sweepChunks(this.dimension, [...this.chunks], () => this.removeAll());
    const left = this.dimension.getEntities({ type: FAKE_PLAYER }).length;
    if (left === 0) {
      this.chunks.clear();
      world.setDynamicProperty(CHUNKS_PROPERTY, undefined);
    }
    return left;
  }

  /** Shows them again after clear(). */
  resume(): void {
    this.paused = false;
    this.sync();
  }

  /** Takes every loaded body away until unhide(), out of a map preview's shot. */
  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.removeAll();
  }

  unhide(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.sync();
  }

  private sync(): void {
    if (this.paused || this.hidden) return;
    const shown = new Set<string>();
    for (const entity of this.dimension.getEntities({ type: FAKE_PLAYER })) {
      const name = this.nameOf(entity);
      const mannequin = name === undefined ? undefined : this.mannequins.get(name);
      const before = entity.getDynamicProperty(SHOWN_PROPERTY);
      // Moved or turned: placed again below, so it's turned from the spawn.
      if (!name || !mannequin || shown.has(name) || typeof before !== "string" || !samePlace(JSON.parse(before) as MapMannequin, mannequin)) {
        entity.remove();
        continue;
      }
      shown.add(name);
      this.dress(entity, mannequin, JSON.parse(before) as MapMannequin);
    }
    for (const [name, mannequin] of this.mannequins) {
      const [x, y, z, yaw] = mannequin.at;
      const at = { x, y, z };
      if (shown.has(name) || !this.dimension.isChunkLoaded(at)) continue;
      try {
        const entity = this.dimension.spawnEntity(FAKE_PLAYER, at, { initialRotation: yaw });
        entity.triggerEvent(MANNEQUIN_EVENT);
        entity.nameTag = "";
        entity.setDynamicProperty(NAME_PROPERTY, name);
        this.dress(entity, mannequin);
        this.remember(at);
      } catch (error) {
        log.warn(`could not place ${name}: ${describeError(error)}`);
      }
    }
  }

  /** Puts its look on a body, the item in its hand only when that changed (or it's new). */
  private dress(entity: Entity, mannequin: MapMannequin, before?: MapMannequin): void {
    if (before && JSON.stringify(before) === JSON.stringify(mannequin)) return;
    const look = mannequinLook(mannequin);
    const holding = !before || before.hold !== mannequin.hold || (look.hold !== undefined && itemColorOf(mannequinLook(before)) !== itemColorOf(look));
    dressFake(entity, look, holding, itemColorOf(look), mannequinSkins());
    entity.setDynamicProperty(SHOWN_PROPERTY, JSON.stringify(mannequin));
  }

  private removeAll(): void {
    for (const entity of this.dimension.getEntities({ type: FAKE_PLAYER })) entity.remove();
  }

  private remember(at: Vector3): void {
    const chunk = chunkOf(at);
    if (this.chunks.has(chunk)) return;
    this.chunks.add(chunk);
    world.setDynamicProperty(CHUNKS_PROPERTY, JSON.stringify([...this.chunks]));
  }
}

export class MannequinTool {
  private readonly host: MannequinHost;
  /** The Step each player last picked in a mannequin's screen. */
  private readonly steps = new Map<string, number>();

  constructor(host: MannequinHost) {
    this.host = host;
  }

  /** A use: a new mannequin where the player aims, facing them, at once (Undo takes it back). */
  use(player: Player): void {
    const at = this.host.aimedAt(player);
    if (!at) {
      actionBar(player, "Aim at a block to place a mannequin");
      return;
    }
    const name = nextMannequinName(this.host.map());
    this.host.edit(player, { op: "mannequin", name, mannequin: mannequinAt(at, player.getRotation().y, NEW_MANNEQUIN_LOOK) }, `${name} placed: hit it to change it.`);
  }

  /** The action bar line while the tool is held. */
  hint(): string {
    return "Use: place a mannequin where you aim, facing you   Hit a mannequin: change it   Sneak and right click: next pose";
  }

  /** A sneaking right click: the mannequin's next pose, the first again after the last, at once. */
  nextPose(player: Player, name: string): void {
    const mannequin = mannequinsOf(this.host.map()).find(([other]) => other === name)?.[1];
    if (!mannequin) return;
    const look = mannequinLook(mannequin);
    const pose = nextPose(look.pose);
    this.host.edit(player, { op: "mannequin", name, mannequin: withLook(mannequin, { ...look, pose }) });
    actionBar(player, `${name}: ${FAKE_POSES[pose].label}`);
  }

  /**
   * A mannequin's screen (it was hit or right clicked, or picked in the map menu, which `back` opens
   * again): every tap changes it at once and opens the screen again, until it's closed or deleted.
   */
  async screen(player: Player, name: string, back?: () => Promise<void>): Promise<void> {
    const key = player.name.toLowerCase();
    let open: MannequinList | undefined;
    for (;;) {
      const mannequin = mannequinsOf(this.host.map()).find(([other]) => other === name)?.[1];
      if (!mannequin || !player.isValid) return;
      const step = this.steps.get(key) ?? POINT_STEPS[0];
      const look = mannequinLook(mannequin);
      const entries = mannequinScreenEntries({ look, items: this.host.rules.items ?? [], at: mannequin.at, step, ...(open ? { open } : {}), back: back !== undefined });
      const form = new ActionFormData().title(sideTitle(name));
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await this.host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      if (action.kind === "back") return back?.();
      if (action.kind === "delete") {
        this.host.edit(player, { op: "mannequin", name }, `${name} deleted.`);
        return;
      }
      if (action.kind === "open") open = open === action.which ? undefined : action.which;
      else if (action.kind === "skin" || action.kind === "color" || action.kind === "hold" || action.kind === "pose") open = undefined;
      let next: MapMannequin | undefined;
      if (action.kind === "skin") next = withLook(mannequin, { ...look, skin: action.skin });
      else if (action.kind === "color") next = withLook(mannequin, { ...look, color: action.color });
      else if (action.kind === "hold") next = withLook(mannequin, { ...look, hold: action.item });
      else if (action.kind === "pose") next = withLook(mannequin, { ...look, pose: action.pose });
      else if (action.kind === "move") next = nudgeMannequin(mannequin, { axis: action.axis, by: action.by * step });
      else if (action.kind === "turn") next = nudgeMannequin(mannequin, { turn: action.by * MANNEQUIN_TURN });
      else if (action.kind === "here") next = mannequinAt(player.location, player.getRotation().y + 180, look);
      else if (action.kind === "facing") next = facingMannequin(mannequin, player.getRotation().y);
      else if (action.kind === "step") this.steps.set(key, action.step);
      if (next && JSON.stringify(next) !== JSON.stringify(mannequin)) this.host.edit(player, { op: "mannequin", name, mannequin: next });
    }
  }
}

/** Whether a body still stands where its mannequin does, turned the same way. */
function samePlace(a: MapMannequin, b: MapMannequin): boolean {
  return a.at.every((value, i) => Math.abs(value - b.at[i]) < 0.001);
}

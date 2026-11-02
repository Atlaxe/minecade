// Fake players, for previews from the map editor: a player-shaped entity (minecade:fake_player,
// in the preview's own packs: editor/preview/) that joins the match like a player, by name ("Fake
// 1"). The game spawns, respawns and downs it like anyone else, and it can be hit, shot or knocked
// off. Only its body lives here: Minigame decides where it goes and when. A body walks (gravity,
// pushed around) or floats in place passing through everything (a spectator): the entity's
// "minecade:walk" and "minecade:float" events.
//
// While it's in play, its name tag shows its health as hearts, like the HUD's (a font page of heart
// glyphs in the preview's resource pack), under its name when names show.
//
// Entities can only be placed in chunks that are loaded and ticking, which only chunks near a player
// are (the servers' tick distance is 4 chunks). So a fake's body gets a one-chunk ticking area
// where it stands, made before it's placed there and dropped once it moves on or is removed.
import { EntityComponentTypes, world, type Dimension, type Entity, type Vector3 } from "@minecraft/server";
import { describeError, log } from "../log.ts";

export const FAKE_PLAYER = "minecade:fake_player";
const WALK_EVENT = "minecade:walk";
const FLOAT_EVENT = "minecade:float";

/** The hearts (editor/preview/resource_pack/font/glyph_E4.png, U+E400 on): full, half and empty. */
export const HEARTS = { full: "\uE400", half: "\uE401", empty: "\uE402" } as const;

/** Health as a row of hearts like the HUD's: one per 2 of `max`, a half one for an odd point, the rest empty. White, so the glyphs keep their colors. */
export function heartsText(health: number, max: number): string {
  const total = Math.max(1, Math.ceil(max / 2));
  const points = Math.max(0, Math.min(total * 2, Math.ceil(health)));
  const full = Math.floor(points / 2);
  const half = points % 2;
  return `§f${HEARTS.full.repeat(full)}${HEARTS.half.repeat(half)}${HEARTS.empty.repeat(total - full - half)}`;
}

export class FakePlayers {
  private readonly dimension: Dimension;
  /** By lowercase name, in the order they were added. */
  private readonly names = new Map<string, string>();
  private readonly bodies = new Map<string, Entity>();
  /** Lowercase names by their bodies' entity ids. */
  private readonly ids = new Map<string, string>();
  /** Each one's ticking area, by lowercase name. */
  private readonly areas = new Map<string, string>();
  /** Each one's name tag without its hearts, and whether its hearts show, by lowercase name. */
  private readonly tags = new Map<string, { tag: string; hearts: boolean }>();
  /** Each one's latest place() or hide(): an older place() that finishes late does nothing. */
  private readonly turns = new Map<string, number>();
  /** Being placed now (waiting for its chunk). */
  private readonly placing = new Set<string>();
  /** Already warned about, so a fake that can't be placed says so once. */
  private readonly warned = new Set<string>();
  private next = 1;
  private nextArea = 1;

  constructor(dimension: Dimension) {
    this.dimension = dimension;
  }

  /** Every fake player's name, in the order they were added. */
  get all(): string[] {
    return [...this.names.values()];
  }

  has(name: string): boolean {
    return this.names.has(name.toLowerCase());
  }

  /** A new fake player's name ("Fake 1", "Fake 2", ...): it has no body until place(). */
  add(): string {
    const name = `Fake ${this.next++}`;
    this.names.set(name.toLowerCase(), name);
    return name;
  }

  /** Its entity, while it's in the world. */
  body(name: string): Entity | undefined {
    const entity = this.bodies.get(name.toLowerCase());
    return entity?.isValid ? entity : undefined;
  }

  /** True while place() waits for its chunk. */
  isPlacing(name: string): boolean {
    return this.placing.has(name.toLowerCase());
  }

  /** The fake player an entity is, if it's one of these. */
  nameOf(entity: Entity): string | undefined {
    try {
      const key = this.ids.get(entity.id);
      return key === undefined ? undefined : this.names.get(key);
    } catch {
      return undefined; // gone
    }
  }

  /**
   * Puts it at `location` with full health, with a new body if it has none, once its chunk is
   * ticking, walking or `floating`, its health as hearts under `nameTag` when `hearts` (in play).
   * Resolves with the body, or undefined when it couldn't be placed or was hidden meanwhile.
   */
  async place(name: string, location: Vector3, nameTag: string, floating = false, hearts = false): Promise<Entity | undefined> {
    const key = name.toLowerCase();
    if (!this.names.has(key)) return undefined;
    const turn = this.turn(key);
    this.placing.add(key);
    let area: string | undefined;
    try {
      area = await this.keepTicking(location);
    } finally {
      if (this.turns.get(key) === turn) this.placing.delete(key);
    }
    if (this.turns.get(key) !== turn || !this.names.has(key)) {
      this.dropArea(area);
      return undefined;
    }
    try {
      let body = this.body(name);
      if (!body) {
        body = this.dimension.spawnEntity(FAKE_PLAYER, location);
        this.bodies.set(key, body);
        this.ids.set(body.id, key);
      } else {
        body.teleport(location);
      }
      body.triggerEvent(floating ? FLOAT_EVENT : WALK_EVENT);
      body.getComponent(EntityComponentTypes.Health)?.resetToMaxValue();
      this.tags.set(key, { tag: nameTag, hearts });
      body.nameTag = this.tagOf(key, body);
      body.clearVelocity();
      this.dropArea(this.areas.get(key));
      if (area) this.areas.set(key, area);
      else this.areas.delete(key);
      this.warned.delete(key);
      return body;
    } catch (error) {
      this.dropArea(area);
      if (!this.warned.has(key)) log.warn(`could not place ${name}: ${describeError(error)}`);
      this.warned.add(key);
      return undefined;
    }
  }

  /** Its name tag again, with its hearts as its health is now: after it's hurt. */
  showHealth(entity: Entity): void {
    try {
      const key = this.ids.get(entity.id);
      if (key !== undefined && entity.isValid) entity.nameTag = this.tagOf(key, entity);
    } catch {
      // gone
    }
  }

  /** Takes its body out of the world (it's down, or out): place() brings it back. */
  hide(name: string): void {
    const key = name.toLowerCase();
    this.turn(key);
    this.placing.delete(key);
    this.tags.delete(key);
    const body = this.bodies.get(key);
    this.bodies.delete(key);
    for (const [id, owner] of this.ids) if (owner === key) this.ids.delete(id);
    this.dropArea(this.areas.get(key));
    this.areas.delete(key);
    try {
      if (body?.isValid) body.remove();
    } catch {
      // gone already
    }
  }

  /** Removes every fake player, body and name. */
  clear(): void {
    for (const name of this.all) this.hide(name);
    this.names.clear();
  }

  /** Its name tag, with its hearts under it while they show. */
  private tagOf(key: string, body: Entity): string {
    const tag = this.tags.get(key);
    const health = tag?.hearts ? body.getComponent(EntityComponentTypes.Health) : undefined;
    if (!tag || !health) return tag?.tag ?? "";
    const hearts = heartsText(health.currentValue, health.effectiveMax);
    return tag.tag ? `${tag.tag}\n${hearts}` : hearts;
  }

  private turn(key: string): number {
    const turn = (this.turns.get(key) ?? 0) + 1;
    this.turns.set(key, turn);
    return turn;
  }

  /** A new ticking area over `location`'s chunk, loaded; undefined when there's no room for one (players' chunks still tick). */
  private async keepTicking(location: Vector3): Promise<string | undefined> {
    const manager = world.tickingAreaManager;
    const options = { dimension: this.dimension, from: location, to: location };
    const id = `minecade:fake${this.nextArea++}`;
    try {
      if (!manager.hasCapacity(options)) return undefined;
      await manager.createTickingArea(id, options);
      return id;
    } catch (error) {
      log.warn(`could not keep a fake player's chunk ticking: ${describeError(error)}`);
      this.dropArea(id);
      return undefined;
    }
  }

  private dropArea(id: string | undefined): void {
    if (id === undefined) return;
    try {
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
    } catch {
      // gone with the server
    }
  }
}

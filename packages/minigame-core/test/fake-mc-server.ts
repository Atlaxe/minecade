// Fake of @minecraft/server for unit tests, swapped in by vitest.config.ts. Time moves only when a
// test calls system.advanceTicks(); signals count their listeners so tests catch leaks. The world
// mimics what BDS 1.26.60 was measured to do (docs/spike-results.md): inside entityHurt
// before-events the reported health already has the hit taken off, cancel restores it, and a
// written damage is final. While a before-event runs, world changes throw, as in BDS.

export const ScriptEventSource = { Block: "Block", Entity: "Entity", NPCDialogue: "NPCDialogue", Server: "Server" } as const;
export type ScriptEventSource = (typeof ScriptEventSource)[keyof typeof ScriptEventSource];

export const GameMode = { Adventure: "Adventure", Creative: "Creative", Spectator: "Spectator", Survival: "Survival" } as const;
export type GameMode = (typeof GameMode)[keyof typeof GameMode];

export const EquipmentSlot = { Chest: "Chest", Feet: "Feet", Head: "Head", Legs: "Legs", Mainhand: "Mainhand", Offhand: "Offhand" } as const;
export const ItemLockMode = { inventory: "inventory", none: "none", slot: "slot" } as const;
export const DisplaySlotId = { BelowName: "BelowName", List: "List", Sidebar: "Sidebar" } as const;
export const ObjectiveSortOrder = { Ascending: 0, Descending: 1 } as const;

// A numeric enum, like the real one: Object.values() also yields the names.
export const InputPermissionCategory = {
  Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8,
  MoveForward: 9, MoveBackward: 10, MoveLeft: 11, MoveRight: 12,
  1: "Camera", 2: "Movement", 4: "LateralMovement", 5: "Sneak", 6: "Jump", 7: "Mount", 8: "Dismount",
  9: "MoveForward", 10: "MoveBackward", 11: "MoveLeft", 12: "MoveRight",
} as const;

export const EntityComponentTypes = {
  CursorInventory: "minecraft:cursor_inventory",
  Equippable: "minecraft:equippable",
  Health: "minecraft:health",
  Hunger: "minecraft:player.hunger",
  Inventory: "minecraft:inventory",
  Saturation: "minecraft:player.saturation",
} as const;
export const ItemComponentTypes = { Dyeable: "minecraft:dyeable" } as const;

// ---- Restricted execution (before-events) ------------------------------------------------

let restricted = false;

/** Throws like BDS when a world change is attempted inside a before-event. */
function writable(what: string): void {
  if (restricted) throw new ReferenceError(`Native function [${what}] does not have required privileges.`);
}

// ---- Signals -----------------------------------------------------------------------------

export interface FakeScriptEvent {
  id: string;
  message: string;
  sourceType: ScriptEventSource;
}

export class FakeSignal<E, O = undefined> {
  private readonly listeners = new Map<(event: E) => void, O | undefined>();
  private readonly before: boolean;

  constructor(before = false) {
    this.before = before;
  }

  subscribe(callback: (event: E) => void, options?: O): (event: E) => void {
    this.listeners.set(callback, options);
    return callback;
  }

  unsubscribe(callback: (event: E) => void): void {
    this.listeners.delete(callback);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Test helper: calls each listener whose subscribe options accept the event. */
  emit(event: E, accepts: (options: O | undefined) => boolean = () => true): void {
    for (const [callback, options] of [...this.listeners]) {
      if (!accepts(options)) continue;
      if (!this.before) {
        callback(event);
        continue;
      }
      restricted = true;
      try {
        callback(event);
      } finally {
        restricted = false;
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Entity filters as the real signals take them: entityTypes (after-events) or entityFilter.type (before). */
function acceptsEntity(entity: { typeId: string }) {
  return (options: unknown) => {
    const filter = options as { entityTypes?: string[]; entityFilter?: { type?: string } } | undefined;
    if (filter?.entityTypes && !filter.entityTypes.includes(entity.typeId)) return false;
    if (filter?.entityFilter?.type && filter.entityFilter.type !== entity.typeId) return false;
    return true;
  };
}

// ---- system ------------------------------------------------------------------------------

interface ScheduledRun {
  at: number;
  callback: () => void;
  every?: number;
}

class FakeSystem {
  currentTick = 0;
  readonly afterEvents = {
    scriptEventReceive: new FakeSignal<FakeScriptEvent, { namespaces?: string[] }>(),
  };
  private nextRunId = 1;
  private readonly runs = new Map<number, ScheduledRun>();

  run(callback: () => void): number {
    return this.runTimeout(callback, 1);
  }

  runTimeout(callback: () => void, tickDelay = 1): number {
    return this.schedule({ at: this.currentTick + tickDelay, callback });
  }

  runInterval(callback: () => void, tickInterval = 1): number {
    return this.schedule({ at: this.currentTick + tickInterval, callback, every: tickInterval });
  }

  clearRun(runId: number): void {
    this.runs.delete(runId);
  }

  waitTicks(ticks: number): Promise<void> {
    return new Promise((resolve) => this.runTimeout(resolve, ticks));
  }

  /** Test helper: moves time forward one tick at a time, running whatever falls due. */
  advanceTicks(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      this.currentTick++;
      for (const [id, run] of [...this.runs]) {
        if (run.at > this.currentTick || !this.runs.has(id)) continue;
        if (run.every) run.at += run.every;
        else this.runs.delete(id);
        run.callback();
      }
    }
  }

  /** Test helper: delivers a script event, filtered by namespace as BDS does. */
  emitScriptEvent(id: string, message: string, sourceType: ScriptEventSource = ScriptEventSource.Server): void {
    const namespace = id.split(":")[0];
    this.afterEvents.scriptEventReceive.emit(
      { id, message, sourceType },
      (options) => !options?.namespaces || options.namespaces.includes(namespace),
    );
  }

  get pendingRuns(): number {
    return this.runs.size;
  }

  reset(): void {
    this.currentTick = 0;
    this.runs.clear();
    this.afterEvents.scriptEventReceive.clear();
  }

  private schedule(run: ScheduledRun): number {
    const id = this.nextRunId++;
    this.runs.set(id, run);
    return id;
  }
}

export const system = new FakeSystem();

// ---- Items -------------------------------------------------------------------------------

export class ItemStack {
  readonly typeId: string;
  amount: number;
  nameTag?: string;
  lockMode: string = ItemLockMode.none;
  keepOnDeath = false;
  private readonly dyeable: { color?: { red: number; green: number; blue: number } } | undefined;

  constructor(typeId: string, amount = 1) {
    this.typeId = typeId.includes(":") ? typeId : `minecraft:${typeId}`;
    this.amount = amount;
    this.dyeable = this.typeId.startsWith("minecraft:leather_") ? {} : undefined;
  }

  getComponent(id: string) {
    return id === ItemComponentTypes.Dyeable ? this.dyeable : undefined;
  }
}

class FakeContainer {
  readonly slots: (ItemStack | undefined)[] = Array(36).fill(undefined);

  setItem(slot: number, item?: ItemStack): void {
    writable("Container::setItem");
    this.slots[slot] = item;
  }

  getItem(slot: number): ItemStack | undefined {
    return this.slots[slot];
  }

  addItem(item: ItemStack): ItemStack | undefined {
    writable("Container::addItem");
    const free = this.slots.findIndex((slot) => slot === undefined);
    if (free === -1) return item;
    this.slots[free] = item;
    return undefined;
  }

  clearAll(): void {
    writable("Container::clearAll");
    this.slots.fill(undefined);
  }

  items(): ItemStack[] {
    return this.slots.filter((slot): slot is ItemStack => slot !== undefined);
  }
}

// ---- Players -----------------------------------------------------------------------------

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

let nextEntityId = 1;

export class FakePlayer {
  readonly typeId = "minecraft:player";
  readonly id: string;
  readonly name: string;
  isValid = true;
  nameTag: string;
  location: Vector3 = { x: 0, y: 65, z: 0 };
  viewDirection: Vector3 = { x: 0, y: 0, z: 1 };
  isSprinting = false;
  selectedSlotIndex = 0;
  readonly teleports: Vector3[] = [];
  /** The facing of each teleport, in order: a rotation (x pitch, y yaw), a point to face, or none. */
  readonly teleportFacings: ({ rotation: { x: number; y: number } } | { facingLocation: Vector3 } | undefined)[] = [];
  /** Every applyKnockback call, in order. */
  readonly knockbacks: { x: number; z: number; vertical: number }[] = [];
  /** Every sound played to this player, in order. */
  readonly sounds: { id: string; pitch?: number; volume?: number }[] = [];
  readonly messages: string[] = [];
  readonly titles: string[] = [];
  actionBar = "";
  gameMode: string = GameMode.Adventure;
  onFire = false;
  level = 0;
  readonly effects = new Map<string, { amplifier: number; duration: number }>();
  readonly inventory = new FakeContainer();
  readonly equipment = new Map<string, ItemStack | undefined>();
  readonly cursorCleared = { count: 0 };
  private readonly permissions = new Map<number, boolean>();
  readonly health = makeAttribute(20, "health");
  readonly hunger = makeAttribute(20, "hunger");
  readonly saturation = makeAttribute(20, "saturation");

  constructor(name: string) {
    this.id = String(nextEntityId++);
    this.name = name;
    this.nameTag = name;
  }

  readonly inputPermissions = {
    setPermissionCategory: (category: number, enabled: boolean) => {
      writable("PlayerInputPermissions::setPermissionCategory");
      this.permissions.set(category, enabled);
    },
    isPermissionCategoryEnabled: (category: number) => this.permissions.get(category) ?? true,
  };

  readonly onScreenDisplay = {
    setTitle: (title: string, options?: { subtitle?: string }) => {
      writable("ScreenDisplay::setTitle");
      this.titles.push(options?.subtitle ? `${title} | ${options.subtitle}` : title);
    },
    setActionBar: (text: string) => {
      writable("ScreenDisplay::setActionBar");
      this.actionBar = text;
    },
    resetHudElementsVisibility: () => writable("ScreenDisplay::resetHudElementsVisibility"),
  };

  /** True when every input category is allowed: nothing left locked. */
  get unlocked(): boolean {
    return [...this.permissions.values()].every(Boolean);
  }

  getComponent(id: string): unknown {
    switch (id) {
      case EntityComponentTypes.Health:
        return this.health;
      case EntityComponentTypes.Hunger:
        return this.hunger;
      case EntityComponentTypes.Saturation:
        return this.saturation;
      case EntityComponentTypes.Inventory:
        return { container: this.inventory };
      case EntityComponentTypes.Equippable:
        return {
          setEquipment: (slot: string, item?: ItemStack) => {
            writable("EntityEquippableComponent::setEquipment");
            this.equipment.set(slot, item);
            return true;
          },
          getEquipment: (slot: string) => this.equipment.get(slot),
        };
      case EntityComponentTypes.CursorInventory:
        return { clear: () => this.cursorCleared.count++ };
      default:
        return undefined;
    }
  }

  teleport(location: Vector3, options: { rotation?: { x: number; y: number }; facingLocation?: Vector3 } = {}): void {
    writable("Entity::teleport");
    this.location = { ...location };
    this.teleports.push({ ...location });
    if (options.rotation) this.teleportFacings.push({ rotation: { ...options.rotation } });
    else if (options.facingLocation) this.teleportFacings.push({ facingLocation: { ...options.facingLocation } });
    else this.teleportFacings.push(undefined);
  }

  playSound(id: string, options: { pitch?: number; volume?: number } = {}): void {
    writable("Player::playSound");
    this.sounds.push({ id, ...options });
  }

  getViewDirection(): Vector3 {
    return { ...this.viewDirection };
  }

  applyKnockback(horizontalForce: { x: number; z: number }, verticalStrength: number): void {
    writable("Entity::applyKnockback");
    this.knockbacks.push({ x: horizontalForce.x, z: horizontalForce.z, vertical: verticalStrength });
  }

  setGameMode(mode?: string): void {
    writable("Player::setGameMode");
    this.gameMode = mode ?? GameMode.Survival;
  }

  getGameMode(): string {
    return this.gameMode;
  }

  sendMessage(text: string): void {
    this.messages.push(text);
  }

  getEffects() {
    return [...this.effects.keys()].map((typeId) => ({ typeId }));
  }

  getEffect(typeId: string) {
    return this.effects.get(typeId);
  }

  addEffect(typeId: string, duration: number, options?: { amplifier?: number }) {
    writable("Entity::addEffect");
    this.effects.set(typeId, { amplifier: options?.amplifier ?? 0, duration });
    return undefined;
  }

  removeEffect(typeId: string): boolean {
    writable("Entity::removeEffect");
    return this.effects.delete(typeId);
  }

  extinguishFire(): boolean {
    writable("Entity::extinguishFire");
    const was = this.onFire;
    this.onFire = false;
    return was;
  }

  resetLevel(): void {
    writable("Player::resetLevel");
    this.level = 0;
  }

  applyDamage(amount: number): boolean {
    writable("Entity::applyDamage");
    world.hurt(this, amount, "entityAttack");
    return true;
  }

  remove(): void {
    this.isValid = false;
  }
}

function makeAttribute(max: number, what: string) {
  return {
    currentValue: max,
    effectiveMax: max,
    resetToMaxValue() {
      writable(`${what}::resetToMaxValue`);
      this.currentValue = max;
    },
    setCurrentValue(value: number) {
      writable(`${what}::setCurrentValue`);
      this.currentValue = value;
      return true;
    },
  };
}

// ---- Scoreboard --------------------------------------------------------------------------

export class FakeObjective {
  readonly id: string;
  readonly displayName: string;
  readonly scores = new Map<string, number>();
  isValid = true;

  constructor(id: string, displayName: string) {
    this.id = id;
    this.displayName = displayName;
  }

  setScore(participant: string, score: number): void {
    writable("ScoreboardObjective::setScore");
    this.scores.set(participant, score);
  }

  removeParticipant(participant: string): boolean {
    writable("ScoreboardObjective::removeParticipant");
    return this.scores.delete(participant);
  }
}

class FakeScoreboard {
  readonly objectives = new Map<string, FakeObjective>();
  sidebar: FakeObjective | undefined;

  addObjective(id: string, displayName = id): FakeObjective {
    writable("Scoreboard::addObjective");
    if (this.objectives.has(id)) throw new Error(`Objective ${id} already exists`);
    const objective = new FakeObjective(id, displayName);
    this.objectives.set(id, objective);
    return objective;
  }

  getObjective(id: string): FakeObjective | undefined {
    return this.objectives.get(id);
  }

  getObjectives(): FakeObjective[] {
    return [...this.objectives.values()];
  }

  removeObjective(objective: FakeObjective | string): boolean {
    writable("Scoreboard::removeObjective");
    const id = typeof objective === "string" ? objective : objective.id;
    const existing = this.objectives.get(id);
    if (existing) existing.isValid = false;
    if (this.sidebar?.id === id) this.sidebar = undefined;
    return this.objectives.delete(id);
  }

  setObjectiveAtDisplaySlot(_slot: string, options: { objective: FakeObjective }): void {
    writable("Scoreboard::setObjectiveAtDisplaySlot");
    this.sidebar = options.objective;
  }

  clearObjectiveAtDisplaySlot(): FakeObjective | undefined {
    writable("Scoreboard::clearObjectiveAtDisplaySlot");
    const was = this.sidebar;
    this.sidebar = undefined;
    return was;
  }
}

// ---- world -------------------------------------------------------------------------------

interface DamageSource {
  cause: string;
  damagingEntity?: FakePlayer | { typeId: string; id: string };
  damagingProjectile?: { typeId: string };
}

interface HurtBeforeEvent {
  hurtEntity: FakePlayer;
  damage: number;
  damageSource: DamageSource;
  cancel: boolean;
}

class FakeWorld {
  readonly afterEvents = {
    worldLoad: new FakeSignal<Record<string, never>>(),
    playerJoin: new FakeSignal<{ playerId: string; playerName: string }>(),
    playerSpawn: new FakeSignal<{ player: FakePlayer; initialSpawn: boolean }>(),
    playerLeave: new FakeSignal<{ playerId: string; playerName: string }>(),
    entityHurt: new FakeSignal<{ hurtEntity: FakePlayer; damage: number; damageSource: DamageSource }, unknown>(),
    entityDie: new FakeSignal<{ deadEntity: FakePlayer; damageSource: DamageSource }, unknown>(),
    entityHitEntity: new FakeSignal<{ damagingEntity: FakePlayer; hitEntity: FakePlayer }, unknown>(),
    itemUse: new FakeSignal<{ source: FakePlayer; itemStack: ItemStack }>(),
    playerInteractWithBlock: new FakeSignal<{ player: FakePlayer; itemStack?: ItemStack; isFirstEvent: boolean }>(),
  };
  readonly beforeEvents = {
    entityHurt: new FakeSignal<HurtBeforeEvent, unknown>(true),
    playerLeave: new FakeSignal<{ player: FakePlayer }>(true),
  };
  readonly gameRules: Record<string, boolean | number> = {};
  readonly scoreboard = new FakeScoreboard();
  readonly chat: string[] = [];
  private players: FakePlayer[] = [];

  getAllPlayers(): FakePlayer[] {
    return [...this.players];
  }

  getPlayers(options?: { name?: string }): FakePlayer[] {
    return this.players.filter((player) => !options?.name || player.name === options.name);
  }

  sendMessage(text: string): void {
    this.chat.push(text);
  }

  // ---- Test helpers ----

  /** A player connects and spawns for the first time. */
  join(name: string): FakePlayer {
    const player = new FakePlayer(name);
    this.players.push(player);
    this.afterEvents.playerJoin.emit({ playerId: player.id, playerName: name });
    this.afterEvents.playerSpawn.emit({ player, initialSpawn: true });
    return player;
  }

  leave(name: string): void {
    const player = this.players.find((candidate) => candidate.name === name);
    if (!player) return;
    this.beforeEvents.playerLeave.emit({ player });
    this.players = this.players.filter((candidate) => candidate !== player);
    player.isValid = false;
    this.afterEvents.playerLeave.emit({ playerId: player.id, playerName: name });
  }

  /** Leaves and joins again: a new Player object with the same name. */
  rejoin(name: string): FakePlayer {
    this.leave(name);
    return this.join(name);
  }

  /** Damages a player the way BDS does (see the file header). */
  /** `cooldown`: the victim is in their 10-tick hit cooldown, so BDS fires the before-event and then drops the hit. */
  hurt(victim: FakePlayer, damage: number, cause: string, from?: { attacker?: FakePlayer; projectile?: string; cooldown?: boolean }): void {
    const damageSource: DamageSource = {
      cause,
      damagingEntity: from?.attacker ?? (from?.projectile ? { typeId: from.projectile, id: "projectile" } : undefined),
      damagingProjectile: from?.projectile ? { typeId: from.projectile } : undefined,
    };
    const before = victim.health.currentValue;
    victim.health.currentValue = before - damage; // BDS reports the health with the hit already taken
    const event: HurtBeforeEvent = { hurtEntity: victim, damage, damageSource, cancel: false };
    this.beforeEvents.entityHurt.emit(event, acceptsEntity(victim));
    if (event.cancel || from?.cooldown) {
      victim.health.currentValue = before;
      return;
    }
    victim.health.currentValue = Math.max(0, before - event.damage);
    this.afterEvents.entityHurt.emit({ hurtEntity: victim, damage: event.damage, damageSource }, acceptsEntity(victim));
    if (victim.health.currentValue <= 0) this.die(victim, damageSource);
  }

  /** A melee hit: the swing (entityHitEntity, even when the damage is canceled), then its damage. */
  melee(attacker: FakePlayer, victim: FakePlayer, damage = 1, cooldown = false): void {
    this.hurt(victim, damage, "entityAttack", { attacker, cooldown });
    this.afterEvents.entityHitEntity.emit({ damagingEntity: attacker, hitEntity: victim }, acceptsEntity(attacker));
  }

  /** /kill: lethal, cause selfDestruct. */
  kill(victim: FakePlayer): void {
    this.hurt(victim, victim.health.currentValue, "selfDestruct");
  }

  private die(victim: FakePlayer, damageSource: DamageSource): void {
    this.afterEvents.entityDie.emit({ deadEntity: victim, damageSource }, acceptsEntity(victim));
    if (this.gameRules.doImmediateRespawn) {
      victim.health.currentValue = 20;
      this.afterEvents.playerSpawn.emit({ player: victim, initialSpawn: false });
    }
  }

  /** Every listener on every signal, for leak checks. */
  listenerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [name, signal] of Object.entries(this.afterEvents)) counts[`after.${name}`] = signal.listenerCount;
    for (const [name, signal] of Object.entries(this.beforeEvents)) counts[`before.${name}`] = signal.listenerCount;
    counts["system.scriptEventReceive"] = system.afterEvents.scriptEventReceive.listenerCount;
    return counts;
  }

  reset(): void {
    this.players = [];
    for (const signal of [...Object.values(this.afterEvents), ...Object.values(this.beforeEvents)]) signal.clear();
    for (const key of Object.keys(this.gameRules)) delete this.gameRules[key];
    this.scoreboard.objectives.clear();
    this.scoreboard.sidebar = undefined;
    this.chat.length = 0;
  }
}

export const world = new FakeWorld();

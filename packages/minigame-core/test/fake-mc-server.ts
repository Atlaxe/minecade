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
  Movement: "minecraft:movement",
  Projectile: "minecraft:projectile",
  Saturation: "minecraft:player.saturation",
} as const;
export const ItemComponentTypes = { Cooldown: "minecraft:cooldown", Dyeable: "minecraft:dyeable", Enchantable: "minecraft:enchantable" } as const;
export const Direction = { Down: "Down", East: "East", North: "North", South: "South", Up: "Up", West: "West" } as const;
export const EntitySwingSource = {
  Attack: "Attack", Build: "Build", DropItem: "DropItem", Event: "Event", Interact: "Interact",
  Mine: "Mine", None: "None", ThrowItem: "ThrowItem", UseItem: "UseItem",
} as const;
export const EntityInitializationCause = { Born: "Born", Event: "Event", Loaded: "Loaded", Spawned: "Spawned", Transformed: "Transformed" } as const;
export const StructureSaveMode = { Memory: "Memory", World: "World" } as const;
export const LiquidType = { Water: "Water" } as const;
export const InputButton = { Jump: "Jump", Sneak: "Sneak" } as const;
export const ButtonState = { Pressed: "Pressed", Released: "Released" } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Blocks flowing water washes away here: plants, torches, rails and the like. */
const WASHED_AWAY = /(^|_)(grass|fern|flower|poppy|dandelion|tulip|torch|rail|sapling|vine|vines|bush|roots|button|carpet|redstone_wire)$/;

/** Block types: anything that reads as a block id (wool, concrete, stone, planks, glass). */
export const BlockTypes = {
  get(typeId: string): { id: string } | undefined {
    return /(_wool|_concrete|stone|_planks|glass)$/.test(typeId) ? { id: typeId } : undefined;
  },
};

/** A block's states, by name. */
export type BlockStates = Record<string, string | number | boolean>;

/** A block type with its states, as the real BlockPermutation (resolve, getState, getAllStates, withState). */
export class BlockPermutation {
  readonly type: { id: string };
  private readonly states: BlockStates;

  private constructor(typeId: string, states: BlockStates) {
    this.type = { id: typeId };
    this.states = { ...states };
  }

  static resolve(typeId: string, states: BlockStates = {}): BlockPermutation {
    return new BlockPermutation(typeId.includes(":") ? typeId : `minecraft:${typeId}`, states);
  }

  getState(name: string): string | number | boolean | undefined {
    return this.states[name];
  }

  getAllStates(): BlockStates {
    return { ...this.states };
  }

  withState(name: string, value: string | number | boolean): BlockPermutation {
    return new BlockPermutation(this.type.id, { ...this.states, [name]: value });
  }

  matches(typeId: string, states: BlockStates = {}): boolean {
    return typeId === this.type.id && Object.entries(states).every(([name, value]) => this.states[name] === value);
  }

  /** Whether flowing water breaks it (WASHED_AWAY's names). */
  canBeDestroyedByLiquidSpread(_liquid: string): boolean {
    return WASHED_AWAY.test(this.type.id.replace(/^minecraft:/, ""));
  }
}

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

  /** Script events a script sent (sendScriptEvent), oldest first; delivered too, as BDS does. */
  readonly scriptEventsSent: { id: string; message: string }[] = [];

  sendScriptEvent(id: string, message: string): void {
    this.scriptEventsSent.push({ id, message });
    this.emitScriptEvent(id, message);
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
    this.scriptEventsSent.length = 0;
  }

  private schedule(run: ScheduledRun): number {
    const id = this.nextRunId++;
    this.runs.set(id, run);
    return id;
  }
}

export const system = new FakeSystem();

// ---- Items -------------------------------------------------------------------------------

export class EnchantmentType {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}

export class ItemStack {
  readonly typeId: string;
  amount: number;
  nameTag?: string;
  lockMode: string = ItemLockMode.none;
  keepOnDeath = false;
  /** Its enchantments, as "<id> <level>" ("minecraft:loyalty 3"). */
  readonly enchantments: string[] = [];
  private readonly dyeable: { color?: { red: number; green: number; blue: number } } | undefined;
  /** How many times a script started this item's cooldown (only items outside minecraft: have one here). */
  cooldownsStarted = 0;
  private readonly cooldown = {
    startCooldown: (player?: FakePlayer) => {
      writable("ItemCooldownComponent::startCooldown");
      this.cooldownsStarted++;
      player?.cooldownsStarted.push(this.typeId);
    },
  };
  private readonly enchantable = {
    addEnchantment: ({ type, level }: { type: EnchantmentType; level: number }) => {
      this.enchantments.push(`${type.id} ${level}`);
    },
  };

  constructor(typeId: string, amount = 1) {
    this.typeId = typeId.includes(":") ? typeId : `minecraft:${typeId}`;
    this.amount = amount;
    this.dyeable = this.typeId.startsWith("minecraft:leather_") ? {} : undefined;
  }

  getComponent(id: string) {
    if (id === ItemComponentTypes.Enchantable) return this.enchantable;
    if (id === ItemComponentTypes.Cooldown) return this.typeId.startsWith("minecraft:") ? undefined : this.cooldown;
    return id === ItemComponentTypes.Dyeable ? this.dyeable : undefined;
  }
}

class FakeContainer {
  readonly slots: (ItemStack | undefined)[] = Array(36).fill(undefined);

  get size(): number {
    return this.slots.length;
  }

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
  isSneaking = false;
  isInWater = false;
  selectedSlotIndex = 0;
  isOnGround = true;
  /** Its velocity, as getVelocity reports it (still unless a test sets it). */
  velocity: Vector3 = { x: 0, y: 0, z: 0 };
  /** The movement keys or stick: x left and right, y forward (1) and back (-1). */
  movementVector = { x: 0, y: 0 };
  readonly inputInfo = { getMovementVector: () => ({ ...this.movementVector }) };
  /** The item ids whose cooldowns a script started for this player through an item, oldest first. */
  readonly cooldownsStarted: string[] = [];
  /** The cooldowns a script started for this player by category (startItemCooldown), oldest first. */
  readonly itemCooldowns: { category: string; ticks: number }[] = [];
  private readonly cooldownEnds = new Map<string, number>();

  startItemCooldown(category: string, ticks: number): void {
    writable("Player::startItemCooldown");
    this.itemCooldowns.push({ category, ticks });
    this.cooldownEnds.set(category, system.currentTick + ticks);
  }

  /** Ticks left on a category's cooldown. */
  getItemCooldown(category: string): number {
    return Math.max(0, (this.cooldownEnds.get(category) ?? 0) - system.currentTick);
  }
  /**
   * Its camera: each setFov's field of view, oldest first (undefined puts the player's own back),
   * each fade's options, and the camera set now (setCamera; clear puts the player's own back).
   */
  readonly camera = {
    fovs: [] as (number | undefined)[],
    fades: [] as { fadeColor?: { red: number; green: number; blue: number }; fadeTime?: { fadeInTime: number; holdTime: number; fadeOutTime: number } }[],
    view: undefined as { preset: string; location?: Vector3; rotation?: { x: number; y: number } } | undefined,
    setCamera: (preset: string, options: { location?: Vector3; rotation?: { x: number; y: number } } = {}) => {
      writable("Camera::setCamera");
      this.camera.view = { preset, ...options };
    },
    clear: () => {
      writable("Camera::clear");
      this.camera.view = undefined;
    },
    setFov: (options: { fov?: number; easeOptions?: { easeTime?: number } } = {}) => {
      writable("Camera::setFov");
      this.camera.fovs.push(options.fov);
    },
    fade: (options: { fadeColor?: { red: number; green: number; blue: number }; fadeTime?: { fadeInTime: number; holdTime: number; fadeOutTime: number } } = {}) => {
      writable("Camera::fade");
      this.camera.fades.push(options);
    },
  };
  /** Its walking speed (the movement attribute, 0.1 for a player). */
  readonly movement = {
    currentValue: 0.1,
    defaultValue: 0.1,
    setCurrentValue(value: number) {
      writable("movement::setCurrentValue");
      this.currentValue = value;
      return true;
    },
    resetToDefaultValue() {
      writable("movement::resetToDefaultValue");
      this.currentValue = this.defaultValue;
    },
  };
  readonly teleports: Vector3[] = [];
  /** The commands a script ran as this player (runCommand), oldest first. */
  readonly commands: string[] = [];
  /** Its facing: x pitch, y yaw (set by a teleport with a rotation). */
  rotation = { x: 0, y: 0 };
  /** The facing of each teleport, in order: a rotation (x pitch, y yaw), a point to face, or none. */
  readonly teleportFacings: ({ rotation: { x: number; y: number } } | { facingLocation: Vector3 } | undefined)[] = [];
  /** Every applyKnockback call, in order. */
  readonly knockbacks: { x: number; z: number; vertical: number }[] = [];
  /** Every sound played to this player, in order. */
  readonly sounds: { id: string; pitch?: number; volume?: number }[] = [];
  /** The level after each addLevels that raised it: Minecraft chimes when one ends on a multiple of 5. */
  readonly levelsGained: number[] = [];
  readonly messages: string[] = [];
  readonly titles: string[] = [];
  actionBar = "";
  gameMode: string = GameMode.Adventure;
  onFire = false;
  level = 0;
  /** Experience points toward the next level (addExperience); resetLevel clears them too. */
  xp = 0;
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
      case EntityComponentTypes.Movement:
        return this.movement;
      default:
        return undefined;
    }
  }

  runCommand(command: string): { successCount: number } {
    writable("Entity::runCommand");
    this.commands.push(command);
    return { successCount: 1 };
  }

  teleport(location: Vector3, options: { rotation?: { x: number; y: number }; facingLocation?: Vector3 } = {}): void {
    writable("Entity::teleport");
    this.location = { ...location };
    this.teleports.push({ ...location });
    if (options.rotation) this.rotation = { ...options.rotation };
    if (options.rotation) this.teleportFacings.push({ rotation: { ...options.rotation } });
    else if (options.facingLocation) this.teleportFacings.push({ facingLocation: { ...options.facingLocation } });
    else this.teleportFacings.push(undefined);
  }

  getRotation(): { x: number; y: number } {
    return { ...this.rotation };
  }

  playSound(id: string, options: { pitch?: number; volume?: number } = {}): void {
    writable("Player::playSound");
    this.sounds.push({ id, ...options });
  }

  getViewDirection(): Vector3 {
    return { ...this.viewDirection };
  }

  getVelocity(): Vector3 {
    return { ...this.velocity };
  }

  /** Particles sent to this player alone (spawnParticle), oldest first. */
  readonly particles: { id: string; location: Vector3 }[] = [];

  spawnParticle(id: string, location: Vector3): void {
    writable("Player::spawnParticle");
    this.particles.push({ id, location: { ...location } });
  }

  /** Eye height over the feet, as a standing player's. */
  getHeadLocation(): Vector3 {
    return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
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
    this.xp = 0;
  }

  addLevels(amount: number): number {
    writable("Player::addLevels");
    this.level += amount;
    if (amount > 0) this.levelsGained.push(this.level);
    return this.level;
  }

  /** Points toward the next level (none past it here: a test sets less than a level's worth). */
  addExperience(amount: number): number {
    writable("Player::addExperience");
    this.xp += amount;
    return this.xp;
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

/** An entity that isn't a player, such as a stuck arrow. */
export class FakeEntity {
  readonly typeId: string;
  readonly id: string;
  isValid = true;
  location: Vector3;

  constructor(typeId: string, location: Vector3 = { x: 0, y: 65, z: 0 }) {
    this.typeId = typeId;
    this.id = String(nextEntityId++);
    this.location = { ...location };
  }

  remove(): void {
    writable("Entity::remove");
    this.isValid = false;
  }
}

/** A mob spawned with dimension.spawnEntity (a preview's fake player): health, a name tag, a place. */
export class FakeMob {
  readonly typeId: string;
  readonly id: string;
  isValid = true;
  nameTag = "";
  location: Vector3;
  readonly teleports: Vector3[] = [];
  readonly knockbacks: { x: number; z: number; vertical: number }[] = [];
  readonly health = makeAttribute(20, "health");
  readonly properties = new Map<string, number | boolean | string>();
  /** Every event triggered on it, oldest first ("minecade:float", ...). */
  readonly events: string[] = [];
  readonly effects = new Set<string>();
  /** Every command it ran, oldest first. */
  readonly commands: string[] = [];
  rotation = { x: 0, y: 0 };
  isInWater = false;
  readonly tags = new Set<string>();
  /** As a projectile (an arrow): who shot it, and the velocity it was shot at. */
  readonly projectile: { owner?: unknown; shot?: Vector3; shoot(velocity: Vector3): void } = {
    shoot: (velocity: Vector3) => {
      writable("EntityProjectileComponent::shoot");
      this.projectile.shot = { ...velocity };
    },
  };

  constructor(typeId: string, location: Vector3) {
    this.typeId = typeId;
    this.id = String(nextEntityId++);
    this.location = { ...location };
  }

  addTag(tag: string): boolean {
    writable("Entity::addTag");
    const added = !this.tags.has(tag);
    this.tags.add(tag);
    return added;
  }

  getTags(): string[] {
    return [...this.tags];
  }

  hasTag(tag: string): boolean {
    return this.tags.has(tag);
  }

  getComponent(id: string): unknown {
    if (id === EntityComponentTypes.Projectile) return this.projectile;
    return id === EntityComponentTypes.Health ? this.health : undefined;
  }

  /** As a projectile, the velocity it was shot at (it doesn't fly here); else still. */
  getVelocity(): Vector3 {
    return { ...(this.projectile.shot ?? { x: 0, y: 0, z: 0 }) };
  }

  setProperty(id: string, value: number | boolean | string): void {
    writable("Entity::setProperty");
    this.properties.set(id, value);
  }

  getProperty(id: string): number | boolean | string | undefined {
    return this.properties.get(id);
  }

  getRotation(): { x: number; y: number } {
    return { ...this.rotation };
  }

  runCommand(command: string): { successCount: number } {
    writable("Entity::runCommand");
    this.commands.push(command);
    return { successCount: 1 };
  }

  getEffect(typeId: string): { typeId: string } | undefined {
    return this.effects.has(typeId) ? { typeId } : undefined;
  }

  addEffect(typeId: string): void {
    writable("Entity::addEffect");
    this.effects.add(typeId);
  }

  removeEffect(typeId: string): boolean {
    writable("Entity::removeEffect");
    return this.effects.delete(typeId);
  }

  triggerEvent(eventName: string): void {
    writable("Entity::triggerEvent");
    this.events.push(eventName);
  }

  teleport(location: Vector3, options: { rotation?: { x: number; y: number } } = {}): void {
    writable("Entity::teleport");
    this.location = { ...location };
    this.teleports.push({ ...location });
    if (options.rotation) this.rotation = { ...options.rotation };
  }

  clearVelocity(): void {
    writable("Entity::clearVelocity");
  }

  applyKnockback(horizontalForce: { x: number; z: number }, verticalStrength: number): void {
    writable("Entity::applyKnockback");
    this.knockbacks.push({ x: horizontalForce.x, z: horizontalForce.z, vertical: verticalStrength });
  }

  remove(): void {
    writable("Entity::remove");
    this.isValid = false;
  }
}

/** A block in the fake world: its place, type and states. */
export class FakeBlock {
  readonly location: Vector3;
  private readonly blocks: Map<string, string>;
  private readonly states: Map<string, BlockStates>;

  constructor(location: Vector3, blocks: Map<string, string>, states: Map<string, BlockStates>) {
    this.location = { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) };
    this.blocks = blocks;
    this.states = states;
  }

  get typeId(): string {
    return this.blocks.get(blockKey(this.location)) ?? "minecraft:air";
  }

  get isAir(): boolean {
    return this.typeId === "minecraft:air";
  }

  get isLiquid(): boolean {
    return /(^|:)(flowing_)?(water|lava)$/.test(this.typeId);
  }

  get permutation(): BlockPermutation {
    return BlockPermutation.resolve(this.typeId, this.states.get(blockKey(this.location)) ?? {});
  }

  setType(typeId: string): void {
    writable("Block::setType");
    this.states.delete(blockKey(this.location));
    if (typeId === "minecraft:air") this.blocks.delete(blockKey(this.location));
    else this.blocks.set(blockKey(this.location), typeId);
  }

  setPermutation(permutation: BlockPermutation): void {
    this.setType(permutation.type.id);
    const states = permutation.getAllStates();
    if (Object.keys(states).length > 0 && !this.isAir) this.states.set(blockKey(this.location), states);
  }

  getItemStack(amount = 1): ItemStack | undefined {
    return this.typeId === "minecraft:air" ? undefined : new ItemStack(this.typeId, amount);
  }
}

function within(at: Vector3, from: Vector3, to: Vector3): boolean {
  const inRange = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b);
  return inRange(at.x, from.x, to.x) && inRange(at.y, from.y, to.y) && inRange(at.z, from.z, to.z);
}

/** Structures saved in memory: each a copy of the blocks in its box, relative to its low corner. */
class FakeStructures {
  readonly saved = new Map<string, { size: Vector3; blocks: Map<string, string> }>();

  createFromWorld(id: string, dimension: FakeDimension, from: Vector3, to: Vector3): void {
    writable("StructureManager::createFromWorld");
    if (this.saved.has(id)) throw new Error(`structure ${id} exists already`);
    const low = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) };
    const size = { x: Math.abs(to.x - from.x) + 1, y: Math.abs(to.y - from.y) + 1, z: Math.abs(to.z - from.z) + 1 };
    if (size.x > 64 || size.y > 384 || size.z > 64) throw new Error("the structure bounds exceed the maximum size");
    dimension.getBlocks(new BlockVolume(from, to), {});
    const blocks = new Map<string, string>();
    for (const [key, typeId] of dimension.blocks) {
      const [x, y, z] = key.split(",").map(Number);
      if (within({ x, y, z }, from, to)) blocks.set(`${x - low.x},${y - low.y},${z - low.z}`, typeId);
    }
    this.saved.set(id, { size, blocks });
  }

  /** Places it with its low corner at `location`: every block of its box, air included. */
  place(id: string, dimension: FakeDimension, location: Vector3): void {
    writable("StructureManager::place");
    const structure = this.saved.get(id);
    if (!structure) throw new Error(`no structure ${id}`);
    for (let x = 0; x < structure.size.x; x++) {
      for (let y = 0; y < structure.size.y; y++) {
        for (let z = 0; z < structure.size.z; z++) {
          const typeId = structure.blocks.get(`${x},${y},${z}`);
          const key = blockKey({ x: location.x + x, y: location.y + y, z: location.z + z });
          if (typeId === undefined) dimension.blocks.delete(key);
          else dimension.blocks.set(key, typeId);
        }
      }
    }
  }

  delete(id: string): boolean {
    writable("StructureManager::delete");
    return this.saved.delete(id);
  }
}

function blockKey(location: Vector3): string {
  return `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

/** Values a particle reads (a paint splash's color). */
export class MolangVariableMap {
  readonly values = new Map<string, unknown>();

  setColorRGB(name: string, color: { red: number; green: number; blue: number }): void {
    this.values.set(name, { ...color });
  }

  setFloat(name: string, value: number): void {
    this.values.set(name, value);
  }

  setVector3(name: string, vector: Vector3): void {
    this.values.set(name, { ...vector });
  }
}

/** A player's or mob's box for raycasts: 0.6 across, 1.8 tall, standing on its location. */
const BODY = { half: 0.3, height: 1.8 };

/** How far along a ray (a unit direction) it first meets a box; undefined when it misses. */
function rayBox(origin: Vector3, direction: Vector3, low: Vector3, high: Vector3): number | undefined {
  let [near, far] = [-Infinity, Infinity];
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < low[axis] || origin[axis] > high[axis]) return undefined;
      continue;
    }
    const [a, b] = [(low[axis] - origin[axis]) / direction[axis], (high[axis] - origin[axis]) / direction[axis]];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far && far >= 0 ? Math.max(0, near) : undefined;
}

/** A box of blocks between two corners (both inside), as the real BlockVolume. */
export class BlockVolume {
  readonly from: Vector3;
  readonly to: Vector3;

  constructor(from: Vector3, to: Vector3) {
    this.from = from;
    this.to = to;
  }
}

class FakeDimension {
  /** Every entity spawnEntity made, oldest first (removed ones too: check isValid). */
  readonly spawned: FakeMob[] = [];
  /** Blocks that aren't air, by "x,y,z". */
  readonly blocks = new Map<string, string>();
  /** The states of blocks that have any (set with setPermutation or setBlockPermutation), by "x,y,z". */
  readonly blockStates = new Map<string, BlockStates>();
  /** Box corners whose blocks can't be read or saved (an unloaded chunk), as "x,y,z" of any block inside. */
  readonly unloaded = new Set<string>();
  /** Every particle and sound played in the world, oldest first. */
  readonly particles: { id: string; location: Vector3; variables?: MolangVariableMap }[] = [];
  readonly sounds: { id: string; location: Vector3; volume?: number; pitch?: number }[] = [];

  spawnParticle(id: string, location: Vector3, variables?: MolangVariableMap): void {
    writable("Dimension::spawnParticle");
    this.particles.push({ id, location: { ...location }, variables });
  }

  playSound(id: string, location: Vector3, options: { volume?: number; pitch?: number } = {}): void {
    writable("Dimension::playSound");
    this.sounds.push({ id, location: { ...location }, ...options });
  }

  getBlock(location: Vector3): FakeBlock {
    return new FakeBlock(location, this.blocks, this.blockStates);
  }

  setBlockPermutation(location: Vector3, permutation: BlockPermutation): void {
    this.getBlock(location).setPermutation(permutation);
  }

  /** Every block in a volume to one permutation, as the real fillBlocks (32,768 blocks at most). */
  /** Fills a volume (only blockFilter's includeTypes is supported): the blocks it changed, as their count. */
  fillBlocks(volume: BlockVolume, block: BlockPermutation | string, options: { blockFilter?: { includeTypes?: string[] } } = {}): { getCapacity(): number } {
    writable("Dimension::fillBlocks");
    const [from, to] = [volume.from, volume.to];
    const size = (Math.abs(to.x - from.x) + 1) * (Math.abs(to.y - from.y) + 1) * (Math.abs(to.z - from.z) + 1);
    if (size > 32768) throw new Error("fillBlocks: the volume is over 32,768 blocks");
    const permutation = typeof block === "string" ? BlockPermutation.resolve(block) : block;
    const only = options.blockFilter?.includeTypes;
    let changed = 0;
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          if (only && !only.includes(this.getBlock({ x, y, z }).typeId)) continue;
          this.setBlockPermutation({ x, y, z }, permutation);
          changed++;
        }
      }
    }
    return { getCapacity: () => changed };
  }

  /** The blocks in a volume of the given types (only includeTypes is supported). */
  getBlocks(volume: BlockVolume, options: { includeTypes?: string[] }): { getBlockLocationIterator(): Iterable<Vector3> } {
    const found: Vector3[] = [];
    for (const [key, typeId] of this.blocks) {
      const [x, y, z] = key.split(",").map(Number);
      if (!within({ x, y, z }, volume.from, volume.to)) continue;
      if (options.includeTypes && !options.includeTypes.includes(typeId)) continue;
      found.push({ x, y, z });
    }
    if ([...this.unloaded].some((key) => {
      const [x, y, z] = key.split(",").map(Number);
      return within({ x, y, z }, volume.from, volume.to);
    })) throw new Error("UnloadedChunksError");
    return { getBlockLocationIterator: () => found };
  }

  /** Spawned mobs still in the world, of one type when asked. */
  getEntities(options: { type?: string } = {}): FakeMob[] {
    return this.spawned.filter((mob) => mob.isValid && (options.type === undefined || mob.typeId === options.type));
  }

  spawnEntity(typeId: string, location: Vector3): FakeMob {
    writable("Dimension::spawnEntity");
    const mob = new FakeMob(typeId, location);
    this.spawned.push(mob);
    return mob;
  }

  /**
   * The first block a ray reaches within `maxDistance`: every block that isn't air is solid here
   * (liquids too, when asked for), walked in small steps. The face is the side the ray came in by.
   */
  getBlockFromRay(location: Vector3, direction: Vector3, options: { maxDistance?: number; includeLiquidBlocks?: boolean; includePassableBlocks?: boolean } = {}) {
    const max = options.maxDistance ?? 64;
    const step = 0.01;
    let previous = { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) };
    for (let t = 0; t <= max; t += step) {
      const at = { x: location.x + direction.x * t, y: location.y + direction.y * t, z: location.z + direction.z * t };
      const cell = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
      const block = this.getBlock(cell);
      // Fire is passable: a ray goes through it unless it asks for passable blocks.
      if (!block.isAir && (options.includeLiquidBlocks || !block.isLiquid) && (options.includePassableBlocks || block.typeId !== "minecraft:fire")) {
        const face =
          previous.y > cell.y ? Direction.Up : previous.y < cell.y ? Direction.Down
          : previous.x > cell.x ? Direction.East : previous.x < cell.x ? Direction.West
          : previous.z > cell.z ? Direction.South : Direction.North;
        // Where the ray enters the block, exactly, as the real raycast reports it.
        const enter = rayBox(location, direction, cell, { x: cell.x + 1, y: cell.y + 1, z: cell.z + 1 }) ?? t;
        const hit = { x: location.x + direction.x * enter, y: location.y + direction.y * enter, z: location.z + direction.z * enter };
        return { block, face, faceLocation: { x: hit.x - cell.x, y: hit.y - cell.y, z: hit.z - cell.z } };
      }
      previous = cell;
    }
    return undefined;
  }

  /** Every player and spawned mob a ray passes through within `maxDistance` (each a 0.6 by 1.8 box), with how far along. */
  getEntitiesFromRay(location: Vector3, direction: Vector3, options: { maxDistance?: number } = {}): { entity: FakePlayer | FakeMob; distance: number }[] {
    const max = options.maxDistance ?? Infinity;
    const bodies: (FakePlayer | FakeMob)[] = [...world.getAllPlayers(), ...this.spawned.filter((mob) => mob.isValid)];
    const hits: { entity: FakePlayer | FakeMob; distance: number }[] = [];
    for (const entity of bodies) {
      const at = entity.location;
      const distance = rayBox(location, direction, { x: at.x - BODY.half, y: at.y, z: at.z - BODY.half }, { x: at.x + BODY.half, y: at.y + BODY.height, z: at.z + BODY.half });
      if (distance !== undefined && distance <= max) hits.push({ entity, distance });
    }
    return hits;
  }

  reset(): void {
    this.spawned.length = 0;
    this.blocks.clear();
    this.blockStates.clear();
    this.unloaded.clear();
    this.particles.length = 0;
    this.sounds.length = 0;
  }
}

/** Ticking areas by id: each loads at once (the promise resolves on the next microtask). */
class FakeTickingAreas {
  readonly areas = new Set<string>();
  readonly maxChunkCount = 100;

  get chunkCount(): number {
    return this.areas.size;
  }

  hasCapacity(): boolean {
    return this.areas.size < this.maxChunkCount;
  }

  createTickingArea(id: string): Promise<void> {
    writable("TickingAreaManager::createTickingArea");
    if (this.areas.has(id)) throw new Error(`ticking area ${id} exists already`);
    this.areas.add(id);
    return Promise.resolve();
  }

  hasTickingArea(id: string): boolean {
    return this.areas.has(id);
  }

  removeTickingArea(id: string): void {
    writable("TickingAreaManager::removeTickingArea");
    this.areas.delete(id);
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
  hurtEntity: FakePlayer | FakeMob;
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
    entityHurt: new FakeSignal<{ hurtEntity: FakePlayer | FakeMob; damage: number; damageSource: DamageSource }, unknown>(),
    entityDie: new FakeSignal<{ deadEntity: FakePlayer | FakeMob; damageSource: DamageSource }, unknown>(),
    entityHitEntity: new FakeSignal<{ damagingEntity: FakePlayer; hitEntity: FakePlayer | FakeMob }, unknown>(),
    itemUse: new FakeSignal<{ source: FakePlayer; itemStack: ItemStack }>(),
    itemStartUse: new FakeSignal<{ source: FakePlayer; itemStack: ItemStack; useDuration: number }>(),
    itemStopUse: new FakeSignal<{ source: FakePlayer; itemStack?: ItemStack; useDuration: number }>(),
    itemReleaseUse: new FakeSignal<{ source: FakePlayer; itemStack?: ItemStack; useDuration: number }>(),
    itemCompleteUse: new FakeSignal<{ source: FakePlayer; itemStack?: ItemStack; useDuration: number }>(),
    playerHotbarSelectedSlotChange: new FakeSignal<{ player: FakePlayer; previousSlotSelected: number; newSlotSelected: number; itemStack?: ItemStack }>(),
    playerSwingStart: new FakeSignal<{ player: FakePlayer; heldItemStack?: ItemStack; swingSource: string }>(),
    playerInteractWithBlock: new FakeSignal<{ player: FakePlayer; itemStack?: ItemStack; block?: FakeBlock; isFirstEvent: boolean }>(),
    projectileHitBlock: new FakeSignal<{
      projectile: FakeEntity | FakeMob;
      source?: FakePlayer;
      location?: Vector3;
      getBlockHit?(): { block: FakeBlock; face: Direction };
    }>(),
    projectileHitEntity: new FakeSignal<{
      projectile: FakeEntity | FakeMob;
      source?: FakePlayer;
      location?: Vector3;
      getEntityHit(): { entity?: FakePlayer | FakeMob };
    }>(),
    playerInteractWithEntity: new FakeSignal<{ player: FakePlayer; target: FakePlayer | FakeMob }>(),
    playerPlaceBlock: new FakeSignal<{ player: FakePlayer; block: FakeBlock }>(),
    entitySpawn: new FakeSignal<{ entity: FakeMob | FakeEntity; cause: string }>(),
    playerButtonInput: new FakeSignal<{ player: FakePlayer; button: string; newButtonState: string }, { buttons?: string[]; state?: string }>(),
  };
  readonly beforeEvents = {
    entityHurt: new FakeSignal<HurtBeforeEvent, unknown>(true),
    playerLeave: new FakeSignal<{ player: FakePlayer }>(true),
    playerInteractWithBlock: new FakeSignal<{ player: FakePlayer; block: FakeBlock; blockFace: Direction; itemStack?: ItemStack; cancel: boolean }>(true),
    playerBreakBlock: new FakeSignal<{ player: FakePlayer; block: FakeBlock; cancel: boolean }>(true),
  };
  readonly gameRules: Record<string, boolean | number> = {};
  readonly scoreboard = new FakeScoreboard();
  readonly chat: string[] = [];
  readonly overworld = new FakeDimension();
  readonly tickingAreaManager = new FakeTickingAreas();
  readonly structureManager = new FakeStructures();
  private players: FakePlayer[] = [];

  getAllPlayers(): FakePlayer[] {
    return [...this.players];
  }

  getDimension(_id: string): FakeDimension {
    return this.overworld;
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
  hurt(victim: FakePlayer | FakeMob, damage: number, cause: string, from?: { attacker?: FakePlayer; projectile?: string; cooldown?: boolean }): void {
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
  melee(attacker: FakePlayer, victim: FakePlayer | FakeMob, damage = 1, cooldown = false): void {
    this.hurt(victim, damage, "entityAttack", { attacker, cooldown });
    this.afterEvents.entityHitEntity.emit({ damagingEntity: attacker, hitEntity: victim }, acceptsEntity(attacker));
  }

  /** A player picks another hotbar slot, as Bedrock reports it. */
  selectSlot(player: FakePlayer, slot: number): void {
    const previousSlotSelected = player.selectedSlotIndex;
    player.selectedSlotIndex = slot;
    this.afterEvents.playerHotbarSelectedSlotChange.emit({ player, previousSlotSelected, newSlotSelected: slot, itemStack: player.inventory.slots[slot] });
  }

  /** A player presses (or lets go of) a button, as playerButtonInput reports it to listeners whose options accept it. */
  pressButton(player: FakePlayer, button: string = InputButton.Jump, state: string = ButtonState.Pressed): void {
    this.afterEvents.playerButtonInput.emit(
      { player, button, newButtonState: state },
      (options) => (options?.buttons === undefined || options.buttons.includes(button)) && (options?.state === undefined || options.state === state),
    );
  }

  /** A projectile (an arrow by default) sticks in a block: returns it, so a test can see whether it was removed. */
  projectileLands(source?: FakePlayer, typeId = "minecraft:arrow", location?: Vector3): FakeEntity {
    const projectile = new FakeEntity(typeId, location);
    this.afterEvents.projectileHitBlock.emit({ projectile, source });
    return projectile;
  }

  /** A projectile (an arrow by default) reaches a player. Its damage, if any, is a separate hurt(). */
  projectileHits(victim: FakePlayer | FakeMob, source?: FakePlayer, typeId = "minecraft:arrow"): void {
    const projectile = new FakeEntity(typeId);
    this.afterEvents.projectileHitEntity.emit({ projectile, source, getEntityHit: () => ({ entity: victim }) });
  }

  /** A spawned projectile (a gun's ball) hits the `face` of the block at `at`, as BDS reports it. */
  projectileHitsBlock(projectile: FakeMob, at: Vector3, face: Direction, source?: FakePlayer): void {
    const block = this.overworld.getBlock(at);
    this.afterEvents.projectileHitBlock.emit({ projectile, source, location: { ...projectile.location }, getBlockHit: () => ({ block, face }) });
  }

  /** A spawned projectile (a gun's ball) reaches a player or mob at `location` (its middle by default). */
  projectileHitsEntity(projectile: FakeMob, victim: FakePlayer | FakeMob, location?: Vector3, source?: FakePlayer): void {
    const at = location ?? { x: victim.location.x, y: victim.location.y + 1, z: victim.location.z };
    this.afterEvents.projectileHitEntity.emit({ projectile, source, location: at, getEntityHit: () => ({ entity: victim }) });
  }

  /**
   * A player uses a block item on the face of the block at `against`: the before-event, then (unless
   * canceled) the block is placed beside it and the after-event fires. Returns whether it was placed.
   */
  placeBlock(player: FakePlayer, against: Vector3, face: Direction, typeId: string): boolean {
    const offsets: Record<Direction, Vector3> = {
      Down: { x: 0, y: -1, z: 0 },
      Up: { x: 0, y: 1, z: 0 },
      North: { x: 0, y: 0, z: -1 },
      South: { x: 0, y: 0, z: 1 },
      West: { x: -1, y: 0, z: 0 },
      East: { x: 1, y: 0, z: 0 },
    };
    const event = { player, block: this.overworld.getBlock(against), blockFace: face, itemStack: new ItemStack(typeId), cancel: false };
    this.beforeEvents.playerInteractWithBlock.emit(event);
    if (event.cancel) return false;
    const at = { x: against.x + offsets[face].x, y: against.y + offsets[face].y, z: against.z + offsets[face].z };
    const block = this.overworld.getBlock(at);
    block.setType(typeId);
    this.afterEvents.playerPlaceBlock.emit({ player, block });
    return true;
  }

  /** A player finishes breaking the block at `at`: the before-event, then (unless canceled) it's gone. Returns whether it broke. */
  breakBlock(player: FakePlayer, at: Vector3): boolean {
    const event = { player, block: this.overworld.getBlock(at), itemStack: player.inventory.slots[player.selectedSlotIndex], cancel: false };
    this.beforeEvents.playerBreakBlock.emit(event);
    if (event.cancel) return false;
    event.block.setType("minecraft:air");
    return true;
  }

  /** /kill: lethal, cause selfDestruct. */
  kill(victim: FakePlayer): void {
    this.hurt(victim, victim.health.currentValue, "selfDestruct");
  }

  private die(victim: FakePlayer | FakeMob, damageSource: DamageSource): void {
    this.afterEvents.entityDie.emit({ deadEntity: victim, damageSource }, acceptsEntity(victim));
    if (victim instanceof FakeMob) {
      victim.isValid = false;
      return;
    }
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
    this.overworld.reset();
    this.tickingAreaManager.areas.clear();
    this.structureManager.saved.clear();
  }
}

export const world = new FakeWorld();

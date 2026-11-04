// Kits: the items, armor and effects a player spawns with. A game lists its kits in its config (a
// map may add its own or replace them, kit-defs.ts); everyone gets the base kit, and the first kit
// unless they picked another in the kit form (kit-picker.ts). Each kit comes back by its refill
// rule: on every spawn, or each round or once, keeping what's left through a respawn.
import {
  EnchantmentType,
  EntityComponentTypes,
  EquipmentSlot,
  ItemComponentTypes,
  ItemLockMode,
  ItemStack,
  type Player,
} from "@minecraft/server";
import type { KitDef, KitItem, KitSelect, KitsConfig, MapKitsConfig } from "../config.ts";
import { kitItemId, matchKits, refillOnSpawn, teamArmorItem, type KitSpawn } from "../kit-defs.ts";
import { describeError, log } from "../log.ts";

const ARMOR_SLOTS = {
  head: EquipmentSlot.Head,
  chest: EquipmentSlot.Chest,
  legs: EquipmentSlot.Legs,
  feet: EquipmentSlot.Feet,
  offhand: EquipmentSlot.Offhand,
} as const;

/** Effects meant to last the whole life last this long (about 11 hours). */
const FOREVER_TICKS = 20 * 60 * 60 * 11;

export class Kits {
  readonly base: KitDef | undefined;
  readonly list: KitDef[];
  readonly select: KitSelect | undefined;
  readonly pickSeconds: number;
  /** Ids of the kits that came from the map. */
  readonly fromMap: ReadonlySet<string>;
  private readonly chosen = new Map<string, string>();
  /** What each player had left of their kits when they last went down: player, then item id, to a count. */
  private readonly kept = new Map<string, Map<string, number>>();

  constructor(game: KitsConfig | undefined, map?: MapKitsConfig) {
    const kits = matchKits(game, map);
    this.base = kits.base;
    this.list = kits.list;
    this.select = kits.select;
    this.pickSeconds = kits.pickSeconds;
    this.fromMap = kits.fromMap;
  }

  /** Whether players pick their kit in the kit form (there's a choice to make). */
  get picking(): boolean {
    return this.select !== undefined && this.list.length > 1;
  }

  choose(player: string, kitId: string): boolean {
    if (!this.list.some((kit) => kit.id === kitId)) return false;
    this.chosen.set(player.toLowerCase(), kitId);
    return true;
  }

  hasChosen(player: string): boolean {
    return this.chosen.has(player.toLowerCase());
  }

  chosenId(player: string): string | undefined {
    return this.chosen.get(player.toLowerCase());
  }

  /** Everyone picks again (before a round, when kits are picked every round). */
  clearChoices(): void {
    this.chosen.clear();
  }

  kitFor(player: string): KitDef | undefined {
    const id = this.chosen.get(player.toLowerCase());
    return this.list.find((kit) => kit.id === id) ?? this.list[0];
  }

  /**
   * Gives what this spawn brings: the base kit, then the player's kit unless `chosen` is false (it
   * comes once they've picked). Items can't be dropped; leather armor takes the team color.
   */
  give(player: Player, why: KitSpawn, teamColor?: string, options: { chosen?: boolean } = {}): void {
    if (this.base) this.giveKit(player, this.base, why, teamColor);
    const kit = options.chosen === false ? undefined : this.kitFor(player.name);
    if (kit) this.giveKit(player, kit, why, teamColor);
  }

  /** Gives the player's kit alone, in full: after they picked it for a round. */
  giveChosen(player: Player, teamColor?: string): void {
    const kit = this.kitFor(player.name);
    if (kit) this.giveKit(player, kit, "round", teamColor);
  }

  /**
   * The player changed teams (a preview's /switch): their kits' items in the old team's color
   * become the new team's, the same counts in the same slots, and their team armor its dye's.
   */
  recolor(player: Player, from?: string, to?: string): void {
    const kits = [this.base, this.kitFor(player.name)].filter((kit): kit is KitDef => kit !== undefined);
    const swaps = new Map<string, string>();
    for (const kit of kits) for (const item of kit.items) swaps.set(kitItemId(item, from), kitItemId(item, to));
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      for (let slot = 0; slot < (inventory?.size ?? 0); slot++) {
        const stack = inventory?.getItem(slot);
        const id = stack ? swaps.get(stack.typeId) : undefined;
        if (!stack || id === undefined || id === stack.typeId) continue;
        const swapped = new ItemStack(id, stack.amount);
        swapped.nameTag = stack.nameTag;
        swapped.lockMode = stack.lockMode;
        inventory?.setItem(slot, swapped);
      }
      const equipment = player.getComponent(EntityComponentTypes.Equippable);
      for (const kit of kits) {
        if (!kit.teamArmor) continue;
        for (const [slot, item] of Object.entries(kit.armor ?? {}) as [keyof typeof ARMOR_SLOTS, string][]) {
          const worn = equipment?.getEquipment(ARMOR_SLOTS[slot]);
          if (worn?.typeId !== teamArmorItem(item, from) || teamArmorItem(item, to) === worn.typeId) continue;
          equipment?.setEquipment(ARMOR_SLOTS[slot], armorStack(kit, item, to));
        }
      }
    } catch (error) {
      log.warn(`could not put ${player.name}'s kit in their new team's color: ${describeError(error)}`);
    }
  }

  /**
   * Remembers what the player has left of each kit that isn't refilled on every spawn, for their
   * next spawn. Call it as they go down, while their inventory still holds it.
   */
  stash(player: Player, teamColor?: string): void {
    const kits = [this.base, this.kitFor(player.name)].filter((kit): kit is KitDef => kit !== undefined && (kit.refill ?? "life") !== "life");
    if (kits.length === 0) return;
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!inventory) return;
      const ids = new Set(kits.flatMap((kit) => kit.items.map((item) => kitItemId(item, teamColor))));
      const counts = new Map<string, number>();
      for (let slot = 0; slot < inventory.size; slot++) {
        const stack = inventory.getItem(slot);
        if (stack && ids.has(stack.typeId)) counts.set(stack.typeId, (counts.get(stack.typeId) ?? 0) + stack.amount);
      }
      this.kept.set(player.name.toLowerCase(), counts);
    } catch (error) {
      log.warn(`could not keep ${player.name}'s kit: ${describeError(error)}`);
    }
  }

  private giveKit(player: Player, kit: KitDef, why: KitSpawn, teamColor?: string): void {
    const key = player.name.toLowerCase();
    const kept = refillOnSpawn(kit.refill, why) === "kept" ? this.kept.get(key) : undefined;
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      for (const entry of kit.items) {
        const full = entry.count ?? 1;
        const count = kept ? Math.min(full, kept.get(kitItemId(entry, teamColor)) ?? 0) : full;
        if (count <= 0) continue;
        const stack = kitStack(kit, entry, teamColor, count);
        if (entry.slot !== undefined) inventory?.setItem(entry.slot, stack);
        else inventory?.addItem(stack);
      }
      const equipment = player.getComponent(EntityComponentTypes.Equippable);
      for (const [slot, item] of Object.entries(kit.armor ?? {}) as [keyof typeof ARMOR_SLOTS, string][]) {
        equipment?.setEquipment(ARMOR_SLOTS[slot], armorStack(kit, item, teamColor));
      }
      for (const effect of kit.effects ?? []) {
        const ticks = effect.seconds ? effect.seconds * 20 : FOREVER_TICKS;
        player.addEffect(effect.id, ticks, { amplifier: effect.amplifier ?? 0, showParticles: false });
      }
    } catch (error) {
      log.warn(`could not give kit "${kit.id}" to ${player.name}: ${describeError(error)}`);
    }
  }
}

/**
 * One of a kit's items as the kit gives it: in the team's color, named, enchanted, and locked in the
 * inventory (it can't be dropped). A game hands one back with it (Siege's trident).
 */
export function kitStack(kit: KitDef, entry: KitItem, teamColor?: string, count = entry.count ?? 1): ItemStack {
  const stack = new ItemStack(kitItemId(entry, teamColor), count);
  if (entry.name) stack.nameTag = entry.name;
  stack.lockMode = ItemLockMode.inventory;
  enchant(stack, kit, entry.item);
  return stack;
}

/**
 * One of a kit's armor pieces as the kit puts it on: locked in its slot, enchanted, and with
 * teamArmor, leather in the team's dye (the armor pack's piece, since scripts can't dye leather).
 */
function armorStack(kit: KitDef, item: string, teamColor?: string): ItemStack {
  const stack = new ItemStack(kit.teamArmor ? teamArmorItem(item, teamColor) : item, 1);
  stack.lockMode = ItemLockMode.slot;
  enchant(stack, kit, item);
  return stack;
}

/** Puts the kit's enchantments for this item (as the kit writes its id) on it; one Minecraft refuses is skipped. */
function enchant(stack: ItemStack, kit: KitDef, item: string): void {
  const enchantments = (kit.enchantments ?? []).filter((entry) => entry.item === item);
  const enchantable = enchantments.length > 0 ? stack.getComponent(ItemComponentTypes.Enchantable) : undefined;
  for (const { enchantment, level } of enchantments) {
    try {
      enchantable?.addEnchantment({ type: new EnchantmentType(enchantment), level });
    } catch (error) {
      log.warn(`could not enchant ${stack.typeId} with ${enchantment} ${level}: ${describeError(error)}`);
    }
  }
}

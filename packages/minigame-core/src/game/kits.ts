// Kits: the items, armor and effects a player spawns with. A game lists its kits in its config;
// with pick enabled, players choose one before the match (the default is the first).
import {
  EntityComponentTypes,
  EquipmentSlot,
  ItemComponentTypes,
  ItemLockMode,
  ItemStack,
  type Player,
  type RGB,
} from "@minecraft/server";
import type { KitDef } from "../config.ts";
import { describeError, log } from "../log.ts";

const ARMOR_SLOTS = {
  head: EquipmentSlot.Head,
  chest: EquipmentSlot.Chest,
  legs: EquipmentSlot.Legs,
  feet: EquipmentSlot.Feet,
  offhand: EquipmentSlot.Offhand,
} as const;

/** Leather armor colors for the § color codes teams use. */
const TEAM_COLORS: Record<string, RGB> = {
  "§c": { red: 0.85, green: 0.15, blue: 0.15 },
  "§9": { red: 0.2, green: 0.35, blue: 0.9 },
  "§a": { red: 0.3, green: 0.8, blue: 0.25 },
  "§e": { red: 0.95, green: 0.85, blue: 0.2 },
  "§6": { red: 0.95, green: 0.55, blue: 0.1 },
  "§d": { red: 0.85, green: 0.35, blue: 0.85 },
  "§b": { red: 0.3, green: 0.85, blue: 0.9 },
  "§f": { red: 0.95, green: 0.95, blue: 0.95 },
};

/** Effects meant to last the whole life last this long (about 11 hours). */
const FOREVER_TICKS = 20 * 60 * 60 * 11;

export class Kits {
  readonly list: KitDef[];
  readonly pick: boolean;
  private readonly chosen = new Map<string, string>();

  constructor(config: { pick?: boolean; list: KitDef[] } | undefined) {
    this.list = config?.list ?? [];
    this.pick = Boolean(config?.pick) && this.list.length > 1;
  }

  choose(player: string, kitId: string): void {
    if (this.list.some((kit) => kit.id === kitId)) this.chosen.set(player.toLowerCase(), kitId);
  }

  hasChosen(player: string): boolean {
    return this.chosen.has(player.toLowerCase());
  }

  kitFor(player: string): KitDef | undefined {
    const id = this.chosen.get(player.toLowerCase());
    return this.list.find((kit) => kit.id === id) ?? this.list[0];
  }

  /** Gives the player's kit. Items can't be dropped; leather armor takes the team color. */
  give(player: Player, teamColor?: string): void {
    const kit = this.kitFor(player.name);
    if (!kit) return;
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
      for (const entry of kit.items) {
        const stack = new ItemStack(entry.item, entry.count ?? 1);
        if (entry.name) stack.nameTag = entry.name;
        stack.lockMode = ItemLockMode.inventory;
        if (entry.slot !== undefined) inventory?.setItem(entry.slot, stack);
        else inventory?.addItem(stack);
      }
      const equipment = player.getComponent(EntityComponentTypes.Equippable);
      for (const [slot, item] of Object.entries(kit.armor ?? {}) as [keyof typeof ARMOR_SLOTS, string][]) {
        const stack = new ItemStack(item, 1);
        stack.lockMode = ItemLockMode.slot;
        const color = kit.teamArmor && teamColor ? TEAM_COLORS[teamColor] : undefined;
        const dyeable = color ? stack.getComponent(ItemComponentTypes.Dyeable) : undefined;
        if (dyeable && color) dyeable.color = color;
        equipment?.setEquipment(ARMOR_SLOTS[slot], stack);
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

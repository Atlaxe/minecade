// Puts a player back into a clean state. Effects, input locks, game modes, items and HUD
// changes all persist across games and servers, so every first spawn (lobby too) and every game
// end runs this. Each step stands alone: one failing step doesn't skip the others.
import {
  EntityComponentTypes,
  EquipmentSlot,
  GameMode,
  InputPermissionCategory,
  type Player,
} from "@minecraft/server";
import { describeError, log } from "./log.ts";

const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];

const INPUT_CATEGORIES = Object.values(InputPermissionCategory).filter(
  (value): value is InputPermissionCategory => typeof value === "number",
);

export function normalizePlayer(player: Player, gameMode: GameMode = GameMode.Adventure): void {
  const step = (what: string, fn: () => void) => {
    if (!player.isValid) return;
    try {
      fn();
    } catch (error) {
      log.warn(`could not reset ${what} for ${player.name}: ${describeError(error)}`);
    }
  };
  step("effects", () => {
    for (const effect of player.getEffects()) player.removeEffect(effect.typeId);
  });
  step("health", () => player.getComponent(EntityComponentTypes.Health)?.resetToMaxValue());
  step("hunger", () => {
    player.getComponent(EntityComponentTypes.Hunger)?.resetToMaxValue();
    player.getComponent(EntityComponentTypes.Saturation)?.resetToMaxValue();
  });
  step("fire", () => player.extinguishFire(false));
  step("experience", () => player.resetLevel());
  step("inventory", () => {
    player.getComponent(EntityComponentTypes.Inventory)?.container.clearAll();
    const equipment = player.getComponent(EntityComponentTypes.Equippable);
    for (const slot of ARMOR_SLOTS) equipment?.setEquipment(slot, undefined);
    player.getComponent(EntityComponentTypes.CursorInventory)?.clear();
  });
  // Always back to everything allowed: a saved copy could itself be a leaked lock.
  step("input", () => {
    for (const category of INPUT_CATEGORIES) player.inputPermissions.setPermissionCategory(category, true);
  });
  step("hud", () => player.onScreenDisplay.resetHudElementsVisibility());
  step("name tag", () => {
    if (player.nameTag !== player.name) player.nameTag = player.name; // team colors
  });
  step("game mode", () => player.setGameMode(gameMode));
}

// The editor's commands, registered when the script loads:
// - /reset (minecade:reset): a map editor gets the editor's items back (the map menu, and in Select
//   the Select tool) and creative mode, for worlds whose command blocks clear inventories or change
//   game modes. Select and Edit say what resetting does.
// - /zoom (minecade:zoom): zooms the view in, like a spyglass, whatever you hold; again to zoom
//   back out.
// The Zoom item (slot 8 in Select and Edit) zooms in while right click is held with it, anywhere,
// and back out once it's let go (zoomWhileHeld). It takes an item: scripts see no keys but jump and
// sneak, no right click with an empty hand unless it lands on a block or mob in reach, and nothing
// used from the off-hand.
import { CommandPermissionLevel, CustomCommandStatus, ItemLockMode, ItemStack, system, world, type Container, type Player } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";

export const ZOOM_ITEM = "minecade:zoom";
/** Slot 8, beside the map menu. */
const ZOOM_SLOT = 7;
/** The field of view while zoomed in (Minecraft's default is about 70). */
const ZOOM_FOV = 30;
const zoomed = new Set<string>();
/** Who holds right click with the Zoom item now, and the tick each last started or stopped. */
const holding = new Set<string>();
const heldAt = new Map<string, number>();

let handler: ((player: Player) => void) | undefined;

/** What /reset does on this server. */
export function onReset(fn: (player: Player) => void): void {
  handler = fn;
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    { name: "minecade:reset", description: "Get the map editor's items back, and creative mode", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can reset." };
      // Commands run where the world can't be changed: the reset happens next tick.
      system.run(() => handler?.(player as Player));
      return { status: CustomCommandStatus.Success };
    },
  );
  customCommandRegistry.registerCommand(
    { name: "minecade:zoom", description: "Zoom the view in, or back out", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
    (origin) => {
      const player = origin.sourceEntity;
      if (player?.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Only a player can zoom." };
      system.run(() => setZoom(player as Player, !zoomed.has(keyOf(player as Player))));
      return { status: CustomCommandStatus.Success };
    },
  );
});

/** Holding right click with the Zoom item zooms in until it's let go. */
export function zoomWhileHeld(scope: Scope): void {
  scope.subscribe(world.afterEvents.itemStartUse, ({ source, itemStack }) => {
    if (itemStack.typeId !== ZOOM_ITEM) return;
    holding.add(keyOf(source));
    heldAt.set(keyOf(source), system.currentTick);
    setZoom(source, true);
  });
  const letGo = ({ source }: { source: Player }) => {
    if (!holding.delete(keyOf(source))) return;
    heldAt.set(keyOf(source), system.currentTick);
    setZoom(source, false);
  };
  scope.subscribe(world.afterEvents.itemStopUse, letGo);
  scope.subscribe(world.afterEvents.itemReleaseUse, letGo);
  scope.subscribe(world.afterEvents.itemCompleteUse, letGo);
  // A use that never starts holding (in case the game doesn't treat the item as held) zooms in or
  // back out per click instead.
  scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
    if (itemStack.typeId !== ZOOM_ITEM) return;
    const key = keyOf(source);
    const at = system.currentTick;
    system.runTimeout(() => {
      if (!holding.has(key) && (heldAt.get(key) ?? -10) < at - 2) setZoom(source, !zoomed.has(key));
    }, 3);
  });
}

/** The Zoom item, locked in slot 8, unless the player has it already. Whatever was in slot 8 moves to a free slot. */
export function giveZoom(inventory: Container): void {
  for (let slot = 0; slot < inventory.size; slot++) if (inventory.getItem(slot)?.typeId === ZOOM_ITEM) return;
  const old = inventory.getItem(ZOOM_SLOT);
  const zoom = new ItemStack(ZOOM_ITEM, 1);
  zoom.lockMode = ItemLockMode.slot;
  zoom.keepOnDeath = true;
  inventory.setItem(ZOOM_SLOT, zoom);
  if (old) inventory.addItem(old);
}

function setZoom(player: Player, on: boolean): void {
  if (!player.isValid) return;
  const key = keyOf(player);
  if (zoomed.has(key) === on) return;
  const easeOptions = { easeTime: 0.2 };
  if (on) {
    zoomed.add(key);
    player.camera.setFov({ fov: ZOOM_FOV, easeOptions });
  } else {
    zoomed.delete(key);
    player.camera.setFov({ easeOptions });
  }
}

function keyOf(player: Player): string {
  return player.name.toLowerCase();
}

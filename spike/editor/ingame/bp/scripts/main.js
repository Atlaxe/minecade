// Map editor spike, in-game part (pass 10.1, run by spike/editor/ingame.ts). Logs `EG|<json>` lines.
//   - Players get a Spike Wand (a custom item with its own icon) when they join.
//   - Every way of using it is logged: use in the air, use on a block, hitting a block.
//   - Using it in the air places a marker (minecade:spike_marker) with a numbered name tag; hitting
//     or tapping a marker is logged and named in chat.
//   - scriptevent eg:perm logs every player's permission levels (before and after `op`).
//   - scriptevent eg:transfer {"host":"...","port":19133} transfers everyone there.
//   - scriptevent eg:config {"host":"...","port":19133} names the other server; then sneaking and
//     using the wand transfers that player there.
import { system, world } from "@minecraft/server";
import { transferPlayer } from "@minecraft/server-admin";

const WAND = "minecade:spike_wand";
const MARKER = "minecade:spike_marker";
const out = (data) => console.log(`EG|${JSON.stringify(data)}`);
let markers = 0;
let other;

function tell(player, message) {
  player.sendMessage(`§b[spike]§r ${message}`);
}

function holdsWand(player) {
  return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex)?.typeId === WAND;
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const container = player.getComponent("minecraft:inventory")?.container;
    const hasWand = Array.from({ length: container?.size ?? 0 }, (_, slot) => container?.getItem(slot)?.typeId).includes(WAND);
    if (!hasWand) player.runCommand(`give @s ${WAND}`);
    out({ ev: "join", name: player.name, permission: player.playerPermissionLevel, command: player.commandPermissionLevel });
    tell(player, "Use the wand in the air to place a marker; hit or tap markers; hit and use blocks.");
  }, 20);
});

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack.typeId !== WAND) return;
  if (source.isSneaking && other) {
    out({ ev: "transfer", name: source.name, ...other });
    tell(source, `transferring to ${other.host}:${other.port}`);
    transferPlayer(source, { hostname: other.host, port: other.port });
    return;
  }
  const { x, y, z } = source.location;
  const marker = source.dimension.spawnEntity(MARKER, { x, y, z });
  marker.nameTag = `Spawn ${++markers}`;
  out({ ev: "itemUse", name: source.name, marker: marker.nameTag });
  tell(source, `itemUse: placed ${marker.nameTag}`);
});

world.afterEvents.playerInteractWithBlock.subscribe(({ player, block, itemStack, isFirstEvent }) => {
  if (itemStack?.typeId !== WAND || !isFirstEvent) return;
  out({ ev: "useOnBlock", name: player.name, block: block.location });
  tell(player, `use on block ${block.location.x} ${block.location.y} ${block.location.z}`);
});

world.afterEvents.entityHitBlock.subscribe(({ damagingEntity, hitBlock }) => {
  if (damagingEntity.typeId !== "minecraft:player" || !holdsWand(damagingEntity)) return;
  out({ ev: "hitBlock", name: damagingEntity.name, block: hitBlock.location });
  tell(damagingEntity, `hit block ${hitBlock.location.x} ${hitBlock.location.y} ${hitBlock.location.z}`);
});

world.afterEvents.entityHitEntity.subscribe(({ damagingEntity, hitEntity }) => {
  if (hitEntity.typeId !== MARKER || damagingEntity.typeId !== "minecraft:player") return;
  out({ ev: "hitMarker", name: damagingEntity.name, marker: hitEntity.nameTag });
  tell(damagingEntity, `hit marker ${hitEntity.nameTag}`);
});

world.afterEvents.playerInteractWithEntity.subscribe(({ player, target }) => {
  if (target.typeId !== MARKER) return;
  out({ ev: "tapMarker", name: player.name, marker: target.nameTag });
  tell(player, `tapped marker ${target.nameTag}`);
});

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
  if (id === "eg:perm") {
    for (const player of world.getAllPlayers()) {
      out({ ev: "perm", name: player.name, permission: player.playerPermissionLevel, command: player.commandPermissionLevel });
    }
  } else if (id === "eg:config") {
    other = JSON.parse(message);
    out({ ev: "config", other });
  } else if (id === "eg:transfer") {
    const { host, port } = JSON.parse(message);
    for (const player of world.getAllPlayers()) {
      out({ ev: "transfer", name: player.name, host, port });
      transferPlayer(player, { hostname: host, port });
    }
  }
});

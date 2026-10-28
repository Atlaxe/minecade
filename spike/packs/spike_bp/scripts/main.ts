// Spike pack: transfer between lobby and game, plus the [NET] log / scriptevent stdin round trip.
import { EntityComponentTypes, ItemLockMode, ItemStack, Player, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { transferPlayer, variables } from "@minecraft/server-admin";

type Via = "lan" | "public";

const role = String(variables.get("role"));
const lanHost = String(variables.get("lanHost"));
const publicHost = String(variables.get("publicHost"));
const targetPort = Number(variables.get("targetPort"));
const target = role === "lobby" ? "game" : "lobby";

function net(payload: Record<string, unknown>): void {
  console.warn(`[NET] ${JSON.stringify({ from: role, ...payload })}`);
}

function giveCompass(player: Player): void {
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const item = new ItemStack("minecraft:compass", 1);
  item.nameTag = `Go to ${target}`;
  item.lockMode = ItemLockMode.slot;
  item.keepOnDeath = true;
  inventory.setItem(0, item);
}

function transfer(player: Player, via: Via): void {
  const hostname = via === "lan" ? lanHost : publicHost;
  console.warn(`[SPIKE] transfer ${player.name} -> ${hostname}:${targetPort} (${via})`);
  player.sendMessage(`Transferring to ${target} via ${via} (${hostname}:${targetPort})...`);
  try {
    transferPlayer(player, { hostname, port: targetPort });
  } catch (error) {
    console.warn(`[SPIKE] transfer failed: ${String(error)}`);
    player.sendMessage(`Transfer failed: ${String(error)}`);
  }
}

async function showTransferForm(player: Player): Promise<void> {
  const form = new ActionFormData()
    .title(`Go to ${target}`)
    .body(`You are on the ${role} server. Pick the address to transfer through.`)
    .button(`LAN\n${lanHost}:${targetPort}`)
    .button(`Public\n${publicHost}:${targetPort}`);
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  transfer(player, response.selection === 0 ? "lan" : "public");
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  giveCompass(player);
  console.warn(`[SPIKE] spawned ${player.name} on ${role} (initial=${initialSpawn})`);
});

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (itemStack.typeId === "minecraft:compass") void showTransferForm(source);
});

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    player.onScreenDisplay.setActionBar(`SPIKE: you are on the ${role.toUpperCase()} server`);
  }
}, 20);

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    if (event.id === "minecade:transfer") {
      const [name, via] = event.message.trim().split(/\s+/);
      const player = world.getAllPlayers().find((p) => p.name === name);
      if (!player) {
        console.warn(`[SPIKE] no player named ${name}`);
        return;
      }
      transfer(player, via === "lan" ? "lan" : "public");
    } else if (event.id === "minecade:net") {
      let message: { t?: string; seq?: number; sentAt?: number };
      try {
        message = JSON.parse(event.message);
      } catch (error) {
        net({ t: "bad_json", length: event.message.length, error: String(error) });
        return;
      }
      net({
        t: "ack",
        of: message.t,
        seq: message.seq,
        sentAt: message.sentAt,
        length: event.message.length,
        sourceType: event.sourceType,
      });
    }
  },
  { namespaces: ["minecade"] },
);

world.afterEvents.worldLoad.subscribe(() => {
  net({ t: "hello", via: "warn" });
  console.log(`[NET] ${JSON.stringify({ from: role, t: "hello_log", via: "log" })}`);
  console.info(`[NET] ${JSON.stringify({ from: role, t: "hello_info", via: "info" })}`);
  console.error(`[NET] ${JSON.stringify({ from: role, t: "hello_error", via: "error" })}`);
});

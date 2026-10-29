// Lobby server script: gives every player the Game Selector compass and the Stats book, keeps
// them on the platform, shows the orchestrator status, and connects the selector and stats
// logic (lobby-controller.ts, stats-controller.ts) to players, forms and the orchestrator.
import {
  EntityComponentTypes,
  ItemLockMode,
  ItemStack,
  system,
  world,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";
import { log, normalizePlayer, showForm, type Scope } from "@minecade/minigame-core";
import { bootServer } from "@minecade/minigame-core/bootstrap";
import registry from "#registry";
import { LobbyController, type GameChoice } from "./lobby-controller.ts";
import { StatsController } from "./stats-controller.ts";

const COMPASS = "minecraft:compass";
const BOOK = "minecraft:book";

function playerNamed(name: string): Player | undefined {
  return world.getAllPlayers().find((player) => player.name === name);
}

function recipients(to: string): Player[] {
  if (to === "all") return world.getAllPlayers();
  const player = playerNamed(to);
  return player ? [player] : [];
}

/** Game, then map (skipped when there's one), then a confirmation. */
async function chooseGame(player: Player | undefined, scope: Scope, choices: GameChoice[]) {
  if (!player) return undefined;
  const gameForm = new ActionFormData().title("Pick a game");
  for (const { game, playable, reason } of choices) {
    gameForm.button(playable ? `${game.name}\n${game.minPlayers}-${game.maxPlayers} players` : `${game.name}\n${reason}`);
  }
  const gamePick = await showForm(scope, player, gameForm);
  if (gamePick?.selection === undefined) return undefined;
  const { game, playable, reason } = choices[gamePick.selection];
  if (!playable) {
    player.sendMessage(`${game.name} ${reason}.`);
    return undefined;
  }

  let map = game.maps[0];
  if (game.maps.length > 1) {
    const mapForm = new ActionFormData().title(game.name).body("Pick a map").button("Random");
    for (const candidate of game.maps) mapForm.button(candidate.name);
    const mapPick = await showForm(scope, player, mapForm);
    if (mapPick?.selection === undefined) return undefined;
    map = mapPick.selection === 0 ? { id: "random", name: "a random map" } : game.maps[mapPick.selection - 1];
  }

  // An action form rather than a message form, so "Start" is always selection 0.
  const confirm = new ActionFormData()
    .title(game.name)
    .body(`Start ${game.name} on ${map.name}? Everyone in the lobby (up to ${game.maxPlayers}) goes.`)
    .button("Start")
    .button("Cancel");
  const answer = await showForm(scope, player, confirm);
  return answer?.selection === 0 ? { game: game.id, map: map.id } : undefined;
}

bootServer(({ vars, transport, transfer, root }) => {
  const [sx, sy, sz] = vars.mapConfig.spawns[0] ?? [0, 65, 0];
  const spawn: Vector3 = { x: sx + 0.5, y: sy, z: sz + 0.5 };
  const bounds = vars.mapConfig.bounds;

  const lobby = new LobbyController(
    {
      send: (event) => transport.send(event),
      onlinePlayers: () => world.getAllPlayers().map((player) => player.name),
      transfer: (name, port) => {
        const player = playerNamed(name);
        if (player) transfer.transfer(player, port);
      },
      notify: (to, text) => {
        for (const player of recipients(to)) player.sendMessage(text);
      },
      title: (to, title, subtitle) => {
        for (const player of recipients(to)) {
          player.onScreenDisplay.setTitle(title, { fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 10, subtitle });
        }
      },
      closeForms: (name) => {
        const player = playerNamed(name);
        if (player) uiManager.closeAllForms(player);
      },
      chooseGame: (name, scope, choices) => chooseGame(playerNamed(name), scope, choices),
    },
    root,
    { registry, devMinPlayers: vars.devMinPlayers },
  );
  const stats = new StatsController(
    {
      send: (event) => transport.send(event),
      notify: (name, text) => playerNamed(name)?.sendMessage(text),
      show: async (name, scope, { title, body, buttons }) => {
        const player = playerNamed(name);
        if (!player) return undefined;
        const form = new ActionFormData().title(title).body(body);
        for (const button of buttons) form.button(button);
        return (await showForm(scope, player, form))?.selection;
      },
    },
    root,
    { registry },
  );
  root.add(
    transport.onMessage((message) => {
      if (message.t !== "stats_reply") {
        log.info(`orchestrator: ${message.t}${message.t === "status" ? ` ${message.state} ${message.game ?? ""}` : ""}`);
      }
      lobby.onMessage(message);
      stats.onMessage(message);
    }),
  );

  function setUp(player: Player): void {
    if (!player.isValid) return;
    // Effects, input locks or a spectator game mode can follow a player back from a game.
    normalizePlayer(player);
    // Rejoining players otherwise appear wherever they logged out.
    player.teleport(spawn);
    const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (inventory) {
      const compass = new ItemStack(COMPASS, 1);
      compass.nameTag = "Game Selector";
      compass.lockMode = ItemLockMode.slot;
      compass.keepOnDeath = true;
      inventory.setItem(0, compass);
      const book = new ItemStack(BOOK, 1);
      book.nameTag = "Stats";
      book.lockMode = ItemLockMode.slot;
      book.keepOnDeath = true;
      inventory.setItem(1, book);
    }
    player.selectedSlotIndex = 0;
  }

  root.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    // A teleport during the spawn itself can be overridden by the client, so wait 2 ticks.
    root.timeout(() => {
      setUp(player);
      if (player.isValid) lobby.onPlayerJoined(player.name);
    }, 2);
  });
  root.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
    lobby.onPlayerLeft(playerName);
    stats.onPlayerLeft(playerName);
  });

  // A tap can fire both events (and itemUse repeats while held): one form per tick per player.
  const lastTap = new Map<string, number>();
  const tap = (player: Player, item: string | undefined) => {
    if (item !== COMPASS && item !== BOOK) return;
    if (lastTap.get(player.name) === system.currentTick) return;
    lastTap.set(player.name, system.currentTick);
    if (item === COMPASS) void lobby.openSelector(player.name);
    else void stats.openStats(player.name);
  };
  root.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => tap(source, itemStack.typeId));
  // Aiming at a block (the platform) may skip itemUse.
  root.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, itemStack, isFirstEvent }) => {
    if (isFirstEvent) tap(player, itemStack?.typeId);
  });

  let frame = 0;
  root.interval(() => {
    const text = lobby.actionBar(frame++);
    for (const player of world.getAllPlayers()) player.onScreenDisplay.setActionBar(text);
  }, 20);

  // Anyone who walks or falls out of the lobby area goes back to spawn.
  if (bounds) {
    root.interval(() => {
      for (const player of world.getAllPlayers()) {
        const { x, y, z } = player.location;
        const inside =
          x >= bounds.min[0] && x <= bounds.max[0] + 1 &&
          y >= bounds.min[1] && y <= bounds.max[1] + 1 &&
          z >= bounds.min[2] && z <= bounds.max[2] + 1;
        if (!inside) player.teleport(spawn);
      }
    }, 10);
  }

  // After a script reload, players are already here.
  for (const player of world.getAllPlayers()) setUp(player);
});

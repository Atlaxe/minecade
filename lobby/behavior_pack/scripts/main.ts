// Lobby server script: places the terminal and its hologram, keeps players on the platform, and
// connects the terminal, game starting and stats logic (terminal-controller.ts,
// lobby-controller.ts, stats-controller.ts) to players, forms and the orchestrator.
import { GameMode, system, world, type Player, type Vector3 } from "@minecraft/server";
import { uiManager, type ActionFormData } from "@minecraft/server-ui";
import { MapView, describeError, facingOf, holoPictures, holoPortraits, log, normalizePlayer, playChime, showForm, type Scope } from "@minecade/minigame-core";
import { bootServer } from "@minecade/minigame-core/bootstrap";
import registry from "#registry";
import skins from "#skins";
import { demoGames } from "./demo-games.ts";
import { countdownContent, teamsContent } from "./holo-content.ts";
import { Hologram } from "./hologram.ts";
import { LobbyController } from "./lobby-controller.ts";
import { PREVIEW_SCREENS } from "./holo-preview.ts";
import { CLOSE, menuChoice, strayClose } from "./game-screen.ts";
import { MAIN_MENU_CHOICES, gameForm, gamesForm, mainMenuForm, playersForm, previewForm, statsForm } from "./menus.ts";
import { isWatcher, useSkins } from "./skins.ts";
import { StarBox } from "./star-box.ts";
import { StatsController } from "./stats-controller.ts";
import { TeamPickForm } from "./team-pick-form.ts";
import { TerminalController } from "./terminal-controller.ts";

// Block components must be registered at startup, before the world (and bootServer) loads. Taps
// are handed to the terminal once it exists; one per player per tick.
let tapTerminal: (name: string) => void = () => {};
const lastTap = new Map<string, number>();
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("minecade:terminal", {
    onPlayerInteract: ({ player }) => {
      if (!player || lastTap.get(player.name) === system.currentTick) return;
      lastTap.set(player.name, system.currentTick);
      const name = player.name;
      system.run(() => tapTerminal(name));
    },
  });
});

/**
 * The skin watcher's gamertag (WATCHER_GAMERTAG, set at boot): a bot that's in the lobby all the
 * time to save players' skins (watcher/), kept in spectator mode and out of everything else.
 */
let watcherName = "";

/** Everyone in the lobby except the skin watcher. */
function lobbyPlayers(): Player[] {
  return world.getAllPlayers().filter((player) => !isWatcher(player.name, watcherName));
}

function playerNamed(name: string): Player | undefined {
  return world.getAllPlayers().find((player) => player.name === name);
}

function recipients(to: string): Player[] {
  if (to === "all") return lobbyPlayers();
  const player = playerNamed(to);
  return player ? [player] : [];
}

/**
 * Shows a themed menu and resolves its choice (menuChoice). An X that comes right as the menu
 * opens is a stray click (strayClose): the menu shows again instead of closing the terminal.
 */
async function showMenu(scope: Scope, player: Player, form: ActionFormData): Promise<number | typeof CLOSE | undefined> {
  for (;;) {
    // From the last attempt: showForm tries again while the player is busy.
    let shownAt = system.currentTick;
    const response = await showForm(scope, player, {
      show: (target: Player) => {
        shownAt = system.currentTick;
        return form.show(target);
      },
    });
    const choice = menuChoice(response?.selection);
    const ticksOpen = system.currentTick - shownAt;
    if (!strayClose(choice, ticksOpen)) {
      // How long a closing menu had been open, in case an X still comes from a click meant elsewhere.
      if (choice === CLOSE) log.info(`${player.name} left the terminal with the X, ${ticksOpen} ticks after the menu opened`);
      return choice;
    }
    log.info(`ignored a stray X on ${player.name}'s menu, ${ticksOpen} ticks after it opened`);
  }
}

bootServer(({ vars, transport, transfer, root }) => {
  const map = new MapView(vars.mapConfig);
  const spawnPoint = map.spawns[0] ?? [0, 65, 0];
  const [sx, sy, sz] = spawnPoint;
  const spawn: Vector3 = { x: sx + 0.5, y: sy, z: sz + 0.5 };
  // A spawn with a saved facing (set in the map editor) keeps it; otherwise everyone faces the terminal.
  const spawnFacing = facingOf(spawnPoint);
  watcherName = vars.watcher;

  const lobby = new LobbyController(
    {
      send: (event) => transport.send(event),
      onlinePlayers: () => lobbyPlayers().map((player) => player.name),
      transfer: (name, port) => {
        const player = playerNamed(name);
        if (player) transfer.transfer(player, port);
      },
      notify: (to, text) => {
        for (const player of recipients(to)) player.sendMessage(text);
      },
      chime: (name, chime) => {
        const player = playerNamed(name);
        if (player) playChime(player, chime);
      },
      closeForms: (name) => {
        const player = playerNamed(name);
        if (player) uiManager.closeAllForms(player);
      },
      teamPicks: {
        open: (name, view) => {
          const open = teamForms.get(name);
          if (open?.showing) return open.update(view);
          open?.close();
          const player = playerNamed(name);
          if (!player) return;
          const form = new TeamPickForm(player, view, (team) => lobby.pickTeam(name, team));
          teamForms.set(name, form);
          void form.show();
        },
        update: (name, view) => {
          try {
            teamForms.get(name)?.update(view);
          } catch (error) {
            log.warn(`team form for ${name}: ${describeError(error)}`);
          }
        },
        close: (name) => {
          teamForms.get(name)?.close();
          teamForms.delete(name);
        },
        hologram: (view) => hologram.show(teamsContent(view)),
      },
      countdown: (view) => hologram.show(countdownContent(view)),
      startEnded: (started) => {
        if (started) stats.forgetPlaces();
        terminal.startEnded(started);
      },
    },
    root,
    { registry, devMinPlayers: vars.devMinPlayers, demoGames: demoGames(vars.devDemoGames) },
  );
  /** The live team forms while players pick teams for a game that's starting, by player name. */
  const teamForms = new Map<string, TeamPickForm>();
  const stats = new StatsController(
    {
      send: (event) => transport.send(event),
      notify: (name, text) => playerNamed(name)?.sendMessage(text),
      playersMenu: async (name, scope, view) => {
        const player = playerNamed(name);
        return player ? showMenu(scope, player, playersForm(view)) : undefined;
      },
      statsMenu: async (name, scope, view) => {
        const player = playerNamed(name);
        return player ? showMenu(scope, player, statsForm(view)) : undefined;
      },
    },
    root,
    { registry },
  );
  // The terminal sits at the map's "terminal" point (the middle block of its 3x3 console).
  const [tx, ty, tz] = vars.mapConfig.points?.terminal?.[0] ?? [0, 65, 0];
  const overworld = world.getDimension("overworld");
  // The build gives the hologram the same picture lists (game pictures, map previews, placeholders;
  // badges and players' skin renders).
  useSkins(skins);
  const hologram = new Hologram(overworld, { x: tx, y: ty, z: tz }, holoPictures(registry), holoPortraits(skins));
  const terminal = new TerminalController(
    {
      mainMenu: async (name, scope) => {
        const player = playerNamed(name);
        if (!player) return undefined;
        const choice = await showMenu(scope, player, mainMenuForm(vars.devHoloPreview));
        return choice === undefined || choice === CLOSE ? choice : MAIN_MENU_CHOICES[choice];
      },
      previewMenu: async (name, scope) => {
        const player = playerNamed(name);
        const answer = player ? await showForm(scope, player, previewForm()) : undefined;
        return answer?.selection === undefined ? undefined : PREVIEW_SCREENS[answer.selection]?.id;
      },
      gamesMenu: async (name, scope, choices) => {
        const player = playerNamed(name);
        return player ? showMenu(scope, player, gamesForm(choices)) : undefined;
      },
      gameMenu: async (name, scope, view) => {
        const player = playerNamed(name);
        return player ? showMenu(scope, player, gameForm(view)) : undefined;
      },
      stats: (name, scope, show) => stats.openStats(name, show, scope),
      choices: () => lobby.choices(),
      busy: () => lobby.busy(),
      request: (name, game, map, settings) => lobby.request(name, game, map, settings),
      starting: () => lobby.starting,
      reopenTeamPick: (name) => lobby.reopenTeamPick(name),
      notify: (name, text) => playerNamed(name)?.sendMessage(text),
      closeForms: (name) => {
        const player = playerNamed(name);
        if (player) uiManager.closeAllForms(player);
      },
      distance: (name) => {
        const player = playerNamed(name);
        if (!player) return undefined;
        const { x, z } = hologram.center;
        return Math.hypot(player.location.x - x, player.location.z - z);
      },
      hologram: (view) => hologram.show(view),
    },
    root,
    { now: () => system.currentTick },
  );
  tapTerminal = (name) => void terminal.tap(name);
  // map.json "stars": the star box sits where the hologram's display does (in the ticking area).
  const { x: cx, y: cy, z: cz } = hologram.center;
  const stars = vars.mapConfig.stars === true ? new StarBox(overworld, { x: cx, y: cy + 2, z: cz }) : undefined;
  // The area may only load once a player is near; ensure() is cheap once everything is there.
  let placed = false;
  let starsLogged = false;
  const place = () => {
    const ok = hologram.ensure();
    if (ok && !placed) terminal.refresh();
    placed = ok;
    if (!ok || !stars) return;
    try {
      stars.ensure();
    } catch (error) {
      if (!starsLogged) log.warn(`could not place the star box: ${describeError(error)}`);
      starsLogged = true;
    }
  };
  root.interval(place, 100);
  // Keep the terminal's area loaded, so it's built before anyone joins.
  const TICKING_AREA = "minecade_terminal";
  if (!world.tickingAreaManager.getTickingArea(TICKING_AREA)) {
    world.tickingAreaManager
      .createTickingArea(TICKING_AREA, {
        dimension: overworld,
        from: { x: tx - 1, y: ty, z: tz - 1 },
        to: { x: tx + 1, y: ty + 5, z: tz + 1 },
      })
      .then(place, (error: unknown) => log.warn(`could not keep the terminal loaded: ${describeError(error)}`));
  }

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
    if (isWatcher(player.name, watcherName)) {
      // Spectators are invisible to everyone else and can't touch anything.
      normalizePlayer(player, GameMode.Spectator);
      player.teleport(spawn);
      return;
    }
    // Effects, input locks, items or a spectator game mode can follow a player back from a game.
    normalizePlayer(player);
    // Rejoining players otherwise appear wherever they logged out.
    sendToSpawn(player);
  }

  function sendToSpawn(player: Player): void {
    if (spawnFacing) player.teleport(spawn, { rotation: { x: spawnFacing.pitch, y: spawnFacing.yaw } });
    else player.teleport(spawn, { facingLocation: hologram.center });
  }

  root.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    // A teleport during the spawn itself can be overridden by the client, so wait 2 ticks.
    root.timeout(() => {
      setUp(player);
      if (!placed) place();
      if (player.isValid && !isWatcher(player.name, watcherName)) lobby.onPlayerJoined(player.name);
    }, 2);
  });
  root.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
    stats.onPlayerLeft(playerName);
    terminal.onPlayerLeft(playerName);
    lobby.onPlayerLeft(playerName);
    teamForms.delete(playerName);
    lastTap.delete(playerName);
  });

  // Anyone who walks or falls out of the lobby area (or into a kill region) goes back to spawn.
  if (map.bounds || map.killY !== undefined || map.killRegions.length > 0) {
    root.interval(() => {
      for (const player of lobbyPlayers()) {
        if (map.outOfBounds(player.location)) sendToSpawn(player);
      }
    }, 10);
  }

  // After a script reload, players are already here.
  for (const player of world.getAllPlayers()) setUp(player);
});

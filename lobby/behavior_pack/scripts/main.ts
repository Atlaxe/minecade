// Lobby server script: places the terminal and its hologram, keeps players on the platform, and
// connects the terminal, game starting and stats logic (terminal-controller.ts,
// lobby-controller.ts, stats-controller.ts) to players, forms and the orchestrator.
import { system, world, type Player, type Vector3 } from "@minecraft/server";
import { uiManager } from "@minecraft/server-ui";
import { describeError, holoPictures, holoPortraits, log, normalizePlayer, playChime, showForm } from "@minecade/minigame-core";
import { bootServer } from "@minecade/minigame-core/bootstrap";
import registry from "#registry";
import { demoGames } from "./demo-games.ts";
import { teamsContent } from "./holo-content.ts";
import { Hologram } from "./hologram.ts";
import { LobbyController } from "./lobby-controller.ts";
import { PREVIEW_SCREENS } from "./holo-preview.ts";
import { MAIN_MENU_CHOICES, gameForm, gamesForm, mainMenuForm, playersForm, previewForm, statsForm } from "./menus.ts";
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

function playerNamed(name: string): Player | undefined {
  return world.getAllPlayers().find((player) => player.name === name);
}

function recipients(to: string): Player[] {
  if (to === "all") return world.getAllPlayers();
  const player = playerNamed(to);
  return player ? [player] : [];
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
      startEnded: () => terminal.refresh(),
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
        return player ? (await showForm(scope, player, playersForm(view)))?.selection : undefined;
      },
      statsMenu: async (name, scope, view) => {
        const player = playerNamed(name);
        return player ? (await showForm(scope, player, statsForm(view)))?.selection : undefined;
      },
    },
    root,
    { registry },
  );
  // The terminal sits at the map's "terminal" point (the middle block of its 3x3 console).
  const [tx, ty, tz] = vars.mapConfig.points?.terminal?.[0] ?? [0, 65, 0];
  const overworld = world.getDimension("overworld");
  // The build gives the hologram the same picture lists (game pictures, map previews, placeholders; badges).
  const hologram = new Hologram(overworld, { x: tx, y: ty, z: tz }, holoPictures(registry), holoPortraits());
  const terminal = new TerminalController(
    {
      mainMenu: async (name, scope) => {
        const player = playerNamed(name);
        if (!player) return undefined;
        const answer = await showForm(scope, player, mainMenuForm(vars.devHoloPreview));
        return answer?.selection === undefined ? undefined : MAIN_MENU_CHOICES[answer.selection];
      },
      previewMenu: async (name, scope) => {
        const player = playerNamed(name);
        const answer = player ? await showForm(scope, player, previewForm()) : undefined;
        return answer?.selection === undefined ? undefined : PREVIEW_SCREENS[answer.selection]?.id;
      },
      gamesMenu: async (name, scope, choices) => {
        const player = playerNamed(name);
        return player ? (await showForm(scope, player, gamesForm(choices)))?.selection : undefined;
      },
      gameMenu: async (name, scope, view) => {
        const player = playerNamed(name);
        return player ? (await showForm(scope, player, gameForm(view)))?.selection : undefined;
      },
      stats: (name, show) => stats.openStats(name, show),
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
  // The area may only load once a player is near; ensure() is cheap once everything is there.
  let placed = false;
  const place = () => {
    const ok = hologram.ensure();
    if (ok && !placed) terminal.refresh();
    placed = ok;
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
    // Effects, input locks, items or a spectator game mode can follow a player back from a game.
    normalizePlayer(player);
    // Rejoining players otherwise appear wherever they logged out. Everyone faces the terminal.
    player.teleport(spawn, { facingLocation: hologram.center });
  }

  root.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    // A teleport during the spawn itself can be overridden by the client, so wait 2 ticks.
    root.timeout(() => {
      setUp(player);
      if (!placed) place();
      if (player.isValid) lobby.onPlayerJoined(player.name);
    }, 2);
  });
  root.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
    stats.onPlayerLeft(playerName);
    terminal.onPlayerLeft(playerName);
    lobby.onPlayerLeft(playerName);
    teamForms.delete(playerName);
    lastTap.delete(playerName);
  });

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

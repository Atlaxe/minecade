# Minecade

A private, Hive-style minigame network for Minecraft Bedrock, for a handful of friends. It runs on
your own Windows PC with Docker, only while you want it: a lobby where anyone can pick a game,
game servers that start on demand, and automatic transfers between them. Players on Xbox,
PlayStation, PC and phone can all join.

- **Lobby** (port 19132): a holographic terminal where anyone can pick a game or look up stats.
- **Game server** (port 19133): one game at a time, started from a fresh copy of its map and
  removed when the game ends.
- **Orchestrator:** starts and stops game servers, routes players, and stores player stats.
- **Minecade Panel:** a small Windows app to start and stop everything, edit settings, read logs
  and see player stats.

Everything runs on the official Bedrock Dedicated Server (BDS) with TypeScript behavior packs.

## Games

| Game | Players | What it is |
|---|---|---|
| Sumo | 2-6 | Hits only push. Knock everyone off the platform; last one standing wins. |
| Probe | 1-8 | A 15 second test game that exercises the whole flow. |

More games are planned (Arena, Search and Destroy, Paintball, One in the Quiver, Microbattles,
Build Battle, Prophunt, Zombies, Hide and Seek, Block Drop). See [Adding a game](#adding-a-game).

## Requirements

- Windows 10 or 11 with [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.44.2
  or newer (WSL2 backend).
- [Node.js](https://nodejs.org/) 22.18 or newer, for the panel and the developer tools.
- A router where you can forward ports, and a public IP that isn't behind CGNAT (see
  [Router and firewall](#router-and-firewall)).
- Minecraft clients on the same version as the server (`BDS_VERSION`, currently 1.26.60).

## Setup

1. Get the code and its tools:

   ```
   git clone https://github.com/Atlaxe/minecade.git
   cd minecade
   npm ci
   ```

2. Copy `.env.example` to `.env` and fill it in:

   | Setting | What to put |
   |---|---|
   | `EULA` | `TRUE` to accept the [Minecraft EULA](https://www.minecraft.net/eula). The build refuses to download BDS without it. |
   | `LAN_HOST` | Your PC's LAN IP, for example `192.168.40.98`. Reserve it in your router so it never changes. |
   | `LAN_PLAYERS` | Gamertags of everyone playing from your home network, at least your own. See [why](#why-lan_players). |
   | `ALLOW_LIST` | Gamertags allowed to join, comma-separated. Empty means anyone with your address can join. |
   | `PUBLIC_HOST` | `auto` (looks up your public IP at start) or a DDNS hostname. |
   | `DEV_MIN_PLAYERS` | Empty normally. `1` lets every game start with one player, for testing alone. |
   | `DEV_DEMO_GAMES` | Empty normally. A number (up to 12) adds that many made-up games to the lobby's menus, for testing how they look with more games. They can't be started. |

3. Start everything, either way:
   - **Panel:** run `npm run panel:shortcut` once to put a "Minecade Panel" shortcut on your
     desktop, open it, and press Start.
   - **Command line:** `docker compose up -d --build`. Stop with `docker compose down`.

   The first start downloads BDS and builds the images, which takes a few minutes. Later starts
   take seconds.

The orchestrator sends everyone back to the lobby and removes a running game when it stops, so
stopping in the middle of a game is safe.

## Router and firewall

Forward these ports on your router to your PC's LAN IP (`LAN_HOST`):

| Name | External port | Internal port | Protocol |
|---|---|---|---|
| Minecade TCP | 19132-19134 | 19132-19134 | TCP |
| Minecade UDP | 19132-19134 | 19132-19134 | UDP |

Each server uses one TCP port and the UDP port with the same number: the lobby 19132, games
19133, and 19134 is reserved for a spare game server.

If friends can't connect even though the forwards are in place, allow the ports in Windows
Firewall (PowerShell as administrator):

```
New-NetFirewallRule -DisplayName "Minecade TCP" -Direction Inbound -Protocol TCP -LocalPort 19132-19134 -Action Allow
New-NetFirewallRule -DisplayName "Minecade UDP" -Direction Inbound -Protocol UDP -LocalPort 19132-19134 -Action Allow
```

**CGNAT check:** compare the WAN IP your router shows with the IP from
[api.ipify.org](https://api.ipify.org). If they differ, your provider shares one public IP
between customers and port forwarding can't work; ask them for a public IP.

## Connecting

The first time you join each server (the lobby and the game server), Minecraft asks you to trust
it. That happens once per server, not on every visit: the servers keep their identity in the
`minecade-keys` Docker volume.

**You, on the PC running the servers:** Servers tab, Add Server, your LAN IP (for example
`192.168.40.98`), port `19132`. If `127.0.0.1` is what fails, run this once (PowerShell as
administrator) and try again; you don't need it for the LAN IP:

```
CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"
```

**Others on your home network:** same as above, and add their gamertags to `LAN_PLAYERS`.

**Friends elsewhere on PC or phone:** Add Server with your public IP (or DDNS name), port `19132`.

**Friends on Xbox or PlayStation:** consoles can't add servers directly, so they use the public
[BedrockConnect](https://github.com/Pugmatt/BedrockConnect) DNS:

1. Set the console's DNS.
   - **Xbox:** Settings, General, Network settings, Advanced settings, DNS settings, Manual:
     primary `104.238.130.180`, secondary `8.8.8.8`.
   - **PlayStation:** Settings, Network, Settings, Set Up Internet Connection, (your network),
     Advanced Settings, DNS Settings, Manual: primary `45.55.68.52`, secondary `8.8.8.8`.
2. In Minecraft, open the Servers tab and join any featured server. The BedrockConnect menu
   opens instead.
3. Choose "Connect to a Server" and enter your public IP and port `19132`. They can save it there
   for next time.

Minecade doesn't host its own BedrockConnect: it would need port 19132 (the lobby's) and would
turn your PC into a public DNS server.

### Why LAN_PLAYERS

Servers move players with a transfer to an IP and port. Friends outside your network must be
sent to your public IP, but most home routers can't connect a device inside the network to the
network's own public IP ("NAT loopback"), so you would get "Multiplayer Connection Failed".
Gamertags in `LAN_PLAYERS` are sent to `LAN_HOST` instead.

## Playing

- **The terminal** (the glowing 3x3 console in the middle of the lobby): tap it for the menu.
  One player uses it at a time, and the hologram above it shows everyone what they're doing.
  - **Play:** pick a game, a map (or random), then confirm. Everyone in the lobby goes, up to the
    game's player limit. Anyone who arrives while a game is running waits for the next one.
  - **Stats:** your wins, kills, K/D and more, overall and per game.
- After the game, everyone is sent back to the lobby automatically.

Games wait up to 30 seconds for everyone to arrive, then count down with everyone frozen in
place. If too few players show up, the game ends and everyone goes back.

## Player stats

Every finished match with at least 2 players (or any co-op match) is recorded per player:
games, wins, losses, draws, win rate, kills, deaths, K/D, damage dealt and taken, time played,
best kill streak, matches left early, and each game's own counters. Players are tracked by their
Xbox account, so stats survive a gamertag change.

- **Where:** the `minecade-data` Docker volume: `stats.db`, a raw log of every match
  (`stats-events.jsonl`), and a backup at every start and once a day (`backups/`, newest 14
  kept). `docker compose down` and the panel's Stop keep it.
- **See them:** the Stats book in the lobby, the "Player stats" table in the panel, or
  `http://127.0.0.1:8080/v1/stats` and `http://127.0.0.1:8080/v1/stats/<gamertag>` on the PC.
- **Reset everything:** stop the stack, then `docker volume rm minecade-data`. This also
  deletes the backups.

## Updating BDS when consoles update

Clients refuse to join a server on a different version. When Minecraft updates:

1. Set `BDS_VERSION` in `.env` (and `.env.example`) and the default in `docker/bds/Dockerfile`
   to the new BDS version.
2. Update the script module versions in `tools/build/mc-versions.ts`, `MIN_ENGINE_VERSION`, and
   the matching `@minecraft/*` devDependencies in `package.json` (a test checks they agree).
3. `npm install`, `npm run check`, then `docker compose up -d --build` and `npm run smoke`.

## Development

| Command | What it does |
|---|---|
| `npm run check` | Typecheck everything and run all tests. |
| `npm run build` | Validate every game and map, and bundle the packs, worlds and orchestrator into `dist/`. The Docker build runs this too. |
| `npm run bake -- <target> <map>` | Build a map's world from its `map.json` (see [docs/maps.md](docs/maps.md)). |
| `npm run smoke` | End-to-end test with no players: rebuild, start Sumo, check the container and ports, let it end, check cleanup. Add `-- --no-build` to skip the rebuild. |
| `npm run cmd -- <container> <command>` | Send a console command to a running server, for example `npm run cmd -- minecade-lobby list`. |
| `npm run panel` | Run the Minecade Panel from the terminal. |

**Debug API** (this PC only, `127.0.0.1:8080`): `GET /v1/status`, `POST /v1/start`
(`{"game": "sumo", "map": "random"}`), `POST /v1/end`, `GET /v1/stats`,
`GET /v1/stats/<gamertag>`.

**Logs:** `docker compose logs -f orchestrator` shows sessions, game script output and stats.
Game servers are deleted when their game ends, so their script lines are copied into the
orchestrator's log.

**Transports:** `TRANSPORT=http` (default) has packs talk to the orchestrator over HTTP;
`TRANSPORT=log` uses console log lines and stdin instead. Both are fully supported.

### Layout

```
packages/minigame-core/   shared runtime: scopes, transfers, forms, the minigame framework, protocol
lobby/                    the lobby's behavior pack and map
games/<id>/               one folder per game: game.config.ts, behavior_pack/, maps/, test/
orchestrator/             the session manager, transport links, stats store, debug API
tools/build/              build, bake and console tools
tools/control-panel/      the Minecade Panel
tools/smoke/              the smoke test
docker/bds/               the server image and its entrypoint
docs/                     map format and measured BDS behavior
```

### Adding a game

1. Copy `games/sumo` to `games/<id>` and give `behavior_pack/manifest.json` two new UUIDs (the
   build rejects duplicates). Replace `icon.png` (the game's 16:9 picture, such as 320x180,
   in the lobby's game grid and on the hologram; every game needs one).
2. Edit `game.config.ts`: name, player counts, timers, teams, respawns, combat, win rule,
   scoring, kits, which stats to record, and any `options` for the lobby's game screen (see
   `docs/ui.md`). The fields are documented in
   `packages/minigame-core/src/config.ts`, and the build validates them.
3. Write the game in `behavior_pack/scripts/`: a class extending `Minigame` that overrides only
   what's different. The framework already handles waiting, the countdown, teams, deaths without
   a death screen, kill credit, respawns, win checks, the sidebar, stats and cleanup. Hooks and
   helpers are documented in `packages/minigame-core/src/game/minigame.ts`.
4. Add a map under `maps/<map-id>/` and bake it. An optional `preview.png` there (16:9, such
   as a screenshot) shows on its map tile.
5. Test it with the fake world in `test/` (see `games/sumo/test/sumo.test.ts` and
   `packages/minigame-core/test/game-harness.ts`), then `npm run check`, `npm run build` and
   `docker compose up -d --build`. It appears in the lobby's Game Selector.

### Adding a map

Write a `map.json` and run `npm run bake`, or drop in a world built in the client. Both are
described in [docs/maps.md](docs/maps.md).

## Checklist before a game night

Run `npm run smoke` first, then check by hand with a console or phone player if you can:

1. Join the lobby, facing the terminal; its hologram says "Tap the terminal".
2. Tap the terminal, choose Play, pick Sumo and confirm. Everyone sees the countdown and is
   transferred.
3. On the game server: the countdown freezes everyone, then the match starts.
4. Play to a win. The winner's title shows, then everyone is back in the lobby within about 10
   seconds.
5. Tap the terminal and open Stats: the match is counted.
6. `docker ps` shows no `minecade-game-` container.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Multiplayer Connection Failed" when the lobby sends you to a game | Add your gamertag to `LAN_PLAYERS` ([why](#why-lan_players)). Check the orchestrator log for the address it used. |
| Friends can't connect at all | Check the port forwards, the firewall rules and CGNAT ([Router and firewall](#router-and-firewall)), and that `PUBLIC_HOST` resolves to your current public IP. |
| "Outdated server" or "Outdated client" | The client and `BDS_VERSION` differ. See [Updating BDS](#updating-bds-when-consoles-update). |
| Asked to trust the server every time | The `minecade-keys` volume is missing or was deleted. It is recreated on the next start; trust once more. |
| A game seems stuck | Panel: End game, or `curl -X POST http://127.0.0.1:8080/v1/end`. The orchestrator also ends a game that stays empty for 3 minutes. |
| "Couldn't start" or "failed to start" in the lobby | Read `docker compose logs orchestrator`. A port still held by Docker for a moment is retried automatically. |
| The Stats book says stats are unavailable | The orchestrator isn't answering or storage is off. Look for "stats storage is off" in its log. |
| The panel says its port is reserved | Windows reserved the port range. See `netsh interface ipv4 show excludedportrange protocol=tcp`. |

# Milestone 10: map editor server (Select, Edit, Preview) (plan)

**Status:** approved 2026-10-30, not started. Next: part 10.0 (spike). The user calls the UI pass milestone 9; this is milestone 10, and the games come after it as milestones 11 and on.

**For the session that implements this:**
- Work in `C:\dev\minecade\network`.
- Stop and report after each part. Commit and push after each part, with no attribution, committing only that part's files.
- Deploy only when nobody is online.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- The architecture plan is `~/.claude/plans/project-scaffold-a-private-dazzling-mochi.md`, and `docs/spike-results.md` records what earlier spikes found.

## Context

The main server, minigame core and lobby are nearly done. Next comes a run of games, each one its own milestone, built and tested on a test map.

Today, giving a map game data means editing `map.json` by hand, checking coordinates in the client, and copying world folders around (the spaceship lobby went in that way). You build maps in Java, several to a world, and convert them to Bedrock yourself with Chunker.

This milestone turns the spare port (19134) into a **map editor server** with three modes:
- **Select:** open one of your converted Bedrock worlds, box a map, and confirm. The map is extracted into its own void world, centered at 0,0.
- **Edit:** in that void world, visual tools set spawns, the spectator spawn, bounds, killY, kill regions, team spawns, named points, regions and preview cameras. Every change is written straight to `map.json`.
- **Preview:** play the map in the real game (or, for a lobby map, as the lobby) without rebuilding images, then come back to Edit.

Each game declares the map data it needs in `game.config.ts`. The editor turns that into a checklist with a tool for each entry, so a new game needs no new editor code. Lobbies work the same way.

Follows the usual rules: stop and report after each part, commit and push after each part, no em dashes, no emojis, US spelling.

## Your decisions

| Topic | Decision |
|---|---|
| Sources | You build in Java and convert with Chunker yourself. The editor starts from a converted Bedrock world: one in your client's worlds folder, any folder, or a `.mcworld`. `.nbt` and `.schematic` files are pasted into a Java world before converting |
| Modes | Select (box a map in the converted world and confirm), Edit (set the data in the map's own void world), Preview (play it) |
| Import result | A void world holding only the selected box, centered at x 0, z 0 (y kept) |
| Controls | npm commands do the work; a Map editor section in the Minecade Panel calls the same code |
| Joining | Port 19134 is open. `LAN_PLAYERS` are let in automatically; everyone else must be on `EDITOR_ALLOW_LIST` |
| Roles | **Map editors** (`MAP_EDITORS`; empty means everyone in `LAN_PLAYERS`) get the tools, mode switches and Preview. Everyone else who joins is a **builder**: creative mode only |
| Player management | In game: map editors add and remove allow-list entries and switch players between builder and editor from a Players screen. Changes take effect at once and are saved to `.env`, so the Panel shows the same lists |
| Mode switches | Players wait in the lobby while the editor restarts, then are sent back automatically. Nobody rejoins by hand |
| Mode on screen | The top-right box that shows the game clock shows the mode instead: Select, Edit, or Build (a builder in Edit mode) |
| Building | No build helpers. Big changes happen in Java, then "Update from world" replaces the blocks and keeps the map data |
| Spawn facing | A "Save my facing" toggle on the spawn form. It is off by default, so the spawn faces the map center as it does today |
| First-version extras | Mirror tool; inspect mode with colored, walk-through **boundary blocks** whose layers you toggle in a form |
| Preview pictures | A placeable camera that saves a position and view angle. Look through it to take the screenshot. Map previews have no players in them; game pictures can |
| Unfinished maps | `"draft": true`; builds skip drafts, and "Mark ready" removes the flag |
| Lobbies | Same editor and modes. `lobby/lobby.config.ts` declares spawn and terminal. `LOBBY_MAP` picks the live lobby |
| Order | Editor core, then Select (import), then games |

## How it fits

```
your PC (host)                                     Docker
  npm run editor (or the Panel)  ---------------->  minecade-editor (BDS, port 19134, IDENTITY=editor)
   - picks the world for the mode                     Select: a copy of your converted world
   - extracts selections in the background            Edit:   games/<game>/maps/<id>/world (void)
   - reads [EDIT] lines, writes map.json   <-------   editor pack: tools, forms, markers, boundary blocks
   - answers with scriptevent minecade:edit ----->    (state, checklist problems, undo results)
   - saves the world back into maps/<id>/world
  extraction: minecade/chunker (prune) + temporary BDS (crop and recenter), no ports
  Preview: orchestrator starts the real game from your local build (DEV_LIVE_MAPS)
```

- **One editor server at a time:** one world on 19134.
  - It is created by the host tool, not by compose or the orchestrator. Its label is `minecade.role=editor` (never `managed-by=orchestrator`), so orchestrator cleanup leaves it alone.
  - The warm spare game server planned for 19134 can't run while the editor does.
- **Switching modes means switching worlds,** so the server restarts. Everyone waits in the lobby meanwhile and comes back automatically (see "Mode switches through the lobby").
  - Extraction runs in a separate temporary container, so you can keep selecting maps while earlier ones extract.
- **What is saved when:**
  - `map.json` is written to the repo on every change, and git is its history.
  - The world is saved on "Save world", when you switch modes, and when you stop.
- **Messages:** the pack applies an edit at once (instant visuals) and sends the edit op. The host applies the same op with the same shared code, writes the file, and runs validation.
  - If the two copies disagree, the host sends a full resync.
  - Hand edits to `map.json` in VS Code during a session are pushed into the game.

## Map format v2 (backward compatible: every existing map.json stays valid and unchanged)

- **Facing:** a position is `[x, y, z]` (faces the map center, as today) or `[x, y, z, yaw, pitch]` (a fixed facing).
  - It applies to `spawns`, `teamSpawns`, `spectatorSpawn` and `points`.
  - Core honors it in `spawn()`, `spectate()` and `placeWaiting` in `packages/minigame-core/src/game/minigame.ts`. `MapView` exposes it.
- **Kill regions:** the reserved region name `kill`. Anyone inside a `regions.kill` box is out, the same as falling below killY. It goes in `watchBounds` and `MapView.outOfBounds`.
- **Per-team points and regions:** keys of the form `<name>.<team>`, for example `buyZone.red`. `MapView.points(name, team?)` and `regions(name, team?)` read them. The mirror tool maps `.red` to `.blue`.
- **Requirements a game declares:** the `map` block in `game.config.ts` takes richer descriptors. The current `string[]` and `boolean` forms still work.
  ```ts
  map: {
    spawns: { min: "maxPlayers" },            // the default
    teamSpawns: { perTeam: 5 },
    spectatorSpawn: true,
    killY: true,
    points: { bombA: { label: "Bomb site A", count: 1 }, bombB: { label: "Bomb site B", count: 1 } },
    regions: { buyZone: { label: "Buy zone", perTeam: true } },
  }
  ```
  - The registry carries these requirements and the team ids, so the editor pack knows what to ask for.
  - The lobby declares its own in a new `lobby/lobby.config.ts` (1 spawn and `points.terminal`). The registry gains a `lobby` entry with those requirements and the lobby's maps.
- **Draft maps:** `"draft": true` marks a map as unfinished.
  - Extraction creates drafts. The normal build skips them with a warning, so a half-done map never blocks `npm run build` or `docker compose up --build`.
  - The Preview build includes the map being previewed once its checklist is complete.
  - "Mark ready" in the map menu removes the flag.
- **Editor-only keys** (the build strips them from shipped copies, as it already does with `build`):
  - `source`: the converted world's name, the selected box, and the offset applied. "Update from world" uses it.
  - `cameras`: the preview cameras: `{ "<name>": { "at": [x, y, z, yaw, pitch], "kind": "map" | "game" } }`.
- **One shared validator:** `validateMapConfig` moves from `tools/build/validate.ts` into minigame-core. It only imports types, so the editor pack can bundle it and show the build's exact problems live in-game. The build re-exports it.
  - **New checks:** killY within the y range, `teamSpawns` keys must be the game's team ids, per-team counts, warnings for duplicate positions, and requirement descriptors.
- **Stable formatting:** a formatter writes `map.json` in today's hand-written style, so the editor's diffs stay small and readable. Key order and unknown extras are kept.

## The editor server

- **Container:** `minecade-editor`, image `minecade/bds:local`, port 19134 TCP and UDP, `IDENTITY=editor` (players accept trust once), log transport.
- **Entrypoint changes** (`docker/bds/entrypoint.sh`), in a new editor mode:
  - the world comes from a staged directory, not the template;
  - `gamemode creative` without `force-gamemode`;
  - the allow list is `LAN_PLAYERS` plus `EDITOR_ALLOW_LIST`;
  - the mode, `MAP_EDITORS`, `mapConfig` and the requirements are written into `variables.json`.
- **Host CLI** (long-running, like bake):
  - `npm run editor -- select "<world name or folder>"` starts Select mode.
  - `npm run editor -- <target> <map>` starts Edit mode on an existing map.
  - `npm run editor -- <target> <map> --new` starts Edit mode on a new void world with a small glass pad, for a quick test map.
- **While running, the host:**
  - stages the world with `putArchive`, starts the server, attaches the console;
  - ops the map editors when they join (`op` from the console, after their `Player connected` line);
  - applies edits, logs every change with the gamertag, keeps undo and redo, and runs mode switches.
- **Stop or switch:**
  1. The pack cleans up (removes markers and boundary blocks, and reports that none are left).
  2. The world is copied out.
  3. level.dat gets the bake settings (noon, no weather or mobs, void generator, spawn from `spawns[0]`).
  4. `maps/<id>/world` is swapped in with the `world.new` rename that bake uses.
- **Hot save:** "Save world" while the server runs uses `save hold`, then `save query`, a copy, and `save resume`.
- **Baked maps:** if a map has a `build` section, the editor warns that `npm run bake` would overwrite world edits. Saving the world offers to drop `build`.

## Mode switches through the lobby

The lobby is the waiting room while the editor restarts into another world, so nobody has to rejoin by hand.

1. **Before the switch:** a map editor picks a mode switch (for example, Castle, then Edit). The host calls a new debug API route, `POST /v1/editor/hold {players, label}`.
   - The orchestrator passes it to the lobby as a new message, `editor_hold`.
   - The lobby marks those players as waiting for the editor.
2. **Leaving:** the editor saves and cleans up as usual. Then `TransferService` sends everyone to the lobby, using the same LAN or public routing that games use.
3. **Waiting in the lobby:**
   - the top-right box reads "Editor: switching to Edit (Castle)";
   - a game started from the terminal doesn't take them along;
   - the terminal still works, so they can look around or check stats.
4. **Coming back:** when the editor logs `Server started.` and its pack is ready, the host calls `POST /v1/editor/return {port: 19134}`.
   - The orchestrator sends `editor_return` to the lobby, and the lobby transfers the waiting players to the editor.
5. **Timeout:** if the editor isn't back within 3 minutes (a failed extraction or a crash), the lobby releases them with a message, and the Panel shows the error.

**Protocol:** these messages bump `PROTOCOL_VERSION` to 7 and join the message allow-lists in `packages/minigame-core/src/protocol/messages.ts`.

**Requirements:** this needs the main stack (lobby and orchestrator).
- When the editor starts and the stack is down, the CLI and the Panel offer to start it (`docker compose up -d`, no rebuild). Preview needs it anyway.
- Without it, a mode switch falls back to "rejoin in about 30 seconds".

**Preview doesn't restart the editor.** Players go from the editor to the game and back, and the editor stays in Edit mode the whole time.

## Player management (in game)

**Players screen:** in the map menu, for map editors only.
- **Online players:** each one with their role. Tap to switch between Editor and Builder; it takes effect at once:
  - the tools are given or taken away;
  - the player is opped or deopped from the console.
- **Allow list:**
  - the `EDITOR_ALLOW_LIST` entries, with Remove (and "kick if online");
  - Add, with a gamertag text field.
  - `LAN_PLAYERS` are shown as always allowed. They can only be changed in the Panel, because they also route players on the main network.
- **Recently refused:** gamertags the server turned away, with one tap to allow. Only if BDS logs refused joins; the spike checks.

**Saving:**
- The host applies allow-list changes live with `allowlist add` and `allowlist remove` on the console.
- It writes `EDITOR_ALLOW_LIST` and `MAP_EDITORS` to `.env`, reusing the Panel's env editing code in `tools/control-panel/core.ts`. The Panel and the next start see the same lists.

**Safety:**
- You can't demote yourself, and the last map editor can't be demoted.
- Every change is logged with who made it.

## Mode on screen

The editor reuses the top-right box the game clock uses (`packages/minigame-core/src/hud.ts` and `resource_pack/ui/hud_screen.json` in the core pack, which every server already gets).
- **What it shows:**
  - **Select** in Select mode;
  - **Edit** for map editors in Edit mode;
  - **Build** for builders in Edit mode;
  - in Preview, the game's own clock takes the box, as usual.
- **How it works:**
  - A second mark, `HUD_MODE_MARK`, uses the same box with a mode icon instead of the clock icon.
  - Inspect mode adds its readout to the same line, for example "Edit   in bounds, 12 above killY, buyZone.red".
  - The action bar can only hold one line, so mixing the two would make them compete.
  - The editor refreshes the line about twice a second, so it never fades.
- **The lobby** uses the same box for waiting players ("Editor: switching to Edit (Castle)").

## Select mode

- **Picking the world:** the Panel lists the worlds in your client's folder by name (`%APPDATA%\Minecraft Bedrock\Users\<id>\games\com.mojang\minecraftWorlds`, read from each `levelname.txt`). You can also browse to any folder or `.mcworld`.
- **The copy:** the editor runs on a copy, so your converted world is never changed. The copy's level.dat gets the void generator, so flying past the converted area doesn't grow new terrain.
- **Select tool:**
  - Hit a block for corner 1, use the tool on a block for corner 2. The box shows in boundary blocks, and you can nudge each side.
  - "Shrink to build" trims the box to the blocks actually inside it, leaving a margin you choose.
- **Confirm form:**
  - **Target:** Lobby, or a game from the registry;
  - **Map id**, for example `castle`;
  - **Name**, for example "Castle".
- **Extraction** runs in the background. The menu lists each selection with its status (queued, extracting, ready, failed). For each box:
  1. A Chunker container (`minecade/chunker`: a pinned Chunker CLI jar, Bedrock to Bedrock, no conversion) prunes the original world down to the box's chunks.
  2. A temporary BDS with no ports (the bake pattern) does three things:
     - clears whatever lies outside the box in those chunks (neighboring maps spill in at chunk edges);
     - moves the box so its center sits at x 0, z 0, using script-API structure tiles (blocks, block entities, item frames and paintings come along);
     - clears the old spot.
  3. Chunker prunes again, to the new chunks only, and level.dat gets the bake settings.
  4. The result is written to `games/<game>/maps/<id>/world` (or `lobby/maps/<id>/world`), with a draft `map.json`: name, `draft`, bounds set to the moved box, one spawn at the center, and `source`.
- **Moving on:** "Edit <map>" on a ready map switches the server to Edit mode on it.
- **Where selections are kept:** `work/select/<world name>.json` (gitignored), so you can come back to the same world later. The box and offset are also in each map's `source`.
- **Update from world:** after you change a map in Java and convert again, pick the new world in Select mode and choose "Update" on that map.
  - It replaces only `world/` and reuses the stored box and offset, so the spawns, regions and other data stay where they were.
  - Builder fixes made in Edit mode are lost, and the editor says so first.

## Edit mode tools

All of these are items with their own icons and forms. `showForm` handles the busy retry. Map editors get them from the map menu; builders get nothing extra.

1. **Map menu** (item in slot 9, or `/mc:map`):
   - shows the map name and game;
   - **checklist:** every requirement in red or green with counts. Tap one to get its tool or to teleport to the problem;
   - the Layers form, inspect mode on and off, undo and redo, Save world, Mark ready;
   - **mode switches:** Back to Select (when the map has a `source`), Preview;
   - Players (see "Player management");
   - map settings: name, plus game extras as text fields.
2. **Spawn tool:** use it to place an entry at your feet, in block coordinates.
   - **Form:**
     - **Target list:** Spawns, a team's spawns, Spectator spawn, or a point by name from the requirements.
     - **"Save my facing" toggle:** off means face the center.
     - **Snap:** exact, 45 degrees, or 90 degrees.
   - **Markers:** each entry is a marker entity with its number, its list's color, and an arrow for a saved facing.
   - **Editing:** hit a marker to open its form: move here, take my facing, clear facing, change list, renumber, delete.
3. **Region tool** (the select tool's corners):
   - **Form:** save as Bounds, as a named region (new, or one from the requirements, per team if declared), or as a Kill region. You can nudge each side, and "Floor at killY" lines the bottom up.
   - Sneak and use the tool inside an existing region to edit or delete it.
4. **Kill Y tool:** sets killY one block below your feet, or to a number typed in the form. Its layer draws the plane.
5. **Mirror tool:** for symmetric team maps.
   - **Mode:** rotate 180 degrees, or flip on X or Z.
   - **Center:** the bounds center, or where you stand.
   - **What:** from one team to another; spawns, team points and team regions. Yaw is mirrored too.
   - Ghost markers preview the result before Apply, and Apply is one undo step.
6. **Inspect mode:**
   - A readout in the top-right box, after the mode, as you walk: inside or outside bounds, height above killY, which regions you are in, the nearest spawn.
   - On a lobby map, leaving the bounds reads "sent back to spawn".
7. **Boundary blocks and layers:**
   - **The block:** `minecade:boundary` has no collision and a translucent tint, so you can walk through it. A color state gives 16 colors.
   - **Placement:** blocks go only into air, along a box's edges or walls (the style is set in the Layers form).
   - **Layers form:** a toggle per layer: bounds (white), kill Y plane (red grid), kill regions (red), each named region (its own color, with a legend), team regions (team colors), the selection.
   - **Never saved:**
     - Before any world save, the pack removes every placed block (from its tracked list) and sweeps the bounds with a replace fill.
     - Saving stops unless the count of blocks left is 0.
     - The list of placed blocks is also kept in a world dynamic property, so a crash is cleaned up at the next start.
   - **Spawns and points use marker entities instead,** because markers can be hit to edit and can show numbers and facing.
8. **Camera tool** (preview pictures):
   - **Placing:** use it where you stand. A camera on a tripod appears, pointing the way you look, and saves your eye position and view angle into `cameras`.
     - It acts like a placed block, but it is a marker entity, so it can point at any angle and never ships in the world.
   - **Form:** a name, and the kind:
     - **Map preview:** no players in the shot. Other players are switched to spectator, so they're invisible, while someone looks through the camera.
     - **Game picture:** players stay in the shot, with their name tags hidden.
   - **Look through:** tap the camera. Your view locks to it (`camera.setCamera` with the free preset), and the HUD, markers and boundary blocks are hidden. Another player can walk into view, and you take the screenshot. Sneak to exit.
   - **Other options on tap:** Re-aim from my view, Delete.
   - **Saving the picture:** the Panel's "Use latest screenshot" takes the newest picture from your Captures folder, crops it to 16:9, and saves it as the map's `preview.png` (map preview) or the game's `icon.png` (game picture).
9. **Commands** (custom command API, `mc:` namespace, map editors only):
   - `/mc:map`, `/mc:spawn add [team]`, `/mc:tp spawn <n>`, `/mc:tp point <name> <n>`, `/mc:tp camera <name>`
   - `/mc:layer <name> on|off`, `/mc:undo`, `/mc:redo`, `/mc:save`

## Preview mode

- **Game maps** (needs the main stack running and `DEV_LIVE_MAPS=1`):
  1. "Preview" in the map menu saves the world and runs `npm run build`. A problem stops it.
  2. The orchestrator starts the real game on this map from your local `dist/templates` (mounted over the image's copy), with `returnPort: 19134`.
  3. When the game is ready, the editor transfers everyone to it.
  4. After the match, everyone lands back on the editor, still in Edit mode.
  - Refused while another game is running. `DEV_MIN_PLAYERS=1` covers solo tests.
- **Lobby maps:** there is only one lobby, so "Preview as lobby" restarts the real lobby on this map from your local build, using a `docker-compose.dev.yml` override that mounts `dist/templates`. It is refused while anyone else is in the lobby.
- **The lobby's map list** only shows new maps after a normal rebuild.

## Lobbies

- **Editing:** `npm run editor -- lobby spaceship`, or choose "Lobby" as the target in Select mode. The checklist comes from `lobby/lobby.config.ts` (spawn and terminal).
- **The terminal marker** shows the 3x3 terminal footprint and where the hologram floats, so you can check the clearance around it.
- **Going live:** `LOBBY_MAP` in `.env` (default `spaceship`, with a Panel dropdown) picks the live lobby. Today `MAP: spaceship` is hard-coded in `docker-compose.yml`.

## Panel

A Map editor section in `tools/control-panel/index.html`, backed by the same `tools/editor` modules under the panel's busy lock, with streamed output:
- **Select:** a world picker (client worlds by name, or browse), and the selections with their extraction status.
- **Edit:** target and map pickers (plus New map), the live checklist mirror, Save world, Mark ready.
- **Preview:** Preview, and Preview as lobby.
- **Server:** Start, Stop, which mode is running, and whether it's ready to join.
- **Pictures:** Use latest screenshot.
- **Settings:** `EDITOR_ALLOW_LIST`, `MAP_EDITORS` and `LOBBY_MAP`, edited like `ALLOW_LIST` today.
- **Container list:** `stackOf` in `core.ts` learns the editor container, so it shows up with a Logs button.

## Building a map, start to finish

This walkthrough becomes `docs/editor.md`. Its example turns the arena "Castle" from your Java world "Arenas" into a Search and Destroy map. That game doesn't exist yet: its milestone first declares the map requirements used below.

```
Java world (you build)
   |  Chunker (you convert, as today)
   v
Bedrock world "Arenas" (client folder, a folder, or .mcworld)
   |
   v
SELECT  box Castle, confirm --> background extraction --> games/sad/maps/castle/ (draft, centered at 0,0)
   ^                                                              |
   | Update from world (after Java changes)                       v
   +--------------------------------------------------- EDIT  spawns, regions, killY, cameras
                                                                  |        ^
                                                                  v        |
                                                            PREVIEW  play it, come back
                                                                  |
                                                                  v
                                      Mark ready --> commit --> rebuild --> live in the lobby
```

### 1. Convert (you, as today)
Convert the Java world with Chunker and save the Bedrock world in your client's worlds folder, or anywhere else. Nothing in the repo changes.

### 2. Select
1. **Start it:** in the Panel, Select, then pick "Arenas" from the list (or run `npm run editor -- select "Arenas"`). Then join `LAN_HOST:19134`; you accept the editor's trust prompt the first time only. Later switches go through the lobby automatically, so this is the only time you join by hand.
2. You arrive at the world's spawn in creative mode, holding the select tool and the map menu. The top-right box reads "Select".
3. **Box the map:** fly to Castle. Hit one corner, use the tool on the opposite corner, or box it roughly and press "Shrink to build".
4. **Confirm:** Target "Search and Destroy", map id `castle`, name "Castle".
5. **Extraction** starts in the background. Box the next map while it runs.
6. **Repo changes when it finishes:**
   - `games/sad/maps/castle/world/`;
   - a draft `map.json`:
     ```json
     { "name": "Castle", "draft": true, "spawns": [[0, 70, 0]],
       "bounds": { "min": [-48, 40, -40], "max": [48, 96, 40] },
       "source": { "world": "Arenas", "box": { "min": [1200, 40, -620], "max": [1296, 96, -540] }, "offset": [-1248, 0, 580] } }
     ```
   - The build still passes, because drafts are skipped.

### 3. Edit
1. **Switch:** in the menu, Castle, then Edit. You're sent to the lobby (the top-right box reads "Editor: switching to Edit (Castle)") while the server restarts into Castle's void world. About 20 to 30 seconds later you're sent back automatically, and the box reads "Edit".
2. **Checklist** for Search and Destroy:
   - bounds: done (from the box);
   - attacker spawns: 0 of 5;
   - defender spawns: 0 of 5;
   - spectator spawn: missing;
   - bomb sites A and B: missing;
   - buy zones for each team: missing.
3. **Bounds:** turn the Bounds layer on and check the box. Nudge its sides if needed.
4. **Attacker spawns:** spawn tool, list "Team spawns: attackers", "Save my facing" on, then place 5. Markers show the numbers and facing arrows.
5. **Defender spawns:** mirror tool, rotate 180 degrees, attackers to defenders. Check the preview, then Apply.
6. **Bomb sites and buy zones:** region tool, for bomb site A, bomb site B, and a buy zone per team.
7. **Spectator spawn:** spawn tool.
8. **Map edges:** Kill Y tool if the map has a void edge; kill regions over lava pits.
9. **Check:** inspect mode, walking the edges to see where the readout says "out".
10. **Small block fixes:** builders can make them. Use Save world after block changes. Bigger changes go back to Java (step 7).
11. **A friend joins to help:** add their gamertag in Players, then Allow list, Add. They arrive as a builder ("Build" in their box); switch them to Editor if they should place spawns too.

Every change shows in `map.json` at once (watch it in VS Code), and undo is in the menu or `/mc:undo`.

### 4. Pictures
- **Map preview:** place a camera with a nice view of Castle, kind "Map preview". Tap it, Look through, take the screenshot. Then in the Panel, Use latest screenshot, which saves `games/sad/maps/castle/preview.png`.
- **Game picture** (once per game, on any map): place a camera of kind "Game picture". A friend stands in the shot while you look through and screenshot. Use latest screenshot saves `games/sad/icon.png`.

### 5. Preview
1. With the main stack running, choose Preview in the map menu.
2. The build runs, Search and Destroy starts on Castle, and everyone on the editor is transferred.
3. After the match, everyone is back in Edit mode. Repeat steps 3 to 5 as needed.

### 6. Ship
1. When the checklist is complete, choose Mark ready (removes `draft`).
2. Stop the editor. The world is saved and cleaned.
3. Run `npm run check` and `npm run build`.
4. Commit `games/sad/maps/castle/` and push.
5. When nobody is online, run `docker compose up -d --build` (or Restart in the Panel). Castle appears on Search and Destroy's game screen.

### 7. Later: you changed Castle in Java
1. Convert again with Chunker.
2. In the Panel, Select, then pick the new world.
3. In the menu, Castle, then Update. Only `world/` is replaced; the spawns, regions and cameras stay put.
4. Preview again, then commit.

### Shorter paths
- **A test map for a new game:** `npm run editor -- sad test --new` (a void world with a glass pad, a draft `map.json`). Build the test arena, then steps 3 to 6. A plain platform can still come from `build.commands` and `npm run bake`.
- **A lobby:** the same steps, with target "Lobby".
  - Step 5 becomes Preview as lobby.
  - In step 6, set `LOBBY_MAP` to make it live.

### Where things live

| Folder | What | In git |
|---|---|---|
| your client's `minecraftWorlds/` (or any folder) | your converted Bedrock worlds, never modified | no |
| `work/` | Select copies, saved selections, extraction scratch | no |
| `games/<game>/maps/<id>/` | `map.json`, `world/`, `preview.png` | yes |
| `lobby/maps/<id>/` | the same, for lobbies | yes |

## Parts (stop and report after each, commit and push)

**10.0 Spike.** Uses one of your converted worlds. Results go in `docs/spike-results.md` under "Map editor". It checks:
1. **Chunker CLI in Docker:** prunes a Bedrock world to chosen chunks (Bedrock to Bedrock, same version), and BDS 1.26.60.6 loads the result. Fallback if it can't: delete chunk keys with a LevelDB tool in a container.
2. **Structure moves in BDS:** the largest tile `structureManager.createFromWorld` and `place` accept, that block entities and item frames survive, and how long a 100x60x100 map takes.
3. **Staging your converted world:** copy time into the container, and the void-generator patch on its level.dat.
4. **Editor basics on 1.26.60:**
   - custom items with icons, and the custom command API with 2.11.0;
   - the translucent, no-collision boundary block, including on console;
   - hits on marker entities, `TextPrimitive.visibleTo`, and `op` from the console.
5. **Camera:**
   - `camera.setCamera` with the free preset at an exact position and angle;
   - `setHudVisibility`;
   - spectators hidden from the viewer, and player name tags hidden for a shot.
6. **Hot save:** `save hold`, `query` and `resume`, with a copy while the server runs.
7. **Preview mount:** a bind mount of a host path into a container that the orchestrator creates (Docker Desktop path translation).
8. **Players:**
   - `allowlist add` and `allowlist remove` work live from the console;
   - whether BDS logs a join it refused for the allow list (for "Recently refused");
   - a transfer from the lobby to port 19134 and back works on the LAN and from outside.

**10.1 Map format v2 and core.**
- Facing entries, kill regions, per-team keys, requirement descriptors, drafts, `source` and `cameras` (stripped by the build).
- `lobby/lobby.config.ts`, and `LOBBY_MAP` in place of the hard-coded lobby map.
- The shared validator in core, requirements (games and lobby) in the registry, the formatter.
- Docs in `docs/maps.md`.

**10.2 Editor server and Edit mode basics.**
- Entrypoint editor mode, `npm run editor` for Edit mode and `--new` (stage, sync, undo, save, stop).
- Access lists and roles, and the in-game Players screen (live allow list, role switches, saved to `.env`).
- The mode in the top-right box (`HUD_MODE_MARK`).
- The pack's map menu, checklist and spawn tool with markers. That is enough to edit Sumo's `arena_1` end to end.

**10.3 Edit mode tools.**
- Region tool, Kill Y tool.
- Boundary blocks with the Layers form, inspect mode.
- Mirror tool, camera tool, `mc:` commands, hot save.

**10.4 Select mode.**
- World picker (client worlds by name, folders, `.mcworld`), select tool with Shrink to build, confirm form.
- Background extraction (Chunker prune, crop and recenter pass, draft map), switching to Edit, Update from world.
- Mode switches through the lobby:
  - protocol 7 (`editor_hold`, `editor_return`);
  - the orchestrator's `/v1/editor/hold` and `/v1/editor/return`;
  - lobby waiting players, the 3-minute timeout, and the offer to start the main stack.

**10.5 Preview mode:** `DEV_LIVE_MAPS`, Preview with the return to the editor, Preview as lobby.

**10.6 Panel section:** modes, world picker, status, settings, Use latest screenshot.

**Then milestones 11 and on, one per game:**
1. Declare the game's `map` requirements.
2. Select or create its test map and fill it in.
3. Build the game, and Preview it from the editor.

## Files

**New**
- `editor/behavior_pack/`:
  - `manifest.json` and `scripts/` (main, modes, menu, checklist, tools, markers, boundary layers, mirror, camera, commands, protocol);
  - `items/`, `blocks/boundary.json`, `entities/editor_marker.json`, `entities/editor_camera.json`.
- `editor/resource_pack/`: item icons, 16 boundary tints, the marker and camera models and textures.
- `packages/minigame-core/src/`:
  - `map-validate.ts`;
  - `map-edit.ts`: pure edit ops (add, move, remove, renumber, set facing, mirror), shared by the pack and the host;
  - `map-format.ts`.
- `tools/editor/`:
  - `editor.ts` (CLI), `session.ts`, `container.ts`, `protocol.ts`;
  - `worlds.ts`: lists client worlds by `levelname.txt`, and reads folders and `.mcworld` files;
  - `select.ts`, `extract.ts`, `chunker.ts`, `finish-core.ts`;
  - `screenshot.ts`: newest capture, cropped to 16:9.
- `docker/chunker/Dockerfile`: a Temurin JRE and a pinned Chunker CLI jar, used only for pruning.
- `lobby/lobby.config.ts`.
- `docker-compose.dev.yml`: mounts `dist/templates` for the lobby (Preview as lobby).
- `docs/editor.md`: the tools guide and the walkthrough above.
- Tests next to each of these.

**Changed**
- **Core** (`packages/minigame-core/src/`):
  - `map-config.ts`, `config.ts`, `registry.ts`, `game/map-view.ts`, `game/minigame.ts`;
  - `hud.ts` (`HUD_MODE_MARK`, a mode line);
  - `protocol/messages.ts` (protocol 7: `editor_hold`, `editor_return`).
- **Core resource pack:** `packages/minigame-core/resource_pack/ui/hud_screen.json` (the second mark and a mode icon).
- **Lobby:** `lobby/behavior_pack/scripts/` (waiting players: the top-right box, left out of game starts, sent back to the editor, the timeout).
- **Build** (`tools/build/`):
  - `build.ts`: an editor target with no maps, requirements in the registry, skips drafts, strips `source` and `cameras`;
  - `validate.ts`: re-exports the validator from core.
- **Server and orchestrator:**
  - `docker/bds/entrypoint.sh`;
  - `orchestrator/src/{config,docker,session-manager,http-server}.ts` (live maps mount, `returnPort`, `/v1/editor/hold` and `/v1/editor/return`);
  - `orchestrator/src/lobby.ts` (passes the editor messages to the lobby).
- **Panel:** `tools/control-panel/{core.ts,panel.ts,index.html}`.
- **Config:**
  - `package.json` scripts (`editor`);
  - `docker-compose.yml` (`MAP: ${LOBBY_MAP:-spaceship}`);
  - `.env.example` (`EDITOR_ALLOW_LIST`, `MAP_EDITORS`, `DEV_LIVE_MAPS`, `LOBBY_MAP`);
  - `.gitignore` (`work/`).
- **Docs:** `README.md` (port 19134 is the editor, the editor commands and settings), `docs/maps.md`.

## Reuse

- **Docker access:** `tools/build/docker-util.ts` (`connectDocker`, `attachConsole`, `copyDirFromContainer`).
- **Bake** (`tools/build/bake.ts`, `bake-core.ts`):
  - the temporary server, staging with `putArchive`, and scriptevent reply markers;
  - the `world.new` swap, `bakeSettings`, and `fixtures/base-level.dat`.
- **level.dat:** `tools/build/leveldat.ts` (`patchLevelDat`, `enableBetaApis`).
- **A temporary server with its own pack:** `spike/knockback/run.ts` stages a pack and its permissions in one archive.
- **Pack side:**
  - `ui.ts` `showForm` (the busy retry);
  - the live `CustomForm` in `lobby/behavior_pack/scripts/team-pick-form.ts`, for the selection readout;
  - `TextPrimitive` usage in `lobby/behavior_pack/scripts/hologram.ts`;
  - the item-use pattern in `minigame.ts` (the picker).
- **Messages:** `log-stdin.ts` (`[NET]` lines and the `scriptevent` reply) is the model for `[EDIT]`, within the protocol's message size limits.
- **Server plumbing:** `vars.ts` `readServerVars`, `bootstrap.ts` `bootServer`, `transfer.ts` `TransferService`.
- **Panel:** `tools/control-panel/core.ts` (`readEnv`, the env editing route, the busy lock, log streaming).
- **Image cropping:** the picture handling in `tools/assets/make-assets.py`.

## Risks the spike settles

- **Chunker pruning:** if Bedrock to Bedrock pruning doesn't work, delete chunk keys with a LevelDB tool in a container instead.
- **Structure moves:** tile size and speed in BDS. If they're too slow, crop only and keep the original coordinates.
- **Boundary block rendering on consoles.** Fallback: per-player particle outlines.
- **Hiding players from a camera shot.** Fallback: ask them to step out of frame.
- **Docker Desktop host paths for Preview.** Fallback: the host copies the build into a named volume.

## Verification

- **Each part:** `npm run check` and `npm run build`.
- **Tests:**
  - **Edit ops:** add, move, delete, renumber, mirror with yaw.
  - **Validator v2:** facing entries, per-team keys, kill regions, team ids, drafts skipped.
  - **Formatter:** every existing `map.json` round trips unchanged.
  - **Core:** `MapView` facing and kill regions; spawn rotation in the fake world.
  - **Editor tools:** the box and offset math in `finish-core.ts`, the world list from a fake client folder, and the registry including requirements.
- **Edit end to end:**
  1. `npm run editor -- sumo arena_1`, then join `LAN_HOST:19134`.
  2. Add a spawn with a saved facing and watch `map.json` change. Undo it.
  3. Save the world, then stop.
  4. `git diff` shows only the intended changes, and reopening shows no leftover markers or boundary blocks.
- **Select end to end:**
  1. Select mode on one of your converted worlds; box two maps and confirm both.
  2. Each opens in Edit mode centered at 0,0 and looks right.
  3. `npm run build` passes, and both drafts are skipped.
  4. Update from world keeps the data in place.
- **Pictures:** a camera's Look through matches the saved view, and Use latest screenshot writes a 16:9 `preview.png`.
- **Preview:** with `DEV_LIVE_MAPS=1`, Preview starts the game on the map at the saved facings, and everyone lands back in Edit mode after. Preview as lobby restarts the lobby on the chosen map.
- **Access:** a gamertag that is in neither `LAN_PLAYERS` nor `EDITOR_ALLOW_LIST` is refused; a builder gets creative mode but no tools.
- **Players screen:**
  - Adding a gamertag in game lets that player join without a restart, and the entry appears in `.env` and the Panel.
  - Switching a builder to Editor gives them the tools at once.
  - You can't demote yourself.
- **Mode switches:**
  - Select to Edit and back sends everyone to the lobby, shows the waiting line, and brings them back without a manual rejoin.
  - A game started in the lobby meanwhile leaves them out.
  - With the main stack down, the fallback message appears.
- **Top-right box:** shows Select, Edit or Build, with the inspect readout after it, and the game clock still works in games.
- **No regressions:** `npm run smoke` still passes.

## Questions to settle at each game's milestone

These are the map inputs each planned game probably needs. Confirming them when its milestone starts sets its `map` requirements.

| Game | Likely map inputs | Question for its milestone |
|---|---|---|
| Arena | free-for-all or team spawns, item points | Are respawn points separate from start spawns? |
| Search and Destroy | attacker and defender spawns, bomb sites A and B (regions), buy zones per team | Bomb sites as regions, or points with a radius? |
| Paintball | team spawns, ammo or power-up points | Can paint mark any surface, or only inside a region? |
| One in the Quiver | more respawn points than players, killY | Respawn at the point farthest from enemies? |
| Microbattles | several small arenas (a region plus spawns each) | One arena per round, or several at once? |
| Build Battle | one plot per player (a region plus its spawn), build height | Plot count equal to max players? A judging route? |
| Prophunt | hider spawn, seeker spawn, seeker holding area | Props from blocks in the map or a fixed list? (A block picker tool would come then.) |
| Zombies | player spawn, zombie spawns per area, doors with costs, wall buys | Needs points with properties, a later format extension |
| Hide and Seek | hider and seeker spawns, a seeker cage region | Does it share maps with Prophunt? |
| Block Drop | floor layers (regions), killY | Floors built in the map, or generated from a region? |

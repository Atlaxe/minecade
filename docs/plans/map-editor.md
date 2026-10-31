# Milestone 10: map editor server (Select, Edit, Preview) (plan)

**Status:** approved 2026-10-30. Milestone 9 (the UI pass) is done, so this is next. Built in 9 passes, functionality first (see "Passes"). Passes 10.1 to 10.5 are done, and the editor boots into an editor lobby since 2026-10-31 (the spike's results are in `docs/spike-results.md`, "Map editor"; the editor's guide is `docs/editor.md`). Next: pass 10.6. The games come after it as milestones 11 and on.

**For the session that implements this:**
- Work in `C:\dev\minecade\network`.
- Stop and report after each pass. Commit and push after each pass, with no attribution, committing only that pass's files.
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

Follows the usual rules: stop and report after each pass, commit and push after each pass, no em dashes, no emojis, US spelling.

## Your decisions

| Topic | Decision |
|---|---|
| Sources | You build in Java and convert with Chunker yourself. The editor starts from a converted Bedrock world: one in your client's worlds folder, any folder, or a `.mcworld`. `.nbt` and `.schematic` files are pasted into a Java world before converting |
| Modes | Select (box a map in the converted world and confirm), Edit (set the data in the map's own void world), Preview (play it) |
| Import result | A void world holding only the selected box, centered at x 0, z 0 (y kept) |
| Controls | npm commands do the work; a Map editor section in the Minecade Panel calls the same code |
| Joining | Only `LAN_PLAYERS`, each one a map editor (the user edits alone: builders, the extra allow lists and the Players screen were dropped on 2026-10-31) |
| Mode switches | Players wait in the lobby while the editor restarts, then are sent back automatically. Nobody rejoins by hand |
| Mode on screen | A small box top center, styled like the game clock's box (the user's choice, 2026-10-31): Select, Edit or Preview, with the world or map |
| Building | No build helpers. Big changes happen in Java, then "Update from world" replaces the blocks and keeps the map data |
| Spawn facing | A "Save my facing" toggle on the spawn form. It is off by default, so the spawn faces the map center as it does today |
| First-version extras | Mirror tool. (Inspect mode and the colored boundary blocks were dropped on 2026-10-31: the user prefers the particle outlines) |
| Preview pictures | A placeable camera that saves a position and view angle. Look through it to take the screenshot. Map previews have no players in them; game pictures can |
| Unfinished maps | `"draft": true`; builds skip drafts, and Publish removes the flag, then commits and pushes the map (the user's request, 2026-10-31) |
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
  - Publish (the checklist's last button) removes the flag, saves, and commits and pushes the map's folder.
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

Dropped on 2026-10-31 (the user edits alone): no builders, no extra allow lists and no Players
screen. Only `LAN_PLAYERS` can join the editor, and each one is a map editor.

## Mode on screen

A small box top center, styled like the box the game clock uses top right (built early, on
2026-10-31; the user asked for top center).
- **What it shows:**
  - **Select** and the world in Select mode;
  - **Edit** and the map ("Sumo: Arena") in Edit mode;
  - nothing in the editor lobby, whose HUD is hidden.
- **How it works:**
  - It rides on the title, not the action bar, so the tools' hints and notices above the hotbar
    never compete with it. Nothing else on the editor's servers sends titles.
  - A title starting with `MODE_MARK` (`editor/behavior_pack/scripts/hud.ts`) shows in the box;
    any other title shows as in vanilla. The override is in the editor's resource pack
    (`editor/resource_pack/ui/hud_screen.json`), not the core pack, because games send titles of
    their own (the countdown's "Go!").
  - The editor sends the line when a player spawns and every 5 seconds; each one stays up 20 seconds.
- **Preview** (10.6) has to share the title with the game's countdown: settle it there (for example,
  the line only between the game's titles).

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

**Controls:** hit (left click), use (right click) and forms only. **No control needs sneaking:** you can't sneak while flying in creative (sneaking flies you down), so sneak combinations are out. Holding a tool never breaks the block you hit. A use is the same event whether you aim at air, a block or a marker (`itemUse`; the spike found no separate event), so each tool finds what you're aiming at itself (`getBlockFromViewDirection`, `getEntitiesFromViewDirection`). Markers and cameras are hit to open their forms; tapping them does nothing.

1. **Map menu** (item in slot 9, or `/mc:map`):
   - shows the map name and game;
   - **checklist:** every requirement in red or green with counts. Tap one to get its tool or to teleport to the problem;
   - the Layers form, inspect mode on and off, undo and redo, Save world, Publish;
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
   - Existing regions are edited or deleted from the map menu: each region in its list has Edit, Nudge, Go to and Delete.
4. **Kill Y tool:** sets killY one block below your feet, or to a number typed in the form. Its layer draws the plane.
5. **Mirror tool:** for symmetric team maps.
   - **Mode:** rotate 180 degrees, or flip on X or Z.
   - **Center:** the bounds center, or where you stand.
   - **What:** from one team to another; spawns, team points and team regions. Yaw is mirrored too.
   - Ghost markers preview the result before Apply, and Apply is one undo step.
6. **Inspect mode** (dropped on 2026-10-31, with the boundary blocks):
   - A readout in the mode box, after the mode, as you walk: inside or outside bounds, height above killY, which regions you are in, the nearest spawn.
   - On a lobby map, leaving the bounds reads "sent back to spawn".
7. **Boundary blocks and layers** (dropped on 2026-10-31: the particle outlines stay):
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
   - **Look through:** hit the camera and choose Look through. Your view locks to it (`camera.setCamera` with the free preset), and the HUD, markers and boundary blocks are hidden. Another player can walk into view, and you take the screenshot. Use (right click) to exit.
   - **Other options in the same form:** Re-aim from my view, Delete.
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
- **Edit:** target and map pickers (plus New map), the live checklist mirror, Save world, Publish.
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
                                      Publish (commit, push) --> rebuild --> live in the lobby
```

### 1. Convert (you, as today)
Convert the Java world with Chunker and save the Bedrock world in your client's worlds folder, or anywhere else. Nothing in the repo changes.

### 2. Select
1. **Start it:** in the Panel, Select, then pick "Arenas" from the list (or run `npm run editor -- select "Arenas"`). Then join `LAN_HOST:19134`; you accept the editor's trust prompt the first time only. Later switches go through the lobby automatically, so this is the only time you join by hand.
2. You arrive at the world's spawn in creative mode, holding the select tool and the map menu. The box top center reads "Select".
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
- **Map preview:** place a camera with a nice view of Castle, kind "Map preview". Hit it, choose Look through, take the screenshot. Then in the Panel, Use latest screenshot, which saves `games/sad/maps/castle/preview.png`.
- **Game picture** (once per game, on any map): place a camera of kind "Game picture". A friend stands in the shot while you look through and screenshot. Use latest screenshot saves `games/sad/icon.png`.

### 5. Preview
1. With the main stack running, choose Preview in the map menu.
2. The build runs, Search and Destroy starts on Castle, and everyone on the editor is transferred.
3. After the match, everyone is back in Edit mode. Repeat steps 3 to 5 as needed.

### 6. Ship
1. When the checklist is complete, choose Publish (the checklist's last button, or the Panel's). It
   removes `draft`, saves the world, commits `games/sad/maps/castle/` as "Automated Map Build :
   Search and Destroy Castle <date> <time>", and pushes it.
2. When nobody is online, shut the editor down and Start the network (it builds from the checkout).
   Castle appears on Search and Destroy's game screen.

### 7. Later: you changed Castle in Java
1. Convert again with Chunker.
2. In the Panel, Select, then pick the new world.
3. In the menu, Castle, then Update. Only `world/` is replaced; the spawns, regions and cameras stay put.
4. Preview again, then Publish.

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

## Passes (stop and report after each, commit and push)

Re-sliced on 2026-10-30 by tier: **functionality first** (a working editor with plain forms, from
the CLI and the Panel), **then UI tweaks, then nice-to-have features**. The design above is
unchanged; until the later passes, simpler stand-ins fill in (noted per pass).

### Functionality

**10.1 Spike** (only what the functional passes rely on; later passes check their own risks first:
boundary blocks on consoles, the camera, the live allow list, hot save). Results go in
`docs/spike-results.md` under "Map editor". Source world: a copy of "Datapacking (imported)" from
the client's worlds folder, plus the spaceship world.
1. **Chunker CLI in Docker** prunes a Bedrock world to chosen chunks (Bedrock to Bedrock), and BDS
   1.26.60.6 loads the result. Fallback: delete chunk keys with a LevelDB tool in a container.
2. **Structure moves in BDS:** the largest tile `structureManager.createFromWorld` and `place`
   accept, that block entities and item frames survive, and how long a 100x60x100 map takes.
3. **Staging a converted world:** copy time into the container, and the void-generator patch on
   its level.dat.
4. **Editor basics on 1.26.60:** custom items, hits on marker entities, `op` from the console.
5. **Preview plumbing:** a transfer from port 19134 to a game and back, and a bind mount of a host
   path into a container the orchestrator creates (Docker Desktop path translation).

**10.2 Map format v2 and core.**
- Facing entries, kill regions, per-team keys, requirement descriptors, drafts, `source` and
  `cameras` (stripped by the build).
- `lobby/lobby.config.ts`, and `LOBBY_MAP` in place of the hard-coded lobby map (with a Panel
  picker).
- The shared validator in core (keeping the `time` and `stars` checks), requirements (games and
  lobby) in the registry, the formatter, the pure edit ops.
- Docs in `docs/maps.md`.

**10.3 Editor server and Edit basics.** After it, Sumo's `arena_1` can be edited end to end.
- Entrypoint editor mode, `npm run editor` for Edit mode and `--new` (stage, sync, undo, save,
  stop).
- The map menu (plain forms), checklist, spawn tool with simple markers (a name tag with the list
  and number), Mark ready.
- Access lists and roles from `.env` (stand-in for the in-game Players screen).
- A shared pack slot (for example `packs/blocks/`, behavior and resource) that the build adds to
  every server (lobby, games, editor), like the core resource pack, for the user's custom blocks.
  It stays empty until their pack lands. They keep converting Java worlds with their own Chunker
  block mappings; the editor never maps blocks (it only prunes Bedrock to Bedrock, and Chunker
  keeps blocks it doesn't recognize).
- The host session runs on its own: in the foreground from `npm run editor`, or started by the
  Panel as a background process (log in `work/editor/editor.log`) with a local control port for
  status, save and stop, so closing the Panel never stops the editor.
- Panel: a Map editor section with Start (target, map, New map) and Stop, the running mode and
  "ready to join", the checklist mirror, the log, and the `EDITOR_ALLOW_LIST` and `MAP_EDITORS`
  settings. The editor container shows in the container list.

*Done 2026-10-30. Where it differs from the design above:*
- The container runs on `minecade/bds-base:local` (bake's plain BDS image), not `minecade/bds:local`.
  The host stages the entrypoint, the editor's packs (built from the checkout at every start) and
  the map, so the editor always runs the checked-out code and never needs the network's images
  rebuilt or `npm run build` to pass.
- The world is saved at stop only when blocks changed (or a map editor switches it on in the map
  menu), so a session that only places spawns changes nothing but `map.json`. Hot "Save world" stays
  in 10.8.
- Before a save, the pack loads every chunk a marker was ever in (the script `TickingAreaManager`)
  and removes them all; the host saves only when none are left.
- Edits travel as ops, and the host answers each with a hash of its copy; undo, redo and hand edits
  of `map.json` send the whole map, in parts within the scriptevent limit.
- Open: a saved world keeps BDS's records of the players who joined (position, inventory, an account
  id). Check in 10.5 whether Chunker's prune drops them; otherwise strip them before a save.
- Brought forward from 10.7 on 2026-10-30, after the user's first in-game run:
  - the button menus (map menu, checklist, marker form) as a dark panel down the right side, full
    height and scrolling, in Minecraft Ten;
  - every tool button is a switch, and a tool goes in hotbar slot 1, unlocked, one at a time
    (the switches became the map menu's tool grid after 10.4);
  - a glowing red line from each faced marker's top toward its facing, tilted by the pitch.

**10.4 Region and Kill Y tools.** Region tool, Kill Y tool, and a plain particle outline of the
box being edited and of the bounds (stand-in for the colored boundary blocks).

*Done 2026-10-30. Where it differs from the design above:*
- Selecting (the user's choice): a hit starts a one-block selection, and each use on a block, up to
  64 blocks away, grows it to that block on every axis, so the box needs no corners in mid-air. A
  use at the air (or Selection in the map menu) opens the region form: Save changes, Save as,
  Nudge sides (up to 16 blocks each way), Floor at kill Y, Back one step, Clear.
- The outlines show everything, not only the selection and the bounds: the selection (yellow), the
  bounds (white), kill regions and the kill Y plane (a deeper red than any team's), each other
  region in its own color (team regions in the team's), to the player holding the region or Kill Y
  tool only. Dots come from a small custom particle, only within 40 blocks, and a box over its
  budget gets sparser dots, so a big map costs the same as a small one.
- Existing boxes are in the map menu's "Bounds and regions" list (Edit, Nudge, Go to, Delete).
- The region tool's item doesn't set `can_destroy_in_creative: false`, so its hits reach the script
  (`entityHitBlock`); the editor cancels the break instead, as for every tool.
- Changed on 2026-10-30, after the user's first look in game (brought forward from 10.7 and 10.8):
  - The map menu: quick icons (the checklist pill, Undo, Redo, a gear for map settings) with
    tooltips, a grid of the tools' icons (tap to pick one, again to put it away), the picked tool's
    settings (scrolling), and a green Save bar at the bottom. Mark ready moved to the checklist, and
    Drop build commands to the gear. Delete and remove buttons are red everywhere.
  - The Spawn and Kill Y tools act at once, with their settings in the map menu (the spawn list,
    Save my facing, the snap). While a tool is held, the action bar says what a use does.
  - Save while running (`save hold`, from 10.8) replaces the "Save the world at stop" switch:
    Save in the map menu, the Panel or `npm run editor -- save`. Stopping still saves block changes
    made since the last save.
  - Outlines show from any distance: dots past 40 blocks are drawn 40 blocks out on the same line
    of sight, spaced and sized by distance, with a dark rim for contrast. Still particles, so only
    the holder sees them (entity models were the other option, but everyone would see them).

**10.5 Select mode.**
- World picker (client worlds by name, folders, `.mcworld`), select tool, confirm form.
- Background extraction (Chunker prune, crop and recenter pass, draft map), Update from world.
- Switching to Edit restarts the editor, and players rejoin by hand after about 30 seconds
  (stand-in for the lobby waiting room).
- Panel: Select with the world picker, the selections with their extraction status, Edit and
  Update.
- The extraction's temporary BDS loads the shared block pack too, and a check like the spike's
  confirms that pruning and moving keep custom blocks, on a world that uses them.

*Done 2026-10-30. Where it differs from the design above:*
- The Select tool works like the region tool (the user's choice in 10.4): a hit starts a box, uses
  on blocks grow it, a use at the sky opens its form. "Save as map" asks for the target, the name and
  the map id (empty: made from the name).
- The first spawn is where the player stands when they save (the user's choice), moved with the
  map; saving from outside the box is refused.
- Both switches exist: Edit <map> from Select, and Back to Select from Edit (the gear, and the
  Panel) for a map whose world is on this PC (the user's choice). The Panel's world picker also
  switches a running editor to another world.
- The extraction's server runs the editor pack in a third mode (extract), not a separate pack.
  Ticking areas load a whole phase at once when it fits the limit (300 chunks), and wait 2 s after
  removing areas: an area next to still-unloading chunks never finished loading. On build B of
  "Datapacking (imported)" the extracted map's fingerprint matches the original exactly, in about
  20 s.
- The custom blocks check used a stand-in block in a test-only pack (the user's choice: their
  Bedrock pack isn't built yet). It survived both prunes and the move; rerun it with the real
  blocks once they land in `packs/blocks/`.
- Each world's list lives in `work/select/<world>.json`; there's no Shrink to build yet (10.8).

*Changed on 2026-10-31, after the user's first try (the Panel couldn't start the editor: its server
predated the Map editor page):*
- **Boot up map editor** replaces the Panel's pickers: picking happens in game. The editor is three
  servers on the network's ports (the user's choice: the network never runs beside the editor, so
  booting stops it, after a confirm):
  - **the editor lobby** on 19132: black (a closed cell, blind, no movement, camera or HUD), with a
    Map editor menu that opens again whenever it closes: Open now, Recent (the "previous" maps),
    Open a map (target, then map), New map (the client's worlds, or an empty world with a glass pad);
  - **Select** on 19133 and **Edit** on 19134, each started (or restarted) by what's opened.
- Players move between them by transfer (`goto`, through `TransferService`), never by rejoining:
  whoever asks waits where they are, and players on a server that restarts wait in the editor
  lobby. This replaces "Mode switches through the lobby" (protocol 7, `editor_hold`) for the editor.
- Select and Edit run side by side, so Edit <map> leaves Select up, and Back to Select is instant
  when Select has that world.
- Each port keeps the network's identity there (`lobby`, `game`, `editor`), so there are no new
  trust prompts, and no new router forwards.
- The Panel and the editor say when they run older code than the checkout: **Restart Panel** (a
  fresh helper takes over its port) and **Restart** for the editor.
- Fixed: a map editor rejoining a server got "Could not op" and "The server didn't answer"
  (BDS's answer for someone who is an operator already).
- 10.6 Preview needs a game port while the editor holds all three: settle it in 10.6 (for example,
  the preview game takes the Select port).

*Then, the same day, at the user's request:*
- The mode box top center (see "Mode on screen"), brought forward from 10.7.
- When a map boxed in Select is ready, map editors on Select and Edit get a notice above the hotbar
  with a chime ("Castle is ready to load in Edit", held about 6 seconds, the `notice` message), and
  chat says where to open it. The runner sends both, so it reaches them on either server.

*Then, at the user's request:* **Publish** replaces Mark ready (the checklist's last button, the
Panel's Edit row, `npm run editor -- publish`). After a confirm it removes `draft`, saves the world,
commits only the map's folder as "Automated Map Build : <Game> <Map> <date> <time>" (the user's
format) and pushes it (`tools/editor/publish.ts`). The lobby lists the map from the network's next
start, which builds from the checkout.

*Then, with 10.6, at the user's request (2026-10-31):*
- The Spawn tool places entries exactly where you aim (on top of a block; in front of a side, on
  the floor; at the sky, where you stand), like entities. Positions may have decimals: whole x and
  z still mean a block's middle (`worldPoint` in `map-config.ts`). **Center on block** keeps the
  old way.
- **A queue spawn** (`queueSpawn`, `queue: { mode, countdown }`): players wait there for everyone,
  locked in (look around, can't move, invisible) or free, then a countdown (5 s by default, set per
  map), then the spawns and the usual frozen countdown (`Minigame` in minigame-core). Placed with
  the Spawn tool; its marker has Lock in and Countdown.

**10.6 Preview:** `DEV_LIVE_MAPS`, Preview with the return to the editor, Preview as lobby, and
both in the Panel.

### UI tweaks

**10.7 Editor look and feel.**
- (The mode box came early, on 2026-10-31.)
- Item icons; marker models with numbers and list colors (the facing line came in 10.3).
- (Boundary blocks, the Layers form and inspect mode were dropped on 2026-10-31: the particle
  outlines stay.)
- The forms with fields in the editor's dark style where it helps (the button menus came in 10.3),
  and Panel polish.

### Nice to have

**10.8 Smoother workflow.**
- `mc:` commands. (Hot "Save world" came early, after 10.4.)
- Dropped on 2026-10-31: mode switches through the lobby (the editor lobby replaced them), the
  in-game Players screen (the user edits alone) and Shrink to build (the selection tools are
  enough).

**10.9 Extra tools:** mirror tool, camera tool and "Use latest screenshot", the lobby terminal
marker.

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
  - `protocol/messages.ts` (protocol 7: `editor_hold`, `editor_return`).
- **Editor resource pack:** `editor/resource_pack/ui/hud_screen.json` (the mode box, from marked titles).
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

- **Each pass:** `npm run check` and `npm run build`.
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

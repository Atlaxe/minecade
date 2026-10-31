# Map editor

The map editor is three Bedrock servers, booted together on the network's ports:

- **The editor lobby** (port 19132) is where everyone joins. It's dark, with a menu that stays
  open: open a map in Edit, copy builds from one of your worlds into Select, or go to what's open.
- **Select** (port 19133) cuts maps out of a world you converted from Java: box a build, and it's
  moved to the middle and saved as a new draft map in the background.
- **Edit** (port 19134) sets a map's data in game: spawns, the spectator spawn, named points, the
  bounds, kill Y and regions, with a checklist of what the map's game still needs. Every change
  goes straight into the map's `map.json`.

Players move between the three by transfer, so nobody rejoins by hand. The network (the lobby and
games) is stopped while the editor runs: they use the same ports.

Preview comes in a later pass of milestone 10 (see `docs/plans/map-editor.md`).

## Starting and stopping

From the Panel: open **Map editor** and press **Boot up map editor**. If the network is running,
the Panel asks first, then stops it. Once the page says the editor is ready, join `LAN_HOST:19132`.
Each port keeps the identity the network's server on it has, so if you've played on the network,
there's no trust prompt; otherwise accept it once per server.

The page shows each server (what it has open, and who is on it), the checklist of the map open in
Edit with **Save** and **Publish**, the maps cut from the world open in Select, and the editor's log. **Shut down**
stops all three (Edit saves first); then **Start the network** brings the lobby and games back.
Closing the Panel doesn't stop the editor.

From a terminal:

```
npm run editor                            boot it, then join LAN_HOST:19132
npm run editor -- <target> <map>          boot it (or use the running one) and open a map in Edit,
                                          for example: npm run editor -- sumo arena_1
npm run editor -- <target> <map> --new    the same with a new draft map: a void world with a glass pad
npm run editor -- select "<world>"        the same with a world in Select: its name in Minecraft,
                                          its folder, or a .mcworld file
npm run editor -- status                  what each of its servers is doing
npm run editor -- save                    save the map open in Edit now
npm run editor -- publish                 publish the map open in Edit (see "Publishing")
npm run editor -- preview [end]           play the map open in Edit as its game, or end that (see "Preview")
npm run editor -- stop                    shut it down (Edit saves first)
```

`<target>` is `lobby` or a game id. The terminal refuses to boot while the network runs: stop it
first (the Panel's Servers page, or `docker compose down`). In the terminal, Ctrl+C shuts the
editor down the same way; press it twice to quit without saving the world (`map.json` keeps every
change either way).

Booting takes a few seconds: the editor builds its own packs from this checkout, so it never needs
`npm run build` or a network restart, and it works on a map that still has problems. Only one editor
runs at a time.

**Restarting** (for new editor code, or new settings in `.env`): when the editor's code changed
since it booted, the Panel says so, with **Restart**, which shuts it down (Edit saves first) and
boots it again. From a terminal: `npm run editor -- stop`, then `npm run editor`. The editor runs
the code in the checkout it starts from (the main checkout, for the Panel), so restart it after new
editor code is merged there.

The Panel says the same about its own code, with **Restart Panel** at the top of every page. (A
Panel from before Restart Panel existed can't: close every Panel window, wait about 20 seconds for
it to exit, and open it again.)

## The editor lobby

You're shut in a small dark room with the **Map editor** menu, which opens again whenever it
closes:

- **Open now:** the map open in Edit and the world open in Select, with who is on each. Pick one to
  go there.
- **Recent:** the last few maps and worlds opened (kept in `work/editor/recent.json`).
- **Open a map...:** the lobby or a game, then one of its maps (drafts are marked). It opens in Edit.
- **New map...:** pick the world to copy builds from: the worlds in Minecraft's worlds folder, by
  the name the game shows, with how many maps came from each. A copy opens in Select. **Empty world**
  at the bottom makes a draft map on a glass pad in the void instead: pick what it's for, its name
  and its map id.

While the server you picked loads (about 20 seconds; a big world takes longer to copy), the menu
says so, and you're moved there once it's ready. Opening something else on a server others are on
asks first: they wait in the editor lobby while it switches (Edit saves first), then come back.

**Going back:** **Editor lobby**, in Select's map menu and in Edit's gear, takes you to the menu to
open another map or world. Select and Edit keep running meanwhile, so going back to them is instant.

**Where you are:** on Select and Edit, a small box top center says which server you're on and
what's open there: **Select** and the world, or **Edit** and the map. It's a title the editor's resource pack draws as a box
(`editor/resource_pack/ui/hud_screen.json`, the mark in `editor/behavior_pack/scripts/hud.ts`), the
way games draw their clock top right; other titles show as usual. In a preview it reads **Preview**
and the map.

## Select mode: cutting maps out of a world

Build maps in Java, convert the world to Bedrock with Chunker (as before), then open it in Select
mode. The editor runs on a copy, so your world is never changed. The copy gets the void generator,
so flying past the converted area grows no new land.

**In game,** map editors get the **Select tool** (slot 1) and the map menu (slot 9):

- **Hit a block** to start a box there. **Use the tool on blocks** (up to 64 away) to grow the box
  to them. **Use it at the sky** for the selection's form: **Save as map...**, Nudge sides, Back one
  step, and Clear (red). The line above the hotbar says what a hit and a use do, and the box's size.
- **Save as map:** stand inside the box (where you stand becomes the map's first spawn), then pick
  what the map is for (the lobby or a game), its name, and its map id (left empty, it's made from the
  name: "Castle Keep" is `castle_keep`). An id the game has already is refused.
- **The map is cut out in the background,** one at a time, so you can box the next map meanwhile.
  It takes about 20 seconds for a 112 x 65 x 128 build. When it's ready, map editors on Select and
  Edit hear a chime and see "<name> is ready to load in Edit" above the hotbar for a few seconds,
  and chat says where to open it: Edit <map> in Select's map menu, or Open a map in the editor lobby.
- **Outlines** (while you hold the Select tool): your box in yellow, and every map from this world,
  green once it's ready, white while it's queued or being cut out, red when it failed.
- **The map menu** lists the maps from this world with how each is going:
  - **Ready:** **Edit <map>** (it opens in Edit, and you're moved there once it's ready; Select
    keeps running), **Update from this world** (red: cuts it out again and replaces its blocks;
    spawns, regions and the rest of `map.json` stay, and block changes made in Edit are lost), and
    **Forget** (takes it off this list; the map stays).
  - **Failed:** why, then **Try again** or **Forget**.
  - The Panel lists them too, with how each is going.

**What a new map gets:**

- `maps/<id>/world`: the box moved so its middle sits at x 0, z 0 (heights stay), and nothing else.
  Neighboring builds that spill into the same chunks are cleared.
- A draft `map.json` with its name, `"draft": true`, the first spawn (where you stood, moved with
  the map), the bounds (the moved box) and `source` (the world, the box and the offset). Drafts are
  left out of the build until they're marked ready, so the build keeps passing.

**Back to Select:** in Edit mode, the map menu's gear has **Back to Select** for a map that came
from a world on this PC, so you can go back and box more. It's instant when Select has that world
open; otherwise Select opens it first, and you're moved there once it's ready.

**Each world's list** is kept in `work/select/<world>.json` (ignored by git), so it's there when
you open the world again. Maps in the repo whose `source` names the world join its list, ready.
Extractions carry on while you open other worlds, and shutting the editor down waits for them to finish.

**Custom blocks:** the extraction's server loads the shared block pack (`packs/blocks/`), so maps
that use custom blocks keep them. This was checked with a stand-in custom block; check it again
with the real blocks once they're in `packs/blocks/`.

## Who can join

Only the gamertags in `LAN_PLAYERS` (in `.env`), and each one is a map editor: the tools, and
operator for commands. Everyone else is refused. A change applies at the editor's next boot.

## In game

Every control is a hit (left click), a use (right click) or a form. None needs sneaking, which
would fly you down.

The map menu, the checklist, a marker's form and the region tool's menus open as a dark panel down
the right side of the screen, full height, so the world stays in view on the left. Esc or the X
closes them. Buttons that delete or remove something are red. The forms with fields (Map settings,
Change list, Renumber, Save as, Nudge sides, a typed kill Y) are the game's own, in the middle of the
screen.

**The map menu** (slot 9, locked), top down:

1. **Quick icons**, each with a tooltip when you point at it:
   - **The checklist pill** (a check and "2/5", the check green when nothing is missing): each
     thing the map's game needs, green when done, with what the build would refuse the map for. Tap
     an entry to get its tool, already set to that list. **Publish** is at the bottom: once nothing
     is missing, it puts the map in the lobby (see "Publishing").
   - **Undo** and **Redo** (faded when there's nothing to undo or redo; the tooltip says what they'd
     change). The menu opens again afterward, so you can undo several steps.
   - **The gear** (map settings): the map's name and the game's own settings in `map.json` (such as
     a number a game reads), as text fields; and **Drop build commands** (maps made by
     `npm run bake`), which keeps the world as you change it.
2. **Tools:** a grid of the tools' icons (the Spawn tool, the Region tool and the Kill Y tool), with
   their names as tooltips. Tap one to put it in slot 1 and in your hand; the menu opens again with
   that tool's settings. Tap it again to put it away. The one you have out is outlined. One tool is
   out at a time: picking one puts any other away. The tool isn't locked, so you can move it;
   whatever was in slot 1 moves to a free slot.
3. **The tool's settings** (they scroll): the map's name and game, how to use the tool, then:
   - **Spawn tool:** **Place into**, each list (spawns, the spectator spawn, the queue spawn, each
     team's spawns, and every point the game asks for) with its count, the one in use outlined; **Save my facing** (off
     means the entry faces the middle of the map); and **Snap** (exact, 45 or 90 degrees), changed
     by tapping it.
   - **Region tool:** your selection's size, then its actions (the same as the region form below),
     then **Bounds and regions**: every box the map has. Tap one to **Edit** it (it becomes your
     selection, then Save changes writes it back), **Nudge** its sides (saved at once), **Go to** it
     (on top, over its middle), or **Delete** it.
   - **Kill Y tool:** kill Y now, **Type a height** (from -64 to 319), and **Remove kill Y**.
4. **Save:** a green bar at the bottom, outside the scrolling part. It saves the world into the map
   now (see Saving), and says when there are unsaved block changes.

**The tools act at once.** While you hold one, the line above the hotbar says what a use does.

- **Spawn tool:** aim at where an entry goes and use it, within 64 blocks. On top of a block, it
  goes exactly where you aim (to a hundredth of a block, like an entity), not the block's middle; at
  a block's side, just in front of that spot, on the floor below it; at the sky, where you stand.
  It goes into the list picked in the map menu, with your facing when Save my facing is on.
  **Center on block** (in the tool's settings, off at first) puts it in the middle of the block
  instead, the old way, for symmetric arenas.
- **Markers:** every entry shows as a marker with a name tag: its list, its number, and the way it
  faces when that's saved. An entry with a saved facing also has a glowing red line, 2 blocks long,
  from the top of its marker toward the facing, tilted up or down with the saved pitch. **Hit a
  marker** to move it exactly to where you stand, give it your facing, clear its facing, move it to
  another list, renumber it, or delete it.
- **Queue spawn:** where players wait for everyone to join, before the game puts them at their
  spawns (see "The queue spawn" in `docs/maps.md`). Its marker reads "Queue spawn (lock in, 5 s)".
  Hit it for two more buttons: **Lock in** (on: players can look around but not move, and are
  invisible to each other; off: they roam free) and **Countdown** (the seconds, once everyone's
  in, before they go to their spawns; 5 at first).
- **Region tool:** picks a box, for the bounds, a region or a kill region (anyone inside a kill
  region is out).
  - **Hit a block** to start a new selection: that one block.
  - **Use the tool on a block**, up to 64 blocks away, to grow the selection to it, on every axis.
    Any box can be picked without placing blocks: hit one corner, then use the tool on the blocks
    at the far edges.
  - **Use the tool at the sky** (no block within 64 blocks) to open the region form:
    - **Save changes** (when the selection came from Edit, or was saved already): writes it back.
    - **Save as:** the bounds, a kill region, a region the game asks for (one per team when it
      asks for that), a region the map already has, or a new region you name (letters, digits
      and `_`). A region holds a list of boxes, and each save adds one.
    - **Nudge sides:** moves each side up to 16 blocks out (above 0) or in (below 0).
    - **Floor at kill Y:** puts the bottom of the box at kill Y.
    - **Back one step** undoes the last change to the selection; **Clear selection**.
  - The checklist's bounds and region rows give you the tool already set to that row.
- **Kill Y tool:** players below kill Y are out. Use it to set kill Y one block below your feet.
- **Outlines:** while you hold the region tool or the Kill Y tool, dots outline your selection
  (yellow), the bounds (white), kill regions (red), each other region in its own color (a team's
  region in the team's color), and the kill Y plane (red: a grid near you, and the bounds' edge at
  that height). Only you see them. Every edge shows however far away it is: dots past 40 blocks are
  drawn 40 blocks out, on the same line of sight, so they sit where the edge is on screen. Dots are
  spaced and sized by distance, so a line looks the same near and far, and each has a dark rim so
  it shows on bright and dark backgrounds. They stand in for the boundary blocks of a later pass.

## Saving

- **`map.json`** is written on every change, in the same hand-written style, so `git diff` shows
  just what changed, and a crash loses nothing. You can edit it in VS Code while the editor runs:
  the editor picks the change up (as one undo step) and the markers move.
- **Save** (the map menu's green bar, the Panel's Save, or `npm run editor -- save`) saves the
  world into `maps/<id>/world` while the editor keeps running. The markers go away for a moment
  while it saves. Save always saves the world, so use it after changing blocks with commands,
  which the editor can't see.
- **Stopping** saves the world too, when blocks changed since the last save (someone placed or broke
  one, or a new map's glass pad). A session that only places spawns leaves the world files
  untouched.
- Before saving, the editor removes every marker, including ones in chunks nobody is near, and
  saves only when none are left. The saved world gets the usual baked settings (noon, no weather or
  mobs, void generation).
- A map with `build` commands is rebuilt from them by `npm run bake`, which would replace block
  changes. Drop the commands from the map menu's gear to keep them.

## Preview

**Preview** plays the map open in Edit as its real game, then brings you back to Edit: the play
icon in the map menu's top row (a game's map with its checklist done; lobby maps can't be
previewed yet), **Preview** on the Panel's Edit row, or `npm run editor -- preview`.

1. The editor saves the world (when blocks changed) and builds the game from this checkout, with
   the map as it is now, draft or not.
2. The game runs on port 19133, Select's port (the network's game port, so no trust prompt). Select
   closes meanwhile; anyone on it waits in the editor lobby, and it opens again on the same world
   afterward.
3. Once the game is ready (about 30 seconds), everyone in Edit is moved there. The game starts as
   soon as you're all in, even alone (a preview needs one player). The mode box top center reads
   **Preview** and the map.
4. When the match ends (a win, everyone out, or the time limit), the game sends everyone back to
   Edit, as the network's games send players to the lobby. **End preview** (the Panel's Preview
   row, or `npm run editor -- preview end`) ends it at any time.

A preview never counts toward stats.

## Publishing

When a map is done, **Publish** puts it in the lobby: the last button in the checklist (map
editors), **Publish** on the Panel's Edit row, or `npm run editor -- publish`. In game and in the
Panel it asks first. Then it:

1. checks the checklist: a map with problems isn't published;
2. removes `"draft"`, so the build includes the map (an undo step, like any change);
3. saves the world into the map, when blocks changed since the last save;
4. commits only the map's folder (`games/<game>/maps/<id>/`, or `lobby/maps/<id>/`), whatever else
   is changed in the checkout, as `Automated Map Build : <Game> <Map> <date> <time>`, for example
   `Automated Map Build : Sumo Sewer 2026-10-31 18:42` (this PC's time);
5. pushes it to GitHub, after catching up with commits pushed from elsewhere when nothing local is
   in the way.

Chat says when it's done, with the commit, and map editors hear a chime and see "Sewer is
published" above the hotbar. The lobby lists the map from the network's next start: **Shut down**
the editor, then **Start the network**, which builds from this checkout. A lobby map shows in the
Panel's lobby map picker instead.

Publish again after more changes (the button then reads **Publish changes**): it commits what
changed. With nothing changed, it says so and commits nothing. When the push fails (no connection,
or GitHub has commits that clash with local changes), the commit stays here, chat says why, and
publishing again pushes it. The commit goes on the branch of the checkout the editor runs from
(the Panel's, normally `main`).

## How it works

- `npm run editor` (`tools/editor/`) starts the containers `minecade-editor-lobby` (19132),
  `minecade-editor-select` (19133) and `minecade-editor-edit` (19134) on the plain BDS image that
  `npm run bake` uses, each with the editor's packs (`editor/`), the shared packs, a world and
  `map.json` copied in. Their entrypoint is `docker/bds/entrypoint.sh` in editor mode, and each uses
  the identity the network's server on that port has (`lobby`, `game`, `editor`).
- **The runner** (`tools/editor/runner.ts`) runs the three: the editor lobby (`home-session.ts`) all
  the time, and Select (`select-session.ts`) and Edit (`session.ts`) once something is opened, all on
  `ServerSession` (`server-session.ts`: the server, the console, opping map editors and `goto`).
  Opening a map or a world on a server that has something else open moves its players to the editor
  lobby (a `goto` message: the pack transfers them, LAN or public by `LAN_PLAYERS`), stops it (Edit
  saves), and starts it on the new one; then everyone waiting for it is moved there, from whichever
  server they're on. The lobby's menu gets the catalog (`catalog.ts`: every map, the client's worlds
  by their folder name, the recent list) and what's open, in parts (`home` messages), whenever it
  changes.
- The editor's pack applies each change at once and writes an `[EDIT] {json}` line to the server
  log. The host applies the same change with the same code (`applyEdit` in minigame-core), writes
  `map.json`, keeps undo and redo, and answers with `scriptevent minecade:edit {json}` on the
  console. If the two copies ever differ, the host sends the whole map again.
- **Save while running** (`hotSave` in `tools/editor/session.ts`): the pack removes the markers,
  then `save hold` makes the server write the world and keep its files still, and once `save
  query` says they're ready, the host copies the world out of the container whole, and `save
  resume` lets the server carry on. Then the markers come back, and the copy gets the same baked
  settings as a save at stop. `save query` also lists a length for each file, meant for cutting
  the copies down, but on BDS 1.26 a log's listed length is from before the save wrote the chunks:
  a copy cut to it lost the blocks placed before the save, while the whole copy kept them (and
  not ones placed after `save resume`).
- **Publish** (`tools/editor/publish.ts`) runs git in the checkout: `fetch` and `merge --ff-only`
  (skipped quietly when local changes are in the way), `add --all` and `commit` naming the map's
  folder (so nothing else staged goes in), then `push`. It never asks on the console
  (`GIT_TERMINAL_PROMPT=0`), and gives the network steps two minutes, for a sign-in window.
- **Preview** (`tools/editor/preview-session.ts`, `preview-template.ts`) runs the game the way the
  editor runs its own servers (the base image, with the template and entrypoint put in), with the
  log transport: the game's `[NET]` lines say `server_ready` and `end_game`, and End preview sends
  it `return_all` on the console. `LOBBY_PORT` is Edit's port, so the game's own trip home lands
  there. A small resource pack carries the editor's mode box, and the `preview` server variable
  makes the game keep "Preview" in it (never over its own titles).
- The host answers on `127.0.0.1:8097` (`GET /status`, `POST /save`, `POST /publish`, `POST /preview`, `POST /preview/end`, `POST /open`, `POST /stop`),
  which the Panel and `npm run editor -- status | save | stop | <target> <map>` use. When the Panel
  boots the editor, its output goes to `work/editor/editor.log`.
- **The menus** are classic forms themed by the editor's resource pack, like the lobby's menus
  (`docs/ui.md`). A title starting with a layout mark (`LAYOUT` in
  `editor/behavior_pack/scripts/marks.ts`) gets a layout in `editor/resource_pack/ui/editor_forms.json`:
  `side` for the side menus, `map` for the map menu. A form's buttons are one list, and each part
  of the map menu shows the buttons with its mark (`MARK`): the pill and the quick icons, the tools
  (with a column mark, `COLUMNS`, so they fill a 5-wide grid), and Save; everything else is a
  setting. Other marks draw a button red (`danger`), outline it (`picked`, and `on` for the tool in
  hand), fade an icon (`dim`), make it a switch (`toggle`), or plain text (`heading`). The tooltips
  are the game's own (`hover_text_renderer`), fed the button's text: the server can't see the
  pointer, so the form draws them. `scripts/menu.ts` builds the map menu's buttons as plain data,
  and the tools are listed in `scripts/tools.ts`: a new tool adds a row there (its item, icon and
  how-to) and gets its icon in the grid. The art comes from `tools/assets/make-assets.py`.
- **The facing line** is part of the marker's model (`editor/resource_pack/models/entity/editor_marker.geo.json`,
  the `facing` bone), drawn glowing with the hologram's additive material. The marker spawns turned
  to the entry's yaw, so the line (the model's front) points that way, and a client-synced property
  tilts it by the pitch. A marker whose facing changes is placed again.
- **Extraction** (`tools/editor/extract.ts`, queued by `selections.ts`):
  1. Chunker (`minecade/chunker:local`, `tools/editor/chunker.ts`) prunes a copy of the world to the
     box's chunks.
  2. A throwaway BDS, `minecade-extract` (no ports, no players), runs the editor pack in extract
     mode (`scripts/extractor.ts`). It captures the box in 64x64 columns (the biggest structure
     allowed), clears every chunk the box touches, places the columns at the offset twice (a block
     attached to a column not yet placed pops off the first time; entities only once), and removes
     dropped items. Stopping the server saves it.
  3. Chunker prunes to the moved box's chunks, and the bake settings go into level.dat.
  4. The world is swapped into `maps/<id>/world`, and a new map's `map.json` written.

  Chunks are loaded with script ticking areas, a whole phase at once (the source, then the
  destination) when that fits the ticking limit (300 chunks), otherwise a 64x64 region at a time.
  After areas are removed, the next ones wait 2 seconds: an area next to chunks that are still
  unloading never finishes loading (found on the test world). The spike proved the rest
  (`docs/spike-results.md`, "Map editor"), and on build B of "Datapacking (imported)" the extracted
  map's block fingerprint matches the original exactly.
- **The outlines** are particles (`editor/resource_pack/particles/outline.json`) sent to the holder
  only. `viewDots` in `scripts/boxes.ts` works out where each dot goes and how big it is for that
  player (tune `DOTS` there), and each refresh has a budget, so a big map costs no more than a
  small one.

## Shared blocks pack

`packs/blocks/` holds custom blocks that every server loads (the lobby, every game and the
editor), so a map using them works anywhere. It's filled from the private block-pack project and
isn't committed; see its README.

## Troubleshooting

- **"The editor's ports are in use":** the network (or something else) holds 19132-19134. Stop it
  first: the Panel does that for you when you boot from there.
- **"An older map editor is running":** one from before the editor lobby. The Panel's **Restart
  the editor** shuts it down (it saves first) and boots the new one; from a terminal,
  `npm run editor -- stop`.
- **Can't join:** first check that the editor is running (the Panel's Map editor page, or
  `npm run editor -- status`): with none running, nothing answers on port 19132 and the join
  fails. If the Panel's buttons do nothing, restart the Panel (see Restarting above). Then check
  that your gamertag is in `LAN_PLAYERS`, and, from outside this network,
  that ports 19132-19134 are forwarded (see the README).
- **The world wasn't saved:** the editor's log says why (markers it couldn't remove, the server not
  getting its files ready, or no block changes at stop). `map.json` still has every change.

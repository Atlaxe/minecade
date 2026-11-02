# Map editor

The map editor is three Bedrock servers, booted together on the network's ports:

- **The editor lobby** (port 19132) is where everyone joins. It's dark, with a menu that stays
  open: open a map in Edit, copy builds from one of your worlds into Select, go to what's open, or
  pick up something recent (a map, a world, or a preview to play again).
- **Select** (port 19133) cuts maps out of a world you converted from Java: box a build, and it's
  moved to the middle and saved as a new draft map in the background.
- **Edit** (port 19134) sets a map's data in game: spawns, the spectator spawn, named points, the
  bounds, kill Y and regions, with a checklist of what the map's game still needs. Every change
  goes straight into the map's `map.json`.

Players move between the three by transfer, so nobody rejoins by hand. The network (the lobby and
games) is stopped while the editor runs: they use the same ports.

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
npm run editor -- invite "<gamertag>"     let a friend join Select and previews (see "Who can join")
npm run editor -- uninvite "<gamertag>"   take that back, and disconnect them
npm run editor -- picture [game]          your newest screenshot as the map's preview (or the game's picture)
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
closes. Its top row is icons (point at one for its name):

- **New map** (the plus): pick the world to copy builds from: the worlds in Minecraft's worlds
  folder, by the name the game shows, with how many maps came from each. A copy opens in Select.
  **Empty world** at the bottom makes a draft map on a glass pad in the void instead: pick what
  it's for, its name and its map id.
- **Players** (the person): invite friends (see "Who can join").
- **Leave** (the door, at the right end): disconnects you, after a confirm. Select and Edit keep
  running; join again to come back.

Under them, **Recent**, with a **Search** link (a magnifying glass) on its right: the lobby or a
game, then one of its maps (drafts are marked), which opens in Edit. Then a card for each map
opened lately (up to 8, from `work/editor/recent.json`, newest first): its game with three icons on
its right, each with a tooltip, and the map's name under them, across the card:

- **Select** (the crop mark): opens the world the map came from, to box more maps. Faded when that
  world isn't on this PC.
- **Edit** (the pencil): opens the map in Edit (or takes you there when it's open already).
- **Preview** (the play icon): asks how many fake players the match starts with, then plays the map
  (see "Preview"). Faded until its checklist is done, and on lobby maps.

A world opened in Select with no map card of its own gets a card too: Select lights up, Edit and
Preview are faded. Tapping a faded icon says in chat what's missing.

While the server you picked loads (about 20 seconds; a big world takes longer to copy), the menu
says so, with five dots after its title lighting up one at a time, and you're moved there once
it's ready. Opening something else on a server others are on asks first: they wait in the editor
lobby while it switches (Edit saves first), then come back.

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

**The world can't be changed in Select:** nobody can break or place blocks there. Maps are changed
in Edit.

**In game,** map editors get the **Select tool** (slot 1, locked there) and the map menu (slot 9).
Command blocks don't run anywhere a map is opened (Select, Edit, previews and every server of the
network). Every 10 seconds, a map editor missing either item gets it back, and **/reset**
(`/minecade:reset`) brings both back at once, with creative mode (in Edit, the map menu).
**/zoom** (`/minecade:zoom`) zooms the view in like a spyglass, whatever you hold; again to zoom
back out.

- **Hit a block** to start a box there. **Use the tool on blocks** (up to 64 away) to grow the box
  to them; the block you aim at is outlined. The map menu has **Export to Map** (green), Nudge
  sides and Clear selection (red). The line above the hotbar says what a hit and a use do, and the
  box's size.
- **Nudge sides:** a minus (in) and a plus (out) for each side; **Step** (1, 5 or 10 blocks) is a
  toggle above them. Each side says where it is from you (ahead, behind, left or right) and how far
  it moved, and the line above the hotbar says which way you face. The outline shows the moved box
  at once; **Nudge** (green, at the bottom) keeps it, the back arrow goes back to the menu you came
  from, and the X closes it; either way the box stays as it was.
- **Export to Map:** a side menu: **Name**, **For** (the lobby or a game; its list shows about five
  at a time), **Open in Edit** (on at first), and **Next**. Once there's a name it opens again with
  the **Map id** too, made from the name and not typed ("Castle Keep" is `castle_keep`, or
  `castle_keep_2` when the game has that id already). **Export to Map** (green) at the bottom
  exports it; the X closes it. Then the loading screen shows while it's cut out. With Open in Edit,
  the map opens on the Edit server once it's ready and you're moved there, with no menu in between;
  meanwhile an Edit server nobody is on stops (saving first), so the new map's starts sooner.
  Without it, once it's ready, it asks whether to edit it.
- **The map is cut out in the background,** one at a time, so you can box the next map meanwhile.
  It takes about 20 seconds for a 112 x 65 x 128 build. When it's ready, map editors on Select and
  Edit hear a chime and see "<name> is ready to load in Edit" above the hotbar for a few seconds,
  and chat says where to open it: its card in Select's map menu, or Search in the editor lobby.
- **Outlines** (while you hold the Select tool): your box in yellow, and every map from this world,
  green once it's ready, white while it's queued or being cut out, red when it failed.
- **The map menu:** an icon row (**Back one step**, faded with nothing to step back; **Players**;
  and **Back to Lobby**, a house, at the right end), a **Help** link (how to box a map, in chat),
  your selection's actions, and the maps from this world. While any of Select's menus is open, the
  outlines show. Using the tool at the sky does nothing: exporting is in the map menu.
  - **A ready map** is a card with its name. Tap it: **Edit** (green) or Cancel. Edit opens it on
    the Edit server, the loading screen shows (with the loading dots), and you're moved there once
    it's ready; Select keeps running. Every move between servers shows the loading screen, in Edit
    too (a preview starting, say).
  - **A failed one** says so. Tap it for why, then **Try again** or **Remove from this list**.
  - A map is deleted only from Edit (its gear's **Delete map**), which also takes it off this list.
  - The Panel lists them too, with how each is going.

**What a new map gets:**

- `maps/<id>/world`: the box moved so its middle sits at x 0, z 0 (heights stay), and nothing else.
  Neighboring builds that spill into the same chunks are cleared.
- A draft `map.json` with its name, `"draft": true`, no spawns yet (they're placed in Edit), a
  **spectator spawn** over the middle, 10 blocks above the highest block of the build (everyone
  arrives there in Edit), the bounds (the moved box, reaching up past the spectator spawn) and
  `source` (the world, the box and the offset). Drafts are left out of the build until they're
  published, so the build keeps passing.

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

- **Map editors:** the gamertags in `LAN_PLAYERS` (in `.env`). They get the tools, and operator for
  commands, on every server. A change applies at the editor's next boot.
- **Guests:** friends a map editor invites by gamertag. They may be in the editor lobby and on
  whatever runs on port 19133, **Select or a preview** (only one runs at a time), but **never Edit**.
  Everyone else is refused.

**Inviting:** **Players** in the editor lobby's menu, in Select's map menu, or in Edit's gear;
the Panel's Guests card; or `npm run editor -- invite "<gamertag>"`. The list is kept in
`work/editor/guests.json` until you remove someone (tap them in Players, Remove on the Panel, or
`npm run editor -- uninvite "<gamertag>"`), which also disconnects them. A dedicated server can't
send Xbox invites: a guest adds this PC's address on port 19132 (the network's address,
`PUBLIC_HOST`) and joins it.

**Where guests go:**
- Joining, they land in the editor lobby (a dark screen with no menu) and are moved straight on to
  Select or the preview, whichever is open; if neither is, they wait there until one is.
- On Select they're in creative with no tools: they can fly around and look. Nobody can break or
  place blocks there.
- **Preview:** guests on Select (or waiting) come along into the game with everyone in Edit. When
  it ends, map editors go back to Edit and guests to the editor lobby, then on to Select when it
  reopens.
- Only map editors can open maps or worlds, start a preview or invite players.

## In game

Every control is a hit (left click), a use (right click) or a form. None needs sneaking, which
would fly you down (sneaking and right clicking a mannequin is only a shortcut for what its screen
does).

The map menu, the checklist, a marker's form and the region tool's menus open as a dark panel down
the right side of the screen, full height, so the world stays in view on the left. Esc or the X
closes them. Buttons that delete or remove something are red, and the step that finishes something
(Export to Map, Nudge, Place, Save) is green. Help you only need the first time is a tooltip (point
at a button or an icon), not text in the menu; a tool's how-to is its **Help** link, which puts it
in chat. Forms with fields (the map's name and settings, a typed position or height, a gamertag)
are side menus too, the game's own fields with a green button at the bottom. The rules every menu
follows are in `docs/ui.md` ("The map editor's menus"). In chat, a map is named `[Game : Map]`, the
game in gold and the map in orange.

**The map menu** (slot 9, locked), top down:

1. **Quick icons**, each with a tooltip when you point at it:
   - **The checklist pill** (a check and "2/5", the check green when nothing is missing): each
     thing the map's game needs, green when done, with what the build would refuse the map for. Tap
     an entry to get its tool, already set to that list. **Publish** is at the bottom: once nothing
     is missing, it puts the map in the lobby (see "Publishing").
   - **Undo** and **Redo** (faded when there's nothing to undo or redo; the tooltip says what they'd
     change). The menu opens again afterward, so you can undo several steps.
   - **The eye** (Boundaries): a switch for every boundary the map has (the bounds, kill Y, kill
     regions, and each other region), and **Show all**. A boundary switched on shows to you all the
     time, whatever you hold (see "Boundaries" below). Your switches are kept for your next map and
     the next boot (`work/editor/view.json`).
   - **The play icon** (Preview, game maps only): see "Preview".
   - **The gear** (map settings): **Players** and **Back to Lobby** (a house, at the right end) in its
     icon row (Select is on the map's card in the editor lobby); **Name and game settings** (the
     map's name, its **Map id** once it has a name, and the game's own settings in `map.json`, such
     as a number a game reads, as text fields; see "A new map id"); **Edit Map Thumbnail** and **Edit
     Minigame Thumbnail** (a game's maps, see "Pictures"); **Drop build commands** (red, maps made by
     `npm run bake`), which keeps the world as you change it; **Publish** (green, the checklist's
     too, see "Publishing"); and **Delete map** (red, see "Deleting a map").
2. **Tools:** a grid of the tools' icons (the Spawn tool, the Game marker tool when the game has
   markers of its own, the Region tool, the Kill Y tool, the Camera tool, the Snapshot tool, the
   Mannequin tool on a game's map, and the Time tool), with their names as tooltips. Tap one to put it in slot 1 and in your hand; the menu closes (open it
   again for the tool's settings). Tap it again to put it away. The one you have out is outlined.
   One tool is out at a time: picking one puts any other away. The tool isn't locked, so you can
   move it; whatever was in slot 1 moves to a free slot.
3. **The tool's settings** (they scroll): a **Help** link (the tool's how-to, in chat, with a
   chime; the menu stays closed so you can read it), then:
   - **Spawn tool:** every spawn the map has, by list (spawns, each team's spawns, the spectator
     spawn and the queue spawn). Tap one for its screen.
   - **Game marker tool:** every marker the map has, by list (each point the game asks for, each
     team's for a per-team one). Tap one for its screen.
   - **Region tool:** your selection's size, **Save the selection** (its screen) and Clear, then
     **Bounds and regions**: every box the map has. Tap one for its screen (see "Region tool"
     below). While the map menu is open, every boundary is outlined.
   - **Kill Y tool:** **Kill Y** and, on a game's map, **Build limit above** and **Build limit
     below**, each with its height ("not set" until it is), listed like the spawns. Tap one for its
     screen.
   - **Time tool:** the map's time of day. Tap it for its screen.
4. **Save:** a green bar at the bottom, outside the scrolling part. It saves the world into the map
   now (see Saving); its tooltip says whether blocks changed since the last save.

**Tools set things; menus are in the map menu.** No tool opens a menu when you use it at the sky:
the Spawn tool opens an entry's screen only aimed at a block, the Region tool only grows its box
(save it from the map menu), and the Camera tool places a camera at once. The exceptions set one
thing that isn't anywhere: a use of the Snapshot tool lists the cameras, and a use of the Kill Y
tool or the Time tool opens its screen (with the back arrow to the map menu). A screen for what a tool
sets up has a toggle first, then its settings and nudge rows (a
minus and a plus each, **Step** cycling how far), and a green button pinned at the bottom that saves
it; closing it keeps nothing. Once a new spawn, marker or box is saved, the next new one's screen
starts over from the first choices (the first tile and list option, Center on block off, no
facing, Snap Exact). While you hold a tool, the line above the hotbar says what a use does.
Blocks break as usual with an empty hand or anything but the editor's items (in creative: Edit puts
you back in creative at every spawn).

- **The aim cursor:** holding the Spawn tool, the Region tool or Select's tool, an entity shows
  where a use lands, up to 64 blocks out: a glowing outline around the block for the box tools, a
  see-through marker at the exact spot (turned the way it will face) for spawns and points: a
  mannequin, a post or the game's own model (Bridges' hole), like the list's markers. It's an
  entity, so it follows the aim at once and hides behind blocks.
- **Spawn tool:** aim at where an entry goes and use it, within 64 blocks. On top of a block, the
  spot is exactly where you aim (to a hundredth of a block, like an entity); at a block's side, just
  in front of that spot, on the floor below it; at the sky, nothing. **Sneak and use** it for where
  you stand, facing the way you look. Its screen: what it is (tiles: **Spawn**, **Spectator**,
  **Queue**), then for a spawn in a team game a **Team** list (each team, and **No team** when the
  game has plain spawns too), the position (tap it to type one, **Move here**, **Center on
  block**), the facing (**Take my facing**, **Clear facing**, **Snap**), the queue's Lock in and
  Countdown for the queue spawn, and X, Y and Z nudge rows; the see-through marker shows it while
  the screen is open. **Place** (green) adds it. A game that asks for team spawns has no plain
  spawns unless its config names them (`docs/maps.md`): its spawns are its teams'.
- **Game marker tool:** only for a game (or the lobby) whose config asks for points, such as the
  lobby's terminal or Bridges' holes. It works like the Spawn tool, but its screen starts with a
  **Marker** list (the game's markers), then a **Team** list for a per-team one, then the same
  position, facing and nudge rows. A list is a row with an arrow: tap it and its options open under
  it, the one picked outlined; tap one to pick it and close the list.
- **Markers:** every entry shows as a marker with a name tag: its list, its number, and the way it
  faces when that's saved. Spawns are player mannequins and points are posts (a thin post with a
  square head, such as the lobby's terminal), unless the game's config picks another style or a
  model of its own (`marker`, see "What a game's maps need" in `docs/maps.md`); a camera is a
  camera head. Markers are colored by kind: spawns orange, the spectator spawn gray, the queue spawn
  aqua, points yellow (a game's own model keeps its texture), and a team's spawns and markers in
  the team's color (a red team's spawn is a red mannequin; a game's model takes it on its bones
  named `tint`, such as the rim of Bridges' hole). Each has a glowing
  red line, 2 blocks long, the way it faces (the saved facing, tilted with its pitch, or toward the
  middle of the map), from a mannequin's eyes or a post's head, and the whole marker turns that
  way. **Hit a marker** for the same screen as placing one, with
  **Renumber** and **Delete** (red); **Save** (green) writes the changes, including moving it to
  another list. A game's own model can be hit anywhere on it: its hitbox is the model's size
  (square around the marker, from its lowest part to its highest), which also means it's in the way
  of hitting or using the blocks inside it.
- **Queue spawn:** where players wait for everyone to join, before the game puts them at their
  spawns (see "The queue spawn" in `docs/maps.md`). Its marker reads "Queue spawn (lock in, 5 s)".
  Hit it for two more buttons: **Lock in** (on: players can look around but not move, and are
  invisible to each other, held up in the air if it's there; off: they roam free) and **Countdown** (the seconds, once everyone's
  in, before they go to their spawns; 5 at first).
- **Region tool:** picks a box, for the bounds, a region or a kill region (anyone inside a kill
  region is out). The bounds can be several boxes: a player inside any of them is in.
  - **Hit a block** to start a new selection: that one block.
  - **Use the tool on a block**, up to 64 blocks away, to grow the selection to it, on every axis.
    Any box can be picked without placing blocks: hit one corner, then use the tool on the blocks
    at the far edges.
  - **Save the selection** in the map menu (the tool's settings) opens the selection's screen (used
    at the sky, the tool does nothing). While it's open, the box shows as your selection with every
    boundary, whatever you hold:
    - **What to save it as:** tiles for **Bounds** (replacing every bounds box), **Add bounds**
      (another bounds box, once the map has one) and **Kill region**; then a **Region** list for
      the rest (the regions the game asks for, any others the map has, and **New region**, with its
      **Name**: letters, digits and `_`), and a **Team** list for a team's region (Bridges' Spawn
      guard). A region holds a list of boxes, and each save adds one.
    - **Floor at kill Y** (the bottom of the box at kill Y), **Back one step**, and a minus and a
      plus for each side, the outline following at once.
    - **Clear selection** (red), and **Save** (green) at the bottom. Saving clears the selection:
      the box is the map's now.
  - **A box the map has:** tap it under Bounds and regions in the map menu for the same screen, set
    to what it is: change its sides with the nudge rows (the outline shows them in place of the
    saved box), make it something else (the tiles and lists; **Bounds** makes it another bounds
    box), **Go to** it (on top, over its middle), **Delete** it (red), and **Save** (green). To
    change it more, delete it and box it again.
  - The checklist's bounds and region rows give you the tool already set to that row.
- **Kill Y tool:** players below kill Y are out. Use it, or tap Kill Y in the map menu, for its
  screen: type a height or nudge it (starting one block below your feet until kill Y is set), with
  only that plane drawn, at the height you're setting; **Set kill Y** (green) saves it, and
  **Remove kill Y** (red) removes it. Holding the tool, you see the heights' planes and no other
  boundary.
  - **Build limit:** on a game's map, the screen's tiles pick **Kill Y**, **Limit above** (no block
    above that height) or **Limit below** (none below it), each a height of its own (`buildLimit` in
    map.json; building games keep blocks between them), and the map menu lists all three. A use
    opens the screen on the one picked last (a build limit starts at your feet). Its planes are
    orange. The top must stay over the bottom.
  - The checklist's Kill Y and build limit rows give you the tool already set to that row.
- **Camera tool:** pictures for the lobby (see "Pictures"). Using it places a camera at your eyes at
  once, looking your way, of the kind the tool's settings say (**Game picture** off or on). Hit a
  camera to look through it (as the Snapshot tool does); right click it for its kind and Delete.
- **Snapshot tool:** takes a camera's picture (see "Pictures"). Using it lists the cameras; its
  settings in the map menu list them too.
- **Mannequin tool** (a game's maps): stand-ins for players in the game's picture (see "Pictures").
  Use it on a block to place a mannequin there at once, facing you; hit or right click one for its
  screen, or sneak and right click it for its next pose. Its settings in the map menu list them.
- **Time tool:** the map's time of day (`time` in map.json), where its servers stop the daylight
  cycle. Use it, or tap Time in the map menu, for its screen: the **Time** list (**Noon**, **Dusk**,
  **Midnight**, **Dawn** or **Custom**); for Custom, **Type a time** (hours and minutes on the
  24-hour clock, such as 14:30) and a nudge row that moves it an hour earlier or later. The world
  shows the time you pick while the screen is open; **Set time** (green) saves it, and **Remove
  time** (red) leaves the map without one (the editor shows noon).
- **Boundaries** are drawn as see-through colored sheets, the way Axiom and Litematica show a
  selection: plane blocks, each a 16x16 square one pixel thick, on every side of a box and across
  the bounds at each height. Holding the region tool, or with the map menu open on it, you see your
  selection (yellow), the bounds (white), kill regions (red), each other region in its own color (a
  team's region in the team's color), kill Y (red) and the build limit (orange). Holding the Kill Y
  tool, or with the map menu open on it, you see kill Y and the build limit only; while you set one
  in its screen, only that one, where you're setting it. A box being changed in its screen shows as
  the selection, with every other boundary. The boundaries you switched on in the Boundaries view
  (the map menu's eye) show whatever you hold. The planes are blocks, so everyone in Edit sees what
  anyone sees. They only go where there's air (a box's side through the ground shows where the
  ground is open), a block you place goes in their place, and your aim and clicks pass through
  them. While anyone looks through a camera they're taken away, and they're taken out of the world
  before every save.
- **Replace mode:** **/replace** (`/minecade:replace`) turns it on or off for you. While it's on, a
  right click on a block puts the block in your hand in its place, keeping what both blocks have
  (a stair's facing, a log's direction); with nothing in hand, or an item that isn't a block, a
  right click does what it always does. The block a right click would replace is outlined, and the
  box top right (where games show their clock) says **Replace mode** while no tool is in hand.

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
previewed yet), **Preview** on the Panel's Edit row, or `npm run editor -- preview`. In game it asks
first how many **fake players** the match starts with (a toggle from 0 up to what fits beside
everyone going, at most 7), then **Start preview** (green).

1. The editor saves the world (when blocks changed) and builds the game from this checkout, with
   the map as it is now, draft or not.
2. The game runs on port 19133, Select's port (the network's game port, so no trust prompt). Select
   closes meanwhile; anyone on it waits in the editor lobby, and it opens again on the same world
   afterward.
3. Once the game is ready (about 30 seconds), everyone in Edit is moved there. The game starts as
   soon as you're all in, even alone (a preview needs one player). The mode box top center reads
   **Preview** and the map.
4. When the match ends (a win, everyone out, or the time limit), each player gets **Preview over**
   in the side panel: **Replay** (green: you wait in the editor lobby while the same preview, with
   the same fake players, starts again), **Edit** (map editors: back to editing the map) and
   **Lobby** (the editor lobby). Closing it, or not picking within a minute, sends you back where
   the preview came from. **/exit** (`/minecade:exit`) ends it at any time with no menu and sends
   everyone back (for an invited guest, it only sends them home to the editor lobby), and so does
   **End preview** (the Panel's Preview row, or `npm run editor -- preview end`). **/restart**
   (`/minecade:restart`, map editors only) plays it again from the start for everyone, as if they
   all picked Replay: you wait in the editor lobby while it starts again. It can't restart on the
   same server, since a match changes the world (Bridges' blocks) and a preview starts from a fresh
   copy of the map.

**Fake players:** the ones picked before the preview loads wait with you from the start (the game
reads `PREVIEW_FAKES`), and **/fake** (`/minecade:fake`) adds more, `/fake 3` three, up to the
game's player limit. A fake player looks like a player (Steve) with a name tag, "Fake 1", "Fake 2"
and so on (hidden during the match, like players' unless the game shows name tags). In play, its
name tag shows its health as hearts like the HUD's (under its name when names show), and they drop
as it's hurt. The game treats it as one: before the match it waits where you do (at the queue spawn, unseen, nameless and
floating when the queue locks you in, or else at a spawn of its own) and counts toward the players needed to
start; it gets a team in team games, spawns, respawns and is eliminated by the game's rules; it has
a score like anyone, and its downs show in the kill feed. Down or out, it watches from where a player
would, nameless: on foot at the queue spawn when the map has no spectator spawn, else floating at
the spectator spawn (seen there, unlike a player, so you can tell where it went). It doesn't move
or fight back. Hit it, shoot it or knock it off like a player (a game's own weapons
work on it too: One in the Quiver's arrow kills it). Once the match has started, /fake only works
in games that let late joiners in (One in the Quiver; not Sumo). The packs for this live in
`editor/preview/` and only previews get them.

**A fake player's panel:** **right click** one for its side panel. On top, in a best-of game while a
round is being played, **Fake 1 wins the round** (green: the round goes to it, or to its team in
team games), then **Fake 1 kills you** (red: you go down, credited to the fake, as the game plays
out a player killing you). Either one closes the panel.

How a stand-in looks, its pose and where it stands for a picture is Edit's Mannequin tool (see
"Pictures").

**/switch** (`/minecade:switch`) trades places with a fake player while the match is being played:
`/switch 2` with Fake 2, else the one you look at, else the nearest. You swap where you stand and
look, your teams, lives and health; your kit's items in your team's color (Bridges' wool) take your
new team's color, the same counts in the same slots, and the fake goes where you were. Each keeps
their own name, score and kill credit. Both have to be in play (not down or out).

**From the editor lobby:** a map card's Preview icon (lit once its checklist is done) asks how many
fake players, then plays that map from its folder as it is, without opening it in Edit (Edit saves
first when it has that map open, and keeps running). You wait in the editor lobby while it starts,
it's just you and any invited guests, and the game sends you back to the editor lobby (**Edit** in
its menu opens the map in Edit).

A preview never counts toward stats.

## Pictures

The lobby shows a picture of each map (its tile, and the hologram when it's picked) and of each
game: the map's thumbnail and the minigame's. Cameras frame them, and the editor saves your
screenshot as the picture.

1. **Place a camera:** with the Camera tool, use it where the shot should be taken from, looking
   the way it should look. "Camera 1" appears there at once (a magenta marker whose red line shows
   where it looks), saved in `map.json`'s `cameras`. The tool's settings say what new cameras are:
   - **Map preview** (Game picture off): the map's thumbnail, with nobody in the shot (you're made
     invisible while you look through);
   - **Game picture** (on): the minigame's thumbnail, where you can walk into the shot.
   A new angle is a new camera: a camera keeps its place, but the Snapshot tool can nudge it.
2. **Snapshot:** use the Snapshot tool and pick a camera, or hit a camera with anything (the
   Snapshot tool goes in your hand). Your view moves to it with the HUD, the markers and the
   outlines hidden, and corner marks frame the 16:9 middle of the screen, which is what a picture
   keeps. Its side menu: **Take a screenshot**, **Back to my view**, **Game picture**, nudge rows to
   move it along X, Y and Z, **Turn** it and **Tilt** it (**Step**: small, medium or large), and
   **Use latest screenshot** (green). The back arrow goes to the cameras. **Shift** brings your own
   view back at any time (the frame's top line says so).
3. **Take the screenshot:** Take a screenshot closes the menu and says how, at the frame's top:
   **F1** hides everything (the frame too), **F2** takes Minecraft's own screenshot, **F1** brings
   it back. Scripts can't take one. The Xbox Game Bar (Win+Alt+PrtScn) and Windows (Win+PrtScn) work
   too.
4. **Use it:** use the Snapshot tool again (any editor item does, while you look through a camera),
   then **Use latest screenshot**: your newest screenshot (taken in the last 10 minutes, a JPEG
   from Minecraft's `com.mojang\Screenshots` or a PNG) has its middle 16:9 scaled to 320x180, kept
   with the others (`work/editor/shots/`, listed with where each was used in
   `work/editor/shots.json`), and saved as the map's `preview.png` or the game's `icon.png`. Your
   view comes back. The Panel's checklist card ("Newest screenshot as") and `npm run editor --
   picture [game]` do the same. Publish commits both.

**Edit Map Thumbnail** and **Edit Minigame Thumbnail** (the gear) show every picture kept so far,
two to a row, the one in use outlined green, each named for where it was used last; tap one to use
it. Pictures saved after Edit opened show from the next time a map opens there (the editor's pack
carries them). Edit Map Thumbnail also has **Import from another minigame**: pick a game, then one
of its maps with a picture (cards with the picture and the name); it asks first, uses that picture,
then asks **Import map name?**: **Import name** gives this map that map's name and map id too (see
"A new map id"), **Keep mine** doesn't. It's for a map you're reusing in another game.

**Mannequins** stand in for players in a game picture. With the Mannequin tool, use it on a block:
"Mannequin 1" stands there at once, facing you, a plain red figure (a see-through mannequin shows
where it'll go while you hold the tool). Hit or right click one for its screen, where every tap
changes it at once (Undo takes it back); **sneak and right click** one for its next pose (named above
the hotbar, the first again after the last):

- **Display:** **Skin** (**Color**, then Minecraft's Steve and Alex, then the players' skins the
  lobby's watcher saved, by gamertag), **Color** under it while the skin is Color (Red, Blue, Green
  and Yellow, White, Black and Gray, each as dark as its concrete), **Hold** (Nothing, or any item
  from the game's kits, such as Bridges' wool in the mannequin's color) and **Pose** (Standing,
  Walking, Running, Swinging, Aiming a bow, Placing a block, Falling, Cheering). Each is a list that
  opens under its row.
- **Position:** **Move here** (where you stand, facing your way), **Take my facing** (where it
  stands, facing your way), X, Y and Z nudge rows, **Turn** (15 degrees a tap, right is +) and
  **Step** (1, 0.5 or 5 blocks). Mannequins float where they're put and can't be hurt or pushed.
- **Delete** (red).

They're saved in `map.json`'s `mannequins` and have no name tag. Looking through a Game picture
camera, they stay in the shot (the markers hide); through a Map preview camera, they hide too
(nobody's in a map preview). Game servers never get them, and they're taken out of the world before every save,
so a published world never has them. Minecraft's skins are Mojang's, so they never go in git: the
editor copies them from the Minecraft install on this PC (its vanilla skin pack) each time it
builds its packs (`tools/editor/fake-player.ts`); one this PC lacks shows as the client's own Steve
or Alex. The players' skins come from `skins/` (see `docs/skins.md`) at the same time: classic
skins only (wide, slim, or an old 64x32 one made 64x64), since a character creator skin needs a
model of its own. `map.json` names one by a hash of the player's xuid, never the player, and a
skin this PC hasn't saved shows as Color. A skin the watcher saves shows after the editor's next
start.

Right click a camera for its form: **Game picture** (switches its kind) and Delete. The Camera tool's
settings list every camera too. Lobby maps can have cameras (the Snapshot only nudges them there),
but the lobby shows no picture of its own map.

## A new map id

**Map id** in Name and game settings (it shows once the map has a name), or an imported name, gives
the map open in Edit another id: everyone in Edit waits in the editor lobby, Edit saves and stops,
the folder moves to `maps/<new id>/`, its world's list in Select and Recent follow, and it opens
again under the new id with everyone back. An id the game has already is refused. A published map's
old folder is still in git: its removal goes with the map's next Publish (noted in
`work/editor/renames.json`).

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

## Deleting a map

**Delete map** (red, in Edit's gear) asks first, then:

1. everyone in Edit goes to the editor lobby, and Edit stops without saving;
2. the map's folder is deleted (`games/<game>/maps/<id>/`, or `lobby/maps/<id>/`);
3. a published map (one git tracks) has its removal committed as `Automated Map Delete : <Game>
   <Map> <date> <time>` and pushed, the way Publish does, so it leaves the lobby at the network's
   next start; a draft is only deleted;
4. it leaves its world's list in Select (every world's, open or not) and Recent.

Chat in the editor lobby says when it's done. A preview has to end first.

## How it works

- `npm run editor` (`tools/editor/`) starts the containers `minecade-editor-lobby` (19132),
  `minecade-editor-select` (19133) and `minecade-editor-edit` (19134) on the plain BDS image that
  `npm run bake` uses, each with the editor's packs (`editor/`), the shared packs, a world and
  `map.json` copied in. Their entrypoint is `docker/bds/entrypoint.sh` in editor mode, and each uses
  the identity the network's server on that port has (`lobby`, `game`, `editor`).
- **The runner** (`tools/editor/runner.ts`) runs the three: the editor lobby (`home-session.ts`) all
  the time, and Select (`select-session.ts`) and Edit (`session.ts`) once something is opened, all on
  `ServerSession` (`server-session.ts`: the server, the console, opping map editors, the live allow
  list for guests, and `goto`). Guests (`guests.ts`) are on the lobby's and Select's allow lists
  (`EDITOR_GUESTS`) and a preview's, never Edit's; a preview sends them home to the editor lobby
  (`GUEST_LOBBY_PORT`).
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
- The host answers on `127.0.0.1:8097` (`GET /status`, `POST /save`, `POST /publish`, `POST /preview`, `POST /preview/end`, `POST /guests`, `POST /picture`, `POST /open`, `POST /stop`),
  which the Panel and `npm run editor -- status | save | stop | <target> <map>` use. When the Panel
  boots the editor, its output goes to `work/editor/editor.log`.
- **The menus** are classic forms themed by the editor's resource pack, like the lobby's menus
  (`docs/ui.md`). A title starting with a layout mark (`LAYOUT` in
  `editor/behavior_pack/scripts/marks.ts`) gets a layout in `editor/resource_pack/ui/editor_forms.json`:
  `side` for the side menus, `map` for the map menu, `icons` for menus with an icon row (Select's map
  menu, the selection's form, Edit's gear) and `home` for the editor lobby's. A form's buttons are
  one list, and each part of a layout shows the buttons with its mark (`MARK`): the pill and the
  quick icons, the tools (with a column mark, `COLUMNS`, so they fill a 5-wide grid), Save, the
  button pinned at the bottom (`bottom`), and Nudge sides' rows (`minus` and `plus`, two columns
  that line up); everything else is a setting. Other marks draw a button red (`danger`) or green
  (`go`), outline it (`picked`, and `on` for the tool in hand), fade an icon (`dim`), make it a
  switch (`toggle`), give it an icon on its left (`card`), or make it plain text (`heading`). The tooltips
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
     dropped items, then finds the highest block (`getTopmostBlock` over the moved box's columns).
     Stopping the server saves it.
  3. Chunker prunes to the moved box's chunks, and the bake settings go into level.dat.
  4. The world is swapped into `maps/<id>/world`, and the new map's `map.json` written, with its
     spectator spawn 10 blocks above the highest block, which the pack measures after placing.

  Chunks are loaded with script ticking areas, a whole phase at once (the source, then the
  destination) when that fits the ticking limit (300 chunks), otherwise a 64x64 region at a time.
  After areas are removed, the next ones wait 2 seconds: an area next to chunks that are still
  unloading never finishes loading (found on the test world). The spike proved the rest
  (`docs/spike-results.md`, "Map editor"), and on build B of "Datapacking (imported)" the extracted
  map's block fingerprint matches the original exactly.
- **The boundaries** are a plane block (`minecade:plane`, written with its 48 geometries and 16
  textures by `tools/assets/plane-block.ts`: rerun it after changing the colors in
  `scripts/sheets.ts`). Its states are the axis it lies across, the pixel it sits on along it (0 to
  15) and its color (Minecraft's 16 dye colors). `scripts/sheets.ts` turns boxes and heights into
  sheets (a box's sides in the blocks just outside it, so the sides never share a block) and works
  out who sees what; `scripts/planes.ts` paints them a chunk column at a time with fills into air,
  erases the ones nobody sees, remembers every chunk it painted (`minecade:planeChunks`), and sweeps
  them before every save like the markers. Block geometry mirrors x, so a plane `n` pixels from a
  block's west side sits at `7 - n` in it.
- **Select's outlines** are particles (`editor/resource_pack/particles/outline.json`) sent to the
  holder only: Select works in a converted world that gets exported, so it puts no blocks in it.
  `viewDots` in `scripts/boxes.ts` works out where each dot goes and how big it is for that player
  (tune `DOTS` there), and each refresh has a budget, so a big map costs no more than a small one.

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

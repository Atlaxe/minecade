# Map viewer

A 3D view of any map in the map store, in the Panel. It reads the map's world straight from its
files, so it needs no server and works while the network or the map editor runs. It shows the map's
spawns, points, boundaries and regions as game Edit does, with the game's checklist beside them,
and changes them with the mouse or by typing their values: spawns and game markers placed, moved,
turned and deleted; bounds, spectator bounds and regions drawn from two corners, moved and resized;
kill Y and the build limit set and moved; the map's settings (its name, time of day, queue, game
settings and the lobby's star box) and pictures (its thumbnail, and on a minigame thumbnail map its
game's picture); with undo, Save and Publish. It never changes a world's
blocks, but **Port to another game** copies them into a new map of another game. Its **Worlds**
tab cuts new maps out of a world from a picture of it seen from above (see "Select from above").
The in-game editor (`docs/editor.md`) keeps every tool it has, and **In game** opens the map there
(see "In game").

## Opening a map

In the Panel, open **Maps**: every map in the store, in cards by game, each with its thumbnail
(the `preview.png` taken in game Edit, or a minigame thumbnail map's game picture, tagged
**Minigame thumbnail**; see "Pictures") and its checklist state (Ready or Not ready, Draft,
Unpublished changes). The search box finds maps by name or id; the dropdowns show one game, or one
status. **Click a card** to pick it, and the bar at the bottom offers **Edit (map) for (game)**:
it, Enter or a double click opens the viewer in the same window. The back arrow at the viewer's
top left returns to Maps, with the search and the pick as they were. The bar's **Port to another
game** makes the picked map's blocks a new map of another game (see "Port to another game"), and
its **Delete** (red) deletes the map (see "Deleting a map").

The first time a map opens, its world is read and kept in `work\viewer\maps\` (Temples takes about
0.1 s, then a few milliseconds); a world saved since is read again. A map wider than 256 blocks on
x or z, counting every block in its world, can't be shown: the viewer says how wide it is.

## Select from above

A second way to cut maps out of a world, beside in-game Select (`docs/editor.md`, "Select mode"),
which stays as it is. It needs no server to look, and exports run in the background while the
network keeps running.

**Opening a world:** in **Maps**, the **Worlds** tab lists this PC's Minecraft worlds (with their
icons, and how many maps came from each) and worlds opened before from a folder. Click one, then
**Select maps in (world)** (or double click it, or Enter); or type a world folder or a `.mcworld`
file's path in the box at the top and **Open**. The back arrow returns to Worlds.

**The picture** is the world from above, a pixel a block column: each column's top block in its
color, brighter the higher it is, with the slopes shaded. Barriers, light blocks and other blocks
nobody sees are looked through. The maps already cut from the world show as outlines with their
names (green when ready, dashed while being cut out, red when that failed). The wheel zooms toward
the pointer, a right or middle drag moves the picture, and **Fit** (Home) shows the whole world, or
the box. Up close, the chunks' edges show. The status line names the block under the pointer and
its height. The first look at a world reads it (about 1.5 s for Datapacking, 1808 by 1712 columns),
then it's kept in `work\viewer\worlds\` until the world changes.

**The box:** drag on the picture to draw one, up to 256 by 256 blocks (it stops growing there, and
says so). Drag its edges or corners to resize it, or its inside to move it; or type its corners in
the right panel.

**The height** is trimmed to the lowest and highest block in the box, and shown from the south with
a floor line and a ceiling line: drag them (or type Floor Y and Ceiling Y) to leave out what you
don't want, such as the ground under a build, which the trim takes in at first. What's left out is
dimmed. **Trim to the blocks** puts them back.

**3D** (top left, beside From above) shows the box's blocks from the floor to the ceiling in the
viewer's drawing, with the view cube: a look before exporting. It's read only.

**Export to map** takes the same choices as in-game Select's Export to Map: the game (or the lobby),
the map's name, and its id (made from the name until you type one; lower case letters, digits, _
and -, and not one the game has or this world's list has). **Export** queues it: the Panel cuts the
box out of a copy of the world and moves it to the middle with the same extractor in-game Select
uses (Chunker, then a throwaway server with no ports and no players, `minecade-extract-panel`, so
in-game Select can export at the same time), and the map appears in the store as a draft whose
spectator spawn is 10 blocks over its highest block. **Open it in the viewer when it's ready** (on at
first) opens it once it's done, if this page is still open. The Panel stays up until every export
is done, and Restart Panel waits for them.

**Maps from this world** lists them with how each is going: **Show** frames one on the picture,
**Open** opens a ready one in the viewer, and a failed one has **Retry** and **Forget** (off the
list; its map, if any, stays).

## The window

- **The top bar:** the back arrow, the map's thumbnail (its game's picture on a minigame thumbnail
  map), name and game; then Undo, Redo, Settings
  (the sliders), **In game**, **Save** and **Publish** on the right. In game's square is green
  while game Edit has the map open.
- **The left panel:** the tools, in rows of four, then two tabs, **Checklist** (the game's
  checklist and the **checks**) and **Overview** (what the map has), each with its own search.
- **The view**, with the view cube in its top right corner.
- **The right panel:** what the tool or the picked entry can change; with Select and nothing
  picked, **Map settings** (see "Map settings") and the cuts; with the Cut tool, the cuts.
- **The status line:** what's picked, what's under the pointer, and the map's size.

Hover any button for a second: its tooltip says what it does, with its key. The keys below are the
defaults: every one can be changed (see "Keys").

**No helper text** (the user's rule, 2026-11-10, as for game Edit's menus in `docs/ui.md`): a
setting's label says what it is, with no sentence under it explaining what it does or where else it
shows (the Minigame thumbnail map box had one, "A map for taking the minigame thumbnail..."). What
only a first use needs goes in the button's tooltip, or in these docs.

## Moving around

| | |
|---|---|
| Right drag | Turn around the spot you press on (the block or marker under the pointer): it stays where it is on screen while the view goes around it. Pressed on nothing, around the middle of the view |
| Left drag, with Select | The same, from anywhere that isn't a marker, the knob or the gizmo (in Top view it draws a rectangle) |
| Shift + right drag, or middle drag | Move sideways |
| Wheel | Toward the spot under the pointer (or away from it), which stays under the pointer; it stops a block short |
| Double click a block | Center the view on it |
| **The view cube** | Turned the way you look. Click a face (N, S, E, W, Top, Bottom), an edge or a corner to look from that side; Top is a flat floor plan, north up |
| **Home** (beside the cube, or the Home key) | The whole map |
| F | Frame the picked entry |

**WASD flying** (in Settings, off at first): W, A, S and D move along the ground the way you
look, Space goes up and Shift down, at the speed the settings say. Turning and the wheel work as
they do without it: around the spot you press on (pressed on nothing, you turn where you are), and
toward the spot under the pointer, at least half a block a notch, so the wheel carries on through a
wall. A block you fly into isn't drawn, and clicks go through it, so a tool used from inside a wall
works on what's beyond it.

## Cutting through

The **Cuts** in the right panel slice the map, X (red), Y (green) and Z (blue), each by its slider:

- **Y:** everything above the slider's layer is cut. Page Up and Page Down (or `]` and `[`) move it
  a layer, with Shift five. The layers the cut uncovers show their tops, with a faint grid up close.
- **X** and **Z:** the same along x and z. **Flip** keeps the other side.
- **Here**, then a click on a block, puts that cut at it; **Off** takes it away.
- The **Cut tool** (C): a click on a block cuts there, along the axis picked in its panel (Y at
  first). Useful for tall maps, such as Sinkhole.

What's past the cuts is drawn see-through (**Faded**) or not at all (**Gone**), in Settings.
Clicks never land on it. With the Top view and a Y cut, you see each floor of a building in turn.

## The tools

The grid at the top of the left panel, four to a row, each with its key (none of them W, A, S or
D):

| Tool | Key | What a click does |
|---|---|---|
| **Select** | V | Picks a marker, a box or a height (see "Picking with a click"; anywhere else picks nothing, and a drag from there turns the view); the picked entry can be moved, resized, typed in, duplicated or given another type |
| **Spawn** | P | Places a spawn into the list picked in the right panel |
| **Marker** | M | Places one of the game's markers (off for a game without any) |
| **Region** | B | Two clicks draw a box into the list picked in the right panel |
| **Height** | H | Sets kill Y or a side of the build limit |
| **Mirror** | I | Puts the mirror plane at the block, or picks a marker to mirror |
| **Cut** | C | Cuts the map at the block |
| **Time** | T | Nothing: its panel sets the map's time of day (see "Map settings") |

Esc goes back to Select (and, in Select, picks nothing). Clicking an entry in the overview picks it
with Select and frames it in the view.

### Picking with a click

With Select, a click picks the first of these under the pointer:

1. A marker in front of the blocks.
2. A box or a height whose outline (a box's edges, a sheet's rim) passes within 6 pixels of the
   pointer, the nearest. Box edges show through blocks, so they're picked through them too.
3. A region the pointer goes into before the block under it, the smallest when there are several:
   a click on a build boundary's floor picks that boundary. A region the camera is inside is left
   out.
4. The bounds, the spectator bounds or a height with nothing behind it (only sky).

The bounds and the spectator bounds usually hold the whole map, so a click on a block inside them
still picks nothing: click their edges. The status line names what a click would pick, before the
block. Shift + click adds it to the pick, or takes it out. What's past a cut isn't picked.

## The map's markup

Everything game Edit's tools place is drawn over the blocks, in game Edit's colors:

| | Drawn as |
|---|---|
| Spawns | An orange figure; a team's spawns in the team's color |
| Spectator spawn, queue spawn | A gray-blue figure, a light blue one |
| Game markers (points) | A yellow post with a square head, a team's in its color, or the game's own model (Bridges' hole, Paintball's power-up) with its rim or marked parts in the team's color |
| Bounds, spectator bounds | White and light gray box edges with faint faces |
| Regions | Box edges in the region's color: kill regions red, a team's region its team's color, the others a color each |
| Kill Y, build limit | A red sheet and orange sheets across the map at that height |

Every spawn and marker has a red line toward where it faces (to the map's middle when it has no
facing of its own), and its name over it (Names, in Settings, turns them off). Box edges show
faintly through blocks. Markers past a cut are faded or gone with the blocks; a marker counts as
past the cut when the block it stands on is, so cutting at a floor keeps the spawns on it.

**The left panel** has two tabs under the tools; the one last open stays open next time.
- **Checklist** (its count is what's left to do and the checks found): the game's checklist (each
  thing the map needs, with how many it has, then what the build would refuse it for, in red, and
  warnings), then the **checks**.
- **Overview** (its count is the entries): what the map has, by the lists game Edit's tools place
  into, under Spawns, Game markers and Boundaries. Only lists with entries show, and only sections
  with such a list: a map with no spawns yet has no Spawns section, and none without a build limit
  has one. What's still needed is the checklist's job.
- **Search:** each tab has its own box, kept while the other tab is open. It shows what has every
  word typed, in any case: the checklist's rows, problems, warnings and checks; the overview's
  entries by name or by the numbers of their place, or a whole list or section by its name
  ("red", "boundaries"). Esc empties the box, and Esc again leaves it.

**Checks** are what a look at the blocks finds, as warnings: Save and Publish still work. Click one
to pick the entry it's about (or, for blocks, to look at the first of them).

- A spawn or game marker whose feet or head are in a block.
- A spawn (not the spectator spawn) with nothing to stand on within 3 blocks below it. Barriers and
  invisible bedrock count, as players stand on them; so does water.
- Build Swap's build boundaries that overlap, or whose shell (the block around each, where the game
  clears liquids) reaches another; and a spawn the game pairs with no boundary (more spawns than
  boundaries) or with one more than 3 blocks away. Each spawn goes with the boundary it stands in,
  else the nearest free one, as the game pairs them.
- Game Edit's boundary blocks (`minecade:plane`) left in the world, counted from the blocks.
- **Blocks without a look:** blocks with no color (drawn bright pink), each with how many there are.

When `map.json` changes (game Edit, a hand edit, another viewer), the viewer shows the change within
a second.

## Spawns and markers

- **Spawn** or **Marker**, then pick the list in the right panel: a see-through marker follows the
  pointer, and each click on the top of a block puts an entry there. A click on a block's side or
  underside puts it just in front and drops it to the floor below, as game Edit does. The spectator
  and queue spawns hold one entry: placing one replaces it.
- **Center on block** (on at first, remembered) puts an entry at its block's middle; off, it goes
  exactly where you click. Switching it on with a marker picked that stands at an exact spot moves
  that marker to its block's middle, at the same height and facing the same way, as game Edit's
  entry screen does.
- **The picked marker** (Select) has the move gizmo: a white cube with arrows out along X (red),
  Y (green) and Z (blue). Drag an arrow to move it along that axis in whole blocks (Shift: to a
  hundredth), click one to step a block that way, or drag the cube to move it across at the same
  height. Dragging the marker itself moves it along the floor, landing on whatever is under the
  pointer.
- **The red knob** on the floor in front of the picked marker turns it, in 15 degree steps (Shift
  for whole degrees).
- **The right panel** shows its X, Y and Z (whole X and Z are the block's middle, as in `map.json`)
  and, with **Faces a fixed way** on, its yaw and pitch: type a value and press Enter. Off, it faces
  the map's middle.
- **Type** (under its name) is the list it's in: pick another to move it there, where it is and
  facing the same way, as one change (a spawn to the queue spawn, a team's spawns or one of the
  game's markers). The spectator and queue spawns hold one entry, so the one there is replaced; the
  note says so, and undo brings it back. The moved entry stays picked.
- **The queue spawn**, picked, also has **Players wait here**: **Lock in** (they look around but
  don't move, and can't see each other) or **Free** (they roam until they're put at their spawns).
- **Delete** (the key, or the button) removes it.

## Boxes: bounds, spectator bounds and regions

- **Region**, then pick where the box goes in the right panel (Bounds, Kill region, each of the
  game's regions, a team's, any the map has of its own, Spectator bounds), then click one corner
  block and the opposite one: the box takes both blocks in. The second corner can be on another
  layer: move the Y cut between the clicks. A see-through box shows what you'd get, with its size.
  A second bounds box makes the bounds a list (a player inside any box is in), as game Edit's Add
  to bounds does.
- **New region** in the Region tool's panel asks for a name (letters, digits and _, starting with
  a letter) and then draws its first box, like game Edit's New region.
- **The picked box** has two modes, **Move** (G) and **Resize** (E). Move gives it the move gizmo:
  drag an arrow (or click it) to move the whole box along that axis, or the cube to move it across.
  Resize gives it a square on each face, opposite faces joined by a line along their axis in the
  axis's color: drag a square to move that face in whole blocks (never past the other side); click
  one to pick that face, then the arrow keys move it out (Up, Right) or in (Down, Left), five at a
  time with Shift, as do **In** and **Out**.
- **The right panel** shows the box's corners, From (its lowest block) and To (its highest), to type.
- **Type** (under its name): the bounds, the spectator bounds, a kill region, the game's regions, a
  team's, or the map's own. Pick another to move the box there as it is, last in that list. A list
  with a minimum size refuses a box smaller than that.
- **To Y cut**, **To X cut** and **To Z cut** (when that cut is on) move a face onto the cut: the
  picked face when it's on the cut's axis, else the face nearer the cut.
- A region the game gives a minimum size (Build Swap's build boundaries, 24 each way) is drawn at
  least that big: each side shorter than that runs on from the first corner the way the second
  lies (up when both are on one layer), so two clicks on a floor make a box tall enough with no
  block up there to click. The box shown before the second click is already that size. Moved or
  resized smaller, it shows red and isn't saved, as in game.
- **Delete** removes the picked box.

## Kill Y and the build limit

- **Height**, pick Kill Y, Build limit above or Build limit below, then click a block: kill Y goes
  just under that block (players who fall off it are out), and a build limit to its top (where a
  player standing on it builds from), as game Edit's Kill Y tool starts them.
- **The picked height** has a green arrow up and down: drag it, click it to step a block, or use the
  Up and Down arrow keys (Shift: five), the panel's buttons, or type Y. **To Y cut** puts it where a
  click on the cut's layer would.
- Kill Y runs from -64 to 319, a build limit from -64 to 320, and the build limit above stays over
  the one below, as in game: a height that breaks these isn't saved, and the viewer says why.
- **Type** (under its name): Kill Y, Build limit above or Build limit below, at the same y. One
  that was set already is replaced (undo brings it back); a height the rules refuse there isn't
  moved.
- **Delete** removes it.

## Picking several and copying

- **Pick several:** with Select, Shift + click markers, boxes or heights in the view, or entries in
  the overview, to add them to the pick (Shift + click a picked one to take it out). In Top view (the cube's top), drag a
  rectangle from anywhere that isn't a marker: it picks every marker and box whose middle is inside
  (Shift: adds them). Esc picks nothing.
- With several picked, the right panel names them and acts on them all: **Delete** (the key too)
  removes them as one change, which one undo brings back.
- **Copy to another team** (under a picked team entry's values, or in the panel for several): adds a
  copy of each picked team entry (team spawns, a team's markers and regions) to that team's list,
  in the same place.
- **Duplicate** (Ctrl+D, or the button beside Delete): adds a copy of each picked spawn, game marker
  and box (bounds, spectator bounds, regions) to its own list, in the same place, as one change,
  and picks the copies, ready to drag where they go. The spectator and queue spawns hold one entry
  and a height is one value, so they're left out (with no button), and the viewer says so.

## Mirror

The **Mirror** tool (I) mirrors spawns, game markers and boxes across a plane you place. What was
picked with Select stays picked when you switch to it, and back.

1. **Place plane:** the plane (a blue sheet standing across the map) starts at the map's middle, the
   middle of its bounds that every marker faces without a facing of its own. With **Place plane** on
   (it is when nothing is picked), the plane follows the pointer: click a block to put it there, at
   the block's edge or middle, whichever the click is nearer. Its arrows above the map drag it half a
   block at a time (a click on one moves it half a block), or type its X or Z. **Map's middle** puts
   it back.
2. **Pick entries:** after the plane goes down, a click on a marker or a box (as Select picks them)
   picks it, or takes it out again, and so does a click on an entry in the overview. **Spawns**,
   **Game markers** and **Boundaries** pick every one of them (a second click takes them out), **None** picks nothing, and in Top view a
   rectangle dragged from anywhere that isn't a marker adds what's in it. A see-through copy shows
   where each picked entry would go.
3. **How:**
   - **Left to right** mirrors across a plane at x, **Front to back** across one at z, and **Half
     turn** turns everything half around the line where both planes meet (both show, with their
     arrows, and the cube between them drags the line).
   - **Team entries go to** the other team (Red to Blue; with more teams, the next one, or a team you
     pick, or their own).
   - **Copies** adds mirrored copies and leaves the picked entries where they are. **Move** moves the
     picked entries themselves, into the other team's list when they change team.
4. **Mirror** does it, as one change that one undo takes back, and picks nothing.

A whole x or z (a block's middle) mirrors to the middle of the block across the plane, an exact
point to the point; facings turn with them, and boxes stay whole blocks. The spectator and queue
spawns hold one entry each, so they're moved but never copied. At most 64 changes go at a time (a
move into another team's list is two).

## Keys

**Settings** (the sliders button in the top bar) has a **Keys** tab: every key the viewer uses, by
Tools, Changes, View and WASD flying, each action with up to two keys.

- **Click a key** (or **Add**), then press the key you want, with Ctrl, Alt or Shift if you like.
  Shift, Ctrl or Alt let go on its own is the key itself (flying down is Shift). Esc keeps the key
  as it was.
- A key another action had moves to this one: one key never does two things, and the line beside
  Done says which action lost it.
- The **x** beside a key takes it away. **Default** (shown when an action's keys aren't its own)
  puts them back, and **All keys to their defaults** puts every one back.
- Shift with the Y cut's and the nudges' keys still means five at a time, and flying's keys work
  with Shift held; for any other key, Shift makes it another key.

The tooltips and the lines that name keys follow the changes at once, and the viewer remembers them
in this browser.

## Undo, Save and Publish

Every change is written to `map.json` at once, in the same style game Edit writes it, and the
checklist updates with it. **Undo** and **Redo** (Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z) step through
the map's changes, wherever the focus is (except in a box you're typing in).

**With game Edit open on the same map** (In game's square is green), the viewer's changes go
through the map editor: markers move in game at once, and undo and redo are game Edit's, shared
with the players there. While game Edit is still opening the map, the Panel writes the changes, and
game Edit takes them once it's ready ("map.json was changed while Edit was opening it"), as one
undo step. A change made before game Edit read the map is where its history starts: undo then says
so instead of taking it back. An editor started before this viewer existed can't take them: the
viewer says to restart it.

- **Save** keeps the map as a version in the map store, as game Edit's Save does (with game Edit
  open on the map, it's game Edit's Save, which saves the world too).
- **Publish** asks first, then does what game Edit's Publish does: it's refused until the checklist
  is done, takes away the draft mark (an undo step), keeps a version, publishes it, and writes the
  store's `published\`. Its message says what happens next: a changed `map.json` reaches the next
  game with no rebuild; a new map, or a new name, picture or block, needs the network's next Start.
  With game Edit open on the map, it's game Edit's Publish.

## Map settings

What game Edit sets in its map menu's gear, its Time tool, its Game settings tool and the queue
spawn's screen, in three places. Each change is made when its field is done (Enter, or leaving it)
or a choice is picked, as one undo step; Esc in a field puts its value back. A value that doesn't
fit is put back, and the note over the view says why.

**Map settings**, in the right panel with Select and nothing picked (Esc picks nothing):

- **Name:** the map's name, up to 48 characters. Its map id shows above it: game Edit's Name and
  map id changes that, as the map's folder moves.
- **Countdown** (once the queue spawn is placed): 1 to 60 seconds once everyone is in at the queue
  spawn, before they're put at their spawns.
- **Game settings** (a game whose config names some, `map.settings`): each with its range, its
  unit and what it changes; the map's own value, or the default until one is typed. **Use the
  default** takes the map's own away. Build Swap has **Build padding** and **Return delay**.
- **Star box** (the lobby's maps only): stars all around the map, below the horizon too. Use it
  with a night time.
- **The game's other keys:** any other plain value of the game's own the map has (as game Edit's
  Name and map id lists them), kept to its kind: a number stays a number, true or false a switch.
- **Pictures** (a game's maps): the **Minigame thumbnail map** box, the game's picture while it's
  checked, and the map's thumbnail (see "Pictures").
- **Port to another game** and **Delete map** (red) (see below).

**The Time tool** (T): where the map's servers stop the daylight cycle. **Not set** (the editor
shows noon), game Edit's **Noon**, **Dusk**, **Midnight** and **Dawn**, or **Custom**, a time typed
on the 24-hour clock (14:30), with **An hour earlier** and **An hour later**. A click in the view
does nothing with it.

**The queue spawn**, picked: how players wait there, **Lock in** or **Free** (see "Spawns and
markers").

## Pictures

The lobby shows a picture of each game's map (its thumbnail, `preview.png`) and of each game (its
picture, the store's `working\<game>\icon.png`). They're taken in game Edit with the Camera and
Snapshot tools (`docs/editor.md`, "Pictures"); the viewer picks which ones are used. Under **Pictures**
in Map settings (a game's maps only; the lobby shows no picture of its own map):

- **Minigame thumbnail map:** check it on a map made for taking the game's picture (Bridges'
  BridgesThumbnail, say), an undo step like any setting (`"gameThumbnail": true` in `map.json`).
  Its card on the Maps page and its thumbnail in the top bar then show the game's picture, and the
  card says **Minigame thumbnail**. It changes nothing else: the map is still a map of its game.
- **Minigame thumbnail** (while the box is checked): the game's picture, whether it's **Published**
  or **Not published yet**, **Change**, and **Publish picture**, which asks first, then puts the
  game's picture in the lobby with no map published (a thumbnail map is often a draft that never
  is) and writes the store's `published\`. The lobby shows it from the network's next start. A
  Publish of any of the game's maps (here or in game Edit) publishes a changed picture too, as
  before.
- **Map thumbnail:** the map's own picture and **Change**. Publish puts it in the lobby with the map.

**Change** opens a dialog: **Use newest screenshot** (one taken in the last 10 minutes on this PC,
cropped to 16:9 at 320x180 and kept with the others, as the Snapshot's Use latest screenshot
does), and the pictures kept so far, newest first: those used before for a map's thumbnail (or a
game's picture, for Minigame thumbnail), each named by where it was used last, and those not
used yet. The one in use is outlined. Click one to use it; the dialog closes and the pictures in
Map settings, the top bar and Maps follow. They follow game Edit's pictures too when the viewer's
window comes back to the front.

The Panel's routes are GET `/api/viewer/pictures?target=&map=`, GET `/api/viewer/shot?id=`, POST
`/api/viewer/picture {target, map, kind: "map" | "game", shot: id | "newest"}` and POST
`/api/viewer/publish-picture {target}` (`tools/viewer/pictures.ts`). They write the picture files
themselves, with or without the map editor; game Edit's thumbnail menus show a picture changed
here from the next time it opens the map.

## Deleting a map

**Delete** in the Maps page's bar for the picked map, or **Delete map** under Map settings in the
viewer, asks first, then does what game Edit's Delete map does (`docs/editor.md`, "Deleting a
map"): the map's folder goes from the map store, a published map stops being published (it leaves
the lobby at the network's next start, or the lobby map picker for a lobby map), and it leaves its
world's list in Select (in game and from above) and Recent. Its versions stay in `maps.db`. The
viewer then goes back to Maps, which says what was deleted.

- **With the map editor running**, the editor does the deleting: when game Edit has the map open
  (or is opening it, as the Panel warms up the map picked), everyone there goes to the editor lobby
  and Edit stops without saving first. It's refused while a preview of the map runs. A map editor
  started before Delete was added says to restart it first.
- **With no map editor**, the Panel does the same itself.
- **The live lobby** (`LOBBY_MAP`, `spaceship` unless set) can't be deleted: pick another lobby map
  on the Servers page first.

The Panel's route is POST `/api/viewer/delete {target, map}` (`tools/viewer/delete-map.ts`), and the
editor's control port has `POST /delete`.

## Port to another game

A map's blocks become a new map of another game: One in the Quiver's KGB for Gunfight, say. The
world and the map's picture (its `preview.png`) always go, and so does what of its markup you check.
The new map is a draft, and the old map stays as it is.

**Port to another game** is under Map settings in the viewer, and in the Maps page's bar for the
picked map. It asks:

- **Game:** every other game, the lobby last (the last one picked comes up first).
- **Name:** the old map's at first.
- **Map id:** the old map's, when the game can take it, else with -2 (or -3, and so on). A game
  can't take an id its list of maps has: its own maps, the maps of games it plays too, and the maps
  of games that play its maps (Gunfight plays Siege's, so a Gunfight map can't be called "strife",
  and a new Siege map can't take a Gunfight map's id), nor a map still being cut out of a world for
  it. The line under the fields says why.
- **What goes along:** a box for each kind of markup the old map has that the picked game can use,
  each with what of it would go, all checked at first (a box you uncheck stays unchecked next
  time, in this browser). What the game can't use is named under them ("Stays behind: 11 spawns").
  - **Spawns:** plain spawns, when the game uses them (Gunfight places players at team spawns
    only, so KGB's spawns stay behind); team spawns of the game's own teams; the spectator spawn
    and the queue spawn with how players wait there (not for the lobby).
  - **Game markers:** the ones the game names (a Bridges hole goes to another game with holes).
  - **Boundaries:** bounds, spectator bounds, kill Y, kill regions and the regions the game names,
    and the sides of a build limit it asks for.
  - **Time of day**, **Cameras** and **Mannequins**, as they are.
  - **Game settings:** the game's own settings the map has a value for that fits (by key), and the
    star box for the lobby.

  Where the map was cut from and its own kits never go.

**Port** copies the world as last saved (game Edit, with the map open and blocks not saved yet,
has to save first) and the picture into the store's `working\<game>\<id>\`, writes the markup
checked into its `map.json`, and keeps it as the new map's first version ("Port from quiver/kgb"). The dialog then offers **Open it**, the new map in the viewer;
from the Maps page, the new map is picked. A game that plays another game's maps through
`map.borrow` doesn't need a port for them: a port is for a map of its own, marked up its own way.

## In game

The in-game editor (`docs/editor.md`) is for what the viewer doesn't do: blocks, and playing the map.
The Panel gets it ready in the background, so going in game is quick:

- **While the Maps page or a viewer is open**, the map editor boots by itself (about 10 seconds, the
  editor lobby only), unless the network runs: the two use the same ports, and the Panel never
  stops the network on its own. The Maps page's line beside its tabs says how it's going, with the
  join address.
- **A map picked** on the Maps page, or opened in a viewer, starts opening in game Edit at once
  (about 4 seconds for Temples), while nobody is using Edit: a map someone is on, or waiting for, is
  never taken from them. Picking another map calls the first off, even halfway through starting.
- **When nobody has used it** for 15 minutes (no page open, nobody on its servers), a map editor
  the Panel booted shuts down (Edit saves first), and so it does when the Panel itself closes with
  nobody on it. One booted from a terminal is left alone.

**In game** in the top bar opens a menu: where the map editor is, whether this map is open in Edit
and who is on it, the join address with **Copy**, and:
- **Open in game:** opens this map in game Edit for sure, booting the map editor if it's off. With
  the network running, it asks first, then stops the network. Map editors already in the editor
  lobby, and any who join it in the next 10 minutes, go straight to this map (once each); the menu
  says until when.
- With the map open in Edit: **Preview** (play it as its game, as game Edit's Preview does; not for
  lobby maps, and only once the checklist is done) or **End preview**, and your newest screenshot
  (taken in the last 10 minutes, cropped to 16:9) as the **Map preview** or the **Game picture**.

Esc or a click elsewhere closes the menu.

**When game Edit saves the world** (its Save, the viewer's Save while game Edit has the map, a
preview, or shutting down with blocks changed), the viewer draws the blocks again: the page loads
again once nothing is under way (no drag, nothing being typed), keeping the camera, the cuts, the
tool and the pick.

The Panel's Servers page still starts and stops the network; starting it while the map editor runs
shuts the editor down first (Edit saves first), asking only when someone is on it.

## How it looks

**Look** (in **Settings**, the sliders button in the top bar, on its View tab) is **Average colors** or
**Vanilla textures**:

- **Average colors:** each block face is one color, the most common color of its texture (the
  average of a texture's pixels turns many blocks brown).
- **Vanilla textures:** each face shows its texture, its pixels crisp, repeated once per block
  (the first frame of an animated one). Plants are cut out by their textures; leaves and other
  blocks with see-through pixels have them filled with the block's average color, as Minecraft's
  fast leaves look; glass shows its frame. The textures load the first time it's picked.

Both tint grass, leaves and water as in a plains biome and shade the sides (tops brightest), and
**Settings** changes the rest:

- **Corner darkening:** corners where blocks meet are darker.
- **Brightness variation:** each block a little brighter or darker, so big floors don't look flat.
- **Darken below the Y cut:** the deeper below it, the darker, so the cut layer stands out.
- **Hidden blocks:** outlines barriers (red), invisible bedrock (purple) and light blocks (yellow),
  which aren't drawn otherwise: the walls and floors a game has that nobody sees.
- **Past the cut:** Faded or Gone. **Names** over the markers. **WASD flying** and its speed.

The viewer remembers them in this browser.

**Shapes.** Blocks are drawn in their shapes, so a click lands where a player would stand:

| Blocks | Drawn as |
|---|---|
| Slabs | Their bottom or top half (double slabs are whole blocks) |
| Stairs | A half slab and the step, with their corners |
| Carpets, pressure plates, snow | A thin layer (snow by its height) |
| Fences, walls, panes, iron bars, chains | A post, with arms to the sides they join |
| Doors, fence gates, trapdoors | A thin panel where it is in game, shut or open (a door's two halves are read together, as the game reads them) |
| Flowers, grass, saplings, crops, torches, buttons, rails, signs | Two crossed faces |
| Water and lava | A block 14/16 high (full under more of the same); water is see-through, and so is the water around waterlogged blocks |
| Glass, panes, ice, slime, honey | See-through |
| A few others (chests, beds, farmland, enchanting tables, lanterns, heads, ...) | Their size |
| Custom blocks | Their collision boxes from the blocks pack (turned as the block is), else the selection box, else a whole block; a custom block with no collision is drawn as a plant |

Clicks pass through plants, water, lava and blocks that aren't drawn, so a click on a flower lands
on the grass under it, and a spawn placed on a slab or a carpet stands on its top (with **Center on
block**, at that height). Barriers, light blocks, structure voids and invisible bedrock aren't
drawn (see Hidden blocks). A block with no color at all is bright pink, and listed under the checks.

The status line also names the block under the pointer, its states and where it is.

### Where the colors and textures come from

From Minecraft on this PC (its vanilla packs) and the shared blocks pack (`packs\blocks`), worked
out the first time the viewer needs them (a few seconds) and kept in `work\viewer\looks\`
(`colors.json`, and the textures at 16x16 in `textures.bin`), which is made again when Minecraft or
the blocks pack changes. Nothing made from those textures goes into git, and the Panel serves the
textures only to its own viewer. Without Minecraft installed, vanilla blocks are pink.

The method gets a few blocks wrong. Ores are their stone mixed with their specks' color, and
glowstone takes its whole texture's average, but any block can be set by hand in
`work\viewer\looks\overrides.json` (create it), every face one color, with alpha if you like:

```json
{
  "minecraft:sea_lantern": "#b4d0c8",
  "minecade:smooth_soul_sandstone": "#6b5440"
}
```

It's read each time a map opens: open the map again to see a change. Deleting `work\viewer\`
is safe: everything in it is made again.

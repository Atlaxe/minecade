# Map viewer

A 3D view of any map in the map store, in the Panel. It reads the map's world straight from its
files, so it needs no server and works while the network or the map editor runs. It shows the map's
spawns, points, boundaries and regions as game Edit does, with the game's checklist beside them,
and changes them with the mouse or by typing their values: spawns and game markers placed, moved,
turned and deleted; bounds, spectator bounds and regions drawn from two corners, moved and resized;
kill Y and the build limit set and moved; with undo, Save and Publish. It never changes a world's
blocks. The in-game editor (`docs/editor.md`) keeps every tool it has.

## Opening a map

In the Panel, open **Maps**: every map in the store, in cards by game, each with its thumbnail
(the `preview.png` taken in game Edit) and its checklist state (Ready or Not ready, Draft,
Unpublished changes). The search box finds maps by name or id; the dropdowns show one game, or one
status. **Click a card** to pick it, and the bar at the bottom offers **Edit (map) for (game)**:
it, Enter or a double click opens the viewer in the same window. The back arrow at the viewer's
top left returns to Maps, with the search and the pick as they were.

The first time a map opens, its world is read and kept in `work\viewer\maps\` (Temples takes about
0.1 s, then a few milliseconds); a world saved since is read again. A map wider than 256 blocks on
x or z, counting every block in its world, can't be shown: the viewer says how wide it is.

## The window

- **The top bar:** the back arrow, the map's thumbnail, name and game; then Undo, Redo, View
  settings, **Save** and **Publish** on the right. "Open in game Edit" shows while game Edit has
  the map open.
- **The left panel:** the tools, the game's checklist, and the **overview** of every list.
- **The view**, with the view cube in its top right corner.
- **The right panel:** what the tool or the picked entry can change; with nothing picked (and with
  the Cut tool), the cuts.
- **The status line:** what's picked, what's under the pointer, and the map's size.

Hover any button for a second: its tooltip says what it does, with its key.

## Moving around

| | |
|---|---|
| Right drag | Turn around the map |
| Shift + right drag, or middle drag | Move sideways |
| Wheel | Zoom, toward the pointer |
| Double click a block | Center the view on it |
| **The view cube** | Turned the way you look. Click a face (N, S, E, W, Top, Bottom), an edge or a corner to look from that side; Top is a flat floor plan, north up |
| **Home** (beside the cube, or the Home key) | The whole map |
| F | Frame the picked entry |

**WASD flying** (in View settings, off at first): W, A, S and D move along the ground the way you
look, Space goes up and Shift down, at the speed the settings say. Right drag then looks around from
where you are, and the wheel moves forward and back. A block you fly into isn't drawn, and clicks go
through it, so a tool used from inside a wall works on what's beyond it.

## Cutting through

The **Cuts** in the right panel slice the map, X (red), Y (green) and Z (blue), each by its slider:

- **Y:** everything above the slider's layer is cut. Page Up and Page Down (or `]` and `[`) move it
  a layer, with Shift five. The layers the cut uncovers show their tops, with a faint grid up close.
- **X** and **Z:** the same along x and z. **Flip** keeps the other side.
- **Here**, then a click on a block, puts that cut at it; **Off** takes it away.
- The **Cut tool** (C): a click on a block cuts there, along the axis picked in its panel (Y at
  first). Useful for tall maps, such as Sinkhole.

What's past the cuts is drawn see-through (**Faded**) or not at all (**Gone**), in View settings.
Clicks never land on it. With the Top view and a Y cut, you see each floor of a building in turn.

## The tools

The row at the top of the left panel, each with its key (none of them W, A, S or D):

| Tool | Key | What a click does |
|---|---|---|
| **Select** | V | Picks a marker (anywhere else picks nothing); the picked entry can be moved, resized or typed in |
| **Spawn** | P | Places a spawn into the list picked in the right panel |
| **Marker** | M | Places one of the game's markers (off for a game without any) |
| **Region** | B | Two clicks draw a box into the list picked in the right panel |
| **Height** | H | Sets kill Y or a side of the build limit |
| **Cut** | C | Cuts the map at the block |

Esc goes back to Select (and, in Select, picks nothing). Clicking an entry in the overview picks it
with Select and frames it in the view.

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
facing of its own), and its name over it (Names, in View settings, turns them off). Box edges show
faintly through blocks. Markers past a cut are faded or gone with the blocks; a marker counts as
past the cut when the block it stands on is, so cutting at a floor keeps the spawns on it.

**The left panel** starts with the game's checklist (each thing the map needs, with how many it has,
then what the build would refuse it for, in red, and warnings), then the **overview**: every list
as game Edit's tools have them, under Spawns, Game markers and Boundaries.

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
- **To Y cut**, **To X cut** and **To Z cut** (when that cut is on) move a face onto the cut: the
  picked face when it's on the cut's axis, else the face nearer the cut.
- A region the game gives a minimum size (Build Swap's build boundaries, 24 each way) shows red
  while it's smaller, and isn't saved, as in game.
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
- **Delete** removes it.

## Undo, Save and Publish

Every change is written to `map.json` at once, in the same style game Edit writes it, and the
checklist updates with it. **Undo** and **Redo** (Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z) step through
the map's changes, wherever the focus is (except in a box you're typing in).

**With game Edit open on the same map** (the top bar says **Open in game Edit**), the viewer's
changes go through the map editor: markers move in game at once, and undo and redo are game Edit's,
shared with the players there. An editor started before this viewer existed can't take them: the
viewer says to restart it.

- **Save** keeps the map as a version in the map store, as game Edit's Save does (with game Edit
  open on the map, it's game Edit's Save, which saves the world too).
- **Publish** asks first, then does what game Edit's Publish does: it's refused until the checklist
  is done, takes away the draft mark (an undo step), keeps a version, publishes it, and writes the
  store's `published\`. Its message says what happens next: a changed `map.json` reaches the next
  game with no rebuild; a new map, or a new name, picture or block, needs the network's next Start.
  With game Edit open on the map, it's game Edit's Publish.

## How it looks

Each block face is one color: the most common color of its texture (the average of a texture's
pixels turns many blocks brown). Grass, leaves and water are tinted as in a plains biome. Sides
are shaded (tops brightest), and **View settings** (the sliders button in the top bar) changes the
rest:

- **Corner darkening:** corners where blocks meet are darker.
- **Brightness variation:** each block a little brighter or darker, so big floors don't look flat.
- **Darken below the Y cut:** the deeper below it, the darker, so the cut layer stands out.
- **Past the cut:** Faded or Gone. **Names** over the markers. **WASD flying** and its speed.

The viewer remembers them in this browser.

Everything is drawn as a whole block for now: slabs, stairs, fences, plants, glass and water get
their own shapes in a later pass. Barriers, light blocks, structure voids and invisible bedrock
aren't drawn. A block with no color at all is bright pink, and the status line counts them (hover
it for their names).

The status line also names the block under the pointer, its states and where it is.

### Where the colors come from

From Minecraft on this PC (its vanilla packs) and the shared blocks pack (`packs\blocks`), worked
out the first time the viewer needs them (a few seconds) and kept in
`work\viewer\looks\colors.json`, which is made again when Minecraft or the blocks pack changes.
Nothing made from those textures goes into git. Without Minecraft installed, vanilla blocks are
pink.

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

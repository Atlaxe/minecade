# Map viewer

A 3D view of any map in the map store, in the Panel. It reads the map's world straight from its
files, so it needs no server and works while the network or the map editor runs. It shows the map's
spawns, points, boundaries and regions as game Edit does, with the game's checklist beside them,
and changes them with the mouse: spawns and game markers placed, moved, turned and deleted; bounds,
spectator bounds and regions drawn from two corners and resized by their faces; kill Y and the
build limit set and dragged; with undo, Save and Publish. It never changes a world's blocks. The
in-game editor (`docs/editor.md`) keeps every tool it has.

## Opening a map

In the Panel, open **Maps**: every map in the store, by game, with its checklist state (Ready or
Not ready, Draft, Unpublished changes). **View in 3D** opens the map in a window of its own, one per
map. The first time a map opens, its world is read and kept in `work\viewer\maps\` (Temples takes
about 0.1 s, then a few milliseconds); a world saved since is read again.

A map wider than 256 blocks on x or z, counting every block in its world, can't be shown: the
viewer says how wide it is.

## Moving around

| | |
|---|---|
| Right drag | Turn around the map |
| Shift + right drag, or middle drag | Move sideways |
| Wheel | Zoom, toward the pointer |
| Double click a block | Center the view on it |
| **Home** (or the Home key) | The whole map |
| **Top** | Straight down and flat (no perspective), north up: a floor plan |
| **N**, **NE**, **E** ... | The whole map from that side or corner |

Left click picks a marker, drags it, or does what a tool does (Place, Cut here). The arrow beside
the views points north.

## Cutting through

- **Height:** everything above the slider's layer is cut. Page Up and Page Down (or `]` and `[`)
  move it a layer, with Shift five. **Cut here**, then click a block, puts the cut at that block's
  layer. **No cut** shows everything again. The layers the cut uncovers show their tops, with a
  faint grid up close.
- **X** and **Z:** the same along x and z. **Flip** keeps the other side; **Off** takes the cut away.
  Useful for tall maps, such as Sinkhole.
- **Past the cut:** **Faded** draws what's cut see-through, **Gone** leaves it out. Clicks never
  land on it.

With the Top view and a height cut, you see each floor of a building in turn.

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
facing of its own), and its name over it (**Names** in the top bar turns them off). Box edges show
faintly through blocks. Markers past a cut are faded or gone with the blocks; a marker counts as
past the cut when the block it stands on is, so cutting at a floor keeps the spawns on it.

**The side panel** on the left starts with the game's checklist (each thing the map needs, with how
many it has, then what the build would refuse it for, in red, and warnings), then every list as
game Edit's tools have them: Spawns, Game markers, then Boundaries (the bounds, each region, the
spectator bounds, kill Y and the build limit). **Click an entry** to pick it: the view frames it (a
height cut above it moves down to it) and the status line says where it is. Clicking a marker in
the view picks it too.

When `map.json` changes (game Edit, a hand edit, another viewer), the viewer shows the change within
a second.

## Placing spawns and markers

- **Place** beside a list (Spawns, a team's spawns, the spectator and queue spawns, each game
  marker) turns placing on for it: a see-through marker follows the pointer, and each click on the
  top of a block puts an entry there. A click on a block's side or underside puts it just in front
  and drops it to the floor below, as game Edit does. A list that holds one entry (the spectator
  and queue spawns) is replaced, and Place turns off; the others stay on for the next one. **Esc**
  or **Stop** in the tool panel turns it off.
- **Center on block** (in the tool panel on the right, on at first and remembered) puts an entry at
  its block's middle; off, it goes exactly where you click, as game Edit's Spawn tool does when it's
  off.
- **Drag a marker** to move it along the floor. It keeps its facing; one without a facing still
  looks at the map's middle.
- **The facing knob:** the picked marker has a red knob on the floor in front of it. Drag it around
  the marker to set its facing, in 15 degree steps (hold Shift for any whole degree). **Clear
  facing** in the tool panel takes it away (the marker faces the map's middle again).
- **Delete** (the key, or the button) removes the picked entry.
- **Undo** and **Redo** (Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z) step through the map's changes.

Every change is written to `map.json` at once, in the same style game Edit writes it. The map is
checked as you go: the checklist on the left updates with each change.

**With game Edit open on the same map** (the top bar says **Open in game Edit**), the viewer's
changes go through the map editor: markers move in game at once, and undo and redo are game Edit's,
shared with the players there. An editor started before this viewer existed can't take them: the
viewer says to restart it.

## Boxes: bounds, spectator bounds and regions

- **Add** beside a box list (Bounds, Spectator bounds, Kill region, each of the game's regions, a
  team's, and any the map has of its own), then click one corner block and the opposite one: the
  box takes both blocks in. The second corner can be on another layer: move the height cut between
  the clicks. A see-through box shows what you'd get, with its size. A second bounds box makes the
  bounds a list (a player inside any box is in), as game Edit's Add to bounds does.
- **New region** (under Boundaries) asks for a name (letters, digits and _, starting with a letter)
  and then draws its first box, like game Edit's New region.
- **Pick a box** in the side panel: its faces get handles. **Drag a handle** to move that face in
  whole blocks (never past the other side); the size shows as you drag. **Click a handle** to pick
  its face (it turns blue), then the **arrow keys** move it out (Up, Right) or in (Down, Left), five
  at a time with Shift; **In** and **Out** in the tool panel do the same.
- **To height cut**, **To X cut** and **To Z cut** move a face onto that cut: the picked face when
  it's on the cut's axis, else the face nearer the cut. The cut's layer becomes the box's last (or
  first) layer.
- A region the game gives a minimum size (Build Swap's build boundaries, 24 each way) shows red
  while it's smaller, and isn't saved, as in game.
- **Delete** removes the picked box.

## Kill Y and the build limit

- **Set** beside Kill Y, Build limit above or Build limit below, then click a block: kill Y goes
  just under that block (players who fall off it are out), and a build limit to its top (where a
  player standing on it builds from), as game Edit's Kill Y tool starts them.
- **Pick one** in the side panel: its sheet gets a handle. Drag the handle up or down, or use the
  Up and Down arrow keys (Shift: five) or the tool panel's buttons. **To height cut** puts it where
  a click on the cut's layer would.
- Kill Y runs from -64 to 319, a build limit from -64 to 320, and the build limit above stays over
  the one below, as in game: a height that breaks these isn't saved, and the viewer says why.
- **Delete** removes it.

## Save and Publish

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
are shaded (tops brightest), and three toggles in the top bar change the rest:

- **Corner darkening:** corners where blocks meet are darker.
- **Brightness variation:** each block a little brighter or darker, so big floors don't look flat.
- **Darken below the cut:** the deeper below the height cut, the darker, so the cut layer stands out.

The viewer remembers them, and Faded or Gone, in this browser.

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

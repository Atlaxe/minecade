# Map viewer

A 3D view of any map in the map store, in the Panel. It reads the map's world straight from its
files, so it needs no server and works while the network or the map editor runs. For now it only
looks: placing spawns, points, boundaries and regions with the mouse comes in later passes
(`docs/plans/map-viewer.md`). The in-game editor (`docs/editor.md`) keeps every tool it has.

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

Left click is kept for the tools (and Cut here). The arrow beside the views points north.

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

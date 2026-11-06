# Map viewer in the Panel (plan)

**Status:** proposed 2026-11-05, not started. Build it in the order of "Passes" below: each pass
leans on the ones before it.

**For the session that implements this:**
- Work in a worktree of your own (`CLAUDE.md`, "Branch and merge").
- Stop and report after each pass, and end the report with a list of what to test. Commit and push
  after each pass, committing only that pass's files, with no attribution.
- Org writing rules: no em dashes, no emojis, US spelling, in code, docs and commit messages.
- Change the map store only through `MapStore` (`tools/maps/store.ts`), never by hand.
- Nothing taken from the Minecraft client or from `packs/blocks` goes into git: no textures, and
  no colors worked out from them.

## Context

The map editor (`docs/editor.md`) does everything as a player: Select cuts a map out of a world,
Edit sets its data with tools in game, and Preview plays it. It needs its servers booted, and the
network stopped, before anything can be placed.

The map viewer is a second, quicker way to do the markup half of that job from the Panel: a 3D
view of a map's world where spawns, points, boundaries, regions and planes are placed with the
mouse. It only reads the world, so it needs no server, and it works while the network runs. It
can also cut new maps out of a world from a picture of it seen from above.

**This doesn't replace the map editor.** In-game Edit keeps every tool it has, so a person can
still do the whole job as a player. The viewer reads and writes the same `map.json` the editor
does, and the two can be used on the same map one after the other.

## Your decisions

| Topic | Decision |
|---|---|
| Purpose | A faster way to do more things, beside the in-game editor, which keeps all its tools |
| What it changes | Map data only (`map.json`). It never changes a world's blocks |
| Size | Maps up to 256x256 blocks across, at most the world's full height (384 blocks, y -64 to 319) |
| Camera | Rotate, pan and zoom around the map, with snap views. No flying |
| Slicing | Cut through the model by height, and along x and z, one layer at a time |
| Past the cut | A toggle: **Faded** (see-through) or **Gone** |
| Look | A toggle: **Average colors** (each block face one color, the average of its texture's most common color, not of the whole texture, which turns many blocks brown) or **Vanilla textures** |
| Select | Pick the area from a picture of the world seen from above. Its height is trimmed to the lowest and highest block inside it, then a floor and a ceiling can be dragged by hand (for ground under the build) |
| Center on block | On when the viewer first opens (a click lands anywhere on a face); the viewer remembers the last choice |
| Game markers | Drawn the way game Edit draws them from the start: the game's own model (`markers/<model>.geo.json`) when its list names one |
| With game Edit open | The viewer edits the map game Edit has open through the editor (`POST /edit`) from the first editing pass, never read-only |
| Changing blocks | **Open in game**: opens the map in the in-game editor's Edit |
| Cameras and mannequins | Skipped for now: not drawn, and kept unchanged in `map.json` |

## What it is not

- Not a replacement for the in-game editor (see above).
- Not a block editor. Blocks change in game (Open in game) or in Java, as today.
- Not a flying camera.

## How it fits

```
Panel server (tools/control-panel/panel.ts, Node)
  world reader    a map's world\db in the store   ->  a view file, cached in work\viewer\
  looks           the client's textures, packs\blocks  ->  colors and textures, cached in work\viewer\
  map routes      edits to map.json (map-edit.ts), Save and Publish (MapStore)
  editor link     the editor's control port (127.0.0.1:8097): what Edit has open, Open in game
Viewer page (the Panel's Edge window)
  three.js scene, mesh workers, picking, tools, lists and checklist
```

## Reading a world

The viewer reads a map's `world\db\` in the store's working folder
(`working\<target>\<map>\world\`), and for Select a source world. It never writes either.

- **LevelDB.** A world is the write-ahead logs (`*.log`) and the sorted tables (`*.ldb`). Table
  blocks are compressed with zlib or raw deflate. `tools/editor/world-log.ts` already reads the
  logs' records and write batches, and `tools/maps/blocks.ts` already reads every value in a table.
  The viewer needs keys too, and only the newest value of each key: every entry carries a sequence
  number (in a table, the 8 bytes after the key; in a log, the batch's first number plus the put's
  place in it), so the highest one wins, and a delete removes the key. That works whether or not a
  world was compacted.
- **Chunk keys:** chunk x and z (32-bit little-endian), a dimension number for the Nether and the
  End only, a tag byte, and for a sub-chunk its y index (a signed byte).
- **Sub-chunks** (tag 47) hold 16x16x16 blocks: a version byte (8 or 9), the number of storage
  layers, and in version 9 the y index; then each layer: a byte whose upper bits are the bits per
  block, packed 32-bit words of palette indices (y changes fastest, then z, then x), and the
  palette, each entry a little-endian NBT compound (`name`, `states`, `version`) that
  `prismarine-nbt` (already a dependency) reads. Layer 0 is the blocks; layer 1 is mostly the water
  in waterlogged blocks. The spike confirms the details against the format's write-up.
- **Height maps** (tag 43, `Data3D`): 256 16-bit heights, then biomes. Select's picture uses them.
- **Older formats** (sub-chunk versions under 8) aren't expected from BDS 1.26 or Chunker. The
  reader refuses them with a clear message.
- **The view file** sent to the page: the box the blocks fill (refused if wider than 256 on x or
  z), a palette of looks (a block's name plus only the states that change how it's drawn), and
  each 16x16x16 section as 16-bit indices into that palette (or one index when the section is all
  one block), gzipped.
- **Cache:** `work\viewer\maps\<target>\<map>\<stamp>.bin`, where the stamp is a hash of the
  `db\` files' names, sizes and times. A map opens at once the second time, and a changed world
  makes a new one (the old one is removed).

## How blocks look

The Look toggle switches between Average colors and Vanilla textures at any time. Both use the
same faces, shapes, shading and tints. Only what fills a face changes.

**Where the looks come from:**
- Vanilla blocks: `blocks.json` and `textures\terrain_texture.json` in the installed client's
  vanilla pack, and the textures themselves, packed in that pack's
  `__brarchive\textures\blocks.brarchive` (assumed to be the archive format `ui.brarchive` uses;
  the spike checks). BDS has no block textures.
- Custom blocks: `packs\blocks\` (the whole pack, never the network's cut), each block's
  `minecraft:material_instances` in its behavior pack file, then its resource pack's
  `terrain_texture.json`.
- `blocks.json` says which texture each face uses (up, down, side, or each side on its own), and
  some states turn faces (a log's `pillar_axis` puts its top texture on its sides).
- Built on this PC when first needed, kept in `work\viewer\looks\` (git-ignored), and built again
  when the client's vanilla pack version or `packs\blocks` changes.

**Average colors:** for each face's texture:
1. Use the first frame of an animated texture (the top square of the strip).
2. Leave out pixels under half opaque.
3. Put each pixel in a bucket by the top 4 bits of red, green and blue.
4. Take the bucket with the most pixels (on a tie, the brighter one).
5. The face's color is the average of the pixels in that bucket. A see-through block (glass) keeps
   how opaque its texture is.

A small overrides file (in `work\viewer\looks\`) sets the color of any block the method gets wrong,
for example ores, which come out the color of stone.

**Vanilla textures:** the textures themselves, 16x16 each, with nearest filtering so they stay
crisp. Merged faces repeat the texture once per block. Leaves, plants and glass edges are cut out
by their alpha, glass is blended, and animated textures show their first frame. The Panel serves
them to its own page only.

**Tints:** grass tops, leaves, vines, ferns, tall grass, lily pads and water are gray in their
textures, and the client tints them by biome in code. The viewer uses one fixed tint for each:
plains, taken from the client's colormaps (`colormap.brarchive`), and a fixed water blue. A small
table names the tinted blocks and textures.

**Shading** (both looks): tops full, north and south faces 80%, east and west 60%, bottoms 50%
(tuned in the pass), plus corner darkening where blocks meet (ambient occlusion, a toggle, on by
default). In Average colors, each block's brightness also changes by up to 3%, from a hash of its
position, so big floors don't look like plastic (a toggle).

**Shapes.** Not every block is drawn as a cube. Spawns stand on top faces, so a slab drawn full
height would put a spawn half a block high.

| Shape | Blocks | Drawn as |
|---|---|---|
| Cube | Everything not below | A full block |
| Slab | Names ending `_slab`, except `_double_slab` (a cube) | The bottom or top half (`minecraft:vertical_half`; wooden slabs also `top_slot_bit`) |
| Stairs | Names ending `_stairs` | A half slab (`upside_down_bit` for the top) plus the back quarter (`weirdo_direction`). Corners (`minecraft:corner`) can wait: drawn straight at first |
| Thin layer | Carpets, pressure plates, snow layers | 1/16 high; snow by its `height` |
| Post | Fences, walls, panes, iron bars, chains | A center post. Arms from the stored connection states (`connection_north`, `wall_connection_type_north` and so on) can wait |
| Door, gate, trapdoor | `*_door`, `fence_gate`, `*_trapdoor` | A thin slab, placed by the rules Paintball worked out (`docs/spike-results.md`, "Painted shapes"; `games/paintball/behavior_pack/scripts/paint.ts`) |
| Plant | Flowers, grass, ferns, saplings, crops, sugar cane, torches, buttons, rails | A small X of two crossed faces |
| Liquid | Water, lava | Top at 14/16 unless the same liquid is above. Water is see-through. Waterlogged blocks (layer 1) get water around them |
| Custom | `minecade:*` blocks | Their behavior pack's `minecraft:collision_box` (x mirrored, as that spike found), else the selection box, else a cube. `collision_box: false` is a plant |

Clicks hit cubes, slabs, stairs, thin layers, posts, doors, gates, trapdoors and custom blocks with
a collision box. They pass through plants, liquids and hidden blocks, so a click on a flower lands
on the grass under it.

**Hidden blocks:** air, structure voids, light blocks, barriers and invisible bedrock aren't drawn.
A **Hidden blocks** toggle outlines barriers and invisible bedrock (they're walls in a game) and
light blocks.

**Unknown blocks** (no texture found) are drawn in a loud color and listed under "Blocks without a
look" in the viewer's info panel.

## The view

**Camera.** Right drag rotates around a point, Shift + right drag (or middle drag) pans, the wheel
zooms. Left click is for the tools. Buttons: Top, the four corners, the four sides, and Home
(frame the whole map). Top view is orthographic, which with a height cut makes a floor plan: the
quickest way to place spawns inside buildings. A double click centers the view on a block.

**Slicing.**
- **Height:** everything above the cut layer is past the cut. Page Up and Page Down (or `[` and
  `]`) move it one layer, Shift moves it five, and a slider beside the view covers only the layers
  the map uses. "Cut here" puts it at a clicked block.
- **X and Z:** the same, with a button to flip which side is kept. Useful for tall maps such as
  Sinkhole (163 blocks high).
- **Past the cut:** Faded (drawn see-through, about 15% opaque, never clicked) or Gone, a toggle
  the viewer remembers.
- **The cut layer** shows solid tops with a faint block grid. Darkening the layers below by depth
  (a toggle) makes the current floor stand out.

**Picking.** A ray walked through the block grid from the camera (not through the meshes): the
first block a click can hit that isn't past a cut, with its face and the exact point hit.
Markers and handles are picked before blocks.

## Markup tools

The same lists as in-game Edit's tools (the Spawn tool's Spawn, Spectator and Queue tiles and its
Team list, the Game marker tool's Marker list, the Region tool's lists, the Kill Y tool's three
lines), so the game's checklist reads the same in both.

| `map.json` | Drawn as |
|---|---|
| `spawns` | A standing figure with a facing line |
| `teamSpawns.<team>` | The same, in the team's color |
| `spectatorSpawn`, `queueSpawn` | The same, in their colors from game Edit |
| `points` (and `<name>.<team>`) | By the list's `marker` style, as in game Edit (`MarkerStyle`, `packages/minigame-core/src/config.ts`): a post with a square head (the default), a standing figure, or the game's own model (`markers/<model>.geo.json` and `.png` in the game's folder, bones named `tint` in the team's color), with its name |
| `bounds`, `spectatorBounds` | Box edges and faint faces, one per box in a list |
| `regions` (with `kill` and `<name>.<team>`) | The same, in game Edit's outline colors, a team's in its color |
| `killY`, `buildLimit.above`, `buildLimit.below` | A sheet across the map at that height |

Positions follow `docs/maps.md`: whole x and z are a block's middle, a fraction is an exact point,
y is the feet, and yaw 0 faces south.

**Points** (spawns of every kind, and game markers): pick the list, then click a top face. The
entry lands on the block above it, at the block's middle, or at the exact point clicked with
**Center on block** off (the same choice the in-game Spawn tool has). It starts on in the viewer,
unlike in game (where it starts off), since a click lands anywhere on a face; the viewer remembers
the last choice. A list that holds one entry
(the spectator and queue spawns) is replaced. No facing by default (it then faces the map's
middle); dragging out from a placed marker sets one in 15 degree steps (Shift for any angle), and
"Clear facing" removes it. Drag a marker to move it along its floor; Delete removes it.

**Boxes** (bounds, spectator bounds, regions, kill regions): pick the list, click one corner block,
then the opposite one (on any layer); the box takes both blocks in. Handles on all six faces drag
in whole blocks, and arrow keys nudge the picked face. The size shows while dragging and turns red
under a region's `minSize`, which can't be saved, as in game. "Set to cut" moves the face toward
the cut onto it. "Add to bounds" adds another box to the list.

**Planes** (Kill Y, Limit above, Limit below): a sheet with a handle: drag it, nudge it, or "Set
to cut". The limits stay within -64 to 320, above over below.

**Lists and checklist:** a side panel with the game's checklist on top (what the map still needs),
then every list and its entries, as in game Edit's menus. Clicking an entry picks it and frames it
in the view.

**Undo and redo:** Ctrl+Z and Ctrl+Y. Each change is a `MapEdit` (`map-edit.ts`), which returns a
new config and keeps the old one, so undo is keeping the configs.

**Speed tools** (a pass of their own):
- **Mirror:** mirror the picked entries across the map's middle (x 0 or z 0 after Select's
  centering): left to right, front to back, or turned half around. Facings and boxes mirror too,
  and a team list's entries go to another team (Red to Blue).
- **Copy** picked entries to another team's list.
- **Pick several:** Shift + click, or drag a rectangle in Top view.

**Not in the viewer for now:** cameras, mannequins and kits (kept as they are). The other map
settings (name, time, queue mode and countdown, game settings, the lobby's stars) come in the last
pass.

## Checks

- After every change: the game's checklist (`mapChecklist`) and the build's rules
  (`validateMapConfig`), the same code game Edit and the build use, so a map that passes in the
  viewer passes everywhere.
- Checks a 3D view makes easy, shown as warnings (Save still works):
  - a spawn or point whose feet or head block is solid;
  - a spawn with nothing to stand on within a few blocks below it;
  - Build Swap plots that overlap, or whose block-thick shell reaches another plot, and a spawn in
    no plot;
  - leftover editor blocks or entities in the world (`minecade:plane` blocks, the editor's marker
    entities), as a bad save once left in Temples and others;
  - blocks without a look.

## Saving, publishing and the in-game editor

- The viewer opens maps from the store's working folders through `MapStore`: the same maps the
  in-game editor opens.
- The page applies a change at once and sends the same `MapEdit` to the Panel server, which applies
  it (`applyEdit`), checks it, writes `working\<target>\<map>\map.json` (`formatMapConfig`), and
  sends back the result. That's the pattern the in-game editor's pack and host already use.
- Fields the viewer doesn't edit stay exactly as they were: an edit changes only what it names.
- **Save** keeps a version in `maps.db`, as the editor does when it saves. **Publish** does what the
  in-game Publish does, and is refused until the checklist is done. Publishing while the network
  runs is safe: each published version gets its own folder. A change to the world or `map.json`
  reaches the next game; a new map, a new id or name, or a picture still needs the Panel's Start
  (a rebuild) before the lobby shows it (`docs/maps.md`, "The map store"). Publish's message says
  which, as the in-game one does.
- **With the in-game editor running:** the editor's `GET /status` says which map Edit has open.
  The viewer's edits to that map go through the editor (a new `POST /edit` on its control port,
  taking a `MapEdit`, from pass V.5), so markers move in game at once and there's only one writer;
  an edit made in game shows in the viewer when `map.json` changes. (The editor already reloads
  `map.json` when it changes on disk, `session.ts` `reloadMap`, but two writers could lose a change
  made in both within its half-second check.)
- **Open in game** is the viewer's way to change blocks: it opens the map in the in-game editor's
  Edit (`POST /open`), booting the editor first if it isn't running, which stops the network after
  the usual question. When the editor saves the world (a new version), the viewer reloads the
  blocks.

## Select from above

In-game Select stays as it is. This is the Panel's way to cut a map out of a world.

- **Worlds:** the same ones in-game Select opens (`tools/editor/worlds.ts`: the client's worlds by
  name, any world folder, or a `.mcworld`).
- **The picture:** one pixel per block column, the top block's average color shaded by its height
  so builds stand out, from each chunk's height map, decoding only the top block of each column.
  Pan and zoom. Maps already cut from the world (`work\select\<world>.json`) show as named
  outlines.
- **The box:** drag a rectangle, up to 256x256 (it stops growing there, and its size shows), with
  handles on its sides.
- **Height:** automatic, then by hand. The box is trimmed to the lowest and highest block inside it
  (air doesn't count), and a picture from the side shows the result, with a floor and a ceiling
  handle to drag. Ground under the build (terrain, or a superflat floor) is in the trim at first:
  drag the floor up past it.
- **A 3D look** at the box in the normal viewer (read-only) before exporting.
- **Export:** the same choices as in-game Export to Map, then the same
  extractor in-game Select uses (`tools/editor/extract.ts`: Chunker prunes the world, a throwaway
  BDS with no ports moves the box to the middle, Chunker prunes again), in the background. Without
  a player or ports the network can keep running (check that in the pass: today the editor's runner
  starts the extractor). The new draft map then opens in the viewer.

## Panel page

- A **Maps** page in the Panel's menu: every map by target (from the store) with its checklist
  state, each opening in the viewer, and a **Worlds** tab for Select from above.
- **The viewer:** the 3D view in the middle, the lists and checklist on one side, the picked tool
  and its settings on the other, and a top bar with Look (Average colors or Vanilla textures),
  Past the cut (Faded or Gone), Hidden blocks, the view buttons, Save, Publish and Open in game.

## Tech

- **three.js** (a new dependency, `three`, at an exact version), served to the page from
  `node_modules` by `panel.ts`. The Panel works offline, so no CDN.
- **The viewer's code** is TypeScript in `tools/control-panel/viewer/`, bundled with esbuild
  (already a dependency) when the Panel starts, so the page uses minigame-core's map code as it is
  (`map-config.ts`, `map-edit.ts`, `map-checklist.ts`). The rest of the Panel stays hand-written.
- **Meshing in web workers:** one mesh per 16x16x16 section; hidden faces left out; touching faces
  with the same look merged into rectangles; vertex colors (Average colors) or texture array layers
  (Vanilla textures). A cut rebuilds only the sections it passes through.
- **Memory:** the worst case is 25.2 million blocks, 50 MB as 16-bit indices. Today's maps are far
  smaller: by their bounds in early November 2026, the biggest were Strife (127x79x184) and
  Sinkhole (64x163x64, the tallest).
- **WebGL2**, in Edge (the Panel's window).
- **Routes** go through `checkRequest` like every other Panel route.

## Passes (the implementation order: stop and report after each, commit and push)

**V.1 Spike.** Results go in `docs/spike-results.md` under "Map viewer".
1. Decode Temples and Sinkhole in plain TypeScript. Check the decoded top block of some columns
   against a throwaway BDS (`getTopmostBlock`), and time it.
2. Unpack `blocks.brarchive`, work out the average colors, and lay them out as a swatch page next
   to whole-texture averages for about 20 blocks.
3. Draw the worst case (256x256, 384 high, mixed blocks) and a realistic 256x256 map in the Panel's
   Edge window: frame rate, memory, meshing time per section.
4. Time one layer step of the height cut (aim: under 50 ms, so dragging the slider feels live).
5. Read only the height maps of a whole source world (the converted Datapacking world), and time
   it.

**V.2 World reader.** Keys and newest values from logs and tables, sub-chunks and palettes, the
blocks' box, the view file and its cache, with tests on small fixture worlds. Panel routes for the
map list and a map's view file.

**V.3 Read-only viewer.** The looks cache with Average colors, everything drawn as cubes, shading
and corner darkening, the camera and its views, height, X and Z cuts with Faded and Gone, the Maps
page.

**V.4 Markers shown.** Every list in the table above drawn, read-only, game markers in their
list's style (the game's own models too); the side panel with the checklist; clicking an entry
frames it; refresh when `map.json` changes.

**V.5 Points, Save and Publish.** Placing, moving, facing and deleting every kind of spawn and game
marker; undo and redo; Save and Publish; `POST /edit` on the editor's control port, so the map
game Edit has open is edited through the editor.

**V.6 Boxes and planes.** Bounds (one box or several), spectator bounds, regions (the game's, the
map's own, per team, kill), `minSize`; Kill Y and the build limits; handles, nudges, Set to cut.

**V.7 Shapes and see-through blocks.** The shape table, custom blocks' collision boxes, liquids,
glass, clicks passing through plants, Hidden blocks, unknown blocks, and the checks from "Checks".

**V.8 Vanilla textures.** The Look toggle and the texture array.

**V.9 Speed tools.** Mirror, copy to another team, pick several.

**V.10 Select from above.** The Worlds tab: the picture, the box, the automatic height with its
floor and ceiling handles, the 3D look, and Export through the extractor.

**V.11 With the in-game editor.** Open in game, and reloading after the editor saves a world.

**V.12 Map settings.** Forms for the name, time, queue mode and countdown, game settings and the
lobby's stars (`map-edit.ts` has no op for `stars` yet: this pass adds one).

## Files

**New**
- `tools/viewer/`: the Panel server's side: `world-reader.ts` (keys and newest values),
  `subchunk.ts`, `view-file.ts`, `looks.ts` (colors, textures, tints, the shape table),
  `brarchive.ts`, `overview.ts` (Select's picture and the automatic height), and `test/`.
- `tools/control-panel/viewer/`: the page and its scripts (scene, camera, slicing, picking, mesh
  worker, tools, lists).
- `docs/viewer.md`: how to use it.

**Changed**
- `tools/control-panel/panel.ts` (routes, the bundle at start) and `index.html` (the Maps page).
- `tools/maps/blocks.ts`: its table reader shared with the world reader.
- `tools/editor/control.ts`, the runner and `session.ts`: `POST /edit` (pass V.5).
- `packages/minigame-core/src/map-edit.ts`: a `stars` op (pass V.12).
- `package.json`: `three`.
- `docs/editor.md`: a line pointing to the viewer.

## Reuse

- `packages/minigame-core/src/`: `map-edit.ts` (`applyEdit`, `listOf`, `describeEdit`),
  `map-config.ts` (`worldPoint`, `boundsBoxes`, `spectatorBoundsBoxes`), `map-checklist.ts`,
  `map-validate.ts`, `map-format.ts`, `map-requirements.ts`.
- `tools/maps/store.ts` (`MapStore`) for the maps, Save and Publish.
- `tools/maps/blocks.ts` (tables) and `tools/editor/world-log.ts` (logs).
- `tools/editor/worlds.ts`, `extract.ts` and `chunker.ts` for Select from above;
  `tools/editor/targets.ts` for each target's maps and rules.
- `tools/editor/control.ts` for Open in game and the editor's status.
- `tools/editor/marker-models.ts` and each game's `markers/` for the game markers' models.
- `tools/editor/png.ts` (`decodePng`) for textures; `prismarine-nbt` for palettes.
- `games/paintball/behavior_pack/scripts/paint.ts` and `docs/spike-results.md` ("Vanilla block
  shapes for painting", "Painted shapes") for block states and door, gate and trapdoor boxes.

## Risks the spike settles

- The sub-chunk and palette details, and newest-wins across logs and tables.
- The texture archive's format, and whether the average color method looks right.
- Frame rate and memory at 256x256x384 in Edge.
- How quickly a cut rebuilds.
- How long a big source world's picture takes.
- **Hosting later:** textures and colors come from the client installed on the same PC, and
  nothing from them ships. A hosted Panel without a client install would need the colors made on
  the customer's PC, or a hand-picked palette.

## Verification

- Unit tests: the reader on fixture worlds (known blocks at known spots, logs over tables, deletes),
  the color method on hand-made PNGs, the shape table, edits round-tripping through `map.json`.
- `npm run check` passes, and the build accepts a map saved and published from the viewer.
- By eye: every published map opened in the viewer next to the same map in game Edit, markers in
  the same places.

## Open questions

None right now. The three from the first draft are answered in "Your decisions" (Select's floor,
Center on block, game marker models).

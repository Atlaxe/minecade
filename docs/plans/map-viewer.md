# Map viewer in the Panel (plan)

**Status:** proposed 2026-11-05. V.1 (the spike) done 2026-11-05: its findings are in
`docs/spike-results.md`, "Map viewer", and this plan is updated for them; its code in
`spike/viewer/` (the looks, the mesher) is where V.3 started. V.2 (the world reader) and V.3 (the
read-only viewer, `docs/viewer.md`) done 2026-11-05, in `tools/viewer/` and
`tools/control-panel/viewer/`. V.4 (markers shown), V.5 (points, Save and Publish) and V.6 (boxes
and planes) done 2026-11-06. Before V.7, the same day, the user reworked the viewer's layout (see
"Layout rework" below). V.7 (shapes and see-through blocks), V.8 (Vanilla textures) and V.9 (speed
tools) done 2026-11-06. After V.9 the user made Mirror a tool of its own and asked for a Keys tab in
the settings (see "After V.9" below). V.10 (Select from above) done 2026-11-06. V.11 (with the in-game editor) done 2026-11-06, with the
warm-up the user asked for. V.12 (map settings) done 2026-11-06: every pass is built. After it the
user moved the map settings out of their dialog and asked for Port to another game (see "After
V.12" below). Build it in the order of "Passes" below: each pass leans on the ones before it.

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
| Camera | Rotate, pan and zoom around the map, with a view cube for the snap views. WASD flying as a setting (2026-11-06), off at first |
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
- Not a flying camera by default: WASD flying is a setting.

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
  world was compacted. The MANIFEST says which tables are live; others are skipped
  (`spike/viewer/leveldb.ts`).
- **Chunk keys:** chunk x and z (32-bit little-endian), a dimension number for the Nether and the
  End only, a tag byte, and for a sub-chunk its y index (a signed byte).
- **Sub-chunks** (tag 47) hold 16x16x16 blocks: a version byte (8 or 9), the number of storage
  layers, and in version 9 the y index; then each layer: a byte whose upper bits are the bits per
  block, packed 32-bit words of palette indices (y changes fastest, then z, then x), and the
  palette, each entry a little-endian NBT compound (`name`, `states`, `version`) that
  `prismarine-nbt` (already a dependency) reads, once per distinct entry (cached by its raw
  bytes). Layer 0 is the blocks; layer 1 is mostly the water in waterlogged blocks. The spike
  matched a server block for block (`spike/viewer/subchunk.ts`).
- **Empty sub-chunks:** Chunker stores every empty one (1 bit a block, a palette of air). A
  sub-chunk whose palette is all air is skipped without unpacking it.
- **Height maps** (tag 43, `Data3D`): 256 16-bit heights, then biomes. Not used: converted worlds'
  are almost all missing (the spike), so Select's picture finds each column's top itself.
- **Older formats** (sub-chunk versions under 8) aren't expected from BDS 1.26 or Chunker. The
  reader refuses them with a clear message.
- **The view file** sent to the page (`tools/viewer/view-format.ts` has the layout and a decoder
  the page uses as it is): the box the blocks fill (refused if wider than 256 on x or z), a
  palette of looks (a block's name plus only the states that change how it's drawn; a custom
  block keeps all its states), and each 16x16x16 section as 16-bit indices into that palette (or
  one index when the section is all one block), with layer 1 where it has any, gzipped. Only
  looks some block uses: a sub-chunk's palette keeps entries whose blocks are gone (Temples'
  palettes still list 259 states of the editor's plane blocks, though none is left).
- **Cache:** `work\viewer\maps\<target>\<map>\<stamp>.bin.gz`, where the stamp is a hash of the
  `db\` files' names, sizes and times, and the view format. A map opens at once the second time
  (3 ms against 129 ms for Temples), and a changed world makes a new one (the old one is removed).

## How blocks look

The Look toggle switches between Average colors and Vanilla textures at any time. Both use the
same faces, shapes, shading and tints. Only what fills a face changes.

**Where the looks come from:**
- Vanilla blocks: the installed client's vanilla resource packs, layered in version order
  (`vanilla`, then `vanilla_1.14` up to the newest, 57 today): each one's `blocks.json` merged
  entry by entry and field by field, its `textures\terrain_texture.json` entry by entry, and its
  block textures from `__brarchive\textures\blocks.brarchive` (the format `ui.brarchive` uses) and
  `__brarchive\textures\blocks\<folder>.brarchive` (`deepslate`, `candles`, `huge_fungus`). Both
  JSON files have `//` comments. A few blocks keep an older name in `blocks.json` (`grass_block`
  is `grass`, `sea_lantern` is `seaLantern`, `iron_chain` is `chain`): a small table renames them.
  BDS has no block textures.
- Custom blocks: `packs\blocks\` (the whole pack, never the network's cut), each block's
  `minecraft:material_instances` in its behavior pack file, then its resource pack's
  `terrain_texture.json`.
- `blocks.json` says which texture each face uses (up, down, side, or each side on its own), and
  some states turn faces (a log's `pillar_axis` puts its top texture on its sides).
- Textures are PNG (also interlaced, palette and 2-bit ones) and TGA (also run-length coded), more
  than `tools/editor/png.ts` reads, so the viewer has its own decoder (`spike/viewer/image.ts`).
- Built on this PC when first needed (about 4 s), kept in `work\viewer\looks\` (git-ignored), and
  built again when the vanilla packs' files or `packs\blocks` change (by their sizes and times: the
  vanilla manifests' version is always 0.0.1).

**Average colors:** for each face's texture:
1. Use the first frame of an animated texture (the top square of the strip).
2. Leave out pixels under half opaque.
3. Put each pixel in a bucket by the top 4 bits of red, green and blue.
4. Take the bucket with the most pixels (on a tie, the brighter one).
5. The face's color is the average of the pixels in that bucket. A see-through block (glass) keeps
   how opaque its texture is.

Three rules (V.3, `tools/viewer/looks.ts`) fix what the method gets wrong, without a color in git:
ores (`*_ore`) mix their stone half and half with their specks (the most common colored color well
away from the stone); glowstone takes its whole texture's average (its most common color is its
dark gaps); and a texture `terrain_texture.json` gives an `overlay_color` (a grass block's side)
has its alpha ignored and no tint, since its alpha marks where the tint goes, not what's
see-through. A small overrides file (`work\viewer\looks\overrides.json`) sets any block's color by
hand, every face one `#rrggbb` (or `#rrggbbaa`).

**Vanilla textures:** the textures themselves, 16x16 each, with nearest filtering so they stay
crisp. Merged faces repeat the texture once per block. Leaves, plants and glass edges are cut out
by their alpha, glass is blended, and animated textures show their first frame. The Panel serves
them to its own page only.

**Tints:** grass tops, leaves, vines, ferns, tall grass, lily pads and water are gray in their
textures, and the client tints them by biome in code. The viewer uses one fixed tint for each:
plains, taken from the client's colormaps (`colormap.brarchive`: `grass.png` and `foliage.png`, and
`evergreen.png` and `birch.png` for spruce and birch leaves), and a fixed water blue. A small table
names the tinted textures.

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
- **How a cut is drawn** (the spike): a clipping plane, plus a cap mesh of the cut layer's tops that
  the layer above hid. Nothing is re-meshed, so a layer step takes 3 to 9 ms to a finished frame
  even at 256x384x256 (re-meshing the cut's sections took up to 90 ms). Faded draws the same meshes
  again, see-through, with the opposite plane, at no frame rate cost.

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
    entities), as a bad save once left in Temples and others (counted from blocks, never from
    palettes, which keep the planes' entries after the blocks go: no map has any left today);
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
  so builds stand out. Each column's top is found from the top down (each chunk's sub-chunks from
  the highest, empty ones skipped), since converted worlds' height maps are missing: about 1 s for
  a whole converted world (`spike/viewer/overview.ts`). Pan and zoom. Maps already cut from the world (`work\select\<world>.json`) show as named
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
  It opens in a window of its own, one per map (`/viewer?target=&map=`), which keeps an event
  stream open so the Panel counts it as one of its windows (`/api/events?target=&map=`, which
  also carries the map's `map.json` changes: one stream per window, as Edge allows six connections
  to the Panel). V.3 has the top bar's views, Past the cut and its toggles, and the cuts in a panel
  on the right; V.4 the checklist and lists in a panel on the left.

## Tech

- **three.js** (`three` 0.186.1 and `@types/three` 0.186.0, devDependencies at exact versions like
  the rest), bundled into the page, so it works offline: no CDN.
- **The viewer's code** is TypeScript in `tools/control-panel/viewer/`, bundled with esbuild
  (already a dependency) on its first use and again whenever one of its files changes (no Panel
  restart for page changes), so the page uses shared code as it is (`tools/viewer/view-format.ts`
  now; minigame-core's `map-config.ts`, `map-edit.ts`, `map-checklist.ts` from V.4). It has its own
  typecheck, `tsconfig.viewer.json` (the browser's types), which `npm run typecheck` runs. The rest
  of the Panel stays hand-written.
- **Drawing on demand:** a frame is drawn only when something changes (the camera, a cut, a
  toggle), so an open viewer costs nothing while nobody touches it.
- **Meshing in web workers:** each 16x16x16 section meshed on its own (hidden faces left out,
  touching faces with the same look merged into rectangles; vertex colors for Average colors,
  texture array layers for Vanilla textures), then sections grouped into region meshes of 4x4x4
  sections (64 blocks a side, positions as bytes). One mesh per section costs a draw call each:
  15 ms a frame at 6,000 sections, against 0.2 ms for the 96 regions (the spike). A cut re-meshes
  nothing (see "Slicing").
- **Memory** (the spike, at 256x384x256 of caves with nothing merging): 48 MB of blocks, 149 MB of
  geometry, 6 million triangles, Edge at 2.0 GB; real maps at 256x256 stay near 500 MB. Keep only
  the region meshes, not the sections' (most of that case's 500 MB of JavaScript heap). Today's
  maps are far smaller: by their bounds in early November 2026, the biggest were Strife
  (127x79x184) and Sinkhole (64x163x64, the tallest).
- **WebGL2**, in Edge (the Panel's window). Edge stops drawing a covered or minimized window, so
  nothing in the viewer may wait on a frame.
- **Routes** go through `checkRequest` like every other Panel route (`tools/viewer/routes.ts`):
  `GET /api/viewer/maps` (the editor's catalog, `tools/editor/catalog.ts`: every map by target
  with its checklist state, and the client's worlds for Select) and
  `GET /api/viewer/view?target=<id>&map=<id>` (the view file, sent gzipped with
  `content-encoding: gzip`, so the page gets it unzipped).

## Layout rework (2026-11-06, before V.7)

The user's changes to V.3 to V.6's layout, built the same day (`docs/viewer.md` has how it works):
- **Opening:** the Maps page has a search box, a game and a status dropdown, and map cards with
  their thumbnails; a card is picked first, and a bar at the bottom opens it ("Edit (map) for
  (game)") in the same window, with a back arrow in the viewer.
- **Top bar:** back arrow, thumbnail, title; Undo, Redo, View settings, Save and Publish on the
  right. The look's toggles and Past the cut moved into the View settings dialog.
- **View cube** (`viewcube.ts`) in the view's top right, with Home beside it, in place of the
  compass buttons.
- **Tools** as game Edit has them (`app.ts`): Select (V), Spawn (P), Marker (M), Region (B), Height
  (H) and Cut (C), icons above the checklist in place of the lists' Place, Add and Set buttons. The
  lists are the "overview".
- **Right panel:** the tool's settings or the picked entry's values to type (a point's X, Y, Z,
  yaw and pitch; a box's corners; a height's Y); the cuts (X, Y and Z sliders in red, green and
  blue, Y now horizontal) only with nothing picked or with the Cut tool.
- **Gizmos** (`gizmo.ts`), as Blockbench and Axiom have them: Move (arrows out of a cube along each
  axis, drag or click) for points, boxes and heights, and Resize (a square per face, opposite faces
  joined by a line) for boxes; G and E switch a box between them.
- **WASD flying** (`fly.ts`), a setting, and blocks within a block of the camera aren't drawn or
  clicked (`CLIP_NEAR`), so a camera inside a wall works on what's beyond it.
- **Keys:** undo and redo listen in the capture phase on the window, so a focused button or the
  canvas never keeps them; every button with a key shows it in a tooltip after a second
  (`tips.js`).

## After V.9 (2026-11-06, the user's changes)

- **Mirror is a tool** (I, `app.ts` and `speed.ts`), no longer buttons under a picked entry. First
  the mirror plane is placed (it starts at the map's middle; a click on a block puts it there, at
  the nearer half block, and its arrows or typed X and Z move it), then what to mirror is picked
  (markers clicked, the overview, a section at a time, or a rectangle in Top view), with see-through
  copies where they'd go, and the tool's settings say how: Left to right, Front to back or Half
  turn; which team team entries go to; and **Copies** or **Move** (the entries themselves). Copy to
  another team stays with Select.
- **Keys** in the settings dialog (built the same day, `keys.ts` and `keys-tab.ts`): the dialog is
  now Settings, with a View tab (what it had) and a Keys tab listing every action by group with two
  keys each; a click on a key waits for the next press (a modifier let go alone is the key, Esc
  keeps it), a key another action had moves over (the footer says from where), and Default or All
  keys to their defaults put them back. Kept in this browser; tooltips, the cuts' line and flying's
  line follow. Flying takes its keys from the same map.

## After V.10 (2026-11-06, the user's changes)

The user asked for these with V.11 and V.12, each its own pass:
- **The left panel in tabs** (done 2026-11-06, `sidebar.ts`): Checklist (the checklist and the
  checks) and Overview, each with its own search. The overview shows only what the map has: no
  Spawns section until a spawn is placed, no build limit until one is set.
- **No Map editor page** in the Panel once V.11 is in (done 2026-11-06, with V.11's warm-up): the
  Maps page and the viewer drive the in-game editor. Its servers start in the background while the
  Maps page is open, a picked map starts loading in Edit (another pick cancels it), so by the time
  the viewer is up, joining the map in game is quick. The editor's log moves to the Logs page, and
  the editor page's Friends tab switch goes (the Servers page has the switch). As built: the
  Servers page has a Map editor section (state, join address, each server with what it has open,
  who is on it and its console's Logs, View for the map in Edit, End preview, the maps cut out in
  Select, Shut down, Restart and Boot up), the sidebar's footer says its state, and Save, Publish,
  Preview and the screenshots for the map in Edit are the viewer's. A booting editor removes editor
  servers left running by one whose process ended, which would otherwise hold the ports.
- **The Servers page reworked** (done 2026-11-06), the join addresses and the Friends tab broadcast
  especially: the network's section has its state and buttons, then Join, a row each for this
  PC's network, the internet (with how to test it) and console friends, whose row holds the
  Friends tab switch and its progress (sign-in code, live), then the lobby map; the Game and
  Containers sections follow (the map editor's containers are in its own section).

## After V.12 (2026-11-06, the user's changes)

The user asked for these together, to declutter the top bar:
- **Time is a tool** (T, a clock): its panel is the Time list game Edit's Time tool has (Not set,
  Noon, Dusk, Midnight, Dawn, Custom with the 24-hour clock and an hour earlier or later). A click
  in the view does nothing with it.
- **The tools in a grid of four columns** (two rows of four with Time).
- **No gear, no Map settings dialog.** The queue's Lock in or Free is only in the picked queue
  spawn's panel ("Players wait here"). The name and the countdown (with the game's settings, the
  lobby's star box and the other keys) are in the right panel as **Map settings**, with Select and
  nothing picked, above the cuts. The countdown shows once the queue spawn is placed, since the
  game counts it only there. `mapsettings.ts` has `MapSettings` (the panel, drawn again on every
  change unless one of its fields is being typed in), `TimeTool` and `queuePanel`.
- **Port to another game** (`tools/viewer/port-map.ts`, the dialog `port.ts`, served alone as
  `/viewer/port.js` for the Maps page): a map's blocks become a new map of another game, such as
  KGB from One in the Quiver for Gunfight (and Gun Game once it's built). Only the world goes: the
  new map.json is `{ name, draft: true, spawns: [] }`, with no spawns, markers, boundaries,
  settings, time, cameras, mannequins or `source`, and no picture. Its id is the old map's when
  the game can take it, else with -2 and so on; an id is taken when the game's own maps, its
  lenders' (map.borrow) or a borrower's list has it (the build refuses two maps of one id in one
  game's list), or a map is being cut out for it. Refused while game Edit has the map open with
  blocks not saved. The world is copied into a folder of its own, then moved into place, then
  map.json is written, and the map store keeps it as its first version ("Port from
  <target>/<map>"). GET and POST `/api/viewer/port`. Under Map settings in the viewer, and in the
  Maps page's bar for the picked map.
- **Port carries markup and the picture** (2026-11-07, the user's ask): the picture
  (`preview.png`) always goes now, and the dialog has a box for each kind of the old map's markup
  the picked game can use, all checked at first (unchecked ones are remembered in the browser):
  Spawns, Game markers, Boundaries, Time of day, Cameras, Mannequins, Game settings. `carryPlan`
  keeps each to what the game has: plain spawns only when it uses them, team spawns of its teams,
  spectator and queue spawns (with the queue's settings) for games only, points and regions by the
  names it asks for (kill regions always), the build limit's sides it asks for, its settings by key
  when the value fits, the star box for the lobby. What it can't take is listed ("Stays behind:
  11 spawns"). `source` and the map's kits never go. The POST takes `carry`, the kinds checked.
- **Delete** (2026-11-07, the user's ask): the Maps page's bar (red Delete) and the viewer's Map
  settings (red Delete map) delete a map after a confirm (`delete.ts`, served as `/viewer/delete.js`).
  POST `/api/viewer/delete` (`tools/viewer/delete-map.ts`): with the map editor running it asks the
  editor (control port `POST /delete`, the runner's `deleteFromPanel`, sharing `removeMap` with
  game Edit's Delete map, in Edit's queue so a warm-up of the map finishes, then closes); with none
  the Panel removes it from the store itself (`MapStore.remove`, export when it was published,
  Recent). Either way the Panel's own Select from above lists and its undo history for the map
  forget it. The live lobby (`LOBBY_MAP`) is refused. An editor older than this answers 404, and
  the Panel says to restart it.

## Passes (the implementation order: stop and report after each, commit and push)

**V.1 Spike** (done 2026-11-05: `docs/spike-results.md`, "Map viewer"; `spike/viewer/`).
1. Decode Temples and Sinkhole in plain TypeScript. Check the decoded top block of some columns
   against a throwaway BDS (`getTopmostBlock`), and time it.
2. Unpack `blocks.brarchive`, work out the average colors, and lay them out as a swatch page next
   to whole-texture averages for about 20 blocks.
3. Draw the worst case (256x256, 384 high, mixed blocks) and a realistic 256x256 map in the Panel's
   Edge window: frame rate, memory, meshing time per section.
4. Time one layer step of the height cut (aim: under 50 ms, so dragging the slider feels live).
5. Read only the height maps of a whole source world (the converted Datapacking world), and time
   it.

**V.2 World reader** (done 2026-11-05). Keys and newest values from logs and tables, sub-chunks and
palettes, the blocks' box, the view file and its cache, with tests on small fixture worlds
(`tools/viewer/test/fixture-world.ts` writes them as LevelDB and BDS do). Panel routes for the map
list and a map's view file. Every map in the store makes a view (at most 104 ms, 150 KB gzipped),
and V.1's spots checked against BDS read the same through the view file.

**V.3 Read-only viewer** (done 2026-11-05, `docs/viewer.md`). The looks cache with Average colors,
everything drawn as cubes, shading and corner darkening, the camera and its views, height, X and Z
cuts with Faded and Gone, the Maps page. Also: brightness variation and darkening below the cut as
shader uniforms (toggling them re-meshes nothing), the block under the pointer in a status line,
and Cut here for all three cuts. Temples meshes in about 150 ms (255k triangles: corner darkening
keeps some faces from merging).

**V.4 Markers shown** (done 2026-11-06). Every list in the table above drawn, read-only, game
markers in their list's style (the game's own models too); the side panel with the checklist;
clicking an entry frames it; refresh when `map.json` changes. The lists, labels and colors come
from game Edit's own pure code (`editor/behavior_pack/scripts/lists.ts` and `regions.ts`, which
gained `regionColors`), so both read the same; markers are built from game Edit's geometry file
and the games' `markers/` (`geo.ts`, `overlay.ts`), served with `map.json` and the rules by
`GET /api/viewer/map` (`tools/viewer/map-data.ts`).

**V.5 Points, Save and Publish** (done 2026-11-06). Placing, moving, facing and deleting every kind
of spawn and game marker; undo and redo; Save and Publish; `POST /edit` on the editor's control
port, so the map game Edit has open is edited through the editor. As built: Place on a list's
header arms it (a ghost follows the pointer), a marker drags along the floor, and the picked one
has a facing knob on the floor (15 degree steps, Shift for whole degrees). The page applies each
edit at once and sends it to the Panel in order (`changes.ts`); the Panel's `POST /api/viewer/edit`,
`/undo`, `/redo`, `/save` and `/publish` (`tools/viewer/map-changes.ts`) try the editor first
(`POST /edit`, `/undo`, `/redo` on its control port, refused with "not open" for another map) and
otherwise write `map.json` themselves, with an undo history per map in which a change made
elsewhere is one step. What the viewer may send is checked on both sides (`edit-check.ts`: only the
markup ops and `draft`). The store's `exportPublished` now counts catalog files it changed, so
Publish's message says whether the next Start must rebuild.

**V.6 Boxes and planes** (done 2026-11-06). Bounds (one box or several), spectator bounds, regions
(the game's, the map's own, per team, kill), `minSize`; Kill Y and the build limits; handles,
nudges, Set to cut. As built: Add on a box list takes two corner clicks (a preview with its size
follows the pointer, red under `minSize`); New region asks for a name first; the picked box has a
handle on each face (drag it, or click it and nudge with the arrow keys or In and Out), and To
height, X or Z cut moves the picked face (else the nearer one) onto that cut. Set on a height takes
a block click (kill Y under the block, a build limit on top of it, as game Edit's Kill Y tool
starts them); the picked height has a handle to drag, and nudges. The math is `boxes.ts`; the
rules game Edit's tools keep (a region's `minSize`, kill Y and build limit ranges, above over
below) are `edit-check.ts`'s `markupProblem`, which the page and the Panel both apply, so a bad box
or height is never written, whether or not game Edit has the map.

**V.7 Shapes and see-through blocks** (done 2026-11-06). The shape table, custom blocks' collision
boxes, liquids, glass, clicks passing through plants, Hidden blocks, unknown blocks, and the checks
from "Checks". As built: the shape table is the page's `shapes.ts` (boxes in sixteenths, with the
stairs' corners, walls' and fences' arms and doors, gates and trapdoors by Paintball's rules, and a
few short blocks such as chests and farmland), and custom blocks' boxes come from the Panel's `GET
/api/viewer/shapes` (`tools/viewer/custom-shapes.ts`): the blocks pack writes a box in the model's
unturned frame and `minecraft:transformation` turns it, so the viewer turns it the same way (quarter
turns about x, then y). A door's halves are joined into one look per half (facing and open from the
lower one, the hinge from the upper). The mesher merges only cubes; other shapes are their boxes'
faces, hidden where a neighbor covers them, and see-through blocks (glass, water, and custom blocks
that blend) go in a second mesh per region drawn blended; positions are sixteenths. The cut's cap
covers the parts of shapes a neighbor hid. Hidden blocks is a View settings switch. The checks
(`checks.ts`) count barriers and invisible bedrock as floors, since players stand on them (Temples'
queue spawn does), and follow Build Swap's own pairing of spawns with build boundaries (Roman puts
each spawn just outside its boundary's corner, which the game pairs by distance), so they warn of a
spawn paired with none or with one more than 3 blocks away instead of every spawn outside one. The
editor's marker entities aren't counted: the world reader doesn't read entities.

**V.8 Vanilla textures** (done 2026-11-06). The Look toggle and the texture array. As built: the
Look is a choice in View settings (the top bar's toggles moved there in the layout rework). The
color table's build (`looks.ts`, method 2) also makes each texture a 16x16 layer, tinted as its
color (an overlay texture tinted where its alpha is set, water made as see-through as the viewer
draws it), kept in `work\viewer\looks\textures.bin`; the color table names each block's layers,
and `GET /api/viewer/textures` sends them, fetched the first time Vanilla textures is picked. Each
vertex carries its face's layer; the shader works out where on the face it is from the world
position, so merged faces repeat the texture per block with nothing more stored. A cube's
see-through texels show its Average color (leaves look like Minecraft's fast leaves rather than
showing through to the sky, since their inner faces are left out), plants are cut out, and plants'
crossed faces now run corner to corner and full height so their textures fill them.

**V.9 Speed tools** (done 2026-11-06). Mirror, copy to another team, pick several. As built
(`speed.ts`): Mirror adds mirrored copies (the picked entries stay) across the map's middle, which
is the bounds' middle game Edit already uses for facings rather than x 0 and z 0, since maps made
before Select (Temples: z 8) aren't centered; whole x and z mirror to the block across it, exact
points to the point, yaws turn, boxes stay whole blocks. Team entries go to the next team by
default (the other one in a two-team game), their own team, or one picked. Copy adds team entries
to another team's list where they are. Mirror, Copy and deleting several are each one `batch` edit
(one undo step, up to 64 entries), and the copies are picked afterward. Pick several: Shift + click
in the view or the overview, or a rectangle dragged in Top view (entries by their middle).

**V.10 Select from above** (done 2026-11-06). The Worlds tab: the picture, the box, the automatic
height with its floor and ceiling handles, the 3D look, and Export through the extractor. As built:
the Maps page has Maps and Worlds tabs; Worlds lists the client's worlds with their icons and
folders opened before (`GET /api/viewer/worlds`), and opens one in its own page
(`/viewer/select?world=`, `select.html` and `select.ts`). The picture (`tools/viewer/overview.ts`,
format `overview-format.ts`) is each column's top block and height, blocks nobody sees looked
through, kept in `work\viewer\worlds\` by the world's stamp (Datapacking: 1.5 s, then 85 ms;
184 KB). The box is drawn, moved and resized on it (`select-box.ts`); its blocks come as a view file
clipped to the box (`view-file.ts` `viewOf` with a clip; the world's sub-chunks stay in memory for
five minutes, so a box after the first takes about 0.2 s), whose blocks' box is the trim; the side
picture and the 3D look (`MapScene` on the view cut to the floor and ceiling) are drawn from it.
Exports run in the Panel (`tools/viewer/select.ts`) through `Selections` with its own extraction
container, `minecade-extract-panel`, so in-game Select's can run at the same time; Chunker's image
build no longer blocks the process. The Panel doesn't exit or restart while one runs. The page
polls the world's list and opens the new map in the viewer when it's ready.

**V.11 With the in-game editor** (done 2026-11-06). Open in game, and reloading after the editor
saves a world. As built, with the user's warm-up: the Maps page and each viewer say every half
minute that they're open (`POST /api/editor/warm`), and a pick or a viewer opening names its map.
The Panel (`tools/control-panel/warm.ts`, `warmStep`, after each refresh) boots the map editor in
the background while one is open and the network isn't running (never stopping the network), asks
it (`POST /warm` on its control port) to open the named map in Edit ahead of time, and shuts an
editor it booted (`MINECADE_EDITOR_FROM=panel`, `fromPanel` in its status) down after 15 minutes
unused, or when the Panel closes with nobody on it. The runner (`warm`, `warmPlan` in
`editor-core.ts`) opens it only while nobody uses Edit (nobody on it or waiting for it, no open
asked for, no preview); a newer warm-up or a player's open calls off one still starting
(`ServerSession.cancel`, `StartCanceled`). Edits to the map while Edit opens it go to map.json
through the Panel, and Edit takes them once ready (`onReady`, "changed while Edit was opening
it", as one undo step; V.12 dropped a first try at undoing them from the Panel's history). Open in game (`POST
/api/viewer/in-game`, `POST /open` with `bring`) boots the editor if needed (asking before
stopping the network), opens the map, and sends map editors in the editor lobby, or joining in the
next 10 minutes, to it (`BRING_MS`). The viewer's In game menu (`ingame.ts`) shows all this, with
Preview and the screenshot buttons the Map editor page had. The Panel watches each open viewer's
world (`map-data.ts` `watchWorld`, a stamp steady twice in a row) and sends `world`; the page loads
again, keeping the camera, cuts, tool and pick. Starting the network shuts the editor down first.

**V.12 Map settings** (done 2026-11-06). Forms for the name, time, queue mode and countdown, game
settings and the lobby's stars (`map-edit.ts` has no op for `stars` yet: this pass adds one). As
built: the gear beside the map's name opens a Map settings dialog (`mapsettings.ts`) with the name
(the map id stays game Edit's, as it moves the folder), the time (game Edit's presets from
`time-of-day.ts`, or a custom clock time), the queue (once its spawn is placed), each of the game's
`map.settings` with its range and Use the default, the lobby's star box (the new `stars` op), and
the game's other plain keys as game Edit's Name and map id lists them. Each field's change is one
edit. `edit-check.ts` takes `name`, `time`, `queue`, `extra` and `stars`, and `markupProblem`
(now given the game's rules, kind too) keeps a setting in its range, another key to its kind of
value, the star box to the lobby, and the queue to its spawn. Undo through game Edit no longer
falls back to the Panel's history (that came back as a hand edit Edit's next undo took back): a
change made before Edit read the map is where its history starts, and undo says so.

## Files

**New**
- `tools/viewer/`: the Panel server's side: `world-reader.ts` (keys and newest values),
  `subchunk.ts`, `view-format.ts` and `view-file.ts` (the view file and its cache), `routes.ts`
  (all four from V.2), `looks.ts` (colors, tints and the overrides from V.3; textures and the
  shape table later), `png.ts` (PNGs of every kind, V.3), `overview.ts` (Select's picture and the
  automatic height), and `test/`. The spike's versions in `spike/viewer/` are the starting point.
- `tools/control-panel/viewer/`: the page and its scripts: `viewer.html`, `app.ts` (the page),
  `scene.ts` (three.js, regions, the shader, cuts and caps, the camera), `volume.ts` (the grid,
  face colors, picking), `mesher.ts` and `worker.ts`, and `test/` (V.3); tools and lists later.
- `docs/viewer.md`: how to use it.

**Changed**
- `tools/control-panel/panel.ts` (routes, the bundle on first use) and `index.html` (the Maps page).
- `tools/maps/blocks.ts`: its table reader shared with the world reader (`tableEntries`, V.2).
- `tools/editor/world-log.ts`: batches with their sequence numbers (`logWrites`) and any log's
  records (`logRecords`, the MANIFEST's too) for the world reader (V.2).
- `tools/editor/control.ts`, the runner and `session.ts`: `POST /edit`, `/undo` and `/redo` (pass V.5).
- `tools/maps/store.ts`: `exportPublished` says how many catalog files changed (V.5).
- `packages/minigame-core/src/map-edit.ts`: a `stars` op (pass V.12).
- `package.json`: `three` and `@types/three`, and `typecheck` runs `tsconfig.viewer.json` too
  (V.3); `tsconfig.node.json` leaves the page's folder to it.
- `docs/editor.md`: a line pointing to the viewer (V.3).

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
- `spike/viewer/`: the reader (`leveldb.ts`, `subchunk.ts`, `world.ts`), the looks (`looks.ts`,
  `brarchive.ts`, `image.ts`), the picture (`overview.ts`) and the mesher (`render/mesher.ts`).
- `prismarine-nbt` for palettes.
- `tools/build/vanilla-textures.ts` for the looks (V.3): it already reads `.brarchive` files
  (`readArchive`) and TGA images (`decodeTga`) for the kit pictures. Its PNG reader
  (`tools/skins/png.ts`) and `tools/editor/png.ts` read only 8-bit RGB(A) without interlacing, so
  the viewer's PNG decoder comes from the spike's `image.ts`.
- `games/paintball/behavior_pack/scripts/paint.ts` and `docs/spike-results.md` ("Vanilla block
  shapes for painting", "Painted shapes") for block states and door, gate and trapdoor boxes.

## Risks

Settled by the spike (`docs/spike-results.md`, "Map viewer"):
- The sub-chunk and palette details, and newest-wins across logs and tables: a server agrees
  block for block.
- The texture archive's format (as `ui.brarchive`, layered over 57 packs), and the color method
  (it looks right; ores and glowstone need overrides).
- Frame rate and memory at 256x256x384 in Edge: fine with region meshes.
- How quickly a cut moves: 3 to 9 ms a layer with a clipping plane.
- How long a big source world's picture takes: about 1 s (height maps can't be used).

Still open:
- **Slower PCs:** the spike ran on an RTX 3080 Ti. A plain laptop's numbers are unknown; the worst
  case's 6 million triangles would be the first thing to suffer.
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

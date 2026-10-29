# Look and feel

How Minecade talks to players and how its lobby UI is built: messages and colors, the HUD clock,
countdown sounds, and the lobby terminal with its hologram and themed menus.

## Messages and colors

Every message players read (chat, titles, the action bar) goes through
`packages/minigame-core/src/text.ts`, so the whole network uses one palette:

| Helper | Color | Use for |
|---|---|---|
| `say.minor` | gray (§7) | Minor notes: "You're spectating", "Wrapping up the last game" |
| `say.info` | aqua (§b) | Information: waiting for players, "Starting Sumo..." |
| `say.important` | blue (§9) | Important news: who's starting a game, round winners |
| `say.success` | green (§a) | Good news: "Go!", "Victory!" |
| `say.warn` / `say.error` | red (§c) | Warnings and errors: not enough players, a failed start |
| `say.highlight` | yellow (§e) | Highlights: countdown numbers, winners, the kill feed |

`nameOf(name, color?)` writes a player or team name in its team color (white without a team).
A name inside a `say.*` line hands the line's color back after itself, so this stays aqua:

```ts
say.info(`${nameOf("Alex")} is starting Sumo.`)
```

`stripColors(text)` removes the codes, for logs and tests (tests compare what players see).

## Kill feed

When a player goes down, the game broadcasts one line:

- **With a killer:** `<victim> was <verb> by <killer>`, the verb picked at random from
  `KILL_VERBS` (obliterated, dominated, man-handled, bonked, ...). The line is yellow, the victim
  is gray and the killer red, or both in their team colors in team games.
- **Without a killer:** a line picked by cause: falling into the void or off the map
  ("took a long walk off a short platform"), fall damage, or a generic one.

A game can add its own verbs, or use only its own, in `game.config.ts`:

```ts
deathMessages: { verbs: ["painted", "splattered"] }                 // added to the defaults
deathMessages: { verbs: ["painted"], replace: true }                // only these
deathMessages: { noKiller: ["fell off the plot"] }                  // lines with no killer
```

For anything more (a line that depends on the weapon, say), override
`protected deathMessage(victim, down)` in the game's `Minigame` class. Returning `undefined`
skips the line.

## Action bar and match clock

The action bar (the line above the hotbar) only shows what matters right now:

- **Lobby:** nothing. Starting a game shows titles and a countdown instead.
- **Games:** lives in games with lives, "Respawning in N" while respawning, and "Waiting for
  players" before the match. A game can show more by overriding `hud(name)`.

Every match has a clock: `timeLimitSeconds` in `game.config.ts`, 5 minutes when a game doesn't
set one (`DEFAULT_TIME_LIMIT_SECONDS`), or `0` for no limit. Games that override `play()` should
use `this.timeLimit` so the default applies to them too. When time runs out, `onTimeUp()`
decides the result (the highest score, or a draw).

The clock shows top right with a clock icon, turning red in the last 30 seconds. Bedrock has no
script API for placing text on the HUD, so it rides on the action bar: `hudLine()` in
`packages/minigame-core/src/hud.ts` starts the line with `HUD_MARK`, a run of formatting codes
that never renders, then the clock and anything else ("2:53   Lives: 2"). The core resource
pack's `ui/hud_screen.json` turns the action bar into a full-screen panel and shows marked lines
in a box top right, after a clock icon; unmarked lines show like the vanilla action bar. Without
the pack, the action bar just reads "2:53   Lives: 2". To see JSON UI errors in the client, turn
on Settings, Creator, Content Log GUI.

What JSON UI allowed here, found in-game on 26.60:

- Engine variables such as `$actionbar_text` work in expressions only after being copied into
  the control's own variable: `"$atext": "$actionbar_text"`.
- Expressions go in plain properties. `"visible": "(not (($atext - 'x') = $atext))"` works, and
  `"text": "('%.8s' * $atext)"` works ('%.Ns' keeps the first N bytes).
- String subtraction doesn't produce text: `"text": "($atext - 'x')"` fails with "expected a
  string". That's why the mark is invisible formatting codes instead of being cut off.
- View bindings need a `#property`: one whose expression only uses `$atext` fails with "Must
  define a source property name in the binding!".

## Countdown sounds

Every countdown (the match start, each round, and the lobby's "Joining" countdown) plays a tick
for each second, a bell for 3, 2 and 1, and a flourish with "Go!" (`CHIMES` and `countdownChime()`
in `hud.ts`). Games can play them too with `this.chime("bell")`.

## The core resource pack

`packages/minigame-core/resource_pack/` goes to every server, before the server's own pack: the
HUD clock now, and other shared UI later. The build stamps every resource pack's version from a
hash of its files, because clients cache server packs by UUID and version and would otherwise keep
an old copy. Images come from `tools/assets/make-assets.py` (Pillow): rerun it after changing the
art and commit the PNGs it writes.

## The lobby terminal

The lobby's menus live on a terminal in the middle of the lobby, not on items. One player uses it
at a time; a public hologram above it shows everyone what they're doing.

| Screen | The terminal's user sees | Everyone sees (the hologram) |
|---|---|---|
| Idle | nothing | The logo frame, "Tap the terminal" |
| Main | The themed menu: logo, Play and Stats side by side | The logo frame, Play and Stats, the chosen one lit |
| Play | A scrolling grid of game cards, 3 across, 80% of the screen's height: the game's 16:9 picture, its name, a player icon and the players needed (red when there aren't enough) | "Choose a game" and the game names, dimmed when there aren't enough players |
| Game | Left: the game's name and info, a red warning when there aren't enough players, the Random map switch (on at first), the settings (Teams: Pick or Random for team games, then the game's own options), Start at the bottom. Right: scrolling map tiles, 2 across, each a 16:9 preview with the name over it; dimmed while Random is on, the chosen one outlined when it's off. Clicking a tile turns Random off and picks that map | The game's name, "Map: ...", the settings, the players it needs, and a picture: the chosen map's preview, or the game's picture while the map is random |

The back arrow (top left of every menu) and Esc go back one step (game screen to grid to main
menu); on the main menu they end the session. Team picking and the stats screens get their own screens next.

**Pieces:**

- **The console:** nine `minecade:terminal` blocks (`lobby/behavior_pack/blocks/terminal.json`),
  one block type with a `minecade:part` state from 0 to 8 (reading order from the north-west
  corner). The top faces are drawn for the north-west corner and the north edge, and each part
  rotates its block. The center is the glowing projector. Tapping any part calls the
  `minecade:terminal` custom component, registered in `main.ts` at startup.
- **The hologram:** one `minecade:holo_display` entity (`behavior_pack/entities/holo_display.json`,
  `resource_pack/entity/...`). Its model is one 3x3 panel copied to all four sides by rotating it
  (`panel_s`, `panel_e`, `panel_n`, `panel_w`), so every side shows the same, unmirrored picture,
  plus a projection beam. The panel is a flat cube at z = +24 whose south face points outward,
  with its UV running normally (`"uv": [0, 0], "uv_size": [48, 48]`).
- **Frames plus live text:** the hologram has two background frames, picked by the client-synced
  `minecade:screen` property from `Array.screens` in
  `render_controllers/holo_display.render_controllers.json` (the order must match `FRAMES` in
  `scripts/hologram.ts`): `frame_logo` (the logo up top, for idle and main) and `frame_panel`
  (everything else). Everything else on it is text: `scripts/holo-content.ts` says what each
  screen shows (a title, up to 6 lines, each with a tone: normal, highlight, dim or warn), and
  `scripts/hologram.ts` draws it on each side with `TextPrimitive`s. So a new screen (team picks,
  stats) needs no new picture. Text heights are in `LAYOUT` in `hologram.ts`; tune them if
  redrawn frames need the text elsewhere. Text colors are in `TONES`: normal text is white, so it
  reads well against the glowing panel (text isn't blended with it).
- **Which way text faces:** a `TextPrimitive`'s y rotation is the direction its reader faces, and
  it turns the opposite way from Minecraft's player yaw: 0 is read facing south, 90 facing east,
  180 north, 270 west (measured in game). Text on a side is read from outside, facing the middle,
  so `readerYaw()` in `hologram.ts` gives the south side 180, the west 90, the north 0 and the
  east 270.
- **The picture:** on the game screen, the `minecade:picture` property picks a 16:9 picture from
  `Array.pictures` in the `holo_picture` render controller: the chosen map's preview, or the
  game's picture while the map is random (placeholders for either when there's none). It shows 2
  blocks wide above the middle of each side, with up to 4 lines under it. `holoPictures()` in
  `packages/minigame-core/src/registry.ts` makes the list (none, the placeholders, then every
  game's picture and map preview); the build writes it into the pack and the lobby looks pictures
  up in the same list. It holds up to 256 pictures.
- **Placement:** the map's `points.terminal` is the middle console block. At boot the lobby
  keeps that area loaded (a ticking area), places the console and spawns the hologram, and
  checks every 5 seconds that they're still there.
- **The lock:** `TerminalController` (`scripts/terminal-controller.ts`, unit-tested with ports).
  The session ends when its player closes the menu, starts a game, leaves, walks more than 8
  blocks away, or leaves it alone for 2 minutes.

**Columns of buttons:** a form's buttons are one list, but the themed layouts sort them into
columns by a mark at the start of each button's text (`MARK` in `scripts/game-screen.ts`,
formatting codes ending in `§r`, so they never render). In `ui/minecade_forms.json`, each column
is a stack panel that makes an item for every button and shows only the items with its mark; a
hidden item takes no space. The game grid alternates its cards between three columns. The game
screen's buttons come in this order: the Random map switch (`MARK.toggle`, plus `MARK.on` while
it's on, which swaps its switch picture), the settings, the maps (alternating between the two map
columns; `MARK.dim` darkens them while Random is on, and `MARK.selected` outlines the chosen
one), then Start. `gameButtons()` says what each one does, so the terminal knows what was pressed
from its place in the list. Start sends `start_game` with the map (or "random") and the settings,
the orchestrator passes the settings to the game server as `GAME_SETTINGS`, and a game reads them
from `ctx.vars.settings` (random teams skips team picking).

**Game options:** a game can offer its own settings on the game screen with `options` in
`game.config.ts`. Each value has a label; the first is the default. The build checks the ids
(lower camelCase, as the orchestrator passes them on) and allows at most 8 settings, Teams
included. Probe has two, to test the screen: Round really sets its stage length, and Teams does
nothing in Probe. Probe says the settings it got in chat when the match starts.

```ts
options: [
  { id: "round", label: "Round", values: [{ value: "15", label: "15 s" }, { value: "30", label: "30 s" }] },
],
```

**Demo games:** to test the menus with more games than exist, set `DEV_DEMO_GAMES` in `.env` (up
to 12). The lobby lists that many made-up games (`scripts/demo-games.ts`) after the real ones,
with placeholder pictures, several maps (one has 9, so the map column scrolls), and some team and
option settings. They can't be started.

**The player icon** on the game cards is a font glyph: `lobby/resource_pack/font/glyph_E3.png` is
a page of 16x16 cells for the characters U+E300 onward, and `GLYPH` in `scripts/menus.ts` names
them (cell 0 is the player icon). Glyphs can go in any text a form shows.

**JSON UI notes for these layouts:** a factory's collection only works on a `stack_panel`, `grid`
or `collection_panel` (on a plain panel, `collection_index` is silently ignored, and every item
shows button 0). Scrolling areas reuse vanilla `common.scrolling_panel`. The back arrow is vanilla
`common.close_button` with vanilla's back button textures. Pictures fill their control with
`"fill": true, "keep_ratio": false`. Sizes in percent are of the parent. Vanilla sizes the form
screen's content panel (`server_form.main_screen_content`) `[0, 0]`, which makes any percentage
inside it zero, so `ui/server_form.json` resizes it to fill the screen; then the layouts' root
(`long_form`) fills the screen too and the game grid can be `"80%"` of it. A texture with a `.json`
file next to it (`nineslice_size`, `base_size`) is a nine-slice: its outer slices keep their size
and the middle stretches.

**Themed menus:** a form whose title starts with a layout mark (formatting codes that never
render, `LAYOUT` in `scripts/menus.ts`) gets Minecade's layout from the lobby resource pack:
`ui/server_form.json` merges a second form factory into the vanilla screen and hides the vanilla
form for marked titles, and `ui/minecade_forms.json` holds the layouts. Without the pack, marked
forms are plain forms with a readable title. A test checks the marks match the pack.

## How the hologram looks the way it does

The hologram PNGs are dark, but in game the hologram looks light, see-through and glowing. Two
settings do that, not the images:

- **Additive blending** (the `entity_beam_additive` material in
  `resource_pack/entity/holo_display.entity.json`): each pixel's color is added to whatever is
  behind it. Black adds nothing, so it's invisible; dark colors are a faint tint; bright colors
  glow. Transparency in the PNG doesn't matter, brightness does.
- **`ignore_lighting: true`** (in the render controllers): the hologram is always fully bright,
  day or night, in shade or not.

So when drawing hologram art: paint on black, use brightness for glow, and expect dark fills to
mostly disappear.

## The art

Every image is a placeholder from `tools/assets/make-assets.py` (Pillow), meant to be redrawn by
hand. The script only writes images that don't exist yet (delete one to regenerate it); `--force`
regenerates all of them and overwrites any edits. Images are stretched to their display size, so
keep each one's proportions, except the nine-slice panels, which stretch only their middle.

| Image | Shown as | Art size |
|---|---|---|
| `packages/minigame-core/resource_pack/textures/minecade/hud/clock.png` | HUD clock icon, 10x10 | 16x16 |
| `lobby/resource_pack/textures/minecade/ui/logo.png` | Main menu logo, 232x50 | 1072x240, transparent background |
| `lobby/resource_pack/textures/minecade/ui/panel.png` | Main menu background, 300x116 | 600x232 |
| `lobby/resource_pack/textures/minecade/ui/tile_default.png`, `tile_hover.png`, `tile_pressed.png` | Menu buttons, 136x34 | 272x68 |
| `lobby/resource_pack/textures/minecade/ui/icon_play.png`, `icon_stats.png` | Button icons, 20x20 | 64x64 |
| `lobby/resource_pack/textures/minecade/ui/panel_grid.png` | Game grid background, 430 wide by 80% of the screen | 48x48 at 1x, nine-slice: the outer 8 pixels are the border and corners, the middle stretches (`panel_grid.json`) |
| `lobby/resource_pack/textures/minecade/ui/card_default.png`, `_hover`, `_pressed` | Game cards, 132x44 (the picture sits on the left, 60x34) | 280x92 |
| `lobby/resource_pack/textures/minecade/ui/panel_game.png` | Game screen background, 460x250 | 48x48 at 1x, nine-slice like `panel_grid` (`panel_game.json`) |
| `lobby/resource_pack/textures/minecade/ui/tile_map_default.png`, `_hover`, `_pressed` | Map tile frames, drawn over the map's preview, 104x58; the preview sits inside the 2 pixel border (100x54) | 208x116, a 4 pixel border, square corners, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/tile_map_selected.png` | Drawn over the chosen map's tile, 104x58 | 208x116, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/tile_dim.png` | Darkens the map tiles while Random is on, 100x54 | 8x8, black, partly transparent |
| `lobby/resource_pack/textures/minecade/ui/fade_bottom.png` | The dark fade under a map's name, stretched over the tile's lower half | 8x64, black, transparent at the top |
| `lobby/resource_pack/textures/minecade/ui/map_placeholder.png` | The preview of a map without its own (on its tile and the hologram) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/game_placeholder.png` | The picture of a game without its own (demo games) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/button_default.png`, `_hover`, `_pressed` | The Random switch, setting and Start buttons, 210x28 | 400x64 |
| `lobby/resource_pack/textures/minecade/ui/toggle_on.png`, `toggle_off.png` | The Random map switch, 26x13 | 52x26 |
| `lobby/resource_pack/font/glyph_E3.png` | Icons inside text, about the height of a letter; cell 0 (U+E300) is the player icon on the game cards | 256x256, 16x16 cells, white on transparent |
| `games/<id>/icon.png` | The game's picture: on its card (60x34) and on the hologram (2 blocks wide) while the map is random | 320x180 (16:9), required for every game |
| `games/<id>/maps/<map>/preview.png` | A map's preview on its tile (100x54) and on the hologram when it's chosen (optional) | 320x180 (16:9), such as a screenshot |
| `lobby/resource_pack/textures/minecade/holo/frame_logo.png`, `frame_panel.png` | Hologram frames, 3x3 blocks on all four sides, with live text over them; `frame_logo` has the logo up top | 512x512 (square), additive |
| `lobby/resource_pack/textures/minecade/holo/beam.png` | Projection beam, two crossed planes 2 wide by 3.25 tall | 128x256, additive, the projector at the bottom; fade the top to black so the beam has no hard edge |
| `lobby/resource_pack/textures/minecade/blocks/terminal_side.png` | Console sides | 16x16 |
| `lobby/resource_pack/textures/minecade/blocks/terminal_corner.png`, `terminal_edge.png`, `terminal_center.png` | Console tops | 16x16; the corner is drawn as the north-west corner (rims on the north and west sides) and the edge as the north edge, and the blocks rotate them into place |

The logo source is `tools/assets/source/minecade-title.png` (the orange original); the script
recolors it to holographic blue.

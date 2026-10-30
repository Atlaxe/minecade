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

- **Lobby:** nothing. Starting a game shows a chat message, and the countdown is on the terminal's
  hologram (no titles).
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

Every countdown (the match start, each round, and the lobby's countdown before sending players) plays a tick
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
| Game | Left: the game's name and info, a red warning when there aren't enough players, the Random map switch (on at first), the settings (Teams: Pick or Random for team games, then the game's own options), Start at the bottom. Right: scrolling map tiles, 2 across, each a 16:9 preview with the name over it; dimmed while Random is on, the chosen one outlined when it's off. Clicking a tile turns Random off and picks that map | Across the top, as wide as the frame allows: the chosen map's preview (or the "No preview" placeholder), or the game's picture while the map is random. Under it, two columns starting at the same height: the game's name and the players it needs on the left, and a table of "Map:" and each setting (up to 3) in white with the answers in yellow on the right. No map list or Start (only the terminal's user picks those) |
| Teams | After Start on a team game set to Pick, **every player in the match** gets a live team form (see below) | The game's name, each team and its players in the team's color, who's still random, and when teams lock |
| Starting | Nothing on screen (a chat message says who started what); the countdown chimes play for the players in the match | Centered: "Starting Sumo", the map and "Getting the server ready" while its server boots (after the team picks, for team games), then "Starting Sumo in", the seconds left in big yellow numbers, and the map |
| Stats list | A scrolling list of everyone with stats, each with their letter badge; you first, marked "(me)", even with no stats yet | "Stats" and the players' names, the viewer first but without "(me)", up to 7, then "+N more" |
| Player stats | Left: the player's badge (where their 3D skin goes later, see `docs/skins.md`) and a tab per view: Global, then each game they've played. Right: their name, their rank in the open view, and their stats as tiles in three columns: Results, Combat, More | A grid. Top row: the badge on the left; beside it the open tab's name (yellow), the player's name and their rank. Below: the open tab's stats as a table across the panel, the same three columns of value over label |

The back arrow (top left of every menu) and Esc go back one step (game screen to grid to main
menu, player stats to the list to the main menu); on the main menu they end the session.

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
- **Frames:** the hologram has two background frames, picked by the client-synced
  `minecade:screen` property from `Array.screens` in
  `render_controllers/holo_display.render_controllers.json` (the order must match `FRAMES` in
  `scripts/hologram.ts`): `frame_logo` (the logo up top, for idle and main) and `frame_panel`
  (everything else).
- **Layouts:** each screen's hologram recreates its form. `scripts/holo-content.ts` builds a list
  of text elements, each placed on the panel (`x` and `y` in blocks from the middle, -1.5 to 1.5,
  as its reader sees it) with a size, a tone or team color, and what it stands for: a button, the
  selected (open or chosen) one, or a stat's tile. `scripts/hologram.ts` keeps 48 text shapes
  (`TextPrimitive`s) per side and places them. Text never gets a background, because a solid
  background hides the hologram's glow: buttons are light blue, the selected one yellow. The
  builders take the same views the forms use, so a form and its hologram can't drift apart.
  Positions and sizes are in `HOLO_LAYOUT` in `holo-content.ts`; tune them there if text overlaps
  or redrawn frames need it elsewhere. Colors are in `TONES` and `BOX_COLORS` in `hologram.ts`
  (text isn't blended with the glowing panel, so they show as they are).
- **Fitting text:** text is placed by its middle, and there's no way to measure it, so
  `textWidth()` estimates widths from the default font's character widths in font pixels (most
  characters are 6, a space 4, "l" 3, "i" and ":" 2; the table is `ADVANCES`), at 0.024 blocks
  per font pixel at scale 1 (`HOLO_LAYOUT.pixel`, measured in game). Per-character widths matter
  for left-aligned text: with a flat width per character, lines with spaces and colons started
  further right than their neighbors. `fitScale()` shrinks text to fit a width (down to a
  minimum), `truncate()` cuts what still doesn't fit with "..", `wrap()` splits long game names
  onto two lines, and left-aligned text is placed half its width right of the left edge.
- **The safe edge:** the frame's border and corner brackets sit about 0.1 blocks inside the
  panel's edge, so text stays within 1.25 blocks of the middle (`HOLO_LAYOUT.edge`). The layout
  tests check that no text runs past it (with a little slack) by the width estimate.
- **Previewing layouts** (`DEV_HOLO_PREVIEW=1` in `.env`): the terminal's main menu gets a small
  Preview button in its corner. It lists every hologram screen (`scripts/holo-preview.ts`); pick
  one, the form closes, and that screen stays on the hologram with sample data until the terminal
  is tapped again, so you can walk around it without a form in the way. It also keeps the game
  screen layouts tried before: a taller picture with its sides cropped (`gameContent(view,
  "tall")`), and the old layout with the picture in the top right corner (`gameCornerContent()`).
  The terminal uses `gameContent(view)`.
- **Which way text faces:** a `TextPrimitive`'s y rotation is the direction its reader faces, and
  it turns the opposite way from Minecraft's player yaw: 0 is read facing south, 90 facing east,
  180 north, 270 west (measured in game). Text on a side is read from outside, facing the middle,
  so `readerYaw()` in `hologram.ts` gives the south side 180, the west 90, the north 0 and the
  east 270.
- **Pictures:** the model has two picture spots on each side, fixed in
  `models/entity/holo_display.geo.json`:
  - **The picture:** on the game screen, the chosen map's preview, or the game's picture while the
    map is random. The `minecade:picture` property picks it from `Array.pictures` (`holo_picture`
    render controller). `holoPictures()` in `packages/minigame-core/src/registry.ts` makes the list
    (none, the placeholders, then every game's picture and map preview), up to 256.
  - **Where the picture goes:** the game screen puts it across the top (the banner: full 16:9,
    2.72 blocks wide, y -0.17 to 1.36, just inside the frame's corner brackets). The Preview menu
    keeps two spots tried before: a taller banner (y -0.39 to 1.36) that crops 6.25% off each side
    of the picture (its bones' UV starts at 3 of 48 and spans 42) instead of stretching it, and
    the top right corner (16:9, 1.2 blocks wide). The `minecade:picture_spot` property picks the
    spot (0 the corner, 1 the banner, 2 the taller banner; `pictureSpot` in the content), and the
    `holo_picture` render controller shows the `picture_*`, `banner_*` or `tall_*` bones to match.
  - **The portrait** (top left, square, 0.75 blocks, top-aligned with the title): on a player's
    stats, their badge. The `minecade:portrait` property picks it from `Array.portraits`
    (`holo_portrait` render controller), listed by `holoPortraits()` (none, then every badge).

  The build writes both lists into the pack, and the lobby looks pictures up in the same lists.
  The model's x runs opposite to the reader's left and right: the picture (on the reader's right)
  has negative x in the model, and the portrait (on the reader's left) positive x.
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
from `ctx.vars.settings`.

**Team picks in the lobby:** for team games where players pick (Teams: Pick on the game screen),
players pick in the lobby while the game server boots, so no time is lost on the game server.
- **The form:** right after Start, every player in the match gets a live team form. It's a
  data-driven `CustomForm` from `@minecraft/server-ui` (`scripts/team-pick-form.ts`), the newer
  kind of form whose text updates while it's open and whose buttons don't close it. It renders in
  Ore UI, so the resource pack can't theme it.
- **On it:** each team with its players and count ("2/3"), a Join button per team (disabled when
  the team is full), a Random team button, and a status line.
- **Rules:** the teams and caps are the game's own (`activeTeams`, and `ceil(players / teams)`
  per team, as `assignTeams` honors), worked out in `scripts/team-picks.ts`. A player who leaves
  the lobby loses their pick. Someone who closed the form gets it back by tapping the terminal.
- **When teams lock** (`scripts/team-pick-controller.ts`, unit-tested with ports): once the game
  server is ready, and everyone has picked or 20 s have passed, but never before 5 s. Then the
  forms close, the lobby sends `team_picks` to the orchestrator, which forwards it to the game
  server, and the usual countdown and transfer run.
- **On the game server:** `Minigame.setTeamPicks()` keeps the picks for when the match begins.
  Players without a pick are dealt out randomly, and picks over a team's cap move to another team.
  With Teams: Pick, the game doesn't hand out its own picker (the nether star); with Random, nobody
  picks. The star is only for starts that don't come from the lobby's game screen (the debug API).
- **The hologram:** while teams are picked it shows them, and it stays on the starting game until
  the players are sent; then it goes back to idle.
- **Why a live form here, unlike the other menus:** a classic form (the themed menus) closes on
  every click and can't change while it's open, so every change means showing the form again.
  For team picks, players would only see each other's picks after their form reopened, and every
  pick would close and reopen everyone's form. The live form updates in place and its buttons
  don't close it; the cost is that it can't be themed.
- **If live forms become stylable:** if a future Minecraft update lets resource packs style these
  live forms the way JSON UI styles classic forms, move the themed menus (main menu, game grid,
  game screen, stats) to live forms too, so they update in place instead of reopening on every
  click.

**Stats screens** (`scripts/stats-controller.ts`, `scripts/stats-screens.ts`, unit-tested with
ports):
- **The list:** Stats on the main menu asks the orchestrator for everyone with stats
  (`stats_query` with `kind: "players"`) and lists them by name, with you first, marked "(me)",
  even before your first match that counts.
- **A player:** picking one asks for their overall stats, the games they've played and their
  rank. Each tab (Global, then each game, most played first) is asked for once, then remembered
  while the screen is open.
- **Stat columns:** the open tab's stats show as tiles (value over label) in three columns,
  `statColumns()` in `scripts/stats-screens.ts`: Results (games, wins, losses, draws, win rate),
  Combat (kills, deaths, K/D, best streak) and More (damage, time played, matches left early, and
  the game's own counters). Draws and matches left early only show when there are some. The tiles
  are form buttons marked for their column (`MARK.stats`), drawn as plain tiles, so they can't be
  clicked.
- **Ranks:** the orchestrator ranks everyone with matches that count by wins, then win rate, then
  kills (`StatsStore.rank`). Players equal on all three share a place. Global leaves co-op games
  out, as the totals do.
- **Which matches count:** matches with at least 2 players, or co-op games.
- **Testing alone:** `DEV_DEMO_STATS=1` in `.env` fills the stats with made-up players and matches
  (`orchestrator/src/stats/demo.ts`), kept in memory only. The real stats database isn't read or
  changed while it's on.
- **Badges:** until players' skins can be shown (`docs/skins.md`), each player has a letter badge
  by their name's first letter or digit (`badgeFor()`).

**Game options:** a game can offer its own settings on the game screen with `options` in
`game.config.ts`. Each value has a label; the first is the default. The build checks the ids
(lower camelCase, as the orchestrator passes them on) and allows at most 8 settings, Teams
included. Each setting's button shows its value and, under it, a bar per value with the chosen one
bright (`settingBars()` in `scripts/menus.ts`, drawn with font glyphs). Probe is the test game for
all of this: it has two teams (so Teams: Pick or Random, and the team form) and a Round setting
that really sets its stage length. It needs 2 players, so set `DEV_MIN_PLAYERS=1` to test alone.
When the match starts, Probe says the settings it got and who is on which team.

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
`common.close_button` with vanilla's back button textures. `"fill": true` on an image scales it to
cover its control and crops what overflows (even with `"keep_ratio": false`), so pictures use it
and frames never do. Sizes in percent are of the parent. Vanilla sizes the form
screen's content panel (`server_form.main_screen_content`) `[0, 0]`, which makes any percentage
inside it zero, so `ui/server_form.json` resizes it to fill the screen; then the layouts' root
(`long_form`) fills the screen too and the game grid can be `"80%"` of it. A texture with a `.json`
file next to it (`nineslice_size`, `base_size`) is a nine-slice: its outer slices keep their size
and the middle stretches.

**The square style:** every button (main menu tiles, game cards, settings, the Random switch, Start,
player rows, tabs) uses one set of art, `button_default/hover/pressed.png`: a 1x nine-slice, navy
with a cyan line down the left and right edges and square corners, so it looks the same at any
size. Outlines (map tiles, the chosen map, the open tab, the portrait) are square nine-slices too.
Nothing in the menus is round.

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

**The menus can't blend that way.** Form images (JSON UI) have no blend mode, only transparency
(vanilla's UI files have no blend setting anywhere). So the menu backgrounds copy the hologram's
look with transparency instead: a see-through dark fill (the world shows through dimly, as through
the hologram), a glowing border and corner brackets, and faint scanlines. Two JSON UI features
keep it crisp at any size: `holo_panel.png` is a nine-slice (its outer 24 pixels, with the border
and brackets, keep their size; the middle stretches), and `holo_scanlines.png` is tiled
(`"tiled": true`), repeated at its own size instead of stretched. Both are drawn together as
`holo_background` in `ui/minecade_forms.json`. The hologram frames and the menu background are
separate images, so redrawing one doesn't change the other.

## The art

Every image is a placeholder from `tools/assets/make-assets.py` (Pillow), meant to be redrawn by
hand. The script only writes images that don't exist yet (delete one to regenerate it); `--force`
regenerates all of them and overwrites any edits. Images are stretched to their display size, so
keep each one's proportions, except the nine-slice menu background, which stretches only its
middle, and the tiled scanlines, which repeat.

| Image | Shown as | Art size |
|---|---|---|
| `packages/minigame-core/resource_pack/textures/minecade/hud/clock.png` | HUD clock icon, 10x10 | 16x16 |
| `lobby/resource_pack/textures/minecade/ui/logo.png` | Main menu logo, 232x50 | 1072x240, transparent background |
| `lobby/resource_pack/textures/minecade/ui/holo_panel.png` | Every menu's background (main menu 300x116, game grid 430 wide by 80% of the screen, game screen 460x250) | 64x64 at 1x, nine-slice (`holo_panel.json`): the outer 24 pixels hold the border and corner brackets and keep their size, the middle stretches; partly transparent |
| `lobby/resource_pack/textures/minecade/ui/holo_scanlines.png` | Scanlines over every menu's background, tiled (repeated at 1 pixel per pixel) | 4x3, one faint line on top, the rest transparent |
| `lobby/resource_pack/textures/minecade/ui/icon_play.png`, `icon_stats.png` | Button icons, 20x20 | 64x64 |
| `lobby/resource_pack/textures/minecade/ui/tile_map_default.png`, `_hover`, `_pressed` | Map tile frames, drawn over the map's preview, 104x58; the preview sits inside the 2 pixel border (100x54) | 16x16 at 1x, nine-slice (4 pixel slices): a 2 pixel square outline, transparent middle (a light tint on hover and press) |
| `lobby/resource_pack/textures/minecade/ui/tile_map_selected.png` | Drawn over the chosen map's tile, 104x58 | 16x16 at 1x, nine-slice: a white 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/tile_dim.png` | Darkens the map tiles while Random is on, 100x54 | 8x8, black, partly transparent |
| `lobby/resource_pack/textures/minecade/ui/fade_bottom.png` | The dark fade under a map's name, stretched over the tile's lower half | 8x64, black, transparent at the top |
| `lobby/resource_pack/textures/minecade/ui/map_placeholder.png` | The preview of a map without its own (on its tile and the hologram) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/game_placeholder.png` | The picture of a game without its own (demo games) | 320x180 (16:9) |
| `lobby/resource_pack/textures/minecade/ui/button_default.png`, `_hover`, `_pressed` | Every button: main menu tiles (136x34), game cards (132x44), the Random switch, settings and Start (210x28), player rows, tabs | 16x16 at 1x, nine-slice (4 pixel slices): navy, a 2 pixel cyan line down the left and right edges, square corners |
| `lobby/resource_pack/textures/minecade/ui/toggle_on.png`, `toggle_off.png` | The Random map switch, 26x13 | 52x26, a square track with a square knob |
| `lobby/resource_pack/textures/minecade/ui/tab_selected.png` | Drawn over the open tab on a player's stats | 16x16 at 1x, nine-slice: a white 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/portrait_frame.png` | The frame around the portrait on a player's stats, 96x96 | 16x16 at 1x, nine-slice: a cyan 2 pixel outline, transparent middle |
| `lobby/resource_pack/textures/minecade/ui/stat_tile.png` | Behind each stat on a player's stats, 90x27 | 16x16 at 1x, nine-slice: dim navy, no lines (so it doesn't look clickable) |
| `lobby/resource_pack/textures/minecade/badges/a.png` to `z.png`, `0.png` to `9.png`, `other.png` | Player badges: 20x20 in the stats list, 88x88 as the portrait on a player's stats and about 0.9 blocks on the hologram (where their skin goes later) | 64x64, a square |
| `lobby/resource_pack/font/glyph_E3.png` | Icons inside text, about the height of a letter: cell 0 (U+E300) is the player icon on the game cards; cells 1 and 2 (U+E301, U+E302) are a setting's bars under its label, bright for the chosen value and dim for the others | 256x256, 16x16 cells, on transparent |
| `games/<id>/icon.png` | The game's picture: on its card (60x34) and on the hologram (2 blocks wide) while the map is random | 320x180 (16:9), required for every game |
| `games/<id>/maps/<map>/preview.png` | A map's preview on its tile (100x54) and on the hologram when it's chosen (optional) | 320x180 (16:9), such as a screenshot |
| `lobby/resource_pack/textures/minecade/holo/frame_logo.png`, `frame_panel.png` | Hologram frames, 3x3 blocks on all four sides, with live text over them; `frame_logo` has the logo up top | 512x512 (square), additive |
| `lobby/resource_pack/textures/minecade/holo/beam.png` | Projection beam, two crossed planes 2 wide by 3.25 tall | 128x256, additive, the projector at the bottom; fade the top to black so the beam has no hard edge |
| `lobby/resource_pack/textures/minecade/blocks/terminal_side.png` | Console sides | 16x16 |
| `lobby/resource_pack/textures/minecade/blocks/terminal_corner.png`, `terminal_edge.png`, `terminal_center.png` | Console tops | 16x16; the corner is drawn as the north-west corner (rims on the north and west sides) and the edge as the north edge, and the blocks rotate them into place |

The logo source is `tools/assets/source/minecade-title.png` (the orange original); the script
recolors it to holographic blue.

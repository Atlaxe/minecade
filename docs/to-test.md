# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a friend outside the network

- Join through the public address, then go from the lobby to a game and back (both transfers).
- Two players on one server, one on the LAN and one remote.
- A console player through BedrockConnect: join, play a game, come back.

## Needs a second player

- Sumo feel test: about 10 minutes of real knockback.
- A real match is recorded and shows on the stats screens (demo stats are off).
- Team picks with real players: the team form and the hologram's team lists.
- Another player's skin shows in the stats screens after the next build.

## Map editor

After the editor's next Stop and Start in the Panel (it runs the code it started with), on Sumo's
`arena_1`:

- The map menu down the right side: "Map menu" and the X, a row of icons (the checklist pill with a
  check and "1/1", Undo, Redo, a gear), the tool icons, the settings, and a green Save bar at the
  bottom that stays put while the settings scroll. The checklist and a marker's form are still dark
  side menus that scroll.
- Pointing at a quick icon or a tool shows its name in a tooltip box. If none shows, say so.
- The pill shows only its count; its tooltip says "Checklist: ready" or the problems. Tap it: the
  checklist, with Mark ready at the bottom on a draft.
- Undo and Redo are faded with nothing to undo or redo. After placing a spawn, Undo removes it and
  the menu opens again.
- The gear opens Map settings: Name and game settings (the old form). Drop build commands shows,
  red, only on a map with build commands.
- Tap a tool icon: the tool goes in slot 1, in your hand (whatever was there moves), and the menu
  opens again with the icon outlined and its settings under the grid. Tap it again: it's put away.
  With no tool out, the settings say "Pick a tool above".
- Delete (a marker's form, a box's menu), Clear selection and Remove kill Y are red, white text.
- Spawn tool: in the menu, Place into lists each list with its count, the one in use outlined; tap
  another to switch. Save my facing is a switch; Snap cycles Exact, 45 and 90 degrees. Holding the
  tool, the line above the hotbar says what a use will place. A use places at once, no form.
- A spawn placed with "Save my facing" shows a glowing red line from the top of its marker, about 2
  blocks toward where you faced. Placed while looking down, it tilts down. If it points backward or
  tilts the wrong way, say so: it's one sign to flip.
- Take my facing on a marker turns its line; Clear facing removes it.
- Save: tap it. Chat says it's saving, the markers vanish for a moment and come back, then "Saved
  the map and the world". Place a block and open the menu: the bar says "unsaved block changes".
  The Panel's Save does the same; Stop saves the block changes since.
- Region tool:
  - Holding it, the line above the hotbar says what a hit and a use do, and the selection's size.
  - Hitting a block starts a one-block selection (yellow dots) and doesn't break the block.
  - Using the tool on blocks grows the selection to them.
  - Using it at the sky opens the region form. Save as a kill region, then as a new region named
    `plot`: `map.json` gets both, and each outline shows in its own color. Undo removes the last.
  - Save as Bounds replaces Sumo's bounds; the white outline moves. Undo puts them back.
  - In the map menu with the region tool picked: the selection's actions (Nudge sides, Floor at
    kill Y, Back one step, Clear) work like the form's, and Bounds and regions lists each box: Edit,
    then grow it and Save changes; Nudge; Go to; Delete.
- Kill Y tool: a use sets kill Y one below your feet at once. In the map menu: Type a height, Remove
  kill Y. The red dots move.
- Outlines:
  - Each dot has a dark rim, and the yellow selection is easy to see against the sky and bright
    blocks.
  - Fly 100 or more blocks from the bounds: the whole outline still shows where its edges are, with
    dots about as big on screen as near ones.
  - Flying or turning, far dots stay close to their edges (they're redrawn twice a second).
  - Only while holding the region or Kill Y tool, and smooth with a big selection (grow one across
    the whole map).
  - If no dots show at all, the custom particle didn't load: say so.

## Needs a second player (map editor)

- A gamertag in `EDITOR_ALLOW_LIST` but not `MAP_EDITORS` joins as a builder: creative, no tools.
- A gamertag in neither list is refused.

## Solo

Lobby terminal memory (after the network's next Start or Restart in the Panel):

- On a game's screen, switch Random off, pick a map and change a setting, then press the X. Tap the
  terminal: that game's screen opens with the same choices.
- The hologram keeps showing the last screen after the X, Esc on the main menu, or walking away
  (it doesn't go back to "Tap the terminal").
- The same after walking away from the terminal, and after leaving the lobby and joining again.
- Esc back to the grid, open another game, then go back to the first: its choices are still there.
- Start a game. Once everyone is sent, the hologram shows the main screen. Back in the lobby, a
  tap opens the main menu, each game's screen has Random on and its first map and settings again,
  and Stats opens on the list.
- Stats: open a player's stats on a game tab and press the X. A tap opens that player and tab. Go
  back to the list, press the X: a tap opens the list.
- Walk away while the stats screens are open: they close and stay closed (before, the list opened
  again).

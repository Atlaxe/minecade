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

- The map menu, the checklist and a marker's form open on the right side of the screen, full
  height, dark, with titles and buttons in Minecraft Ten. With more buttons than fit, they scroll.
- The Spawn tool switch: on puts the tool in slot 1, in your hand (whatever was in slot 1 moves to
  another slot), and the next map menu shows the switch on. You can move the tool. Off takes it
  away.
- Save the world at stop: the menu opens again with the switch flipped.
- A spawn placed with "Save my facing" shows a glowing red line from the top of its marker, about 2
  blocks toward where you faced. Placed while looking down, it tilts down. If it points backward or
  tilts the wrong way, say so: it's one sign to flip.
- Take my facing on a marker turns its line; Clear facing removes it.
- Region tool (pass 10.4), on Sumo's `arena_1`:
  - The map menu shows the Region tool and Kill Y tool switches.
  - Hitting a block starts a one-block selection (yellow dots) and doesn't break the block.
  - Using the tool on blocks grows the selection to them, and the size shows above the hotbar.
  - Using it at the sky opens the region form. Save as a kill region, then as a new region named
    `plot`: `map.json` gets both, and each outline shows in its own color. Undo removes the last.
  - Save as Bounds replaces Sumo's bounds; the white outline moves. Undo puts them back.
  - Nudge sides and Floor at kill Y change the selection; Back one step undoes them.
  - Bounds and regions in the map menu: Edit, then grow it and Save changes; Nudge; Go to; Delete.
  - Kill Y tool: Set to (one below your feet), Type a height, Remove. The red dot plane moves.
  - Outlines show only while holding the region or Kill Y tool, and stay smooth with a big
    selection (grow one across the whole map).
  - If no dots show at all, the custom particle didn't load: say so (the fallback is the game's
    colored flame particle).

## Needs a second player (map editor)

- A gamertag in `EDITOR_ALLOW_LIST` but not `MAP_EDITORS` joins as a builder: creative, no tools.
- A gamertag in neither list is refused.

## Solo

- Lobby game screen: click Random map, then, without moving the mouse, click it again once the menu
  has reopened. It switches back and the menu stays open. If the menu closes instead, the lobby log
  says "left the terminal with the X, N ticks after the menu opened".

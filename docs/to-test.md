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

## Map editor (pass 10.3)

- Sumo end to end: `npm run editor -- sumo arena_1` (or Start on the Panel's Map editor page), join
  `LAN_HOST:19134`, place a spawn with "Save my facing" on, and watch `map.json` change. Undo it
  from the map menu. Stop, then `git diff` shows only the intended change, and reopening shows no
  leftover markers.
- The editor log says "<your gamertag> is an operator" after you join.
- Hitting a block with the map menu or the spawn tool doesn't break it.
- Hitting a marker opens its form: move here, take my facing, change list, renumber, delete.
- Place or break a block, stop: the world is saved, and a reopen has no markers in it.
- `--new`: `npm run editor -- sumo test --new` starts on a glass pad; stop saves the world.

## Needs a second player (map editor)

- A gamertag in `EDITOR_ALLOW_LIST` but not `MAP_EDITORS` joins as a builder: creative, no tools.
- A gamertag in neither list is refused.

## Solo

- Lobby game screen: click Random map, then, without moving the mouse, click it again once the menu
  has reopened. It switches back and the menu stays open. If the menu closes instead, the lobby log
  says "left the terminal with the X, N ticks after the menu opened".

# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a second player

- Team picks with real players: the team form and the hologram's team lists.

## One in the Quiver

With a second player (a preview with an invited guest, or the network once the map is published):

- After a published match, the stats screen's One in the Quiver tab shows Bow kills and Longest shot.
- Published: the game is in the lobby's game grid with the green QUIVER picture (a Game picture
  from the Camera tool replaces it).

## Bridges

Make its first map in the map editor, then preview it (a fake player, or better an invited guest):

- The checklist asks for team spawns, bounds, kill Y, a spectator or queue spawn, Hole (Red) and
  (Blue) as posts, and Spawn guard (Red) and (Blue), which the region tool saves and the Boundaries
  view shows in each team's color.
- Once everyone is in, you stand frozen at your team's spawn with the kit form open: Everyone gets
  (sword, bow, 64 wool, arrow), then Snowballs and Leap, each with a picture of its items and counts
  above it. Say whether the pictures show at all (DDUI's image argument is a guess). Closing the form
  brings it back within a second. Once both have picked, it closes and a 5 second countdown runs.
- The holes: black inside, a ring of the team's color at the rim, standing in the map's pits.
  Arrows and snowballs don't stick on them.
- Top right: five white circles beside the clock. Score in the other team's hole: the round's title,
  a short pause, everyone back at their spawns with a 3 second countdown, and the first circle in
  your color. Three rounds win the match. Jumping into your own hole puts you down ("jumped into
  their own hole").
- Wool places inside the bounds but not in either spawn guard or over a hole. Only placed wool
  breaks, and it drops nothing. With the lobby's Placed blocks on Cleared each round, it's gone
  after each goal.
- The bow shoots the locked arrow; the arrow comes back 10 seconds later (the level counts down
  the seconds), or at once with a kill. Snowballs push; the Leap feather throws you forward and up
  once. Snowballs and the Leap don't come back when you die, only at the next round (what's left
  stays through a death).
- The lobby: Bridges' card, Teams: Pick or Random, Best of (5, 3, 7) and Placed blocks.

## Map editor
Several bounds and the Boundaries view, on a copy of Sumo's Arena:

- Region tool, Save as "Add to bounds (another box)" on an area beside the arena: Bounds and
  regions lists Bounds 1 and Bounds 2, Boundaries says 2 boxes, and `map.json` has
  `"bounds": [ ... ]` with both. Save as Bounds replaces them all with the one box, and Undo puts
  them back.
- Preview it: walking from one box into the other is fine, and stepping into the gap between them
  puts you out. Delete Bounds 2: `map.json` is back to one box, as an object.


Guests (needs a second account that isn't in LAN_PLAYERS):

- Edit's gear, Players, Invite a player: chat says they're invited and gives the address to join.
  The Panel's Guests card lists them.
- With nothing open on Select, the guest who joins port 19132 sees a dark screen saying it's
  waiting for Select or a preview, and no editor menu.
- Open a world in Select: the guest is moved there in creative with no tools, and can fly around
  but not break or place blocks. Edit (port 19134) refuses them.
- Start a preview from Edit: the guest waits in the editor lobby while Select closes, then you both
  go into the preview. When it ends, you're back in Edit and they're in the editor lobby, then on
  Select once it reopens.
- In a preview, the guest types `/exit`: only they go home to the editor lobby, and the preview
  goes on for you.
- Players, tap the guest, Remove: they're disconnected with "You're no longer invited to the map
  editor", and can't rejoin.
- With a second map editor (another LAN_PLAYERS account) in Edit, opening another map asks about
  them first; they wait in the editor lobby and come back with you.
# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a second player

- Team picks with real players: the team form and the hologram's team lists.

## Every server

- Command blocks don't run: in a world with command blocks (Select, Edit, a preview), nothing they
  do happens.

## One in the Quiver

With a second player (a preview with an invited guest, or the network once the map is published):

- After a published match, the stats screen's One in the Quiver tab shows Bow kills and Longest shot.
- Published: the game is in the lobby's game grid with the green QUIVER picture (a Game picture
  from the Camera tool replaces it).

Alone, in a preview with fake players:

- No "+1 arrow" line after a kill.
- A missed arrow stays where it lands, then disappears about 5 seconds after it stops (or as soon
  as someone walks within 2.5 blocks of it).

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

Previews:

- A map with a queue spawn and no spectator spawn passes the checklist and previews. Players who
  are out wait at the queue spawn on foot, seen but nameless, and get put back if they fall.

The Snapshot tool (the map menu's fifth tool; place a camera with the Camera tool first):

- Use it: the side menu lists the map's cameras. Pick one: your view moves there, with corner marks
  framing the 16:9 area. The tool's settings in the map menu list the cameras too.
- Hit a camera's marker with anything: the Snapshot tool goes into slot 1 and you look through that
  camera. Right click a camera's marker: its form, with Game picture and Delete.
- Nudge X, Y and Z, Turn and Tilt with each Step size: the view follows.
- Take a screenshot: the line at the top says F1, F2, F1. Press them; the frame doesn't show in the
  screenshot.
- Use the Snapshot tool again, then Use latest screenshot: chat confirms, your view comes back, and
  the map's preview.png (or the game's icon.png) is updated.
- Open the map again, then the gear, Edit Map Thumbnail: a two-column grid with the one in use
  outlined green; tap another to switch. Same for Edit Minigame Thumbnail.
- Edit Map Thumbnail, Import from another minigame: pick a game, then a map card, Use it, then
  Import name (the map takes that name and map id) or Keep mine.
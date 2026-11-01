# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a second player

- Team picks with real players: the team form and the hologram's team lists.

## One in the Quiver

Its first map (needs the map editor, after the editor's next boot):

- New map from one of your worlds, box an arena in Select, and Save as map for One in the Quiver.
  In Edit, the checklist asks for 10 spawns, a spectator spawn and kill Y. Place them and Save.
- Preview it alone. You spawn with a stone sword in slot 1, a bow in slot 2 and one arrow in slot 9;
  Q drops none of them. Draw the bow and shoot at a wall: the arrow leaves slot 9 (if the bow
  won't shoot the locked arrow, say so), and it's gone from the wall, nothing to pick up.
- The sidebar says Kills, and chat says "First to 15 kills wins...".

With a second player (a preview with an invited guest, or the network once the map is published):

- An arrow hit kills at once: the kill feed says "B was shot by A (N blocks)" (or sniped,
  skewered...), and A gets "+1 arrow" on the action bar, a chime and an arrow in slot 9.
- B watches from the spectator spawn for 2 seconds, then respawns away from A with one arrow, and
  can't be hurt for 2 seconds.
- A sword hit then an arrow right after (within half a second) still kills. A sword kill earns an
  arrow too. An arrow shot straight up that comes down on its shooter does nothing.
- 5 kills in a row: chat says "A is on a 5 kill streak!".
- The first to the target wins. On the lobby's game screen, First to cycles 15, 20, 25 and 10 kills.
- After a published match, the stats screen's One in the Quiver tab shows Bow kills and Longest shot.
- Published: the game is in the lobby's game grid with the green QUIVER picture (a Game picture
  from the Camera tool replaces it).

## Map editor

In Edit, on a copy of Sumo's Arena:

- Pointing at a quick icon or a tool shows its name in a tooltip box.
- Exact placing: aim at a spot near a block's corner and use the Spawn tool. The marker stands
  exactly there, and chat gives the spot with decimals ("3.27 65 -1.84"). Aimed at a wall, it
  stands on the floor just in front; aimed at the sky, where you stand. Center on block puts it in
  the block's middle again. Hit a marker, Move here: it moves exactly to where you stand.
- Save my facing: the marker's red line points about 2 blocks the way you faced, tilted down if you
  looked down. If it points backward or tilts the wrong way, say so. Take my facing turns it, and
  Clear facing removes it.
- Region tool: Save as a kill region, then as a new region named `plot`. Each outline has its own
  color, and Undo removes the last. With the tool picked, the map menu's selection actions (Nudge
  sides, Floor at kill Y, Back one step, Clear) work, and Bounds and regions lists each box with
  Edit, Nudge, Go to and Delete.
- Outlines: fly 100 or more blocks from the bounds. The whole outline still shows, its far dots
  about as big on screen as near ones and staying on their edges as you fly or turn. A selection
  grown across the whole map stays smooth.

Every editor menu (after the editor's next boot):

- Buttons are in the game's regular font (only titles are Minecraft Ten), one line and about 22
  pixels tall: the Leave menu's Leave and Cancel, the Recent cards, everything. Point at a button
  with a second line (most of them): its tooltip shows it.
- Cards with a status (Open now's "open: Friend", a failed export) are taller and show both lines.
- Forms with fields (Name and game settings in Edit's gear, typing a position or a height, Invite a
  player, Export's Name) are side panels with a green button at the bottom, not a box in the middle.
  If one still shows in the middle, or its labels are hard to read on the dark panel, say so.
- Chat names a map as [Sumo : Arena], Sumo gold and Arena orange: opening a map, publishing,
  deleting, exporting, "ready" notices.

Edit's map menu (after the editor's next boot):

- No text under the tools any more. With a tool picked, the first thing is an aqua Help link: tap
  it, and the tool's how-to goes into chat with a chime.
- Save is just "Save"; its tooltip says whether blocks changed.
- Spawn tool picked: every spawn, the spectator spawn and the queue spawn, by list, each tappable.
- Markers have a color per kind: spawns orange, spectator gray, queue aqua, team spawns green,
  points yellow, cameras magenta.
- Use the Spawn tool: a "New spawn" screen opens: the Spawn / Spectator / Queue tiles first (the
  picked one green), then the position (tap to type), Move here, Center on block, the facing rows,
  then X, Y and Z rows with a minus and a plus. The block it goes in is outlined; nudge it and the
  outline moves. Place (green, at the bottom) places it; the X places nothing.
- Hit a marker: the same screen, with Renumber, Delete (red) and Save. Pick another list's tile and
  Save: it moves to that list.
- Region tool picked: every boundary is outlined while the map menu is open.
- Use the Region tool at the sky: the selection's screen: what to save it as (tiles), New region's
  Name, Floor at kill Y, Back one step, a minus and a plus for each side (the outline follows),
  Clear (red) and Save (green).
- Use the Kill Y tool: its screen; nudge the height and the red plane moves; Set kill Y saves it.
- Use the Camera tool: the new camera's screen (Map preview or Game picture tiles, Aim from my
  view, Place camera).
- The gear: no Back to Select; Name and game settings opens down the right side.

The editor lobby's menu (after the editor's next boot):

- The top row: a pencil, a plus, a person (Players) and a door at the right end. Under it, the
  Recent filter: three touching tiles (a pencil, a crop mark, a play icon); tap one and it turns
  green. Pointing at each
  shows its name in a tooltip box. The pencil opens Open a map and the plus New map, as before;
  the list has no Maps section any more.
- Open now and Recent are cards: an icon on the left (pencil for Edit, crop mark for Select, play
  for a preview) and the name beside it. Open now's cards also say who is on them.
- Tap the crop mark tile: it's green, the heading reads "Recent: Select only" and only worlds are
  listed. Tap it again: everything. A kind with nothing yet says so ("No previews yet").
- Preview a map from Edit, then go to the editor lobby: Recent has it with the play icon. Tap it:
  "Loading the preview of ...", about 30 seconds later you're in the preview, and when it ends
  you're back in the editor lobby, with chat saying how it ended. Edit stayed open meanwhile.
- Loading anything: the title reads "Loading" with five dots after it, lit aqua one at a time from
  left to right. If they don't move, or sit too high or low beside the word, say so.
- The door: a "Leave?" menu. Cancel goes back; Leave disconnects you with "You left the map editor.
  Join again to come back." Joining again brings you back to the menu.

Loading, /reset and Select's latest changes (after the editor's next boot):

- Every move between servers shows the loading screen (the dots), not only in the editor lobby:
  tap a map's Edit in Select; start a preview from Edit (everyone in Edit sees it). If opening fails,
  it closes and chat says why.
- Select: Export to Map, then the loading screen ("Exporting") stays up until the map is cut out,
  then "Edit <name>?" asks. A failed export shows why.
- /reset (or /minecade:reset) in Select or Edit: creative mode and your editor items back. Clear
  your inventory with a command (/clear): within about 10 seconds, the map menu (and in Select the
  Select tool) comes back by itself, with a chat line.
- Select's map menu: the icon row has Back one step, Players, and a house (Back to Lobby) at the
  right end; under it an aqua Help link that puts how to box a map in chat, with a chime. No
  question mark, nothing pinned at the bottom.
- With any Select menu open (holding the map menu), the outlines show.
- Nudge sides: a back arrow left of the title (back to the menu you came from); Step is three
  tiles (1, 5, 10 blocks) above the rows, the one in use green; Nudge is green at the bottom.
- Export to Map: a back arrow; Name, Map id and For stay put while only the games list scrolls;
  Export to Map is green, pinned at the bottom.
- Edit's gear: Players and the house (Back to Lobby) in its icon row.

Select (New map from one of your worlds; after the editor's next boot):

- The box top center reads "Select" (aqua) and the world's name.
- You can't break or place blocks (with or without the tool), and doors and buttons don't work.
  The Select tool stays in slot 1 (it can't be moved or dropped).
- The map menu: no crop icon and no empty space at the top. Its icon row has Back one step (faded
  with nothing to step back), Players (a person) and a question mark whose tooltip says how to box
  a map. Back to Lobby is pinned at the bottom, and the list scrolls above it.
- With a selection: "Selection: <size>", Export to Map (green), Nudge sides, Clear selection (red).
  Back one step in the row undoes the last grow and the menu stays open.
- Nudge sides: a side menu with a minus and a plus for each side; each side says ahead, behind,
  left or right, and the line above the hotbar says which way you face. Tap plus on the side ahead:
  the outline moves out at once. Step cycles 1, 5 and 10. Nudge (green) keeps it; the X puts the box
  back. If the minus and plus don't line up with their side, say so.
- Export to Map: a side menu: Name, Map id, then the games (titles only, the picked one outlined),
  then Export to Map (green). Tap Name: a small text box. Leave Map id: it shows the one made from
  the name in gray. You don't have to stand inside the box.
- When it's ready: a chime, and "<name> is ready to load in Edit" in green above the hotbar for
  about 6 seconds. Its card in the map menu is just its name.
- Tap it: "Edit <name>?" with Edit (green) and Cancel. Edit: the Loading menu with the dots, then
  you're in Edit, arriving high over the middle of the map (its spectator spawn, 10 blocks above
  its highest block). `map.json` has no spawns and a spectator spawn; the checklist asks for spawns.
- Box a second build while the first is being cut out: both end up ready.
- The editor lobby's New map, Empty world: Sumo, a name and an empty id. Edit opens it, a glass pad
  in the void.

Edit's gear (after the editor's next boot):

- Players is an icon at the top; Back to Lobby is pinned at the bottom.
- Delete map (red): "Delete <name>?" says what happens. Delete it: you're moved to the editor lobby,
  chat says it's deleted, the map is gone from `games/<game>/maps/`, from its world's list in
  Select and from Recent. Try it on a draft first; a published map's removal is also committed and
  pushed.

Preview and the queue spawn, on a copy of Sumo's Arena:

- Spawn tool, Place into: Queue spawn, on a floor a little away from the arena. The marker reads
  "Queue spawn (lock in, 5 s)". Hit it and set Countdown to 8: the marker says 8 s.
- The map menu's play icon is faded while the checklist has problems. Tap it with the checklist
  done: about 30 seconds later you're moved to port 19133, and the box top center reads "Preview"
  and "Sumo: <map>".
- You start at the queue spawn, able to look around but not walk, with your body and name tag
  hidden. The countdown ("Spawning in") runs, then you're at a spawn, visible, for the usual 3-2-1
  and "Go!". The Preview box comes back after "Go!", never over the countdown.
- Fall off: the match ends and you're back in Edit, with chat saying how the preview ended.
- The Panel's End preview (on the Preview row) brings you back to Edit at once, and Select, if it
  was open, comes back on its world.
- With Lock in off (Free), you can walk around the queue area; falling below kill Y or leaving the
  bounds puts you back at the queue spawn.
- A map without a queue spawn previews with you waiting at a spawn.

Several bounds and the Boundaries view, on a copy of Sumo's Arena:

- The map menu's top row: the checklist pill, then Undo, Redo, an eye, the play icon and the gear,
  none cut off or overlapping.
- The eye opens Boundaries: Show all, then Bounds, and Kill Y or regions when the map has them. A
  boundary switched on stays shown with no tool in hand; switched off, it goes. Show all, then
  tapping Bounds, leaves the others on. Reopen the map (or boot again): your switches are as you
  left them.
- Region tool, Save as "Add to bounds (another box)" on an area beside the arena: Bounds and
  regions lists Bounds 1 and Bounds 2, Boundaries says 2 boxes, and `map.json` has
  `"bounds": [ ... ]` with both. Save as Bounds replaces them all with the one box, and Undo puts
  them back.
- Preview it: walking from one box into the other is fine, and stepping into the gap between them
  puts you out. Delete Bounds 2: `map.json` is back to one box, as an object.

The Camera tool, on a copy of Sumo's Arena:

- The tool grid's fourth tool is a camera. A use places Camera 1: a magenta marker "Camera 1, Map
  preview" at your eye height, its red line pointing where you looked. `map.json` has `cameras`.
- Hit it, Look through: your view jumps to the camera, with no HUD, hotbar, markers or outlines, and
  stays put as you move the mouse. Take a screenshot (Win+Alt+PrtScn), then right click: you're
  back and asked whether to use it. Use it: chat says it saved the map's preview, and
  `games/sumo/maps/<map>/preview.png` is 320x180 and shows the shot.
- Switch it to Game picture and Look through again: you're visible, so you can walk into the shot.
  Using it replaces `games/sumo/icon.png` (don't publish that unless you mean to).
- Aim from my view moves the marker to your eyes, and Delete removes it. The Panel's "Newest
  screenshot as: Map preview" does what the form does.

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
- Players, tap the guest, Remove: they're disconnected with "You're no longer invited to the map
  editor", and can't rejoin.
- With a second map editor (another LAN_PLAYERS account) in Edit, opening another map asks about
  them first; they wait in the editor lobby and come back with you.

## Block pack (Java mod)

The custom blocks mod in a 26.2 Fabric profile. Take the new mod jar from the private block-pack
project's `out/mods` folder and the new `minecade-showroom-java.zip` from `out`. Everything else
passed on 2026-10-31:

- Connected glass (framed glass and the windows, in the Connections area): a 3x3 wall or a stack
  looks like one sheet, with no faces between the blocks. The mod now skips them, as vanilla glass
  does. A small seam where three framed glass blocks meet in an inside corner is expected.
- Planters: right-click a planter's top with any flower. One-block flowers sit on it, and tall ones
  (sunflower, lilac, rose bush, peony, pitcher plant) stand two blocks high. Breaking the planter or
  either half takes the flower and drops it once (nothing in creative). The Connections area has a
  planter with every flower.

## Block pack (Bedrock)

Open the new `minecade-showroom.mcworld` from the private block-pack project's `out` folder.
Everything else passed on 2026-10-31. BDS already put flowers on planters from a simulated
player's clicks and broke them again, and every showroom block came through a Chunker conversion
and a map editor cut exactly. This needs a real client:

- Planters: right-click a planter's top with any flower. It stands there and looks like that flower
  does anywhere else, not thinner or darker. Tall flowers take two blocks. Blocks still go against
  a planter's sides without sneaking. The Connections area has a planter with every flower.

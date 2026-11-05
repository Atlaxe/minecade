# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a second player

- Team picks with real players: the team form and the hologram's team lists.

## Every server

- Command blocks don't run: in a world with command blocks (Select, Edit, a preview), nothing they
  do happens.

## One in the Quiver

With a second player (a preview with a guest, or the network once the map is published):

- After a published match, the stats screen's One in the Quiver tab shows Bow kills and Longest shot.
- Published: the game is in the lobby's game grid with the green QUIVER picture (a Game picture
  from the Camera tool replaces it).

Alone, in a preview with fake players:

- No "+1 arrow" line after a kill.
- A missed arrow stays where it lands, then disappears about 5 seconds after it stops (or as soon
  as someone walks within 2.5 blocks of it).

## Siege

Needs a map first: team spawns, bounds, a spectator or queue spawn, and some water. Alone, in a
preview with fake players to make up 4:

- The class form comes up before the countdown with all seven classes, each picture showing its
  gear (leather in your team's color). Pick one: its items are in your hotbar, the ability item in
  the last slot, and chat says what the ability does.
- Down everyone on the other team: your team takes the round, the circles top right color in, and
  after a short break the class form comes back. The match goes on to round 2.
- Pick a different class for round 2: chat tells you about the new one (not again about a class
  you've already played).
- Let a round run its 3 minutes: it goes to the team with more players standing, then the one with
  more health, else it's a draw.
- Names over heads show in team colors. Health doesn't come back on its own, and hunger stays full
  while sprinting.

Abilities (the item in the last hotbar slot):

- Any of them: the number over the hotbar counts down from its cooldown, with a chime when it's
  back to 0, and a low note if it's used too soon.
- Soldier, Rally: a horn sounds, and you and teammates within 8 blocks hit harder and run faster
  for 6 seconds.
- Archer, Volley: 5 arrows fly in a fan where you look. One that hits an enemy hurts them and
  counts as your hit (a kill is yours). Arrows that land disappear.
- Seaman: the trident has Loyalty and comes back after a throw; one thrown into the void is
  replaced within about 5 seconds. It can't be dropped. In water you're faster than on land and
  don't drown.
- Seaman, Tidal Wave: enemies within 6 blocks are pushed away, slowed, and lose a heart a second
  for 3 seconds, out of water too.
- Water: every other class loses a heart a second in it. Going down there with nobody to blame
  says "was washed away".
- Tank: slower than the rest. Fortify: for 6 seconds hits don't knock you back and do about half
  damage, with the hurt sound still playing.
- Medic, Heal: you and teammates within 8 blocks get 4 hearts back, with hearts floating up.
- Scout: faster than the rest. Leap throws you the way you look, and a long fall does no damage.
- Assassin, Vanish: invisible for 6 seconds, armor and name too. Hitting someone or being hit
  brings it all back at once; otherwise it comes back when the time is up.

Bridges, since its Leap and arrow countdown moved into core with Siege:

- The Leap and the arrow coming back (the number over the hotbar, the pop) work as before.

## Map editor
Several bounds and the Boundaries view, on a copy of Sumo's Arena:

- Region tool, Save as "Add to bounds (another box)" on an area beside the arena: Bounds and
  regions lists Bounds 1 and Bounds 2, Boundaries says 2 boxes, and `map.json` has
  `"bounds": [ ... ]` with both. Save as Bounds replaces them all with the one box, and Undo puts
  them back.
- Preview it: walking from one box into the other is fine, and stepping into the gap between them
  puts you out. Delete Bounds 2: `map.json` is back to one box, as an object.


Guests (needs a second account that isn't in LAN_PLAYERS):

- The Panel's Map editor page, Who can join: Add their gamertag. They're listed, with where they
  are once the editor runs. The in-game icon rows (editor lobby, Select's map menu, Edit's gear)
  have no Players icon, and the rest still line up.
- With the editor shut down, Add and Remove a guest: the list keeps the change, and the next boot
  lets them in.
- With nothing open on Select, the guest who joins port 19132 sees a dark screen saying it's
  waiting for Select or a preview, and no editor menu.
- Open a world in Select: the guest is moved there in creative with no tools, and can fly around
  but not break or place blocks. Edit (port 19134) refuses them.
- Start a preview from Edit: the guest waits in the editor lobby while Select closes, then you both
  go into the preview. When it ends, you're back in Edit and they're in the editor lobby, then on
  Select once it reopens.
- In a preview, the guest types `/exit`: only they go home to the editor lobby, and the preview
  goes on for you.
- On the Panel, Remove the guest while they're on: they're disconnected with "You're no longer a
  guest of the map editor", and can't rejoin.
- With a second map editor (another LAN_PLAYERS account) in Edit, opening another map asks about
  them first; they wait in the editor lobby and come back with you.

Friends tab in the map editor (first forward TCP 19135 on the router and widen the firewall rule to
TCP 19132-19135; a console friend on the guest list):

- Boot (or Restart) the editor with Friends tab on: the Map editor page's Friends tab row goes from
  Starting to "On. Friends who add (account) ...", with no sign-in asked if the network's sign-in
  carried over. The editor log says the same.
- The console friend sees "Minecade map editor" in their Friends tab, joins, and is moved to
  Select (or waits in the editor lobby until Select or a preview opens).
- A console friend not on the guest list is refused.
- Start a preview with the console guest in it: when it ends, they land back in the editor lobby
  (through 19135) instead of getting stuck.
- Open another world in Select while the console guest is on it: they wait in the editor lobby and
  come back to the new Select.
- Turn off, then Turn on, on the Map editor page while the editor runs: the bot stops and starts
  again, and the editor log says so. The Servers page's Friends tab row shows the same switch.

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

## Map store

The maps and the games' pictures moved out of git into C:\dev\minecade\maps (docs/maps.md, "The
map store"). Restart the Panel first, so it has the new code.

- Start the editor: the editor lobby lists all 14 maps, and only the three drafts (Bridges
  Thumbnail, Build Swap Thumbnail, Apocalypse) say Unpublished changes.
- Open a map, change a block, Save: the editor log says "Kept the map as version 2." (or the next
  number), and `npm run maps -- versions <target> <map>` lists it.
- Publish it: chat says it's published with its version, and nothing new shows in `git status` or
  `git log`.
- Build Swap's new picture (taken before the move) shows in the lobby once a Build Swap map is
  published again and the network restarts.
- Start the network from the Panel: the lobby lists every game's maps with their pictures, and the
  Panel's lobby map picker still offers spaceship.

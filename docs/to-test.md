# To test

Tests still to run by hand. Delete a line once it passes.

## Needs a second player

- Team picks with real players: the team form and the hologram's team lists.

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
  Scout: faster than the rest. Leap throws you the way you look, and a long fall does no damage.
- Assassin, Vanish: invisible for 6 seconds, armor and name too. Hitting someone or being hit
Bridges, since its Leap and arrow countdown moved into core with Siege:

- The Leap and the arrow coming back (the number over the hotbar, the pop) work as before.

## The arsenal

docs/ui.md, "The arsenal". Start the network from the Panel so it rebuilds, then play Probe alone
(`DEV_TEST_GAMES=1`, `DEV_MIN_PLAYERS=1`, Round 60 s) with the Gunner kit (the nine guns) or the
Grenadier kit (the rest). Probe hurts nobody: with a second player, each hit says in chat what it
would have taken.

- All 15 hotbar icons show their 3D models, like a wall or a banner does.
- Where each gun sits from the hip, aiming (right click) and in third person (first guesses: move
  them in Blockbench as before). Aiming the sniper hides it, so the zoom is the scope.
- Every gun fires on left click with a streak from the muzzle and a puff of dust where it hits a
  block. The SMG and Assault Rifle keep firing while the button is held; the Burst Rifle fires 3
  shots a click.
- Ammo shows top right and counts down each shot. An empty magazine plays the reload sound, says
  Reloading, and comes back full.
- The Rail Gun draws a cyan beam to the first block. With a second player in line, both are hit.
- The RPG's rocket flies straight, trails smoke, points the way it flies, and blasts where it hits.
- Frag Grenade: lands, flashes faster and faster, then blasts with a bang.
- Molotov: breaks where it hits and leaves flames on the ground for about 6 seconds.
- Flashbang: the screen goes white looking at it, less looking away, not at all behind a wall.
- Smoke Grenade: a thick cloud for about 10 seconds; standing inside it blinds you.
- Throwing Knife: tumbles in flight, floats where it lands, and walking over it gives it back.
- Stimpack: health comes back with green motes, and you run faster for a few seconds.
- The crossbow keeps 8 arrows above the hotbar, and arrows that land disappear.
- A row of the arsenal's models floats behind the row of paint guns.

## Gunfight

docs/ui.md, "Gunfight". It plays Siege's maps (Strife). Alone: restart the map editor (it has new
code), open Strife in Edit, Preview, pick **Play as: Gunfight** and 3 fake players.

- The Preview menu has Play as with Siege picked at first; picking Gunfight lets you add up to 7
  fake players, and the preview says Gunfight.
- Everyone spawns at their team's spawns with the same four items: a primary in slot 1, a
  secondary in 2, a grenade in 3, a Stimpack in 9, none of them movable, and team leather. Chat
  says the round's loadout.
- Guns fire only once the round starts (not in the countdown). Shooting a fake player takes health
  (more in the head), shot after shot, and you hear a hit, a higher one for a headshot, a chime
  for a down. Teammates take nothing.
- The ammo count is top right above the clock and the round circles, counting down each shot.
- Down the other team: your team takes the round, a circle colors in, and round 2 starts with a new
  primary and the teams at each other's spawns ("The teams have switched sides" in chat). Round 3
  goes back.
- A crossbow comes with arrows and kills in one hit; so does the netherite sword.
- Let a round run out (90 seconds): it goes to the team with more players standing, then more
  health.
- On the network (2 or more players): Gunfight is in the lobby's game grid with the stand-in
  picture, Strife is its map with Siege's preview, and a match plays there.

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


## Map viewer

docs/viewer.md. Restart the Panel first, so it has the new code.

With game Edit open on the same map (restart the map editor first, so it takes the viewer's
changes):

- The viewer's top bar says Open in game Edit. A spawn placed, moved or turned in the viewer moves
  in game at once, and Undo in the viewer undoes it in game too.
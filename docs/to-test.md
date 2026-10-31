# To test

Tests still to run by hand. Delete a line once it passes.

## Friends tab broadcast (Panel)

- Turn off stops it, and the row reads "Off". Turn on again: no new sign-in is asked for.

## Needs a second player

- Sumo feel test: about 10 minutes of real knockback.
- A real match is recorded and shows on the stats screens (demo stats are off).
- Team picks with real players: the team form and the hologram's team lists.
- Another player's skin shows in the stats screens after the next build.

## Map editor

First, once: close every Panel window, wait about 20 seconds, and open the Panel again (the running
one predates the map editor, so its editor buttons fail with "not found"). From then on the Panel
offers Restart Panel itself when its code changes.

Booting (the editor lobby, after the rework of 2026-10-31):

- The Map editor page says an older map editor is running: Restart the editor. It confirms that the
  network stops, then the old editor saves and stops, the network stops, and the new one boots.
- The page shows the join address on port 19132, and rows for the editor lobby, Select and Edit.
- Join `LAN_HOST:19132`: no trust prompt (the lobby's identity). It's black, you can't move or look
  around, there's no HUD, and the Map editor menu is open down the right side. If anything of the
  world shows, or the menu doesn't open, say so.
- Close the menu (Esc, or the X): it opens again at once. Open the pause menu and close it: the
  menu comes back.
- Open a map, Sumo, Arena: the menu says "Loading Sumo: Arena (arena_1)...", and after about 20
  seconds you're moved to Edit on port 19134 (no trust prompt), where everything below works.
- In Edit, rejoining (leave and join 19132 again, then Go to Edit) makes you an operator again with
  no "Could not op" lines in the editor's log.
- The gear: Editor lobby. You're back in the dark menu, which now lists Edit (Arena, with you gone
  from its players) under Open now, and Arena under Recent if you open something else.
- New map: the list shows your worlds by name, "Datapacking (imported)" among them, and Empty world
  last. Pick Datapacking: you're moved to Select on port 19133 (no trust prompt) once the copy is
  up. Edit stays open meanwhile (the Panel shows both).
- Empty world: Sumo, a name, an empty id. Edit switches to it (a glass pad in the void); a second
  player in Edit at that moment is asked about first, waits in the lobby, and comes back with you.
- Shut down on the Panel: everyone is disconnected, all three servers go, the page offers Start the
  network, and that brings the lobby back.
- `npm run editor -- status` while it runs lists the three servers.

On Sumo's `arena_1` in Edit:

- The map menu down the right side: "Map menu" and the X, a row of icons (the checklist pill with a
  check and "1/1", Undo, Redo, a gear), the tool icons, the settings, and a green Save bar at the
  bottom that stays put while the settings scroll. The checklist and a marker's form are still dark
  side menus that scroll.
- Pointing at a quick icon or a tool shows its name in a tooltip box. If none shows, say so.
- The pill shows only its count; its tooltip says "Checklist: ready" or the problems. Tap it: the
  checklist, with Publish at the bottom.
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
- Publish (after the editor's next boot; it really commits and pushes, so use a map you mean to
  publish): on a draft with a done checklist, the pill's tooltip says "Checklist: ready to publish",
  and the checklist's last button reads "Publish / put it in the lobby: commit and push". With
  problems, it says "finish the checklist first", and tapping it lists them.
- Tap Publish: a "Publish?" side menu says what happens; Cancel does nothing. Publish: chat says
  it's publishing, the markers blink while the world saves, then a chime, "<map> is published" above
  the hotbar, and chat gives the commit. The map menu's top line no longer says "draft".
- On GitHub, the newest commit is "Automated Map Build : Sumo <map> <date> <time>" (your time) and
  holds only that map's folder. Other uncommitted changes in the checkout are still uncommitted.
- Publish again: the button now reads "Publish changes"; with nothing changed, chat says the map has
  no changes since it was last published.
- The Panel: the Edit row has Publish beside Save (grayed while the checklist has problems). It
  asks first, then reads "Publishing..." while it runs.
- Shut down, then Start the network: the map is in Sumo's map list on the lobby terminal.
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

The mode box (top center, after the editor's next boot):

- In Select: a small dark box top center reads "Select" (aqua) and the world's name (gray), styled
  like a game's clock box. It stays up the whole time, through forms and after respawning.
- In Edit: "Edit" (green) and "Sumo: Arena" for a map editor; a builder sees "Build" (yellow).
- No big title flashes in the middle of the screen when you arrive on a server. If the mode shows
  as a big title in the middle instead of the box, say so.
- The editor lobby shows no box (its HUD is hidden).

Select mode (pass 10.5), opened from the editor lobby's New map:

- On Datapacking you get the Select tool in slot 1 and the map menu in slot 9, and the world is the
  one you converted (flying past its edge grows nothing).
- Box a build: hit a block, use the tool on the far corners. The line above the hotbar shows the
  size and what a hit and a use do; the yellow outline follows.
- Stand inside the box, use the tool at the sky, Save as map: for Sumo, a name, and an empty map id
  (it's made from the name). Chat says it's queued; the box turns white, then green when ready (about
  20 seconds), and chat says so. Standing outside the box is refused.
- When it's ready: a chime, and "<name> is ready to load in Edit" in green above the hotbar for about
  6 seconds, even while you hold the Select tool (its hint comes back after). Hitting a block meanwhile
  replaces it at once. Chat says to use Edit <map> in the map menu.
- Save another map, and before it's ready, go to Edit (Edit <map> on the first one): the same notice
  and chime come in Edit, and chat says to open it from the editor lobby.
- Box a second build while the first is being cut out: both end up ready.
- The map menu lists both with their status (so does the Panel). On a ready one: Edit <map>. Chat
  says it's opening; you're moved to Edit once it's ready, at the spawn where you stood, centered at
  x 0, z 0, with nothing from the neighboring builds.
- In Edit, the gear: Back to Select. You're back in Select at once (it kept running), and the list
  still has both maps.
- Select's map menu: Editor lobby, then New map and another world: Select switches to it.
- Update from this world (red, with a confirm) on a ready map: its blocks are redone, its spawns and
  map.json stay.
- `git status` shows the new maps (`games/sumo/maps/<id>/`) and nothing else; delete the ones you
  don't keep.

## Needs a second player (map editor)

- A gamertag in `EDITOR_ALLOW_LIST` but not `MAP_EDITORS` joins as a builder: the editor lobby says
  to wait for a map editor, and they're moved to Edit (creative, no tools) once a map is open there.
- A gamertag in neither list is refused.

## Block pack (Java mod)

The custom blocks mod (built from the private block-pack project) in a 26.2 Fabric profile, in the
Minecade Showroom world. The headless server already checked every state change and click; these
need a real client:

- Sitting: right-click a stool, you sit on it; sneak to get up. If you sit too high or sink into it,
  say so.
- Connected textures: the 3x3 walls in the Connections area (framed glass, windows, their panes,
  layered stone) and the pillars join with no lines inside. A small seam where three framed glass
  blocks meet in an inside corner is expected.
- Globes: the globe sits on the stand's arm, tilted with it; right-click turns it a quarter.
- Chests: the latch shows on every wood, including acacia, birch, cherry, crimson and warped.
- Flags show a cloth of their dye color, pointing the way they face.
- Jars: water and the 16 dye colors show as a liquid inside the glass.
- Hitboxes: paper lanterns and stools are outlined around the model, not a full block.
- Placing: a sconce goes on the floor or a wall depending on where you click, like a torch;
  buntings go on a ceiling or a wall. A candle holder held against one adds a candle.

## Block pack (Bedrock)

Open `minecade-showroom.mcworld` (from the private block-pack project's `out` folder) on a Bedrock
device; it brings the blocks pack with it. BDS already loaded the pack with no errors, placed every
block, gave every chest its storage and checked the connection rules. A probe world also checked
collision (items dropped on doors, ladders, wicker fences, stairs, slabs, posts, gates and flags
land where Java's shapes say), right-clicks (book piles, jars, candle holders, sconces, awnings,
globes, flower boxes, stools) and placing doors, ladders, panes and posts from their items. These
need a real client:

- Looks: every block looks like its Java version in the Java showroom: textures, shapes, which way
  it faces. If any block faces the opposite way or is mirrored, say which.
- The Connections area at the end draws everything, including the planter, the tatami pair, the
  blackstone furnace on soul sand and the double chest next to the cooking pot and skillet. Canvas
  rugs, cooking pots and skillets show, with no geometry errors in the content log.
- Collision matches what you see: doors (open and closed), ladders, fences, wicker fences (a lone
  one is a thin post) and posts lying on their side. A flag only stops you at its pole.
- Climbing: walk into a ladder or a rope to climb it; stop and you slide down slowly.
- No flickering faces on paper lanterns, awnings or glass. After right-clicking an awning, its top
  stripes still run the same way as before.
- Glass: in a wall of framed glass or windows you don't see the faces between the blocks.
- Chests: right-click opens one from any side; the lid opens while it's open, with chest sounds.
  Hitting it breaks it and drops what was inside. Each half of a double chest has its own 27 slots.
- Sitting: the hotbar hint reads "Sneak or jump to get up", and jumping gets you up.
- Creative menu: Construction has a group per family (copper tiles, food crates and so on) holding
  its stairs, slabs and walls. Doors, panes, bars, ladders and gates show flat icons; walls, fences
  and posts show their sides, not a bare post.
- Flower boxes: right-click with a flower or a fern adds up to three of one kind; an empty hand
  takes one out. Book piles go 1, 2, 3, 4 books and back to 1 on each right-click.
- Placing: stairs and slabs take the half you click; a sconce goes on a wall when you click a wall.

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

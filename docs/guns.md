# The guns

Every gun, grenade, knife and stimpack lives in one shared pack, `packs/guns`, and the build adds it
to every server: the lobby, every game and the map editor. So any game can hand them out as kit
items, and mannequins can hold them in the editor. There are two families:

- **Paintball's guns:** the pistol, rifle, shotgun and paint grenade, each in all 16 paint colors.
  Their balls fly and splash paint.
- **The arsenal:** real guns (hitscan bullets, a beam, a rocket), grenades, a throwing knife and a
  stimpack, one item each. Gunfight uses them, and Gun Game will.

Almost every file in the pack is drawn by a generator (`tools/assets/guns.ts`) from lists of boxes
and the numbers in `packages/guns/src/defs.ts`. Only two kinds of file are edited by hand: the
manifests, and `guns_hold.animation.json` (where each gun sits in the hand).

## Where everything is

| Path | What it is | Who writes it |
|---|---|---|
| `packages/guns/src/defs.ts` | Every gun's name and numbers: fire mode, fire rate, spread, zoom, speed, range, damage, magazine, sound, recoil. The generator and the games read the same file. | By hand |
| `packages/guns/src/guns.ts` | `Guns`: firing, aiming, the view kick, ammo, balls, bullets, beams, rockets, thrown items. | By hand |
| `packages/guns/src/arsenal.ts` | `Arsenal`: what the arsenal does to players (damage, blasts, flames, flashes, smoke, knives, the stimpack). | By hand |
| `tools/assets/guns.ts` | The generator: every model's boxes, colors, first hold guesses, particles, and all the pack's files. | By hand |
| `packs/guns/behavior_pack/items/` | One item per gun (per paint color for Paintball's), plus the hidden aim marker. | Generated |
| `packs/guns/behavior_pack/blocks/` | A hidden block per item whose model the hotbar shows as the item's icon. | Generated |
| `packs/guns/behavior_pack/entities/` | Balls, the rocket, thrown and landed grenades, pickups. | Generated |
| `packs/guns/resource_pack/models/entity/guns.geo.json` | Every model's geometry, three per model: held, display (pickups and thrown items) and icon. | Generated |
| `packs/guns/resource_pack/textures/minecade/guns/` | The models' textures, ball sprites, the splash and puff. | Generated |
| `packs/guns/resource_pack/attachables/` | How each item is drawn in the hand: model, texture, and which animations play. | Generated |
| `packs/guns/resource_pack/animations/guns.animation.json` | Recoil, the pickups' float, the paint grenade's tumble and swell, the rocket's flight. | Generated |
| `packs/guns/resource_pack/animation_controllers/guns.animation_controllers.json` | The aiming guns' hold controllers: hip pose or aim pose, eased between. | Generated |
| `packs/guns/resource_pack/animations/guns_hold.animation.json` | Where each gun sits in the hand: hip, aim and third person poses. | **By hand** (Blockbench) |
| `packs/guns/resource_pack/particles/` | The paint splash and the arsenal's streaks, beam, blasts, flames, smoke and glow. | Generated |
| `packs/guns/icons/` | 128x128 pictures of each item for the lobby's kit pictures (not in either pack). | Generated |
| `packs/guns/*/manifest.json` | The two packs' manifests. | By hand |

After changing `defs.ts` or `tools/assets/guns.ts`, rerun the generator and commit what it writes:

    npx tsx tools/assets/guns.ts

`tools/build/test/guns-pack.test.ts` fails if the committed files don't match what the generator
writes, so a generated file edited by hand is caught by `npm run check`.

## Every gun

### Paintball's guns

Item ids carry the paint color: `minecade:<dye>_paintball_pistol`, `_paintball_rifle`,
`_paintball_shotgun` and `minecade:<dye>_paint_grenade` (`gunItem(kind, dye)` in `defs.ts`). A kit
asks for the team's color with `teamGunItem(kind)`. White is the pickups' look.

| Gun | Fires (left click) | Every (ticks) | Balls | Spread | Range | Sound |
|---|---|---|---|---|---|---|
| Paintball Pistol | One shot a click | 6 | 1 | 2.5 degrees | 2 s of flight | `mob.llama.spit`, high |
| Paintball Rifle | Again and again while held | 4 | 1 | 5 degrees | 2 s of flight | `mob.llama.spit`, higher |
| Paintball Shotgun | One spray a click | 20 | 6 | 12 degrees | Half a second of flight; at most 2 of a spray count on one target | `mob.llama.spit`, low |
| Paint Grenade | Thrown with either click, used up | 10 | | | 10 s | Lands, swells for a second, bursts |

Paintball's guns have no magazine (they never run dry) and don't aim (see "Aiming").

### The arsenal

One item each: `minecade:<id>` (`arsenalItem(id)`). The real pistol, rifle and shotgun are
Paintball's models without the paint hopper. Only the Sniper Rifle, Rail Gun and RPG aim (see
"Aiming"); the others fire from the hip.

| Item | Id | Fires | Every (ticks) | Damage body / head (20 is full health) | Magazine, reload | Notes |
|---|---|---|---|---|---|---|
| Pistol | `handgun` | tap | 5 | 5 / 8 | 12, 1.5 s | falls to 60% from 25 to 60 blocks |
| SMG | `smg` | hold | 2 | 3 / 4 | 32, 1.75 s | 45 block reach, falls to half from 15 to 35 |
| Assault Rifle | `assault_rifle` | hold | 3 | 4 / 6 | 30, 2 s | 90 block reach |
| Burst Rifle | `burst_rifle` | tap: 3 shots 2 ticks apart | 12 | 5 / 8 | 24, 2 s | 90 block reach |
| Pump Shotgun | `pump_shotgun` | tap: 6 pellets | 18 | 3.5 / 4 each | 6, 3 s | 18 block reach |
| Double Barrel | `double_barrel` | tap: 8 pellets | 6 | 2.5 / 3 each | 2, 2 s | 14 block reach, wide |
| Sniper Rifle | `sniper_rifle` | tap | 30 | 17 / 40 | 5, 2.5 s | aims (zoom 30, the most Bedrock allows; dead on); 10 degrees off from the hip; aiming hides the model (the zoom is the scope) |
| Rail Gun | `rail_gun` | tap: a beam | 40 | 20 | 4, 3 s | aims (zoom 40, dead on); goes through every player in line |
| RPG | `rpg` | tap: a rocket | 20 | 20 direct, up to 14 in 4 blocks | 1, 3 s | aims (zoom 55); the shooter takes half its blast |
| Frag Grenade | `frag_grenade` | thrown, lands, 1.5 s fuse | 10 | up to 18 in 5 blocks | | |
| Molotov | `molotov` | thrown, breaks where it hits | 10 | 1 every half second in 3 blocks, 6 s | | flames are particles, never fire blocks |
| Flashbang | `flashbang` | thrown, lands, 0.6 s fuse | 10 | | | whites out screens up to 3 s |
| Smoke Grenade | `smoke_grenade` | thrown, lands, 0.5 s fuse | 10 | | | a cloud of 4 blocks for 10 s |
| Throwing Knife | `throwing_knife` | thrown | 10 | kills | | floats where it stops until someone takes it |
| Stimpack | `stimpack` | either click | 20 | 8 health back, Speed I 4 s | | |

### The files each item has

Taking the red Paintball Pistol and the arsenal's Pistol as examples (Paintball's have one of each
per paint color, the arsenal's one each):

| File | Red Paintball Pistol | Pistol (arsenal) |
|---|---|---|
| Item | `behavior_pack/items/red_paintball_pistol.json` | `behavior_pack/items/handgun.json` |
| Icon block | `behavior_pack/blocks/red_paintball_pistol_model.json` | `behavior_pack/blocks/handgun_model.json` |
| Held model (attachable) | `resource_pack/attachables/red_paintball_pistol.json` | `resource_pack/attachables/handgun.json` |
| Geometry (in `guns.geo.json`) | `geometry.minecade.gun_pistol` (held), `_display`, `_icon` | `geometry.minecade.gun_handgun`, `_display`, `_icon` |
| Texture | `resource_pack/textures/minecade/guns/pistol/red.png` (64x32) | `resource_pack/textures/minecade/guns/arsenal/handgun.png` |
| Hold poses | `animation.minecade.gun_pistol.first_person_hip`, `.third_person` | `animation.minecade.gun_handgun.first_person_hip`, `.third_person` (and `.first_person_aim` for the Sniper Rifle, Rail Gun and RPG) |
| Recoil | `animation.minecade.gun_pistol.recoil` | `animation.minecade.gun_handgun.recoil` |
| Its own cooldown (fire rate, times the recoil) | `minecade_pistol` | `minecade_handgun` |
| Kit picture icon | `icons/red_paintball_pistol.png` | `icons/handgun.png` |

The paint grenade and the arsenal's throwables and stimpack have the same files except the aim
pose, the recoil and the cooldown. The rocket has its own geometry (`geometry.minecade.rocket`)
and texture (`arsenal/rocket.png`).

## How they work in game

- **Controls:** left click fires. A held attack button reaches a script only as repeated swings,
  which come in bursts in the air, so a held gun (the Paintball Rifle, SMG, Assault Rifle) keeps
  firing for its `triggerTicks` (10) after each swing, bridging the gaps; Probe says in chat, when
  you let go, how far apart the swings came, to tune it. Only the Sniper Rifle, Rail Gun and RPG aim
  (see "Aiming"): a right click raises one and the next lowers it; the camera zooms to its field of
  view, its shots stray less, and the held model comes up. Switching slots lowers it. A right click
  with any other gun does nothing. A gun's left click swing is kept to 0.05 s so a shot barely moves
  the hand.
- **Hotbar:** each shot (a burst's first) starts the gun's own cooldown (`minecade_<gun>`, its fire
  rate) with the player's `startItemCooldown`, and Minecraft shades it over the slot until the gun
  can fire again. While it shades, a right click can't raise or lower the gun (a cooling item can't
  be used). The icon is the model itself, drawn by
  the game the way it draws a wall or a banner: each item places a hidden block holding the model
  (`minecade:<item>_model`, placeable only on itself, so never placed).
- **Held models:** each gun is a 3D model (an attachable) with one bone, `gun`, bound to the hand
  and holding every box; the hold poses and the recoil both move it. (They used to have a child
  bone, `body`, holding the boxes, and a pose on the bound bone never moved it: seen in game on
  2026-11-08, which is why no hold pose ever showed.) A gun that aims has a hold
  controller with two states, its hip pose and its aim pose, and eases from one to the other in a
  fifth of a second as the aim marker (`minecade:aim_marker`) comes into the player's off hand and
  goes: Guns puts it there while they aim, and the controller reads it with
  `q.is_item_name_any('slot.weapon.offhand', 0, 'minecade:aim_marker')`. The held models use no
  variables at all: their animations look variables up on the player holding them, so a variable
  their own scripts set is unknown to them (the client logs "unknown variable"). The
  marker's icon and its model in a hand are blank, so the off hand shows nothing. Something else of
  the player's in the off hand is left alone (the model then stays lowered).
- **Recoil:** each shot kicks the held model back and tips its muzzle up, easing home just as the gun
  can fire again, and turns the shooter's view up and a little to one side, where it stays until the
  player pulls it back down. Both are smaller while aiming a gun that aims. See "Recoil" under
  Editing.
- **Ammo:** a gun with a magazine fires it, then reloads by itself when it's empty (crossbow loading
  sounds). Spare rounds never run out. The game shows `ammoText` or `Arsenal.ammoLine` on the HUD.
- **Balls** fly as `minecade:paintball`, a sprite like the snowball's, in one of 16 paint colors (the
  `minecade:color` property). Where a ball lands, the game decides what happens; `paintSplash` throws
  the splash particle in its color.
- **Paint grenades:** a thrown grenade (`minecade:paint_grenade_thrown`) that hits something becomes
  `minecade:paint_grenade_primed`: it falls to the ground, swells to nearly twice its size and
  flashes white for its 1 second fuse, then bursts.
- **Bullets are hitscan:** a ray from the eyes finds the first block in the gun's reach, then the
  nearest player before it, who takes the hit at once. A hit at or above 0.32 blocks under the
  target's eyes is a headshot. A beam goes on through every player to the block. Each shot draws a
  streak from the muzzle (`minecade:bullet_streak`, the beam's `minecade:rail_beam`), a hit throws
  red sparks, and a miss puffs dust where it lands.
- **Damage** comes straight off health (no armor, no hurt cooldown), so a fast gun's every bullet
  counts. The shooter hears a hit, a headshot (higher) and a down (a chime) apart.
- **The rocket** flies straight at its speed, trailing smoke, and a direct hit takes its damage before
  the blast.
- **Blasts** (the frag, the rocket) hurt everyone in their radius, falling off evenly to nothing at
  the edge, a quarter through cover, and throw them out from the middle. No blocks break.
- **Flashes** white out players who can see the flashbang: full close up and looking at it, a third
  looking away, nothing at 20 blocks or through a wall. The thrower too.
- **Smoke** is a cloud of particles; anyone standing in it is blinded while they stay.
- **Knives** kill whoever they hit and float (`minecade:arsenal_pickup`) where they came to rest for
  the first fighting player to walk over.
- **Vanilla one-hits:** `arsenal.vanillaDamage(hit)` makes a crossbow's arrow and a netherite
  sword's hit kill outright. Crossbow carriers are kept at 8 arrows, and arrows that land are taken
  away.
- **Pickups:** `minecade:gun_pickup` floats, spins and bobs a white Paintball gun or grenade (the
  `minecade:kind` property); `minecade:arsenal_pickup` does the same for any arsenal model (the
  `minecade:model` property, an index into `ARSENAL_MODELS`). Thrown arsenal items fly as
  `minecade:arsenal_thrown` and landed grenades sit as `minecade:arsenal_primed`.

A game fires Paintball's guns with `Guns` (Paintball's own script) and the arsenal with `Arsenal`,
giving it a host:

```ts
const arsenal = new Arsenal(this.scope, {
  canFire: (player) => this.roster.get(player.name)?.state === "alive",
  targets: () => /* every fighting participant's body */,
  nameOf: (entity) => /* a participant's name, or undefined */,
  hurt: (victim, attacker, amount, cause) => this.combat.hit(victim, attacker, amount, cause, { direct: true }),
}, { onAmmo: (player) => this.refreshHud(player.name) });
```

and calls `arsenal.vanillaDamage(hit)` from `onDamage`, `arsenal.forget(name)` when a player goes
down, `arsenal.refill(name)` on a respawn or a new round, and shows `arsenal.ammoLine(player)` from
`hud()`. Probe's Painter, Gunner and Grenadier kits carry every gun, grenade and knife (its hits only
say in chat what they would have taken), with every model floating in two rows in front of the
first player.

## Aiming

Only the Sniper Rifle, Rail Gun and RPG aim, with a right click toggle. The other guns used to aim
too, but Bedrock doesn't let a script read a held button together with another one: while right
click is held, no left click reaches the script at all (so "hold right click to aim, left click to
shoot" can't work), and a held left click only arrives as bursts of swings. So for now they fire
from the hip only, and their aim poses are gone from the hold file.

**Bring aiming back** when Bedrock lets a script read held buttons (a hold-to-aim that still lets
the player shoot, with the shot's accuracy telling hip fire from aimed fire). For a gun:

1. In `defs.ts`, give it an `aimFov` (the camera's zoom) and an `aimSpreadDegrees` (its aimed
   spread, under its `hipSpreadDegrees`). `canAim` then says yes, Guns raises it on a right click,
   and its kick is `AIM_RECOIL` of the hip one while it's up.
2. In `tools/assets/guns.ts`, give its `HOLD` entry an `aim` place (`under`, `depth`).
3. Rerun the generator: its attachable gets the aim blend, and the hold file gets a first guess
   for its `first_person_aim` pose at the end.
4. Change the controls in `Guns` (`rightClick`, `aim`, `stopAiming`) if the new input calls for it,
   and the docs here.

## Editing

### Numbers: fire rate, spread, zoom, damage, ammo, sounds

All in `packages/guns/src/defs.ts`: `GUNS` and `GRENADE` for Paintball's, `ARSENAL_GUN_DEFS`,
`ARSENAL_THROWABLE_DEFS`, `STIM`, `BLASTS`, `FIRE`, `FLASH` and `SMOKE` for the arsenal. Rerun the
generator afterward: an item's cooldown (its fire rate, shaded over the slot) is written into its
item file.

### Models: the boxes

Each model is a list of boxes in `tools/assets/guns.ts`: `MODELS` for Paintball's, `ARSENAL_BOXES`
for the arsenal's, `ROCKET_BOXES` for the rocket. A box is `box([x, y, z], [width, height, depth],
color)` in pixels (16 to a block). Models face north (-z), top up, with the top of the grip at the
origin: the grip runs down from it and the barrel points north.

Rerun the generator and it redraws everything from the boxes: the three geometries, the textures,
the icon blocks (shrunk to fit 30 pixels where needed) and the kit picture icons. Don't edit
`guns.geo.json` in Blockbench and save it: the next run overwrites it, and the test fails until then.
To look at a model in Blockbench, open `guns.geo.json` (File > Open Model), pick the geometry, and
drag in its texture.

### Colors and textures

The textures are drawn, not painted. Each box has a color name from `PALETTE` at the top of
`tools/assets/guns.ts` (`body`, `metal`, `grip`, `tank`, `wood`, `accent`, `steel`, `olive`,
`glass`, `cloth`, `flame`, `glow`, `dose`, `white`, `blade`), or `paint`, which takes the item's
paint color (`PAINT_RGB` in `defs.ts`, each dye as its concrete looks). The generator lays each box
out in box UV (64 pixels wide) and shades it: lit tops, darker bottoms and sides, a darker rim on
each face, and a little grain.

So to change a look:

- **One part of one model:** give its box another color name.
- **A color everywhere it's used:** change its hex value in `PALETTE`.
- **A new color:** add it to `PALETTE`, then use its name on boxes.
- **The paint colors:** `PAINT_RGB` in `defs.ts` (the balls, splashes and painted blocks follow).

A texture painted by hand is overwritten on the next run, and the test fails until then. Painted
textures would need the generator to keep them (as it keeps the hold file) and to draw the kit
icons from them; it doesn't yet.

### Where a gun sits in the hand

The poses are in `packs/guns/resource_pack/animations/guns_hold.animation.json`, the one generated
file the generator leaves alone (it writes it only when it's missing, from a solver's first guesses:
delete it and rerun to start over). Each gun has three animations, each a single pose of the `gun`
bone: `animation.minecade.gun_<model>.first_person_hip` and `.third_person`, and
`.first_person_aim` for the guns that aim (the Sniper Rifle, Rail Gun and RPG). To change one in Blockbench (5.1 or later, which
previews attachables):

1. File > Open Model: `packs/guns/resource_pack/models/entity/guns.geo.json`, and pick the held
   model, `geometry.minecade.gun_<model>` (not `_display` or `_icon`).
2. Drag in its texture, such as `packs/guns/resource_pack/textures/minecade/guns/pistol/red.png`
   or `.../guns/arsenal/handgun.png`.
3. In the Animate tab, import `guns_hold.animation.json` (the Animations panel's import button).
4. In the Animate tab's toolbar, set the **Bedrock Animation Mode** dropdown to match the pose:
   **Item 1st Person** for `first_person_hip` and `first_person_aim` (the camera's view, with a
   crosshair), **Item 3rd Person** for `third_person` (a reference player holding the gun). A pose
   looks wrong in the other mode.
5. In the Animations panel, click the pose's animation (`animation.minecade.gun_<model>.<pose>`) so
   it's the one playing. In the Outliner, select the `gun` bone, and move, turn or scale it in the
   view (or type the numbers in its keyframe at time 0).
6. Save the animation file only: right-click the animation in the Animations panel and pick Save.
   Not File > Save Model, which also overwrites `guns.geo.json` (the generator owns it, and
   `guns.animation.json`).

Keep to the `gun` bone (the only one) and keep the animation names.
Blockbench's preview is approximate, so check in game. `npm run check` confirms every pose the guns
name is still in the file.

When a new model comes, the generator adds the solver's first guess for each of its poses at the end
of the file, in the file's own layout and line endings, and changes nothing already there.

A gun's origin (the top of its grip) sits 24 pixels under the hand when it has no pose, as
Blockbench's preview has it: seen in game with Probe's Holds kit (docs/spike-results.md, "Holding in
third person"). So a pose lifts it about 24 pixels back up to the hand, and Blockbench's preview
should match the game.

### Recoil

Each gun's recoil is its `recoil` in `defs.ts` (`GUNS` and `ARSENAL_GUN_DEFS`), four numbers:

| Number | What it does |
|---|---|
| `back` | Pixels the held model moves back toward you. |
| `lift` | Degrees the held model's muzzle tips up. |
| `pitch` | Degrees your view turns up. |
| `yaw` | Your view also turns up to this many degrees left or right, at random. |

| Gun | back | lift | pitch | yaw |
|---|---|---|---|---|
| Paintball Pistol | 2 | 12 | 1.5 | 0.5 |
| Paintball Rifle | 1.2 | 5 | 0.8 | 0.5 |
| Paintball Shotgun | 3 | 20 | 4 | 1.5 |
| Pistol | 2 | 12 | 2 | 0.6 |
| SMG | 0.8 | 4 | 0.7 | 0.6 |
| Assault Rifle | 1.2 | 5 | 1 | 0.5 |
| Burst Rifle | 2 | 10 | 1.2 | 0.5 |
| Pump Shotgun | 3.5 | 24 | 5 | 1.5 |
| Double Barrel | 3.5 | 26 | 6 | 2 |
| Sniper Rifle | 4 | 28 | 8 | 1 |
| Rail Gun | 3 | 18 | 5 | 0.5 |
| RPG | 4 | 12 | 4 | 0.5 |

While aiming (the guns that aim), both kicks are `AIM_RECOIL` (0.6) of these.

**The held model's kick** runs off the gun's own cooldown, its fire rate: the attachable reads
`q.cooldown_time_remaining('slot.weapon.mainhand')`, the item in your hand. The kick rises in about
0.04 seconds, then eases home (fast at first, slower at the end) and is back at rest just as the gun
can fire again. So a pistol kicks and settles in a quarter second, the SMG shivers every tenth of a
second, and the sniper rifle settles over its whole second and a half. The burst rifle kicks once a
burst. The animations (`animation.minecade.gun_<gun>.recoil`, in `guns.animation.json`) move the
`gun` bone on top of its hold pose by the kick, 0 to 1, written out in full in each channel (no
variables, see "Held models"): the muzzle tips up about the grip, and the gun goes back along its
barrel, which way that is coming from the generator's own pose for each view (so a hold pose turned
far from it kicks a little off line). Change the numbers in `defs.ts` and rerun the generator. The shape of the kick is the
Molang from `kickMolang` in `tools/assets/guns.ts` (`kickHeight` beside it works it out the same
way, for the tests).

**The view kick** is the script's (`Guns.kickView`). A script can't turn a player's view by itself
(Bedrock's `setRotation` is reported to do nothing to a player), so it teleports you to where you
stand with the new facing. That has two costs, so:

- It only happens while you're on the ground. Bedrock refuses to keep a player's speed through a
  teleport, so in the air it would cut a jump short.
- It happens at most once every 4 ticks (`VIEW_KICK_GAP_TICKS`), the kicks of a fast gun's shots in
  between adding up, because each teleport stops your stride for a moment.

The kick stays where it put your view: holding down an automatic gun climbs, and you pull it back
down. Only the script reads `pitch` and `yaw`, so changing them needs no rerun of the generator
(still a restart, as for any change).

### Particles

The arsenal's particles are written by `arsenalParticles()` in `tools/assets/guns.ts`, all from one
soft puff texture (`textures/minecade/guns/puff.png`); the paint splash by `splashParticle()`. Their
ids are `PARTICLES` and `PAINT_SPLASH` in `defs.ts`.

### Adding a gun

1. In `defs.ts`, add its id to `ARSENAL_GUNS` and its numbers, recoil included, to
   `ARSENAL_GUN_DEFS`.
2. In `tools/assets/guns.ts`, add its boxes to `ARSENAL_BOXES` and its first hold guesses to `HOLD`.
3. Rerun the generator. It writes the item, icon block, attachable (with its recoil), texture and kit
   icon, and appends first guesses for its three poses to the hold file.
4. Hand it out with `arsenalItem("<id>")` in a kit. `Arsenal` fires every gun in `ARSENAL_GUN_DEFS`.
5. Run `npm run check`, and set its poses in Blockbench.

## Seeing a change in game

The editor builds its packs from the checkout it starts from when it boots (the main checkout, for
the Panel), and the network rebuilds when it starts from the Panel. So after a change is in the main
checkout, restart the map editor (Servers page, Restart) or start the network again, then rejoin:
the packs are versioned by their content, so your client downloads the new ones.

To try the guns alone, open Probe's map in Edit, Preview, and pick the Painter (Paintball's guns),
Gunner (the arsenal's nine guns) or Grenadier (grenades, knife, stimpack, crossbow and sword) kit.
The aim pose and the recoil only show where a game runs the guns (a preview or a match); in Edit
itself, a mannequin can hold any gun in Probe's kits (Mannequin tool, Hold) to show the third person
pose.

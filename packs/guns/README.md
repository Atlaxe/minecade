# Shared guns pack

Guns any game can hand out: Paintball's pistol, rifle, shotgun and paint grenade in each of the 16
paint colors, and the arsenal (real guns, grenades, a throwing knife and a stimpack, one item
each), held as 3D models that aim and kick back as they fire; the paint balls and the rocket they
fire, the grenades and knife in flight and once they land, pickups that float a gun or grenade over
a map spot, and the particles (the paint splash, and the arsenal's streaks, beams, blasts, flames
and smoke). The build adds this pack to every server (the lobby, every game and the map
editor), the same way it adds the core resource pack and `packs/blocks`, so any game can give the
guns as kit items and mannequins can hold them in the editor.

- `behavior_pack/`: the items (and the hidden markers whose cooldowns time the recoil and the aim),
  the hidden blocks whose models the hotbar shows as the items' icons, and the ball, grenade and
  pickup entities.
- `resource_pack/`: the held models (attachables), their animations, textures per paint color, the
  ball sprites and the splash particle.
- `icons/`: the kit pictures' icons (the build reads them; they aren't in either pack).

Unlike `packs/blocks`, this pack is committed: everything in it is drawn by
`tools/assets/guns.ts` from the boxes listed there and the names and numbers in
`packages/guns/src/defs.ts`. Change those, then rerun it and commit what it writes:

    npx tsx tools/assets/guns.ts

A test checks the committed files match (`tools/build/test/guns-pack.test.ts`). The manifests and
`resource_pack/animations/guns_hold.animation.json` (where the guns sit in the hand, edited in
Blockbench: docs/ui.md, "Editing where the guns sit") are the only hand-written files; the
generator only adds a new model's poses to the end of the hold file, leaving the rest as it is. A
game fires the guns with `Guns` from `@minecade/guns` (`packages/guns`), and the arsenal's with
`Arsenal`; see docs/ui.md, "The guns" and "The arsenal".

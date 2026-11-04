# Shared guns pack

Guns any game can hand out: the pistol, rifle, shotgun and paint grenade, held as 3D models that
kick back as they fire, the paint balls they fire (16 colors), a pickup that floats a gun or grenade
over a map spot, and a paint splash particle. The build adds this pack to every server (the lobby,
every game and the map editor), the same way it adds the core resource pack and `packs/blocks`, so
any game can give the guns as kit items and mannequins can hold them in the editor.

- `behavior_pack/`: the items and the ball, thrown grenade and pickup entities.
- `resource_pack/`: the held models (attachables), their animations, textures, icons, the ball
  sprites and the splash particle.

Unlike `packs/blocks`, this pack is committed: everything in it is drawn by
`tools/assets/guns.ts` from the boxes listed there and the numbers in
`packages/minigame-core/src/gun-defs.ts`. Change those, then rerun it and commit what it writes:

    npx tsx tools/assets/guns.ts

A test checks the committed files match (`tools/build/test/guns-pack.test.ts`). The manifests are
the only hand-written files. A game fires the guns with core's `Guns`
(`packages/minigame-core/src/game/guns.ts`); see docs/ui.md, "The guns".

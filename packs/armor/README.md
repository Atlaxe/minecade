# Shared armor pack

Leather armor in each of the 16 dye colors: `minecade:<dye>_leather_helmet`, `_chestplate`,
`_leggings` and `_boots` (`dyedLeather(piece, dye)` in minigame-core), named, protecting and
wearing out like vanilla leather and looking like leather dyed that color. The build adds this pack
to every server, the same way it adds `packs/guns`.

Bedrock's scripts can't dye vanilla leather, so team armor uses these instead: a kit with
`teamArmor` puts on the piece in the team's dye in place of the vanilla leather it lists, and a
preview's team switch swaps it. Any game can also hand one out by name. How a new game uses them:
`docs/ui.md`, "Team armor in a new game".

- `behavior_pack/`: the 64 items.
- `resource_pack/`: how they look worn (attachables like vanilla leather's, for players and for
  everything else) and their hotbar icons.

Both folders are written by `tools/assets/armor.ts`, which the build runs before it packs the
servers: the textures are Minecraft's own leather ones tinted the way the game tints dyed leather,
read from the game on this PC or the cache of its textures (`tools/assets/vanilla/`, see
`tools/build/vanilla-textures.ts`). They're Mojang's, so both folders are git-ignored; never commit
them. To write them by hand:

    npx tsx tools/assets/armor.ts

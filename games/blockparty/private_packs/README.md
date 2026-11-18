# Block Party's private packs

Packs for Block Party that hold files that can't go in the repo, one folder each:
`<name>/behavior_pack/` and `<name>/resource_pack/`. They're git-ignored. The build adds each half
to Block Party's server once it has a `manifest.json` and some content (`tools/build/packs.ts`,
`privatePacks`), named `blockparty_<name>_bp` and `blockparty_<name>_rp`. A behavior pack here
ships as it is.

- `arenas/`: published maps' arenas as structures, for the spike's Arenas test, written by
  `npx tsx spike/blockparty/arena-pack.ts [<game>/<map> ...]` from the map store (maps aren't in
  git). Each is `minecade:arena_<game>_<map>`.
- `players/`: vanilla's `player.json` with `minecraft:rideable` and `minecraft:leashable` added,
  for the spike's ride and lead tests (Carry Race and Paired Parkour need them). It's built by the
  private block-party-players project in the workshop folder beside this repo
  (`..\workshop\block-party-players`: `tools\build.py`, then `tools\install.py`), which copies the
  file out of the installed game, so it stays out of git.
- `faces/`: the dialogue box's character faces (`textures/blockparty/faces/<face>.png`), from the
  workshop's dialogue tool (`..\workshop\dialogue`: `characters.json` names each character's face,
  `faces\` holds the pictures, starters cut from the game's own mob textures by
  `tools\make_faces.py`), installed by its `tools\install-faces.mjs`.
- `sounds/`: the user's own sounds, from the same tool's Sounds view, installed by its
  `tools\install-sounds.mjs`.
- `icons/`: the coin picture (`textures/blockparty/ui/coin.png`, the user's Minecoin, which the
  player cards and the results show) and the coin and Star models (`geometry.blockparty.coin` and
  `geometry.blockparty.star`, each its picture one pixel thick, for the `blockparty:coin` and
  `blockparty:star` entities). The Star is the game's own nether star (`textures/items/nether_star`),
  so only its model is here. Built and installed by the private block-party-icons project in the
  workshop folder (`..\workshop\block-party-icons`: `tools\build.py`, then `tools\install.py`).

Run the network's build (Start in the Panel) after installing to put a change on the server.

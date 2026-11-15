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

Run the network's build (Start in the Panel) after installing to put a change on the server.

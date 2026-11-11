# Chameleon's private packs

Packs for Chameleon that come from outside the repo, one folder each: `<name>/behavior_pack/` and
`<name>/resource_pack/`, git-ignored because they hold files that aren't ours to publish. The build
adds each half to Chameleon's server once it has a `manifest.json` and some content
(`tools/build/packs.ts`, `privatePacks`), named `chameleon_<name>_bp` and `chameleon_<name>_rp`.

- `chameleon/`: the hiders' side of the game. Hiders wear a block's texture (any full block,
  vanilla or the Minecade block pack's), pose, lock their position, taunt, and fly off in free look
  while a stand-in keeps their costume; they're small, behind a close camera, and see other hiders
  only up close; everyone sees the hiders' costumes as pictures on the right. It knows a hider by
  their Wear block item and a seeker by their Detector (the game's hotbars, game.config.ts), and
  the game tells it the rest by script events (PACK_EVENTS in scripts/chameleon.ts). It's built by
  the private chameleon-test project in the workshop folder beside this repo
  (`..\workshop\chameleon-test`: `tools\build.py`, then `tools\install.py`, which copies it here
  and into Probe's slot). It copies vanilla's player files out of the installed game and draws
  pictures from Minecraft's and the block pack's textures, so it stays out of git.

Without it, Chameleon still plays: the hiders just look like themselves.

Run the network's build (Start in the Panel) after installing to put a change on the server.

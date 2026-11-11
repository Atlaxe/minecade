# Probe's private packs

Packs for Probe that come from outside the repo, one folder each: `<name>/behavior_pack/` and
`<name>/resource_pack/`. They're git-ignored, because they hold files that aren't ours to publish.
The build adds each half to Probe's server once it has a `manifest.json` and some content
(`tools/build/packs.ts`, `privatePacks`), named `probe_<name>_bp` and `probe_<name>_rp`. A behavior
pack here ships as it is, so a script in it must already be built (plain JavaScript, one manifest).

Any game can have this folder; Probe is the one that does.

- `chameleon/`: the chameleon test (wear a clicked block's texture, small size, poses, free look,
  everyone's costumes as pictures on the right). It's built by the private chameleon-test project in the workshop folder
  beside this repo (`..\workshop\chameleon-test`: `tools\build.py`, then `tools\install.py`, which
  copies it here). It copies vanilla's player files out of the installed game and draws pictures
  from Minecraft's and the block pack's textures, so it stays out of git. Probe's Chameleon kit
  holds its abilities, as wool for now.

Run the network's build (Start in the Panel) after installing to put a change on the server.

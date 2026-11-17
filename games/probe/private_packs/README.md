# Probe's private packs

Packs for Probe that come from outside the repo, one folder each: `<name>/behavior_pack/` and
`<name>/resource_pack/`. They're git-ignored, because they hold files that aren't ours to publish.
The build adds each half to Probe's server once it has a `manifest.json` and some content
(`tools/build/packs.ts`, `privatePacks`), named `probe_<name>_bp` and `probe_<name>_rp`. A behavior
pack here ships as it is, so a script in it must already be built (plain JavaScript, one manifest).

Any game can have this folder; Probe is the one that does.

- `chameleon/`: the chameleon test (hiders and seekers, switched with `/chameleon:role`: hiders
  are small, wear a block's texture, pose, lock their position, taunt, and fly off in free look
  while a stand-in stays; hiders see each other only up close; everyone sees the hiders' costumes
  as pictures on the right). It's built by the private chameleon-test project in the workshop folder
  beside this repo (`..\workshop\chameleon-test`: `tools\build.py`, then `tools\install.py`, which
  copies it here). It copies vanilla's player files out of the installed game and draws pictures
  from Minecraft's and the block pack's textures, so it stays out of git. Probe's Chameleon kit
  is a hider's hotbar, wool for now.

- `jsonui/`: the JSON UI tool's test pack: its calibration, for checking its preview against the
  game, and the form layouts and HUD pieces made in its builder, to try them before they go into
  a game. The calibration puts 30 test screens on the HUD (one at a time, picked by the sidebar's
  title, so don't run it during the chameleon test, whose pictures use the sidebar too) and adds
  `/jsonui:run [seconds]` (every screen in turn, for everyone), `/jsonui:case <n>`,
  `/jsonui:stop` and `/jsonui:forms` (8 test forms one after another, for everyone). The designs
  add `/jsonui:form <design>` (opens a form with the design's mark and sample content, and says in
  chat what was picked) and `/jsonui:hud <design> [seconds]` (the design's HUD line on your action
  bar; Probe's clock writes the line too, so it may flicker; `/jsonui:stop` ends it). Each form
  layout hides vanilla's form for its mark, keeping the marks the other packs here hide it for.
  It's built by the private json-ui project in the workshop folder beside this repo
  (`..\workshop\json-ui`: the builder's Test in Probe, or `tools\build-calibration.mjs` then
  `tools\install.mjs`). Nothing in it is private; it's here because it's a test tool, not part of
  Probe.

Run the network's build (Start in the Panel) after installing to put a change on the server.

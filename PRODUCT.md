# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner of a Minecade network and a few admins they trust. They sit at the Windows PC that runs
the network and use the Panel to run it: start and stop the servers, see who is on, manage who may
join, boot the map editor, and lay out maps. Sessions are working sessions, often with Minecraft
open beside the Panel, switching between the two.

Later, possibly: customers renting hosted Minecade, using the same Panel as the admin side of
their own network. Not a current audience; the Panel should not need a second redesign for them.

## Product Purpose

Minecade is a Minecraft Bedrock minigame network: a lobby and games (Bridges, Build Swap, Sumo,
One in the Quiver, Siege, Paintball and more), each a Bedrock Dedicated Server in Docker, run by an
orchestrator, with maps made in its own map editor. The Panel is its control room. It succeeds when
running the network and making maps takes less time and fewer trips into the game.

## Positioning

The Panel is built around this network's own pieces, not a generic server host's: the map store
with its versions and publishes, the in-game map editor and its checklist, game-specific map rules,
and a 3D map viewer that reads a map's world straight from its files and edits its markup (spawns,
markers, boundaries, regions) beside the in-game editor, never replacing it.

## Operating Context

- Runs on the network's Windows PC, served by a local Node helper on 127.0.0.1:8099 and shown in an
  Edge app window at desktop size. Not used on phones.
- Pages: Servers (the network and the map editor: start, stop, join addresses, the Friends tab
  switch), Players (who is on, who may join, guests, stats), Maps (every map in the map store,
  opened in the 3D viewer; the map editor warms up in the background while it's open), Logs (the
  Panel's activity, each server's console, the map editor's log).
- The map viewer edits `map.json` only; blocks change in game. When the in-game editor has the same
  map open, the viewer's edits go through it.
- Works offline: no CDN. Everything it loads is served by the helper.

## Capabilities and Constraints

- Hand-written HTML, CSS and JavaScript for the Panel (`tools/control-panel/index.html`); the map
  viewer is TypeScript bundled with esbuild (`tools/control-panel/viewer/`) with three.js.
- Fonts: Google Fonts, downloaded and shipped as font files in the repo, so the Panel looks the same
  offline and on any PC.
- Writing rules for every text: no em dashes, no emojis, US spelling. Plain words that say what a
  control does.
- Nothing taken from the Minecraft client (textures, colors worked out from them) goes into git.
- Terms: map store, Publish, Save (a version), draft, checklist, game Edit (the in-game editor),
  Select (cutting maps out of a world), the viewer, markers, boundaries, regions, kill Y, build
  limit.

## Brand Commitments

- Name: Minecade. Wordmark: a blocky, Minecraft-style "MINECADE" in light blue with a dark outline
  and darker blue extrusion, as players see it in the game's menus
  (`packages/minigame-core/resource_pack/textures/minecade/ui/logo.png`). Blue is the brand color.
- An orange-to-red version (`assets\Minecade Title.png` beside the repo) exists but is not the brand.

## Evidence on Hand

- Real maps in the map store (Temples, Sewer, Sinkhole, Roman, Strife and more), with thumbnails the
  owner takes in game (`preview.png`). Never make, replace or fake thumbnails or game pictures.
- Real player stats from the orchestrator. No testimonials, customers or hosting offer exist yet:
  never invent them.

## Product Principles

1. A working tool first: dense, fast to scan, every control within reach of the task at hand.
2. The in-game editor stays whole; the Panel adds faster ways, never fewer.
3. Say what happens: actions report what they did and what comes next, in plain words.
4. Built so a hosted customer could use it later without a second redesign.

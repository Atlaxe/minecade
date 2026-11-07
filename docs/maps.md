# Maps

Every server target (the lobby, and each game under `games/<id>/`) has one or more maps. A map
is a `map.json` plus a `world/` folder (and a `preview.png`, the lobby's picture of it). Maps
aren't in git: they live in the map store beside the checkout (see "The map store" below). A map
is checked when it's published (the map editor's checklist). Servers read the published worlds
from the store, mounted into their containers; the network's build only takes each map's name,
kits and pictures, for the lobby. Each game server starts from a fresh copy of its world.

The map editor sets spawns and points in game and writes `map.json` for you; see
[editor.md](editor.md).

## map.json

```json
{
  "name": "Default",
  "spawns": [[3, 65, 0], [-3, 65, 0]],
  "spectatorSpawn": [0, 70, 0],
  "bounds": { "min": [-12, 40, -12], "max": [12, 100, 12] },
  "build": {
    "commands": [
      "fill -5 64 -5 5 64 5 white_concrete",
      "setblock 0 64 0 lime_concrete"
    ]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Shown in the game selector. |
| `draft` | no | `true` for an unfinished map: the build skips it with a warning (and skips a game whose maps are all drafts). The map editor's Publish removes it, then publishes the map. |
| `spawns` | yes | Positions (see below). The lobby needs one; a game needs one per player slot (at least `maxPlayers`), and a game with team spawns none (unless its config asks for them; then `[]` is fine). The first is also the world spawn (else the first team spawn). |
| `spectatorSpawn` | no | Where players watch from when they're out or waiting to respawn, flying in spectator mode. A map without one has them watch from its `queueSpawn` instead (see below). A game needs one or the other unless its config says otherwise. |
| `queueSpawn` | no | Where players wait for everyone to join before the game puts them at their spawns (see "The queue spawn" below). |
| `queue` | no | How they wait there: `{ "mode": "lock" \| "free", "countdown": 5 }`. `lock` (the default) keeps everyone on the spot, looking around but unable to move, and invisible with no name tags, so nobody sees the others; `free` lets them roam. `countdown` is whole seconds (1 to 60, default 5). |
| `bounds` | when `build` is used | The playable area, in whole blocks (inclusive): one box, or a list of boxes for an area of another shape (an L-shaped arena, two islands). Players outside every box are out (in games with `combat.outOfBounds: "down"`), and in the lobby go back to spawn. Spectators are kept inside the box around them all, flying over the gaps (unless the map has `spectatorBounds`). Spawns must be inside a box, and y must stay within -64 to 319. Baking works inside the box around them all. |
| `spectatorBounds` | no | Where everyone who isn't playing is kept, written like `bounds` (one box, or a list): players waiting at the queue spawn, and players who are out, waiting to respawn or watching. With it, the `spectatorSpawn` and `queueSpawn` go inside it instead of inside `bounds`, so they can stand apart from the arena (a stand beside it, a platform over the void), and a map with it needs one of the two. Someone not playing who leaves every box goes back to the spectator (or queue) spawn; `killY` and kill regions don't apply to them. Spectators who fly are kept inside the box around them all. Players in the match still go by `bounds`. Without it, everyone is kept in `bounds`. |
| `killY` | no | Anyone below this height is out (knocked off, fell into the void). Within -64 to 319. |
| `buildLimit` | no | `{ "above": y, "below": y }`, either or both: in a building game, no block goes above the `above` height or below the `below` one (each a plane, like `killY`: with `"above": 80` the highest block is at 79, with `"below": 60` the lowest is at 60). Whole numbers from -64 to 320, `above` over `below`. Set with the map editor's Kill Y tool. |
| `time` | no | A fixed time of day: the daylight cycle stops there when the server starts. `day`, `noon`, `sunset`, `night`, `midnight` or `sunrise`, or ticks from 0 to 23999. The map editor's Time tool sets it (Noon, Dusk, Midnight and Dawn are `noon`, `sunset`, `midnight` and `sunrise`; a custom time is ticks). |
| `stars` | no | The lobby only: `true` puts a star box around the map, so stars show in every direction, below the horizon too (Bedrock's own sky has stars only above it). Use it with a night `time`. See "The star box" in `docs/ui.md`. |
| `teamSpawns` | no | `{ "<team or role id>": [positions] }`. Team games spawn each team at its own points; before teams are dealt, players wait at every team's spawns in turn (or the plain spawns, when the map has them). The keys must be the game's team ids. |
| `points` | no | `{ "<name>": [positions] }`: named positions a game uses, such as bomb sites or mob spawns. `"<name>.<team>"` is one team's (`"flag.red"`). |
| `regions` | no | `{ "<name>": [{ "min": [x, y, z], "max": [x, y, z] }, ...] }`: named boxes, such as build plots or a floor that falls away. `"<name>.<team>"` is one team's. The name `kill` is reserved: anyone inside a `kill` box is out, the same as falling below `killY` (spectators fly over them). |
| `kits` | no | Games only: kits of the map's own, for a game whose players pick kits. `{ "mode": "append", "list": [kits] }` adds them after the game's (a kit with the same `id` as one of the game's takes its place); `"mode": "replace"` uses only the map's. A `base` replaces the game's base kit either way. Each kit is written as in `game.config.ts`: `{ "id": "ice", "name": "Ice", "refill": "round", "items": [{ "item": "minecraft:snowball", "count": 16 }] }`. The map editor keeps it as written; there's no screen for it yet. A game whose kits are the same on every map (`kits.mapKits: false`, Siege) refuses a map's own. |
| `build.commands` | no | Console commands (no leading `/`) that build the world, run once by `npm run bake`. |
| `source`, `cameras`, `mannequins`, `mannequinsInPreview` | no | Written by the map editor: where the map was cut from, its preview cameras (`{ "Camera 1": { "at": [x, y, z, yaw, pitch], "kind": "map" \| "game" } }`, the eye point and view the Camera tool saved), and its mannequins, stand-ins for game pictures (`{ "Mannequin 1": { "at": [x, y, z, yaw], "skin": "color", "color": "red", "pose": "standing", "hold": "minecraft:bow" } }`, the Mannequin tool's; ids from minigame-core's `fake-looks.ts`, or for a player's saved skin "p" and a hash of their xuid), and whether the mannequins stand in its previews (`true`, the Mannequin tool's Show in previews; a preview's server then gets them as `previewMannequins`, each look worked out for its pack). Servers never get them. |
| anything else | no | Game-specific settings the game reads itself: the settings its config names (`map.settings`, below, set with the map editor's Game settings tool), each a whole number under its key (`"buildPadding": 4`), the default when it's left out. |

**Positions** are `[x, y, z]`, or `[x, y, z, yaw, pitch]` with a fixed facing in degrees (yaw -180
to 180, 0 faces south; pitch -90 up to 90 down). Whole x and z mean the middle of that block
(`[3, 65, -2]` stands at 3.5, 65, -1.5); a fraction in x or z makes it an exact point
(`[3.27, 65, -1.84]`), which is what the map editor's Spawn tool writes. y is the feet. Without a
facing, spawns face the middle of the map, and the lobby's spawn faces the terminal. Positions
and points must be inside a `bounds` box, and regions inside the box around them all (x 12.7 is
inside a max of 12). The lobby's
`terminal` point is always a block.

Servers get `map.json` without `build`, `source`, `cameras`, `mannequins`, `mannequinsInPreview` and `draft`. `npm run build` reports
every problem in every map at once, and warns (without stopping) about two entries of a list in
the same block.

## The queue spawn

With a `queueSpawn`, the start of a game goes:

1. Everyone who joins waits at the queue spawn (locked in or free, by `queue.mode`). Anyone who
   falls below `killY` or leaves `bounds` (or, locked in, gets pushed off the spot) is put back.
   On a map with `spectatorBounds`, leaving those is what puts them back instead.
   Locked in, they can't fall either: a queue spawn in the air gets a barrier under it (in the
   block below, if that's air) while anyone waits there, taken away once they go to their spawns.
2. Once everyone expected is in (or the wait runs out with enough players), a countdown of
   `queue.countdown` seconds runs there ("Spawning in").
3. Everyone moves to their spawns, visible again, for the game's usual frozen countdown, then "Go!".
   If players drop below the minimum, it's back to the queue.

Without one, players wait at their spawns, as before. The map editor places it with the Spawn
tool (Queue spawn, in Place into); hit its marker for Lock in and the countdown.

**Watching from the queue spawn:** a map with a `queueSpawn` and no `spectatorSpawn` has players
who are out (or waiting to respawn), late joiners who spectate, and players past the game's limit
wait at the queue spawn instead: on foot in adventure mode, with empty hands, seen by others but
without a name tag (whatever `queue.mode` says). A fall below `killY` or a step out of `bounds` puts
them back there (on a map with `spectatorBounds`, a step out of those). A preview's fake players go where players would: in the queue while waiting, at
their spawns in the match, and when out at the queue spawn on foot, or floating at the spectator
spawn (seen there, unlike a player).

**Name tags:** while players wait (at their spawns, or in a free queue) their gamertags show. During
the match they're hidden, players' and a preview's fake players' alike, unless the game's config has
`nameTags: true` (then team games show them in the team's color).

## What a game's maps need

A game says what its maps must have in the `map` block of its `game.config.ts`. The build checks
every map against it, and the map editor shows it as each map's checklist:

```ts
map: {
  spawns: { min: "maxPlayers" },   // the default; a number also works
  teamSpawns: { perTeam: 5 },      // or true for at least one per team
  spectatorSpawn: true,
  queueSpawn: true,                // only when every map must have one
  killY: true,
  buildLimit: true,                // both sides; or { above: true } for one
  bounds: true,
  points: { bombA: { label: "Bomb site A" }, bombB: { label: "Bomb site B", count: 1 } },
  regions: { buyZone: { label: "Buy zone", perTeam: true } },
}
```

A region can ask for big enough boxes: `minSize: 24` means every box spans at least 24 blocks along
each side (Build Swap's building boundaries). A smaller box doesn't count toward the region's
`count`, the build names it as a problem, and the map editor's region tool won't save one.

**Per-map settings:** `settings` names numbers the game reads from each map, which the map
editor's Game settings tool sets (a game never needs a tool of its own for them):

```ts
settings: { buildPadding: { label: "Build padding", hint: "how far builders and voters can go past a boundary", default: 2, min: 0, max: 32, unit: "blocks" } },
```

Each is a whole number from `min` to `max`, kept in `map.json` under its key; a map that leaves it
out plays with `default`. The game reads it with `this.mapSetting("buildPadding")`. The build
checks a map's value fits, and a setting's key can't be one `map.json` already has.

`perTeam` entries are needed once for every team the game can have (`"buyZone.red"`,
`"buyZone.blue"`). The short forms still work: `points: ["bombA", "bombB"]`,
`regions: ["floor"]`, `teamSpawns: true`.

**Plain spawns in team games:** a game that asks for `teamSpawns` and doesn't name `spawns` has no
plain spawns: its maps need none, and the map editor's Spawn tool only places team spawns (its Team
list), the spectator spawn and the queue spawn. Naming `spawns` (`spawns: {}` for one, used while
players wait) turns them back on, with **No team** in that list. `spawns: false` turns them off in
any game. The `points` a game names are placed with the map editor's Game marker tool.

**Where players watch from:** a game that names neither `spectatorSpawn` nor `queueSpawn` needs one
or the other (the checklist's "Spectator or queue spawn" row): a map with only a queue spawn passes
and previews, and its players watch from there. Naming either asks for exactly what's named:
`spectatorSpawn: true` for one, both for both, and `spectatorSpawn: false` for a game that needs
neither.

**Markers:** `marker` says how the map editor draws a list's entries: `"player"`, a mannequin (the
default for every kind of spawn); `"post"`, a thin post with a square head (the default for points,
such as the lobby's terminal); or `{ model: "<name>" }`, the game's own model. It goes on a point
(`points: { terminal: { marker: { model: "terminal" } } }`), on `spawns: { marker }`,
`teamSpawns: { marker }`, and on `spectatorSpawn` and `queueSpawn` as `{ marker }` instead of
`true`. A model is two files in the game's folder (the lobby's: `lobby/markers/`):
`markers/<name>.geo.json` (a Bedrock entity geometry, its feet at the entry's spot and its front
facing the entry's facing) and `markers/<name>.png`, its texture. Names are lowercase letters,
digits and `_`. The map editor adds every game's models to its resource pack when it starts, draws
them on the markers and on the aim cursor while one is placed, and draws a model it doesn't have
as a post. Its markers can be hit anywhere on the model: the editor's behavior pack gets a hitbox
for each, sized from its cubes. A team's markers take the team's color on the model's bones named `tint` (Bridges' hole
colors its rim), drawn fully lit so they show in the dark; the rest keeps the texture's colors.
Markers draw both sides of every face, so a flat cube (a size of 0) needs only one face: two
faces on the same plane flicker over each other.

**Building games** (a `build` block in `game.config.ts`, Bridges) play in survival mode. Players
place blocks only inside a `bounds` box (above `killY`, outside kill regions, within the map's
`buildLimit`), never inside a region
the game names in `build.noBuild`, and break only blocks placed during the match (nothing drops).
A name there covers its per-team lists too, so `noBuild: ["spawnGuard"]` closes `spawnGuard.red`
and `spawnGuard.blue` to everyone. Draw those regions with the map editor's region tool (Save as,
then the region from the list, such as Spawn guard (Red)); they show in each team's color, and in
the Boundaries view.

**Bridges** needs team spawns, bounds, a build limit, a spectator or queue spawn, and per team the
two entries below. A fall out of the bounds is a fall into the void, so kill Y is optional; a
queue spawn on a stand beside the arena goes in `spectatorBounds` (the Region tool's Spectators).
Per team:
- a `hole.<team>` point at the **middle of the hole's floor**, in the pit the map has for it. The
  game stands the hole there: 3 blocks square and 3 tall, black inside, its rim a ring in the
  team's color, drawn fully lit so it looks the same in the dark as in daylight. Each of its sides,
  its floor and its rim is one flat face, drawn from both sides. Nobody can build in the hole or
  anywhere above it. The editor draws the point as the same hole, its rim in the team's color.
- a `spawnGuard.<team>` region around the team's spawn (and its hole), where nobody builds.

**Siege** needs team spawns (one per team at least; up to four players share a team's spawns, so
give each team a few), bounds, and a spectator or queue spawn. Players who are out watch from there
until the next round. Water anywhere on the map hurts every class but the Seaman, a heart a second,
so a moat or a pool is part of the map's design. Its classes are the same on every map: a Siege map
can't have `kits` of its own (the build and the editor's checklist refuse them).

**Build Swap** needs 8 spawns, a spectator or queue spawn, and 8 boxes in the `plot` region
(Build boundary in the map editor's Region list), each at least 24 blocks on every side. A box is
where one player builds; put one spawn in each (the game pairs each spawn with the box it stands
in, or the nearest one left), facing the build if you like, since players also stand there to
vote on that build. Put a floor under each box rather than inside it: players can change every
block inside their box, and nothing outside it (`/floor` lays the block in hand across the box's
bottom layer). Leave space between boxes (liquids that run out of a box are cleared from the
block-thick shell around it, and a shell that cuts into another box is skipped). A box bigger than
64 blocks on a side works: the game saves it in 64-block pieces. Builders are kept within 2 blocks
of their box unless the map sets its own **Build padding** (`"buildPadding"`, 0 to 32), and put back
as soon as they're past it unless the map sets a **Return delay** (`"returnDelay"`, 0 to 30
seconds); both with the map editor's Game settings tool. Voters are kept within the same padding of
the box being voted on, and always put back at once.

**Paintball** needs team spawns for all four teams (Red, Blue, Yellow and Green, at least 2 each,
since a match can have any of 2 to 4 teams), bounds, at least 8 Power-up spots (the Game marker
tool's Power-up spot list, drawn as the floating white rifle players see), and a spectator or queue
spawn, where players wait out their 3 second respawn. Two power-ups are out at a time, never on the
same spot, so spread the spots around the arena. Balls paint everything inside the bounds in the
teams' colors (full blocks become concrete; see "Paintball" in [ui.md](ui.md)), so build the arena
from blocks that look good painted. The map itself never changes: every match starts from a fresh
copy.

**The lobby** declares its own in `lobby/lobby.config.ts`: one spawn and the `terminal` point
(the middle block of the terminal's 3x3 console; the hologram floats above it). `LOBBY_MAP` in
`.env` picks which published lobby map is the live lobby (default `spaceship`), and the Panel has a
picker for it on the Servers page. A restart applies it.

### Borrowing another game's maps

A game can play another game's published maps as they are, beside any of its own, by naming that
game in `map.borrow`. Gunfight plays Siege's:

```ts
map: { teamSpawns: true, bounds: true, borrow: ["siege"] },
```

- The build lists the other game's published maps after the game's own (each in `registry.json`
  with `owner`, the game it belongs to, and that game's preview), and refuses two maps with the
  same id. It also checks that the other game asks at least what this one asks of a map
  (`uncoveredRequirements`), so any map it publishes will do: Siege's team spawns, bounds and
  spectator or queue spawn are all Gunfight needs.
- A borrowed map stays its own game's: it's made, edited and published there, and Gunfight gets
  each new version of it with Siege's next publish. Its world is published under its owner, so the
  orchestrator looks it up there and starts the server with `MAP_GAME` (the entrypoint reads
  `/maps/<MAP_GAME>/<map>/<version>`).
- In the map editor, Preview can play a borrowed map as the game that borrows it ("Play as": see
  docs/editor.md, "Preview").
- A game playing only borrowed maps has none of its own to take its picture on yet: the build
  warns instead of refusing, and the lobby shows the stand-in picture.

To give a game a map of its own built from another game's, port it instead: the Panel's **Port to
another game** (docs/viewer.md) copies the map's world, and nothing else of it, into a new draft
map of that game.

## The map store

The maps and the games' pictures are kept in `C:\dev\minecade\maps\`, beside the checkouts, and
never go to GitHub. It's `..\maps` from the repo root, so the main checkout and every
`network-<topic>` worktree see the same one; `MAP_STORE` in `.env` puts it somewhere else.

| In the store | What it is |
| --- | --- |
| `working\<target>\<map>\` | The map the map editor works on: `map.json`, `preview.png`, `world\`. `<target>` is `lobby` or a game id. |
| `working\<game>\icon.png` | The game's picture, taken with the editor's Camera tool. |
| `maps.db` | Every map's versions and which one is published (node:sqlite). A version is the map's folder as it was; files that didn't change are stored once. |
| `published\catalog\` | What the network's build reads: each published map's card (`<target>\<map>.json`: its name, its kits, and the custom blocks its world uses, for the network's cut of the blocks pack), its preview (`<target>\<map>.png`), and each game's picture (`<game>\icon.png`). |
| `published\worlds\` | What the servers read, mounted at `/maps` in the lobby, the orchestrator and every game: each published version in a folder of its own (`<target>\<map>\<version>\`, the world with Beta APIs on and `map.json` as servers read it), and `index.json`, which names each map's published version. |
| `backups\` | A copy of `maps.db` after every publish and delete, the newest 30. |

The map editor keeps a version each time it saves the world and each time it stops, and Publish
points the map at its newest version. The store keeps every published version and the newest 20
others of each map. A deleted map keeps its versions too.

```
npm run maps -- list                          the published maps
npm run maps -- versions <target> <map>       a map's versions, the newest first
npm run maps -- restore <target> <map> <n>    put version n back (close the map in the editor first), then Publish it
npm run maps -- export                        write published\ again (only what changed)
npm run maps -- backup                        copy maps.db into backups\
npm run maps -- import [<checkout>]           take the maps out of a git checkout (HEAD's come in published)
```

`published\` is written from `maps.db` on every Publish, every Delete and every Panel Start, and
only what changed is written: a version's folder never changes once it's there, and a catalog file
is rewritten only when its bytes do. A server that starts while the index changes reads the old
one or the new one, and both versions are there (the one before the published one stays; older
ones go).

The Docker build gets `published\catalog\` as a second build context (`maps` in
`docker-compose.yml`), and compose mounts `published\worlds\` read-only at `/maps` in the lobby
and the orchestrator, which gives every game container the same folder. So what a Publish needs
before the lobby shows it:

| Changed | Start the network |
| --- | --- |
| The world, or anything else in `map.json` (spawns, bounds, regions, settings) | The build is all cache and finishes in seconds; the next game runs the new version, and the lobby its own from its next start. |
| A new map, a map's id, name or kits, a picture, a deleted map, or a world that now uses a custom block it didn't | The build runs again: for the lobby's lists and pictures, or the network's cut of the blocks pack (`packs/blocks/README.md`). |

The Panel's Start writes `published\` first; before a `docker compose up --build` by hand, run
`npm run maps -- export`. A fresh clone has no maps: restore `maps.db` from a backup into the
store and run the export.

## Baking a map

```
npm run bake -- <target> <map>     for example: npm run bake -- lobby main
npm run bake -- --all              every map with a "build" section
```

Baking starts a temporary server (no ports published) on an empty void world, runs the
`build.commands` inside `bounds`, and replaces the map's `world\` in the store with the result.
Baked worlds are always noon, with no weather, mob spawning, fire spread or mob griefing. Publish
the map in the map editor to put it in the lobby.

The bake stops on any command error (bad syntax, unknown block, more than 32768 blocks in
one `fill`) and quotes the server's message. Add `--verbose` to watch the server console.

## Using a world built in the client

You can build a map by hand in Minecraft instead:

1. Build it in a creative world.
2. Copy that world's folder (from `minecraftWorlds/`) to the store's
   `working\<target>\<map-id>\world\`.
3. Write a `map.json` without a `build` section beside it.
4. Open it in the map editor and Publish it.

The map editor's Select mode does all of this for you from a box drawn around part of a world.

The build turns on the Beta APIs experiment in the shipped copy, which every Minecade pack needs.

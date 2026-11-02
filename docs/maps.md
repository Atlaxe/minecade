# Maps

Every server target (the lobby, and each game under `games/<id>/`) has one or more maps in
`maps/<map-id>/`. A map is a `map.json` plus a `world/` folder. The build checks every map and
copies it into the server templates. Each game server starts from a fresh copy of its world.

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
| `draft` | no | `true` for an unfinished map: the build skips it with a warning (and skips a game whose maps are all drafts). The map editor's Publish removes it, then commits and pushes the map. |
| `spawns` | yes | Positions (see below). The lobby needs one; a game needs one per player slot (at least `maxPlayers`), and a game with team spawns none (unless its config asks for them; then `[]` is fine). The first is also the world spawn (else the first team spawn). |
| `spectatorSpawn` | no | Where players watch from when they're out or waiting to respawn, flying in spectator mode. A map without one has them watch from its `queueSpawn` instead (see below). A game needs one or the other unless its config says otherwise. |
| `queueSpawn` | no | Where players wait for everyone to join before the game puts them at their spawns (see "The queue spawn" below). |
| `queue` | no | How they wait there: `{ "mode": "lock" \| "free", "countdown": 5 }`. `lock` (the default) keeps everyone on the spot, looking around but unable to move, and invisible with no name tags, so nobody sees the others; `free` lets them roam. `countdown` is whole seconds (1 to 60, default 5). |
| `bounds` | when `build` is used | The playable area, in whole blocks (inclusive): one box, or a list of boxes for an area of another shape (an L-shaped arena, two islands). Players outside every box are out (in games with `combat.outOfBounds: "down"`), and in the lobby go back to spawn. Spectators are kept inside the box around them all, flying over the gaps. Spawns must be inside a box, and y must stay within -64 to 319. Baking works inside the box around them all. |
| `killY` | no | Anyone below this height is out (knocked off, fell into the void). Within -64 to 319. |
| `time` | no | A fixed time of day: the daylight cycle stops there when the server starts. `day`, `noon`, `sunset`, `night`, `midnight` or `sunrise`, or ticks from 0 to 23999. |
| `stars` | no | The lobby only: `true` puts a star box around the map, so stars show in every direction, below the horizon too (Bedrock's own sky has stars only above it). Use it with a night `time`. See "The star box" in `docs/ui.md`. |
| `teamSpawns` | no | `{ "<team or role id>": [positions] }`. Team games spawn each team at its own points; before teams are dealt, players wait at every team's spawns in turn (or the plain spawns, when the map has them). The keys must be the game's team ids. |
| `points` | no | `{ "<name>": [positions] }`: named positions a game uses, such as bomb sites or mob spawns. `"<name>.<team>"` is one team's (`"flag.red"`). |
| `regions` | no | `{ "<name>": [{ "min": [x, y, z], "max": [x, y, z] }, ...] }`: named boxes, such as build plots or a floor that falls away. `"<name>.<team>"` is one team's. The name `kill` is reserved: anyone inside a `kill` box is out, the same as falling below `killY` (spectators fly over them). |
| `kits` | no | Games only: kits of the map's own, for a game whose players pick kits. `{ "mode": "append", "list": [kits] }` adds them after the game's (a kit with the same `id` as one of the game's takes its place); `"mode": "replace"` uses only the map's. A `base` replaces the game's base kit either way. Each kit is written as in `game.config.ts`: `{ "id": "ice", "name": "Ice", "refill": "round", "items": [{ "item": "minecraft:snowball", "count": 16 }] }`. The map editor keeps it as written; there's no screen for it yet. |
| `build.commands` | no | Console commands (no leading `/`) that build the world, run once by `npm run bake`. |
| `source`, `cameras` | no | Written by the map editor: where the map was cut from, and its preview cameras (`{ "Camera 1": { "at": [x, y, z, yaw, pitch], "kind": "map" \| "game" } }`, the eye point and view the Camera tool saved). Servers never get them. |
| anything else | no | Game-specific settings the game reads itself. |

**Positions** are `[x, y, z]`, or `[x, y, z, yaw, pitch]` with a fixed facing in degrees (yaw -180
to 180, 0 faces south; pitch -90 up to 90 down). Whole x and z mean the middle of that block
(`[3, 65, -2]` stands at 3.5, 65, -1.5); a fraction in x or z makes it an exact point
(`[3.27, 65, -1.84]`), which is what the map editor's Spawn tool writes. y is the feet. Without a
facing, spawns face the middle of the map, and the lobby's spawn faces the terminal. Positions
and points must be inside a `bounds` box, and regions inside the box around them all (x 12.7 is
inside a max of 12). The lobby's
`terminal` point is always a block.

Servers get `map.json` without `build`, `source`, `cameras` and `draft`. `npm run build` reports
every problem in every map at once, and warns (without stopping) about two entries of a list in
the same block.

## The queue spawn

With a `queueSpawn`, the start of a game goes:

1. Everyone who joins waits at the queue spawn (locked in or free, by `queue.mode`). Anyone who
   falls below `killY` or leaves `bounds` (or, locked in, gets pushed off the spot) is put back.
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
them back there. A preview's fake players go where players would: in the queue while waiting, at
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
  bounds: true,
  points: { bombA: { label: "Bomb site A" }, bombB: { label: "Bomb site B", count: 1 } },
  regions: { buyZone: { label: "Buy zone", perTeam: true } },
}
```

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
as a post. A team's markers take the team's color on the model's bones named `tint` (Bridges' hole
colors its rim); the rest keeps the texture's colors.

**Building games** (a `build` block in `game.config.ts`, Bridges) play in survival mode. Players
place blocks only inside a `bounds` box (above `killY`, outside kill regions), never inside a region
the game names in `build.noBuild`, and break only blocks placed during the match (nothing drops).
A name there covers its per-team lists too, so `noBuild: ["spawnGuard"]` closes `spawnGuard.red`
and `spawnGuard.blue` to everyone. Draw those regions with the map editor's region tool (Save as,
then the region from the list, such as Spawn guard (Red)); they show in each team's color, and in
the Boundaries view.

**Bridges** needs team spawns, bounds, kill Y, a spectator or queue spawn, and per team:
- a `hole.<team>` point at the **middle of the hole's floor**, in the pit the map has for it. The
  game stands the hole there: 3 blocks square and 3 tall, black inside, its rim a ring in the
  team's color. Nobody can build in the hole or anywhere above it. The editor draws the point as a
  post.
- a `spawnGuard.<team>` region around the team's spawn (and its hole), where nobody builds.

**The lobby** declares its own in `lobby/lobby.config.ts`: one spawn and the `terminal` point
(the middle block of the terminal's 3x3 console; the hologram floats above it). `LOBBY_MAP` in
`.env` picks which of `lobby/maps/` is the live lobby (default `spaceship`), and the Panel has a
picker for it on the Servers page. A restart applies it.

## Baking a map

```
npm run bake -- <target> <map>     for example: npm run bake -- lobby main
npm run bake -- --all              every map with a "build" section
```

Baking starts a temporary server (no ports published) on an empty void world, runs the
`build.commands` inside `bounds`, and replaces `world/` with the result. Baked worlds are
always noon, with no weather, mob spawning, fire spread or mob griefing. Each one is a few
kilobytes, so commit it.

The bake stops on any command error (bad syntax, unknown block, more than 32768 blocks in
one `fill`) and quotes the server's message. Add `--verbose` to watch the server console.

## Using a world built in the client

You can build a map by hand in Minecraft instead:

1. Build it in a creative world.
2. Copy that world's folder (from `minecraftWorlds/`) to `<target>/maps/<map-id>/world/`.
3. Write a `map.json` without a `build` section.
4. Run `npm run build`.

The build turns on the Beta APIs experiment in the shipped copy, which every Minecade pack needs.

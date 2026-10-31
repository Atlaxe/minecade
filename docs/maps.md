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
| `spawns` | yes | Positions (see below). The lobby needs one; a game needs one per player slot (at least `maxPlayers`). The first is also the world spawn. |
| `spectatorSpawn` | no | Where eliminated players watch from. |
| `bounds` | when `build` is used | The playable box, in whole blocks (inclusive). Players outside it are out (in games with `combat.outOfBounds: "down"`), and spectators are kept inside. Spawns must be inside it, and y must stay within -64 to 319. |
| `killY` | no | Anyone below this height is out (knocked off, fell into the void). Within -64 to 319. |
| `time` | no | A fixed time of day: the daylight cycle stops there when the server starts. `day`, `noon`, `sunset`, `night`, `midnight` or `sunrise`, or ticks from 0 to 23999. |
| `stars` | no | The lobby only: `true` puts a star box around the map, so stars show in every direction, below the horizon too (Bedrock's own sky has stars only above it). Use it with a night `time`. See "The star box" in `docs/ui.md`. |
| `teamSpawns` | no | `{ "<team or role id>": [positions] }`. Team games spawn each team at its own points. With these, `spawns` may have fewer than `maxPlayers` entries. The keys must be the game's team ids. |
| `points` | no | `{ "<name>": [positions] }`: named positions a game uses, such as bomb sites or mob spawns. `"<name>.<team>"` is one team's (`"flag.red"`). |
| `regions` | no | `{ "<name>": [{ "min": [x, y, z], "max": [x, y, z] }, ...] }`: named boxes, such as build plots or a floor that falls away. `"<name>.<team>"` is one team's. The name `kill` is reserved: anyone inside a `kill` box is out, the same as falling below `killY` (spectators fly over them). |
| `build.commands` | no | Console commands (no leading `/`) that build the world, run once by `npm run bake`. |
| `source`, `cameras` | no | Written by the map editor: where the map was cut from, and its preview cameras. Servers never get them. |
| anything else | no | Game-specific settings the game reads itself. |

**Positions** are `[x, y, z]`, or `[x, y, z, yaw, pitch]` with a fixed facing in degrees (yaw -180
to 180, 0 faces south; pitch -90 up to 90 down). Whole x and z mean the middle of that block
(`[3, 65, -2]` stands at 3.5, 65, -1.5); a fraction in x or z makes it an exact point
(`[3.27, 65, -1.84]`), which is what the map editor's Spawn tool writes. y is the feet. Without a
facing, spawns face the middle of the map, and the lobby's spawn faces the terminal. Positions,
points and regions must all be inside `bounds` (x 12.7 is inside a max of 12). The lobby's
`terminal` point is always a block.

Servers get `map.json` without `build`, `source`, `cameras` and `draft`. `npm run build` reports
every problem in every map at once, and warns (without stopping) about two entries of a list in
the same block.

## What a game's maps need

A game says what its maps must have in the `map` block of its `game.config.ts`. The build checks
every map against it, and the map editor shows it as each map's checklist:

```ts
map: {
  spawns: { min: "maxPlayers" },   // the default; a number also works
  teamSpawns: { perTeam: 5 },      // or true for at least one per team
  spectatorSpawn: true,
  killY: true,
  bounds: true,
  points: { bombA: { label: "Bomb site A" }, bombB: { label: "Bomb site B", count: 1 } },
  regions: { buyZone: { label: "Buy zone", perTeam: true } },
}
```

`perTeam` entries are needed once for every team the game can have (`"buyZone.red"`,
`"buyZone.blue"`). The short forms still work: `points: ["bombA", "bombB"]`,
`regions: ["floor"]`, `teamSpawns: true`. With `teamSpawns`, the plain `spawns` need only one.

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

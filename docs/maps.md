# Maps

Every server target (the lobby, and each game under `games/<id>/`) has one or more maps in
`maps/<map-id>/`. A map is a `map.json` plus a `world/` folder. The build checks every map and
copies it into the server templates. Each game server starts from a fresh copy of its world.

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
| `spawns` | yes | `[x, y, z]` positions. The lobby needs one; a game needs one per player slot (at least `maxPlayers`). The first is also the world spawn. |
| `spectatorSpawn` | no | Where eliminated players watch from. |
| `bounds` | when `build` is used | The playable box, in whole blocks (inclusive). Players outside it are out (in games with `combat.outOfBounds: "down"`), and spectators are kept inside. Spawns must be inside it, and y must stay within -64 to 319. |
| `killY` | no | Anyone below this height is out (knocked off, fell into the void). |
| `teamSpawns` | no | `{ "<team or role id>": [[x, y, z], ...] }`. Team games spawn each team at its own points. With these, `spawns` may have fewer than `maxPlayers` entries. |
| `points` | no | `{ "<name>": [[x, y, z], ...] }`: named positions a game uses, such as bomb sites or mob spawns. |
| `regions` | no | `{ "<name>": [{ "min": [x, y, z], "max": [x, y, z] }, ...] }`: named boxes, such as build plots or a floor that falls away. |
| `build.commands` | no | Console commands (no leading `/`) that build the world, run once by `npm run bake`. |
| anything else | no | Game-specific settings the game reads itself. |

Positions, points and regions must all be inside `bounds`. A game can list the `points` and
`regions` names it needs in its config, and say whether it needs `teamSpawns`
(`map: { points: ["bombA", "bombB"], teamSpawns: true }`). The build then rejects any of its
maps that lacks one.

`npm run build` reports every problem in every map at once.

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

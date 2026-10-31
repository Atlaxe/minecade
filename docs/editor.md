# Map editor

The map editor is a Bedrock server on port 19134 where you set a map's data in game: spawns, the
spectator spawn and named points, with a checklist of what the map's game still needs. Every change
goes straight into the map's `map.json`. This page covers Edit mode as it is today; Select mode
(cutting maps out of a converted world), Preview, and the region and Kill Y tools come in later
passes of milestone 10 (see `docs/plans/map-editor.md`).

## Starting and stopping

From the Panel: open **Map editor**, pick the lobby or a game, pick a map (or **New map...** and
type an id), and press **Start**. The page shows when it's ready to join, who is online, the
checklist and the editor's log. **Stop** saves and stops it. Closing the Panel doesn't stop the
editor.

From a terminal:

```
npm run editor -- <target> <map>          for example: npm run editor -- sumo arena_1
npm run editor -- <target> <map> --new    a new draft map: a void world with a glass pad
npm run editor -- status                  what the running editor is doing
npm run editor -- stop                    stop it (it saves first)
```

`<target>` is `lobby` or a game id. In the terminal, Ctrl+C stops the editor the same way; press it
twice to quit without saving the world (`map.json` keeps every change either way).

Starting takes a few seconds: the editor builds its own packs from this checkout, so it never needs
`npm run build` or a network restart, and it works on a map that still has problems. Only one editor
runs at a time.

Then join `LAN_HOST:19134` (the Panel shows the address). The first time, accept the server's trust
prompt; it keeps the same identity after that. The Docker network doesn't need to be running.

## Who can join, and who gets the tools

Set these in `.env`, or on the Panel's Map editor page. They apply at the editor's next start.

| Setting | Meaning |
|---|---|
| `LAN_PLAYERS` | Always allowed in. |
| `EDITOR_ALLOW_LIST` | Also allowed in. Everyone else is refused. |
| `MAP_EDITORS` | Who gets the tools (and operator, for commands). Empty means everyone in `LAN_PLAYERS`. |

Everyone else who joins is a **builder**: creative mode, no tools.

## In game

Every control is a hit (left click), a use (right click) or a form. None needs sneaking, which
would fly you down.

The map menu, the checklist and a marker's form open as a dark panel down the right side of the
screen, full height, so the world stays in view on the left. Their buttons run top down and scroll
when there are more than fit. Esc or the X closes them. The forms with fields (the spawn tool's
Place form, Map settings, Change list, Renumber) are the game's own, in the middle of the screen.

- **Map menu** (slot 9, locked, map editors only): the map's name and game, then:
  - **Checklist:** each thing the map's game needs, green when done, with what the build would
    refuse the map for. Tap an entry to get its tool, already set to that list.
  - **Tools** (the Spawn tool for now): each is a switch. On puts the tool in slot 1 and in your
    hand, and the menu closes. Off takes it away. One tool is out at a time: switching one on puts
    any other away. The tool isn't locked, so you can move it; whatever was in slot 1 moves to a
    free slot.
  - **Undo** and **Redo**, with what each would change.
  - **Mark ready** (draft maps): once nothing is missing, removes `"draft"` so the build includes the
    map.
  - **Map settings:** the map's name, and the game's own settings in `map.json` (such as a number
    a game reads), as text fields.
  - **Save the world at stop:** a switch for whether the world is saved when the editor stops (see
    below). The menu opens again with it flipped.
  - **Drop build commands** (maps made by `npm run bake`): keeps the world as you change it.
- **Spawn tool:** use it where an entry goes. The form picks the list (spawns, the spectator spawn,
  each team's spawns, and every point the game asks for), **Save my facing** (off means the entry
  faces the middle of the map, as before), and how to round the facing (exact, 45 or 90 degrees).
  The entry goes at your feet, in whole blocks.
- **Markers:** every entry shows as a marker with a name tag: its list, its number, and the way it
  faces when that's saved. An entry with a saved facing also has a glowing red line, 2 blocks long,
  from the top of its marker toward the facing, tilted up or down with the saved pitch. **Hit a
  marker** to move it to where you stand, give it your facing, clear its facing, move it to another
  list, renumber it, or delete it.

## Saving

- **`map.json`** is written on every change, in the same hand-written style, so `git diff` shows
  just what changed. You can edit it in VS Code while the editor runs: the editor picks the change
  up (as one undo step) and the markers move.
- **The world** is saved back into `maps/<id>/world` when the editor stops, but only when blocks
  changed (someone placed or broke one, or a new map's glass pad), or a map editor switched
  **World** to saved. A session that only places spawns leaves the world files untouched.
- Before saving, the editor removes every marker, including ones in chunks nobody is near, and
  saves only when none are left. The saved world gets the usual baked settings (noon, no weather or
  mobs, void generation).
- A map with `build` commands is rebuilt from them by `npm run bake`, which would replace block
  changes. Drop the commands from the map menu to keep them.

## How it works

- `npm run editor` (`tools/editor/`) starts the container `minecade-editor` on the plain BDS image
  that `npm run bake` uses, with the editor's packs (`editor/`), the shared packs, the map's world
  and `map.json` copied in. The container's entrypoint is `docker/bds/entrypoint.sh` in editor mode.
- The editor's pack applies each change at once and writes an `[EDIT] {json}` line to the server
  log. The host applies the same change with the same code (`applyEdit` in minigame-core), writes
  `map.json`, keeps undo and redo, and answers with `scriptevent minecade:edit {json}` on the
  console. If the two copies ever differ, the host sends the whole map again.
- The host answers on `127.0.0.1:8097` (`GET /status`, `POST /stop`), which the Panel and
  `npm run editor -- status | stop` use. When the Panel starts the editor, its output goes to
  `work/editor/editor.log`.
- **The side menus** are classic forms themed by the editor's resource pack, like the lobby's
  menus (`docs/ui.md`): a title starting with the side mark (`LAYOUT.side` in
  `editor/behavior_pack/scripts/menu.ts`) gets the layout in `editor/resource_pack/ui/editor_forms.json`,
  and a button marked as a switch (`MARK.toggle`, plus `MARK.on`) shows an on or off picture. The
  tools are listed in `scripts/tools.ts`: a new tool adds a row there and gets its switch. The art
  comes from `tools/assets/make-assets.py`.
- **The facing line** is part of the marker's model (`editor/resource_pack/models/entity/editor_marker.geo.json`,
  the `facing` bone), drawn glowing with the hologram's additive material. The marker spawns turned
  to the entry's yaw, so the line (the model's front) points that way, and a client-synced property
  tilts it by the pitch. A marker whose facing changes is placed again.

## Shared blocks pack

`packs/blocks/` holds custom blocks that every server loads (the lobby, every game and the
editor), so a map using them works anywhere. It's empty until the blocks land; see its README.

## Troubleshooting

- **"A map editor is already running":** `npm run editor -- stop`, or Stop on the Panel.
- **Can't join:** check that your gamertag is in `LAN_PLAYERS` or `EDITOR_ALLOW_LIST`, and that
  port 19134 is forwarded and allowed (see the README).
- **No tools:** you're a builder. Add your gamertag to `MAP_EDITORS` (or leave it empty and be in
  `LAN_PLAYERS`), then restart the editor.
- **The world wasn't saved:** the editor's log says why (markers it couldn't remove, or no block
  changes). `map.json` still has every change.

# Map editor

The map editor is a Bedrock server on port 19134 where you set a map's data in game: spawns, the
spectator spawn, named points, the bounds, kill Y and regions, with a checklist of what the map's
game still needs. Every change goes straight into the map's `map.json`. This page covers Edit mode
as it is today; Select mode (cutting maps out of a converted world) and Preview come in later passes
of milestone 10 (see `docs/plans/map-editor.md`).

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

**Restarting** (for new editor code, or new settings in `.env`): **Stop**, wait until the page
says the editor has stopped, then **Start** again. From a terminal: `npm run editor -- stop`, then
`npm run editor -- <target> <map>`. The editor runs the code in the checkout it starts from (the
main checkout, for the Panel), so restart it after new editor code is merged there.

The Panel's server runs the code it opened with, but it reads its page from disk on every request,
so an old Panel can show the new **Map editor** page while its server can't start the editor (Start
does nothing, or says "not found"). After an update to the Panel, close every Panel window, wait
about 20 seconds for it to exit, and open it again.

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

The map menu, the checklist, a marker's form and the region and Kill Y tools' menus open as a dark
panel down the right side of the screen, full height, so the world stays in view on the left. Their
buttons run top down and scroll when there are more than fit. Esc or the X closes them. The forms
with fields (the spawn tool's Place form, Map settings, Change list, Renumber, Save as, Nudge sides,
a typed kill Y) are the game's own, in the middle of the screen.

- **Map menu** (slot 9, locked, map editors only): the map's name and game, then:
  - **Checklist:** each thing the map's game needs, green when done, with what the build would
    refuse the map for. Tap an entry to get its tool, already set to that list.
  - **Tools** (the Spawn tool, the Region tool and the Kill Y tool): each is a switch. On puts the tool in slot 1 and in your
    hand, and the menu closes. Off takes it away. One tool is out at a time: switching one on puts
    any other away. The tool isn't locked, so you can move it; whatever was in slot 1 moves to a
    free slot.
  - **Selection** (when you have one): the region tool's form, for places where a block is always
    in reach, such as indoors.
  - **Bounds and regions** (when the map has any): every box the map has. Tap one to **Edit** it
    (it becomes your selection, then Save changes writes it back), **Nudge** its sides (saved at
    once), **Go to** it (on top, over its middle), or **Delete** it.
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
- **Region tool:** picks a box, for the bounds, a region or a kill region (anyone inside a kill
  region is out).
  - **Hit a block** to start a new selection: that one block.
  - **Use the tool on a block**, up to 64 blocks away, to grow the selection to it, on every axis.
    Any box can be picked without placing blocks: hit one corner, then use the tool on the blocks
    at the far edges. The size shows above the hotbar.
  - **Use the tool at the air** (no block within 64 blocks) to open the region form:
    - **Save changes** (when the selection came from Edit, or was saved already): writes it back.
    - **Save as:** the bounds, a kill region, a region the game asks for (one per team when it
      asks for that), a region the map already has, or a new region you name (letters, digits
      and `_`). A region holds a list of boxes, and each save adds one.
    - **Nudge sides:** moves each side up to 16 blocks out (above 0) or in (below 0).
    - **Floor at kill Y:** puts the bottom of the box at kill Y.
    - **Back one step** undoes the last change to the selection; **Clear selection**.
  - The checklist's bounds and region rows give you the tool already set to that row.
- **Kill Y tool:** players below kill Y are out. Use it to set kill Y one block below your feet, to
  type a height (from -64 to 319), or to remove it.
- **Outlines:** while you hold the region tool or the Kill Y tool, dots outline your selection
  (yellow), the bounds (white), kill regions (red), each other region in its own color (a team's
  region in the team's color), and the kill Y plane (red). Only you see them. They're drawn within
  about 40 blocks of you, and get sparser on a big box, so they stay smooth on any map. They stand
  in for the boundary blocks of a later pass.

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
- **Can't join:** first check that an editor is running (the Panel's Map editor page, or
  `npm run editor -- status`): with none running, nothing answers on port 19134 and the join
  fails. If the Panel's Start does nothing, restart the Panel (see Restarting above). Then check that your gamertag is in `LAN_PLAYERS` or `EDITOR_ALLOW_LIST`, and that port
  19134 is forwarded and allowed (see the README).
- **No tools:** you're a builder. Add your gamertag to `MAP_EDITORS` (or leave it empty and be in
  `LAN_PLAYERS`), then restart the editor.
- **The world wasn't saved:** the editor's log says why (markers it couldn't remove, or no block
  changes). `map.json` still has every change.

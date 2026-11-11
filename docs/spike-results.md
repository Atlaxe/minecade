# Spike results (milestone 1)

Run on 2026-10-28 with BDS 1.26.60.6 in Docker Desktop 4.45.0 (WSL2) on Windows 11.
Re-run any time with `npm run spike:build && npm run spike:world && npm run spike:up`.

## Automated results

| Check | Result | Notes |
|---|---|---|
| 1a. Two BDS containers on different ports | PASS | Lobby TCP+UDP 19132, game TCP+UDP 19133. Each boots in about 2 s and logs `Server started.` |
| Beta APIs via level.dat patch | PASS | `experiments.gametest = 1b` via prismarine-nbt. BDS logs `Experiment(s) active: gtst`. |
| Stable `@minecraft/server` 2.11.0 + beta modules | PASS | Manifest `"@minecraft/server": "2.11.0"` loads alongside `"@minecraft/server-admin": "1.0.0-beta"` and `"@minecraft/server-net": "1.0.0-beta"`. |
| 1c. server-net HTTP to a compose service | PASS | GET/POST to `http://relay:8080/` return 200. First request about 220 ms, later about 100 ms. A 3 s long-poll returns in 3.05 s. |
| server-net URL allowlist | PASS | A URI outside `allowed_uris` throws `UriNotAllowedError: Request URI is not permitted by configuration.` immediately. |
| 1d. `[NET]` log lines on stdout | PASS | `console.warn`, `log`, `info` and `error` all reach stdout as `[<timestamp> WARN] [Scripting] [NET] {...}`. There is no buffering delay on a pipe (`Tty: false`). |
| 1d. `scriptevent` on stdin | PASS | `scriptevent minecade:net {json}` written to the container's stdin arrives with `sourceType: "Server"`. Round trip is about 230 ms. BDS logs `Script event minecade:net has been sent` for each one. |
| scriptevent size limit | PASS | A 1955-char message works. Over 2048 chars, BDS logs `Message length exceeds (2048) character limit!` and drops it. |
| Dual LAN + public `server-udp-ports` entry | **FAIL** | `ERROR server-udp-ports: conflicting per-entry IPs`. Each server can advertise only one IP. |

## Transport decision

Both transports work. **Default: HTTP** (`TRANSPORT=http`): structured requests, no log scraping, and a long-poll for inbound messages. **Log/stdin** (`TRANSPORT=log`) stays a fully supported fallback.

## Config that works

`config/default/permissions.json` (HTTP transport only; the log transport needs no change):

```json
{
  "allowed_modules": ["@minecraft/server-gametest", "@minecraft/server", "@minecraft/server-ui",
    "@minecraft/server-admin", "@minecraft/server-editor", "@minecraft/debug-utilities", "@minecraft/server-net"],
  "module_permissions": { "@minecraft/server-net": { "allowed_uris": ["http://orchestrator:8080/"] } }
}
```

### server.properties facts (from the 1.26.60.6 file itself)

- `allow-list=true` is the default. It must be set explicitly, or nobody can join.
- `level-type` no longer exists.
- `transport=nethernet` is the default. `server-port` is the TCP signaling port.
- `server-udp-ports` supports a **single UDP port shared by all clients** (the default mode) or a range, with an optional `IP:public:local` prefix. Only one IP per server.
- **Server identity:** BDS loads `keys/server_identity_key.pem` (unencrypted P-384). Without it, it makes up a new identity at every start and players must accept server trust again (from `bedrock_server_how_to.html`). The entrypoint keeps one key per role (`lobby`, `game`) in the `minecade-keys` volume.

## Network design consequence

Each server uses one TCP port and one UDP port with the same number. **Router forwards: TCP and UDP 19132-19134**, which matches the original brief. Each server advertises the public IP (`<public>:<port>:<port>`). A player on the host's own LAN therefore needs router NAT loopback, or a fallback (see pending tests).

## Client results (Windows PC on the same LAN, 2026-10-28)

| Test | Result | Notes |
|---|---|---|
| PC joins `192.168.40.98:19132` (lobby, public IP advertised) | PASS | NetherNet works through Docker Desktop port publishing. |
| PC joins `192.168.40.98:19134` (probe-lan, LAN IP advertised) | PASS | |
| PC joins `192.168.40.98:19135` (probe-auto, no IP advertised) | PASS | |
| PC compass transfer via LAN address, both directions | PASS | Script `transferPlayer` works. |
| PC compass transfer via public address | FAIL (expected) | "Multiplayer Connection Failed". TCP to the public IP fails from inside the LAN: the router does no NAT loopback. |

What this settles:

- The advertised UDP address does not matter to a LAN client, so every server advertises the public IP.
- A player on the host's LAN must be transferred by LAN address. `LAN_PLAYERS` in `.env` lists those gamertags, and every other player gets the public address.

## Remote client results (phone on cellular data, 2026-10-28)

Router forwards for TCP+UDP 19132-19134 are in place (Plume).

| Test | Result | Notes |
|---|---|---|
| Remote client joins `<public IP>:19132` | PASS | Phone on cellular data, same account with the PC client closed. Proves the forwards and the public UDP advertisement. |

## Still open (needs a friend)

| Test | Expected |
|---|---|
| Remote client compass transfer via public address, both directions | Proves transfers through the forwards |
| Console via BedrockConnect, same steps | Low risk: BedrockConnect itself moves consoles with the same transfer packet |
| Two players on one server (one LAN, one remote) | Proves the shared single UDP port with mixed clients |

If a deferred test fails, the likely fixes are configuration (forwards, advertised IP, Docker network mode), not code. A single account can also run the remote test from a phone on cellular data, with Minecraft fully closed on the PC.

## Damage events (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-10-29)

Measured headless on mobs with `/damage`, armor, effects and real arrows. The combat code in `packages/minigame-core/src/game/combat.ts` relies on these facts.

| Question | Finding |
|---|---|
| `beforeEvents.entityHurt` `damage` | **After** armor and resistance: diamond armor turned 10 into 3, resistance II turned 5 into 3, magic ignored armor. Absorption is not reflected. |
| Health read inside the before-event | **Already reduced by the hit** (health 10, hit 4: reads 6, and negative on a killing blow). Health before the hit = reported + damage. |
| `afterEvents.entityHurt` `damage` | Equals the health actually lost, except with absorption (absorption is spent after the event). |
| `cancel = true` | Blocks the damage **and** the knockback; no after-event fires. |
| Writing `damage = N` | Sets the final amount, lower or higher; armor is not applied again. |
| `/kill`, void, fall | All fire both events. Causes: `selfDestruct` (damage = remaining health), `void` (4 every 10 ticks), `fall`. |
| Projectiles | A real arrow: `damagingEntity` = shooter, `damagingProjectile` = `minecraft:arrow`. With no owner, both are the arrow. |
| Invulnerability frames | A stronger second hit fires the before-event with only the difference; a weaker or equal one fires nothing. |

## Knockback (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-10-29)

Measured headless with real player melee hits: two SimulatedPlayers (@minecraft/server-gametest `1.0.0-beta`, npm `1.0.0-beta.1.26.60-stable`) 1.5 blocks apart on a stone floor, adventure mode, peaceful, hitting with `attackEntity()` (`attack()` gives identical numbers), with the victim's position and `getVelocity()` sampled every tick for 30 ticks. Simulated players move on the server; a real client receives the same velocity, but how it plays it back was not checked. Rerun: `npx tsx spike/knockback/run.ts` (raw data goes to `spike/results/knockback.json`).

| Question | Finding |
|---|---|
| SimulatedPlayers on BDS | **Work.** `spawnSimulatedPlayer(location, name, GameMode)` needs no registered test, structure or `/gametest` command; only Beta APIs and the module in `permissions.json`. The container needs a network: with none, BDS hangs at "Waiting for Minecraft services". |
| Vanilla hit | Victim velocity on the next tick: 0.4 horizontal, 0.4 up. Peak height 1.15 blocks at tick 5, lands at tick 11, 1.79 blocks away at tick 10, settles at 2.07. Bare hand, wooden sword and iron sword knock back the same (damage 1, 5, 7). All three events fire in the attack tick. |
| Direction | From the attacker's position to the victim's, on XZ. The attacker's facing is ignored (turned away: same result). Off-axis attacker: velocity (0.222, 0.333) = 0.4 x the unit vector. |
| Sprinting attacker | 0.6 horizontal, 0.32 up: peak 0.78 at tick 4, settles at 2.87. The same with only the `isSprinting` flag set and with a real run-up. |
| `damage = 0` | Knockback **identical to vanilla** (4 decimals, normal and sprint). Health stays 20. The after-event fires with `damage` 0. Hurt flash and sound are not observable headless. |
| `cancel = true` | No knockback, health 20, no after-event. `afterEvents.entityHitEntity` **still fires** for the swing. |
| `applyKnockback(horizontalForce, verticalStrength)` | Linear: horizontal velocity = 0.4 x the length of `horizontalForce`, vertical velocity = `verticalStrength` (h 0.4, 0.5, 0.9, 1.0, 1.1, 2.0 settle at 0.83, 1.03, 1.86, 2.07, 2.28, 4.14; v 0.3, 0.4, 0.5 peak at 0.70, 1.15, 1.71). **Unit vector x 1.0 with 0.4 matches a vanilla hit at every tick; x 1.5 with 0.32 matches a sprint hit**, also on an airborne victim. |
| Scripted timing | Called in `afterEvents.entityHitEntity`, it lands on the same tick as vanilla: `getVelocity()` reads 0 right after the call (as it does right after a vanilla hit) and the victim first moves on the next tick in both. |
| Victim hurt cooldown, vanilla | 10 ticks. A second attacker's equal hit at tick 1, 5 or 9 fires only `entityHitEntity`: no hurt events, no knockback. At tick 10 it is a full hit. A stronger hit inside the window (iron sword after a fist) fires both hurt events with the difference (6) **and knocks back again**. |
| Victim hurt cooldown, `damage = 0` | Still 10 ticks with no knockback, stronger hits included. Since the remembered damage is 0, any hit inside the window fires the before-event (with its full damage) but no after-event and no knockback. |
| Victim hurt cooldown, `cancel = true` | **None.** A second attacker at tick 1, 5 or 9 fires the before-event and `entityHitEntity`, and scripted knockback stacks: settles at 3.66 (tick 1) and 4.36 with a 2.31 peak (tick 5), against 2.07 for one hit. |
| Same attacker swinging again | `attack()` and `attackEntity()` return false for 10 ticks after a hit (tick 9 refused, tick 10 accepted) in every mode, **even on a different target**, and refused swings fire no events. That is a SimulatedPlayer swing cooldown, not the victim's; Bedrock clients have no swing cooldown, so for spam clicking under `cancel` the second-attacker row is the one that applies (not verified with a real client). |

Recommendation for Sumo: set `damage = 0` in `beforeEvents.entityHurt` rather than canceling. It gives exact vanilla knockback (direction, sprint bonus, hits on an airborne player) with nothing to tune, health stays full, and the engine's 10-tick hurt cooldown per victim still stops spam clicks and second attackers from chaining knockback, so no cooldown of our own is needed. Two consequences in `combat.ts`: its `damage: "none"` path cancels every hit, which removes knockback entirely, so for melee it should write 0 instead; and kill credit is recorded in the before-event, which in this mode also fires for hits that do nothing inside the cooldown, so take credit from `afterEvents.entityHurt` (it fires only for hits that land) unless a no-op touch taking credit is acceptable. Keep "cancel + scripted" for non-vanilla knockback: in `afterEvents.entityHitEntity`, take the unit XZ vector from attacker to victim and call `applyKnockback({ x: ux * 1.0, z: uz * 1.0 }, 0.4)`, or `{ x: ux * 1.5, z: uz * 1.5 }, 0.32` when `damagingEntity.isSprinting`, then scale. That mode removes the victim's hurt cooldown, so it must add its own: ignore hits on a victim within 10 ticks of its last accepted hit (per victim, not per attacker).

### A push on top of a hit, and in the air (checked 2026-11-11)

Same rig, with a cases file (`npx tsx spike/knockback/run.ts cases.json`) and two new case fields in the pack: `jump` (the victim jumps at tick 0) and `push` (`[tick, h, v]`: `applyKnockback({ x: 0, z: h }, v)` on the victim at that tick).

| Question | Finding |
|---|---|
| `applyKnockback` after a landed hit (`damage = 0`, called in `afterEvents.entityHitEntity` of the same tick) | **Halves the hit's speed and adds its own.** Unit x 1.0 on top settles at 3.10 (vanilla 2.07); x 1.5 settles at 4.14, exactly a canceled hit pushed at x 2.0, so **x 1.5 on top is twice vanilla**. The height stays vanilla's (peak 1.15 either way). Sprint hit: x 3.0 with 0.32 on top settles at 7.17 (vanilla sprint 2.87; x 2.25 is twice). |
| Upward speed of a push in the air | `min(v + (vy + 0.125) / 2, v)`, with `vy` as `getVelocity()` reads in that tick: rising (0.25) a push of 0.5 gives 0.5; falling at -0.15 it gives 0.486, at -0.30 0.413. So rising it's capped at `v`, and falling it keeps half the fall (less 0.0625). A jump is 0.42 up (peak 1.25); a push of 0.5 from the ground peaks 1.71. |
| Sideways push in the air | Unchanged rule: 0.4 x the force's length (0.75 gave 0.30 a tick). |

What the code does with this: Sumo's default `knockback.mode` is "vanilla" (its `onDamage` returns 0 for melee hits), and "scripted" uses the numbers above with a 10-tick cooldown per victim and credits its own pushes. Since 2026-11-11 Sumo knocks twice as far (`knockback.strength` 2, the user's ask): in vanilla mode each hit that lands (`afterEvents.entityHurt`, so not the taps the hurt cooldown drops) gets a push of 1.5 (2.25 sprinting) on top, keeping the hurt flash and the cooldown; scripted mode multiplies its horizontal numbers. Its double jump pushes up at `0.5 - min(0, vy + 0.125) / 2`, so it rises the same whether the player is going up or falling. `combat.ts` now takes kill credit from `afterEvents.entityHurt`, plus lethal hits it intercepts, so a tap inside the cooldown can't steal a knock-off. `damage: "none"` stays "cancel every hit" (for games where hits should do nothing at all); games that want push-only hits return 0 from `onDamage` instead.

## Block physics (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-11)

Measured on a throwaway BDS (`npx tsx spike/physics/run.ts`): red concrete powder, sand and an anvil
put in the air over a stone floor, by script and by a creative SimulatedPlayer
(`useItemInSlotOnBlock` against a pillar's side), each checked 10 or 20 ticks later and again after
a block was set beside it. The runner also loads Build Swap's twins (`games/buildswap/behavior_pack/blocks`).
The twins' list is minigame-core's `src/building/still-blocks.ts` now, shared with Guess the Build.

| Question | Finding |
|---|---|
| A gravity block a script puts in the air | **Falls**, every way: `setType`, `setPermutation`, `/setblock`, `fillBlocks`, and a structure placed there. One falling block entity each, the block lands on the floor. |
| A player's | `playerPlaceBlock` fires in the placing tick; the falling block entity spawns **2 ticks later** (cause Spawned), a block lower. |
| Putting it back | Removing the falling block entity and setting the block again (`setPermutation` in `entitySpawn`) only starts another fall; setting it to air and back in `playerPlaceBlock` still falls. A script can't keep a vanilla gravity block up. |
| A custom twin (no gravity) | **Stays**: set in the air by script, and in place of a player's block in `playerPlaceBlock` (no falling block entity ever spawns), and after a neighbor update. All 23 of Build Swap's twins load with no content errors. |
| Anvil states | `minecraft:anvil`, `minecraft:chipped_anvil` and `minecraft:damaged_anvil` are separate blocks, each with `damage` (undamaged, slightly_damaged, very_damaged), `minecraft:cardinal_direction` and the older `direction` (0 to 3). Placed looking north it was `west`, direction 1. Concrete powders carry a `color` state (light gray's is `silver`). |

What the code does with this: Build Swap swaps each gravity block a builder places for its twin in
`playerPlaceBlock` (`still-blocks.ts`), and `/set`, `/replace` and `/floor` fill with twins.
Before, the game's "nothing spawned stays" rule removed the falling block entity, so concrete
powder placed in the air just vanished.

## Arena tiles (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-11)

`npx tsx spike/tiles/run.ts` boots a throwaway server (`minecade-tilescheck`, no published ports) on
a void world with no players. Its script builds a 40 by 31 by 40 arena at the origin (a stone floor,
a gold block, glass in the far corner, water), loads it with a ticking area, saves it as a structure
in memory, and copies it to eight tiles in a 3 by 3 grid and one 1000 blocks away, each loaded by a
ticking area of its own.

| Question | Finding |
|---|---|
| The ticking area limit | `world.tickingAreaManager.maxChunkCount` is **300** (chunks, all of a world's script ticking areas together; overlapping chunks count twice). One area's sides are capped at 255 chunks. |
| Loading void chunks nobody has visited | `createTickingArea` resolves **2 to 3 ticks** later, the chunks generated (void) and loaded. |
| Copying the arena there | `structureManager.place` right after works: every tile had the gold block, the glass and the water where the arena does, 1000 blocks away too. |
| A 40 by 40 arena | 9 chunks for the first, 4 to 9 more for each copy (copies share chunk columns at their edges): 73 for the nine. |
| How big the copies can be | `hasCapacity`: true for 8 arenas 64 blocks across in a row, or 4 by 2 of them; false for one area 300 by 300. |
| A chunk with no area and no player | `getBlock` there gives **undefined** (not loaded), 1000 blocks out before its area and again 5 seconds after removing it. With its area kept, saving it as a structure works with nobody near. |

What the code does with this: a building game's map has one arena (Build Swap, Guess the Build), and
the game copies it once per player before the match (minigame-core's `game/arenas.ts`), each copy
keeping its own ticking area until the match ends, so builds can be saved and put back in any of
them. An arena is at most 80 blocks on a side (the game's `maxSize`): 8 copies of that take at most
288 chunks, leaving room for a preview's fake players (one chunk each).

## Custom command names (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-11)

`npx tsx spike/commands/run.ts` registers custom commands and runs them from the console.

| Question | Finding |
|---|---|
| `minecade:/wand` and `minecade://wand` | **Registered** without complaint, but `/wand` (what a player's `//wand` reaches the server as) fails: "Unknown command: /". The parser splits the second slash off, so WorldEdit's `//` commands can't work. |
| `minecade:wand`, `set`, `replace`, `fix` | Run by their bare names (`wand`, `set stone`); no vanilla command is in the way. `minecade:-set` runs as `-set` too. |
| A `BlockType` parameter | Takes a bare id (`set stone`, `set red_concrete_powder`) and gives the script `minecraft:stone`. |

What the code does with this: Build Swap's selection commands take one slash: `/wand`, `/set`,
`/replace`, `/fix`.

## Map editor (pass 10.1, BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-10-30)

Source: a copy of the user's converted world "Datapacking (imported)" (6.8 MB, a void world with a
terracotta floor, last opened with 1.26.60). Its builds were found by reading the LevelDB keys and
sub-chunk palettes (13 separate builds once the floor is ignored). The test build ("B") spans
chunks x 6..12, z -5..2 (blocks x 96..207, z -80..47, y -64..0): 156,583 blocks, 133 containers,
172 signs. Automated part: `npx tsx spike/editor/run.ts "<world folder>"` (results in
`spike/results/editor.json`); in-game part: `spike/editor/ingame.ts`.

**Who checked what:** the rows marked "(in game)" were done by the user on the test servers and
confirmed in their logs. Every other row ran headless: scripts and throwaway test servers with no
player, checked by fingerprints, file listings and container output.

| Check | Finding |
|---|---|
| Chunker CLI in Docker | **Works.** `minecade/chunker:local` (`docker/chunker/Dockerfile`: Temurin 21 JRE, `chunker-cli-1.21.0.jar` pinned by checksum). `-f INPUT` keeps the world's version (Bedrock 1.26.60 to 1.26.60; `BEDROCK_R26_60` also exists). Pruning file: `{"configs": {"minecraft:overworld": {"include": true, "regions": [{"minChunkX", "minChunkZ", "maxChunkX", "maxChunkZ"}]}}}`, chunk coordinates, inclusive. The whole world prunes to one build in about 5 s; a second prune of the moved build takes 2 s. Only the chosen chunks remain, and BDS loads the result. |
| Chunker and its input | **Chunker rewrites its input world** (it compacts the database when it opens it). Always run it on a copy. The runner copies worlds into the container (`putArchive`), so no host folder is ever opened by Chunker. |
| Chunker and level.dat | Its output level.dat drops `FlatWorldLayers` and the experiments. Without the layers, new chunks could generate the default flat preset, so the bake settings (void layers, spawn, gamerules) must be applied after every prune. |
| Structure size | `structureManager.createFromWorld` accepts at most **64x384x64** (its error says so). A map is moved in 64x64 columns of full height. |
| Moving a build | Capture every column (in memory), clear the old box (entities, then air in 32-block cubes with `fillBlocks`), place every column at the new spot. Clearing first makes an overlapping move safe. Build B: capture 36 ms, clear 0.2 s, place 0.8 s per pass. |
| Attached blocks | Placed once, 4 blocks went missing (2 signs among them): blocks attached to a block in a column not placed yet pop off. **Placing every column twice** fixes it (no losses, no dropped items); total move 2.0 s. |
| Exactness | After the move, save, prune and reload, the build's fingerprint (every block's type, states, container contents and sign text, by relative position) **matches the original exactly**. Right after the move, only 30 walls differed (their live connection states); they match again after the reload. Item frames and paintings weren't in the test build, so they're unchecked. |
| Staging a world | Copying the whole 6.8 MB world into a container: 0.2 s. BDS boots in 2 s. |
| First console command | The first command sent right as BDS prints "Server started." can arrive garbled ("Unknown command: {"). The host must confirm each command's reply (or retry), as the runner does for ticking areas. |
| Custom items (in game) | **Work.** A custom item (`items/*.json`, format 1.21.60) shows its own icon from `textures/item_texture.json`. `afterEvents.itemUse` fires on every use (right click) **whether aimed at air, a block or a marker**: `playerInteractWithBlock` never fired for this item. Tools find what the player aims at themselves on each use (`getBlockFromViewDirection`, `getEntitiesFromViewDirection`). `afterEvents.entityHitBlock` reports hits; in creative mode a hit still breaks the block, so the real tools must cancel breaking while held. |
| Marker entities (in game) | **Work** for hits: a summonable custom entity with a name tag always shown, and `afterEvents.entityHitEntity` reports hits on it, with no damage taken. **Tapping (use on) a marker does nothing:** `playerInteractWithEntity` never fired (the entity has no interact component), and the use counts as a plain `itemUse`. Markers are edited by hitting them. |
| Transfers (in game) | **Work** on the LAN: `transferPlayer` from port 19134 to 19133 and back, each server with its own saved identity (the new `editor` key is in the `minecade-keys` volume, so the trust prompt comes once). From outside the network is still untested (`docs/to-test.md`). |
| `op` from the console | Not settled: the test world was a copy of the user's own world, which already saved them as an operator. Pass 10.3 checks it on a fresh map world. |
| Sneaking | The user's note: **you can't sneak while flying** in creative (sneaking flies you down), so editor controls never use sneak combinations (`docs/plans/map-editor.md`, "Controls"). |
| Bind mounts for Preview | **Work.** A container created through the Docker socket from inside the orchestrator container can mount `dist/templates` from this PC with any of `C:\dev\...`, `C:/dev/...`, `/c/dev/...` or `/run/desktop/mnt/host/c/dev/...` (Docker Desktop translates them). Preview can mount the local build directly. |

## Vanilla block shapes for painting (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-03)

Read from a throwaway game server's script (`BlockTypes`, `BlockStates`, `BlockPermutation`), for
Paintball's painted blocks. No experiments on (the worlds have only Beta APIs).

| Check | Finding |
|---|---|
| Concrete shapes | **Concrete stairs, slabs and double slabs exist** in every color (`minecraft:red_concrete_stairs`, `minecraft:green_concrete_slab`, `minecraft:blue_concrete_double_slab`). There are no concrete walls. |
| Stairs | States `minecraft:corner` (`none`, `inner_left`, `inner_right`, `outer_left`, `outer_right`: the corner is stored, not worked out by the client), `weirdo_direction` (0 to 3), `upside_down_bit`. Concrete stairs have the same states as oak stairs, and every stair has the `minecraft:cornerable_stairs` tag. |
| Slabs | `minecraft:vertical_half` (`bottom`, `top`); a wooden slab also has `top_slot_bit` and `wood_type`, concrete slabs only the half. |
| Walls | `wall_connection_type_north`, `_east`, `_south`, `_west` (`none`, `short`, `tall`), `wall_post_bit`, plus `wall_block_type`. |
| Fences, panes, iron bars | Their sides are stored: `minecraft:connection_north`, `_east`, `_south`, `_west` (booleans); a stained pane also has `color`, a wooden fence `wood_type`. |
| Gates, doors, trapdoors | Oak's are still `minecraft:fence_gate`, `minecraft:wooden_door` and `minecraft:trapdoor` (`minecraft:oak_fence_gate` doesn't resolve). Gates: `minecraft:cardinal_direction`, `open_bit`, `in_wall_bit`. Doors: `minecraft:cardinal_direction`, `open_bit`, `upper_block_bit`, `door_hinge_bit`. Trapdoors: `direction` (0 to 3), `open_bit`, `upside_down_bit`. |
| Other states seen | `minecraft:cardinal_direction` values are `south`, `west`, `north`, `east`; carpets have `color`; logs `pillar_axis`; leaves have the `minecraft:leaves` tag. |
| The guns pack | Its items and entities (`packs/guns`) load with no content log errors. |

## Painted shapes (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-04)

`npx tsx spike/paint/run.ts` boots a throwaway server (`minecade-paintcheck`, no published ports)
with Paintball's painted blocks and places each vanilla door, fence gate and trapdoor in every state
beside the painted block Paintball makes of it, then casts rays at both from every side.

| Check | Finding |
|---|---|
| Painted blocks | All 28 load with no content log errors, and Bedrock takes every one of their 1,048 states. A block that names a custom component (`minecade:paint_use`) fails to load unless a script registers it at startup. |
| Doors | `minecraft:cardinal_direction` is a quarter turn from Java's `facing`: a shut door whose cardinal direction is `south` stands on the west side of its block, as a Java door facing east (`west` is Java's south, `north` west, `east` north). `door_hinge_bit` true is Java's right hinge. Facing and open come from the lower half, the hinge from the upper. |
| Gates | `minecraft:cardinal_direction` is Java's `facing`. |
| Trapdoors | `direction` 0 to 3 is Java's east, west, south, north (as stairs' `weirdo_direction`); `upside_down_bit` is the top half. |
| Shapes | With those, all 40 vanilla states (16 doors, 8 gates, 16 trapdoors) paint to blocks hit in the same places from every side. Custom blocks' collision and selection boxes mirror x as their geometry does (x 0 to 3 in Java's coordinates is origin 5 to 8). A ray hitting a custom block's face on its east, south or top edge reports it at 0, where vanilla's says 1. |

## Held guns: where a held model sits, aiming and left clicks (2026-11-04)

What the guns' second pass is built on (`tools/assets/guns.ts`, `packages/guns`). Only the content
log was checked on a server; the rest waits on a look in game.

| Check | Finding |
|---|---|
| Where a bound model sits | Bedrock draws a model bound to the hand (`q.item_slot_to_bone_name`) 24 pixels lower than its coordinates say: the Bedrock Wiki's attachable guide moves `rightItem` by (-6, -9, -1) to match it, and Mcblend's docs give the same 1.5 block drop. The first pass ignored it, so the guns sat a block and a half off the hand. **2026-11-08: not in third person** (see "Holding in third person" below). |
| First person | Blockbench's attachable preview (`js/formats/bedrock/attachable_preview.js`) draws first person with the camera at (0, 27.41, 0) looking along +z, a 70.25 degree field of view, and the arm in vanilla's `animation.player.first_person.empty_hand` pose (turned (95, -45, 115), moved (13.5, -10, 12)). A small simulator built on that drew the vanilla trident where the game draws it (low right, leaning up and left), then placed the guns. |
| Vanilla arm poses | `animation.player.holding` raises a held item's arm 18 degrees in third person. The first-person swing (`first_person_attack_rotation_item`) and the third-person one only play while no item is in use (`variable.item_use_normalized <= 0`), so a shot fired while aiming doesn't swing. |
| Left click | `world.afterEvents.playerSwingStart` is in @minecraft/server 2.11.0 stable, with `swingSource` (Attack, Mine, Build, Interact, UseItem, DropItem, ThrowItem, Event, None). **Seen in game (2026-11-04): no left click arrives while right click is held** (an item in use), so aiming is a right click toggle. Still unseen: which source a click at the sky reports, and whether a held button repeats the swing. |
| Short swing | `minecraft:swing_duration` (item format 1.21.120 or later, `{ "value": seconds }`) loads with no content log errors. |
| Recoil off a cooldown category | Microsoft's Molang docs say `q.cooldown_time_remaining` takes a cooldown category as well as a slot. The guns start a hidden item's cooldown per shot (`minecade:<gun>_shot`) and the held model reads its category, so the recoil keeps its own timing apart from the gun's own cooldown (its fire rate, shaded over its hotbar slot). The aim works the same way (`minecade:aim_marker`). **2026-11-07: it never ran:** starting a cooldown through an item throws (see "Recoil" below). |
| The guns pack | Its 64 items, 3 shot markers and the landed grenade entity load with no content log errors. |
| Icons drawn by the game | Microsoft's docs: an item with `minecraft:block_placer` and no `minecraft:icon` shows its block as its icon, in 3D, the way a wall or a banner shows. Each gun places a hidden block holding its model (a block's model must fit in 30 pixels, so the long guns are shrunk), only on itself, so it's never placed. The blocks and the guns with `block_placer` load with no content log errors; unseen in game. |
| Dyeing leather | Setting `ItemDyeableComponent.color` on vanilla leather from a script left Probe's team armor brown in game. Mojira reports that a custom item's `minecraft:dyeable` `default_color` only tints the inventory icon, not held items or dropped ones. So team leather is 64 items of its own (`packs/armor`), Minecraft's leather textures tinted by the build; they load with no content log errors. |

## The arsenal: items, entities, raycasts and a rocket's flight (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-06)

`npx tsx spike/arsenal/run.ts` boots a throwaway server (`minecade-armscheck`, no published ports)
with the shared guns behavior pack and `spike/arsenal/probe.ts` on a void world. Only the server
side: the particles, held models and client entities wait on a look in game.

| Check | Finding |
|---|---|
| The arsenal's files | Its 15 items, 9 shot markers, 15 model blocks and 4 entities load with no content log errors. An item's cooldown category can't be read from a script on 2.11.0 (the getter throws); the component is there. |
| Entity properties | A `setProperty` takes effect at the end of the tick: read straight back it's still the old value, a tick later the new one (the thrown, landed and pickup entities' `minecade:model`). |
| `getBlockFromRay` | Reports the block and the face the ray entered by, and `faceLocation` exactly on that face (a ray at a wall 5.5 blocks south: the block's north face, z 0). |
| `getEntitiesFromRay` | Each hit's `distance` is to where the ray enters the entity's box (an armor stand 3 blocks south: 2.65). Without `ignoreBlockCollision` a block between stops it (the stand behind a wall: no hits). `getHeadLocation` on an armor stand is 1.68 over its feet. |
| A custom projectile's flight | Without a vanilla `runtime_identifier`, a projectile moves as a plain entity: it keeps 0.91 of its speed a tick and falls under the world's gravity (a rocket shot level at 1.6 blocks a tick fell 6.4 blocks in 9 ticks), whatever its `minecraft:projectile` says (`inertia: 1` and `minecraft:physics` `has_gravity: false` change nothing but the fall). With `runtime_identifier` `minecraft:snowball` (or `minecraft:arrow`) it keeps exactly the speed it was shot at and falls only by the component's own `gravity`. The rocket uses the snowball's; Paintball's balls and grenades keep the plain flight the user has seen. |

## Recoil: cooldowns, and turning a player's view (BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-11-07)

`npx tsx spike/recoil/run.ts` boots a throwaway server (`minecade-recoilcheck`, no published ports)
with the shared guns behavior pack and `spike/recoil/probe.ts`, bundled with packages/guns' real
`Guns`, on a void world with a stone floor. A SimulatedPlayer fires every gun. Only the server side:
the held model's kick is drawn by the client.

| Check | Finding |
|---|---|
| An item's cooldown component | `new ItemStack(id).getComponent("minecraft:cooldown").startCooldown(player)` throws "Failed to call function 'startCooldown'." for every gun item and every hidden marker, on a SimulatedPlayer and on real players (the map editor's log has 352 such warnings from previews). So since the guns moved firing to left click (pass 2, when the script began starting the cooldowns), no gun's slot shaded, the held models never kicked and the aim pose never came up. The guns' first pass fired on a use, which starts the item's cooldown by itself, and its kick, read off the main hand, was seen in game. |
| The player's own cooldown call | `player.startItemCooldown(category, ticks)` works: `getItemCooldown(category)` is the ticks given at once and counts down one a tick, for every gun's own category (`minecade_<gun>`). Guns uses it now. |
| Firing through Guns | Each gun fired by a left click (`SimulatedPlayer.attack()` swings with source Attack) starts its own cooldown at its fire rate (a burst once, at its first shot), with no warnings. |
| `keepVelocity` on a player | `player.teleport(at, { keepVelocity: true })` throws "keepVelocity is not supported for player teleportation." The server's other refusals for players: `lookAt`, `remove` and `setVelocity`; nothing for `setRotation`. |
| A teleport's cost | A teleport without it stops a SimulatedPlayer: a walk ends where it was teleported, and a jump teleported 2 ticks in hangs there, then falls (its upward speed is gone). |
| Turning a SimulatedPlayer | A teleport with a rotation sets its yaw exactly (the view kick's sideways part, as expected per gun), but a SimulatedPlayer resets its own pitch every tick, after a teleport or a `setRotation` alike, so the kick's upward part can't be seen on one. A real player's pitch follows a teleport (the lobby faces players that way). Whether `setRotation` turns a real player's view is unknown (MCPE-179128 says it does nothing). |

## Holding in third person (client 1.26.6x, seen in game 2026-11-08)

| Check | Finding |
|---|---|
| Where a bound model sits in third person | At the hand. Every gun's third person pose, solved with the 24-pixel drop, showed the gun above the player's head (a Probe match, in F5), swinging in over the head as the arm moved: its origin sat above the shoulder joint. Vanilla's crossbow binds its `rightitem` bone the same way (`q.item_slot_to_bone_name(c.item_slot)`), draws its picture at (0, -5, -3) from the origin and moves it only (0.5, -0.5, -1.5) in third person, and sits in the hand. The poses now solve third person from the rightItem locator, (1, -7, 1) from the shoulder, 24 pixels higher than before; first person keeps the drop (its poses were set by eye in game). |
| Blockbench's Item 3rd Person view | Showed the old poses where the game did (through the head), so it can be used to set the third person poses. |
| After lowering third person only | The user still saw the gun in the face in third person, and in first person the gun in the middle of the screen, filling it. First person was solved with the same 24 pixels, so every first person pose was lowered by the same (0, -24, -2) too (the solver binds at the hand in both views). Not yet seen in game after that. |
| The aim pose | Never came up: a right click zoomed, but the gun didn't move at all. It was blended by `q.cooldown_time_remaining('minecade_aim')`, a cooldown read by its category name, which nobody has seen work on the client. Now the aim marker is an item in the off hand, read by `q.is_item_name_any('slot.weapon.offhand', 0, 'minecade:aim_marker')` (the player's own equipment); not yet seen in game. |
| A held left click | In the air, holding the attack button fired the SMG and Assault Rifle in bursts with their 6 and 7 tick windows: the repeated swings don't come often enough. The window is 10 ticks now, and Probe says in chat, when the trigger lets go, how far apart the swings came (TriggerReport). Not yet measured. |
| The aim marker and the zoom on the server | `spike/recoil/run.ts`: raising the Sniper Rifle puts `minecade:aim_marker` in a SimulatedPlayer's off hand and lowering it takes it out. `camera.setFov` threw "Custom FOV must be within [30.0, 110.0]" for the sniper's zoom of 20, so it never zoomed; it's 30 now, the strongest there is. |
| After lowering first person too | The user saw nothing change in either view: the gun still in the face in third person, still filling the middle of the screen in first person, and the aim pose still never came up. The client had the new pack each time (its download cache, `%LOCALAPPDATA%\Temp\Minecraft Bedrock\minecraftpe\packcacheesource\<hash>\`, held each new hold file byte for byte, by the time of each test) and its content log had no errors from the guns pack, so moving a pose a block and a half did nothing visible. |
| The held left click, measured | Probe's reports (2026-11-08): when Bedrock repeats a held swing, it's every 4 to 5 ticks (one SMG hold: 14 shots, 10 swings, 4 to 5 apart), which the 10 tick window bridges; but most holds sent one swing only. |
| The hold tests | Probe's Holds kit (`games/probe/resource_pack/attachables/hold_test_*`): the arsenal's Pistol; the same model with no pose; a colored axes model (white at the origin, red +X, green +Y, blue -Z, the barrel's way) with no pose, moved up 8, half size in first person and 2.5 times in third (by `c.is_first_person` in `animate`, and by an animation controller as vanilla's spear does), and the same sized by view on an item that doesn't place a block. F2 screenshots of each in both views say whether a held model's animations run at all, where its origin is and which way its axes point. Not yet seen. |
| The hold tests, seen (2026-11-08) | F2 screenshots leave out the first person hand, so third person only. The axes with no pose sat about 24 pixels under the hand, beside the feet, with blue (-Z, a barrel's way) to the player's right, red (+X) ahead and green (+Y) up. Moved up 8 and sized 2.5 times, they moved and grew, so a held model's animations do move its bound bone; sized by view (by `c.is_first_person` in `animate`, by a controller, and on an item that places no block) all worked alike. A held model with no animation of its own keeps the last item's pose: the axes with no pose came up where the moved ones had been, and the Pistol with no pose looked like the Pistol, so those two items now pose to nothing on purpose. The real Pistol sat at the shoulder, its barrel to the player's right, wherever its hold pose said. |
| A held model's variables | The client logged `unknown variable 'variable.kick'` for the Pistol's recoil, in the player's name (`minecraft:player.0.<id>`): a held model's animations look variables up on the player holding it, so the `v.kick` and `v.aim` its own `pre_animation` set were never there. That is why the guns never kicked and the aim pose never came up. The first pass's kick (no variables, keyframes started by a controller reading the cooldown) was seen in game. Now the held models use no variables: the kick is written out in each recoil channel and the aiming guns ease between poses through a controller (`blend_transition`). Not yet seen in game. |
| A held left click, again | In the third Probe session every hold came through as one swing, aimed at the sky or the ground: Bedrock doesn't repeat a held left click for these items, so full auto can't come from it. |
| A value from the server in a held model | Probe's Test H: every 2 seconds Probe plays an animation on each player whose timeline sets `v.minecade_hold` to 8 or 0; the held axes move up by `v.minecade_hold` and sideways by `c.owning_entity->v.minecade_hold`. Whichever moves (if either) can carry live values to a held model, for an in-game hold editor. Not yet seen. |
| The hold tests, second look (2026-11-08) | Windows screenshots show the first person hand (F2's don't). With no pose, the axes sat right of the crosshair at a held item's size; the real Pistol was a huge box over the middle of the screen. So the hold poses do apply; their numbers are wrong, and moving them 24 pixels mostly moved the gun toward or away from the camera, which looked like nothing. Every Probe test animation failed to load ("can't find animation"): `c.owning_entity->v.minecade_hold ?? 0` is refused ("found left-hand-side of ??" not a variable) and one bad expression drops its whole animation file. Test H now reads `c.owning_entity->v.minecade_hold` alone. |
| The kick without variables | Seen: the guns kick in both views (dcb5ed8). The client took the new guns pack mid-session (a new download, the old pack's errors stopped), so a pack change needs no restart. |
| The aim pose, again | A right click zoomed but no gun moved and the Sniper Rifle didn't hide, with no errors; the aim marker was in the off hand (the client drew its held model). The hold controller asked `q.is_item_name_any` of the held model only; now it asks it of the holder too (`c.owning_entity->q.`, as vanilla's spear asks its holder), and Probe's Test I moves the axes up by the first and sideways by the second while Probe flips the marker in the off hand every 2 seconds. Not yet seen. |
| The hold tests, third look (2026-11-08) | The axes followed the aim marker in the off hand (Test I, now H) in both views, mostly along red in first person: `c.owning_entity->q.is_item_name_any` sees the holder's off hand. Playing an animation on the player whose timeline set `v.minecade_hold` moved no held model, and it jerked the player's off hand every time; that test is gone. The Pistol and the Pistol with an explicit zero pose looked the same, and the Sniper Rifle never hid with its aim pose's scale of 0, while the axes, whose boxes are in the bound bone, followed every pose: a pose on a bound bone doesn't move a child bone's boxes. So since the second pass no gun's hold pose ever showed. The held models are now one bound bone with every box (the recoil moves it too, back along the barrel by the generator's pose for each view). |
| Where the solver puts a bound origin | From the first person screenshot of the axes with no pose: the origin sat right of the crosshair, where the 24-pixel drop (Blockbench's preview) puts it, and its axes pointed within about 25 degrees of where the solver's arm turns them. So the solver's first guesses, with the drop, are back in the hold file (its first person poses had been lowered (0, -24, -2), its third person ones too); the two pistols' third person pose is the user's from Blockbench again. Not yet seen. |
| Aiming and shooting together | Not possible while right click is held (no left click reaches the script), so only the Sniper Rifle, Rail Gun and RPG aim (a toggle) and the rest fire from the hip (the user's call, 2026-11-08). |
| The hold tests, fourth look (2026-11-09) | Seen: the poses move the guns now (a0286b9). In first person the Pistol sat at the lower right; right click raised the Sniper Rifle, Rail Gun and RPG and the sniper hid; the recoil looked right. In third person (F5, front) the Pistol sat beside the hand, not in it: its pose was the user's earlier one from Blockbench, which put the grip 5 pixels outside the hand (x -5). The hold file is now a shared pose a view for every gun plus each gun's own on top (added up, as Blockbench adds two animations playing together), every gun on the solver's place, the pistols' own third person pose 0. Not yet seen. |
| Right click held, as a use | The user's call (2026-11-09): right click fires, left click aims (Sniper Rifle, Rail Gun, RPG) or fires one shot. Each gun item has `minecraft:use_modifiers` (`use_duration` 3600, `movement_modifier` 1), so right click should hold it in use like a bow, with `itemStartUse` when the button goes down and `itemReleaseUse` / `itemStopUse` when it comes up; at a block, `playerInteractWithBlock` repeats with `isFirstEvent` false while it's held. Not yet seen: whether those events come for a gun (a block placer), how far apart the repeats come (Probe says in chat), whether a cooldown started each shot ends the use, and whether firing stops a sprint or slows the player. |
| The new controls, seen (2026-11-09) | Seen working (50cc6fc): a held right click fires the SMG and Assault Rifle nonstop until it comes up, so the use events do come for a gun and a shot's cooldown doesn't end the use; a left click fires one shot; the Pistol fires on both buttons; a left click raises the Sniper Rifle, Rail Gun and RPG and a right click fires them. Firing didn't seem to slow the player, but looking around while firing jumps: each view kick is a teleport to the rotation the server last had plus the kick, and while the mouse moves that rotation is a few ticks old, so the view snaps back. In third person the Pistol is in the hand at the wrong angle. In Blockbench the `gun` bone couldn't be changed: picking an animation deselects every bone (Blockbench's `Animation.select` calls `unselectAllElements`), and a hold is only the Animate tab's keyframes, never the Edit tab's pivot or rotation; docs/guns.md now says so step by step, and how to type a pose in the file instead. |
| Blockbench, the second try (2026-11-09) | The edits still didn't stick: the file Blockbench saved had every number as before, in its own layout. Blockbench's autosave (`%APPDATA%\Blockbench\backups`, `<lz>` and LZUTF8 in its StorageBinaryString form) showed why. Item 3rd Person, `all_guns.third_person` and the `gun` bone were all selected, but Blockbench had loaded `guns.animation.json`'s `gun_handgun.recoil` too (opening a model in a resource pack, it loads every animation the model's attachable names), and the recoil had taken the turns and moves: its rotation's multiplier had gone from 12 to 290.5 and its depth had picked up -3 (unsaved). A recoil channel is the shot's kick times a number, and the kick is 0 in Blockbench (no cooldown), so a turn there shows nothing. So the deselecting was a guess; docs/guns.md now says to unload the recoil (right-click, Unload: Delete offers to delete it from the file). |
| Camera shake for the view kick | The user's pick (2026-11-09): each shot runs `camerashake add @s <shake> <seconds> rotational` as the shooter, so the aim no longer climbs and nothing fights the mouse. Not yet seen: how strong each gun's shake feels, and whether shakes from a fast gun add up. |
| The Sniper Rifle's icon | Looked broken, parts missing. Its texture was 64 by 128 and its stock's sides were below row 64; the Rail Gun's (also 64 by 128) only had its butt plate there. The icon's model block takes its texture from the block atlas, which may keep only a square of a tall texture, so a texture now widens instead (both are 128 by 64). Not yet seen. |
| The scope and heavy guns (2026-11-09) | The user's asks. The Sniper Rifle's scope is drawn by the HUD from a code on the action bar line (`SCOPE_CODE`), which the game adds while Guns says the player is scoped and redraws when a gun goes up or down. Heavy guns set the player's `minecraft:movement` attribute to 0.75 of its default while held (`setCurrentValue`, stable in @minecraft/server 2.11). Not yet seen: whether the scope covers the screen as laid out (its sides are placed by `"%y"`), whether it lags the zoom, and whether a script's movement change slows a player as expected (and whether it changes the field of view, as Slowness does). |
| The scope and heavy guns, seen (2026-11-09) | The heavy guns slow the holder (0.75 felt right) and give the speed back on another item; the movement attribute changes the field of view, as Slowness does, and only a player's own video setting can stop that. The scope came up with the zoom but showed as a narrow strip: the lens was the screen's height, but the black sides, placed from the screen's middle by a `"%y"` offset, covered all but about a ninth of it, so an offset's `"%y"` isn't the control's own height. The sides now hang off the lens's own edges. The RPG's rocket always pointed one way: it flies as a snowball, whose rotation nothing sets, so `q.target_x_rotation` and `q.target_y_rotation` (vanilla's arrow's) stayed 0; the script now gives each rocket its heading as two synced properties, read with the arrow's signs. Neither fix seen yet. |
| The Probe server crashed (2026-11-09) | Nothing was left to read: the network was restarted at 10:21, which removes the orchestrator's log with its container, and the game container goes when its session ends. The user's client didn't crash (running since 8:22, nothing in its content log but sound notices). The orchestrator now keeps a game's last 200 console lines and, when its server stops on its own, writes them to `/data/crashes/` and puts the last 30 in its log. |
| The rocket's heading properties (2026-11-09) | The client's content log: `query.property called on an actor without a property component` for `-q.property('minecade:pitch')` and `-q.property('minecade:yaw')` in `animation.minecade.rocket.fly`. The rocket's behavior entity had both properties, but it flies as a snowball (`runtime_identifier`), and the client seems to give such an entity no property component: the guns' other entities read properties the same way, with no `runtime_identifier`, and logged nothing. So the rocket has no properties now: its client entity works out its heading from its own move (`q.movement_direction`, which vanilla's elytra reads), keeping the last one while it doesn't move. That build (fcfbc4e, with the properties) also stopped the rocket: the user saw it appear on its side, facing one way, and only sink slowly (tests at 12:55 and 13:34, all from the pack with `q.property`). Without the properties the rocket's behavior entity and the script are as they were when it flew (a7b8856). Its turn is `[v.pitch, v.yaw, 0]`, as vanilla's `look_at_target` turns a head toward a look (the warhead is at -Z, where a face is, and where vanilla's arrow has its tip); the first try's `-v.pitch, -v.yaw` copied the arrow's signs, which are for the arrow's own reversed rotation, and would have pointed it the mirror way. Not yet seen. |
| The rocket's heading and trail, seen (2026-11-09) | After a restart onto 9ecf422 the rocket flew straight and pointed the way it was fired, and nothing else looked wrong. Its smoke came out ahead of it: the script spawned 2 puffs a tick at the rocket's place on the server, and the client draws the rocket a few ticks behind that. Now its client entity emits the smoke itself (40 puffs a second off a `tail` locator, from an animation controller state's `particle_effects`, as vanilla's phantom and dolphin do), and the script spawns none. Not yet seen: whether the smoke stays behind the rocket, and whether the puffs already in the air last out their time when the rocket hits and goes, or vanish with it. |

## Map viewer (pass V.1, BDS 1.26.60.6, client packs up to vanilla_1.26.62, checked 2026-11-05)

The spike for `docs/plans/map-viewer.md`, in `spike/viewer/`. Everything it writes (colors,
textures, screenshots, timings) goes to `work\viewer\spike\`, which git ignores, and it only reads
the map store and the client's worlds. Timed on this PC: 16 cores, an RTX 3080 Ti, Edge 156, a
1584x961 canvas.

```
npx tsx spike/viewer/decode.ts bridges/temples sumo/sinkhole     decode maps from the store; write spots for the check
npx tsx spike/viewer/bds-check.ts bridges/temples               those spots against a throwaway BDS (minecade-viewercheck, no ports)
npx tsx spike/viewer/colors.ts ["<world folder>" ...]          face colors, coverage of the maps' blocks, swatches.html
npx tsx spike/viewer/overview.ts "<world folder>"               Select's picture of a whole world
npx tsx spike/viewer/render/serve.ts [temples realistic worst]  draw in an Edge window of its own, and time it
```

### Reading worlds

| Check | Finding |
|---|---|
| Against BDS | Temples, Sinkhole and Strife decoded in plain TypeScript match a server's `getBlock` at every spot checked: 784, 768 and 784 spots (sample columns' top blocks and the air above them, and 400 random spots through each box), name and every stored state. |
| Speed | Temples: 19 ms to read the db, 51 ms to decode its 376 sub-chunks (mostly parsing its 547 palette entries once each); Sinkhole 4 and 3 ms; Strife 7 and 10 ms. A whole source world's 247k sub-chunks decode in 5.4 s. |
| Newest wins | Temples has a table and a 3.9 MB log whose batches run past the table's last sequence number (16,420 against 16,042): the highest number per key gives what BDS has. The MANIFEST names the live tables (`newfile` and `deletefile` edits); none were left over in these worlds. |
| Sub-chunks | Every one is version 9. Layer 1 (water in waterlogged blocks) is in 2 of Strife's 383 sub-chunks. Palette entries parse once each, cached by their raw bytes (an NBT skipper finds where each ends). |
| Chunker writes every empty sub-chunk | A converted world stores all 24 sub-chunks of every chunk, the empty ones with 1 bit a block and a palette of air: 234k of Datapacking's 247k. Skip a sub-chunk whose palette is all air without unpacking it. |
| Map worlds hold more than their bounds | Temples' world is the whole 127x75x184 island it was cut with (its bounds are 37x27x104); Strife was built from the same island. The view file's box should be the blocks' box, as the plan says, not the bounds. |
| BDS's own answers | `getTopmostBlock` skips leaves and water (it gives the block under them). `getAllStates` adds old states worked out from the name (`color`, `wood_type`, `stone_type`, `top_slot_bit`, `stripped_bit`) that worlds don't store. A throwaway server sometimes garbles its first console line ("Unknown command: {."): send the first command again until it answers. |

### How blocks look

| Check | Finding |
|---|---|
| The texture archive | `textures\blocks.brarchive` is the format `ui.brarchive` uses. A folder inside is an archive of its own: `__brarchive\textures\blocks\deepslate.brarchive` holds `textures/blocks/deepslate/*` (also `candles` and `huge_fungus`). |
| Layered packs | The client's vanilla pack has only 341 blocks, under old names (`grass`, `log`, `planks` picked by data value). It layers 57 vanilla packs on top (`vanilla`, `vanilla_1.14` up to `vanilla_1.26.62`), sorted by version: `blocks.json` merged entry by entry and field by field (a later layer gives `brown_terracotta` only a `sound`), `terrain_texture.json` entry by entry, block textures from 23 of them. In all: 1,352 vanilla blocks and 1,367 textures. |
| Pack files | `blocks.json` and `terrain_texture.json` have `//` comments, also after code on a line. The vanilla manifests' version is always 0.0.1, so the looks cache has to key on the files' sizes and times. |
| Image formats | Of the base pack's 703 block textures: 553 RGBA PNG, 90 RGB, 45 TGA (9 run-length coded), 13 interlaced, 2 palette (one 2-bit). `tools/editor/png.ts` reads only 8-bit RGB(A) without interlacing, so the viewer needs its own decoder (`spike/viewer/image.ts`). |
| Renamed blocks | Three names worlds use aren't in any `blocks.json`: `grass_block` is `grass`, `sea_lantern` is `seaLantern`, `iron_chain` is `chain`. |
| Coverage | With the above and the blocks pack's 1,541 blocks, every block in every map in the store has a look (Temples 90 kinds, Sinkhole 37, Strife 115, KGB 164, Roman 28, Spaceship 262), and every block in two source worlds but light blocks (hidden anyway). Building the looks: 3.7 s (most of it the custom textures), the colors 48 ms. |
| The color method | Most-common-color (the plan's) next to whole-texture averages for 29 blocks (`work\viewer\spike\swatches.html`): cleaner, more saturated colors for dirt, bricks, planks, logs and cobblestone. Ores come out as stone, as expected (overrides). New for the overrides: glowstone comes out dark brown, its most common bucket being the dark gaps between the bright bits. |
| Tints | Plains grass and foliage from `colormap.brarchive` (`grass.png`, `foliage.png` at temperature 0.8, downfall 0.4); spruce and birch leaves and water as fixed colors. Grass tops, leaves and water look right in the swatches and the views. |
| Custom blocks | `material_instances` then the resource pack's `terrain_texture.json` work as the plan says. For V.7: a custom block's `collision_box` can be a list of boxes, and permutations change it. |

### Drawing in Edge

Three scenes, meshed per 16x16x16 section in 8 web workers (hidden faces left out, touching faces
of the same block merged), vertex colors with the plan's shading, three.js 0.186.1 (WebGL2 through
ANGLE on Direct3D 11). "Worst" is 256x384x256 of noise caves with each block one of 64 looks at
random, so nothing merges; "realistic" is the 256x256 area with the most blocks in the converted
Datapacking world (Temples' first island and its neighbors on a terracotta floor, 1.46 million
blocks, 84 high).

| | Temples (127x75x184) | Realistic (256x84x256) | Worst (256x384x256) |
|---|---|---|---|
| Sections with blocks | 355 | 780 | 5,966 |
| Triangles | 199k | 303k | 6.0 million |
| Meshing, in all (per section: average, slowest) | 61 ms (1.0, 6.1 ms) | 62 ms (0.2, 0.8 ms) | 0.51 s (0.3, 1.1 ms) |
| A frame with one mesh per section (draw calls) | 1.8 ms (355) | 2.0 ms (780) | 17 ms (5,966): 68 fps |
| A frame with sections grouped into 64-block region meshes | 1.3 ms (11) | 1.4 ms (29) | 1.8 ms (96) |
| Faded on (everything past the cut drawn again, see-through) | 1.5 ms | 1.8 ms | 3.7 ms |
| Geometry; JS heap; Edge's private memory (GPU process) | 4.6 MB; 25 MB; 406 MB (160) | 6.6 MB; 43 MB; 508 MB (203) | 149 MB; 500 MB; 2.0 GB (1.0 GB) |

A frame here is one forced to finish (a pixel read back after it); with region meshes every scene
stays at the display's refresh rate. Positions are bytes (0 to 255 inside a region), colors 4
bytes, indices 32-bit where a region passes 65,535 vertices.

| Check | Finding |
|---|---|
| Draw calls | One mesh per section is fine for real maps but costs 15 ms a frame of JavaScript alone at 6,000 sections. **Group sections into region meshes** (4x4x4 sections, 64 blocks a side): about 100 draw calls at the worst case, and building them is a copy (109 ms for the worst case). |
| Height cut | **A clipping plane plus a cap** (the cut layer's tops that the layer above hid, one layer of the whole map, greedy merged) takes 2.9 ms a layer step on Temples, 3.6 ms on the realistic scene, 8.9 ms (at most 17) on the worst case, to a finished frame. Re-meshing the cut's row of sections instead takes 19, 35 and 55 ms (at most 90), over the 50 ms aim. The plane draws "Gone" exactly: only top faces were hidden by the blocks above. X and Z cuts work the same way. |
| Faded | The same region meshes drawn again with a see-through material and the opposite plane: no frame rate cost in any scene. |
| Memory | The worst case's 500 MB of JS heap is mostly the sections' meshes kept after building the regions; the viewer should keep only the regions (and re-mesh from the volume if a section ever changes). |
| A covered window | Edge stops drawing a covered or minimized window (`requestAnimationFrame` pauses, once for 258 s): fine for the viewer, but nothing it does may wait on a frame. The spike turns that off with `--disable-backgrounding-occluded-windows` and friends. |
| Screenshots | `work\viewer\spike\shot-*.png`: each scene, its cut and Faded. |

### Select's picture of a whole world

| Check | Finding |
|---|---|
| Height maps | Data3D's 256 heights are `[z * 16 + x]`, each the top block's y + 65. **They can't be used for the picture:** right in 99.5% of Temples' columns (saved by BDS), 89% of the Showroom's (a custom block on top is often left out), and almost none in converted worlds: Datapacking 24k of 2.6 million columns, Minecade Maps 0 of 155k, Bikini Bottom 15k of 698k. |
| Top-down scan | Each chunk's sub-chunks from the highest down, all-air ones skipped by their palette, until all 256 columns have a top: right in every column of all four worlds checked. Datapacking (5.7 MB of db, 1808x1712 columns): 1.2 s, of which reading 0.75 s, decoding 12k of 247k sub-chunks. Minecade Maps (4.0 MB, 1424x1552): 1.0 s. Reading only the height maps would save little (0.5 s and 0.4 s), since reading the tables is most of it. |
| Old names | Older converted worlds can hold old block names (Bikini Bottom's `minecraft:grass`, `concretePowder`), which the game upgrades when it loads them (not checked here). Map worlds have been through BDS, so mostly Select's picture meets them: an unknown name there gets a plain color. |

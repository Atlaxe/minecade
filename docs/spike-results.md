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

What the code does with this: Sumo's default `knockback.mode` is "vanilla" (its `onDamage` returns 0 for melee hits), and "scripted" uses the numbers above with a 10-tick cooldown per victim and credits its own pushes. `combat.ts` now takes kill credit from `afterEvents.entityHurt`, plus lethal hits it intercepts, so a tap inside the cooldown can't steal a knock-off. `damage: "none"` stays "cancel every hit" (for games where hits should do nothing at all); games that want push-only hits return 0 from `onDamage` instead.

## Map editor (pass 10.1, BDS 1.26.60.6, @minecraft/server 2.11.0, checked 2026-10-30)

Source: a copy of the user's converted world "Datapacking (imported)" (6.8 MB, a void world with a
terracotta floor, last opened with 1.26.60). Its builds were found by reading the LevelDB keys and
sub-chunk palettes (13 separate builds once the floor is ignored). The test build ("B") spans
chunks x 6..12, z -5..2 (blocks x 96..207, z -80..47, y -64..0): 156,583 blocks, 133 containers,
172 signs. Automated part: `npx tsx spike/editor/run.ts "<world folder>"` (results in
`spike/results/editor.json`); in-game part: `spike/editor/ingame.ts`.

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
| Custom items (in game) | **Work.** A custom item (`items/*.json`, format 1.21.60) with its own icon from `textures/item_texture.json`. `afterEvents.itemUse` fires on use (right click) and `afterEvents.entityHitBlock` on hits. In creative mode a hit still breaks the block, so the real tools must cancel breaking while held. |
| Marker entities (in game) | **Work.** A summonable custom entity with a name tag always shown; `afterEvents.entityHitEntity` reports hits on it, with no damage taken. |
| Transfers (in game) | **Work** on the LAN: `transferPlayer` from port 19134 to 19133 and back, each server with its own saved identity (the new `editor` key is in the `minecade-keys` volume, so the trust prompt comes once). From outside the network is still untested (`docs/to-test.md`). |
| `op` from the console | Not settled: the test world was a copy of the user's own world, which already saved them as an operator. Pass 10.3 checks it on a fresh map world. |
| Sneaking | The user's note: **you can't sneak while flying** in creative (sneaking flies you down), so editor controls never use sneak combinations (`docs/plans/map-editor.md`, "Controls"). |
| Bind mounts for Preview | **Work.** A container created through the Docker socket from inside the orchestrator container can mount `dist/templates` from this PC with any of `C:\dev\...`, `C:/dev/...`, `/c/dev/...` or `/run/desktop/mnt/host/c/dev/...` (Docker Desktop translates them). Preview can mount the local build directly. |

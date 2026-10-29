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

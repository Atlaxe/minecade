# Skin capture spikes

Tests, not features: two ways to get each player's skin on Bedrock 1.26.60 (NetherNet).
Background and findings are in `docs/skins.md`. Saved skins go to `spike/skins/out/`
(gitignored: skins are personal data). Both run in a Node 26 container on the main stack's
Docker network, and both need the spare Microsoft account.

- **The watcher** (`watcher.ts`, the current test): a bot that joins the lobby as the spare
  account and saves every player's skin from the player list. See "The watcher" below.
- **The relay** (`skins.ts`, ruled out): a relay in front of the lobby that reads the skin from
  each player's login. The lobby refuses logins through it (see `docs/skins.md`).

## The watcher

**How it works:** `watcher.ts` joins the lobby with
[bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) 3.61.0 (MIT), signed in as the
spare account, like any player. The lobby sends every player the skins of everyone online (the
player list), and again when someone changes skin, so the bot saves them as
`out/watch-<xuid>-<name>.png`, with a `.json` of what else the skin says. bedrock-protocol can't
yet reach a server by address over NetherNet, so the bot swaps in BDS's HTTP signaling (adapted
from nethernet-proxy, MIT). Nobody else's connection changes.

**Running it** (from `network/`, with the main stack up):

1. `npm run spike:watcher:check` builds the container and checks that bedrock-protocol loads and
   the lobby answers. It doesn't sign in.
2. `npm run spike:watcher` starts the bot. `docker logs -f minecade-skin-watcher` shows a
   `device_login` line: open its URL, enter its code, and sign in as the spare account (its own
   sign-in, separate from the relay's; cached in the same Docker volume, so it's asked once).
3. When `spawned` shows, the bot is in the lobby for 10 minutes (`SKIN_WATCH_MINUTES` in `.env`
   changes that). Join the lobby as usual (port 19132) during that time, or be in it already:
   a `skin_saved` line and a picture in `out/` should follow for each player.
4. Try a classic skin and a character creator skin, and change skin while it watches.

**While it's in the lobby:** it's a player there (it stands at spawn). Don't start a game while it
watches: the lobby would count it and send it to the game.

## The relay

**How it works:** `skins.ts` runs [nethernet-proxy](https://github.com/SKYNETWORK-MCBE/nethernet-proxy)
0.2.0 (MIT) in a Node 26 container on the main stack's Docker network. Players join the relay on
port 19140 instead of the lobby's 19132. The relay passes each player's own login through to the
lobby, and saves the skin from it to `spike/skins/out/` (gitignored: skins are personal data).
The lobby itself isn't changed, and transfers to games go straight to the game servers.

**The account:** the relay's own connection to the lobby needs a Minecraft multiplayer token,
from a Microsoft account. Use a spare account, never anyone's main one. There's no password
anywhere: the first run prints a code, and you enter it at the printed URL while signed in as the
spare account. The library signs in posing as the Nintendo Switch version of Minecraft. The token
is cached in the `minecade-skin-spike-cache` Docker volume, not in the repo.

The account needs an Xbox profile (a gamertag). A brand-new Microsoft account doesn't have one,
and the relay stops right after the sign-in with "Your account currently does not have an Xbox
profile". Sign in once at https://www.xbox.com with the account and create the gamertag it asks
for, then start the relay again.

### Running it

Run these from `network/`, with the main stack up (`docker compose up -d`):

1. `npm run spike:skins:check` builds the container and checks that the relay's packages load and
   that the lobby answers. It doesn't sign in.
2. `npm run spike:skins` starts the relay. Then `docker logs -f minecade-skin-spike` shows a
   `device_login` line with a `url` and a `userCode`: open the URL, enter the code, and sign in as
   the spare account. Then `signed_in` and `listening` follow.
3. In Minecraft, add a server with your `LAN_HOST` address and port 19140, and join it. You should
   land in the lobby as usual. Check that walking around, the terminal, and starting Sumo (and
   coming back) all work.
4. Look in `spike/skins/out/`: `<xuid>-<name>.png` is the skin, and `.json` has what else the
   login says about it (size, character creator or classic, geometry). Try once with a classic
   skin and once with a character creator skin.

### What to watch for

- **The version:** nethernet-proxy targets 1.26.50, and it decodes the server's start-game packet
  with an older protocol library. If joining through the relay fails right after loading, that's
  the likely cause (`relay_*` and `leave` lines in the log say why).
- **The network:** the relay advertises `LAN_HOST` and the UDP ports 19141 to 19150 (one per
  player connected at a time). From outside your network it would also need those ports forwarded
  on the router; this test is meant for your own network only.

## Cleaning up

- `npm run spike:skins:down` stops the relay and the watcher.
- `docker volume rm minecade-skin-spike-cache` deletes the cached sign-ins and the relay's key.
- Delete `spike/skins/out/` to delete the captured skins.

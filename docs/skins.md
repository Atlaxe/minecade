# Player skins

The stats list shows each player's head, and a player's stats screen and the hologram show their
head and shoulders, drawn from their own skin at an angle in the hologram's blue. A player the
watcher hasn't seen yet has a letter badge instead (`badgeFor()`).

## How it works

1. **The watcher saves skins.** `watcher/watcher.ts` is a bot that stays in the lobby as a
   spare Microsoft account (the `watcher` service in `docker-compose.yml`, set by
   `WATCHER_GAMERTAG`). The lobby sends every player the skins of everyone online, and again when
   someone changes skin, so the bot saves each one to `skins/<xuid>/` (gitignored: skins are
   players' personal data). It reconnects whenever it drops out, such as when the lobby restarts.
2. **The lobby hides it.** With `WATCHER_GAMERTAG` set, the lobby puts the watcher in spectator
   mode (invisible to everyone else) and leaves it out of player counts, game starts, team picks,
   messages and the stats screens (`isWatcher()` in `lobby/behavior_pack/scripts/skins.ts`). It
   never goes to a game: everyone passes through the lobby, so that's where it sees every skin.
3. **The build renders them.** `tools/skins/` is a small software renderer: it draws each skin on
   its model (vanilla's classic wide, slim or old 64x32 model, or a character creator skin's own
   model from its geometry data) at an angle, with shading, then gives it the hologram's look
   (blue by brightness, glowing edges, scanlines, transparent around). Each player gets two
   renders in the lobby pack: head and shoulders (`textures/minecade/skins/<xuid>_holo`, for the
   hologram and the stats screen) and the head alone (`_holo_head`, for the stats list), and the
   lobby's scripts get the list as `#skins`. The background is transparent rather than black: the
   hologram draws additively, so both show as nothing there, and the menus draw it over their own
   background.
4. **New skins show after the next build and lobby restart** (`docker compose up -d --build`, the
   panel's Start, or a smoke test). Bedrock only shows pictures that are in a resource pack, and
   the lobby loads its packs when it starts; clients download the new pack on their next join.

**Setting it up:** create a spare Microsoft account, sign in once at https://www.xbox.com to give
it a gamertag (an Xbox profile), put that gamertag in `.env` as `WATCHER_GAMERTAG`, and start the
stack. The watcher's log (`docker logs minecade-watcher`) shows a `sign_in_needed` line with a URL
and a code: sign in as the spare account. The sign-in is kept in the `minecade-watcher-auth`
volume. bedrock-protocol signs in posing as the Nintendo Switch version of Minecraft, so use an
account you don't mind losing.

**Looking at the renders:** `npm run skins` renders every saved skin into its folder (`skin.png`,
`holo.png` and `holo-head.png` as the lobby has them, and `portrait.png` and `head.png` in color),
and `npm run skins -- <skin.png> [slim]` renders one skin file.

**Not done yet:** a 3D model of each player in the world (for showing players in games). The
lobby pack would need a figure entity with each player's texture (and a character creator
skin's own model).

## Why it takes a bot

- **No script API:** behavior pack scripts can't read a player's skin, not even the viewer's.
- **Player heads are always Steve:** Bedrock's player head item has no skin data, unlike Java's.
- **The paper doll draws only the viewer:** the UI's skin preview (as in the inventory) always
  shows the person looking at it, so a form can't show someone else's skin.
- **Player IDs don't help:** a script can see a player's name and entity id, but nothing links
  those to their skin's pixels. The skin travels in the player's login data, which the server
  keeps to itself, and in the player list the server sends every player, which is what the bot
  reads.

## What we checked (October 2026)

- **No public skin API covers our players.** Microsoft doesn't publish Bedrock skins. GeyserMC's
  Global API (`GET /v2/skin/:xuid`) only has skins of Bedrock players who joined a Java server
  running Geyser and Floodgate, which our players haven't. mc-api.io looks players up by xuid but
  doesn't say where its Bedrock skins come from.
- **A relay can read the skin, but needs a Microsoft account.**
  [nethernet-proxy](https://github.com/SKYNETWORK-MCBE/nethernet-proxy) (MIT, TypeScript, Node
  26) relays NetherNet connections and passes each player's own login through to the server. Its
  join event exposes the login's client data, including `SkinData` (raw RGBA),
  `SkinImageWidth`/`SkinImageHeight`, `SkinGeometryData` and `PersonaSkin`. Upstream decoded both
  character creator (256x256) and classic (64x64) skins on 1.26.51. However, the relay's own
  connection to the server needs a multiplayer token: `authenticateTransport()` in
  `@nethernet-proxy/relay` 0.2.0 runs a Microsoft device-code sign-in (prismarine-auth, posing as
  the Nintendo Switch version of Minecraft) and caches the token on disk.
- **The relay test (October 30, 2026), with a spare account:** `spike/skins/` (see its README)
  runs the relay in a `node:26` container on port 19140, in front of the running lobby.
  - **What worked:** the sign-in (once the account had an Xbox profile; a brand-new Microsoft
    account doesn't). The relay's gateway accepted the player's multiplayer token, WebRTC through
    Docker on Windows reached the relay on the LAN, and the relay connected to the lobby. BDS
    1.26.60 answers `/v1/join` with an empty body, so the game version for the sign-in comes from
    `BDS_VERSION`.
  - **What failed:** the lobby refuses the player's login 7 ms after it arrives through the relay,
    with Disconnect reason 46 (not authenticated), which the game shows as "You need to
    authenticate to Microsoft services" (a Guardian error). The relay's identity line and the
    lobby's are built the same way, so that's not the cause: BDS ties the login to the account
    that opened the connection, and through the relay that's the spare account, not the player.
    **A pass-through relay can't sit in front of an online-mode BDS.**
- **What's left:**
  - **An observer bot (being tested):** the spare account joins the lobby as an ordinary
    player and reads every player's skin from the player list, which BDS sends to everyone. The
    lobby's security doesn't change. `spike/skins/watcher.ts` does this with PrismarineJS
    `bedrock-protocol` 3.61.0 (1.26.60 and NetherNet support; it answers the lobby's required
    resource pack without downloading it). That release can only find NetherNet servers by LAN
    discovery or through Xbox, so the bot swaps in BDS's HTTP signaling. A real version would hide
    the bot in the lobby and leave it out of counts, stats and game starts.
  - **The watcher works (October 30, 2026):** it joined the lobby as the spare account
    ("MinecadeServer") and saved a player's classic skin (64x64, `geometry.humanoid.custom`) from
    the player list, a real skin image. Notes from the test:
    - in bedrock-protocol's 1.26.60 definitions the player list's `records` is a plain array of
      `{ type: "add" | "remove", uuid, username, xbox_user_id, skin_data: Skin, ... }`, and the image
      is `skin_data.skin_data` (`{ width, height, data }`);
    - it can't decode `server_script_debug_drawer` (packet 328, the hologram's text shapes), which
      it doesn't need;
    - a bot stopped without leaving keeps its session for about 15 seconds, and starting it again
      meanwhile is refused with "server_id_conflict", so it now leaves cleanly on stop;
    - a character creator skin came through too: 256x256, `persona: true`, with its own model
      (`geometry.persona_<id>`, plus `geometry.animated_face_persona_<id>`). Its picture is a sheet
      of body parts, not the classic skin layout, so drawing it needs that model, which the skin
      carries in `geometry_data` (the watcher saves it as `.geo.json`). A head for the stats list
      would be cut from the sheet using the model's head bone;
    - a bot that only closes its connection keeps its session for about 15 seconds too, so a quick
      restart still has to wait;
    - when the lobby restarts, the bot drops out and doesn't come back: an always-on bot needs to
      reconnect;
    - still untested: a skin change while in the lobby.
  - **An offline-mode lobby behind the relay:** the relay checks every player's sign-in, and the
    lobby trusts whoever the relay sends. The lobby must then be reachable only through the relay,
    and every lobby connection depends on a young library (0.2.0). A much bigger change.

## Open risks

- **The relay:** Bedrock 1.26 connects through NetherNet (WebRTC), not plain RakNet, so a proxy
  that reads login packets is much harder to build than it used to be, and could break with game
  updates.
- **Pack size and downloads:** every skin added means a bigger pack, and every change means a
  fresh download for everyone.
- **Privacy:** skins would be stored on the host's disk; only players on this network are captured.

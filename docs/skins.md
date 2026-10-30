# Player skins

The original UI plan has players' skins in the lobby: a 3D figure with a blue holographic tint
on the stats screen and the hologram, and heads in the stats list. For now, every player has a
letter badge instead (`badgeFor()` in `lobby/behavior_pack/scripts/stats-screens.ts`). This page
explains why, and how skins could come later.

## Why other players' skins can't be shown yet

- **No script API:** behavior pack scripts can't read a player's skin, not even the viewer's.
- **Player heads are always Steve:** Bedrock's player head item has no skin data, unlike Java's.
- **The paper doll draws only the viewer:** the UI's skin preview (as in the inventory) always
  shows the person looking at it, so a form can't show someone else's skin.
- **Player IDs don't help:** a script can see a player's name and entity id, but nothing links
  those to their skin's pixels. The skin only travels in the player's login data, which the
  server keeps to itself.

## The plan for later

1. **Capture each skin once.** On a player's first join, read their skin from their login
   packet and save it, keyed by their xuid, and again when it changes. Scripts never see the login
   packet, so this needs a small relay (a proxy) between players and the lobby that reads it as
   it passes.
2. **Bake the saved skins into the lobby's resource pack.** At lobby startup, the build adds
   each saved skin as a texture and bumps the pack version, so clients download the new pack.
3. **Draw them.**
   - **On the hologram and the stats screen:** a custom figure entity with the player model,
     using the player's texture, in the hologram's additive blue.
   - **As list heads:** the head part of each texture, cut out at bake time.

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
- **The test is ready to run** with a spare Microsoft account (never anyone's main one):
  `spike/skins/` (see its README) runs the relay in a `node:26` container on port 19140, in front
  of the running lobby, and saves joining players' skins to `spike/skins/out/`.
  `npm run spike:skins:check` passes: the relay's packages load and it reaches the lobby. BDS
  1.26.60 answers `/v1/join` with an empty body, so the game version for the sign-in comes from
  `BDS_VERSION`.
- **Still untested:** the sign-in itself, whether joining through the relay works on 1.26.60 (the
  library targets 1.26.50), and whether WebRTC through Docker on Windows reaches the relay (it
  advertises `LAN_HOST` and publishes UDP 19141 to 19150).
- **The other route,** a bot that joins the lobby and reads skins from the player list, also needs
  its own Microsoft account.

## Open risks

- **The relay:** Bedrock 1.26 connects through NetherNet (WebRTC), not plain RakNet, so a proxy
  that reads login packets is much harder to build than it used to be, and could break with game
  updates.
- **Pack size and downloads:** every skin added means a bigger pack, and every change means a
  fresh download for everyone.
- **Privacy:** skins would be stored on the host's disk; only players on this network are captured.

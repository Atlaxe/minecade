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

## Open risks

- **The relay:** Bedrock 1.26 connects through NetherNet (WebRTC), not plain RakNet, so a proxy
  that reads login packets is much harder to build than it used to be, and could break with game
  updates.
- **Pack size and downloads:** every skin added means a bigger pack, and every change means a
  fresh download for everyone.
- **Privacy:** skins would be stored on the host's disk; only players on this network are captured.

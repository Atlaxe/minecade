#!/usr/bin/env bash
# Writes MCXboxBroadcast's config from the environment, then runs it. Its sign-in and logs stay in
# /data (the minecade-broadcaster volume); config.yml is rewritten at every start.
#   BROADCAST     1 runs it; anything else exits at once (the container stays stopped)
#   LOBBY_HOST    where joins are relayed, on the compose network (default lobby)
#   LOBBY_PORT    the lobby's signaling port there (default 19132)
#   WORLD_NAME    the name in the Friends tab (default Minecade lobby)
#   MAX_PLAYERS   the player limit shown there (default 10)
set -euo pipefail

if [[ "${BROADCAST:-}" != "1" ]]; then
  echo "[broadcaster] off: set BROADCAST=1 in .env (or turn it on in the Panel) to show the lobby in friends' Friends tab"
  exit 0
fi

# query-server stays off: BDS answers the status check with an empty body, which this build can't
# read, so the Friends tab shows the fixed details below. Friends aren't dropped after a while
# without joining (expiry), since they would have to add the account again.
cat > /data/config.yml <<EOF
session:
  remote-address: ${LOBBY_HOST:-lobby}
  remote-port: ${LOBBY_PORT:-19132}
  update-interval: 30
  query-server: false
  config-fallback: false
  session-info:
    host-name: Minecade
    world-name: ${WORLD_NAME:-Minecade lobby}
    game-mode: Adventure
    players: 0
    max-players: ${MAX_PLAYERS:-10}
  hide-old-sessions: true
  allow-ipv6: false
friend-sync:
  update-interval: 60
  auto-friend: true
  initial-invite: true
  expiry:
    enabled: false
    days: 15
    check: 1800
notifications:
  enabled: false
  webhook-url: ''
  session-expired-message: |-
    Xbox Session expired, sign in again to update it.

    Use the following link to sign in: %s
    Enter the code: %s
  friend-restriction-message: '%s (%s) has restrictions in place that prevent them from being friends with our account.'
debug-mode: false
suppress-session-update-message: true
config-version: 9
EOF

echo "[broadcaster] relaying Friends tab joins to ${LOBBY_HOST:-lobby}:${LOBBY_PORT:-19132}"
exec java -jar /app/broadcast.jar

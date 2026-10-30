#!/usr/bin/env bash
# Server entrypoint: prepares one BDS instance from the built templates, then execs BDS so it
# owns stdin. Every start copies the world template fresh; resetting a server means a new container.
#   GAME, MAP       template to run: /templates/servers/$GAME/maps/$MAP
#   SERVER_ID       how the orchestrator knows this server ("lobby", or the session id)
#   SERVER_PORT     TCP signaling and UDP game port (the same number inside and outside)
#   TRANSPORT       http | log (must match the orchestrator)
#   IDENTITY        name of this server's saved identity key in /keys (default: SERVER_ID)
#   ORCH_URL, LAN_HOST, PUBLIC_HOST, LAN_PLAYERS, ALLOW_LIST, LOBBY_PORT, SESSION_ID,
#   EXPECTED_PLAYERS, MAX_PLAYERS, SERVER_NAME, DEV_MIN_PLAYERS, DEV_DEMO_GAMES, DEV_HOLO_PREVIEW,
#   GAME_SETTINGS
set -euo pipefail
cd /bds

: "${GAME:?GAME is required}"
: "${MAP:?MAP is required}"
: "${SERVER_ID:?SERVER_ID is required}"
SERVER_PORT="${SERVER_PORT:-19132}"
TRANSPORT="${TRANSPORT:-http}"
ORCH_URL="${ORCH_URL:-http://orchestrator:8080}"
TEMPLATE="/templates/servers/${GAME}"
MAP_DIR="${TEMPLATE}/maps/${MAP}"

fail() { echo "[minecade] $*" >&2; exit 1; }
[[ "$TRANSPORT" == "http" || "$TRANSPORT" == "log" ]] || fail "TRANSPORT must be http or log, got: $TRANSPORT"
[[ -f "$MAP_DIR/world/level.dat" ]] || fail "no world template at $MAP_DIR/world"

set_prop() { # key value: replace an uncommented key, or append it
  if grep -qE "^$1=" server.properties; then
    sed -i -E "s|^$1=.*|$1=$2|" server.properties
  else
    echo "$1=$2" >> server.properties
  fi
}

resolve_ipv4() { # auto | IPv4 literal | hostname (server-udp-ports needs a literal IP)
  local host="$1"
  if [[ "$host" == "auto" ]]; then
    curl -fsS --max-time 10 https://api.ipify.org
  elif [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    echo "$host"
  else
    getent ahostsv4 "$host" | awk 'NR==1 { print $1 }'
  fi
}

csv_json() { # "a, b,,c" -> ["a","b","c"]
  jq -cn --arg s "${1:-}" '$s | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))'
}

PUBLIC_IP="$(resolve_ipv4 "${PUBLIC_HOST:-auto}" || true)"
LAN_IP="$(resolve_ipv4 "${LAN_HOST:?LAN_HOST is required}" || true)"
[[ -n "$PUBLIC_IP" ]] || fail "could not resolve PUBLIC_HOST=${PUBLIC_HOST:-auto}"
[[ -n "$LAN_IP" ]] || fail "could not resolve LAN_HOST=${LAN_HOST}"

# --- server.properties -------------------------------------------------------------------
set_prop server-name "${SERVER_NAME:-Minecade ${GAME}}"
set_prop level-name active
set_prop server-port "$SERVER_PORT"
# One UDP port shared by all clients, advertised on the public IP. LAN clients still connect.
set_prop server-udp-ports "${PUBLIC_IP}:${SERVER_PORT}:${SERVER_PORT}"
set_prop transport nethernet
set_prop max-players "${MAX_PLAYERS:-10}"
set_prop enable-lan-visibility false
set_prop online-mode true
# Needed for console scriptevent and tickingarea. Players join as members, not operators.
set_prop allow-cheats true
set_prop default-player-permission-level member
set_prop gamemode adventure
set_prop force-gamemode true
set_prop difficulty peaceful
set_prop view-distance 10
set_prop tick-distance 4
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false

if [[ -n "${ALLOW_LIST:-}" ]]; then
  csv_json "$ALLOW_LIST" | jq 'map({name: ., ignoresPlayerLimit: false})' > allowlist.json
  set_prop allow-list true
else
  set_prop allow-list false
fi

# --- Server identity ---------------------------------------------------------------------------
# Without a saved key BDS makes up a new identity at every start, and players must accept server
# trust again each time. Keys live in the shared /keys volume, one per role ("lobby", "game"),
# so every game container on the game port keeps the same identity.
if [[ -d /keys ]]; then
  key="/keys/${IDENTITY:-$SERVER_ID}.pem"
  if [[ ! -s "$key" ]]; then
    openssl ecparam -name secp384r1 -genkey -noout -out "$key.tmp"
    mv "$key.tmp" "$key"
    echo "[minecade] created server identity key $key"
  fi
  mkdir -p keys
  cp "$key" keys/server_identity_key.pem
else
  echo "[minecade] no /keys volume: this server gets a new identity at every start" >&2
fi

# --- World: a fresh copy of the template ---------------------------------------------------
rm -rf worlds/active
mkdir -p worlds
cp -r "$MAP_DIR/world" worlds/active

# --- Packs: keep the manifest and script built for TRANSPORT -------------------------------
pack_ref() { # manifest.json -> one world pack list entry
  jq -c '{pack_id: .header.uuid, version: .header.version}' "$1"
}

packs='[]'
if [[ -d "$TEMPLATE/behavior_packs" ]]; then
  for src in "$TEMPLATE"/behavior_packs/*/; do
    [[ -d "$src" ]] || continue
    dest="behavior_packs/minecade_$(basename "$src")"
    rm -rf "$dest"
    cp -r "$src" "$dest"
    mv "$dest/manifest.${TRANSPORT}.json" "$dest/manifest.json"
    rm -f "$dest"/manifest.*.json
    find "$dest/scripts" -name 'main.*.js' ! -name "main.${TRANSPORT}.js" -delete
    packs="$(jq -c --argjson ref "$(pack_ref "$dest/manifest.json")" '. + [$ref]' <<< "$packs")"
  done
fi
echo "$packs" > worlds/active/world_behavior_packs.json

# Resource packs exist in a template only when they have content (the build skips empty ones),
# and players are asked to download them, so require them only when there are any.
rpacks='[]'
if [[ -d "$TEMPLATE/resource_packs" ]]; then
  for src in "$TEMPLATE"/resource_packs/*/; do
    [[ -d "$src" ]] || continue
    dest="resource_packs/minecade_$(basename "$src")"
    rm -rf "$dest"
    cp -r "$src" "$dest"
    rpacks="$(jq -c --argjson ref "$(pack_ref "$dest/manifest.json")" '. + [$ref]' <<< "$rpacks")"
  done
fi
echo "$rpacks" > worlds/active/world_resource_packs.json
set_prop texturepack-required "$([[ "$rpacks" != "[]" ]] && echo true || echo false)"

# --- Script config ---------------------------------------------------------------------------
mkdir -p config/default
modules='["@minecraft/server-gametest","@minecraft/server","@minecraft/server-ui","@minecraft/server-admin","@minecraft/server-editor","@minecraft/debug-utilities"]'
if [[ "$TRANSPORT" == "http" ]]; then
  # server-net may only reach this server's own link on the orchestrator.
  jq -n --argjson modules "$modules" --arg uri "${ORCH_URL%/}/v1/servers/${SERVER_ID}/" \
    '{allowed_modules: ($modules + ["@minecraft/server-net"]), module_permissions: {"@minecraft/server-net": {allowed_uris: [$uri]}}}' \
    > config/default/permissions.json
else
  jq -n --argjson modules "$modules" '{allowed_modules: $modules}' > config/default/permissions.json
fi

# Lists and objects are passed as JSON strings; minigame-core parses them.
map_config='{}'
[[ -f "$MAP_DIR/map.json" ]] && map_config="$(jq -c . "$MAP_DIR/map.json")"
role="game"
[[ "$GAME" == "lobby" ]] && role="lobby"
# The lobby's game screen choices ({"teams":"random"}), or none.
game_settings="${GAME_SETTINGS:-}"
[[ -n "$game_settings" ]] || game_settings='{}'
jq -n \
  --arg serverId "$SERVER_ID" \
  --arg role "$role" \
  --arg game "$GAME" \
  --arg map "$MAP" \
  --arg sessionId "${SESSION_ID:-}" \
  --arg orchestratorUrl "$ORCH_URL" \
  --arg transport "$TRANSPORT" \
  --arg lanHost "$LAN_IP" \
  --arg publicHost "$PUBLIC_IP" \
  --argjson serverPort "$SERVER_PORT" \
  --argjson lobbyPort "${LOBBY_PORT:-19132}" \
  --arg lanPlayers "$(csv_json "${LAN_PLAYERS:-}")" \
  --arg expectedPlayers "$(csv_json "${EXPECTED_PLAYERS:-}")" \
  --arg mapConfig "$map_config" \
  --arg devMinPlayers "${DEV_MIN_PLAYERS:-}" \
  --arg devDemoGames "${DEV_DEMO_GAMES:-}" \
  --arg devHoloPreview "${DEV_HOLO_PREVIEW:-}" \
  --arg settings "$game_settings" \
  '$ARGS.named' > config/default/variables.json

echo "[minecade] ${SERVER_ID}: ${GAME}/${MAP} on port ${SERVER_PORT}, transport ${TRANSPORT}, public ${PUBLIC_IP}, allow-list $([[ -n "${ALLOW_LIST:-}" ]] && echo on || echo off)"
exec ./bedrock_server

#!/usr/bin/env bash
# Server entrypoint: prepares one BDS instance from the built templates, then execs BDS so it
# owns stdin. Every start copies the world template fresh; resetting a server means a new container.
#   GAME, MAP       template to run: /templates/servers/$GAME/maps/$MAP
#   SERVER_ID       how the orchestrator knows this server ("lobby", or the session id)
#   SERVER_PORT     TCP signaling and UDP game port (the same number inside and outside)
#   TRANSPORT       http | log (must match the orchestrator)
#   ORCH_URL, LAN_HOST, PUBLIC_HOST, LAN_PLAYERS, ALLOW_LIST, LOBBY_PORT, SESSION_ID,
#   EXPECTED_PLAYERS, MAX_PLAYERS, SERVER_NAME, DEV_MIN_PLAYERS
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

# --- World: a fresh copy of the template ---------------------------------------------------
rm -rf worlds/active
mkdir -p worlds
cp -r "$MAP_DIR/world" worlds/active

# --- Packs: keep the manifest and script built for TRANSPORT -------------------------------
packs='[]'
if [[ -d "$TEMPLATE/behavior_packs" ]]; then
  for src in "$TEMPLATE"/behavior_packs/*/; do
    dest="behavior_packs/minecade_$(basename "$src")"
    rm -rf "$dest"
    cp -r "$src" "$dest"
    mv "$dest/manifest.${TRANSPORT}.json" "$dest/manifest.json"
    rm -f "$dest"/manifest.*.json
    find "$dest/scripts" -name 'main.*.js' ! -name "main.${TRANSPORT}.js" -delete
    packs="$(jq -c --slurpfile m "$dest/manifest.json" '. + [{pack_id: $m[0].header.uuid, version: $m[0].header.version}]' <<< "$packs")"
  done
fi
echo "$packs" > worlds/active/world_behavior_packs.json

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
  '$ARGS.named' > config/default/variables.json

echo "[minecade] ${SERVER_ID}: ${GAME}/${MAP} on port ${SERVER_PORT}, transport ${TRANSPORT}, public ${PUBLIC_IP}, allow-list $([[ -n "${ALLOW_LIST:-}" ]] && echo on || echo off)"
exec ./bedrock_server

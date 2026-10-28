#!/usr/bin/env bash
# Spike entrypoint: prepares a BDS instance from the bind-mounted /spike folder, then execs BDS.
#   ROLE=makeworld  boot a fresh world with no packs (spike/make-world.ts stops it and copies it out)
#   ROLE=lobby|game copy /spike/world + /spike/dist packs, write config, run
set -euo pipefail
cd /bds

: "${ROLE:?ROLE is required (makeworld|lobby|game)}"
SERVER_PORT="${SERVER_PORT:-19132}"
UDP_PORTS_SPEC="${UDP_PORTS_SPEC:-$SERVER_PORT}"
PERMS="${PERMS:-allowlist}"

set_prop() { # key value: replace an uncommented key, or append it
  if grep -qE "^$1=" server.properties; then
    sed -i -E "s|^$1=.*|$1=$2|" server.properties
  else
    echo "$1=$2" >> server.properties
  fi
}

resolve_ipv4() { # auto | IPv4 literal | hostname
  local host="$1"
  if [[ "$host" == "auto" ]]; then
    curl -fsS --max-time 10 https://api.ipify.org
  elif [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    echo "$host"
  else
    getent ahostsv4 "$host" | awk 'NR==1 { print $1 }'
  fi
}

set_prop server-name "Minecade spike ${ROLE}"
set_prop level-name active
set_prop server-port "$SERVER_PORT"
set_prop transport nethernet
set_prop enable-lan-visibility false
set_prop online-mode true
set_prop allow-cheats true
set_prop gamemode adventure
set_prop force-gamemode true
set_prop difficulty peaceful
set_prop view-distance 10
set_prop tick-distance 4
set_prop content-log-console-output-enabled true
set_prop content-log-level info

if [[ -n "${ALLOW_LIST:-}" ]]; then
  jq -n --arg names "$ALLOW_LIST" \
    '$names | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0)) | map({name: ., ignoresPlayerLimit: false})' \
    > allowlist.json
  set_prop allow-list true
else
  set_prop allow-list false
fi

if [[ "$ROLE" == "makeworld" ]]; then
  set_prop server-udp-ports "$SERVER_PORT"
  echo "[spike] makeworld: generating a fresh world"
  exec ./bedrock_server
fi

PUBLIC_IP="$(resolve_ipv4 "${PUBLIC_HOST:-auto}")"
LAN_IP="$(resolve_ipv4 "${LAN_HOST:?LAN_HOST is required}")"
UDP_SPEC="${UDP_PORTS_SPEC//%PUBLIC%/$PUBLIC_IP}"
UDP_SPEC="${UDP_SPEC//%LAN%/$LAN_IP}"
set_prop server-udp-ports "$UDP_SPEC"

rm -rf worlds/active
mkdir -p worlds
cp -r /spike/world worlds/active
cp /spike/dist/world_behavior_packs.json worlds/active/world_behavior_packs.json
for pack in /spike/dist/packs/*/; do
  cp -r "$pack" behavior_packs/
done

mkdir -p config/default
cp "/spike/dist/permissions.${PERMS}.json" config/default/permissions.json
jq -n \
  --arg role "$ROLE" \
  --arg lanHost "$LAN_IP" \
  --arg publicHost "$PUBLIC_IP" \
  --argjson targetPort "${TARGET_PORT:?TARGET_PORT is required}" \
  --arg relayUrl "${RELAY_URL:-http://relay:8080/}" \
  '{role: $role, lanHost: $lanHost, publicHost: $publicHost, targetPort: $targetPort, relayUrl: $relayUrl}' \
  > config/default/variables.json

echo "[spike] role=${ROLE} port=${SERVER_PORT} server-udp-ports=${UDP_SPEC} perms=${PERMS}"
exec ./bedrock_server

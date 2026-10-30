// Map editor spike, in-game part (pass 10.1): starts two servers that stay up after this script
// exits, both with spike/editor/ingame (a custom wand item with its own icon, a marker entity,
// permission and transfer commands; see bp/scripts/main.js):
//   minecade-editor-spike-a  port 19134, the "editor" identity (kept for the real editor), the
//                            converted world (a copy; the void settings and Beta APIs added)
//   minecade-editor-spike-b  port 19133 (the game port), the "game" identity, the same world
// Players in LAN_PLAYERS are allowed. Drive them with `npm run cmd -- <container> <command>`
// (op, scriptevent eg:perm, scriptevent eg:transfer {...}) and read `docker logs`.
//   npx tsx spike/editor/ingame.ts "<world folder>"
//   npx tsx spike/editor/ingame.ts --stop
// The main stack must not start a game while B holds port 19133.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Docker from "dockerode";
import * as tar from "tar";
import { bakeSettings } from "../../tools/build/bake-core.ts";
import { connectDocker, findContainerByName } from "../../tools/build/docker-util.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../../tools/build/leveldat.ts";
import { readEnv } from "../../tools/control-panel/core.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const SERVERS = [
  { name: "minecade-editor-spike-a", port: 19134, identity: "editor" },
  { name: "minecade-editor-spike-b", port: 19133, identity: "game" },
];

const SERVER_SCRIPT = `
set -e
cd /bds
set_prop() {
  if grep -qE "^$1=" server.properties; then sed -i -E "s|^$1=.*|$1=$2|" server.properties; else echo "$1=$2" >> server.properties; fi
}
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org)"
set_prop server-name "Minecade editor spike $PORT"
set_prop level-name es
set_prop server-port "$PORT"
set_prop server-portv6 "$((PORT + 10))"
set_prop server-udp-ports "$PUBLIC_IP:$PORT:$PORT"
set_prop transport nethernet
set_prop online-mode true
set_prop allow-cheats true
set_prop default-player-permission-level member
set_prop gamemode creative
set_prop force-gamemode false
set_prop difficulty peaceful
set_prop texturepack-required true
set_prop content-log-console-output-enabled true
set_prop content-log-level info
set_prop emit-server-telemetry false
set_prop allow-list true
printf '%s' "$ALLOW" > allowlist.json
key="/keys/$IDENTITY.pem"
if [[ ! -s "$key" ]]; then openssl ecparam -name secp384r1 -genkey -noout -out "$key.tmp"; mv "$key.tmp" "$key"; echo "[spike] created $key"; fi
mkdir -p keys
cp "$key" keys/server_identity_key.pem
exec ./bedrock_server
`;

async function stop(docker: Docker): Promise<void> {
  for (const { name } of SERVERS) {
    const container = await findContainerByName(docker, name);
    if (container) {
      await container.remove({ force: true });
      console.log(`removed ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const docker = connectDocker();
  await stop(docker);
  if (process.argv.includes("--stop")) return;
  const source = process.argv[2];
  if (!source) throw new Error('usage: npx tsx spike/editor/ingame.ts "<world folder>" | --stop');
  const env = readEnv(await readFile(join(root, ".env"), "utf8"));
  const players = (env.LAN_PLAYERS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  const allow = JSON.stringify(players.map((name) => ({ name, ignoresPlayerLimit: false })));

  const staging = await mkdtemp(join(tmpdir(), "minecade-editor-ingame-"));
  try {
    // The world: a copy, with the void settings (spawn above build A) and Beta APIs (server-admin).
    const worldDir = join(staging, "worlds", "es");
    await cp(source, worldDir, { recursive: true });
    const dat = await readLevelDat(join(worldDir, "level.dat"));
    bakeSettings(dat, { spawns: [[8, 10, -16]] } as never);
    enableBetaApis(dat);
    await writeLevelDat(join(worldDir, "level.dat"), dat);
    const bp = JSON.parse(await readFile(join(here, "ingame", "bp", "manifest.json"), "utf8"));
    const rp = JSON.parse(await readFile(join(here, "ingame", "rp", "manifest.json"), "utf8"));
    await writeFile(join(worldDir, "world_behavior_packs.json"), JSON.stringify([{ pack_id: bp.header.uuid, version: bp.header.version }]));
    await writeFile(join(worldDir, "world_resource_packs.json"), JSON.stringify([{ pack_id: rp.header.uuid, version: rp.header.version }]));
    await cp(join(here, "ingame", "bp"), join(staging, "behavior_packs", "editor_spike_bp"), { recursive: true });
    await cp(join(here, "ingame", "rp"), join(staging, "resource_packs", "editor_spike_rp"), { recursive: true });
    await mkdir(join(staging, "config", "default"), { recursive: true });
    await writeFile(join(staging, "config", "default", "permissions.json"), JSON.stringify({ allowed_modules: ["@minecraft/server", "@minecraft/server-admin"] }));

    for (const server of SERVERS) {
      const port = `${server.port}`;
      const container = await docker.createContainer({
        name: server.name,
        Image: "minecade/bds:local",
        Entrypoint: ["/bin/bash", "-c", SERVER_SCRIPT],
        Env: [`PORT=${port}`, `IDENTITY=${server.identity}`, `ALLOW=${allow}`],
        OpenStdin: true,
        StdinOnce: false,
        Tty: false,
        ExposedPorts: { [`${port}/tcp`]: {}, [`${port}/udp`]: {} },
        HostConfig: {
          PortBindings: { [`${port}/tcp`]: [{ HostPort: port }], [`${port}/udp`]: [{ HostPort: port }] },
          Binds: ["minecade-keys:/keys"],
        },
        Labels: { "minecade.role": "spike" },
      });
      await container.putArchive(tar.c({ cwd: staging, portable: true }, ["worlds", "behavior_packs", "resource_packs", "config"]) as unknown as NodeJS.ReadableStream, { path: "/bds" });
      await container.start();
      console.log(`started ${server.name} on port ${port}`);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await main();

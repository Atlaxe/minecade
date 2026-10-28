// Generates spike/world: boots BDS once with no packs, stops it, copies the world out,
// and turns on the Beta APIs experiment in level.dat.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachConsole, connectDocker, copyDirFromContainer, findContainerByName } from "../tools/build/docker-util.ts";
import { enableBetaApis, getTag, isBetaApisEnabled, patchLevelDat, readLevelDat } from "../tools/build/leveldat.ts";

const NAME = "minecade-spike-makeworld";
const spikeDir = fileURLToPath(new URL(".", import.meta.url));
const worldDir = join(spikeDir, "world");
const docker = connectDocker();

const stale = await findContainerByName(docker, NAME);
if (stale) await stale.remove({ force: true });
await rm(worldDir, { recursive: true, force: true });

const container = await docker.createContainer({
  name: NAME,
  Image: "minecade/bds-base:local",
  Entrypoint: ["/bin/bash", "/spike/entrypoint.sh"],
  Env: ["ROLE=makeworld", "SERVER_PORT=19132"],
  OpenStdin: true,
  StdinOnce: false,
  Tty: false,
  HostConfig: { Mounts: [{ Type: "bind", Source: spikeDir, Target: "/spike", ReadOnly: true }] },
});

const serverConsole = await attachConsole(container, true);
await container.start();
await serverConsole.waitFor(/Server started\./, 180_000);
serverConsole.send("stop");
await container.wait();
serverConsole.close();

await copyDirFromContainer(container, "/bds/worlds/active", worldDir);
await container.remove();

const levelDat = join(worldDir, "level.dat");
await patchLevelDat(levelDat, enableBetaApis);
const dat = await readLevelDat(levelDat);
console.log(
  `world ready at ${worldDir}: storageVersion=${dat.storageVersion} betaApis=${isBetaApisEnabled(dat)} ` +
    `Generator=${JSON.stringify(getTag(dat, "Generator"))} LevelName=${JSON.stringify(getTag(dat, "LevelName"))}`,
);

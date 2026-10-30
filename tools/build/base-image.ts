// The plain BDS image (the Dockerfile's "bds" stage, no Minecade build inside): the temporary
// servers of npm run bake and the map editor run on it, so they match the network's BDS version
// without rebuilding the network's own images.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readEnv } from "../control-panel/core.ts";

export const BASE_IMAGE = "minecade/bds-base:local";

/** Builds (or, with the cache, just re-tags) the plain BDS image for BDS_VERSION in .env. */
export function buildBaseImage(root: string, verbose = false): void {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) throw new Error("no .env file: copy .env.example to .env and set EULA=TRUE");
  const env = readEnv(readFileSync(envPath, "utf8"));
  if (env.EULA !== "TRUE") throw new Error("set EULA=TRUE in .env to accept the Minecraft EULA (https://www.minecraft.net/eula)");
  console.log(`Preparing ${BASE_IMAGE} (BDS ${env.BDS_VERSION || "default"})...`);
  const args = ["build", "--target", "bds", "-t", BASE_IMAGE, "-f", "docker/bds/Dockerfile", "--build-arg", `EULA=${env.EULA}`];
  if (env.BDS_VERSION) args.push("--build-arg", `BDS_VERSION=${env.BDS_VERSION}`);
  const result = spawnSync("docker", [...args, "."], { cwd: root, encoding: "utf8", stdio: verbose ? "inherit" : "pipe" });
  if (result.status !== 0) throw new Error(`docker build failed:\n${result.stderr ?? result.error?.message ?? ""}`);
}

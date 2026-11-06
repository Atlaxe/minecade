// Chunker (docker/chunker, the CLI in minecade/chunker:local): prunes a Bedrock world to the
// chunks a map needs, Bedrock to Bedrock with no conversion. Chunker rewrites the world it opens,
// so the world is always copied into its container and the result copied out; no folder on this
// PC is ever opened by it. Its level.dat loses the void layers, so callers put the bake settings
// back afterward (docs/spike-results.md, "Map editor").
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import * as tar from "tar";
import { copyDirFromContainer } from "../build/docker-util.ts";
import type { ChunkRange } from "./select-core.ts";

export const CHUNKER_IMAGE = "minecade/chunker:local";

/** Builds the Chunker image (with the cache, a quick check when it's there already), without holding up the process (the Panel serves meanwhile). */
export function buildChunkerImage(root: string, verbose = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["build", "-t", CHUNKER_IMAGE, "docker/chunker"], { cwd: root, stdio: verbose ? "inherit" : "pipe", windowsHide: true });
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => (errors = (errors + chunk.toString("utf8")).slice(-4000)));
    child.stdout?.resume();
    child.on("error", (error) => reject(new Error(`building ${CHUNKER_IMAGE} failed: ${error.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`building ${CHUNKER_IMAGE} failed:\n${errors}`))));
  });
}

/** Writes the world at `world`, cut down to `chunks`, to `out` (replacing it). */
export async function prune(docker: Docker, world: string, chunks: ChunkRange, out: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "minecade-chunker-"));
  const container = await docker.createContainer({ Image: CHUNKER_IMAGE, Cmd: ["-i", "in", "-o", "out", "-f", "INPUT", "-p", "pruning.json"], Tty: false });
  try {
    await cp(world, join(staging, "in"), { recursive: true });
    const region = { minChunkX: chunks.minX, minChunkZ: chunks.minZ, maxChunkX: chunks.maxX, maxChunkZ: chunks.maxZ };
    await writeFile(join(staging, "pruning.json"), JSON.stringify({ configs: { "minecraft:overworld": { include: true, regions: [region] } } }));
    await container.putArchive(tar.c({ cwd: staging, portable: true }, ["in", "pruning.json"]) as unknown as NodeJS.ReadableStream, { path: "/work" });
    await container.start();
    const { StatusCode } = (await container.wait()) as { StatusCode: number };
    if (StatusCode !== 0) {
      const log = String(await container.logs({ stdout: true, stderr: true }));
      throw new Error(`Chunker stopped with exit code ${StatusCode}: ${log.slice(-600)}`);
    }
    await rm(out, { recursive: true, force: true });
    await copyDirFromContainer(container, "/work/out", out);
  } finally {
    await container.remove({ force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}

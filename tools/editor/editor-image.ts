// The map editor's image: the plain BDS image (the Dockerfile's "bds" stage) with the shared packs
// (blocks, core, guns, armor) in BDS's own pack folders, as the network's image has them (the
// Dockerfile's "editor" stage). It's built when a shared pack's files change (checked at every
// server start, so a pack edit still shows from the next one), and kept across editor runs: the
// image carries the packs' signature as a label. Each server start then
// stages only its own packs and its world: the editor's servers, previews and extractions all run
// on it. The shared packs are staged for it in work/editor/shared/, laid out as the network's
// dist/shared/, and the templates' pack lists name them from there (writePackLists).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "../control-panel/core.ts";
import { connectDocker } from "../build/docker-util.ts";
import { addSharedPacks, PACK_PREFIX, readPinnedManifest, sharedPacks } from "../build/packs.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const EDITOR_IMAGE = "minecade/bds-editor:local";
/** The shared packs as the editor image holds them: <behavior|resource>_packs/minecade_<name>. */
export const EDITOR_SHARED = join(root, "work", "editor", "shared");
/** The signature EDITOR_SHARED was staged for. */
const STAGED = join(root, "work", "editor", "shared.signature");
/** The image's label holding the signature it was built for. */
const LABEL = "minecade.packs";
const DOCKERFILE = join(root, "docker", "bds", "Dockerfile");

/** The build for the shared packs as they were when it started; servers starting meanwhile share it. */
let current: { signature: string; built: Promise<void> } | undefined;

/**
 * Makes sure the editor image holds the shared packs as they are now, building it when it doesn't
 * (the first time in a run, or after a pack changed). Returns the image's name.
 */
export async function editorImage(note: (text: string) => void, verbose = false): Promise<string> {
  const env = buildEnv();
  const signature = await packsSignature(env);
  let built = current?.signature === signature ? current.built : undefined;
  if (!built) {
    // One build at a time: a pack that changed during a build waits for it to finish.
    const before = current?.built.catch(() => {}) ?? Promise.resolve();
    built = before.then(async () => {
      if (!(await upToDate(signature))) await buildImage(env, signature, note, verbose);
    });
    const mine = { signature, built };
    current = mine;
    // A failed build is tried again at the next server start.
    built.catch(() => {
      if (current === mine) current = undefined;
    });
  }
  await built;
  return EDITOR_IMAGE;
}

function buildEnv(): Record<string, string> {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) throw new Error("no .env file: copy .env.example to .env and set EULA=TRUE");
  const env = readEnv(readFileSync(envPath, "utf8"));
  if (env.EULA !== "TRUE") throw new Error("set EULA=TRUE in .env to accept the Minecraft EULA (https://www.minecraft.net/eula)");
  return env;
}

/** What the image is made from: every shared pack file's path, size and time, BDS_VERSION and the Dockerfile. */
async function packsSignature(env: Record<string, string>): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`${env.BDS_VERSION ?? ""}\n${readFileSync(DOCKERFILE, "utf8")}\n`);
  for (const pack of await sharedPacks()) {
    hash.update(`${pack.kind} ${pack.name}\n`);
    const entries = await readdir(pack.dir, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
    // All at once: the blocks pack alone is 12k files.
    const infos = await Promise.all(files.map((file) => stat(file)));
    files.forEach((file, index) => hash.update(`${relative(pack.dir, file)} ${infos[index].size} ${infos[index].mtimeMs}\n`));
  }
  return hash.digest("hex");
}

/** True when the staged packs and the image are both from an earlier build for this signature. */
async function upToDate(signature: string): Promise<boolean> {
  try {
    if ((await readFile(STAGED, "utf8")) !== signature) return false;
    const info = await connectDocker().getImage(EDITOR_IMAGE).inspect();
    return info.Config?.Labels?.[LABEL] === signature;
  } catch {
    return false;
  }
}

async function buildImage(env: Record<string, string>, signature: string, note: (text: string) => void, verbose: boolean): Promise<void> {
  note(`Preparing ${EDITOR_IMAGE} (BDS ${env.BDS_VERSION || "default"} and the shared packs)...`);
  await rm(STAGED, { force: true });
  await rm(EDITOR_SHARED, { recursive: true, force: true });
  const shared = [];
  for (const pack of await sharedPacks()) shared.push({ pack, manifest: await readPinnedManifest(pack.dir) });
  await addSharedPacks(EDITOR_SHARED, shared, PACK_PREFIX);
  const args = ["build", "--target", "editor", "-t", EDITOR_IMAGE, "-f", "docker/bds/Dockerfile", "--build-context", `editorpacks=${EDITOR_SHARED}`];
  args.push("--label", `${LABEL}=${signature}`, "--build-arg", `EULA=${env.EULA}`);
  if (env.BDS_VERSION) args.push("--build-arg", `BDS_VERSION=${env.BDS_VERSION}`);
  await run("docker", [...args, "."], verbose);
  await writeFile(STAGED, signature);
}

/** Runs a command without blocking the editor (its control server keeps answering). */
function run(command: string, args: string[], verbose: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: verbose ? "inherit" : ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr?.on("data", (chunk: Buffer) => (errors = (errors + chunk.toString()).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker build failed:\n${errors}`))));
  });
}

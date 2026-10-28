// Builds spike/packs/* into spike/dist (bundled scripts + manifests + world pack list + permissions).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const spikeDir = fileURLToPath(new URL(".", import.meta.url));
const packsDir = join(spikeDir, "packs");
const distDir = join(spikeDir, "dist");

const DEFAULT_MODULES = [
  "@minecraft/server-gametest",
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-admin",
  "@minecraft/server-editor",
  "@minecraft/debug-utilities",
];

await rm(distDir, { recursive: true, force: true });

const worldPacks: { pack_id: string; version: number[] }[] = [];
for (const name of await readdir(packsDir)) {
  const src = join(packsDir, name);
  const out = join(distDir, "packs", name);
  const manifest = JSON.parse(await readFile(join(src, "manifest.json"), "utf8"));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  await build({
    entryPoints: [join(src, "scripts", "main.ts")],
    outfile: join(out, "scripts", "main.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["@minecraft/*"],
    logLevel: "warning",
  });
  worldPacks.push({ pack_id: manifest.header.uuid, version: manifest.header.version });
  console.log(`built ${name}`);
}

await writeFile(join(distDir, "world_behavior_packs.json"), JSON.stringify(worldPacks, null, 2));

const allowedModules = [...DEFAULT_MODULES, "@minecraft/server-net"];
await writeFile(
  join(distDir, "permissions.allowlist.json"),
  JSON.stringify(
    {
      allowed_modules: allowedModules,
      module_permissions: { "@minecraft/server-net": { allowed_uris: ["http://relay:8080/"] } },
    },
    null,
    2,
  ),
);
await writeFile(join(distDir, "permissions.open.json"), JSON.stringify({ allowed_modules: allowedModules }, null, 2));
console.log("wrote world_behavior_packs.json and permissions.{allowlist,open}.json");

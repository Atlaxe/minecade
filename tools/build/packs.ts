// Builds packs into a server template (dist/templates/servers/<target>/), for the build and for
// the map editor, which builds its own template on every start. Behavior packs with scripts are
// bundled once per transport, and the container entrypoint keeps the pair that matches TRANSPORT.
// Resource packs are versioned by their content. Every server also gets the shared packs: the core
// resource pack (the HUD timer and other shared UI) and the shared blocks pack (custom blocks).
import { existsSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { PlayerSkin, Registry } from "@minecade/minigame-core/config";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { MODULE_VERSIONS, pinManifest, type Manifest } from "./mc-versions.ts";
import { contentHash, withPatchVersion } from "./pack-version.ts";
import { registryPlugin, skinsPlugin, transportPlugin } from "./transport-plugin.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TRANSPORTS: TransportKind[] = ["http", "log"];
/** Added to the HTTP variant's manifest only, so log-transport servers never load it. */
const SERVER_NET = { module_name: "@minecraft/server-net", version: MODULE_VERSIONS["@minecraft/server-net"] };
/** A pack holding only these files has no content, and clients shouldn't download it. */
const PACK_BOILERPLATE = new Set(["manifest.json", "pack_icon.png"]);

/** A pack every server gets, and its folder name in a template. */
export interface SharedPack {
  kind: "behavior" | "resource";
  /** The folder in the template: behavior_packs/<name> or resource_packs/<name>. */
  name: string;
  dir: string;
}

/**
 * The shared packs that exist and have content: the core resource pack, and the shared blocks pack
 * (packs/blocks/, which stays empty until the custom blocks land).
 */
export async function sharedPacks(): Promise<SharedPack[]> {
  const candidates: SharedPack[] = [
    { kind: "behavior", name: "blocks_bp", dir: join(root, "packs", "blocks", "behavior_pack") },
    { kind: "resource", name: "blocks_rp", dir: join(root, "packs", "blocks", "resource_pack") },
    { kind: "resource", name: "core_rp", dir: join(root, "packages", "minigame-core", "resource_pack") },
  ];
  const found: SharedPack[] = [];
  for (const pack of candidates) {
    if (existsSync(join(pack.dir, "manifest.json")) && (await hasContent(pack.dir))) found.push(pack);
  }
  return found;
}

/** A pack's manifest with pinned versions. Throws when it's missing, not JSON, or names an unknown module. */
export async function readPinnedManifest(dir: string): Promise<Manifest> {
  const path = join(dir, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch (error) {
    throw new Error(`${relative(root, path)}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return pinManifest(manifest);
}

export async function hasContent(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && !(entry.parentPath === dir && PACK_BOILERPLATE.has(entry.name))) return true;
  }
  return false;
}

export async function buildBehaviorPack(src: string, out: string, manifest: Manifest, registry: Registry, skins: PlayerSkin[]): Promise<void> {
  // Everything except the sources and the manifest ships as-is (icons, texts, ...).
  await cp(src, out, { recursive: true, filter: (path) => !path.endsWith(".ts") && path !== join(src, "manifest.json") });
  for (const kind of TRANSPORTS) {
    const bundle = join(out, "scripts", `main.${kind}.js`);
    await build({
      entryPoints: [join(src, "scripts", "main.ts")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      external: ["@minecraft/*"],
      plugins: [transportPlugin(kind), registryPlugin(registry), skinsPlugin(skins)],
      logLevel: "warning",
    });
    const variant = structuredClone(manifest);
    for (const module of variant.modules) if (module.type === "script") module.entry = `scripts/main.${kind}.js`;
    if (kind === "http") variant.dependencies = [...(variant.dependencies ?? []), SERVER_NET];
    await writeFile(join(out, `manifest.${kind}.json`), JSON.stringify(variant, null, 2));
    // A script importing a module its manifest doesn't declare fails to load at all on the server.
    const declared = new Set(variant.dependencies?.map((dependency) => dependency.module_name));
    const imported = new Set([...(await readFile(bundle, "utf8")).matchAll(/from\s*"(@minecraft\/[a-z-]+)"/g)].map((match) => match[1]));
    const missing = [...imported].filter((module) => !declared.has(module));
    if (missing.length > 0) {
      throw new Error(`${relative(root, src)}: the ${kind} bundle imports ${missing.join(", ")}; add it to manifest.json dependencies`);
    }
  }
}

/**
 * Copies a resource pack (plus anything `extra` adds), versioned by its content so clients
 * download it again whenever it changes.
 */
export async function buildResourcePack(src: string, out: string, manifest: Manifest, extra?: (out: string) => Promise<void>): Promise<void> {
  await cp(src, out, { recursive: true, filter: (path) => path !== join(src, "manifest.json") });
  await extra?.(out);
  const stamped = withPatchVersion(manifest, await contentHash(out));
  await writeFile(join(out, "manifest.json"), JSON.stringify(stamped, null, 2));
}

/** Adds the shared packs to a template: behavior packs without scripts as they are, resource packs versioned by content. */
export async function addSharedPacks(out: string, packs: { pack: SharedPack; manifest: Manifest }[]): Promise<void> {
  for (const { pack, manifest } of packs) {
    if (pack.kind === "resource") {
      await buildResourcePack(pack.dir, join(out, "resource_packs", pack.name), manifest);
    } else {
      const dest = join(out, "behavior_packs", pack.name);
      await cp(pack.dir, dest, { recursive: true, filter: (path) => !path.endsWith(".ts") && path !== join(pack.dir, "manifest.json") });
      await writeFile(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
    }
  }
}

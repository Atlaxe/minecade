// Builds packs into a server template (dist/templates/servers/<target>/), for the build and for
// the map editor, which builds its own template on every start. Behavior packs with scripts are
// bundled once per transport, and the container entrypoint keeps the pair that matches TRANSPORT.
// Resource packs are versioned by their content. Every server also gets the shared packs: the core
// resource pack (the HUD timer and other shared UI) and the shared blocks pack (custom blocks).
// The build puts those in the image once (dist/shared/, copied into BDS's own pack folders), and
// each template gets the world's pack lists with them in (writePackLists).
import { existsSync } from "node:fs";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { PlayerSkin, Registry } from "@minecade/minigame-core/config";
import type { TransportKind } from "@minecade/minigame-core/protocol";
import { MODULE_VERSIONS, pinManifest, type Manifest } from "./mc-versions.ts";
import { contentHash, withPatchVersion } from "./pack-version.ts";
import { modBlocksPlugin, registryPlugin, skinsPlugin, transportPlugin } from "./transport-plugin.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TRANSPORTS: TransportKind[] = ["http", "log"];
/** Added to the HTTP variant's manifest only, so log-transport servers never load it. */
const SERVER_NET = { module_name: "@minecraft/server-net", version: MODULE_VERSIONS["@minecraft/server-net"] };
/** A pack holding only these files has no content, and clients shouldn't download it. */
const PACK_BOILERPLATE = new Set(["manifest.json", "pack_icon.png"]);
/** What a pack folder is called in the container: the entrypoint copies a template's <name> to minecade_<name>. */
export const PACK_PREFIX = "minecade_";

/** A pack every server gets, and its folder name in a template. */
export interface SharedPack {
  kind: "behavior" | "resource";
  /** The folder in the template: behavior_packs/<name> or resource_packs/<name>. */
  name: string;
  dir: string;
}

/**
 * The shared packs that exist and have content: the shared blocks pack (packs/blocks/, generated
 * and git-ignored), the core resource pack, the shared guns pack (packs/guns/, any game can hand
 * its guns out), and the dyed leather armor pack (packs/armor/, written by the build, git-ignored).
 */
export async function sharedPacks(): Promise<SharedPack[]> {
  const candidates: SharedPack[] = [
    { kind: "behavior", name: "blocks_bp", dir: join(root, "packs", "blocks", "behavior_pack") },
    { kind: "resource", name: "blocks_rp", dir: join(root, "packs", "blocks", "resource_pack") },
    { kind: "resource", name: "core_rp", dir: join(root, "packages", "minigame-core", "resource_pack") },
    { kind: "behavior", name: "guns_bp", dir: join(root, "packs", "guns", "behavior_pack") },
    { kind: "resource", name: "guns_rp", dir: join(root, "packs", "guns", "resource_pack") },
    { kind: "behavior", name: "armor_bp", dir: join(root, "packs", "armor", "behavior_pack") },
    { kind: "resource", name: "armor_rp", dir: join(root, "packs", "armor", "resource_pack") },
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
      plugins: [transportPlugin(kind), registryPlugin(registry), skinsPlugin(skins), modBlocksPlugin()],
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

/**
 * Adds the shared packs to a template, or (with `prefix`, PACK_PREFIX) to the image's shared folder,
 * named as in the container: behavior packs without scripts as they are, resource packs versioned
 * by content.
 */
export async function addSharedPacks(out: string, packs: { pack: SharedPack; manifest: Manifest }[], prefix = ""): Promise<void> {
  for (const { pack, manifest } of packs) {
    if (pack.kind === "resource") {
      await buildResourcePack(pack.dir, join(out, "resource_packs", `${prefix}${pack.name}`), manifest);
    } else {
      const dest = join(out, "behavior_packs", `${prefix}${pack.name}`);
      await cp(pack.dir, dest, { recursive: true, filter: (path) => !path.endsWith(".ts") && path !== join(pack.dir, "manifest.json") });
      await writeFile(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
    }
  }
}

/** One entry of a world's pack list: world_behavior_packs.json, world_resource_packs.json. */
interface PackRef {
  pack_id: string;
  version: number[] | undefined;
}

/**
 * Writes a template's world pack lists, which the entrypoint puts in the world: the template's own
 * packs, and the shared ones in `shared` (the image's dist/shared/, already named as in the
 * container) when they aren't in the template itself, except those `skip` names (the blocks pack a
 * server doesn't load: the full one or the network's cut). They're in order of their folder names in
 * the container, the order the entrypoint always made them in: packs that change the same UI
 * files (the core pack's, the lobby's, the editor's) depend on it.
 */
export async function writePackLists(template: string, shared?: string, skip: (name: string) => boolean = () => false): Promise<void> {
  for (const kind of ["behavior", "resource"] as const) {
    const entries: { name: string; ref: PackRef }[] = [];
    const sources: [string, string][] = [[template, PACK_PREFIX], ...(shared ? [[shared, ""] as [string, string]] : [])];
    for (const [dir, prefix] of sources) {
      const folder = join(dir, `${kind}_packs`);
      if (!existsSync(folder)) continue;
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory() && !skip(name)) entries.push({ name, ref: await packRef(join(folder, entry.name)) });
      }
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    await writeFile(join(template, `world_${kind}_packs.json`), JSON.stringify(entries.map((entry) => entry.ref)));
  }
}

/** A built pack's entry in a world pack list. A pack built per transport names the same pack in each manifest. */
async function packRef(dir: string): Promise<PackRef> {
  const names = existsSync(join(dir, "manifest.json")) ? ["manifest.json"] : TRANSPORTS.map((kind) => `manifest.${kind}.json`);
  const refs: PackRef[] = [];
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(dir, name), "utf8")) as Manifest;
    refs.push({ pack_id: manifest.header.uuid, version: manifest.header.version });
  }
  if (refs.some((ref) => JSON.stringify(ref) !== JSON.stringify(refs[0]))) {
    throw new Error(`${relative(root, dir)}: its transports' manifests name different packs`);
  }
  return refs[0];
}

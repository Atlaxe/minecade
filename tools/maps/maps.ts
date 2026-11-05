// The map store's tools (store.ts; the store is maps\ beside the checkout, or MAP_STORE).
//   npm run maps -- list                          every map: its versions, and whether it's published
//   npm run maps -- versions <target> <map>       a map's versions, the newest first
//   npm run maps -- restore <target> <map> <n>    puts version n back in the map's working folder
//                                                 (close it in the map editor first); Publish it after
//   npm run maps -- export                        writes published\ again (the build reads it)
//   npm run maps -- backup                        copies maps.db into backups\
//   npm run maps -- import [<checkout>] [--replace]
//                                                 takes the maps and game pictures out of a git
//                                                 checkout (this one unless given): HEAD's come in
//                                                 published, the working copy as the working folders
import { resolve } from "node:path";
import { importCheckout } from "./import.ts";
import { repoRoot, storeDir } from "./paths.ts";
import { MapStore } from "./store.ts";

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((arg) => arg.startsWith("--")));
const args = rest.filter((arg) => !arg.startsWith("--"));

const store = MapStore.open(storeDir());
try {
  switch (command) {
    case "list": {
      for (const { target, map, version } of store.published()) console.log(`${target}/${map}: published version ${version}`);
      break;
    }
    case "versions": {
      const [target, map] = need(2);
      for (const version of store.versions(target, map)) {
        const when = new Date(version.savedAt).toLocaleString();
        console.log(`${version.n}${version.published ? " (published)" : ""}: ${version.kind}, ${when}${version.by ? `, ${version.by}` : ""}, ${version.files} files, ${kb(version.bytes)}`);
      }
      break;
    }
    case "restore": {
      const [target, map, n] = need(3);
      store.restore(target, map, Number(n));
      console.log(`${target}/${map}'s working folder is version ${n} again. Publish it in the map editor to put it in the lobby.`);
      break;
    }
    case "export": {
      const { maps, icons } = store.exportPublished();
      console.log(`Wrote ${maps} published maps and ${icons} game pictures to ${resolve(store.dir, "published")}.`);
      break;
    }
    case "backup": {
      console.log(`Backed up to ${store.backup()}.`);
      break;
    }
    case "import": {
      const checkout = resolve(args[0] ?? repoRoot);
      const result = await importCheckout(store, checkout, { replace: flags.has("--replace"), note: (text) => console.log(`  ${text}`) });
      store.backup();
      const { maps } = store.exportPublished();
      console.log(`Imported ${result.maps.length} maps (${result.published.length} published) and ${result.icons.length} game pictures from ${checkout}; ${maps} maps are published.`);
      if (result.skipped.length > 0) console.log(`Left alone (the store has them already; --replace takes them again): ${result.skipped.join(", ")}`);
      break;
    }
    default:
      console.error("Usage: npm run maps -- list | versions <target> <map> | restore <target> <map> <n> | export | backup | import [<checkout>] [--replace]");
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  store.close();
}

function need(count: number): string[] {
  if (args.length < count) throw new Error(`${command} needs ${count} arguments`);
  return args.slice(0, count);
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

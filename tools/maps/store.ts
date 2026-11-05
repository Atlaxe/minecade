// The map store (maps\ beside the checkouts, paths.ts): every map's working copy, the versions it
// was saved as, and which version is published, kept on this PC and out of git.
//   working\<target>\<map>\   the folder the map editor works on (map.json, preview.png, world\),
//                             and working\<game>\icon.png, the game's picture
//   maps.db                   node:sqlite: each map's versions (its folder's files, stored once
//                             each by content), and what's published
//   published\                the published maps (exportPublished): catalog\, what the network's
//                             build reads, and worlds\, what its servers read (mounted at /maps)
//   backups\                  a copy of maps.db after every publish and delete, the newest 30
// A map is known here from its first version; a working folder alone (a map just made) is a draft
// nobody saved yet. Publishing points the map at a version (its newest), and a map given another
// id keeps its history and stays published under its old id until its next Publish.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runtimeMapConfig, type MapConfig } from "@minecade/minigame-core/config";
import { enableBetaApis, patchLevelDatSync } from "../build/leveldat.ts";
import { workingDir } from "./paths.ts";

/** Saves kept per map besides its publishes, the newest first. */
export const KEEP_SAVES = 20;
/** Backups of maps.db kept, the newest first. */
export const KEEP_BACKUPS = 30;
const BACKUP_FILE = /^maps-\d{8}-\d{6}\.db$/;
/** Left out of a map's folder: a world save's half-written copy (session.ts swaps it in whole). */
const SKIPPED_DIRS = new Set(["world.new"]);

// Each entry upgrades the schema by one version (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE maps (
    key INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    id TEXT NOT NULL,
    published_id TEXT,
    published_version INTEGER,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX maps_live ON maps (target, id) WHERE deleted_at IS NULL;
  CREATE TABLE versions (
    map_key INTEGER NOT NULL,
    n INTEGER NOT NULL,
    kind TEXT NOT NULL,
    digest TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    by TEXT,
    PRIMARY KEY (map_key, n)
  );
  CREATE TABLE files (
    map_key INTEGER NOT NULL,
    n INTEGER NOT NULL,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    PRIMARY KEY (map_key, n, path)
  );
  CREATE INDEX files_by_blob ON files (sha256);
  CREATE TABLE blobs (
    sha256 TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  CREATE TABLE icons (
    target TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    published_at INTEGER NOT NULL
  );
  `,
];

/** "save" (the editor saved the world, or stopped), "publish", or "import" (from a git checkout's working copy). */
export type VersionKind = "save" | "publish" | "import";

export interface VersionInfo {
  n: number;
  kind: VersionKind;
  savedAt: number;
  by?: string;
  files: number;
  bytes: number;
  published: boolean;
}

export interface PublishedMap {
  target: string;
  /** The id it was published under. */
  map: string;
  version: number;
}

export type PublishResult = { outcome: "published"; version: number } | { outcome: "unchanged"; version: number };

/**
 * What the network's build needs of a published map (published\catalog\<target>\<map>.json): its
 * name for the lobby's lists, and its own kits for the kit form's pictures. Everything else in its
 * map.json only matters to its server, which reads it from published\worlds\.
 */
export interface MapCard {
  name: string;
  kits?: MapConfig["kits"];
}

/** published\worlds\index.json: each published map's version, by target and map id. */
export type WorldsIndex = Record<string, Record<string, number>>;

interface MapRow {
  key: number;
  target: string;
  id: string;
  published_id: string | null;
  published_version: number | null;
}

interface FileEntry {
  path: string;
  sha256: string;
  data: Buffer;
}

export interface MapStoreOptions {
  now?: () => number;
}

export class MapStore {
  readonly dir: string;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  /** Working folders' digests, by folder, while their files' sizes and times stay the same. */
  private readonly digests = new Map<string, { signature: string; digest: string }>();

  /** Opens (or creates) the store in `dir`. */
  static open(dir: string, options: MapStoreOptions = {}): MapStore {
    mkdirSync(join(dir, "working"), { recursive: true });
    const db = new DatabaseSync(join(dir, "maps.db"));
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA busy_timeout = 5000");
      return new MapStore(dir, db, options);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Brings the schema up to date. Throws for a store from newer tools. */
  constructor(dir: string, db: DatabaseSync, options: MapStoreOptions = {}) {
    this.dir = dir;
    this.db = db;
    this.now = options.now ?? Date.now;
    this.migrate();
  }

  /** A map's working folder. */
  folder(target: string, map: string): string {
    return join(workingDir(target, this.dir), map);
  }

  /** A game's working picture. */
  icon(target: string): string {
    return join(workingDir(target, this.dir), "icon.png");
  }

  /**
   * Keeps the map's working folder (or `from`, a folder laid out the same way) as its next version,
   * unless nothing changed since its newest. The map is known from here on.
   */
  saveVersion(target: string, map: string, kind: VersionKind, by?: string, from = this.folder(target, map)): { version: number; created: boolean } {
    const files = readFolder(from);
    if (!files.some((file) => file.path === "map.json")) throw new Error(`${target}/${map} has no map.json`);
    const digest = digestOf(files);
    return this.transaction(() => {
      const row = this.liveRow(target, map) ?? this.addRow(target, map);
      const newest = this.newestVersion(row.key);
      if (newest && newest.digest === digest) {
        if (kind === "publish" && newest.kind !== "publish") this.db.prepare("UPDATE versions SET kind = 'publish' WHERE map_key = ? AND n = ?").run(row.key, newest.n);
        return { version: newest.n, created: false };
      }
      const n = (newest?.n ?? 0) + 1;
      const addBlob = this.db.prepare("INSERT OR IGNORE INTO blobs (sha256, size, data) VALUES (?, ?, ?)");
      const addFile = this.db.prepare("INSERT INTO files (map_key, n, path, sha256) VALUES (?, ?, ?, ?)");
      for (const file of files) {
        addBlob.run(file.sha256, file.data.length, file.data);
        addFile.run(row.key, n, file.path, file.sha256);
      }
      this.db.prepare("INSERT INTO versions (map_key, n, kind, digest, saved_at, by) VALUES (?, ?, ?, ?, ?, ?)").run(row.key, n, kind, digest, this.now(), by ?? null);
      this.prune(row.key);
      return { version: n, created: true };
    });
  }

  /**
   * Publishes the map as its working folder is now (a version, if it changed), and the game's
   * working picture with it. "unchanged" when that's what was published already.
   */
  publish(target: string, map: string, by?: string): PublishResult {
    const { version } = this.saveVersion(target, map, "publish", by);
    const row = this.liveRow(target, map)!;
    const iconChanged = this.publishIcon(target);
    if (row.published_version === version && row.published_id === map && !iconChanged) return { outcome: "unchanged", version };
    // A map given another id since it was published under this one gives way.
    this.db.prepare("UPDATE maps SET published_id = NULL, published_version = NULL WHERE target = ? AND published_id = ? AND key != ?").run(target, map, row.key);
    this.db.prepare("UPDATE maps SET published_id = ?, published_version = ? WHERE key = ?").run(map, version, row.key);
    this.backup();
    return { outcome: "published", version };
  }

  /** Points the map's publish at one of its versions, as it is (import does, for what git has). */
  setPublished(target: string, map: string, version: number): void {
    const row = this.liveRow(target, map);
    if (!row || !this.db.prepare("SELECT 1 FROM versions WHERE map_key = ? AND n = ?").get(row.key, version)) throw new Error(`${target}/${map} has no version ${version}`);
    this.db.prepare("UPDATE versions SET kind = 'publish' WHERE map_key = ? AND n = ?").run(row.key, version);
    this.db.prepare("UPDATE maps SET published_id = ?, published_version = ? WHERE key = ?").run(map, version, row.key);
  }

  /** Publishes `data` (a PNG) as a game's picture, whatever its working one is (import does). */
  setPublishedIcon(target: string, data: Buffer): void {
    const sha256 = sha(data);
    this.db.prepare("INSERT OR IGNORE INTO blobs (sha256, size, data) VALUES (?, ?, ?)").run(sha256, data.length, data);
    this.db
      .prepare("INSERT INTO icons (target, sha256, published_at) VALUES (?, ?, ?) ON CONFLICT (target) DO UPDATE SET sha256 = excluded.sha256, published_at = excluded.published_at")
      .run(target, sha256, this.now());
  }

  /** Whether the map's working folder isn't what's published: never published, changed since, or given another id since. */
  isUnpublished(target: string, map: string): boolean {
    const row = this.liveRow(target, map);
    if (!row || row.published_version === null) return true;
    if (row.published_id !== map) return true;
    const published = this.db.prepare("SELECT digest FROM versions WHERE map_key = ? AND n = ?").get(row.key, row.published_version) as { digest: string } | undefined;
    const folder = this.folder(target, map);
    return !existsSync(folder) || published?.digest !== this.workingDigest(folder);
  }

  /** The map's working folder moved to `to` (the editor moves it): its history follows. */
  rename(target: string, from: string, to: string): void {
    this.transaction(() => {
      // A map of that id whose folder was deleted by hand is gone already.
      this.db.prepare("UPDATE maps SET deleted_at = ?, published_id = NULL, published_version = NULL WHERE target = ? AND id = ? AND deleted_at IS NULL").run(this.now(), target, to);
      this.db.prepare("UPDATE maps SET id = ? WHERE target = ? AND id = ? AND deleted_at IS NULL").run(to, target, from);
    });
  }

  /**
   * Deletes the map: its working folder goes, and it's no longer published. Its versions are kept
   * (restore brings it back). `published` says whether it was.
   */
  remove(target: string, map: string): { published: boolean } {
    const row = this.liveRow(target, map);
    // Retries cover Windows file watchers (VS Code) briefly holding files in the world.
    rmSync(this.folder(target, map), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (!row) return { published: false };
    this.db.prepare("UPDATE maps SET deleted_at = ?, published_id = NULL, published_version = NULL WHERE key = ?").run(this.now(), row.key);
    this.backup();
    return { published: row.published_version !== null };
  }

  /** The map's versions, the newest first. */
  versions(target: string, map: string): VersionInfo[] {
    const row = this.liveRow(target, map);
    if (!row) return [];
    const rows = this.db
      .prepare(
        `SELECT v.n, v.kind, v.saved_at AS savedAt, v.by, count(f.path) AS files, coalesce(sum(b.size), 0) AS bytes
         FROM versions v JOIN files f ON f.map_key = v.map_key AND f.n = v.n JOIN blobs b ON b.sha256 = f.sha256
         WHERE v.map_key = ? GROUP BY v.n ORDER BY v.n DESC`,
      )
      .all(row.key) as { n: number; kind: VersionKind; savedAt: number; by: string | null; files: number; bytes: number }[];
    return rows.map(({ by, ...version }) => ({ ...version, ...(by ? { by } : {}), published: version.n === row.published_version }));
  }

  /**
   * Puts version `n` back in the map's working folder (keeping what was there as a version first).
   * It's published from its next Publish.
   */
  restore(target: string, map: string, n: number): void {
    const row = this.liveRow(target, map);
    if (!row) throw new Error(`there is no map ${target}/${map}`);
    if (!this.db.prepare("SELECT 1 FROM versions WHERE map_key = ? AND n = ?").get(row.key, n)) throw new Error(`${target}/${map} has no version ${n}`);
    const folder = this.folder(target, map);
    if (existsSync(join(folder, "map.json"))) this.saveVersion(target, map, "save", "restore");
    replaceFolder(folder, (dest) => this.checkout(row.key, n, dest));
  }

  /** Every published map, by target and the id it was published under. */
  published(): PublishedMap[] {
    return (
      this.db
        .prepare("SELECT target, published_id AS map, published_version AS version FROM maps WHERE deleted_at IS NULL AND published_version IS NOT NULL ORDER BY target, published_id")
        .all() as unknown as PublishedMap[]
    ).map((row) => ({ ...row }));
  }

  /**
   * Writes the published maps to `dest` (the store's published\ unless given), in two halves:
   * - catalog\: what the network's build reads (the Docker build's "maps" context): each map's card
   *   (<target>\<map>.json, MapCard) and preview (<target>\<map>.png), and each game's picture
   *   (<game>\icon.png). A file is written only when its bytes change, so the build stays cached
   *   while no map's name, kits or pictures did.
   * - worlds\: what the servers read (mounted at /maps): each published version in a folder of its
   *   own, <target>\<map>\<version>\ (world\ with Beta APIs on, and map.json as servers read it),
   *   written once and never changed, and index.json naming each map's published version, swapped
   *   in whole. A server starting meanwhile reads the old index or the new one, and both versions'
   *   folders are there: the one before the published one stays, older ones go.
   * Anything else in `dest` (the layout before) goes. `written` is how many version folders were new.
   */
  exportPublished(dest = join(this.dir, "published")): { maps: number; icons: number; written: number } {
    const maps = this.db.prepare("SELECT key, target, published_id, published_version FROM maps WHERE deleted_at IS NULL AND published_version IS NOT NULL").all() as unknown as MapRow[];
    const icons = this.db.prepare("SELECT target, sha256 FROM icons").all() as { target: string; sha256: string }[];
    const catalog = join(dest, "catalog");
    const worlds = join(dest, "worlds");
    mkdirSync(catalog, { recursive: true });
    mkdirSync(worlds, { recursive: true });
    for (const entry of readdirSync(dest)) {
      if (entry !== "catalog" && entry !== "worlds") removeTree(join(dest, entry));
    }
    const index: WorldsIndex = {};
    const kept = new Set<string>();
    const keep = (path: string, data: string | Uint8Array) => {
      writeIfChanged(path, data);
      kept.add(path);
    };
    let written = 0;
    for (const row of maps) {
      const map = row.published_id!;
      const n = row.published_version!;
      (index[row.target] ??= {})[map] = n;
      const folder = join(worlds, row.target, map, String(n));
      if (!existsSync(join(folder, "map.json"))) {
        this.writeWorld(row.key, n, folder);
        written++;
      }
      const config = JSON.parse(Buffer.from(this.file(row.key, n, "map.json")!).toString("utf8")) as MapConfig;
      const card: MapCard = { name: config.name, ...(config.kits ? { kits: config.kits } : {}) };
      keep(join(catalog, row.target, `${map}.json`), JSON.stringify(card, null, 2));
      const preview = this.file(row.key, n, "preview.png");
      if (preview) keep(join(catalog, row.target, `${map}.png`), preview);
    }
    for (const icon of icons) keep(join(catalog, icon.target, "icon.png"), this.blob(icon.sha256));
    removeOthers(catalog, kept);
    const indexPath = join(worlds, "index.json");
    const indexJson = JSON.stringify(index, null, 2);
    if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== indexJson) {
      writeFileSync(`${indexPath}.new`, indexJson);
      renameSync(`${indexPath}.new`, indexPath);
    }
    pruneWorlds(worlds, index);
    return { maps: maps.length, icons: icons.length, written };
  }

  /** Copies maps.db into backups\ and keeps the newest KEEP_BACKUPS. Returns the copy's path. */
  backup(): string {
    const dir = join(this.dir, "backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(this.now()).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const file = join(dir, `maps-${stamp}.db`);
    if (!existsSync(file)) this.db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    const backups = readdirSync(dir).filter((name) => BACKUP_FILE.test(name)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) rmSync(join(dir, old), { force: true });
    return file;
  }

  get schemaVersion(): number {
    return (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  }

  close(): void {
    this.db.close();
  }

  /** Publishes the game's working picture when it's new or changed. True when it did. */
  private publishIcon(target: string): boolean {
    const path = this.icon(target);
    if (target === "lobby" || !existsSync(path)) return false;
    const data = readFileSync(path);
    const current = this.db.prepare("SELECT sha256 FROM icons WHERE target = ?").get(target) as { sha256: string } | undefined;
    if (current?.sha256 === sha(data)) return false;
    this.setPublishedIcon(target, data);
    return true;
  }

  private checkout(key: number, n: number, dest: string): void {
    const files = this.db
      .prepare("SELECT f.path, b.data FROM files f JOIN blobs b ON b.sha256 = f.sha256 WHERE f.map_key = ? AND f.n = ? ORDER BY f.path")
      .all(key, n) as { path: string; data: Uint8Array }[];
    mkdirSync(dest, { recursive: true });
    for (const file of files) {
      const out = join(dest, ...file.path.split("/"));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, file.data);
    }
  }

  /** A version's folder as a server reads it: the world with Beta APIs on (which every pack needs), and the runtime map.json. */
  private writeWorld(key: number, n: number, folder: string): void {
    const fresh = `${folder}.new`;
    removeTree(fresh);
    try {
      this.checkout(key, n, fresh);
      rmSync(join(fresh, "preview.png"), { force: true });
      const config = JSON.parse(readFileSync(join(fresh, "map.json"), "utf8")) as MapConfig;
      writeFileSync(join(fresh, "map.json"), JSON.stringify(runtimeMapConfig(config), null, 2));
      // Worlds built by hand in the client usually lack Beta APIs.
      const levelDat = join(fresh, "world", "level.dat");
      if (existsSync(levelDat)) patchLevelDatSync(levelDat, enableBetaApis);
      removeTree(folder);
      renameSync(fresh, folder);
    } catch (error) {
      removeTree(fresh);
      throw error;
    }
  }

  /** One file of a version, or undefined when it has none by that path. */
  private file(key: number, n: number, path: string): Uint8Array | undefined {
    const row = this.db.prepare("SELECT b.data FROM files f JOIN blobs b ON b.sha256 = f.sha256 WHERE f.map_key = ? AND f.n = ? AND f.path = ?").get(key, n, path) as
      | { data: Uint8Array }
      | undefined;
    return row?.data;
  }

  private blob(sha256: string): Uint8Array {
    const row = this.db.prepare("SELECT data FROM blobs WHERE sha256 = ?").get(sha256) as { data: Uint8Array } | undefined;
    if (!row) throw new Error(`the store is missing a file (${sha256})`);
    return row.data;
  }

  private liveRow(target: string, map: string): MapRow | undefined {
    return this.db.prepare("SELECT key, target, id, published_id, published_version FROM maps WHERE target = ? AND id = ? AND deleted_at IS NULL").get(target, map) as MapRow | undefined;
  }

  private addRow(target: string, map: string): MapRow {
    const result = this.db.prepare("INSERT INTO maps (target, id, created_at) VALUES (?, ?, ?)").run(target, map, this.now());
    return { key: Number(result.lastInsertRowid), target, id: map, published_id: null, published_version: null };
  }

  private newestVersion(key: number): { n: number; kind: VersionKind; digest: string } | undefined {
    return this.db.prepare("SELECT n, kind, digest FROM versions WHERE map_key = ? ORDER BY n DESC LIMIT 1").get(key) as { n: number; kind: VersionKind; digest: string } | undefined;
  }

  /** Keeps every publish and the newest KEEP_SAVES other versions of a map; files nothing uses any more go. */
  private prune(key: number): void {
    const old = this.db
      .prepare("SELECT n FROM versions WHERE map_key = ? AND kind != 'publish' ORDER BY n DESC LIMIT -1 OFFSET ?")
      .all(key, KEEP_SAVES) as { n: number }[];
    if (old.length === 0) return;
    for (const { n } of old) {
      this.db.prepare("DELETE FROM files WHERE map_key = ? AND n = ?").run(key, n);
      this.db.prepare("DELETE FROM versions WHERE map_key = ? AND n = ?").run(key, n);
    }
    this.db.exec(
      "DELETE FROM blobs WHERE NOT EXISTS (SELECT 1 FROM files WHERE files.sha256 = blobs.sha256) AND NOT EXISTS (SELECT 1 FROM icons WHERE icons.sha256 = blobs.sha256)",
    );
  }

  private workingDigest(folder: string): string {
    const signature = folderSignature(folder);
    const cached = this.digests.get(folder);
    if (cached?.signature === signature) return cached.digest;
    const digest = digestOf(readFolder(folder));
    this.digests.set(folder, { signature, digest });
    return digest;
  }

  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    const version = this.schemaVersion;
    if (version > MIGRATIONS.length) {
      throw new Error(`maps.db has schema version ${version}, newer than these tools know (${MIGRATIONS.length})`);
    }
    for (let next = version; next < MIGRATIONS.length; next++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[next]);
        this.db.exec(`PRAGMA user_version = ${next + 1}`);
      });
    }
  }
}

/** A map folder's files (paths with "/", sorted), each with its content and hash. */
function readFolder(dir: string): FileEntry[] {
  return listFiles(dir).map((path) => {
    const data = readFileSync(join(dir, ...path.split("/")));
    return { path, sha256: sha(data), data };
  });
}

function listFiles(dir: string, prefix = ""): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!(prefix === "" && SKIPPED_DIRS.has(entry.name))) paths.push(...listFiles(join(dir, entry.name), path));
    } else if (entry.isFile()) paths.push(path);
  }
  return paths.sort();
}

/** The files' sizes and modified times: while it stays the same, so does the folder's digest. */
function folderSignature(dir: string): string {
  return listFiles(dir)
    .map((path) => {
      const info = statSync(join(dir, ...path.split("/")));
      return `${path}:${info.size}:${info.mtimeMs}`;
    })
    .join("|");
}

function digestOf(files: { path: string; sha256: string }[]): string {
  return sha(Buffer.from(JSON.stringify(files.map((file) => [file.path, file.sha256]))));
}

function sha(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deletes a file or folder, if it's there. Retries cover Windows file watchers (VS Code) briefly holding files. */
function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Writes a file unless it already holds exactly `data`, so its time (and Docker's build cache) stays. */
function writeIfChanged(path: string, data: string | Uint8Array): void {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  if (existsSync(path) && readFileSync(path).equals(bytes)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/** Deletes every file under `dir` that isn't in `kept`, and the folders left empty. */
function removeOthers(dir: string, kept: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeOthers(path, kept);
      if (readdirSync(path).length === 0) removeTree(path);
    } else if (!kept.has(path)) rmSync(path, { force: true });
  }
}

/**
 * Keeps, for each map in the index, its published version's folder and the newest one before it
 * (a server may have read the index just before it changed); every other folder under `worlds`
 * goes, with the maps and targets no longer published.
 */
function pruneWorlds(worlds: string, index: WorldsIndex): void {
  for (const target of readdirSync(worlds, { withFileTypes: true })) {
    if (!target.isDirectory()) continue;
    const targetDir = join(worlds, target.name);
    for (const map of readdirSync(targetDir, { withFileTypes: true })) {
      const mapDir = join(targetDir, map.name);
      const published = index[target.name]?.[map.name];
      if (!map.isDirectory() || published === undefined) {
        removeTree(mapDir);
        continue;
      }
      const versions = readdirSync(mapDir).filter((name) => /^[0-9]+$/.test(name)).map(Number);
      const before = Math.max(-1, ...versions.filter((n) => n < published));
      for (const name of readdirSync(mapDir)) {
        if (name !== String(published) && name !== String(before)) removeTree(join(mapDir, name));
      }
    }
    if (readdirSync(targetDir).length === 0) removeTree(targetDir);
  }
}

/** Fills a new folder beside `dest` with `fill`, then swaps it in for `dest` whole. */
function replaceFolder(dest: string, fill: (fresh: string) => void): void {
  const fresh = `${dest}.new`;
  rmSync(fresh, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  try {
    fill(fresh);
    // Retries cover Windows file watchers (VS Code) briefly holding files in the old folder.
    rmSync(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    renameSync(fresh, dest);
  } catch (error) {
    rmSync(fresh, { recursive: true, force: true });
    throw error;
  }
}

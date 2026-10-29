import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash, withPatchVersion } from "../pack-version.ts";

const dirs: string[] = [];
function pack(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "minecade-pack-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("contentHash", () => {
  it("changes when a file changes, and ignores the manifest", async () => {
    const a = await contentHash(pack({ "manifest.json": "{}", "ui/hud_screen.json": "one" }));
    expect(await contentHash(pack({ "manifest.json": '{"other": 1}', "ui/hud_screen.json": "one" }))).toBe(a);
    expect(await contentHash(pack({ "manifest.json": "{}", "ui/hud_screen.json": "two" }))).not.toBe(a);
    expect(await contentHash(pack({ "manifest.json": "{}", "ui/renamed.json": "one" }))).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(32_768);
  });
});

describe("withPatchVersion", () => {
  it("sets the header and every module to major.minor.patch, keeping major and minor", () => {
    const manifest = { header: { uuid: "h", version: [2, 3, 0] }, modules: [{ type: "resources", uuid: "m", version: [2, 3, 0] }] };
    expect(withPatchVersion(manifest, 42)).toEqual({ header: { uuid: "h", version: [2, 3, 42] }, modules: [{ type: "resources", uuid: "m", version: [2, 3, 42] }] });
    expect(manifest.header.version).toEqual([2, 3, 0]);
  });
});

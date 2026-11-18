import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash } from "../../build/pack-version.ts";
import { buildEditorTemplate } from "../template.ts";

let out: string | undefined;

afterAll(async () => {
  if (out) await rm(out, { recursive: true, force: true });
});

describe("Edit's template", () => {
  // Clients keep a pack they have by its UUID and version, so a resource pack's version must come
  // from every file it ships: the fake player went in after the stamp once, and the mannequins'
  // new poses never reached the client (their size, set by the server, did).
  it("stamps its resource pack's version from the pack as it ships, the fake player included", async () => {
    out = await mkdtemp(join(tmpdir(), "editor-template-"));
    await buildEditorTemplate(out);
    const rp = join(out, "resource_packs", "editor_rp");
    const manifest = JSON.parse(await readFile(join(rp, "manifest.json"), "utf8")) as { header: { version: number[] } };
    const animations = JSON.parse(await readFile(join(rp, "animations", "fake_player.animation.json"), "utf8")) as { animations: Record<string, unknown> };
    expect(Object.keys(animations.animations)).toContain("animation.minecade.fake_player.sitting");
    expect(manifest.header.version[2]).toBe(await contentHash(rp));
  }, 120_000);
});

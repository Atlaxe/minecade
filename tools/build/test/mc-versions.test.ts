import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_ENGINE_VERSION, MODULE_VERSIONS, pinManifest, type Manifest } from "../mc-versions.ts";

const manifest: Manifest = {
  header: { uuid: "h", min_engine_version: [1, 21, 0] },
  modules: [{ type: "script", uuid: "m", entry: "scripts/main.js" }],
  dependencies: [
    { module_name: "@minecraft/server", version: "1.0.0" },
    { module_name: "@minecraft/server-admin", version: "*" },
    { uuid: "another-pack", version: [1, 0, 0] },
  ],
};

describe("pinManifest", () => {
  it("pins module and engine versions and leaves pack dependencies alone", () => {
    const pinned = pinManifest(manifest);
    expect(pinned.header.min_engine_version).toEqual(MIN_ENGINE_VERSION);
    expect(pinned.dependencies).toEqual([
      { module_name: "@minecraft/server", version: MODULE_VERSIONS["@minecraft/server"] },
      { module_name: "@minecraft/server-admin", version: MODULE_VERSIONS["@minecraft/server-admin"] },
      { uuid: "another-pack", version: [1, 0, 0] },
    ]);
    expect(manifest.dependencies?.[0].version).toBe("1.0.0"); // the input is not modified
  });

  it("refuses a module it doesn't know", () => {
    expect(() => pinManifest({ ...manifest, dependencies: [{ module_name: "@minecraft/server-gaemtest", version: "1" }] })).toThrow(
      /unknown script module "@minecraft\/server-gaemtest"/,
    );
  });

  it("matches the @minecraft/* npm packages the code is type-checked against", () => {
    const { devDependencies } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    for (const [module, version] of Object.entries(MODULE_VERSIONS)) {
      // npm beta builds carry a suffix: manifest "1.0.0-beta" is npm "1.0.0-beta.1.26.60-stable".
      expect(devDependencies[module], module).toMatch(new RegExp(`^${version.replaceAll(".", "\\.")}($|\\.)`));
    }
  });
});

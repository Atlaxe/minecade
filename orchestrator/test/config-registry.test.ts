import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { loadRegistry, resolveGameMap } from "../src/registry.ts";
import { registry } from "./fakes.ts";

describe("loadConfig", () => {
  it("fills in defaults", () => {
    expect(loadConfig({ LAN_HOST: "192.168.40.98" })).toMatchObject({
      transport: "http",
      publicHost: "auto",
      serverImage: "minecade/bds:local",
      network: "minecade",
      lobbyPort: 19132,
      gamePort: 19133,
      sparePort: 19134,
      readyTimeoutMs: 120_000,
      emptyBackstopMs: 180_000,
      devDemoStats: false,
    });
    expect(loadConfig({ LAN_HOST: "x", DEV_DEMO_STATS: "1" }).devDemoStats).toBe(true);
  });

  it("rejects bad settings", () => {
    expect(() => loadConfig({})).toThrow(/LAN_HOST/);
    expect(() => loadConfig({ LAN_HOST: "x", TRANSPORT: "carrier-pigeon" })).toThrow(/TRANSPORT/);
    expect(() => loadConfig({ LAN_HOST: "x", READY_TIMEOUT_S: "soon" })).toThrow(/whole number/);
  });
});

describe("registry", () => {
  it("loads a registry file and rejects a game without maps", () => {
    const dir = mkdtempSync(join(tmpdir(), "minecade-registry-"));
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(registry));
    expect(loadRegistry(good).games[0].id).toBe("probe");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ games: [{ id: "empty", maps: [] }] }));
    expect(() => loadRegistry(bad)).toThrow(/at least one map/);
  });

  it("resolves explicit and random maps", () => {
    expect(resolveGameMap(registry, "probe", "default")).toMatchObject({ ok: true, map: { id: "default" } });
    expect(resolveGameMap(registry, "probe", "random", () => 0)).toMatchObject({ ok: true, map: { id: "default" } });
    expect(resolveGameMap(registry, "probe", "random", () => 0.99)).toMatchObject({ ok: true, map: { id: "other" } });
    expect(resolveGameMap(registry, "probe", "nope")).toEqual({ ok: false, reason: 'game "probe" has no map "nope"' });
  });
});

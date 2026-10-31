import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHIMES, Scope, stripColors } from "@minecade/minigame-core";
import { system, world } from "../../packages/minigame-core/test/fake-mc-server.ts";
import { MODE_MARK, keepModeLine, modeLine } from "../behavior_pack/scripts/hud.ts";
import { actionBar, hintBar, notice } from "../behavior_pack/scripts/tool-host.ts";

beforeEach(() => {
  system.reset();
});

afterEach(() => {
  world.reset();
});

describe("modeLine", () => {
  it("starts with the invisible mark, then the mode in its color and the detail in gray", () => {
    expect(modeLine("edit", "Sumo: Arena")).toBe(`${MODE_MARK}§aEdit§7   Sumo: Arena`);
    expect(modeLine("select")).toBe(`${MODE_MARK}§bSelect`);
    expect(stripColors(modeLine("select", "Arenas"))).toBe("Select   Arenas");
  });

  it("uses the same mark as the editor's resource pack, for the plain title and the box", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud.split(`'${MODE_MARK}'`).length - 1).toBe(2);
    expect(stripColors(MODE_MARK)).toBe("");
  });
});

describe("keepModeLine", () => {
  it("shows the line when a player spawns, and again every few seconds", () => {
    const scope = new Scope("test");
    keepModeLine(scope, (player) => modeLine("edit", player.name));
    const player = world.join("Alex");
    system.advanceTicks(1);
    expect(player.titles.map(stripColors)).toEqual(["Edit   Alex"]);
    system.advanceTicks(100);
    expect(player.titles).toHaveLength(2);
    scope.dispose();
    system.advanceTicks(100);
    expect(player.titles).toHaveLength(2);
  });
});

describe("notice", () => {
  it("chimes, keeps the held tool's hint off the bar, and is put back once before it fades", () => {
    const scope = new Scope("test");
    const player = world.join("Alex");
    notice(scope, player as never, "Castle is ready");
    expect(player.actionBar).toBe("Castle is ready");
    expect(player.sounds.map((sound) => sound.id)).toEqual([CHIMES.go.id]);
    system.advanceTicks(40);
    hintBar(player as never, "Select tool: hit a block");
    expect(player.actionBar).toBe("Castle is ready");
    player.actionBar = "";
    system.advanceTicks(10);
    expect(player.actionBar).toBe("Castle is ready");
    system.advanceTicks(70);
    hintBar(player as never, "Select tool: hit a block");
    expect(player.actionBar).toBe("Select tool: hit a block");
    scope.dispose();
  });

  it("isn't put back once feedback replaced it", () => {
    const scope = new Scope("test");
    const player = world.join("Alex");
    notice(scope, player as never, "Castle is ready");
    actionBar(player as never, "Selection: 3 x 3 x 3");
    player.actionBar = "";
    system.advanceTicks(50);
    expect(player.actionBar).toBe("");
    scope.dispose();
  });
});

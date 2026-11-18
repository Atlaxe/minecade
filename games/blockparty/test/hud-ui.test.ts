import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, STARS_LAYER, blockpartyHud, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { STAR_PHASES, phaseCode, starsCode } from "../behavior_pack/scripts/bar-codes.ts";
import { PHASE_MS, STAR_LAYERS, STAR_PERIOD_MS, StarField, layerSpeed, layerStart, loopSeconds } from "../behavior_pack/scripts/stars.ts";

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes or the layers)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("parses as JSON once its two comment lines are off", () => {
    const body = blockpartyHudFile().split("\n").slice(2).join("\n");
    expect(JSON.parse(body).namespace).toBe("blockparty_hud");
  });

  it("puts the star field's strength, way and phase on the line", () => {
    expect(starsCode(0, "down", 3)).toBe("");
    expect(starsCode(3)).toBe("§k§d§3");
    expect(starsCode(99)).toBe("§k§d§8");
    expect(starsCode(8, "down")).toBe("§k§d§8§k§g");
    expect(starsCode(8, "down", 0x2f)).toBe("§k§d§8§k§g§2§f");
    expect(starsCode(1, "up", 255)).toBe("§k§d§1§k§h§f§f");
    expect(phaseCode("down", STAR_PHASES + 1)).toBe("§k§g§0§1");
    expect(phaseCode("up", -1)).toBe("§k§h§f§f");
  });

  it("has a copy of the layers for every phase and way, each built only when the line names it", () => {
    const field = blockpartyHud().field as { controls: Record<string, { ignored: string }>[] };
    expect(field.controls).toHaveLength(STAR_PHASES * 2);
    const ignored = field.controls.map((copy) => Object.values(copy)[0].ignored);
    expect(new Set(ignored).size).toBe(STAR_PHASES * 2);
    expect(ignored[0]).toBe("(($atext - '§k§g§0§0') = $atext)");
    expect(ignored[STAR_PHASES + 37]).toBe("(($atext - '§k§h§2§5') = $atext)");
  });

  it("draws the stars over the board's screens but under the dialogue box and the fork box", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).toContain('"bp_stars@blockparty_hud.stars"');
    expect(hud).toContain('"jui_blockparty_dialogue@jui_blockparty_dialogue.layout": { "layer": 200 }');
    expect(hud).toContain('"jui_blockparty_fork@jui_blockparty_fork.layout": { "layer": 200 }');
    expect(STARS_LAYER).toBeGreaterThan(159);
    expect(STARS_LAYER).toBeLessThan(200);
  });

  it("leaves the hotbar to vanilla (no pack hotbar in the HUD)", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).not.toContain("blockparty_hud.hotbar");
    expect(hud).not.toContain("item_name_text_root");
  });
});

/** How far apart two offsets are on a layer that repeats every `tile`. */
function apart(a: number, b: number, tile: number): number {
  const gap = (((a - b) % tile) + tile) % tile;
  return Math.min(gap, tile - gap);
}

describe("the star field's layers", () => {
  it("slide whole tiles in a period, faster as they come nearer", () => {
    const speeds = STAR_LAYERS.map(layerSpeed);
    expect(speeds).toEqual([20, 40, 80]);
    for (const layer of STAR_LAYERS) expect((loopSeconds(layer) * layerSpeed(layer)) / layer.tile).toBeCloseTo(1);
  });

  it("start each phase where the slide has taken them, and reach the loop's end on time", () => {
    for (const layer of STAR_LAYERS) {
      const speed = layerSpeed(layer);
      for (let phase = 0; phase < STAR_PHASES; phase++) {
        const seconds = (phase * PHASE_MS) / 1000;
        const slid = (speed * seconds) % layer.tile;
        const down = layerStart(layer, phase, "down");
        expect(down.from).toBeGreaterThanOrEqual(-layer.tile);
        expect(down.from).toBeLessThan(0);
        expect(apart(down.from + layer.tile, slid, layer.tile)).toBeCloseTo(0);
        expect(down.from + speed * down.seconds).toBeCloseTo(0);
        const up = layerStart(layer, phase, "up");
        expect(up.seconds).toBeGreaterThan(0);
        expect(up.from - speed * up.seconds).toBeCloseTo(-layer.tile);
        // The same picture either way at the same phase: reversing doesn't jump.
        expect(apart(up.from, down.from, layer.tile)).toBeCloseTo(0);
      }
    }
  });

  it("goes round once in a period", () => {
    expect(STAR_PERIOD_MS).toBe(STAR_PHASES * PHASE_MS);
  });
});

describe("the star field's state", () => {
  it("slides by the clock while it's up, back as it turns, and holds while it's down", () => {
    let now = 1000;
    const stars = new StarField(() => now);
    expect(stars.codes()).toBe("");
    expect(stars.exact).toBe(true);
    stars.level = 1;
    now += 1000;
    expect(stars.phase).toBe(10);
    expect(stars.codes()).toBe("§k§d§1§k§g§0§a");
    expect(stars.key()).toBe("§k§d§1§k§g");
    stars.direction = "up";
    now += 300;
    expect(stars.phase).toBe(7);
    expect(stars.codes()).toBe("§k§d§1§k§h§0§7");
    now += 900;
    // Slid back past where it started: the phases wrap.
    expect(stars.phase).toBe(STAR_PHASES - 2);
    stars.level = 0;
    now += 5000;
    stars.level = 2;
    expect(stars.phase).toBe(STAR_PHASES - 2);
  });

  it("is exact on a phase, and not between two", () => {
    let now = 0;
    const stars = new StarField(() => now);
    stars.level = 8;
    now = 1000;
    expect(stars.exact).toBe(true);
    now = 1020;
    expect(stars.exact).toBe(true);
    now = 1050;
    expect(stars.exact).toBe(false);
    now = 1080;
    expect(stars.exact).toBe(true);
  });
});

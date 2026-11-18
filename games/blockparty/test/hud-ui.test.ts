import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, STARS_LAYER, blockpartyHud, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { STAR_LEVELS, STAR_PHASES, phaseCode, starsCode } from "../behavior_pack/scripts/bar-codes.ts";
import { LIFE, PHASE_MS, STAR_CYCLE_MS, StarField, ZOOM_FROM, ZOOM_LAYERS, ZOOM_TO, alphaAt, lifeAt, zoomAt } from "../behavior_pack/scripts/stars.ts";

type Anim = { anim_type: string; from: unknown; to: unknown; duration: number; next: string };

const percent = (value: unknown) => Number.parseFloat((value as string[])[0]);

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes or the star field)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("parses as JSON once its two comment lines are off", () => {
    const body = blockpartyHudFile().split("\n").slice(2).join("\n");
    expect(JSON.parse(body).namespace).toBe("blockparty_hud");
  });

  it("puts the star field's strength and phase on the line", () => {
    expect(starsCode(0, 3)).toBe("");
    expect(starsCode(3)).toBe("§k§d§3");
    expect(starsCode(99)).toBe("§k§d§8");
    expect(starsCode(8, 0x1f)).toBe("§k§d§8§k§x§1§f");
    expect(phaseCode(STAR_PHASES + 1)).toBe("§k§x§0§1");
    expect(phaseCode(-1)).toBe("§k§x§1§f");
  });

  it("shows the star field with visible, which reads its own $atext (ignored reads only its parents', and left it out every time)", () => {
    const stars = blockpartyHud().stars as { visible?: string; ignored?: string; $atext: string };
    expect(stars.ignored).toBeUndefined();
    expect(stars.visible).toBe("(not (($atext - '§k§d') = $atext))");
    expect(stars.$atext).toBe("$actionbar_text");
  });

  it("has a copy of the zoom layers for every strength and phase, each built only when the line names it", () => {
    const stars = blockpartyHud().stars as { controls: Record<string, { ignored: string; controls: Record<string, { ignored?: string; controls?: unknown[] }>[] }>[] };
    expect(stars.controls).toHaveLength(STAR_LEVELS);
    const level3 = stars.controls[2].level_3;
    expect(level3.ignored).toBe("(($atext - '§k§d§3') = $atext)");
    // The still stars far behind, then a copy for each phase.
    expect(level3.controls).toHaveLength(1 + STAR_PHASES);
    const copy = level3.controls[1 + 5].p5;
    expect(copy.ignored).toBe("(($atext - '§k§x§0§5') = $atext)");
    expect(copy.controls).toHaveLength(ZOOM_LAYERS);
    expect(copy.controls![1]).toEqual({ "z1@blockparty_hud.zoom_1": { $zoom_anims: ["@blockparty_hud.size_from_13", "@blockparty_hud.alpha_3_from_13"] } });
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

describe("the zoom layers", () => {
  const hud = blockpartyHud() as unknown as Record<string, Anim>;
  const cycle = STAR_CYCLE_MS / 1000;

  it("grow steadily from small to large over a life, a quarter of a life apart", () => {
    expect(zoomAt(0)).toBe(ZOOM_FROM);
    expect(zoomAt(STAR_PHASES)).toBe(ZOOM_TO);
    expect(lifeAt(0, 1)).toBe(STAR_PHASES / ZOOM_LAYERS);
    expect(lifeAt(STAR_PHASES - 1, 1)).toBe(STAR_PHASES / ZOOM_LAYERS - 1);
  });

  it("are unseen when they jump back to small, and fade in and out between", () => {
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(STAR_PHASES - 1)).toBe(0);
    expect(alphaAt(4)).toBeCloseTo(0.5);
    expect(alphaAt(12)).toBe(1);
    expect(LIFE.at(-1)!.to).toBe(STAR_PHASES);
  });

  it("start each phase at the size the life has reached, and are at full size when it ends", () => {
    expect(hud.size_loop.duration).toBeCloseTo(cycle);
    for (let life = 0; life < STAR_PHASES; life++) {
      const anim = hud[`size_from_${life}`];
      expect(percent(anim.from) / 100).toBeCloseTo(zoomAt(life));
      expect(percent(anim.to) / 100).toBe(ZOOM_TO);
      expect(anim.duration).toBeCloseTo(((STAR_PHASES - life) * PHASE_MS) / 1000);
      expect(anim.next).toBe("@blockparty_hud.size_loop");
    }
  });

  it("follow one alpha all the way round from any phase, at each strength", () => {
    for (let level = 1; level <= STAR_LEVELS; level++) {
      const strength = level / STAR_LEVELS;
      for (let life = 0; life < STAR_PHASES; life++) {
        // Walk the chain from this phase until the life comes round: the times add up and each step starts where the last ended.
        let anim = hud[`alpha_${level}_from_${life}`];
        expect(anim.from).toBeCloseTo(alphaAt(life) * strength, 2);
        let time = anim.duration;
        let at = anim.to as number;
        while (anim.next !== `@blockparty_hud.alpha_${level}_in`) {
          anim = hud[anim.next.replace("@blockparty_hud.", "")];
          expect(anim.from).toBeCloseTo(at, 3);
          time += anim.duration;
          at = anim.to as number;
        }
        expect(time).toBeCloseTo(((STAR_PHASES - life) * PHASE_MS) / 1000);
        expect(at).toBe(0);
      }
    }
  });
});

describe("the star field's state", () => {
  it("zooms by the clock while it's up, and holds while it's down", () => {
    let now = 1000;
    const stars = new StarField(() => now);
    expect(stars.codes()).toBe("");
    expect(stars.exact).toBe(true);
    stars.level = 1;
    now += 1000;
    expect(stars.phase).toBe(10);
    expect(stars.codes()).toBe("§k§d§1§k§x§0§a");
    expect(stars.key()).toBe("§k§d§1");
    now += 2600;
    // Round past the end of a life: the phases wrap.
    expect(stars.phase).toBe(4);
    stars.level = 0;
    now += 5000;
    stars.level = 2;
    expect(stars.phase).toBe(4);
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

describe("the star field's codes", () => {
  it("never match the core's codes on the same line (its clock's places, its count's)", () => {
    const core = ["§k§a", "§k§b", "§k§c", "§k§e", "§k§g", "§k§h", "§k§i", "§k§j", "§k§l", "§k§m", "§k§n", "§k§p", "§k§q", "§k§s", "§k§t", "§k§u"];
    for (let level = 1; level <= STAR_LEVELS; level++) {
      for (let phase = 0; phase < STAR_PHASES; phase++) {
        const line = starsCode(level, phase);
        for (const code of core) expect(line).not.toContain(code);
      }
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKPARTY_HUD_FILE, STARS_LAYER, blockpartyHud, blockpartyHudFile } from "../../../tools/assets/blockparty-hud-ui.ts";
import { STAR_FRAMES, STAR_LEVELS, frameCode, starsCode } from "../behavior_pack/scripts/bar-codes.ts";
import { LIFE, StarField, ZOOM_FROM, ZOOM_LAYERS, ZOOM_TO, alphaAt, lifeAt, zoomAt } from "../behavior_pack/scripts/stars.ts";

type Picture = { size: string[]; alpha: number };
type Level = { ignored: string; controls: Record<string, { ignored?: string; controls?: Record<string, Picture>[] }>[] };

const levelOf = (level: number) => (blockpartyHud().stars as { controls: Record<string, Level>[] }).controls[level - 1][`level_${level}`];

describe("Block Party's own HUD", () => {
  it("is the file tools/assets/blockparty-hud-ui.ts writes (rerun it after changing the codes or the star field)", () => {
    expect(readFileSync(BLOCKPARTY_HUD_FILE, "utf8").replaceAll("\r\n", "\n")).toBe(blockpartyHudFile());
  });

  it("parses as JSON once its two comment lines are off", () => {
    const body = blockpartyHudFile().split("\n").slice(2).join("\n");
    expect(JSON.parse(body).namespace).toBe("blockparty_hud");
  });

  it("puts the star field's strength and frame on the line", () => {
    expect(starsCode(0, 3)).toBe("");
    expect(starsCode(3)).toBe("§k§d§3§k§x§0§0");
    expect(starsCode(99, 0x3f)).toBe("§k§d§8§k§x§3§f");
    expect(frameCode(STAR_FRAMES + 1)).toBe("§k§x§0§1");
    expect(frameCode(-1)).toBe("§k§x§3§f");
  });

  it("shows the star field with visible, which reads its own $atext (ignored reads only its parents', and left it out every time)", () => {
    const stars = blockpartyHud().stars as { visible?: string; ignored?: string; $atext: string };
    expect(stars.ignored).toBeUndefined();
    expect(stars.visible).toBe("(not (($atext - '§k§d') = $atext))");
    expect(stars.$atext).toBe("$actionbar_text");
  });

  it("uses no JSON UI animations (they never showed in game): each frame is still pictures", () => {
    expect(blockpartyHudFile()).not.toContain("anim");
  });

  it("has the still stars and a frame of zoom pictures for every strength, each built only when the line names it", () => {
    const level3 = levelOf(3);
    expect(level3.ignored).toBe("(($atext - '§k§d§3') = $atext)");
    expect(level3.controls).toHaveLength(1 + STAR_FRAMES);
    const frame = level3.controls[1 + 5].f5;
    expect(frame.ignored).toBe("(($atext - '§k§x§0§5') = $atext)");
    // Every picture at the size and alpha its life says, at the strength's alpha.
    for (const picture of frame.controls!) {
      const [[key, { size, alpha }]] = Object.entries(picture);
      const layer = Number(key.slice(1, 2));
      const life = lifeAt(5, layer);
      expect(Number.parseFloat(size[0]) / 100).toBeCloseTo(zoomAt(life), 2);
      expect(alpha).toBeCloseTo(alphaAt(life) * (3 / STAR_LEVELS), 2);
    }
  });

  it("draws the stars over the board's screens but under the dialogue box, the fork box and the announcement", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).toContain('"bp_stars@blockparty_hud.stars"');
    expect(hud).toContain('"jui_blockparty_dialogue@jui_blockparty_dialogue.layout": { "layer": 200 }');
    expect(hud).toContain('"jui_blockparty_fork@jui_blockparty_fork.layout": { "layer": 200 }');
    expect(hud).toContain('"jui_blockparty_announce@jui_blockparty_announce.layout": { "layer": 200 }');
    expect(STARS_LAYER).toBeGreaterThan(159);
    expect(STARS_LAYER).toBeLessThan(200);
  });

  it("leaves the hotbar to vanilla (no pack hotbar in the HUD)", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).not.toContain("blockparty_hud.hotbar");
    expect(hud).not.toContain("item_name_text_root");
  });
});

describe("the zoom pictures", () => {
  it("grow steadily from small to large over a life, a quarter of a life apart", () => {
    expect(zoomAt(0)).toBe(ZOOM_FROM);
    expect(zoomAt(STAR_FRAMES)).toBe(ZOOM_TO);
    expect(lifeAt(0, 1)).toBe(STAR_FRAMES / ZOOM_LAYERS);
    expect(lifeAt(STAR_FRAMES - 1, 1)).toBe(STAR_FRAMES / ZOOM_LAYERS - 1);
  });

  it("are unseen when they jump back to small, and fade in and out between", () => {
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(STAR_FRAMES - 1)).toBe(0);
    expect(alphaAt(8)).toBeCloseTo(0.5);
    expect(alphaAt(24)).toBe(1);
    expect(LIFE.at(-1)!.to).toBe(STAR_FRAMES);
  });

  it("always has some stars at full strength on screen", () => {
    for (let frame = 0; frame < STAR_FRAMES; frame++) {
      const total = Array.from({ length: ZOOM_LAYERS }, (_, layer) => alphaAt(lifeAt(frame, layer))).reduce((sum, alpha) => sum + alpha, 0);
      expect(total).toBeGreaterThan(1.5);
    }
  });
});

describe("the star field's state", () => {
  it("steps a frame a tick while it's up, round and round, and holds while it's down", () => {
    const stars = new StarField();
    stars.tick();
    expect(stars.frame).toBe(0);
    expect(stars.codes()).toBe("");
    stars.level = 1;
    stars.tick();
    expect(stars.codes()).toBe("§k§d§1§k§x§0§1");
    for (let tick = 0; tick < STAR_FRAMES; tick++) stars.tick();
    expect(stars.frame).toBe(1);
    stars.level = 0;
    stars.tick();
    expect(stars.frame).toBe(1);
  });
});

describe("the star field's codes", () => {
  it("never match the core's codes on the same line (its clock's places, its count's)", () => {
    const core = ["§k§a", "§k§b", "§k§c", "§k§e", "§k§g", "§k§h", "§k§i", "§k§j", "§k§l", "§k§m", "§k§n", "§k§p", "§k§q", "§k§s", "§k§t", "§k§u"];
    for (let level = 1; level <= STAR_LEVELS; level++) {
      for (let frame = 0; frame < STAR_FRAMES; frame++) {
        const line = starsCode(level, frame);
        for (const code of core) expect(line).not.toContain(code);
      }
    }
  });
});

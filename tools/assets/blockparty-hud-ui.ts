// Writes Block Party's own HUD (games/blockparty/resource_pack/ui/blockparty_hud.json), the JSON UI
// that reads the codes the game puts on the action bar (games/blockparty/behavior_pack/scripts/
// bar-codes.ts), riding in the core's full-screen action bar panel like the gun scope:
//   - the star field (scripts/stars.ts, docs/plans/block-party-ui.md, "The minigame announcement"):
//     still stars far behind, and pictures of streaked stars zooming out of the middle of the
//     screen, over everything but the dialogue box, at one of STAR_LEVELS strengths, which the game
//     steps up and down to fade it in and out over a camera fade to black, and at one of STAR_FRAMES
//     frames, which it steps every tick like a gif.
// Each strength and frame is the zoom pictures at set sizes and alphas, every number written out:
// no animations (they never showed in game). Only the strength the line names is built (the others
// are ignored), and in it only the frame it names.
// A control for every code, so it's generated: rerun after changing the codes, and commit the file.
// A test checks the committed file matches (games/blockparty/test/hud-ui.test.ts).
//
//     npx tsx tools/assets/blockparty-hud-ui.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARS_CODE, STAR_FRAMES, STAR_LEVELS, frameCode } from "../../games/blockparty/behavior_pack/scripts/bar-codes.ts";
import { BACK_TEXTURE, ZOOM_LAYERS, alphaAt, lifeAt, zoomAt, zoomTexture } from "../../games/blockparty/behavior_pack/scripts/stars.ts";

export const BLOCKPARTY_HUD_FILE = fileURLToPath(new URL("../../games/blockparty/resource_pack/ui/blockparty_hud.json", import.meta.url));

type Control = Record<string, unknown>;

const ATEXT = { $atext: "$actionbar_text" };
const NS = "blockparty_hud";
/**
 * The star field's layer in the action bar's panel: over every screen the game draws there (the
 * results screen's top control is at 159) but the dialogue box, the fork box and the announcement,
 * which ui/hud_screen.json lifts over it (Minigame! and the wheel show on the stars).
 */
export const STARS_LAYER = 170;

/** True when the line has the code (for "visible", which reads the control's own $atext). */
const has = (code: string) => `(not (($atext - '${code}') = $atext))`;
/** True when the line hasn't (for "ignored", which reads $atext from the control's parents, never its own). */
const lacks = (code: string) => `(($atext - '${code}') = $atext)`;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
const strengthOf = (level: number) => round(level / STAR_LEVELS, 3);

/** A zoom picture: centered, its size and alpha set by each frame. */
function zoomPicture(layer: number): Control {
  return {
    type: "image",
    texture: zoomTexture(layer),
    size: ["100%", "100%"],
    anchor_from: "center",
    anchor_to: "center",
    keep_ratio: false,
    bilinear: true,
    layer: layer + 1,
  };
}

/** The zoom pictures at one strength and frame (those faded out left out): built only when the line names that frame. */
function frameCopy(level: number, frame: number): Control {
  const pictures: Control[] = [];
  for (let layer = 0; layer < ZOOM_LAYERS; layer++) {
    const life = lifeAt(frame, layer);
    const alpha = round(alphaAt(life) * strengthOf(level), 3);
    if (alpha <= 0) continue;
    const percent = `${round(zoomAt(life) * 100, 2)}%`;
    pictures.push({ [`z${layer}@${NS}.zoom_${layer}`]: { size: [percent, percent], alpha } });
  }
  return { [`f${frame}`]: { type: "panel", size: ["100%", "100%"], ...ATEXT, ignored: lacks(frameCode(frame)), controls: pictures } };
}

/** One strength: the still stars far behind at its alpha, and a copy of the zoom pictures for each frame. */
function strength(level: number): Control {
  return {
    [`level_${level}`]: {
      type: "panel",
      size: ["100%", "100%"],
      ...ATEXT,
      ignored: lacks(`${STARS_CODE}§${level}`),
      controls: [
        { back: { type: "image", texture: BACK_TEXTURE, tiled: true, tiled_scale: [1, 1], size: ["100%", "100%"], alpha: strengthOf(level), layer: 0 } },
        ...Array.from({ length: STAR_FRAMES }, (_, frame) => frameCopy(level, frame)),
      ],
    },
  };
}

export function blockpartyHud(): Record<string, Control> {
  const definitions: Record<string, Control> = {
    stars: {
      type: "panel",
      size: ["100%", "100%"],
      layer: STARS_LAYER,
      ...ATEXT,
      visible: has(STARS_CODE),
      controls: Array.from({ length: STAR_LEVELS }, (_, index) => strength(index + 1)),
    },
  };
  for (let layer = 0; layer < ZOOM_LAYERS; layer++) definitions[`zoom_${layer}`] = zoomPicture(layer);
  return definitions;
}

/** The file: a definition a line, and in the star field each strength's frames a line each. */
export function blockpartyHudFile(): string {
  const hud = blockpartyHud();
  const lines = Object.entries(hud).map(([name, control]) => {
    if (name !== "stars") return `  ${JSON.stringify(name)}: ${JSON.stringify(control)}`;
    const { controls, ...rest } = control as { controls: Control[] };
    const levels = controls.map((entry) => {
      const [[key, level]] = Object.entries(entry) as [[string, { controls: Control[] }]];
      const { controls: inner, ...head } = level;
      return `    {${JSON.stringify(key)}:${JSON.stringify(head).slice(0, -1)},"controls":[\n${inner.map((copy) => `      ${JSON.stringify(copy)}`).join(",\n")}\n    ]}}`;
    });
    return `  "stars": ${JSON.stringify(rest).slice(0, -1)},"controls":[\n${levels.join(",\n")}\n  ]}`;
  });
  return [
    "// Generated by tools/assets/blockparty-hud-ui.ts from the codes in games/blockparty/behavior_pack/scripts/bar-codes.ts",
    "// and the star field in stars.ts: rerun it instead of editing this file.",
    "{",
    `  "namespace": "${NS}",`,
    lines.join(",\n"),
    "}",
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  writeFileSync(BLOCKPARTY_HUD_FILE, blockpartyHudFile());
  console.log(`wrote ${BLOCKPARTY_HUD_FILE}`);
}

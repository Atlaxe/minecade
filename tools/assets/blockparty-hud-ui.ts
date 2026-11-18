// Writes Block Party's own HUD (games/blockparty/resource_pack/ui/blockparty_hud.json), the JSON UI
// that reads the codes the game puts on the action bar (games/blockparty/behavior_pack/scripts/
// bar-codes.ts), riding in the core's full-screen action bar panel like the gun scope:
//   - the star field (scripts/stars.ts, docs/plans/block-party-ui.md, "The minigame announcement"):
//     still stars far behind, and pictures of streaked stars zooming out of the middle of the
//     screen, over everything but the dialogue box, at one of STAR_LEVELS strengths, which the game
//     steps up and down to fade it in and out.
// The action bar's controls are built anew at every send, which starts their animations over, so a
// layer's zoom can't simply loop: for each strength and phase on the line there's a copy of the
// layers whose animations start where that phase puts each one in its life (size_from_<n> and
// alpha_<level>_from_<n>), then loop on (size_loop, and alpha_<level>_<part> one part after
// another). Every number is written out: nothing is worked out in the client. Only the strength the
// line names is built (the others are ignored), and in it only the phase it names.
// A control for every code, so it's generated: rerun after changing the codes, and commit the file.
// A test checks the committed file matches (games/blockparty/test/hud-ui.test.ts).
//
//     npx tsx tools/assets/blockparty-hud-ui.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARS_CODE, STAR_LEVELS, STAR_PHASES, phaseCode } from "../../games/blockparty/behavior_pack/scripts/bar-codes.ts";
import { BACK_TEXTURE, LIFE, PHASE_MS, ZOOM_LAYERS, ZOOM_TO, alphaAt, lifeAt, partAt, zoomAt, zoomTexture } from "../../games/blockparty/behavior_pack/scripts/stars.ts";

export const BLOCKPARTY_HUD_FILE = fileURLToPath(new URL("../../games/blockparty/resource_pack/ui/blockparty_hud.json", import.meta.url));

type Control = Record<string, unknown>;

const ATEXT = { $atext: "$actionbar_text" };
const NS = "blockparty_hud";
/**
 * The star field's layer in the action bar's panel: over every screen the game draws there (the
 * results screen's top control is at 159) but the dialogue box and the fork box, which
 * ui/hud_screen.json lifts over it (the roulette shows on the stars).
 */
export const STARS_LAYER = 170;

/** True when the line has the code (for "visible"). */
const has = (code: string) => `(not (($atext - '${code}') = $atext))`;
/** True when the line hasn't (for "ignored", which reads $atext from the control's parents, never its own). */
const lacks = (code: string) => `(($atext - '${code}') = $atext)`;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
const seconds = (phases: number) => round((phases * PHASE_MS) / 1000, 3);
const size = (screens: number) => {
  const percent = `${round(screens * 100, 2)}%`;
  return [percent, percent];
};
const strengthOf = (level: number) => round(level / STAR_LEVELS, 3);

/** A zoom layer: its picture centered, as big as its size animation says, its alpha from its alpha animation. */
function zoomLayer(layer: number): Control {
  return {
    type: "image",
    texture: zoomTexture(layer),
    size: ["100%", "100%"],
    anchor_from: "center",
    anchor_to: "center",
    keep_ratio: false,
    bilinear: true,
    alpha: 0,
    layer: layer + 1,
    anims: "$zoom_anims",
  };
}

/** The size animations: from each point in a life to its end, then the whole life, round and round. */
function sizeAnims(): Record<string, Control> {
  const anims: Record<string, Control> = {
    size_loop: { anim_type: "size", easing: "linear", from: size(zoomAt(0)), to: size(ZOOM_TO), duration: seconds(STAR_PHASES), next: `@${NS}.size_loop` },
  };
  for (let life = 0; life < STAR_PHASES; life++) {
    anims[`size_from_${life}`] = { anim_type: "size", easing: "linear", from: size(zoomAt(life)), to: size(ZOOM_TO), duration: seconds(STAR_PHASES - life), next: `@${NS}.size_loop` };
  }
  return anims;
}

/** One strength's alpha animations: each part of a life in turn, and from each point in a life to the end of its part. */
function alphaAnims(level: number): Record<string, Control> {
  const strength = strengthOf(level);
  const anims: Record<string, Control> = {};
  LIFE.forEach((part, index) => {
    const next = LIFE[(index + 1) % LIFE.length];
    anims[`alpha_${level}_${part.part}`] = { anim_type: "alpha", easing: "linear", from: round(part.alpha[0] * strength, 3), to: round(part.alpha[1] * strength, 3), duration: seconds(part.to - part.from), next: `@${NS}.alpha_${level}_${next.part}` };
  });
  for (let life = 0; life < STAR_PHASES; life++) {
    const part = partAt(life);
    const next = LIFE[(LIFE.indexOf(part) + 1) % LIFE.length];
    anims[`alpha_${level}_from_${life}`] = { anim_type: "alpha", easing: "linear", from: round(alphaAt(life) * strength, 3), to: round(part.alpha[1] * strength, 3), duration: seconds(part.to - life), next: `@${NS}.alpha_${level}_${next.part}` };
  }
  return anims;
}

/** The layers at one strength and phase: built only when the line names that phase. */
function phaseCopy(level: number, phase: number): Control {
  return {
    [`p${phase}`]: {
      type: "panel",
      size: ["100%", "100%"],
      ...ATEXT,
      ignored: lacks(phaseCode(phase)),
      controls: Array.from({ length: ZOOM_LAYERS }, (_, layer) => {
        const life = lifeAt(phase, layer);
        return { [`z${layer}@${NS}.zoom_${layer}`]: { $zoom_anims: [`@${NS}.size_from_${life}`, `@${NS}.alpha_${level}_from_${life}`] } };
      }),
    },
  };
}

/** One strength: the still stars far behind at its alpha, and a copy of the zoom layers for each phase. */
function strength(level: number): Control {
  return {
    [`level_${level}`]: {
      type: "panel",
      size: ["100%", "100%"],
      ...ATEXT,
      ignored: lacks(`${STARS_CODE}§${level}`),
      controls: [
        { back: { type: "image", texture: BACK_TEXTURE, tiled: true, tiled_scale: [1, 1], size: ["100%", "100%"], alpha: strengthOf(level), layer: 0 } },
        ...Array.from({ length: STAR_PHASES }, (_, phase) => phaseCopy(level, phase)),
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
  for (let layer = 0; layer < ZOOM_LAYERS; layer++) definitions[`zoom_${layer}`] = zoomLayer(layer);
  Object.assign(definitions, sizeAnims());
  for (let level = 1; level <= STAR_LEVELS; level++) Object.assign(definitions, alphaAnims(level));
  return definitions;
}

/** The file: a definition a line, and in the star field each strength's copies a line each. */
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

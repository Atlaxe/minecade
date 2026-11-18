// Writes Block Party's own HUD (games/blockparty/resource_pack/ui/blockparty_hud.json), the JSON UI
// that reads the codes the game puts on the action bar (games/blockparty/behavior_pack/scripts/
// bar-codes.ts), riding in the core's full-screen action bar panel like the gun scope:
//   - the star field (scripts/stars.ts, docs/plans/block-party-ui.md, "The minigame announcement"):
//     layers of stars sliding at their own speeds over everything but the dialogue box, at one of
//     STAR_LEVELS strengths, which the game steps up and down to fade it in and out.
// The action bar's controls are built anew at every send, which starts their animations over, so a
// layer's slide can't simply loop: for each phase on the line and each way the stars slide there's a
// copy of the layers whose animations start where that phase puts them (from, over seconds to the
// end of the loop), then loop. Only the copy the line names is built (every other one is ignored),
// inside only the strength the line names, which passes its alpha down as $level_alpha.
// A control for every code, so it's generated: rerun after changing the codes, and commit the file.
// A test checks the committed file matches (games/blockparty/test/hud-ui.test.ts).
//
//     npx tsx tools/assets/blockparty-hud-ui.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARS_CODE, STAR_LEVELS, STAR_PHASES, phaseCode, type StarDirection } from "../../games/blockparty/behavior_pack/scripts/bar-codes.ts";
import { STAR_LAYERS, layerStart, loopSeconds, type StarLayer } from "../../games/blockparty/behavior_pack/scripts/stars.ts";

export const BLOCKPARTY_HUD_FILE = fileURLToPath(new URL("../../games/blockparty/resource_pack/ui/blockparty_hud.json", import.meta.url));

type Control = Record<string, unknown>;

const ATEXT = { $atext: "$actionbar_text" };
const NS = "blockparty_hud";
const DIRECTIONS: readonly StarDirection[] = ["down", "up"];
/**
 * The star field's layer in the action bar's panel: over every screen the game draws there (the
 * results screen's top control is at 159) but the dialogue box and the fork box, which
 * ui/hud_screen.json lifts over it (the roulette shows on the stars).
 */
export const STARS_LAYER = 170;

/** Left out unless the line has the code. */
const unless = (code: string) => `(($atext - '${code}') = $atext)`;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** A layer sliding one way: its tiled image, a tile taller than the screen, with the animation that starts it from $from. */
function layerImage(layer: StarLayer, index: number, direction: StarDirection): Control {
  return {
    type: "image",
    texture: layer.texture,
    tiled: true,
    tiled_scale: [layer.scale, layer.scale],
    size: ["100%", `100% + ${layer.tile}px`],
    anchor_from: "top_left",
    anchor_to: "top_left",
    alpha: "$level_alpha",
    layer: index + 1,
    anims: [`@${NS}.${layer.id}_${direction}_start`],
  };
}

/** From $from to the end of the loop over $seconds, then the loop: a tile down (or up), round and round. */
function layerAnims(layer: StarLayer, direction: StarDirection): Record<string, Control> {
  const top = [0, -layer.tile];
  const rest = [0, 0];
  const [start, end] = direction === "down" ? [top, rest] : [rest, top];
  return {
    [`${layer.id}_${direction}_start`]: { anim_type: "offset", easing: "linear", from: "$from", to: end, duration: "$seconds", next: `@${NS}.${layer.id}_${direction}_loop` },
    [`${layer.id}_${direction}_loop`]: { anim_type: "offset", easing: "linear", from: start, to: end, duration: round(loopSeconds(layer), 3), next: `@${NS}.${layer.id}_${direction}_loop` },
  };
}

/** The layers at one phase, sliding one way: built only when the line names it. */
function phaseCopy(direction: StarDirection, phase: number): Record<string, Control> {
  return {
    [`${direction}_${phase}`]: {
      type: "panel",
      size: ["100%", "100%"],
      ...ATEXT,
      ignored: unless(phaseCode(direction, phase)),
      controls: STAR_LAYERS.map((layer) => {
        const { from, seconds } = layerStart(layer, phase, direction);
        return { [`${layer.id}@${NS}.${layer.id}_${direction}`]: { $from: [0, round(from, 2)], $seconds: round(seconds, 3) } };
      }),
    },
  };
}

export function blockpartyHud(): Record<string, Control> {
  const levels = Array.from({ length: STAR_LEVELS }, (_, index) => index + 1);
  const phases = Array.from({ length: STAR_PHASES }, (_, index) => index);
  const definitions: Record<string, Control> = {
    stars: {
      type: "panel",
      size: ["100%", "100%"],
      layer: STARS_LAYER,
      ...ATEXT,
      ignored: unless(STARS_CODE),
      controls: levels.map((level) => ({
        [`level_${level}`]: {
          type: "panel",
          size: ["100%", "100%"],
          ...ATEXT,
          ignored: unless(`${STARS_CODE}§${level}`),
          $level_alpha: round(level / STAR_LEVELS, 3),
          controls: [{ [`field@${NS}.field`]: {} }],
        },
      })),
    },
    field: {
      type: "panel",
      size: ["100%", "100%"],
      controls: DIRECTIONS.flatMap((direction) => phases.map((phase) => phaseCopy(direction, phase))),
    },
  };
  for (const direction of DIRECTIONS) {
    STAR_LAYERS.forEach((layer, index) => {
      definitions[`${layer.id}_${direction}`] = layerImage(layer, index, direction);
      Object.assign(definitions, layerAnims(layer, direction));
    });
  }
  return definitions;
}

/** The file: a definition a line, and the field's copies a line each (the copies make it long). */
export function blockpartyHudFile(): string {
  const hud = blockpartyHud();
  const lines = Object.entries(hud).map(([name, control]) => {
    if (name !== "field") return `  ${JSON.stringify(name)}: ${JSON.stringify(control)}`;
    const { controls, ...rest } = control as { controls: Control[] };
    const head = JSON.stringify(rest).slice(0, -1);
    return `  "field": ${head},"controls":[\n${controls.map((copy) => `    ${JSON.stringify(copy)}`).join(",\n")}\n  ]}`;
  });
  return [
    "// Generated by tools/assets/blockparty-hud-ui.ts from the codes in games/blockparty/behavior_pack/scripts/bar-codes.ts",
    "// and the layers in stars.ts: rerun it instead of editing this file.",
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

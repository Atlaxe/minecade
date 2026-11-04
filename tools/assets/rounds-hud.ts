// Writes the core resource pack's best-of rounds box (packages/minigame-core/resource_pack/ui/
// minecade_rounds.json), the JSON UI that reads the rounds codes bestOfCodes() puts at the end of the
// HUD line (packages/minigame-core/src/hud.ts). The box sits top right, left of the own score's and
// the clock's (hud_screen.json's mc_hud_row). It has a control for every code it can find, so it's
// generated: rerun after changing the codes, and commit the file.
//
//     npx tsx tools/assets/rounds-hud.ts
//
// A test checks the committed file matches (packages/minigame-core/test/hud.test.ts).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUND_COLORS, ROUND_COUNT, ROUND_WON, SIDE_COLOR, SIDE_TENS, SIDE_UNITS } from "../../packages/minigame-core/src/hud.ts";

export const ROUNDS_HUD_FILE = fileURLToPath(new URL("../../packages/minigame-core/resource_pack/ui/minecade_rounds.json", import.meta.url));

/** The colors of the § codes, as JSON UI colors (0 to 1). */
const RGB: Record<(typeof ROUND_COLORS)[number], number> = { c: 0xff5555, "9": 0x5555ff, a: 0x55ff55, e: 0xffff55, "6": 0xffaa00, d: 0xff55ff, b: 0x55ffff, "2": 0x00aa00, f: 0xffffff, "7": 0xaaaaaa };
const MAX_CIRCLES = 7;
const MIN_CIRCLES = 3;
const SIDES = 4;
const CIRCLE = 8;
const GAP = 2;
const ROW = 10;

type Control = Record<string, unknown>;

const has = (code: string) => `(not (($atext - '${code}') = $atext))`;
const lacks = (code: string) => `(($atext - '${code}') = $atext)`;
const color = (code: (typeof ROUND_COLORS)[number]) => [RGB[code] >> 16, (RGB[code] >> 8) & 0xff, RGB[code] & 0xff].map((part) => Math.round((part / 255) * 1000) / 1000);
/** Shown only when `when` holds: left out of the layout otherwise, as the own score's digits are. */
const only = (when: string, lacking: string) => ({ ignored: lacking, visible: when });

function circle(place: number): Control {
  const won = `${ROUND_WON}§${place}`;
  const images: Control[] = [{ open: { type: "image", texture: "textures/minecade/hud/round_open", size: [CIRCLE, CIRCLE], layer: 32, $atext: "$actionbar_text", ...only(lacks(won), has(won)) } }];
  for (const code of ROUND_COLORS) {
    const winner = `${won}§${code}`;
    images.push({ [`won_${code}`]: { type: "image", texture: `textures/minecade/hud/round_${code}`, size: [CIRCLE, CIRCLE], layer: 32, $atext: "$actionbar_text", ...only(has(winner), lacks(winner)) } });
  }
  return { type: "panel", size: [CIRCLE, ROW], $atext: "$actionbar_text", controls: images };
}

/** Circle `place` is there when the series has at least that many rounds. */
function circleShown(place: number): { ignored?: string } {
  if (place <= MIN_CIRCLES) return {};
  const counts = [];
  for (let rounds = place; rounds <= MAX_CIRCLES; rounds++) counts.push(lacks(`${ROUND_COUNT}§${rounds}`));
  return { ignored: `(${counts.join(" and ")})` };
}

function icons(): Control {
  const controls: Control[] = [];
  for (let place = 1; place <= MAX_CIRCLES; place++) {
    const shown = circleShown(place);
    if (place > 1) controls.push({ [`gap_${place}`]: { type: "panel", size: [GAP, ROW], $atext: "$actionbar_text", ...shown } });
    controls.push({ [`circle_${place}`]: { ...circle(place), ...shown } });
  }
  return { type: "stack_panel", orientation: "horizontal", anchor_from: "center", anchor_to: "center", size: ["100%c", ROW], $atext: "$actionbar_text", ...only(has(ROUND_COUNT), lacks(ROUND_COUNT)), controls };
}

/** One side's round wins in one color: its tens (from 10) and units, a label per digit. */
function sideInColor(place: number, code: (typeof ROUND_COLORS)[number]): Control {
  const digits: Control[] = [];
  for (const [name, prefix, from] of [["t", SIDE_TENS, 1], ["u", SIDE_UNITS, 0]] as const) {
    for (let digit = from; digit <= 9; digit++) {
      const key = `${prefix}§${place}§${digit}`;
      digits.push({ [`${name}${digit}@minecade_rounds.digit`]: { text: String(digit), color: color(code), ...only(has(key), lacks(key)) } });
    }
  }
  const key = `${SIDE_COLOR}§${place}§${code}`;
  return { type: "stack_panel", orientation: "horizontal", size: ["100%c", ROW], $atext: "$actionbar_text", ...only(has(key), lacks(key)), controls: digits };
}

function score(): Control {
  const controls: Control[] = [];
  for (let place = 1; place <= SIDES; place++) {
    const side = `${SIDE_COLOR}§${place}`;
    if (place > 1) controls.push({ [`bar_${place}@minecade_rounds.digit`]: { text: " | ", color: color("7"), ...only(has(side), lacks(side)) } });
    controls.push({
      [`side_${place}`]: {
        type: "stack_panel",
        orientation: "horizontal",
        size: ["100%c", ROW],
        $atext: "$actionbar_text",
        ...only(has(side), lacks(side)),
        controls: ROUND_COLORS.map((code) => ({ [`in_${code}`]: sideInColor(place, code) })),
      },
    });
  }
  return { type: "stack_panel", orientation: "horizontal", anchor_from: "center", anchor_to: "center", size: ["100%c", ROW], $atext: "$actionbar_text", ...only(has(SIDE_COLOR), lacks(SIDE_COLOR)), controls };
}

/** The file's controls, by name. */
export function roundsHud(): Record<string, Control> {
  const none = `(${lacks(ROUND_COUNT)} and ${lacks(SIDE_COLOR)})`;
  return {
    // The box, like the clock's: the circles or the score inside.
    box: {
      type: "image",
      texture: "textures/ui/hud_tip_text_background",
      size: ["100%c + 8px", 14],
      layer: 30,
      alpha: "@hud.anim_actionbar_text_background_alpha_out",
      $atext: "$actionbar_text",
      ignored: none,
      visible: `(not ${none})`,
      controls: [{ "icons@minecade_rounds.icons": {} }, { "score@minecade_rounds.score": {} }],
    },
    // Between the box and the next one; gone with the box.
    gap: { type: "panel", size: [GAP, 14], $atext: "$actionbar_text", ignored: none },
    icons: icons(),
    score: score(),
    digit: { type: "label", size: ["default", ROW], color: color("f"), layer: 31, shadow: true, localize: false, $atext: "$actionbar_text", alpha: "@hud.anim_actionbar_text_alpha_out" },
  };
}

/**
 * The file as written: controls one per line inside the lists (the file is long), with a header
 * saying where it comes from.
 */
export function roundsHudFile(): string {
  const lines = ["// Generated by tools/assets/rounds-hud.ts from the rounds codes in packages/minigame-core/src/hud.ts:", "// rerun it instead of editing this file.", "{", '  "namespace": "minecade_rounds",'];
  const entries = Object.entries(roundsHud());
  entries.forEach(([name, control], index) => {
    lines.push(`  ${JSON.stringify(name)}: ${write(control, 2)}${index < entries.length - 1 ? "," : ""}`);
  });
  lines.push("}", "");
  return lines.join("\n");
}

function write(control: Control, indent: number): string {
  const pad = " ".repeat(indent + 2);
  const fields = Object.entries(control).map(([key, value]) => {
    if (key !== "controls" || !Array.isArray(value)) return `${pad}${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const items = (value as Control[]).map((item) => {
      const [[name, inner]] = Object.entries(item) as [[string, Control]];
      const nested = Array.isArray(inner.controls) ? write(inner, indent + 4) : JSON.stringify(inner);
      return `${pad}  { ${JSON.stringify(name)}: ${nested} }`;
    });
    return `${pad}"controls": [\n${items.join(",\n")}\n${pad}]`;
  });
  return `{\n${fields.join(",\n")}\n${" ".repeat(indent)}}`;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  writeFileSync(ROUNDS_HUD_FILE, roundsHudFile());
  console.log(`wrote ${ROUNDS_HUD_FILE}`);
}

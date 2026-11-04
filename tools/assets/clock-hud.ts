// Writes the core resource pack's clock digits (packages/minigame-core/resource_pack/ui/
// minecade_clock.json), the JSON UI that reads the clock codes clockCodes() puts at the end of the
// HUD line (packages/minigame-core/src/hud.ts). They sit in the clock's bubble top right, after its
// icon (hud_screen.json's mc_hud_box): a label for every digit in every place, in white and again in
// red for the last 30 seconds, each left out unless its code is in the line. That's a control for
// every code, so it's generated: rerun after changing the codes, and commit the file.
//
//     npx tsx tools/assets/clock-hud.ts
//
// A test checks the committed file matches (packages/minigame-core/test/hud.test.ts).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLOCK_PLACES, CLOCK_URGENT } from "../../packages/minigame-core/src/hud.ts";
import { color, has, lacks, only, uiFile, type Control } from "./rounds-hud.ts";

export const CLOCK_HUD_FILE = fileURLToPath(new URL("../../packages/minigame-core/resource_pack/ui/minecade_clock.json", import.meta.url));

const ROW = 10;
/** Each place's digits: the minutes' tens only from 1 (a leading 0 is left out), the seconds' tens to 5. */
const DIGITS: readonly (readonly [from: number, to: number])[] = [
  [1, 9],
  [0, 9],
  [0, 5],
  [0, 9],
];

/** The clock in one color: each place's digits, a colon after the minutes. */
function clockIn(red: boolean): Control {
  const tint = color(red ? "c" : "f");
  const controls: Control[] = [];
  CLOCK_PLACES.forEach((place, index) => {
    if (index === 2) controls.push({ "colon@minecade_clock.digit": { text: ":", color: tint } });
    const [from, to] = DIGITS[index];
    for (let digit = from; digit <= to; digit++) {
      const key = `${place}§${digit}`;
      controls.push({ [`p${index}_${digit}@minecade_clock.digit`]: { text: String(digit), color: tint, ...only(has(key), lacks(key)) } });
    }
  });
  const shown = red ? only(has(CLOCK_URGENT), lacks(CLOCK_URGENT)) : only(lacks(CLOCK_URGENT), has(CLOCK_URGENT));
  return { type: "stack_panel", orientation: "horizontal", size: ["100%c", ROW], $atext: "$actionbar_text", ...shown, controls };
}

/** The file's controls, by name. */
export function clockHud(): Record<string, Control> {
  return {
    // White, or red in the last 30 seconds: only one is in the layout.
    digits: {
      type: "stack_panel",
      orientation: "horizontal",
      size: ["100%c", ROW],
      $atext: "$actionbar_text",
      controls: [{ "white@minecade_clock.white": {} }, { "red@minecade_clock.red": {} }],
    },
    white: clockIn(false),
    red: clockIn(true),
    digit: { type: "label", size: ["default", ROW], color: color("f"), layer: 31, shadow: true, localize: false, $atext: "$actionbar_text", alpha: "@hud.anim_actionbar_text_alpha_out" },
  };
}

/** The file as written. */
export function clockHudFile(): string {
  return uiFile("minecade_clock", "tools/assets/clock-hud.ts from the clock codes", clockHud());
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  writeFileSync(CLOCK_HUD_FILE, clockHudFile());
  console.log(`wrote ${CLOCK_HUD_FILE}`);
}

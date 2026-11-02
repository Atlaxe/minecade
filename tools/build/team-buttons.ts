// The lobby team form's buttons as pictures (lobby/behavior_pack/scripts/team-pick-form.ts). The form
// is Minecraft's live Ore UI form, whose own buttons can't take a color, so each button is a
// clickable picture instead: the team's color with white text ("Join Red"), framed in white on the
// player's own team ("On Red"), dimmed when the team is full, and a gray Random team. The build draws
// one set for every team any game can have, into the lobby pack; the text is in a pixel font drawn
// after Minecraft's.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { codeTint, possibleTeams, teamButtonPath, type Registry, type TeamButtonState } from "@minecade/minigame-core/config";
import { blankImage, encodePng, type Image } from "../skins/png.ts";

/** A button is 216 by 30 pixels, about the shape of the form's own (a full row wide), drawn 4 times as large so it stays sharp. */
const WIDTH = 216;
const HEIGHT = 30;
const SCALE = 4;
/** Room the text keeps from the sides. */
const TEXT_MARGIN = 8;
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
/** Random team's button, and a full team's text. */
const GRAY = [110, 110, 110];
const DIM_TEXT = [170, 170, 170];

/**
 * The font: each glyph's rows (a "#" is a pixel), 7 tall from the top of a capital to the baseline,
 * and an 8th row under it for g, j, p, q and y. One pixel of space follows each glyph.
 */
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "###..", "#....", "#....", "#....", "#####"],
  F: ["#####", "#....", "###..", "#....", "#....", "#....", "#...."],
  G: [".####", "#....", "#..##", "#...#", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  J: ["....#", "....#", "....#", "....#", "....#", "#...#", ".###."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#", "#...#", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#...#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "#...#"],
  S: [".####", "#....", ".###.", "....#", "....#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#...#", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".####"],
  f: ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."],
  g: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "####."],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  i: ["#", ".", "#", "#", "#", "#", "#"],
  j: ["....#", ".....", "....#", "....#", "....#", "....#", "#...#", ".###."],
  k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
  l: ["#.", "#.", "#.", "#.", "#.", "#.", ".#"],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "#.##.", "##..#", "#...#", "####.", "#....", "#...."],
  q: [".....", ".....", ".##.#", "#..##", "#...#", ".####", "....#", "....#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#.", ".#.", "###", ".#.", ".#.", ".#.", "..#"],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".####"],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#", "####."],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#...#", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...##", "..#.#", ".#..#", "#...#", "#####", "....#", "....#"],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "#...#", "....#", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  ":": [".", "#", ".", ".", ".", "#", "."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
};

/** A glyph for each character, a "?" for one the font lacks. */
function glyph(char: string): string[] {
  return GLYPHS[char] ?? GLYPHS["?"];
}

/** How wide a line of text is, in pixels (no space after the last glyph). */
export function textWidth(text: string): number {
  return [...text].reduce((width, char) => width + glyph(char)[0].length + 1, 0) - (text.length > 0 ? 1 : 0);
}

/** One button's look: its face color (red, green, blue), its text and the text's color, and whether it's framed (the player's pick). */
export interface ButtonLook {
  face: number[];
  text: string;
  textColor: number[];
  framed: boolean;
}

/** Draws a button: a black outline, the face lighter on top and darker at the bottom like Minecraft's, the text centered with its shadow. */
export function drawButton(look: ButtonLook): Image {
  const image = blankImage(WIDTH * SCALE, HEIGHT * SCALE);
  const fill = (x: number, y: number, width: number, height: number, color: number[]) => {
    for (let py = y * SCALE; py < (y + height) * SCALE; py++) {
      for (let px = x * SCALE; px < (x + width) * SCALE; px++) {
        const at = (py * image.width + px) * 4;
        image.data.set([color[0], color[1], color[2], 255], at);
      }
    }
  };
  const shade = (color: number[], by: number) => color.map((value) => Math.max(0, Math.min(255, Math.round(value * by))));
  fill(0, 0, WIDTH, HEIGHT, BLACK);
  fill(1, 1, WIDTH - 2, HEIGHT - 2, look.face);
  fill(1, 1, WIDTH - 2, 1, shade(look.face, 1.25));
  fill(1, HEIGHT - 3, WIDTH - 2, 2, shade(look.face, 0.6));
  if (look.framed) {
    fill(1, 1, WIDTH - 2, 1, WHITE);
    fill(1, HEIGHT - 2, WIDTH - 2, 1, WHITE);
    fill(1, 1, 1, HEIGHT - 2, WHITE);
    fill(WIDTH - 2, 1, 1, HEIGHT - 2, WHITE);
  }
  const text = fitText(look.text);
  const left = Math.floor((WIDTH - textWidth(text)) / 2);
  const top = Math.floor((HEIGHT - 2 - 7) / 2);
  const draw = (x: number, y: number, color: number[]) => {
    let pen = x;
    for (const char of text) {
      const rows = glyph(char);
      rows.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++) if (row[dx] === "#") fill(pen + dx, y + dy, 1, 1, color);
      });
      pen += rows[0].length + 1;
    }
  };
  draw(left + 1, top + 1, shade(look.face, 0.35));
  draw(left, top, look.textColor);
  return image;
}

/** Text cut to fit the button, with "..." at the end when it doesn't. */
function fitText(text: string): string {
  const room = WIDTH - 2 * TEXT_MARGIN;
  if (textWidth(text) <= room) return text;
  let cut = text;
  while (cut.length > 0 && textWidth(`${cut}...`) > room) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** A team's color as a button's face: its § color's, darker so white text reads on it. */
export function teamFace(color: string): number[] {
  const tint = codeTint(color) ?? 0xaaaaaa;
  return [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255].map((value) => Math.round(value * 0.68));
}

/** Each button of one team (or Random team, with no team), by state. */
export function teamButtons(team: { name: string; color: string } | undefined): { state: TeamButtonState; look: ButtonLook }[] {
  if (!team) {
    return [
      { state: "join", look: { face: GRAY, text: "Random team", textColor: WHITE, framed: false } },
      { state: "on", look: { face: GRAY, text: "Random team", textColor: WHITE, framed: true } },
    ];
  }
  const face = teamFace(team.color);
  const dim = face.map((value, index) => Math.round(value * 0.45 + [60, 60, 60][index] * 0.55));
  return [
    { state: "join", look: { face, text: `Join ${team.name}`, textColor: WHITE, framed: false } },
    { state: "on", look: { face, text: `On ${team.name}`, textColor: WHITE, framed: true } },
    { state: "full", look: { face: dim, text: `${team.name} is full`, textColor: DIM_TEXT, framed: false } },
  ];
}

/** Draws every team form button into the lobby pack at `out`: Random team's, and each team's of every game. Returns how many. */
export async function addTeamButtons(out: string, registry: Registry): Promise<number> {
  const teams = new Map<string, { name: string; color: string } | undefined>([["random", undefined]]);
  for (const game of registry.games) {
    if (!game.teams) continue;
    for (const team of possibleTeams(game.teams)) teams.set(teamButtonPath(team, "join"), { name: team.name, color: team.color });
  }
  let count = 0;
  for (const team of teams.values()) {
    for (const { state, look } of teamButtons(team)) {
      const path = join(out, `${teamButtonPath(team, state)}.png`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, encodePng(drawButton(look)));
      count++;
    }
  }
  return count;
}

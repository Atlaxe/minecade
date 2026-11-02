import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_TEAMS, TEAM_BUTTONS, teamButtonPath, type Registry } from "@minecade/minigame-core/config";
import { addTeamButtons, drawButton, teamButtons, teamFace, textWidth } from "../team-buttons.ts";

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const pixel = (image: { width: number; data: Uint8Array }, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe("team form buttons", () => {
  it("names each picture by its team's color and name, and Random team's on its own", () => {
    expect(teamButtonPath(DEFAULT_TEAMS[0], "join")).toBe(`${TEAM_BUTTONS}/c_red_join`);
    expect(teamButtonPath({ name: "Light Blue", color: "§b" }, "full")).toBe(`${TEAM_BUTTONS}/b_light_blue_full`);
    expect(teamButtonPath(undefined, "on")).toBe(`${TEAM_BUTTONS}/random_on`);
  });

  it("measures text in the font, a pixel between glyphs", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("i")).toBe(1);
    expect(textWidth("Join Red")).toBe(5 + 5 + 1 + 5 + 3 + 5 + 5 + 5 + 7);
  });

  it("draws a button in its team's color with white text, framed on the player's own team", () => {
    const [join, on, full] = teamButtons(DEFAULT_TEAMS[0]);
    expect([join.state, on.state, full.state]).toEqual(["join", "on", "full"]);
    expect(join.look.text).toBe("Join Red");
    expect(full.look.text).toBe("Red is full");
    const picture = drawButton(join.look);
    expect(picture.width / picture.height).toBeCloseTo(216 / 30);
    expect(pixel(picture, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(picture, 20, picture.height / 2)).toEqual([...teamFace("§c"), 255]);
    expect(pixel(drawButton(on.look), 6, picture.height / 2)).toEqual([255, 255, 255, 255]);
    let white = 0;
    for (let at = 0; at < picture.data.length; at += 4) if (picture.data[at] === 255 && picture.data[at + 1] === 255 && picture.data[at + 2] === 255) white++;
    expect(white).toBeGreaterThan(0);
  });

  it("writes Random team's and every team's buttons of each game into the pack", async () => {
    const dir = await mkdtemp(join(tmpdir(), "team-buttons-"));
    dirs.push(dir);
    const registry = {
      games: [
        { id: "a", teams: { count: 2 } },
        { id: "b", teams: { count: [2, 4] } },
        { id: "c" },
      ],
    } as unknown as Registry;
    expect(await addTeamButtons(dir, registry)).toBe(2 + 4 * 3);
    const files = await readdir(join(dir, ...TEAM_BUTTONS.split("/")));
    expect(files).toContain("random_join.png");
    expect(files).toContain("e_yellow_full.png");
  });
});

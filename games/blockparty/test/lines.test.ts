import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { button, line } from "../behavior_pack/scripts/lines.ts";
import dialogue from "../dialogue.json";

const SCRIPTS = fileURLToPath(new URL("../behavior_pack/scripts", import.meta.url));
const LINES: Record<string, string[]> = dialogue.lines;

/** Every line("<id>" in the game's scripts. */
function idsSaid(): string[] {
  const ids = new Set<string>();
  for (const name of readdirSync(SCRIPTS, { recursive: true }) as string[]) {
    if (!name.endsWith(".ts")) continue;
    for (const match of readFileSync(join(SCRIPTS, name), "utf8").matchAll(/\bline\(\s*"([^"]+)"/g)) ids.add(match[1]);
  }
  return [...ids].sort();
}

describe("Block Party's lines", () => {
  // The user may leave a line out on purpose (the game skips it), so no id needs a line; the
  // dialogue editor lists the ones the game says that have none.
  it("says lines by ids of lowercase words joined by dots or hyphens", () => {
    const ids = idsSaid();
    expect(ids.length).toBeGreaterThan(30);
    expect(ids.filter((id) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))).toEqual([]);
  });

  it("fills each {name} it's given and leaves the rest as typed", () => {
    const text = LINES["turn.rolled"][0];
    expect(line("turn.rolled", { player: "Alex", roll: 4 }, () => 0)).toBe(text.replaceAll("{player}", "Alex").replaceAll("{roll}", "4"));
    expect(line("turn.rolled", {}, () => 0)).toBe(text);
  });

  it("picks among a moment's alternates", () => {
    const [id, texts] = Object.entries(LINES).find(([, list]) => list.length > 1) ?? [];
    if (!id || !texts) return;
    expect(line(id, {}, () => 0)).toBe(texts[0]);
    expect(line(id, {}, () => 0.999)).toBe(texts[texts.length - 1]);
  });

  it("skips a line it doesn't have (nothing to show), but a button keeps its id so the choice still shows", () => {
    expect(line("no.such.line")).toBe("");
    expect(button("no.such.line")).toBe("no.such.line");
    expect(button("turn.rolled", { player: "Alex", roll: 4 }, () => 0)).toBe(line("turn.rolled", { player: "Alex", roll: 4 }, () => 0));
  });
});

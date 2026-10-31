import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseViews, readViews, saveView } from "../views.ts";

describe("the Boundaries view's saved switches", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "minecade-views-test-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps each player's switches by lower-case name, and drops an empty list", async () => {
    expect(await readViews(root)).toEqual({});
    await saveView(root, "Get A Waffle", ["bounds", "killY", "bounds"]);
    await saveView(root, "Other", ["all"]);
    expect(await readViews(root)).toEqual({ "get a waffle": ["bounds", "killY"], other: ["all"] });
    await saveView(root, "other", []);
    expect(JSON.parse(await readFile(join(root, "work", "editor", "view.json"), "utf8"))).toEqual({ "get a waffle": ["bounds", "killY"] });
  });

  it("reads only entries that make sense", () => {
    expect(parseViews("not json")).toEqual({});
    expect(parseViews("[1]")).toEqual({});
    expect(parseViews('{ "A": ["bounds"], "b": "bounds", "c": [1] }')).toEqual({ a: ["bounds"] });
  });
});

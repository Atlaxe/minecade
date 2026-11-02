import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addGuest, isGamertag, parseGuests, readGuests, removeGuest, writeGuests } from "../guests.ts";

describe("guests", () => {
  it("takes gamertags only: letters, digits and single spaces, nothing a command would trip on", () => {
    expect(isGamertag("Get A Waffle")).toBe(true);
    expect(isGamertag("Steve1234")).toBe(true);
    expect(isGamertag("x")).toBe(true);
    for (const bad of ["", " Steve", "Steve ", "Two  Spaces", 'Say "hi"', "semi;colon", "a".repeat(21)]) expect(isGamertag(bad)).toBe(false);
  });

  it("adds a player once, never a map editor, and removes them by any case", () => {
    const editors = ["Get A Waffle"];
    expect(addGuest([], " Friend ", editors)).toEqual(["Friend"]);
    expect(addGuest(["Friend"], "friend", editors)).toBe("friend is a guest already");
    expect(addGuest([], "get a waffle", editors)).toBe("get a waffle is a map editor already (LAN_PLAYERS)");
    expect(addGuest([], "no;way", editors)).toBe('"no;way" is not a gamertag: letters, digits and single spaces, up to 20');
    expect(removeGuest(["Friend", "Pal"], "FRIEND")).toEqual(["Pal"]);
    expect(removeGuest(["Pal"], "Friend")).toBe("Friend isn't a guest");
  });

  it("reads only gamertags from the file", () => {
    expect(parseGuests('["Friend", 3, "bad;name", "Pal"]')).toEqual(["Friend", "Pal"]);
    expect(parseGuests("{}")).toEqual([]);
    expect(parseGuests("nope")).toEqual([]);
  });

  describe("kept in work/editor/guests.json", () => {
    let root: string;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "minecade-guests-test-"));
    });

    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("round trips the list", async () => {
      expect(await readGuests(root)).toEqual([]);
      await writeGuests(root, ["Friend", "Some Pal"]);
      expect(await readGuests(root)).toEqual(["Friend", "Some Pal"]);
      expect(await readFile(join(root, "work", "editor", "guests.json"), "utf8")).toBe('[\n  "Friend",\n  "Some Pal"\n]\n');
    });
  });
});

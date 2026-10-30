import { afterEach, describe, expect, it } from "vitest";
import { badgeFor, skinTexture } from "@minecade/minigame-core";
import { statsContent } from "../behavior_pack/scripts/holo-content.ts";
import { playersForm, statsForm } from "../behavior_pack/scripts/menus.ts";
import { headFor, holoPortraitFor, isWatcher, portraitFor, useSkins } from "../behavior_pack/scripts/skins.ts";
import { GLOBAL_TAB } from "../behavior_pack/scripts/stats-screens.ts";

afterEach(() => useSkins([]));

describe("players' skin renders", () => {
  it("gives a player with a saved skin their renders (by gamertag, any case), and everyone else their badge", () => {
    useSkins([{ name: "Get A Waffle", key: "253" }]);
    expect(headFor("get a waffle")).toBe(skinTexture("253", "head"));
    expect(portraitFor("GET A WAFFLE")).toBe(skinTexture("253", "portrait"));
    expect(holoPortraitFor("Get A Waffle")).toBe(skinTexture("253", "holo"));
    expect(headFor("Steve")).toBe(badgeFor("Steve"));
    useSkins([]);
    expect(headFor("get a waffle")).toBe(badgeFor("get a waffle"));
  });

  it("shows them in the stats list, on the stats screen and on the hologram", () => {
    useSkins([{ name: "Alex", key: "9" }]);
    const list = playersForm({ viewer: "Steve", players: ["Steve", "Alex"], more: 0 }) as unknown as { icons: (string | undefined)[] };
    expect(list.icons.slice(-2)).toEqual([badgeFor("Steve"), skinTexture("9", "head")]);
    const view = { player: "Alex", tabs: [GLOBAL_TAB], tab: GLOBAL_TAB.id, body: "", columns: [] };
    expect((statsForm(view) as unknown as { icons: (string | undefined)[] }).icons).toContain(skinTexture("9", "portrait"));
    expect(statsContent(view).portrait).toBe(skinTexture("9", "holo"));
  });

  it("knows the skin watcher by its gamertag (any case), and nobody when there's none", () => {
    expect(isWatcher("MinecadeServer", "minecadeserver")).toBe(true);
    expect(isWatcher("Steve", "MinecadeServer")).toBe(false);
    expect(isWatcher("", "")).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { badgeFor, skinTexture } from "@minecade/minigame-core";
import { MARK } from "../behavior_pack/scripts/game-screen.ts";
import { statsContent } from "../behavior_pack/scripts/holo-content.ts";
import { playersForm, statsForm } from "../behavior_pack/scripts/menus.ts";
import { headFor, isWatcher, portraitFor, useSkins } from "../behavior_pack/scripts/skins.ts";
import { GLOBAL_TAB } from "../behavior_pack/scripts/stats-screens.ts";

afterEach(() => useSkins([]));

describe("players' skin renders", () => {
  it("gives a player with a saved skin their renders (by gamertag, any case), and everyone else their badge", () => {
    useSkins([{ name: "Get A Waffle", key: "253" }]);
    expect(headFor("get a waffle")).toBe(skinTexture("253", "holo_head"));
    expect(portraitFor("GET A WAFFLE")).toBe(skinTexture("253", "holo"));
    expect(headFor("Steve")).toBe(badgeFor("Steve"));
    useSkins([]);
    expect(headFor("get a waffle")).toBe(badgeFor("get a waffle"));
  });

  it("shows them in the stats list, on the stats screen and on the hologram", () => {
    useSkins([{ name: "Alex", key: "9" }]);
    const list = playersForm({ viewer: "Steve", players: ["Steve", "Alex"], more: 0 }) as unknown as { icons: (string | undefined)[] };
    expect(list.icons.slice(-2)).toEqual([badgeFor("Steve"), skinTexture("9", "holo_head")]);
    const view = { player: "Alex", tabs: [GLOBAL_TAB], tab: GLOBAL_TAB.id, body: "", columns: [] };
    const form = statsForm(view) as unknown as { buttons: string[]; icons: (string | undefined)[] };
    expect(form.icons).toContain(skinTexture("9", "holo"));
    // The player's own render is marked, so it isn't framed; a badge isn't marked, so it is.
    expect(form.buttons).toContain(`${MARK.portrait}${MARK.render}Alex`);
    const badge = statsForm({ ...view, player: "Steve" }) as unknown as { buttons: string[] };
    expect(badge.buttons).toContain(`${MARK.portrait}Steve`);
    expect(statsContent(view).portrait).toBe(skinTexture("9", "holo"));
  });

  it("knows the skin watcher by its gamertag (any case), and nobody when there's none", () => {
    expect(isWatcher("MinecadeServer", "minecadeserver")).toBe(true);
    expect(isWatcher("Steve", "MinecadeServer")).toBe(false);
    expect(isWatcher("", "")).toBe(false);
  });
});

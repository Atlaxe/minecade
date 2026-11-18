import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_SIDEBAR_MARK } from "@minecade/minigame-core";
import { boxRows, boxTitle } from "../behavior_pack/scripts/dialogue-codes.ts";
import { DICE, ITEMS, holdings } from "../behavior_pack/scripts/dice-items.ts";
import { CARD, MENU, PANEL, PANEL_TEXT, RESULT, SCREEN_LAYOUTS, SCREEN_WORDS, bytes, cardRows, codesOf, fieldsOf, initialOf, menuRow, panelRows, placeText, resultRows, wordsOf } from "../behavior_pack/scripts/screen-codes.ts";
import { MAX_ROWS, compose } from "../behavior_pack/scripts/sidebar-rows.ts";

/** A field cut out of a row the way the UI does: its bytes, spaces out. */
function cut(row: string, field: { from: number; length: number }): string {
  const buffer = Buffer.from(row, "utf8");
  const end = field.length === 0 ? buffer.length : field.from + field.length;
  return buffer.subarray(field.from, end).toString("utf8").replaceAll(" ", "");
}

describe("Block Party's screen rows", () => {
  it("puts each field where its layout says, in bytes", () => {
    const [row] = cardRows([{ name: "Alex", stars: 3, coins: 12, place: 1, items: ["ST", "EP"], head: "textures/blockparty/heads/123", turn: true, shown: true }]);
    const fields = fieldsOf(CARD);
    expect(cut(row, fields.stars)).toBe("3");
    expect(cut(row, fields.coins)).toBe("12");
    expect(cut(row, fields.place)).toBe("1st");
    expect(cut(row, fields.item1)).toBe("ST");
    expect(cut(row, fields.item2)).toBe("EP");
    expect(cut(row, fields.item3)).toBe("");
    expect(cut(row, fields.letter)).toBe("A");
    expect(cut(row, fields.head)).toBe("textures/blockparty/heads/123");
    expect(row.startsWith("§k§c§c§0")).toBe(true);
    for (const word of ["t1", "h0", "b1", "g1"]) expect(row).toContain(codesOf(word));
  });

  it("keeps every row's fields in place whatever is in them", () => {
    const fields = fieldsOf(CARD);
    const rows = cardRows([
      { name: "Éclair", stars: 0, coins: 0, items: [], turn: false, shown: false },
      { name: "Sam", stars: 123, coins: 4567, place: 4, items: ["ST", "GT", "V"], turn: true, shown: true },
    ]);
    expect(cut(rows[0], fields.stars)).toBe("0");
    expect(cut(rows[0], fields.letter)).toBe("C");
    expect(cut(rows[1], fields.stars)).toBe("99");
    expect(cut(rows[1], fields.coins)).toBe("999");
    expect(cut(rows[1], fields.item3)).toBe("V");
    expect(cut(rows[1], fields.head)).toBe("");
    // A card not shown yet keeps its place: hidden, no highlight.
    expect(rows[0]).toContain(codesOf("h1"));
    expect(rows[0]).toContain(codesOf("b0"));
    // Every row before its last field is the same length in bytes.
    expect(bytes(rows[0])).toBe(fields.head.from);
  });

  it("has at most one field running to the row's end, and it last", () => {
    for (const screen of Object.values(SCREEN_LAYOUTS)) {
      for (const layout of Object.values(screen.rows)) {
        const rest = layout.parts.filter((part) => part.kind === "rest");
        expect(rest.length).toBeLessThanOrEqual(1);
        if (rest.length) expect(layout.parts.at(-1)?.kind).toBe("rest");
      }
    }
  });

  it("marks the menu's selected and disabled buttons", () => {
    const row = menuRow({ selected: "items", disabled: ["board"], open: false });
    expect(row).toBe("§k§m§s§1§u§0§v§0§j§1§n§0");
    expect(wordsOf(MENU)).toMatchObject({ km: "km", itemsOff: "v1", open: "n1" });
  });

  it("shows a die's faces, or an item's name and what it does", () => {
    const [die] = panelRows({ die: DICE.golden }, true);
    const fields = fieldsOf(PANEL);
    expect(die.startsWith("§k§i§a§1§f§1")).toBe(true);
    expect([1, 2, 3, 4, 5, 6].map((n) => cut(die, fields[`face${n}`]))).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(cut(die, fields.icon)).toBe("GD");
    expect(cut(die, fields.name)).toBe("GoldenDie");
    const item = panelRows({ item: ITEMS.villager }, false);
    expect(item).toHaveLength(2);
    expect(item[0].startsWith("§k§i§a§0§f§0")).toBe(true);
    expect(cut(item[0], fields.icon)).toBe("V");
    expect(item[1]).toBe(`§k§j${ITEMS.villager.what}`);
    expect(fieldsOf(PANEL_TEXT).what).toEqual({ from: 6, length: 0 });
  });

  it("writes the results' rows", () => {
    const rows = resultRows([{ seat: 2, name: "Alex", place: 1, stars: 2, coins: 30, border: true }]);
    const fields = fieldsOf(RESULT);
    expect(rows[0].startsWith("§k§s§q§2§e§1§g§0")).toBe(true);
    expect(cut(rows[0], fields.place)).toBe("1st");
    expect(cut(rows[0], fields.coins)).toBe("30");
  });

  it("says places and initials", () => {
    expect([1, 2, 3, 4, undefined].map(placeText)).toEqual(["1st", "2nd", "3rd", "4th", ""]);
    expect(initialOf("xX_Sam")).toBe("X");
    expect(initialOf("___")).toBe("?");
  });

  it("gives no two screens' words, nor their rows' codes, one inside another", () => {
    const words = Object.values(SCREEN_WORDS).map(codesOf);
    for (const a of words) for (const b of words) if (a !== b) expect(a.includes(b)).toBe(false);
    const kinds = ["kc", "km", "ki", "kj", "ks"].map(codesOf);
    for (const a of kinds) for (const b of kinds) if (a !== b) expect(a.includes(b)).toBe(false);
    // The dialogue box's codes (§k§1 to §k§6, §d§l§g) aren't any of these.
    const box = boxRows({ words: ["Hi."], buttons: ["Yes", "No"], selected: 0, skip: "Skip", jumped: ["Alex"], prompt: "" }).join("");
    for (const kind of kinds) expect(box.includes(kind)).toBe(false);
  });

  it("keeps the standard die first, and the limits", () => {
    expect(holdings(["golden", "standard", "risk", "slow"], ["stone_totem", "glove", "villager", "lightning"])).toEqual({ dice: ["standard", "golden", "risk"], items: ["stone_totem", "glove", "villager"] });
  });
});

describe("Block Party's sidebar", () => {
  it("puts the screens' words in the title before the dialogue box's part", () => {
    const box = boxTitle("everyone", "Chris");
    const { title, rows } = compose({ dialogue: { title: box, rows: ["§k§1§0§rHello."] }, cards: { title: codesOf(SCREEN_WORDS.cards), rows: ["§k§c§c§0x"] } });
    expect(title).toBe(`${GAME_SIDEBAR_MARK}§b§p§c${box.slice(GAME_SIDEBAR_MARK.length)}`);
    expect(title.endsWith("§rChris")).toBe(true);
    expect(rows).toEqual(["§k§1§0§rHello.", "§k§c§c§0x"]);
  });

  it("keeps to the client's 15 rows, the dialogue box's first", () => {
    const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const { rows, dropped } = compose({ results: { title: "", rows: many("r", 5) }, dialogue: { title: "", rows: many("d", 8) }, cards: { title: "", rows: many("c", 4) } });
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows.slice(0, 8)).toEqual(many("d", 8));
    expect(dropped).toBe(2);
  });

  it("is only the mark with nothing in it", () => {
    expect(compose({})).toEqual({ title: GAME_SIDEBAR_MARK, rows: [], dropped: 0 });
  });
});

describe("Block Party's screens' JSON UI (the workshop builder's components, installed)", () => {
  /**
   * A field's expression as the builder writes it (its compile.mjs fieldExpression). A trimmed one
   * takes the spaces out of both cuts before one comes out of the other: the game reads a field
   * that starts with a number (" 2", "1st") as one and shows nothing for (' 2' - ' ').
   */
  const expression = (field: { from: number; length: number }, trim: boolean) => {
    const row = "#player_name_sidebar";
    const first = (n: number) => `('%.${n}s' * ${row})`;
    const spaced = (text: string) => (trim ? `(${text} - ' ')` : text);
    const end = field.length === 0 ? row : first(field.from + field.length);
    return field.from === 0 ? spaced(end) : `(${spaced(end)} - ${spaced(first(field.from))})`;
  };
  const files = { cards: "jui_blockparty_cards", menu: "jui_blockparty_menu", panel: "jui_blockparty_panel", results: "jui_blockparty_results" } as const;

  for (const [screen, name] of Object.entries(files) as [keyof typeof files, string][]) {
    it(`${name} shows for its word and cuts each field where the game writes it`, () => {
      const text = readFileSync(new URL(`../resource_pack/ui/${name}.json`, import.meta.url), "utf8");
      expect(text).toContain(codesOf(SCREEN_WORDS[screen]));
      for (const layout of Object.values(SCREEN_LAYOUTS[screen].rows)) {
        const kinds = Object.fromEntries(layout.parts.filter((part) => "name" in part).map((part) => [part.name, part.kind]));
        for (const [field, place] of Object.entries(fieldsOf(layout))) {
          // A field the design doesn't use isn't in the file; one it uses must be at the game's place.
          const any = new RegExp(`'%\.${place.from + place.length}s'|'%\.${place.from}s'`);
          if (!any.test(text)) continue;
          expect(text, `${screen}'s ${field}`).toContain(JSON.stringify(expression(place, kinds[field] === "field")).slice(1, -1));
        }
      }
    });
  }

  it("draws each screen in Block Party's HUD, under the dialogue box", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    const at = (name: string) => hud.indexOf(`@${name}.layout`);
    for (const name of Object.values(files)) expect(at(name)).toBeGreaterThan(0);
    expect(at("jui_blockparty_results")).toBeLessThan(at("jui_blockparty_cards"));
    expect(at("jui_blockparty_panel")).toBeLessThan(at("jui_blockparty_dialogue"));
  });
});

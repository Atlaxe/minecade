import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_SIDEBAR_MARK } from "@minecade/minigame-core";
import { boxRows, boxTitle } from "../behavior_pack/scripts/dialogue-codes.ts";
import { DICE } from "../behavior_pack/scripts/dice.ts";
import { ITEMS, holdings } from "../behavior_pack/scripts/dice-items.ts";
import { ANNOUNCE_HEAD, ANNOUNCE_WHEEL, CARD, EMPTY_ICON, MAX_CONTROLS, MENU, PANEL, PANEL_TEXT, RESULT, ROUND, ROUND_COLORS, SCREEN_LAYOUTS, SCREEN_WORDS, STANDINGS_WORD, TUTORIAL_CONTROL, TUTORIAL_INPUTS, TUTORIAL_READY, announceRows, bytes, cardRows, codesOf, fieldsOf, initialOf, menuRow, panelRows, placeText, resultRows, roundRow, roundText, tutorialRows, wordsOf } from "../behavior_pack/scripts/screen-codes.ts";
import { MAX_ROWS, compose } from "../behavior_pack/scripts/sidebar-rows.ts";
import { READY_CODE, SIDE_TWO_CODE, STANDINGS_CODE } from "../behavior_pack/scripts/bar-codes.ts";
import { standingRows } from "../behavior_pack/scripts/results.ts";

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
    // An empty slot's picture is the clear one (the screens show items by their letters' pictures).
    expect(cut(row, fields.item3)).toBe(EMPTY_ICON);
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

  it("draws a result row at its place, or a quarter of a row a step toward the next while it slides", () => {
    const row = (slide?: number) => resultRows([{ seat: 0, name: "Alex", place: 1, stars: 1, coins: 9, border: false, ...(slide === undefined ? {} : { slide }) }])[0];
    expect(row()).toContain("§d§5");
    expect(row(1)).toContain("§d§6");
    expect(row(3)).toContain("§d§8");
    expect(row(-2)).toContain("§d§3");
    // Never past three quarters: the next frame has it in its new place.
    expect(row(9)).toContain("§d§8");
    expect(row(-9)).toContain("§d§2");
    // Its fields stay where they were.
    const fields = fieldsOf(RESULT);
    expect(cut(row(2), fields.place)).toBe("1st");
    expect(cut(row(2), fields.coins)).toBe("9");
  });

  it("ranks the standings for a player's own results screen: best first, ties sharing a place, 1st bordered", () => {
    const rows = standingRows([
      { key: "c", name: "Cam", stars: 0, coins: 40 },
      { key: "a", name: "Alex", stars: 1, coins: 5 },
      { key: "b", name: "Bea", stars: 1, coins: 5 },
    ]);
    expect(rows.map((row) => [row.name, row.place, row.border, row.seat])).toEqual([
      ["Alex", 1, true, 0],
      ["Bea", 1, true, 1],
      ["Cam", 3, false, 2],
    ]);
    expect(STANDINGS_WORD).not.toBe(SCREEN_WORDS.results);
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
    expect(item[1]).toBe(`§k§j${ITEMS.villager.description}`);
    expect(fieldsOf(PANEL_TEXT).what).toEqual({ from: 6, length: 0 });
  });

  it("shows a die's faces, its description or both, as the dice file says, each face what it says it shows", () => {
    const fields = fieldsOf(PANEL);
    const die = { ...DICE.golden, panel: "faces" as const };
    expect(panelRows({ die }, false)).toHaveLength(1);
    // Its description instead: the faces are hidden (no die switch), and the second row says it.
    const told = panelRows({ die: { ...die, panel: "description" } }, false);
    expect(told).toHaveLength(2);
    expect(told[0].startsWith("§k§i§a§0§f§0")).toBe(true);
    expect(cut(told[0], fields.face1)).toBe("");
    expect(told[1]).toBe(`§k§j${die.description}`);
    const both = panelRows({ die: { ...die, panel: "both" } }, false);
    expect(both[0].startsWith("§k§i§a§0§f§1")).toBe(true);
    expect(both[1]).toBe(`§k§j${die.description}`);
    // A face can show letters in place of its move.
    const faces = die.faces.map((face, i) => (i === 0 ? { ...face, show: "S" } : face));
    expect(cut(panelRows({ die: { ...die, faces } }, false)[0], fields.face1)).toBe("S");
  });

  it("writes the round's row in its own colors, not the line's: the round light gray, the rounds in all dark gray", () => {
    // The line with a fill style on each fill (the dialogue tool's), as line() gives it.
    const say = (fills: { round: number; rounds: string }) => `Round §2${fills.round}§r / §q${fills.rounds}§r`;
    const text = roundText(say, 3, 10);
    expect(text).toBe(`${ROUND_COLORS.round}Round 3 / ${ROUND_COLORS.rounds}10`);
    expect([ROUND_COLORS.round, ROUND_COLORS.rounds]).toEqual(["§7", "§8"]);
    // Worded another way, the rounds' color still goes on the rounds.
    expect(roundText((fills) => `${fills.rounds} rounds, this is ${fills.round}`, 3, 10)).toBe("§7§810 rounds, this is 3");
    const row = roundRow(text);
    expect(row).toBe("§k§n§7Round 3 / §810");
    expect(Buffer.from(row, "utf8").subarray(fieldsOf(ROUND).text.from).toString("utf8")).toBe("§7Round 3 / §810");
  });

  it("writes the results' rows", () => {
    const rows = resultRows([{ seat: 2, name: "Alex", place: 1, stars: 2, coins: 30, border: true }]);
    const fields = fieldsOf(RESULT);
    expect(rows[0].startsWith("§k§s§q§2§e§1§g§0")).toBe(true);
    expect(cut(rows[0], fields.place)).toBe("1st");
    expect(cut(rows[0], fields.coins)).toBe("30");
  });

  it("writes the minigame announcement: the heading, the format once it shows, and the wheel with its light and its pick", () => {
    const head = fieldsOf(ANNOUNCE_HEAD);
    expect(announceRows({})).toEqual(["§k§a§f§0"]);
    const [withFormat, ...wheel] = announceRows({ format: "§bFree for all", wheel: { names: ["Hot Floor", "Mob Freeze", "TNT Run"], at: 1, landed: false } });
    expect(withFormat.startsWith("§k§a§f§1")).toBe(true);
    expect(Buffer.from(withFormat, "utf8").subarray(head.format.from).toString("utf8")).toBe("Free for all");
    expect(wheel.map((row) => cut(row, fieldsOf(ANNOUNCE_WHEEL).name))).toEqual(["HotFloor", "MobFreeze", "TNTRun"]);
    expect(wheel.map((row) => row.slice(0, 16))).toEqual(["§k§w§w§0§s§0§l§0", "§k§w§w§1§s§1§l§0", "§k§w§w§2§s§0§l§0"]);
    const landed = announceRows({ format: "Free for all", wheel: { names: ["Hot Floor", "Mob Freeze"], at: 0, landed: true } });
    expect(landed[1]).toContain("§s§0§l§1");
    expect(landed[2]).toContain("§s§0§l§0");
  });

  it("writes the minigame tutorial: the name, each side's objective and controls, and the Ready strip", () => {
    const rows = tutorialRows({
      name: "Hunter",
      sides: [
        { objective: "Catch them.", controls: [{ input: "attack", what: "Catch a runner" }] },
        { objective: "Get home.", controls: [{ input: "move", what: "Run" }, { input: "jump", what: "Hop" }] },
      ],
      ready: 1,
      total: 4,
    });
    // Each control names its input by its place in TUTORIAL_INPUTS (§i§2 attack, §i§0 move, §i§1 jump).
    expect(rows).toEqual(["§k§tHunter", "§k§oCatch them.", "§k§x§x§0§i§2Catch a runner", "§k§pGet home.", "§k§q§x§0§i§0Run", "§k§q§x§1§i§1Hop", "§k§r1/4"]);
    expect(wordsOf(TUTORIAL_CONTROL).input).toBe("i");
    expect(TUTORIAL_INPUTS.map((_, i) => `i${i}`).filter((word) => rows[2].includes(codesOf(word)))).toEqual(["i2"]);
    const control = fieldsOf(TUTORIAL_CONTROL);
    expect(Buffer.from(rows[2], "utf8").subarray(control.what.from).toString("utf8")).toBe("Catch a runner");
    expect(cut(rows[6], fieldsOf(TUTORIAL_READY).votes)).toBe("1/4");
    // At most MAX_CONTROLS controls a side, and no more than everyone ready.
    const many = tutorialRows({ name: "X", sides: [{ objective: "Go.", controls: Array.from({ length: 5 }, () => ({ input: "move" as const, what: "w" })) }], ready: 5, total: 4 });
    expect(many.filter((row) => row.startsWith("§k§x"))).toHaveLength(MAX_CONTROLS);
    expect(many.at(-1)).toBe("§k§r4/4");
  });

  it("says places and initials", () => {
    expect([1, 2, 3, 4, undefined].map(placeText)).toEqual(["1st", "2nd", "3rd", "4th", ""]);
    expect(initialOf("xX_Sam")).toBe("X");
    expect(initialOf("___")).toBe("?");
  });

  it("gives no two screens' words, nor their rows' codes, one inside another", () => {
    const words = Object.values(SCREEN_WORDS).map(codesOf);
    for (const a of words) for (const b of words) if (a !== b) expect(a.includes(b)).toBe(false);
    const kinds = ["kc", "km", "ki", "kj", "ks", "kn", "ka", "kw", "kt", "ko", "kp", "kx", "kq", "kr"].map(codesOf);
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

  it("leaves the dialogue box out while the item panel is up, and brings it back after", () => {
    const box = boxTitle("everyone", "Chris");
    const dialogue = { title: box, rows: ["§k§1§0§rHello."] };
    const panel = { title: codesOf(SCREEN_WORDS.panel), rows: ["§k§i§a§0§f§1"] };
    const up = compose({ dialogue, panel });
    expect(up.title).toBe(`${GAME_SIDEBAR_MARK}${codesOf(SCREEN_WORDS.panel)}`);
    expect(up.rows).toEqual(panel.rows);
    expect(compose({ dialogue }).rows).toEqual(dialogue.rows);
  });

  it("is only the mark with nothing in it", () => {
    expect(compose({})).toEqual({ title: GAME_SIDEBAR_MARK, rows: [], dropped: 0 });
  });
});

describe("Block Party's screens' JSON UI (the workshop builder's components, installed)", () => {
  /**
   * A field's expression as the builder writes it (its compile.mjs fieldExpression), for a label
   * (`lead` "§r") or a picture's path (no lead). The game reads text that starts with a number
   * (" 2", "1st") as one and shows nothing for it, so a trimmed field takes the spaces out of both
   * cuts, and a label's puts the reset code in front of the longer one before the shorter one comes
   * out: no step leaves text starting with a digit.
   */
  const expression = (field: { from: number; length: number }, trim: boolean, lead: string) => {
    const row = "#player_name_sidebar";
    const first = (n: number) => `('%.${n}s' * ${row})`;
    const spaced = (text: string) => (trim ? `(${text} - ' ')` : text);
    const end = field.length === 0 ? row : first(field.from + field.length);
    const led = lead ? `('${lead}' + ${spaced(end)})` : spaced(end);
    return field.from === 0 ? led : `(${led} - ${spaced(first(field.from))})`;
  };
  const files = {
    cards: "jui_blockparty_cards",
    menu: "jui_blockparty_menu",
    panel: "jui_blockparty_panel",
    results: "jui_blockparty_results",
    round: "jui_blockparty_round",
    announce: "jui_blockparty_announce",
    tutorial: "jui_blockparty_tutorial",
  } as const;

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
          const forms = ["§r", ""].map((lead) => JSON.stringify(expression(place, kinds[field] === "field", lead)).slice(1, -1));
          expect(forms.some((form) => text.includes(form)), `${screen}'s ${field} at ${place.from}`).toBe(true);
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

  it("shows the tutorial's second side and its Ready! strip by each player's action bar codes, and the announcement over the star field", () => {
    const tutorial = readFileSync(new URL("../resource_pack/ui/jui_blockparty_tutorial.json", import.meta.url), "utf8");
    // Read through the piece's own copy of the line ($atext): straight from $actionbar_text an
    // expression never matches (network 59d0c7a).
    expect(tutorial).toContain('"$atext": "$actionbar_text"');
    for (const code of [SIDE_TWO_CODE, READY_CODE]) {
      expect(tutorial).toContain(`(($atext - '${code}') = $atext)`);
      expect(tutorial).toContain(`(not (($atext - '${code}') = $atext))`);
    }
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    const at = (name: string) => hud.indexOf(name);
    expect(at("@blockparty_hud.stars")).toBeGreaterThan(0);
    expect(at("@blockparty_hud.stars")).toBeLessThan(at("@jui_blockparty_announce.layout"));
    // Lifted over the stars, as the dialogue box is.
    expect(hud).toContain('{ "jui_blockparty_announce@jui_blockparty_announce.layout": { "layer": 200 } }');
  });

  it("draws each tutorial input the player's own way: key caps, the controller's own glyph, the touch button", () => {
    const tutorial = readFileSync(new URL("../resource_pack/ui/jui_blockparty_tutorial.json", import.meta.url), "utf8");
    // Each input shows on the control rows that name it, on both sides' lists.
    for (const i of TUTORIAL_INPUTS.keys()) {
      const shows = `(not ((#player_name_sidebar - '${codesOf(`i${i}`)}') = #player_name_sidebar))`;
      expect(tutorial.split(shows).length - 1, TUTORIAL_INPUTS[i]).toBe(2);
    }
    for (const key of ["W", "A", "S", "D", "Space", "Left Click", "Right Click", "Shift", "Ctrl"]) expect(tutorial).toContain(`"text": "${key}"`);
    for (const binding of ["#controller_left_stick_icon", "#controller_face_down_icon", "#controller_right_trigger", "#controller_left_trigger", "#controller_face_right_icon"]) expect(tutorial).toContain(`"binding_name": "${binding}"`);
    for (const button of ["joystick_frame", "jump", "attack", "interact", "sneak", "sprint"]) expect(tutorial).toContain(`"texture": "textures/ui/${button}"`);
    // The Ready strip asks for the jump, a minigame's Ready (25d4d93): Space beside each side's jump
    // input (three), and no Right Click but each side's use input (two).
    expect(tutorial.split('"text": "Space"').length - 1).toBe(3);
    expect(tutorial.split('"text": "Right Click"').length - 1).toBe(2);
    expect(tutorial.split('"texture": "textures/ui/interact"').length - 1).toBe(2);
  });

  it("shows a player their own results screen for the standings word while their line has the standings code, and hides their cards", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).toContain(`(not (($atext - '${STANDINGS_CODE}') = $atext))`);
    expect(hud).toContain(`(#objective_sidebar_name - '${codesOf(STANDINGS_WORD)}')`);
    expect(hud).toContain(`(($atext - '${STANDINGS_CODE}') = $atext)`);
  });

  it("shows items and dice as their icons' pictures, by the letters the game writes", () => {
    const path = (from: number, to: number) => `('textures/blockparty/icons/' + ((('%.${to}s' * #player_name_sidebar) - ' ') - (('%.${from}s' * #player_name_sidebar) - ' ')))`;
    const cards = readFileSync(new URL("../resource_pack/ui/jui_blockparty_cards.json", import.meta.url), "utf8");
    for (const slot of ["item1", "item2", "item3"]) {
      const field = fieldsOf(CARD)[slot];
      expect(cards, slot).toContain(JSON.stringify(path(field.from, field.from + field.length)).slice(1, -1));
    }
    const panel = readFileSync(new URL("../resource_pack/ui/jui_blockparty_panel.json", import.meta.url), "utf8");
    const icon = fieldsOf(PANEL).icon;
    expect(panel).toContain(JSON.stringify(path(icon.from, icon.from + icon.length)).slice(1, -1));
  });

  it("slides the results' rows on the code the game writes", () => {
    const text = readFileSync(new URL("../resource_pack/ui/jui_blockparty_results.json", import.meta.url), "utf8");
    // 5 is a row at its place: shown while the row has none of the others.
    for (const digit of [2, 3, 4, 6, 7, 8]) expect(text).toContain(`'§d§${digit}'`);
    expect(text).toContain('"-75%"');
    expect(text).toContain('"75%"');
  });

  it("keeps the chat hidden unless the player's chat switch (the status effects element) is on", () => {
    const hud = readFileSync(new URL("../resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(hud).toContain('"control_name": "chat_panel"');
    expect(hud).toContain("(#editor_chat_visible and #status_effects_visible)");
    // The core pack takes the status effects' icons away on every server, so the switch shows nothing else.
    const core = readFileSync(new URL("../../../packages/minigame-core/resource_pack/ui/hud_screen.json", import.meta.url), "utf8");
    expect(core).toContain('"operation": "remove", "control_name": "mob_effects_renderer"');
  });
});

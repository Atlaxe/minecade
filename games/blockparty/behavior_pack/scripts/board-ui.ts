// The board menu and the item panel (docs/plans/block-party-ui.md, "The board menu" and "The item
// panel"), the same for everyone: on the active player's turn, until they roll.
//   - The menu, top left: Dice block, Items and Board. The movement keys step through it (Items is
//     skipped while they hold no items), jump picks, sneak does nothing.
//   - Dice block and Items open the item panel, bottom left: one die or item at a time, A and D step
//     through what they hold (wrapping round; W and S do nothing there, the user's call), jump rolls
//     the die (the one shown floats over their head) or uses the item, sneak goes back to the menu.
//   - Board shows the whole board from above for everyone (the user: a wide, still view, nothing to
//     move); it's a toggle, so a jump goes back to the menu (the user, 2026-11-18), and so does sneak.
// Only the player whose turn it is steers it, and not while the dialogue box is theirs to steer. A
// bot's turn shows the same: the menu, then the dice, a moment each, then the roll.
// What shows goes on the game's sidebar (sidebar-rows.ts) as screen-codes.ts's rows; each step,
// pick and back plays its event's sound (the user's sound map, sounds.ts).
import type { Player } from "@minecraft/server";
import type { Scope } from "@minecade/minigame-core";
import { pushOf, sidewaysOf, stepThrough } from "./board-view.ts";
import type { Who } from "./bots.ts";
import { Steering } from "./dialogue-codes.ts";
import { dieOf, type DieDef } from "./dice.ts";
import { ITEMS, type Holdings, type ItemDef } from "./dice-items.ts";
import { MENU_BUTTONS, SCREEN_WORDS, codesOf, menuRow, panelRows, type MenuButton } from "./screen-codes.ts";
import type { GameSidebar } from "./sidebar-rows.ts";
import { eventCue, playCue } from "./sounds.ts";

export interface BoardMenuHost {
  scope: Scope;
  sidebar: GameSidebar;
  random(): number;
  /** What a seat holds now. */
  holdingsOf(who: Who): Holdings;
  /** The panel shows this die now (the one over the roller's head follows), or no die (closed, or items). */
  showDie(who: Who, die: DieDef | undefined): void;
  /** A jump with a die showing: the roll (the menu is already gone, the die still up). */
  roll(who: Who, die: DieDef): void;
  /** A jump with an item showing. */
  use(who: Who, item: ItemDef): void;
  /** Board's view of the whole board for everyone, or back to the turn's own camera. */
  boardView(on: boolean): void;
  /** Whether `player` is steering something else now (the dialogue box): their keys are its. */
  busy(player: Player): boolean;
}

type View = "menu" | "dice" | "items" | "board";

/** Events each step and pick play (the user's sound map: event:<id>). */
export const MENU_EVENTS = {
  step: "menu.step",
  select: "menu.select",
  back: "menu.back",
  disabled: "menu.disabled",
  panelStep: "panel.step",
  panelUse: "panel.use",
  switchDie: "panel.switch-die",
} as const;

/** A bot's turn: how long the menu shows, then the dice, before it rolls. */
const BOT_MENU = 14;
const BOT_DICE = 18;

interface Turn {
  who: Who;
  view: View;
  selected: MenuButton;
  dice: number;
  items: number;
}

export class BoardMenu {
  private readonly host: BoardMenuHost;
  private turn: Turn | undefined;
  private readonly steering = new Steering();

  constructor(host: BoardMenuHost) {
    this.host = host;
    host.scope.interval(() => this.tick(), 1);
    host.scope.add(() => (this.turn = undefined));
  }

  /** Whose menu is up (their key). */
  get active(): string | undefined {
    return this.turn?.who.key;
  }

  /** Whether `key`'s item panel shows a die now (it floats over their head). */
  showsDie(key: string): boolean {
    return this.turn?.who.key === key && this.turn.view === "dice";
  }

  /** Opens the menu on `who`'s turn, on Dice block. */
  open(who: Who): void {
    this.steering.reset();
    this.turn = { who, view: "menu", selected: "dice", dice: 0, items: 0 };
    this.draw();
  }

  /** Takes the menu and panel down (the roll, or the turn called off); the die over the head stays when `keepDie`. */
  close(keepDie = false): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = undefined;
    if (turn.view === "board") this.host.boardView(false);
    if (turn.view === "dice" && !keepDie) this.host.showDie(turn.who, undefined);
    this.host.sidebar.set("menu", undefined);
    this.host.sidebar.set("panel", undefined);
  }

  /** What the seat holds changed: the panel keeps to what's there. */
  refresh(): void {
    if (this.turn) this.draw();
  }

  /**
   * A bot's turn as everyone sees it: the menu, then the dice (a special one at random, sometimes),
   * then it's gone. Resolves with the die to roll, or undefined if the menu went meanwhile.
   */
  async botTurn(who: Who): Promise<DieDef> {
    this.open(who);
    await this.host.scope.wait(BOT_MENU);
    const turn = this.turn;
    const dice = this.host.holdingsOf(who).dice;
    if (turn?.who.key === who.key) {
      turn.view = "dice";
      turn.dice = this.host.random() < 0.3 && dice.length > 1 ? 1 + Math.floor(this.host.random() * (dice.length - 1)) : 0;
      playCue(eventCue(MENU_EVENTS.select));
      this.draw();
      await this.host.scope.wait(BOT_DICE);
    }
    const die = dieOf(dice[turn?.dice ?? 0]);
    if (this.turn?.who.key === who.key) this.close(true);
    return die;
  }

  /** A jump: the active player picking, and in the dice panel the jump that hits the die. True when the menu took it. */
  jumped(player: Player): boolean {
    const turn = this.mine(player);
    if (!turn) return false;
    if (turn.view === "dice") {
      const die = this.die(turn);
      this.close(true);
      this.host.roll(turn.who, die);
      return true;
    }
    if (turn.view === "menu") {
      if (turn.selected === "board") {
        turn.view = "board";
        this.host.boardView(true);
      } else if (turn.selected === "items") {
        if (this.disabled(this.held(turn)).includes("items")) {
          playCue(eventCue(MENU_EVENTS.disabled));
          return true;
        }
        turn.view = "items";
        turn.items = 0;
      } else {
        turn.view = "dice";
        turn.dice = 0;
        this.host.showDie(turn.who, this.die(turn));
      }
      playCue(eventCue(MENU_EVENTS.select));
      this.draw();
      return true;
    }
    if (turn.view === "items") {
      const item = this.item(turn);
      if (!item) return true;
      playCue(eventCue(MENU_EVENTS.panelUse));
      turn.view = "menu";
      this.draw();
      this.host.use(turn.who, item);
      return true;
    }
    // Board is a toggle: a jump goes back to the menu.
    this.host.boardView(false);
    turn.view = "menu";
    playCue(eventCue(MENU_EVENTS.back));
    this.draw();
    return true;
  }

  /** A tap of sneak: back from the panel or Board to the menu. True when the menu took it. */
  sneaked(player: Player): boolean {
    const turn = this.mine(player);
    if (!turn) return false;
    if (turn.view === "menu") return true;
    if (turn.view === "board") this.host.boardView(false);
    if (turn.view === "dice") this.host.showDie(turn.who, undefined);
    turn.view = "menu";
    playCue(eventCue(MENU_EVENTS.back));
    this.draw();
    return true;
  }

  /** The active player's turn, if `player` is them. */
  private mine(player: Player): Turn | undefined {
    const turn = this.turn;
    return turn && turn.who.player && turn.who.key === player.name.toLowerCase() ? turn : undefined;
  }

  private held(turn: Turn): Holdings {
    return this.host.holdingsOf(turn.who);
  }

  private die(turn: Turn): DieDef {
    const dice = this.held(turn).dice;
    return dieOf(dice[Math.min(turn.dice, dice.length - 1)]);
  }

  private item(turn: Turn): ItemDef | undefined {
    const items = this.held(turn).items;
    const id = items[Math.min(turn.items, items.length - 1)];
    return id ? ITEMS[id] : undefined;
  }

  /** Each tick: the active player's movement keys step through the menu or the panel. */
  private tick(): void {
    const turn = this.turn;
    const player = turn?.who.player;
    if (!turn || !player?.isValid || turn.view === "board") return;
    if (this.host.busy(player)) {
      this.steering.reset();
      return;
    }
    let push = 0;
    try {
      // The menu steps with any movement key; the item panel only with A and D.
      const vector = player.inputInfo.getMovementVector();
      push = turn.view === "menu" ? pushOf(vector) : sidewaysOf(vector);
    } catch {
      return;
    }
    const step = this.steering.step(push);
    if (step === 0) return;
    const held = this.held(turn);
    if (turn.view === "menu") {
      const at = MENU_BUTTONS.indexOf(turn.selected);
      const next = stepThrough(at, MENU_BUTTONS.length, step, (i) => this.disabled(held).includes(MENU_BUTTONS[i]));
      if (next === at) return;
      turn.selected = MENU_BUTTONS[next];
      playCue(eventCue(MENU_EVENTS.step));
    } else if (turn.view === "dice") {
      const next = stepThrough(turn.dice, held.dice.length, step);
      if (next === turn.dice) return;
      turn.dice = next;
      this.host.showDie(turn.who, this.die(turn));
      playCue(eventCue(MENU_EVENTS.switchDie));
    } else {
      const next = stepThrough(turn.items, held.items.length, step);
      if (next === turn.items) return;
      turn.items = next;
      playCue(eventCue(MENU_EVENTS.panelStep));
    }
    this.draw();
  }

  /** Items is dim with nothing held, or once an item has been used this turn (one a turn). */
  private disabled(held: Holdings): MenuButton[] {
    return held.items.length === 0 || held.spent ? ["items"] : [];
  }

  private draw(): void {
    const turn = this.turn;
    if (!turn) return;
    const held = this.held(turn);
    // Items gone (or spent) while the panel showed them: back to the menu.
    if (turn.view === "items" && this.disabled(held).includes("items")) turn.view = "menu";
    turn.dice = Math.min(turn.dice, Math.max(0, held.dice.length - 1));
    turn.items = Math.min(turn.items, Math.max(0, held.items.length - 1));
    if (this.disabled(held).includes(turn.selected)) turn.selected = "dice";
    this.host.sidebar.set("menu", { title: codesOf(SCREEN_WORDS.menu), rows: [menuRow({ selected: turn.selected, disabled: this.disabled(held), open: turn.view !== "menu" })] });
    if (turn.view === "dice") {
      this.host.sidebar.set("panel", { title: codesOf(SCREEN_WORDS.panel), rows: panelRows({ die: this.die(turn) }, held.dice.length > 1) });
    } else if (turn.view === "items") {
      const item = this.item(turn);
      this.host.sidebar.set("panel", item ? { title: codesOf(SCREEN_WORDS.panel), rows: panelRows({ item }, held.items.length > 1) } : undefined);
    } else this.host.sidebar.set("panel", undefined);
  }
}

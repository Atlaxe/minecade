// Block Party's spike (docs/plans/block-party.md, "Suggested order" 1), played as a test game on
// Probe's map. It lays a 12-space test board beside the platform, makes each player their own piece
// on it, and gives them the game's hotbar (a stand-in for it) with a Tests menu. The menu tries what
// the game will need:
//   - walking a piece (pieces.ts: the player pushed along the path, easing into corners; each walk
//     says in chat how it went), watched by everyone through the chase or watch camera;
//   - camera shots (shots.ts), skipped by everyone jumping (a vote);
//   - the jump button: every jump is reported in chat with what was locked at the time;
//   - the hotbar: the pack's own, bottom right (vanilla's is hidden; bar-codes.ts and
//     ui/blockparty_hud.json), each player's drawn from codes on their action bar: Items, Dice and
//     Tests in the rightmost slots, only the slots in use showing. Vanilla's slots still pick
//     (scrolling, number keys). Using Items or Dice swaps the bar for that set (the items held, or the
//     dice, each with a Back slot); in the dice, the die picked floats over your head and a jump hits
//     it, and your piece walks the number. Health, hunger and the XP bar are hidden;
//   - the NPCs on the vanilla mobs' models (npcs.ts): hit one for its animations and variants;
//   - arenas from other maps (spike/blockparty/arena-pack.ts installs them as structures in
//     private_packs/arenas/): placed far east of the board (or in the map's arena slot), fresh each
//     time: a fade to black, the loading screen (the star field and Minecade's logo) fading in over
//     it, then out again, and the black fading away on the new place;
//   - a player riding a player and on a lead (two players; both need private_packs/players/,
//     vanilla's player.json made rideable and leashable).
// What a test tells a player in chat also goes to the server's log ("blockparty test:" lines).
import {
  ButtonState,
  EntityComponentTypes,
  HudElement,
  HudVisibility,
  InputButton,
  InputPermissionCategory,
  ItemLockMode,
  ItemStack,
  BlockVolume,
  system,
  world,
  type Container,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ARENA_SLOT, Minigame, Notes, describeError, draw, hudLine, log, say, showForm, spacesOf, type GameContext, type Result, type SpawnReason } from "@minecade/minigame-core";
import registry from "#registry";
import { HOTBAR_SIZE, LOADING_LEVELS, barCodes, loadingCode, type BarIcon } from "./bar-codes.ts";
import type config from "../../game.config.ts";
import { boardBox, build, mapSpaces, testSpaces, type Space, type Vec3 } from "./board.ts";
import { BoardLoop } from "./board-loop.ts";
import { LENGTHS } from "./board-rules.ts";
import { Npcs } from "./npcs.ts";
import { DEFAULT_SETTINGS, Pieces, WALK_CAMERAS, lock, unlock, type PieceSettings } from "./pieces.ts";
import { SHOTS, Shots, type ShotId } from "./shots.ts";

type Config = typeof config;

// ---- The hotbar ----------------------------------------------------------------------------
// The bar's items are the pack's own (behavior_pack/items/bar_<icon>.json), with a clear texture so
// nothing shows in the player's hand (the user asked); the bar draws each one's icon (vanilla's
// textures for now, bar-codes.ts). Each has a name and a line saying what it does.

interface BarItem {
  id: string;
  name: string;
  what: string;
  /** Its icon on the pack's bar. */
  icon: BarIcon;
}
interface Die extends BarItem {
  faces: readonly number[];
  /** The block that floats over the roller's head while it's picked. */
  block: string;
}

/** A bar item's id: the pack's item for its icon. */
const barItem = (icon: BarIcon) => `blockparty:bar_${icon}`;
const MENU_ITEM = barItem("tests");
const ITEMS_ITEM = barItem("items");
const DICE_ITEM = barItem("dice");
const BACK_ITEM = barItem("back");

const MAIN_BAR: readonly BarItem[] = [
  { id: ITEMS_ITEM, name: "Items", what: "Use it: your items", icon: "items" },
  { id: DICE_ITEM, name: "Dice", what: "Use it: pick a die, then jump to roll", icon: "dice" },
  { id: MENU_ITEM, name: "Tests", what: "Every Block Party test", icon: "tests" },
];
const DICE: readonly Die[] = [
  { id: barItem("die"), name: "Die", what: "Jump to hit it: 1 to 6", icon: "die", faces: [1, 2, 3, 4, 5, 6], block: "minecraft:white_concrete" },
  { id: barItem("slow_die"), name: "Slow Die", what: "Jump to hit it: 1 to 3", icon: "slow_die", faces: [1, 2, 3], block: "minecraft:light_blue_concrete" },
  { id: barItem("golden_die"), name: "Golden Die", what: "Jump to hit it: 5 to 10", icon: "golden_die", faces: [5, 6, 7, 8, 9, 10], block: "minecraft:gold_block" },
];
const ITEMS: readonly BarItem[] = [
  { id: barItem("stone_totem"), name: "Stone Totem", what: "Roll an extra die next turn", icon: "stone_totem" },
  { id: barItem("lightning"), name: "Lightning Strike", what: "The leader gives 10 coins to last place", icon: "lightning" },
  { id: barItem("glove"), name: "Dueling Glove", what: "A 1v1 duel for 10 coins", icon: "glove" },
];
const BACK: BarItem = { id: BACK_ITEM, name: "Back", what: "Use it: back to the hotbar", icon: "back" };
/** What the board hides: everything a survival player watches that Block Party has no use for, and vanilla's hotbar (the pack draws its own). */
const HIDDEN_HUD = [HudElement.Hotbar, HudElement.Health, HudElement.Hunger, HudElement.ProgressBar, HudElement.Armor, HudElement.AirBubbles];
/** Ticks between sends of each player's bar (the action bar fades unless it's sent again). */
const BAR_RESEND = 20;

type Bar = "main" | "items" | "dice";

// ---- Jumps and arenas ----------------------------------------------------------------------

type JumpMode = "free" | "lateral" | "movement" | "nojump" | "camera";
const JUMP_MODES: readonly { id: JumpMode; label: string }[] = [
  { id: "free", label: "Nothing locked" },
  { id: "lateral", label: "Can't walk (lateral movement off)" },
  { id: "movement", label: "Can't move (movement off)" },
  { id: "nojump", label: "Movement and jump off" },
  { id: "camera", label: "Can't walk, scripted camera on" },
];

/** Where arenas are placed: far east of the board, their middle at x and z, their floor from y. */
const ARENA_AT: Vec3 = [2000, 0, 0];
const ARENA_AREA = "minecade:blockparty_arena";
const BOARD_AREA = "minecade:blockparty_board";
/** Ticks of black before the loading screen starts fading in over it. */
const LOADING_AFTER = 4;
/** Blocks placed a millisecond, about (docs/spike-results.md, "Block Party": Sinkhole's 667,648 in 608 to 676 ms). */
const BLOCKS_PER_MS = 1000;
/** Ticks the slow-load test keeps the loading screen up longer. */
const SLOW_LOAD = 80;
/**
 * Ticks the loading screen stays up after the move, while players' clients load the chunks around
 * their new place (the user saw it fade away before the arena showed).
 */
const CLIENT_LOAD = 40;

interface PlayerTests {
  settings: PieceSettings;
  jumpMode: JumpMode;
  reportJumps: boolean;
  bar: Bar;
  /** Special dice held besides the standard die (0 to 2) and items held (0 to 3): "Hotbar contents". */
  specialDice: number;
  items: number;
  /** The slot selected last tick, to tell which way a scroll went. */
  lastSlot: number;
  /** The action bar line last sent, and when: the bar's codes, sent again when they change or every BAR_RESEND ticks. */
  sentLine?: string;
  sentAt?: number;
  /** The open dice bar: the die floating over the player's head. */
  rolling?: { at: Vector3; placed: boolean; shown?: string };
}

export class BlockPartySpike extends Minigame<Config> {
  private spaces: Space[] = [];
  private pieces!: Pieces;
  private npcs!: Npcs;
  private shots!: Shots;
  private readonly tests = new Map<string, PlayerTests>();
  private arena: { id: string; min: Vector3; size: Vector3 } | undefined;
  /** Whether the test board's blocks are down: nobody is put on it before. */
  private boardReady = false;
  private slowLoads = false;
  /** Whether the board is the map's own spaces (else the test board is laid beside Probe's platform). */
  private ownBoard = false;
  /** The board's middle: the test board's, or the middle of the map's spaces. */
  private boardMiddle: Vec3 = [0, 64, 0];
  /** The tick each player last used a hotbar item: a click on a block and in the air both report. */
  private readonly lastUse = new Map<string, number>();
  /** The loading screen's strength for everyone (0 off, up to LOADING_LEVELS). */
  private loadingLevel = 0;
  /** The board loop (board-loop.ts), and the standings top left. */
  private loop!: BoardLoop;
  private notes!: Notes;
  /** The rolls the loop is waiting for, by lowercased name: what a jump resolves, and whether everyone watches. */
  private readonly pendingRolls = new Map<string, { resolve: (value: number | undefined) => void; shot: boolean }>();
  /** The board's blocks are down (play waits for it). */
  private boardLaid: Promise<void> = Promise.resolve();

  constructor(ctx: GameContext, gameConfig: Config) {
    super(ctx, gameConfig);
  }

  private testsOf(player: Player): PlayerTests {
    const key = player.name.toLowerCase();
    let tests = this.tests.get(key);
    if (!tests) {
      tests = { settings: { ...DEFAULT_SETTINGS, speed: this.config.board.speed }, jumpMode: "free", reportJumps: true, bar: "main", specialDice: 2, items: 3, lastSlot: 0 };
      this.tests.set(key, tests);
    }
    return tests;
  }

  private get middle(): Vec3 {
    return this.boardMiddle;
  }

  /** A test's result: in the player's chat, and in the server's log. */
  private tell(player: Player, text: string): void {
    if (player.isValid) player.sendMessage(say.info(text));
    log.info(`blockparty test: to ${player.isValid ? player.name : "?"}: ${text}`);
  }

  private everyone(text: string): void {
    this.broadcast(say.info(text));
    log.info(`blockparty test: ${text}`);
  }

  protected override setup(): void {
    const own = spacesOf(this.map.config);
    this.ownBoard = own.length > 0;
    this.spaces = this.ownBoard ? mapSpaces(own) : testSpaces(this.config.board.at, this.config.board.spacing);
    if (this.ownBoard) {
      const xs = this.spaces.map((space) => space.at[0]);
      const zs = this.spaces.map((space) => space.at[2]);
      this.boardMiddle = [(Math.min(...xs) + Math.max(...xs)) / 2, this.spaces[0].at[1], (Math.min(...zs) + Math.max(...zs)) / 2];
    } else this.boardMiddle = this.config.board.at;
    const box = boardBox(this.spaces);
    const arenaBox = { min: [ARENA_AT[0] - 100, -64, ARENA_AT[2] - 100] as Vec3, max: [ARENA_AT[0] + 100, 319, ARENA_AT[2] + 100] as Vec3 };
    this.map.extendBounds([box, arenaBox]);
    const watchers = () => world.getAllPlayers();
    this.pieces = new Pieces(this.scope, {
      spaces: () => this.spaces,
      settings: (player) => this.testsOf(player).settings,
      watchers,
      overview: () => [this.middle[0], this.middle[1] + 18, this.middle[2] - 22],
      report: (player, text) => this.tell(player, text),
    });
    this.npcs = new Npcs(this.scope);
    this.shots = new Shots(this.scope, {
      watchers,
      middle: () => this.middle,
      pieceOf: (player) => player,
      chris: () => this.npcs.get("chris"),
      say: (text) => this.everyone(text),
    });
    this.notes = new Notes(this.scope);
    const length = Number(this.ctx.vars.settings.length);
    this.loop = new BoardLoop({
      scope: this.scope,
      spaces: () => this.spaces,
      pieces: this.pieces,
      turns: (LENGTHS as readonly number[]).includes(length) ? length : LENGTHS[0],
      roll: (player, shot) =>
        new Promise((resolve) => {
          const key = player.name.toLowerCase();
          this.pendingRolls.get(key)?.resolve(undefined);
          this.pendingRolls.set(key, { resolve, shot });
          this.openDice(player);
        }),
      everyone: (text) => this.everyone(text),
      tell: (player, text) => this.tell(player, text),
      title: (text, subtitle) => {
        for (const player of world.getAllPlayers()) player.onScreenDisplay.setTitle(text, { subtitle: subtitle ?? "", fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 10 });
      },
      changed: () => this.loopChanged(),
      random: () => this.ctx.random(),
    });
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => this.used(source, itemStack.typeId));
    this.scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player, itemStack }) => {
      if (itemStack) this.used(player, itemStack.typeId);
    });
    this.scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const role = this.npcs.roleOf(hitEntity);
      if (role) void this.npcs.menu(damagingEntity as Player, hitEntity, role, (text) => this.everyone(text));
    });
    this.scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => this.jumped(player),
      { buttons: [InputButton.Jump], state: ButtonState.Pressed },
    );
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.pendingRolls.get(playerName.toLowerCase())?.resolve(undefined);
      this.pendingRolls.delete(playerName.toLowerCase());
      const tests = this.tests.get(playerName.toLowerCase());
      if (tests?.rolling?.placed) this.clearDie(tests.rolling.at);
      this.tests.delete(playerName.toLowerCase());
      this.pieces.forget(playerName);
    });
    this.scope.interval(() => this.keepHotbars(), 1);
    this.scope.add(() => this.cleanUp());
  }

  protected override onStart(): void {
    this.boardLaid = this.layBoard();
  }

  /** The board loop (board-loop.ts), once the board is down; the Tests stay in the hotbar beside it. */
  protected override async play(): Promise<Result | void> {
    await this.boardLaid;
    if (!this.boardReady) return draw("the board couldn't be laid");
    return this.loop.run();
  }

  /** The loop's state changed: everyone's HUD line, and the standings top left. */
  private loopChanged(): void {
    for (const player of world.getAllPlayers()) {
      const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (container) this.sendLine(player, this.testsOf(player), container, true);
    }
    this.notes.show(this.loop.standings());
  }

  protected override onSpawn(player: Player, _why: SpawnReason): void {
    const tests = this.testsOf(player);
    tests.bar = "main";
    this.giveBar(player);
    try {
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HIDDEN_HUD);
    } catch (error) {
      this.tell(player, `Hiding the health, hunger and XP bars failed: ${describeError(error)}`);
    }
    if (this.boardReady) system.runTimeout(() => player.isValid && this.pieces.place(player), 10);
  }

  private async layBoard(): Promise<void> {
    const box = boardBox(this.spaces);
    const dimension = world.getDimension("overworld");
    try {
      await world.tickingAreaManager.createTickingArea(BOARD_AREA, { dimension, from: { x: box.min[0], y: box.min[1], z: box.min[2] }, to: { x: box.max[0], y: box.max[1], z: box.max[2] } });
      // A map's own board keeps its paths; only the spaces' blocks are laid.
      build(dimension, this.spaces, !this.ownBoard);
      if (!this.ownBoard) {
        // A plaza in the middle for the NPCs.
        const [mx, my, mz] = this.middle;
        dimension.fillBlocks(new BlockVolume({ x: Math.floor(mx) - 6, y: my - 1, z: Math.floor(mz) - 6 }, { x: Math.floor(mx) + 6, y: my - 1, z: Math.floor(mz) + 6 }), "minecraft:smooth_stone");
      }
    } catch (error) {
      log.warn(`blockparty: laying the test board failed: ${describeError(error)}`);
      this.everyone(`Laying the test board failed: ${describeError(error)}`);
      return;
    }
    this.boardReady = true;
    for (const player of world.getAllPlayers()) this.pieces.place(player);
    this.everyone(this.ownBoard ? "Block Party on this map's own board. Tests (the compass) has the spike's tests; hit an NPC for its menu." : "Block Party on the test board. Tests (the compass) has the spike's tests; hit an NPC for its menu.");
  }

  // ---- The hotbar -------------------------------------------------------------------------

  /** What a bar holds, left to right. */
  private barItems(player: Player): readonly BarItem[] {
    const tests = this.testsOf(player);
    if (tests.bar === "items") return [...ITEMS.slice(0, tests.items), BACK];
    if (tests.bar === "dice") return [...DICE.slice(0, 1 + tests.specialDice), BACK];
    return MAIN_BAR;
  }

  /**
   * Puts the player's bar in their hotbar, in the rightmost slots (the bar sits bottom right): the
   * pack hides the empty ones, so only these show, against the screen's edge. The first is selected.
   */
  private giveBar(player: Player): void {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;
    const items = this.barItems(player);
    const first = HOTBAR_SIZE - items.length;
    for (let slot = 0; slot < HOTBAR_SIZE; slot++) container.setItem(slot, undefined);
    items.forEach(({ id, name, what }, i) => {
      const item = new ItemStack(id, 1);
      item.nameTag = name;
      item.setLore([what]);
      item.lockMode = ItemLockMode.slot;
      item.keepOnDeath = true;
      container.setItem(first + i, item);
    });
    try {
      player.selectedSlotIndex = first;
    } catch {
      // gone
    }
    this.testsOf(player).lastSlot = first;
  }

  private openBar(player: Player, bar: Bar): void {
    this.testsOf(player).bar = bar;
    this.giveBar(player);
  }

  /** The selected item's id, if any. */
  private selected(player: Player): string | undefined {
    return player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex)?.typeId;
  }

  /**
   * Every tick: a selection that lands on an empty (hidden) slot moves on to the next slot in use,
   * the way the scroll went, wrapping round, so scrolling only ever stops on what shows; and the die
   * over a rolling player's head follows the die they pick.
   */
  private keepHotbars(): void {
    for (const player of world.getAllPlayers()) {
      const tests = this.tests.get(player.name.toLowerCase());
      const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (!tests || !container) continue;
      let slot = player.selectedSlotIndex;
      if (!container.getItem(slot)) {
        const step = slot > tests.lastSlot || (tests.lastSlot === HOTBAR_SIZE - 1 && slot === 0) ? 1 : -1;
        for (let i = 1; i < HOTBAR_SIZE; i++) {
          const next = (((slot + step * i) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
          if (container.getItem(next)) {
            slot = next;
            player.selectedSlotIndex = next;
            break;
          }
        }
      }
      tests.lastSlot = slot;
      this.sendLine(player, tests, container);
      if (tests.rolling?.placed) {
        const die = DICE.find((d) => d.id === container.getItem(slot)?.typeId);
        if (die && tests.rolling.shown !== die.block) {
          player.dimension.getBlock(tests.rolling.at)?.setType(die.block);
          tests.rolling.shown = die.block;
        }
      }
    }
  }

  /**
   * The player's action bar: the core's HUD mark, then their bar's codes (each slot in use, its
   * icon, the selected one) and the loading screen's level, when it's up. Sent when it changes, and
   * every BAR_RESEND ticks so it doesn't fade.
   */
  private sendLine(player: Player, tests: PlayerTests, container: Container, force = false): void {
    const slots: { slot: number; icon: BarIcon }[] = [];
    const icons = new Map([...MAIN_BAR, ...DICE, ...ITEMS, BACK].map((item) => [item.id, item.icon]));
    for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
      const icon = icons.get(container.getItem(slot)?.typeId ?? "");
      if (icon) slots.push({ slot, icon });
    }
    const line = hudLine(undefined, this.loop?.hudText(player) ?? "", undefined, "", barCodes(slots, player.selectedSlotIndex) + loadingCode(this.loadingLevel));
    if (!force && line === tests.sentLine && system.currentTick - (tests.sentAt ?? 0) < BAR_RESEND) return;
    tests.sentLine = line;
    tests.sentAt = system.currentTick;
    player.onScreenDisplay.setActionBar(line);
  }

  /** A hotbar item was used (right click, or a tap on a touch screen). */
  private used(player: Player, typeId: string): void {
    const key = player.name.toLowerCase();
    const last = this.lastUse.get(key) ?? -10;
    if (system.currentTick - last < 4) return;
    this.lastUse.set(key, system.currentTick);
    const tests = this.testsOf(player);
    if (typeId === MENU_ITEM) void this.menu(player);
    else if (typeId === ITEMS_ITEM) this.openBar(player, "items");
    else if (typeId === DICE_ITEM) {
      if (this.pendingRolls.has(key)) this.openDice(player);
      else this.tell(player, this.loop.active ? "Wait for your turn: your dice open when it comes." : "Your dice open when the game asks for a roll.");
    }
    else if (typeId === BACK_ITEM) {
      if (tests.rolling) this.endRoll(player);
      this.openBar(player, "main");
    } else {
      const item = ITEMS.find((i) => i.id === typeId);
      if (item && tests.bar === "items") this.tell(player, `Used ${item.name} (a test: nothing happens yet).`);
    }
  }

  private async contentsForm(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    const form = new ModalFormData()
      .title("Hotbar contents")
      .slider("Special dice (besides the standard die)", 0, 2, { valueStep: 1, defaultValue: tests.specialDice })
      .slider("Items", 0, 3, { valueStep: 1, defaultValue: tests.items });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    tests.specialDice = values[0] as number;
    tests.items = values[1] as number;
    this.giveBar(player);
    this.tell(player, `Hotbar: the standard die and ${tests.specialDice} special, ${tests.items} items. Use Items or Dice to see them.`);
  }

  // ---- Rolling ----------------------------------------------------------------------------

  /** The dice bar: the picked die floats over your head, a low camera looks up at it, and a jump hits it. */
  private openDice(player: Player): void {
    const tests = this.testsOf(player);
    if (tests.rolling || this.pieces.isWalking(player)) return;
    this.openBar(player, "dice");
    const at = player.location;
    const die = { x: Math.floor(at.x), y: Math.floor(at.y) + 3, z: Math.floor(at.z) };
    const block = player.dimension.getBlock(die);
    const placed = block?.isAir === true;
    if (placed) block?.setType(DICE[0].block);
    tests.rolling = { at: die, placed, shown: placed ? DICE[0].block : undefined };
    lock(player);
    // The roll camera: everyone watches a turn's roll; each player their own while everyone rolls for turn order.
    const yaw = (player.getRotation().y * Math.PI) / 180;
    const watchers = this.pendingRolls.get(player.name.toLowerCase())?.shot === false ? [player] : world.getAllPlayers();
    for (const watcher of watchers) {
      watcher.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 3.5, y: at.y + 0.5, z: at.z + Math.cos(yaw) * 3.5 }, facingLocation: { x: die.x + 0.5, y: die.y, z: die.z + 0.5 } });
    }
    this.tell(player, "Pick a die in the hotbar, then jump to hit it.");
  }

  /** Takes the die away and gives everyone their own view back (the roll is over or called off). */
  private endRoll(player: Player): void {
    const tests = this.testsOf(player);
    if (tests.rolling?.placed) this.clearDie(tests.rolling.at);
    tests.rolling = undefined;
    for (const watcher of world.getAllPlayers()) watcher.camera.clear();
    unlock(player);
  }

  private clearDie(at: Vector3): void {
    try {
      const block = world.getDimension("overworld").getBlock(at);
      if (block && DICE.some((d) => d.block === block.typeId)) block.setType("minecraft:air");
    } catch {
      // unloaded
    }
  }

  private async roll(player: Player): Promise<void> {
    const die = DICE.find((d) => d.id === this.selected(player));
    if (!die) {
      this.tell(player, "Pick a die in the hotbar, then jump.");
      return;
    }
    const tests = this.testsOf(player);
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    const rolled = die.faces[Math.floor(this.ctx.random() * die.faces.length)];
    const rolling = tests.rolling;
    tests.rolling = undefined;
    this.pendingRolls.delete(key);
    const watchers = pending?.shot === false ? [player] : world.getAllPlayers();
    for (const watcher of watchers) watcher.onScreenDisplay.setTitle(`${rolled}`, { subtitle: `${player.name}, ${die.name}`, fadeInDuration: 2, stayDuration: 25, fadeOutDuration: 8 });
    await this.scope.wait(12);
    if (rolling?.placed) this.clearDie(rolling.at);
    await this.scope.wait(8);
    for (const watcher of watchers) watcher.camera.clear();
    unlock(player);
    this.openBar(player, "main");
    pending?.resolve(rolled);
  }

  // ---- The menu ---------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const items: [string, () => void | Promise<void>][] = [
      ["Piece settings", () => this.settingsForm(player)],
      ["Camera shots", () => this.shotsMenu(player)],
      ["Jump test", () => this.jumpMenu(player)],
      ["Hotbar contents", () => this.contentsForm(player)],
      [this.npcs.spawned ? "Take the NPCs away" : "Put the NPCs out", () => this.toggleNpcs()],
      ["Arenas from other maps", () => this.arenaMenu(player)],
      ["Ride and lead (two players)", () => this.rideMenu(player)],
      ["End the test game", () => this.finish(draw("ended from the Tests menu"))],
    ];
    const form = new ActionFormData().title("Block Party tests");
    for (const [label] of items) form.button(label);
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    try {
      await items[response.selection][1]();
    } catch (error) {
      this.tell(player, `That test failed: ${describeError(error)}`);
    }
  }

  private async settingsForm(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    const s = tests.settings;
    const form = new ModalFormData()
      .title("Piece settings")
      .dropdown("Camera while walking", WALK_CAMERAS.map((c) => c.label), { defaultValueIndex: WALK_CAMERAS.findIndex((c) => c.id === s.camera) })
      .slider("Speed (blocks a second)", 2, 16, { valueStep: 1, defaultValue: s.speed });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [camera, speed] = values as [number, number];
    tests.settings = { camera: WALK_CAMERAS[camera].id, speed };
    this.pieces.refresh(player);
    this.tell(player, `Piece: camera ${WALK_CAMERAS[camera].id}, ${speed} blocks a second.`);
  }

  private async shotsMenu(player: Player): Promise<void> {
    const form = new ActionFormData().title("Camera shots").body("Everyone sees the shot. Everyone jumping skips it.");
    for (const shot of SHOTS) form.button(shot.label);
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    const id: ShotId = SHOTS[response.selection].id;
    if (id === "clear") this.shots.stop();
    else void this.shots.play(id, player);
  }

  private toggleNpcs(): void {
    if (this.npcs.spawned) {
      this.npcs.clear();
      this.everyone("NPCs taken away.");
      return;
    }
    const failed = this.npcs.spawn(world.getDimension("overworld"), this.middle);
    this.everyone(failed.length === 0 ? "NPCs out in the middle of the board. Hit one for its animations and variants." : `Some NPCs failed: ${failed.join("; ")}`);
  }

  // ---- Jumps ------------------------------------------------------------------------------

  private jumped(player: Player): void {
    const tests = this.testsOf(player);
    if (tests.rolling) {
      void this.roll(player);
      return;
    }
    if (this.shots.vote(player)) return;
    if (!tests.reportJumps) return;
    const startY = player.location.y;
    const camera = tests.jumpMode === "camera" ? "scripted" : "own";
    const state = `test: ${JUMP_MODES.find((m) => m.id === tests.jumpMode)?.label}; walking: ${this.pieces.isWalking(player) ? "yes" : "no"}; camera: ${camera}`;
    system.runTimeout(() => {
      if (!player.isValid) return;
      const rose = player.location.y - startY;
      this.tell(player, `Jump seen (${state}). ${rose > 0.3 ? `You rose ${rose.toFixed(2)} blocks.` : "You stayed down."}`);
    }, 6);
  }

  private async jumpMenu(player: Player): Promise<void> {
    const tests = this.testsOf(player);
    const form = new ActionFormData().title("Jump test").body(`Now: ${JUMP_MODES.find((m) => m.id === tests.jumpMode)?.label}. Pick one, then jump.`);
    for (const mode of JUMP_MODES) form.button(mode.label);
    form.button(tests.reportJumps ? "Stop reporting jumps" : "Report every jump");
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    if (response.selection === JUMP_MODES.length) {
      tests.reportJumps = !tests.reportJumps;
      return;
    }
    this.setJumpMode(player, JUMP_MODES[response.selection].id);
  }

  private setJumpMode(player: Player, mode: JumpMode): void {
    const tests = this.testsOf(player);
    unlock(player);
    player.camera.clear();
    tests.jumpMode = mode;
    const perms = player.inputPermissions;
    if (mode === "lateral" || mode === "camera") perms.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    if (mode === "movement" || mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Movement, false);
    if (mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Jump, false);
    if (mode === "camera") {
      const at = player.location;
      const yaw = (player.getRotation().y * Math.PI) / 180;
      player.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 4, y: at.y + 1.8, z: at.z + Math.cos(yaw) * 4 }, facingLocation: { x: at.x, y: at.y + 1, z: at.z } });
    }
    this.tell(player, `Jump test: ${JUMP_MODES.find((m) => m.id === mode)?.label}. Jump, and the chat says what came through. Pick Nothing locked to go back.`);
  }

  // ---- Arenas -----------------------------------------------------------------------------

  /** The arenas installed as structures (minecade:arena_<game>_<map>), from the games' own published maps. */
  private installedArenas(): { id: string; label: string }[] {
    const found: { id: string; label: string }[] = [];
    for (const game of registry.games) {
      for (const map of game.maps) {
        if (map.owner) continue;
        const id = `minecade:arena_${game.id}_${map.id}`;
        if (world.structureManager.get(id)) found.push({ id, label: `${game.name}: ${map.name}` });
      }
    }
    return found;
  }

  private async arenaMenu(player: Player): Promise<void> {
    const arenas = this.installedArenas();
    const form = new ActionFormData().title("Arenas from other maps");
    form.body(arenas.length > 0 ? "Placed far east of the board, a fresh copy each time, behind a fade both ways." : "None installed: run spike/blockparty/arena-pack.ts, then Start the network again.");
    const actions: (() => void | Promise<void>)[] = [];
    for (const arena of arenas) {
      form.button(arena.label);
      actions.push(() => this.placeArena(arena.id));
    }
    if (this.arena) {
      form.button("Place it again (fresh)");
      actions.push(() => this.placeArena(this.arena!.id));
      form.button("Back to the board");
      actions.push(() => this.backToBoard());
    }
    form.button(this.slowLoads ? "Slow loads: on (4 s more, to see the loading screen)" : "Slow loads: off");
    actions.push(() => {
      this.slowLoads = !this.slowLoads;
      this.tell(player, `Slow loads ${this.slowLoads ? "on: every move between the board and an arena takes 4 s longer, so the loading screen shows" : "off"}.`);
    });
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    await actions[response.selection]?.();
  }

  /**
   * A move behind the loading screen, for everyone: the screen fades to black (a camera fade), the
   * loading screen fades in over the black a level a tick (the HUD draws over a camera fade: the
   * user saw it pop in), the work is done (a long placement stalls the server, the screen holding),
   * it holds CLIENT_LOAD ticks more while clients load the new place's chunks, then a second black
   * comes up under it, the loading screen fades out to that black, and the black fades away on the
   * new place. Each fade holds only as long as it's needed: a fade started while another holds
   * doesn't cut that one short (a 10 s hold kept players in black after the loading screen went).
   */
  private async behindBlack(work: () => void | Promise<void>): Promise<void> {
    const black = { red: 0, green: 0, blue: 0 };
    const fade = (fadeInTime: number, holdTime: number, fadeOutTime: number) => {
      for (const player of world.getAllPlayers()) player.camera.fade({ fadeTime: { fadeInTime, holdTime, fadeOutTime }, fadeColor: black });
    };
    // Black, held until the loading screen is fully up over it, then gone behind it.
    fade(0.4, 0.4 + (LOADING_AFTER + LOADING_LEVELS + 4) / 20, 0.2);
    await this.scope.wait(8 + LOADING_AFTER);
    try {
      for (let level = 1; level <= LOADING_LEVELS; level++) await this.loadingAt(level);
      // The level is sent: the stall can't hide it.
      await this.scope.wait(2);
      if (this.slowLoads) await this.scope.wait(SLOW_LOAD);
      await work();
      await this.scope.wait(CLIENT_LOAD);
    } finally {
      // Black again behind the loading screen, held while it fades out to it, then gone on the new place.
      fade(0.2, (LOADING_LEVELS + 6) / 20, 0.6);
      await this.scope.wait(5);
      for (let level = LOADING_LEVELS - 1; level >= 0; level--) await this.loadingAt(level);
    }
  }

  /** The loading screen at `level` for everyone, then a tick's wait. */
  private async loadingAt(level: number): Promise<void> {
    this.loadingLevel = level;
    for (const player of world.getAllPlayers()) {
      const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
      if (container) this.sendLine(player, this.testsOf(player), container);
    }
    await this.scope.wait(1);
  }

  private async placeArena(id: string): Promise<void> {
    const structure = world.structureManager.get(id);
    if (!structure) return;
    const size = structure.size;
    const dimension = world.getDimension("overworld");
    // The map's arena slot when it has one (the board's arena background), else far east of the board.
    const slot = this.map.regions(ARENA_SLOT)[0];
    const middle = slot ? { x: Math.floor((slot.min[0] + slot.max[0] + 1) / 2), y: slot.min[1], z: Math.floor((slot.min[2] + slot.max[2] + 1) / 2) } : { x: ARENA_AT[0], y: ARENA_AT[1], z: ARENA_AT[2] };
    const min = { x: middle.x - Math.floor(size.x / 2), y: middle.y, z: middle.z - Math.floor(size.z / 2) };
    const max = { x: min.x + size.x - 1, y: min.y + size.y - 1, z: min.z + size.z - 1 };
    let report = "";
    await this.behindBlack(async () => {
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
      const loadStarted = system.currentTick;
      await manager.createTickingArea(ARENA_AREA, { dimension, from: min, to: max });
      const loadTicks = system.currentTick - loadStarted;
      const expected = (size.x * size.y * size.z) / BLOCKS_PER_MS;
      const started = Date.now();
      world.structureManager.place(id, dimension, min, { includeEntities: false });
      const ms = Date.now() - started;
      this.arena = { id, min, size };
      const spot = this.standingSpot(min, size);
      for (const player of world.getAllPlayers()) {
        this.pieces.release(player);
        player.teleport(spot);
      }
      report = `Placed ${id} (${size.x} x ${size.y} x ${size.z}) at ${min.x}, ${min.y}, ${min.z}${slot ? ` in the map's arena slot${size.x > 60 || size.z > 60 ? " (bigger than the slot)" : ""}` : ""}: its chunks loaded in ${loadTicks} ticks, the placing took ${ms} ms (about ${Math.round(expected)} expected).`;
    });
    this.everyone(`${report} Break something and Place it again: it comes back whole.`);
  }

  /** The highest spot near the arena's middle with a block underfoot and room to stand. */
  private standingSpot(min: Vector3, size: Vector3): Vector3 {
    const dimension = world.getDimension("overworld");
    const cx = min.x + Math.floor(size.x / 2);
    const cz = min.z + Math.floor(size.z / 2);
    for (let r = 0; r < Math.max(size.x, size.z) / 2; r += 2) {
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
        for (let y = min.y + size.y - 2; y > min.y; y--) {
          const at = { x: cx + dx, y, z: cz + dz };
          const below = dimension.getBlock({ ...at, y: y - 1 });
          if (below && !below.isAir && !below.isLiquid && dimension.getBlock(at)?.isAir && dimension.getBlock({ ...at, y: y + 1 })?.isAir) return { x: at.x + 0.5, y, z: at.z + 0.5 };
        }
      }
    }
    return { x: cx + 0.5, y: min.y + size.y + 1, z: cz + 0.5 };
  }

  private async backToBoard(): Promise<void> {
    await this.behindBlack(() => {
      for (const player of world.getAllPlayers()) this.pieces.place(player);
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    });
    this.everyone("Back on the board.");
  }

  // ---- Riding and leads -------------------------------------------------------------------

  private async rideMenu(player: Player): Promise<void> {
    const others = world.getAllPlayers().filter((other) => other.name !== player.name);
    const form = new ActionFormData().title("Ride and lead");
    const actions: (() => void)[] = [];
    if (others.length === 0) form.body("These need a second player.");
    for (const other of others) {
      form.button(`Ride ${other.name} (players pack)`);
      actions.push(() => this.ride(player, other));
      form.button(`Put me on ${other.name}'s lead (players pack)`);
      actions.push(() => this.lead(player, other));
    }
    form.button("Let go of everything");
    actions.push(() => this.letGo(player));
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    actions[response.selection]?.();
  }

  private ride(rider: Player, carrier: Player): void {
    this.pieces.release(rider);
    // Vanilla's players are rideable already, by tame parrots only (their shoulders); the players
    // pack lets players on too.
    const rideable = carrier.getComponent("minecraft:rideable");
    if (!rideable?.getFamilyTypes().includes("player")) {
      this.tell(rider, `${carrier.name} can't carry players (riders allowed: ${rideable?.getFamilyTypes().join(", ") ?? "none"}): the players pack (private_packs/players) isn't installed.`);
      return;
    }
    const ok = rideable.addRider(rider);
    this.everyone(ok ? `${rider.name} is riding ${carrier.name}. Sneak to get off, and try jumping too.` : `${rider.name} couldn't get on ${carrier.name} (addRider said no).`);
  }

  private lead(follower: Player, holder: Player): void {
    this.pieces.release(follower);
    const leashable = follower.getComponent("minecraft:leashable");
    if (!leashable) {
      this.tell(follower, "You have no leashable component: the players pack (private_packs/players) isn't installed.");
      return;
    }
    try {
      leashable.leashTo(holder);
      this.everyone(`${follower.name} is on ${holder.name}'s lead. Walk apart and see what pulls.`);
    } catch (error) {
      this.tell(follower, `leashTo failed: ${describeError(error)}`);
    }
  }

  private letGo(player: Player): void {
    try {
      player.getComponent("minecraft:riding")?.entityRidingOn?.getComponent("minecraft:rideable")?.ejectRider(player);
      for (const other of world.getAllPlayers()) other.getComponent("minecraft:rideable")?.ejectRider(player);
      const leashable = player.getComponent("minecraft:leashable");
      if (leashable?.isLeashed) leashable.unleash();
    } catch (error) {
      this.tell(player, `Letting go: ${describeError(error)}`);
    }
    this.pieces.place(player);
  }

  private cleanUp(): void {
    const manager = world.tickingAreaManager;
    for (const id of [ARENA_AREA, BOARD_AREA]) {
      try {
        if (manager.hasTickingArea(id)) manager.removeTickingArea(id);
      } catch {
        // gone with the server
      }
    }
    for (const tests of this.tests.values()) if (tests.rolling?.placed) this.clearDie(tests.rolling.at);
    for (const player of world.getAllPlayers()) {
      unlock(player);
      try {
        player.camera.clear();
        player.onScreenDisplay.setHudVisibility(HudVisibility.Reset, HIDDEN_HUD);
      } catch {
        // gone
      }
    }
  }
}

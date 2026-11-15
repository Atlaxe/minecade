// Block Party's spike (docs/plans/block-party.md, "Suggested order" 1), played as a test game on
// Probe's map. It lays a 12-space test board beside the platform, makes each player their own piece
// on it, and gives them the game's hotbar (a stand-in for it) with a Tests menu. The menu tries what
// the game will need:
//   - walking a piece (pieces.ts: the player pushed along the path; each walk says in chat how it
//     went), watched by everyone through the chase or watch camera, with a name label over each;
//   - camera shots (shots.ts), skipped by everyone jumping (a vote);
//   - the jump button: every jump is reported in chat with what was locked at the time;
//   - the hotbar (resource_pack/ui/hud_screen.json restyles vanilla's): Items, Dice and Tests in the
//     middle slots, only the slots in use showing. Using Items or Dice swaps the bar for that set
//     (the items held, or the dice, each with a Back slot); in the dice, the die picked floats over
//     your head and a jump hits it, and your piece walks the number. Health, hunger and the XP bar
//     are hidden;
//   - the NPCs on the vanilla mobs' models (npcs.ts): hit one for its animations and variants;
//   - arenas from other maps (spike/blockparty/arena-pack.ts installs them as structures in
//     private_packs/arenas/): placed far east of the board, fresh each time, behind a fade both ways,
//     with Minecade's logo on the black once it lasts;
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
  type Player,
  type Vector3,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Minigame, describeError, draw, log, say, showForm, type GameContext, type Result, type SpawnReason } from "@minecade/minigame-core";
import registry from "#registry";
import type config from "../../game.config.ts";
import { boardBox, build, testSpaces, type Space, type Vec3 } from "./board.ts";
import { Npcs } from "./npcs.ts";
import { DEFAULT_SETTINGS, Pieces, WALK_CAMERAS, lock, unlock, type PieceSettings } from "./pieces.ts";
import { SHOTS, Shots, type ShotId } from "./shots.ts";

type Config = typeof config;

// ---- The hotbar ----------------------------------------------------------------------------
// Stand-ins for the game's own items: vanilla items with a name and a line saying what they do.

interface BarItem {
  id: string;
  name: string;
  what: string;
}
interface Die extends BarItem {
  faces: readonly number[];
}

const MENU_ITEM = "minecraft:compass";
const ITEMS_ITEM = "minecraft:book";
const DICE_ITEM = "minecraft:quartz";
const BACK_ITEM = "minecraft:arrow";

const MAIN_BAR: readonly BarItem[] = [
  { id: ITEMS_ITEM, name: "Items", what: "Use it: your items" },
  { id: DICE_ITEM, name: "Dice", what: "Use it: pick a die, then jump to roll" },
  { id: MENU_ITEM, name: "Tests", what: "Every Block Party test" },
];
const DICE: readonly Die[] = [
  { id: "minecraft:white_concrete", name: "Die", what: "Jump to hit it: 1 to 6", faces: [1, 2, 3, 4, 5, 6] },
  { id: "minecraft:light_blue_concrete", name: "Slow Die", what: "Jump to hit it: 1 to 3", faces: [1, 2, 3] },
  { id: "minecraft:gold_block", name: "Golden Die", what: "Jump to hit it: 5 to 10", faces: [5, 6, 7, 8, 9, 10] },
];
const ITEMS: readonly BarItem[] = [
  { id: "minecraft:totem_of_undying", name: "Stone Totem", what: "Roll an extra die next turn" },
  { id: "minecraft:blaze_rod", name: "Lightning Strike", what: "The leader gives 10 coins to last place" },
  { id: "minecraft:leather", name: "Dueling Glove", what: "A 1v1 duel for 10 coins" },
];
const BACK: BarItem = { id: BACK_ITEM, name: "Back", what: "Use it: back to the hotbar" };
const HOTBAR_SIZE = 9;
/** What the board hides: everything a survival player watches that Block Party has no use for. */
const HIDDEN_HUD = [HudElement.Health, HudElement.Hunger, HudElement.ProgressBar, HudElement.Armor, HudElement.AirBubbles];

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
/**
 * A title made of formatting codes that never render: the pack's ui/hud_screen.json shows
 * Minecade's logo inside the title while it's this, so the logo fades in and out with the title.
 */
const LOADING_MARK = "§r§m§l§r";
/** Ticks of black before the logo fades in. */
const LOGO_AFTER = 40;
/** A placement expected to stall the server longer than this (ms) shows the logo first: the server can't send it mid-stall. */
const LONG_STALL_MS = 1500;
/** Blocks placed a millisecond, about (docs/spike-results.md, "Block Party": Sinkhole's 667,648 in 608 to 676 ms). */
const BLOCKS_PER_MS = 1000;
/** Ticks the slow-load test keeps the screen black, so the logo shows. */
const SLOW_LOAD = 80;

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
  /** The tick each player last used a hotbar item: a click on a block and in the air both report. */
  private readonly lastUse = new Map<string, number>();

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
    return this.config.board.at;
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
    this.spaces = testSpaces(this.middle, this.config.board.spacing);
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
      const tests = this.tests.get(playerName.toLowerCase());
      if (tests?.rolling?.placed) this.clearDie(tests.rolling.at);
      this.tests.delete(playerName.toLowerCase());
      this.pieces.forget(playerName);
    });
    this.scope.interval(() => this.keepHotbars(), 1);
    this.scope.add(() => this.cleanUp());
  }

  protected override onStart(): void {
    void this.layBoard();
  }

  protected override async play(): Promise<Result | void> {
    await this.stage("Tests");
    return draw("the tests are over");
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
      build(dimension, this.spaces);
      // A plaza in the middle for the NPCs.
      const [mx, my, mz] = this.middle;
      dimension.fillBlocks(new BlockVolume({ x: Math.floor(mx) - 6, y: my - 1, z: Math.floor(mz) - 6 }, { x: Math.floor(mx) + 6, y: my - 1, z: Math.floor(mz) + 6 }), "minecraft:smooth_stone");
    } catch (error) {
      log.warn(`blockparty: laying the test board failed: ${describeError(error)}`);
      this.everyone(`Laying the test board failed: ${describeError(error)}`);
      return;
    }
    this.boardReady = true;
    for (const player of world.getAllPlayers()) this.pieces.place(player);
    this.everyone("Block Party spike: you're your piece on the test board. Use Dice to roll, Tests for every test, and hit an NPC for its menu. Every jump is reported in chat.");
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
   * Puts the player's bar in their hotbar, in the middle slots: the pack hides the empty ones, so
   * only these show, centered. The first slot is selected.
   */
  private giveBar(player: Player): void {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;
    const items = this.barItems(player);
    const first = Math.floor((HOTBAR_SIZE - items.length) / 2);
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
      if (tests.rolling?.placed) {
        const die = DICE.find((d) => d.id === container.getItem(slot)?.typeId);
        if (die && tests.rolling.shown !== die.id) {
          player.dimension.getBlock(tests.rolling.at)?.setType(die.id);
          tests.rolling.shown = die.id;
        }
      }
    }
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
    else if (typeId === DICE_ITEM) this.openDice(player);
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
    if (placed) block?.setType(DICE[0].id);
    tests.rolling = { at: die, placed, shown: placed ? DICE[0].id : undefined };
    lock(player);
    const yaw = (player.getRotation().y * Math.PI) / 180;
    for (const watcher of world.getAllPlayers()) {
      watcher.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 3.5, y: at.y + 0.5, z: at.z + Math.cos(yaw) * 3.5 }, facingLocation: { x: die.x + 0.5, y: die.y, z: die.z + 0.5 } });
    }
    this.everyone(`${player.name} is rolling: pick a die in the hotbar, then jump to hit it.`);
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
      if (block && DICE.some((d) => d.id === block.typeId)) block.setType("minecraft:air");
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
    const rolled = die.faces[Math.floor(Math.random() * die.faces.length)];
    const rolling = tests.rolling;
    tests.rolling = undefined;
    for (const watcher of world.getAllPlayers()) watcher.onScreenDisplay.setTitle(`${rolled}`, { subtitle: `${player.name}, ${die.name}`, fadeInDuration: 2, stayDuration: 25, fadeOutDuration: 8 });
    await this.scope.wait(12);
    if (rolling?.placed) this.clearDie(rolling.at);
    await this.scope.wait(8);
    for (const watcher of world.getAllPlayers()) watcher.camera.clear();
    this.openBar(player, "main");
    await this.pieces.walk(player, rolled);
  }

  // ---- The menu ---------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const items: [string, () => void | Promise<void>][] = [
      ["Roll: the dice bar", () => this.openDice(player)],
      ["Walk 1 space", () => this.pieces.walk(player, 1)],
      ["Walk 6 spaces", () => this.pieces.walk(player, 6)],
      ["Piece settings", () => this.settingsForm(player)],
      ["Camera shots", () => this.shotsMenu(player)],
      ["Jump test", () => this.jumpMenu(player)],
      ["Hotbar contents", () => this.contentsForm(player)],
      [this.npcs.spawned ? "Take the NPCs away" : "Put the NPCs out", () => this.toggleNpcs()],
      ["Arenas from other maps", () => this.arenaMenu(player)],
      ["Ride and lead (two players)", () => this.rideMenu(player)],
      ["Back to Start", () => this.pieces.reset(player)],
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
      .slider("Speed (blocks a second)", 2, 16, { valueStep: 1, defaultValue: s.speed })
      .slider("Turn over (ticks; 1 is a snap at the corner)", 1, 8, { valueStep: 1, defaultValue: s.turnTicks })
      .toggle("A name label over the piece", { defaultValue: s.label })
      .slider("The label's height over your feet (tenths of a block)", 5, 30, { valueStep: 1, defaultValue: Math.round(s.labelHeight * 10) })
      .toggle("Hide my own name tag", { defaultValue: s.hideTag });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [camera, speed, turnTicks, label, labelHeight, hideTag] = values as [number, number, number, boolean, number, boolean];
    tests.settings = { camera: WALK_CAMERAS[camera].id, speed, turnTicks, label, labelHeight: labelHeight / 10, hideTag };
    this.pieces.refresh(player);
    this.tell(player, `Piece: camera ${WALK_CAMERAS[camera].id}, ${speed} blocks a second, turns over ${turnTicks} ticks, label ${label ? `at ${(labelHeight / 10).toFixed(1)}` : "off"}, own tag ${hideTag ? "hidden" : "shown"}.`);
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
    form.button(this.slowLoads ? "Slow loads: on (4 s of black, to see the logo)" : "Slow loads: off");
    actions.push(() => {
      this.slowLoads = !this.slowLoads;
      this.tell(player, `Slow loads ${this.slowLoads ? "on: every move between the board and an arena keeps the screen black 4 s longer, so the logo shows" : "off"}.`);
    });
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    await actions[response.selection]?.();
  }

  /**
   * A move behind black, for everyone: fade out, do the work, fade back in. Once the black has
   * lasted LOGO_AFTER ticks, Minecade's logo fades in on it; `work` calls `expectStall` before
   * anything that stalls the server long (the logo can't be sent during the stall), which shows it
   * at once. The fade's hold is the longest a fade allows (10 s); the fade back in replaces it.
   */
  private async behindBlack(work: (expectStall: (ms: number) => void) => void | Promise<void>): Promise<void> {
    const black = { red: 0, green: 0, blue: 0 };
    for (const player of world.getAllPlayers()) player.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 10, fadeOutTime: 0.6 }, fadeColor: black });
    await this.scope.wait(9);
    let done = false;
    let logo = false;
    const showLogo = () => {
      if (logo || done) return;
      logo = true;
      for (const player of world.getAllPlayers()) player.onScreenDisplay.setTitle(LOADING_MARK, { fadeInDuration: 15, stayDuration: 20 * 30, fadeOutDuration: 8 });
    };
    this.scope.timeout(showLogo, LOGO_AFTER);
    try {
      if (this.slowLoads) await this.scope.wait(SLOW_LOAD);
      await work((ms) => {
        if (ms > LONG_STALL_MS) showLogo();
      });
    } finally {
      done = true;
      for (const player of world.getAllPlayers()) {
        if (logo) player.onScreenDisplay.setTitle(LOADING_MARK, { fadeInDuration: 0, stayDuration: 0, fadeOutDuration: 8 });
        player.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: logo ? 0.4 : 0.1, fadeOutTime: 0.6 }, fadeColor: black });
      }
    }
  }

  private async placeArena(id: string): Promise<void> {
    const structure = world.structureManager.get(id);
    if (!structure) return;
    const size = structure.size;
    const dimension = world.getDimension("overworld");
    const min = { x: ARENA_AT[0] - Math.floor(size.x / 2), y: ARENA_AT[1], z: ARENA_AT[2] - Math.floor(size.z / 2) };
    const max = { x: min.x + size.x - 1, y: min.y + size.y - 1, z: min.z + size.z - 1 };
    let report = "";
    await this.behindBlack(async (expectStall) => {
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
      const loadStarted = system.currentTick;
      await manager.createTickingArea(ARENA_AREA, { dimension, from: min, to: max });
      const loadTicks = system.currentTick - loadStarted;
      const expected = (size.x * size.y * size.z) / BLOCKS_PER_MS;
      expectStall(expected);
      const started = Date.now();
      world.structureManager.place(id, dimension, min, { includeEntities: false });
      const ms = Date.now() - started;
      this.arena = { id, min, size };
      const spot = this.standingSpot(min, size);
      for (const player of world.getAllPlayers()) {
        this.pieces.release(player);
        player.teleport(spot);
      }
      report = `Placed ${id} (${size.x} x ${size.y} x ${size.z}) at ${min.x}, ${min.y}, ${min.z}: its chunks loaded in ${loadTicks} ticks, the placing took ${ms} ms (about ${Math.round(expected)} expected).`;
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

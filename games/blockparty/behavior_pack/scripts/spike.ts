// Block Party's spike (docs/plans/block-party.md, "Suggested order" 1), played as a test game on
// Probe's map. It lays a 12-space test board beside the platform, makes each player their own piece
// on it, with a Tests menu (/blockparty:tests). The menu tries what the game will need:
//   - walking a piece (pieces.ts: the player pushed along the path, easing into corners; each walk
//     says in chat how it went), watched by everyone through the chase or watch camera;
//   - camera shots (shots.ts), skipped by everyone jumping (a vote);
//   - the jump button: every jump is reported in chat with what was locked at the time;
//   - the board's screens (block-party-ui.md), the same for everyone, on the game's sidebar
//     (sidebar-rows.ts): the player cards top right, and on a turn the board menu top left (Dice
//     block, Items, Board) and the item panel bottom left (board-ui.ts), steered with the movement
//     keys, jump to pick, sneak to go back; the die shown floats over the roller's head and a jump
//     hits it, and the piece walks the number. The results screen after every minigame and Star
//     (results.ts). Nothing is in a player's hands on the board: vanilla's hotbar shows only while a
//     minigame plays (the user's call). Health, hunger and the XP bar are hidden;
//   - the board's camera (board-camera.ts): the board view on the player whose turn it is, fixed or
//     turning by the map's settings, following their walk; the turn shot zoomed in on them while
//     their menu is up; the NPCs' shots and Board's view take it and give it back; into a minigame
//     it rises from the board and eases down into the arena;
//   - nobody walks the board by themselves (the user's call): the movement keys move a player only
//     off the board (a minigame, a ride) and on the pre-game podium until they roll (keepControls);
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
  BlockVolume,
  system,
  world,
  type Dimension,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ARENA_SLOT, Minigame, describeError, draw, facingOf, hudLine, log, say, showForm, spacesOf, worldPoint, type GameContext, type MapPosition, type Result, type SpawnReason } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";
import registry from "#registry";
import skins from "#skins";
import { HOTBAR_SIZE, LOADING_LEVELS, loadingCode } from "./bar-codes.ts";
import type config from "../../game.config.ts";
import { boardBox, build, mapSpaces, standAt, testSpaces, type Space, type Vec3 } from "./board.ts";
import { BoardLoop } from "./board-loop.ts";
import { BoardCamera, autoDirection, cameraSettings, type BoardCameraSettings } from "./board-camera.ts";
import { BoardMenu } from "./board-ui.ts";
import { boardOverview } from "./board-view.ts";
import { DICE, DICE_PROBLEMS, STANDARD, STANDARD_DIE, modelIndex, rollDie, throwsText, type DieDef, type RollOutcome } from "./dice.ts";
import { ITEMS, type ItemDef } from "./dice-items.ts";
import { ITEM_PROBLEMS } from "./items.ts";
import { CURSED_DIE } from "./item-play.ts";
import { CHANCE, HAPPENING, WARDEN, type ChanceId, type HappeningId, type WardenId } from "./space-rules.ts";
import { Zombies } from "./zombies.ts";
import { ResultsScreen } from "./results.ts";
import { SCREEN_WORDS, cardRows, codesOf } from "./screen-codes.ts";
import { GameSidebar } from "./sidebar-rows.ts";
import { Heads } from "./heads.ts";
import { Dialogue } from "./dialogue.ts";
import { TurnFade } from "./fade.ts";
import { Stage, type StageMarkup } from "./stage.ts";
import type { Marker } from "./stage-layout.ts";
import { STAGE_POINTS, chrisKey } from "./stage-markup.ts";
import { line } from "./lines.ts";
import { BOT_COUNTS, LENGTHS, START_COINS } from "./board-rules.ts";
import { Bots, hop, isPlayer, thinkTicks, whoOf, type Who } from "./bots.ts";
import { fits, type Format } from "./minigame-rules.ts";
import { MinigameRunner, type ArenaPlace } from "./minigame-runner.ts";
import { MINIGAMES } from "./minigames/index.ts";
import { TITLE, type TitleTiming } from "./minigames/kit.ts";
import { Npcs } from "./npcs.ts";
import { DEFAULT_SETTINGS, Pieces, WALK_CAMERAS, hold, lock, resendLocks, unlock, type PieceSettings } from "./pieces.ts";
import { SHOTS, Shots, type ShotId } from "./shots.ts";

type Config = typeof config;

// ---- Dice and items ------------------------------------------------------------------------

/**
 * A die over the roller's head while the item panel shows it: its model (DIE_ENTITY, a die with a
 * texture in the dice file, its texture picked by DIE_PROPERTY: dice.ts, modelIndex), or else its
 * block (the dice file's stand-in) in the block `at`.
 */
interface DieShown {
  at: Vector3;
  model?: Entity;
  block?: string;
}
const DIE_ENTITY = "blockparty:die";
const DIE_PROPERTY = "blockparty:die";

/** What Block Party hides: everything a survival player watches that it has no use for, and the hotbar with its item names (MINIGAME_HUD). */
const HIDDEN_HUD = [HudElement.Hotbar, HudElement.ItemText, HudElement.Health, HudElement.Hunger, HudElement.ProgressBar, HudElement.Armor, HudElement.AirBubbles];
/** What comes back while a player plays a minigame: vanilla's hotbar (the user: only in minigames, never on the board or in cutscenes). */
const MINIGAME_HUD = [HudElement.Hotbar, HudElement.ItemText];
/** Ticks between sends of each player's HUD line (the action bar fades unless it's sent again). */
const BAR_RESEND = 20;

/**
 * What a player's keys may do now (keepControls): walk ("free": off the board, or on the pre-game
 * podium before their roll); only look round, a jump and sneak being the game's buttons ("held": the
 * board); not even look round ("turn": their turn, facing the turn shot, the user's call; "locked":
 * their piece walking); or that with a real jump ("rolling": their die out, the jump hits it).
 */
type Controls = "free" | "held" | "turn" | "locked" | "rolling";
/**
 * Ticks after a player is back on the board from a minigame when their locks are sent again
 * (resendLocks in pieces.ts): the client can miss the ones sent while it loads after the long teleport.
 */
const LOCKS_RESEND = [5, 20, 40];

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
/** Starting coins while Block Party is a test game or a server plays it alone. */
const TEST_COINS = 30;
/** Seats at a Block Party game. */
const SEATS = 4;
/** Ticks after the players have moved before the bots are made again beside them (their screens are there by then). */
const BOTS_AFTER = 10;
/** Ticks a bot thinks before a choice. */
const BOT_CHOICE: [number, number] = [20, 40];

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
  /** The action bar line last sent, and when: sent again when it changes or every BAR_RESEND ticks. */
  sentLine?: string;
  sentAt?: number;
  /** Their die out: which die it is, the block over their head it floats in, and what shows there. */
  rolling?: { die: DieDef; at: Vector3; over?: DieShown };
  /** What their keys were last set to do, and whether vanilla's hotbar was last shown (undefined: set them again). */
  controls?: Controls;
  hotbar?: boolean;
  /** Ticks at which their locks are sent again (LOCKS_RESEND), soonest first. */
  resendAt?: number[];
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
  /** The loading screen's strength for everyone (0 off, up to LOADING_LEVELS). */
  private loadingLevel = 0;
  /** The board loop (board-loop.ts). */
  private loop!: BoardLoop;
  /** The game's one sidebar (the dialogue box and the board's screens), the board menu and item panel, the results screen. */
  private gameSidebar!: GameSidebar;
  private boardMenu!: BoardMenu;
  private results!: ResultsScreen;
  /** The cards' rows last put on the sidebar, so they're sent only when they change. */
  private cardsShown = "";
  /** The board's own camera (board-camera.ts), and the way a fixed one looks when the map doesn't say. */
  private boardCamera!: BoardCamera;
  private autoYaw: number | undefined;
  /** The rolls the loop is waiting for, by lowercased name: what a jump resolves, and whether everyone watches. */
  private readonly pendingRolls = new Map<string, { resolve: (value: RollOutcome | undefined) => void; shot: boolean }>();
  /** The board's blocks are down (play waits for it). */
  private boardLaid: Promise<void> = Promise.resolve();
  /** The bots in a game one player started (bots.ts), and the minigames' runner. */
  private bots!: Bots;
  /** The heads on the cards and the results: players' faces from the build, Steve's for bots. */
  private readonly heads = new Heads(skins);
  private runner!: MinigameRunner;
  /** The dialogue box (dialogue.ts) and the stage: the NPCs and the shots (stage.ts). */
  private dialogue!: Dialogue;
  private staging!: Stage;
  /** The minigame's line top right while one is on (it takes the board's place). */
  private minigameStatus: string | undefined;
  /** Players put on the pre-game podium who haven't rolled for turn order yet (by key): they may walk. */
  private readonly podium = new Set<string>();
  /** On a turn, everyone else fades away (fade.ts). */
  private fade!: TurnFade;
  /** The zombies that follow seats (zombies.ts: the Zombie Spawn, the Warden's curse, Chance's outbreak). */
  private zombies!: Zombies;

  constructor(ctx: GameContext, gameConfig: Config) {
    super(ctx, gameConfig);
  }

  private testsOf(player: Player): PlayerTests {
    const key = player.name.toLowerCase();
    let tests = this.tests.get(key);
    if (!tests) {
      tests = { settings: { ...DEFAULT_SETTINGS, speed: this.config.board.speed }, jumpMode: "free", reportJumps: true };
      this.tests.set(key, tests);
    }
    return tests;
  }

  private get middle(): Vec3 {
    return this.boardMiddle;
  }

  /** A test's result: in the player's chat, and in the server's log. Nothing for an empty text (a line the user hasn't written). */
  private tell(player: Player, text: string): void {
    if (text === "") return;
    if (player.isValid) player.sendMessage(say.info(text));
    log.info(`blockparty test: to ${player.isValid ? player.name : "?"}: ${text}`);
  }

  /**
   * The party leader (the user, 2026-11-18): the player who started the game from the lobby (the
   * lobby's `leader` setting). While they're away, the first player the lobby sent who's here, else
   * the first player here. Only they move the dialogue box on.
   */
  private leader(): Player | undefined {
    const players = world.getAllPlayers();
    const named = (name: string | undefined) => (name ? players.find((player) => player.name.toLowerCase() === name.toLowerCase()) : undefined);
    return named(this.ctx.vars.settings.leader) ?? this.ctx.vars.expectedPlayers.map(named).find((player) => player !== undefined) ?? players[0];
  }

  private everyone(text: string): void {
    if (text === "") return;
    this.broadcast(say.info(text));
    log.info(`blockparty test: ${text}`);
  }

  protected override setup(): void {
    for (const problem of DICE_PROBLEMS) log.warn(`blockparty: dice.json: ${problem}`);
    for (const problem of ITEM_PROBLEMS) log.warn(`blockparty: items.json: ${problem}`);
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
      // A bot's walk is watched through the first player's camera setting.
      settings: (body) => {
        const settings = isPlayer(body) ? this.testsOf(body).settings : (world.getAllPlayers().map((player) => this.testsOf(player).settings)[0] ?? { ...DEFAULT_SETTINGS, speed: this.config.board.speed });
        // The board's camera follows a walk in the board game (the Tests' walk cameras only before it).
        return this.boardCamera?.active ? { ...settings, camera: "none" } : settings;
      },
      watchers,
      overview: () => [this.middle[0], this.middle[1] + 18, this.middle[2] - 22],
      report: (body, text) => isPlayer(body) && this.tell(body, text),
    });
    const dimension = world.getDimension("overworld");
    this.bots = new Bots(this.scope, dimension);
    this.runner = new MinigameRunner({
      scope: this.scope,
      dimension,
      arenaPlace: () => this.arenaPlace(),
      arenaMaps: (id) => this.ctx.vars.arenas[id] ?? [],
      behindBlack: (work) => this.behindBlack(work),
      leaveBoard: (who) => this.leaveBoard(who),
      backToBoard: (who) => this.backOnBoard(who),
      respawnBot: (who, at, yaw) => this.bots.respawn(who, at, yaw),
      title: (text, subtitle, timing) => this.titleAll(text, subtitle, timing),
      titleTo: (player, text, subtitle, timing) => this.titleTo(player, text, subtitle, timing),
      say: (text) => this.everyone(text),
      random: () => this.ctx.random(),
      status: (text) => (this.minigameStatus = text),
      zoomOut: (seconds) => this.boardCamera.zoomOut(seconds),
    });
    this.npcs = new Npcs(this.scope);
    this.shots = new Shots(this.scope, {
      watchers,
      middle: () => this.middle,
      pieceOf: (player) => player,
      chris: () => this.npcs.get("chris"),
      say: (text) => this.everyone(text),
    });
    this.gameSidebar = new GameSidebar(this.scope);
    this.fade = new TurnFade(this.scope, () => system.currentTick);
    this.zombies = new Zombies({
      scope: this.scope,
      dimension,
      bodyOf: (key) => this.bodyOf(key),
      offBoard: (key) => {
        const body = this.bodyOf(key);
        return !body || this.pieces.isOff(body);
      },
      fade: this.fade,
    });
    this.dialogue = new Dialogue({ scope: this.scope, random: () => this.ctx.random(), show: (box) => this.gameSidebar.set("dialogue", box), leader: () => this.leader() });
    this.boardMenu = new BoardMenu({
      scope: this.scope,
      sidebar: this.gameSidebar,
      random: () => this.ctx.random(),
      holdingsOf: (who) => this.loop.holdingsOf(who),
      showDie: (who, die) => {
        if (who.player) this.showDie(who.player, die);
      },
      roll: (who, die) => {
        if (who.player) void this.rollOrGive(who, die);
      },
      use: (who, item) => {
        if (who.player) void this.useItem(who, item);
      },
      boardView: (on) => this.boardView(on),
      busy: (player) => this.dialogue.steerer === player.name.toLowerCase(),
    });
    this.results = new ResultsScreen({ scope: this.scope, sidebar: this.gameSidebar, headOf: (name) => this.headOf(name) });
    this.staging = new Stage({
      scope: this.scope,
      dimension,
      dialogue: this.dialogue,
      spaces: () => this.spaces,
      markup: () => this.stageMarkup(),
      put: (who, at, yaw) => this.putSeat(who, at, yaw),
      // Bots a moment after the players, as everywhere a body goes a long way with them (bots.ts).
      toStart: (who) => (who.player ? this.backOnBoard(who) : this.scope.timeout(() => this.backOnBoard(who), BOTS_AFTER)),
      cameraTaken: () => this.boardCamera?.take(),
      cameraBack: () => this.boardCamera?.giveBack() ?? false,
    });
    const length = Number(this.ctx.vars.settings.length);
    this.loop = new BoardLoop({
      scope: this.scope,
      spaces: () => this.spaces,
      pieces: this.pieces,
      turns: (LENGTHS as readonly number[]).includes(length) ? length : LENGTHS[0],
      // 30 coins while Block Party is a test game or a server plays it alone (the user asked), so Stars can be tried.
      startCoins: this.config.test || this.ctx.vars.devMinPlayers === 1 ? TEST_COINS : START_COINS,
      present: () => [...world.getAllPlayers().map(whoOf), ...this.bots.all()],
      leader: () => this.leader()?.name.toLowerCase(),
      // A turn's roll opens the board menu (everyone watching); the turn order's roll (each their own) goes straight to the standard die.
      roll: (who, shot) => {
        const player = who.player;
        // A turn: the turn shot zooms in on them while their menu is up, and they turn to face it,
        // their keys locked first so they keep facing it (the user: nobody moves round on their turn).
        if (shot && player) this.keepControls(player, this.testsOf(player));
        if (shot) this.boardCamera.turnShot(who.body);
        if (!player) return shot ? this.boardMenu.botTurn(who).then((die) => this.botRoll(who, shot, die)) : this.botRoll(who, shot, STANDARD);
        return new Promise((resolve) => {
          const key = player.name.toLowerCase();
          this.pendingRolls.get(key)?.resolve(undefined);
          this.pendingRolls.set(key, { resolve, shot });
          if (shot) this.boardMenu.open(who);
          else this.showDie(player, STANDARD);
        });
      },
      choose: (who, title, body, options, botPick) => this.choose(who, title, body, options, botPick),
      say: (id, fills, skippable, by) => this.dialogue.say(id, fills, skippable, by),
      talk: (id, fills, options) => this.dialogue.talk(id, fills, options),
      cutscene: (skippable, work) => this.dialogue.cutscene(skippable, work),
      stage: this.staging,
      minigames: MINIGAMES,
      playMinigame: (format, def, sides, pool, onlookers, settle) => this.runner.play(format, def, sides, pool, onlookers, settle),
      everyone: (text) => this.everyone(text),
      tell: (who, text) => who.player && this.tell(who.player, text),
      title: (text, subtitle) => this.titleAll(text, subtitle),
      changed: () => this.loopChanged(),
      results: (before, after) => this.results.show(before, after),
      zombies: this.zombies,
      random: () => this.ctx.random(),
    });
    this.boardCamera = new BoardCamera({
      scope: this.scope,
      watchers: () => world.getAllPlayers(),
      settings: () => this.cameraSettingsNow(),
      // The board game's own camera from its first round, except while a minigame has the players.
      engaged: () => this.loop.active && this.loop.rounds.now >= 1 && !this.runner.active,
      focus: () => this.bodyOf(this.loop.focus),
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
    // Sneak is the dialogue box's back button (Not now), else the board menu's back.
    this.scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => void (this.dialogue.sneaked(player) || this.boardMenu.sneaked(player)),
      { buttons: [InputButton.Sneak], state: ButtonState.Pressed },
    );
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      if (this.boardMenu.active === playerName.toLowerCase()) this.boardMenu.close();
      this.pendingRolls.get(playerName.toLowerCase())?.resolve(undefined);
      this.pendingRolls.delete(playerName.toLowerCase());
      const tests = this.tests.get(playerName.toLowerCase());
      this.takeDie(tests?.rolling?.over);
      this.tests.delete(playerName.toLowerCase());
      this.pieces.forget(playerName);
    });
    this.scope.interval(() => this.keepPlayers(), 1);
    this.scope.add(() => this.cleanUp());
  }

  /** The Tests menu (/blockparty:tests, main.ts; the compass in the bar too). */
  openTests(player: Player): void {
    void this.menu(player);
  }

  /**
   * /minigame win (main.ts): ends the minigame on now with `typed` (a player or bot in it) winning,
   * only while testing: Block Party a test game, DEV_MIN_PLAYERS at 1, or a preview from the map
   * editor. Says what went wrong, or undefined once it's done.
   */
  winMinigame(typed: string): string | undefined {
    const { devMinPlayers, preview } = this.ctx.vars;
    if (!this.config.test && devMinPlayers !== 1 && preview === "") return "/minigame win is only for testing: a test game, DEV_MIN_PLAYERS at 1, or a preview from the map editor.";
    if (!this.runner) return "Block Party isn't running yet.";
    return this.runner.win(typed);
  }

  protected override onStart(): void {
    this.boardLaid = this.layBoard();
  }

  /** The board loop (board-loop.ts), once the board is down; the Tests stay in the hotbar beside it. */
  protected override async play(): Promise<Result | void> {
    await this.boardLaid;
    if (!this.boardReady) return draw("the board couldn't be laid");
    this.seatBots();
    return this.loop.run();
  }

  /** A game one player started gets bots in the empty seats, as many as the lobby's Bots option says. */
  private seatBots(): void {
    const players = world.getAllPlayers().length;
    const asked = Number(this.ctx.vars.settings.bots ?? BOT_COUNTS[0]);
    const wanted = Math.min(SEATS - players, Number.isInteger(asked) && asked >= 0 ? asked : BOT_COUNTS[0]);
    if (players !== 1 || wanted <= 0) return;
    const [x, y, z] = standAt(this.spaces[0], 0);
    for (const bot of this.bots.add(wanted, { x, y, z })) this.pieces.place(bot.body);
    const joined = { count: wanted, players: this.bots.all().map((bot) => bot.name).join(", ") };
    this.everyone(wanted === 1 ? line("bots.join.one", joined) : line("bots.join.many", joined));
  }

  /** A choice: a player's form, or a bot's moment of thought and its pick. */
  private async choose(who: Who, title: string, body: string, options: readonly string[], botPick: number): Promise<number | undefined> {
    const player = who.player;
    if (!player) {
      await this.scope.wait(thinkTicks(() => this.ctx.random(), ...BOT_CHOICE));
      return botPick;
    }
    const form = new ActionFormData().title(title);
    if (body) form.body(body);
    for (const option of options) form.button(option);
    return (await showForm(this.scope, player, form))?.selection;
  }

  /** A big line on everyone's screen. */
  private titleAll(text: string, subtitle?: string, timing: TitleTiming = TITLE.show): void {
    for (const player of world.getAllPlayers()) this.titleTo(player, text, subtitle ?? "", timing);
  }

  /**
   * A big line on one player's screen. Nothing when both are empty (lines the user hasn't written);
   * a subtitle alone gets a blank title, since Bedrock shows a subtitle only with one.
   */
  private titleTo(player: Player, text: string, subtitle: string, timing: TitleTiming = TITLE.show): void {
    if (text === "" && subtitle === "") return;
    try {
      player.onScreenDisplay.setTitle(text === "" ? " " : text, { subtitle, fadeInDuration: timing.fadeIn, stayDuration: timing.stay, fadeOutDuration: timing.fadeOut });
    } catch {
      // gone
    }
  }

  /** Off the board for a minigame: a player gets their movement back (the minigame has the hotbar). */
  private leaveBoard(who: Who): void {
    this.pieces.release(who.body);
  }

  /** A seat back on its space: a player put there with empty hands (whatever a minigame gave them goes), a bot made again there (bots.ts, respawn). */
  private backOnBoard(who: Who): void {
    if (who.player) {
      if (!who.player.isValid) return;
      this.pieces.place(who.player);
      this.podium.delete(who.key);
      this.testsOf(who.player).resendAt = LOCKS_RESEND.map((after) => system.currentTick + after);
      const container = who.player.getComponent(EntityComponentTypes.Inventory)?.container;
      for (let slot = 0; container && slot < HOTBAR_SIZE; slot++) container.setItem(slot, undefined);
      return;
    }
    this.bots.respawn(who, this.pieces.spotOf(who.name));
    if (who.body.isValid) this.pieces.place(who.body);
  }

  /**
   * A seat put somewhere off its space (the pre-game podium) facing `yaw`: a player at once, free to
   * walk there until they roll for turn order (the user's call), a bot made again there a moment later.
   */
  private putSeat(who: Who, at: Vec3, yaw: number): void {
    const spot = { x: at[0], y: at[1], z: at[2] };
    if (who.player) {
      this.podium.add(who.key);
      try {
        if (who.player.isValid) who.player.teleport(spot, { rotation: { x: 0, y: yaw } });
      } catch {
        // gone
      }
      return;
    }
    this.scope.timeout(() => this.bots.respawn(who, spot, yaw), BOTS_AFTER);
  }

  /** The map's stage markup (stage-markup.ts): its pre-game podium, Chris's pre-game spot, the podium camera and the intro, each marker with its facing. */
  private stageMarkup(): StageMarkup {
    const marker = (position: MapPosition): Marker => {
      const at = worldPoint(position);
      const facing = facingOf(position);
      return { at: [at.x, at.y, at.z], ...(facing ? { yaw: facing.yaw, pitch: facing.pitch } : {}) };
    };
    return {
      lineup: this.map.points(STAGE_POINTS.podium).map(marker),
      chris: this.map.points(chrisKey("pregame")).map(marker)[0],
      podiumCamera: this.map.points(STAGE_POINTS.podiumCamera).map(marker)[0],
      intro: this.map.points(STAGE_POINTS.intro).map(marker),
    };
  }

  /** Where an arena goes: the middle of the map's arena slot's floor (and the slot's size across), else far east of the board. */
  private arenaPlace(): ArenaPlace {
    const slot = this.map.regions(ARENA_SLOT)[0];
    if (!slot) return { middle: { x: ARENA_AT[0], y: ARENA_AT[1], z: ARENA_AT[2] } };
    return {
      middle: { x: (slot.min[0] + slot.max[0] + 1) / 2, y: slot.min[1], z: (slot.min[2] + slot.max[2] + 1) / 2 },
      slot: [slot.max[0] - slot.min[0] + 1, slot.max[2] - slot.min[2] + 1],
    };
  }

  /** A bot's roll: the die over its head (everyone watching through the turn shot on a turn), a moment's thought, a hop, the number. */
  private async botRoll(who: Who, shot: boolean, picked: DieDef): Promise<RollOutcome | undefined> {
    const body = who.body;
    if (!body.isValid) return undefined;
    const over = this.putDie(body.dimension, overHead(body.location), picked);
    const watchers = shot ? world.getAllPlayers() : [];
    await this.scope.wait(thinkTicks(() => this.ctx.random(), 25, 45));
    if (!body.isValid) {
      this.takeDie(over);
      return undefined;
    }
    hop(body);
    await this.scope.wait(5);
    const rolled = rollDie(picked, () => this.ctx.random());
    for (const watcher of watchers) this.rollTitle(watcher, who.name, rolled);
    await this.scope.wait(12);
    this.takeDie(over);
    await this.scope.wait(8);
    // Out to the board view for the walk.
    if (shot) this.boardCamera.boardShot();
    return rolled;
  }

  /** A roll's number big on `watcher`'s screen, whose roll and which die under it (and each throw: "3 + 5 + 2"). */
  private rollTitle(watcher: Player, name: string, rolled: RollOutcome): void {
    const throws = throwsText(rolled);
    watcher.onScreenDisplay.setTitle(`${rolled.move}`, { subtitle: `${name}, ${rolled.die.name}${throws ? `: ${throws}` : ""}`, fadeInDuration: 2, stayDuration: 25, fadeOutDuration: 8 });
  }

  /** Puts `die` over the block `at` (the roller's head): its model if it has a texture, else its block if the place is empty. */
  private putDie(dimension: Dimension, at: Vector3, die: DieDef): DieShown | undefined {
    try {
      const index = modelIndex(die);
      if (index !== undefined) {
        const model = dimension.spawnEntity(DIE_ENTITY, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 });
        model.setProperty(DIE_PROPERTY, index);
        return { at, model };
      }
      const block = dimension.getBlock(at);
      if (block?.isAir !== true) return undefined;
      block.setType(die.block);
      return { at, block: block.typeId };
    } catch (error) {
      log.warn(`blockparty: showing the ${die.name} failed: ${describeError(error)}`);
      return undefined;
    }
  }

  /** Takes a die from over a head: its model, or its block. */
  private takeDie(shown: DieShown | undefined): void {
    if (!shown) return;
    try {
      if (shown.model?.isValid) shown.model.remove();
      if (shown.block) {
        const block = world.getDimension("overworld").getBlock(shown.at);
        if (block?.typeId === shown.block) block.setType("minecraft:air");
      }
    } catch {
      // unloaded, or gone
    }
  }

  /** The loop's state changed: everyone's HUD line, and the cards. */
  private loopChanged(): void {
    for (const player of world.getAllPlayers()) this.sendLine(player, this.testsOf(player), true);
    this.drawCards();
  }

  /** The board camera's settings: the map's (Game settings), a fixed one looking across the board's longer way unless the map says. */
  private cameraSettingsNow(): BoardCameraSettings {
    const settings = cameraSettings((key) => this.mapSetting(key));
    if (settings.direction !== undefined) return settings;
    this.autoYaw ??= autoDirection(this.spaces);
    return { ...settings, direction: this.autoYaw };
  }

  /** A seat's body by key: the player, or the bot. */
  private bodyOf(key: string | undefined): Entity | undefined {
    if (!key) return undefined;
    return world.getAllPlayers().find((player) => player.name.toLowerCase() === key) ?? this.bots.all().find((who) => who.key === key)?.body;
  }

  /**
   * The player cards top right (block-party-ui.md, "Player cards"), from the loop's seats in turn
   * order: on the board and the podium, never during a minigame or the results screen. Sent when
   * they change.
   */
  private drawCards(): void {
    const seats = this.loop?.cards() ?? [];
    const hidden = seats.length === 0 || this.runner.active || this.results.showing;
    const rows = hidden
      ? []
      : cardRows(
          seats.map((seat) => {
            return { ...seat, items: this.loop.itemLetters(seat.key), head: this.headOf(seat.name) };
          }),
        );
    const key = rows.join("\n");
    if (key === this.cardsShown) return;
    this.cardsShown = key;
    this.gameSidebar.set("cards", rows.length ? { title: codesOf(SCREEN_WORDS.cards), rows } : undefined);
  }

  /** A seat's head picture by name: a bot's is Steve's, unless a player here has that name. */
  private headOf(name: string): string | undefined {
    const lower = name.toLowerCase();
    const bot = this.bots.has(name) && !world.getAllPlayers().some((player) => player.name.toLowerCase() === lower);
    return this.heads.of(name, bot);
  }

  protected override onSpawn(player: Player, _why: SpawnReason): void {
    const tests = this.testsOf(player);
    // Their keys and HUD are set again on the next tick (keepPlayers), and whether they're faded.
    tests.controls = undefined;
    tests.hotbar = undefined;
    this.fade?.reset(player);
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
    this.everyone(`Block Party on ${this.ownBoard ? "this map's own board" : "the test board"}. /blockparty:tests has the spike's tests; hit an NPC for its menu.`);
  }

  // ---- Each tick ---------------------------------------------------------------------------

  /** Every tick, for each player: what their keys may do and whether vanilla's hotbar shows (keepControls), and their HUD line; and the cards and the turn fade. */
  private keepPlayers(): void {
    for (const player of world.getAllPlayers()) {
      const tests = this.tests.get(player.name.toLowerCase());
      if (!tests) continue;
      this.keepControls(player, tests);
      this.sendLine(player, tests);
    }
    this.drawCards();
    this.keepFade();
  }

  /**
   * The turn fade (fade.ts): on someone's turn everyone else here fades away, players and bots, with
   * whatever follows them; nobody while there's no turn (the pre-game, the turn order roll, between
   * rounds) or while a minigame has the players (a Versus duel too).
   */
  private keepFade(): void {
    if (!this.loop?.active) return;
    const turn = this.runner.active ? undefined : this.loop.whoseTurn;
    this.fade.update([...world.getAllPlayers().map(whoOf), ...this.bots.all()], turn, this.loop.featured);
  }

  /**
   * What the player's keys may do (Controls), set when it changes: walking only off the board (a
   * minigame, where its runner also stops everything till Go, or a ride) and on the pre-game podium
   * until their roll, unless Chris is asking them something (the movement keys steer the box's
   * buttons); nothing at all on their turn (they face the turn shot) or while their piece walks, but
   * a real jump while their die is out; else only looking round, a jump and sneak being buttons. Back
   * from a minigame the locks go out again a few times (LOCKS_RESEND). A jump test's lock stands in
   * until it's set back to Nothing locked.
   * And vanilla's hotbar, shown only while they play a minigame.
   */
  private keepControls(player: Player, tests: PlayerTests): void {
    const key = player.name.toLowerCase();
    const hotbar = this.runner.isPlaying(key);
    if (tests.hotbar !== hotbar) {
      tests.hotbar = hotbar;
      try {
        player.onScreenDisplay.setHudVisibility(hotbar ? HudVisibility.Reset : HudVisibility.Hide, MINIGAME_HUD);
      } catch {
        // gone
      }
    }
    if (tests.jumpMode !== "free") return;
    let controls: Controls = "held";
    if (tests.rolling) controls = "rolling";
    else if (this.pieces.isWalking(player)) controls = "locked";
    else if (this.pieces.isOff(player) || (this.podium.has(key) && this.dialogue.steerer !== key)) controls = "free";
    else if (this.loop?.whoseTurn === key) controls = "turn";
    const due = tests.resendAt?.[0];
    const resend = due !== undefined && system.currentTick >= due;
    if (resend) tests.resendAt?.shift();
    if (tests.controls === controls && !resend) return;
    tests.controls = controls;
    if (resend) resendLocks(player);
    if (controls === "locked" || controls === "turn") lock(player);
    else if (controls === "rolling") lock(player, true);
    else if (controls === "held") hold(player);
    else {
      // Not Movement: a minigame's runner holds everyone still with it till Go.
      try {
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, true);
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, true);
      } catch {
        // gone
      }
    }
  }

  /**
   * The player's action bar: the core's HUD mark, the line top right (the minigame's or the board's)
   * and the loading screen's level, when it's up. Sent when it changes, and every BAR_RESEND ticks so
   * it doesn't fade.
   */
  private sendLine(player: Player, tests: PlayerTests, force = false): void {
    const status = this.minigameStatus ?? this.loop?.hudText(player) ?? "";
    const line = hudLine(undefined, status, undefined, "", loadingCode(this.loadingLevel));
    if (!force && line === tests.sentLine && system.currentTick - (tests.sentAt ?? 0) < BAR_RESEND) return;
    tests.sentLine = line;
    tests.sentAt = system.currentTick;
    player.onScreenDisplay.setActionBar(line);
  }

  /** Dice and items held (Tests): sets what your seat holds, any two of the dice file's special dice and any three items. */
  private async contentsForm(player: Player): Promise<void> {
    const key = player.name.toLowerCase();
    const seat = this.loop.seatOf(key);
    if (!seat) return this.tell(player, "Dice and items held works once you're seated in the board game.");
    const special = Object.values(DICE).filter((die) => die.id !== STANDARD_DIE);
    const items = Object.values(ITEMS);
    const dieAt = (slot: number) => Math.max(0, special.findIndex((die) => die.id === seat.hands.dice[slot]) + 1);
    const itemAt = (slot: number) => Math.max(0, items.findIndex((item) => item.id === seat.hands.items[slot]) + 1);
    const dieNames = ["None", ...special.map((die) => die.name)];
    const itemNames = ["None", ...items.map((item) => item.name)];
    const form = new ModalFormData()
      .title("Dice and items held")
      .dropdown("Special die 1", dieNames, { defaultValueIndex: dieAt(0) })
      .dropdown("Special die 2", dieNames, { defaultValueIndex: dieAt(1) })
      .dropdown("Item 1", itemNames, { defaultValueIndex: itemAt(0) })
      .dropdown("Item 2", itemNames, { defaultValueIndex: itemAt(1) })
      .dropdown("Item 3", itemNames, { defaultValueIndex: itemAt(2) });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const picked = <T>(list: readonly T[], slots: readonly unknown[]) => slots.flatMap((index) => (typeof index === "number" && index > 0 && list[index - 1] ? [list[index - 1]] : []));
    const dice = picked(special, [values[0], values[1]]);
    const held = picked(items, [values[2], values[3], values[4]]);
    this.loop.setHands(
      key,
      dice.map((die) => die.id),
      held.map((item) => item.id),
    );
    this.boardMenu.refresh();
    this.drawCards();
    this.tell(player, `You hold ${[STANDARD.name, ...dice.map((die) => die.name)].join(", ")}, and ${held.length > 0 ? held.map((item) => item.name).join(", ") : "no items"}. On your turn the board menu's Dice block and Items show them.`);
  }

  /** Next space outcomes (Tests): what the next Chance Time (all three potions), Warden and Happening do, to try each without luck. */
  private async outcomeForm(player: Player): Promise<void> {
    const forced = this.loop.spacePlay.forced;
    const chance = Object.keys(CHANCE) as ChanceId[];
    const warden = Object.keys(WARDEN) as WardenId[];
    const happening = Object.keys(HAPPENING) as HappeningId[];
    const at = <T>(list: readonly T[], value: T | undefined) => (value === undefined ? 0 : list.indexOf(value) + 1);
    const form = new ModalFormData()
      .title("Next space outcomes")
      .dropdown("Chance Time (all three potions)", ["At random", ...chance.map((id) => CHANCE[id].name)], { defaultValueIndex: at(chance, forced.chance) })
      .dropdown("Warden", ["At random", ...warden.map((id) => WARDEN[id].name)], { defaultValueIndex: at(warden, forced.warden) })
      .dropdown("Happening", ["At random", ...happening.map((id) => HAPPENING[id].name)], { defaultValueIndex: at(happening, forced.happening) });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [c, w, h] = values as [number, number, number];
    forced.chance = c > 0 ? chance[c - 1] : undefined;
    forced.warden = w > 0 ? warden[w - 1] : undefined;
    forced.happening = h > 0 ? happening[h - 1] : undefined;
    const said = [forced.chance && `Chance Time: ${CHANCE[forced.chance].name}`, forced.warden && `Warden: ${WARDEN[forced.warden].name}`, forced.happening && `Happening: ${HAPPENING[forced.happening].name}`].filter(Boolean);
    this.tell(player, said.length > 0 ? `Next time each comes up: ${said.join("; ")}. Go to a space gets you there.` : "Every space outcome is at random again.");
  }

  /** Bring the Wandering Trader (Tests): he comes now to a random Item space, for the rest of this round. */
  private async traderTest(player: Player): Promise<void> {
    if (!this.loop.active || this.loop.rounds.now < 1) return this.tell(player, "The Wandering Trader comes once the rounds have started.");
    if (this.loop.spacePlay.traderSpace !== undefined) return this.tell(player, "The Wandering Trader is on the board already (the green beam).");
    const came = await this.loop.spacePlay.traderArrives();
    this.tell(player, came ? "The Wandering Trader is here till the round ends: pass or land on his space (the green beam) to trade." : "He can't come: this board has no Item space without a Star on it.");
  }

  // ---- Rolling ----------------------------------------------------------------------------

  /**
   * The die the item panel shows floats over the player's head (`die`), a low camera looks up at it,
   * and a jump hits it; undefined takes it away (the panel closed), the roll still waiting. Switching
   * dice swaps the block over the head.
   */
  private showDie(player: Player, die: DieDef | undefined): void {
    const tests = this.testsOf(player);
    if (!die) {
      if (tests.rolling) this.endRoll(player);
      return;
    }
    if (tests.rolling) {
      // Another die: it takes the other's place over their head (a model grows in).
      if (tests.rolling.die.id !== die.id) {
        this.takeDie(tests.rolling.over);
        tests.rolling.over = this.putDie(player.dimension, tests.rolling.at, die);
      }
      tests.rolling.die = die;
      return;
    }
    if (this.pieces.isWalking(player)) return;
    const spot = overHead(player.location);
    tests.rolling = { die, at: spot, over: this.putDie(player.dimension, spot, die) };
    // Rolling for turn order ends the pre-game podium's walking. The jump that hits the die is a real
    // jump (the plan's turn shot: a jump makes them jump). The camera stays: the turn shot on a turn,
    // the podium's while everyone rolls for turn order.
    this.podium.delete(player.name.toLowerCase());
    lock(player, true);
    this.tell(player, line("turn.roll.hint"));
  }

  /**
   * An item used from the item panel: the menu goes while it works (a rival picked in the dialogue
   * box, its NPC's shot), then the turn shot and the menu come back for the roll.
   */
  private async useItem(who: Who, item: ItemDef): Promise<void> {
    const player = who.player;
    if (!player) return;
    this.boardMenu.close();
    await this.loop.useItem(who, item.id);
    this.backToMenu(who);
  }

  /** The turn's roll still waits after something in the middle of it (an item, the Cursed Die handed on): the turn shot and the menu again. */
  private backToMenu(who: Who): void {
    const player = who.player;
    if (!player?.isValid || !this.pendingRolls.get(who.key)?.shot) return;
    this.keepControls(player, this.testsOf(player));
    this.boardCamera.turnShot(who.body);
    this.boardMenu.open(who);
  }

  /**
   * The jump on a die: the roll, unless it's the Cursed Die from their own hands and they make a rival
   * roll it instead (item-play.ts, offerCursedDie): then the die goes and the menu comes back.
   */
  private async rollOrGive(who: Who, die: DieDef): Promise<void> {
    const player = who.player;
    if (!player) return;
    if (die.id === CURSED_DIE && (await this.loop.items.offerCursedDie(who))) {
      this.endRoll(player);
      this.backToMenu(who);
      return;
    }
    await this.roll(player, die);
  }

  /** Board's view: the whole board for everyone, still (board-view.ts), or everyone's own view again. */
  private boardView(on: boolean): void {
    const shot = on ? boardOverview(this.spaces) : undefined;
    if (shot) this.staging.shot(shot, "Cut");
    else this.staging.clear();
  }

  /** Takes the die away (the roll is over or called off); keepControls holds the player again. */
  private endRoll(player: Player): void {
    const tests = this.testsOf(player);
    this.takeDie(tests.rolling?.over);
    tests.rolling = undefined;
  }

  /** The jump that hits the die: the number, then the die goes and the walk follows. */
  private async roll(player: Player, die: DieDef): Promise<void> {
    const tests = this.testsOf(player);
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    const rolled = rollDie(die, () => this.ctx.random());
    const rolling = tests.rolling;
    tests.rolling = undefined;
    this.pendingRolls.delete(key);
    const watchers = pending?.shot === false ? [player] : world.getAllPlayers();
    for (const watcher of watchers) this.rollTitle(watcher, player.name, rolled);
    await this.scope.wait(12);
    this.takeDie(rolling?.over);
    await this.scope.wait(8);
    // Out to the board view for the walk (a turn's roll).
    if (pending?.shot) this.boardCamera.boardShot();
    pending?.resolve(rolled);
  }

  // ---- The menu ---------------------------------------------------------------------------

  private async menu(player: Player): Promise<void> {
    const items: [string, () => void | Promise<void>][] = [
      ["Get star (on your roll)", () => this.getStar(player)],
      ["Go to a space (on your roll)", () => this.goToSpace(player)],
      ["Skip to a round", () => this.skipForm(player)],
      ["Play a minigame now", () => this.minigameForm(player)],
      ["Piece settings", () => this.settingsForm(player)],
      ["Camera shots", () => this.shotsMenu(player)],
      ["Jump test", () => this.jumpMenu(player)],
      ["Dice and items held", () => this.contentsForm(player)],
      ["Next space outcomes", () => this.outcomeForm(player)],
      ["Bring the Wandering Trader", () => this.traderTest(player)],
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

  /**
   * Get star (the user asked, to try Stars without a long game): on the player's turn, while their
   * roll waits, the roll is the number of spaces to the nearest Star ahead, and every branch on the
   * way takes the way there.
   */
  private getStar(player: Player): void {
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    if (!pending?.shot) return this.tell(player, "Get star works on your turn, while your roll waits.");
    const path = this.loop.pathToStar(this.pieces.spaceOf(player));
    if (!path) return this.tell(player, "There's no Star ahead to get to.");
    this.walkPath(player, path, `Get star: ${path.length} space${path.length === 1 ? "" : "s"} to the Star.`);
  }

  /**
   * Go to a space (the user asked, to try Versus and the rest without luck): Get star's way, to the
   * nearest space of a type ahead.
   */
  private async goToSpace(player: Player): Promise<void> {
    const key = player.name.toLowerCase();
    if (!this.pendingRolls.get(key)?.shot) return this.tell(player, "Go to a space works on your turn, while your roll waits.");
    const types = BLOCK_PARTY_BOARD.types.filter((type) => type.id !== "start" && this.spaces.some((space) => space.type === type.id));
    const form = new ActionFormData().title("Go to a space");
    for (const type of types) form.button(type.name);
    const picked = (await showForm(this.scope, player, form))?.selection;
    if (picked === undefined || !this.pendingRolls.get(key)?.shot) return;
    const type = types[picked];
    const path = this.loop.pathTo(this.pieces.spaceOf(player), (_, space) => space.type === type.id);
    if (!path) return this.tell(player, `There's no ${type.name} space ahead.`);
    this.walkPath(player, path, `Go to a space: ${path.length} space${path.length === 1 ? "" : "s"} to ${type.name}.`);
  }

  /** The waiting roll is `path`'s length, and the walk takes `path`'s way at each branch. */
  private walkPath(player: Player, path: number[], text: string): void {
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    if (!pending) return;
    this.loop.steer(key, path);
    this.pendingRolls.delete(key);
    this.boardMenu.close();
    this.endRoll(player);
    this.tell(player, text);
    pending.resolve({ die: STANDARD, faces: [], move: path.length });
  }

  /** Skip to a round (the user asked, to try late rounds without playing up to them). */
  private async skipForm(player: Player): Promise<void> {
    if (!this.loop.active) return this.tell(player, "Skip to a round works once the board game is on.");
    const { now, of } = this.loop.rounds;
    const form = new ModalFormData()
      .title("Skip to a round")
      .dropdown(
        "Round",
        Array.from({ length: of }, (_, i) => `Round ${i + 1} of ${of}`),
        { defaultValueIndex: Math.min(of - 1, now) },
      )
      .toggle("Straight to its minigame", { defaultValue: true });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [index, minigameOnly] = values as [number, boolean];
    this.loop.testJump({ kind: "round", round: index + 1, minigameOnly });
    this.callOffRoll(player);
    this.tell(player, `On to round ${index + 1}${minigameOnly ? "'s minigame" : ""} once the turn going on ends.`);
  }

  /** Play a minigame now (the user asked): any minigame in any of its formats, next, then the turns go on. */
  private async minigameForm(player: Player): Promise<void> {
    if (!this.loop.active) return this.tell(player, "Play a minigame works once the board game is on.");
    const formatName: Record<Format, string> = { ffa: "free for all", battle: "Battle", "2v2": "2 vs 2", "1v3": "1 vs 3", duel: "duel" };
    const entries = MINIGAMES.flatMap((def) =>
      (def.kind === "ffa" ? (["ffa", "battle"] as const) : [def.kind]).map((format: Format) => ({ def, format, label: `${def.name}: ${formatName[format]}` })),
    );
    const form = new ActionFormData().title("Play a minigame now");
    for (const entry of entries) form.button(entry.label);
    const picked = (await showForm(this.scope, player, form))?.selection;
    if (picked === undefined) return;
    const entry = entries[picked];
    if (!fits(entry.format, this.loop.seated)) return this.tell(player, `${entry.label} doesn't fit ${this.loop.seated} players.`);
    this.loop.testJump({ kind: "minigame", format: entry.format, def: entry.def });
    this.callOffRoll(player);
    this.tell(player, `${entry.label} comes once the turn going on ends (a roll you were waiting on is played again after).`);
  }

  /** A test that can't wait: the player's own turn roll, if it's waiting, is called off. */
  private callOffRoll(player: Player): void {
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    if (!pending?.shot) return;
    this.pendingRolls.delete(key);
    this.boardMenu.close();
    this.endRoll(player);
    pending.resolve(undefined);
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
    // The dialogue box: its steerer's pick, or a vote to skip.
    if (this.dialogue.jumped(player)) return;
    // A minigame's rules: a jump is Ready.
    if (this.runner.jumped(player)) return;
    // The board menu and item panel: the active player's pick.
    if (this.boardMenu.jumped(player)) return;
    const tests = this.testsOf(player);
    // The turn order's roll (no menu): the standard die.
    if (tests.rolling) {
      void this.roll(player, tests.rolling.die);
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
    // Nothing locked hands the keys back to the game (keepControls), which sets them again.
    tests.controls = undefined;
    const perms = player.inputPermissions;
    if (mode === "lateral" || mode === "camera") perms.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    if (mode === "movement" || mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Movement, false);
    if (mode === "nojump") perms.setPermissionCategory(InputPermissionCategory.Jump, false);
    if (mode === "camera") {
      const at = player.location;
      const yaw = (player.getRotation().y * Math.PI) / 180;
      player.camera.setCamera("minecraft:free", { location: { x: at.x - Math.sin(yaw) * 4, y: at.y + 1.8, z: at.z + Math.cos(yaw) * 4 }, facingLocation: { x: at.x, y: at.y + 1, z: at.z } });
    }
    this.tell(player, `Jump test: ${JUMP_MODES.find((m) => m.id === mode)?.label}. Jump, and the chat says what came through. Pick Nothing locked to give the game your keys back.`);
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
    for (const player of world.getAllPlayers()) this.sendLine(player, this.testsOf(player));
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
    for (const tests of this.tests.values()) this.takeDie(tests.rolling?.over);
    // A die model a bot's roll left (the game ended in the middle of it).
    try {
      for (const model of world.getDimension("overworld").getEntities({ type: DIE_ENTITY })) model.remove();
    } catch {
      // gone with the server
    }
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

/** The block a die floats in over a body standing at `at`: 3 over the block they stand in. */
function overHead(at: Vector3): Vector3 {
  return { x: Math.floor(at.x), y: Math.floor(at.y) + 3, z: Math.floor(at.z) };
}

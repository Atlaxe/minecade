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
//   - animations (animations.ts, moves.ts): the players' sets as the game goes (Select as a turn
//     starts or a rival is picked, Dice roll on the jump that hits the die, Celebration and Sad on
//     the turn order reveal, a minigame's result, a Star or coins won and lost), and every line's
//     actions from the dialogue tool, the speaker talking unless the line says otherwise;
//   - arenas from other maps (spike/blockparty/arena-pack.ts installs them as structures in
//     private_packs/arenas/): placed far east of the board (or in the map's arena slot), fresh each
//     time, behind the minigame announcement's star field (stars.ts) fading in over the view and out
//     again on the new place;
//   - a player riding a player and on a lead (two players; both need private_packs/players/,
//     vanilla's player.json made rideable and leashable);
//   - every minigame's test arena (minigames/test-arenas.ts, or a built one's own), laid where arenas
//     go with its marks shown, to look at (testing only).
// What a test tells a player in chat also goes to the server's log ("blockparty test:" lines).
import {
  ButtonState,
  EntityComponentTypes,
  HudElement,
  HudVisibility,
  InputButton,
  InputPermissionCategory,
  ItemStack,
  system,
  world,
  type Dimension,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ARENA_SLOT, Minigame, describeError, draw, facingOf, hudLine, log, say, showForm, spacesOf, worldPoint, type Down, type DownDecision, type GameContext, type Hit, type MapPosition, type Result, type SpawnReason } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD, type MapEdit, type MapSettingConfig } from "@minecade/minigame-core/config";
import registry from "#registry";
import skins from "#skins";
import { HOTBAR_SIZE, KEEP_UP, READY_CODE, SIDE_TWO_CODE, STANDINGS_CODE, STAR_LEVELS, holdingCode } from "./bar-codes.ts";
import type config from "../../game.config.ts";
import { boardBox, floorOf, mapSpaces, standAt, type Space, type Vec3 } from "./board.ts";
import { WorldTerrain } from "./terrain.ts";
import { mapGolems } from "./golem-rules.ts";
import { layTestBoard, testBoardSpaces } from "./test-board.ts";
import { BoardLoop } from "./board-loop.ts";
import { BoardCamera, autoDirection, cameraSettings, type BoardCameraSettings } from "./board-camera.ts";
import { CameraTuning } from "./camera-tuning.ts";
import { BoardMenu } from "./board-ui.ts";
import { StarField } from "./stars.ts";
import { boardOverview } from "./board-view.ts";
import { DICE, DICE_PROBLEMS, STANDARD, STANDARD_DIE, burstParticle, modelIndex, rollDie, type DieDef, type RollOutcome } from "./dice.ts";
import { Counts } from "./counts.ts";
import { eventCue, playCue } from "./sounds.ts";
import { ITEMS, type ItemDef } from "./dice-items.ts";
import { ITEM_PROBLEMS } from "./items.ts";
import { CURSED_DIE } from "./item-play.ts";
import { CHANCE, HAPPENING, WARDEN, type ChanceId, type HappeningId, type WardenId } from "./space-rules.ts";
import { Zombies } from "./zombies.ts";
import { ResultsScreen, type ResultSeat } from "./results.ts";
import { SCREEN_WORDS, announceRows, cardRows, codesOf, roundRow, roundText, tutorialRows } from "./screen-codes.ts";
import { GameSidebar } from "./sidebar-rows.ts";
import { Heads } from "./heads.ts";
import { Dialogue, type SaidLine } from "./dialogue.ts";
import { CLIPS, playerClips, roleOf, type LineAction } from "./animations.ts";
import { Moves, PLAYER_ANIMATION } from "./moves.ts";
import { Transfers } from "./transfers.ts";
import { ITEM_IDS } from "./items.ts";
import type { Token } from "./tokens.ts";
import type { Pass } from "./handovers.ts";
import { TEST_WORDS, type TestWord } from "./tests-menu.ts";
import { TurnFade } from "./fade.ts";
import { SpaceMarkers } from "./space-markers.ts";
import { Stage, type StageMarkup } from "./stage.ts";
import { nearestSpace, type Marker } from "./stage-layout.ts";
import { STAGE_POINTS, chrisKey } from "./stage-markup.ts";
import { line } from "./lines.ts";
import { BOT_COUNTS, LENGTHS, START_COINS } from "./board-rules.ts";
import { Bots, hop, isPlayer, thinkTicks, whoOf, type Who } from "./bots.ts";
import { fits, type Format } from "./minigame-rules.ts";
import { MinigameRunner, type ArenaPlace, type TutorialView } from "./minigame-runner.ts";
import { ARENAS, MARKUP, PAINTER_TEAMS } from "./minigames/arenas.ts";
import { MINIGAMES } from "./minigames/index.ts";
import { fill, type Field, type Spot } from "./minigames/kit.ts";
import { TEST_ARENAS, layTestArena, testArenaCopies, testArenaField } from "./minigames/test-arenas.ts";
import { Npcs } from "./npcs.ts";
import { DEFAULT_SETTINGS, Pieces, WALK_CAMERAS, hold, lock, resendLocks, unlock, type PieceSettings } from "./pieces.ts";
import { SHOTS, Shots, type ShotId } from "./shots.ts";

type Config = typeof config;

// ---- Dice and items ------------------------------------------------------------------------

/**
 * A die over the roller's head while the item panel shows it: its model (DIE_ENTITY, a die with a
 * texture in the dice file, its texture picked by DIE_PROPERTY: dice.ts, modelIndex) right over
 * their head, or else its block (the dice file's stand-in) in the block `at`.
 */
interface DieShown {
  at: Vector3;
  model?: Entity;
  block?: string;
}
const DIE_ENTITY = "blockparty:die";
const DIE_PROPERTY = "blockparty:die";
/** Set when the jump hits the die: it shakes, swells and pops (animation.blockparty.die_burst, BURST_TICKS long). */
const BURST_PROPERTY = "blockparty:burst";
/**
 * How far over the roller's feet the die's model stands: the die itself (a player head's size, the
 * model's middle half a block up) clears their head by about half a block, so a jump hits it.
 */
const DIE_OVER = 2.15;
/** Ticks from the jump to the head hitting the die, the burst's length, and the number's time over the head before the walk. */
const HIT_AFTER = 4;
const BURST_TICKS = 7;
const NUMBER_TICKS = 16;
/** Ticks between one throw's number and the die coming back for the next (a Triple Die's, Roll again's). */
const NEXT_THROW_AFTER = 12;
/**
 * Ticks after the die comes out before jumping comes on and a jump hits it (the user, 2026-11-18:
 * picking Dice block made them jump, the press that picked it still held as jumping came on). Half a
 * second (the user, 2026-11-20: half what it was).
 */
const DIE_JUMP_AFTER = 10;
/** The puff the die bursts in, with its own chips (dice.ts, burstParticle). */
const BURST_PUFF = "minecraft:large_explosion";
/** The sound cues (the user's Sounds view, Item panel): the jump hits the die, and its number shows. */
const DICE_EVENTS = { hit: "dice.hit", number: "dice.number" } as const;

/**
 * The coin and Star models, for the board's animations later: each its picture one pixel thick (the
 * workshop's block-party-icons builds them into the private icons pack). TURNING_PROPERTY turns one
 * slowly about its middle (animation.blockparty.icon_turn).
 */
const ICON_MODELS = ["blockparty:coin", "blockparty:star"] as const;
const TURNING_PROPERTY = "blockparty:turning";
/** How long the Tests menu's Coin and Star models stay out. */
const ICON_TEST_TICKS = 400;

/**
 * What Block Party hides: everything a survival player watches that it has no use for, the hotbar
 * with its item names (MINIGAME_HUD), and the chat (CHAT_HUD).
 */
const HIDDEN_HUD = [HudElement.Hotbar, HudElement.ItemText, HudElement.Health, HudElement.Hunger, HudElement.ProgressBar, HudElement.Armor, HudElement.AirBubbles, HudElement.StatusEffects];
/** What comes back while a player plays a minigame: vanilla's hotbar (the user: only in minigames, never on the board or in cutscenes). */
const MINIGAME_HUD = [HudElement.Hotbar, HudElement.ItemText];
/** And in a minigame with real damage. */
const HEARTS_HUD = [HudElement.Health, HudElement.Armor];
/**
 * The chat's switch (the user: no chat, /chat brings it back): vanilla's status effects element,
 * whose icons no server shows, so the pack's hud_screen.json shows the chat only while it's on.
 */
const CHAT_HUD = [HudElement.StatusEffects];
/** Ticks between sends of each player's HUD line (the action bar fades unless it's sent again). */
const BAR_RESEND = 20;
/** Ticks after a turn starts before its player's Select (the turn shot eases in on them meanwhile). */
const SELECT_AFTER = 10;
/**
 * The item every player holds on the board, in each hotbar slot, so a drop (Q, a controller's drop
 * button) has something to drop: a clear picture, nothing in their hands. The drop shows them their
 * own results screen (the user's ask); the item never leaves.
 */
const STANDINGS_ITEM = "blockparty:standings";
/** Ticks a right click on a block or a mob counts as held (use is the skip vote's button): a block's repeats while the button stays down. */
const USE_ON_TARGET = 6;
/** Ticks a player's own results screen stays up unless they drop again. */
const STANDINGS_TICKS = 160;
/** Ticks between checks that every player on the board has STANDINGS_ITEM in every hotbar slot. */
const STANDINGS_EVERY = 10;
/** A player's body square to where they look on the board (keepSquared): the pack's animation, its controller, and how often it's played again. */
const SQUARE_UP = "animation.blockparty.square_up";
const SQUARE_CONTROLLER = "blockparty.square";
const SQUARE_EVERY = 100;
/** The pack's animation that does nothing, played to stop another on its controller. */
const REST_ANIMATION = "animation.blockparty.rest";
/** How far from a dropped STANDINGS_ITEM its dropper can be, in blocks. */
const DROP_REACH = 4;

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
/** How long a test arena's marks show, in ticks (a minute). */
const MARKS_SHOWN = 1200;

/** A checklist's points or regions (arenas.ts) as map keys and labels: one per team or type, the podium left out (a test arena's results use the game's stand-in). */
function markKeys(record: unknown, teams: readonly string[]): [string, string][] {
  const needs = (record ?? {}) as Record<string, { label?: string; perTeam?: boolean; types?: { id: string; name: string }[] }>;
  return Object.entries(needs)
    .filter(([key]) => key !== MARKUP.podium && key !== MARKUP.podiumCamera)
    .flatMap(([key, need]): [string, string][] => {
      const label = need.label ?? key;
      if (need.perTeam) return teams.map((team): [string, string] => [`${key}.${team}`, `${label} (${team})`]);
      if (need.types) return need.types.map((type): [string, string] => [`${key}.${type.id}`, `${label} (${type.name})`]);
      return [[key, label]];
    });
}
const BOARD_AREA = "minecade:blockparty_board";
/** Ticks between the star field's strengths as it fades in or out (STAR_LEVELS of them), as the old loading screen's. */
const STAR_STEP = 1;
/** Ticks of black before the star field starts fading in over it. */
const STARS_AFTER_BLACK = 4;
/** Blocks placed a millisecond, about (docs/spike-results.md, "Block Party": Sinkhole's 667,648 in 608 to 676 ms). */
const BLOCKS_PER_MS = 1000;
/** How long a save from /boardcam waits for the map editor's answer, in ticks. */
const SAVE_WAIT = 200;
/** What a testing command says when Block Party isn't being tested (spike.ts, testing). */
const ONLY_TESTING = "is only for testing: a test game, DEV_MIN_PLAYERS at 1, or a preview from the map editor.";

/** Starting coins while Block Party is a test game or a server plays it alone. */
const TEST_COINS = 30;
/** Seats at a Block Party game. */
const SEATS = 4;
/** Ticks after the players have moved before the bots are made again beside them (their screens are there by then). */
const BOTS_AFTER = 10;

/** Ticks the slow-load test keeps the star field up longer. */
const SLOW_LOAD = 80;
/**
 * Ticks the star field stays up after the move, while players' clients load the chunks around
 * their new place (the user saw the old loading screen fade away before the arena showed).
 */
const CLIENT_LOAD = 40;

interface PlayerTests {
  settings: PieceSettings;
  jumpMode: JumpMode;
  reportJumps: boolean;
  /** The action bar line last sent, and when: sent again when it changes or every BAR_RESEND ticks. */
  sentLine?: string;
  sentAt?: number;
  /**
   * Their die out: which die it is, the block over their head it floats in, and what shows there;
   * `next` when it's back for another throw of the same roll (a Triple Die's), the jump that hits it;
   * `jumpAt`, the tick from which a jump hits it and jumping is on (DIE_JUMP_AFTER after it came out).
   */
  rolling?: { die: DieDef; at: Vector3; over?: DieShown; next?: () => void; jumpAt?: number };
  /** What their keys were last set to do, and whether vanilla's hotbar was last shown (undefined: set them again). */
  controls?: Controls;
  hotbar?: boolean;
  /** Vanilla's hearts and armor show: a minigame with real damage is playing. */
  hearts?: boolean;
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
  /** The test arena laid to look at (Test arenas), its box, and what stops its marks showing. */
  private testArena: { min: Vector3; max: Vector3; stop: () => void } | undefined;
  /** Whether the test board's blocks are down: nobody is put on it before. */
  private boardReady = false;
  private slowLoads = false;
  /** The minigame tutorial up now (its second side's players and who's ready ride each one's action bar). */
  private tutorialView: TutorialView | undefined;
  /** Whether the board is the map's own spaces (else the test board is laid beside Probe's platform). */
  private ownBoard = false;
  /** The board's middle: the test board's, or the middle of the map's spaces. */
  private boardMiddle: Vec3 = [0, 64, 0];
  /** The minigame announcement's star field, the same for everyone (stars.ts). */
  private readonly stars = new StarField();
  /** The board loop (board-loop.ts). */
  private loop!: BoardLoop;
  /** The game's one sidebar (the dialogue box and the board's screens), the board menu and item panel, the results screen. */
  private gameSidebar!: GameSidebar;
  private boardMenu!: BoardMenu;
  private results!: ResultsScreen;
  /** The cards' rows last put on the sidebar, so they're sent only when they change. */
  private cardsShown = "";
  /** The round's text last put on the sidebar (bottom right), likewise. */
  private roundShown = "";
  /** The board's own camera (board-camera.ts), and the way a fixed one looks when the map doesn't say. */
  private boardCamera!: BoardCamera;
  /** Board's view of the whole board is up (board-ui.ts's Board): nobody is faded meanwhile. */
  private boardViewing = false;
  private autoYaw: number | undefined;
  /** The camera tuned in game (/boardcam, /spacecam: camera-tuning.ts), over the map's own. */
  private tuning!: CameraTuning;
  /** Saves asked of the map editor so far (each its own request id). */
  private saves = 0;
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
  /** The players' and NPCs' animations (moves.ts). */
  private moves!: Moves;
  /** Coins, Stars, items and dice flying from one to another (transfers.ts). */
  private transfers!: Transfers;
  /** The minigame's line top right while one is on (it takes the board's place). */
  private minigameStatus: string | undefined;
  /** A player's own line over the minigame's status (Play.tell), by key, until its tick. */
  private readonly ownLines = new Map<string, { text: string; until: number }>();
  /** The board's words above the hotbar (barText: a turn's start) and the tick they go at. */
  private barWords: { text: string; until: number } | undefined;
  /** Players put on the pre-game podium who haven't rolled for turn order yet (by key): they may walk. */
  private readonly podium = new Set<string>();
  /** On a turn, everyone else fades away (fade.ts). */
  private fade!: TurnFade;
  /** The spaces' markers (space-markers.ts): laid with the board, lit where a piece stands or the stage's shot is. */
  private markers!: SpaceMarkers;
  /** The zombies that follow seats (zombies.ts: the Zombie Spawn, the Warden's curse, Chance's outbreak). */
  private zombies!: Zombies;
  /** The moves left over a walker's head after a roll (counts.ts). */
  private counts!: Counts;
  /** The board loop has ended (the core's own "wins" title is left out: the loop's end notice says it). */
  private loopOver = false;
  /** Who has turned chat on with /chat (by key): Block Party hides it for everyone else. */
  private readonly chatOn = new Set<string>();
  /** Who stands square to where they look (keepSquared), by key, and the tick it was last played. */
  private readonly squared = new Map<string, number>();
  /**
   * Who holds use (right click) down now, by key: the tick it went down, and for a right click on a
   * block or a mob (no lasting use, just events while it's held) until when it counts as down.
   */
  private readonly useDown = new Map<string, { since: number; until?: number }>();
  /** Who has the results screen up for themselves (a drop), by key, and the tick it goes. */
  private readonly viewing = new Map<string, number>();
  /** The standings last put on the sidebar for them, so they're sent only when they change. */
  private standingsShown = "[]";

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
    this.spaces = this.ownBoard ? mapSpaces(own) : testBoardSpaces(this.config.board.at);
    if (this.ownBoard) {
      const xs = this.spaces.map((space) => space.at[0]);
      const zs = this.spaces.map((space) => space.at[2]);
      this.boardMiddle = [(Math.min(...xs) + Math.max(...xs)) / 2, floorOf(this.spaces[0]), (Math.min(...zs) + Math.max(...zs)) / 2];
    } else this.boardMiddle = this.config.board.at;
    const box = boardBox(this.spaces);
    const arenaBox = { min: [ARENA_AT[0] - 100, -64, ARENA_AT[2] - 100] as Vec3, max: [ARENA_AT[0] + 100, 319, ARENA_AT[2] + 100] as Vec3 };
    this.map.extendBounds([box, arenaBox]);
    const watchers = () => world.getAllPlayers();
    const dimension = world.getDimension("overworld");
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
      // The ground the walk goes over: jumps, falls, stairs and climbs (walk-plan.ts).
      terrain: new WorldTerrain(dimension, () => this.spaces),
    });
    this.bots = new Bots(this.scope, dimension);
    this.runner = new MinigameRunner({
      scope: this.scope,
      dimension,
      arenaPlace: () => this.arenaPlace(),
      arenaMaps: (id) => this.ctx.vars.arenas[id] ?? [],
      starsIn: () => this.starsIn(),
      behindStars: (work, reveal) => this.behindStars(work, reveal),
      leaveBoard: (who) => this.leaveBoard(who),
      backToBoard: (who) => this.backOnBoard(who),
      respawnBot: (who, at, yaw) => this.bots.respawn(who, at, yaw),
      release: (who) => this.moves.release(who.body),
      // Out of a minigame: the end's bonus Stars count it.
      out: (who) => this.loop?.stats.out(who.key),
      notice: (text, ticks) => void this.notice(text, "", ticks),
      say: (text) => this.everyone(text),
      random: () => this.ctx.random(),
      status: (text) => (this.minigameStatus = text),
      tell: (key, text, ticks) => {
        if (text === undefined) this.ownLines.delete(key);
        else this.ownLines.set(key, { text, until: system.currentTick + ticks });
      },
      zoomOut: (seconds) => this.boardCamera.zoomOut(seconds),
      boardAbove: () => {
        if (this.boardCameraBack()) this.boardCamera.above();
      },
      boardIn: (seconds) => {
        if (this.boardCameraBack()) this.boardCamera.comeIn(seconds);
      },
      announce: (screen) => this.gameSidebar.set("announce", screen ? { title: codesOf(SCREEN_WORDS.announce), rows: announceRows(screen) } : undefined),
      tutorial: (view) => {
        this.tutorialView = view;
        this.gameSidebar.set("tutorial", view ? { title: codesOf(SCREEN_WORDS.tutorial), rows: tutorialRows(view) } : undefined);
      },
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
    this.markers = new SpaceMarkers({
      scope: this.scope,
      dimension,
      spaces: () => this.spaces,
      // A seat faded out on someone else's turn lights nothing.
      pieces: () => [...world.getAllPlayers().map(whoOf), ...this.bots.all()].map((who) => who.body).filter((body) => !this.fade.isFaded(body)),
    });
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
    this.counts = new Counts({ scope: this.scope, bodyOf: (key) => this.bodyOf(key) });
    this.moves = new Moves({ scope: this.scope, random: () => this.ctx.random(), fallIn: (entity) => void this.staging.fallAgain(entity) });
    this.transfers = new Transfers({ scope: this.scope, dimension: () => dimension, random: () => this.ctx.random(), movesShown: (key) => this.counts.shows(key) });
    this.dialogue = new Dialogue({
      scope: this.scope,
      random: () => this.ctx.random(),
      show: (box) => this.gameSidebar.set("dialogue", box),
      leader: () => this.leader(),
      act: (action, said) => this.lineAction(action, said),
      holdingUse: (player) => this.holdingUse(player),
    });
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
    this.results = new ResultsScreen({
      scope: this.scope,
      sidebar: this.gameSidebar,
      headOf: (name) => this.headOf(name),
      // Once the changes have played, the party leader's jump goes on, or the turn's player's (a Star they bought, a duel).
      mayGoOn: (player) => player.name === this.leader()?.name || player.name.toLowerCase() === this.loop?.whoseTurn,
    });
    this.staging = new Stage({
      scope: this.scope,
      dimension,
      dialogue: this.dialogue,
      spaces: () => this.spaces,
      markup: () => this.stageMarkup(),
      put: (who, at, yaw, still) => this.putSeat(who, at, yaw, still),
      fade: (fadeIn, hold, fadeOut) => this.blackFade(fadeIn, hold, fadeOut),
      face: (who, toward) => this.faceSeat(who, toward),
      // Bots a moment after the players, as everywhere a body goes a long way with them (bots.ts).
      toStart: (who) => (who.player ? this.backOnBoard(who) : this.scope.timeout(() => this.backOnBoard(who), BOTS_AFTER)),
      cameraTaken: (seconds) => this.boardCamera?.take(seconds),
      cameraBack: () => this.boardCamera?.giveBack() ?? false,
      shotUp: () => this.boardCamera?.held ?? true,
      moves: this.moves,
      select: (space) => this.markers.select(space),
      // Golem Gardens' golems stand and walk off the spaces: their spots and walks stay loaded.
      held: () => (this.ownBoard ? mapGolems(this.map.config, this.spaces).flatMap((golem) => golem.walk) : []),
      // While the board camera never turns, every cutscene on the board looks its way too (stage.ts lay).
      boardWay: () => this.boardYaw(),
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
        // Their turn: Select, as the turn shot gets to them.
        if (shot) this.scope.timeout(() => this.moves.player(who.body, "Select"), SELECT_AFTER);
        if (!player) return shot ? this.boardMenu.botTurn(who).then((die) => this.botRoll(who, shot, die)) : this.botRoll(who, shot, STANDARD);
        return new Promise((resolve) => {
          const key = player.name.toLowerCase();
          this.pendingRolls.get(key)?.resolve(undefined);
          this.pendingRolls.set(key, { resolve, shot });
          if (shot) this.boardMenu.open(who);
          else this.showDie(player, STANDARD);
        });
      },
      count: (who, left) => this.counts.set(who.key, left),
      fork: (options) => this.dialogue.fork(options),
      say: (id, fills, skippable, by) => this.dialogue.say(id, fills, skippable, by),
      talk: (id, fills, options) => this.dialogue.talk(id, fills, options),
      cutscene: (skippable, work) => this.dialogue.cutscene(skippable, work),
      stage: this.staging,
      // A minigame with no published arena map plays its test arena only while testing (the user, 2026-11-26).
      minigames: this.testing ? MINIGAMES : MINIGAMES.filter((def) => (this.ctx.vars.arenas[def.id] ?? []).length > 0),
      playMinigame: (format, def, sides, pool, onlookers, settle, options) => this.runner.play(format, def, sides, pool, onlookers, settle, options),
      everyone: (text) => this.everyone(text),
      tell: (who, text) => who.player && this.tell(who.player, text),
      notice: (text, more, ticks) => this.notice(text, more, ticks),
      headline: (title, subtitle, ticks) => this.headline(title, subtitle, ticks),
      barText: (text, ticks) => (this.barWords = text.trim() === "" ? undefined : { text, until: system.currentTick + ticks }),
      changed: () => this.loopChanged(),
      results: (before, after) => this.results.show(before, after),
      // On the minigame podium a mood is held until everyone goes back (the user), and on the final podium too.
      react: (who, set, hold) => this.moves.player(who.body, set, hold ?? this.runner.onPodium),
      transfer: (from, to, token, count) => this.transfers.give(from, to, token, count),
      leave: (from, ways, token) => this.transfers.leave(from, ways, token),
      arrive: (to, from, token, count) => this.transfers.arrive(to, from, token, count),
      confetti: (who) => confettiOver(who.body),
      zombies: this.zombies,
      random: () => this.ctx.random(),
      // Golem Gardens' golems (golem-rules.ts), on a map's own board only; they walk the ground as pieces do.
      golems: () => (this.ownBoard ? mapGolems(this.map.config, this.spaces) : []),
      terrain: new WorldTerrain(world.getDimension("overworld"), () => this.spaces),
    });
    this.boardCamera = new BoardCamera({
      scope: this.scope,
      watchers: () => world.getAllPlayers(),
      settings: () => this.cameraSettingsNow(),
      // The board game's own camera from its first round, except while a minigame has the players.
      engaged: () => this.loop.active && this.loop.rounds.now >= 1 && !this.runner.active,
      focus: () => this.bodyOf(this.loop.focus),
    });
    this.tuning = new CameraTuning({
      setting: (key) => {
        const settings: Readonly<Record<string, MapSettingConfig>> = this.config.map?.settings ?? {};
        const setting = settings[key];
        if (!setting) throw new Error(`blockparty has no map setting "${key}"`);
        return setting;
      },
      mapValue: (key) => this.mapSetting(key),
      spaces: () => this.spaces,
      boardYaw: () => this.boardYaw(),
      retuned: () => {
        this.boardCamera.refresh();
        this.staging.restage();
      },
      spaceNow: () => this.staging.shotSpace ?? this.focusSpace(),
      shotSpace: () => this.staging.shotSpace,
      show: (space) => this.staging.showSpace(space),
      back: () => this.staging.hideSpace(),
      canSave: () => this.ctx.vars.preview !== "",
      save: (edit, by) => this.saveToMap(edit, by),
    });
    this.scope.subscribe(world.afterEvents.entityHitEntity, ({ damagingEntity, hitEntity }) => {
      if (damagingEntity.typeId !== "minecraft:player") return;
      const role = this.npcs.roleOf(hitEntity);
      if (role) void this.npcs.menu(damagingEntity as Player, hitEntity, role, (text) => this.everyone(text), this.moves);
    });
    this.scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => this.jumped(player),
      { buttons: [InputButton.Jump], state: ButtonState.Pressed },
    );
    // Holding use (right click) is the skip vote (the user, 2026-11-18; picks and going on are the
    // jump, as they were). The board's item has a use that lasts (items/standings.json,
    // use_modifiers), so its start and stop say when the button goes down and up; a right click on a
    // block or a mob uses that instead, its events coming again while it's held (a block's), so it's
    // down till they stop.
    this.scope.subscribe(world.afterEvents.itemStartUse, ({ source, itemStack }) => {
      if (itemStack.typeId === STANDINGS_ITEM) this.useGoesDown(source);
    });
    for (const signal of [world.afterEvents.itemStopUse, world.afterEvents.itemReleaseUse, world.afterEvents.itemCompleteUse]) {
      this.scope.subscribe(signal, ({ source }: { source: Player }) => this.useGoesUp(source));
    }
    this.scope.subscribe(world.afterEvents.playerHotbarSelectedSlotChange, ({ player }) => this.useDown.delete(player.name.toLowerCase()));
    this.scope.subscribe(world.afterEvents.playerInteractWithBlock, ({ player }) => this.useOnTarget(player));
    this.scope.subscribe(world.afterEvents.playerInteractWithEntity, ({ player }) => this.useOnTarget(player));
    // Sneak is the dialogue box's back button (Not now), else the board menu's back.
    this.scope.subscribe(
      world.afterEvents.playerButtonInput,
      ({ player }) => void (this.dialogue.sneaked(player) || this.boardMenu.sneaked(player)),
      { buttons: [InputButton.Sneak], state: ButtonState.Pressed },
    );
    // A drop of the board's held item: the dropper's own results screen (the user's ask).
    this.scope.subscribe(world.afterEvents.entitySpawn, ({ entity }) => this.dropped(entity));
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => {
      this.viewing.delete(playerName.toLowerCase());
      this.useDown.delete(playerName.toLowerCase());
      if (this.boardMenu.active === playerName.toLowerCase()) this.boardMenu.close();
      this.pendingRolls.get(playerName.toLowerCase())?.resolve(undefined);
      this.pendingRolls.delete(playerName.toLowerCase());
      const tests = this.tests.get(playerName.toLowerCase());
      // A roll waiting on their next throw goes on, and finds them gone.
      tests?.rolling?.next?.();
      this.takeDie(tests?.rolling?.over);
      this.counts.set(playerName.toLowerCase(), undefined);
      this.tests.delete(playerName.toLowerCase());
      this.pieces.forget(playerName);
    });
    this.scope.interval(() => this.keepPlayers(), 1);
    this.scope.add(() => this.cleanUp());
  }

  /** The Tests menu (/blockparty:tests, main.ts; the compass in the bar too), or the test `word` names straight away (/tests playeranimations). */
  openTests(player: Player, word?: string): void {
    void this.menu(player, word);
  }

  /**
   * /minigame win (main.ts): ends the minigame on now with `typed` (a player or bot in it) winning,
   * only while testing: Block Party a test game, DEV_MIN_PLAYERS at 1, or a preview from the map
   * editor. Says what went wrong, or undefined once it's done.
   */
  winMinigame(typed: string): string | undefined {
    if (!this.testing) return `/minigame win ${ONLY_TESTING}`;
    if (!this.runner) return "Block Party isn't running yet.";
    return this.runner.win(typed);
  }

  /**
   * /blockparty:hold (main.ts) and the Tests menu (the user asked, to try dice and items): holds the
   * game on the player's turns, or lets it go on again when they hold it. Held, once the turn or
   * minigame going on ends, every turn is theirs and their dice and items come back after each one
   * (board-loop.ts, hold). Only while testing, as /minigame win. Says what went wrong, or undefined
   * once it's done (everyone is told).
   */
  holdGame(player: Player): string | undefined {
    if (!this.testing) return `/blockparty:hold ${ONLY_TESTING}`;
    if (!this.loop?.active || this.loopOver) return "The board game isn't on.";
    const key = player.name.toLowerCase();
    if (this.loop.heldBy === key) {
      this.loop.hold(undefined);
      this.everyone(`Test: ${player.name} let go of the hold. The game goes on once this turn ends.`);
      return undefined;
    }
    if (!this.loop.hold(key)) return "The hold works once you're seated in the board game.";
    this.everyone(
      `Test: the game is held on ${player.name}'s turns. Once the turn or minigame going on ends, every turn is theirs (no other turns, no minigames), and their dice and items come back after each turn: what they hold now, or what Dice and items held sets. /blockparty:hold again lets the game go on.`,
    );
    return undefined;
  }

  /** Testing: Block Party a test game, DEV_MIN_PLAYERS at 1, or a preview from the map editor. */
  private get testing(): boolean {
    const { devMinPlayers, preview } = this.ctx.vars;
    return this.config.test || devMinPlayers === 1 || preview !== "";
  }

  /** A hit on a player: cancelled unless the minigame playing now lets it through (minigame-runner.ts, damage). */
  protected override onDamage(hit: Hit): number | "cancel" | void {
    return this.runner.damage(hit);
  }

  /** A lethal hit in a minigame with real damage: the minigame takes it, the player kept up. */
  protected override onDown(name: string, down: Down): DownDecision | void {
    if (this.runner.downed(name, down.cause)) return "handled";
  }

  protected override onStart(): void {
    this.boardLaid = this.layBoard();
  }

  /** The board loop (board-loop.ts), once the board is down; the Tests stay in the hotbar beside it. */
  protected override async play(): Promise<Result | void> {
    await this.boardLaid;
    if (!this.boardReady) return draw("the board couldn't be laid");
    this.seatBots();
    try {
      return await this.loop.run();
    } finally {
      this.loopOver = true;
    }
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

  /**
   * The game's own words in the dialogue box with no speaker (dialogue.ts, notify), `more` in a row
   * under `text`: Block Party's only title is a round's (headline). Nothing for empty text (lines
   * the user hasn't written).
   */
  private notice(text: string, more = "", ticks?: number): () => void {
    const joined = [text, more].filter((part) => part.trim() !== "").join("\n");
    return this.dialogue && joined ? this.dialogue.notify(joined, ticks) : () => undefined;
  }

  /**
   * A real title for everyone, up `ticks` then fading: a round's ("Round 3 / 10", alone) is the only
   * one (the user, 2026-11-18; a turn's start shows above the hotbar, barWords). Nothing for a title
   * the user hasn't written.
   */
  private headline(title: string, subtitle: string, ticks: number): void {
    if (title.trim() === "") return;
    super.title(title, subtitle.trim() === "" ? undefined : subtitle, undefined, ticks);
  }

  /**
   * The core's titles (the start's countdown, Go, who won) become notices too. One sent to each
   * player in turn (the core's Go) is the same for everyone, so it simply shows again. None once the
   * board loop is over: its own end notice says who won, the user's way.
   */
  override title(title: string, subtitle?: string, _to?: string, stay = 30): void {
    if (this.loopOver) return;
    this.notice(title, subtitle ?? "", stay + 10);
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
   * walk there until they roll for turn order (the user's call), or held still there when `still`
   * (the end's podiums), a bot made again there a moment later.
   */
  private putSeat(who: Who, at: Vec3, yaw: number, still = false): void {
    const spot = { x: at[0], y: at[1], z: at[2] };
    if (who.player) {
      if (still) this.podium.delete(who.key);
      else this.podium.add(who.key);
      try {
        if (who.player.isValid) who.player.teleport(spot, { rotation: { x: 0, y: yaw } });
      } catch {
        // gone
      }
      return;
    }
    this.scope.timeout(() => this.bots.respawn(who, spot, yaw), BOTS_AFTER);
  }

  /**
   * A seat turns where it stands to look at `toward` (an NPC it talks with, the user: they look at
   * each other): a player by a teleport to where they are (setRotation doesn't turn a player on their
   * own client), a bot by turning.
   */
  private faceSeat(who: Who, toward: Vec3): void {
    try {
      if (!who.body.isValid) return;
      const at = who.body.location;
      const yaw = (Math.atan2(-(toward[0] - at.x), toward[2] - at.z) * 180) / Math.PI;
      if (who.player) who.player.teleport(at, { rotation: { x: 0, y: yaw } });
      else who.body.setRotation({ x: 0, y: yaw });
    } catch {
      // gone
    }
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
      final: this.map.points(STAGE_POINTS.finalPodium).map(marker),
      finalChris: this.map.points(chrisKey("final")).map(marker)[0],
      finalCamera: this.map.points(STAGE_POINTS.finalCamera).map(marker)[0],
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

  /** A bot's roll: the die over its head (everyone watching through the turn shot on a turn), a moment's thought, a hop, the burst and the number. */
  private async botRoll(who: Who, shot: boolean, picked: DieDef): Promise<RollOutcome | undefined> {
    const body = who.body;
    if (!body.isValid) return undefined;
    const over = this.putDie(body.dimension, body.location, picked);
    await this.scope.wait(thinkTicks(() => this.ctx.random(), 25, 45));
    if (!body.isValid) {
      this.takeDie(over);
      return undefined;
    }
    const rolled = rollDie(picked, () => this.ctx.random());
    // Each throw is a hit of its own (the user, 2026-11-18: a Triple Die rolled three times in a
    // row), the number over the head the total so far.
    let total = 0;
    let die = over;
    for (let i = 0; i < rolled.faces.length; i++) {
      if (i > 0) {
        await this.scope.wait(NEXT_THROW_AFTER);
        if (!body.isValid) return rolled;
        die = this.putDie(body.dimension, body.location, picked);
        await this.scope.wait(thinkTicks(() => this.ctx.random(), 10, 20));
        if (!body.isValid) {
          this.takeDie(die);
          return rolled;
        }
      }
      hop(body);
      this.moves.player(body, "Dice roll");
      total += picked.faces[rolled.faces[i]].move;
      await this.scope.wait(HIT_AFTER);
      await this.burst(die, picked, who, total);
    }
    await this.scope.wait(NUMBER_TICKS);
    // Out to the board view for the walk.
    if (shot) this.boardCamera.boardShot();
    return rolled;
  }

  /**
   * The jump hits the die (the user: a fun little explosion, then the number over the head in the
   * 10 font): it shakes, swells and pops, bursting into chips of itself in a puff, and the roll's
   * number grows in where it was, to ride over the roller's head (counts.ts) until they've walked it.
   */
  private async burst(shown: DieShown | undefined, die: DieDef, who: Who, move: number): Promise<void> {
    playCue(eventCue(DICE_EVENTS.hit));
    const model = shown?.model;
    try {
      if (model?.isValid) model.setProperty(BURST_PROPERTY, true);
    } catch {
      // gone
    }
    await this.scope.wait(BURST_TICKS);
    let at: Vector3 | undefined;
    try {
      // The die's middle: its model's, half a block over where it stands, or its block's.
      if (model?.isValid) at = { ...model.location, y: model.location.y + 0.5 };
      else if (shown) at = { x: shown.at.x + 0.5, y: shown.at.y + 0.5, z: shown.at.z + 0.5 };
      else if (who.body.isValid) at = { ...who.body.location, y: who.body.location.y + DIE_OVER + 0.5 };
    } catch {
      // gone
    }
    this.takeDie(shown);
    if (at) {
      const dimension = who.body.isValid ? who.body.dimension : world.getDimension("overworld");
      for (const particle of [...(model ? [burstParticle(die.id)] : []), BURST_PUFF]) {
        try {
          dimension.spawnParticle(particle, at);
        } catch (error) {
          log.warn(`blockparty: the die's burst (${particle}) failed: ${describeError(error)}`);
        }
      }
    }
    playCue(eventCue(DICE_EVENTS.number));
    // The number grows in where the die's middle was.
    this.counts.set(who.key, move, at);
  }

  /**
   * One of a line's actions (dialogue.ts: the dialogue tool's, per line), on whoever the line means.
   * Speaker is the line's character, and a character by name is that one: the part of its role last
   * brought into a scene (stage.ts), the zombie following the line's player, or the Tests' NPC.
   * Player is the {player} the line names, else the seat it's to or about, else every seat (a line
   * to everyone); Other is its {other}; Every player is every seat. Bots play the players' sets too.
   */
  private lineAction(action: LineAction, said: SaidLine): void {
    const seats = [...world.getAllPlayers().map(whoOf), ...this.bots.all()];
    const named = (fill: string): Who | undefined => {
      const name = said.fills[fill];
      return name === undefined ? undefined : seats.find((who) => who.name === String(name));
    };
    const about = named("player") ?? said.about;
    if (action.who === "Every player" || (action.who === "Player" && !about)) {
      for (const who of seats) this.moves.player(who.body, action.action);
      return;
    }
    if (action.who === "Player" || action.who === "Other") {
      const who = action.who === "Player" ? about : named("other");
      if (who) this.moves.player(who.body, action.action);
      return;
    }
    const character = action.who === "Speaker" ? said.character : action.who;
    if (character === "Game") return;
    const role = roleOf(character);
    const entity = role === "zombie" ? (about ? this.zombies.of(about.key) : undefined) : (this.staging.speaker(role) ?? this.npcs.get(role));
    if (entity) this.moves.npc(entity, character, action.action, about?.body);
  }

  /**
   * Puts `die` over the head of a body standing at `feet`: its model, right over them, if it has a
   * texture, else its block in the block 3 over the one they stand in, if that's empty.
   */
  private putDie(dimension: Dimension, feet: Vector3, die: DieDef): DieShown | undefined {
    const at = blockOverHead(feet);
    try {
      const index = modelIndex(die);
      if (index !== undefined) {
        const model = dimension.spawnEntity(DIE_ENTITY, { x: feet.x, y: feet.y + DIE_OVER, z: feet.z });
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

  /** The board camera's settings: the map's (Game settings) or as tuned in game (/boardcam), a fixed one looking across the board's longer way unless the map says. */
  private cameraSettingsNow(): BoardCameraSettings {
    const settings = cameraSettings((key) => (this.tuning ? this.tuning.value(key) : this.mapSetting(key)));
    if (settings.direction !== undefined) return settings;
    this.autoYaw ??= autoDirection(this.spaces);
    return { ...settings, direction: this.autoYaw };
  }

  /** The board camera's way while it never turns (a cutscene on the board looks that way too), else undefined. */
  private boardYaw(): number | undefined {
    const settings = this.cameraSettingsNow();
    return settings.turns ? undefined : settings.direction;
  }

  /** The space the piece the board camera watches stands on, if any. */
  private focusSpace(): Space | undefined {
    const body = this.bodyOf(this.loop?.focus);
    if (!body?.isValid) return undefined;
    const at = body.location;
    return nearestSpace(this.spaces, [at.x, at.y, at.z]);
  }

  /**
   * /boardcam (main.ts): the board camera's settings, tuned for everyone at once (camera-tuning.ts),
   * only while testing, as /minigame win. What to tell the player.
   */
  async boardCam(player: Player, word: string | undefined, value: number | undefined): Promise<string> {
    if (!this.testing) return `/boardcam ${ONLY_TESTING}`;
    return this.tuning.boardCommand(word, value, player.name);
  }

  /** /spacecam (main.ts): a space's cutscene camera, likewise. */
  async spaceCam(player: Player, word: string | undefined, value: number | undefined): Promise<string> {
    if (!this.testing) return `/spacecam ${ONLY_TESTING}`;
    return this.tuning.spaceCommand(word, value, player.name);
  }

  /** Asks the map editor to change the map (a preview's map_edit, preview-session.ts): its answer, or why there's none. */
  private saveToMap(edit: MapEdit, by: string): Promise<{ ok: boolean; message: string }> {
    const requestId = `${this.ctx.vars.sessionId}.camera.${++this.saves}`;
    return new Promise((resolve) => {
      let done = false;
      const finish = (answer: { ok: boolean; message: string }) => {
        if (done) return;
        done = true;
        stop();
        resolve(answer);
      };
      const stop = this.ctx.transport.onMessage((message) => {
        if (message.t === "map_edit_reply" && message.requestId === requestId) finish({ ok: message.ok === true, message: String(message.message ?? "") });
      });
      this.scope.timeout(() => finish({ ok: false, message: "Not saved: the map editor didn't answer." }), SAVE_WAIT);
      try {
        this.ctx.transport.send({ t: "map_edit", requestId, sessionId: this.ctx.vars.sessionId, by, edit });
      } catch (error) {
        finish({ ok: false, message: `Not saved: ${describeError(error)}` });
      }
    });
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
    this.drawRound(hidden);
    if (key === this.cardsShown) return;
    this.cardsShown = key;
    this.gameSidebar.set("cards", rows.length ? { title: codesOf(SCREEN_WORDS.cards), rows } : undefined);
  }

  /**
   * The round bottom right ("Round 3 / 10", the user's round.hud line; component blockparty_round):
   * from the first round to the end, whenever the cards show, "Round 3 /" light gray and "10" dark
   * gray (roundText). Sent when it changes.
   */
  private drawRound(cardsHidden: boolean): void {
    const rounds = this.loop?.rounds;
    const shown = !cardsHidden && this.loop?.active === true && rounds !== undefined && rounds.now >= 1;
    const text = shown ? roundText((fills) => line("round.hud", fills), rounds.now, rounds.of) : "";
    if (text === this.roundShown) return;
    this.roundShown = text;
    this.gameSidebar.set("round", text ? { title: codesOf(SCREEN_WORDS.round), rows: [roundRow(text)] } : undefined);
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
    this.squared.delete(player.name.toLowerCase());
    this.fade?.reset(player);
    try {
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HIDDEN_HUD);
    } catch (error) {
      this.tell(player, `Hiding the health, hunger and XP bars failed: ${describeError(error)}`);
    }
    // The chat stays on for whoever turned it on.
    this.showChat(player);
    if (this.boardReady) system.runTimeout(() => player.isValid && this.pieces.place(player), 10);
  }

  private async layBoard(): Promise<void> {
    const box = boardBox(this.spaces);
    const dimension = world.getDimension("overworld");
    try {
      await world.tickingAreaManager.createTickingArea(BOARD_AREA, { dimension, from: { x: box.min[0], y: box.min[1], z: box.min[2] }, to: { x: box.max[0], y: box.max[1], z: box.max[2] } });
      // A map's own board keeps its paths; the test board gets its own, with something to get over on
      // every stretch, and a plaza in the middle for the NPCs (test-board.ts).
      if (!this.ownBoard) layTestBoard(dimension, this.middle);
      // Every space's marker, standing on the floor (space-markers.ts).
      this.markers.lay();
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

  /**
   * Every tick, for each player: what their keys may do and whether vanilla's hotbar shows
   * (keepControls), and their HUD line; the cards, the turn fade, and anyone's own results screen;
   * every few ticks, the board's held item in every hotbar slot.
   */
  private keepPlayers(): void {
    this.stars.tick();
    this.keepStandings();
    for (const player of world.getAllPlayers()) {
      const tests = this.tests.get(player.name.toLowerCase());
      if (!tests) continue;
      this.keepControls(player, tests);
      this.sendLine(player, tests);
    }
    this.drawCards();
    this.keepFade();
    if (system.currentTick % STANDINGS_EVERY === 0) this.keepStandingsItems();
    this.keepSquared();
    this.keepUse();
  }

  /**
   * Every player on the board stands square to where they look (the user: turned to an NPC or the
   * camera, the body turns too, not just the head). Teleporting a player turns only their head, and
   * Minecraft brings the body round only once they walk, so the pack's animation.blockparty.square_up
   * turns their whole model by their head's turn from the body (q.target_y_rotation) on a controller
   * of its own; the head, turned relative to the entity, stays where it looks. Played again every
   * SQUARE_EVERY ticks (it's lost on a respawn), and stopped while they play a minigame.
   */
  private keepSquared(): void {
    const now = system.currentTick;
    for (const player of world.getAllPlayers()) {
      const key = player.name.toLowerCase();
      const onBoard = !this.runner.isPlaying(key);
      const since = this.squared.get(key);
      try {
        if (onBoard && (since === undefined || now - since >= SQUARE_EVERY)) {
          player.playAnimation(SQUARE_UP, { controller: SQUARE_CONTROLLER, stopExpression: "0" });
          this.squared.set(key, now);
        } else if (!onBoard && since !== undefined) {
          player.playAnimation(REST_ANIMATION, { controller: SQUARE_CONTROLLER, stopExpression: "q.any_animation_finished" });
          this.squared.delete(key);
        }
      } catch {
        // gone
      }
    }
  }

  // ---- Chat and a player's own results screen -------------------------------------------

  /** /chat (main.ts): turns the player's chat on, or off again (Block Party hides it). What to tell them. */
  toggleChat(player: Player): string {
    const key = player.name.toLowerCase();
    const on = !this.chatOn.has(key);
    if (on) this.chatOn.add(key);
    else this.chatOn.delete(key);
    this.showChat(player);
    return on ? "Chat is on. /chat hides it again." : "Chat is off. /chat brings it back.";
  }

  /** The player's chat as they last set it: hidden (the switch is CHAT_HUD, ui/hud_screen.json) unless they turned it on. */
  private showChat(player: Player): void {
    try {
      player.onScreenDisplay.setHudVisibility(this.chatOn.has(player.name.toLowerCase()) ? HudVisibility.Reset : HudVisibility.Hide, CHAT_HUD);
    } catch {
      // gone
    }
  }

  /** Every player on the board holds STANDINGS_ITEM in each empty hotbar slot (never while they play a minigame: vanilla's hotbar shows then). */
  private keepStandingsItems(): void {
    for (const player of world.getAllPlayers()) {
      if (this.runner.isPlaying(player.name.toLowerCase())) continue;
      try {
        const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
        for (let slot = 0; container && slot < HOTBAR_SIZE; slot++) {
          if (container.getItem(slot) === undefined) container.setItem(slot, standingsItem());
        }
      } catch {
        // gone
      }
    }
  }

  /**
   * A dropped STANDINGS_ITEM: it goes at once (the slot fills again), and its dropper (the nearest
   * player) gets their own results screen, or loses it if it was up.
   */
  private dropped(entity: Entity): void {
    if (entity.typeId !== "minecraft:item") return;
    try {
      if (entity.getComponent(EntityComponentTypes.Item)?.itemStack.typeId !== STANDINGS_ITEM) return;
      const at = entity.location;
      const dimension = entity.dimension.id;
      entity.remove();
      const near = world
        .getAllPlayers()
        .filter((player) => player.dimension.id === dimension)
        .map((player) => ({ player, far: distance(player.getHeadLocation(), at) }))
        .filter((one) => one.far <= DROP_REACH)
        .sort((a, b) => a.far - b.far)[0];
      if (!near) return;
      this.toggleStandings(near.player);
      this.keepStandingsItems();
    } catch {
      // gone
    }
  }

  /** The player's own results screen comes up (while there are standings and the results aren't playing for everyone), or goes. */
  private toggleStandings(player: Player): void {
    const key = player.name.toLowerCase();
    if (this.viewing.has(key)) this.viewing.delete(key);
    else if (this.standingSeats().length > 0 && !this.results.showing) this.viewing.set(key, system.currentTick + STANDINGS_TICKS);
    else return;
    this.keepStandings();
    this.sendLine(player, this.testsOf(player), true);
  }

  /** The standings now, as the results screen ranks them (none before the turn order is rolled). */
  private standingSeats(): ResultSeat[] {
    return (this.loop?.cards() ?? []).map((seat) => ({ key: seat.key, name: seat.name, stars: seat.stars, coins: seat.coins }));
  }

  /** Each tick: own results screens that ran out go (their line is sent again), and the standings are on the sidebar while anyone has one up. */
  private keepStandings(): void {
    for (const [key, until] of this.viewing) {
      if (system.currentTick < until) continue;
      this.viewing.delete(key);
      const player = world.getAllPlayers().find((candidate) => candidate.name.toLowerCase() === key);
      if (player) this.sendLine(player, this.testsOf(player), true);
    }
    const seats = this.viewing.size > 0 ? this.standingSeats() : [];
    const shown = JSON.stringify(seats);
    if (shown === this.standingsShown) return;
    this.standingsShown = shown;
    this.results.standings(seats);
  }

  /**
   * The turn fade (fade.ts): on someone's turn everyone else here fades away, players and bots, with
   * whatever follows them; nobody while there's no turn (the pre-game, the turn order roll, between
   * rounds) or while a minigame has the players (a Versus duel too).
   */
  private keepFade(): void {
    if (!this.loop?.active) return;
    // Board's view shows everyone (the user, 2026-11-18).
    const turn = this.runner.active || this.boardViewing ? undefined : this.loop.whoseTurn;
    this.fade.update([...world.getAllPlayers().map(whoOf), ...this.bots.all()], turn, this.loop.featured);
  }

  /**
   * What the player's keys may do (Controls), set when it changes: walking only off the board (a
   * minigame, where its runner also stops everything till Go, or a ride) and on the pre-game podium
   * until their roll, unless Chris is asking them something (the movement keys steer the box's
   * buttons); nothing at all on their turn (they face the turn shot) or while their piece walks, but
   * a real jump while their die is out (from DIE_JUMP_AFTER after it came out); else only looking
   * round, a jump and sneak being buttons. Back
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
      // The board's held item leaves the hotbar while vanilla's shows (keepStandingsItems puts it back after).
      if (hotbar) takeStandingsItems(player);
    }
    // Vanilla's hearts and armor too, while a minigame with real damage plays.
    const hearts = hotbar && this.runner.realDamage;
    if (tests.hearts !== hearts) {
      tests.hearts = hearts;
      try {
        player.onScreenDisplay.setHudVisibility(hearts ? HudVisibility.Reset : HudVisibility.Hide, HEARTS_HUD);
      } catch {
        // gone
      }
    }
    if (tests.jumpMode !== "free") return;
    let controls: Controls = "held";
    if (tests.rolling) controls = system.currentTick < (tests.rolling.jumpAt ?? 0) ? "locked" : "rolling";
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
   * The player's action bar: a minigame's status line while one is on (the board has none: the user
   * took its round and totals line away), the star field's strength and frame when it's up (a new
   * frame every tick, so it's sent every tick then), and their own results screen when they've
   * dropped for it. Never empty (KEEP_UP): every screen rides the action bar's panel. Sent when it
   * changes, and every BAR_RESEND ticks so it doesn't fade.
   * The board's words above the hotbar (barWords, "Alex's turn") go out without the core's HUD mark,
   * so the core pack shows them where vanilla's action bar sits; the codes after them never render.
   */
  private sendLine(player: Player, tests: PlayerTests, force = false): void {
    if (this.barWords && system.currentTick >= this.barWords.until) this.barWords = undefined;
    const name = player.name.toLowerCase();
    const mine = this.ownLines.get(name);
    const status = (mine && mine.until > system.currentTick ? mine.text : undefined) ?? this.minigameStatus ?? "";
    const tutorial = this.tutorialView;
    const own =
      (this.viewing.has(name) ? STANDINGS_CODE : "") +
      holdingCode(this.dialogue?.holdStep(player.name)) +
      (tutorial?.secondSide.has(name) ? SIDE_TWO_CODE : "") +
      (tutorial?.readyKeys.has(name) ? READY_CODE : "");
    const codes = this.stars.codes() + own;
    const words = !status && this.barWords ? this.barWords.text : "";
    const line = words ? `${words}§r${codes}` : hudLine(undefined, status, undefined, "", codes || (status ? "" : KEEP_UP));
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

  /** Hold the game on my turns, or Let the game go on (Tests): as /blockparty:hold. */
  private holdFromMenu(player: Player): void {
    const problem = this.holdGame(player);
    if (problem !== undefined) this.tell(player, problem);
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

  /** Coin and Star models (the user asked for them, for animations later): both turning side by side over the player's head for a while. */
  private iconModels(player: Player): void {
    const view = player.getViewDirection();
    const level = Math.hypot(view.x, view.z) || 1;
    // The player's right, level: their view turned a quarter about up.
    const right = { x: -view.z / level, z: view.x / level };
    const at = player.location;
    const shown = ICON_MODELS.map((id, index) => {
      const side = index === 0 ? -0.7 : 0.7;
      const model = player.dimension.spawnEntity(id, { x: at.x + right.x * side, y: at.y + 2, z: at.z + right.z * side });
      model.setProperty(TURNING_PROPERTY, true);
      return model;
    });
    this.scope.timeout(() => {
      for (const model of shown) if (model.isValid) model.remove();
    }, ICON_TEST_TICKS);
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
    const feet = player.location;
    tests.rolling = { die, at: feet, over: this.putDie(player.dimension, feet, die), jumpAt: system.currentTick + DIE_JUMP_AFTER };
    // Rolling for turn order ends the pre-game podium's walking. The jump that hits the die is a real
    // jump (the plan's turn shot: a jump makes them jump), but only DIE_JUMP_AFTER after the die comes
    // out: till then jumping stays off (keepControls turns it on) and a jump does nothing, so the
    // press that picked Dice block doesn't jump them. The camera stays: the turn shot on a turn, the
    // podium's while everyone rolls for turn order.
    this.podium.delete(player.name.toLowerCase());
    lock(player);
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

  /**
   * Board's view: the whole board for everyone, still (board-view.ts), or the board's camera again.
   * Both ways ease over the board camera's ease (the user: the way out was a cut, the way back slow
   * and cinematic; both are slow now), the field of view with it. While it's up nobody is faded
   * (keepFade): every player, bot and zombie shows.
   */
  private boardView(on: boolean): void {
    const shot = on ? boardOverview(this.spaces, this.boardYaw()) : undefined;
    this.boardViewing = shot !== undefined;
    if (shot) this.staging.shot(shot, "Pan", Math.max(0.05, this.cameraSettingsNow().ease));
    else this.staging.clear();
  }

  /** Takes the die away (the roll is over or called off); keepControls holds the player again. */
  private endRoll(player: Player): void {
    const tests = this.testsOf(player);
    this.takeDie(tests.rolling?.over);
    tests.rolling = undefined;
  }

  /** The jump that hits the die: it bursts, its number shows over their head, and the walk follows. */
  private async roll(player: Player, die: DieDef): Promise<void> {
    const tests = this.testsOf(player);
    const key = player.name.toLowerCase();
    const pending = this.pendingRolls.get(key);
    const rolled = rollDie(die, () => this.ctx.random());
    const rolling = tests.rolling;
    tests.rolling = undefined;
    this.pendingRolls.delete(key);
    // The jump that hits it: one or both fists up (the jump itself is their own). Each throw of the
    // roll is a hit of its own (the user, 2026-11-18: a Triple Die rolled three times in a row, a
    // Roll again face once more): the die comes back over their head for the next jump, and the
    // number over their head is the total so far.
    let total = 0;
    let over = rolling?.over;
    for (let i = 0; i < rolled.faces.length; i++) {
      if (i > 0) {
        await this.scope.wait(NEXT_THROW_AFTER);
        if (!player.isValid) return pending?.resolve(undefined);
        over = await this.nextThrow(player, die);
        if (!player.isValid) {
          this.takeDie(over);
          return pending?.resolve(undefined);
        }
      }
      this.moves.player(player, "Dice roll");
      total += die.faces[rolled.faces[i]].move;
      await this.scope.wait(HIT_AFTER);
      await this.burst(over, die, whoOf(player), total);
    }
    await this.scope.wait(NUMBER_TICKS);
    // Out to the board view for the walk (a turn's roll).
    if (pending?.shot) this.boardCamera.boardShot();
    pending?.resolve(rolled);
  }

  /** The die back over a player's head for another throw of their roll: resolves with it once their jump hits it (or they've gone). */
  private nextThrow(player: Player, die: DieDef): Promise<DieShown | undefined> {
    const tests = this.testsOf(player);
    const feet = player.location;
    const over = this.putDie(player.dimension, feet, die);
    return new Promise((resolve) => {
      tests.rolling = {
        die,
        at: feet,
        over,
        next: () => {
          tests.rolling = undefined;
          resolve(over);
        },
      };
    });
  }

  // ---- The menu ---------------------------------------------------------------------------

  /** The Tests menu, or with `word` (tests-menu.ts, /tests <word>) that test straight away. */
  private async menu(player: Player, word?: string): Promise<void> {
    const tests: Record<TestWord, [string, () => void | Promise<void>]> = {
      getstar: ["Get star (on your roll)", () => this.getStar(player)],
      gotospace: ["Go to a space (on your roll)", () => this.goToSpace(player)],
      skiptoround: ["Skip to a round", () => this.skipForm(player)],
      playminigame: ["Play a minigame now", () => this.minigameForm(player)],
      endtie: ["End-of-game tie", () => this.endTieForm(player)],
      piecesettings: ["Piece settings", () => this.settingsForm(player)],
      camerashots: ["Camera shots", () => this.shotsMenu(player)],
      jumptest: ["Jump test", () => this.jumpMenu(player)],
      diceanditems: ["Dice and items held", () => this.contentsForm(player)],
      hold: [this.loop?.heldBy === player.name.toLowerCase() ? "Let the game go on" : "Hold the game on my turns", () => this.holdFromMenu(player)],
      outcomes: ["Next space outcomes", () => this.outcomeForm(player)],
      trader: ["Bring the Wandering Trader", () => this.traderTest(player)],
      models: ["Coin and Star models", () => this.iconModels(player)],
      lightspaces: [this.markers.allLit ? "Space highlights back to normal" : "Light every space", () => this.markers.lightAll(!this.markers.allLit)],
      playeranimations: ["Player animations", () => this.playerAnimationsForm(player)],
      transfers: ["Transfer animations", () => this.transfersForm(player)],
      npcs: [this.npcs.spawned ? "Take the NPCs away" : "Put the NPCs out", () => this.toggleNpcs()],
      arenas: ["Arenas from other maps", () => this.arenaMenu(player)],
      testarenas: ["Test arenas", () => this.testArenaMenu(player)],
      ride: ["Ride and lead (two players)", () => this.rideMenu(player)],
      end: ["End the test game", () => this.finish(draw("ended from the Tests menu"))],
    };
    let picked: TestWord | undefined = TEST_WORDS.find((test) => test === word?.toLowerCase());
    if (word !== undefined && !picked) {
      this.tell(player, `No test called "${word}". The tests: ${TEST_WORDS.join(", ")}.`);
      return;
    }
    if (!picked) {
      const form = new ActionFormData().title("Block Party tests");
      for (const test of TEST_WORDS) form.button(tests[test][0]);
      const response = await showForm(this.scope, player, form);
      if (response?.selection === undefined) return;
      picked = TEST_WORDS[response.selection];
    }
    try {
      await tests[picked][1]();
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

  /** Skip to a round (the user asked, to try late rounds without playing up to them), or to the end of the game (pass 8). */
  private async skipForm(player: Player): Promise<void> {
    if (!this.loop.active) return this.tell(player, "Skip to a round works once the board game is on.");
    const { now, of } = this.loop.rounds;
    const form = new ModalFormData()
      .title("Skip to a round")
      .dropdown(
        "Round",
        [...Array.from({ length: of }, (_, i) => `Round ${i + 1} of ${of}`), "The end of the game (bonus Stars)"],
        { defaultValueIndex: Math.min(of - 1, now) },
      )
      .toggle("Straight to its minigame", { defaultValue: true });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [index, minigameOnly] = values as [number, boolean];
    this.callOffRoll(player);
    if (index >= of) {
      this.loop.testJump({ kind: "end" });
      this.tell(player, "On to the end of the game once the turn going on ends.");
      return;
    }
    this.loop.testJump({ kind: "round", round: index + 1, minigameOnly });
    this.tell(player, `On to round ${index + 1}${minigameOnly ? "'s minigame" : ""} once the turn going on ends.`);
  }

  /**
   * End-of-game tie (pass 8, to try the tiebreaker): after the bonus Stars, the top 2, 3 or 4 are
   * made level with the leader, and the sudden death can be made to decide nothing, so the Allay
   * picks. Set any time; it's used at the end.
   */
  private async endTieForm(player: Player): Promise<void> {
    if (!this.loop) return this.tell(player, "Block Party isn't running yet.");
    const now = this.loop.endTestNow;
    const ties = ["No tie", "The top 2", "The top 3", "All 4"];
    const form = new ModalFormData()
      .title("End-of-game tie")
      .dropdown("Tied for first after the bonus Stars", ties, { defaultValueIndex: Math.max(0, now.tie - 1) })
      .toggle("The sudden death decides nothing (the Allay picks)", { defaultValue: now.stillTied });
    const values = (await showForm(this.scope, player, form))?.formValues;
    if (!values) return;
    const [index, stillTied] = values as [number, boolean];
    const tie = index === 0 ? 0 : index + 1;
    this.loop.setEndTest({ tie, stillTied });
    this.tell(player, tie === 0 ? "End-of-game tie: off." : `End-of-game tie: the top ${tie} will be tied after the bonus Stars${stillTied ? ", and the sudden death will decide nothing" : ""}. Skip to a round has The end of the game.`);
  }

  /** Play a minigame now (the user asked): any minigame in any of its formats, next, then the turns go on. */
  private async minigameForm(player: Player): Promise<void> {
    if (!this.loop.active) return this.tell(player, "Play a minigame works once the board game is on.");
    const formatName: Record<Format, string> = { ffa: "free for all", battle: "Battle", "2v2": "2 vs 2", "1v3": "1 vs 3", duel: "duel" };
    // The minigame, then its format when it has more than one.
    const form = new ActionFormData().title("Play a minigame now");
    for (const def of MINIGAMES) form.button(def.name);
    const picked = (await showForm(this.scope, player, form))?.selection;
    if (picked === undefined) return;
    const def = MINIGAMES[picked];
    const formats: Format[] = def.kind === "ffa" ? ["ffa", "battle"] : [def.kind];
    let format = formats[0];
    if (formats.length > 1) {
      const which = new ActionFormData().title(def.name);
      for (const each of formats) which.button(formatName[each]);
      const chosen = (await showForm(this.scope, player, which))?.selection;
      if (chosen === undefined) return;
      format = formats[chosen];
    }
    const entry = { def, format, label: `${def.name}: ${formatName[format]}` };
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

  /**
   * Player animations (Tests): every animation of the players' sets, each played on the player who
   * picks it (seen from outside: F5, or another player watching). The game picks one of a set's at
   * random; here each one can be seen on its own.
   */
  private async playerAnimationsForm(player: Player): Promise<void> {
    const clips = playerClips(CLIPS);
    const form = new ActionFormData().title("Player animations").body("Each plays on you. Press F5 to see yourself, or have someone watch.");
    for (const clip of clips) form.button(clip.name.replace("animation.blockparty.player.", "").replace(/_/g, " ").replace(".", ": "));
    const picked = (await showForm(this.scope, player, form))?.selection;
    const clip = picked === undefined ? undefined : clips[picked];
    if (!clip || !player.isValid) return;
    player.playAnimation(clip.name, { controller: PLAYER_ANIMATION, stopExpression: "q.any_animation_finished", blendOutTime: 0.2 });
  }

  /**
   * Transfer animations (Tests): each kind of transfer played round the player, shown only (nobody's
   * coins or hands change). An NPC that gives or takes stands a few blocks in front of them for it.
   * Seat to seat ones are hand-overs (handovers.ts): the camera on the giver, then on each taker.
   */
  private async transfersForm(player: Player): Promise<void> {
    const random = () => this.ctx.random();
    const item = (): Token => ({ kind: "item", id: ITEM_IDS[Math.floor(random() * ITEM_IDS.length)] });
    const dieIds = Object.keys(DICE);
    const die = (): Token => ({ kind: "die", id: dieIds[Math.floor(random() * dieIds.length)] });
    const others = () => [...world.getAllPlayers().filter((one) => one.name !== player.name).map(whoOf), ...this.bots.all()];
    // A hand-over between seats, shown only: the camera's cuts and the tokens (the loop plays it as a pass would).
    const handOver = async (passes: (them: readonly Who[], me: Who) => Pass[], me: Who) => {
      const them = others();
      if (them.length === 0) {
        this.tell(player, "Nobody else is here: start with a bot, or have someone join.");
        return;
      }
      await this.loop.playPasses(passes(them, me));
    };
    const demos: [string, string | undefined, (npc: Entity | undefined, me: Who) => Promise<void>][] = [
      ["10 coins from Chris", "chris", (npc, me) => this.transfers.give(npc, me, "coin", 10)],
      ["25 coins to Chris", "chris", (npc, me) => this.transfers.give(me, npc, "coin", 25)],
      ["A Star from Chris", "chris", (npc, me) => this.transfers.give(npc, me, "star", 1)],
      ["An item from the Villager", "villager", (npc, me) => this.transfers.give(npc, me, item(), 1)],
      ["A die from the Villager", "villager", (npc, me) => this.transfers.give(npc, me, die(), 1)],
      ["An item to the Villager, coins back", "villager", async (npc, me) => {
        await this.transfers.give(me, npc, item(), 1);
        await this.transfers.give(npc, me, "coin", 4);
      }],
      ["7 coins to the Witch", "witch", (npc, me) => this.transfers.give(me, npc, "coin", 7)],
      ["3 coins from the bank (a Blue space)", undefined, (_npc, me) => this.transfers.give(undefined, me, "coin", 3)],
      ["3 coins lost (a Red space)", undefined, (_npc, me) => this.transfers.give(me, undefined, "coin", 3)],
      ["A Star lost", undefined, (_npc, me) => this.transfers.give(me, undefined, "star", 1)],
      ["Hand-over: 5 coins to another player or a bot", undefined, (_npc, me) => handOver((them) => [{ from: me.key, to: them[0].key, token: "coin", count: 5 }], me)],
      ["Hand-over: 3 coins to each of the others", undefined, (_npc, me) => handOver((them) => them.map((one) => ({ from: me.key, to: one.key, token: "coin" as const, count: 3 })), me)],
      ["Hand-over: a Star from another player or a bot", undefined, (_npc, me) => handOver((them) => [{ from: them[0].key, to: me.key, token: "star", count: 1 }], me)],
      ["Hand-over: items passed round (Gift Exchange)", undefined, (_npc, me) => handOver((them) => {
        const ring = [me, ...them];
        return ring.map((one, i) => ({ from: one.key, to: ring[(i + 1) % ring.length].key, token: item(), count: 1 }));
      }, me)],
    ];
    const form = new ActionFormData().title("Transfer animations").body("Each one plays round you. Shown only: nobody's coins change.");
    for (const [label] of demos) form.button(label);
    const picked = (await showForm(this.scope, player, form))?.selection;
    const demo = picked === undefined ? undefined : demos[picked];
    if (!demo || !player.isValid) return;
    const [, role, run] = demo;
    const npc = role ? this.demoNpc(player, role) : undefined;
    // A moment for the NPC to be there on everyone's screen.
    if (npc) await this.scope.wait(6);
    try {
      await run(npc, whoOf(player));
    } finally {
      this.scope.timeout(() => {
        try {
          if (npc?.isValid) npc.remove();
        } catch {
          // gone
        }
      }, 30);
    }
  }

  /** An NPC for a test, a few blocks in front of the player, facing them. */
  private demoNpc(player: Player, role: string): Entity | undefined {
    const view = player.getViewDirection();
    const level = Math.hypot(view.x, view.z) || 1;
    const at = { x: player.location.x + (view.x / level) * 4, y: player.location.y, z: player.location.z + (view.z / level) * 4 };
    try {
      const npc = player.dimension.spawnEntity(`blockparty:${role}`, at);
      const yaw = (Math.atan2(-(player.location.x - at.x), player.location.z - at.z) * 180) / Math.PI;
      npc.setRotation({ x: 0, y: yaw });
      return npc;
    } catch (error) {
      this.tell(player, `The ${role} couldn't stand there: ${describeError(error)}`);
      return undefined;
    }
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

  // ---- Use and jumps ---------------------------------------------------------------------------

  /** Use goes down (the board's item's lasting use starts). */
  private useGoesDown(player: Player): void {
    const key = player.name.toLowerCase();
    if (!this.useDown.has(key)) this.useDown.set(key, { since: system.currentTick });
  }

  /** Use comes up. */
  private useGoesUp(player: Player): void {
    this.useDown.delete(player.name.toLowerCase());
  }

  /** A right click on a block or a mob: use is down till its events stop coming (keepUse lets it go). */
  private useOnTarget(player: Player): void {
    const key = player.name.toLowerCase();
    const down = this.useDown.get(key);
    const until = system.currentTick + USE_ON_TARGET;
    if (down) {
      if (down.until !== undefined) down.until = until;
      return;
    }
    this.useDown.set(key, { since: system.currentTick, until });
  }

  /** Each tick: a right click on a block or a mob whose events have stopped is let go. */
  private keepUse(): void {
    for (const [key, down] of [...this.useDown]) {
      if (down.until !== undefined && down.until < system.currentTick) this.useDown.delete(key);
    }
  }

  /** Whether a player holds use down now (the skip vote's button: dialogue.ts counts how long). */
  private holdingUse(player: Player): boolean {
    return this.useDown.has(player.name.toLowerCase());
  }

  /** A jump: the board's button (the user, 2026-11-18: the controller's A, the space bar), and the jump that hits the die. */
  private jumped(player: Player): void {
    const tests = this.testsOf(player);
    // The die back for another throw of the same roll: the jump hits it.
    if (tests.rolling?.next) {
      tests.rolling.next();
      return;
    }
    // The results screen once its changes have played: going on from it.
    if (this.results.jumped(player)) return;
    // The dialogue box: its steerer's pick, or going on.
    if (this.dialogue.jumped(player)) return;
    // A minigame's rules: a jump is Ready.
    if (this.runner.jumped(player)) return;
    // The die just out (DIE_JUMP_AFTER): a jump doesn't hit it yet.
    if (tests.rolling && system.currentTick < (tests.rolling.jumpAt ?? 0)) return;
    // The board menu and item panel: the active player's pick, and in the dice panel the hit.
    if (this.boardMenu.jumped(player)) return;
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
    form.button(this.slowLoads ? "Slow loads: on (4 s more, to see the star field)" : "Slow loads: off");
    actions.push(() => {
      this.slowLoads = !this.slowLoads;
      this.tell(player, `Slow loads ${this.slowLoads ? "on: every move between the board and an arena takes 4 s longer, so the star field shows" : "off"}.`);
    });
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    await actions[response.selection]?.();
  }

  /**
   * The minigame announcement's star field comes over everyone's view the way the old loading screen
   * did (the user asked for that fade back, 2026-11-18): the screen fades to black (a camera fade),
   * then the star field fades in over the black a level a tick (the HUD draws over a camera fade),
   * its stars rushing out of the middle a frame a tick (stars.ts), and the black goes behind it once
   * it's fully up (at full strength its still stars far behind are opaque). Resolves once it's fully
   * up (at once when it is already).
   */
  private async starsIn(): Promise<void> {
    if (this.stars.level >= STAR_LEVELS) return;
    // Black, held until the stars are fully up over it, then gone behind them.
    this.blackFade(0.4, 0.4 + (STARS_AFTER_BLACK + STAR_LEVELS * STAR_STEP + 4) / 20, 0.2);
    await this.scope.wait(8 + STARS_AFTER_BLACK);
    while (this.stars.level < STAR_LEVELS) await this.starsAt(this.stars.level + 1);
  }

  /**
   * The way out, as the old loading screen's: black again behind the star field, held while it fades
   * out to the black; then `reveal` runs (the camera's way down into the new place) as the black
   * lifts on it.
   */
  private async starsOut(reveal?: () => void): Promise<void> {
    if (this.stars.level > 0) {
      this.blackFade(0.2, (STAR_LEVELS * STAR_STEP + 6) / 20, 0.6);
      await this.scope.wait(5);
      while (this.stars.level > 0) await this.starsAt(this.stars.level - 1);
    }
    reveal?.();
  }

  /** A camera fade to black for everyone, in, held and out over these seconds. */
  private blackFade(fadeInTime: number, holdTime: number, fadeOutTime: number): void {
    for (const player of world.getAllPlayers()) {
      try {
        player.camera.fade({ fadeTime: { fadeInTime, holdTime, fadeOutTime }, fadeColor: { red: 0, green: 0, blue: 0 } });
      } catch {
        // gone
      }
    }
  }

  /**
   * A move behind the star field, for everyone: it comes (unless it's up already), the work is done
   * (a long placement stalls the server; the screen holds), it holds CLIENT_LOAD ticks more while
   * clients load the new place's chunks, then it goes as `reveal` takes the camera down into the new
   * place.
   */
  private async behindStars(work: () => void | Promise<void>, reveal?: () => void): Promise<void> {
    await this.starsIn();
    try {
      // The full strength is sent: the stall can't hide it.
      await this.scope.wait(2);
      if (this.slowLoads) await this.scope.wait(SLOW_LOAD);
      await work();
      await this.scope.wait(CLIENT_LOAD);
    } finally {
      await this.starsOut(reveal);
    }
  }

  /** The star field at `level` for everyone, then STAR_STEP ticks' wait. */
  private async starsAt(level: number): Promise<void> {
    this.stars.level = level;
    for (const player of world.getAllPlayers()) this.sendLine(player, this.testsOf(player));
    await this.scope.wait(STAR_STEP);
  }

  /** Whether the board's camera takes over again once a minigame is over (the board game is in its rounds). */
  private boardCameraBack(): boolean {
    return this.loop.active && this.loop.rounds.now >= 1;
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
    await this.behindStars(async () => {
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
    await this.behindStars(() => {
      for (const player of world.getAllPlayers()) this.pieces.place(player);
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    });
    this.everyone("Back on the board.");
  }

  // ---- Test arenas ------------------------------------------------------------------------

  /**
   * Every minigame's test arena (the user asked, 2026-11-26): the built ones' own, the rest from
   * test-arenas.ts, a tiled one as many copies side by side as fit. Laid where arenas go behind the
   * star field, everyone moved onto it, its marks shown for a minute. Testing only.
   */
  private async testArenaMenu(player: Player): Promise<void> {
    if (this.runner.active) return this.tell(player, "Test arenas wait until the minigame on now is over.");
    const form = new ActionFormData().title("Test arenas");
    const actions: (() => Promise<void>)[] = [];
    for (const arena of ARENAS) {
      const built = MINIGAMES.some((def) => def.id === arena.id);
      if (!built && !TEST_ARENAS[arena.id]) continue;
      form.button(built ? arena.name : `${arena.name} (not built)`);
      actions.push(() => this.layTestArenaFor(arena.id, arena.name));
    }
    if (this.testArena) {
      form.button("Back to the board");
      actions.push(() => this.leaveTestArena());
    }
    const response = await showForm(this.scope, player, form);
    if (response?.selection === undefined) return;
    await actions[response.selection]?.();
  }

  private async layTestArenaFor(id: string, name: string): Promise<void> {
    const def = MINIGAMES.find((candidate) => candidate.id === id);
    const plan = TEST_ARENAS[id];
    if (!def && !plan) return;
    const size = def ? def.size : plan.size;
    const copies = def ? 1 : testArenaCopies(id);
    const { middle } = this.arenaPlace();
    const min = { x: Math.floor(middle.x - (size[0] * copies) / 2), y: Math.floor(middle.y), z: Math.floor(middle.z - size[2] / 2) };
    const max = { x: min.x + size[0] * copies - 1, y: min.y + size[1] - 1, z: min.z + size[2] - 1 };
    const dimension = world.getDimension("overworld");
    const before = this.testArena;
    this.testArena = undefined;
    let field: Field | undefined;
    let failed: string[] = [];
    await this.behindStars(async () => {
      before?.stop();
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
      const from = before ? { x: Math.min(min.x, before.min.x), y: Math.min(min.y, before.min.y), z: Math.min(min.z, before.min.z) } : min;
      const to = before ? { x: Math.max(max.x, before.max.x), y: Math.max(max.y, before.max.y), z: Math.max(max.z, before.max.z) } : max;
      await manager.createTickingArea(ARENA_AREA, { dimension, from, to });
      if (before) fill(dimension, before.min, before.max, "minecraft:air");
      fill(dimension, min, max, "minecraft:air");
      if (def) def.build(dimension, min, Math.random);
      else failed = layTestArena(dimension, plan, min, copies);
      field = def ? def.testField(min) : testArenaField(plan, min);
      const start = field.spawns[0] ?? field.teamSpawns(PAINTER_TEAMS[0].id)[0] ?? this.standingSpot(min, { x: size[0], y: size[1], z: size[2] });
      for (const each of world.getAllPlayers()) {
        this.pieces.release(each);
        each.teleport(start);
      }
    });
    if (!field) return;
    const shown = this.showMarks(id, field);
    this.testArena = { min, max, stop: shown.stop };
    const killY = def ? undefined : plan.killY;
    const copiesText = copies > 1 ? `, ${copies} copies side by side` : "";
    const killText = killY !== undefined ? `; Kill Y ${min.y + killY}` : "";
    const failedText = failed.length > 0 ? ` Not placed (not on this server): ${failed.join(", ")}.` : "";
    this.everyone(`${name}'s test arena (testing only), ${size[0]} x ${size[1]} x ${size[2]}${copiesText}. Its marks, shown for a minute (green spawns, blue points, flames at each box's corners): ${shown.summary}${killText}.${failedText}`);
  }

  /** Every mark a test arena's checklist names (arenas.ts, the podium aside), shown with particles for a minute; and a line saying what they are. */
  private showMarks(id: string, field: Field): { summary: string; stop: () => void } {
    const arena = ARENAS.find((candidate) => candidate.id === id);
    const teams = arena?.teams ? PAINTER_TEAMS.map((team) => team.id) : [];
    const spots: Spot[] = [...field.spawns, ...teams.flatMap((team) => field.teamSpawns(team))];
    const parts: string[] = [];
    if (field.spawns.length > 0) parts.push(`${field.spawns.length} spawns`);
    for (const team of teams) parts.push(`${field.teamSpawns(team).length} ${team} spawns`);
    const points: Spot[] = [];
    const corners: Vector3[] = [];
    for (const [key, label] of markKeys(arena?.map?.points, teams)) {
      const found = field.points(key);
      points.push(...found);
      parts.push(`${label} ${found.length}`);
    }
    for (const [key, label] of markKeys(arena?.map?.regions, teams)) {
      const found = field.regions(key);
      for (const box of found) {
        for (const x of [box.min.x, box.max.x + 1]) for (const y of [box.min.y, box.max.y + 1]) for (const z of [box.min.z, box.max.z + 1]) corners.push({ x, y, z });
      }
      parts.push(`${label} (box) ${found.length}`);
    }
    const dimension = world.getDimension("overworld");
    const spawn = (particle: string, at: Vector3) => {
      try {
        dimension.spawnParticle(particle, at);
      } catch {
        // not loaded
      }
    };
    const timer = this.scope.interval(() => {
      for (const spot of spots) spawn("minecraft:villager_happy", { x: spot.x, y: spot.y + 0.5, z: spot.z });
      for (const spot of points) spawn("minecraft:blue_flame_particle", { x: spot.x, y: spot.y + 0.5, z: spot.z });
      for (const corner of corners) spawn("minecraft:basic_flame_particle", corner);
    }, 10);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      system.clearRun(timer);
    };
    this.scope.timeout(stop, MARKS_SHOWN);
    return { summary: parts.length > 0 ? parts.join(", ") : "none", stop };
  }

  private async leaveTestArena(): Promise<void> {
    const laid = this.testArena;
    if (!laid) return;
    this.testArena = undefined;
    await this.behindStars(() => {
      laid.stop();
      for (const player of world.getAllPlayers()) this.pieces.place(player);
      fill(world.getDimension("overworld"), laid.min, laid.max, "minecraft:air");
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    });
    this.everyone("Back on the board; the test arena is cleared.");
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
    // A die model a bot's roll left, or a number over a head (the game ended in the middle of it).
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

/** The block a die without a model floats in over a body standing at `feet`: 3 over the block they stand in. */
function blockOverHead(feet: Vector3): Vector3 {
  return { x: Math.floor(feet.x), y: Math.floor(feet.y) + 3, z: Math.floor(feet.z) };
}

/** The board's held item (STANDINGS_ITEM): one, kept on death. */
function standingsItem(): ItemStack {
  const item = new ItemStack(STANDINGS_ITEM, 1);
  item.keepOnDeath = true;
  return item;
}

/** Takes STANDINGS_ITEM out of the player's hotbar (a minigame gives them vanilla's hotbar). */
function takeStandingsItems(player: Player): void {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    for (let slot = 0; container && slot < HOTBAR_SIZE; slot++) {
      if (container.getItem(slot)?.typeId === STANDINGS_ITEM) container.setItem(slot, undefined);
    }
  } catch {
    // gone
  }
}

/** Block Party's confetti (resource_pack/particles/confetti.json): paper in party colors, bursting up and fluttering down. */
const CONFETTI = "blockparty:confetti";

/** Confetti bursting over a body's head (a win, a Star gained: the user, 2026-11-18). */
function confettiOver(body: Entity): void {
  try {
    if (!body.isValid) return;
    const at = body.location;
    body.dimension.spawnParticle(CONFETTI, { x: at.x, y: at.y + 2.3, z: at.z });
  } catch {
    // unloaded
  }
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

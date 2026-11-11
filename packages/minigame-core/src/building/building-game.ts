// What the building games (Build Swap, Guess the Build) share, as a base class on Minigame. The map
// holds one arena with a build area and a spawn in it (game/arenas.ts); once the prompt form before
// the match is done, the arena is copied side by side, one for each player, and each copy's build
// area is a Plot. A game runs its own rounds on them (buildRound), shows builds again from snapshots,
// and has everyone vote on them (voteOn) with the terracotta blocks in their hotbar.
//
// Players build in creative mode, only inside the build area they're working on (they can change any
// block there, and /floor lays the block in hand across its bottom; the selection wand and /set,
// /replace and /fix work there too), and are kept within the map's build padding of it (put back once
// they've been past it for the map's return delay). In a round's prep time they can take blocks from
// creative's inventory, but not build yet. Out of their rounds they're still in creative (so voters
// can fly; adventure mode can't), but keep nothing from creative's inventory: a voter only their vote
// blocks (and whatever a game hands out, keepsItem). Voters are kept within the same padding of the
// build being voted on, put back at once; one who still hasn't voted after voteNagSeconds gets a big
// "Vote!" and a wither's roar, again each time that passes. Nothing spawned (mobs, items, armor
// stands) stays, TNT and fire do nothing, and liquids that run out of an area are cleared. Blocks
// that fall (concrete powder, sand, gravel, anvils) stay where they're put: each becomes its twin that
// doesn't (still-blocks.ts).
import {
  BlockPermutation,
  BlockVolume,
  Direction,
  EntityComponentTypes,
  EntityInitializationCause,
  EquipmentSlot,
  GameMode,
  ItemLockMode,
  ItemStack,
  system,
  world,
  type Block,
  type Entity,
  type Player,
  type Vector3,
} from "@minecraft/server";
import type { GameConfig } from "../config.ts";
import { ArenaTiles, shiftBox, shiftPosition } from "../game/arenas.ts";
import { inside } from "../game/map-view.ts";
import { Minigame, type GameContext, type SpawnReason } from "../game/minigame.ts";
import { drawOutline, OUTLINE_REFRESH_TICKS, outlineColor } from "../game/outline.ts";
import { PromptBank } from "../game/prompt-bank.ts";
import { draw, type Result } from "../game/results.ts";
import { countdownChime, hudText } from "../hud.ts";
import { describeError, log } from "../log.ts";
import { facingOf, worldPoint, type Box, type MapPosition, type Vec3 } from "../map-config.ts";
import { cleanPrompt, dealPrompts, PROMPT_MAX_CHARS, type DealablePrompt } from "../prompts.ts";
import type { PromptKind } from "../protocol/index.ts";
import type { Scope } from "../scope.ts";
import { COLOR, nameOf, ordinal, say } from "../text.ts";
import { ARENA_REGION, BUILD_PADDING, PLOT_REGION, RETURN_DELAY } from "./building-map.ts";
import { DEFAULT_STARTERS, DEFAULT_TWISTS } from "./default-prompts.ts";
import { blockInside, clampInto, floorOf, grow, LiquidGuard, Snapshots, type Plot } from "./plots.ts";
import { PromptForm, type TextAnswer } from "./prompt-form.ts";
import { SELECTION_HEX, WAND, WAND_NAME, boxVolume, clipBox, cornersBox, fillPieces, fixCells, sizeText, type Corners, type FixCell } from "./selection.ts";
import { stillStates, stillTwin } from "./still-blocks.ts";
import { Ballot, VOTES, votePoints, voteText } from "./votes.ts";

/** How often the prompt form's status and the players near their areas are checked, in ticks. */
const CHECK_TICKS = 10;
/** How long the game waits for the prompt bank's reply before dealing without it. */
export const BANK_WAIT_TICKS = 60;
/** The most prompts of a kind asked of the bank: three per player, so everyone can get one that isn't their own. */
const BANK_PER_PLAYER = 3;
/** Liquids that ran out of an area are cleared this often. */
const LIQUID_TICKS = 20;
/** A preview's fake players vote somewhere in this many ticks. */
const FAKE_VOTE_TICKS = [20, 80];
/** What a player hears when their vote counts. */
const VOTE_SOUND = "random.orb";
/** Dealt when every prompt is used up, which a full game list makes rare. */
export const FALLBACK_PROMPTS: Record<PromptKind, string> = { starter: "Anything you like", twist: "Make it bigger" };
/** What a voter who hasn't voted hears with the "Vote!" title: loud on purpose (the user's ask). */
const NAG_SOUND = "mob.wither.spawn";
/** The most dots a selection takes a refresh. */
const SELECTION_DOTS = 300;
const SELECTION_COLOR = outlineColor(SELECTION_HEX);
/** Where armor and the off hand go: emptied with the inventory out of building time. */
const WORN = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet, EquipmentSlot.Offhand];

const FACE_OFFSETS: Record<Direction, Vector3> = {
  [Direction.Down]: { x: 0, y: -1, z: 0 },
  [Direction.Up]: { x: 0, y: 1, z: 0 },
  [Direction.North]: { x: 0, y: 0, z: -1 },
  [Direction.South]: { x: 0, y: 0, z: 1 },
  [Direction.West]: { x: -1, y: 0, z: 0 },
  [Direction.East]: { x: 1, y: 0, z: 0 },
};

/** What a building game's config adds to a game's. */
export interface BuildingGameConfig extends GameConfig {
  /** The prompt form before the match: seconds until it closes, skipping whoever hasn't answered. */
  promptSeconds: number;
  /** Seconds to read a prompt and look around before building starts, each round. */
  prepSeconds: number;
  /** Once everyone has voted on a build, seconds until the next one (votes can still change). */
  voteGraceSeconds: number;
  /** A voter who hasn't voted this long after a build shows gets a big "Vote!" title and a wither's roar, again each time it passes. */
  voteNagSeconds: number;
  /** A build nobody can vote on (only its builder is here, or its builder left) shows this long. */
  showSeconds: number;
}

/** A text box of the prompt form before the match: one kind of prompt. */
export interface PromptField {
  kind: PromptKind;
  label: string;
  description: string;
}

/** What a player wrote before the match (by kind), or that they skipped (or ran out of time). */
export type PromptAnswers = Partial<Record<PromptKind, string>> | "skip";

/** One player's part in a building round: where they build, their line top right, their title, and a line in chat. */
export interface BuildJob {
  name: string;
  plot: Plot;
  line: string;
  title: [title: string, subtitle: string];
  message?: string;
}

/** Where a participant must stay, and since when (tick) they've been out of it. */
interface KeepIn {
  name: string;
  box: Box;
  plot: Plot;
  /** How long they may stay out before they're put back, in ticks. */
  graceTicks: number;
  outSince?: number;
}

export const keyOf = (name: string): string => name.toLowerCase();
const corner = (at: readonly number[]): Vector3 => ({ x: at[0], y: at[1], z: at[2] });

/** A shuffled copy. */
export function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** "m:ss". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Each player's points, highest first (names in the order given break no ties: equal points share a place). */
export function standings(points: ReadonlyMap<string, number>, names: readonly string[]): { name: string; points: number; place: number }[] {
  const rows = names.map((name) => ({ name, points: points.get(keyOf(name)) ?? 0 })).sort((a, b) => b.points - a.points);
  return rows.map((row) => ({ ...row, place: 1 + rows.filter((other) => other.points > row.points).length }));
}

/** "1 point", "5 points". */
export function pointsText(points: number): string {
  return points === 1 ? "1 point" : `${points} points`;
}

/** Water or lava for a block that is either (still or flowing); undefined for anything else. */
function liquidAt(typeId: string | undefined): "water" | "lava" | undefined {
  if (typeId === undefined || !["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"].includes(typeId)) return undefined;
  return typeId.includes("lava") ? "lava" : "water";
}

/** What a builder's block id is placed as: its twin when it would fall; undefined for something that isn't a block. */
function placeable(typeId: string): BlockPermutation | undefined {
  const twin = stillTwin(typeId);
  try {
    return BlockPermutation.resolve(twin ? twin.still : typeId);
  } catch {
    return undefined;
  }
}

export abstract class BuildingGame<C extends BuildingGameConfig> extends Minigame<C> {
  /** The build area of each copy of the arena, in tile order, once it's copied (before the match). */
  protected plots: Plot[] = [];
  protected bank!: PromptBank;
  protected readonly snapshots: Snapshots;
  /** What each player wrote (or skipped), by lowercase name; kept if a countdown falls through. */
  protected readonly answers = new Map<string, PromptAnswers>();
  /** Who's building where right now (only while building is on). */
  protected readonly working = new Map<string, Plot>();
  /** Each player's line after the clock, while there's no vote. */
  protected readonly lines = new Map<string, string>();
  /** The vote under way. */
  protected ballot: Ballot | undefined;
  /** Each player's points from votes, by lowercase name. */
  protected readonly points = new Map<string, number>();
  /** How many took part when the match began: one left of several wins. */
  protected startedWith = 0;
  protected building = false;
  private arenas: ArenaTiles | undefined;
  private liquids: LiquidGuard | undefined;
  private watchingLiquids = false;
  private readonly forms = new Map<string, PromptForm>();
  /** Where each participant must stay: their area while building, the one being looked at otherwise. */
  private readonly keepIn = new Map<string, KeepIn>();
  /** Each builder's selection corners (the wand), by lowercase name; cleared every round. */
  private readonly corners = new Map<string, Corners>();
  /** A preview's /skip ended the prompt form's wait. */
  private promptsSkipped = false;

  constructor(ctx: GameContext, gameConfig: C) {
    super(ctx, gameConfig);
    this.gameMode = GameMode.Creative;
    this.snapshots = new Snapshots(gameConfig.id);
  }

  /** The prompt form's boxes before the match, each a kind of prompt the game deals. */
  protected abstract promptFields(): readonly PromptField[];

  /** Items the game acts on when used (right click), instead of placing them, besides the vote blocks: onUse runs. */
  protected usesItem(_typeId: string): boolean {
    return false;
  }

  /** A player used one of the game's own items (usesItem). */
  protected onUse(_name: string, _typeId: string): void {}

  /** Whether a player out of their building time keeps this item in this slot (besides a voter's vote blocks). */
  protected keepsItem(_name: string, _slot: number, _typeId: string): boolean {
    return false;
  }

  pointsOf(name: string): number {
    return this.points.get(keyOf(name)) ?? 0;
  }

  /**
   * The map's arena, its build area and its spawn: what's copied once per player. An arena missing
   * from the map is the build area itself; undefined when there's no build area.
   */
  protected layout(): { arena: Box; plot: Box; spawn: MapPosition } | undefined {
    const plot = this.map.regions(PLOT_REGION)[0];
    if (!plot) return undefined;
    const middle: MapPosition = [Math.floor((plot.min[0] + plot.max[0]) / 2), plot.min[1], Math.floor((plot.min[2] + plot.max[2]) / 2)];
    return { arena: this.map.regions(ARENA_REGION)[0] ?? plot, plot, spawn: this.map.spawns[0] ?? middle };
  }

  protected override setup(): void {
    this.bank = new PromptBank(this.ctx, this.scope, this.config.id);
    const layout = this.layout();
    if (layout) this.arenas = new ArenaTiles({ arena: layout.arena, most: this.config.maxPlayers, name: this.config.id, scope: this.scope, map: this.map });
    else log.error(`${this.config.id}: the map has no build area (its "${PLOT_REGION}" region)`);
    this.scope.add(() => this.snapshots.dispose());
    this.scope.add(() => this.closeForms());

    // Building: only in the area a player is working on, and only while building is on. Vote blocks
    // (and the game's own items) are used instead of being placed.
    this.scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      const name = event.player.name;
      const typeId = event.itemStack?.typeId;
      // The wand's right click picks the second corner, and does nothing else (no stripped logs).
      if (typeId === WAND) {
        event.cancel = true;
        const at = event.block.location;
        if (event.isFirstEvent !== false) system.run(() => this.pickCorner(name, "second", at));
        return;
      }
      if (typeId !== undefined && ((votePoints(typeId) !== undefined && this.ballot) || this.usesItem(typeId))) {
        event.cancel = true;
        if (event.isFirstEvent !== false) system.run(() => this.used(name, typeId));
        return;
      }
      const box = this.workBox(name);
      const offset = FACE_OFFSETS[event.blockFace] ?? { x: 0, y: 0, z: 0 };
      const at = event.block.location;
      const beside = { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z };
      if (!box || !(blockInside(at, box) || (event.itemStack !== undefined && blockInside(beside, box)))) event.cancel = true;
    });
    this.scope.subscribeBefore(world.beforeEvents.playerBreakBlock, (event) => {
      // The wand's left click picks the first corner instead of breaking the block.
      if (event.itemStack?.typeId === WAND) {
        event.cancel = true;
        const [name, at] = [event.player.name, event.block.location];
        system.run(() => this.pickCorner(name, "first", at));
        return;
      }
      const box = this.workBox(event.player.name);
      if (!box || !blockInside(event.block.location, box)) event.cancel = true;
    });
    // A placement that still landed outside (a tall block's top half) is taken back. One that falls
    // becomes its twin that doesn't, before it can (two ticks later).
    this.scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player, block }) => {
      const box = this.workBox(player.name);
      if (box && blockInside(block.location, box)) return this.keepStill(block);
      try {
        block.setType("minecraft:air");
      } catch {
        // gone already
      }
    });
    this.scope.interval(() => this.drawSelections(), OUTLINE_REFRESH_TICKS);
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => this.used(source.name, itemStack.typeId));
    // Nothing spawned stays: mobs from eggs, dropped items, armor stands, thrown things. The map's own
    // entities (loaded with their chunks) and Minecade's (a preview's fake players) do.
    this.scope.subscribe(world.afterEvents.entitySpawn, ({ entity, cause }) => {
      if (cause === EntityInitializationCause.Loaded) return;
      this.removeSpawned(entity);
    });
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => this.ballot?.remove(playerName));
    this.scope.interval(() => {
      this.keepNear();
      this.keepHandsEmpty();
    }, CHECK_TICKS);
  }

  /** A vote block or one of the game's items, used. */
  private used(name: string, typeId: string): void {
    const points = votePoints(typeId);
    if (points !== undefined) this.castVote(name, points);
    else if (this.usesItem(typeId)) this.onUse(name, typeId);
  }

  // ---- The prompt form, and the arena's copies ------------------------------------------------

  /**
   * Everyone writes their prompts, or skips: each player's form stays up until they do. Once
   * everyone has, or promptSeconds are up (whoever hasn't is skipped), the arena is copied for
   * everyone and the match starts. What they wrote goes to the prompt bank at once, and the bank is
   * asked for prompts to deal.
   */
  protected override async beforeCountdown(_names: string[], scope: Scope): Promise<boolean> {
    const step = scope.child("prompts");
    step.add(() => this.closeForms());
    this.promptsSkipped = false;
    try {
      for (let left = this.config.promptSeconds * 20; ; left -= CHECK_TICKS) {
        if (this.decided) return false;
        if (this.online().length < this.minPlayers) {
          this.broadcast(say.warn("Not enough players. Waiting again."));
          return false;
        }
        const waiting = this.writers().filter((name) => !this.answers.has(keyOf(name)));
        if (waiting.length === 0 || left <= 0 || this.promptsSkipped) break;
        this.showForms(waiting, left / 20);
        await step.wait(CHECK_TICKS);
      }
    } finally {
      step.dispose();
    }
    for (const name of this.writers()) if (!this.answers.has(keyOf(name))) this.answers.set(keyOf(name), "skip");
    const players = Math.min(this.config.maxPlayers, this.online().length);
    this.bank.request(Object.fromEntries(this.promptFields().map((field) => [field.kind, players * BANK_PER_PLAYER])));
    await this.tile(players);
    return !this.decided;
  }

  /** A preview's /skip while the prompt form is up: whoever hasn't answered is skipped, as when time runs out. */
  protected override skipPicking(): boolean {
    if (this.writers().every((name) => this.answers.has(keyOf(name)))) return false;
    this.promptsSkipped = true;
    return true;
  }

  /** The players who write prompts: everyone here but a preview's fake players. */
  private writers(): string[] {
    return this.online().filter((name) => !this.fakes?.has(name));
  }

  /** Brings up (or updates) the forms of everyone still writing; the others wait with a note on the action bar. */
  private showForms(waiting: string[], secondsLeft: number): void {
    const names = waiting.map((name) => nameOf(name)).join("§r, ");
    const status = `Waiting for ${waiting.length > 3 ? `${waiting.length} players` : names}§r: ${clock(secondsLeft)}`;
    const fields = this.promptFields().map((field) => ({ key: field.kind, label: field.label, description: field.description }));
    for (const name of waiting) {
      const player = this.player(name);
      if (!player) continue;
      let form = this.forms.get(keyOf(name));
      if (!form?.showingTo(player)) {
        form?.close();
        form = new PromptForm(player, `${this.config.name}: ${fields.length === 1 ? "prompt" : "prompts"}`, status, fields, {
          submit: (answer) => this.submitted(name, answer),
          skip: () => this.answered(name, "skip"),
        });
        this.forms.set(keyOf(name), form);
        form.show();
      }
      form.update(status);
    }
    for (const player of world.getAllPlayers()) {
      if (waiting.some((name) => keyOf(name) === keyOf(player.name))) continue;
      const count = waiting.length === 1 ? "1 player" : `${waiting.length} players`;
      player.onScreenDisplay.setActionBar(say.info(`Waiting for ${count} to write ${fields.length === 1 ? "a prompt" : "prompts"}: ${clock(secondsLeft)}`));
    }
  }

  /** A submitted form: undefined when it's taken, else what's wrong with it. */
  submitted(name: string, answer: TextAnswer): string | undefined {
    if (this.answers.has(keyOf(name)) || this.phase !== "picking") return undefined;
    const fields = this.promptFields();
    if (fields.some((field) => (answer[field.kind] ?? "").trim().length > PROMPT_MAX_CHARS)) {
      return say.warn(fields.length === 1 ? `Keep it to ${PROMPT_MAX_CHARS} characters.` : `Keep each prompt to ${PROMPT_MAX_CHARS} characters.`);
    }
    const written: Partial<Record<PromptKind, string>> = {};
    for (const field of fields) written[field.kind] = cleanPrompt(answer[field.kind] ?? "");
    if (fields.every((field) => !written[field.kind])) return say.warn("Write a prompt, or skip.");
    this.bank.submit(
      name,
      fields.map((field) => ({ kind: field.kind, text: written[field.kind] ?? "" })),
    );
    this.answered(name, written);
    return undefined;
  }

  private answered(name: string, answer: PromptAnswers): void {
    if (this.answers.has(keyOf(name)) || this.phase !== "picking") return;
    this.answers.set(keyOf(name), answer);
    this.forms.get(keyOf(name))?.close();
    this.forms.delete(keyOf(name));
    const one = this.promptFields().length === 1;
    const reply = answer === "skip" ? `You skipped the ${one ? "prompt" : "prompts"}.` : `Your ${one ? "prompt is" : "prompts are"} in. Nobody gets their own.`;
    this.player(name)?.sendMessage(say.minor(reply));
  }

  private closeForms(): void {
    for (const form of this.forms.values()) form.close();
    this.forms.clear();
  }

  /**
   * Copies the map's arena until there's one copy per player (`count`), and makes each copy's build
   * area. Fewer when there's no room to keep them all loaded (logged): players then share.
   */
  protected async tile(count: number): Promise<void> {
    const layout = this.layout();
    if (!this.arenas || !layout) return;
    const have = await this.arenas.ensure(count);
    if (have === this.plots.length) return;
    this.plots = this.arenas.tiles.map((tile) => ({ index: tile.index, box: shiftBox(layout.plot, tile.offset), spawn: shiftPosition(layout.spawn, tile.offset) }));
    this.liquids = new LiquidGuard(this.plots.map((plot) => plot.box));
    if (this.watchingLiquids) this.liquids.learn();
  }

  // ---- The match ------------------------------------------------------------------------------

  protected override onStart(): void {
    this.startedWith = this.roster.all().length;
  }

  /** Every player starts at their own area's spawn; later they're moved by the game. */
  protected override spawnPoint(name: string, why: SpawnReason = "start"): MapPosition {
    const plot = this.keepIn.get(keyOf(name))?.plot ?? this.ownPlot(name);
    return plot?.spawn ?? super.spawnPoint(name, why);
  }

  /**
   * Waits for the prompt bank's reply (a while at most), makes sure everyone in the match has an
   * arena of their own (late arrivals), and starts clearing liquids that run out of an area. The
   * start of every game's play().
   */
  protected async prepare(): Promise<void> {
    for (let waited = 0; !this.bank.answered && waited < BANK_WAIT_TICKS; waited += 5) await this.scope.wait(5);
    await this.tile(Math.min(this.config.maxPlayers, this.roster.all().length));
    // The map's own liquids by the areas stay; any that run out of an area from now on are cleared.
    this.watchingLiquids = true;
    this.liquids?.learn();
    this.scope.interval(() => this.liquids?.sweep(), LIQUID_TICKS);
  }

  /** Participants still here (players and a preview's fake players). */
  protected here(): string[] {
    return this.roster.inState("alive").map((participant) => participant.name);
  }

  protected present(name: string | undefined): boolean {
    return name !== undefined && this.roster.get(name)?.state === "alive";
  }

  /** A player's own build area: the copy of the arena that's theirs by their place in the match (or, before it, in the queue). */
  protected ownPlot(name: string): Plot | undefined {
    if (this.plots.length === 0) return undefined;
    const players = this.roster.all().length > 0 ? this.roster.all().map((participant) => participant.name) : this.online();
    const index = players.findIndex((other) => keyOf(other) === keyOf(name));
    return this.plots[Math.max(0, index) % this.plots.length];
  }

  /**
   * One prompt of a kind for each of `players`, never one they wrote and never two the same: this
   * match's prompts first, then the bank's (newest, least used), then the game's own list. The
   * bank's are counted as used. `skip` leaves out prompts already taken (by lowercase text).
   */
  protected deal(kind: PromptKind, players: readonly string[], skip: ReadonlySet<string> = new Set()): Map<string, string> {
    const random = this.ctx.random;
    const written: DealablePrompt[] = [];
    for (const [by, answer] of this.answers) {
      const text = answer === "skip" ? undefined : answer[kind];
      if (text) written.push({ text, by });
    }
    const own = (kind === "starter" ? DEFAULT_STARTERS : DEFAULT_TWISTS).map((text) => ({ text, by: "" }));
    const pool = [...shuffled(written, random), ...this.bank.prompts(kind), ...shuffled(own, random)].filter((prompt) => !skip.has(prompt.text.toLowerCase()));
    const dealt = dealPrompts(shuffled(players, random), pool);
    this.bank.used([...dealt.values()]);
    return new Map([...players].map((name) => [name, dealt.get(name)?.text ?? FALLBACK_PROMPTS[kind]]));
  }

  /**
   * A building round: everyone to the area they work on, prepSeconds to read their prompt, look and
   * take blocks from creative's inventory, then `seconds` to build. `stages` names the two stages.
   */
  protected async buildRound(jobs: readonly BuildJob[], seconds: number, stages: { prep: string; build: string }, announce?: string): Promise<void> {
    this.keepIn.clear();
    this.working.clear();
    this.corners.clear();
    for (const job of jobs) {
      if (!this.present(job.name)) continue;
      const key = keyOf(job.name);
      this.working.set(key, job.plot);
      this.keepIn.set(key, { name: job.name, box: grow(job.plot.box, this.mapSetting(BUILD_PADDING)), plot: job.plot, graceTicks: this.mapSetting(RETURN_DELAY) * 20 });
      this.lines.set(key, job.line);
      this.clearInventory(job.name);
      // The match starts everyone at their own area's spawn: no second move there.
      const at = this.body(job.name)?.location;
      if (!at || !inside(at, job.plot.box)) this.goTo(job.name, job.plot);
      this.title(job.title[0], job.title[1], job.name, 80);
      if (job.message) this.player(job.name)?.sendMessage(job.message);
    }
    if (announce) this.broadcast(announce);
    await this.stage(stages.prep, { seconds: this.config.prepSeconds }, (stage) => this.countDown(stage.scope, () => stage.secondsLeft));
    this.building = true;
    this.chime("go");
    this.title(say.success("Build!"), say.minor(clock(seconds)));
    await this.stage(stages.build, { seconds }, (stage) => {
      stage.scope.interval(() => {
        const left = stage.secondsLeft ?? 0;
        if (left === 60) this.broadcast(say.highlight("1 minute left!"));
      }, 20);
      this.countDown(stage.scope, () => stage.secondsLeft);
    });
    this.building = false;
    this.working.clear();
    this.corners.clear();
    this.title(say.highlight("Time's up!"));
  }

  /** The last five seconds of a stage, chimed. */
  protected countDown(scope: Scope, left: () => number | undefined): void {
    scope.interval(() => {
      const seconds = left() ?? 0;
      if (seconds > 0 && seconds <= 5) this.chime(countdownChime(seconds));
    }, 20);
  }

  /** `name` must stay within the build padding of `plot`, put back once out for `graceTicks` (0: at once). */
  protected keepNearPlot(name: string, plot: Plot, graceTicks = 0): void {
    this.keepIn.set(keyOf(name), { name, box: grow(plot.box, this.mapSetting(BUILD_PADDING)), plot, graceTicks });
  }

  /** Nobody is kept anywhere (the end, or between stages). */
  protected releaseAll(): void {
    this.keepIn.clear();
  }

  // ---- Voting ---------------------------------------------------------------------------------

  /** Everyone to a build's spawn, kept within the map's build padding of it (put back at once). */
  protected gather(plot: Plot): void {
    this.keepIn.clear();
    for (const name of this.online()) {
      if (this.roster.get(name)) this.keepNearPlot(name, plot);
      this.goTo(name, plot);
    }
  }

  /**
   * A vote on one build: everyone here but its builder votes with the blocks in slots 1 to 5, with no
   * time limit. Once all have, voteGraceSeconds to change a vote, then it counts toward the
   * builder's points. A build whose builder left (or with nobody to vote) shows for showSeconds
   * instead. Resolves to its points, or undefined when it wasn't voted on.
   */
  protected async voteOn(builder: string): Promise<number | undefined> {
    const ballot = new Ballot(builder, this.here());
    if (!this.present(builder) || ballot.needed === 0) {
      await this.stage("Look", { seconds: this.config.showSeconds });
      return undefined;
    }
    this.ballot = ballot;
    for (const name of this.online()) {
      if (ballot.isVoter(name)) this.giveVotes(name);
      else this.clearInventory(name);
    }
    this.fakesVote(ballot);
    await this.stage("Vote", {}, (stage) => {
      stage.scope.interval(() => {
        if (ballot.done) stage.end();
      }, 5);
      stage.scope.interval(() => this.nagVoters(ballot), this.config.voteNagSeconds * 20);
    });
    await this.stage("Next build", { seconds: this.config.voteGraceSeconds });
    this.ballot = undefined;
    for (const name of this.online()) this.clearInventory(name);
    this.points.set(keyOf(builder), (this.points.get(keyOf(builder)) ?? 0) + ballot.total);
    return ballot.total;
  }

  /** Counts a vote (or a change of vote) from a voter on the build being voted on. */
  private castVote(name: string, points: number): void {
    const ballot = this.ballot;
    if (!ballot || !ballot.isVoter(name) || ballot.voteOf(name) === points || !ballot.vote(name, points)) return;
    try {
      this.player(name)?.playSound(VOTE_SOUND, { pitch: 0.8 + points * 0.1 });
    } catch {
      // gone
    }
  }

  /** Every player who still hasn't voted on the build under way: a big "Vote!" and a wither's roar, to them. */
  private nagVoters(ballot: Ballot): void {
    if (this.ballot !== ballot || ballot.done) return;
    for (const name of this.online()) {
      if (!ballot.isVoter(name) || ballot.voteOf(name) !== undefined || this.fakes?.has(name)) continue;
      this.title(say.warn("Vote!"), say.info("Pick a number from 1 to 5"), name, 50);
      try {
        this.player(name)?.playSound(NAG_SOUND, { volume: 1 });
      } catch {
        // gone
      }
    }
  }

  /** A preview's fake players vote at random, a moment after the build shows. */
  private fakesVote(ballot: Ballot): void {
    for (const name of this.fakes?.all ?? []) {
      if (!ballot.isVoter(name)) continue;
      const [low, high] = FAKE_VOTE_TICKS;
      this.scope.timeout(() => {
        if (this.ballot === ballot) ballot.vote(name, 1 + Math.floor(this.ctx.random() * VOTES.length));
      }, low + Math.floor(this.ctx.random() * (high - low)));
    }
  }

  private giveVotes(name: string): void {
    const container = this.player(name)?.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;
    container.clearAll();
    VOTES.forEach((vote, slot) => {
      const stack = new ItemStack(vote.item, 1);
      stack.nameTag = vote.name;
      stack.lockMode = ItemLockMode.slot;
      container.setItem(slot, stack);
    });
  }

  protected clearInventory(name: string): void {
    try {
      this.player(name)?.getComponent(EntityComponentTypes.Inventory)?.container.clearAll();
    } catch {
      // gone
    }
  }

  /**
   * The line top right, above the clock: the game's own (lines) out of a vote, the vote's during
   * one. A vote has no clock until everyone has voted, so its line goes top right on its own
   * (hudText) until then.
   */
  protected override hud(name: string): string | undefined {
    const ballot = this.ballot;
    if (!ballot) return this.lines.get(keyOf(name));
    const line = this.voteLine(name, ballot);
    return this.activeStage?.secondsLeft === undefined ? hudText(line) : line;
  }

  /** How many have voted, after "Your build" for its builder, and a voter's own vote once they've voted. */
  private voteLine(name: string, ballot: Ballot): string {
    const count = `${COLOR.minor}${ballot.counted}/${ballot.needed} voted`;
    if (keyOf(name) === keyOf(ballot.builder)) return `${COLOR.minor}Your build   ${count}`;
    if (!ballot.isVoter(name)) return count;
    const mine = ballot.voteOf(name);
    return mine === undefined ? `${say.info("Vote with a number")}   ${count}` : `${COLOR.minor}Your vote: ${voteText(mine)}   ${count}`;
  }

  // ---- The end --------------------------------------------------------------------------------

  /**
   * The match's result by points: the standings in chat, each player's own lines (`ownLines`, what
   * their builds earned) to them alone, the stats, and the winner's build on show (`showWinner`).
   */
  protected decide(ownLines: (name: string) => string[], showWinner: (winner: string) => void): Result {
    const everyone = this.roster.all().map((participant) => participant.name);
    for (const name of everyone) {
      this.stats.extra(name, "points", this.pointsOf(name));
      this.stats.extra(name, "bestScore", this.pointsOf(name));
    }
    for (const row of standings(this.points, everyone)) {
      const gone = this.present(row.name) ? "" : say.minor(" (left)");
      this.broadcast(`${say.highlight(ordinal(row.place))} ${nameOf(row.name)}${COLOR.minor}: ${pointsText(row.points)}${gone}`);
    }
    for (const name of everyone) {
      const player = this.player(name);
      if (!player) continue;
      try {
        for (const line of ownLines(name)) player.sendMessage(line);
      } catch {
        // gone
      }
    }
    const ranked = standings(this.points, this.here());
    const top = ranked[0];
    if (!top || top.points === 0) return draw("nobody got a vote");
    const winners = ranked.filter((row) => row.points === top.points).map((row) => row.name);
    this.keepIn.clear();
    showWinner(winners[0]);
    const reason = pointsText(top.points);
    return winners.length === 1 ? this.playerWins(winners[0], reason) : { kind: "win", players: winners, reason: `${reason} each` };
  }

  protected override checkWin(): Result | undefined {
    const here = this.here();
    if (here.length === 0) return draw("everyone left");
    if (this.startedWith >= 2 && here.length === 1) return this.playerWins(here[0], "everyone else left");
    return undefined;
  }

  // ---- /floor ---------------------------------------------------------------------------------

  /**
   * /floor: the block in the player's hand becomes the floor of the area they're building in, the
   * bottom layer of its build area, whatever was there. Returns what happened.
   */
  floor(player: Player): string {
    const box = this.workBox(player.name);
    if (!box) return say.minor("Lay a floor while you're building.");
    const item = player.getComponent(EntityComponentTypes.Inventory)?.container.getItem(player.selectedSlotIndex);
    if (!item) return say.minor("Hold the block for the floor, then /floor.");
    const block = placeable(item.typeId);
    if (!block) return say.minor("That isn't a block: hold the block for the floor.");
    const dimension = world.getDimension("overworld");
    try {
      for (const piece of fillPieces(floorOf(box))) dimension.fillBlocks(new BlockVolume(corner(piece.min), corner(piece.max)), block);
    } catch (error) {
      log.warn(`${this.config.id}: could not lay ${player.name}'s floor: ${describeError(error)}`);
      return say.warn("The floor didn't go down: try again.");
    }
    return say.success("Floor laid.");
  }

  // ---- The selection wand, /set, /replace and /fix --------------------------------------------

  /** /wand: a wooden axe, the selection wand. Returns what happened. */
  wand(player: Player): string {
    if (!this.workBox(player.name)) return say.minor("The wand works while you're building.");
    const wand = new ItemStack(WAND, 1);
    wand.nameTag = WAND_NAME;
    try {
      const left = player.getComponent(EntityComponentTypes.Inventory)?.container.addItem(wand);
      if (left) return say.warn("Your inventory is full: make room for the wand.");
    } catch (error) {
      log.warn(`${this.config.id}: could not give ${player.name} the wand: ${describeError(error)}`);
      return say.warn("The wand didn't come: try again.");
    }
    return say.success("Left click a block for the first corner, right click one for the second.");
  }

  /** The wand's click: a corner of the selection, inside the area being built. */
  private pickCorner(name: string, which: keyof Corners, at: Vector3): void {
    const player = this.player(name);
    const box = this.workBox(name);
    if (!player) return;
    if (!box) return player.sendMessage(say.minor("The wand works while you're building."));
    if (!blockInside(at, box)) return player.sendMessage(say.warn("Pick a block inside your building area."));
    const key = keyOf(name);
    const corners = { ...this.corners.get(key), [which]: [Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)] as Vec3 };
    this.corners.set(key, corners);
    const selected = cornersBox(corners);
    const size = corners.first && corners.second && selected ? `: ${sizeText(selected)}` : "";
    player.sendMessage(say.info(`${which === "first" ? "First" : "Second"} corner set${size}.`));
  }

  /** A builder's selection, inside the area they're building; undefined (with why) when there isn't one. */
  private selection(player: Player): { box: Box } | { problem: string } {
    const area = this.workBox(player.name);
    if (!area) return { problem: say.minor("That works while you're building.") };
    const corners = this.corners.get(keyOf(player.name));
    if (!corners?.first || !corners.second) return { problem: say.minor("Pick two corners with the wand first (/wand).") };
    const box = clipBox(cornersBox(corners)!, area);
    return box ? { box } : { problem: say.minor("Your selection is outside your building area.") };
  }

  /** /set: the selection filled with `block`. Returns what happened. */
  set(player: Player, block: string): string {
    const picked = this.selection(player);
    if ("problem" in picked) return picked.problem;
    const permutation = placeable(block);
    if (!permutation) return say.warn("That isn't a block.");
    try {
      const dimension = world.getDimension("overworld");
      for (const piece of fillPieces(picked.box)) dimension.fillBlocks(new BlockVolume(corner(piece.min), corner(piece.max)), permutation);
    } catch (error) {
      log.warn(`${this.config.id}: ${player.name}'s /set failed: ${describeError(error)}`);
      return say.warn("That didn't work: try again.");
    }
    const count = boxVolume(picked.box);
    return say.success(`Set ${count === 1 ? "1 block" : `${count} blocks`}.`);
  }

  /** /replace: every `from` in the selection (its twin too) becomes `to`. Returns what happened. */
  replace(player: Player, from: string, to: string): string {
    const picked = this.selection(player);
    if ("problem" in picked) return picked.problem;
    const permutation = placeable(to);
    if (!permutation) return say.warn("That isn't a block.");
    const twin = stillTwin(from)?.still;
    const includeTypes = twin ? [from, twin] : [from];
    let count = 0;
    try {
      const dimension = world.getDimension("overworld");
      for (const piece of fillPieces(picked.box)) {
        count += dimension.fillBlocks(new BlockVolume(corner(piece.min), corner(piece.max)), permutation, { blockFilter: { includeTypes } }).getCapacity();
      }
    } catch (error) {
      log.warn(`${this.config.id}: ${player.name}'s /replace failed: ${describeError(error)}`);
      return say.warn("That didn't work: try again.");
    }
    return count === 0 ? say.minor("Nothing in your selection was that block.") : say.success(`Replaced ${count === 1 ? "1 block" : `${count} blocks`}.`);
  }

  /**
   * /fix, standing in water or lava: the pool around you becomes still liquid, levelled to where
   * you stand and its gaps filled, up to FIX_RADIUS blocks away, inside your building area.
   */
  fix(player: Player): string {
    const area = this.workBox(player.name);
    if (!area) return say.minor("That works while you're building.");
    const dimension = world.getDimension("overworld");
    const feet: Vec3 = [Math.floor(player.location.x), Math.floor(player.location.y), Math.floor(player.location.z)];
    const liquid = [feet, [feet[0], feet[1] + 1, feet[2]] as Vec3].map((at) => liquidAt(dimension.getBlock(corner(at))?.typeId)).find(Boolean);
    if (!liquid) return say.minor("Stand in the water or lava to fix, then /fix.");
    if (!blockInside(corner(feet), area)) return say.minor("Stand in your building area to fix.");
    const kindAt = (at: Vec3): FixCell => {
      const typeId = dimension.getBlock(corner(at))?.typeId;
      if (typeId === undefined) return "other";
      if (typeId === "minecraft:air") return "air";
      return liquidAt(typeId) === liquid ? "liquid" : "other";
    };
    const still = BlockPermutation.resolve(`minecraft:${liquid}`, { liquid_depth: 0 });
    let count = 0;
    try {
      for (const at of fixCells(feet, kindAt, area)) {
        const block = dimension.getBlock(corner(at));
        if (!block) continue;
        if (block.typeId === `minecraft:${liquid}` && block.permutation.getState("liquid_depth") === 0) continue;
        block.setPermutation(still);
        count++;
      }
    } catch (error) {
      log.warn(`${this.config.id}: ${player.name}'s /fix failed: ${describeError(error)}`);
      return say.warn("That didn't work: try again.");
    }
    return count === 0 ? say.minor(`The ${liquid} is already still.`) : say.success(`Fixed ${count === 1 ? "1 block" : `${count} blocks`} of ${liquid}.`);
  }

  /** Each builder's selection, in dots only they see. */
  private drawSelections(): void {
    if (!this.building) return;
    for (const [key, corners] of this.corners) {
      const box = cornersBox(corners);
      const player = box && this.working.has(key) ? this.player(key) : undefined;
      if (player && box) drawOutline(player, box, SELECTION_COLOR, SELECTION_DOTS);
    }
  }

  /** A gravity block a builder placed, as its twin that stays put (an anvil keeps its facing). */
  private keepStill(block: Block): void {
    try {
      const states = block.permutation.getAllStates();
      const twin = stillTwin(block.typeId, states);
      if (twin) block.setPermutation(BlockPermutation.resolve(twin.still, stillStates(twin, states)));
    } catch (error) {
      log.warn(`${this.config.id}: could not keep a ${block.typeId} from falling: ${describeError(error)}`);
    }
  }

  // ---- Helpers --------------------------------------------------------------------------------

  /**
   * Creative's inventory hands out any item, so outside their own round (its prep time and building
   * time) players keep only what the game gave them: a voter their vote blocks in their slots, and
   * whatever the game keeps (keepsItem); nothing else, worn or held on the cursor either.
   */
  private keepHandsEmpty(): void {
    if (this.phase !== "playing") return;
    for (const player of world.getAllPlayers()) {
      if (this.working.has(keyOf(player.name))) continue;
      const voter = this.ballot?.isVoter(player.name) === true;
      try {
        const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
        for (let slot = 0; container && slot < container.size; slot++) {
          const item = container.getItem(slot);
          if (item && !(voter && VOTES[slot]?.item === item.typeId) && !this.keepsItem(player.name, slot, item.typeId)) container.setItem(slot);
        }
        const equipment = player.getComponent(EntityComponentTypes.Equippable);
        for (const slot of WORN) if (equipment?.getEquipment(slot)) equipment.setEquipment(slot);
        player.getComponent(EntityComponentTypes.CursorInventory)?.clear();
      } catch {
        // gone
      }
    }
  }

  /** The area `name` may build in now: theirs to work on, while building is on. */
  protected workBox(name: string): Box | undefined {
    return this.building ? this.working.get(keyOf(name))?.box : undefined;
  }

  /** Players who wander off are put back inside the box they must stay in, once they've been out for its grace time. */
  private keepNear(): void {
    const now = system.currentTick;
    for (const keep of this.keepIn.values()) {
      const { name, box } = keep;
      if (this.fakes?.has(name)) continue;
      const player = this.player(name);
      if (!player || inside(player.location, box)) {
        keep.outSince = undefined;
        continue;
      }
      keep.outSince ??= now;
      if (now - keep.outSince < keep.graceTicks) continue;
      keep.outSince = undefined;
      try {
        player.teleport(clampInto(player.location, box));
      } catch {
        // gone
      }
    }
  }

  /** To an area's spawn, facing its saved facing, else the middle of the area. */
  protected goTo(name: string, plot: Plot): void {
    const body = this.body(name);
    if (!body) return;
    const at = worldPoint(plot.spawn);
    const facing = facingOf(plot.spawn);
    const { min, max } = plot.box;
    const middle = { x: (min[0] + max[0] + 1) / 2, y: at.y + 1.62, z: (min[2] + max[2] + 1) / 2 };
    try {
      body.teleport(at, facing ? { rotation: { x: facing.pitch, y: facing.yaw } } : { facingLocation: middle });
    } catch {
      // gone
    }
  }

  private removeSpawned(entity: Entity): void {
    try {
      if (!entity.isValid || entity.typeId === "minecraft:player" || entity.typeId.startsWith("minecade:")) return;
      entity.remove();
    } catch {
      // gone already
    }
  }
}

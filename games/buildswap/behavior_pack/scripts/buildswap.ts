// Build Swap on the minigame framework. Core runs the waiting, the clock top right
// (each round's own), the result and the stats. This class adds the prompt form before the
// match (no countdown: the first round's prompt shows at once), the two building rounds (your own
// prompt in your own building area, then a twist on someone else's build), and voting on every
// build, first as it was before its twist and then with it, its prompt (and then its twist) top
// left. Builders stay anonymous until the end: the standings in chat, and each player's own points
// for their prompt and their twist, to them alone.
//
// Players build in creative mode, only inside the building area they're working on (they can
// change any block there, and /floor lays the block in hand across its bottom; the selection wand
// and /set, /replace and /fix work there too, selection.ts), and are kept
// within the map's build padding of it (put back once they've been past it for the map's return
// delay). In a round's prep time they can take blocks from creative's inventory, but not build yet.
// Out of their rounds they're still in creative (so voters can fly; adventure mode can't), but keep
// nothing from creative's inventory: a voter only their vote blocks. Voters are kept within the
// same padding of the build being voted on, put back at once; one who still hasn't voted after
// voteNagSeconds gets a big "Vote!" and a wither's roar, again each time that passes. Nothing
// spawned (mobs, items, armor stands) stays, TNT and fire do nothing, and liquids that run out of
// an area are cleared. Blocks that fall (concrete powder, sand, gravel, anvils) stay where they're
// put: each becomes its twin that doesn't (still-blocks.ts).
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
import {
  COLOR,
  Minigame,
  OUTLINE_REFRESH_TICKS,
  Notes,
  PromptBank,
  cleanPrompt,
  countdownChime,
  dealPrompts,
  describeError,
  draw,
  drawOutline,
  facingOf,
  hudText,
  inside,
  log,
  nameOf,
  ordinal,
  outlineColor,
  PROMPT_MAX_CHARS,
  say,
  worldPoint,
  type DealablePrompt,
  type GameContext,
  type MapPosition,
  type PromptKind,
  type Result,
  type Box,
  type Scope,
  type SpawnReason,
  type Vec3,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";
import { DEFAULT_STARTERS, DEFAULT_TWISTS } from "./default-prompts.ts";
import { PromptForm, type PromptAnswer } from "./prompt-form.ts";
import { LIQUIDS, LiquidGuard, PLOT_REGION, Snapshots, blockInside, clampInto, floorOf, grow, pairPlots, swapPlots, tiles, type Plot } from "./plots.ts";
import { SELECTION_HEX, WAND, WAND_NAME, boxVolume, clipBox, cornersBox, fillPieces, fixCells, sizeText, type Corners, type FixCell } from "./selection.ts";
import { stillStates, stillTwin } from "./still-blocks.ts";
import { Ballot, VOTES, votePoints, voteText } from "./votes.ts";

/** How often the prompt form's status and the players near their areas are checked, in ticks. */
const CHECK_TICKS = 10;
/** How long the game waits for the prompt bank's reply before dealing without it. */
const BANK_WAIT_TICKS = 60;
/** The most prompts of a kind asked of the bank: three per player, so everyone can get one that isn't their own. */
const BANK_PER_PLAYER = 3;
/** Liquids that ran out of an area are cleared this often. */
const LIQUID_TICKS = 20;
/** A preview's fake players vote somewhere in this many ticks. */
const FAKE_VOTE_TICKS = [20, 80];
/** What a player hears when their vote counts. */
const VOTE_SOUND = "random.orb";
/** Dealt when every prompt is used up, which a full game list makes rare. */
const FALLBACK = { starter: "Anything you like", twist: "Make it bigger" };
/** The map setting (game.config.ts map.settings) for how far builders, and voters, may go past an area. */
const BUILD_PADDING = "buildPadding";
/** The map setting for how long (seconds) builders may stay past the padding before they're put back. */
const RETURN_DELAY = "returnDelay";
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

/** One building area in play: its first builder and prompt, and who added which twist. */
export interface Build {
  plot: Plot;
  builder: string;
  starter: string;
  twister?: string;
  twist?: string;
}

/** A vote's result: one part of a build, and what it earned whoever built that part. */
interface Scored {
  build: Build;
  kind: PromptKind;
  builder: string;
  points: number;
}

/** Where a participant must stay, and since when (tick) they've been out of it. */
interface KeepIn {
  name: string;
  box: Plot["box"];
  plot: Plot;
  /** How long they may stay out before they're put back, in ticks. */
  graceTicks: number;
  outSince?: number;
}

/** What a player wrote before the match, or that they skipped (or ran out of time). */
type Answer = PromptAnswer | "skip";

const keyOf = (name: string) => name.toLowerCase();
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

/** Water or lava for a block that is either (still or flowing); undefined for anything else. */
function liquidAt(typeId: string | undefined): "water" | "lava" | undefined {
  if (typeId === undefined || !LIQUIDS.includes(typeId)) return undefined;
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

/** "m:ss". */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Each player's points, highest first (names in the order given break no ties: equal points share a place). */
export function standings(points: ReadonlyMap<string, number>, names: readonly string[]): { name: string; points: number; place: number }[] {
  const rows = names.map((name) => ({ name, points: points.get(keyOf(name)) ?? 0 })).sort((a, b) => b.points - a.points);
  return rows.map((row) => ({ ...row, place: 1 + rows.filter((other) => other.points > row.points).length }));
}

export class BuildSwap extends Minigame<typeof config> {
  private plots: Plot[] = [];
  private bank!: PromptBank;
  private liquids!: LiquidGuard;
  private readonly snapshots = new Snapshots();
  /** What each player wrote (or skipped), by lowercase name; kept if a countdown falls through. */
  private readonly answers = new Map<string, Answer>();
  private readonly forms = new Map<string, PromptForm>();
  /** Every build, by its first builder's lowercase name. */
  private readonly builds = new Map<string, Build>();
  /** Who's building where right now (only while building is on). */
  private readonly working = new Map<string, Build>();
  /** Where each participant must stay: their area while building, the one being voted on while voting. */
  private readonly keepIn = new Map<string, KeepIn>();
  /** Each builder's selection corners (the wand), by lowercase name; cleared every round. */
  private readonly corners = new Map<string, Corners>();
  private building = false;
  /** Each player's line after the clock, while it isn't the vote's. */
  private readonly lines = new Map<string, string>();
  /** The vote under way, and the build part it's for. */
  private ballot: Ballot | undefined;
  private votingOn: { build: Build; kind: PromptKind } | undefined;
  private readonly points = new Map<string, number>();
  private readonly scored: Scored[] = [];
  /** How many took part when the match began: one left of several wins. */
  private startedWith = 0;
  /** A preview's /skip ended the prompt form's wait. */
  private promptsSkipped = false;

  constructor(ctx: GameContext, gameConfig: typeof config) {
    super(ctx, gameConfig);
    this.gameMode = GameMode.Creative;
  }

  /** The lobby's Build time setting, in seconds: the first round's length. */
  get buildSeconds(): number {
    const minutes = Number(this.ctx.vars.settings.buildTime) || Number(this.config.options[0].values[0].value);
    return minutes * 60;
  }

  /** Every build, for tests and the reveal. */
  get allBuilds(): readonly Build[] {
    return [...this.builds.values()];
  }

  pointsOf(name: string): number {
    return this.points.get(keyOf(name)) ?? 0;
  }

  /** The vote under way: which part of which build, and who built that part. */
  get voting(): { build: Build; kind: PromptKind; builder: string } | undefined {
    return this.votingOn && this.ballot ? { ...this.votingOn, builder: this.ballot.builder } : undefined;
  }

  protected override setup(): void {
    this.plots = pairPlots(this.map.spawns, this.map.regions(PLOT_REGION));
    this.bank = new PromptBank(this.ctx, this.scope, this.config.id);
    this.liquids = new LiquidGuard(this.plots.map((plot) => plot.box));
    this.scope.add(() => this.snapshots.dispose());
    this.scope.add(() => this.closeForms());

    // Building: only in the area a player is working on, and only while building is on. Vote blocks
    // vote instead of being placed.
    this.scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      const name = event.player.name;
      // The wand's right click picks the second corner, and does nothing else (no stripped logs).
      if (event.itemStack?.typeId === WAND) {
        event.cancel = true;
        const at = event.block.location;
        if (event.isFirstEvent !== false) system.run(() => this.pickCorner(name, "second", at));
        return;
      }
      const points = votePoints(event.itemStack?.typeId);
      if (points !== undefined && this.ballot) {
        event.cancel = true;
        if (event.isFirstEvent !== false) system.run(() => this.castVote(name, points));
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
    this.scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
      const points = votePoints(itemStack.typeId);
      if (points !== undefined) this.castVote(source.name, points);
    });
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

  // ---- The prompt form ----------------------------------------------------------------------

  /**
   * Everyone writes a prompt to build and a twist, or skips: each player's form stays up until they
   * do. Once everyone has, or promptSeconds are up (whoever hasn't is skipped), the match starts.
   * What they wrote goes to the prompt bank at once, and the bank is asked for prompts to deal.
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
    this.bank.request({ starter: players * BANK_PER_PLAYER, twist: players * BANK_PER_PLAYER });
    return true;
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
    for (const name of waiting) {
      const player = this.player(name);
      if (!player) continue;
      let form = this.forms.get(keyOf(name));
      if (!form?.showingTo(player)) {
        form?.close();
        form = new PromptForm(player, `${this.config.name}: prompts`, status, {
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
      player.onScreenDisplay.setActionBar(say.info(`Waiting for ${waiting.length === 1 ? "1 player" : `${waiting.length} players`} to write prompts: ${clock(secondsLeft)}`));
    }
  }

  /** A submitted form: undefined when it's taken, else what's wrong with it. */
  submitted(name: string, answer: PromptAnswer): string | undefined {
    if (this.answers.has(keyOf(name)) || this.phase !== "picking") return undefined;
    if (answer.starter.trim().length > PROMPT_MAX_CHARS || answer.twist.trim().length > PROMPT_MAX_CHARS) return say.warn(`Keep each prompt to ${PROMPT_MAX_CHARS} characters.`);
    const starter = cleanPrompt(answer.starter);
    const twist = cleanPrompt(answer.twist);
    if (!starter && !twist) return say.warn("Write a prompt, or skip.");
    this.bank.submit(name, [
      { kind: "starter", text: starter },
      { kind: "twist", text: twist },
    ]);
    this.answered(name, { starter, twist });
    return undefined;
  }

  private answered(name: string, answer: Answer): void {
    if (this.answers.has(keyOf(name)) || this.phase !== "picking") return;
    this.answers.set(keyOf(name), answer);
    this.forms.get(keyOf(name))?.close();
    this.forms.delete(keyOf(name));
    this.player(name)?.sendMessage(say.minor(answer === "skip" ? "You skipped the prompts." : "Your prompts are in. Nobody gets their own."));
  }

  private closeForms(): void {
    for (const form of this.forms.values()) form.close();
    this.forms.clear();
  }

  // ---- The match ----------------------------------------------------------------------------

  protected override onStart(): void {
    this.startedWith = this.roster.all().length;
    if (this.plots.length < this.startedWith) this.broadcast(say.warn(`This map has ${this.plots.length} building areas for ${this.startedWith} players: some share one.`));
  }

  /** Every player starts at their own area's spawn; later they're moved by the game. */
  protected override spawnPoint(name: string, why: SpawnReason = "start"): MapPosition {
    const plot = this.keepIn.get(keyOf(name))?.plot ?? this.ownPlot(name);
    return plot?.spawn ?? super.spawnPoint(name, why);
  }

  protected override async play(): Promise<Result | void> {
    for (let waited = 0; !this.bank.answered && waited < BANK_WAIT_TICKS; waited += 5) await this.scope.wait(5);
    const builders = this.here();
    const starters = this.deal("starter", builders);
    for (const name of builders) {
      const plot = this.ownPlot(name);
      if (plot) this.builds.set(keyOf(name), { plot, builder: name, starter: starters.get(name) ?? FALLBACK.starter });
    }
    // The map's own liquids by the areas stay; any that run out of an area from now on are cleared.
    this.liquids.learn();
    this.scope.interval(() => this.liquids.sweep(), LIQUID_TICKS);
    await this.round("starter", this.buildSeconds);
    for (const build of this.builds.values()) this.snapshots.save(`p${build.plot.index}_starter`, build.plot.box);

    // The swap: everyone still here moves to another's build (one whose builder is still here) for the twist.
    const twisters = this.here().filter((name) => this.builds.has(keyOf(name)));
    const swap = swapPlots(twisters, this.ctx.random);
    const twists = this.deal("twist", twisters);
    for (const [twister, owner] of swap) {
      const build = this.builds.get(keyOf(owner));
      if (!build) continue;
      build.twister = twister;
      build.twist = twists.get(twister) ?? FALLBACK.twist;
    }
    await this.round("twist", this.config.twistMinutes * 60);
    for (const build of this.builds.values()) this.snapshots.save(`p${build.plot.index}_final`, build.plot.box);

    await this.voteAll();
    return this.winner();
  }

  /** Participants still here (players and a preview's fake players). */
  private here(): string[] {
    return this.roster.inState("alive").map((participant) => participant.name);
  }

  private present(name: string | undefined): boolean {
    return name !== undefined && this.roster.get(name)?.state === "alive";
  }

  /** A player's own building area: the one paired with the spawn they started at. */
  private ownPlot(name: string): Plot | undefined {
    if (this.plots.length === 0) return undefined;
    const index = this.roster.all().findIndex((participant) => keyOf(participant.name) === keyOf(name));
    return this.plots[Math.max(0, index) % this.plots.length];
  }

  /**
   * One prompt each, never one they wrote and never two the same: this match's prompts first, then
   * the bank's (newest, least used), then the game's own list. The bank's are counted as used.
   */
  private deal(kind: PromptKind, players: readonly string[]): Map<string, string> {
    const random = this.ctx.random;
    const written: DealablePrompt[] = [];
    for (const [by, answer] of this.answers) if (answer !== "skip" && answer[kind]) written.push({ text: answer[kind], by });
    const own = (kind === "starter" ? DEFAULT_STARTERS : DEFAULT_TWISTS).map((text) => ({ text, by: "" }));
    const pool = [...shuffled(written, random), ...this.bank.prompts(kind), ...shuffled(own, random)];
    const dealt = dealPrompts(shuffled(players, random), pool);
    this.bank.used([...dealt.values()]);
    return new Map([...dealt].map(([name, prompt]) => [name, prompt.text]));
  }

  /**
   * A building round: everyone to the area they work on, prepSeconds to read the prompt, look and
   * take blocks from creative's inventory, then `seconds` to build.
   */
  private async round(kind: PromptKind, seconds: number): Promise<void> {
    this.keepIn.clear();
    this.working.clear();
    this.corners.clear();
    for (const build of this.builds.values()) {
      const worker = kind === "starter" ? build.builder : build.twister;
      if (!this.present(worker)) continue;
      this.working.set(keyOf(worker!), build);
      const box = grow(build.plot.box, this.mapSetting(BUILD_PADDING));
      this.keepIn.set(keyOf(worker!), { name: worker!, box, plot: build.plot, graceTicks: this.mapSetting(RETURN_DELAY) * 20 });
      this.lines.set(keyOf(worker!), kind === "starter" ? `${COLOR.minor}Build: §f${build.starter}` : `${COLOR.minor}Twist: §f${build.twist}${COLOR.minor} on §f${build.starter}`);
      this.clearInventory(worker!);
      // The match starts everyone at their own area's spawn: no second move there.
      const at = this.body(worker!)?.location;
      if (kind === "twist" || !at || !inside(at, build.plot.box)) this.goTo(worker!, build.plot);
      if (kind === "starter") this.title(say.highlight("Your prompt"), `§f${build.starter}`, worker!, 80);
      else {
        this.title(say.highlight("Your twist"), `§f${build.twist}`, worker!, 80);
        this.player(worker!)?.sendMessage(`${say.info("Twist:")} §f${build.twist}${say.minor(" on this build:")} §f${build.starter}`);
      }
    }
    if (kind === "twist") this.broadcast(say.info("Swap! Add your twist to this build. You can change anything in its area."));
    await this.stage(kind === "starter" ? "Get ready" : "Get ready for the twist", { seconds: this.config.prepSeconds }, (stage) => this.countDown(stage.scope, () => stage.secondsLeft));
    this.building = true;
    this.chime("go");
    this.title(say.success("Build!"), say.minor(clock(seconds)));
    await this.stage(kind === "starter" ? "Build" : "Twist", { seconds }, (stage) => {
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
  private countDown(scope: Scope, left: () => number | undefined): void {
    scope.interval(() => {
      const seconds = left() ?? 0;
      if (seconds > 0 && seconds <= 5) this.chime(countdownChime(seconds));
    }, 20);
  }

  // ---- Voting -------------------------------------------------------------------------------

  /** Every build in turn, in a random order: as it was before its twist, then with it, its prompt (and its twist) top left. */
  private async voteAll(): Promise<void> {
    this.lines.clear();
    const notesScope = this.scope.child("notes");
    const notes = new Notes(notesScope);
    for (const player of world.getAllPlayers()) this.clearInventory(player.name);
    const order = shuffled(
      [...this.builds.values()].filter((build) => this.present(build.builder) || this.present(build.twister)),
      this.ctx.random,
    );
    for (const [i, build] of order.entries()) {
      this.gather(build.plot);
      this.snapshots.restore(`p${build.plot.index}_starter`, build.plot.box);
      const prompt = `${COLOR.minor}Prompt: §f${build.starter}`;
      notes.show([prompt]);
      this.title(say.highlight(`Build ${i + 1} of ${order.length}`), `§f${build.starter}`, undefined, 60);
      await this.votePart(build, "starter");
      if (build.twister !== undefined) {
        this.snapshots.restore(`p${build.plot.index}_final`, build.plot.box);
        notes.show([prompt, `${COLOR.minor}Twist: §f${build.twist}`]);
        this.title(say.highlight("The twist"), `§f${build.twist}`, undefined, 60);
        await this.votePart(build, "twist");
      }
    }
    notesScope.dispose();
    this.keepIn.clear();
  }

  /** Everyone to a build's spawn, kept within the map's build padding of it (put back at once). */
  private gather(plot: Plot): void {
    this.keepIn.clear();
    const box = grow(plot.box, this.mapSetting(BUILD_PADDING));
    for (const name of this.online()) {
      if (this.roster.get(name)) this.keepIn.set(keyOf(name), { name, box, plot, graceTicks: 0 });
      this.goTo(name, plot);
    }
  }

  /**
   * A vote on one part of a build: everyone here but its builder votes with the blocks in slots 1 to
   * 5, with no time limit. Once all have, voteGraceSeconds to change a vote, then it counts. A part
   * whose builder left (or with nobody to vote) shows for showSeconds instead.
   */
  private async votePart(build: Build, kind: PromptKind): Promise<void> {
    const builder = kind === "starter" ? build.builder : build.twister!;
    const ballot = new Ballot(builder, this.here());
    if (!this.present(builder) || ballot.needed === 0) {
      await this.stage("Look", { seconds: this.config.showSeconds });
      return;
    }
    this.ballot = ballot;
    this.votingOn = { build, kind };
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
    this.votingOn = undefined;
    for (const name of this.online()) this.clearInventory(name);
    this.points.set(keyOf(builder), (this.points.get(keyOf(builder)) ?? 0) + ballot.total);
    this.scored.push({ build, kind, builder, points: ballot.total });
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

  /** Every player who still hasn't voted on the part under way: a big "Vote!" and a wither's roar, to them. */
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

  private clearInventory(name: string): void {
    try {
      this.player(name)?.getComponent(EntityComponentTypes.Inventory)?.container.clearAll();
    } catch {
      // gone
    }
  }

  /**
   * The line top right, above the clock: the prompt while building, the vote while voting. A vote
   * has no clock until everyone has voted, so its line goes top right on its own (hudText) until then.
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

  // ---- The end ------------------------------------------------------------------------------

  /** The standings in chat, each player's own points to them, the winner's build on show, and the result. */
  private winner(): Result {
    const everyone = this.roster.all().map((participant) => participant.name);
    for (const name of everyone) {
      this.stats.extra(name, "points", this.pointsOf(name));
      this.stats.extra(name, "bestScore", this.pointsOf(name));
    }
    this.reveal(everyone);
    const ranked = standings(this.points, this.here());
    const top = ranked[0];
    if (!top || top.points === 0) return draw("nobody got a vote");
    const winners = ranked.filter((row) => row.points === top.points).map((row) => row.name);
    const plot = this.builds.get(keyOf(winners[0]))?.plot;
    if (plot) {
      this.keepIn.clear();
      for (const name of this.online()) this.goTo(name, plot);
    }
    const reason = `${top.points} points`;
    return winners.length === 1 ? this.playerWins(winners[0], reason) : { kind: "win", players: winners, reason: `${reason} each` };
  }

  /** The standings, then each player's own parts and their points, to them alone. */
  private reveal(everyone: string[]): void {
    for (const row of standings(this.points, everyone)) {
      const gone = this.present(row.name) ? "" : say.minor(" (left)");
      this.broadcast(`${say.highlight(ordinal(row.place))} ${nameOf(row.name)}${COLOR.minor}: ${row.points} points${gone}`);
    }
    for (const name of everyone) {
      const player = this.player(name);
      if (!player) continue;
      try {
        for (const line of this.ownParts(name)) player.sendMessage(line);
      } catch {
        // gone
      }
    }
  }

  /** What `name` built (their prompt, then their twist on another's build) and what each part earned. */
  ownParts(name: string): string[] {
    const lines: string[] = [];
    const earned = (build: Build, kind: PromptKind) => {
      const part = this.scored.find((entry) => entry.build === build && entry.kind === kind);
      return part ? say.highlight(part.points === 1 ? "1 point" : `${part.points} points`) : say.minor("not voted on");
    };
    const own = this.builds.get(keyOf(name));
    if (own) lines.push(`${COLOR.minor}Your prompt §f${own.starter}${COLOR.minor}: ${earned(own, "starter")}`);
    const twisted = [...this.builds.values()].find((build) => build.twister !== undefined && keyOf(build.twister) === keyOf(name));
    if (twisted) lines.push(`${COLOR.minor}Your twist §f${twisted.twist}${COLOR.minor} on §f${twisted.starter}${COLOR.minor}: ${earned(twisted, "twist")}`);
    return lines;
  }

  protected override checkWin(): Result | undefined {
    const here = this.here();
    if (here.length === 0) return draw("everyone left");
    if (this.startedWith >= 2 && here.length === 1) return this.playerWins(here[0], "everyone else left");
    return undefined;
  }

  // ---- /floor -------------------------------------------------------------------------------

  /**
   * /floor: the block in the player's hand becomes the floor of the area they're building in, the
   * bottom layer of its boundary, whatever was there. Returns what happened.
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
      for (const tile of tiles(floorOf(box))) dimension.fillBlocks(new BlockVolume(corner(tile.min), corner(tile.max)), block);
    } catch (error) {
      log.warn(`buildswap: could not lay ${player.name}'s floor: ${describeError(error)}`);
      return say.warn("The floor didn't go down: try again.");
    }
    return say.success("Floor laid.");
  }

  // ---- The selection wand, /set, /replace and /fix ------------------------------------------

  /** /wand: a wooden axe, the selection wand. Returns what happened. */
  wand(player: Player): string {
    if (!this.workBox(player.name)) return say.minor("The wand works while you're building.");
    const wand = new ItemStack(WAND, 1);
    wand.nameTag = WAND_NAME;
    try {
      const left = player.getComponent(EntityComponentTypes.Inventory)?.container.addItem(wand);
      if (left) return say.warn("Your inventory is full: make room for the wand.");
    } catch (error) {
      log.warn(`buildswap: could not give ${player.name} the wand: ${describeError(error)}`);
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
      log.warn(`buildswap: ${player.name}'s /set failed: ${describeError(error)}`);
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
      log.warn(`buildswap: ${player.name}'s /replace failed: ${describeError(error)}`);
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
      log.warn(`buildswap: ${player.name}'s /fix failed: ${describeError(error)}`);
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
      log.warn(`buildswap: could not keep a ${block.typeId} from falling: ${describeError(error)}`);
    }
  }

  // ---- Helpers ------------------------------------------------------------------------------

  /**
   * Creative's inventory hands out any item, so outside their own round (its prep time and building
   * time) players keep only what the game gave them: a voter their vote blocks in their slots,
   * everyone else nothing (worn or held on the cursor either).
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
          if (item && !(voter && VOTES[slot]?.item === item.typeId)) container.setItem(slot);
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
  private workBox(name: string): Plot["box"] | undefined {
    return this.building ? this.working.get(keyOf(name))?.plot.box : undefined;
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
  private goTo(name: string, plot: Plot): void {
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

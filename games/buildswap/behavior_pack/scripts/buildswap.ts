// Build Swap on the minigame framework. Core runs the waiting, the countdown, the clock top right
// (each round's own), the result and the stats. This class adds the prompt form before the
// countdown, the two building rounds (your own prompt in your own building area, then a twist on
// someone else's build), and voting on every build, first as it was before its twist and then with
// it. Builders stay anonymous until the winner is shown, with everyone's builds and points in chat.
//
// Players build in creative mode, only inside the building area they're working on (they can
// change any block there), and are kept near it. Nothing spawned (mobs, items, armor stands) stays,
// TNT and fire do nothing, and liquids that run out of an area are cleared.
import {
  Direction,
  EntityComponentTypes,
  EntityInitializationCause,
  GameMode,
  ItemLockMode,
  ItemStack,
  system,
  world,
  type Entity,
  type Vector3,
} from "@minecraft/server";
import {
  COLOR,
  Minigame,
  PromptBank,
  cleanPrompt,
  countdownChime,
  dealPrompts,
  draw,
  facingOf,
  inside,
  nameOf,
  ordinal,
  PROMPT_MAX_CHARS,
  say,
  worldPoint,
  type DealablePrompt,
  type GameContext,
  type MapPosition,
  type PromptKind,
  type Result,
  type Scope,
  type SpawnReason,
} from "@minecade/minigame-core";
import type config from "../../game.config.ts";
import { DEFAULT_STARTERS, DEFAULT_TWISTS } from "./default-prompts.ts";
import { PromptForm, type PromptAnswer } from "./prompt-form.ts";
import { LiquidGuard, PLOT_REGION, Snapshots, blockInside, clampInto, grow, pairPlots, swapPlots, type Plot } from "./plots.ts";
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

/** What a player wrote before the match, or that they skipped (or ran out of time). */
type Answer = PromptAnswer | "skip";

const keyOf = (name: string) => name.toLowerCase();

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
  private readonly keepIn = new Map<string, { name: string; box: Plot["box"]; plot: Plot }>();
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
      const box = this.workBox(event.player.name);
      if (!box || !blockInside(event.block.location, box)) event.cancel = true;
    });
    // A placement that still landed outside (a tall block's top half) is taken back.
    this.scope.subscribe(world.afterEvents.playerPlaceBlock, ({ player, block }) => {
      const box = this.workBox(player.name);
      if (box && blockInside(block.location, box)) return;
      try {
        block.setType("minecraft:air");
      } catch {
        // gone already
      }
    });
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
    this.scope.interval(() => this.keepNear(), CHECK_TICKS);
  }

  // ---- The prompt form ----------------------------------------------------------------------

  /**
   * Everyone writes a prompt to build and a twist, or skips: each player's form stays up until they
   * do. Once everyone has, or promptSeconds are up (whoever hasn't is skipped), the countdown starts.
   * What they wrote goes to the prompt bank at once, and the bank is asked for prompts to deal.
   */
  protected override async beforeCountdown(_names: string[], scope: Scope): Promise<boolean> {
    const step = scope.child("prompts");
    step.add(() => this.closeForms());
    try {
      for (let left = this.config.promptSeconds * 20; ; left -= CHECK_TICKS) {
        if (this.decided) return false;
        if (this.online().length < this.minPlayers) {
          this.broadcast(say.warn("Not enough players. Waiting again."));
          return false;
        }
        const waiting = this.writers().filter((name) => !this.answers.has(keyOf(name)));
        if (waiting.length === 0 || left <= 0) break;
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

  /** A building round: everyone to the area they work on, prepSeconds to read the prompt and look, then `seconds` to build. */
  private async round(kind: PromptKind, seconds: number): Promise<void> {
    this.keepIn.clear();
    this.working.clear();
    for (const build of this.builds.values()) {
      const worker = kind === "starter" ? build.builder : build.twister;
      if (!this.present(worker)) continue;
      this.working.set(keyOf(worker!), build);
      this.keepIn.set(keyOf(worker!), { name: worker!, box: grow(build.plot.box, this.config.margin.build), plot: build.plot });
      this.lines.set(keyOf(worker!), kind === "starter" ? `${COLOR.minor}Build: §f${build.starter}` : `${COLOR.minor}Twist: §f${build.twist}${COLOR.minor} on §f${build.starter}`);
      this.clearInventory(worker!);
      this.goTo(worker!, build.plot);
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

  /** Every build in turn, in a random order: as it was before its twist, then with it. */
  private async voteAll(): Promise<void> {
    this.lines.clear();
    for (const player of world.getAllPlayers()) this.clearInventory(player.name);
    const order = shuffled(
      [...this.builds.values()].filter((build) => this.present(build.builder) || this.present(build.twister)),
      this.ctx.random,
    );
    for (const [i, build] of order.entries()) {
      this.gather(build.plot);
      this.snapshots.restore(`p${build.plot.index}_starter`, build.plot.box);
      this.title(say.highlight(`Build ${i + 1} of ${order.length}`), `§f${build.starter}`, undefined, 60);
      await this.votePart(build, "starter");
      if (build.twister !== undefined) {
        this.snapshots.restore(`p${build.plot.index}_final`, build.plot.box);
        this.title(say.highlight("The twist"), `§f${build.twist}`, undefined, 60);
        await this.votePart(build, "twist");
      }
    }
    this.keepIn.clear();
  }

  /** Everyone to a build's spawn, kept near it. */
  private gather(plot: Plot): void {
    this.keepIn.clear();
    const box = grow(plot.box, this.config.margin.vote);
    for (const name of this.online()) {
      if (this.roster.get(name)) this.keepIn.set(keyOf(name), { name, box, plot });
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

  /** The line after the clock: the prompt while building, the vote while voting. */
  protected override hud(name: string): string | undefined {
    const ballot = this.ballot;
    if (!ballot) return this.lines.get(keyOf(name));
    const count = `${COLOR.minor}${ballot.counted}/${ballot.needed} voted`;
    if (keyOf(name) === keyOf(ballot.builder)) return `${COLOR.minor}Your build   ${count}`;
    if (!ballot.isVoter(name)) return count;
    const mine = ballot.voteOf(name);
    return mine === undefined ? `${say.info("Vote with a number")}   ${count}` : `${COLOR.minor}Your vote: ${voteText(mine)}   ${count}`;
  }

  // ---- The end ------------------------------------------------------------------------------

  /** Everyone's builds and points in chat, the winner's build on show, and the result. */
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

  /** Who built what, and the standings. */
  private reveal(everyone: string[]): void {
    this.broadcast(say.highlight("The builds:"));
    const seen = new Set<Build>();
    for (const { build } of this.scored) {
      if (seen.has(build)) continue;
      seen.add(build);
      const part = (kind: PromptKind) => this.scored.find((entry) => entry.build === build && entry.kind === kind);
      const first = `§f${build.starter}${COLOR.minor} by ${nameOf(build.builder)}${COLOR.minor}: ${say.highlight(String(part("starter")?.points ?? 0))}`;
      const twist = build.twister !== undefined ? `${COLOR.minor}, twist §f${build.twist}${COLOR.minor} by ${nameOf(build.twister)}${COLOR.minor}: ${say.highlight(String(part("twist")?.points ?? 0))}` : "";
      this.broadcast(`${first}${twist}`);
    }
    for (const row of standings(this.points, everyone)) {
      const gone = this.present(row.name) ? "" : say.minor(" (left)");
      this.broadcast(`${say.highlight(ordinal(row.place))} ${nameOf(row.name)}${COLOR.minor}: ${row.points} points${gone}`);
    }
  }

  protected override checkWin(): Result | undefined {
    const here = this.here();
    if (here.length === 0) return draw("everyone left");
    if (this.startedWith >= 2 && here.length === 1) return this.playerWins(here[0], "everyone else left");
    return undefined;
  }

  // ---- Helpers ------------------------------------------------------------------------------

  /** The area `name` may build in now: theirs to work on, while building is on. */
  private workBox(name: string): Plot["box"] | undefined {
    return this.building ? this.working.get(keyOf(name))?.plot.box : undefined;
  }

  /** Players who wander off are put back inside the box they must stay in. */
  private keepNear(): void {
    for (const { name, box } of this.keepIn.values()) {
      if (this.fakes?.has(name)) continue;
      const player = this.player(name);
      if (!player || inside(player.location, box)) continue;
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

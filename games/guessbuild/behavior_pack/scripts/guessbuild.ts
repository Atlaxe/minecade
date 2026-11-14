// Guess the Build on the minigame framework and the building games' base (minigame-core's building
// kit: the prompt form, the copies of the map's arena, the building rules and tools, and voting).
// After the prompt form, everyone sits in a shuffled circle and owns a chain: a dealt prompt (what
// they wrote goes to the bank for a later match), living in their copy of the arena (chains.ts). Then the steps:
// a build step has everyone build the latest text of the chain they're on (the prompt, then the last
// guess) in that chain's arena, cleared first; a guess step has everyone look at the build in the
// chain they're on and write what they think it is, with the paper in their first slot or the form
// that comes up on its own. Then the showcase: chain by chain, everyone in its arena, the prompt top
// left, each build again from its snapshot for everyone but its builder to vote on, then each guess
// by its guesser's name ("A guessed it was ..."), and at the end what it started as. Builders stay
// anonymous until the end: the standings in chat, and each player's own builds' points to them alone.
import { ItemLockMode, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { COLOR, Notes, aborted, cleanPrompt, nameOf, PROMPT_MAX_CHARS, say, type Result } from "@minecade/minigame-core";
import { BuildingGame, PromptForm, clock, keyOf, pointsText, shuffled, type BuildJob, type PromptField, DEFAULT_STARTERS } from "@minecade/minigame-core/building";
import type config from "../../game.config.ts";
import { buildToGuess, nextText, stepCount, stepKind, workerSeat, type BuildEntry, type Chain } from "./chains.ts";

/** The guess item: paper, named Guess, in the first slot while guessing. */
export const GUESS_ITEM = "minecraft:paper";
const GUESS_NAME = "Guess";
const GUESS_SLOT = 0;
/** How often the guess step checks who's guessed (and the form's clock), in ticks. */
const GUESS_CHECK_TICKS = 5;
/** A preview's fake players guess somewhere in this many ticks. */
const FAKE_GUESS_TICKS = [40, 160];
/** The build area as the map made it, put back before each build after the first. */
const BLANK = "blank";

const FIELDS: readonly PromptField[] = [{ kind: "starter", label: "Build prompt", description: "Something to build that others can guess: a pirate ship" }];
const GUESS_FIELD = [{ key: "guess", label: "Your guess", description: "What is this build? A pirate ship" }];

export class GuessBuild extends BuildingGame<typeof config> {
  /** The circle: everyone in the match, shuffled. Seat i owns chain i. */
  private seats: string[] = [];
  private readonly chains: Chain[] = [];
  /** The guess step under way: each guesser (lowercase) and the chain they're guessing. */
  private readonly guessing = new Map<string, Chain>();
  /** What each guesser has submitted this step, cleaned. */
  private readonly guessed = new Map<string, string>();
  private readonly guessForms = new Map<string, PromptForm>();
  /** The build being voted on in the showcase. */
  private showing: { chain: Chain; entry: BuildEntry } | undefined;

  protected override promptFields(): readonly PromptField[] {
    return FIELDS;
  }

  /** The lobby's Build time setting, in seconds: each build's length. */
  get buildSeconds(): number {
    const minutes = Number(this.ctx.vars.settings.buildTime) || Number(this.config.options[0].values[0].value);
    return minutes * 60;
  }

  /** Every chain, for tests and the showcase. */
  get allChains(): readonly Chain[] {
    return this.chains;
  }

  /** The circle, seat by seat. */
  get circle(): readonly string[] {
    return this.seats;
  }

  /** The build being voted on, and its builder. */
  get voting(): { chain: Chain; entry: BuildEntry; builder: string } | undefined {
    return this.ballot && this.showing ? { ...this.showing, builder: this.showing.entry.by } : undefined;
  }

  /** What `name` is guessing now, if they are. */
  guessingOf(name: string): Chain | undefined {
    return this.guessing.get(keyOf(name));
  }

  protected override usesItem(typeId: string): boolean {
    return typeId === GUESS_ITEM && this.guessing.size > 0;
  }

  protected override onUse(name: string, _typeId: string): void {
    this.openGuess(name);
  }

  protected override keepsItem(name: string, slot: number, typeId: string): boolean {
    return typeId === GUESS_ITEM && slot === GUESS_SLOT && this.guessing.has(keyOf(name));
  }

  protected override async play(): Promise<Result | void> {
    await this.prepare();
    this.seats = shuffled(this.here(), this.ctx.random);
    if (this.plots.length < this.seats.length) {
      this.broadcast(say.warn(`This map's arena is too big to copy for ${this.seats.length} players. Pick another map.`));
      return aborted("error");
    }
    this.dealChains();
    // The build area as the map made it, before anyone builds: each later build starts from it.
    this.snapshots.save(BLANK, this.plots[0].box);
    const steps = stepCount(this.seats.length);
    for (let step = 1; step <= steps; step++) {
      if (stepKind(step) === "build") await this.buildStep(step);
      else await this.guessStep(step);
    }
    await this.showcase();
    return this.decide(
      (name) => this.ownBuilds(name),
      (winner) => this.showBest(winner),
    );
  }

  /**
   * Each seat's chain and its prompt, dealt: what players write in this match's form waits in the
   * bank for a later match (the user's ask, 2026-11-13). Everyone but a chain's owner works on it, so
   * its prompt is never one any of them wrote in an earlier match (the owner's own, or one by
   * nobody here, is fine).
   */
  private dealChains(): void {
    const here = new Set(this.seats.map(keyOf));
    const dealt = this.deal("starter", this.seats, (owner, prompt) => prompt.by === "" || prompt.by === keyOf(owner) || !here.has(prompt.by));
    this.seats.forEach((owner, index) => this.chains.push({ index, owner, prompt: dealt.get(owner)!, entries: [] }));
  }

  // ---- Building -------------------------------------------------------------------------------

  /** Everyone builds the latest text of the chain they're on, in its arena, cleared first after the first build. */
  private async buildStep(step: number): Promise<void> {
    this.lines.clear();
    const jobs: BuildJob[] = [];
    for (const chain of this.chains) {
      const plot = this.plots[chain.index];
      if (step > 1) this.snapshots.restore(BLANK, plot.box);
      const builder = this.seats[workerSeat(chain.index, step, this.seats.length)];
      if (!this.present(builder)) continue;
      const text = nextText(chain);
      chain.entries.push({ kind: "build", step, by: builder, from: text, snapshot: `c${chain.index}_s${step}` });
      const title: [string, string] = [say.highlight(step === 1 ? "Your prompt" : "Build their guess"), `§f${text}`];
      jobs.push({ name: builder, plot, line: `${COLOR.minor}Build: §f${text}`, title });
    }
    await this.buildRound(jobs, this.buildSeconds, { prep: "Get ready", build: "Build" }, step > 1 ? say.info("Build what the player before you guessed!") : undefined);
    for (const chain of this.chains) {
      const entry = chain.entries.at(-1);
      if (entry?.kind === "build" && entry.step === step) this.snapshots.save(entry.snapshot, this.plots[chain.index].box);
    }
  }

  // ---- Guessing -------------------------------------------------------------------------------

  /**
   * Everyone looks at the build in the chain they're on and writes what they think it is: the paper
   * brings up the form, and it comes up on its own guessLookSeconds in. From then on, whoever still
   * hasn't guessed and doesn't have the form up gets a big "Guess!" and a wither's roar every
   * guessNagSeconds, as Build Swap's voters do. Once all have guessed (or the time's up, taking
   * whatever is typed), the guesses go in their chains.
   */
  private async guessStep(step: number): Promise<void> {
    this.lines.clear();
    this.guessing.clear();
    this.guessed.clear();
    this.releaseAll();
    for (const chain of this.chains) {
      const guesser = this.seats[workerSeat(chain.index, step, this.seats.length)];
      if (!this.present(guesser)) continue;
      if (!buildToGuess(chain, step)) {
        this.lines.set(keyOf(guesser), `${COLOR.minor}Nothing to guess: wait for the next build`);
        this.player(guesser)?.sendMessage(say.minor("This build's builder left, so there's nothing to guess this round."));
        continue;
      }
      const plot = this.plots[chain.index];
      this.guessing.set(keyOf(guesser), chain);
      this.keepNearPlot(guesser, plot);
      this.goTo(guesser, plot);
      this.giveGuessItem(guesser);
      this.lines.set(keyOf(guesser), say.info("What is it?"));
      this.title(say.highlight("What is it?"), say.minor("Look around, then guess"), guesser, 60);
    }
    this.fakesGuess();
    let looked = false;
    await this.stage("Guess", { seconds: this.config.guessSeconds }, (stage) => {
      stage.scope.timeout(() => {
        looked = true;
        for (const name of this.guessing.keys()) if (!this.guessed.has(name) && !this.fakes?.has(name)) this.openGuess(name);
      }, this.config.guessLookSeconds * 20);
      stage.scope.interval(() => looked && this.nagGuessers(), this.config.guessNagSeconds * 20);
      stage.scope.interval(() => {
        const status = `Time left: ${clock(stage.secondsLeft ?? 0)}`;
        for (const form of this.guessForms.values()) form.update(status);
        const waiting = [...this.guessing.keys()].filter((name) => this.present(name) && !this.guessed.has(name));
        if (waiting.length === 0) stage.end();
      }, GUESS_CHECK_TICKS);
      this.countDown(stage.scope, () => stage.secondsLeft);
    });
    await this.takeTyped();
    for (const [name, chain] of this.guessing) {
      const guesser = this.roster.get(name)?.name ?? name;
      chain.entries.push({ kind: "guess", step, by: guesser, text: this.guessed.get(name) });
      this.clearInventory(guesser);
    }
    this.closeGuessForms();
    this.guessing.clear();
    this.lines.clear();
    this.releaseAll();
    this.title(say.highlight("Time's up!"));
  }

  /** The paper that brings up the guess form, named and locked in the first slot. */
  private giveGuessItem(name: string): void {
    const container = this.player(name)?.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return;
    container.clearAll();
    const paper = new ItemStack(GUESS_ITEM, 1);
    paper.nameTag = GUESS_NAME;
    paper.lockMode = ItemLockMode.slot;
    container.setItem(GUESS_SLOT, paper);
  }

  /** Brings up a guesser's form (again, with what they typed). */
  private openGuess(name: string): void {
    const key = keyOf(name);
    if (!this.guessing.has(key)) return;
    const player = this.player(name);
    if (!player) return;
    let form = this.guessForms.get(key);
    if (form?.showingTo(player)) return;
    if (!form) {
      form = new PromptForm(player, `${this.config.name}: your guess`, "", GUESS_FIELD, { submit: (answer) => this.submitGuess(name, answer.guess ?? "") });
      this.guessForms.set(key, form);
    }
    form.show();
  }

  /** Every guesser who hasn't submitted a guess and doesn't have the form up: "Guess!" and a wither's roar, to them. */
  private nagGuessers(): void {
    for (const key of this.guessing.keys()) {
      if (this.guessed.has(key) || this.fakes?.has(key) || !this.present(key)) continue;
      const player = this.player(key);
      if (!player || this.guessForms.get(key)?.showingTo(player)) continue;
      this.nag(key, say.warn("Guess!"), say.info("Use the paper to write what it is"));
    }
  }

  /** A guess submitted: undefined when it's taken (it can be changed until the time's up), else what's wrong. */
  submitGuess(name: string, text: string): string | undefined {
    const key = keyOf(name);
    if (!this.guessing.has(key)) return undefined;
    if (text.trim().length > PROMPT_MAX_CHARS) return say.warn(`Keep it to ${PROMPT_MAX_CHARS} characters.`);
    const guess = cleanPrompt(text);
    if (!guess) return say.warn("Write what you think it is.");
    this.guessed.set(key, guess);
    this.guessForms.get(key)?.hide();
    this.lines.set(key, `${COLOR.minor}Your guess: §f${guess}`);
    this.player(name)?.sendMessage(say.minor(`Your guess: ${guess}. Use the paper to change it.`));
    return undefined;
  }

  /** At the end of a guess: a guesser who typed but never submitted guesses what they typed. */
  private async takeTyped(): Promise<void> {
    const forms = [...this.guessForms].filter(([name]) => !this.guessed.has(name));
    const typed = await this.scope.guard(Promise.all(forms.map(([, form]) => form.typed())));
    forms.forEach(([name], i) => {
      const guess = cleanPrompt(typed[i].guess ?? "");
      if (guess) this.guessed.set(name, guess);
    });
  }

  private closeGuessForms(): void {
    for (const form of this.guessForms.values()) form.close();
    this.guessForms.clear();
  }

  /** A preview's fake players guess one of the game's own prompts, a while after the step starts. */
  private fakesGuess(): void {
    for (const name of this.fakes?.all ?? []) {
      const key = keyOf(name);
      if (!this.guessing.has(key)) continue;
      const [low, high] = FAKE_GUESS_TICKS;
      const chain = this.guessing.get(key);
      this.scope.timeout(
        () => {
          if (this.guessing.get(key) === chain) this.guessed.set(key, DEFAULT_STARTERS[Math.floor(this.ctx.random() * DEFAULT_STARTERS.length)]);
        },
        low + Math.floor(this.ctx.random() * (high - low)),
      );
    }
  }

  // ---- The showcase ---------------------------------------------------------------------------

  /**
   * Chain by chain, in a random order, everyone in its arena: its prompt top left, each build again
   * for everyone but its builder to vote on (the text it was built from as the title), each guess by
   * its guesser's name, and at the end what it started as.
   */
  private async showcase(): Promise<void> {
    this.lines.clear();
    for (const name of this.online()) this.clearInventory(name);
    const notesScope = this.scope.child("notes");
    const notes = new Notes(notesScope);
    const order = shuffled(
      this.chains.filter((chain) => chain.entries.some((entry) => entry.kind === "build")),
      this.ctx.random,
    );
    for (const [i, chain] of order.entries()) {
      const plot = this.plots[chain.index];
      this.gather(plot);
      const lines = [`${COLOR.minor}Prompt: §f${chain.prompt}`];
      notes.show(lines);
      let first = true;
      for (const entry of chain.entries) {
        if (entry.kind === "build") {
          this.snapshots.restore(entry.snapshot, plot.box);
          if (first) this.title(say.highlight(`Chain ${i + 1} of ${order.length}`), `§f${chain.prompt}`, undefined, 60);
          else this.title(say.highlight("Their build of"), `§f${entry.from}`, undefined, 60);
          first = false;
          this.showing = { chain, entry };
          entry.points = await this.voteOn(entry.by);
          this.showing = undefined;
          continue;
        }
        const said = entry.text ? `${nameOf(entry.by)}${COLOR.minor} guessed it was` : `${nameOf(entry.by)}${COLOR.minor} didn't guess`;
        this.title(said, entry.text ? `§f${entry.text}` : "", undefined, 60);
        this.broadcast(entry.text ? `${said} §f${entry.text}` : said);
        lines.push(entry.text ? `${COLOR.minor}${entry.by} guessed: §f${entry.text}` : `${COLOR.minor}${entry.by} didn't guess`);
        notes.show(lines);
        await this.stage("Guessed", { seconds: this.config.revealSeconds });
      }
      if (chain.entries.at(-1)?.kind === "guess") {
        this.title(say.highlight("It started as"), `§f${chain.prompt}`, undefined, 60);
        await this.stage("Started as", { seconds: this.config.revealSeconds });
      }
    }
    notesScope.dispose();
    this.releaseAll();
  }

  // ---- The end --------------------------------------------------------------------------------

  /** Every build of `name`'s, what it was built from and what it earned. */
  ownBuilds(name: string): string[] {
    return this.chains.flatMap((chain) =>
      chain.entries.flatMap((entry) => {
        if (entry.kind !== "build" || keyOf(entry.by) !== keyOf(name)) return [];
        const earned = entry.points === undefined ? say.minor("not voted on") : say.highlight(pointsText(entry.points));
        return [`${COLOR.minor}Your build of §f${entry.from}${COLOR.minor}: ${earned}`];
      }),
    );
  }

  /** The winner's best build, back in its arena, everyone there to see it. */
  private showBest(winner: string): void {
    let best: { chain: Chain; entry: BuildEntry } | undefined;
    for (const chain of this.chains) {
      for (const entry of chain.entries) {
        if (entry.kind !== "build" || keyOf(entry.by) !== keyOf(winner)) continue;
        if (!best || (entry.points ?? 0) > (best.entry.points ?? 0)) best = { chain, entry };
      }
    }
    if (!best) return;
    const plot = this.plots[best.chain.index];
    this.snapshots.restore(best.entry.snapshot, plot.box);
    for (const name of this.online()) this.goTo(name, plot);
  }
}

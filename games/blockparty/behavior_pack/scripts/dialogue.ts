// The dialogue box (docs/plans/block-party-ui.md, "The dialogue box" and "Skip and Ready"): what the
// NPCs say, bottom middle, the same for everyone. It rides the scoreboard sidebar (dialogue-codes.ts),
// which the pack's ui/jui_blockparty_dialogue.json draws (the workshop JSON UI tool's
// blockparty_dialogue component): the speaker's name on the top border, the words on the left, a
// right column with the buttons (a question to one player) or who has jumped (a line to everyone),
// and the jump button's icon at its bottom right, the player's own (a key, a controller's button, the
// touch jump), whenever a jump goes on.
//   - One sentence at a time (the user's call): nothing said before stays in the box. Each comes with
//     one sound of the speaker's voice (the user's sound map, sounds.ts), or the line's own sound
//     plays once in place of them all.
//   - Said to everyone (say): the next sentence (or the next line) comes once every player has jumped;
//     the right column names who has. Bots don't count.
//   - Said to one player (talk): only they go on, a jump a sentence, the prompt naming them for
//     everyone else. At the last sentence its buttons, if it has any, are steered with the movement
//     keys (W and S), jump picks, a tap of sneak picks its back button (Not now, Leave). A bot goes on
//     and picks after a moment's thought.
//   - A jump in the first moments of a sentence doesn't count (it was meant for the one before).
//   - A skippable line or cutscene shows the skip strip on the box's top border: holding sneak for 4
//     seconds votes to skip (the strip names who has voted, and how far along anyone holding is);
//     once every player has, the rest of it is skipped.
// A line the user hasn't written isn't shown (line() gives "").
import { system, world, type Player } from "@minecraft/server";
import { describeError, log, Sidebar, type Scope } from "@minecade/minigame-core";
import { thinkTicks, type Who } from "./bots.ts";
import { boxRows, boxTitle, readTicks, rowsOf, sentences, Steering, type BoxMode } from "./dialogue-codes.ts";
import { line, moment, type Fills } from "./lines.ts";
import { eventCue, hasCue, lineCue, playCue, voiceCue } from "./sounds.ts";

export interface DialogueHost {
  scope: Scope;
  random(): number;
  /** The sidebar's own use again (the standings top left) once the box has gone. */
  restore(): void;
}

export interface TalkOptions {
  /** Who it's said to: they steer its buttons. */
  to: Who;
  /** The buttons' labels; none: a jump goes on. */
  buttons?: readonly string[];
  /** The button sneak picks (going back), if any. */
  back?: number;
  /** The button picked first. */
  selected?: number;
  /** What a bot picks. */
  botPick?: number;
}

/** A skip vote going on: a skippable line, or a skippable cutscene. */
interface Voting {
  votes: string[];
}

/** The line on screen now. */
interface Open extends Voting {
  mode: BoxMode;
  /** The speaker's name on the border ("" for none). */
  name: string;
  /** The sentence on show, in rows. */
  words: string[];
  /** The buttons, at the last sentence of a question. */
  buttons?: string[];
  selected: number;
  /** One mode: who goes on and steers, by key; a bot does by itself. */
  steerer?: Who;
  back?: number;
  /** The tick the sentence on show came in (a jump counts from JUMP_AFTER ticks after). */
  since: number;
  /** Everyone mode: who has jumped to go on from this sentence (names, in order). */
  jumped: string[];
  /** One mode: the steerer's jump (the button picked, 0 with none). */
  picked?: number;
  /** A vote can skip it. */
  skippable: boolean;
  skipped: boolean;
}

/** Ticks after a sentence comes in before a jump counts (a jump still meant for the one before). */
const JUMP_AFTER = 6;
/** Ticks sneak is held to vote to skip (the user's 4 seconds). */
const SKIP_HOLD = 80;
/** Ticks the box waits before going, so the next line (if one comes at once) takes its place without a flicker. */
const LINGER = 3;
/** A bot's think before picking, and how long its pick shows before it goes. */
const BOT_THINK: [number, number] = [20, 40];
const BOT_SHOW = 10;

export class Dialogue {
  private readonly host: DialogueHost;
  private open: Open | undefined;
  /** The box on screen: its own scope (its sidebar goes with it) and its title. */
  private box: { scope: Scope; sidebar: Sidebar; title: string } | undefined;
  private serial = 0;
  /** The box's going, a moment after its line ends (a token; 0 for none): a line that comes meanwhile calls it off. */
  private closing = 0;
  private readonly steering = new Steering();
  /** A cutscene running: whether it can be skipped, who voted, and whether it's being skipped. */
  private scene: (Voting & { skippable: boolean; skipping: boolean }) | undefined;
  /** How long each player has held sneak toward a skip vote, in ticks, by name. */
  private readonly holding = new Map<string, number>();

  constructor(host: DialogueHost) {
    this.host = host;
    host.scope.interval(() => this.tick(), 1);
    host.scope.add(() => this.close());
  }

  /** A cutscene is being skipped: what's left of it shouldn't play (its cameras, its waits). */
  get skipping(): boolean {
    return this.scene?.skipping === true;
  }

  /** Whether the box is up. */
  get showing(): boolean {
    return this.open !== undefined;
  }

  /** Who the box is waiting on now (a line to one player: their key), if anyone: their movement keys steer it. */
  get steerer(): string | undefined {
    return this.open?.mode === "one" ? this.open.steerer?.key : undefined;
  }

  /**
   * Runs `work` as a cutscene: while it runs, a skippable one shows the skip strip, and once every
   * player has voted the rest of it is skipped (every say() in it returns at once, and `skipping`
   * tells its cameras and waits). Nested cutscenes run as part of the outer one.
   */
  async cutscene<T>(skippable: boolean, work: () => Promise<T>): Promise<T> {
    if (this.scene) return work();
    this.scene = { skippable, votes: [], skipping: false };
    try {
      return await work();
    } finally {
      this.scene = undefined;
      this.holding.clear();
    }
  }

  /** Waits `ticks`, or less once the cutscene is skipped. */
  async wait(ticks: number): Promise<void> {
    for (let i = 0; i < ticks && !this.skipping && !this.host.scope.disposed; i++) await this.host.scope.wait(1);
  }

  /**
   * Says `id` to everyone, a sentence at a time, each going on once every player has jumped.
   * `skippable` (or the user's file) lets everyone vote it away.
   */
  async say(id: string, fills: Fills = {}, skippable = false): Promise<void> {
    if (this.skipping) return;
    const text = line(id, fills, () => this.host.random());
    if (!text) return;
    const said = moment(id);
    const open = this.show({ mode: "everyone", name: nameOf(said.character), words: [], selected: 0, since: system.currentTick, jumped: [], skippable: skippable || said.skippable || this.scene?.skippable === true, votes: [], skipped: false });
    try {
      const voices = !this.lineSound(id);
      const all = sentences(text);
      for (let s = 0; s < all.length && !this.done(open); s++) {
        this.present(open, all[s], voices ? said.character : undefined);
        await this.everyoneJumped(open, all[s]);
        if (!this.done(open)) playCue(eventCue("dialogue.next"));
      }
    } finally {
      this.release(open);
    }
  }

  /**
   * Says `id` to one player, a sentence at a time, each going on at their jump, then its buttons if
   * it has any: resolves with the button they pick (0 with none), or undefined if they leave first.
   * Everyone sees it; only they steer it.
   */
  async talk(id: string, fills: Fills, options: TalkOptions): Promise<number | undefined> {
    // A question in a cutscene that's being skipped isn't asked.
    if (this.skipping) return undefined;
    const text = line(id, fills, () => this.host.random());
    const buttons = options.buttons && options.buttons.length > 0 ? [...options.buttons] : undefined;
    if (!text && !buttons) return 0;
    const said = moment(id);
    const all = text ? sentences(text) : [""];
    const open = this.show({ mode: "one", name: nameOf(said.character), words: [], selected: 0, steerer: options.to, back: options.back, since: system.currentTick, jumped: [], skippable: false, votes: [], skipped: false });
    this.steering.reset();
    try {
      const voices = text ? !this.lineSound(id) : false;
      for (let s = 0; s < all.length; s++) {
        const last = s === all.length - 1;
        open.buttons = last ? buttons : undefined;
        open.selected = last && buttons ? Math.min(Math.max(0, options.selected ?? 0), buttons.length - 1) : 0;
        this.present(open, all[s], voices ? said.character : undefined);
        const picked = await this.pick(open, all[s], last ? options.botPick : 0);
        if (picked === undefined) return undefined;
        if (last) return buttons ? picked : 0;
      }
      return undefined;
    } finally {
      this.release(open);
    }
  }

  /** A jump: the steerer going on (or picking), or a player's jump to go on from a line to everyone. True when the box took it. */
  jumped(player: Player): boolean {
    const open = this.open;
    if (!open) return false;
    if (open.mode === "one") {
      if (open.steerer?.key !== player.name.toLowerCase()) return false;
      if (open.picked === undefined && this.counts(open)) open.picked = open.selected;
      return true;
    }
    if (!this.counts(open) || open.jumped.includes(player.name)) return true;
    open.jumped.push(player.name);
    this.draw(open);
    return true;
  }

  /** A tap of sneak: the steerer's back button, if the box has one now. True when the box took it. (Holding it votes to skip: tick.) */
  sneaked(player: Player): boolean {
    const open = this.open;
    if (open?.mode !== "one" || open.steerer?.key !== player.name.toLowerCase()) return false;
    if (open.back !== undefined && open.buttons && open.picked === undefined && open.back < open.buttons.length) {
      open.selected = open.back;
      open.picked = open.back;
    }
    return true;
  }

  /** Takes the box down now. */
  close(): void {
    this.closing = 0;
    this.open = undefined;
    if (!this.box) return;
    const box = this.box;
    this.box = undefined;
    try {
      box.scope.dispose();
    } catch (error) {
      log.warn(`blockparty: the dialogue box didn't go: ${describeError(error)}`);
    }
    if (this.host.scope.disposed) return;
    playCue(eventCue("dialogue.close"));
    try {
      this.host.restore();
    } catch (error) {
      log.warn(`blockparty: putting the standings back failed: ${describeError(error)}`);
    }
  }

  /** Puts `open` on screen (in place of the box there). */
  private show(open: Open): Open {
    this.closing = 0;
    const opening = this.box === undefined;
    this.open = open;
    this.draw(open);
    if (opening) playCue(eventCue("dialogue.open"));
    return open;
  }

  /** The box goes a moment after its line ends, unless another line has taken its place. */
  private release(open: Open): void {
    if (this.open !== open) return;
    this.open = undefined;
    const token = ++this.serial;
    this.closing = token;
    this.host.scope.timeout(() => {
      if (this.closing === token && !this.open) this.close();
    }, LINGER);
  }

  /** Whether a line is over: skipped, or its box gone. */
  private done(open: Open): boolean {
    return open.skipped || this.open !== open || this.skipping || this.host.scope.disposed;
  }

  /** Whether a jump counts now (not in the sentence's first moments). */
  private counts(open: Open): boolean {
    return system.currentTick - open.since >= JUMP_AFTER;
  }

  /** Puts one sentence in the box in place of the last, with a sound of `voice`'s, if given. */
  private present(open: Open, sentence: string, voice: string | undefined): void {
    open.words = sentence ? rowsOf(sentence) : [];
    open.jumped = [];
    open.picked = undefined;
    open.since = system.currentTick;
    this.draw(open);
    if (voice && sentence) playCue(voiceCue(voice), () => this.host.random());
  }

  /** The line's own sound, if it has one (played now); else each sentence gets the voice. */
  private lineSound(id: string): boolean {
    if (!hasCue(lineCue(id))) return false;
    playCue(lineCue(id), () => this.host.random());
    return true;
  }

  /** Waits until every player has jumped (the line is skipped, or its box goes); with nobody to jump, the time to read it. */
  private async everyoneJumped(open: Open, sentence: string): Promise<void> {
    const started = system.currentTick;
    while (!this.done(open)) {
      const players = world.getAllPlayers();
      if (players.length > 0 ? players.every((player) => open.jumped.includes(player.name)) : system.currentTick - started >= readTicks(sentence)) return;
      await this.host.scope.wait(1);
    }
  }

  /** Waits for the steerer's jump or pick (a bot's after a moment); undefined if they leave or the box goes. */
  private async pick(open: Open, sentence: string, botPick: number | undefined): Promise<number | undefined> {
    const who = open.steerer;
    if (who && !who.player) {
      await this.host.scope.wait(open.buttons ? thinkTicks(() => this.host.random(), ...BOT_THINK) : readTicks(sentence));
      if (this.open !== open) return undefined;
      if (open.buttons) {
        open.selected = Math.min(Math.max(0, botPick ?? 0), open.buttons.length - 1);
        this.draw(open);
        await this.host.scope.wait(BOT_SHOW);
      }
      return this.open === open ? open.selected : undefined;
    }
    while (open.picked === undefined) {
      if (this.open !== open || this.host.scope.disposed) return undefined;
      if (who?.player && !who.player.isValid) return undefined;
      await this.host.scope.wait(1);
    }
    playCue(eventCue("dialogue.next"));
    return open.picked;
  }

  /** Each tick: the steerer's movement keys step through the buttons, and held sneaks count toward skip votes. */
  private tick(): void {
    this.steer();
    this.holds();
  }

  private steer(): void {
    const open = this.open;
    const player = open?.steerer?.player;
    if (!open?.buttons || open.buttons.length < 2 || open.picked !== undefined || !player?.isValid) return;
    let forward = 0;
    try {
      forward = player.inputInfo.getMovementVector().y;
    } catch {
      return;
    }
    const step = this.steering.step(forward);
    if (step === 0) return;
    open.selected = (open.selected + step + open.buttons.length) % open.buttons.length;
    playCue(eventCue("dialogue.button"));
    this.draw(open);
  }

  /** The skip vote going on now: the cutscene's, or the line's. */
  private voting(open: Open | undefined): Voting | undefined {
    return this.scene?.skippable ? this.scene : open?.skippable ? open : undefined;
  }

  /** Sneak held SKIP_HOLD ticks is a vote to skip; once every player has voted, it's skipped. */
  private holds(): void {
    const open = this.open;
    const voting = this.voting(open);
    if (!voting) {
      this.holding.clear();
      return;
    }
    let changed = false;
    for (const player of world.getAllPlayers()) {
      const name = player.name;
      if (voting.votes.includes(name)) continue;
      let sneaking = false;
      try {
        sneaking = player.isSneaking;
      } catch {
        // gone
      }
      if (!sneaking) {
        if (this.holding.delete(name)) changed = true;
        continue;
      }
      const held = (this.holding.get(name) ?? 0) + 1;
      if (held < SKIP_HOLD) {
        this.holding.set(name, held);
        if (held % (SKIP_HOLD / 4) === 0) changed = true;
        continue;
      }
      this.holding.delete(name);
      voting.votes.push(name);
      changed = true;
      playCue(eventCue("vote.skip"));
      if (world.getAllPlayers().every((other) => voting.votes.includes(other.name))) {
        playCue(eventCue("vote.done"));
        if (this.scene && voting === this.scene) this.scene.skipping = true;
        if (open) open.skipped = true;
      }
    }
    if (changed && open) this.draw(open);
  }

  /** Puts the box as it is now on the sidebar: a new one when the title changes. */
  private draw(open: Open): void {
    if (this.open !== open) return;
    try {
      const title = boxTitle(open.mode, open.name);
      if (!this.box || this.box.title !== title) {
        const old = this.box;
        const scope = this.host.scope.child(`dialogue box ${++this.serial}`);
        this.box = { scope, sidebar: new Sidebar(scope, `dialogue_${this.serial}`, title), title };
        old?.scope.dispose();
      }
      const voting = this.voting(open);
      // Anyone holding sneak: how far along, a quarter at a time.
      const holders = [...this.holding].filter(([, held]) => held >= SKIP_HOLD / 4).map(([name, held]) => `${name} ${Math.floor((held / SKIP_HOLD) * 4) * 25}%`);
      const skip = voting ? [line("dialogue.skip"), ...voting.votes, ...holders].filter(Boolean).join("  ") : undefined;
      // The prompt: who it waits for on a line to one player (none while a bot goes on by itself).
      const steerer = open.steerer;
      const prompt = open.mode === "everyone" ? "" : steerer?.player ? steerer.name : undefined;
      const rows = boxRows({ words: open.words, buttons: open.buttons, selected: open.selected, skip, jumped: open.mode === "everyone" ? open.jumped : undefined, prompt });
      this.box.sidebar.show(rows.map((row, i): [string, number] => [row, rows.length - i]));
    } catch (error) {
      log.warn(`blockparty: drawing the dialogue box failed: ${describeError(error)}`);
    }
  }
}

/** The name on the box's border: none for the game's own lines. */
function nameOf(character: string): string {
  return character === "Game" ? "" : character;
}

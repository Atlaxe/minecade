// The dialogue box (docs/plans/block-party-ui.md, "The dialogue box" and "Skip and Ready"): what the
// NPCs say, bottom middle, the same for everyone. It rides the scoreboard sidebar (dialogue-codes.ts),
// which the pack's ui/jui_blockparty_dialogue.json draws (the workshop JSON UI tool's
// blockparty_dialogue component): the speaker's face and name (in their color, from the workshop's
// characters.json) on the top border, the words on the left, the buttons in a right column (a
// question to one player), and the jump button's icon at its bottom right, the player's own (a key,
// a controller's button, the touch jump), whenever a jump goes on.
//   - One card at a time (the user, 2026-11-18): each line, as the user built it in the dialogue
//     tool's scene builder, is one box with all its words; nothing said before stays. While it's up
//     the speaker's voice plays once for each of its sentences, one after another (the user's sound
//     map, sounds.ts), or the line's own sound once in place of them all.
//   - Who goes on (the user, 2026-11-18): in the global cutscenes, the ones no player's turn brings
//     (the pre-game, the announcements, the end), only the party leader: the player who started the
//     game from the lobby, or who stands in for them while they're away (the host's leader()). A line
//     a player's turn brings (landing on a Star, the shop, Versus, any NPC's space: say()'s `by`)
//     goes on at that player's jump instead; at a bot's, or once they've left, the leader's. Nobody
//     else's jump does anything. With no player at all, a card waits the time it takes to read.
//   - A question to one player (talk, with buttons) is theirs to answer: they steer its buttons with
//     the movement keys (W and S), jump picks, a tap of sneak picks its back button (Not now,
//     Leave). A bot picks after a moment's thought.
//   - A fork in the path (fork(), the user, 2026-11-18): the fork box in place of the dialogue box,
//     its buttons alone side by side (Left, Right), steered with A and D by the player whose walk it
//     is and picked with jump; each way picked turns everyone's camera down it (the caller's focus).
//   - A jump in a card's first moments doesn't count (it was meant for the one before).
//   - A skippable line or cutscene shows the skip strip on the box's top border. Holding use (right
//     click: the board's item, spike.ts, holdingUse) for 4 seconds is a vote; once every player has
//     voted, the rest of it is skipped (a question in it too). The strip says (the user, 2026-11-18;
//     skipText): "Hold use to skip" before anyone has voted, "Waiting to skip 1 / 3" while some have,
//     "Waiting for Alex to skip" when one is left, and "Skipping" once everyone has. A player holding
//     use toward their vote sees "Skipping..." instead, its dots lighting up as the hold goes on
//     (holdStep; the sidebar is everyone's, so spike.ts puts the step on their own action bar). Bots
//     don't vote and don't count.
//   - Notices (the user, 2026-11-18: no titles or subtitles at all): what the game itself tells
//     everyone (whose turn it is, a round starting, a minigame's countdown) shows in the box with no
//     speaker, no jump prompt and no skip strip, for a time or until the game takes it down. A line
//     said meanwhile takes the box, and the notice comes back after it if it's still up.
//   - A line's actions (the dialogue tool's, per line: animations.ts): who does what as the card
//     comes in, some seconds in, or once it's gone on (not when it's skipped). The speaker talks as
//     the card comes in unless the line gives them something else to do then.
// A line the user hasn't written isn't shown (line() gives "").
import { system, world, type Player } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { CLIPS, talks, withTalk, type LineAction } from "./animations.ts";
import { thinkTicks, type Who } from "./bots.ts";
import { sidewaysOf } from "./board-view.ts";
import { boxRows, boxTitle, forkTitle, readTicks, rowsOf, sentences, skipText, Steering, wideButtons, type BoxMode, type ButtonIcon } from "./dialogue-codes.ts";
import { actionsOf, look, moment, pickLine, type Fills } from "./lines.ts";

/** A line as it's said, for its actions: its id, who says it, its fills, and the seat it's to or about (a turn's player, a question's). */
export interface SaidLine {
  id: string;
  character: string;
  fills: Fills;
  about?: Who;
}
import { eventCue, hasCue, lineCue, playCue, voiceCue } from "./sounds.ts";

export interface DialogueHost {
  scope: Scope;
  random(): number;
  /**
   * The box's title and rows on the game's sidebar (sidebar-rows.ts, which shares it with the board's
   * screens), or undefined once the box has gone.
   */
  show(box: { title: string; rows: readonly string[] } | undefined): void;
  /** The party leader now, if any player is here: only their jump goes on to the next card. */
  leader(): Player | undefined;
  /** Plays one of a line's actions (who does it is the host's to find: the speaker, a seat, a character). */
  act?(action: LineAction, said: SaidLine): void;
  /** Whether a player holds use (right click) down now: the skip vote's button. */
  holdingUse?(player: Player): boolean;
}

export interface TalkOptions {
  /** Who it's said to: they steer its buttons. */
  to: Who;
  /** The buttons' labels; none: it's said like any line (the leader goes on). */
  buttons?: readonly string[];
  /** The button sneak picks (going back), if any. */
  back?: number;
  /** The button picked first. */
  selected?: number;
  /** What a bot picks. */
  botPick?: number;
  /** A picture left of each button's words (Chance Time's potions), if it has one. */
  icons?: readonly (ButtonIcon | undefined)[];
}

export interface ForkOptions {
  /** Who picks the way: they steer the buttons. */
  to: Who;
  /** The ways' labels, left to right as they show ("Left", "Right"). */
  labels: readonly string[];
  /** The way picked first. */
  selected?: number;
  /** What a bot picks. */
  botPick?: number;
  /** The way picked now has changed (and as the box comes in): the camera looks down that way. */
  focus?(index: number): void;
}

/** A skip vote going on: a skippable line, or a skippable cutscene. */
interface Voting {
  votes: string[];
}

/** The card on screen now. */
interface Open extends Voting {
  mode: BoxMode;
  /** The speaker's name on the border ("" for none), and its color code. */
  name: string;
  color: string;
  /** The speaker's face's name ("" for none), and whether its picture is wide (the box's wide slot). */
  face: string;
  wide?: boolean;
  /** The line, in rows. */
  words: string[];
  /** The buttons of a question. */
  buttons?: string[];
  /** A picture left of each button's words, if it has one. */
  icons?: readonly (ButtonIcon | undefined)[];
  selected: number;
  /** A fork's: told each time the picked way changes. */
  onFocus?: (index: number) => void;
  /** A question: who steers and picks, by key; a bot does by itself. */
  steerer?: Who;
  /** A line a player's turn brought: they go on (the leader instead for a bot, or once they've gone). */
  by?: Who;
  back?: number;
  /** The tick the card came in (a jump counts from JUMP_AFTER ticks after). */
  since: number;
  /** The jump that goes on: the leader's (0), or a question's pick. */
  picked?: number;
  /** A vote can skip it. */
  skippable: boolean;
  skipped: boolean;
}

/** Ticks after a card comes in before a jump counts (a jump still meant for the one before). */
const JUMP_AFTER = 6;
/** Ticks use is held to vote to skip (the user's 4 seconds), and the steps its dots light up in. */
const SKIP_HOLD = 80;
const HOLD_STEPS = 4;
/** Ticks use is held before the player's strip says Skipping... (a click shows nothing). */
const HOLD_SHOWN = 10;
/** Ticks the box waits before going, so the next line (if one comes at once) takes its place without a flicker. */
const LINGER = 3;
/** A bot's think before picking, and how long its pick shows before it goes. */
const BOT_THINK: [number, number] = [20, 40];
const BOT_SHOW = 10;

/** A notice up now: its words in rows, and the tick it goes (undefined: when it's taken down). */
interface Notice {
  words: string[];
  until?: number;
}

/** A notice's words in rows: each line break starts a row, and a long line runs on into the next. */
export function noticeRows(text: string): string[] {
  return text
    .split("\n")
    .filter((part) => part.trim() !== "")
    .flatMap((part) => rowsOf(part));
}

export class Dialogue {
  private readonly host: DialogueHost;
  private open: Open | undefined;
  /** The box on screen, by its title. */
  private box: { title: string } | undefined;
  private serial = 0;
  /** The box's going, a moment after its line ends (a token; 0 for none): a line that comes meanwhile calls it off. */
  private closing = 0;
  private readonly steering = new Steering();
  /** A cutscene running: whether it can be skipped, who voted, and whether it's being skipped. */
  private scene: (Voting & { skippable: boolean; skipping: boolean }) | undefined;
  /** How long each player has held use toward a skip vote, in ticks, by name. */
  private readonly holding = new Map<string, number>();
  /** The notice up now, if any: the box shows it whenever no line is up. */
  private notice: Notice | undefined;

  constructor(host: DialogueHost) {
    this.host = host;
    host.scope.interval(() => this.tick(), 1);
    host.scope.add(() => {
      this.notice = undefined;
      this.close();
    });
  }

  /**
   * Puts the game's own words in the box with no speaker (in place of a title): no jump goes on from
   * it and nobody can skip it. It stays `ticks` (undefined: until the returned function takes it
   * down, or another notice takes its place). A line break starts a new row. A line said meanwhile
   * takes the box; the notice comes back after it while it's still up. Empty text takes the notice
   * down.
   */
  notify(text: string, ticks?: number): () => void {
    const words = noticeRows(text);
    if (words.length === 0) {
      this.endNotice(this.notice);
      return () => undefined;
    }
    const notice: Notice = { words, until: ticks === undefined ? undefined : system.currentTick + Math.max(1, Math.round(ticks)) };
    this.notice = notice;
    if (!this.open) {
      this.closing = 0;
      this.drawNotice(notice);
    }
    return () => this.endNotice(notice);
  }

  /** A cutscene is being skipped: what's left of it shouldn't play (its cameras, its waits). */
  get skipping(): boolean {
    return this.scene?.skipping === true;
  }

  /** Whether the box is up. */
  get showing(): boolean {
    return this.open !== undefined;
  }

  /** Who the box is waiting on to answer a question (their key), if anyone: their movement keys steer it. */
  get steerer(): string | undefined {
    const mode = this.open?.mode;
    return mode === "one" || mode === "fork" ? this.open?.steerer?.key : undefined;
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
   * Says `id` to everyone: the whole line in the box, until the leader jumps, or `by` when their turn
   * brought it (a player who landed on an NPC's space). `skippable` (or the user's file) lets
   * everyone vote it away.
   */
  async say(id: string, fills: Fills = {}, skippable = false, by?: Who): Promise<void> {
    if (this.skipping) return;
    const { text, index } = pickLine(id, fills, () => this.host.random());
    if (!text) return;
    const said = moment(id);
    const open = this.show({ mode: "everyone", ...this.speaker(said.character), words: rowsOf(text), selected: 0, by, since: system.currentTick, skippable: skippable || said.skippable || this.scene?.skippable === true, votes: [], skipped: false });
    const ended = this.actions(open, { id, character: said.character, fills, about: by }, index);
    try {
      this.voice(id, open, text, said.character);
      await this.goneOn(open, text);
      if (!this.done(open)) playCue(eventCue("dialogue.next"));
      ended();
    } finally {
      this.release(open);
    }
  }

  /**
   * Asks `id` of one player: the whole line with its buttons, which they steer and pick from.
   * Resolves with the button they pick, or undefined if they leave first. Everyone sees it; only they
   * steer it. With no buttons it's said like any line, going on at their jump, and resolves with 0.
   */
  async talk(id: string, fills: Fills, options: TalkOptions): Promise<number | undefined> {
    // A question in a cutscene that's being skipped isn't asked.
    if (this.skipping) return undefined;
    const buttons = options.buttons && options.buttons.length > 0 ? [...options.buttons] : undefined;
    if (!buttons) {
      await this.say(id, fills, false, options.to);
      return 0;
    }
    const { text, index } = pickLine(id, fills, () => this.host.random());
    const said = moment(id);
    const selected = Math.min(Math.max(0, options.selected ?? 0), buttons.length - 1);
    const open = this.show({ mode: "one", ...this.speaker(said.character), words: text ? rowsOf(text) : [], buttons, icons: options.icons, selected, steerer: options.to, back: options.back, since: system.currentTick, skippable: false, votes: [], skipped: false });
    this.steering.reset();
    const ended = text ? this.actions(open, { id, character: said.character, fills, about: options.to }, index) : () => undefined;
    try {
      if (text) this.voice(id, open, text, said.character);
      const picked = await this.pick(open, options.botPick);
      if (picked !== undefined) ended();
      return picked;
    } finally {
      this.release(open);
    }
  }

  /**
   * A fork in the path (the user, 2026-11-18: like the dialogue box, not a form): the fork box, its
   * buttons the only thing in it, side by side across it ("Left", "Right"). The player whose walk it
   * is steers with A and D (a stick's left and right) and jumps to pick; everyone sees the box and,
   * through `focus`, the way it's on. A bot moves to its pick after a moment's thought. Resolves with
   * the way picked, or undefined if they leave first.
   */
  async fork(options: ForkOptions): Promise<number | undefined> {
    const labels = [...options.labels];
    if (labels.length === 0) return undefined;
    const selected = Math.min(Math.max(0, options.selected ?? 0), labels.length - 1);
    const open = this.show({ mode: "fork", name: "", color: "", face: "", words: [], buttons: labels, selected, steerer: options.to, onFocus: options.focus, since: system.currentTick, skippable: false, votes: [], skipped: false });
    this.steering.reset();
    this.focused(open);
    try {
      return await this.pick(open, options.botPick);
    } finally {
      this.release(open);
    }
  }

  /**
   * How far `name` (a player) is through holding use toward a skip vote (0 to HOLD_STEPS - 1), or
   * undefined when they aren't holding toward one: their own strip says "Skipping...", its dots lit
   * that far (spike.ts puts holdingCode(step) on their action bar).
   */
  holdStep(name: string): number | undefined {
    const voting = this.voting(this.open);
    const held = this.holding.get(name);
    if (!voting || held === undefined || held < HOLD_SHOWN || voting.votes.includes(name)) return undefined;
    return Math.min(HOLD_STEPS - 1, Math.floor(((held - HOLD_SHOWN) / (SKIP_HOLD - HOLD_SHOWN)) * HOLD_STEPS));
  }

  /** A jump: the one who goes on (the leader, or the player whose turn brought the line) going on, or a question's steerer picking. True when the box took it. */
  jumped(player: Player): boolean {
    const open = this.open;
    if (!open) return false;
    if (open.mode === "one" || open.mode === "fork") {
      if (open.steerer?.key !== player.name.toLowerCase()) return false;
      if (open.picked === undefined && this.counts(open)) open.picked = open.selected;
      return true;
    }
    // A line to everyone: only the one who goes on; anyone else's jump does nothing while it's up.
    if (open.picked === undefined && this.counts(open) && this.goer(open)?.name === player.name) open.picked = 0;
    return true;
  }

  /** A tap of sneak: the steerer's back button, if the box has one now. True when the box took it. (Holding it votes to skip: tick.) */
  sneaked(player: Player): boolean {
    const open = this.open;
    // A fork has no back button: its steerer's sneak does nothing else meanwhile.
    if (open?.mode === "fork") return open.steerer?.key === player.name.toLowerCase();
    if (open?.mode !== "one" || open.steerer?.key !== player.name.toLowerCase()) return false;
    if (open.back !== undefined && open.buttons && open.picked === undefined && open.back < open.buttons.length) {
      open.selected = open.back;
      open.picked = open.back;
    }
    return true;
  }

  /** Takes the box down now (a notice still up takes its place). */
  close(): void {
    this.closing = 0;
    this.open = undefined;
    if (this.notice && !this.host.scope.disposed) {
      this.drawNotice(this.notice);
      return;
    }
    if (!this.box) return;
    this.box = undefined;
    if (this.host.scope.disposed) return;
    try {
      this.host.show(undefined);
    } catch (error) {
      log.warn(`blockparty: the dialogue box didn't go: ${describeError(error)}`);
    }
    playCue(eventCue("dialogue.close"));
  }

  /** The speaker's name on the border (none for the game's own lines), its color and face. */
  private speaker(character: string): { name: string; color: string; face: string; wide: boolean } {
    if (character === "Game") return { name: "", color: "", face: "", wide: false };
    return { name: character, ...look(character) };
  }

  /** Who goes on from a line to everyone: the player whose turn brought it while they're here, else the leader. */
  private goer(open: Open): Player | undefined {
    const by = open.by?.player;
    return by?.isValid ? by : this.host.leader();
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

  /** Whether a jump counts now (not in the card's first moments). */
  private counts(open: Open): boolean {
    return system.currentTick - open.since >= JUMP_AFTER;
  }

  /**
   * The line's own sound once, if it has one; else one sound of the speaker's voice for each of its
   * sentences, one after another, each after the time it takes to read the one before (they stop
   * once the card has gone).
   */
  private voice(id: string, open: Open, text: string, character: string): void {
    if (hasCue(lineCue(id))) {
      playCue(lineCue(id), () => this.host.random());
      return;
    }
    let at = 0;
    for (const sentence of sentences(text)) {
      const play = () => {
        if (this.open === open && !open.skipped) playCue(voiceCue(character), () => this.host.random());
      };
      if (at === 0) play();
      else this.host.scope.timeout(play, at);
      at += readTicks(sentence);
    }
  }

  /**
   * A line's actions (the user's file's, and the speaker's Talk as it starts unless the file gives
   * them something then): the Start ones now, the After ones that many seconds in, and the End ones
   * when the returned function is called, once the line has gone on. None of it once the line or
   * its cutscene is skipped.
   */
  private actions(open: Open, said: SaidLine, index: number): () => void {
    const act = this.host.act;
    if (!act) return () => undefined;
    const list = withTalk(actionsOf(said.id, index), said.character, talks(CLIPS, said.character));
    const play = (action: LineAction) => {
      if (open.skipped || this.skipping || this.host.scope.disposed) return;
      try {
        act(action, said);
      } catch (error) {
        log.warn(`blockparty: ${said.id}'s action ${action.who} ${action.action} failed: ${describeError(error)}`);
      }
    };
    for (const action of list) {
      if (action.when === "Start") play(action);
      else if (action.when === "After") this.host.scope.timeout(() => play(action), Math.max(1, Math.round((action.seconds ?? 0) * 20)));
    }
    return () => {
      for (const action of list) if (action.when === "End") play(action);
    };
  }

  /** Waits for the jump that goes on (the line is skipped, or its box goes); with no player here, the time to read it. */
  private async goneOn(open: Open, text: string): Promise<void> {
    const started = system.currentTick;
    const read = sentences(text).reduce((sum, sentence) => sum + readTicks(sentence), 0);
    while (!this.done(open) && open.picked === undefined) {
      if (this.goer(open) === undefined && system.currentTick - started >= read) return;
      await this.host.scope.wait(1);
    }
  }

  /** Waits for the steerer's pick (a bot's after a moment); undefined if they leave or the box goes. */
  private async pick(open: Open, botPick: number | undefined): Promise<number | undefined> {
    const who = open.steerer;
    if (who && !who.player) {
      await this.host.scope.wait(thinkTicks(() => this.host.random(), ...BOT_THINK));
      if (this.open !== open) return undefined;
      open.selected = Math.min(Math.max(0, botPick ?? 0), (open.buttons?.length ?? 1) - 1);
      this.draw(open);
      this.focused(open);
      await this.host.scope.wait(BOT_SHOW);
      return this.open === open ? open.selected : undefined;
    }
    while (open.picked === undefined) {
      // Gone, or skipped with the rest of its cutscene.
      if (this.done(open)) return undefined;
      if (who?.player && !who.player.isValid) return undefined;
      await this.host.scope.wait(1);
    }
    playCue(eventCue("dialogue.next"));
    return open.picked;
  }

  /** Each tick: the steerer's movement keys step through the buttons, held sneaks count toward skip votes, and a notice's time runs out. */
  private tick(): void {
    this.steer();
    this.holds();
    const notice = this.notice;
    if (notice?.until !== undefined && system.currentTick >= notice.until) this.endNotice(notice);
  }

  /** Takes `notice` down, if it's still the one up: the box goes with it unless a line has it. */
  private endNotice(notice: Notice | undefined): void {
    if (!notice || this.notice !== notice) return;
    this.notice = undefined;
    if (!this.open && this.closing === 0) this.close();
  }

  /** Puts a notice on the sidebar: the box with no speaker, only its words. */
  private drawNotice(notice: Notice): void {
    try {
      const title = boxTitle("everyone", "");
      this.box = { title };
      this.host.show({ title, rows: boxRows({ words: notice.words }) });
    } catch (error) {
      log.warn(`blockparty: drawing a notice failed: ${describeError(error)}`);
    }
  }

  private steer(): void {
    const open = this.open;
    const player = open?.steerer?.player;
    if (!open?.buttons || open.buttons.length < 2 || open.picked !== undefined || !player?.isValid) return;
    let forward = 0;
    try {
      const vector = player.inputInfo.getMovementVector();
      // A fork's ways are side by side: A and D step through them; a question's are a column (W and S).
      forward = open.mode === "fork" ? sidewaysOf(vector) : vector.y;
    } catch {
      return;
    }
    const step = this.steering.step(forward);
    if (step === 0) return;
    if (open.mode === "fork") {
      // Side by side, the ends don't wrap round: D on the rightmost way stays there.
      const next = Math.min(open.buttons.length - 1, Math.max(0, open.selected + step));
      if (next === open.selected) return;
      open.selected = next;
    } else open.selected = (open.selected + step + open.buttons.length) % open.buttons.length;
    playCue(eventCue("dialogue.button"));
    this.draw(open);
    this.focused(open);
  }

  /** Tells a fork's watcher which way is picked now. */
  private focused(open: Open): void {
    if (this.open !== open || !open.onFocus) return;
    try {
      open.onFocus(open.selected);
    } catch (error) {
      log.warn(`blockparty: a fork's view failed: ${describeError(error)}`);
    }
  }

  /** The skip vote going on now: the cutscene's, or the line's. */
  private voting(open: Open | undefined): Voting | undefined {
    return this.scene?.skippable ? this.scene : open?.skippable ? open : undefined;
  }

  /** Use held SKIP_HOLD ticks is a vote to skip; once every player here has voted, it's skipped. */
  private holds(): void {
    const open = this.open;
    const voting = this.voting(open);
    if (!voting) {
      this.holding.clear();
      return;
    }
    const players = world.getAllPlayers();
    let changed = false;
    for (const player of players) {
      const name = player.name;
      if (voting.votes.includes(name)) continue;
      if (this.host.holdingUse?.(player) !== true) {
        this.holding.delete(name);
        continue;
      }
      const held = (this.holding.get(name) ?? 0) + 1;
      if (held < SKIP_HOLD) {
        this.holding.set(name, held);
        continue;
      }
      this.holding.delete(name);
      voting.votes.push(name);
      changed = true;
      playCue(eventCue("vote.skip"));
    }
    // Everyone here has voted (someone who voted may have left since): skipped.
    const skipped = this.scene?.skipping === true || open?.skipped === true;
    if (!skipped && players.length > 0 && players.every((player) => voting.votes.includes(player.name))) {
      playCue(eventCue("vote.done"));
      if (this.scene && voting === this.scene) this.scene.skipping = true;
      if (open) open.skipped = true;
      changed = true;
    }
    if (changed && open) this.draw(open);
  }

  /** The skip strip's words for the players here and their votes (skipText). */
  private votesText(voting: Voting): string {
    return skipText(voting.votes, world.getAllPlayers().map((player) => player.name));
  }

  /** Puts the box as it is now on the sidebar. */
  private draw(open: Open): void {
    if (this.open !== open) return;
    try {
      if (open.mode === "fork") {
        // The fork box: its buttons alone, across it.
        const title = forkTitle(open.buttons?.length ?? 2);
        this.box = { title };
        this.host.show({ title, rows: boxRows({ words: [], buttons: open.buttons, selected: open.selected }) });
        return;
      }
      // A question with long labels: its buttons under the words, the box's whole width.
      const title = boxTitle(open.mode, open.name, open.color, open.mode === "one" && wideButtons(open.buttons));
      this.box = { title };
      const voting = this.voting(open);
      const skip = voting ? this.votesText(voting) : undefined;
      // The jump prompt, while a jump goes on: the leader's or the turn's player's to everyone, the steerer's on a question (none while a bot picks).
      const waiting = open.mode === "everyone" ? this.goer(open) !== undefined : open.steerer?.player !== undefined;
      const rows = boxRows({ face: open.name ? open.face : undefined, faceWide: open.wide, words: open.words, buttons: open.buttons, icons: open.icons, selected: open.selected, skip, prompt: waiting ? "" : undefined });
      this.host.show({ title, rows });
    } catch (error) {
      log.warn(`blockparty: drawing the dialogue box failed: ${describeError(error)}`);
    }
  }
}


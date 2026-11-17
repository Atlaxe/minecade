// The dialogue box (docs/plans/block-party-ui.md, "The dialogue box" and "Skip and Ready"): what the
// NPCs say, bottom middle, the same for everyone. It rides the scoreboard sidebar (dialogue-codes.ts),
// which the pack's ui/blockparty_dialogue.json draws: the speaker's name on the top border, the
// words, and, for a line said to one player, a column of buttons beside them.
//   - The words come a sentence at a time, each with one sound of the speaker's voice (the user's
//     sound map, sounds.ts), or once with the line's own sound when it has one. A long line goes on
//     over pages.
//   - Said to one player (talk): its buttons (Next when it has no choice) are steered with the
//     movement keys (W and S), jump picks, sneak picks its back button (Not now, Leave) if it has
//     one. A jump while the words still come shows them all. Only that player steers; a bot picks
//     after a moment's thought. Everyone else watches the same box.
//   - Said to everyone (say): the words take the whole width and go on by themselves once read. One
//     that can be skipped shows the skip strip bottom right, with the names of those who've jumped
//     to skip; once every player has, it's skipped. Inside a skippable cutscene a skip ends the rest
//     of it.
// A line the user hasn't written isn't shown (line() gives "").
import { world, type Player } from "@minecraft/server";
import { describeError, log, Sidebar, type Scope } from "@minecade/minigame-core";
import { thinkTicks, type Who } from "./bots.ts";
import { boxRows, boxTitle, pages, readTicks, rowsOf, Steering, type BoxMode } from "./dialogue-codes.ts";
import { button, line, moment, type Fills } from "./lines.ts";
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
  /** The buttons' labels; none gives Next. */
  buttons?: readonly string[];
  /** The button sneak picks (going back), if any. */
  back?: number;
  /** The button picked first. */
  selected?: number;
  /** What a bot picks. */
  botPick?: number;
}

/** The line on screen now. */
interface Open {
  mode: BoxMode;
  /** The speaker's name on the border ("" for none). */
  name: string;
  words: string[];
  buttons?: string[];
  selected: number;
  /** One mode: who steers, by key; a bot steers by itself. */
  steerer?: Who;
  back?: number;
  /** The steerer jumped while the words came: show the rest at once. */
  hurry: boolean;
  /** A button was picked. */
  picked?: number;
  /** Everyone mode: a vote can skip it, and who has voted (names, in order). */
  skippable: boolean;
  votes: string[];
  skipped: boolean;
}

/** Ticks a line said to everyone stays up once all of it is out. */
const HOLD = 30;
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
  private scene: { skippable: boolean; votes: string[]; skipping: boolean } | undefined;

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

  /**
   * Runs `work` as a cutscene: while it runs, a skippable one shows the skip strip, and once every
   * player has jumped the rest of it is skipped (every say() in it returns at once, and `skipping`
   * tells its cameras and waits). Nested cutscenes run as part of the outer one.
   */
  async cutscene<T>(skippable: boolean, work: () => Promise<T>): Promise<T> {
    if (this.scene) return work();
    this.scene = { skippable, votes: [], skipping: false };
    try {
      return await work();
    } finally {
      this.scene = undefined;
    }
  }

  /** Waits `ticks`, or less once the cutscene is skipped. */
  async wait(ticks: number): Promise<void> {
    for (let i = 0; i < ticks && !this.skipping && !this.host.scope.disposed; i++) await this.host.scope.wait(1);
  }

  /**
   * Says `id` to everyone, the words the whole width, going on by itself once it's read. `skippable`
   * (or the user's file) lets everyone vote it away.
   */
  async say(id: string, fills: Fills = {}, skippable = false): Promise<void> {
    if (this.skipping) return;
    const text = line(id, fills, () => this.host.random());
    if (!text) return;
    const said = moment(id);
    const open = this.show({ mode: "everyone", name: nameOf(said.character), words: [], selected: 0, hurry: false, skippable: skippable || said.skippable || this.scene?.skippable === true, votes: [], skipped: false });
    try {
      const own = this.lineSound(id);
      const all = pages(text);
      for (let p = 0; p < all.length && !this.done(open); p++) {
        open.words = [];
        await this.reveal(open, all[p], said.character, own && p === 0);
        await this.until(open, HOLD);
      }
    } finally {
      this.release(open);
    }
  }

  /**
   * Says `id` to one player, with buttons (Next when there are none): resolves with the button they
   * pick, or undefined if they leave first. Everyone sees it; only they steer it.
   */
  async talk(id: string, fills: Fills, options: TalkOptions): Promise<number | undefined> {
    // A question in a cutscene that's being skipped isn't asked.
    if (this.skipping) return undefined;
    const text = line(id, fills, () => this.host.random());
    const buttons = options.buttons && options.buttons.length > 0 ? [...options.buttons] : [button("dialogue.next")];
    if (!text && !options.buttons) return 0;
    const said = moment(id);
    const all = text ? pages(text) : [[]];
    const open = this.show({ mode: "one", name: nameOf(said.character), words: [], selected: 0, steerer: options.to, back: options.back, hurry: false, skippable: false, votes: [], skipped: false });
    this.steering.reset();
    try {
      const own = text ? this.lineSound(id) : false;
      for (let p = 0; p < all.length; p++) {
        const last = p === all.length - 1;
        open.words = [];
        open.buttons = undefined;
        open.hurry = false;
        await this.reveal(open, all[p], said.character, own && p === 0);
        open.buttons = last ? buttons : [button("dialogue.next")];
        open.selected = last ? Math.min(Math.max(0, options.selected ?? 0), buttons.length - 1) : 0;
        open.picked = undefined;
        this.draw(open);
        const picked = await this.pick(open, last ? options.botPick : 0);
        if (picked === undefined) return undefined;
        if (last) return picked;
        playCue(eventCue("dialogue.next"));
      }
      return undefined;
    } finally {
      this.release(open);
    }
  }

  /** A jump: the steerer's pick (or hurry), or a vote to skip. True when the box took it. */
  jumped(player: Player): boolean {
    const key = player.name.toLowerCase();
    const open = this.open;
    if (open?.mode === "one") {
      if (open.steerer?.key !== key) return false;
      if (open.buttons === undefined) open.hurry = true;
      else if (open.picked === undefined) open.picked = open.selected;
      return true;
    }
    const voting = this.scene?.skippable ? this.scene : open?.skippable ? open : undefined;
    if (!voting) return false;
    const name = player.name;
    if (!voting.votes.includes(name)) {
      voting.votes.push(name);
      playCue(eventCue("vote.skip"));
      const everyone = world.getAllPlayers().every((other) => voting.votes.includes(other.name));
      if (everyone) {
        playCue(eventCue("vote.done"));
        if (voting === this.scene) this.scene.skipping = true;
        if (open) open.skipped = true;
      }
      if (open) this.draw(open);
    }
    return true;
  }

  /** A sneak: the steerer's back button, if the box has one now. True when the box took it. */
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

  /** Brings a page's sentences in one at a time, each with a sound of the speaker's voice (none with a line sound of its own). */
  private async reveal(open: Open, sentences: readonly string[], character: string, ownSound: boolean): Promise<void> {
    for (let s = 0; s < sentences.length; s++) {
      if (this.done(open) && open.mode === "everyone") return;
      open.words.push(...rowsOf(sentences[s]));
      this.draw(open);
      if (!open.hurry && !ownSound) playCue(voiceCue(character), () => this.host.random());
      if (open.hurry) continue;
      const last = s === sentences.length - 1;
      await this.until(open, last && open.mode === "one" ? 6 : readTicks(sentences[s]));
    }
  }

  /** The line's own sound, if it has one (played now); else each sentence gets the voice. */
  private lineSound(id: string): boolean {
    if (!hasCue(lineCue(id))) return false;
    playCue(lineCue(id), () => this.host.random());
    return true;
  }

  /** Waits `ticks`, or less once the line is skipped, hurried or gone. */
  private async until(open: Open, ticks: number): Promise<void> {
    for (let i = 0; i < ticks && !this.done(open) && !open.hurry; i++) await this.host.scope.wait(1);
  }

  /** Waits for the steerer's pick (a bot's after a moment); undefined if they leave or the box goes. */
  private async pick(open: Open, botPick: number | undefined): Promise<number | undefined> {
    const who = open.steerer;
    if (who && !who.player) {
      await this.host.scope.wait(thinkTicks(() => this.host.random(), ...BOT_THINK));
      if (this.open !== open) return undefined;
      open.selected = Math.min(Math.max(0, botPick ?? 0), (open.buttons?.length ?? 1) - 1);
      this.draw(open);
      await this.host.scope.wait(BOT_SHOW);
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

  /** Each tick: the steerer's movement keys step through the buttons. */
  private tick(): void {
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
      const voting = this.scene?.skippable ? this.scene : open.skippable ? open : undefined;
      const skip = voting ? [line("dialogue.skip"), ...voting.votes].filter(Boolean).join("  ") : undefined;
      const rows = boxRows({ words: open.words, buttons: open.buttons, selected: open.selected, skip });
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

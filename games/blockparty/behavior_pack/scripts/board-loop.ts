// Block Party's board loop (docs/plans/block-party.md, "Core loop"; pass 4 of "Suggested order"):
//   1. Everyone gets 10 coins (Chris hands them out once the NPCs have their stages, pass 6), and the
//      Stars go to the board's opening spots (two in a 10-turn game, else one).
//   2. Turn order: everyone rolls at once (their dice open, a jump each), highest first.
//   3. Each round, each player in turn opens their dice, rolls by jumping, and their piece walks the
//      number: at a branch they pick the way (a form), and passing or landing on a Star they're
//      offered it for its price (15, 20 or 25 coins by the game's length), after which it moves to a
//      candidate far away. Landing pays: Blue +3 coins, Red -3 (never below 0); the other types say
//      what they'll do, as their passes come.
//   4. After everyone has moved, a minigame (pass 5; for now a short pause), then the next round.
//   5. After the last round, most Stars wins, then coins; a tie still standing goes to chance (the
//      Allay picks, pass 8).
// A player who isn't there when their turn comes is skipped and keeps their place. Someone new comes
// in at the start of the next round, at Start, last in the turn order, with as many coins as last
// place and no Stars. No timers: the game waits for each roll and choice.
import { world, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { describeError, log, showForm, type Result, type Scope } from "@minecade/minigame-core";
import { BLOCK_PARTY_BOARD } from "@minecade/minigame-core/config";
import type { Space } from "./board.ts";
import { START_COINS, activeStars, addCoins, coinsFor, count, firstStars, leaders, nextStar, ranked, starDistance, starPrice, turnOrder, type Standing } from "./board-rules.ts";
import type { Pieces } from "./pieces.ts";

export interface LoopHost {
  scope: Scope;
  spaces(): readonly Space[];
  pieces: Pieces;
  /** The game's length in rounds (the lobby's Length option). */
  turns: number;
  /** Opens the player's dice and resolves with what they roll (undefined if they leave first); `shot`: everyone watches through the roll camera. */
  roll(player: Player, shot: boolean): Promise<number | undefined>;
  everyone(text: string): void;
  tell(player: Player, text: string): void;
  /** A big line on everyone's screen. */
  title(text: string, subtitle?: string): void;
  /** Whose turn, coins or Stars changed: the HUD and the standings follow. */
  changed(): void;
  random(): number;
}

interface Seat {
  name: string;
  coins: number;
  stars: number;
}

/** Ticks between drawings of the Stars' beams. */
const BEAM_TICKS = 10;
/** The minigame's stand-in between rounds, in ticks. */
const MINIGAME_PAUSE = 60;

export class BoardLoop {
  private readonly seats = new Map<string, Seat>();
  private order: string[] = [];
  private round = 0;
  /** The player whose turn it is, by lowercased name. */
  private turn: string | undefined;
  /** The spaces the Stars are on, by index. */
  private stars: number[] = [];
  private running = false;
  private readonly host: LoopHost;

  constructor(host: LoopHost) {
    this.host = host;
    host.scope.interval(() => this.drawBeams(), BEAM_TICKS);
  }

  /** Whether the loop has started (the board is the game's now). */
  get active(): boolean {
    return this.running;
  }

  /** The HUD's line for a player: the round, whose turn it is, and what they have. */
  hudText(player: Player): string {
    if (!this.running) return "";
    const seat = this.seats.get(player.name.toLowerCase());
    const turn = this.turn ? (this.turn === player.name.toLowerCase() ? "your turn" : `${this.seats.get(this.turn)?.name ?? this.turn}'s turn`) : this.round === 0 ? "rolling for turns" : "everyone's moved";
    const round = this.round === 0 ? "" : `Round ${this.round} of ${this.host.turns}, `;
    return seat ? `${round}${turn}. You: ${count(seat.coins, "coin")}, ${count(seat.stars, "Star")}` : `${round}${turn}`;
  }

  /** The standings for everyone, best first: "1. Alex: 2 Stars, 14 coins". */
  standings(): string[] {
    if (!this.running) return [];
    return ranked([...this.seats.values()]).map((seat, index) => `${index + 1}. ${seat.name}: ${count(seat.stars, "Star")}, ${count(seat.coins, "coin")}`);
  }

  async run(): Promise<Result> {
    this.running = true;
    const spaces = this.host.spaces();
    for (const player of world.getAllPlayers()) this.seat(player, START_COINS);
    this.stars = firstStars(spaces, activeStars(this.host.turns), this.host.random);
    this.host.everyone(`Everyone starts with ${count(START_COINS, "coin")}. ${this.starsText()}`);
    this.host.changed();

    // Turn order: everyone rolls at once.
    this.host.title("Roll for turn order", "Jump to hit your die");
    const present = world.getAllPlayers();
    const rolls = await Promise.all(present.map(async (player) => ({ name: player.name.toLowerCase(), roll: (await this.host.roll(player, false)) ?? 0 })));
    this.order = turnOrder(rolls);
    this.host.everyone(`Turn order: ${this.order.map((name) => `${this.seats.get(name)?.name ?? name} (${rolls.find((entry) => entry.name === name)?.roll})`).join(", ")}.`);

    for (this.round = 1; this.round <= this.host.turns; this.round++) {
      this.seatLateJoiners();
      this.host.title(`Round ${this.round} of ${this.host.turns}`);
      this.host.changed();
      await this.host.scope.wait(30);
      for (const name of [...this.order]) {
        const player = world.getAllPlayers().find((candidate) => candidate.name.toLowerCase() === name);
        if (!player) {
          this.host.everyone(`${this.seats.get(name)?.name ?? name} isn't here: their turn is skipped.`);
          continue;
        }
        try {
          await this.playTurn(player);
        } catch (error) {
          log.warn(`blockparty: ${name}'s turn failed: ${describeError(error)}`);
        }
      }
      this.turn = undefined;
      this.host.changed();
      // The minigame (pass 5).
      this.host.title("Minigame time", "Minigames come with the next pass");
      await this.host.scope.wait(MINIGAME_PAUSE);
    }
    this.round = this.host.turns;
    return this.finish();
  }

  /** A player sits down with `coins` and no Stars, last in the turn order. */
  private seat(player: Player, coins: number): void {
    const key = player.name.toLowerCase();
    if (this.seats.has(key)) return;
    this.seats.set(key, { name: player.name, coins, stars: 0 });
    if (this.order.length > 0 && !this.order.includes(key)) this.order.push(key);
  }

  /** Anyone new comes in at Start, last in the turn order, with as many coins as last place. */
  private seatLateJoiners(): void {
    const last = Math.min(...[...this.seats.values()].map((seat) => seat.coins), START_COINS);
    for (const player of world.getAllPlayers()) {
      if (this.seats.has(player.name.toLowerCase())) continue;
      this.seat(player, last);
      this.host.pieces.reset(player);
      this.host.everyone(`${player.name} joins at Start with ${count(last, "coin")}, last in the turn order.`);
    }
  }

  private async playTurn(player: Player): Promise<void> {
    const name = player.name.toLowerCase();
    this.turn = name;
    this.host.changed();
    this.host.title(`${player.name}'s turn`, "Pick a die and jump to roll");
    const rolled = await this.host.roll(player, true);
    if (rolled === undefined || !player.isValid) return;
    this.host.everyone(`${player.name} rolled ${rolled}.`);
    await this.move(player, rolled);
    if (!player.isValid) return;
    this.land(player);
    for (const watcher of world.getAllPlayers()) watcher.camera.clear();
    await this.host.scope.wait(20);
  }

  /** Walks the player's piece `steps` spaces, stopping to pick a way at each branch and at each Star it passes. */
  private async move(player: Player, steps: number): Promise<void> {
    const spaces = this.host.spaces();
    let left = steps;
    let at = this.host.pieces.spaceOf(player);
    while (left > 0 && player.isValid) {
      const stretch: Space[] = [];
      let here = at;
      while (left > 0) {
        const space = spaces[here];
        if (space.next.length > 1 && stretch.length > 0) break;
        const next = space.next.length > 1 ? await this.choosePath(player, space) : (space.next[0] ?? here);
        here = next;
        stretch.push(spaces[here]);
        left--;
        if (this.stars.includes(here) && left > 0) break;
      }
      if (!player.isValid) return;
      await this.host.pieces.walkThrough(player, stretch, { land: left === 0, quiet: true });
      at = here;
      if (this.stars.includes(at)) await this.offerStar(player, at);
    }
  }

  /** A branch: the player picks the way (the first when they close the form). */
  private async choosePath(player: Player, space: Space): Promise<number> {
    const spaces = this.host.spaces();
    const form = new ActionFormData().title("Which way?");
    for (const next of space.next) form.button(`Toward ${this.spaceName(spaces[next])}: ${this.typeName(spaces[next].type)}${this.stars.includes(next) ? ", the Star" : ""}`);
    const response = await showForm(this.host.scope, player, form);
    return space.next[response?.selection ?? 0] ?? space.next[0];
  }

  /** Passing or landing on a Star: buy it for its price, if the player has the coins and wants it. */
  private async offerStar(player: Player, at: number): Promise<void> {
    const seat = this.seats.get(player.name.toLowerCase());
    if (!seat) return;
    const price = starPrice(this.host.turns);
    if (seat.coins < price) {
      this.host.tell(player, `A Star costs ${count(price, "coin")}: you have ${count(seat.coins, "coin")}.`);
      return;
    }
    const form = new ActionFormData().title("The Star").body(`Buy a Star for ${count(price, "coin")}? You have ${count(seat.coins, "coin")}.`).button("Buy a Star").button("Not now");
    const response = await showForm(this.host.scope, player, form);
    if (response?.selection !== 0) return;
    seat.coins -= price;
    seat.stars++;
    const spaces = this.host.spaces();
    const index = this.stars.indexOf(at);
    const moved = nextStar(spaces, at, this.stars.filter((star) => star !== at), starDistance(spaces.length), this.host.random);
    if (index >= 0) this.stars[index] = moved;
    this.host.title(`${player.name} got a Star!`, `It moves to ${this.spaceName(spaces[moved])}`);
    this.host.everyone(`${player.name} bought a Star for ${count(price, "coin")}. ${this.starsText()}`);
    this.host.changed();
  }

  /** Landing: the space's effect. */
  private land(player: Player): void {
    const seat = this.seats.get(player.name.toLowerCase());
    const space = this.host.spaces()[this.host.pieces.spaceOf(player)];
    if (!seat || !space) return;
    const change = coinsFor(space.type);
    if (change !== 0) {
      seat.coins = addCoins(seat.coins, change);
      this.host.everyone(`${player.name} landed on ${this.typeName(space.type)}: ${change > 0 ? "+" : ""}${change} coins.`);
    } else {
      const later: Record<string, string> = {
        item: "an item (items come with pass 7)",
        shop: "the Villager's shop (pass 7)",
        chance: "Chance Time with the Witch (pass 7)",
        warden: "the Warden (pass 7)",
        versus: "a duel (pass 5)",
        happening: "a Happening (pass 7)",
        start: "Start",
      };
      this.host.everyone(`${player.name} landed on ${this.typeName(space.type)}${later[space.type] ? `: ${later[space.type]}` : ""}.`);
    }
    this.host.changed();
  }

  /** The end: most Stars, then coins; a tie still standing goes to chance. */
  private finish(): Result {
    const standings: Standing[] = [...this.seats.values()];
    const tied = leaders(standings);
    if (tied.length === 0) return { kind: "draw", reason: "nobody played" };
    const winner = tied.length === 1 ? tied[0] : tied[Math.floor(this.host.random() * tied.length)];
    if (tied.length > 1) this.host.everyone(`${tied.map((seat) => seat.name).join(" and ")} are tied: the winner is picked at random (the Allay picks once it's built, pass 8).`);
    this.host.title(`${winner.name} wins!`, `${count(winner.stars, "Star")}, ${count(winner.coins, "coin")}`);
    this.host.everyone(`Final standings: ${this.standings().join("; ")}.`);
    this.running = false;
    return { kind: "win", players: [winner.name], reason: `${count(winner.stars, "Star")} and ${count(winner.coins, "coin")}` };
  }

  /** A space's name: its id on a map, else its place on the test board. */
  private spaceName(space: Space): string {
    return `space ${space.id ?? space.index + 1}`;
  }

  private typeName(type: string): string {
    return BLOCK_PARTY_BOARD.types.find((candidate) => candidate.id === type)?.name ?? type;
  }

  private starsText(): string {
    const spaces = this.host.spaces();
    const at = this.stars.map((index) => this.spaceName(spaces[index]));
    return at.length === 1 ? `The Star is on ${at[0]}.` : `The Stars are on ${at.join(" and ")}.`;
  }

  /** A column of light over each Star (the plan's beacon beam is a model, pass 6). */
  private drawBeams(): void {
    if (!this.running) return;
    const spaces = this.host.spaces();
    const dimension = world.getDimension("overworld");
    for (const index of this.stars) {
      const space = spaces[index];
      if (!space) continue;
      for (let y = 0.5; y <= 8; y += 0.75) {
        try {
          dimension.spawnParticle("minecraft:endrod", { x: space.at[0], y: space.at[1] + y, z: space.at[2] });
        } catch {
          // unloaded
        }
      }
    }
  }
}

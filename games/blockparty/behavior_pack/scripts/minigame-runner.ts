// Plays one minigame (docs/plans/block-party.md, "Minigame formats": the roulette, rules then Ready,
// and the arenas' "At play time"), from the board and back:
//   1. The roulette: the format's minigames go by in a title, slowing down, and stop on the pick.
//   2. Behind the loading screen: the minigame's arena is laid where arenas go (its test arena for
//      now; minigames/kit.ts), with a stand beside it for bots that are out, and everyone is put on
//      its spawns, off their pieces. Anyone not playing (a duel's onlookers) watches from over it.
//   3. The rules, through a camera over the arena, until everyone has jumped to say they're ready
//      (bots after a moment); nobody moves till Go.
//   4. 3, 2, 1, Go, and the minigame plays (its play()). A player who's out watches as a spectator
//      over the arena; a bot stands on the stand.
//   5. The results (what the loop pays, settle()) over the arena, then behind the loading screen
//      again the arena is cleared and everyone is back on their pieces.
import { GameMode, InputPermissionCategory, world, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, type Scope } from "@minecade/minigame-core";
import { isPlayer, thinkTicks, type Who } from "./bots.ts";
import type { Format } from "./minigame-rules.ts";
import { fill, type MinigameDef, type Outcome, type Play, type Vec3 } from "./minigames/kit.ts";

export interface RunnerHost {
  scope: Scope;
  dimension: Dimension;
  /** Where an arena goes: the middle of its floor (the map's arena slot's, or far east of the board). */
  arenaMiddle(): Vector3;
  /** A move behind the loading screen. */
  behindBlack(work: () => void | Promise<void>): Promise<void>;
  /** Off the board (a player gets their movement back), and back on it (on their space). */
  leaveBoard(who: Who): void;
  backToBoard(who: Who): void;
  title(text: string, subtitle?: string): void;
  say(text: string): void;
  random(): number;
  /** The line top right for everyone, while a minigame is on (undefined: the board's again). */
  status(text: string | undefined): void;
}

/** What the loop makes of an outcome: the results to show over the arena. */
export type Settle = (outcome: Outcome) => { title: string; subtitle: string };

const ARENA_AREA = "minecade:blockparty_minigame";
/** The roulette's waits between names, in ticks: quick, then slowing to the pick. */
const ROULETTE = [2, 2, 2, 2, 3, 3, 4, 5, 6, 8];
/** Ticks the results stay up before everyone goes back. */
const RESULTS_TICKS = 70;
/** How far over the arena onlookers and players who are out watch from. */
const WATCH_HEIGHT = 6;

export function formatLabel(format: Format, sides: readonly (readonly Who[])[]): string {
  if (format === "2v2") return "2 vs 2";
  if (format === "1v3") return `1 vs ${sides[1]?.length ?? 3}`;
  if (format === "battle") return "Battle: 5 coins each in the pot";
  if (format === "duel") return "Duel";
  return "Free for all";
}

export class MinigameRunner {
  private readonly host: RunnerHost;
  private on = false;
  /** Players who haven't said they're ready yet (lowercased), while the rules show. */
  private waiting: Set<string> | undefined;
  private readyCount = 0;
  private readyTotal = 0;
  /** Who's out this minigame, by key. */
  private readonly outs = new Set<string>();

  constructor(host: RunnerHost) {
    this.host = host;
  }

  /** Whether a minigame is on (the board waits). */
  get active(): boolean {
    return this.on;
  }

  /** A player jumped: while the rules show, that's their Ready. True when it was. */
  jumped(player: Player): boolean {
    if (!this.waiting) return false;
    if (this.waiting.delete(player.name.toLowerCase())) this.ready();
    return true;
  }

  /**
   * Plays `def` in `format` with `sides` (watched by `onlookers`), the roulette going through `pool`.
   * `settle` turns the outcome into the results shown over the arena. Resolves with the outcome once
   * everyone is back on the board.
   */
  async play(format: Format, def: MinigameDef, sides: Who[][], pool: readonly MinigameDef[], onlookers: readonly Who[], settle: Settle): Promise<Outcome> {
    this.on = true;
    this.outs.clear();
    const everyone = sides.flat();
    const { dimension } = this.host;
    const size = def.size;
    const middle = this.host.arenaMiddle();
    const min = { x: Math.floor(middle.x - size[0] / 2), y: Math.floor(middle.y), z: Math.floor(middle.z - size[2] / 2) };
    const stand = { x: min.x - 4.5, y: min.y + 3, z: min.z + Math.floor(size[2] / 2) + 0.5 };
    const watchSpot = { x: min.x + size[0] / 2, y: min.y + size[1] + WATCH_HEIGHT, z: min.z + size[2] / 2 };
    let outcome: Outcome = { places: [] };
    try {
      await this.roulette(def, pool, format, sides);
      await this.host.behindBlack(async () => {
        await this.loadArena(min, size, stand);
        def.build(dimension, min, this.host.random);
        const spawns = def.spawns(
          min,
          sides.map((side) => side.length),
        );
        sides.forEach((side, s) =>
          side.forEach((who, m) => {
            const spot = spawns[s]?.[m] ?? { x: middle.x, y: min.y + size[1], z: middle.z };
            this.host.leaveBoard(who);
            this.put(who.body, spot, middle, GameMode.Adventure);
            if (who.player) setMoving(who.player, false);
          }),
        );
        for (const who of onlookers) if (who.player) this.put(who.player, watchSpot, middle, GameMode.Spectator);
        this.rulesCamera([...everyone, ...onlookers], min, size);
      });
      this.host.title(def.name, formatLabel(format, sides));
      this.host.say(`${def.name} (${formatLabel(format, sides)}): ${def.rules}`);
      await this.readyVote(everyone);
      for (const who of [...everyone, ...onlookers]) clearCamera(who.player);
      for (const count of ["3", "2", "1"]) {
        this.host.title(count, def.name);
        await this.host.scope.wait(20);
      }
      this.host.title("Go!", "");
      for (const who of everyone) if (who.player) setMoving(who.player, true);
      const scope = this.host.scope.child(`minigame ${def.id}`);
      const play: Play = {
        scope,
        dimension,
        min,
        size,
        sides,
        random: this.host.random,
        inPlay: () => everyone.filter((who) => !this.outs.has(who.key) && this.bodyOf(who) !== undefined),
        out: (who) => this.takeOut(who, watchSpot, stand),
        isOut: (who) => this.outs.has(who.key),
        bodyOf: (who) => this.bodyOf(who),
        freeze: (who, ticks) => {
          if (!who.player) return;
          setMoving(who.player, false);
          scope.timeout(() => who.player && setMoving(who.player, true), ticks);
        },
        title: (text, subtitle) => this.host.title(text, subtitle),
        say: (text) => this.host.say(text),
        status: (text) => this.host.status(text),
      };
      try {
        outcome = await def.play(play);
      } catch (error) {
        log.warn(`blockparty: ${def.name} failed: ${describeError(error)}`);
        this.host.say(`${def.name} failed: ${describeError(error)}. Nobody wins it.`);
        outcome = def.kind === "ffa" ? { places: [everyone.map((who) => who.key)] } : { winner: undefined };
      } finally {
        scope.dispose();
      }
      for (const who of everyone) if (who.player) setMoving(who.player, false);
      const results = settle(outcome);
      this.host.status(undefined);
      this.host.title(results.title, results.subtitle);
      await this.host.scope.wait(RESULTS_TICKS);
      await this.host.behindBlack(() => {
        for (const who of [...everyone, ...onlookers]) {
          if (who.player?.isValid) {
            setMoving(who.player, true);
            clearCamera(who.player);
            if (who.player.getGameMode() !== GameMode.Adventure) who.player.setGameMode(GameMode.Adventure);
          }
          this.host.backToBoard(who);
        }
        this.clearArena(min, size);
      });
    } finally {
      this.on = false;
      this.waiting = undefined;
      this.host.status(undefined);
    }
    return outcome;
  }

  /** The roulette: the format's minigames in a title, slowing down to the pick. */
  private async roulette(def: MinigameDef, pool: readonly MinigameDef[], format: Format, sides: readonly (readonly Who[])[]): Promise<void> {
    const names = pool.length > 1 ? pool.map((minigame) => minigame.name) : [def.name];
    let index = Math.floor(this.host.random() * names.length);
    for (const wait of ROULETTE) {
      this.host.title(`§7${names[index % names.length]}`, formatLabel(format, sides));
      index++;
      await this.host.scope.wait(wait);
    }
    this.host.title(def.name, formatLabel(format, sides));
    await this.host.scope.wait(30);
  }

  /** Loads the arena's chunks (and the stand's) and lays the stand. */
  private async loadArena(min: Vector3, size: Vec3, stand: Vector3): Promise<void> {
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    await manager.createTickingArea(ARENA_AREA, { dimension: this.host.dimension, from: { x: min.x - 7, y: min.y, z: min.z }, to: { x: min.x + size[0] - 1, y: min.y + size[1] - 1, z: min.z + size[2] - 1 } });
    fill(this.host.dimension, { x: stand.x - 2.5, y: stand.y - 1, z: stand.z - 2.5 }, { x: stand.x + 1.5, y: stand.y - 1, z: stand.z + 1.5 }, "minecraft:smooth_stone");
  }

  private clearArena(min: Vector3, size: Vec3): void {
    try {
      fill(this.host.dimension, { x: min.x - 7, y: min.y, z: min.z }, { x: min.x + size[0] - 1, y: min.y + size[1] - 1, z: min.z + size[2] - 1 }, "minecraft:air");
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    } catch (error) {
      log.warn(`blockparty: clearing the minigame's arena failed: ${describeError(error)}`);
    }
  }

  /** Puts a body at `spot` facing `toward` (a player in `mode`). */
  private put(body: Entity, spot: Vector3, toward: Vector3, mode: GameMode): void {
    try {
      const yaw = (Math.atan2(-(toward.x - spot.x), toward.z - spot.z) * 180) / Math.PI;
      if (isPlayer(body) && body.getGameMode() !== mode) body.setGameMode(mode);
      body.teleport(spot, { rotation: { x: 0, y: yaw } });
      if (!isPlayer(body)) body.clearVelocity();
    } catch (error) {
      log.warn(`blockparty: putting someone in the arena failed: ${describeError(error)}`);
    }
  }

  /** The rules camera: over the arena, behind its near side, looking at its middle. */
  private rulesCamera(who: readonly Who[], min: Vector3, size: Vec3): void {
    const middle = { x: min.x + size[0] / 2, y: min.y + 1, z: min.z + size[2] / 2 };
    const location = { x: middle.x, y: min.y + size[1] + 10, z: min.z - Math.max(8, size[2] * 0.4) };
    for (const one of who) {
      try {
        one.player?.camera.setCamera("minecraft:free", { location, facingLocation: middle });
      } catch {
        // gone
      }
    }
  }

  /** Waits until every player has jumped and every bot has had its moment. */
  private async readyVote(everyone: readonly Who[]): Promise<void> {
    const players = everyone.filter((who) => who.player?.isValid);
    const bots = everyone.filter((who) => !who.player);
    this.waiting = new Set(players.map((who) => who.key));
    this.readyTotal = everyone.length;
    this.readyCount = 0;
    this.ready(0);
    let botsLeft = bots.length;
    bots.forEach((_, i) =>
      this.host.scope.timeout(() => {
        botsLeft--;
        this.ready();
      }, thinkTicks(this.host.random, 20 + i * 10, 50 + i * 10)),
    );
    while (this.waiting.size > 0 || botsLeft > 0) {
      // A player who left isn't waited for.
      for (const key of [...this.waiting]) if (!world.getAllPlayers().some((player) => player.name.toLowerCase() === key)) this.waiting.delete(key);
      await this.host.scope.wait(2);
    }
    this.waiting = undefined;
  }

  /** Someone's ready (or, with 0, just the count again). */
  private ready(add = 1): void {
    this.readyCount += add;
    this.host.status(`Jump when you're ready: ${Math.min(this.readyCount, this.readyTotal)} of ${this.readyTotal} ready`);
  }

  /** Off the field: a player watches over the arena as a spectator, a bot from the stand. */
  private takeOut(who: Who, watchSpot: Vector3, stand: Vector3): void {
    if (this.outs.has(who.key)) return;
    this.outs.add(who.key);
    const body = this.bodyOf(who);
    if (!body) return;
    try {
      if (isPlayer(body)) {
        body.setGameMode(GameMode.Spectator);
        body.teleport(watchSpot);
      } else {
        body.teleport(stand);
        body.clearVelocity();
      }
    } catch (error) {
      log.warn(`blockparty: taking ${who.name} out failed: ${describeError(error)}`);
    }
  }

  private bodyOf(who: Who): Entity | undefined {
    try {
      return who.body.isValid ? who.body : undefined;
    } catch {
      return undefined;
    }
  }
}

/** A player can walk (and jump) or not; a jump still comes through to the script either way. */
function setMoving(player: Player, moving: boolean): void {
  try {
    if (!player.isValid) return;
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, moving);
  } catch {
    // gone
  }
}

function clearCamera(player: Player | undefined): void {
  try {
    if (player?.isValid) player.camera.clear();
  } catch {
    // gone
  }
}

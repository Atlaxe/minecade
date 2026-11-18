// Plays one minigame (docs/plans/block-party.md, "Minigame formats": the roulette, rules then Ready,
// and the arenas' "At play time"), from the board and back:
//   1. The roulette: the format's minigames go by in a title, slowing down, and stop on the pick.
//   2. Behind the loading screen: the minigame's arena is laid where arenas go, and everyone is put on
//      its spawns, off their pieces: the players, then a moment later the bots, made again there
//      (bots.ts, respawn). The arena is one of the minigame's published arena maps (minigames/
//      arenas.ts), its structure placed fresh, turned a quarter when that's how it fits the board's
//      arena slot, with the arena's own time of day; or, while the minigame has none, its test
//      arena, laid in code (minigames/kit.ts). Anyone not playing (a duel's onlookers) watches from
//      the arena's spectator spawn, or over it.
//   3. The rules, through the arena map's Start view camera (or one over the arena), until everyone
//      has jumped to say they're ready (bots after a moment); nobody moves till Go.
//   4. 3, 2, 1, Go, and the minigame plays (its play()). A player who's out watches as a spectator
//      from the spectator spawn; a bot floats there. Only while it plays do the players have
//      vanilla's hotbar (isPlaying; spike.ts shows it, the user's call).
//   5. The results (what the loop pays, settle()) over the arena: a short title for everyone and
//      each player's own place and coins under it. Then behind the loading screen again everyone is
//      back on their pieces (the bots a moment after the players), the arena is cleared and the
//      board's time is back.
// Titles that follow each other quickly (the roulette, the countdown) come in at once (TITLE).
import { EasingType, GameMode, InputPermissionCategory, StructureRotation, world, type Dimension, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, log, placeArena, turnedSize, turnsToFit, type ArenaMap, type QuarterTurns, type Scope } from "@minecade/minigame-core";
import { isPlayer, thinkTicks, type Who } from "./bots.ts";
import { line } from "./lines.ts";
import { forcedOutcome, pickName, type Format } from "./minigame-rules.ts";
import { arenaSize, fill, mapField, TITLE, type Field, type MinigameDef, type Outcome, type Play, type Spot, type TitleTiming } from "./minigames/kit.ts";

/** Where arenas go: the middle of the floor (the map's arena slot's, or far east of the board), and the slot's size across (x by z) when there is one. */
export interface ArenaPlace {
  middle: Vector3;
  slot?: [number, number];
}

export interface RunnerHost {
  scope: Scope;
  dimension: Dimension;
  arenaPlace(): ArenaPlace;
  /** A minigame's published arena maps (the "arenas" server variable). */
  arenaMaps(id: string): readonly ArenaMap[];
  /** A move behind the loading screen. */
  behindBlack(work: () => void | Promise<void>): Promise<void>;
  /** Off the board (a player gets their movement back), and back on it (on their space; a bot made again there). */
  leaveBoard(who: Who): void;
  backToBoard(who: Who): void;
  /** A bot made again at `at` facing `yaw` (bots.ts, respawn); `who` gets the new body. */
  respawnBot(who: Who, at: Vector3, yaw: number): void;
  /** A big line on everyone's screen, or on one player's. */
  title(text: string, subtitle?: string, timing?: TitleTiming): void;
  titleTo(player: Player, text: string, subtitle: string, timing?: TitleTiming): void;
  say(text: string): void;
  random(): number;
  /** The line top right for everyone, while a minigame is on (undefined: the board's again). */
  status(text: string | undefined): void;
  /**
   * Into a minigame (block-party-ui.md, "The minigame announcement", its camera only for now): the
   * board's camera rises and pulls back over `seconds`, still aimed at the same point.
   */
  zoomOut?(seconds: number): void;
}

/**
 * What the loop makes of an outcome: the results to show over the arena, the same title for
 * everyone (short: one name, a team, a tie) and each player's own line under it (their place and
 * coins). The whole list goes to chat.
 */
export interface Results {
  title: string;
  /** A player's own line, by key ("" for someone who didn't play). */
  subtitle(key: string): string;
}
export type Settle = (outcome: Outcome) => Results;

const ARENA_AREA = "minecade:blockparty_minigame";
/** Seconds the camera takes to rise from the board as a minigame comes, and to ease down into its arena. */
const ZOOM_OUT = 3;
const EASE_IN = 2.5;
/** How far over and behind the rules camera the ease down into the arena starts, in blocks. */
const EASE_IN_RISE = 18;
const EASE_IN_BACK = 14;
/** The roulette's waits between names, in ticks: quick, then slowing to the pick. */
const ROULETTE = [2, 2, 2, 2, 3, 3, 4, 5, 6, 8];
/** Ticks the results stay up before everyone goes back. */
const RESULTS_TICKS = 70;
/** How far over the arena onlookers and players who are out watch from, when its map has no spectator spawn. */
const WATCH_HEIGHT = 6;
/** Ticks after the players have moved before the bots are made again beside them (their screens are there by then). */
const BOTS_AFTER = 10;
const ROTATIONS: Record<QuarterTurns, StructureRotation> = { 0: StructureRotation.None, 1: StructureRotation.Rotate90, 2: StructureRotation.Rotate180, 3: StructureRotation.Rotate270 };

/** The arena a minigame is played on this time: where, its markup there, and the structure placed for it (none: its test arena). */
interface Laid {
  field: Field;
  structure?: { id: string; turns: QuarterTurns; map: string };
}

/** A minigame on now: what it is, who's on which side, and the outcome /minigame win forced on it, with what ends its play() early. */
interface Running {
  def: MinigameDef;
  sides: Who[][];
  forced?: Outcome;
  force?: (outcome: Outcome) => void;
}

export function formatLabel(format: Format, sides: readonly (readonly Who[])[]): string {
  if (format === "2v2") return line("format.2v2");
  if (format === "1v3") return line("format.1v3", { count: sides[1]?.length ?? 3 });
  if (format === "battle") return line("format.battle");
  if (format === "duel") return line("format.duel");
  return line("format.ffa");
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
  /** Who's playing it now, from Go until it ends (by key): they get the hotbar. */
  private readonly playing = new Set<string>();
  /** The minigame on now, from the roulette until its outcome is known (/minigame win's). */
  private current: Running | undefined;

  constructor(host: RunnerHost) {
    this.host = host;
  }

  /** Whether a minigame is on (the board waits). */
  get active(): boolean {
    return this.on;
  }

  /** Whether `key` is playing a minigame now: from Go until it ends, out or not. */
  isPlaying(key: string): boolean {
    return this.playing.has(key);
  }

  /** A player jumped: while the rules show, that's their Ready. True when it was. */
  jumped(player: Player): boolean {
    if (!this.waiting) return false;
    if (this.waiting.delete(player.name.toLowerCase())) this.ready();
    return true;
  }

  /**
   * /minigame win (testing): ends the minigame on now with `typed` (a player or bot in it, or part
   * of their name: pickName) as its winner, their side in a team minigame. While it plays it stops at
   * once; before that (the roulette, the arena loading) it goes as far as the rules and stops there,
   * with no Ready vote or countdown. Either way the results and the coins come as they would have.
   * Says what went wrong, or undefined once it's done.
   */
  win(typed: string): string | undefined {
    const current = this.current;
    if (!current) return "No minigame is on.";
    if (current.forced) return `${current.def.name} is already ending.`;
    const everyone = current.sides.flat();
    const name = pickName(everyone.map((who) => who.name), typed);
    const who = everyone.find((one) => one.name === name);
    const outcome = who && forcedOutcome(current.def.kind, current.sides.map((side) => side.map((one) => one.key)), who.key);
    if (!who || !outcome) return `"${typed}" isn't one player in ${current.def.name}. Playing it: ${everyone.map((one) => one.name).join(", ")}.`;
    current.forced = outcome;
    current.force?.(outcome);
    const team = current.def.kind !== "ffa" && current.sides.find((side) => side.includes(who))!.length > 1;
    this.host.say(`${current.def.name} was skipped: ${who.name}${team ? "'s side" : ""} wins it (/minigame win).`);
    return undefined;
  }

  /**
   * Plays `def` in `format` with `sides` (watched by `onlookers`), the roulette going through `pool`.
   * `settle` turns the outcome into the results shown over the arena. Resolves with the outcome once
   * everyone is back on the board.
   */
  async play(format: Format, def: MinigameDef, sides: Who[][], pool: readonly MinigameDef[], onlookers: readonly Who[], settle: Settle): Promise<Outcome> {
    this.on = true;
    this.outs.clear();
    const current: Running = { def, sides };
    this.current = current;
    const everyone = sides.flat();
    const { dimension } = this.host;
    // Picked before the roulette, so a map that can't be played is named while it spins.
    const laid = this.lay(def);
    let field = laid.field;
    let watchSpot = watchSpotOf(field);
    let boardTime: number | undefined;
    let outcome: Outcome = { places: [] };
    try {
      // The camera rises from the board while the roulette spins.
      this.host.zoomOut?.(ZOOM_OUT);
      await this.roulette(def, pool, format, sides);
      await this.host.behindBlack(async () => {
        field = await this.layDown(def, laid);
        watchSpot = watchSpotOf(field);
        const { min, size } = field;
        const middle = middleOf(field);
        if (field.time !== undefined) {
          boardTime = world.getTimeOfDay();
          world.setTimeOfDay(field.time);
        }
        const spawns = def.spawns(
          field,
          sides.map((side) => side.length),
        );
        const spotOf = (s: number, m: number): Spot => spawns[s]?.[m] ?? { x: middle.x, y: min.y + size[1], z: middle.z };
        const facing = (spot: Spot) => spot.yaw ?? yawToward(spot, middle);
        for (const who of everyone) this.host.leaveBoard(who);
        // The players first; the bots once the players' screens are there (bots.ts, respawn).
        sides.forEach((side, s) =>
          side.forEach((who, m) => {
            if (!who.player) return;
            const spot = spotOf(s, m);
            this.put(who.player, spot, facing(spot), GameMode.Adventure);
            setMoving(who.player, false);
          }),
        );
        for (const who of onlookers) if (who.player) this.put(who.player, watchSpot, watchSpot.yaw ?? yawToward(watchSpot, middle), GameMode.Spectator);
        // Behind the black, high over the rules camera; it eases down once the black has gone.
        this.rulesCamera([...everyone, ...onlookers], field, "above");
        await this.host.scope.wait(BOTS_AFTER);
        sides.forEach((side, s) =>
          side.forEach((who, m) => {
            if (who.player) return;
            const spot = spotOf(s, m);
            this.host.respawnBot(who, spot, facing(spot));
          }),
        );
      });
      this.rulesCamera([...everyone, ...onlookers], field, "ease");
      this.host.title(def.name, formatLabel(format, sides));
      this.host.say(line("minigame.rules", { minigame: def.name, format: formatLabel(format, sides), rules: def.rules }));
      await this.readyVote(everyone, current);
      for (const who of [...everyone, ...onlookers]) clearCamera(who.player);
      for (const count of ["3", "2", "1"]) {
        if (current.forced) break;
        this.host.title(count, def.name, TITLE.count);
        await this.host.scope.wait(20);
      }
      if (current.forced) outcome = current.forced;
      else {
        this.host.title(line("minigame.go"), "", TITLE.land);
        for (const who of everyone) if (who.player) setMoving(who.player, true);
        for (const who of everyone) this.playing.add(who.key);
        const scope = this.host.scope.child(`minigame ${def.id}`);
        const play: Play = {
          scope,
          dimension,
          field,
          sides,
          random: this.host.random,
          inPlay: () => everyone.filter((who) => !this.outs.has(who.key) && this.bodyOf(who) !== undefined),
          out: (who) => this.takeOut(who, watchSpot),
          isOut: (who) => this.outs.has(who.key),
          bodyOf: (who) => this.bodyOf(who),
          freeze: (who, ticks) => {
            if (!who.player) return;
            setMoving(who.player, false);
            scope.timeout(() => who.player && setMoving(who.player, true), ticks);
          },
          title: (text, subtitle, timing) => this.host.title(text, subtitle, timing),
          titleEach: (text, subtitleOf, timing) => {
            for (const player of world.getAllPlayers()) this.host.titleTo(player, text, subtitleOf(player.name.toLowerCase()), timing);
          },
          say: (text) => this.host.say(text),
          status: (text) => this.host.status(text),
        };
        try {
          // /minigame win ends it early: its scope goes below, which stops its waits for good.
          outcome = await Promise.race([def.play(play), new Promise<Outcome>((resolve) => (current.force = resolve))]);
        } catch (error) {
          log.warn(`blockparty: ${def.name} failed: ${describeError(error)}`);
          this.host.say(`${def.name} failed: ${describeError(error)}. Nobody wins it.`);
          outcome = def.kind === "ffa" ? { places: [everyone.map((who) => who.key)] } : { winner: undefined };
        } finally {
          scope.dispose();
          this.playing.clear();
        }
      }
      if (this.current === current) this.current = undefined;
      for (const who of everyone) if (who.player) setMoving(who.player, false);
      const results = settle(outcome);
      this.host.status(undefined);
      for (const player of world.getAllPlayers()) this.host.titleTo(player, results.title, results.subtitle(player.name.toLowerCase()), TITLE.results);
      await this.host.scope.wait(RESULTS_TICKS);
      await this.host.behindBlack(async () => {
        // The players first; the bots that played once the players' screens are back (onlookers never left).
        for (const who of [...everyone, ...onlookers]) {
          if (!who.player) continue;
          if (who.player.isValid) {
            setMoving(who.player, true);
            clearCamera(who.player);
            if (who.player.getGameMode() !== GameMode.Adventure) who.player.setGameMode(GameMode.Adventure);
          }
          this.host.backToBoard(who);
        }
        await this.host.scope.wait(BOTS_AFTER);
        for (const who of everyone) if (!who.player) this.host.backToBoard(who);
        this.clearArena(field);
        if (boardTime !== undefined) world.setTimeOfDay(boardTime);
        boardTime = undefined;
      });
    } finally {
      this.on = false;
      if (this.current === current) this.current = undefined;
      this.playing.clear();
      this.waiting = undefined;
      this.host.status(undefined);
      if (boardTime !== undefined) world.setTimeOfDay(boardTime);
    }
    return outcome;
  }

  /**
   * Lays the arena behind the loading screen: loads its chunks, then places its map's structure, or
   * lays its test arena. A structure that won't place is named in chat and the test arena stands in.
   * Resolves with the field that was laid.
   */
  private async layDown(def: MinigameDef, laid: Laid): Promise<Field> {
    const { dimension } = this.host;
    await this.loadArena(laid.field);
    const { structure } = laid;
    if (structure) {
      try {
        world.structureManager.place(structure.id, dimension, laid.field.min, { rotation: ROTATIONS[structure.turns], includeEntities: false });
        log.info(`blockparty: ${def.name} on its arena map ${structure.map}${structure.turns > 0 ? `, turned ${structure.turns * 90} degrees to fit the arena slot` : ""}`);
        return laid.field;
      } catch (error) {
        log.warn(`blockparty: placing ${def.name}'s arena map ${structure.map} failed: ${describeError(error)}`);
        this.host.say(`${def.name}'s arena map ${structure.map} couldn't be placed (${describeError(error)}), so its test arena stands in.`);
        this.clearArena(laid.field);
        const test = this.testLaid(def);
        await this.loadArena(test.field);
        def.build(dimension, test.field.min, this.host.random);
        return test.field;
      }
    }
    def.build(dimension, laid.field.min, this.host.random);
    return laid.field;
  }

  /** The minigame's test arena, centered where arenas go. */
  private testLaid(def: MinigameDef): Laid {
    const { middle } = this.host.arenaPlace();
    const min = { x: Math.floor(middle.x - def.size[0] / 2), y: Math.floor(middle.y), z: Math.floor(middle.z - def.size[2] / 2) };
    return { field: def.testField(min) };
  }

  /**
   * Where `def` is played this time: one of its arena maps (at random, when there are more), its
   * Arena box centered where arenas go, turned a quarter when only that fits the arena slot; or its
   * test arena, while it has no arena map, or none it can be played on (it says why).
   */
  private lay(def: MinigameDef): Laid {
    const place = this.host.arenaPlace();
    const maps = this.host.arenaMaps(def.id);
    const arena = maps.length > 0 ? maps[Math.floor(this.host.random() * maps.length)] : undefined;
    const size = arena && arenaSize(arena.config);
    if (arena && size) {
      const turns: QuarterTurns = place.slot ? (turnsToFit(size, place.slot) ?? 0) : 0;
      const turned = turnedSize(size, turns);
      const min = { x: Math.floor(place.middle.x - turned[0] / 2), y: Math.floor(place.middle.y), z: Math.floor(place.middle.z - turned[2] / 2) };
      const field = mapField(arena.config, placeArena(arena.config, [min.x, min.y, min.z], turns));
      const problem = world.structureManager.get(arena.structure) ? def.problem?.(field) : `its structure ${arena.structure} isn't on this server`;
      if (!problem) return { field, structure: { id: arena.structure, turns, map: arena.map } };
      log.warn(`blockparty: ${def.name}'s arena map ${arena.map} can't be played: ${problem}`);
      this.host.say(`${def.name}'s arena map ${arena.map} can't be played (${problem}), so its test arena stands in.`);
    }
    return this.testLaid(def);
  }

  /** The roulette: the format's minigames in a title, slowing down to the pick. */
  private async roulette(def: MinigameDef, pool: readonly MinigameDef[], format: Format, sides: readonly (readonly Who[])[]): Promise<void> {
    const names = pool.length > 1 ? pool.map((minigame) => minigame.name) : [def.name];
    let index = Math.floor(this.host.random() * names.length);
    for (const wait of ROULETTE) {
      this.host.title(`§7${names[index % names.length]}`, formatLabel(format, sides), TITLE.swap);
      index++;
      await this.host.scope.wait(wait);
    }
    this.host.title(def.name, formatLabel(format, sides), TITLE.land);
    await this.host.scope.wait(30);
  }

  /** Loads the arena's chunks. */
  private async loadArena(field: Field): Promise<void> {
    const { min, size } = field;
    const manager = world.tickingAreaManager;
    if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    await manager.createTickingArea(ARENA_AREA, { dimension: this.host.dimension, from: min, to: { x: min.x + size[0] - 1, y: min.y + size[1] - 1, z: min.z + size[2] - 1 } });
  }

  /** Clears the arena's box, so the next one is laid on nothing. */
  private clearArena(field: Field): void {
    const { min, size } = field;
    try {
      fill(this.host.dimension, min, { x: min.x + size[0] - 1, y: min.y + size[1] - 1, z: min.z + size[2] - 1 }, "minecraft:air");
      const manager = world.tickingAreaManager;
      if (manager.hasTickingArea(ARENA_AREA)) manager.removeTickingArea(ARENA_AREA);
    } catch (error) {
      log.warn(`blockparty: clearing the minigame's arena failed: ${describeError(error)}`);
    }
  }

  /** Puts a player at `spot` facing `yaw`, in `mode`. */
  private put(player: Player, spot: Vector3, yaw: number, mode: GameMode): void {
    try {
      if (player.getGameMode() !== mode) player.setGameMode(mode);
      player.teleport({ x: spot.x, y: spot.y, z: spot.z }, { rotation: { x: 0, y: yaw } });
    } catch (error) {
      log.warn(`blockparty: putting someone in the arena failed: ${describeError(error)}`);
    }
  }

  /**
   * The rules camera: the arena map's Start view, else over the arena, behind its near side, looking
   * at its middle. "above": where the ease down into it starts, high over it and further back, at
   * once (behind the black); "ease": down into it from there (block-party-ui.md, "The minigame
   * announcement": the camera eases down into the arena to its rules camera).
   */
  private rulesCamera(who: readonly Who[], field: Field, step: "above" | "ease"): void {
    const { min, size, camera } = field;
    const middle = { x: min.x + size[0] / 2, y: min.y + 1, z: min.z + size[2] / 2 };
    const location = camera ? { x: camera.x, y: camera.y, z: camera.z } : { x: middle.x, y: min.y + size[1] + 10, z: min.z - Math.max(8, size[2] * 0.4) };
    // Back along the way it looks, and up.
    const away = { x: location.x - middle.x, z: location.z - middle.z };
    const length = Math.hypot(away.x, away.z) || 1;
    const above = { x: location.x + (away.x / length) * EASE_IN_BACK, y: location.y + EASE_IN_RISE, z: location.z + (away.z / length) * EASE_IN_BACK };
    for (const one of who) {
      try {
        if (step === "above") one.player?.camera.setCamera("minecraft:free", { location: above, facingLocation: middle });
        else if (camera) one.player?.camera.setCamera("minecraft:free", { location, rotation: { x: camera.pitch, y: camera.yaw }, easeOptions: { easeTime: EASE_IN, easeType: EasingType.InOutSine } });
        else one.player?.camera.setCamera("minecraft:free", { location, facingLocation: middle, easeOptions: { easeTime: EASE_IN, easeType: EasingType.InOutSine } });
      } catch {
        // gone
      }
    }
  }

  /** Waits until every player has jumped and every bot has had its moment, or /minigame win ends the minigame. */
  private async readyVote(everyone: readonly Who[], current: Running): Promise<void> {
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
        // Not once the vote is over (a minigame ended early): the count would come back over its results.
        if (this.waiting) this.ready();
      }, thinkTicks(this.host.random, 20 + i * 10, 50 + i * 10)),
    );
    while ((this.waiting.size > 0 || botsLeft > 0) && !current.forced) {
      // A player who left isn't waited for.
      for (const key of [...this.waiting]) if (!world.getAllPlayers().some((player) => player.name.toLowerCase() === key)) this.waiting.delete(key);
      await this.host.scope.wait(2);
    }
    this.waiting = undefined;
  }

  /** Someone's ready (or, with 0, just the count again). */
  private ready(add = 1): void {
    this.readyCount += add;
    this.host.status(line("minigame.ready.status", { votes: `${Math.min(this.readyCount, this.readyTotal)} of ${this.readyTotal}` }));
  }

  /**
   * Off the field: a player watches from the spectator spawn (or over the arena) as a spectator, and
   * a bot floats there too, each a little apart (it's made again on the board after).
   */
  private takeOut(who: Who, watchSpot: Spot): void {
    if (this.outs.has(who.key)) return;
    const apart = this.outs.size;
    this.outs.add(who.key);
    const body = this.bodyOf(who);
    if (!body) return;
    const spot = { x: watchSpot.x, y: watchSpot.y, z: watchSpot.z };
    try {
      if (isPlayer(body)) {
        body.setGameMode(GameMode.Spectator);
        body.teleport(spot, watchSpot.yaw !== undefined ? { rotation: { x: watchSpot.pitch ?? 0, y: watchSpot.yaw } } : undefined);
      } else {
        body.triggerEvent("blockparty:float");
        body.teleport({ x: spot.x + ((apart % 3) - 1) * 1.2, y: spot.y, z: spot.z + Math.floor(apart / 3) * 1.2 });
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

/** An arena's middle, on its floor. */
function middleOf(field: Field): Vector3 {
  return { x: field.min.x + field.size[0] / 2, y: field.min.y, z: field.min.z + field.size[2] / 2 };
}

/** Where players who are out watch from: the arena map's spectator spawn, else over the arena's middle. */
function watchSpotOf(field: Field): Spot {
  const middle = middleOf(field);
  return field.watch ?? { x: middle.x, y: field.min.y + field.size[1] + WATCH_HEIGHT, z: middle.z };
}

/** The yaw from `from` toward `to`. */
function yawToward(from: Vector3, to: Vector3): number {
  return (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
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

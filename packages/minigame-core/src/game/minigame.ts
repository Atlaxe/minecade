// The Minigame base class. A game subclasses it, sets its config, and writes play() from stages
// and rounds. Core runs the outer lifecycle: waiting for players, a countdown with team and kit
// picks, the match, and the results (stats, the winner). Everything a match sets up hangs off
// this.scope, so nothing survives into the next game.
import {
  EntityComponentTypes,
  GameMode,
  InputPermissionCategory,
  ItemLockMode,
  ItemStack,
  system,
  world,
  type Entity,
  type Player,
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { ServerContext } from "../context.ts";
import type { GameConfig, TeamDef } from "../config.ts";
import { countdownChime, hudLine, playChime, type Chime } from "../hud.ts";
import { describeError, log } from "../log.ts";
import type { Vec3 } from "../map-config.ts";
import { normalizePlayer } from "../player.ts";
import type { Scope } from "../scope.ts";
import { COLOR, deathMessage as formatDeath, nameOf, say } from "../text.ts";
import { showForm } from "../ui.ts";
import { Combat, type CombatHost, type Hit } from "./combat.ts";
import { KillCredit } from "./credit.ts";
import { Kits } from "./kits.ts";
import { MapView } from "./map-view.ts";
import { aborted, draw, lastStanding, type Result } from "./results.ts";
import { Roster, type Participant } from "./roster.ts";
import { Score } from "./score.ts";
import { Sidebar } from "./sidebar.ts";
import { packStatsParts, StatsRecorder } from "./stats.ts";
import { activeTeams, assignTeams } from "./teams.ts";

export interface GameContext extends ServerContext {
  random(): number;
  /** Which match of the session this is (always 1 until Party mode). */
  match: number;
}

export type Phase = "waiting" | "countdown" | "playing" | "ending" | "done";
export type SpawnReason = "start" | "round" | "respawn" | "join";
/** What happens to a downed player: out for good, back after a delay, back at the next round or wave, or the game took care of it. */
export type DownDecision = "eliminate" | "respawn" | "wait" | "handled";

export interface Down {
  cause: string;
  /** The enemy credited with the kill, if any. */
  killer?: string;
}

export interface Stage<T = unknown> {
  readonly name: string;
  /** Lives as long as the stage: subscriptions and timers for this stage only. */
  readonly scope: Scope;
  readonly secondsLeft: number | undefined;
  end(outcome?: T): void;
  addSeconds(seconds: number): void;
}

export interface StageResult<T = unknown> {
  outcome?: T;
  timedOut: boolean;
}

/** Every match has a clock unless its config says otherwise (timeLimitSeconds: 0 for none). */
export const DEFAULT_TIME_LIMIT_SECONDS = 5 * 60;
const PICKER_ITEM = "minecraft:nether_star";
const PICKER_SLOT = 8;
/** Rules every game gets unless it says otherwise: deaths are handled by core, invisibly. */
const DEFAULT_GAME_RULES: Record<string, boolean | number> = {
  showDeathMessages: false,
  doImmediateRespawn: true,
  keepInventory: true,
  pvp: true,
};

export abstract class Minigame<C extends GameConfig = GameConfig> {
  readonly ctx: GameContext;
  readonly config: C;
  /** Everything the match sets up hangs off this scope; it is disposed when the match ends. */
  readonly scope: Scope;
  readonly roster = new Roster();
  readonly map: MapView;
  readonly score = new Score();
  readonly kits: Kits;
  readonly stats: StatsRecorder;
  readonly credit: KillCredit;
  readonly combat: Combat;
  /** The game mode players spawn in. Build games can switch to creative. */
  protected gameMode: GameMode = GameMode.Adventure;

  private currentPhase: Phase = "waiting";
  private playingScope: Scope | undefined;
  private countdownScope: Scope | undefined;
  private outcome: Result | undefined;
  private settle: (result: Result) => void = () => {};
  private readonly finished: Promise<Result>;
  private contest: ((result: Result) => void) | undefined;
  private contestSides = 0;
  private currentStage: Stage | undefined;
  private roundWins: Score | undefined;
  private teams: TeamDef[] = [];
  private readonly teamPicks = new Map<string, string>();
  private readonly pickerOpen = new Set<string>();
  private readonly protectedUntil = new Map<string, number>();
  /** When each respawning player comes back (tick), for the action bar. */
  private readonly respawnAt = new Map<string, number>();
  private winCheckQueued = false;
  private startTick = 0;
  private sidebar: Sidebar | undefined;
  private sidebarVersion = -1;

  constructor(ctx: GameContext, config: C) {
    this.ctx = ctx;
    this.config = config;
    this.scope = ctx.root.child(`game:${config.id}`);
    this.map = new MapView(ctx.vars.mapConfig);
    this.kits = new Kits(config.kits);
    this.stats = new StatsRecorder(config.stats);
    this.credit = new KillCredit((config.combat?.killCreditSeconds ?? 8) * 20);
    this.combat = new Combat(this.combatHost(), config.combat ?? {}, this.stats, this.credit);
    this.finished = new Promise((resolve) => (this.settle = resolve));
  }

  get phase(): Phase {
    return this.currentPhase;
  }

  get teamDefs(): readonly TeamDef[] {
    return this.teams;
  }

  get activeStage(): Stage | undefined {
    return this.currentStage;
  }

  // ---- Hooks: override what the game needs ----------------------------------------------

  /** Before anything else: register game features (on this.scope), set up the map. */
  protected setup(): void {}

  /** After everyone has spawned for the first time. */
  protected onStart(): void {}

  /**
   * The match itself. The default is one stage of timeLimitSeconds (5 minutes unless set; 0 for
   * no limit), or until a win check ends it. Return a result, or nothing for a draw. finish()
   * ends it from anywhere.
   */
  protected async play(): Promise<Result | void> {
    const { timedOut } = await this.stage("Match", { seconds: this.timeLimit });
    if (timedOut) return this.onTimeUp();
  }

  /** The match length in seconds, or undefined for no limit. */
  protected get timeLimit(): number | undefined {
    const seconds = this.config.timeLimitSeconds ?? DEFAULT_TIME_LIMIT_SECONDS;
    return seconds > 0 ? seconds : undefined;
  }

  /** After a player has been reset, teleported and kitted. */
  protected onSpawn(_player: Player, _why: SpawnReason): void {}

  /**
   * Runs inside a before-event: decide only (no teleports, items, forms). Return a new damage
   * amount, "cancel", or nothing to keep the damage.
   */
  protected onDamage(_hit: Hit): number | "cancel" | void {}

  /** A player went down. Return a decision, or nothing to apply the respawn config. */
  protected onDown(_name: string, _down: Down): DownDecision | void {}

  /** Checked after every down, leave and score change, and every second. Ends the current contest. */
  protected checkWin(): Result | undefined {
    const target = this.config.scoring?.target;
    if (target !== undefined) {
      const reached = this.score.reached(target);
      if (reached) return this.sideWins(reached, `reached ${target}`);
    }
    const mode = this.config.win ?? "last";
    if (mode === "custom") return undefined;
    const sides = this.roster.standingSides();
    if (mode === "coop") return sides.length === 0 ? { kind: "coop", won: false, reason: "everyone is down" } : undefined;
    const { winner, everyoneOut } = lastStanding(sides, this.contestSides);
    if (winner) return this.sideWins(winner, "last one standing");
    if (everyoneOut) return draw("everyone is out");
    return undefined;
  }

  protected onTimeUp(): Result {
    const rule = this.config.timeUp ?? "highestScore";
    if (typeof rule === "object") return this.teamWins(rule.team, "time ran out");
    if ((this.config.win ?? "last") === "coop") return { kind: "coop", won: true, reason: "survived" };
    if (rule === "highestScore" && this.config.scoring) {
      const leader = this.score.leader();
      if (leader && !leader.tied) return this.sideWins(leader.id, "highest score");
    }
    return draw("time ran out");
  }

  /** Team spawns for team games, otherwise the map's spawns in roster order. */
  protected spawnPoint(name: string): Vec3 {
    const participant = this.roster.get(name);
    const key = name.toLowerCase();
    if (participant?.team) {
      const spawns = this.map.teamSpawns(participant.team);
      const members = this.roster.teamMembers(participant.team).map((member) => member.name.toLowerCase());
      if (spawns.length > 0) return spawns[Math.max(0, members.indexOf(key)) % spawns.length];
    }
    const everyone = this.roster.all().map((member) => member.name.toLowerCase());
    const spawns = this.map.spawns;
    return spawns[Math.max(0, everyone.indexOf(key)) % Math.max(1, spawns.length)] ?? [0, 65, 0];
  }

  /**
   * The action bar line for a player, refreshed twice a second. Only what matters right now:
   * lives in lives games and a respawn countdown. The stage clock is drawn separately, top
   * right (see hud.ts).
   */
  protected hud(name: string): string | undefined {
    const parts: string[] = [];
    const participant = this.roster.get(name);
    if (participant && this.config.respawn?.mode === "lives" && participant.state !== "out") parts.push(say.info(`Lives: ${participant.lives}`));
    const respawnAt = this.respawnAt.get(name.toLowerCase());
    if (participant?.state === "respawning" && respawnAt !== undefined) {
      parts.push(say.info(`Respawning in ${Math.max(1, Math.ceil((respawnAt - system.currentTick) / 20))}`));
    }
    return parts.length > 0 ? parts.join("   ") : undefined;
  }

  /**
   * The kill-feed line for a down, or undefined for none. The default is a random
   * "<victim> was <verb> by <killer>" from the game's deathMessages config; override for more.
   */
  protected deathMessage(victim: string, down: Down): string | undefined {
    if (down.cause === "left") return undefined;
    const killer = down.killer;
    return formatDeath(
      { victim, victimColor: this.teamOf(victim)?.color, killer, killerColor: killer ? this.teamOf(killer)?.color : undefined, cause: down.cause },
      this.config.deathMessages,
      this.ctx.random,
    );
  }

  /** After the result is known and announced, before players are sent back. */
  protected onEnd(_result: Result): void {}

  // ---- Lifecycle --------------------------------------------------------------------------

  /** Runs the whole match and resolves with its result once everything is cleaned up. */
  async run(): Promise<Result> {
    this.applyGameRules();
    this.scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      if (!initialSpawn) return;
      const name = player.name;
      this.scope.timeout(() => this.arrived(name), 2);
    });
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => this.departed(playerName));
    this.combat.attach(this.scope);
    try {
      this.setup();
    } catch (error) {
      log.error(`${this.config.id}: setup failed: ${describeError(error)}`);
      return this.conclude(aborted("error"));
    }

    const pregame = this.scope.child("pregame");
    this.openPregame(pregame);
    for (;;) {
      if (!(await this.waitForPlayers())) {
        pregame.dispose();
        return this.conclude(this.outcome ?? aborted("not_enough_players"));
      }
      if (await this.countdown()) break;
    }
    pregame.dispose();
    if (this.outcome) return this.conclude(this.outcome);

    this.begin();
    return this.conclude(await Promise.race([this.finished, this.runPlay()]));
  }

  /** Ends the match now with `result`. Safe to call from anywhere, once. */
  finish(result: Result): void {
    if (this.outcome) return;
    this.outcome = result;
    this.settle(result);
  }

  /** Ends the match without a real result (return_all, an empty server). */
  abort(reason: "aborted" | "empty" | "error" = "aborted"): void {
    this.finish(aborted(reason));
  }

  /** Ends the current stage early (debug "skip"). */
  skipStage(): void {
    this.currentStage?.end();
  }

  // ---- Helpers for play() -----------------------------------------------------------------

  /**
   * Runs a stage: a named stretch of the match with an optional time limit and its own scope.
   * Resolves when the stage ends (end() or time running out). If the match finishes first, it
   * never resolves, so code after it doesn't run for a finished match.
   */
  protected stage<T = unknown>(name: string, options: { seconds?: number } = {}, body?: (stage: Stage<T>) => void | Promise<void>): Promise<StageResult<T>> {
    const playing = this.playingScope ?? this.scope;
    return playing.guard(
      new Promise<StageResult<T>>((resolve) => {
        const scope = playing.child(`stage:${name}`);
        let left = options.seconds;
        let done = false;
        const close = (outcome: T | undefined, timedOut: boolean) => {
          if (done) return;
          done = true;
          if (this.currentStage === stage) this.currentStage = undefined;
          scope.dispose();
          resolve({ outcome, timedOut });
        };
        const stage: Stage<T> = {
          name,
          scope,
          get secondsLeft() {
            return left;
          },
          end: (outcome) => close(outcome, false),
          addSeconds: (seconds) => {
            if (left !== undefined) left += seconds;
          },
        };
        this.currentStage = stage as Stage;
        if (left !== undefined) {
          scope.interval(() => {
            left = (left ?? 0) - 1;
            if (left <= 0) close(undefined, true);
          }, 20);
        }
        if (body) {
          Promise.resolve()
            .then(() => body(stage))
            .catch((error: unknown) => log.error(`${this.config.id}: stage "${name}" failed: ${describeError(error)}`));
        }
      }),
    );
  }

  /**
   * Best-of rounds: each round respawns everyone, runs a short frozen countdown, then a stage
   * that the win check (or time) ends. The first player or team to `firstTo` round wins takes
   * the match.
   */
  protected async rounds(options: {
    firstTo: number;
    seconds?: number;
    countdownSeconds?: number;
    before?: (round: number) => void | Promise<void>;
  }): Promise<Result> {
    const wins = new Score();
    this.roundWins = wins;
    for (let round = 1; ; round++) {
      await options.before?.(round);
      this.respawnAll("round");
      await this.frozenCountdown(options.countdownSeconds ?? 3, `Round ${round}`);
      const result = await (this.playingScope ?? this.scope).guard(
        new Promise<Result>((resolve) => {
          this.contest = resolve;
          this.contestSides = this.roster.standingSides().length;
          void this.stage(`Round ${round}`, { seconds: options.seconds }).then(({ timedOut }) => {
            if (timedOut) resolve(this.onTimeUp());
          });
        }),
      );
      this.contest = undefined;
      this.currentStage?.end();
      if (result.kind === "aborted") return result;
      if (result.kind === "win") {
        const side = result.team ?? result.players[0];
        const total = wins.add(side);
        this.broadcast(say.important(`${this.sideName(side)} wins round ${round}!`));
        if (total >= options.firstTo) return this.sideWins(side, `won ${options.firstTo} rounds`);
      } else {
        this.broadcast(say.minor(`Round ${round}: ${result.reason}.`));
      }
    }
  }

  /** Brings every remaining participant back (next round or wave), with full lives. */
  respawnAll(why: SpawnReason = "round"): void {
    const lives = this.config.respawn?.mode === "lives" ? (this.config.respawn.lives ?? 3) : 1;
    for (const participant of this.roster.all()) {
      if (participant.state === "left") continue;
      participant.lives = lives;
      this.spawn(participant.name, why);
    }
  }

  /** Locks movement for the given players until `scope` is disposed. */
  freeze(names: string[], scope: Scope): void {
    for (const name of names) {
      const player = this.player(name);
      if (!player) continue;
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
      scope.add(() => {
        if (player.isValid) player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
      });
    }
  }

  /** Removes `entity` (a mob, a display) when `scope` (default: the match) is disposed. */
  track(entity: Entity, scope: Scope = this.playingScope ?? this.scope): void {
    scope.add(() => {
      try {
        if (entity.isValid) entity.remove();
      } catch {
        // already gone
      }
    });
  }

  spectate(name: string): void {
    const player = this.player(name);
    if (!player) return;
    player.setGameMode(GameMode.Spectator);
    const [x, y, z] = this.map.spectatorSpawn;
    player.teleport({ x: x + 0.5, y, z: z + 0.5 });
  }

  broadcast(text: string): void {
    world.sendMessage(text);
  }

  /** A countdown sound for everyone on the server. */
  chime(chime: Chime): void {
    for (const player of world.getAllPlayers()) playChime(player, chime);
  }

  /** A title for one player, or everyone when `to` is omitted. */
  title(title: string, subtitle?: string, to?: string): void {
    const players = to === undefined ? world.getAllPlayers() : [this.player(to)].filter((player): player is Player => !!player);
    for (const player of players) {
      player.onScreenDisplay.setTitle(title, { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle });
    }
  }

  player(name: string): Player | undefined {
    const key = name.toLowerCase();
    return world.getAllPlayers().find((player) => player.name.toLowerCase() === key);
  }

  teamOf(name: string): TeamDef | undefined {
    const team = this.roster.get(name)?.team;
    return this.teams.find((def) => def.id === team);
  }

  /** Moves a player to another team (a found hider becomes a seeker). */
  moveToTeam(name: string, teamId: string): void {
    const participant = this.roster.get(name);
    if (!participant || !this.teams.some((team) => team.id === teamId)) return;
    participant.team = teamId;
    this.queueWinCheck();
  }

  playerWins(name: string, reason: string): Result {
    return { kind: "win", players: [name], reason };
  }

  teamWins(teamId: string, reason: string): Result {
    return { kind: "win", team: teamId, players: this.roster.teamMembers(teamId).map((member) => member.name), reason };
  }

  /** A team win in team games, a player win otherwise. */
  sideWins(side: string, reason: string): Result {
    return this.teams.length > 0 ? this.teamWins(side, reason) : this.playerWins(side, reason);
  }

  // ---- Players ----------------------------------------------------------------------------

  /** Resets, teleports and kits a participant, and marks them alive. */
  protected spawn(name: string, why: SpawnReason): void {
    const participant = this.roster.get(name);
    if (!participant) return;
    participant.state = "alive";
    this.combat.settled(name);
    this.credit.clear(name);
    const player = this.player(name);
    if (!player) return;
    normalizePlayer(player, this.gameMode);
    const team = this.teamOf(name);
    if (team) player.nameTag = `${team.color}${player.name}`;
    const [x, y, z] = this.spawnPoint(name);
    // Face the middle of the map at eye level, so nobody starts looking at the sky or the floor.
    const [cx, , cz] = this.map.center();
    player.teleport({ x: x + 0.5, y, z: z + 0.5 }, { facingLocation: { x: cx + 0.5, y: y + 1.62, z: cz + 0.5 } });
    this.kits.give(player, team?.color);
    const protect = this.config.respawn?.protectSeconds;
    if (why === "respawn" && protect) this.protectedUntil.set(name.toLowerCase(), system.currentTick + protect * 20);
    try {
      this.onSpawn(player, why);
    } catch (error) {
      log.error(`${this.config.id}: onSpawn failed: ${describeError(error)}`);
    }
  }

  /** A participant is down: counts the death and kill, then applies onDown or the respawn rule. */
  protected down(name: string, cause: string): void {
    const participant = this.roster.get(name);
    if (!participant || participant.state !== "alive" || this.currentPhase !== "playing") {
      this.combat.settled(name);
      return;
    }
    const credited = this.credit.creditFor(name, system.currentTick);
    const killer = credited !== undefined && !this.areTeammates(credited, name) ? credited : undefined;
    this.credit.clear(name);
    this.stats.death(name);
    if (killer) {
      this.stats.kill(killer);
      const perKill = this.config.scoring?.perKill;
      if (perKill) this.score.add(this.sideOf(killer), perKill);
    }
    try {
      const line = this.deathMessage(name, { cause, killer });
      if (line) this.broadcast(line);
    } catch (error) {
      log.error(`${this.config.id}: deathMessage failed: ${describeError(error)}`);
    }
    let decision: DownDecision | void = undefined;
    try {
      decision = this.onDown(name, { cause, killer });
    } catch (error) {
      log.error(`${this.config.id}: onDown failed: ${describeError(error)}`);
    }
    this.applyDown(participant, decision ?? this.respawnRule(participant));
    this.queueWinCheck();
  }

  private respawnRule(participant: Participant): DownDecision {
    switch (this.config.respawn?.mode ?? "none") {
      case "unlimited":
        return "respawn";
      case "lives":
        participant.lives -= 1;
        return participant.lives > 0 ? "respawn" : "eliminate";
      case "stage":
        return "wait";
      default:
        return "eliminate";
    }
  }

  private applyDown(participant: Participant, decision: DownDecision): void {
    const name = participant.name;
    if (decision === "handled") {
      this.combat.settled(name);
      return;
    }
    this.spectate(name);
    if (decision === "eliminate") {
      participant.state = "out";
      this.combat.settled(name);
      this.title(say.error("Eliminated"), say.minor("You're spectating now"), name);
      return;
    }
    participant.state = "respawning";
    if (decision === "wait") return; // back at respawnAll()
    const delay = Math.max(1, (this.config.respawn?.delaySeconds ?? 3) * 20);
    this.respawnAt.set(name.toLowerCase(), system.currentTick + delay);
    this.playingScope?.timeout(() => {
      if (participant.state === "respawning") this.spawn(name, "respawn");
    }, delay);
  }

  private arrived(name: string): void {
    const player = this.player(name);
    if (!player) return;
    if (this.currentPhase === "waiting" || this.currentPhase === "countdown") {
      this.prepareWaiting(player);
      if (this.countdownScope) this.freeze([name], this.countdownScope);
      return;
    }
    if (this.currentPhase !== "playing") return;
    const participant = this.roster.get(name);
    const rule = this.config.lateJoin ?? "spectate";
    if (rule === "return") {
      player.sendMessage(say.info(`${this.config.name} is already running. Sending you back to the lobby.`));
      this.ctx.transfer.transfer(player, this.ctx.vars.lobbyPort);
      return;
    }
    if (rule === "join") {
      const joined = participant ?? this.roster.add(name, this.config.respawn?.lives ?? 1, this.smallestTeam());
      this.stats.join(name, system.currentTick, joined.team);
      this.spawn(name, "join");
      return;
    }
    normalizePlayer(player);
    this.spectate(name);
    player.sendMessage(say.minor(`${this.config.name} is in progress. You're spectating.`));
  }

  private departed(name: string): void {
    this.teamPicks.delete(name.toLowerCase());
    this.pickerOpen.delete(name.toLowerCase());
    if (this.currentPhase !== "playing") return;
    const participant = this.roster.get(name);
    if (!participant || participant.state === "left") return;
    if (participant.state === "alive") this.down(name, "left");
    participant.state = "left";
    this.stats.leave(name, system.currentTick);
    this.queueWinCheck();
  }

  // ---- Pregame ----------------------------------------------------------------------------

  /** Players pick teams unless the game says no, or the lobby's game screen chose random teams. */
  private get teamPicking(): boolean {
    const teams = this.config.teams;
    return teams !== undefined && teams.pick !== false && this.ctx.vars.settings?.teams !== "random";
  }

  private get picksOpen(): boolean {
    const roles = (this.config.teams?.defs ?? []).some((team) => team.size !== undefined);
    return (this.teamPicking && !roles) || this.kits.pick;
  }

  private hasPicked(name: string): boolean {
    return (!this.teamPicking || this.teamPicks.has(name.toLowerCase())) && (!this.kits.pick || this.kits.hasChosen(name));
  }

  private get minPlayers(): number {
    return this.ctx.vars.devMinPlayers ?? this.config.minPlayers;
  }

  private online(): string[] {
    return world.getAllPlayers().map((player) => player.name);
  }

  private openPregame(scope: Scope): void {
    for (const player of world.getAllPlayers()) this.prepareWaiting(player);
    if (this.picksOpen) {
      scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
        if (itemStack.typeId === PICKER_ITEM) void this.openPicker(source, scope);
      });
    }
    // Nobody can be hurt before the match (combat ignores non-participants); fallers come back.
    scope.interval(() => {
      for (const player of world.getAllPlayers()) {
        if (this.map.outOfBounds(player.location)) this.placeWaiting(player);
      }
    }, 10);
  }

  private prepareWaiting(player: Player): void {
    normalizePlayer(player, this.gameMode);
    this.placeWaiting(player);
    if (this.picksOpen) {
      const picker = new ItemStack(PICKER_ITEM, 1);
      picker.nameTag = this.config.teams ? "Pick team and kit" : "Pick a kit";
      picker.lockMode = ItemLockMode.slot;
      player.getComponent(EntityComponentTypes.Inventory)?.container.setItem(PICKER_SLOT, picker);
    }
  }

  private placeWaiting(player: Player): void {
    const index = Math.max(0, this.online().indexOf(player.name));
    const [x, y, z] = this.map.spawns[index % Math.max(1, this.map.spawns.length)] ?? [0, 65, 0];
    player.teleport({ x: x + 0.5, y, z: z + 0.5 });
  }

  private async openPicker(player: Player, scope: Scope): Promise<void> {
    const key = player.name.toLowerCase();
    if (this.pickerOpen.has(key)) return;
    this.pickerOpen.add(key);
    try {
      const teams = this.config.teams;
      if (teams && this.teamPicking) {
        const options = activeTeams(this.online().length, teams);
        const form = new ActionFormData().title("Pick a team");
        for (const team of options) {
          const picked = [...this.teamPicks.values()].filter((id) => id === team.id).length;
          form.button(`${team.color}${team.name}§r (${picked})`);
        }
        const answer = await showForm(scope, player, form);
        if (answer?.selection !== undefined) this.teamPicks.set(key, options[answer.selection].id);
      }
      if (this.kits.pick) {
        const form = new ActionFormData().title("Pick a kit");
        for (const kit of this.kits.list) form.button(kit.name, kit.icon);
        const answer = await showForm(scope, player, form);
        if (answer?.selection !== undefined) this.kits.choose(player.name, this.kits.list[answer.selection].id);
      }
    } finally {
      this.pickerOpen.delete(key);
    }
  }

  private async waitForPlayers(): Promise<boolean> {
    this.currentPhase = "waiting";
    const expected = this.ctx.vars.expectedPlayers.map((name) => name.toLowerCase());
    const limit = this.config.waitForPlayersSeconds ?? 30;
    for (let second = 0; ; second++) {
      if (this.outcome) return false;
      const online = this.online();
      const here = new Set(online.map((name) => name.toLowerCase()));
      if (expected.length > 0 && expected.every((name) => here.has(name)) && online.length >= this.minPlayers) return true;
      if (second >= limit) {
        if (online.length >= this.minPlayers) return true;
        this.outcome = aborted(online.length === 0 ? "empty" : "not_enough_players");
        return false;
      }
      const needed = Math.max(this.minPlayers, expected.length);
      for (const player of world.getAllPlayers()) player.onScreenDisplay.setActionBar(say.info(`Waiting for players (${online.length}/${needed})`));
      await this.scope.wait(20);
    }
  }

  /** Frozen countdown. Returns false when players drop below the minimum. */
  private async countdown(): Promise<boolean> {
    this.currentPhase = "countdown";
    const scope = this.scope.child("countdown");
    this.countdownScope = scope;
    try {
      const picks = this.picksOpen;
      const base = this.config.countdownSeconds ?? 5;
      let left = picks ? Math.max(base, 15) : base;
      this.freeze(this.online(), scope);
      while (left > 0) {
        if (this.outcome) return false;
        const online = this.online();
        if (online.length < this.minPlayers) {
          this.broadcast(say.warn("Not enough players. Waiting again."));
          return false;
        }
        if (picks && left > 3 && online.every((name) => this.hasPicked(name))) left = 3;
        this.title(`${COLOR.highlight}${left}`, say.minor(picks ? "Use the star to pick" : `${this.config.name} is starting`));
        this.chime(countdownChime(left));
        await scope.wait(20);
        left--;
      }
      return !this.outcome;
    } finally {
      this.countdownScope = undefined;
      scope.dispose();
    }
  }

  private async frozenCountdown(seconds: number, label: string): Promise<void> {
    const scope = (this.playingScope ?? this.scope).child("round-countdown");
    this.freeze(this.roster.inState("alive").map((participant) => participant.name), scope);
    for (let left = seconds; left > 0; left--) {
      this.title(`${COLOR.highlight}${left}`, say.minor(label));
      this.chime(countdownChime(left));
      await scope.wait(20);
    }
    scope.dispose();
    this.title(say.success("Go!"), say.minor(label));
    this.chime("go");
  }

  // ---- The match --------------------------------------------------------------------------

  private begin(): void {
    this.currentPhase = "playing";
    const playing = this.scope.child("playing");
    this.playingScope = playing;
    this.startTick = system.currentTick;
    const names = this.online().slice(0, this.config.maxPlayers);
    let assignment: Map<string, string> | undefined;
    if (this.config.teams) {
      const picks = new Map<string, string>();
      for (const name of names) {
        const pick = this.teamPicks.get(name.toLowerCase());
        if (pick) picks.set(name, pick);
      }
      assignment = assignTeams(names, picks, this.config.teams, this.ctx.random);
      this.teams = activeTeams(names.length, this.config.teams);
    }
    const lives = this.config.respawn?.mode === "lives" ? (this.config.respawn.lives ?? 3) : 1;
    for (const name of names) {
      const participant = this.roster.add(name, lives, assignment?.get(name));
      this.stats.join(name, this.startTick, participant.team);
    }
    for (const extra of this.online().slice(this.config.maxPlayers)) this.spectate(extra);
    if (this.config.scoring) {
      // Everyone starts on the sidebar at 0, not only once they score.
      const sides = this.config.scoring.per === "team" ? this.teams.map((team) => team.id) : names;
      for (const side of sides) this.score.set(side, 0);
    }

    playing.interval(() => this.watchBounds(), 2);
    playing.interval(() => this.refreshDisplays(), 10);
    playing.interval(() => {
      if (world.getAllPlayers().length === 0) this.abort("empty");
      else this.runWinCheck();
    }, 20);

    for (const participant of this.roster.all()) this.spawn(participant.name, "start");
    for (const participant of this.roster.all()) {
      const team = this.teamOf(participant.name);
      this.title(say.success("Go!"), team ? say.minor(`You're on the ${nameOf(`${team.name} team`, team.color)}`) : say.minor(this.config.name), participant.name);
    }
    this.chime("go");
    this.contestSides = this.roster.standingSides().length;
    try {
      this.onStart();
    } catch (error) {
      log.error(`${this.config.id}: onStart failed: ${describeError(error)}`);
    }
    this.refreshDisplays();
  }

  private async runPlay(): Promise<Result> {
    const playing = this.playingScope ?? this.scope;
    try {
      const value = await playing.guard(Promise.resolve().then(() => this.play()));
      return value ?? draw("the match ended");
    } catch (error) {
      log.error(`${this.config.id}: play() failed: ${describeError(error)}`);
      return aborted("error");
    }
  }

  private watchBounds(): void {
    if ((this.config.combat?.outOfBounds ?? "down") === "ignore") return;
    for (const participant of this.roster.inState("alive")) {
      const player = this.player(participant.name);
      if (player && this.map.outOfBounds(player.location)) this.down(participant.name, "void");
    }
    // Spectators fly through walls: keep them over the map.
    for (const participant of this.roster.inState("out", "respawning")) {
      const player = this.player(participant.name);
      const bounds = this.map.bounds;
      if (player && bounds && this.map.outOfBounds({ ...player.location, y: Math.max(player.location.y, bounds.min[1]) })) {
        const [x, y, z] = this.map.spectatorSpawn;
        player.teleport({ x: x + 0.5, y, z: z + 0.5 });
      }
    }
  }

  private refreshDisplays(): void {
    const secondsLeft = this.currentStage?.secondsLeft;
    for (const player of world.getAllPlayers()) {
      const text = hudLine(secondsLeft, this.hud(player.name) ?? "");
      if (text) player.onScreenDisplay.setActionBar(text);
    }
    const board = this.roundWins ?? (this.config.scoring ? this.score : undefined);
    if (!board) return;
    if (!this.sidebar) {
      this.sidebar = new Sidebar(this.playingScope ?? this.scope, `${this.ctx.vars.sessionId}`.slice(0, 12), this.config.scoring?.title ?? (this.roundWins ? "Rounds" : "Score"));
    }
    if (board.changes === this.sidebarVersion) return;
    this.sidebarVersion = board.changes;
    this.sidebar.show(board.entries().map(([id, value]) => [this.sideName(id), value]));
  }

  private queueWinCheck(): void {
    if (this.winCheckQueued || !this.playingScope || this.playingScope.disposed) return;
    this.winCheckQueued = true;
    this.playingScope.defer(() => {
      this.winCheckQueued = false;
      this.runWinCheck();
    });
  }

  private runWinCheck(): void {
    if (this.currentPhase !== "playing" || this.outcome) return;
    let result: Result | undefined;
    try {
      result = this.checkWin();
    } catch (error) {
      log.error(`${this.config.id}: checkWin failed: ${describeError(error)}`);
    }
    if (!result) return;
    if (this.contest) this.contest(result);
    else this.finish(result);
  }

  private async conclude(result: Result): Promise<Result> {
    this.currentPhase = "ending";
    this.outcome ??= result;
    this.playingScope?.dispose();
    if (result.kind !== "aborted") {
      this.announce(result);
      this.sendStats(result);
    }
    try {
      this.onEnd(result);
    } catch (error) {
      log.error(`${this.config.id}: onEnd failed: ${describeError(error)}`);
    }
    if (result.kind !== "aborted") await this.scope.wait((this.config.endDelaySeconds ?? 5) * 20);
    this.scope.dispose();
    this.currentPhase = "done";
    return result;
  }

  private announce(result: Result): void {
    switch (result.kind) {
      case "win": {
        const team = result.team !== undefined ? this.teams.find((def) => def.id === result.team) : undefined;
        const who = team ? nameOf(`${team.name} team`, team.color) : result.players.map((name) => nameOf(name)).join(say.highlight(", "));
        this.title(`${who} ${COLOR.highlight}wins!`, say.minor(result.reason));
        this.broadcast(`${say.highlight(`${who} wins ${this.config.name}!`)} ${say.minor(`(${result.reason})`)}`);
        return;
      }
      case "coop":
        this.title(result.won ? say.success("Victory!") : say.error("Defeat"), say.minor(result.reason));
        this.broadcast(result.won ? say.success(`${this.config.name}: victory!`) : say.error(`${this.config.name}: defeat.`));
        return;
      case "draw":
        this.title(say.highlight("Draw"), say.minor(result.reason));
        this.broadcast(`${say.highlight(`${this.config.name} ended in a draw.`)} ${say.minor(`(${result.reason})`)}`);
        return;
      default:
        return;
    }
  }

  private sendStats(result: Result): void {
    const config = this.config.stats;
    if (!config) return;
    const vars = this.ctx.vars;
    const header = {
      sessionId: vars.sessionId,
      matchId: `${vars.sessionId}.${this.ctx.match}`,
      game: this.config.id,
      map: vars.map,
      mode: config.mode,
      durationSec: Math.round((system.currentTick - this.startTick) / 20),
      ...(result.kind === "win" ? { winner: result.team ?? result.players[0] } : {}),
    };
    const parts = packStatsParts(header, this.stats.rows(result, system.currentTick));
    for (const part of parts) this.ctx.transport.send(part);
    log.info(`${this.config.id}: sent stats for ${parts.reduce((sum, part) => sum + part.rows.length, 0)} players in ${parts.length} part(s)`);
  }

  private applyGameRules(): void {
    const rules = { ...DEFAULT_GAME_RULES, ...(this.config.combat?.fall === false ? { fallDamage: false } : {}), ...this.config.gameRules };
    const gameRules = world.gameRules as unknown as Record<string, boolean | number>;
    const saved: Record<string, boolean | number> = {};
    for (const [rule, value] of Object.entries(rules)) {
      try {
        saved[rule] = gameRules[rule];
        gameRules[rule] = value;
      } catch (error) {
        log.warn(`${this.config.id}: could not set game rule ${rule}: ${describeError(error)}`);
      }
    }
    this.scope.add(() => {
      for (const [rule, value] of Object.entries(saved)) gameRules[rule] = value;
    });
  }

  // ---- Small helpers ----------------------------------------------------------------------

  private combatHost(): CombatHost {
    const game = this;
    return {
      get playing() {
        return game.currentPhase === "playing";
      },
      canFight: (name) => this.roster.get(name)?.state === "alive",
      isProtected: (name) => (this.protectedUntil.get(name.toLowerCase()) ?? 0) > system.currentTick,
      areAllies: (a, b) => this.areTeammates(a, b) && !this.config.teams?.friendlyFire,
      onDamage: (hit) => this.onDamage(hit),
      down: (name, cause) => this.down(name, cause),
    };
  }

  private areTeammates(a: string, b: string): boolean {
    const teamA = this.roster.get(a)?.team;
    return teamA !== undefined && teamA === this.roster.get(b)?.team;
  }

  /** The scoring side of a player: their team in team games, else themselves. */
  private sideOf(name: string): string {
    return this.roster.get(name)?.team ?? this.roster.get(name)?.name ?? name;
  }

  /** A team's name in its color, or a player's name (in their team color, else white). */
  private sideName(side: string): string {
    const team = this.teams.find((def) => def.id === side);
    return team ? nameOf(team.name, team.color) : nameOf(side, this.teamOf(side)?.color);
  }

  private smallestTeam(): string | undefined {
    if (this.teams.length === 0) return undefined;
    const counts = this.teams.map((team) => [team.id, this.roster.teamMembers(team.id).length] as const);
    return counts.sort(([, a], [, b]) => a - b)[0][0];
  }
}


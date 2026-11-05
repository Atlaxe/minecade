// The Minigame base class. A game subclasses it, sets its config, and writes play() from stages,
// or plays best-of rounds by config. Core runs the outer lifecycle: waiting for players, the kit
// form, a countdown, the match, and the results (stats, the winner). Everything a match sets up
// hangs off this.scope, so nothing survives into the next game.
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
  type Vector3,
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { ServerContext } from "../context.ts";
import type { BestOfConfig, GameConfig, KitDef, TeamDef } from "../config.ts";
import { bestOfCodes, countdownChime, hudLine, playChime, previewLine, type Chime } from "../hud.ts";
import { kitLines, kitPicturePath, teamColored } from "../kit-defs.ts";
import { describeError, log } from "../log.ts";
import { facingOf, worldPoint, type Box, type MapPosition } from "../map-config.ts";
import { mapSettingValue } from "../map-requirements.ts";
import { normalizePlayer } from "../player.ts";
import type { Scope } from "../scope.ts";
import { COLOR, deathMessage as formatDeath, nameOf, say, stripColors } from "../text.ts";
import { showForm } from "../ui.ts";
import { homePort } from "../vars.ts";
import { BestOf, bestOfDisplay, bestOfRounds } from "./best-of.ts";
import { BuildRules, type BuildHost } from "./build.ts";
import { Combat, type CombatHost, type Hit } from "./combat.ts";
import { KillCredit } from "./credit.ts";
import { fakePanelEntries } from "./fake-panel.ts";
import { FAKE_PLAYER, FakePlayers } from "./fakes.ts";
import { PreviewMannequins } from "./preview-mannequins.ts";
import { KitForm, type KitCard, type KitFormContent } from "./kit-form.ts";
import { KitPicker, type KitPickView } from "./kit-picker.ts";
import { Kits } from "./kits.ts";
import { MapView } from "./map-view.ts";
import { SIDE_TITLE } from "./preview.ts";
import { aborted, draw, lastStanding, type Result } from "./results.ts";
import { Roster, type Participant } from "./roster.ts";
import { Score } from "./score.ts";
import { Sidebar } from "./sidebar.ts";
import { packStatsParts, StatsRecorder } from "./stats.ts";
import { activeTeams, assignTeams, teamLimit } from "./teams.ts";

export interface GameContext extends ServerContext {
  random(): number;
  /** Which match of the session this is (always 1 until Party mode). */
  match: number;
}

/** "picking": everyone is in, and picking kits before the countdown. */
export type Phase = "waiting" | "picking" | "countdown" | "playing" | "ending" | "done";
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
/** The star: before the match, in a game whose players pick kits, it brings up the kit form to change kits. */
const KIT_STAR = "minecraft:nether_star";
const KIT_STAR_SLOT = 8;
/** How often a preview's mode line is checked, and sent again when a title replaced it or it's due. */
const PREVIEW_CHECK_TICKS = 20;
const PREVIEW_REFRESH_TICKS = 100;
/** A title() lasts this long (stay plus fade out); the preview's line waits until it's gone. */
const TITLE_TICKS = 40;
const TITLE_FADE_TICKS = 10;
/** Invisibility in a locked queue lasts until normalizePlayer clears it at the spawn. */
const QUEUE_EFFECT_TICKS = 1_000_000;
/** What holds players up at a locked queue spawn in the air: solid, and players don't see it. */
const QUEUE_FLOOR = "minecraft:barrier";
/** After a best-of round is decided, everyone stays put this long before going back to their spawns. */
const ROUND_BREAK_TICKS = 40;
/** How often the kit form's picks are checked, in ticks; its clock moves every second. */
const PICK_CHECK_TICKS = 5;
/** Survival games (building): hunger is topped up this often, so nobody starves. */
const FEED_TICKS = 100;
/** Sides without a team color (best-of free-for-alls) take these in turn on the rounds display. */
const SIDE_COLORS = ["§c", "§9", "§a", "§e"];
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
  /** A preview's fake players (/fake), who play like everyone else; undefined outside previews. */
  readonly fakes: FakePlayers | undefined;
  /** Building rules, for games with a `build` config. */
  readonly build: BuildRules | undefined;
  /** The game mode players spawn in: survival for build games. Others can switch to creative. */
  protected gameMode: GameMode = GameMode.Adventure;
  /**
   * The resource pack (its UUID) that holds the kit pictures the build draws, so the kit form shows
   * them; undefined for none. A game with a resource pack sets it from its manifest.
   */
  protected kitPicturePack: string | undefined;

  private currentPhase: Phase = "waiting";
  private playingScope: Scope | undefined;
  private countdownScope: Scope | undefined;
  /** Players wait at the map's queue spawn (until the queue countdown ends). */
  private queued = false;
  /** When title() last showed a title, and when the preview's mode line was last sent, in ticks. */
  private titleAt = -TITLE_TICKS;
  private previewSentAt = -PREVIEW_REFRESH_TICKS;
  private outcome: Result | undefined;
  private settle: (result: Result) => void = () => {};
  private readonly finished: Promise<Result>;
  private contest: ((result: Result) => void) | undefined;
  private contestSides = 0;
  private currentStage: Stage | undefined;
  /** The best-of series, once it starts. */
  private series: BestOf | undefined;
  /** Seconds left on the clock over all best-of rounds (timeLimitSeconds), when there is one. */
  private matchSecondsLeft: number | undefined;
  private teams: TeamDef[] = [];
  /**
   * Teams dealt out once everyone is in, before the kits and the countdown, so players wait at
   * their own team's spawns (lowercase name to team id). The match keeps them where it can.
   */
  private teamPlan: Map<string, string> | undefined;
  private readonly teamPicks = new Map<string, string>();
  /** Each player's kit form while one is up: the picker's, or the star's before the match. */
  private readonly kitForms = new Map<string, KitForm>();
  /** The kit picking under way, if any. */
  private kitPicker: KitPicker | undefined;
  private readonly protectedUntil = new Map<string, number>();
  /** When each respawning player comes back (tick), for their countdown. */
  private readonly respawnAt = new Map<string, number>();
  /** The second each respawning player's countdown title shows. */
  private readonly respawnShown = new Map<string, number>();
  private winCheckQueued = false;
  private startTick = 0;
  private sidebar: Sidebar | undefined;
  private sidebarVersion = -1;
  /** Players with a fake player's side panel open. */
  private readonly panelOpen = new Set<string>();
  /** A map editor's /restart ended the preview: everyone plays it again. */
  private restartAsked = false;
  /** The block under a locked queue spawn the game made a barrier while players wait there. */
  private queueFloor: Vector3 | undefined;

  constructor(ctx: GameContext, config: C) {
    this.ctx = ctx;
    this.config = config;
    this.scope = ctx.root.child(`game:${config.id}`);
    this.map = new MapView(ctx.vars.mapConfig);
    this.kits = new Kits(config.kits, ctx.vars.mapConfig.kits);
    this.stats = new StatsRecorder(config.stats);
    this.credit = new KillCredit((config.combat?.killCreditSeconds ?? 8) * 20);
    this.combat = new Combat(this.combatHost(), config.combat ?? {}, this.stats, this.credit);
    this.fakes = ctx.vars.preview ? new FakePlayers(world.getDimension("overworld")) : undefined;
    this.build = config.build ? new BuildRules(this.buildHost(), config.build, this.map) : undefined;
    if (config.build) this.gameMode = GameMode.Survival;
    this.finished = new Promise((resolve) => (this.settle = resolve));
  }

  /** Whether a map editor ended the preview with /restart, so everyone plays it again (session.ts). */
  get restarting(): boolean {
    return this.restartAsked;
  }

  get phase(): Phase {
    return this.currentPhase;
  }

  /** True once the match's result is known (finish() or abort() was called): a game's own steps stop there. */
  protected get decided(): boolean {
    return this.outcome !== undefined;
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
   * Once everyone's in (and has picked a kit), before the countdown: a game's own step, such as
   * Build Swap's prompt form, with the phase "picking". Resolve true to go on to the countdown, or
   * false to go back to waiting (when fewer than minPlayers are online()). `scope` lasts until the
   * match begins. The step runs again whenever a countdown falls through, so it keeps what it got.
   * Games without one leave it out.
   */
  protected beforeCountdown?(names: string[], scope: Scope): Promise<boolean>;

  /** A preview's /skip during beforeCountdown: end the game's step now. True when there was one to end. */
  protected skipPicking?(): boolean;

  /**
   * The match itself. The default is one stage of timeLimitSeconds (5 minutes unless set; 0 for
   * no limit), or until a win check ends it; or, with a `bestOf` config, best-of rounds
   * (playBestOf). Return a result, or nothing for a draw. finish() ends it from anywhere.
   */
  protected async play(): Promise<Result | void> {
    if (this.config.bestOf) return this.playBestOf(this.config.bestOf);
    const { timedOut } = await this.stage("Match", { seconds: this.timeLimit });
    if (timedOut) return this.onTimeUp();
  }

  /** As a best-of round starts (after its countdown; round 1 at "Go!"). */
  protected onRoundStart(_round: number): void {}

  /** Once a best-of round is decided, before the next (or the end of the match). */
  protected onRoundEnd(_round: number, _result: Result): void {}

  /** A best-of round ran out of time (bestOf.roundSeconds): a drawn round unless the game says otherwise. */
  protected onRoundTimeUp(_round: number): Result {
    return draw("time ran out");
  }

  /** Boxes where nobody can build, on top of the map's no-build regions (Bridges: its holes). */
  protected noBuildBoxes(): Box[] {
    return [];
  }

  /**
   * One of the game's per-map settings (its config's `map.settings`): this map's value, set with the
   * map editor's Game settings tool, or the setting's default.
   */
  protected mapSetting(key: string): number {
    const setting = this.config.map?.settings?.[key];
    if (!setting) throw new Error(`${this.config.id} has no map setting "${key}"`);
    return mapSettingValue(setting, this.map.config, key);
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
    if (this.series) {
      // Best-of rounds: the most round wins when time runs out.
      const leader = this.series.leader(this.seriesSides());
      return leader !== undefined ? this.sideWins(leader, "the most rounds when time ran out") : draw("time ran out");
    }
    const rule = this.config.timeUp ?? "highestScore";
    if (typeof rule === "object") return this.teamWins(rule.team, "time ran out");
    if ((this.config.win ?? "last") === "coop") return { kind: "coop", won: true, reason: "survived" };
    if (rule === "highestScore" && this.config.scoring) {
      const leader = this.score.leader();
      if (leader && !leader.tied) return this.sideWins(leader.id, "highest score");
    }
    return draw("time ran out");
  }

  /**
   * Team spawns for team games, otherwise the map's spawns in roster order. `why` lets a game
   * choose differently for respawns (One in the Quiver: away from everyone else).
   */
  protected spawnPoint(name: string, _why: SpawnReason = "start"): MapPosition {
    const participant = this.roster.get(name);
    const key = name.toLowerCase();
    if (participant?.team) {
      const spawns = this.map.teamSpawns(participant.team);
      const members = this.roster.teamMembers(participant.team).map((member) => member.name.toLowerCase());
      if (spawns.length > 0) return spawns[Math.max(0, members.indexOf(key)) % spawns.length];
    }
    const everyone = this.roster.all().map((member) => member.name.toLowerCase());
    const spawns = this.map.waitingSpots;
    return spawns[Math.max(0, everyone.indexOf(key)) % Math.max(1, spawns.length)] ?? [0, 65, 0];
  }

  /**
   * The action bar line for a player, refreshed twice a second. Only what matters right now: lives
   * in lives games. The stage clock is drawn separately, top right (see hud.ts), with this line
   * after it; a respawn countdown is a title.
   */
  protected hud(name: string): string | undefined {
    const participant = this.roster.get(name);
    if (participant && this.config.respawn?.mode === "lives" && participant.state !== "out") return say.info(`Lives: ${participant.lives}`);
    return undefined;
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
    if (this.ctx.vars.preview) this.keepPreviewLine(this.ctx.vars.preview);
    // The map editor's mannequins, when its preview build kept them in.
    const mannequins = this.ctx.vars.mapConfig.previewMannequins;
    if (this.ctx.vars.preview && Array.isArray(mannequins) && mannequins.length > 0) new PreviewMannequins(this.scope, mannequins);
    this.scope.subscribe(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
      if (!initialSpawn) return;
      const name = player.name;
      this.scope.timeout(() => this.arrived(name), 2);
    });
    this.scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => this.departed(playerName));
    this.combat.attach(this.scope);
    this.build?.attach(this.scope);
    if (this.fakes) this.watchFakes(this.fakes);
    try {
      this.setup();
    } catch (error) {
      log.error(`${this.config.id}: setup failed: ${describeError(error)}`);
      return this.conclude(aborted("error"));
    }

    const pregame = this.scope.child("pregame");
    // A map with a queue spawn: everyone waits there, then a countdown puts them at their spawns
    // for the usual frozen countdown. A countdown that falls through sends them back to it.
    this.queued = this.map.queueSpawn !== undefined;
    this.openPregame(pregame);
    // A preview starts with the fake players picked before it loaded: they wait like anyone else,
    // leaving room for everyone the preview expects.
    const room = this.config.maxPlayers - this.ctx.vars.expectedPlayers.length;
    if (this.fakes && this.ctx.vars.previewFakes > 0 && room > 0) log.info(stripColors(this.addFakes(Math.min(this.ctx.vars.previewFakes, room))));
    // Once everyone's in, teams are dealt (players wait at their team's spawns), then everyone picks
    // a kit where they wait (the queue spawn or their spawn), then the countdown. A countdown or a
    // kit form that loses players goes back to waiting; picks already made are kept.
    for (;;) {
      if (this.map.queueSpawn && !this.queued) this.requeue(true);
      if (!(await this.waitForPlayers())) {
        pregame.dispose();
        return this.conclude(this.outcome ?? aborted("not_enough_players"));
      }
      this.planTeams();
      if (this.kits.picking && !(await this.pickKits(this.online(), pregame, true))) {
        this.unplanTeams();
        continue;
      }
      if (this.beforeCountdown) {
        this.currentPhase = "picking";
        if (!(await this.beforeCountdown(this.online(), pregame))) {
          this.unplanTeams();
          continue;
        }
      }
      if (this.queued) {
        if (!(await this.queueCountdown(this.map.queue.countdown))) {
          this.unplanTeams();
          continue;
        }
        this.requeue(false);
      }
      if (await this.countdown()) break;
      this.unplanTeams();
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

  /**
   * The team picks made in the lobby (player name to team id), forwarded by the orchestrator.
   * They decide teams when the match begins, up to each team's cap; picks that come later are
   * ignored.
   */
  setTeamPicks(picks: Record<string, string>): void {
    if (this.currentPhase !== "waiting" && this.currentPhase !== "picking" && this.currentPhase !== "countdown") {
      log.warn(`${this.config.id}: team picks arrived after the match began; ignored`);
      return;
    }
    for (const [name, team] of Object.entries(picks)) this.teamPicks.set(name.toLowerCase(), team);
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
   * Best-of rounds (not turn-based rounds, a separate system still to come). Round 1 starts at
   * "Go!"; each round runs until the win check or endRound() decides it (or bestOf.roundSeconds run
   * out). Then everyone goes back to their spawns, picks a kit again when kits are picked every round,
   * and gets a short frozen countdown. The first side to win more than half the rounds (or to
   * `firstTo`) takes the match; timeLimitSeconds is a clock over all of them. The rounds show top
   * right (hud.ts bestOfCodes).
   */
  protected async playBestOf(config: BestOfConfig): Promise<Result> {
    const series = new BestOf(bestOfRounds(config, this.ctx.vars.settings));
    this.series = series;
    this.startMatchClock();
    for (;;) {
      const round = series.round;
      if (round > 1) await this.nextRound(round, config);
      this.safely("onRoundStart", () => this.onRoundStart(round));
      const result = await this.playRound(round, config);
      if (result.kind === "aborted") return result;
      const side = result.kind === "win" ? (result.team ?? result.players[0]) : undefined;
      series.record(side);
      this.announceRound(round, side, result.reason);
      this.safely("onRoundEnd", () => this.onRoundEnd(round, result));
      const outcome = series.outcome(this.seriesSides());
      if (outcome.over) {
        if (outcome.winner === undefined) return draw("the rounds were tied");
        const wins = series.wins(outcome.winner);
        return this.sideWins(outcome.winner, `won ${wins} round${wins === 1 ? "" : "s"}`);
      }
      await this.roundBreak();
    }
  }

  /** Decides the best-of round being played with `result` (Bridges: a goal). Nothing between rounds. */
  endRound(result: Result): void {
    this.contest?.(result);
  }

  /** True while a best-of round is being played (not during its countdown or the break after it). */
  get roundInPlay(): boolean {
    return this.contest !== undefined;
  }

  /** The best-of series: the round being played and each round's winner; undefined outside best-of games. */
  get bestOf(): BestOf | undefined {
    return this.series;
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
    if (this.fakes?.has(name)) {
      // Where a player would watch from: on foot at the queue spawn, or floating at the spectator
      // spawn. Seen there, unlike a player (so a preview shows where they went), and nameless.
      this.placeFake(name, this.map.spectatorSpawn, { tagged: false, floating: !this.map.watchesFromQueue });
      return;
    }
    const player = this.player(name);
    if (!player) return;
    if (this.map.watchesFromQueue) {
      // No spectator spawn: they wait at the queue spawn on foot, with empty hands, seen but nameless.
      normalizePlayer(player, GameMode.Adventure);
      player.nameTag = "";
      this.place(player, this.map.spectatorSpawn);
      return;
    }
    player.setGameMode(GameMode.Spectator);
    this.place(player, this.map.spectatorSpawn);
  }

  broadcast(text: string): void {
    world.sendMessage(text);
  }

  /** A countdown sound for everyone on the server. */
  chime(chime: Chime): void {
    for (const player of world.getAllPlayers()) playChime(player, chime);
  }

  /** A title for one player, or everyone when `to` is omitted, up for `stay` ticks, then fading for 10. */
  title(title: string, subtitle?: string, to?: string, stay = 30): void {
    this.titleAt = system.currentTick;
    const players = to === undefined ? world.getAllPlayers() : [this.player(to)].filter((player): player is Player => !!player);
    for (const player of players) {
      player.onScreenDisplay.setTitle(title, { fadeInDuration: 0, stayDuration: stay, fadeOutDuration: TITLE_FADE_TICKS, subtitle });
    }
  }

  player(name: string): Player | undefined {
    const key = name.toLowerCase();
    return world.getAllPlayers().find((player) => player.name.toLowerCase() === key);
  }

  /** A participant's body in the world: their player, or a preview's fake player. */
  body(name: string): Entity | undefined {
    return this.player(name) ?? this.fakes?.body(name);
  }

  /** Who an entity is in the match: a player's name, or a fake player's; undefined for anything else. */
  whoIs(entity: Entity | undefined): string | undefined {
    try {
      if (entity?.typeId === "minecraft:player") return (entity as Player).name;
      return entity?.typeId === FAKE_PLAYER ? this.fakes?.nameOf(entity) : undefined;
    } catch {
      return undefined; // gone
    }
  }

  /** Whether a player is still protected after a respawn (respawn.protectSeconds): no hit counts on them. */
  isProtected(name: string): boolean {
    return (this.protectedUntil.get(name.toLowerCase()) ?? 0) > system.currentTick;
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
    const protect = this.config.respawn?.protectSeconds;
    if (why === "respawn" && protect) this.protectedUntil.set(name.toLowerCase(), system.currentTick + protect * 20);
    this.respawnAt.delete(name.toLowerCase());
    this.respawnShown.delete(name.toLowerCase());
    if (this.fakes?.has(name)) {
      this.placeFake(name, this.spawnPoint(name, why), { faceCenter: true, tagged: this.config.nameTags === true, hearts: true });
      return;
    }
    const player = this.player(name);
    if (!player) return;
    normalizePlayer(player, this.gameMode);
    const team = this.teamOf(name);
    player.nameTag = this.config.nameTags !== true ? "" : team ? `${team.color}${player.name}` : player.name;
    this.place(player, this.spawnPoint(name, why), true);
    // Kits picked every round come once the round's pick is made (nextRound).
    this.kits.give(player, why, team?.color, { chosen: !(why === "round" && this.kits.select === "round" && this.kits.picking) });
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
    // What's left of kits that aren't refilled on every spawn comes back at the respawn.
    const body = this.player(name);
    if (body) this.kits.stash(body, this.teamOf(name)?.color);
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
    this.respawnTitles();
    this.playingScope?.timeout(() => {
      if (participant.state === "respawning") this.spawn(name, "respawn");
    }, delay);
  }

  private arrived(name: string): void {
    const player = this.player(name);
    if (!player) return;
    if (this.currentPhase === "waiting" || this.currentPhase === "picking" || this.currentPhase === "countdown") {
      this.prepareWaiting(player);
      if (this.countdownScope) this.freeze([name], this.countdownScope);
      return;
    }
    if (this.currentPhase !== "playing") return;
    const participant = this.roster.get(name);
    const rule = this.config.lateJoin ?? "spectate";
    if (rule === "return") {
      player.sendMessage(say.info(`${this.config.name} is already running. Sending you back to the lobby.`));
      this.ctx.transfer.transfer(player, homePort(this.ctx.vars, player.name));
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
    if (this.currentPhase !== "playing") return;
    const participant = this.roster.get(name);
    if (!participant || participant.state === "left") return;
    if (participant.state === "alive") this.down(name, "left");
    participant.state = "left";
    this.stats.leave(name, system.currentTick);
    this.queueWinCheck();
  }

  // ---- Pregame ----------------------------------------------------------------------------

  protected get minPlayers(): number {
    return this.ctx.vars.devMinPlayers ?? this.config.minPlayers;
  }

  /** Everyone in the game: the players, then a preview's fake players. */
  protected online(): string[] {
    return [...world.getAllPlayers().map((player) => player.name), ...(this.fakes?.all ?? [])];
  }

  private openPregame(scope: Scope): void {
    scope.add(() => this.releaseQueueFloor());
    for (const player of world.getAllPlayers()) this.prepareWaiting(player);
    if (this.kits.picking) {
      scope.subscribe(world.afterEvents.itemUse, ({ source, itemStack }) => {
        if (itemStack.typeId === KIT_STAR) this.openKitForm(source);
      });
      scope.add(() => this.closeKitForms());
    }
    // Nobody can be hurt before the match (combat ignores non-participants); fallers come back,
    // and so does anyone pushed off a locked queue spawn.
    scope.interval(() => {
      this.holdQueueFloor();
      for (const player of world.getAllPlayers()) {
        if (this.map.outOfBounds(player.location) || this.offQueueSpot(player)) this.placeWaiting(player);
      }
      for (const name of this.fakes?.all ?? []) {
        if (this.fakes?.isPlacing(name)) continue;
        const body = this.fakes?.body(name);
        if (!body || this.map.outOfBounds(body.location)) this.placeWaitingFake(name);
      }
    }, 10);
  }

  /**
   * A game previewed from the map editor keeps "Preview   Sumo: Arena" in the mode box top center.
   * It rides on the title, so it never goes out while one of the game's titles is up (they all go
   * through title()), and comes back as soon as one is gone.
   */
  private keepPreviewLine(label: string): void {
    const line = previewLine(label);
    this.scope.interval(() => {
      const now = system.currentTick;
      if (now - this.titleAt < TITLE_TICKS) return;
      if (this.previewSentAt > this.titleAt && now - this.previewSentAt < PREVIEW_REFRESH_TICKS) return;
      this.previewSentAt = now;
      for (const player of world.getAllPlayers()) {
        try {
          player.onScreenDisplay.setTitle(line, { fadeInDuration: 0, stayDuration: PREVIEW_REFRESH_TICKS * 4, fadeOutDuration: 0 });
        } catch {
          // gone, or not ready for titles yet: the next check sends it
        }
      }
    }, PREVIEW_CHECK_TICKS);
    this.scope.subscribe(world.afterEvents.playerSpawn, () => (this.previewSentAt = -PREVIEW_REFRESH_TICKS));
  }

  /** Everyone into the queue (`on`), or out of it to their waiting spawns. */
  private requeue(on: boolean): void {
    this.queued = on;
    if (!on) this.releaseQueueFloor();
    for (const player of world.getAllPlayers()) this.prepareWaiting(player);
    for (const name of this.fakes?.all ?? []) this.placeWaitingFake(name);
  }

  /** A locked-in player more than a block from the queue spawn (pushed, or lagging). */
  private offQueueSpot(player: Player): boolean {
    const spawn = this.map.queueSpawn;
    if (!this.queued || !spawn || this.map.queue.mode !== "lock") return false;
    const spot = worldPoint(spawn);
    return Math.hypot(player.location.x - spot.x, player.location.z - spot.z) > 1 || Math.abs(player.location.y - spot.y) > 1;
  }

  private prepareWaiting(player: Player): void {
    normalizePlayer(player, this.gameMode);
    this.placeWaiting(player);
    if (this.kits.picking) {
      const star = new ItemStack(KIT_STAR, 1);
      star.nameTag = "Change kit";
      star.lockMode = ItemLockMode.slot;
      player.getComponent(EntityComponentTypes.Inventory)?.container.setItem(KIT_STAR_SLOT, star);
    }
  }

  /**
   * At the queue spawn while queued (locked in: unable to move but free to look around, held up
   * there, and invisible without a name tag, so nobody sees the others), else at a spawn of their
   * own. normalizePlayer, at every spawn, undoes the queue's lock.
   */
  private placeWaiting(player: Player): void {
    const queueSpawn = this.map.queueSpawn;
    if (this.queued && queueSpawn) {
      this.holdQueueFloor();
      this.place(player, queueSpawn);
      if (this.map.queue.mode !== "lock") return;
      try {
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
        player.addEffect("invisibility", QUEUE_EFFECT_TICKS, { amplifier: 0, showParticles: false });
        player.nameTag = "";
      } catch (error) {
        log.warn(`could not lock ${player.name} in the queue: ${describeError(error)}`);
      }
      return;
    }
    this.place(player, this.waitingSpawn(player.name));
  }

  /** A fake player waits where a player would: in the queue (unseen, nameless and floating when it locks), else at a spawn of its own. */
  private placeWaitingFake(name: string): void {
    const queueSpawn = this.map.queueSpawn;
    if (this.queued && queueSpawn) {
      const locked = this.map.queue.mode === "lock";
      this.placeFake(name, queueSpawn, { tagged: !locked, unseen: locked, floating: locked });
      return;
    }
    this.placeFake(name, this.waitingSpawn(name));
  }

  /**
   * Locking players in can't stop them falling, so a locked queue spawn in the air gets a floor
   * while they wait there: a barrier in the block under it (only in place of air), taken away
   * once they leave the queue. Until its chunk loads, the pregame's check tries again.
   */
  private holdQueueFloor(): void {
    const spawn = this.map.queueSpawn;
    if (this.queueFloor || !this.queued || !spawn || this.map.queue.mode !== "lock") return;
    const at = worldPoint(spawn);
    const below = { x: Math.floor(at.x), y: Math.floor(at.y) - 1, z: Math.floor(at.z) };
    try {
      const block = world.getDimension("overworld").getBlock(below);
      if (block?.typeId !== "minecraft:air") return;
      block.setType(QUEUE_FLOOR);
      this.queueFloor = below;
    } catch (error) {
      log.warn(`could not put a floor under the queue spawn: ${describeError(error)}`);
    }
  }

  private releaseQueueFloor(): void {
    const at = this.queueFloor;
    this.queueFloor = undefined;
    if (!at) return;
    try {
      const block = world.getDimension("overworld").getBlock(at);
      if (block?.typeId === QUEUE_FLOOR) block.setType("minecraft:air");
    } catch (error) {
      log.warn(`could not take the queue spawn's floor away: ${describeError(error)}`);
    }
  }

  /** A spawn of the player's planned team when teams are dealt (and the map has team spawns), else a plain spawn of their own. */
  private waitingSpawn(name: string): MapPosition {
    const team = this.teamPlan?.get(name.toLowerCase());
    const teamSpawns = team !== undefined ? this.map.teamSpawns(team) : [];
    if (team !== undefined && teamSpawns.length > 0) {
      const members = [...this.teamPlan!].filter(([, id]) => id === team).map(([member]) => member);
      return teamSpawns[Math.max(0, members.indexOf(name.toLowerCase())) % teamSpawns.length];
    }
    const index = Math.max(0, this.online().indexOf(name));
    const spots = this.map.waitingSpots;
    return spots[index % Math.max(1, spots.length)] ?? [0, 65, 0];
  }

  /**
   * Deals out teams once everyone is in, by the lobby's picks (the rest at random), so players wait
   * at their own team's spawns while they pick kits and count down. Teams are only picked in the
   * lobby: a start from anywhere else deals them all at random.
   */
  private planTeams(): void {
    const teams = this.config.teams;
    if (!teams) return;
    const names = this.online().slice(0, this.config.maxPlayers);
    const picks = new Map<string, string>();
    for (const name of names) {
      const pick = this.teamPicks.get(name.toLowerCase());
      if (pick) picks.set(name, pick);
    }
    const limit = teamLimit(this.config, this.ctx.vars.settings);
    const plan = assignTeams(names, picks, teams, this.ctx.random, limit);
    this.teamPlan = new Map([...plan].map(([name, team]) => [name.toLowerCase(), team]));
    this.teams = activeTeams(names.length, teams, limit);
    if (!this.queued) {
      for (const player of world.getAllPlayers()) this.placeWaiting(player);
      for (const name of this.fakes?.all ?? []) this.placeWaitingFake(name);
    }
  }

  /** Back to waiting: teams are dealt again once everyone is in. */
  private unplanTeams(): void {
    this.teamPlan = undefined;
    this.teams = [];
  }

  /** A player's team before the match: the planned one. */
  private plannedTeam(name: string): TeamDef | undefined {
    const team = this.teamPlan?.get(name.toLowerCase());
    return this.teams.find((def) => def.id === team);
  }

  /**
   * The kit form for `names`: a live form each, kept open (it comes back when closed) until
   * everyone has picked or the time is up, when whoever hasn't gets the first kit. Before the match
   * (`pregame`), players wait frozen at their spawns (or in the queue), and it's false when players
   * drop below the minimum; the picks made so far are kept.
   */
  private async pickKits(names: string[], scope: Scope, pregame: boolean): Promise<boolean> {
    if (pregame) this.currentPhase = "picking";
    const picking = scope.child("kit-picks");
    if (pregame && !this.queued) this.freeze(names, picking);
    const teamOf = (name: string) => (pregame ? this.plannedTeam(name) : this.teamOf(name));
    this.closeKitForms(); // the star's: the picker brings up its own
    const forms = this.kitForms;
    const picker: KitPicker = new KitPicker(
      {
        show: (name, view) => {
          const player = this.player(name);
          if (!player) return;
          const open = forms.get(name);
          if (open?.showingTo(player)) return;
          open?.close();
          const form = new KitForm(player, this.kitFormContent(teamOf(name)?.color), view, (kitId) => picker.pick(name, kitId));
          forms.set(name, form);
          form.show();
        },
        update: (name, view) => forms.get(name)?.update(view),
        close: (name) => {
          forms.get(name)?.close();
          forms.delete(name);
        },
      },
      {
        players: names.filter((name) => !this.fakes?.has(name)),
        kits: this.kits,
        seconds: this.kits.pickSeconds,
        online: () => this.online(),
        display: (name) => nameOf(name, teamOf(name)?.color),
      },
    );
    this.kitPicker = picker;
    try {
      for (let waited = 0; ; waited += PICK_CHECK_TICKS) {
        if (this.outcome) return false;
        if (pregame && this.online().length < this.minPlayers) {
          this.broadcast(say.warn("Not enough players. Waiting again."));
          return false;
        }
        if (picker.finished) return true;
        await picking.wait(PICK_CHECK_TICKS);
        if ((waited + PICK_CHECK_TICKS) % 20 === 0) picker.tick();
      }
    } finally {
      picker.cancel();
      this.kitPicker = undefined;
      picking.dispose();
    }
  }

  /**
   * The star: brings up the player's kit form. While kits are being picked it's the picker's (back
   * at once if they closed it); otherwise a form of its own, with no status line, where a pick
   * changes their kit for the match.
   */
  private openKitForm(player: Player): void {
    const name = player.name;
    if (this.kitPicker?.reopen(name)) return;
    const open = this.kitForms.get(name);
    if (open?.showingTo(player)) return;
    open?.close();
    const view = (): KitPickView => {
      const kit = this.kits.chosenId(name);
      return { status: "", picks: kit === undefined ? {} : { [name]: kit } };
    };
    const form: KitForm = new KitForm(player, this.kitFormContent(this.plannedTeam(name)?.color), view(), (kitId) => {
      if (this.kits.choose(name, kitId)) form.update(view());
    });
    this.kitForms.set(name, form);
    form.show();
  }

  private closeKitForms(): void {
    for (const form of this.kitForms.values()) form.close();
    this.kitForms.clear();
  }

  /** The kit form's content for a player of this team color: each kit, with its picture, in the team's color. */
  private kitFormContent(teamColor: string | undefined): KitFormContent {
    const card = (kit: KitDef): KitCard => ({
      id: kit.id,
      name: kit.name,
      lines: kitLines(kit, teamColor),
      picture: `${kitPicturePath(kit.id, { map: this.kits.fromMap.has(kit.id) ? this.ctx.vars.map : undefined, teamColor, colored: teamColored(kit) })}.png`,
    });
    return { title: `${this.config.name}: pick a kit`, kits: this.kits.list.map(card), pack: this.kitPicturePack };
  }

  /**
   * Puts a fake player at a map position, with a body again if it had none, once its chunk is
   * ticking. Its name shows in its team's color unless `tagged` is false (a match without name
   * tags, a spectator), and its health as hearts with `hearts` (in play); `unseen` makes it
   * invisible (a locked queue), and `floating` keeps it in the air, passing through everything (a
   * spectator).
   */
  private placeFake(name: string, position: MapPosition, how: { faceCenter?: boolean; tagged?: boolean; hearts?: boolean; unseen?: boolean; floating?: boolean } = {}): void {
    const team = this.teamOf(name);
    const tag = how.tagged === false ? "" : team ? `${team.color}${name}` : name;
    void this.fakes?.place(name, worldPoint(position), tag, { floating: how.floating, hearts: how.hearts, teamColor: team?.color }).then((body) => {
      try {
        if (!body?.isValid) return;
        this.place(body, position, how.faceCenter);
        if (how.unseen) body.addEffect("invisibility", QUEUE_EFFECT_TICKS, { amplifier: 0, showParticles: false });
        else body.removeEffect("invisibility");
      } catch (error) {
        log.warn(`could not turn ${name}: ${describeError(error)}`);
      }
    });
  }

  /**
   * Teleports to a map position (the middle of its block, or the exact point), facing its saved
   * facing. Without one, spawns face the middle of the map at eye level, so nobody starts looking
   * at the sky or the floor; other places keep the player's own facing.
   */
  private place(entity: Entity, position: MapPosition, faceCenter = false): void {
    const location = worldPoint(position);
    const y = location.y;
    const facing = facingOf(position);
    if (facing) {
      entity.teleport(location, { rotation: { x: facing.pitch, y: facing.yaw } });
    } else if (faceCenter) {
      const [cx, , cz] = this.map.center();
      entity.teleport(location, { facingLocation: { x: cx + 0.5, y: y + 1.62, z: cz + 0.5 } });
    } else {
      entity.teleport(location);
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

  /** The queue's countdown, once everyone's in. False when players drop below the minimum. */
  private async queueCountdown(seconds: number): Promise<boolean> {
    for (let left = seconds; left > 0; left--) {
      if (this.outcome) return false;
      if (this.online().length < this.minPlayers) {
        this.broadcast(say.warn("Not enough players. Waiting again."));
        return false;
      }
      this.title(`${COLOR.highlight}${left}`, say.minor("Spawning in"));
      this.chime(countdownChime(left));
      await this.scope.wait(20);
    }
    return !this.outcome;
  }

  /** Frozen countdown. Returns false when players drop below the minimum. */
  private async countdown(): Promise<boolean> {
    this.currentPhase = "countdown";
    const scope = this.scope.child("countdown");
    this.countdownScope = scope;
    try {
      let left = this.config.countdownSeconds ?? 5;
      if (left > 0) this.freeze(this.online(), scope);
      while (left > 0) {
        if (this.outcome) return false;
        const online = this.online();
        if (online.length < this.minPlayers) {
          this.broadcast(say.warn("Not enough players. Waiting again."));
          return false;
        }
        this.title(`${COLOR.highlight}${left}`, say.minor(`${this.config.name} is starting`));
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

  /** Plays one best-of round: until the win check, endRound() or its clock decides it. */
  private async playRound(round: number, config: BestOfConfig): Promise<Result> {
    const result = await (this.playingScope ?? this.scope).guard(
      new Promise<Result>((resolve) => {
        this.contest = (decided) => {
          this.contest = undefined;
          resolve(decided);
        };
        this.contestSides = this.roster.standingSides().length;
        void this.stage(`Round ${round}`, { seconds: config.roundSeconds }).then(({ timedOut }) => {
          if (timedOut) this.contest?.(this.onRoundTimeUp(round));
        });
      }),
    );
    this.currentStage?.end();
    return result;
  }

  /** Before every round after the first: everyone back at their spawns, their kits (picked again, when they're picked every round), the countdown. */
  private async nextRound(round: number, config: BestOfConfig): Promise<void> {
    this.respawnAll("round");
    if (this.kits.select === "round" && this.kits.picking) {
      const names = this.roster.inState("alive").map((participant) => participant.name);
      const scope = (this.playingScope ?? this.scope).child("round-kits");
      this.freeze(names, scope);
      this.kits.clearChoices();
      await this.pickKits(names, scope, false);
      scope.dispose();
      for (const name of names) {
        const player = this.player(name);
        if (player && this.roster.get(name)?.state === "alive") this.kits.giveChosen(player, this.teamOf(name)?.color);
      }
    }
    await this.frozenCountdown(config.countdownSeconds ?? 3, `Round ${round}`);
  }

  /** A moment after a round is decided, everyone holding still, so its title can be read. */
  private async roundBreak(): Promise<void> {
    const scope = (this.playingScope ?? this.scope).child("round-break");
    this.freeze(this.roster.inState("alive").map((participant) => participant.name), scope);
    await scope.wait(ROUND_BREAK_TICKS);
    scope.dispose();
  }

  private announceRound(round: number, side: string | undefined, reason: string): void {
    if (side === undefined) {
      this.title(say.highlight(`Round ${round} is a draw`), say.minor(reason));
      this.broadcast(say.minor(`Round ${round} is a draw (${reason}).`));
      return;
    }
    this.title(`${this.sideName(side)} ${COLOR.highlight}wins round ${round}`, say.minor(reason));
    this.broadcast(`${say.important(`${this.sideName(side)} wins round ${round}!`)} ${say.minor(`(${reason})`)}`);
  }

  /** The clock over all best-of rounds, when the match has a time limit: when it runs out, onTimeUp decides. */
  private startMatchClock(): void {
    const limit = this.timeLimit;
    if (limit === undefined) return;
    this.matchSecondsLeft = limit;
    (this.playingScope ?? this.scope).interval(() => {
      if (this.matchSecondsLeft === undefined || this.outcome) return;
      this.matchSecondsLeft = Math.max(0, this.matchSecondsLeft - 1);
      if (this.matchSecondsLeft === 0) this.finish(this.onTimeUp());
    }, 20);
  }

  /** The sides of a best-of series: the teams in team games, else every player who joined. */
  private seriesSides(): string[] {
    if (this.teams.length > 0) return this.teams.map((team) => team.id);
    return this.roster.all().map((participant) => participant.name);
  }

  /**
   * The best-of rounds as HUD codes (empty outside best-of games): circles colored by winner, or each
   * side's wins. A game whose scoring shows "sides" puts each team's score there instead.
   */
  private roundsCodes(): string {
    if (this.config.scoring?.display === "sides") {
      if (this.teams.length === 0) return "";
      return bestOfCodes({ display: "score", sides: this.teams.map((team) => ({ color: team.color, wins: this.score.get(team.id) })) });
    }
    const series = this.series;
    const config = this.config.bestOf;
    if (!series || !config) return "";
    const sides = this.seriesSides();
    const colorOf = (side: string) => this.teams.find((team) => team.id === side)?.color ?? SIDE_COLORS[sides.indexOf(side) % SIDE_COLORS.length];
    if (bestOfDisplay(config, series, sides.length) === "icons") {
      return bestOfCodes({ display: "icons", rounds: series.rounds ?? series.round, winners: series.history.map((side) => (side === undefined ? undefined : colorOf(side))) });
    }
    return bestOfCodes({ display: "score", sides: sides.map((side) => ({ color: colorOf(side), wins: series.wins(side) })) });
  }

  /** Survival games: hunger stays full (saturation still runs down, so healing stays natural). */
  private feed(): void {
    for (const participant of this.roster.inState("alive")) {
      try {
        this.player(participant.name)?.getComponent(EntityComponentTypes.Hunger)?.resetToMaxValue();
      } catch {
        // left
      }
    }
  }

  /** Runs a game hook, logging (not throwing) what goes wrong. */
  private safely(hook: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      log.error(`${this.config.id}: ${hook} failed: ${describeError(error)}`);
    }
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
      // The teams dealt before the countdown stand (they count as picks), as far as each team's cap allows.
      const picks = new Map<string, string>();
      for (const name of names) {
        const pick = this.teamPlan?.get(name.toLowerCase()) ?? this.teamPicks.get(name.toLowerCase());
        if (pick) picks.set(name, pick);
      }
      const limit = teamLimit(this.config, this.ctx.vars.settings);
      assignment = assignTeams(names, picks, this.config.teams, this.ctx.random, limit);
      this.teams = activeTeams(names.length, this.config.teams, limit);
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
    if (this.gameMode === GameMode.Survival) playing.interval(() => this.feed(), FEED_TICKS);
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
      const body = this.body(participant.name);
      if (body && this.map.outOfBounds(body.location)) this.down(participant.name, "void");
    }
    // Spectators at the queue spawn are on foot: a fall or a walk out of bounds puts them back. Anyone
    // here who isn't playing counts (late joiners and extras watch too).
    if (this.map.watchesFromQueue) {
      for (const player of world.getAllPlayers()) {
        const state = this.roster.get(player.name)?.state;
        if ((state === undefined || state === "out" || state === "respawning") && this.map.outOfBounds(player.location)) this.place(player, this.map.spectatorSpawn);
      }
      for (const name of this.fakes?.all ?? []) {
        const state = this.roster.get(name)?.state;
        const body = this.fakes?.body(name);
        if ((state === "out" || state === "respawning") && body && !this.fakes?.isPlacing(name) && this.map.outOfBounds(body.location)) this.place(body, this.map.spectatorSpawn);
      }
      return;
    }
    // Spectators fly through walls: keep them over the map (kill regions and the gaps between
    // bounds boxes don't apply to them).
    for (const participant of this.roster.inState("out", "respawning")) {
      const player = this.player(participant.name);
      const bounds = this.map.bounds;
      if (player && bounds && this.map.outOfBounds({ ...player.location, y: Math.max(player.location.y, bounds.min[1]) }, { killRegions: false, enclosing: true })) {
        this.place(player, this.map.spectatorSpawn);
      }
    }
  }

  private refreshDisplays(): void {
    // A round's own clock, else the match's (a stage's, or the one over all best-of rounds).
    const secondsLeft = this.currentStage?.secondsLeft ?? this.matchSecondsLeft;
    const scoring = this.config.scoring;
    const own = scoring?.display === "own";
    const sides = scoring?.display === "sides";
    const rounds = this.roundsCodes();
    for (const player of world.getAllPlayers()) {
      const rest = this.hud(player.name) ?? "";
      const count = own ? this.ownScore(player.name) : undefined;
      // With no clock (and no rounds) there's no box to put the score beside: it goes on the action bar as text.
      const text =
        secondsLeft === undefined && count !== undefined && !rounds
          ? [say.info(`${scoring?.title ?? "Score"}: ${count}`), rest].filter(Boolean).join("   ")
          : hudLine(secondsLeft, rest, count, rounds);
      if (text) player.onScreenDisplay.setActionBar(text);
    }
    this.respawnTitles();
    // "own" and "sides" show the scores in the HUD's boxes, not on the sidebar.
    const board = scoring && !own && !sides ? this.score : undefined;
    if (!board) return;
    if (!this.sidebar) {
      this.sidebar = new Sidebar(this.playingScope ?? this.scope, `${this.ctx.vars.sessionId}`.slice(0, 12), this.config.scoring?.title ?? "Score");
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
    // Best-of rounds: a win check decides the round being played. Between rounds there's nothing to
    // decide (the series ends the match), even with a team still out from the last round.
    if (this.series && !this.contest) return;
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

  // ---- Previews: fake players and /exit (preview.ts) ---------------------------------------

  /** /fake: adds fake players, who wait with everyone or join a running match as late joiners. Returns what happened. */
  addFakes(count: number): string {
    const fakes = this.fakes;
    if (!fakes) return say.minor("Fake players are only for previews.");
    if (this.currentPhase === "ending" || this.currentPhase === "done") return say.minor("The match is over.");
    const playing = this.currentPhase === "playing";
    if (playing && (this.config.lateJoin ?? "spectate") !== "join") {
      return say.minor(`${this.config.name} lets nobody in once it has started: add fake players before the countdown ends.`);
    }
    const added: string[] = [];
    while (added.length < count && this.online().length < this.config.maxPlayers) {
      const name = fakes.add();
      added.push(name);
      if (!playing) {
        this.placeWaitingFake(name);
        continue;
      }
      const joined = this.roster.add(name, this.config.respawn?.lives ?? 1, this.smallestTeam());
      this.stats.join(name, system.currentTick, joined.team);
      if (this.config.scoring?.per === "player" && !this.score.entries().some(([id]) => id === name)) this.score.set(name, 0);
      this.spawn(name, "join");
    }
    if (added.length === 0) return say.minor(`${this.config.name} is full: ${this.config.maxPlayers} players.`);
    return say.info(`Added ${added.join(", ")}. Right click one for its panel.`);
  }

  /**
   * A fake player kills `victim`, a real player who asked (its panel's red button): they go
   * down, credited to the fake when it's their enemy in the match. Returns why not, if it can't.
   */
  fakeKills(name: string, victim: string): string | undefined {
    if (this.currentPhase !== "playing") return say.minor("The match hasn't started.");
    if (this.roster.get(name)?.state !== "alive") return say.minor(`${name} isn't in play right now.`);
    if (this.roster.get(victim)?.state !== "alive") return say.minor("You aren't in play right now.");
    if (!this.areTeammates(name, victim)) this.credit.hit(victim, name, system.currentTick);
    this.down(victim, "entityAttack");
    return undefined;
  }

  /**
   * A fake player wins the best-of round being played, for its team in team games (a map editor
   * asked: right click, then pick it). Returns why not, if it can't.
   */
  fakeWinsRound(name: string): string | undefined {
    const side = this.roundSideOf(name);
    if (side === undefined) return say.minor("There's no round being played.");
    this.endRound(this.sideWins(side, `${name} took it in the preview`));
    return undefined;
  }

  /** The side a fake player would win the round being played for: its team in team games, else itself. */
  private roundSideOf(name: string): string | undefined {
    const participant = this.roster.get(name);
    if (!this.config.bestOf || !this.roundInPlay || this.currentPhase !== "playing" || !participant || participant.state === "left") return undefined;
    return this.teams.length > 0 ? participant.team : name;
  }

  /**
   * /switch: the player and a fake player trade places in the match: where they stand and look,
   * their teams, lives and health. The player's kit items in their team's color take their new
   * team's. `number` picks Fake <number>; without it, the fake they look at, else the nearest one in
   * play. Returns what happened.
   */
  switchWithFake(player: Player, number?: number): string {
    const fakes = this.fakes;
    if (!fakes) return say.minor("Fake players are only for previews.");
    if (this.currentPhase !== "playing") return say.minor("Switch once the match has started.");
    const me = this.roster.get(player.name);
    if (!me || me.state === "left" || me.state === "out") return say.minor("You aren't playing in this match.");
    if (me.state !== "alive") return say.minor("You're down: switch once you're back in play.");
    const name = number !== undefined ? `Fake ${Math.trunc(number)}` : (this.fakeInView(player) ?? this.nearestFake(player));
    if (name === undefined) return say.minor("There are no fake players in play.");
    if (!fakes.has(name)) return say.minor(`There's no ${name}.`);
    const fake = this.roster.get(name);
    const body = fakes.body(name);
    if (fake?.state !== "alive" || !body) return say.minor(`${name} isn't in play right now.`);
    try {
      const mine = { at: player.location, rotation: player.getRotation(), health: healthOf(player) };
      const theirs = { at: body.location, rotation: body.getRotation(), health: healthOf(body) };
      player.teleport(theirs.at, { rotation: theirs.rotation });
      body.teleport(mine.at, { rotation: { x: 0, y: mine.rotation.y } });
      setHealth(player, theirs.health);
      setHealth(body, mine.health);
    } catch (error) {
      log.warn(`could not switch ${player.name} with ${name}: ${describeError(error)}`);
      return say.minor("That didn't work: try again.");
    }
    [me.lives, fake.lives] = [fake.lives, me.lives];
    this.credit.clear(player.name);
    this.credit.clear(name);
    if (me.team === fake.team) return say.info(`You traded places with ${name}.`);
    const before = this.teamOf(player.name);
    [me.team, fake.team] = [fake.team, me.team];
    const team = this.teamOf(player.name);
    this.kits.recolor(player, before?.color, team?.color);
    const tagged = this.config.nameTags === true;
    player.nameTag = !tagged ? "" : team ? `${team.color}${player.name}` : player.name;
    fakes.retag(name, !tagged ? "" : before ? `${before.color}${name}` : name, before?.color);
    this.queueWinCheck();
    return say.info(`You traded places with ${name}: you're on ${team?.name ?? "its team"} now.`);
  }

  /** The fake player in play a player looks at, if any (up to 64 blocks away). */
  private fakeInView(player: Player): string | undefined {
    try {
      for (const { entity } of player.getEntitiesFromViewDirection({ maxDistance: 64 })) {
        const name = entity.typeId === FAKE_PLAYER ? this.whoIs(entity) : undefined;
        if (name !== undefined && this.roster.get(name)?.state === "alive") return name;
      }
    } catch {
      // nothing in view
    }
    return undefined;
  }

  /** The nearest fake player in play. */
  private nearestFake(player: Player): string | undefined {
    let nearest: { name: string; distance: number } | undefined;
    for (const name of this.fakes?.all ?? []) {
      const body = this.fakes?.body(name);
      if (!body || this.roster.get(name)?.state !== "alive") continue;
      const { x, y, z } = body.location;
      const distance = Math.hypot(x - player.location.x, y - player.location.y, z - player.location.z);
      if (!nearest || distance < nearest.distance) nearest = { name, distance };
    }
    return nearest?.name;
  }

  /** /exit: a map editor ends the preview for everyone (back to Edit); anyone else leaves alone. */
  exitPreview(player: Player): void {
    if (!player.isValid) return;
    const editor = this.ctx.vars.lanPlayers.some((name) => name.toLowerCase() === player.name.toLowerCase());
    if (editor && this.currentPhase !== "ending" && this.currentPhase !== "done") {
      this.broadcast(say.info(`${player.name} ended the preview.`));
      this.abort("aborted");
      return;
    }
    this.ctx.transfer.transfer(player, homePort(this.ctx.vars, player.name));
  }

  /**
   * /skip: a map editor moves a preview on without waiting: the stage under way ends now (a round's
   * clock, a vote, a break between rounds), or before the countdown, the game's own step does
   * (skipPicking: Build Swap's prompts). Returns what to tell them, if anything.
   */
  skipPreview(player: Player): string | undefined {
    if (!this.ctx.vars.lanPlayers.some((name) => name.toLowerCase() === player.name.toLowerCase())) return say.warn("Only a map editor can skip.");
    if (this.currentPhase === "picking" && this.skipPicking?.()) {
      this.broadcast(say.info(`${player.name} skipped ahead.`));
      return undefined;
    }
    const stage = this.currentStage;
    if (this.currentPhase !== "playing" || !stage) return say.minor("There's nothing to skip right now: try again once the match is under way.");
    this.broadcast(say.info(`${player.name} skipped ${stage.name}.`));
    stage.end();
    return undefined;
  }

  /** /restart: a map editor ends the preview for everyone, who all play it again (as if they all picked Replay). */
  restartPreview(player: Player): void {
    if (!player.isValid) return;
    if (!this.ctx.vars.lanPlayers.some((name) => name.toLowerCase() === player.name.toLowerCase())) {
      player.sendMessage(say.warn("Only a map editor can restart the preview."));
      return;
    }
    if (this.currentPhase === "ending" || this.currentPhase === "done") {
      player.sendMessage(say.info("The match is over: pick Replay to play it again."));
      return;
    }
    this.restartAsked = true;
    this.broadcast(say.info(`${player.name} restarted the preview.`));
    this.abort("aborted");
  }

  /** Right clicking a fake player opens its side panel (fake-panel.ts). Its hearts follow its health. */
  private watchFakes(fakes: FakePlayers): void {
    this.scope.add(() => fakes.clear());
    this.scope.subscribe(world.afterEvents.playerInteractWithEntity, ({ player, target }) => {
      const name = this.whoIs(target);
      if (name !== undefined && fakes.has(name)) void this.fakePanel(player, name, fakes);
    });
    this.scope.subscribe(world.afterEvents.entityHurt, ({ hurtEntity }) => {
      if (hurtEntity.typeId === FAKE_PLAYER) fakes.showHealth(hurtEntity);
    });
  }

  /** A fake player's side panel: "wins the round" or "kills you", or Cancel. */
  private async fakePanel(player: Player, name: string, fakes: FakePlayers): Promise<void> {
    const key = player.name.toLowerCase();
    if (this.panelOpen.has(key)) return;
    this.panelOpen.add(key);
    try {
      const side = this.roundSideOf(name);
      const entries = fakePanelEntries({ name, ...(side !== undefined ? { round: { team: this.teams.find((def) => def.id === side)?.name } } : {}) });
      const form = new ActionFormData().title(`${SIDE_TITLE}${name}`);
      for (const entry of entries) form.button(entry.text);
      const answer = await showForm(this.scope, player, form);
      const action = answer?.selection === undefined ? undefined : entries[answer.selection]?.action;
      if (!action || action.kind === "cancel" || !fakes.has(name)) return;
      const why = action.kind === "win" ? this.fakeWinsRound(name) : this.fakeKills(name, player.name);
      if (why && player.isValid) player.sendMessage(why);
    } finally {
      this.panelOpen.delete(key);
    }
  }

  // ---- Small helpers ----------------------------------------------------------------------

  private buildHost(): BuildHost {
    const game = this;
    return {
      get playing() {
        return game.currentPhase === "playing";
      },
      canBuild: (name) => this.roster.get(name)?.state === "alive",
      noBuild: () => this.noBuildBoxes(),
    };
  }

  private combatHost(): CombatHost {
    const game = this;
    return {
      get playing() {
        return game.currentPhase === "playing";
      },
      nameOf: (entity) => this.whoIs(entity),
      canFight: (name) => this.roster.get(name)?.state === "alive",
      isProtected: (name) => this.isProtected(name),
      areAllies: (a, b) => this.areTeammates(a, b) && !this.config.teams?.friendlyFire,
      onDamage: (hit) => this.onDamage(hit),
      down: (name, cause) => this.down(name, cause),
    };
  }

  private areTeammates(a: string, b: string): boolean {
    const teamA = this.roster.get(a)?.team;
    return teamA !== undefined && teamA === this.roster.get(b)?.team;
  }

  /**
   * A respawning player's countdown, like the start's: the seconds left as a title over
   * "Respawning in". Each one stays until the next, and the last is gone as they respawn.
   */
  private respawnTitles(): void {
    for (const participant of this.roster.inState("respawning")) {
      const key = participant.name.toLowerCase();
      const at = this.respawnAt.get(key);
      if (at === undefined) continue; // waiting for the next stage
      const left = at - system.currentTick;
      const seconds = Math.max(1, Math.ceil(left / 20));
      if (this.respawnShown.get(key) === seconds) continue;
      this.respawnShown.set(key, seconds);
      this.title(`${COLOR.highlight}${seconds}`, say.minor("Respawning in"), participant.name, Math.min(30, Math.max(0, left - TITLE_FADE_TICKS)));
    }
  }

  /** The score a player sees as their own (their team's in team games); undefined for anyone not playing. */
  private ownScore(name: string): number | undefined {
    return this.roster.get(name) ? this.score.get(this.sideOf(name)) : undefined;
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

/** An entity's health now (a player's, or a fake player's body). */
function healthOf(entity: Entity): number {
  return entity.getComponent(EntityComponentTypes.Health)?.currentValue ?? 20;
}

function setHealth(entity: Entity, value: number): void {
  entity.getComponent(EntityComponentTypes.Health)?.setCurrentValue(Math.max(1, value));
}

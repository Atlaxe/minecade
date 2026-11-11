// Build Swap on the minigame framework and the building games' base (minigame-core's building kit:
// the prompt form, the copies of the map's arena, the building rules and tools, and voting). Core
// runs the waiting, the clock top right (each round's own), the result and the stats. This class
// adds the two building rounds (your own prompt in your own build area, then a twist on someone
// else's build), and voting on every build, first as it was before its twist and then with it, its
// prompt (and then its twist) top left. Builders stay anonymous until the end: the standings in chat,
// and each player's own points for their prompt and their twist, to them alone.
import { COLOR, Notes, say, type PromptKind, type Result } from "@minecade/minigame-core";
import { BuildingGame, keyOf, pointsText, shuffled, type PromptField, type Plot } from "@minecade/minigame-core/building";
import type config from "../../game.config.ts";

/** One build area in play: its first builder and prompt, and who added which twist. */
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
  points: number;
}

const FIELDS: readonly PromptField[] = [
  { kind: "starter", label: "Build prompt", description: "Something to build: a pirate ship" },
  { kind: "twist", label: "Twist prompt", description: "Something to add or change: it's on fire" },
];

/**
 * The twist round's swap: who builds on whose build. Everyone in `builders` moves to another's
 * area, in one shuffled loop, so nobody keeps their own (unless they're the only one). Twist
 * builder to the area's first builder.
 */
export function swapPlots(builders: readonly string[], random: () => number): Map<string, string> {
  const order = shuffled(builders, random);
  return new Map(order.map((name, i) => [name, order[(i + 1) % order.length]]));
}

export class BuildSwap extends BuildingGame<typeof config> {
  /** Every build, by its first builder's lowercase name. */
  private readonly builds = new Map<string, Build>();
  /** The build part being voted on. */
  private votingOn: { build: Build; kind: PromptKind; builder: string } | undefined;
  private readonly scored: Scored[] = [];

  protected override promptFields(): readonly PromptField[] {
    return FIELDS;
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

  /** The vote under way: which part of which build, and who built that part. */
  get voting(): { build: Build; kind: PromptKind; builder: string } | undefined {
    return this.ballot ? this.votingOn : undefined;
  }

  protected override async play(): Promise<Result | void> {
    await this.prepare();
    if (this.plots.length < this.startedWith) this.broadcast(say.warn(`This map's arena fits ${this.plots.length} copies for ${this.startedWith} players: some share one.`));
    const builders = this.here();
    const starters = this.deal("starter", builders);
    for (const name of builders) {
      const plot = this.ownPlot(name);
      if (plot) this.builds.set(keyOf(name), { plot, builder: name, starter: starters.get(name)! });
    }
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
      build.twist = twists.get(twister)!;
    }
    await this.round("twist", this.config.twistMinutes * 60);
    for (const build of this.builds.values()) this.snapshots.save(`p${build.plot.index}_final`, build.plot.box);

    await this.voteAll();
    return this.decide(
      (name) => this.ownParts(name),
      (winner) => {
        const plot = this.builds.get(keyOf(winner))?.plot;
        if (plot) for (const name of this.online()) this.goTo(name, plot);
      },
    );
  }

  /** A building round: the first builders on their own prompts, or the twisters on someone else's build. */
  private async round(kind: PromptKind, seconds: number): Promise<void> {
    const jobs = [...this.builds.values()].flatMap((build) => {
      const worker = kind === "starter" ? build.builder : build.twister;
      if (worker === undefined) return [];
      return kind === "starter"
        ? [{ name: worker, plot: build.plot, line: `${COLOR.minor}Build: §f${build.starter}`, title: [say.highlight("Your prompt"), `§f${build.starter}`] as [string, string] }]
        : [
            {
              name: worker,
              plot: build.plot,
              line: `${COLOR.minor}Twist: §f${build.twist}${COLOR.minor} on §f${build.starter}`,
              title: [say.highlight("Your twist"), `§f${build.twist}`] as [string, string],
              message: `${say.info("Twist:")} §f${build.twist}${say.minor(" on this build:")} §f${build.starter}`,
            },
          ];
    });
    const stages = kind === "starter" ? { prep: "Get ready", build: "Build" } : { prep: "Get ready for the twist", build: "Twist" };
    await this.buildRound(jobs, seconds, stages, kind === "twist" ? say.info("Swap! Add your twist to this build. You can change anything in its area.") : undefined);
  }

  // ---- Voting -------------------------------------------------------------------------------

  /** Every build in turn, in a random order: as it was before its twist, then with it, its prompt (and its twist) top left. */
  private async voteAll(): Promise<void> {
    this.lines.clear();
    const notesScope = this.scope.child("notes");
    const notes = new Notes(notesScope);
    for (const name of this.online()) this.clearInventory(name);
    const order = shuffled(
      [...this.builds.values()].filter((build) => this.present(build.builder) || this.present(build.twister)),
      this.ctx.random,
    );
    for (const [i, build] of order.entries()) {
      this.gather(build.plot);
      this.snapshots.restore(`p${build.plot.index}_starter`, build.plot.box);
      const prompt = `${COLOR.minor}Prompt: §f${build.starter}`;
      notes.show([prompt]);
      this.title(say.highlight(`Build ${i + 1} of ${order.length}`), `§f${build.starter}`, undefined, 60);
      await this.votePart(build, "starter");
      if (build.twister !== undefined) {
        this.snapshots.restore(`p${build.plot.index}_final`, build.plot.box);
        notes.show([prompt, `${COLOR.minor}Twist: §f${build.twist}`]);
        this.title(say.highlight("The twist"), `§f${build.twist}`, undefined, 60);
        await this.votePart(build, "twist");
      }
    }
    notesScope.dispose();
    this.releaseAll();
  }

  /** A vote on one part of a build, its points to whoever built that part. */
  private async votePart(build: Build, kind: PromptKind): Promise<void> {
    const builder = kind === "starter" ? build.builder : build.twister!;
    this.votingOn = { build, kind, builder };
    const points = await this.voteOn(builder);
    this.votingOn = undefined;
    if (points !== undefined) this.scored.push({ build, kind, points });
  }

  // ---- The end ------------------------------------------------------------------------------

  /** What `name` built (their prompt, then their twist on another's build) and what each part earned. */
  ownParts(name: string): string[] {
    const lines: string[] = [];
    const earned = (build: Build, kind: PromptKind) => {
      const part = this.scored.find((entry) => entry.build === build && entry.kind === kind);
      return part ? say.highlight(pointsText(part.points)) : say.minor("not voted on");
    };
    const own = this.builds.get(keyOf(name));
    if (own) lines.push(`${COLOR.minor}Your prompt §f${own.starter}${COLOR.minor}: ${earned(own, "starter")}`);
    const twisted = [...this.builds.values()].find((build) => build.twister !== undefined && keyOf(build.twister) === keyOf(name));
    if (twisted) lines.push(`${COLOR.minor}Your twist §f${twisted.twist}${COLOR.minor} on §f${twisted.starter}${COLOR.minor}: ${earned(twisted, "twist")}`);
    return lines;
  }
}

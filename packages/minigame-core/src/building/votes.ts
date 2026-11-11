// The building games' voting (Build Swap, Guess the Build), as plain logic: the vote blocks, who
// votes on a build, their votes (which they can change until the build is over), and the points it
// earns its builder. The game shows the builds and hands out the blocks.

/** The vote blocks, hotbar slots 1 to 5: terracotta named for its points, in its own color. */
export const VOTES = [
  { item: "minecraft:red_terracotta", name: "§c1", points: 1 },
  { item: "minecraft:orange_terracotta", name: "§62", points: 2 },
  { item: "minecraft:yellow_terracotta", name: "§e3", points: 3 },
  { item: "minecraft:lime_terracotta", name: "§a4", points: 4 },
  { item: "minecraft:green_terracotta", name: "§25", points: 5 },
] as const;

/** The points a vote block is worth, or undefined for anything else. */
export function votePoints(typeId: string | undefined): number | undefined {
  return VOTES.find((vote) => vote.item === typeId)?.points;
}

/** A vote's points as the vote block shows them, in its color. */
export function voteText(points: number): string {
  return VOTES.find((vote) => vote.points === points)?.name ?? String(points);
}

/** One build being voted on: its builder doesn't vote, everyone else here does. */
export class Ballot {
  readonly builder: string;
  private readonly voters: Set<string>;
  private readonly votes = new Map<string, number>();

  constructor(builder: string, voters: readonly string[]) {
    this.builder = builder;
    this.voters = new Set(voters.map((name) => name.toLowerCase()).filter((name) => name !== builder.toLowerCase()));
  }

  /** Whether `name` votes on this build. */
  isVoter(name: string): boolean {
    return this.voters.has(name.toLowerCase());
  }

  /** Records (or changes) a vote. False when `name` doesn't vote here or the points aren't a vote. */
  vote(name: string, points: number): boolean {
    const key = name.toLowerCase();
    if (!this.voters.has(key) || !Number.isInteger(points) || points < 1 || points > VOTES.length) return false;
    this.votes.set(key, points);
    return true;
  }

  voteOf(name: string): number | undefined {
    return this.votes.get(name.toLowerCase());
  }

  /** A voter left: they no longer hold it up, and their vote doesn't count. */
  remove(name: string): void {
    const key = name.toLowerCase();
    this.voters.delete(key);
    this.votes.delete(key);
  }

  get needed(): number {
    return this.voters.size;
  }

  get counted(): number {
    return this.votes.size;
  }

  /** Every voter has voted (true at once with no voters). */
  get done(): boolean {
    return this.votes.size >= this.voters.size;
  }

  /** The points the build earned: every vote added up. */
  get total(): number {
    let sum = 0;
    for (const points of this.votes.values()) sum += points;
    return sum;
  }
}

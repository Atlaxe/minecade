// Who is in the match and how they're doing. Keyed by lowercase gamertag: a rejoining player is
// a new Player object, and the protocol and EXPECTED_PLAYERS speak in names.

export type ParticipantState = "alive" | "respawning" | "out" | "left";

export interface Participant {
  name: string;
  team?: string;
  lives: number;
  kit?: string;
  state: ParticipantState;
}

export class Roster {
  private readonly players = new Map<string, Participant>();

  add(name: string, lives: number, team?: string): Participant {
    const existing = this.get(name);
    if (existing) return existing;
    const participant: Participant = { name, lives, team, state: "alive" };
    this.players.set(name.toLowerCase(), participant);
    return participant;
  }

  get(name: string): Participant | undefined {
    return this.players.get(name.toLowerCase());
  }

  all(): Participant[] {
    return [...this.players.values()];
  }

  inState(...states: ParticipantState[]): Participant[] {
    return this.all().filter((participant) => states.includes(participant.state));
  }

  teamMembers(team: string): Participant[] {
    return this.all().filter((participant) => participant.team === team);
  }

  /** Players (or teams, in team games) still in the running: alive or waiting to respawn. */
  standingSides(): string[] {
    const standing = this.inState("alive", "respawning");
    const sides = standing.map((participant) => participant.team ?? participant.name);
    return [...new Set(sides)];
  }
}

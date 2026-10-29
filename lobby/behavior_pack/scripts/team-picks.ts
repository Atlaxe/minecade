// Who picked which team, as plain data, by the game's own rules: the teams a match with this many
// players uses (activeTeams) and the same cap per team (ceil(players / teams)) that assignTeams
// honors on the game server. Nobody has to pick; players without a pick are dealt out randomly.
import { activeTeams, type TeamDef, type TeamsConfig } from "@minecade/minigame-core";

export interface TeamSlot {
  id: string;
  name: string;
  /** A § color code. */
  color: string;
  members: string[];
  cap: number;
  full: boolean;
}

export interface TeamPicksView {
  teams: TeamSlot[];
  /** Players without a pick (they get a random team). */
  unpicked: string[];
}

export class TeamPicks {
  readonly teams: TeamDef[];
  private players: string[];
  private readonly chosen = new Map<string, string>();

  constructor(players: string[], cfg: TeamsConfig) {
    this.players = [...players];
    this.teams = activeTeams(players.length, cfg);
  }

  /** How many players a team may hold; it shrinks when players leave, as it would on the game server. */
  get cap(): number {
    return Math.max(1, Math.ceil(this.players.length / this.teams.length));
  }

  /** Joins a team, or goes back to random with `team` undefined. False if the team is full or unknown. */
  pick(name: string, team: string | undefined): boolean {
    if (!this.players.includes(name)) return false;
    if (team === undefined) {
      this.chosen.delete(name);
      return true;
    }
    if (!this.teams.some((candidate) => candidate.id === team)) return false;
    if (this.chosen.get(name) === team) return true;
    if (this.members(team).length >= this.cap) return false;
    this.chosen.set(name, team);
    return true;
  }

  /** A player left: their pick goes, and the caps follow the smaller player count. */
  remove(name: string): void {
    this.chosen.delete(name);
    this.players = this.players.filter((player) => player !== name);
  }

  teamOf(name: string): string | undefined {
    return this.chosen.get(name);
  }

  /** True once everyone in the match who is still here has picked. */
  allPicked(online: readonly string[]): boolean {
    const here = new Set(online);
    return this.players.filter((name) => here.has(name)).every((name) => this.chosen.has(name));
  }

  /** Player name to team id, for the game server. */
  picks(): Record<string, string> {
    return Object.fromEntries(this.chosen);
  }

  view(): TeamPicksView {
    const cap = this.cap;
    return {
      teams: this.teams.map((team) => {
        const members = this.members(team.id);
        return { id: team.id, name: team.name, color: team.color, members, cap, full: members.length >= cap };
      }),
      unpicked: this.players.filter((name) => !this.chosen.has(name)),
    };
  }

  private members(team: string): string[] {
    return this.players.filter((name) => this.chosen.get(name) === team);
  }
}

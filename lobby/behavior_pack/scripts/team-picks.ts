// Who picked which team, as plain data, by the game's own rules: the teams a match with this many
// players uses (activeTeams) and the same cap per team (ceil(players / teams)) that assignTeams
// honors on the game server. Nobody has to pick; players without a pick are dealt out randomly.
// In a role game (a team of a fixed size, such as Chameleon's one seeker) only the fixed-size roles
// can be picked, each up to its size, and everyone else is dealt: picking is done once they're full.
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

  /** `limit`: the most teams the game screen's setting allows (teamLimit), for games with one. */
  constructor(players: string[], cfg: TeamsConfig, limit?: number) {
    this.players = [...players];
    const teams = activeTeams(players.length, cfg, limit);
    this.roles = teams.some((team) => team.size !== undefined);
    this.teams = this.roles ? teams.filter((team) => typeof team.size === "number") : teams;
  }

  /** Whether only fixed-size roles are picked (a role game). */
  readonly roles: boolean;

  /** How many players a team may hold; it shrinks when players leave, as it would on the game server. */
  get cap(): number {
    return Math.max(1, Math.ceil(this.players.length / this.teams.length));
  }

  /** A team's room: a role's size, else the even cap. */
  private capOf(team: TeamDef): number {
    return this.roles && typeof team.size === "number" ? team.size : this.cap;
  }

  /** Joins a team, or goes back to random with `team` undefined. False if the team is full or unknown. */
  pick(name: string, team: string | undefined): boolean {
    if (!this.players.includes(name)) return false;
    if (team === undefined) {
      this.chosen.delete(name);
      return true;
    }
    const def = this.teams.find((candidate) => candidate.id === team);
    if (!def) return false;
    if (this.chosen.get(name) === team) return true;
    if (this.members(team).length >= this.capOf(def)) return false;
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

  /** True once everyone in the match who is still here has picked (in a role game, once every role is full). */
  allPicked(online: readonly string[]): boolean {
    if (this.roles) return this.teams.every((team) => this.members(team.id).length >= this.capOf(team));
    const here = new Set(online);
    return this.players.filter((name) => here.has(name)).every((name) => this.chosen.has(name));
  }

  /** Player name to team id, for the game server. */
  picks(): Record<string, string> {
    return Object.fromEntries(this.chosen);
  }

  view(): TeamPicksView {
    return {
      teams: this.teams.map((team) => {
        const members = this.members(team.id);
        const cap = this.capOf(team);
        return { id: team.id, name: team.name, color: team.color, members, cap, full: members.length >= cap };
      }),
      unpicked: this.players.filter((name) => !this.chosen.has(name)),
    };
  }

  private members(team: string): string[] {
    return this.players.filter((name) => this.chosen.get(name) === team);
  }
}

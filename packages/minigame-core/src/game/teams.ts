// Team assignment, as pure functions. Players may pick a team; everyone else is shuffled and
// dealt to the smallest team, so teams stay balanced and the fill is random.
import type { GameConfig, TeamDef, TeamsConfig } from "../config.ts";

export const DEFAULT_TEAMS: TeamDef[] = [
  { id: "red", name: "Red", color: "§c" },
  { id: "blue", name: "Blue", color: "§9" },
  { id: "green", name: "Green", color: "§a" },
  { id: "yellow", name: "Yellow", color: "§e" },
];

/** Role teams (a fixed-size team such as one seeker) use every def; otherwise the count decides. */
function isRoleSetup(defs: TeamDef[]): boolean {
  return defs.some((team) => team.size !== undefined);
}

/**
 * The most teams the lobby's setting allows, for a game whose teams name one (TeamsConfig.option):
 * the picked value, else the setting's first (its default). Undefined for other games.
 */
export function teamLimit(config: Pick<GameConfig, "teams" | "options">, settings?: Readonly<Record<string, string>>): number | undefined {
  const id = config.teams?.option;
  if (id === undefined) return undefined;
  const picked = Number(settings?.[id] ?? config.options?.find((option) => option.id === id)?.values[0]?.value);
  return Number.isInteger(picked) && picked > 0 ? picked : undefined;
}

/** The teams a match with `players` players uses, at most `limit` of them (teamLimit). */
export function activeTeams(players: number, cfg: TeamsConfig, limit?: number): TeamDef[] {
  const defs = cfg.defs ?? DEFAULT_TEAMS;
  if (isRoleSetup(defs)) return defs;
  let count: number;
  if (typeof cfg.count === "number") {
    count = Math.min(cfg.count, limit ?? cfg.count);
  } else {
    const [min, max] = cfg.count;
    count = Math.max(min, Math.min(max, limit ?? max, Math.floor(players / Math.max(1, cfg.minPerTeam ?? 1))));
  }
  return defs.slice(0, Math.max(1, Math.min(count, defs.length)));
}

/** Every team a match could use: all defs for role teams, else as many as the largest count. */
export function possibleTeams(cfg: TeamsConfig): TeamDef[] {
  const defs = cfg.defs ?? DEFAULT_TEAMS;
  if (isRoleSetup(defs)) return defs;
  const count = typeof cfg.count === "number" ? cfg.count : cfg.count[1];
  return defs.slice(0, Math.max(1, Math.min(count, defs.length)));
}

/** A button on the lobby's team form: Join, the player's own team (or Random, while they have no pick), or full. */
export type TeamButtonState = "join" | "on" | "full";

/** The lobby pack's pictures of the team form's buttons (the build draws them: tools/build/team-buttons.ts). */
export const TEAM_BUTTONS = "textures/minecade/team_buttons";

/** A team form button's picture in the lobby pack, by its team's color and name; no team is Random team. */
export function teamButtonPath(team: { name: string; color: string } | undefined, state: TeamButtonState): string {
  if (!team) return `${TEAM_BUTTONS}/random_${state}`;
  const color = team.color.replace("§", "").toLowerCase();
  const name = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${TEAM_BUTTONS}/${color}_${name}_${state}`;
}

/** Returns player -> team id for every player, on at most `limit` teams (teamLimit). */
export function assignTeams(
  players: string[],
  picks: ReadonlyMap<string, string>,
  cfg: TeamsConfig,
  random: () => number,
  limit?: number,
): Map<string, string> {
  const teams = activeTeams(players.length, cfg, limit);
  const roles = isRoleSetup(teams);
  const even = Math.ceil(players.length / teams.length);
  // In a role setup the "rest" teams share what the fixed sizes leave, so picks can't empty a role.
  const fixedTotal = teams.reduce((sum, team) => sum + (typeof team.size === "number" ? team.size : 0), 0);
  const restCount = teams.filter((team) => typeof team.size !== "number").length;
  const restRoom = Math.ceil(Math.max(0, players.length - fixedTotal) / Math.max(1, restCount));
  const capacity = new Map<string, number>();
  for (const team of teams) {
    if (!roles) capacity.set(team.id, even);
    else capacity.set(team.id, typeof team.size === "number" ? team.size : restRoom);
  }
  const counts = new Map(teams.map((team) => [team.id, 0]));
  const assigned = new Map<string, string>();
  const place = (player: string, team: string) => {
    assigned.set(player, team);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  };

  // Picks first, in player order, while the team has room.
  for (const player of players) {
    const pick = picks.get(player);
    if (pick !== undefined && counts.has(pick) && counts.get(pick)! < capacity.get(pick)!) place(player, pick);
  }

  const rest = shuffle(
    players.filter((player) => !assigned.has(player)),
    random,
  );
  // Fixed-size role teams fill first (one seeker), then the smallest open team takes each player.
  const fixed = teams.filter((team) => typeof team.size === "number");
  for (const player of rest) {
    const needy = fixed.find((team) => counts.get(team.id)! < capacity.get(team.id)!);
    if (needy) {
      place(player, needy.id);
      continue;
    }
    const open = teams.filter((team) => typeof team.size !== "number" && counts.get(team.id)! < capacity.get(team.id)!);
    const pool = open.length > 0 ? open : teams;
    const fewest = Math.min(...pool.map((team) => counts.get(team.id)!));
    const smallest = pool.filter((team) => counts.get(team.id) === fewest);
    place(player, smallest[Math.floor(random() * smallest.length)].id);
  }
  return assigned;
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

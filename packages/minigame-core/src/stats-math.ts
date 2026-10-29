// Derived stats, shared by the lobby, the panel and the stats store so they always agree.

/** Kills per death, to 2 decimals. With no deaths it is the kill count. */
export function killDeathRatio(kills: number, deaths: number): number {
  return Math.round((deaths === 0 ? kills : kills / deaths) * 100) / 100;
}

/** Wins as a percentage of games (draws count as games), to 1 decimal. 0 with no games. */
export function winRate(wins: number, games: number): number {
  return games === 0 ? 0 : Math.round((wins / games) * 1000) / 10;
}

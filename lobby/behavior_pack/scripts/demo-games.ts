// Made-up games for testing the lobby's menus (scrolling, long names, many maps and settings)
// before there are that many real ones. Turned on with DEV_DEMO_GAMES in .env; the lobby lists
// them like real games but refuses to start them.
import type { RegistryGame } from "@minecade/minigame-core";

export const DEMO_PREFIX = "demo_";

const DESCRIPTION = "A demo game for testing the menus.";

const DEMOS: Omit<RegistryGame, "id" | "description">[] = [
  {
    name: "Paintball",
    minPlayers: 2,
    maxPlayers: 16,
    teams: { count: [2, 4] },
    maps: ["Warehouse", "Rooftops", "Jungle Temple", "Harbor", "Old Mill", "Canyon", "Snowfort", "Castle Walls", "Arcade"].map(demoMap),
  },
  { name: "Block Drop", minPlayers: 2, maxPlayers: 12, maps: ["Rainbow", "Lava Lake", "Sky"].map(demoMap) },
  {
    name: "Hide and Seek",
    minPlayers: 3,
    maxPlayers: 12,
    teams: { count: 2, defs: [{ id: "seekers", name: "Seekers", color: "§c", size: 1 }, { id: "hiders", name: "Hiders", color: "§a", size: "rest" }] },
    maps: ["Village", "Library", "Toy Room", "Ship"].map(demoMap),
  },
  {
    name: "Capture the Wool",
    minPlayers: 4,
    maxPlayers: 16,
    teams: { count: 2 },
    options: [{ id: "wools", label: "Wools", values: [{ value: "1", label: "1" }, { value: "3", label: "3" }] }],
    maps: ["Twin Peaks", "Bridges"].map(demoMap),
  },
  { name: "TNT Run", minPlayers: 2, maxPlayers: 10, maps: ["Desert", "Nether"].map(demoMap) },
  {
    name: "Parkour Race",
    minPlayers: 1,
    maxPlayers: 8,
    options: [{ id: "laps", label: "Laps", values: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }] }],
    maps: ["Lava Run", "Cloud Course", "Factory", "Tower"].map(demoMap),
  },
  { name: "Spleef", minPlayers: 2, maxPlayers: 8, maps: ["Arena", "Layers"].map(demoMap) },
  { name: "Archery", minPlayers: 2, maxPlayers: 4, maps: ["Range"].map(demoMap) },
  { name: "Build Battle", minPlayers: 4, maxPlayers: 4, maps: ["Plots"].map(demoMap) },
  { name: "Murder Mystery", minPlayers: 4, maxPlayers: 12, maps: ["Mansion", "Train", "Hotel"].map(demoMap) },
  { name: "Skywars", minPlayers: 2, maxPlayers: 12, teams: { count: [2, 6], pick: false }, maps: ["Islands", "Temple", "Sky Garden"].map(demoMap) },
  { name: "Dropper", minPlayers: 1, maxPlayers: 8, maps: ["Well", "Library Shaft"].map(demoMap) },
];

/** Up to 12 made-up games (ids start with "demo_"); their pictures and maps use the placeholders. */
export function demoGames(count: number): RegistryGame[] {
  return DEMOS.slice(0, Math.max(0, count)).map((demo) => ({
    ...demo,
    id: `${DEMO_PREFIX}${demo.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    description: DESCRIPTION,
  }));
}

export function isDemoGame(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}

function demoMap(name: string): { id: string; name: string } {
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"), name };
}

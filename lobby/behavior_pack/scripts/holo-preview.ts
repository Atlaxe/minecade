// Hologram previews (DEV_HOLO_PREVIEW): every screen the hologram can show, with sample data, so
// its layout can be looked at from the lobby without a form covering the view. The terminal's
// Preview button lists these; the picked one stays up until the terminal is tapped again.
import type { StatsTotals } from "@minecade/minigame-core";
import { defaultSettings } from "./game-screen.ts";
import { countdownContent, gameContent, gameCornerContent, gamesContent, idleContent, mainContent, statsContent, statsListContent, teamsContent, type HoloContent } from "./holo-content.ts";
import type { GameChoice } from "./lobby-controller.ts";
import { GLOBAL_TAB, statColumns } from "./stats-screens.ts";

export const PREVIEW_SCREENS = [
  { id: "idle", name: "Idle" },
  { id: "main", name: "Main menu" },
  { id: "games", name: "Game grid" },
  { id: "game", name: "Game screen" },
  { id: "gameTall", name: "Game screen, taller picture" },
  { id: "gameCorner", name: "Game screen, picture in the corner" },
  { id: "teams", name: "Team picks" },
  { id: "players", name: "Stats list" },
  { id: "stats", name: "Player stats" },
  { id: "starting", name: "Starting" },
  { id: "countdown", name: "Countdown" },
] as const;

export type PreviewScreen = (typeof PREVIEW_SCREENS)[number]["id"];

const SAMPLE_NAMES = ["Nova", "Pixel", "Blaze", "Echo", "Rook", "Zephyr"];
const SAMPLE_TOTALS: StatsTotals = { games: 21, wins: 6, losses: 13, draws: 2, kills: 39, deaths: 27, dealt: 910, taken: 371, seconds: 3900, bestStreak: 3, left: 0 };

/**
 * One screen with sample data. The grid and game screen use the lobby's real games (the first one
 * with settings for the game screen); the rest is made up. `viewer` stands in as the player.
 */
export function previewContent(screen: PreviewScreen, choices: GameChoice[], viewer: string): HoloContent {
  switch (screen) {
    case "idle":
      return idleContent();
    case "main":
      return mainContent("play");
    case "games":
      return gamesContent(choices);
    case "game":
    case "gameTall":
    case "gameCorner": {
      const choice = choices.find((candidate) => Object.keys(defaultSettings(candidate.game)).length > 0) ?? choices[0];
      if (!choice) return gamesContent(choices);
      const view = { choice, random: false, map: choice.game.maps[0]?.id ?? "random", settings: defaultSettings(choice.game) };
      if (screen === "gameCorner") return gameCornerContent(view);
      return gameContent(view, screen === "game" ? "wide" : "tall");
    }
    case "teams":
      return teamsContent({
        game: "Probe",
        status: "Teams lock in 12 s",
        teams: [
          { id: "red", name: "Red", color: "§c", members: [viewer, SAMPLE_NAMES[0]], cap: 3, full: false },
          { id: "blue", name: "Blue", color: "§9", members: [SAMPLE_NAMES[1], SAMPLE_NAMES[2], SAMPLE_NAMES[3]], cap: 3, full: true },
        ],
        unpicked: [SAMPLE_NAMES[4]],
      });
    case "players":
      return statsListContent({ viewer, players: [viewer, ...SAMPLE_NAMES], more: 0 });
    case "stats":
      return statsContent({
        player: viewer,
        tabs: [GLOBAL_TAB, { id: "sumo", name: "Sumo" }, { id: "probe", name: "Probe" }],
        tab: GLOBAL_TAB.id,
        body: "",
        columns: statColumns(SAMPLE_TOTALS),
        placement: { rank: 3, of: 9 },
      });
    case "starting":
      return countdownContent({ game: "Sumo", map: "Arena" });
    case "countdown":
      return countdownContent({ game: "Sumo", map: "Arena", left: 3 });
  }
}

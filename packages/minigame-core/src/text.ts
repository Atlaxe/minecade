// Colors and wording for everything players read: chat, titles and the action bar. One palette,
// so the whole network reads the same way: gray for minor notes, aqua and blue for information,
// green for good news, red for warnings and errors, yellow for highlights. Pure: the lobby,
// games and tests all use it.

export const COLOR = {
  minor: "§7",
  info: "§b",
  important: "§9",
  success: "§a",
  warn: "§c",
  error: "§c",
  highlight: "§e",
  /** Player names that aren't on a team. */
  name: "§f",
} as const;

/**
 * Wraps text in a palette color. A colored piece inside it (a player name ending in §r) hands
 * the color back afterwards, so `say.info(`${nameOf("Alex")} is starting Sumo.`)` stays aqua.
 */
function paint(color: string): (text: string) => string {
  return (text) => `${color}${text.replaceAll("§r", `§r${color}`)}§r`;
}

export const say = {
  minor: paint(COLOR.minor),
  info: paint(COLOR.info),
  important: paint(COLOR.important),
  success: paint(COLOR.success),
  warn: paint(COLOR.warn),
  error: paint(COLOR.error),
  highlight: paint(COLOR.highlight),
};

/** A player name in their team color (a § code), or white. */
export function nameOf(name: string, color: string = COLOR.name): string {
  return `${color}${name}§r`;
}

// ---- Death messages --------------------------------------------------------------------------

/** "<victim> was <verb> by <killer>". */
export const KILL_VERBS: readonly string[] = [
  "obliterated",
  "dominated",
  "destroyed",
  "man-handled",
  "flattened",
  "deleted",
  "sent packing",
  "outplayed",
  "humbled",
  "bonked",
  "erased",
  "steamrolled",
  "schooled",
  "yeeted",
  "vaporized",
  "demolished",
];

/** What happened to a player who went down with nobody to credit, by cause. */
export const NO_KILLER_LINES: Readonly<Record<"void" | "fall" | "generic", readonly string[]>> = {
  void: ["fell into the void", "took a long walk off a short platform", "forgot how gravity works", "found the edge of the map"],
  fall: ["hit the ground too hard", "trusted their landing a bit too much"],
  generic: ["was eliminated", "blinked out of existence", "is out"],
};

export interface DeathMessageConfig {
  /** Extra "was <verb> by" verbs for this game, such as Paintball's "painted". */
  verbs?: string[];
  /** Use only `verbs`, not the default ones. */
  replace?: boolean;
  /** Lines for a player who went down with nobody to credit, replacing the defaults. */
  noKiller?: string[];
}

export interface Death {
  victim: string;
  /** The victim's team color, if any. */
  victimColor?: string;
  killer?: string;
  killerColor?: string;
  /** The damage cause ("void", "fall", "entityAttack", ...). */
  cause: string;
}

/** A kill-feed line: `<victim> was <verb> by <killer>`, yellow, with the names in team colors (or gray and red). */
export function deathMessage(death: Death, config: DeathMessageConfig = {}, random: () => number = Math.random): string {
  const victim = nameOf(death.victim, death.victimColor ?? COLOR.minor);
  if (death.killer !== undefined) {
    const verbs = config.replace && config.verbs?.length ? config.verbs : [...KILL_VERBS, ...(config.verbs ?? [])];
    return `${victim} ${COLOR.highlight}was ${pick(verbs, random)} by ${nameOf(death.killer, death.killerColor ?? COLOR.warn)}`;
  }
  const lines = config.noKiller?.length ? config.noKiller : (NO_KILLER_LINES[causeGroup(death.cause)] ?? NO_KILLER_LINES.generic);
  return `${victim} ${COLOR.highlight}${pick(lines, random)}§r`;
}

function causeGroup(cause: string): keyof typeof NO_KILLER_LINES {
  if (cause === "void" || cause === "outOfWorld") return "void";
  if (cause === "fall") return "fall";
  return "generic";
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/** Text without § formatting codes, for logs and tests. */
export function stripColors(text: string): string {
  return text.replace(/§./g, "");
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st", ... */
export function ordinal(place: number): string {
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`;
  const suffix = ["th", "st", "nd", "rd"][place % 10] ?? "th";
  return `${place}${suffix}`;
}

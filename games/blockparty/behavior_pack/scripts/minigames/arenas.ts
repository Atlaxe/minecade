// Block Party's minigame arenas (docs/plans/block-party.md, "Minigame arena maps"; every minigame
// written out in docs/plans/block-party-minigames.md), as the game's config lists them
// (GameConfig.arenas, core's arena-map.ts): each minigame's arena map is its own entry in the map
// editor's list ("Hot Floor (Block Party)", blockparty-hotfloor) with its own checklist and Game
// settings. Every arena map has the Arena box, at most the arena slot's 40 x 60 across (either way
// around: the game turns it to fit the slot) and 48 tall (Leg Breaker's 96); Publish cuts it out as a
// structure, which the game places in the slot, fresh each time. Every minigame of the plan has its
// entry, built or not (minigames/index.ts lists the built ones), so the user can make its maps ahead
// of its code. Plain data, read by game.config.ts (the editors, the build), by the minigames (the
// markup names below) and by the test arenas (test-arenas.ts).
import { ARENA_SLOT_FOOTPRINT, STRUCTURE_REGION, type ArenaConfig, type MapEntryRequirement, type MapRequirementsConfig, type MapSettingConfig } from "@minecade/minigame-core/config";

/** How tall an Arena box may be, from the slot's floor (the plan's proposal). */
export const ARENA_HEIGHT = 48;
/** Leg Breaker's Arena box, for a long fall (the user, 2026-11-26). */
export const LEG_BREAKER_HEIGHT = 96;

/** The markup the minigames read, by name. */
export const MARKUP = {
  /** Hot Floor: where its tiles go (the box's lowest layer). Co-op Painters, Slither: the floor that gets painted. Anvil Rain, TNT Run, Spleef Duo: the floor. */
  floor: "floor",
  /** Hunter: where the runners are home. */
  goal: "goal",
  /** Hunter, Labyrinth: the hunter's spawn, and the runners'. */
  hunter: "hunter",
  runners: "runners",
  /** Every minigame: the minigame podium, where the players stand for its results, 1st to 4th (minigame-podium.ts), and the camera on it. */
  podium: "podium",
  podiumCamera: "podiumCamera",
  /** Mob Freeze: the Warden's spot. */
  mob: "mob",
  /** Mob Freeze, Minecart Dodge, Montecarlo, Paired Parkour, Carry Race, Trap Master: the finish. */
  finish: "finish",
  /** Simon Says: each player's colors, and the big display. */
  stations: "stations",
  display: "display",
  /** Enderman Roulette. */
  enderman: "enderman",
  /** Button Mash. */
  buttons: "buttons",
  /** Egg Drop: where the eggs fall. */
  drop: "drop",
  /** Hole in the Wall: the platform, and the wall where it starts. */
  platform: "platform",
  wallStart: "wallStart",
  /** Minecart Dodge's lanes. */
  tracks: "tracks",
  waterLanes: "waterLanes",
  /** Rising Lava: the box the liquid fills. */
  rise: "rise",
  /** Leg Breaker: the finish at the bottom, and where the random layers go. */
  bottom: "bottom",
  layers: "layers",
  /** Montecarlo. */
  hallways: "hallways",
  hallwayStarts: "hallwayStarts",
  doors: "doors",
  /** Climb the Ladder. */
  top: "top",
  /** Snowball Sniper's target lanes. */
  targets: "targets",
  /** Chicken Chase, Count the Mobs. */
  pen: "pen",
  /** Mining Race. */
  mines: "mines",
  /** Hook the Mob. */
  pits: "pits",
  pool: "pool",
  /** Cook's Request. */
  villager: "villager",
  pantry: "pantry",
  animals: "animals",
  /** Quiz Floor's answer pads. */
  answers: "answers",
  /** Count the Mobs. */
  penCamera: "penCamera",
  gates: "gates",
  /** King of the Hill. */
  hill: "hill",
  /** Mini Survival Games (typed Middle and Outer). */
  chests: "chests",
  /** Tug of War. */
  rope: "rope",
  tugCamera: "tugCamera",
  /** Capture the Wool (per team). */
  wool: "wool",
  base: "base",
  /** Paired Parkour. */
  checkpoints: "checkpoints",
  /** Cannon Duel (per team). */
  cannon: "cannon",
  ammo: "ammo",
  target: "target",
  /** Trap Master: the master's spot, and each kind of trap with its levers (the nth lever works the nth trap of its kind). */
  master: "master",
  dropTraps: "dropTraps",
  vanishTraps: "vanishTraps",
  tntTraps: "tntTraps",
  waterTraps: "waterTraps",
  dropLevers: "dropLevers",
  vanishLevers: "vanishLevers",
  tntLevers: "tntLevers",
  waterLevers: "waterLevers",
  /** Defend the Core. */
  core: "core",
  raider: "raider",
  defenders: "defenders",
  /** Barnyard Bluff. */
  farmer: "farmer",
  hiders: "hiders",
  herd: "herd",
  /** Labyrinth (with hunter and runners). */
  exit: "exit",
  maze: "maze",
  /** Boss Fight. */
  boss: "boss",
  trio: "trio",
  /** Bomb Disposal. */
  bomber: "bomber",
  squad: "squad",
  squadRoom: "squadRoom",
  bombSites: "bombSites",
} as const;

/**
 * Every arena map's minigame podium (the user, 2026-11-18): 4 spots, 1st place to 4th in order, each
 * placed standing where a player stands with their facing taken; and the Podium camera, placed the
 * same way where the camera goes (Take my facing). A map can do without the camera (Checklist
 * Features): the shot then stands in front of the podium. An arena with no podium plays its results
 * at its spawns.
 */
const PODIUM = {
  [MARKUP.podium]: { label: "Minigame podium", count: 4, marker: "player" },
  [MARKUP.podiumCamera]: { label: "Podium camera" },
} as const;
const PODIUM_ADJUSTABLE = { [`points.${MARKUP.podiumCamera}`]: { off: true } };

/** The 2v2 sides, as team spawns and per-team marks are keyed (Co-op Painters' first). */
export const PAINTER_TEAMS = [
  { id: "red", name: "Red", color: "§c" },
  { id: "blue", name: "Blue", color: "§9" },
];
const TWO_TEAMS = { count: 2, pick: false, defs: PAINTER_TEAMS };

const inside = { inside: STRUCTURE_REGION };
/** 4 plain spawns inside the Arena box (a duel uses the first 2). */
const FOUR = { min: 4, ...inside };

const SECONDS = "seconds";
const TENTHS = "tenths of a second";
const BLOCKS = "blocks";
const PERCENT = "%";
const SPEED = "blocks a second";
const OF_VANILLA = "tenths of vanilla's";

/** A Game setting (the map editor's Game settings tool and the Panel's Map settings). */
function setting(label: string, value: number, min: number, max: number, unit?: string): MapSettingConfig {
  return { label, default: value, min, max, ...(unit ? { unit } : {}) };
}
const playTime = (value: number, min: number, max: number, label = "Time limit") => setting(label, value, min, max, SECONDS);
const knockback = (value = 20, min = 10, max = 40, label = "Knockback") => setting(label, value, min, max, OF_VANILLA);

/** A point a player stands at, facing where they look. */
const player = (label: string, count?: number): MapEntryRequirement => ({ label, marker: "player", ...(count !== undefined ? { count } : {}) });
const post = (label: string, count?: number): MapEntryRequirement => ({ label, ...(count !== undefined ? { count } : {}) });
const region = (label: string, count?: number): MapEntryRequirement => ({ label, ...inside, ...(count !== undefined ? { count } : {}) });

/** The checklist every arena has around a minigame's own: the spectator spawn, the podium and its camera. */
function entry(id: string, name: string, map: MapRequirementsConfig, options: { teams?: boolean; height?: number } = {}): ArenaConfig {
  const points = (map.points ?? {}) as Record<string, MapEntryRequirement>;
  return {
    id,
    name,
    maxPlayers: 4,
    ...(options.teams ? { teams: TWO_TEAMS } : {}),
    box: { footprint: ARENA_SLOT_FOOTPRINT, height: options.height ?? ARENA_HEIGHT },
    map: { ...map, spectatorSpawn: true, points: { ...points, ...PODIUM }, adjustable: { ...map.adjustable, ...PODIUM_ADJUSTABLE } },
  };
}

export const ARENAS: ArenaConfig[] = [
  // ---- Built -------------------------------------------------------------------------------
  // 4 spawns on the floor (a duel uses the first 2), where the players who fall watch from, and the floor's tiles.
  entry("hotfloor", "Hot Floor", {
    spawns: FOUR,
    regions: { [MARKUP.floor]: region("Floor (tiles)") },
    settings: {
      firstCount: setting("First countdown", 40, 15, 100, TENTHS),
      lastCount: setting("Shortest countdown", 15, 5, 50, TENTHS),
      countStep: setting("Shorter each round by", 3, 0, 20, TENTHS),
      rounds: setting("Most rounds", 12, 3, 30),
      colorCount: setting("Colors", 6, 2, 6),
    },
  }),
  entry(
    "painters",
    "Co-op Painters",
    { spawns: false, teamSpawns: { perTeam: 2 }, regions: { [MARKUP.floor]: region("Floor") }, settings: { playTime: playTime(30, 15, 120, "Time") } },
    { teams: true },
  ),
  // The hunter's spawn, 3 runners' (1v2 uses the first 2), and the runners' goal.
  entry("hunter", "Hunter", {
    spawns: false,
    points: { [MARKUP.hunter]: player("Hunter spawn"), [MARKUP.runners]: player("Runner spawns", 3) },
    regions: { [MARKUP.goal]: region("Goal") },
    settings: { playTime: playTime(45, 20, 120, "Time"), headStart: setting("Hunter waits", 2, 0, 10, SECONDS) },
  }),

  // ---- Quick reflexes ----------------------------------------------------------------------
  entry("mobfreeze", "Mob Freeze", {
    spawns: FOUR,
    points: { [MARKUP.mob]: post("Warden") },
    regions: { [MARKUP.finish]: region("Finish") },
    settings: {
      playTime: playTime(30, 15, 90),
      awayMin: setting("Looks away for at least", 10, 5, 100, TENTHS),
      awayMax: setting("Looks away for at most", 40, 5, 100, TENTHS),
      watch: setting("Watches for", 25, 10, 60, TENTHS),
      warning: setting("Warning before it turns", 5, 0, 20, TENTHS),
      grace: setting("Reaction time", 3, 0, 10, TENTHS),
    },
  }),
  entry("simon", "Simon Says", {
    spawns: FOUR,
    points: { [MARKUP.stations]: post("Stations", 4), [MARKUP.display]: post("Display") },
    settings: {
      hearts: setting("Hearts", 2, 1, 5),
      firstWindow: setting("First answer time", 30, 10, 60, TENTHS),
      lastWindow: setting("Shortest answer time", 12, 5, 30, TENTHS),
      commands: setting("Most commands", 20, 5, 40),
      dontShare: setting("Don't commands", 35, 0, 70, PERCENT),
    },
    adjustable: { [`points.${MARKUP.display}`]: { off: true } },
  }),
  entry("enderman", "Enderman Roulette", {
    spawns: FOUR,
    points: { [MARKUP.enderman]: post("Enderman") },
    settings: {
      rounds: setting("Rounds", 5, 1, 10),
      snapMin: setting("Snaps after at least", 30, 10, 300, TENTHS),
      snapMax: setting("Snaps after at most", 120, 10, 300, TENTHS),
      cone: setting("Looking at it within", 15, 5, 45, "degrees"),
    },
  }),
  entry("buttonmash", "Button Mash", {
    spawns: FOUR,
    points: { [MARKUP.buttons]: post("Buttons", 4) },
    settings: { playTime: playTime(10, 5, 30, "Time") },
  }),
  entry("anvilrain", "Anvil Rain", {
    spawns: FOUR,
    regions: { [MARKUP.floor]: region("Floor") },
    settings: {
      startRate: setting("Anvils a second at first", 2, 1, 10),
      endRate: setting("Anvils a second at the end", 8, 1, 20),
      ringEvery: setting("A ring closes every", 4, 1, 20, SECONDS),
      warning: setting("Shadow before it lands", 10, 3, 30, TENTHS),
      playTime: playTime(60, 20, 120),
    },
  }),
  entry("tntrun", "TNT Run", {
    spawns: FOUR,
    killY: true,
    regions: { [MARKUP.floor]: region("Floor") },
    settings: { delay: setting("Vanishes after", 4, 1, 20, TENTHS), playTime: playTime(90, 30, 180) },
  }),
  entry("eggdrop", "Egg Drop", {
    spawns: FOUR,
    regions: { [MARKUP.drop]: region("Drop") },
    settings: {
      playTime: playTime(30, 15, 90, "Time"),
      eggRate: setting("Eggs a second", 2, 1, 8),
      eggSpeed: setting("Fall speed", 3, 1, 10, SPEED),
      rareShare: setting("Brown and blue eggs", 15, 0, 50, PERCENT),
    },
  }),
  entry("hottnt", "Hot TNT", {
    spawns: FOUR,
    settings: {
      fuseMin: setting("Shortest fuse", 15, 5, 90, SECONDS),
      fuseMax: setting("Longest fuse", 30, 5, 90, SECONDS),
      noPassBack: setting("No passing back for", 20, 0, 50, TENTHS),
      holderSpeed: setting("Holder's speed", 1, 0, 3),
      killRadius: setting("Out within", 2, 0, 4, BLOCKS),
      blastRadius: setting("Hurt within", 5, 2, 10, BLOCKS),
      blastHearts: setting("Most hearts lost", 6, 1, 10, "hearts"),
    },
  }),
  entry("holeinwall", "Hole in the Wall", {
    spawns: FOUR,
    killY: true,
    regions: { [MARKUP.platform]: region("Platform"), [MARKUP.wallStart]: region("Wall start") },
    settings: {
      walls: setting("Walls", 10, 3, 30),
      firstSpeed: setting("First wall speed", 2, 1, 8, SPEED),
      lastSpeed: setting("Last wall speed", 5, 1, 12, SPEED),
      holes: setting("Holes", 3, 1, 6),
    },
  }),

  // ---- Races and courses -------------------------------------------------------------------
  entry("minecarts", "Minecart Dodge", {
    spawns: FOUR,
    regions: { [MARKUP.finish]: region("Finish"), [MARKUP.tracks]: region("Track lanes", 6), [MARKUP.waterLanes]: region("Water lanes", 3) },
    settings: {
      playTime: playTime(60, 30, 120),
      cartSpeed: setting("Cart speed", 5, 2, 15, SPEED),
      cartGap: setting("A cart every", 30, 10, 100, TENTHS),
      tntShare: setting("TNT carts", 5, 0, 30, PERCENT),
      tntRadius: setting("TNT blast", 3, 1, 6, BLOCKS),
      logSpeed: setting("Log speed", 2, 1, 8, SPEED),
      logMin: setting("Shortest log", 2, 1, 10, BLOCKS),
      logMax: setting("Longest log", 5, 1, 10, BLOCKS),
      respawn: setting("Back after", 10, 0, 40, TENTHS),
    },
    adjustable: { [`regions.${MARKUP.tracks}`]: { off: true, min: 1, max: 10 }, [`regions.${MARKUP.waterLanes}`]: { off: true, min: 1, max: 8 } },
  }),
  entry("risinglava", "Rising Lava", {
    spawns: FOUR,
    regions: { [MARKUP.rise]: region("Rise") },
    settings: {
      water: setting("Water instead of lava", 0, 0, 1),
      startDelay: setting("First rise after", 5, 0, 30, SECONDS),
      riseEvery: setting("A layer every, at first", 20, 5, 100, TENTHS),
      riseEnd: setting("A layer every, at the end", 8, 3, 100, TENTHS),
    },
  }),
  entry(
    "legbreaker",
    "Leg Breaker",
    {
      spawns: FOUR,
      regions: { [MARKUP.bottom]: region("Bottom"), [MARKUP.layers]: region("Layers") },
      settings: {
        playTime: playTime(60, 30, 120),
        layerCount: setting("Layers", 8, 3, 15),
        holes: setting("Holes", 25, 10, 60, PERCENT),
        slime: setting("Slime", 15, 0, 100),
        cobweb: setting("Cobweb", 10, 0, 100),
        hay: setting("Hay", 20, 0, 100),
        concrete: setting("Concrete", 40, 0, 100),
        magma: setting("Magma", 15, 0, 100),
        respawn: setting("Back to the top after", 2, 0, 10, SECONDS),
      },
      adjustable: { [`regions.${MARKUP.layers}`]: { off: true } },
    },
    { height: LEG_BREAKER_HEIGHT },
  ),
  // Tiled: one player's copy (test-arenas.ts lays one for each).
  entry("montecarlo", "Montecarlo", {
    spawns: { min: 1, ...inside },
    points: { [MARKUP.hallwayStarts]: player("Hallway starts", 4) },
    regions: { [MARKUP.hallways]: region("Hallways", 4), [MARKUP.doors]: region("Doors", 12), [MARKUP.finish]: region("Finish") },
    settings: {
      playTime: playTime(60, 30, 120),
      rightDoors: setting("Right doors per hallway", 1, 1, 2),
      backAfter: setting("Back after a wrong door", 10, 0, 40, TENTHS),
    },
    adjustable: {
      [`regions.${MARKUP.hallways}`]: { min: 3, max: 8 },
      [`points.${MARKUP.hallwayStarts}`]: { min: 3, max: 8 },
      [`regions.${MARKUP.doors}`]: { min: 6, max: 48 },
    },
  }),
  entry("ladder", "Climb the Ladder", {
    spawns: FOUR,
    regions: { [MARKUP.top]: region("Top") },
    settings: { playTime: playTime(45, 20, 120), knockback: knockback() },
  }),

  // ---- Points and collecting ---------------------------------------------------------------
  entry("scramble", "Item Scramble", {
    spawns: FOUR,
    settings: {
      rounds: setting("Rounds", 3, 1, 6),
      roundTime: setting("Round time", 30, 10, 60, SECONDS),
      ring: setting("Chests this far out", 3, 2, 6, BLOCKS),
      perChest: setting("Items in a chest", 12, 4, 27),
    },
  }),
  entry("snowball", "Snowball Sniper", {
    spawns: FOUR,
    regions: { [MARKUP.targets]: region("Target lanes", 4) },
    settings: { playTime: playTime(40, 20, 90, "Time"), targetSpeed: setting("Target speed", 4, 1, 15, SPEED) },
    adjustable: { [`regions.${MARKUP.targets}`]: { min: 2, max: 8 } },
  }),
  entry("chickens", "Chicken Chase", {
    spawns: FOUR,
    regions: { [MARKUP.pen]: region("Pen") },
    settings: { playTime: playTime(30, 15, 90, "Time"), chickens: setting("Chickens at once", 8, 2, 20) },
  }),
  entry("mining", "Mining Race", {
    spawns: FOUR,
    regions: { [MARKUP.mines]: region("Mines", 4) },
    settings: { playTime: playTime(30, 15, 90, "Time"), oreShare: setting("Ores", 15, 5, 50, PERCENT) },
    adjustable: { [`regions.${MARKUP.mines}`]: { min: 1, max: 4 } },
  }),
  entry("slither", "Slither", {
    spawns: FOUR,
    regions: { [MARKUP.floor]: region("Floor") },
    settings: { playTime: playTime(45, 20, 120, "Time"), startPatch: setting("Starting patch", 2, 1, 4, BLOCKS) },
  }),
  entry("hookmob", "Hook the Mob", {
    spawns: FOUR,
    regions: { [MARKUP.pits]: region("Pits", 4), [MARKUP.pool]: region("Pool") },
    settings: {
      playTime: playTime(45, 20, 120, "Time"),
      mobs: setting("Mobs at once", 10, 4, 30),
      creeperShare: setting("Creepers", 15, 0, 50, PERCENT),
      reach: setting("Throws up to", 12, 6, 30, BLOCKS),
    },
  }),
  // Tiled: one player's (one team's) kitchen; a 2v2 team shares one, so it has 2 spawns.
  entry("cook", "Cook's Request", {
    spawns: { min: 2, ...inside },
    points: { [MARKUP.villager]: post("Villager"), [MARKUP.pantry]: post("Pantry", 2), [MARKUP.animals]: post("Animal spots", 2) },
    settings: {
      requests: setting("Requests", 3, 1, 5),
      requestTime: setting("Time per request", 90, 30, 240, SECONDS),
      cookTime: setting("The pot cooks for", 5, 1, 20, SECONDS),
      regrow: setting("Crops and animals back after", 5, 1, 30, SECONDS),
    },
    adjustable: { [`points.${MARKUP.pantry}`]: { min: 1, max: 6 }, [`points.${MARKUP.animals}`]: { off: true, min: 1, max: 6 } },
  }),

  // ---- Brains ------------------------------------------------------------------------------
  entry("quiz", "Quiz Floor", {
    spawns: FOUR,
    regions: { [MARKUP.answers]: region("Answer pads", 4) },
    settings: { answerTime: setting("Answer time", 10, 5, 30, SECONDS), questions: setting("Questions", 8, 3, 20) },
  }),
  entry("countmobs", "Count the Mobs", {
    spawns: FOUR,
    points: { [MARKUP.penCamera]: post("Pen camera"), [MARKUP.gates]: post("Gates", 2) },
    regions: { [MARKUP.pen]: region("Pen") },
    settings: {
      rounds: setting("Rounds", 3, 1, 5),
      roundTime: setting("Round time", 20, 10, 60, SECONDS),
      mostSheep: setting("Most sheep in the pen", 12, 4, 30),
    },
  }),

  // ---- Fights and knock-offs ---------------------------------------------------------------
  entry("kitbrawl", "Kit Brawl", {
    spawns: FOUR,
    killY: true,
    settings: { playTime: playTime(30, 10, 90, "Time") },
    adjustable: { killY: { off: true } },
  }),
  entry("hill", "King of the Hill", {
    spawns: FOUR,
    killY: true,
    regions: { [MARKUP.hill]: region("Hill") },
    settings: { playTime: playTime(40, 20, 120, "Time"), knockback: knockback(), respawn: setting("Back after a fall", 2, 0, 10, SECONDS) },
    adjustable: { killY: { off: true } },
  }),
  entry("sumoduel", "Sumo Duel", {
    spawns: FOUR,
    killY: true,
    settings: { playTime: playTime(45, 20, 120), knockback: knockback() },
  }),
  entry("cactus", "Cactus Slap", {
    spawns: FOUR,
    killY: true,
    settings: { playTime: playTime(60, 20, 120), knockback: knockback(40, 10, 80) },
    adjustable: { killY: { off: true } },
  }),
  entry("towers", "Towers of Fortune", {
    spawns: FOUR,
    killY: true,
    settings: { playTime: playTime(120, 60, 300), itemEvery: setting("An item every", 5, 2, 20, SECONDS) },
  }),
  entry("survival", "Mini Survival Games", {
    spawns: FOUR,
    points: {
      [MARKUP.chests]: {
        label: "Chests",
        types: [
          { id: "middle", name: "Middle", count: 2 },
          { id: "outer", name: "Outer", count: 4 },
        ],
      },
    },
    settings: {
      playTime: playTime(120, 60, 300),
      grace: setting("No fighting for", 10, 0, 30, SECONDS),
      borderStart: setting("Border closes after", 60, 0, 240, SECONDS),
      borderEnd: setting("Border ends at", 8, 4, 30, BLOCKS),
    },
  }),

  // ---- 2v2 ---------------------------------------------------------------------------------
  entry(
    "tugofwar",
    "Tug of War",
    {
      spawns: false,
      teamSpawns: { perTeam: 2 },
      points: { [MARKUP.tugCamera]: post("Tug camera") },
      regions: { [MARKUP.rope]: region("Rope") },
      settings: {
        playTime: playTime(30, 15, 90, "Time"),
        pullToWin: setting("Pull to win", 5, 2, 15, BLOCKS),
        tugPull: setting("A tug pulls", 10, 2, 50, "hundredths of a block"),
        together: setting("Together within", 2, 1, 5, TENTHS),
        togetherBoost: setting("Together pulls", 150, 100, 300, PERCENT),
      },
      adjustable: { [`points.${MARKUP.tugCamera}`]: { off: true } },
    },
    { teams: true },
  ),
  entry(
    "wool",
    "Capture the Wool",
    {
      spawns: false,
      teamSpawns: { perTeam: 2 },
      points: { [MARKUP.wool]: { label: "Wool", perTeam: true } },
      regions: { [MARKUP.base]: { label: "Base", perTeam: true, ...inside } },
      settings: {
        playTime: playTime(60, 30, 120, "Time"),
        captures: setting("Captures to win", 1, 1, 3),
        respawn: setting("Back after a tag", 2, 0, 10, SECONDS),
      },
    },
    { teams: true },
  ),
  entry("spleef", "Spleef Duo", {
    spawns: FOUR,
    killY: true,
    regions: { [MARKUP.floor]: region("Floor") },
    settings: { playTime: playTime(60, 30, 120, "Time"), knockback: knockback(15, 5, 40, "Snowball knockback") },
    adjustable: { [`regions.${MARKUP.floor}`]: { min: 1, max: 3 } },
  }),
  // Tiled: one team's course.
  entry("parkour", "Paired Parkour", {
    spawns: { min: 2, ...inside },
    killY: true,
    regions: { [MARKUP.checkpoints]: region("Checkpoints", 3), [MARKUP.finish]: region("Finish") },
    settings: { playTime: playTime(90, 30, 180, "Time") },
    adjustable: { [`regions.${MARKUP.checkpoints}`]: { off: true, min: 1, max: 8 } },
  }),
  // Tiled: one team's maze; the walker's spawn, then the rider's.
  entry("carryrace", "Carry Race", {
    spawns: { min: 2, ...inside },
    regions: { [MARKUP.finish]: region("Finish") },
    settings: { playTime: playTime(60, 30, 120, "Time") },
  }),
  entry(
    "cannons",
    "Cannon Duel",
    {
      spawns: false,
      teamSpawns: { perTeam: 2 },
      points: { [MARKUP.cannon]: { label: "Cannon", perTeam: true }, [MARKUP.ammo]: { label: "Ammo", perTeam: true } },
      regions: { [MARKUP.target]: { label: "Target", perTeam: true, ...inside } },
      settings: {
        playTime: playTime(60, 30, 120, "Time"),
        hitsToWin: setting("Hits to win", 3, 1, 10),
        reload: setting("Reload", 2, 0, 10, SECONDS),
      },
    },
    { teams: true },
  ),

  // ---- 1v3 ---------------------------------------------------------------------------------
  entry("trapmaster", "Trap Master", {
    spawns: false,
    killY: true,
    points: {
      [MARKUP.master]: player("Master spawn"),
      [MARKUP.runners]: player("Runner spawns", 3),
      [MARKUP.dropLevers]: post("Drop levers"),
      [MARKUP.vanishLevers]: post("Vanish levers"),
      [MARKUP.tntLevers]: post("TNT levers"),
      [MARKUP.waterLevers]: post("Water levers"),
    },
    regions: {
      [MARKUP.dropTraps]: region("Drop traps"),
      [MARKUP.vanishTraps]: region("Vanish traps"),
      [MARKUP.tntTraps]: region("TNT traps"),
      [MARKUP.waterTraps]: region("Water traps"),
      [MARKUP.finish]: region("Finish"),
    },
    settings: {
      playTime: playTime(60, 30, 120, "Time"),
      open: setting("Trap lasts", 20, 5, 60, TENTHS),
      cooldown: setting("Lever waits", 5, 1, 20, SECONDS),
      tntRadius: setting("TNT blast", 3, 1, 6, BLOCKS),
    },
    adjustable: Object.fromEntries(
      (["drop", "vanish", "tnt", "water"] as const).flatMap((kind) => [
        [`regions.${kind}Traps`, { off: true, min: 1, max: 3 }],
        [`points.${kind}Levers`, { off: true, min: 1, max: 3 }],
      ]),
    ),
  }),
  entry("core", "Defend the Core", {
    spawns: false,
    points: { [MARKUP.core]: post("Core"), [MARKUP.raider]: player("Raider spawn"), [MARKUP.defenders]: player("Defender spawns", 3) },
    settings: {
      playTime: playTime(60, 30, 120, "Time"),
      coreHits: setting("Hits to break the core", 20, 5, 60),
      raiderHearts: setting("Raider's hearts", 20, 10, 60, "hearts"),
      respawn: setting("Defenders back after", 3, 0, 10, SECONDS),
    },
  }),
  entry("barnyard", "Barnyard Bluff", {
    spawns: false,
    points: { [MARKUP.farmer]: player("Farmer spawn"), [MARKUP.hiders]: player("Hider spawns", 3) },
    regions: { [MARKUP.herd]: region("Herd") },
    settings: {
      hideTime: setting("Time to blend in", 10, 5, 30, SECONDS),
      playTime: playTime(60, 30, 120, "Time to find them"),
      animals: setting("Animals", 20, 8, 40),
      guesses: setting("Guesses", 4, 3, 10),
    },
  }),
  entry("labyrinth", "Labyrinth", {
    spawns: false,
    points: { [MARKUP.hunter]: player("Hunter spawn"), [MARKUP.runners]: player("Runner spawns", 3) },
    regions: { [MARKUP.exit]: region("Exit"), [MARKUP.maze]: region("Maze") },
    settings: {
      playTime: playTime(60, 30, 120, "Time"),
      headStart: setting("Hunter waits", 3, 0, 10, SECONDS),
      needed: setting("Runners who must get out", 3, 1, 3),
      cameraHeight: setting("Hunter's camera height", 8, 4, 20, BLOCKS),
    },
    adjustable: { [`regions.${MARKUP.maze}`]: { off: true } },
  }),
  entry("bossfight", "Boss Fight", {
    spawns: false,
    killY: true,
    points: { [MARKUP.boss]: player("Boss spawn"), [MARKUP.trio]: player("Trio spawns", 3) },
    settings: {
      playTime: playTime(90, 45, 180, "Time"),
      bossHealth: setting("Wither's health", 100, 20, 500),
      trioLives: setting("Trio's lives", 2, 1, 5),
      loseBlue: setting("No blue skulls below", 75, 0, 100, PERCENT),
      loseBlack: setting("No black skulls below", 50, 0, 100, PERCENT),
      loseFlight: setting("Grounded below", 25, 0, 100, PERCENT),
    },
    adjustable: { killY: { off: true } },
  }),
  entry("bomb", "Bomb Disposal", {
    spawns: false,
    points: { [MARKUP.bomber]: player("Bomber spawn"), [MARKUP.squad]: player("Squad spawns", 3), [MARKUP.bombSites]: post("Bomb sites", 8) },
    regions: { [MARKUP.squadRoom]: region("Squad room") },
    settings: {
      plantTime: setting("Time to plant", 15, 5, 30, SECONDS),
      fuse: setting("Fuse", 60, 30, 120, SECONDS),
      bombs: setting("Bombs", 3, 1, 5),
      defuseTime: setting("Defusing takes", 4, 1, 10, SECONDS),
      freeze: setting("Frozen for", 2, 1, 5, SECONDS),
    },
    adjustable: { [`points.${MARKUP.bombSites}`]: { min: 6, max: 12 } },
  }),
];

/** The arenas played as a copy for each player ("player") or each side ("side"), side by side (docs/plans/block-party-minigames.md, piece 9). */
export const TILED: Readonly<Record<string, "player" | "side">> = { montecarlo: "player", cook: "side", parkour: "side", carryrace: "side" };

// Block Party's animations (docs/plans/block-party-ui.md, "Player animations"): what the players and
// the NPCs do, by the names the dialogue tool gives them (its actions list: the players' four sets,
// Celebration, Sad, Dice roll and Select, and each character's moves).
//
// The game's own animations are in its resource pack, and an animation's name says what it's for:
//   animation.blockparty.<owner>.<action>            the one animation for it
//   animation.blockparty.<owner>.<action>.<variant>  one of several, picked at random each time
// The owner is "player" for the players' sets, else the character ("chris", "wandering_trader"),
// and the action is its name in the dialogue tool the same way ("dice_roll", "look_at_the_player").
// So a variant made in Blockbench and saved into the pack's animation files, named that way, plays
// with no code change, and so does a new action the user adds to a character in the dialogue tool.
//
// A few moves are something else, by the table below (NPC_MOVES): a vanilla animation (the Warden's
// roar), a looping one held for a while (the Allay's dance), a property (the Referee's cheer), or
// something the script does (Chris turning to the player, falling in; the Enderman's blink).
//
// Moods: a player who gets a Star celebrates, and one who loses a Star or coins they didn't spend is
// sad (moodOf); the loop watches every seat for it, so no change of coins anywhere is missed.
import playerPack from "../../resource_pack/animations/blockparty.player.animation.json";
import npcPack from "../../resource_pack/animations/blockparty.npc.animation.json";
import ownPack from "../../resource_pack/animations/blockparty.animation.json";

/** One animation of the pack's: its name, how long it plays, and whether it loops. */
export interface Clip {
  name: string;
  seconds: number;
  loops: boolean;
}

/** The players' animation sets (the dialogue tool's "Player" actions). */
export const PLAYER_SETS = ["Celebration", "Sad", "Dice roll", "Select"] as const;
export type PlayerSet = (typeof PLAYER_SETS)[number];

/** Whose the players' sets are, in an animation's name and in the dialogue tool's actions. */
export const PLAYER = "Player";

const PREFIX = "animation.blockparty.";

/** A name from the dialogue tool ("Dice roll", "Wandering Trader") as an animation name's part ("dice_roll", "wandering_trader"). */
export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface AnimationFile {
  animations?: Record<string, { animation_length?: number; loop?: boolean | string; bones?: Record<string, unknown> }>;
}

/** The longest keyframe time in an animation with no length of its own (how long Bedrock plays it). */
function lastKeyframe(bones: Record<string, unknown> | undefined): number {
  let last = 0;
  for (const bone of Object.values(bones ?? {})) {
    for (const channel of Object.values((bone ?? {}) as Record<string, unknown>)) {
      if (!channel || typeof channel !== "object" || Array.isArray(channel)) continue;
      for (const time of Object.keys(channel)) {
        const at = Number(time);
        if (Number.isFinite(at)) last = Math.max(last, at);
      }
    }
  }
  return last;
}

/** Every animation in the given animation files, by name. */
export function clipsIn(files: readonly AnimationFile[]): Map<string, Clip> {
  const clips = new Map<string, Clip>();
  for (const file of files) {
    for (const [name, animation] of Object.entries(file.animations ?? {})) {
      const seconds = typeof animation.animation_length === "number" ? animation.animation_length : lastKeyframe(animation.bones);
      clips.set(name, { name, seconds, loops: animation.loop === true });
    }
  }
  return clips;
}

/** The game's own animations (its resource pack's animation files). */
export const CLIPS: ReadonlyMap<string, Clip> = clipsIn([playerPack, npcPack, ownPack] as AnimationFile[]);

/**
 * The animations an owner's action plays, one picked at random each time: the one named after it,
 * and every variant of it (a name one part longer). Empty when the pack has none.
 */
export function variantsOf(clips: ReadonlyMap<string, Clip>, owner: string, action: string): Clip[] {
  const base = `${PREFIX}${slug(owner)}.${slug(action)}`;
  const found: Clip[] = [];
  for (const [name, clip] of clips) {
    if (name === base) found.push(clip);
    else if (name.startsWith(`${base}.`) && !name.slice(base.length + 1).includes(".")) found.push(clip);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** One of `clips`, by `random` (undefined for none). */
export function pickClip(clips: readonly Clip[], random: () => number): Clip | undefined {
  if (clips.length === 0) return undefined;
  return clips[Math.min(clips.length - 1, Math.floor(random() * clips.length))];
}

/** What the script does for a move, besides any animation. */
export type Deed = "look" | "fall in" | "teleport" | "drop star";

/** A move that isn't (only) the pack's animation named after it. */
export interface NpcMove {
  /** The animation it plays instead of the one named after it (a vanilla one, or the pack's under an older name). */
  animation?: string;
  /** A looping animation or a property is held this many seconds, then the NPC rests again; "stays" never rests (the Warden dug in, till the game takes him away). */
  hold?: number | "stays";
  /** A bool property switched on while it's held (the Referee's cheer). */
  property?: string;
  /** What the script does too. */
  deed?: Deed;
  /**
   * It comes out of hiding (SHOWN): an NPC that starts hidden (the Warden, so he's never seen
   * standing before he emerges) is shown once its animation has begun, out of sight underground.
   */
  appear?: boolean;
  /** It's hidden (SHOWN off) this many seconds in, once its animation has it out of sight (the Warden dug in). */
  vanish?: number;
}

/** The bool property that shows an NPC which starts hidden (the Warden's entity; npcs.ts NpcRole.shows). */
export const SHOWN = "blockparty:shown";

/**
 * The characters' moves that aren't just the pack's animation named after them, by character and
 * action as the dialogue tool names them. Everything else plays animation.blockparty.<character>.<action>.
 */
export const NPC_MOVES: Readonly<Record<string, Readonly<Record<string, NpcMove>>>> = {
  Chris: {
    "Look at the player": { deed: "look" },
    "Fall in": { deed: "fall in" },
  },
  Warden: {
    Roar: { animation: "animation.warden.roar" },
    "Sonic boom": { animation: "animation.warden.sonic_boom" },
    Sniff: { animation: "animation.warden.sniff" },
    // He's hidden until his emerge has begun (it starts 4 blocks down), and hidden again as his dig
    // has him 2.5 blocks down, held there: never seen standing before or after (the user's look).
    Emerge: { animation: "animation.warden.emerge", appear: true },
    "Dig away": { animation: "animation.warden.dig", hold: "stays", vanish: 4.6 },
  },
  Enderman: {
    Teleport: { deed: "teleport" },
  },
  Referee: {
    Cheer: { property: "blockparty:cheer", hold: 2.5 },
  },
  Allay: {
    Dance: { animation: "animation.allay.dance", hold: 2.75 },
    "Drop a Star": { deed: "drop star" },
  },
  "Iron Golem": {
    Attack: { animation: "animation.blockparty.golem_hit" },
  },
  Zombie: {
    Attack: { animation: "animation.blockparty.zombie_hit" },
  },
};

/** How a character's action plays: the animations to pick from, and the table's move (if it has one). Nothing to do when both are empty. */
export function npcMove(clips: ReadonlyMap<string, Clip>, character: string, action: string): { clips: Clip[]; move?: NpcMove } {
  const move = NPC_MOVES[character]?.[action];
  if (move?.animation) {
    // A vanilla animation's length isn't known here: a held one's hold says how long it plays.
    const own = clips.get(move.animation);
    return { clips: [own ?? { name: move.animation, seconds: typeof move.hold === "number" ? move.hold : 0, loops: false }], move };
  }
  return { clips: variantsOf(clips, character, action), move };
}

/**
 * Every move a character has (for the Tests' NPC menus): the table's, then each action the pack has
 * animations for, its name made from the animation's ("look_at_the_player" is "Look at the player").
 */
export function movesOf(clips: ReadonlyMap<string, Clip>, character: string): string[] {
  const moves = Object.keys(NPC_MOVES[character] ?? {});
  const prefix = `${PREFIX}${slug(character)}.`;
  for (const name of clips.keys()) {
    if (!name.startsWith(prefix)) continue;
    const part = name.slice(prefix.length).split(".")[0];
    if (moves.some((move) => slug(move) === part)) continue;
    const words = part.replace(/_/g, " ");
    moves.push(words.charAt(0).toUpperCase() + words.slice(1));
  }
  return moves;
}

/** Every animation of a players' set's, by name (for the Tests' Player animations). */
export function playerClips(clips: ReadonlyMap<string, Clip>): Clip[] {
  return PLAYER_SETS.flatMap((set) => variantsOf(clips, PLAYER, set));
}

/** The NPC role (npcs.ts, its entity blockparty:<role>) a character of the dialogue tool is. */
export function roleOf(character: string): string {
  return slug(character);
}

/** A seat's coins and Stars, as the loop last saw them. */
export interface CoinsAndStars {
  coins: number;
  stars: number;
}

/**
 * How a change of a seat's coins and Stars makes its player feel: a Star gained is a Celebration
 * (a Star bought too, whatever it cost), a Star lost or coins lost is Sad, except coins they spent
 * themselves (`spent`: a shop, a bet, a reroll, a Battle's pot). Gaining coins does nothing.
 */
export function moodOf(before: CoinsAndStars, after: CoinsAndStars, spent = 0): PlayerSet | undefined {
  if (after.stars > before.stars) return "Celebration";
  if (after.stars < before.stars) return "Sad";
  if (after.coins < before.coins - spent) return "Sad";
  return undefined;
}

/** A line's action, as the dialogue tool writes it (dialogue.json's actions). */
export interface LineAction {
  /** "Speaker", "Player" ({player}), "Other" ({other}), "Every player", or a character by name. */
  who: string;
  action: string;
  /** "Start", "End", or "After" `seconds`. */
  when: string;
  seconds?: number;
}

/**
 * A line's actions as they play: the file's, and the speaker talking as the line starts when the
 * file gives the speaker nothing to do then (a line by "Game", or a character with no Talk, never
 * talks).
 */
export function withTalk(actions: readonly LineAction[], character: string, talks: boolean): LineAction[] {
  if (character === "Game" || !talks) return [...actions];
  const speakerStarts = actions.some((action) => action.who === "Speaker" && action.when === "Start");
  return speakerStarts ? [...actions] : [{ who: "Speaker", action: "Talk", when: "Start" }, ...actions];
}

/** Whether a character has a Talk of its own in the pack (or the table). */
export function talks(clips: ReadonlyMap<string, Clip>, character: string): boolean {
  const { clips: found, move } = npcMove(clips, character, "Talk");
  return found.length > 0 || move !== undefined;
}

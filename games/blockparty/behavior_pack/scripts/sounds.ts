// Block Party's sound cues (docs/plans/block-party-ui.md, "Sounds"), from games/blockparty/sounds.json,
// which the user's dialogue editor writes (its Sounds view; install it, never edit it by hand): each
// cue is a list of sounds, one picked at random each time, with its volume, pitch and delay.
//   voice:<character>   a character's voice: one for every sentence they say in the dialogue box
//   line:<id>           a line's own sound, played as it starts in place of the voice
//   event:<id>          a game event (the dialogue box opening, its buttons, a vote, ...)
//   action:<owner>/<action>  a player's or an NPC's action (pass 10)
// Everyone hears every cue (the view is shared). A cue with no sounds is silent.
import { system, world } from "@minecraft/server";
import soundMap from "../../sounds.json";

export interface CuePlay {
  sound: string;
  volume: number;
  pitch: number;
  /** Seconds before it plays. */
  delay: number;
}

const CUES: Readonly<Record<string, readonly CuePlay[]>> = (soundMap as { cues?: Record<string, CuePlay[]> }).cues ?? {};

export const voiceCue = (character: string) => `voice:${character}`;
export const lineCue = (id: string) => `line:${id}`;
export const eventCue = (id: string) => `event:${id}`;

/** Whether a cue has any sound. */
export function hasCue(key: string): boolean {
  return (CUES[key]?.length ?? 0) > 0;
}

/** One of a cue's sounds, at random; undefined when it has none. */
export function pickCue(key: string, random: () => number = Math.random): CuePlay | undefined {
  const plays = CUES[key];
  if (!plays || plays.length === 0) return undefined;
  return plays[Math.min(plays.length - 1, Math.floor(random() * plays.length))];
}

/** Plays one of a cue's sounds to everyone (each hears it where they are). False when the cue has none. */
export function playCue(key: string, random: () => number = Math.random): boolean {
  const play = pickCue(key, random);
  if (!play) return false;
  const sound = () => {
    for (const player of world.getAllPlayers()) {
      try {
        player.playSound(play.sound, { volume: play.volume, pitch: play.pitch });
      } catch {
        // gone, or a sound this client hasn't got
      }
    }
  };
  if (play.delay > 0) system.runTimeout(sound, Math.round(play.delay * 20));
  else sound();
  return true;
}

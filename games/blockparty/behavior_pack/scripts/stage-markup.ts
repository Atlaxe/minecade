// What a Block Party board marks for its stage (docs/plans/block-party.md, "Stages and camera
// anchors"), as the game's config asks it of a board map (map.points, the Game marker tool) and as
// the game reads it (stage.ts). Plain data, read by game.config.ts too.
//   - Pre-game podium: 4 spots, the seats in order (1 to 4), with a wider gap between the 2nd and
//     the 3rd so the podium camera sees Chris between them.
//   - Chris: where Chris stands, each marker with a Type (its screen's Type list) saying when. For
//     now the one type is Pre-game: Chris at the podium, facing the players. Kept as
//     "chris.<type>" keys ("chris.pregame").
//   - Podium camera: placed standing where the camera goes, with your facing taken (Take my facing):
//     the shot is what you see from there. Without one, the camera stands behind the podium.
//   - Intro shots: as many as you like, in order, each placed the same way; the camera eases from
//     each to the next while Chris welcomes everyone.
// Every row can be turned off (Checklist Features): a board without them gets stand-ins (Start's
// corners for the podium, Chris on the next space, a camera behind Start, high shots round the board).
import type { MapAdjustable, MapEntryRequirement } from "@minecade/minigame-core/config";

export const STAGE_POINTS = {
  podium: "podium",
  chris: "chris",
  podiumCamera: "podiumCamera",
  intro: "intro",
} as const;

/** Chris's types: when he stands at a Chris marker. */
export const CHRIS_TYPES = [{ id: "pregame", name: "Pre-game" }] as const;

/** The map key of Chris's markers of one type ("chris.pregame"). */
export const chrisKey = (type: (typeof CHRIS_TYPES)[number]["id"]) => `${STAGE_POINTS.chris}.${type}`;

export const STAGE_MARKUP: Record<string, MapEntryRequirement> = {
  [STAGE_POINTS.podium]: { label: "Pre-game podium", count: 4, marker: "player" },
  [STAGE_POINTS.chris]: { label: "Chris", marker: "player", types: CHRIS_TYPES.map((type) => ({ ...type })) },
  [STAGE_POINTS.podiumCamera]: { label: "Podium camera" },
  [STAGE_POINTS.intro]: { label: "Intro shots", count: 2 },
};

/** Each stage row can be turned off by a map (Probe's maps, which Block Party borrows, have none). */
export const STAGE_ADJUSTABLE: Record<string, MapAdjustable> = Object.fromEntries(Object.keys(STAGE_MARKUP).map((name) => [`points.${name}`, { off: true }]));

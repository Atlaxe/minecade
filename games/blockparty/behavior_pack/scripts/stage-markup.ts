// What a Block Party board marks for its stage (pass 6; docs/plans/block-party.md, "Stages and
// camera anchors"), as the game's config asks it of a board map (map.points, the Game marker tool)
// and as the game reads it (stage.ts). Plain data, read by game.config.ts too.
//   - Podium lineup: 4 spots, the seats in order, with a wider gap between the 2nd and the 3rd so the
//     podium camera sees Chris between them.
//   - Chris at the podium: where Chris stands, further back, facing the lineup.
//   - Podium camera: placed standing where the camera goes, with your facing taken (Take my facing):
//     the shot is what you see from there.
//   - Intro shots: as many as you like, in order, each placed the same way; the camera eases from
//     each to the next while Chris welcomes everyone.
// Every row can be turned off (Checklist Features): a board without them gets stand-ins (Start's
// corners for the lineup, Chris on the next space, a camera behind Start, high shots round the board).
import type { MapAdjustable, MapEntryRequirement } from "@minecade/minigame-core/config";

export const STAGE_POINTS = {
  lineup: "lineup",
  chris: "chris",
  podiumCamera: "podiumCamera",
  intro: "intro",
} as const;

export const STAGE_MARKUP: Record<string, MapEntryRequirement> = {
  [STAGE_POINTS.lineup]: { label: "Podium lineup", count: 4, marker: "player" },
  [STAGE_POINTS.chris]: { label: "Chris at the podium", marker: "player" },
  [STAGE_POINTS.podiumCamera]: { label: "Podium camera" },
  [STAGE_POINTS.intro]: { label: "Intro shots", count: 2 },
};

/** Each stage row can be turned off by a map (Probe's maps, which Block Party borrows, have none). */
export const STAGE_ADJUSTABLE: Record<string, MapAdjustable> = Object.fromEntries(Object.keys(STAGE_MARKUP).map((name) => [`points.${name}`, { off: true }]));

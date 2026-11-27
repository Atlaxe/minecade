// King of the Hill (FFA; docs/plans/block-party-minigames.md): hold the Hill. Every second you're on
// it alone scores a point; a shared second scores nobody. Hits knock others off (Knockback). A fall
// (Kill Y) puts you back at your spawn a moment later. Most points at time wins. Bots head onto the
// hill and hit anyone in reach.
import { MARKUP } from "./arenas.ts";
import { botBrawl, clock, everyTick, fellOut, floorOf, moveTo, onPlan, placesBy } from "./common.ts";
import { inOrder, middleOf, over, type MinigameDef, type Outcome, type Play } from "./kit.ts";

export const HILL: MinigameDef = {
  id: "hill",
  name: "King of the Hill",
  kind: "ffa",
  rules: "Stand on the hill alone to score. Knock the others off.",
  tutorial: [
    {
      objective: "Every second you're on the hill alone scores a point; a shared second scores nobody. Knock the others off. Most points wins.",
      controls: [
        { input: "move", what: "Get on the hill" },
        { input: "attack", what: "Knock them off" },
        { input: "jump", what: "Climb up" },
      ],
    },
  ],
  ...onPlan("hill"),
  problem(field) {
    return field.regions(MARKUP.hill)[0] ? undefined : "its arena map has no Hill";
  },
  spawns(field, sides) {
    return inOrder(field.spawns, sides);
  },
  async play(play: Play): Promise<Outcome> {
    const { field, scope } = play;
    const hill = field.regions(MARKUP.hill)[0];
    const top = middleOf(hill);
    const everyone = play.sides.flat();
    const starts = new Map(everyone.map((who, i) => [who.key, field.spawns[i] ?? field.spawns[0]]));
    const strength = play.setting("knockback") / 10;
    const total = play.setting("playTime") * 20;
    const respawn = play.setting("respawn") * 20;
    const floorY = floorOf(field.spawns, field);
    const points = new Map(everyone.map((who) => [who.key, 0]));
    const lastHit = new Map<string, number>();
    const down = new Set<string>();
    play.hits("push", strength);
    let king: string | undefined;
    await everyTick(play, total, (tick) => {
      const onHill: string[] = [];
      for (const who of play.inPlay()) {
        const body = play.bodyOf(who);
        if (!body || down.has(who.key)) continue;
        if (fellOut(field, body, floorY)) {
          down.add(who.key);
          play.tell(who, "You fell! Back in a moment.");
          scope.timeout(() => {
            down.delete(who.key);
            const start = starts.get(who.key);
            if (start) moveTo(who, play.bodyOf(who), start);
          }, Math.max(1, respawn));
          continue;
        }
        if (over(hill, body.location, 1, 2)) onHill.push(who.key);
        if (!who.player) botBrawl(play, who, play.inPlay(), strength, lastHit, top);
      }
      king = onHill.length === 1 ? onHill[0] : undefined;
      if (tick % 20 === 19 && king) points.set(king, (points.get(king) ?? 0) + 1);
      if (tick % 5 === 0) {
        const kingName = everyone.find((who) => who.key === king)?.name;
        play.status(`${kingName ? `King: ${kingName}  ` : ""}${everyone.map((who) => `${who.name} ${points.get(who.key)}`).join("  ")}  ${clock(total - tick)}`);
      }
    });
    return { places: placesBy(everyone.map((who) => who.key), (key) => points.get(key) ?? 0) };
  },
};

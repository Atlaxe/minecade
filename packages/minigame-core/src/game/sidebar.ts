// The scoreboard sidebar for a game's scores. Objectives persist in the world, so a crashed game
// can leave one behind: every Minecade objective starts with "mc_", and leftovers are removed
// when a server boots.
import { DisplaySlotId, ObjectiveSortOrder, world, type ScoreboardObjective } from "@minecraft/server";
import type { Scope } from "../scope.ts";

const PREFIX = "mc_";

export function removeLeftoverObjectives(): void {
  for (const objective of world.scoreboard.getObjectives()) {
    if (objective.id.startsWith(PREFIX)) world.scoreboard.removeObjective(objective);
  }
}

export class Sidebar {
  private readonly objective: ScoreboardObjective;
  private readonly shown = new Map<string, number>();

  /** Shows a new sidebar until `scope` is disposed. */
  constructor(scope: Scope, id: string, title: string) {
    const objectiveId = `${PREFIX}${id}`;
    if (world.scoreboard.getObjective(objectiveId)) world.scoreboard.removeObjective(objectiveId);
    this.objective = world.scoreboard.addObjective(objectiveId, title);
    world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: this.objective, sortOrder: ObjectiveSortOrder.Descending });
    scope.add(() => {
      world.scoreboard.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
      world.scoreboard.removeObjective(objectiveId);
    });
  }

  /** Shows exactly these lines, changing only what differs from last time. */
  show(lines: [label: string, value: number][]): void {
    const wanted = new Map(lines);
    for (const label of this.shown.keys()) {
      if (!wanted.has(label)) {
        this.objective.removeParticipant(label);
        this.shown.delete(label);
      }
    }
    for (const [label, value] of wanted) {
      if (this.shown.get(label) === value) continue;
      this.objective.setScore(label, value);
      this.shown.set(label, value);
    }
  }
}

// Map viewer spike, the BDS half of step 1 (bds-check.ts bundles it with the spots to check as
// SPOTS): once every spot's chunk is loaded, prints the block BDS has at each.
//   scriptevent viewer:probe     prints "VIEWER|" lines, then "VIEWER|done"
import { system, world } from "@minecraft/server";

declare const SPOTS: [x: number, y: number, z: number][];

const out = (value: unknown) => console.log(`VIEWER|${JSON.stringify(value)}`);

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "viewer:probe") return;
  const dimension = world.getDimension("overworld");
  let tries = 0;
  const run = system.runInterval(() => {
    tries++;
    const waiting = SPOTS.filter(([x, , z]) => {
      try {
        return dimension.getBlock({ x, y: 0, z }) === undefined;
      } catch {
        return true;
      }
    });
    if (waiting.length > 0 && tries < 600) return;
    system.clearRun(run);
    if (waiting.length > 0) out({ error: `${waiting.length} spots' chunks never loaded` });
    for (const [x, y, z] of SPOTS) {
      try {
        const block = dimension.getBlock({ x, y, z });
        out(block ? { x, y, z, name: block.typeId, states: block.permutation.getAllStates() } : { x, y, z, none: true });
      } catch (error) {
        out({ x, y, z, error: String(error) });
      }
    }
    out("done");
  }, 5);
});

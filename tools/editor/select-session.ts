// The Select server: a copy of a converted world (with the void generator, so flying past it grows
// nothing; the world itself is never opened), where map editors box maps. Saving a box as a map
// queues its extraction (selections.ts); the list and how each extraction is going reach the pack,
// which shows them in the map menu. Nothing in Select mode is saved: stopping just stops.
import { cp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EditorEvent, SelectInfo, SelectionInfo } from "@minecade/minigame-core/config";
import { voidGenerator } from "../build/bake-core.ts";
import { enableBetaApis, patchLevelDat } from "../build/leveldat.ts";
import type { SelectStatus } from "./editor-core.ts";
import { centerOffset, insideBox, mapIdProblem } from "./select-core.ts";
import type { Selections } from "./selections.ts";
import { RUNTIME_FILES, ServerSession, root, type SessionBase } from "./server-session.ts";
import { listTargets, type EditorTarget } from "./targets.ts";
import type { World } from "./worlds.ts";

export class SelectSession extends ServerSession {
  private readonly world: World;
  private readonly selections: Selections;
  private targets: (EditorTarget & { maps: string[] })[] = [];
  private infos: SelectionInfo[] = [];
  private offChange: (() => void) | undefined;

  constructor(options: SessionBase & { world: World; selections: Selections }) {
    super(options);
    this.world = options.world;
    this.selections = options.selections;
  }

  status(): SelectStatus {
    return { ...this.common(), mode: "select", world: this.world.name, worldPath: this.world.path, selections: this.infos };
  }

  /** A map in the list, from the Panel or the pack: retry, forget or update. Why not, when it can't. */
  async mapAction(by: string, action: "retry" | "forget" | "update", target: string, map: string): Promise<string | undefined> {
    const problem = await this.selections.act(this.world.name, action, target, map);
    if (problem) this.note(`${by}: can't ${action} ${target}/${map}: ${problem}`);
    else this.note(`${by}: ${action} ${target}/${map}`);
    return problem;
  }

  protected label(): string {
    return `Select mode on "${this.world.name}"`;
  }

  protected async prepare(): Promise<void> {
    await this.selections.open(this.world);
    this.targets = await listTargets(root);
    this.infos = await this.selections.infos(this.world.name);
    this.offChange = this.selections.onChange((world, info, gone) => {
      if (world !== this.world.name) return;
      const same = (candidate: SelectionInfo) => candidate.target === info.target && candidate.map === info.map;
      if (gone) this.infos = this.infos.filter((candidate) => !same(candidate));
      else this.infos = this.infos.some(same) ? this.infos.map((candidate) => (same(candidate) ? info : candidate)) : [...this.infos, info];
      if (this.state !== "ready") return;
      // The runner says when one is ready or failed.
      void this.send(gone ? { t: "forgotten", target: info.target, map: info.map } : { t: "selection", item: info });
    });
  }

  /** The world's copy, with the void generator; editor.json in Select mode. */
  protected async stage(dir: string): Promise<void> {
    const world = join(dir, "world");
    this.note(`Copying "${this.world.name}" for Select mode (the world itself is never opened)...`);
    await cp(this.world.path, world, { recursive: true });
    for (const file of RUNTIME_FILES) await rm(join(world, file), { force: true });
    await patchLevelDat(join(world, "level.dat"), (dat) => {
      voidGenerator(dat);
      // The editor's pack reads its settings through @minecraft/server-admin, a Beta API.
      enableBetaApis(dat);
    });
    await writeFile(join(dir, "map.json"), JSON.stringify({ name: this.world.name, spawns: [[0, 64, 0]] }));
    const info: SelectInfo = {
      mode: "select",
      world: this.world.name,
      editors: this.editors,
      targets: this.targets.map(({ id, name, maps }) => ({ id, name, maps })),
      selections: this.infos,
    };
    await writeFile(join(dir, "editor.json"), JSON.stringify(info));
  }

  protected onEvent(event: EditorEvent): void {
    switch (event.t) {
      case "saveMap":
        void this.saveMap(event);
        return;
      case "mapAction":
        void this.mapAction(event.by, event.action, event.target, event.map).then((problem) => {
          if (problem) void this.say(`§c${problem}`, event.by);
        });
        return;
    }
  }

  private async saveMap(event: Extract<EditorEvent, { t: "saveMap" }>): Promise<void> {
    const target = this.targets.find((candidate) => candidate.id === event.target);
    const name = event.name.trim();
    const file = await this.selections.open(this.world);
    const problem = !target
      ? `there is no target "${event.target}"`
      : !name
        ? "the map needs a name"
        : !insideBox(event.box, event.spawn)
          ? "stand inside the box when you save it: that's where the first spawn goes"
          : mapIdProblem(event.map, target.maps, file.selections, target.id);
    if (problem || !target) {
      void this.say(`§c${problem}`, event.by);
      return;
    }
    await this.selections.add(this.world.name, { target: target.id, map: event.map, name, box: event.box, offset: centerOffset(event.box), spawn: event.spawn });
    this.note(`${event.by}: ${target.name}, ${name} (${event.map}) queued for extraction.`);
    void this.say(`${name} (${event.map}) is queued: it's cut out and moved to the middle in the background. You can box the next map meanwhile.`, event.by);
  }

  protected async afterReady(): Promise<void> {
    // The pack got the list in editor.json; changes since then follow.
    for (const info of this.infos) await this.send({ t: "selection", item: info });
  }

  protected async shutdown(): Promise<void> {
    this.offChange?.();
    await this.plainShutdown(`Stopped Select mode on "${this.world.name}".`);
  }
}

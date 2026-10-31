// The editor lobby's server: where everyone joins (port 19132). A void world where the pack keeps
// players in the dark with a form that can't be closed: open a map in Edit, or copy a world into
// Select. Its HomeState (what can be opened, and what's open) comes from the runner, which sends it
// again whenever it changes. Nothing here is saved.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { splitHome, type EditorEvent, type HomeInfo, type HomeState } from "@minecade/minigame-core/config";
import { bakeSettings } from "../build/bake-core.ts";
import { enableBetaApis, readLevelDat, writeLevelDat } from "../build/leveldat.ts";
import type { HomeStatus } from "./editor-core.ts";
import { ServerSession, root, type SessionBase } from "./server-session.ts";

/** A level.dat written by BDS (bake's): the lobby's void world starts from it. */
const BASE_LEVEL_DAT = join(root, "tools", "build", "fixtures", "base-level.dat");
/** Where players appear: the pack shuts them in a small dark cell here. */
const SPAWN: [number, number, number] = [0, 100, 0];

export class HomeSession extends ServerSession {
  private readonly home: () => Promise<HomeState>;
  private homeId = 0;
  private sending: Promise<unknown> = Promise.resolve();

  constructor(options: SessionBase & { home(): Promise<HomeState> }) {
    super(options);
    this.home = options.home;
  }

  status(): HomeStatus {
    return { ...this.common(), mode: "home" };
  }

  /** Sends the pack the lobby's state as it is now (one send at a time, so parts never mix). */
  update(): Promise<unknown> {
    this.sending = this.sending.then(async () => {
      if (this.state !== "ready") return;
      const id = ++this.homeId;
      for (const part of splitHome(await this.home(), id)) await this.send(part);
    });
    return this.sending;
  }

  protected label(): string {
    return "the editor lobby";
  }

  protected async prepare(): Promise<void> {}

  /** A void world (a level.dat without db/, so BDS makes every chunk from it), and the lobby's state. */
  protected async stage(dir: string): Promise<void> {
    const world = join(dir, "world");
    await mkdir(world, { recursive: true });
    const dat = await readLevelDat(BASE_LEVEL_DAT);
    bakeSettings(dat, { name: "Editor lobby", spawns: [SPAWN] });
    enableBetaApis(dat);
    await writeLevelDat(join(world, "level.dat"), dat);
    await writeFile(join(world, "levelname.txt"), "Editor lobby");
    await writeFile(join(dir, "map.json"), JSON.stringify({ name: "Editor lobby", spawns: [SPAWN] }));
    const info: HomeInfo = { mode: "home", home: await this.home() };
    await writeFile(join(dir, "editor.json"), JSON.stringify(info));
  }

  protected onEvent(_event: EditorEvent): void {}

  protected async afterReady(): Promise<void> {}

  protected async shutdown(): Promise<void> {
    await this.plainShutdown("Stopped the editor lobby.");
  }
}

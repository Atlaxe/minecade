// The Camera tool: preview pictures. A use places a camera at your eyes at once, looking where you
// look ("Camera 1", "Camera 2" and on), of the kind set in the tool's settings: a map preview (the
// map's tile and hologram picture in the lobby, nobody in the shot) or a game picture (the game's
// picture, where you can walk into the shot). Right click a camera's marker for its form (its
// kind, Delete).
// The Snapshot tool takes the pictures: a use lists the cameras, and hitting a camera's marker
// (with anything) picks it and puts the Snapshot tool in hand. Your view moves to the camera, with
// the HUD, markers and outlines hidden and a 16:9 frame showing what a picture keeps; nudge it,
// take the screenshot with Minecraft's own keys (F1 hides everything, F2 takes it), then use the
// tool again for Use latest screenshot, which has the host save it as the picture
// (tools/editor/shots.ts). Shift (or Back to my view) brings the player's own view back, and
// Delete camera brings it back and deletes the camera.
import { HudVisibility, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { describeError } from "@minecade/minigame-core";
import { CAMERA_KINDS, cameraActions, cameraAt, cameraText, nextCameraName, nudgeCamera, toggleStartView, type CameraKind } from "./cameras.ts";
import { frameLine } from "./hud.ts";
import { sideTitle } from "./marks.ts";
import { BACK_TEXT, ICONS, SNAPSHOT_STEPS, snapshotEntries, snapshotListEntries, type SnapshotAction } from "./menu.ts";
import { actionBar, type ToolHost } from "./tool-host.ts";

/** Long enough to last any look through. */
const LOOK_TICKS = 1_000_000;
/** The frame's title stays up this long (it's sent again after every change). */
const FRAME_TICKS = 20 * 60 * 10;
/** What the frame says once Take a screenshot is picked. */
const SHOOT_LINE = "§fF1 hides everything, F2 takes the screenshot, F1 brings it back. Then use the Snapshot tool again.";
/** What the frame says otherwise. */
const FRAME_LINE = "§7Shift: back to your view";

export interface CameraHost extends ToolHost {
  /** "Sumo", or "Lobby" (a lobby map has no picture). */
  readonly targetName: string;
  /** Asks the host to save the newest screenshot on its PC as the map's thumbnail or the game's. */
  picture(player: Player, kind: CameraKind): void;
  /** Someone started or stopped looking through a camera, or its kind changed: markers and outlines hide while anyone does, mannequins while anyone looks through a map preview. */
  lookChanged(): void;
  /** Puts the Snapshot tool in the player's hand (a camera's marker was hit with something else). */
  holdSnapshot(player: Player): void;
}

export class CameraTool {
  private readonly host: CameraHost;
  /** The kind new cameras get, per player. */
  private readonly kinds = new Map<string, CameraKind>();
  /** Who is looking through which camera, and the Snapshot's Step they last picked. */
  private readonly looking = new Map<string, { name: string; kind: CameraKind }>();
  private readonly steps = new Map<string, number>();

  constructor(host: CameraHost) {
    this.host = host;
  }

  kindOf(player: Player): CameraKind {
    return this.kinds.get(player.name.toLowerCase()) ?? "map";
  }

  toggleKind(player: Player): void {
    this.kinds.set(player.name.toLowerCase(), this.kindOf(player) === "map" ? "game" : "map");
  }

  isLooking(player: Player): boolean {
    return this.looking.has(player.name.toLowerCase());
  }

  anyoneLooking(): boolean {
    return this.looking.size > 0;
  }

  /** Whether anyone looks through a camera of this kind (a map preview keeps mannequins out of the shot). */
  anyoneLookingAt(kind: CameraKind): boolean {
    return [...this.looking.values()].some((looking) => looking.kind === kind);
  }

  /** A use: a new camera at the player's eyes, looking their way, of the kind in the tool's settings. */
  use(player: Player): void {
    const kind = this.kindOf(player);
    const name = nextCameraName(this.host.map());
    const camera = cameraAt(player.getHeadLocation(), player.getRotation(), kind);
    if (this.host.edit(player, { op: "camera", name, camera })) actionBar(player, `${name} placed (${CAMERA_KINDS[kind].label.toLowerCase()}): hit it to take its picture`);
  }

  /** The action bar line while the tool is held. */
  hint(player: Player): string {
    return `Use: place ${nextCameraName(this.host.map())} at your eyes (${CAMERA_KINDS[this.kindOf(player)].label})   Hit a camera: its picture   Right click: settings`;
  }

  /** A camera's form, from a right click on its marker or the tool's settings: its kind, and Delete. */
  async menu(player: Player, name: string, back?: () => Promise<void>): Promise<void> {
    const camera = this.host.map().cameras?.[name];
    if (!camera) return;
    const actions = cameraActions(camera);
    const form = new ActionFormData().title(sideTitle(name)).body(`${cameraText(camera)}.`);
    const offset = back ? 1 : 0;
    if (back) form.button(BACK_TEXT, ICONS.back);
    for (const { text } of actions) form.button(text);
    const response = await this.host.show(player, form);
    if (back && response?.selection === 0 && player.isValid) return back();
    const action = response?.selection === undefined ? undefined : actions[response.selection - offset]?.action;
    if (!action || !player.isValid) return;
    const now = this.host.map().cameras?.[name];
    if (!now) {
      this.host.tell(player, `${name} is gone.`);
      return;
    }
    if (action === "kind") {
      const kind = now.kind === "map" ? "game" : "map";
      this.host.edit(player, { op: "camera", name, camera: { ...now, kind } }, `${name} is a ${CAMERA_KINDS[kind].label.toLowerCase()} now.`);
      return this.menu(player, name, back);
    }
    if (action === "start") {
      const camera = toggleStartView(now);
      this.host.edit(player, { op: "camera", name, camera }, camera.startView === false ? `Players never wait looking through ${name} now.` : `Players can wait looking through ${name} now.`);
      return this.menu(player, name, back);
    }
    if (this.isLookingAt(name)) {
      this.host.tell(player, `Someone is looking through ${name}: it can't be deleted now.`);
      return;
    }
    this.host.edit(player, { op: "camera", name }, `${name} deleted.`);
  }

  // ---- The Snapshot tool ----------------------------------------------------------------------

  /** A use of the Snapshot tool: its menu for the camera the player looks through, else the cameras to pick from. */
  async snapshot(player: Player): Promise<void> {
    const looking = this.looking.get(player.name.toLowerCase());
    if (looking && this.host.map().cameras?.[looking.name]) return this.snapshotMenu(player, looking.name);
    if (looking) this.stop(player);
    return this.pickCamera(player);
  }

  /** A camera picked from its marker or the map menu: the Snapshot tool in hand, the view through it, and its menu. */
  async snapshotOf(player: Player, name: string): Promise<void> {
    this.host.holdSnapshot(player);
    if (!this.look(player, name)) return;
    return this.snapshotMenu(player, name);
  }

  /** The cameras: tap one to look through it. */
  private async pickCamera(player: Player): Promise<void> {
    const entries = snapshotListEntries(this.host.map());
    const form = new ActionFormData().title(sideTitle("Snapshot"));
    for (const entry of entries) form.button(entry.text);
    const response = await this.host.show(player, form);
    const name = response?.selection === undefined ? undefined : entries[response.selection]?.camera;
    if (!name || !player.isValid) return;
    if (!this.look(player, name)) return;
    return this.snapshotMenu(player, name);
  }

  /** While looking through `name`: nudge it, take the screenshot, use it, or come back. */
  private async snapshotMenu(player: Player, name: string): Promise<void> {
    const key = player.name.toLowerCase();
    for (;;) {
      const camera = this.host.map().cameras?.[name];
      if (!camera || !this.isLooking(player)) return;
      const step = this.steps.get(key) ?? 1;
      const entries = snapshotEntries({ camera, step, lobby: this.host.rules.kind === "lobby" });
      const form = new ActionFormData().title(sideTitle(name));
      for (const entry of entries) form.button(entry.text, entry.icon);
      const response = await this.host.show(player, form);
      const action: SnapshotAction | undefined = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      switch (action.kind) {
        case "none":
          continue;
        case "back":
          return this.pickCamera(player);
        case "stop":
          this.stop(player);
          return;
        case "shoot":
          this.frame(player, SHOOT_LINE);
          return;
        case "use":
          this.host.picture(player, camera.kind);
          this.stop(player);
          return;
        case "step":
          this.steps.set(key, action.step);
          continue;
        case "delete":
          if (this.deleteFromSnapshot(player, name)) return;
          continue;
        case "kind": {
          const kind = camera.kind === "map" ? "game" : "map";
          this.host.edit(player, { op: "camera", name, camera: { ...camera, kind } });
          this.lookAs(player, kind);
          continue;
        }
        default: {
          const size = SNAPSHOT_STEPS[step] ?? SNAPSHOT_STEPS[1];
          const nudged =
            action.kind === "move"
              ? nudgeCamera(camera, { axis: action.axis, by: action.by * size.move })
              : action.kind === "turn"
                ? nudgeCamera(camera, { turn: action.by * size.turn })
                : nudgeCamera(camera, { tilt: action.by * size.turn });
          if (this.host.edit(player, { op: "camera", name, camera: nudged })) this.view(player, nudged.at);
        }
      }
    }
  }

  /** Delete camera, while looking through it: the player's view comes back and it's deleted (Undo brings it back). False when someone else looks through it. */
  private deleteFromSnapshot(player: Player, name: string): boolean {
    const others = [...this.looking].some(([key, looking]) => looking.name === name && key !== player.name.toLowerCase());
    if (others) {
      this.host.tell(player, `Someone else is looking through ${name}: it can't be deleted now.`);
      return false;
    }
    this.stop(player);
    this.host.edit(player, { op: "camera", name }, `${name} deleted.`);
    return true;
  }

  /** Moves the player's view to the camera, with the HUD (and, for a map preview, the player) hidden, and the frame shown. False when it couldn't. */
  look(player: Player, name: string): boolean {
    const camera = this.host.map().cameras?.[name];
    if (!camera) return false;
    const was = this.looking.get(player.name.toLowerCase());
    try {
      this.view(player, camera.at);
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide);
      if (was && was.kind !== camera.kind) this.lookAs(player, camera.kind);
      else if (!was && camera.kind === "map") player.addEffect("invisibility", LOOK_TICKS, { showParticles: false });
    } catch (error) {
      this.host.tell(player, `§cCouldn't look through ${name}: ${describeError(error)}`);
      this.restore(player, camera.kind);
      this.looking.delete(player.name.toLowerCase());
      this.host.lookChanged();
      return false;
    }
    this.looking.set(player.name.toLowerCase(), { name, kind: camera.kind });
    this.frame(player);
    this.host.lookChanged();
    return true;
  }

  /** Brings the player's view back. */
  stop(player: Player): void {
    const looking = this.looking.get(player.name.toLowerCase());
    if (!looking) return;
    this.looking.delete(player.name.toLowerCase());
    this.restore(player, looking.kind);
    this.host.lookChanged();
  }

  /** A player who left: nothing to restore, the view resets when they join again. */
  forget(name: string): void {
    this.steps.delete(name.toLowerCase());
    if (this.looking.delete(name.toLowerCase())) this.host.lookChanged();
  }

  private isLookingAt(name: string): boolean {
    return [...this.looking.values()].some((looking) => looking.name === name);
  }

  /** The free camera at a camera's place and angle. */
  private view(player: Player, at: [number, number, number, number, number]): void {
    const [x, y, z, yaw, pitch] = at;
    player.camera.setCamera("minecraft:free", { location: { x, y, z }, rotation: { x: pitch, y: yaw } });
  }

  /** The player seen or not, for a camera that changed kind while they look through it. */
  private lookAs(player: Player, kind: CameraKind): void {
    const looking = this.looking.get(player.name.toLowerCase());
    if (looking) looking.kind = kind;
    try {
      if (kind === "map") player.addEffect("invisibility", LOOK_TICKS, { showParticles: false });
      else player.removeEffect("invisibility");
    } catch {
      // left meanwhile
    }
    this.host.lookChanged();
  }

  /** The 16:9 frame (hud.ts FRAME_MARK), with a line at its top. */
  private frame(player: Player, line = FRAME_LINE): void {
    try {
      player.onScreenDisplay.setTitle(frameLine(line), { fadeInDuration: 0, stayDuration: FRAME_TICKS, fadeOutDuration: 0 });
    } catch {
      // left meanwhile
    }
  }

  private restore(player: Player, kind: CameraKind): void {
    try {
      player.camera.clear();
      player.onScreenDisplay.setHudVisibility(HudVisibility.Reset);
      player.runCommand("title @s clear");
      if (kind === "map") player.removeEffect("invisibility");
    } catch {
      // left meanwhile
    }
  }
}

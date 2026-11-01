// The Camera tool: preview pictures. A use places a camera at your eyes, looking where you look
// ("Camera 1", "Camera 2" and on), of the kind picked in the tool's settings: a map preview (the
// map's tile and hologram picture in the lobby, nobody in the shot) or a game picture (the game's
// picture, where you can walk into the shot). Hit a camera's marker for its form. Look through
// moves your view to the camera with the HUD, markers and outlines hidden, so the screenshot is
// just the map; use the tool again to come back, and the host can save your newest screenshot as
// the picture (tools/editor/screenshot.ts).
import { HudVisibility, type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { describeError } from "@minecade/minigame-core";
import { CAMERA_KINDS, cameraActions, cameraAt, cameraPlace, cameraText, nextCameraName, type CameraKind } from "./cameras.ts";
import { sideTitle } from "./marks.ts";
import { BACK_TEXT, ICONS, cameraScreenEntries } from "./menu.ts";
import type { ToolHost } from "./tool-host.ts";

/** Long enough to last any look through. */
const LOOK_TICKS = 1_000_000;

export interface CameraHost extends ToolHost {
  /** "Sumo", or "Lobby" (a lobby map has no picture). */
  readonly targetName: string;
  /** Asks the host to save the newest screenshot on its PC as the map's preview or the game's picture. */
  picture(player: Player, kind: CameraKind): void;
  /** Someone started or stopped looking through a camera: markers and outlines hide while anyone does. */
  lookChanged(): void;
}

export class CameraTool {
  private readonly host: CameraHost;
  /** The kind new cameras get, per player. */
  private readonly kinds = new Map<string, CameraKind>();
  /** Who is looking through which camera. */
  private readonly looking = new Map<string, { name: string; kind: CameraKind }>();

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

  /** A use: the new camera's screen (at the player's eyes), or brings a player looking through one back. */
  async use(player: Player): Promise<void> {
    if (this.isLooking(player)) {
      this.stop(player);
      return;
    }
    let kind = this.kindOf(player);
    let camera = cameraAt(player.getHeadLocation(), player.getRotation(), kind);
    for (;;) {
      const name = nextCameraName(this.host.map());
      const place = cameraPlace(camera);
      const entries = cameraScreenEntries({ kind, at: `At ${place.at}`, looks: `Looking ${place.looks}` });
      const form = new ActionFormData().title(sideTitle(`New camera: ${name}`));
      for (const entry of entries) form.button(entry.text);
      const response = await this.host.show(player, form);
      const action = response?.selection === undefined ? undefined : entries[response.selection]?.action;
      if (!action || !player.isValid) return;
      if (action.kind === "save") {
        this.host.edit(player, { op: "camera", name, camera }, `${name} placed: ${cameraText(camera)}. Hit its marker to look through it.`);
        return;
      }
      if (action.kind === "kind") {
        kind = action.camera;
        this.kinds.set(player.name.toLowerCase(), kind);
        camera = { ...camera, kind };
      } else if (action.kind === "aim") camera = cameraAt(player.getHeadLocation(), player.getRotation(), kind);
    }
  }

  /** The action bar line while the tool is held. */
  hint(player: Player): string {
    return `Use: place ${nextCameraName(this.host.map())} at your eyes (${CAMERA_KINDS[this.kindOf(player)].label})   Hit a camera: look through it`;
  }

  /** A camera's form, from its marker or the tool's settings. */
  async menu(player: Player, name: string, back?: () => Promise<void>): Promise<void> {
    const camera = this.host.map().cameras?.[name];
    if (!camera) return;
    const lobby = this.host.rules.kind === "lobby";
    const actions = cameraActions(camera, lobby);
    const body = `${cameraText(camera)}.\n\nLook through, then take your screenshot (Windows: Win+Alt+PrtScn, or Win+PrtScn) and use the Camera tool to come back.${lobby ? "" : " Then Use my newest screenshot saves it as the picture."}`;
    const form = new ActionFormData().title(sideTitle(name)).body(body);
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
    switch (action) {
      case "look":
        this.look(player, name);
        return;
      case "picture":
        this.host.picture(player, now.kind);
        return;
      case "aim": {
        const camera = cameraAt(player.getHeadLocation(), player.getRotation(), now.kind);
        this.host.edit(player, { op: "camera", name, camera }, `${name} aimed: ${cameraText(camera)}.`);
        return;
      }
      case "kind": {
        const kind = now.kind === "map" ? "game" : "map";
        this.host.edit(player, { op: "camera", name, camera: { ...now, kind } }, `${name} is a ${CAMERA_KINDS[kind].label.toLowerCase()} now.`);
        return this.menu(player, name);
      }
      case "delete":
        this.host.edit(player, { op: "camera", name }, `${name} deleted.`);
        return;
    }
  }

  /** Moves the player's view to the camera, with the HUD (and, for a map preview, the player) hidden. */
  look(player: Player, name: string): void {
    const camera = this.host.map().cameras?.[name];
    if (!camera) return;
    const [x, y, z, yaw, pitch] = camera.at;
    // A use of the tool in hand brings them back.
    this.host.equip(player, "camera");
    try {
      player.camera.setCamera("minecraft:free", { location: { x, y, z }, rotation: { x: pitch, y: yaw } });
      player.onScreenDisplay.setHudVisibility(HudVisibility.Hide);
      player.runCommand("title @s clear");
      if (camera.kind === "map") player.addEffect("invisibility", LOOK_TICKS, { showParticles: false });
    } catch (error) {
      this.host.tell(player, `§cCouldn't look through ${name}: ${describeError(error)}`);
      this.restore(player, camera.kind);
      return;
    }
    this.looking.set(player.name.toLowerCase(), { name, kind: camera.kind });
    this.host.lookChanged();
  }

  /** Brings the player's view back, then offers to save their newest screenshot. */
  stop(player: Player): void {
    const looking = this.looking.get(player.name.toLowerCase());
    if (!looking) return;
    this.looking.delete(player.name.toLowerCase());
    this.restore(player, looking.kind);
    this.host.lookChanged();
    if (this.host.rules.kind !== "lobby") void this.offerPicture(player, looking.name, looking.kind);
  }

  /** A player who left: nothing to restore, the view resets when they join again. */
  forget(name: string): void {
    if (this.looking.delete(name.toLowerCase())) this.host.lookChanged();
  }

  private restore(player: Player, kind: CameraKind): void {
    try {
      player.camera.clear();
      player.onScreenDisplay.setHudVisibility(HudVisibility.Reset);
      if (kind === "map") player.removeEffect("invisibility");
    } catch {
      // left meanwhile
    }
  }

  private async offerPicture(player: Player, name: string, kind: CameraKind): Promise<void> {
    const what = kind === "map" ? "the map's preview in the lobby" : `${this.host.targetName}'s picture in the lobby`;
    const form = new ActionFormData()
      .title(sideTitle("Use the screenshot?"))
      .body(`Save your newest screenshot (taken in the last 10 minutes) from ${name} as ${what}? It's cropped to 16:9, and Publish puts it in the lobby.`)
      .button("Use it")
      .button("Not now");
    const response = await this.host.show(player, form);
    if (response?.selection === 0 && player.isValid) this.host.picture(player, kind);
  }
}

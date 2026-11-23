// The camera tuned in game (the user, 2026-11-23: "a way to edit the camera settings for board in
// live time when in dev"; docs/plans/block-party-ui.md, "Cameras"), while Block Party is being
// tested (spike.ts, testing):
//   - /boardcam <setting> <value> changes one of the board camera's settings (the map's Game
//     settings: distance, height, pitch, field of view and the rest, in the same units) for everyone
//     at once, the view easing to it. /boardcam alone lists them; /boardcam reset goes back to the
//     map's.
//   - /spacecam <setting> [value] changes a space's cutscene camera: its own way (yaw), pitch and
//     distance, free (its shots keep their own angles while the board camera always looks one way),
//     board (the board camera's way again), or default (none of its own). The space is the one the
//     cutscene on screen is at, else the one the turn's player stands on, or one picked with
//     /spacecam space <id> (the camera shows it; /spacecam back puts back the shot from before). The
//     shot on screen is laid again the new way.
//   - /boardcam save (or /spacecam save) keeps every change on the map: only a preview from the map
//     editor can, since the editor owns the map (map_edit, saved as the Panel would save it). Anywhere
//     else it lists what to set by hand.
// Pure but for the host, so the tests can check the words and the edits.
import { SPACE_CAMERA_LIMITS, settingText, type MapEdit, type MapSettingConfig, type SpaceCamera } from "@minecade/minigame-core/config";
import { CAMERA_SETTING_KEYS } from "./board-camera.ts";
import type { Space } from "./board.ts";

/** /boardcam's enum and its words: each board camera setting by its name in BoardCameraSettings, lower case, then reset and save. */
export const BOARD_CAM_ENUM = "blockparty:boardcamsetting";
export const BOARD_CAM_SETTINGS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(CAMERA_SETTING_KEYS).map(([field, key]) => [field.toLowerCase(), key]));
export const BOARD_CAM_WORDS: readonly string[] = [...Object.keys(BOARD_CAM_SETTINGS), "reset", "save"];

/** /spacecam's enum and its words. */
export const SPACE_CAM_ENUM = "blockparty:spacecamsetting";
export const SPACE_CAM_WORDS: readonly string[] = ["way", "pitch", "distance", "free", "board", "default", "space", "back", "save"];

/** Said when a space's shot was brought up to show it. */
const BACK_HINT = " /spacecam back puts the camera back.";

/** The most edits one map_edit carries (the console's message limit, with room to spare). */
export const SAVE_CHUNK_CHARS = 1300;

export interface TuningHost {
  /** A board camera setting's config (game.config.ts map.settings), by its map key. */
  setting(key: string): MapSettingConfig;
  /** Its value on the map (the default where the map has none). */
  mapValue(key: string): number;
  spaces(): readonly Space[];
  /** The board camera's yaw now, while it never turns (what a cutscene follows), else undefined. */
  boardYaw(): number | undefined;
  /** Something changed: the board camera eases to its settings, and the cutscene's shot on screen is laid again. */
  retuned(): void;
  /** The space /spacecam tunes: the cutscene's on screen, else the one the turn's player stands on. */
  spaceNow(): Space | undefined;
  /** The space the cutscene's shot on screen is at, if one is up. */
  shotSpace(): Space | undefined;
  /** The camera to a space's shot (it stays until back, or the game moves the camera on). */
  show(space: Space): void;
  /** Back from a space shown to the shot before it: false when none is shown. */
  back(): boolean;
  /** Whether the game can save to its map (a preview from the map editor). */
  canSave(): boolean;
  /** Asks the map editor to change the map, for `by` (a player's name): its answer. */
  save(edit: MapEdit, by: string): Promise<{ ok: boolean; message: string }>;
}

/** A space as the commands name it: its id on the map, else its number on the test board. */
export function spaceName(space: Space): string {
  return `space ${space.id ?? space.index + 1}${space.type ? ` (${space.type})` : ""}`;
}

/** A space's camera in words, as said of its cutscenes ("its cutscenes look its own way, 90 degrees"). */
export function describeSpaceCamera(camera: SpaceCamera | undefined, boardYaw: number | undefined): string {
  const parts: string[] = [];
  if (camera?.yaw !== undefined) parts.push(`look its own way, ${camera.yaw} degrees`);
  else if (camera?.free) parts.push("are free: each shot picks its own side");
  else if (boardYaw !== undefined) parts.push(`look the board camera's way, ${Math.round(boardYaw)} degrees`);
  else parts.push("pick their own side for each shot (the board camera turns)");
  const tuned = [camera?.pitch !== undefined ? `pitch ${camera.pitch}` : "", camera?.distance !== undefined ? `distance ${camera.distance}` : ""].filter(Boolean);
  if (tuned.length > 0) parts.push(`${tuned.join(", ")}${camera?.yaw === undefined && (camera?.free || boardYaw === undefined) ? " (used once it has a way)" : ""}`);
  return parts.join("; ");
}

/** The map edits one save makes, in batches that each fit a console message. */
export function saveBatches(edits: readonly MapEdit[], limit = SAVE_CHUNK_CHARS): MapEdit[] {
  const out: MapEdit[] = [];
  let batch: MapEdit[] = [];
  const flush = () => {
    if (batch.length === 1) out.push(batch[0]);
    else if (batch.length > 1) out.push({ op: "batch", edits: batch });
    batch = [];
  };
  for (const edit of edits) {
    if (batch.length > 0 && JSON.stringify({ op: "batch", edits: [...batch, edit] }).length > limit) flush();
    batch.push(edit);
  }
  flush();
  return out;
}

/** A yaw as a whole number of degrees from 0 to 359. */
export function wholeYaw(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

export class CameraTuning {
  private readonly host: TuningHost;
  /** Board camera settings changed in game and not saved, by map key. */
  private readonly board = new Map<string, number>();
  /** Values saved to the map since the game started (the game's copy of the map has the old ones). */
  private readonly saved = new Map<string, number>();
  /** Spaces whose camera changed and wasn't saved, by index, with the camera each had before. */
  private readonly before = new Map<number, SpaceCamera | undefined>();

  constructor(host: TuningHost) {
    this.host = host;
  }

  /** A board camera setting now: changed in game, saved since the start, or the map's. */
  value(key: string): number {
    return this.board.get(key) ?? this.saved.get(key) ?? this.host.mapValue(key);
  }

  /** Whether anything changed and isn't saved. */
  get unsaved(): boolean {
    return this.board.size > 0 || this.before.size > 0;
  }

  /** /boardcam: a setting (`word`) set to `value`, reset, save, or (nothing) the list. What to tell the player. */
  async boardCommand(word: string | undefined, value: number | undefined, by: string): Promise<string> {
    if (word === undefined) return this.describeBoard();
    if (word === "save") return this.save(by);
    if (word === "reset") return this.reset();
    const key = BOARD_CAM_SETTINGS[word];
    if (!key) return `/boardcam ${word}: not a setting. The settings: ${Object.keys(BOARD_CAM_SETTINGS).join(", ")}.`;
    const setting = this.host.setting(key);
    if (value === undefined) return `${setting.label} is ${settingText(setting, this.value(key))}. /boardcam ${word} <number> changes it (${setting.min} to ${setting.max}).`;
    if (!Number.isInteger(value) || value < setting.min || value > setting.max) return `${setting.label} is a whole number from ${setting.min} to ${setting.max}.`;
    const base = this.saved.get(key) ?? this.host.mapValue(key);
    if (value === base) this.board.delete(key);
    else this.board.set(key, value);
    this.host.retuned();
    return `${setting.label}: ${settingText(setting, value)}${value === base ? " (as the map has it)" : ` (the map: ${settingText(setting, base)})`}.`;
  }

  /** /spacecam: the space's camera changed by `word` (with `value`), or (nothing) described. What to tell the player. */
  async spaceCommand(word: string | undefined, value: number | undefined, by: string): Promise<string> {
    if (word === "save") return this.save(by);
    if (word === "back") return this.host.back() ? "Back to the camera from before." : "No space is being shown: /spacecam space <id> shows one.";
    if (word === "space") {
      if (value === undefined) return "/spacecam space <id> shows that space's cutscene camera, to tune it.";
      const space = this.host.spaces().find((one) => (one.id ?? one.index + 1) === value);
      if (!space) return `There's no space ${value} on this board.`;
      this.host.show(space);
      return `${spaceName(space)}: its cutscenes ${describeSpaceCamera(space.camera, this.host.boardYaw())}.${BACK_HINT}`;
    }
    const space = this.host.spaceNow();
    if (!space) return "No space to tune: there's no cutscene on screen and nobody's turn. /spacecam space <id> picks one.";
    if (word === undefined) return `${spaceName(space)}: its cutscenes ${describeSpaceCamera(space.camera, this.host.boardYaw())}.`;
    const camera: SpaceCamera = { ...space.camera };
    switch (word) {
      case "way":
      case "pitch":
      case "distance": {
        const field = word === "way" ? "yaw" : word;
        const limits = SPACE_CAMERA_LIMITS[field];
        if (value === undefined) return `/spacecam ${word} needs a number (${field === "yaw" ? "0 south, 90 west, 180 north, 270 east" : `${limits.min} to ${limits.max}`}).`;
        const number = field === "yaw" ? wholeYaw(value) : value;
        if (!Number.isInteger(number) || number < limits.min || number > limits.max) return `A space's ${word} is a whole number from ${limits.min} to ${limits.max}.`;
        camera[field] = number;
        if (field === "yaw") delete camera.free;
        break;
      }
      case "free":
        camera.free = true;
        delete camera.yaw;
        break;
      case "board":
        delete camera.free;
        delete camera.yaw;
        break;
      case "default": {
        const shown = this.setSpace(space, undefined);
        return `${spaceName(space)}: its cutscenes ${describeSpaceCamera(undefined, this.host.boardYaw())}.${shown ? BACK_HINT : ""}`;
      }
      default:
        return `/spacecam ${word}: not a setting. The settings: ${SPACE_CAM_WORDS.join(", ")}.`;
    }
    const shown = this.setSpace(space, camera);
    return `${spaceName(space)}: its cutscenes ${describeSpaceCamera(space.camera, this.host.boardYaw())}.${shown ? BACK_HINT : ""}`;
  }

  /** A space's camera changed (none: the default), noting what it was to keep for reset and save. Whether its shot was brought up to show it. */
  private setSpace(space: Space, camera: SpaceCamera | undefined): boolean {
    if (!this.before.has(space.index)) this.before.set(space.index, space.camera ? { ...space.camera } : undefined);
    const tidy = camera && Object.keys(camera).length > 0 ? camera : undefined;
    if (tidy) space.camera = tidy;
    else delete space.camera;
    if (JSON.stringify(this.before.get(space.index) ?? null) === JSON.stringify(space.camera ?? null)) this.before.delete(space.index);
    // Shown, so the change can be seen: the shot on screen is laid again if it's at this space, else the space's own shot comes up.
    this.host.retuned();
    if (this.host.shotSpace() === space) return false;
    this.host.show(space);
    return true;
  }

  /** Every change made in game and not saved, undone. */
  private reset(): string {
    if (!this.unsaved) return "The camera is as the map has it.";
    this.board.clear();
    for (const [index, camera] of this.before) {
      const space = this.host.spaces()[index];
      if (!space) continue;
      if (camera) space.camera = { ...camera };
      else delete space.camera;
    }
    this.before.clear();
    this.host.retuned();
    return "Back to the map's camera: every change not saved is undone.";
  }

  /** The map edits that keep every change: the board settings changed, then each space's camera (spaces with an id on the map). */
  edits(): MapEdit[] {
    const edits: MapEdit[] = [...this.board].map(([key, value]) => ({ op: "extra", key, value }));
    for (const index of this.before.keys()) {
      const space = this.host.spaces()[index];
      if (space?.id !== undefined) edits.push(space.camera ? { op: "spaceCamera", id: space.id, camera: { ...space.camera } } : { op: "spaceCamera", id: space.id });
    }
    return edits;
  }

  /** /boardcam save: everything changed kept on the map (a preview from the map editor), else what to set by hand. */
  private async save(by: string): Promise<string> {
    if (!this.unsaved) return "Nothing to save: the camera is as the map has it.";
    const testBoard = [...this.before.keys()].some((index) => this.host.spaces()[index]?.id === undefined);
    if (!this.host.canSave()) return `Not saved: only a preview from the map editor can save to the map. ${this.listing()}`;
    const edits = this.edits();
    if (edits.length === 0) return "Nothing to save: the test board's spaces aren't on the map.";
    for (const batch of saveBatches(edits)) {
      const answer = await this.host.save(batch, by);
      if (!answer.ok) return answer.message;
      this.markSaved(batch);
    }
    return `Saved to the map.${testBoard ? " The test board's spaces aren't on the map, so their cameras weren't." : ""}`;
  }

  /** The changes in `edit` are on the map now. */
  private markSaved(edit: MapEdit): void {
    const all = edit.op === "batch" ? edit.edits : [edit];
    for (const one of all) {
      if (one.op === "extra" && typeof one.value === "number") {
        this.saved.set(one.key, one.value);
        this.board.delete(one.key);
      }
      if (one.op === "spaceCamera") {
        const index = this.host.spaces().findIndex((space) => space.id === one.id);
        if (index >= 0) this.before.delete(index);
      }
    }
  }

  /** What changed, to set by hand: Game settings, and each space's camera. */
  private listing(): string {
    const settings = [...this.board].map(([key, value]) => `${this.host.setting(key).label} ${value}`);
    const spaces = [...this.before.keys()].flatMap((index) => {
      const space = this.host.spaces()[index];
      return space ? [`${spaceName(space)}: ${JSON.stringify(space.camera ?? {})}`] : [];
    });
    return [settings.length > 0 ? `Game settings: ${settings.join(", ")}.` : "", spaces.length > 0 ? `Space cameras (map.json "camera"): ${spaces.join("; ")}.` : ""].filter(Boolean).join(" ");
  }

  /** /boardcam alone: every setting and its value, and what's changed. */
  private describeBoard(): string {
    const lines = Object.entries(BOARD_CAM_SETTINGS).map(([word, key]) => {
      const setting = this.host.setting(key);
      const value = this.value(key);
      const yaw = this.host.boardYaw();
      const note = key === CAMERA_SETTING_KEYS.direction && value < 0 && yaw !== undefined ? ` (picked: ${Math.round(yaw)})` : "";
      return `${word} ${value}${note}${this.board.has(key) ? " *" : ""}: ${setting.label}, ${settingText(setting, value)}`;
    });
    const changed = this.unsaved ? "* changed here and not saved. /boardcam save keeps them on the map (a preview from the map editor)." : "Nothing changed here.";
    return ["Board camera:", ...lines, changed].join("\n");
  }
}

// The Camera tool's pure parts: camera names, where a camera stands and looks, its marker, and its
// form's buttons, so they can be tested without a server. A camera is saved in map.json's
// "cameras" (editor-only: servers never get it) as { at: [x, y, z, yaw, pitch], kind }.
import type { MapCamera, MapConfig } from "@minecade/minigame-core/config";
import { MARKER_KINDS, MARKER_STYLES, compass, type MarkerShape } from "./lists.ts";
import { dangerText, switchText } from "./marks.ts";

export type CameraKind = MapCamera["kind"];

/** The kinds, as forms name them. */
export const CAMERA_KINDS: Readonly<Record<CameraKind, { label: string; hint: string }>> = {
  map: { label: "Map preview", hint: "the map's picture in the lobby, nobody in the shot" },
  game: { label: "Game picture", hint: "the game's picture, you can walk into the shot" },
};

/** A camera's marker: it stands a block below the camera, so the facing line (from its top) starts at the lens. */
export interface CameraMarker extends MarkerShape {
  camera: string;
}

/** The map's cameras that read right, by name, in name order. */
export function camerasOf(config: MapConfig): [string, MapCamera][] {
  const cameras: unknown = config.cameras;
  if (typeof cameras !== "object" || cameras === null || Array.isArray(cameras)) return [];
  return Object.entries(cameras as Record<string, unknown>)
    .filter((entry): entry is [string, MapCamera] => isCamera(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

/** "Camera 1", or the next number no camera has. */
export function nextCameraName(config: MapConfig): string {
  const taken = new Set(Object.keys(config.cameras ?? {}).map((name) => name.toLowerCase()));
  let number = 1;
  while (taken.has(`camera ${number}`)) number++;
  return `Camera ${number}`;
}

/** A camera at an eye point, looking along a player's rotation (x is the pitch, y the yaw). */
export function cameraAt(eye: { x: number; y: number; z: number }, rotation: { x: number; y: number }, kind: CameraKind): MapCamera {
  const round = (value: number, step: number) => Math.round(value / step) * step + 0;
  const fix = (value: number) => Number(value.toFixed(2));
  let yaw = round(rotation.y, 0.1);
  if (yaw > 180) yaw -= 360;
  if (yaw <= -180) yaw += 360;
  const pitch = Math.max(-90, Math.min(90, round(rotation.x, 0.1)));
  return { at: [fix(eye.x), fix(eye.y), fix(eye.z), fix(yaw), fix(pitch)], kind };
}

/** A marker for every camera: a camera head centered on its lens, tilted, its line where it looks. */
export function cameraMarkers(config: MapConfig): CameraMarker[] {
  return camerasOf(config).map(([name, camera]) => {
    const [x, y, z, yaw, pitch] = camera.at;
    return { key: `camera:${name}`, camera: name, label: `§d${name}\n§7${CAMERA_KINDS[camera.kind].label}`, at: { x, y: y - 0.25, z }, facing: { yaw, pitch }, kind: MARKER_KINDS.camera, style: MARKER_STYLES.camera };
  });
}

/** A camera in a few words: "Map preview at 3.2 70.6 -14, looking north, 25 degrees down". */
export function cameraText(camera: MapCamera): string {
  const { at, looks } = cameraPlace(camera);
  return `${CAMERA_KINDS[camera.kind].label} at ${at}, looking ${looks}`;
}

/** Where a camera is ("3.3 70.6 -14") and how it looks ("north, 25 degrees down"). */
export function cameraPlace(camera: MapCamera): { at: string; looks: string } {
  const [x, y, z, yaw, pitch] = camera.at;
  const tilt = Math.round(pitch) === 0 ? "level" : `${Math.abs(Math.round(pitch))} degrees ${pitch > 0 ? "down" : "up"}`;
  return { at: [x, y, z].map((value) => Math.round(value * 10) / 10).join(" "), looks: `${compass(yaw)}, ${tilt}` };
}

export type CameraAction = "kind" | "start" | "delete";

/**
 * A camera's form: the kind, Start view and Delete. Its picture is the Snapshot's (the Camera
 * tool's slot 2), and a new angle is a new camera. Start view (on unless turned off): on a map
 * without a queue spawn, players wait before the match looking through a camera with it on, a map
 * preview before a game picture, each in name order (startViewCamera).
 */
export function cameraActions(camera: MapCamera): { action: CameraAction; text: string }[] {
  const start = camera.startView !== false;
  return [
    { action: "kind", text: switchText("Game picture", camera.kind === "game" ? CAMERA_KINDS.game.hint : "off: a map preview, nobody in the shot", camera.kind === "game") },
    { action: "start", text: switchText("Start view", start ? "players wait looking through it (no queue spawn)" : "off: players never wait looking through it", start) },
    { action: "delete", text: dangerText("Delete") },
  ];
}

/** The camera with Start view switched: off (false), or on again (the key left out, as every camera starts). */
export function toggleStartView(camera: MapCamera): MapCamera {
  if (camera.startView === false) {
    const { startView: _off, ...on } = camera;
    return on;
  }
  return { ...camera, startView: false };
}

/** A camera moved `by` along an axis, or turned (yaw) or tilted (pitch, kept from -90 to 90), its numbers rounded like cameraAt's. */
export function nudgeCamera(camera: MapCamera, change: { axis: 0 | 1 | 2; by: number } | { turn: number } | { tilt: number }): MapCamera {
  const [x, y, z, yaw, pitch] = camera.at;
  const fix = (value: number) => Number(value.toFixed(2));
  if ("axis" in change) {
    const at: [number, number, number] = [x, y, z];
    at[change.axis] = fix(at[change.axis] + change.by);
    return { ...camera, at: [...at, yaw, pitch] };
  }
  if ("turn" in change) {
    let turned = fix(yaw + change.turn);
    if (turned > 180) turned = fix(turned - 360);
    if (turned <= -180) turned = fix(turned + 360);
    return { ...camera, at: [x, y, z, turned, pitch] };
  }
  return { ...camera, at: [x, y, z, yaw, fix(Math.max(-90, Math.min(90, pitch + change.tilt)))] };
}

function isCamera(value: unknown): value is MapCamera {
  if (typeof value !== "object" || value === null) return false;
  const { at, kind } = value as { at?: unknown; kind?: unknown };
  return (kind === "map" || kind === "game") && Array.isArray(at) && at.length === 5 && at.every((n) => typeof n === "number" && Number.isFinite(n));
}

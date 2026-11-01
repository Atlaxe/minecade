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

export type CameraAction = "look" | "picture" | "aim" | "kind" | "delete";

/** A camera's form: Look through, Use my newest screenshot (not on a lobby map), Aim from my view, the kind, Delete. */
export function cameraActions(camera: MapCamera, lobby: boolean): { action: CameraAction; text: string }[] {
  const picture = camera.kind === "map" ? "as the map's preview" : "as the game's picture";
  return [
    { action: "look", text: "Look through\n§7your view moves here, with no HUD" },
    ...(lobby ? [] : [{ action: "picture" as const, text: `Use my newest screenshot\n§7${picture}` }]),
    { action: "aim", text: "Aim from my view\n§7move it to your eyes, looking your way" },
    { action: "kind", text: switchText("Game picture", camera.kind === "game" ? CAMERA_KINDS.game.hint : "off: a map preview, nobody in the shot", camera.kind === "game") },
    { action: "delete", text: dangerText("Delete") },
  ];
}

function isCamera(value: unknown): value is MapCamera {
  if (typeof value !== "object" || value === null) return false;
  const { at, kind } = value as { at?: unknown; kind?: unknown };
  return (kind === "map" || kind === "game") && Array.isArray(at) && at.length === 5 && at.every((n) => typeof n === "number" && Number.isFinite(n));
}

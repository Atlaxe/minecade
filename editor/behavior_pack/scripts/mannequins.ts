// The Mannequin tool's pure parts: mannequin names, where a new one stands and how it's turned,
// nudges, its skins, and its look as map.json keeps it, so they can be tested without a server. A
// mannequin is a stand-in for players in a game's picture, saved in map.json's "mannequins"
// (editor-only: servers never get it) as { at: [x, y, z, yaw], skin, color?, pose, hold? }.
import { FAKE_COLORS, FAKE_SKINS, lookFromIds, lookIds, type FakeLook, type FakeSkin, type MapConfig, type MapMannequin, type PlayerSkin } from "@minecade/minigame-core/config";

/** Its skins: the fake player's own, then the players' skins the build put in Edit's pack. */
let skins: readonly FakeSkin[] = FAKE_SKINS;

/** Takes the build's players' skins ("#skins", main.ts): classic skins, by a key the pack names their texture with. */
export function useMannequinSkins(players: PlayerSkin[]): void {
  skins = [...FAKE_SKINS, ...players.map((player) => ({ id: player.key, label: player.name, slim: player.slim === true }))];
}

/** Every skin a mannequin can wear, in the pack's order. */
export function mannequinSkins(): readonly FakeSkin[] {
  return skins;
}

/** The map's mannequins that read right, by name, in name order. */
export function mannequinsOf(config: MapConfig): [string, MapMannequin][] {
  const mannequins: unknown = config.mannequins;
  if (typeof mannequins !== "object" || mannequins === null || Array.isArray(mannequins)) return [];
  return Object.entries(mannequins as Record<string, unknown>)
    .filter((entry): entry is [string, MapMannequin] => isMannequin(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

/** "Mannequin 1", or the next number no mannequin has. */
export function nextMannequinName(config: MapConfig): string {
  const taken = new Set(Object.keys(config.mannequins ?? {}).map((name) => name.toLowerCase()));
  let number = 1;
  while (taken.has(`mannequin ${number}`)) number++;
  return `Mannequin ${number}`;
}

/** A mannequin standing at `at`, turned to face a player who looks along `playerYaw`, in `look`. */
export function mannequinAt(at: { x: number; y: number; z: number }, playerYaw: number, look: FakeLook): MapMannequin {
  const fix = (value: number) => Number(value.toFixed(2)) + 0;
  return { at: [fix(at.x), fix(at.y), fix(at.z), normalYaw(Math.round(playerYaw) + 180)], ...lookIds(look, skins) };
}

/** A mannequin's look, from its ids. */
export function mannequinLook(mannequin: MapMannequin): FakeLook {
  return lookFromIds(mannequin, skins);
}

/** A mannequin in a new look (its place kept). */
export function withLook(mannequin: MapMannequin, look: FakeLook): MapMannequin {
  return { at: mannequin.at, ...lookIds(look, skins) };
}

/** The § color whose dye a mannequin's held items take: its plain color's, else none (white). */
export function itemColorOf(look: FakeLook): string | undefined {
  return skins[look.skin]?.id === "color" ? (FAKE_COLORS[look.color] ?? FAKE_COLORS[0]).code : undefined;
}

/** A mannequin moved `by` along an axis, or turned `turn` degrees (+ is to its right). */
export function nudgeMannequin(mannequin: MapMannequin, change: { axis: 0 | 1 | 2; by: number } | { turn: number }): MapMannequin {
  const [x, y, z, yaw] = mannequin.at;
  const fix = (value: number) => Number(value.toFixed(2)) + 0;
  if ("turn" in change) return { ...mannequin, at: [x, y, z, normalYaw(yaw + change.turn)] };
  const at: [number, number, number] = [x, y, z];
  at[change.axis] = fix(at[change.axis] + change.by);
  return { ...mannequin, at: [...at, yaw] };
}

/** A mannequin turned to look along `yaw` (where it stands kept). */
export function facingMannequin(mannequin: MapMannequin, yaw: number): MapMannequin {
  const [x, y, z] = mannequin.at;
  return { ...mannequin, at: [x, y, z, normalYaw(Math.round(yaw))] };
}

/** A yaw from -180 (exclusive) to 180. */
function normalYaw(yaw: number): number {
  let turned = Number(yaw.toFixed(2));
  while (turned > 180) turned -= 360;
  while (turned <= -180) turned += 360;
  return turned + 0;
}

function isMannequin(value: unknown): value is MapMannequin {
  if (typeof value !== "object" || value === null) return false;
  const { at, skin, pose } = value as { at?: unknown; skin?: unknown; pose?: unknown };
  return typeof skin === "string" && typeof pose === "string" && Array.isArray(at) && at.length === 4 && at.every((n) => typeof n === "number" && Number.isFinite(n));
}

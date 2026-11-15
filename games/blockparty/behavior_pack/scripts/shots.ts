// The spike's camera shots (the plan's "Shots"): eased moves of each kind, a flyover along a
// CatmullRom spline and the same along a linear one, private shots (each player their own), fades
// to black and white, hard cuts, a shot and reverse shot with Chris, an orbit, a shake, and
// clearing. Everyone watches the same shot unless it's private. While one plays, a jump votes to
// skip it, and it ends once everyone has voted (the plan's votes); the camera is always cleared at
// the end, on a skip, and when the test game ends.
import { CameraShakeType, CatmullRomSpline, EasingType, LinearSpline, type Entity, type Player, type Vector3 } from "@minecraft/server";
import { describeError, type Scope } from "@minecade/minigame-core";
import type { Vec3 } from "./board.ts";

export interface ShotsHost {
  watchers: () => Player[];
  /** The board's middle, at the spaces' height. */
  middle: () => Vec3;
  /** A player's piece (what private shots look at). */
  pieceOf: (player: Player) => Entity;
  /** Chris, when the NPCs are out. */
  chris: () => Entity | undefined;
  say: (text: string) => void;
}

export const SHOTS = [
  { id: "eases", label: "Eased moves: seven kinds of easing" },
  { id: "spline", label: "Flyover on a CatmullRom spline" },
  { id: "linear", label: "Flyover on a linear spline" },
  { id: "private", label: "Private shots: each player their own piece" },
  { id: "fades", label: "Fades: to black, then to white" },
  { id: "cuts", label: "Cuts: high, low, close, with a fade" },
  { id: "reverse", label: "Shot and reverse shot with Chris" },
  { id: "orbit", label: "Orbit around your piece" },
  { id: "shake", label: "The Warden's looming shot, with shake" },
  { id: "clear", label: "Clear the camera" },
] as const;
export type ShotId = (typeof SHOTS)[number]["id"];

const EASES: EasingType[] = [EasingType.Linear, EasingType.InOutSine, EasingType.OutBack, EasingType.InOutCubic, EasingType.OutBounce, EasingType.InOutElastic, EasingType.Spring];

export class Shots {
  /** Bumped by every new shot, so an older one stops at its next wait. */
  private generation = 0;
  private playing = false;
  private readonly votes = new Set<string>();

  constructor(
    private readonly scope: Scope,
    private readonly host: ShotsHost,
  ) {
    scope.add(() => this.clearAll());
  }

  get running(): boolean {
    return this.playing;
  }

  /** A jump during a shot: a vote to skip it. True when the jump was taken as a vote. */
  vote(player: Player): boolean {
    if (!this.playing) return false;
    this.votes.add(player.name.toLowerCase());
    const watchers = this.host.watchers();
    const missing = watchers.filter((watcher) => !this.votes.has(watcher.name.toLowerCase()));
    if (missing.length === 0) {
      this.host.say(`Everyone voted to skip: skipped.`);
      this.stop();
    } else {
      this.host.say(`${player.name} voted to skip (${watchers.length - missing.length} of ${watchers.length}).`);
    }
    return true;
  }

  stop(): void {
    this.generation++;
    this.playing = false;
    this.clearAll();
  }

  async play(id: ShotId, by: Player): Promise<void> {
    const generation = ++this.generation;
    this.votes.clear();
    this.playing = id !== "clear";
    const alive = () => generation === this.generation && !this.scope.disposed;
    const wait = async (ticks: number) => {
      await this.scope.wait(ticks);
      return alive();
    };
    try {
      await this.run(id, by, wait);
    } catch (error) {
      this.host.say(`The ${id} shot failed: ${describeError(error)}`);
    } finally {
      if (alive()) {
        this.playing = false;
        this.clearAll();
      }
    }
  }

  private async run(id: ShotId, by: Player, wait: (ticks: number) => Promise<boolean>): Promise<void> {
    const [mx, my, mz] = this.host.middle();
    const center = { x: mx, y: my + 1, z: mz };
    const all = this.host.watchers();
    const each = (fn: (player: Player) => void) => {
      for (const player of all) {
        try {
          if (player.isValid) fn(player);
        } catch (error) {
          this.host.say(`${player.name}: ${describeError(error)}`);
        }
      }
    };
    const ring = (radius: number, height: number, count: number, from = 0): Vector3[] =>
      Array.from({ length: count }, (_, i) => {
        const angle = from + (i / count) * Math.PI * 2;
        return { x: mx + Math.cos(angle) * radius, y: my + height, z: mz + Math.sin(angle) * radius };
      });
    const yawFacing = (from: Vector3, to: Vector3) => (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
    const pitchFacing = (from: Vector3, to: Vector3) => (-Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z)) * 180) / Math.PI;

    switch (id) {
      case "clear":
        return;
      case "eases": {
        const spots = ring(24, 12, EASES.length + 1);
        each((player) => player.camera.setCamera("minecraft:free", { location: spots[0], facingLocation: center }));
        for (let i = 0; i < EASES.length; i++) {
          if (!(await wait(10))) return;
          this.host.say(`Ease ${i + 1} of ${EASES.length}: ${EASES[i]} (2 s)`);
          each((player) => player.camera.setCamera("minecraft:free", { location: spots[i + 1], facingLocation: center, easeOptions: { easeTime: 2, easeType: EASES[i] } }));
          if (!(await wait(40))) return;
        }
        await wait(20);
        return;
      }
      case "spline":
      case "linear": {
        const points = ring(26, 14, 9);
        points.push(points[0]);
        const spline = id === "spline" ? new CatmullRomSpline() : new LinearSpline();
        spline.controlPoints = points;
        const seconds = 10;
        const yaws = unwrap(points.map((point) => yawFacing(point, center)));
        const rotationKeyFrames = points.map((point, i) => ({ timeSeconds: (i / (points.length - 1)) * seconds, rotation: { x: pitchFacing(point, center), y: yaws[i], z: 0 } }));
        each((player) => {
          player.camera.setCamera("minecraft:free", { location: points[0], facingLocation: center });
          player.camera.playAnimation(spline, {
            totalTimeSeconds: seconds,
            animation: { progressKeyFrames: [{ alpha: 0, timeSeconds: 0 }, { alpha: 1, timeSeconds: seconds, easingFunc: EasingType.InOutSine }], rotationKeyFrames },
          });
        });
        this.host.say(`Flyover on a ${id === "spline" ? "CatmullRom" : "linear"} spline, ${seconds} s: 10 points around the board.`);
        await wait(seconds * 20 + 10);
        return;
      }
      case "private": {
        each((player) => {
          const piece = this.host.pieceOf(player).location;
          const yaw = (this.host.pieceOf(player).getRotation().y * Math.PI) / 180;
          const front = { x: piece.x - Math.sin(yaw) * 3, y: piece.y + 1.6, z: piece.z + Math.cos(yaw) * 3 };
          player.camera.setCamera("minecraft:free", { location: front, facingLocation: { x: piece.x, y: piece.y + 1.3, z: piece.z }, easeOptions: { easeTime: 1, easeType: EasingType.InOutSine } });
          player.onScreenDisplay.setTitle("", { subtitle: "Your own shot", fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 10 });
        });
        await wait(80);
        return;
      }
      case "fades": {
        each((player) => player.camera.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 0.8, fadeOutTime: 0.5 }, fadeColor: { red: 0, green: 0, blue: 0 } }));
        if (!(await wait(50))) return;
        each((player) => player.camera.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 0.8, fadeOutTime: 0.5 }, fadeColor: { red: 1, green: 1, blue: 1 } }));
        await wait(40);
        return;
      }
      case "cuts": {
        const high = { x: mx, y: my + 34, z: mz - 26 };
        const low = { x: mx - 6, y: my + 0.6, z: mz - 16 };
        each((player) => player.camera.setCamera("minecraft:free", { location: high, facingLocation: center }));
        this.host.say("Cut: board overview, high.");
        if (!(await wait(40))) return;
        each((player) => player.camera.setCamera("minecraft:free", { location: low, facingLocation: { x: mx, y: my + 3, z: mz } }));
        this.host.say("Cut: low angle.");
        if (!(await wait(40))) return;
        each((player) => player.camera.fade({ fadeTime: { fadeInTime: 0.3, holdTime: 0.3, fadeOutTime: 0.3 }, fadeColor: { red: 0, green: 0, blue: 0 } }));
        if (!(await wait(8))) return;
        each((player) => {
          const piece = this.host.pieceOf(player).location;
          player.camera.setCamera("minecraft:free", { location: { x: piece.x + 2.5, y: piece.y + 1.7, z: piece.z + 2.5 }, facingLocation: { x: piece.x, y: piece.y + 1.4, z: piece.z } });
        });
        this.host.say("Fade, then a close-up of each player's piece.");
        await wait(50);
        return;
      }
      case "reverse": {
        const chris = this.host.chris();
        if (!chris?.isValid) {
          this.host.say("Chris isn't out: pick NPCs in the Tests menu first.");
          return;
        }
        const target = this.host.pieceOf(by);
        const a = target.location;
        const b = chris.location;
        const shoulder = (from: Vector3, to: Vector3, height: number): Vector3 => {
          const d = Math.hypot(to.x - from.x, to.z - from.z) || 1;
          const ux = (to.x - from.x) / d;
          const uz = (to.z - from.z) / d;
          return { x: from.x - ux * 2.2 - uz * 0.8, y: from.y + height, z: from.z - uz * 2.2 + ux * 0.8 };
        };
        each((player) => player.camera.setCamera("minecraft:free", { location: shoulder(a, b, 2.1), facingLocation: { x: b.x, y: b.y + 0.6, z: b.z } }));
        this.host.say(`Over ${by.name}'s shoulder, at Chris.`);
        if (!(await wait(50))) return;
        each((player) => player.camera.setCamera("minecraft:free", { location: shoulder(b, a, 1.2), facingLocation: { x: a.x, y: a.y + 1.5, z: a.z } }));
        this.host.say(`Reverse: from behind Chris, at ${by.name}.`);
        if (!(await wait(50))) return;
        each((player) => player.camera.setCamera("minecraft:free", { location: shoulder(a, b, 2.1), facingLocation: { x: b.x, y: b.y + 0.6, z: b.z }, easeOptions: { easeTime: 0.8, easeType: EasingType.InOutSine } }));
        await wait(40);
        return;
      }
      case "orbit": {
        const piece = this.host.pieceOf(by).location;
        const around = { x: piece.x, y: piece.y + 1.2, z: piece.z };
        const points = Array.from({ length: 9 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          return { x: around.x + Math.cos(angle) * 4.5, y: around.y + 1.2, z: around.z + Math.sin(angle) * 4.5 };
        });
        const spline = new CatmullRomSpline();
        spline.controlPoints = points;
        const seconds = 6;
        const yaws = unwrap(points.map((point) => yawFacing(point, around)));
        const rotationKeyFrames = points.map((point, i) => ({ timeSeconds: (i / 8) * seconds, rotation: { x: pitchFacing(point, around), y: yaws[i], z: 0 } }));
        each((player) => {
          player.camera.setCamera("minecraft:free", { location: points[0], facingLocation: around });
          player.camera.playAnimation(spline, { totalTimeSeconds: seconds, animation: { progressKeyFrames: [{ alpha: 0, timeSeconds: 0 }, { alpha: 1, timeSeconds: seconds }], rotationKeyFrames } });
        });
        this.host.say(`Orbit around ${by.name}'s piece, ${seconds} s.`);
        await wait(seconds * 20 + 10);
        return;
      }
      case "shake": {
        const piece = this.host.pieceOf(by).location;
        each((player) => {
          player.camera.setCamera("minecraft:free", { location: { x: piece.x + 1.5, y: piece.y + 0.3, z: piece.z + 1.5 }, facingLocation: { x: piece.x, y: piece.y + 2.6, z: piece.z } });
          player.camera.addShake({ duration: 2, intensity: 0.4, type: CameraShakeType.Rotational });
        });
        this.host.say("Low and looming, with a rotational shake (2 s).");
        await wait(60);
        return;
      }
    }
  }

  private clearAll(): void {
    for (const player of this.host.watchers()) {
      try {
        player.camera.clear();
      } catch {
        // gone
      }
    }
  }
}

/** Yaws made continuous (each within half a turn of the one before), so a flyover never spins back the short way. */
export function unwrap(yaws: readonly number[]): number[] {
  const out: number[] = [];
  for (const yaw of yaws) {
    let next = yaw;
    const before = out[out.length - 1];
    if (before !== undefined) {
      while (next - before > 180) next -= 360;
      while (next - before < -180) next += 360;
    }
    out.push(next);
  }
  return out;
}

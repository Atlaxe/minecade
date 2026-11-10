// WASD flying, a setting of the viewer's: W and S move forward and back the way the camera looks
// (level, never into the ground's slope), A and D sideways, Space up and Shift down (or the keys
// Settings, Keys gives them: keys.ts), at the speed the settings say (no Ctrl for faster: Ctrl+W
// would close the window).
// While it's on, the point the camera looks at rides just ahead of it. Turning and the wheel are the
// page's, flying or not: around the spot pressed on, and toward the one under the pointer
// (scene.ts, orbit and wheelAt). Movement runs once a frame only while a key is held.
import * as THREE from "three";
import { actionFor, defaultKeyMap, type ActionId, type KeyMap } from "./keys.ts";
import type { MapScene } from "./scene.ts";

/** Blocks a second for each speed setting. */
export const FLY_SPEEDS = { slow: 5, normal: 12, fast: 30 } as const;
export type FlySpeed = keyof typeof FLY_SPEEDS;
/** How far ahead of the camera the point it looks at rides while flying. */
const LOOK_AHEAD = 0.6;

export class Fly {
  private on = false;
  /** The flying actions whose keys are held. */
  private readonly held = new Set<ActionId>();
  /** The viewer's keys (flying's are the "fly" actions). */
  keys: KeyMap = defaultKeyMap();
  /** Blocks a second. */
  speed: number = FLY_SPEEDS.normal;
  private last = 0;
  private running = false;

  constructor(private readonly scene: MapScene) {
    addEventListener("keydown", (event) => {
      // Ctrl and Alt with a key are shortcuts (Ctrl+Z), not moves, unless a flying key has them; nothing flies while a dialog is open.
      if (!this.on || typing(event.target) || document.querySelector("dialog[open]")) return;
      const action = actionFor(this.keys, event, (candidate) => candidate.fly === true);
      if (!action) return;
      this.held.add(action);
      event.preventDefault();
      this.start();
    });
    addEventListener("keyup", (event) => {
      for (const action of [...this.held]) if (this.keys[action].some((binding) => binding?.code === event.code)) this.held.delete(action);
    });
    addEventListener("blur", () => this.held.clear());
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Turns flying on (the point the camera looks at comes close) or off (it goes back out ahead). */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.held.clear();
    const controls = this.scene.controls;
    const camera = this.scene.activeCamera;
    const look = new THREE.Vector3();
    camera.getWorldDirection(look);
    const distance = on ? LOOK_AHEAD : Math.max(12, controls.target.distanceTo(camera.position) * 20);
    controls.target.copy(camera.position).addScaledVector(look, distance);
    controls.update();
    this.scene.requestRender();
  }

  /** The way W goes: the camera's view, level. Straight down (Top), north. */
  private forward(): THREE.Vector3 {
    const look = new THREE.Vector3();
    this.scene.activeCamera.getWorldDirection(look);
    look.y = 0;
    if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
    return look.normalize();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = (now: number) => {
      if (!this.on || this.held.size === 0) {
        this.running = false;
        return;
      }
      const seconds = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const forward = this.forward();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
      const move = new THREE.Vector3();
      if (this.held.has("flyForward")) move.add(forward);
      if (this.held.has("flyBack")) move.sub(forward);
      if (this.held.has("flyRight")) move.add(right);
      if (this.held.has("flyLeft")) move.sub(right);
      if (this.held.has("flyUp")) move.y += 1;
      if (this.held.has("flyDown")) move.y -= 1;
      if (move.lengthSq() > 0) this.moveBy(move.normalize().multiplyScalar(this.speed * seconds));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Moves the camera and the point it looks at together (the controls' change draws the frame). */
  private moveBy(move: THREE.Vector3): void {
    const controls = this.scene.controls;
    this.scene.activeCamera.position.add(move);
    controls.target.add(move);
    controls.update();
  }
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ? !["range", "checkbox", "radio"].includes(target.type) : target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

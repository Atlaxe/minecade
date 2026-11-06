// WASD flying, a setting of the viewer's: W and S move forward and back the way the camera looks
// (level, never into the ground's slope), A and D sideways, Space up and Shift down, at the speed
// the settings say (no Ctrl for faster: Ctrl+W would close the window).
// While it's on, the point the camera turns around rides just ahead of it, so a right drag looks
// around from where the camera is, and the wheel moves forward and back. Movement runs once a frame
// only while a key is held.
import * as THREE from "three";
import type { MapScene } from "./scene.ts";

/** Blocks a second for each speed setting. */
export const FLY_SPEEDS = { slow: 5, normal: 12, fast: 30 } as const;
export type FlySpeed = keyof typeof FLY_SPEEDS;
/** How far ahead of the camera the turning point rides while flying. */
const LOOK_AHEAD = 0.6;
/** Blocks a wheel notch moves. */
const WHEEL_STEP = 3;

const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"]);

export class Fly {
  private on = false;
  private readonly held = new Set<string>();
  /** Blocks a second. */
  speed: number = FLY_SPEEDS.normal;
  private last = 0;
  private running = false;

  constructor(
    private readonly scene: MapScene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    addEventListener("keydown", (event) => {
      // Ctrl and Alt with a key are shortcuts (Ctrl+Z), not moves.
      if (!this.on || !KEYS.has(event.code) || typing(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      this.held.add(event.code);
      event.preventDefault();
      this.start();
    });
    addEventListener("keyup", (event) => this.held.delete(event.code));
    addEventListener("blur", () => this.held.clear());
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.on) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.moveBy(this.forward().multiplyScalar(-Math.sign(event.deltaY) * WHEEL_STEP), true);
      },
      { capture: true, passive: false },
    );
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Turns flying on (the turning point comes close) or off (it goes back out ahead). */
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
    controls.enableZoom = !on;
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
      if (this.held.has("KeyW")) move.add(forward);
      if (this.held.has("KeyS")) move.sub(forward);
      if (this.held.has("KeyD")) move.add(right);
      if (this.held.has("KeyA")) move.sub(right);
      if (this.held.has("Space")) move.y += 1;
      if (this.held.has("ShiftLeft") || this.held.has("ShiftRight")) move.y -= 1;
      if (move.lengthSq() > 0) this.moveBy(move.normalize().multiplyScalar(this.speed * seconds), false);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Moves the camera and its turning point together. */
  private moveBy(move: THREE.Vector3, render: boolean): void {
    const controls = this.scene.controls;
    this.scene.activeCamera.position.add(move);
    controls.target.add(move);
    controls.update();
    if (render) this.scene.requestRender();
  }
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ? !["range", "checkbox", "radio"].includes(target.type) : target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

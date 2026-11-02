// Picking kits, as plain logic: every player gets a live kit form (kit-form.ts) that stays open,
// coming back if they close it, until everyone has picked. Then the forms close and the match (or
// the round) counts down. Whoever hasn't picked when the time runs out gets the first kit. The
// Minigame passes in ports for the forms, so this file is unit-tested with plain data.

export interface KitPickView {
  /** "Waiting for Alex and Sam: 24 s", or "Everyone's ready". */
  status: string;
  /** Who picked each kit, by kit id: names in their team colors. */
  pickedBy: Record<string, string[]>;
  /** Each player's pick, by name. */
  picks: Record<string, string>;
}

export interface KitPickerPorts {
  /** Shows the player's kit form, or shows it again if they closed it; nothing while it's open. */
  show(name: string, view: KitPickView): void;
  /** Updates an open form. */
  update(name: string, view: KitPickView): void;
  close(name: string): void;
}

/** What the picker needs of the kits: the choices, and where picks are kept (Kits). */
export interface KitChoices {
  readonly list: readonly { id: string }[];
  choose(player: string, kitId: string): boolean;
  chosenId(player: string): string | undefined;
}

export interface KitPickerOptions {
  /** Who picks. */
  players: string[];
  kits: KitChoices;
  /** Seconds before whoever hasn't picked gets the first kit. */
  seconds: number;
  /** Everyone still here. */
  online(): string[];
  /** A player's name as the form shows it (in their team color). */
  display(name: string): string;
}

export class KitPicker {
  private readonly ports: KitPickerPorts;
  private readonly options: KitPickerOptions;
  private elapsed = 0;
  private done = false;

  constructor(ports: KitPickerPorts, options: KitPickerOptions) {
    this.ports = ports;
    this.options = options;
    const view = this.view();
    for (const name of this.here()) ports.show(name, view);
  }

  /** True once everyone here has picked, or the time ran out; the forms are closed by then. */
  get finished(): boolean {
    return this.done;
  }

  /** A second has passed: brings back closed forms, and ends the picking when it's time. */
  tick(): void {
    if (this.done) return;
    this.elapsed++;
    if (this.check()) return;
    const view = this.view();
    for (const name of this.here()) {
      this.ports.show(name, view);
      this.ports.update(name, view);
    }
  }

  pick(name: string, kitId: string): void {
    if (this.done || !this.options.players.includes(name) || !this.options.kits.choose(name, kitId)) return;
    if (!this.check()) this.refresh();
  }

  /** Ends the picking now: the forms close, and whoever hasn't picked gets the first kit. */
  close(): void {
    if (this.done) return;
    this.done = true;
    const first = this.options.kits.list[0]?.id;
    for (const name of this.options.players) {
      if (first !== undefined && this.options.kits.chosenId(name) === undefined) this.options.kits.choose(name, first);
      this.ports.close(name);
    }
  }

  /** Stops without deciding anything: the forms close and the picks made so far stay (back to waiting). */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    for (const name of this.options.players) this.ports.close(name);
  }

  private check(): boolean {
    const here = this.here();
    if (here.every((name) => this.options.kits.chosenId(name) !== undefined) || this.elapsed >= this.options.seconds) {
      this.close();
      return true;
    }
    return false;
  }

  private refresh(): void {
    const view = this.view();
    for (const name of this.here()) this.ports.update(name, view);
  }

  private view(): KitPickView {
    const pickedBy: Record<string, string[]> = Object.fromEntries(this.options.kits.list.map((kit) => [kit.id, []]));
    const picks: Record<string, string> = {};
    const waiting: string[] = [];
    for (const name of this.here()) {
      const id = this.options.kits.chosenId(name);
      if (id === undefined) {
        waiting.push(name);
        continue;
      }
      picks[name] = id;
      pickedBy[id]?.push(this.options.display(name));
    }
    const left = Math.max(1, this.options.seconds - this.elapsed);
    const status = waiting.length === 0 ? "§aEveryone's ready" : `Waiting for ${listNames(waiting.map((name) => this.options.display(name)))}§r: ${left} s`;
    return { status, pickedBy, picks };
  }

  /** The players picking who are still here. */
  private here(): string[] {
    const online = new Set(this.options.online().map((name) => name.toLowerCase()));
    return this.options.players.filter((name) => online.has(name.toLowerCase()));
  }
}

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length > 3) return `${names.slice(0, 2).join("§r, ")}§r and ${names.length - 2} more`;
  return `${names.slice(0, -1).join("§r, ")}§r and ${names[names.length - 1]}`;
}

// The pack's copy of the map being edited: the host's last confirmed copy, plus edits the host
// hasn't answered yet, so a change shows at once. The host answers every edit (ack, with a hash of
// its copy) and sends the whole map after undo, redo or a hand edit; both keep the copies in step.
import { applyEdit, mapHash, type MapConfig, type MapEdit } from "@minecade/minigame-core/config";

export class MapState {
  private confirmed: MapConfig;
  private pending: { seq: number; edit: MapEdit }[] = [];
  private nextSeq = 1;
  /** The map as players see it: the confirmed copy with the pending edits applied. */
  current: MapConfig;

  constructor(config: MapConfig) {
    this.confirmed = config;
    this.current = config;
  }

  /** Applies an edit here and returns its seq for the host. Throws a MapEditError when it doesn't fit. */
  apply(edit: MapEdit): number {
    this.current = applyEdit(this.current, edit);
    const seq = this.nextSeq++;
    this.pending.push({ seq, edit });
    return seq;
  }

  /** The host applied edit `seq`. False when the two copies disagree afterwards: ask for the whole map. */
  ack(seq: number, hash: string): boolean {
    try {
      for (const { edit } of this.pending.filter((entry) => entry.seq <= seq)) this.confirmed = applyEdit(this.confirmed, edit);
    } catch {
      return false;
    } finally {
      this.pending = this.pending.filter((entry) => entry.seq > seq);
    }
    return mapHash(this.confirmed) === hash;
  }

  /** The host's whole map, after it applied edits up to `seq`. Later edits are applied again on top. */
  replace(config: MapConfig, seq: number): void {
    this.confirmed = config;
    this.pending = this.pending.filter((entry) => entry.seq > seq);
    let current = config;
    for (const entry of [...this.pending]) {
      try {
        current = applyEdit(current, entry.edit);
      } catch {
        // No longer fits the host's map: the host refuses it too, and its answer carries on from there.
        this.pending = this.pending.filter((other) => other !== entry);
      }
    }
    this.current = current;
  }
}

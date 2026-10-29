// Kill credit: who last hurt a player, and whether that was recent enough to count. A fall or
// void death shortly after a hit (Sumo, knockback) still credits the hitter.

export class KillCredit {
  private readonly windowTicks: number;
  private readonly lastHit = new Map<string, { attacker: string; tick: number }>();

  constructor(windowTicks: number) {
    this.windowTicks = windowTicks;
  }

  hit(victim: string, attacker: string, tick: number): void {
    if (victim.toLowerCase() === attacker.toLowerCase()) return;
    this.lastHit.set(victim.toLowerCase(), { attacker, tick });
  }

  /** The attacker to credit for `victim` going down at `tick`, if any. */
  creditFor(victim: string, tick: number): string | undefined {
    const last = this.lastHit.get(victim.toLowerCase());
    return last && tick - last.tick <= this.windowTicks ? last.attacker : undefined;
  }

  clear(victim: string): void {
    this.lastHit.delete(victim.toLowerCase());
  }
}

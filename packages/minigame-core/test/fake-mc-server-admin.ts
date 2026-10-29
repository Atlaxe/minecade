// Minimal fake of @minecraft/server-admin for unit tests, swapped in by vitest.config.ts.

let values: Record<string, unknown> = {};

/** Every transferPlayer call, oldest first. */
export const transfers: { player: string; hostname: string; port: number }[] = [];
let transferError: Error | undefined;

export function setVariables(next: Record<string, unknown>): void {
  values = { ...next };
}

/** Makes the next transferPlayer calls throw `error` (undefined to stop). */
export function failTransfers(error: Error | undefined): void {
  transferError = error;
}

export function resetAdmin(): void {
  values = {};
  transfers.length = 0;
  transferError = undefined;
}

export const variables = {
  get(name: string): unknown {
    return values[name];
  },
};

export function transferPlayer(player: { name: string }, options: { hostname: string; port: number }): void {
  if (transferError) throw transferError;
  transfers.push({ player: player.name, hostname: options.hostname, port: options.port });
}

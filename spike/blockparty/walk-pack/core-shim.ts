// What the walk check's bundle takes from @minecade/minigame-core in its place (the core's index
// starts the whole game framework when it loads).
export const log = {
  warn: (message: string): void => console.warn(message),
  info: (message: string): void => console.log(message),
};

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Scope = never;

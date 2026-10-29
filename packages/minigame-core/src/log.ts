// Script-side logging. Every console level reaches BDS stdout as "[<time> <LEVEL>] [Scripting] ..."
// (verified in the spike). Lines that start with NET_LOG_MARKER belong to the log transport.
const PREFIX = "[minecade]";

export const log = {
  info(message: string): void {
    console.info(`${PREFIX} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${PREFIX} ${message}`);
  },
  error(message: string): void {
    console.error(`${PREFIX} ${message}`);
  },
};

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

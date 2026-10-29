// Orchestrator logging: one line per entry, read with `docker compose logs orchestrator`.
export const log = {
  info(message: string): void {
    console.log(`[orchestrator] ${message}`);
  },
  warn(message: string): void {
    console.warn(`[orchestrator] WARN ${message}`);
  },
  error(message: string): void {
    console.error(`[orchestrator] ERROR ${message}`);
  },
};

export function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Lets queued promise callbacks run, over several rounds for chained awaits. */
export async function flushPromises(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

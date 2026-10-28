// Spike pack: can a behavior pack reach a local service over HTTP via @minecraft/server-net?
import { world } from "@minecraft/server";
import { variables } from "@minecraft/server-admin";
import { http, HttpHeader, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

const role = String(variables.get("role"));
const relayUrl = String(variables.get("relayUrl"));

function report(test: string, data: Record<string, unknown>): void {
  console.warn(`[SPIKE-HTTP] ${JSON.stringify({ role, test, ...data })}`);
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error: `${error.name}: ${error.message}`, ctor: error.constructor?.name };
  return { error: String(error) };
}

async function timed(test: string, request: () => Promise<{ status: number; body: string }>): Promise<void> {
  const started = Date.now();
  try {
    const response = await request();
    report(test, { status: response.status, body: response.body.slice(0, 200), ms: Date.now() - started });
  } catch (error) {
    report(test, { ...describeError(error), ms: Date.now() - started });
  }
}

async function run(): Promise<void> {
  await timed("get", () => http.get(`${relayUrl}ping?from=${role}`));
  await timed("post", () => {
    const request = new HttpRequest(`${relayUrl}ping`);
    request.method = HttpRequestMethod.Post;
    request.body = JSON.stringify({ from: role, t: "post" });
    request.headers = [new HttpHeader("Content-Type", "application/json")];
    request.timeout = 10;
    return http.request(request);
  });
  await timed("longpoll_3s", () => {
    const request = new HttpRequest(`${relayUrl}ping?wait=3`);
    request.timeout = 10;
    return http.request(request);
  });
  await timed("not_in_allowlist", () => http.get("http://example.com/"));
}

world.afterEvents.worldLoad.subscribe(() => {
  void run();
});

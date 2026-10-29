// Bundled by transport-plugin.test.ts, once per transport.
import { createTransport, kind } from "#transport";

const transport = createTransport({ serverId: "test", orchestratorUrl: "http://orchestrator:8080" });
transport.send({ t: "status_request" });
console.warn(`transport: ${kind}`);

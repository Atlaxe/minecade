// Orchestrator entry point: wires the config, registry, Docker, transport links, lobby channel,
// session manager and HTTP server, then handles startup cleanup and shutdown.
import { lookup } from "node:dns/promises";
import { loadConfig } from "./config.ts";
import { DockerodeAdapter } from "./docker.ts";
import { createOrchestratorServer } from "./http-server.ts";
import { HttpLinkHub } from "./links/http-link.ts";
import { LogStdinServerLink } from "./links/logstdin-link.ts";
import { LobbyChannel } from "./lobby.ts";
import { describeError, log } from "./log.ts";
import { loadRegistry } from "./registry.ts";
import { SessionManager } from "./session-manager.ts";
import { NoopWarmPool } from "./warm-pool.ts";

const PUBLIC_IP_CACHE_MS = 10 * 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = loadRegistry(config.registryPath);
  const docker = new DockerodeAdapter(config.composeProject);
  const hub = new HttpLinkHub();
  const publicIp = publicIpResolver(config.publicHost);

  // The lobby channel is created after the session manager, which only calls toLobby later.
  let lobby: LobbyChannel | undefined;
  const sessions = new SessionManager({
    config,
    registry,
    docker,
    warmPool: new NoopWarmPool(config.sparePort),
    openLink: (serverId, handle) =>
      config.transport === "http" ? hub.open(serverId) : new LogStdinServerLink(serverId, handle.console),
    toLobby: (message) => lobby?.send(message),
    publicIp,
  });
  lobby = new LobbyChannel({
    transport: config.transport,
    hub,
    docker,
    onEvent: (event) => sessions.onLobbyEvent(event),
    onConnect: () => sessions.pushStatus(),
  });

  const server = createOrchestratorServer({ config, hub, sessions, registry });
  await new Promise<void>((resolve) => server.listen(config.httpPort, "0.0.0.0", resolve));
  log.info(
    `listening on :${config.httpPort} (transport ${config.transport}, games: ${registry.games.map((game) => game.id).join(", ")})`,
  );
  log.info(`public address: ${(await publicIp()) || "unknown"}, LAN address: ${config.lanHost}`);

  await sessions.cleanupLeftovers();
  lobby.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: shutting down`);
    try {
      await sessions.shutdown();
    } catch (error) {
      log.error(`shutdown failed: ${describeError(error)}`);
    }
    lobby?.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/** Resolves PUBLIC_HOST to an IPv4 address: "auto" asks ipify, a hostname goes through DNS. */
function publicIpResolver(publicHost: string): () => Promise<string> {
  let cached = { value: "", at: 0 };
  return async () => {
    if (cached.value && Date.now() - cached.at < PUBLIC_IP_CACHE_MS) return cached.value;
    try {
      let value: string;
      if (/^\d+(\.\d+){3}$/.test(publicHost)) value = publicHost;
      else if (publicHost === "auto") {
        const response = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(5000) });
        value = response.ok ? (await response.text()).trim() : "";
      } else value = (await lookup(publicHost, { family: 4 })).address;
      if (value) cached = { value, at: Date.now() };
    } catch (error) {
      log.warn(`could not resolve PUBLIC_HOST=${publicHost}: ${describeError(error)}`);
    }
    return cached.value;
  };
}

main().catch((error: unknown) => {
  log.error(`failed to start: ${describeError(error)}`);
  process.exit(1);
});

// Skin watcher spike: a bot that joins the lobby as an ordinary player (the spare account) and saves
// every player's skin from the player list, which the lobby sends to everyone online. Unlike the
// relay (skins.ts), it doesn't stand between players and the lobby, so nobody's login changes.
// See README.md. Runs on Node 26, which runs this TypeScript file as is.
//
// bedrock-protocol (PrismarineJS) does the joining: sign-in, login, the resource pack exchange and
// decoding packets. It can't yet reach a server by address over NetherNet (only by LAN discovery or
// Xbox), so useHttpSignaling() below swaps in BDS's HTTP signaling: the same POST /v1/join/<id>
// a game client makes. It's adapted from nethernet-proxy's relay (MIT).
import { mkdir, writeFile } from "node:fs/promises";
import bedrock from "bedrock-protocol";
import { SignalType } from "nethernet";
import { png } from "./skin-image.ts";

const LOBBY_URL = process.env.LOBBY_URL ?? "http://minecade-lobby:19132";
const VERSION = process.env.BDS_VERSION?.split(".").slice(0, 3).join(".") ?? "1.26.60";
/** How long to stay in the lobby, saving skins as players come and go. */
const STAY_MINUTES = Number(process.env.WATCH_MINUTES || 10);
const OUT = process.env.OUT_DIR ?? "/spike/out";

function report(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

const response = await fetch(new URL("/v1/join", LOBBY_URL));
if (!response.ok) throw new Error(`the lobby's status failed: HTTP ${response.status}`);
report("lobby", { url: LOBBY_URL, version: VERSION });
if (process.env.CHECK_ONLY === "1") {
  report("ready", { note: "bedrock-protocol loads and the lobby answers; the next run asks for the sign-in" });
  process.exit(0);
}

const lobby = new URL(LOBBY_URL);
report("sign_in", { note: "if a device_login line follows, open its url and enter its userCode, signed in as the spare account" });
const client = bedrock.createClient({
  host: lobby.hostname,
  port: Number(lobby.port),
  transport: "nethernet",
  skipPing: true,
  version: VERSION,
  // The server's network id: BDS's HTTP signaling never uses it (only our own signals carry it),
  // but bedrock-protocol refuses 0.
  nethernet: { networkId: 1n },
  username: "watcher",
  // The sign-in token is cached in the spike's Docker volume, so later runs skip the code.
  profilesFolder: "/cache/watcher",
  onMsaCode: (code: { verification_uri: string; user_code: string }) => report("device_login", { url: code.verification_uri, userCode: code.user_code }),
  conLog: (...args: unknown[]) => report("client", { message: args.map(String).join(" ") }),
});
const attach = () => useHttpSignaling(client.connection.nethernet, LOBBY_URL);
if (client.connection) attach();
else client.once("connect_allowed", attach);

/** Players' names by their uuid, for skin changes (which carry only the uuid). */
const names = new Map<string, { name: string; xuid: string }>();
let saved = 0;

// A packet bedrock-protocol can't decode is dropped with an "error"; keep the last one read, so the
// error can say which packet it was, and save its bytes (out/failed-<id>-<time>.bin) to study.
let lastPacket: Buffer | undefined;
const readPacket = client.readPacket.bind(client);
client.readPacket = (packet: Buffer) => {
  lastPacket = packet;
  readPacket(packet);
};

client.on("spawn", () => {
  report("spawned", { as: client.profile?.name, stayMinutes: STAY_MINUTES });
  setTimeout(() => {
    report("done", { saved });
    client.close();
    process.exit(0);
  }, STAY_MINUTES * 60_000);
});
// The player list's records: { type: "add" | "remove", uuid, username, xbox_user_id, skin_data: Skin, ... }.
client.on("player_list", (packet: { records?: Record<string, unknown>[] }) => {
  const records = Array.isArray(packet.records) ? packet.records : [];
  report("player_list", { count: records.length, types: [...new Set(records.map((record) => record.type))] });
  for (const record of records) {
    if (record.type !== "add") continue;
    const name = String(record.username ?? "unknown");
    const xuid = String(record.xbox_user_id ?? "");
    names.set(String(record.uuid), { name, xuid });
    if (name === client.profile?.name) continue;
    save(name, xuid, (record.skin_data ?? record.skin) as Record<string, unknown> | undefined, "player_list", Object.keys(record)).catch((error: unknown) =>
      report("save_failed", { name, error: String(error) }),
    );
  }
});
client.on("player_skin", (packet: { uuid?: unknown; skin?: Record<string, unknown> }) => {
  const who = names.get(String(packet.uuid)) ?? { name: "unknown", xuid: "" };
  if (who.name === client.profile?.name) return;
  save(who.name, who.xuid, packet.skin, "player_skin", Object.keys(packet)).catch((error: unknown) => report("save_failed", { name: who.name, error: String(error) }));
});
client.on("transfer", (packet: unknown) => report("transferred", { packet }));
client.on("kick", (packet: unknown) => report("kicked", { packet }));
client.on("error", (error: unknown) => {
  const packet = lastPacket;
  lastPacket = undefined;
  if (!packet) return report("error", { error: String(error) });
  const id = packetId(packet);
  const file = `${OUT}/failed-${id}-${Date.now()}.bin`;
  mkdir(OUT, { recursive: true })
    .then(() => writeFile(file, packet))
    .catch(() => {});
  report("error", { error: String(error), packetId: id, bytes: packet.length, saved: file });
});
client.on("close", (reason: unknown) => {
  report("closed", { reason: String(reason ?? ""), saved });
  process.exit(0);
});
// Leave the lobby cleanly when the container stops, or the lobby keeps the session a while and
// refuses the next start ("server_id_conflict").
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    report("stopping", { saved });
    client.close();
    setTimeout(() => process.exit(0), 500);
  });
}

/**
 * Writes out/watch-<xuid>-<name>.png (the skin's pixels) and .json (what else the skin says, without
 * the image). The skin's layout comes from bedrock-protocol's packet definitions; if the image isn't
 * where it's expected, the .json lists the fields that were there.
 */
async function save(name: string, xuid: string, skin: Record<string, unknown> | undefined, from: string, fields: string[]): Promise<void> {
  const image = (skin?.skin_data ?? skin?.skin_image) as { width?: number; height?: number; data?: Uint8Array } | undefined;
  const width = Number(image?.width);
  const height = Number(image?.height);
  const pixels = image?.data ? Buffer.from(image.data) : Buffer.alloc(0);
  const patch = parseJson(skin?.skin_resource_pack) as { geometry?: unknown } | undefined;
  const info = {
    name,
    xuid,
    from,
    skinId: skin?.skin_id,
    width,
    height,
    bytes: pixels.length,
    persona: skin?.persona,
    premium: skin?.premium,
    armSize: skin?.arm_size,
    geometry: patch?.geometry,
    geometryBytes: typeof skin?.geometry_data === "string" ? skin.geometry_data.length : 0,
    recordFields: fields,
    skinFields: skin ? Object.keys(skin) : [],
  };
  const file = `${OUT}/watch-${xuid || "unknown"}-${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  await mkdir(OUT, { recursive: true });
  await writeFile(`${file}.json`, `${JSON.stringify(info, null, 2)}\n`);
  // Character creator skins come with their own model (the classic ones use the standard humanoid);
  // drawing one needs it, so keep it beside the picture.
  if (typeof skin?.geometry_data === "string" && skin.geometry_data.length > 0) await writeFile(`${file}.geo.json`, skin.geometry_data);
  if (width > 0 && height > 0 && pixels.length === width * height * 4) {
    await writeFile(`${file}.png`, png(width, height, pixels));
    saved++;
    report("skin_saved", { name, from, width, height, persona: info.persona, geometry: info.geometry });
  } else {
    report("no_skin", { name, from, width, height, bytes: pixels.length, skinFields: info.skinFields });
  }
}

/** A packet's id: the low 10 bits of its first varint (the rest are sub-client bits). */
function packetId(packet: Buffer): number {
  let value = 0;
  for (let at = 0, shift = 0; at < packet.length && shift < 35; at++, shift += 7) {
    value |= (packet[at] & 0x7f) << shift;
    if ((packet[at] & 0x80) === 0) break;
  }
  return value & 0x3ff;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

interface NethernetClient {
  networkId: bigint;
  serverNetworkId: bigint;
  signalHandler: (signal: { type: unknown; connectionId: bigint; data: string }) => void;
  handleSignal(signal: { type: unknown; connectionId: bigint; networkId: bigint; data: string }): void;
  close(reason?: string): void;
}

/**
 * BDS's HTTP signaling: the client's connect request (its SDP offer) is POSTed to the server's
 * /v1/join/<the client's network id>, and the answer (an SDP, or a number on failure) comes back
 * in the response. Adapted from nethernet-proxy's useHttpSignaling (MIT).
 */
function useHttpSignaling(nethernet: NethernetClient, url: string): void {
  nethernet.signalHandler = (signal) => {
    if (signal.type !== SignalType.ConnectRequest) return;
    (async () => {
      try {
        const answer = await fetch(new URL(`/v1/join/${nethernet.networkId}`, url), {
          method: "POST",
          headers: { "content-type": "application/sdp", "user-agent": "libhttpclient/1.0.0.0" },
          body: signal.data,
          signal: AbortSignal.timeout(20_000),
        });
        const data = (await answer.text()).trim();
        report("signaling", { status: answer.status, answer: data.startsWith("v=0") ? "sdp" : data.slice(0, 80) });
        if (/^\d+$/.test(data)) nethernet.handleSignal({ type: SignalType.ConnectError, connectionId: signal.connectionId, networkId: nethernet.serverNetworkId, data });
        else if (data.startsWith("v=0")) nethernet.handleSignal({ type: SignalType.ConnectResponse, connectionId: signal.connectionId, networkId: nethernet.serverNetworkId, data });
        else throw new Error(`no SDP answer (HTTP ${answer.status})`);
      } catch (error) {
        report("signaling_failed", { error: String(error) });
        nethernet.close("signaling_failed");
      }
    })();
  };
}

// Skin capture spike: a NetherNet relay in front of the lobby that saves each joining player's skin
// from their login, to see whether it works at all (see README.md). Players join the relay's port
// (19140) instead of the lobby's; their own login passes through to the lobby untouched.
// Runs on Node 26, which runs this TypeScript file as is.
import { mkdir, writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { NetherNetProxy, authenticateTransport, proxyServerIdentity } from "@nethernet-proxy/proxy";

const LOBBY_URL = process.env.LOBBY_URL ?? "http://minecade-lobby:19132";
/** The address players reach the relay at (LAN_HOST), advertised for the WebRTC connection. */
const ADVERTISE = process.env.ADVERTISE ?? "";
const SIGNALING_PORT = 19140;
/** Published one-to-one by docker-compose.skins.yml; one per player connected at a time. */
const UDP_PORTS: [number, number] = [19141, 19150];
const OUT = process.env.OUT_DIR ?? "/spike/out";

function report(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

const response = await fetch(new URL("/v1/join", LOBBY_URL));
if (!response.ok) throw new Error(`the lobby's status failed: HTTP ${response.status}`);
// BDS 1.26.60 answers with an empty body, so the game version (for the sign-in) comes from
// BDS_VERSION in .env when the lobby doesn't say.
const version = reportedVersion(await response.text()) ?? process.env.BDS_VERSION?.split(".").slice(0, 3).join(".");
if (!version) throw new Error("no game version: set BDS_VERSION in .env");
report("lobby", { url: LOBBY_URL, version });

if (process.env.CHECK_ONLY === "1") {
  report("ready", { note: "the relay's packages load and the lobby answers; the next run asks for the sign-in" });
  process.exit(0);
}
if (!ADVERTISE) throw new Error("set LAN_HOST in .env (the address players reach this PC at)");

// The relay's own connection to the lobby needs a multiplayer token: the first run prints a
// "device_login" line with a URL and a code for the spare Microsoft account. The token is cached
// in /cache (a Docker volume), so later runs skip this.
report("sign_in", { note: "if a device_login line follows, open its url and enter its userCode, signed in as the spare account" });
const serverSideIdentity = await authenticateTransport(version);
report("signed_in");

const proxy = new NetherNetProxy({
  serverUrl: LOBBY_URL,
  clientSideIdentity: await proxyServerIdentity(),
  serverSideIdentity,
  publicUdp: { address: ADVERTISE, ports: [{ external: UDP_PORTS }] },
  // Joining matters more than the skin: a player whose login can't be read still gets in.
  requireClientData: false,
  log: (event, fields) => report(`relay_${event}`, fields),
});
proxy.on("playerJoin", ({ identity, clientData }) => {
  saveSkin(identity.name, identity.xuid, clientData as unknown as Record<string, unknown>).catch((error: unknown) => report("save_failed", { error: String(error) }));
});
proxy.on("playerSpawn", ({ player }) => report("spawn", { name: player.name }));
proxy.on("playerLeave", ({ player, reason }) => report("leave", { name: player?.name, reason }));
await proxy.listen(SIGNALING_PORT, "0.0.0.0");
report("listening", { join: `${ADVERTISE}:${SIGNALING_PORT}`, lobby: LOBBY_URL });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    proxy.close().finally(() => process.exit(0));
  });
}

/** Writes out/<xuid>-<name>.png (the skin's pixels) and .json (what else the login says about it, without the image). */
async function saveSkin(name: string | undefined, xuid: string | undefined, data: Record<string, unknown>): Promise<void> {
  const width = Number(data.SkinImageWidth);
  const height = Number(data.SkinImageHeight);
  const pixels = typeof data.SkinData === "string" ? Buffer.from(data.SkinData, "base64") : Buffer.alloc(0);
  const patch = decodeJson(data.SkinResourcePatch) as { geometry?: unknown } | undefined;
  const info = {
    name,
    xuid,
    deviceOs: data.DeviceOS,
    deviceModel: data.DeviceModel,
    skinId: data.SkinId,
    width,
    height,
    bytes: pixels.length,
    persona: data.PersonaSkin,
    premium: data.PremiumSkin,
    armSize: data.ArmSize,
    geometry: patch?.geometry,
    geometryBytes: typeof data.SkinGeometryData === "string" ? data.SkinGeometryData.length : 0,
    fields: Object.keys(data).sort(),
  };
  const file = `${OUT}/${xuid ?? "unknown"}-${(name ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}`;
  await mkdir(OUT, { recursive: true });
  await writeFile(`${file}.json`, `${JSON.stringify(info, null, 2)}\n`);
  if (width > 0 && height > 0 && pixels.length === width * height * 4) {
    await writeFile(`${file}.png`, png(width, height, pixels));
    report("skin_saved", { name, width, height, persona: info.persona, geometry: info.geometry });
  } else {
    report("no_skin", { name, width, height, bytes: pixels.length });
  }
}

/** The version in a /v1/join status body, if it has one. */
function reportedVersion(body: string): string | undefined {
  try {
    const version = (JSON.parse(body) as { version?: unknown }).version;
    return version === undefined ? undefined : String(version);
  } catch {
    return undefined;
  }
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** A PNG of raw RGBA pixels (8 bits per channel, no filtering). */
function png(width: number, height: number, rgba: Buffer): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

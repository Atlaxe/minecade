// The skin watcher: a bot that stays in the lobby as an ordinary player (a spare Microsoft account,
// signed in once) and saves every player's skin from the player list, which the lobby sends to
// everyone online, and again when someone changes skin. The build renders what it saves
// (tools/skins) into the lobby pack. The lobby puts it in spectator mode and leaves it out of games
// (WATCHER_GAMERTAG). It reconnects whenever it drops out, such as when the lobby restarts.
// Runs on Node 26, which runs this TypeScript file as is.
//
// bedrock-protocol (PrismarineJS) does the joining: sign-in, login, the resource pack exchange and
// decoding packets. It can't yet reach a server by address over NetherNet (only by LAN discovery
// or Xbox), so useHttpSignaling() below swaps in BDS's HTTP signaling: the same POST
// /v1/join/<id> a game client makes. It's adapted from nethernet-proxy's relay (MIT).
//
// Saved per player, under SKINS_DIR (tools/skins/store.ts reads it):
//   <xuid>/meta.json       who and what (written last, so a folder with one is complete)
//   <xuid>/skin.rgba       the skin's pixels, 4 bytes each, rows top to bottom
//   <xuid>/model.geo.json  a character creator skin's own model
//   <xuid>/face.rgba       a character creator skin's face (its "animated_face" model's texture:
//                          the face, then its blink, top to bottom)
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bedrock from "bedrock-protocol";
import { SignalType } from "nethernet";

const LOBBY_URL = process.env.LOBBY_URL ?? "http://lobby:19132";
const VERSION = process.env.BDS_VERSION?.split(".").slice(0, 3).join(".") || "1.26.60";
/** The watcher's own gamertag, which the lobby hides; the watcher stays off without it. */
const GAMERTAG = process.env.WATCHER_GAMERTAG?.trim() ?? "";
const SKINS_DIR = process.env.SKINS_DIR ?? "/skins";
/** The spare account's sign-in (a Docker volume). */
const AUTH_DIR = process.env.AUTH_DIR ?? "/auth";
/** The lobby keeps a dropped session about 15 seconds and refuses the same account until then. */
const RETRY_MS = 20_000;
/** How often to look again while the lobby doesn't answer (stopped, or restarting). */
const WAIT_MS = 10_000;
/** A visit that hasn't reached the lobby by then is given up and tried again. */
const JOIN_TIMEOUT_MS = 90_000;
/** A skin animation's type for a character creator skin's face. */
const FACE_ANIMATION = 1;
/** server_script_debug_drawer: the hologram's text shapes, which bedrock-protocol can't decode and the watcher doesn't need. */
const UNREADABLE_PACKET = 328;

function report(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!GAMERTAG) {
  report("off", { note: "set WATCHER_GAMERTAG in .env to the spare account's gamertag to turn the skin watcher on" });
  process.exit(0);
}

let stopping = false;
let current: { close(): void } | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    report("stopping");
    current?.close();
    setTimeout(() => process.exit(0), 500);
  });
}

for (;;) {
  if (stopping) break;
  if (!(await lobbyAnswers())) {
    await sleep(WAIT_MS);
    continue;
  }
  const reason = await visit();
  report("left", { reason });
  if (!stopping) await sleep(RETRY_MS);
}

async function lobbyAnswers(): Promise<boolean> {
  try {
    return (await fetch(new URL("/v1/join", LOBBY_URL), { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    return false;
  }
}

interface SkinImage {
  width?: number;
  height?: number;
  data?: Uint8Array;
}

interface Skin {
  skin_id?: string;
  skin_resource_pack?: string;
  skin_data?: SkinImage;
  /** Animated parts: a character creator skin's face is type 1 (the face and its blink, as frames). */
  animations?: { skin_image?: SkinImage; animation_type?: number; animation_frames?: number }[];
  geometry_data?: string;
  arm_size?: string;
  persona?: boolean;
  premium?: boolean;
}

/** Joins the lobby and stays, saving skins, until the connection ends; resolves why it ended. */
function visit(): Promise<string> {
  return new Promise((resolve) => {
    const lobby = new URL(LOBBY_URL);
    report("joining", { lobby: LOBBY_URL });
    const client = bedrock.createClient({
      host: lobby.hostname,
      port: Number(lobby.port),
      transport: "nethernet",
      skipPing: true,
      version: VERSION,
      // The server's network id: BDS's HTTP signaling never uses it, but bedrock-protocol refuses 0.
      nethernet: { networkId: 1n },
      username: "watcher",
      profilesFolder: AUTH_DIR,
      viewDistance: 2,
      onMsaCode: (code: { verification_uri: string; user_code: string }) =>
        report("sign_in_needed", { url: code.verification_uri, code: code.user_code, note: "sign in as the spare account" }),
      conLog: () => {},
    });
    current = client;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(timeout);
      current = undefined;
      try {
        client.close();
      } catch {
        // Already closed.
      }
      resolve(reason);
    };
    const timeout = setTimeout(() => end("didn't reach the lobby in time"), JOIN_TIMEOUT_MS);
    const attach = () => useHttpSignaling(client.connection.nethernet, LOBBY_URL, end);
    if (client.connection) attach();
    else client.once("connect_allowed", attach);

    // A packet bedrock-protocol can't decode is dropped with an "error"; remember which it was.
    let lastPacket = -1;
    const readPacket = client.readPacket.bind(client);
    client.readPacket = (packet: Buffer) => {
      lastPacket = packetId(packet);
      readPacket(packet);
    };

    /** Players' names and xuids by uuid, for skin changes (which carry only the uuid). */
    const players = new Map<string, { name: string; xuid: string }>();
    const isMe = (name: string) => name.toLowerCase() === (client.profile?.name ?? GAMERTAG).toLowerCase();
    client.on("spawn", () => {
      clearTimeout(timeout);
      const name = client.profile?.name ?? "";
      report("in_lobby", { as: name });
      if (name.toLowerCase() !== GAMERTAG.toLowerCase()) {
        report("gamertag_mismatch", { signedInAs: name, WATCHER_GAMERTAG: GAMERTAG, note: "set WATCHER_GAMERTAG to the signed-in gamertag, or the lobby treats the watcher as a player" });
      }
    });
    // The player list's records: { type: "add" | "remove", uuid, username, xbox_user_id, skin_data: Skin, ... }.
    client.on("player_list", (packet: { records?: Record<string, unknown>[] }) => {
      for (const record of Array.isArray(packet.records) ? packet.records : []) {
        if (record.type !== "add") continue;
        const player = { name: String(record.username ?? ""), xuid: String(record.xbox_user_id ?? "") };
        players.set(String(record.uuid), player);
        if (!isMe(player.name)) save(player, record.skin_data as Skin | undefined);
      }
    });
    client.on("player_skin", (packet: { uuid?: unknown; skin?: Skin }) => {
      const player = players.get(String(packet.uuid));
      if (player && !isMe(player.name)) save(player, packet.skin);
    });
    client.on("kick", (packet: { reason?: unknown; message?: unknown }) => report("kicked", { reason: packet.reason, message: packet.message }));
    client.on("error", (error: unknown) => {
      if (lastPacket !== UNREADABLE_PACKET) report("error", { error: String(error), packet: lastPacket });
    });
    client.on("close", (reason: unknown) => end(String(reason || "closed")));
  });
}

/** Saves a player's skin, unless it's the same as the one already saved. */
function save(player: { name: string; xuid: string }, skin: Skin | undefined): void {
  saveSkin(player, skin).catch((error: unknown) => report("save_failed", { name: player.name, error: String(error) }));
}

async function saveSkin(player: { name: string; xuid: string }, skin: Skin | undefined): Promise<void> {
  const width = Number(skin?.skin_data?.width);
  const height = Number(skin?.skin_data?.height);
  const pixels = skin?.skin_data?.data ? Buffer.from(skin.skin_data.data) : Buffer.alloc(0);
  if (!/^\d+$/.test(player.xuid) || !(width > 0 && height > 0 && pixels.length === width * height * 4)) {
    report("no_skin", { name: player.name, width, height, bytes: pixels.length });
    return;
  }
  const geometry = typeof skin?.geometry_data === "string" && skin.geometry_data.length > 0 ? skin.geometry_data : undefined;
  const faceAnimation = skin?.animations?.find((animation) => animation.animation_type === FACE_ANIMATION);
  const face = image(faceAnimation?.skin_image);
  const hash = createHash("sha256")
    .update(pixels)
    .update(geometry ?? "")
    .update(face?.pixels ?? Buffer.alloc(0))
    .digest("hex")
    .slice(0, 16);
  const folder = join(SKINS_DIR, player.xuid);
  const saved = await readJson(join(folder, "meta.json"));
  if (saved?.hash === hash && saved?.name === player.name) return;
  const patch = parseJson(skin?.skin_resource_pack) as { geometry?: Record<string, string> } | undefined;
  const meta = {
    xuid: player.xuid,
    name: player.name,
    width,
    height,
    persona: skin?.persona === true,
    premium: skin?.premium === true,
    armSize: skin?.arm_size,
    geometry: patch?.geometry,
    ...(face ? { face: { width: face.width, height: face.height, frames: faceAnimation?.animation_frames ?? 1 } } : {}),
    skinId: skin?.skin_id,
    hash,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(folder, { recursive: true });
  await writeAtomically(join(folder, "skin.rgba"), pixels);
  if (geometry) await writeAtomically(join(folder, "model.geo.json"), geometry);
  else await rm(join(folder, "model.geo.json"), { force: true });
  if (face) await writeAtomically(join(folder, "face.rgba"), face.pixels);
  else await rm(join(folder, "face.rgba"), { force: true });
  await writeAtomically(join(folder, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  report("skin_saved", { name: player.name, width, height, persona: meta.persona, changed: saved !== undefined });
}

/** A skin image's pixels, when it's complete. */
function image(source: SkinImage | undefined): { width: number; height: number; pixels: Buffer } | undefined {
  const width = Number(source?.width);
  const height = Number(source?.height);
  const pixels = source?.data ? Buffer.from(source.data) : Buffer.alloc(0);
  return width > 0 && height > 0 && pixels.length === width * height * 4 ? { width, height, pixels } : undefined;
}

async function writeAtomically(path: string, data: string | Buffer): Promise<void> {
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
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

interface NethernetClient {
  networkId: bigint;
  serverNetworkId: bigint;
  signalHandler: (signal: { type: unknown; connectionId: bigint; data: string }) => void;
  handleSignal(signal: { type: unknown; connectionId: bigint; networkId: bigint; data: string }): void;
}

/**
 * BDS's HTTP signaling: the client's connect request (its SDP offer) is POSTed to the server's
 * /v1/join/<the client's network id>, and the answer (an SDP, or a number on failure) comes back
 * in the response. Adapted from nethernet-proxy's useHttpSignaling (MIT).
 */
function useHttpSignaling(nethernet: NethernetClient, url: string, fail: (reason: string) => void): void {
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
        if (/^\d+$/.test(data)) nethernet.handleSignal({ type: SignalType.ConnectError, connectionId: signal.connectionId, networkId: nethernet.serverNetworkId, data });
        else if (data.startsWith("v=0")) nethernet.handleSignal({ type: SignalType.ConnectResponse, connectionId: signal.connectionId, networkId: nethernet.serverNetworkId, data });
        else throw new Error(`no SDP answer (HTTP ${answer.status})`);
      } catch (error) {
        fail(`signaling failed: ${String(error)}`);
      }
    })();
  };
}

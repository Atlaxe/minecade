// Spike relay: HTTP echo target for server-net, plus the orchestrator side of the
// log/stdin transport (tails [NET] lines, replies with scriptevent on stdin).
import http from "node:http";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import Docker from "dockerode";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const results = [];
const links = new Map(); // role -> { stdin }
const attached = new Set();
let seq = 0;

function record(kind, data) {
  const entry = { at: new Date().toISOString(), kind, ...data };
  results.push(entry);
  console.log(`[RELAY] ${JSON.stringify(entry)}`);
}

function sendCommand(role, command) {
  const link = links.get(role);
  if (!link) {
    record("error", { role, error: "no stdin link" });
    return false;
  }
  link.stdin.write(`${command}\n`);
  return true;
}

function sendNet(role, message) {
  const command = `scriptevent minecade:net ${JSON.stringify(message)}`;
  if (sendCommand(role, command)) record("sent", { role, t: message.t, seq: message.seq, length: command.length });
}

function onNet(role, message, line) {
  record("net", { role, message, line });
  if (message.t === "hello") {
    sendNet(role, { t: "pong", seq: ++seq, sentAt: Date.now() });
    sendNet(role, { t: "big1900", seq: ++seq, sentAt: Date.now(), pad: "x".repeat(1900) });
    sendNet(role, { t: "big2100", seq: ++seq, sentAt: Date.now(), pad: "x".repeat(2100) });
  } else if (message.t === "ack" && typeof message.sentAt === "number") {
    record("rtt", {
      role,
      of: message.of,
      seq: message.seq,
      ms: Date.now() - message.sentAt,
      length: message.length,
      sourceType: message.sourceType,
    });
  }
}

async function attach(info) {
  const role = info.Labels["minecade.role"];
  const container = docker.getContainer(info.Id);
  const stdin = await container.attach({ stream: true, stdin: true, hijack: true });
  links.set(role, { stdin });
  const logs = await container.logs({ follow: true, stdout: true, stderr: true, since: 0 });
  const out = new PassThrough();
  container.modem.demuxStream(logs, out, out);
  createInterface({ input: out }).on("line", (line) => {
    const marker = line.indexOf("[NET] ");
    if (marker >= 0) {
      try {
        onNet(role, JSON.parse(line.slice(marker + 6)), line);
      } catch {
        record("parse_error", { role, line });
      }
    } else if (/\[SPIKE|Server started|NetherNet|signaling|udp|error|warn|scriptevent|Player/i.test(line)) {
      record("log", { role, line });
    }
  });
  record("attached", { role, id: info.Id.slice(0, 12) });
}

async function scan() {
  try {
    const list = await docker.listContainers({ filters: { label: ["minecade.spike=1"] } });
    for (const info of list) {
      if (attached.has(info.Id)) continue;
      attached.add(info.Id);
      attach(info).catch((error) => {
        attached.delete(info.Id);
        record("error", { error: String(error) });
      });
    }
  } catch (error) {
    record("error", { error: String(error) });
  }
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://relay");
      const json = (status, value) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value, null, 2));
      };
      if (url.pathname === "/ping") {
        const wait = Number(url.searchParams.get("wait") ?? 0);
        record("http", { method: req.method, path: req.url, body, from: req.socket.remoteAddress });
        setTimeout(() => json(200, { ok: true, echo: body, serverTime: Date.now() }), wait * 1000);
      } else if (url.pathname === "/results") {
        json(200, results);
      } else if (url.pathname === "/send" && req.method === "POST") {
        // Manual test hook: {"role":"lobby","command":"scriptevent minecade:transfer Name lan"}
        const { role, command } = JSON.parse(body || "{}");
        json(200, { ok: sendCommand(role, command) });
      } else {
        json(404, { error: "not found" });
      }
    });
  })
  .listen(8080, "0.0.0.0", () => console.log("[RELAY] listening on :8080"));

setInterval(scan, 2000);
scan();

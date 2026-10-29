// Small dockerode helpers shared by the build/bake tools and the spike.
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Docker from "dockerode";
import * as tar from "tar";

export function connectDocker(): Docker {
  if (process.env.DOCKER_HOST) return new Docker();
  if (process.platform === "win32") return new Docker({ socketPath: "//./pipe/dockerDesktopLinuxEngine" });
  return new Docker({ socketPath: "/var/run/docker.sock" });
}

export interface ServerConsole {
  /** Writes one console command (no leading slash) to the server's stdin. */
  send(command: string): void;
  /** Resolves with the first line matching `pattern` that arrives after this call. */
  waitFor(pattern: RegExp, timeoutMs: number): Promise<string>;
  onLine(cb: (line: string) => void): () => void;
  close(): void;
}

/**
 * Attaches to a container's stdin/stdout/stderr. Call before `container.start()` to
 * see output from the first line. Requires the container to be created with
 * OpenStdin: true and Tty: false.
 */
export async function attachConsole(container: Docker.Container, echo = false): Promise<ServerConsole> {
  const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true });
  const out = new PassThrough();
  container.modem.demuxStream(stream, out, out);
  const listeners = new Set<(line: string) => void>();
  createInterface({ input: out }).on("line", (line) => {
    if (echo) console.log(`  | ${line}`);
    for (const cb of listeners) cb(line);
  });

  const onLine = (cb: (line: string) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };

  return {
    send(command) {
      stream.write(`${command}\n`);
    },
    onLine,
    waitFor(pattern, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${pattern}`));
        }, timeoutMs);
        const off = onLine((line) => {
          if (!pattern.test(line)) return;
          clearTimeout(timer);
          off();
          resolve(line);
        });
      });
    },
    close() {
      listeners.clear();
      stream.end();
    },
  };
}

/**
 * Follows a container's log from its first line, calling `onLine` for each line, until the
 * returned stop function is called or the stream ends (the container stopped). Requires Tty: false.
 */
export async function followLogs(
  container: Docker.Container,
  onLine: (line: string) => void,
  onEnd?: () => void,
): Promise<() => void> {
  const stream = (await container.logs({ follow: true, stdout: true, stderr: true, since: 0 })) as unknown as Readable;
  const out = new PassThrough();
  container.modem.demuxStream(stream, out, out);
  const lines = createInterface({ input: out });
  lines.on("line", onLine);
  stream.on("end", () => out.end());
  stream.on("close", () => onEnd?.());
  return () => {
    lines.close();
    stream.destroy();
  };
}

/** Copies a directory out of a (running or stopped) container into `dest`. */
export async function copyDirFromContainer(container: Docker.Container, path: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const archive = await container.getArchive({ path });
  await pipeline(archive, tar.x({ cwd: dest, strip: 1 }));
}

export async function findContainerByName(docker: Docker, name: string): Promise<Docker.Container | undefined> {
  const list = await docker.listContainers({ all: true, filters: { name: [name] } });
  const match = list.find((c) => c.Names.some((n) => n === `/${name}` || n.endsWith(name)));
  return match ? docker.getContainer(match.Id) : undefined;
}

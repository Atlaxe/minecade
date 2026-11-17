// A lobby or game config's default export, as its files are now. The Panel and the editor run for
// days, and Node keeps every module it imported for the life of the process, the files a config
// imports included (Block Party's game.config.ts imports its board-rules.ts). So a config is
// bundled with everything it imports (esbuild) and the bundle is imported instead, kept until one
// of the files in it changes.
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build, type BuildFailure } from "esbuild";

interface Bundled {
  /** Every file in the bundle with its modified time when bundled (NaN: it changed while bundling). */
  inputs: { path: string; mtimeMs: number }[];
  value: unknown;
}

const bundled = new Map<string, Bundled>();

export async function importConfig<T>(path: string): Promise<T> {
  const cached = bundled.get(path);
  if (cached && (await unchanged(cached.inputs))) return cached.value as T;
  const dir = dirname(path);
  const startedAt = Date.now();
  let code: string;
  let inputs: string[];
  try {
    const result = await build({ entryPoints: [path], absWorkingDir: dir, bundle: true, format: "esm", platform: "node", write: false, metafile: true, logLevel: "silent" });
    code = result.outputFiles[0].text;
    inputs = Object.keys(result.metafile.inputs).map((input) => resolve(dir, input));
  } catch (error) {
    throw new Error(buildErrors(error));
  }
  // Node keeps a module per URL: the same bundle again is the module already loaded.
  const value = ((await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)) as { default: unknown }).default;
  bundled.set(path, {
    inputs: await Promise.all(inputs.map(async (input) => ({ path: input, mtimeMs: await mtime(input, startedAt) }))),
    value,
  });
  return value as T;
}

async function unchanged(inputs: Bundled["inputs"]): Promise<boolean> {
  const times = await Promise.all(inputs.map(({ path }) => stat(path).then((stats) => stats.mtimeMs, () => NaN)));
  return times.every((time, index) => time === inputs[index].mtimeMs);
}

/** A file's modified time, or NaN (never equal, so it's bundled again next time) if it changed after bundling began. */
async function mtime(path: string, startedAt: number): Promise<number> {
  const { mtimeMs } = await stat(path);
  return mtimeMs >= startedAt ? NaN : mtimeMs;
}

/** esbuild's errors, one a line: "game.config.ts:2: No matching export in ... for import ...", paths from the config's folder. */
function buildErrors(error: unknown): string {
  const errors = (error as Partial<BuildFailure>).errors;
  if (!Array.isArray(errors) || errors.length === 0) return error instanceof Error ? error.message : String(error);
  return errors.map(({ text, location }) => (location ? `${location.file}:${location.line}: ${text}` : text)).join("\n");
}

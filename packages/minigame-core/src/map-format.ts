// Writes a map.json the way they're written by hand, so the map editor's changes make small,
// readable diffs: 2-space indents, positions and boxes on one line, a single position inline, longer
// lists of positions in even rows of up to 4, small objects on one line when they fit, console
// commands one per line. Keys keep their order, and unknown keys are kept. Ends with a newline (LF;
// whoever writes the file keeps its own line endings).

/** Lines longer than this are broken up. */
const WIDTH = 100;
const ROW_MAX = 4;

export function formatMapConfig(config: object): string {
  return `${expanded(config, 0)}\n`;
}

/** A value on one line, or undefined when it's written over several lines. */
function inline(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (isPosition(value)) return `[${value.map((n) => JSON.stringify(n)).join(", ")}]`;
    // A single position or box stays on the line; longer lists, and strings, go one per line.
    if (value.length === 1 && (isPosition(value[0]) || isBox(value[0]))) return `[${inline(value[0])}]`;
    return undefined;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return "{}";
  const parts: string[] = [];
  for (const [key, item] of entries) {
    const text = inline(item);
    if (text === undefined) return undefined;
    parts.push(`${JSON.stringify(key)}: ${text}`);
  }
  return `{ ${parts.join(", ")} }`;
}

/** An object or list over several lines, starting at the current position (the caller's indent). */
function expanded(value: object, indent: number): string {
  const pad = " ".repeat(indent + 2);
  const end = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.every(isPosition)) return positionRows(value, indent);
    const items = value.map((item) => `${pad}${field(undefined, item, indent + 2)}`);
    return `[\n${items.join(",\n")}\n${end}]`;
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  const lines = entries.map(([key, item]) => `${pad}${field(key, item, indent + 2)}`);
  return `{\n${lines.join(",\n")}\n${end}}`;
}

/** One key and its value (or a list item without a key), at `indent`, without the trailing comma. */
function field(key: string | undefined, value: unknown, indent: number): string {
  const prefix = key === undefined ? "" : `${JSON.stringify(key)}: `;
  const text = inline(value);
  // +1 for the comma that may follow.
  if (text !== undefined && indent + prefix.length + text.length + 1 <= WIDTH) return `${prefix}${text}`;
  if (value === null || typeof value !== "object") return `${prefix}${text}`;
  return `${prefix}${expanded(value, indent)}`;
}

/** A list of positions in even rows of up to ROW_MAX that fit the width: 8 as 4 and 4, 6 as 3 and 3. */
function positionRows(list: number[][], indent: number): string {
  const pad = " ".repeat(indent + 2);
  const texts = list.map((position) => inline(position)!);
  const longest = Math.max(...texts.map((text) => text.length));
  let perRow = Math.min(ROW_MAX, list.length);
  while (perRow > 1 && indent + 2 + perRow * (longest + 2) > WIDTH) perRow--;
  const rows = Math.ceil(list.length / perRow);
  const size = Math.ceil(list.length / rows);
  const lines: string[] = [];
  for (let start = 0; start < texts.length; start += size) lines.push(`${pad}${texts.slice(start, start + size).join(", ")}`);
  return `[\n${lines.join(",\n")}\n${" ".repeat(indent)}]`;
}

function isPosition(value: unknown): value is number[] {
  return Array.isArray(value) && (value.length === 3 || value.length === 5) && value.every((n) => typeof n === "number");
}

function isBox(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && isPosition((value as { min?: unknown }).min) && isPosition((value as { max?: unknown }).max);
}

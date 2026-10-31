// The Boundaries view's switches (which outlines each map editor sees whatever they hold), kept per
// gamertag in work/editor/view.json, so they carry over to the next map and the next boot. The Edit
// pack sends them as they change, and gets them back in EditInfo.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Switched-on groups ("bounds", "killY", "regions.<name>", or "all"), by lower-case gamertag. */
export type Views = Record<string, string[]>;

/** The views from view.json, keeping only entries that read right. */
export function parseViews(text: string): Views {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const views: Views = {};
    for (const [name, groups] of Object.entries(value)) {
      if (Array.isArray(groups) && groups.every((group) => typeof group === "string")) views[name.toLowerCase()] = groups;
    }
    return views;
  } catch {
    return {};
  }
}

export async function readViews(root: string): Promise<Views> {
  const path = viewsPath(root);
  return existsSync(path) ? parseViews(await readFile(path, "utf8")) : {};
}

/** Keeps one player's switches (none removes them). */
export async function saveView(root: string, name: string, shown: string[]): Promise<void> {
  const views = await readViews(root);
  const key = name.toLowerCase();
  if (shown.length > 0) views[key] = [...new Set(shown)];
  else delete views[key];
  await mkdir(join(root, "work", "editor"), { recursive: true });
  await writeFile(viewsPath(root), `${JSON.stringify(views, null, 2)}\n`);
}

function viewsPath(root: string): string {
  return join(root, "work", "editor", "view.json");
}

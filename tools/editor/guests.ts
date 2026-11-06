// The map editor's guests (work/editor/guests.json, set by the Panel's Players page, its Guest switch, and kept until
// someone removes them). Guests may join the editor lobby and whatever runs on Select's port
// (Select, or a preview), never Edit; the runner opens those servers' allow lists to them, and the
// Panel edits the file itself while the editor is off. Map editors (LAN_PLAYERS) are never guests.
// Kept apart from the runner so the rules can be unit-tested.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Xbox gamertags: letters, digits and spaces (a newer one's number suffix included), no quotes, so commands can quote them. */
const GAMERTAG = /^[A-Za-z0-9](?:[A-Za-z0-9 ]{0,18}[A-Za-z0-9])?$/;

export function isGamertag(name: string): boolean {
  return GAMERTAG.test(name) && !name.includes("  ");
}

/** The list with `name` added, or why it can't be: not a gamertag, a map editor already, or a guest already. */
export function addGuest(guests: string[], name: string, editors: string[]): string[] | string {
  const tag = name.trim();
  if (!isGamertag(tag)) return `"${tag}" is not a gamertag: letters, digits and single spaces, up to 20`;
  if (editors.some((editor) => same(editor, tag))) return `${tag} is a map editor already (LAN_PLAYERS)`;
  if (guests.some((guest) => same(guest, tag))) return `${tag} is a guest already`;
  return [...guests, tag];
}

/** The list without `name`, or why not (not a guest). */
export function removeGuest(guests: string[], name: string): string[] | string {
  const tag = name.trim();
  if (!guests.some((guest) => same(guest, tag))) return `${tag} isn't a guest`;
  return guests.filter((guest) => !same(guest, tag));
}

/** The guests from guests.json, keeping only gamertags. */
export function parseGuests(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string" && isGamertag(name)) : [];
  } catch {
    return [];
  }
}

export async function readGuests(root: string): Promise<string[]> {
  const path = guestsPath(root);
  return existsSync(path) ? parseGuests(await readFile(path, "utf8")) : [];
}

export async function writeGuests(root: string, guests: string[]): Promise<void> {
  await mkdir(join(root, "work", "editor"), { recursive: true });
  await writeFile(guestsPath(root), `${JSON.stringify(guests, null, 2)}\n`);
}

function guestsPath(root: string): string {
  return join(root, "work", "editor", "guests.json");
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The game reads pack JSON only on the client or at server start, so a broken file shows up late.
// These checks run on every pack in the repo instead.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function packDirs(): string[] {
  const dirs = ["packages/minigame-core/resource_pack", "lobby/resource_pack", "lobby/behavior_pack", "editor/resource_pack", "editor/behavior_pack"];
  for (const game of readdirSync(join(ROOT, "games"))) {
    for (const kind of ["resource_pack", "behavior_pack"]) dirs.push(`games/${game}/${kind}`);
  }
  for (const shared of ["blocks", "guns"]) {
    for (const kind of ["resource_pack", "behavior_pack"]) dirs.push(`packs/${shared}/${kind}`);
  }
  return dirs.map((dir) => join(ROOT, dir)).filter((dir) => existsSync(dir));
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "scripts" ? [] : jsonFiles(path);
    return name.endsWith(".json") ? [path] : [];
  });
}

/** Pack JSON as the game reads it: whole-line // comments are allowed (the UI files use them). */
function readPackJson(file: string): Json {
  return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "").replace(/^\s*\/\/.*$/gm, "")) as Json;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

/** Whether a control's own bindings set its visibility (also bindings a merge file inserts). */
function shownByBinding(control: JsonObject): boolean {
  const inserted = list(control.modifications).filter((change) => isObject(change) && change.array_name === "bindings").flatMap((change) => (isObject(change) ? list(change.value) : []));
  return [...list(control.bindings), ...inserted].some((binding) => isObject(binding) && binding.binding_type === "view" && binding.target_property_name === "#visible");
}

/**
 * Controls whose visibility comes from a binding but that don't start hidden. A new screen's first
 * frame comes before its bindings apply; a control visible then can take a click meant for what
 * replaces it (a menu reopened under a still mouse closed instead, docs/ui.md).
 */
function visibleBeforeBindings(file: string): string[] {
  const ui = readPackJson(file);
  if (!isObject(ui)) return [];
  const namespace = ui.namespace;
  // Top-level definitions by name, so a control can inherit "visible": false from its base.
  const defined = new Map<string, JsonObject>();
  for (const [key, value] of Object.entries(ui)) if (isObject(value)) defined.set(key.split("@")[0], value);
  const startsHidden = (key: string, control: JsonObject): boolean => {
    if (control.visible === false) return true;
    const base = key.split("@")[1];
    if (!base) return false;
    const [space, name] = base.split(".");
    return space === namespace && defined.get(name)?.visible === false;
  };
  const found: string[] = [];
  const visit = (key: string, control: JsonObject): void => {
    if (shownByBinding(control) && !startsHidden(key, control)) found.push(key);
    for (const child of list(control.controls)) {
      if (isObject(child)) for (const [childKey, value] of Object.entries(child)) if (isObject(value)) visit(childKey, value);
    }
  };
  for (const [key, value] of Object.entries(ui)) if (isObject(value)) visit(key, value);
  return found;
}

/** The sizes and offsets in a UI file whose parts include a variable ("size": [ "$w", 10 ]), anywhere in it. */
function variableParts(file: string): string[] {
  const found: string[] = [];
  const visit = (value: Json, path: string): void => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (["size", "offset", "min_size", "max_size"].includes(key) && Array.isArray(child) && child.some((part) => typeof part === "string" && part.includes("$"))) found.push(`${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(readPackJson(file), "");
  return found;
}

describe("pack JSON", () => {
  const files = packDirs().flatMap(jsonFiles);

  it("parses, every file in every pack", () => {
    expect(files.length).toBeGreaterThan(20);
    const broken = files.filter((file) => {
      try {
        readPackJson(file);
        return false;
      } catch {
        return true;
      }
    });
    expect(broken.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it("starts hidden wherever a binding decides a JSON UI control's visibility", () => {
    const uiFiles = files.filter((file) => /[\\/]ui[\\/][^\\/]+\.json$/.test(file));
    expect(uiFiles.length).toBeGreaterThan(3);
    const found = uiFiles.flatMap((file) => visibleBeforeBindings(file).map((key) => `${relative(ROOT, file)}: ${key}`));
    expect(found).toEqual([]);
  });

  // The game reads a variable inside a size or offset as text: a number there has no unit, the
  // client logs "Dangling number (no % or px in Size)", and the control gets no size (Block Party's
  // dialogue box drew only its name tab). A whole size through a variable ("size": "$box_size",
  // holding [ 330, "100%c" ]) is fine, as vanilla does.
  it("never puts a variable in one part of a JSON UI size or offset", () => {
    const uiFiles = files.filter((file) => /[\\/]ui[\\/][^\\/]+\.json$/.test(file));
    const found = uiFiles.flatMap((file) => variableParts(file).map((at) => `${relative(ROOT, file)}: ${at}`));
    expect(found).toEqual([]);
  });
});

// Checks for map.json files, shared by the build and the map editor (which shows the same
// problems live). validateMapConfig returns a list of problems (empty when valid) so everything
// is reported at once; mapWarnings lists things worth a look that don't stop a build.
import type { MapRequirementsConfig } from "./config.ts";
import { BUILD_LIMIT_SIDES, MAP_TIMES, QUEUE_COUNTDOWN, QUEUE_MODES, enclosingBox, mapTimeTicks, type Box, type BuildLimitSide, type MapConfig, type MapPosition, type Vec3 } from "./map-config.ts";
import { bigEnough, boxSize, mapRequirements, mapSettings, settingFits, smallEnough, type MapRequirement } from "./map-requirements.ts";

/** Bedrock overworld height limits. */
const MIN_Y = -64;
const MAX_Y = 319;

export interface MapRules {
  kind: "lobby" | "game";
  /** For games: the map needs a spawn for every player slot (or team spawns). */
  maxPlayers?: number;
  /** Map entries the game's (or lobby's) config requires: its `map` block. */
  requires?: MapRequirementsConfig;
  /** Every team the game can have. When given, team spawn keys and "<name>.<team>" keys must be one of them. */
  teams?: { id: string; name: string }[];
  /** false: the game's kits are the same on every map (its `kits.mapKits`), so a map can't have its own. */
  mapKits?: boolean;
}

export function validateMapConfig(raw: unknown, rules: MapRules): string[] {
  if (!isRecord(raw)) return ["map.json must be a JSON object"];
  const map = raw as Partial<MapConfig>;
  const problems: string[] = [];
  const who = rules.kind === "lobby" ? "the lobby" : "this game";
  const requirements = mapRequirements(rules.requires, { kind: rules.kind, maxPlayers: rules.maxPlayers, teams: rules.teams });
  if (typeof map.name !== "string" || !map.name) problems.push('"name" is required');
  if (map.draft !== undefined && typeof map.draft !== "boolean") problems.push('"draft" must be true or false');

  const spawns = Array.isArray(map.spawns) ? map.spawns : [];
  if (!Array.isArray(map.spawns)) problems.push('"spawns" must be a list of [x, y, z] positions');
  spawns.forEach((spawn, i) => checkPosition(spawn, `spawns[${i}]`, problems));
  const hasTeamSpawns = isRecord(map.teamSpawns) && Object.keys(map.teamSpawns).length > 0;
  const spawnRule = requirements.find((requirement) => requirement.field === "spawns");
  // A map with team spawns only needs one plain spawn, for players waiting before the start; a game
  // without plain spawns needs none (they wait at their team's spawns).
  const needed = !spawnRule ? 0 : hasTeamSpawns ? 1 : spawnRule.min;
  if (spawns.length < needed) {
    const perSlot = spawnRule?.perPlayer && needed > 1 ? " (one per player slot)" : "";
    problems.push(`needs at least ${needed} spawn${needed === 1 ? "" : "s"}${perSlot}, has ${spawns.length}`);
  }
  if (map.spectatorSpawn !== undefined) checkPosition(map.spectatorSpawn, "spectatorSpawn", problems, '"spectatorSpawn"');
  if (map.queueSpawn !== undefined) checkPosition(map.queueSpawn, "queueSpawn", problems, '"queueSpawn"');
  if (map.queue !== undefined) {
    const queue = map.queue as Record<string, unknown>;
    const { min, max } = QUEUE_COUNTDOWN;
    if (!isRecord(queue)) problems.push('"queue" must be { "mode": "lock" | "free", "countdown": seconds }');
    else {
      if (queue.mode !== undefined && !(QUEUE_MODES as readonly unknown[]).includes(queue.mode)) problems.push(`"queue.mode" must be ${QUEUE_MODES.join(" or ")}`);
      const countdown = queue.countdown;
      if (countdown !== undefined && (typeof countdown !== "number" || !Number.isInteger(countdown) || countdown < min || countdown > max)) {
        problems.push(`"queue.countdown" must be whole seconds from ${min} to ${max}`);
      }
    }
  }
  if (map.killY !== undefined) {
    if (typeof map.killY !== "number" || !Number.isFinite(map.killY)) problems.push('"killY" must be a number');
    else if (map.killY < MIN_Y || map.killY > MAX_Y) problems.push(`"killY" must be within ${MIN_Y} to ${MAX_Y}`);
  }
  if (map.buildLimit !== undefined) problems.push(...buildLimitProblems(map.buildLimit));
  if (map.time !== undefined && mapTimeTicks(map.time) === undefined) {
    problems.push(`"time" must be one of ${Object.keys(MAP_TIMES).join(", ")}, or ticks from 0 to 23999`);
  }
  if (map.kits !== undefined && rules.mapKits === false) problems.push(`"kits": ${who}'s kits are the same on every map`);
  else if (map.kits !== undefined) problems.push(...mapKitProblems(map.kits, rules.kind));
  if (map.stars !== undefined && typeof map.stars !== "boolean") problems.push('"stars" must be true or false');
  if (map.stars === true && rules.kind !== "lobby") problems.push('"stars" is only for the lobby map');

  // Named entries: shape and team keys, then (below) inside the bounds.
  const points: [string, Vec3][] = [];
  spawns.forEach((spawn, i) => isPosition(spawn) && points.push([`spawns[${i}]`, xyz(spawn)]));
  if (isPosition(map.spectatorSpawn)) points.push(["spectatorSpawn", xyz(map.spectatorSpawn)]);
  if (isPosition(map.queueSpawn)) points.push(["queueSpawn", xyz(map.queueSpawn)]);
  const teamIds = rules.teams?.map((team) => team.id);
  for (const [field, entries] of [
    ["teamSpawns", map.teamSpawns],
    ["points", map.points],
  ] as const) {
    if (entries === undefined) continue;
    if (!isRecord(entries)) {
      problems.push(`"${field}" must map names to lists of [x, y, z]`);
      continue;
    }
    for (const [name, list] of Object.entries(entries)) {
      checkTeamKey(field, name, teamIds, problems);
      if (!Array.isArray(list) || list.length === 0) {
        problems.push(`${field}.${name} must be a non-empty list of [x, y, z]`);
        continue;
      }
      list.forEach((point, i) => {
        if (checkPosition(point, `${field}.${name}[${i}]`, problems)) points.push([`${field}.${name}[${i}]`, xyz(point as MapPosition)]);
      });
    }
  }
  const boxes: [string, Box][] = [];
  if (map.regions !== undefined) {
    if (!isRecord(map.regions)) problems.push('"regions" must map names to lists of { "min", "max" } boxes');
    else {
      for (const [name, list] of Object.entries(map.regions)) {
        checkTeamKey("regions", name, teamIds, problems);
        if (!Array.isArray(list) || list.length === 0) problems.push(`regions.${name} must be a non-empty list of boxes`);
        else
          list.forEach((box, i) => {
            if (!isBox(box)) problems.push(`regions.${name}[${i}] must be { "min": [x, y, z], "max": [x, y, z] }`);
            else if (box.min.some((value, axis) => value > box.max[axis])) problems.push(`regions.${name}[${i}] min must not be larger than max`);
            else boxes.push([`regions.${name}[${i}]`, box]);
          });
      }
    }
  }

  // One box, or several: every position must be inside one of them, every region inside the box
  // around them all. With spectator bounds, the spectator and queue spawns go by those instead.
  const bounds = map.bounds;
  const playing = bounds === undefined ? undefined : boxList(bounds, "bounds", problems);
  const watching = map.spectatorBounds === undefined ? undefined : boxList(map.spectatorBounds, "spectatorBounds", problems);
  for (const [name, point] of points) {
    const watch = map.spectatorBounds !== undefined && (name === "spectatorSpawn" || name === "queueSpawn");
    const shaped = watch ? watching : playing;
    if (shaped && !shaped.some((box) => inside(point, box.min, box.max))) problems.push(`${name} ${JSON.stringify(point)} is outside "${watch ? "spectatorBounds" : "bounds"}"`);
  }
  const around = playing && enclosingBox(playing);
  if (around) {
    for (const [name, box] of boxes) {
      if (!inside(box.min, around.min, around.max) || !inside(box.max, around.min, around.max)) problems.push(`${name} is outside "bounds"`);
    }
  }
  if (map.spectatorBounds !== undefined && map.spectatorSpawn === undefined && map.queueSpawn === undefined) {
    problems.push('"spectatorBounds" needs a "spectatorSpawn" or a "queueSpawn" inside it');
  }

  for (const requirement of requirements) problems.push(...missing(requirement, map, who, hasTeamSpawns));

  if (map.build !== undefined) {
    const commands = isRecord(map.build) ? map.build.commands : undefined;
    if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string")) {
      problems.push('"build.commands" must be a list of console commands');
    } else {
      commands.forEach((command: string, i) => {
        if (command.trimStart().startsWith("/")) problems.push(`build.commands[${i}]: leave out the leading "/"`);
      });
    }
    if (bounds === undefined) problems.push('"bounds" is required when "build" is present (baking works inside it)');
  }
  // The game's settings are optional (a map without one gets the default), but must fit when set.
  for (const setting of mapSettings(rules.requires)) {
    const value = (raw as Record<string, unknown>)[setting.key];
    if (value !== undefined && !settingFits(setting, value)) problems.push(`"${setting.key}" must be a whole number from ${setting.min} to ${setting.max}`);
  }
  problems.push(...editorKeyProblems(map, rules.kind));
  return problems;
}

/** Things worth a look that don't stop a build: two entries of a list in the same block. */
export function mapWarnings(config: MapConfig): string[] {
  const warnings: string[] = [];
  const lists: [string, unknown][] = [["spawns", config.spawns]];
  for (const field of ["teamSpawns", "points"] as const) {
    const entries = config[field];
    if (isRecord(entries)) for (const [name, list] of Object.entries(entries)) lists.push([`${field}.${name}`, list]);
  }
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) continue;
    const seen = new Map<string, number>();
    list.forEach((position, i) => {
      if (!isPosition(position)) return;
      const at = xyz(position).map(Math.floor).join(",");
      const first = seen.get(at);
      if (first === undefined) seen.set(at, i);
      else warnings.push(`${name}[${i}] is in the same block as ${name}[${first}]`);
    });
  }
  return warnings;
}

/** The problems with one requirement: entries missing, or fewer than needed. Spawns are checked above. */
function missing(requirement: MapRequirement, map: Partial<MapConfig>, who: string, hasTeamSpawns: boolean): string[] {
  const { field, name, min } = requirement;
  switch (field) {
    case "spawns": {
      // Their count is checked above; here, that each is inside the region the game asks for.
      const region = requirement.inside;
      const within = region === undefined ? undefined : regionBoxes(map, region);
      if (!within || within.length === 0) return [];
      const spawns = Array.isArray(map.spawns) ? map.spawns : [];
      return spawns.flatMap((spawn, i) => (isPosition(spawn) && !within.some((box) => inside(xyz(spawn), box.min, box.max)) ? [`spawns[${i}] is outside the "${region}" region`] : []));
    }
    case "spectatorSpawn":
      return map.spectatorSpawn === undefined ? [`${who} needs a "spectatorSpawn"`] : [];
    case "queueSpawn":
      return map.queueSpawn === undefined ? [`${who} needs a "queueSpawn"`] : [];
    case "spectatorOrQueue":
      return map.spectatorSpawn === undefined && map.queueSpawn === undefined ? [`${who} needs a "spectatorSpawn" or a "queueSpawn"`] : [];
    case "bounds":
      return map.bounds === undefined ? [`${who} needs "bounds"`] : [];
    case "killY":
      return map.killY === undefined ? [`${who} needs "killY"`] : [];
    case "buildLimit":
      return isRecord(map.buildLimit) && map.buildLimit[name as BuildLimitSide] !== undefined ? [] : [`${who} needs "buildLimit.${name}"`];
    case "teamSpawns":
      if (name === undefined) return hasTeamSpawns ? [] : [`${who} needs "teamSpawns"`];
      return count(`teamSpawns.${name}`, listLength(map.teamSpawns, name), min, who);
    case "points":
      return count(`${field}.${name}`, listLength(map[field], name!), min, who);
    case "regions": {
      // A box smaller (or bigger) than the game asks for doesn't count, and says so. One outside the
      // region it must be in says so too, once that region has a box.
      const boxes = isRecord(map.regions) && Array.isArray(map.regions[name!]) ? map.regions[name!] : [];
      const misfits = boxes.flatMap((box, i) => {
        if (!isBox(box)) return [];
        const size = boxSize(box).join("x");
        if (!bigEnough(box, requirement.minSize)) return [`regions.${name}[${i}] is ${size}, smaller than ${requirement.minSize} on a side`];
        if (!smallEnough(box, requirement.maxSize)) return [`regions.${name}[${i}] is ${size}, bigger than ${requirement.maxSize} on a side`];
        return [];
      });
      const region = requirement.inside;
      const within = region === undefined ? [] : regionBoxes(map, region);
      const outside = within.length === 0 ? [] : boxes.flatMap((box, i) => (isBox(box) && !within.some((around) => boxInside(box, around)) ? [`regions.${name}[${i}] is outside the "${region}" region`] : []));
      return [...misfits, ...outside, ...count(`${field}.${name}`, boxes.length - misfits.length, min, who)];
    }
  }
}

/** A region's well-formed boxes (none when it has none). */
function regionBoxes(map: Partial<MapConfig>, name: string): Box[] {
  const list = isRecord(map.regions) ? map.regions[name] : undefined;
  return Array.isArray(list) ? list.filter(isBox) : [];
}

/** Whether every block of `box` is inside `around`. */
function boxInside(box: Box, around: Box): boolean {
  return [0, 1, 2].every((axis) => box.min[axis] >= around.min[axis] && box.max[axis] <= around.max[axis]);
}

function count(key: string, have: number, min: number, who: string): string[] {
  if (have >= min) return [];
  return [min === 1 ? `${who} needs a "${key}" entry` : `${who} needs ${min} "${key}" entries, has ${have}`];
}

function listLength(entries: unknown, name: string): number {
  if (!isRecord(entries)) return 0;
  const list = entries[name];
  return Array.isArray(list) ? list.length : 0;
}

/** Team spawn keys are team ids; a "<name>.<team>" key's team must be one of the game's. */
function checkTeamKey(field: string, key: string, teamIds: string[] | undefined, problems: string[]): void {
  if (teamIds === undefined) return;
  const team = field === "teamSpawns" ? key : key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : undefined;
  if (team === undefined || teamIds.includes(team)) return;
  const known = teamIds.length > 0 ? `one of ${teamIds.join(", ")}` : "a team, and this map's game has none";
  problems.push(`${field}.${key}: "${team}" must be ${known}`);
}

/** The map editor's keys: where the map was cut from, its preview cameras, its mannequins (and whether previews show them), and whether it's a minigame thumbnail map. */
function editorKeyProblems(map: Partial<MapConfig>, kind: MapRules["kind"]): string[] {
  const problems: string[] = [];
  const source = map.source;
  if (source !== undefined && !(isRecord(source) && typeof source.world === "string" && isBox(source.box) && isVec3(source.offset))) {
    problems.push('"source" must be { "world", "box": { "min", "max" }, "offset": [x, y, z] }');
  }
  if (map.cameras !== undefined) {
    if (!isRecord(map.cameras)) problems.push('"cameras" must map names to { "at": [x, y, z, yaw, pitch], "kind" }');
    else {
      for (const [name, camera] of Object.entries(map.cameras)) {
        const ok = isRecord(camera) && isPosition(camera.at) && camera.at.length === 5 && (camera.kind === "map" || camera.kind === "game");
        if (!ok) problems.push(`cameras.${name} must be { "at": [x, y, z, yaw, pitch], "kind": "map" or "game" }`);
        else if (camera.startView !== undefined && typeof camera.startView !== "boolean") problems.push(`cameras.${name}.startView must be true or false`);
      }
    }
  }
  if (map.mannequins !== undefined) {
    if (!isRecord(map.mannequins)) problems.push('"mannequins" must map names to { "at": [x, y, z, yaw], "skin", "pose" }');
    else {
      for (const [name, mannequin] of Object.entries(map.mannequins)) {
        const ok = isRecord(mannequin) && isNumberList(mannequin.at, [4]) && typeof mannequin.skin === "string" && typeof mannequin.pose === "string";
        if (!ok) problems.push(`mannequins.${name} must be { "at": [x, y, z, yaw], "skin", "pose" }`);
      }
    }
  }
  if (map.startView !== undefined) problems.push('"startView" is the servers\' own (from the cameras): leave it out');
  if (map.mannequinsInPreview !== undefined && typeof map.mannequinsInPreview !== "boolean") problems.push('"mannequinsInPreview" must be true or false');
  if (map.gameThumbnail !== undefined && typeof map.gameThumbnail !== "boolean") problems.push('"gameThumbnail" must be true or false');
  if (map.gameThumbnail === true && kind === "lobby") problems.push('"gameThumbnail" is only for a game\'s maps: the lobby has no picture');
  return problems;
}

/**
 * "bounds" or "spectatorBounds": one box, or a list of them. Reports the problems; the boxes when
 * every one is a box, else undefined.
 */
function boxList(value: unknown, key: string, problems: string[]): Box[] | undefined {
  const several = Array.isArray(value);
  const entries: unknown[] = several ? value : [value];
  const shaped: Box[] = [];
  if (entries.length === 0) problems.push(`"${key}" must be a box, or a list of boxes`);
  entries.forEach((box, i) => {
    const label = several ? `"${key}[${i}]"` : `"${key}"`;
    if (!isBox(box)) {
      problems.push(`${label} must be { "min": [x, y, z], "max": [x, y, z] }`);
      return;
    }
    if (box.min.some((value, axis) => value > box.max[axis])) problems.push(`${label} min must not be larger than max`);
    if (box.min[1] < MIN_Y || box.max[1] > MAX_Y) problems.push(`${label} y must stay within ${MIN_Y} to ${MAX_Y}`);
    shaped.push(box);
  });
  return shaped.length > 0 && shaped.length === entries.length ? shaped : undefined;
}

/** Reports a bad position; true when it's a usable one. */
const KIT_ID = /^[a-z][a-z0-9_]*$/;
const KIT_REFILLS: readonly unknown[] = ["life", "round", "match"];

/** A map's own kits: { "mode": "append" | "replace", "base": kit, "list": [kits] }, with unique ids. */
function mapKitProblems(kits: unknown, kind: MapRules["kind"]): string[] {
  if (kind === "lobby") return ['"kits" is only for game maps'];
  if (!isRecord(kits)) return ['"kits" must be { "mode": "append" | "replace", "base": kit, "list": [kits] }'];
  const problems: string[] = [];
  if (kits.mode !== undefined && kits.mode !== "append" && kits.mode !== "replace") problems.push('"kits.mode" must be "append" or "replace"');
  if (kits.list !== undefined && !Array.isArray(kits.list)) problems.push('"kits.list" must be a list of kits');
  const entries: [string, unknown][] = [...(kits.base !== undefined ? [["kits.base", kits.base] as [string, unknown]] : []), ...(Array.isArray(kits.list) ? kits.list.map((kit, i): [string, unknown] => [`kits.list[${i}]`, kit]) : [])];
  const ids: string[] = [];
  for (const [name, kit] of entries) {
    if (!isRecord(kit)) {
      problems.push(`${name} must be { "id", "name", "items": [...] }`);
      continue;
    }
    if (typeof kit.id !== "string" || !KIT_ID.test(kit.id)) problems.push(`${name}.id must be lowercase letters, digits and _, starting with a letter`);
    else ids.push(kit.id);
    if (typeof kit.name !== "string" || !kit.name) problems.push(`${name}.name is required`);
    if (kit.refill !== undefined && !KIT_REFILLS.includes(kit.refill)) problems.push(`${name}.refill must be "life", "round" or "match"`);
    if (!Array.isArray(kit.items) || kit.items.length === 0) {
      problems.push(`${name}.items must be a non-empty list of { "item", "count" }`);
      continue;
    }
    kit.items.forEach((item: unknown, i) => {
      const where = `${name}.items[${i}]`;
      if (!isRecord(item) || typeof item.item !== "string" || !item.item) problems.push(`${where} must have an "item" id`);
      else if (item.count !== undefined && !(Number.isInteger(item.count) && (item.count as number) >= 1 && (item.count as number) <= 64)) problems.push(`${where}.count must be from 1 to 64`);
      else if (item.slot !== undefined && !(Number.isInteger(item.slot) && (item.slot as number) >= 0 && (item.slot as number) <= 35)) problems.push(`${where}.slot must be from 0 to 35`);
    });
  }
  if (new Set(ids).size !== ids.length) problems.push('"kits" ids must be unique');
  return problems;
}

function checkPosition(value: unknown, name: string, problems: string[], quoted = name): boolean {
  if (!isPosition(value)) {
    problems.push(`${quoted} must be [x, y, z]`);
    return false;
  }
  if (value.length === 5) {
    const [, , , yaw, pitch] = value;
    if (yaw < -180 || yaw > 180 || pitch < -90 || pitch > 90) {
      problems.push(`${quoted} facing must be a yaw from -180 to 180 and a pitch from -90 to 90`);
      return false;
    }
  }
  return true;
}

/** "buildLimit": { "above"?: height, "below"?: height }, the top over the bottom when it has both. */
function buildLimitProblems(value: unknown): string[] {
  if (!isRecord(value) || Object.keys(value).some((key) => !(BUILD_LIMIT_SIDES as readonly string[]).includes(key))) {
    return ['"buildLimit" must be { "above": height, "below": height }, either or both'];
  }
  const problems: string[] = [];
  for (const side of BUILD_LIMIT_SIDES) {
    const y = value[side];
    if (y === undefined) continue;
    if (typeof y !== "number" || !Number.isInteger(y)) problems.push(`"buildLimit.${side}" must be a whole number`);
    else if (y < MIN_Y || y > MAX_Y + 1) problems.push(`"buildLimit.${side}" must be within ${MIN_Y} to ${MAX_Y + 1}`);
  }
  const { above, below } = value;
  if (problems.length === 0 && typeof above === "number" && typeof below === "number" && above <= below) {
    problems.push(`"buildLimit.above" (${above}) must be over "buildLimit.below" (${below}), or nothing can be built`);
  }
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberList(value: unknown, lengths: number[]): boolean {
  return Array.isArray(value) && lengths.includes(value.length) && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isVec3(value: unknown): value is Vec3 {
  return isNumberList(value, [3]);
}

/** [x, y, z], or [x, y, z, yaw, pitch] with a saved facing. */
function isPosition(value: unknown): value is MapPosition {
  return isNumberList(value, [3, 5]);
}

function isBox(value: unknown): value is Box {
  return isRecord(value) && isVec3(value.min) && isVec3(value.max);
}

function xyz(position: MapPosition): Vec3 {
  return [position[0], position[1], position[2]];
}

/** Inside a box of whole blocks: x 12.7 is inside a max of 12, as at runtime (MapView). */
function inside(point: Vec3, min: Vec3, max: Vec3): boolean {
  return point.every((value, axis) => value >= min[axis] && value < max[axis] + 1);
}

// The viewer's keys: every action a key does, its keys (two at most), the defaults, and the ones
// changed in Settings, Keys (kept in this browser). Keys are physical keys (KeyboardEvent.code), so
// W, A, S and D stay where they are on any layout. Shift with an action's key is left alone where
// it means five steps (the Y cut, nudges) and for flying (Shift is down); elsewhere a key with
// Shift is another key. Plain TypeScript, tested.

/** A key, with the modifiers held with it. */
export interface Binding {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type ActionId =
  | "select"
  | "spawn"
  | "marker"
  | "region"
  | "height"
  | "mirror"
  | "cut"
  | "undo"
  | "redo"
  | "delete"
  | "cancel"
  | "boxMove"
  | "boxResize"
  | "nudgeOut"
  | "nudgeIn"
  | "frame"
  | "home"
  | "cutDown"
  | "cutUp"
  | "flyForward"
  | "flyBack"
  | "flyLeft"
  | "flyRight"
  | "flyUp"
  | "flyDown";

export interface Action {
  id: ActionId;
  group: "Tools" | "Changes" | "View" | "Flying";
  label: string;
  keys: Binding[];
  /** Shift with it means five steps, so Shift doesn't make it another key. */
  steps?: boolean;
  /** One of WASD flying's keys (only while flying is on). */
  fly?: boolean;
}

const key = (code: string, mods: Omit<Binding, "code"> = {}): Binding => ({ code, ...mods });

/** Every action, in the order Settings, Keys lists them, with its keys at first. */
export const ACTIONS: readonly Action[] = [
  { id: "select", group: "Tools", label: "Select", keys: [key("KeyV")] },
  { id: "spawn", group: "Tools", label: "Spawn", keys: [key("KeyP")] },
  { id: "marker", group: "Tools", label: "Marker", keys: [key("KeyM")] },
  { id: "region", group: "Tools", label: "Region", keys: [key("KeyB")] },
  { id: "height", group: "Tools", label: "Height", keys: [key("KeyH")] },
  { id: "mirror", group: "Tools", label: "Mirror", keys: [key("KeyI")] },
  { id: "cut", group: "Tools", label: "Cut", keys: [key("KeyC")] },
  { id: "undo", group: "Changes", label: "Undo", keys: [key("KeyZ", { ctrl: true })] },
  { id: "redo", group: "Changes", label: "Redo", keys: [key("KeyY", { ctrl: true }), key("KeyZ", { ctrl: true, shift: true })] },
  { id: "delete", group: "Changes", label: "Delete the picked entries", keys: [key("Delete"), key("Backspace")] },
  { id: "cancel", group: "Changes", label: "Back to Select, or pick nothing", keys: [key("Escape")] },
  { id: "boxMove", group: "Changes", label: "Picked box: Move", keys: [key("KeyG")] },
  { id: "boxResize", group: "Changes", label: "Picked box: Resize", keys: [key("KeyE")] },
  { id: "nudgeOut", group: "Changes", label: "Picked face out, or height up", keys: [key("ArrowUp"), key("ArrowRight")], steps: true },
  { id: "nudgeIn", group: "Changes", label: "Picked face in, or height down", keys: [key("ArrowDown"), key("ArrowLeft")], steps: true },
  { id: "frame", group: "View", label: "Frame the picked entry", keys: [key("KeyF")] },
  { id: "home", group: "View", label: "Home (the whole map)", keys: [key("Home")] },
  { id: "cutDown", group: "View", label: "Y cut down a layer", keys: [key("PageDown"), key("BracketLeft")], steps: true },
  { id: "cutUp", group: "View", label: "Y cut up a layer", keys: [key("PageUp"), key("BracketRight")], steps: true },
  { id: "flyForward", group: "Flying", label: "Fly forward", keys: [key("KeyW")], fly: true },
  { id: "flyBack", group: "Flying", label: "Fly back", keys: [key("KeyS")], fly: true },
  { id: "flyLeft", group: "Flying", label: "Fly left", keys: [key("KeyA")], fly: true },
  { id: "flyRight", group: "Flying", label: "Fly right", keys: [key("KeyD")], fly: true },
  { id: "flyUp", group: "Flying", label: "Fly up", keys: [key("Space")], fly: true },
  { id: "flyDown", group: "Flying", label: "Fly down", keys: [key("ShiftLeft"), key("ShiftRight")], fly: true },
];

/** How many keys an action can have. */
export const SLOTS = 2;

/** Each action's keys: SLOTS places, each a key or empty. */
export type KeyMap = Record<ActionId, (Binding | null)[]>;

const byId = new Map(ACTIONS.map((action) => [action.id, action]));

export function actionOf(id: ActionId): Action {
  return byId.get(id)!;
}

/** The keys as they are at first. */
export function defaultKeyMap(): KeyMap {
  return Object.fromEntries(ACTIONS.map((action) => [action.id, slots(action.keys)])) as KeyMap;
}

function slots(keys: readonly (Binding | null)[]): (Binding | null)[] {
  return Array.from({ length: SLOTS }, (_, i) => (keys[i] ? { ...keys[i]! } : null));
}

const MODIFIER_NAMES = ["ctrl", "alt", "shift"] as const;

/** A key read from storage, or null when it isn't one. */
function readBinding(value: unknown): Binding | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.code !== "string" || !/^[A-Za-z0-9]{1,24}$/.test(raw.code)) return null;
  const binding: Binding = { code: raw.code };
  for (const name of MODIFIER_NAMES) if (raw[name] === true) binding[name] = true;
  return binding;
}

/** The keys kept in this browser over the defaults: actions it doesn't name keep theirs. */
export function readKeyMap(saved: unknown): KeyMap {
  const map = defaultKeyMap();
  if (!saved || typeof saved !== "object") return map;
  for (const [id, keys] of Object.entries(saved as Record<string, unknown>)) {
    if (!byId.has(id as ActionId) || !Array.isArray(keys)) continue;
    map[id as ActionId] = slots(keys.map(readBinding));
  }
  return map;
}

/** Only the actions whose keys aren't the defaults, to keep. */
export function changedKeys(map: KeyMap): Partial<KeyMap> {
  const defaults = defaultKeyMap();
  const changed: Partial<KeyMap> = {};
  for (const action of ACTIONS) if (!sameSlots(map[action.id], defaults[action.id])) changed[action.id] = map[action.id];
  return changed;
}

export function isDefault(map: KeyMap, id: ActionId): boolean {
  return sameSlots(map[id], defaultKeyMap()[id]);
}

function sameSlots(a: (Binding | null)[], b: (Binding | null)[]): boolean {
  return a.every((binding, i) => (binding && b[i] ? sameBinding(binding, b[i]!) : binding === b[i]));
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift;
}

/** What a key event says: its key and the modifiers held. */
export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES: Record<string, "ctrl" | "alt" | "shift"> = {
  ShiftLeft: "shift",
  ShiftRight: "shift",
  ControlLeft: "ctrl",
  ControlRight: "ctrl",
  AltLeft: "alt",
  AltRight: "alt",
};

/** Whether a key is only a modifier (Shift, Ctrl, Alt). */
export function isModifier(code: string): boolean {
  return code in MODIFIER_CODES;
}

/**
 * Whether a key press is a binding. Ctrl (or the Mac's Command) and Alt must be held as the binding
 * says; Shift too, unless `looseShift` (five steps, flying). A binding that is itself a modifier
 * key (Shift for flying down) ignores that modifier.
 */
export function matches(binding: Binding, press: KeyPress, looseShift = false): boolean {
  if (binding.code !== press.code) return false;
  const own = MODIFIER_CODES[binding.code];
  if (own !== "ctrl" && (press.ctrlKey || !!press.metaKey) !== !!binding.ctrl) return false;
  if (own !== "alt" && press.altKey !== !!binding.alt) return false;
  if (own !== "shift" && !looseShift && press.shiftKey !== !!binding.shift) return false;
  return true;
}

/** The action a key press does, among those `wanted` (all but flying's at first). */
export function actionFor(map: KeyMap, press: KeyPress, wanted: (action: Action) => boolean = (action) => !action.fly): ActionId | undefined {
  for (const action of ACTIONS) {
    if (!wanted(action)) continue;
    if (map[action.id].some((binding) => binding !== null && matches(binding, press, action.steps || action.fly))) return action.id;
  }
  return undefined;
}

/** The key a press makes, to bind: undefined for a modifier alone (bound when it's let go). */
export function bindingOf(press: KeyPress): Binding | undefined {
  if (isModifier(press.code)) return undefined;
  return { code: press.code, ...(press.ctrlKey || press.metaKey ? { ctrl: true } : {}), ...(press.altKey ? { alt: true } : {}), ...(press.shiftKey ? { shift: true } : {}) };
}

/**
 * Gives an action's slot a key (or empties it). The key leaves any other action or slot that had
 * it, so one key never does two things; `took` names the action it was taken from.
 */
export function assign(map: KeyMap, id: ActionId, slot: number, binding: Binding | null): { map: KeyMap; took?: ActionId } {
  const next = Object.fromEntries(Object.entries(map).map(([action, keys]) => [action, keys.map((key) => (key ? { ...key } : null))])) as KeyMap;
  let took: ActionId | undefined;
  if (binding) {
    for (const action of ACTIONS) {
      next[action.id] = next[action.id].map((key, i) => {
        if (!key || !sameBinding(key, binding) || (action.id === id && i === slot)) return key;
        if (action.id !== id) took = action.id;
        return null;
      });
    }
  }
  next[id][slot] = binding ? { ...binding } : null;
  return { map: next, ...(took ? { took } : {}) };
}

/** Back to an action's own keys; any other action using one of them loses it. */
export function resetAction(map: KeyMap, id: ActionId): { map: KeyMap; took: ActionId[] } {
  let next = map;
  const took: ActionId[] = [];
  actionOf(id).keys.forEach((binding, slot) => {
    const result = assign(next, id, slot, binding);
    next = result.map;
    if (result.took) took.push(result.took);
  });
  for (let slot = actionOf(id).keys.length; slot < SLOTS; slot++) next = assign(next, id, slot, null).map;
  return { map: next, took };
}

const NAMES: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageUp: "Page Up",
  PageDown: "Page Down",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Escape: "Esc",
  Delete: "Del",
  Insert: "Ins",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
};

/** A key as people say it: "V", "Ctrl+Shift+Z", "Page Down", "[". */
export function keyLabel(binding: Binding): string {
  const code = binding.code;
  const name = NAMES[code] ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^Numpad\d$/.test(code) ? `Num ${code.slice(6)}` : code);
  return [binding.ctrl ? "Ctrl" : "", binding.alt ? "Alt" : "", binding.shift ? "Shift" : "", name].filter(Boolean).join("+");
}

/** An action's first key as people say it (for tooltips), or "" when it has none. */
export function keyText(map: KeyMap, id: ActionId): string {
  const first = map[id].find((binding) => binding !== null);
  return first ? keyLabel(first) : "";
}

/** An action's keys, "Page Down or [", or "" when it has none; both Shifts (or Ctrls, Alts) are just "Shift". */
export function keysText(map: KeyMap, id: ActionId): string {
  const labels = map[id].filter((binding): binding is Binding => binding !== null).map(keyLabel);
  const both = labels.find((label) => label.startsWith("Left ") && labels.includes(`Right ${label.slice(5)}`));
  return (both ? [both.slice(5), ...labels.filter((label) => label !== both && label !== `Right ${both.slice(5)}`)] : labels).join(" or ");
}

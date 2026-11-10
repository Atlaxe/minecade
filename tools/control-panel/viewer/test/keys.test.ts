import { describe, expect, it } from "vitest";
import { ACTIONS, actionFor, assign, bindingOf, changedKeys, defaultKeyMap, isDefault, keyLabel, keysText, matches, readKeyMap, resetAction, type KeyPress } from "../keys.ts";

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ code, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("the default keys", () => {
  it("are the keys the viewer has always had, one action each", () => {
    const map = defaultKeyMap();
    expect(actionFor(map, press("KeyV"))).toBe("select");
    expect(actionFor(map, press("KeyI"))).toBe("mirror");
    expect(actionFor(map, press("KeyZ", { ctrlKey: true }))).toBe("undo");
    expect(actionFor(map, press("KeyZ", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(actionFor(map, press("KeyY", { ctrlKey: true }))).toBe("redo");
    expect(actionFor(map, press("Backspace"))).toBe("delete");
    expect(actionFor(map, press("KeyD", { ctrlKey: true }))).toBe("duplicate");
    // D alone is flying's, never Duplicate's.
    expect(actionFor(map, press("KeyD"))).toBeUndefined();
    expect(actionFor(map, press("Escape"))).toBe("cancel");
    // No key does two things.
    const seen = new Set<string>();
    for (const action of ACTIONS) {
      for (const binding of action.keys) {
        const label = keyLabel(binding);
        expect(seen.has(label)).toBe(false);
        seen.add(label);
      }
    }
  });

  it("let Shift through where it means five steps, and nowhere else", () => {
    const map = defaultKeyMap();
    expect(actionFor(map, press("PageDown", { shiftKey: true }))).toBe("cutDown");
    expect(actionFor(map, press("BracketRight", { shiftKey: true }))).toBe("cutUp");
    expect(actionFor(map, press("ArrowLeft", { shiftKey: true }))).toBe("nudgeIn");
    expect(actionFor(map, press("KeyV", { shiftKey: true }))).toBeUndefined();
    // Ctrl or Alt with a tool's key is something else (Ctrl+C copies).
    expect(actionFor(map, press("KeyC", { ctrlKey: true }))).toBeUndefined();
    expect(actionFor(map, press("KeyM", { altKey: true }))).toBeUndefined();
  });

  it("keep flying's keys apart, Shift held or not, and Shift itself is down", () => {
    const map = defaultKeyMap();
    expect(actionFor(map, press("KeyW"))).toBeUndefined();
    const flying = (action: { fly?: boolean }) => action.fly === true;
    expect(actionFor(map, press("KeyW", { shiftKey: true }), flying)).toBe("flyForward");
    expect(actionFor(map, press("ShiftRight", { shiftKey: true }), flying)).toBe("flyDown");
    expect(matches({ code: "ShiftLeft" }, press("ShiftLeft", { shiftKey: true }))).toBe(true);
  });
});

describe("changing keys", () => {
  it("gives a slot a key and takes it from the action that had it", () => {
    const { map, took } = assign(defaultKeyMap(), "mirror", 0, { code: "KeyV" });
    expect(took).toBe("select");
    expect(map.select).toEqual([null, null]);
    expect(actionFor(map, press("KeyV"))).toBe("mirror");
    expect(actionFor(map, press("KeyI"))).toBeUndefined();
    // The same key in the action's other slot just moves.
    const moved = assign(defaultKeyMap(), "redo", 0, { code: "KeyZ", ctrl: true, shift: true });
    expect(moved.took).toBeUndefined();
    expect(moved.map.redo).toEqual([{ code: "KeyZ", ctrl: true, shift: true }, null]);
  });

  it("empties a slot, and resets an action to its own keys", () => {
    let map = assign(defaultKeyMap(), "delete", 1, null).map;
    expect(keysText(map, "delete")).toBe("Del");
    map = assign(map, "frame", 0, { code: "Delete" }).map;
    expect(map.delete).toEqual([null, null]);
    const reset = resetAction(map, "delete");
    expect(reset.took).toEqual(["frame"]);
    expect(isDefault(reset.map, "delete")).toBe(true);
    expect(reset.map.frame).toEqual([null, null]);
  });

  it("keeps only what changed, and reads it back over the defaults, leaving out what isn't a key", () => {
    const map = assign(defaultKeyMap(), "home", 1, { code: "KeyO", shift: true }).map;
    const kept = JSON.parse(JSON.stringify(changedKeys(map)));
    expect(kept).toEqual({ home: [{ code: "Home" }, { code: "KeyO", shift: true }] });
    expect(readKeyMap(kept)).toEqual(map);
    expect(readKeyMap({ home: [{ code: 5 }, "x"], nothing: [], select: "V" })).toEqual({ ...defaultKeyMap(), home: [null, null] });
    expect(readKeyMap(null)).toEqual(defaultKeyMap());
  });
});

describe("keys in words", () => {
  it("names keys as people say them", () => {
    expect(keyLabel({ code: "KeyZ", ctrl: true, shift: true })).toBe("Ctrl+Shift+Z");
    expect(keyLabel({ code: "PageDown" })).toBe("Page Down");
    expect(keyLabel({ code: "BracketLeft" })).toBe("[");
    expect(keyLabel({ code: "Digit4", alt: true })).toBe("Alt+4");
    expect(keyLabel({ code: "ShiftLeft" })).toBe("Left Shift");
    expect(keysText(defaultKeyMap(), "cutDown")).toBe("Page Down or [");
    expect(keysText(defaultKeyMap(), "flyDown")).toBe("Shift");
  });

  it("makes a key from a press, waiting on a modifier alone", () => {
    expect(bindingOf(press("KeyK", { ctrlKey: true, shiftKey: true }))).toEqual({ code: "KeyK", ctrl: true, shift: true });
    expect(bindingOf(press("ShiftLeft", { shiftKey: true }))).toBeUndefined();
  });
});

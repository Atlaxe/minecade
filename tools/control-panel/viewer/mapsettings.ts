// The map's own settings in the viewer (pass V.12; out of their dialog after it, as the user asked),
// what game Edit sets in its map menu's gear, its Time tool, its Game settings tool and the queue
// spawn's screen:
// - Map settings (MapSettings), in the right panel with Select and nothing picked: the map's name,
//   the queue's countdown once the queue spawn is placed, each of the game's own settings for the
//   map (map.settings in its config, with their ranges and defaults), the lobby's star box, any
//   other plain key of the game's own the map has, and Port to another game.
// - The Time tool's panel (TimeTool): the map's time of day, game Edit's Noon, Dusk, Midnight and
//   Dawn, or a time typed on the 24-hour clock.
// - The picked queue spawn's (queuePanel): how players wait there, locked in or free.
// Each change is one edit (one undo step), made when a field is done (Enter, or leaving it) or a
// choice is picked.
import { QUEUE_COUNTDOWN, isMapKey, mapSettings, mapTimeTicks, queueSettings, settingText, type EditorRules, type MapConfig, type MapEdit, type MapTime } from "@minecade/minigame-core/config";
import { TIME_PRESETS, clockText, hoursLater, parseClock, presetOf } from "../../../editor/behavior_pack/scripts/time-of-day.ts";
import { MAX_NAME } from "../../viewer/edit-check.ts";
import { el } from "./sidebar.ts";

export interface MapSettingsOptions {
  /** The map's id (its folder). */
  map: string;
  rules: EditorRules;
  edit(change: MapEdit): void;
  /** Says why a value wasn't taken. */
  note(text: string): void;
  /** Port to another game: opens its dialog. */
  port(): void;
}

/** A value typed for a key that holds `old`: the same kind of value, or undefined when it isn't one (game Edit's parseSetting). */
export function parseValue(text: string, old: string | number | boolean): string | number | boolean | undefined {
  if (typeof old === "string") return text;
  const trimmed = text.trim();
  if (typeof old === "boolean") return /^(true|false)$/i.test(trimmed) ? trimmed.toLowerCase() === "true" : undefined;
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) ? value : undefined;
}

/** A setting's hint as a sentence: "How far builders can go." */
function sentence(text: string | undefined): string {
  if (!text) return "";
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The map's own keys that aren't map.json's or one of the game's settings, with a plain value: game Edit's Name and map id form lists them. */
export function otherKeys(config: MapConfig, rules: EditorRules): [string, string | number | boolean][] {
  const declared = new Set(mapSettings(rules.requires).map((setting) => setting.key));
  return Object.entries(config).filter(
    (entry): entry is [string, string | number | boolean] => !isMapKey(entry[0]) && !declared.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1]),
  );
}

/** Whether a text or number field inside `element` is being typed in. */
function typingIn(element: HTMLElement): boolean {
  const active = document.activeElement;
  return element.contains(active) && active instanceof HTMLInputElement && (active.type === "text" || active.type === "number");
}

/** A field's value goes once it's done: Enter, or leaving it. Esc puts the value back and leaves it. */
function onDone(input: HTMLInputElement, done: () => void): void {
  const start = input.value;
  input.addEventListener("change", done);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = start;
      input.blur();
    }
  });
}

/** Puts a value back that wasn't taken, and says why. */
function refuse(input: HTMLInputElement, value: string, why: string, note: (text: string) => void): void {
  input.value = value;
  note(why);
}

/** Map settings in the right panel: drawn again whenever the map changes, unless one of its fields is being typed in. */
export class MapSettings {
  private config: MapConfig | undefined;
  /** A field is being typed in: the panel is drawn again once it's left. */
  private pending = false;

  constructor(
    readonly element: HTMLElement,
    private readonly options: MapSettingsOptions,
  ) {
    element.addEventListener("focusout", () => {
      if (!this.pending) return;
      // After the field's own change has gone out.
      setTimeout(() => {
        if (typingIn(this.element)) return;
        this.pending = false;
        this.draw();
      }, 0);
    });
  }

  /** The map changed (an edit here, an undo, game Edit): the panel follows, unless a field in it is being typed in. */
  update(config: MapConfig): void {
    this.config = config;
    if (typingIn(this.element)) {
      this.pending = true;
      return;
    }
    this.draw();
  }

  private draw(): void {
    const config = this.config;
    if (!config) return;
    const { rules, map } = this.options;
    const parts = [
      el("h2", {}, "Map settings"),
      el("p", { className: "sub" }, `Map id ${map}: game Edit's Name and map id changes it.`),
      this.nameField(config),
      this.countdownField(config),
      this.gameSettings(config, rules),
      rules.kind === "lobby" ? this.starBox(config) : null,
      this.otherKeys(config, rules),
      el(
        "div",
        { className: "buttons" },
        el("button", { className: "small", dataset: { tip: "Its blocks become a new map of another game, with nothing placed yet" }, onclick: () => this.options.port() }, "Port to another game"),
      ),
    ];
    this.element.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  }

  private nameField(config: MapConfig): HTMLElement {
    const input = el("input", { type: "text", value: config.name, maxLength: MAX_NAME, spellcheck: false, autocomplete: "off", className: "wide" });
    onDone(input, () => {
      const name = input.value.trim();
      if (!name) return refuse(input, config.name, "A map needs a name.", this.options.note);
      if (name !== config.name) this.options.edit({ op: "name", name });
    });
    return el("label", { className: "setting" }, el("span", { className: "group-label" }, "Name"), input);
  }

  /** The queue's countdown, once the queue spawn is placed (the game counts it down only there). */
  private countdownField(config: MapConfig): HTMLElement | null {
    if (config.queueSpawn === undefined) return null;
    const queue = queueSettings(config);
    const { min, max } = QUEUE_COUNTDOWN;
    const input = el("input", { type: "number", min: String(min), max: String(max), step: "1", value: String(queue.countdown), className: "number" });
    onDone(input, () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < min || value > max) return refuse(input, String(queue.countdown), `The countdown is whole seconds from ${min} to ${max}.`, this.options.note);
      if (value !== queue.countdown) this.options.edit({ op: "queue", countdown: value });
    });
    return el(
      "div",
      { className: "setting" },
      el("label", { className: "field-row" }, el("span", { className: "strong" }, "Countdown"), input, el("span", { className: "muted meta" }, "seconds")),
      el("p", { className: "sub" }, `Once everyone is in at the queue spawn, before they're put at their spawns: ${min} to ${max}.`),
    );
  }

  private gameSettings(config: MapConfig, rules: EditorRules): HTMLElement | null {
    const settings = mapSettings(rules.requires);
    if (settings.length === 0) return null;
    return el(
      "div",
      {},
      el("div", { className: "group-label" }, "Game settings"),
      settings.map((setting) => {
        const own = config[setting.key];
        const set = typeof own === "number";
        const input = el("input", { type: "number", min: String(setting.min), max: String(setting.max), step: "1", value: String(set ? own : setting.default), className: "number" });
        onDone(input, () => {
          const value = Number(input.value);
          if (!Number.isInteger(value) || value < setting.min || value > setting.max) return refuse(input, String(set ? own : setting.default), `${setting.label} is a whole number from ${setting.min} to ${setting.max}.`, this.options.note);
          if (value !== own) this.options.edit({ op: "extra", key: setting.key, value });
        });
        const reset = set ? el("button", { className: "small", onclick: () => this.options.edit({ op: "extra", key: setting.key }) }, "Use the default") : null;
        return el(
          "div",
          { className: "setting" },
          el("label", { className: "field-row" }, el("span", { className: "strong" }, setting.label), input, setting.unit ? el("span", { className: "muted meta" }, setting.unit) : null),
          reset ? el("div", { className: "buttons tight" }, reset) : null,
          el("p", { className: "sub" }, [sentence(setting.hint), `The default is ${settingText(setting, setting.default)}; it can be ${setting.min} to ${setting.max}.`].filter(Boolean).join(" ")),
        );
      }),
    );
  }

  private starBox(config: MapConfig): HTMLElement {
    const box = el("input", { type: "checkbox", checked: config.stars === true, onchange: () => this.options.edit({ op: "stars", on: box.checked }) });
    return el(
      "div",
      { className: "setting" },
      el("label", { className: "field-row" }, box, "Star box: stars all around, below the horizon too"),
      el("p", { className: "sub" }, "Bedrock's own sky has stars only above the horizon. Use it with a night time."),
    );
  }

  private otherKeys(config: MapConfig, rules: EditorRules): HTMLElement | null {
    const keys = otherKeys(config, rules);
    if (keys.length === 0) return null;
    return el(
      "div",
      {},
      el("div", { className: "group-label" }, "The game's other keys"),
      keys.map(([key, value]) => {
        if (typeof value === "boolean") {
          const box = el("input", { type: "checkbox", checked: value, onchange: () => this.options.edit({ op: "extra", key, value: box.checked }) });
          return el("label", { className: "field-row" }, box, el("span", { className: "mono" }, key));
        }
        const input = el("input", { type: typeof value === "number" ? "number" : "text", value: String(value), spellcheck: false, autocomplete: "off", className: typeof value === "number" ? "number" : "grow" });
        onDone(input, () => {
          const next = parseValue(input.value, value);
          if (next === undefined) return refuse(input, String(value), `${key} is a ${typeof value}.`, this.options.note);
          if (next !== value) this.options.edit({ op: "extra", key, value: next });
        });
        return el("label", { className: "field-row" }, el("span", { className: "mono" }, key), input);
      }),
    );
  }
}

export interface TimeToolOptions {
  edit(change: MapEdit): void;
  note(text: string): void;
  /** Draws the panel again (Custom picked before a time is typed). */
  redraw(): void;
}

/** The Time tool's panel: the map's time of day, as game Edit's Time tool sets it. */
export class TimeTool {
  /** Custom is picked, before a time is typed. */
  private custom = false;

  constructor(private readonly options: TimeToolOptions) {}

  /** Another tool: Custom goes back to what the map has. */
  reset(): void {
    this.custom = false;
  }

  panel(config: MapConfig): HTMLElement {
    const { edit, note, redraw } = this.options;
    const time = config.time as MapTime | undefined;
    const ticks = mapTimeTicks(time);
    const preset = presetOf(time);
    const custom = this.custom || (ticks !== undefined && preset === undefined);
    const set = (next: MapTime | undefined) => {
      this.custom = false;
      if (next !== time) edit({ op: "time", time: next });
      else redraw();
    };
    const choice = (label: string, detail: string, on: boolean, pick: () => void) =>
      el("button", { className: `choice${on ? " on" : ""}`, role: "radio", ariaChecked: String(on), onclick: pick }, el("span", {}, label), el("span", { className: "count" }, detail));
    const clock = el("input", { type: "text", value: ticks !== undefined ? clockText(ticks) : "18:00", placeholder: "14:30", spellcheck: false, autocomplete: "off", className: "clock" });
    onDone(clock, () => {
      const typed = parseClock(clock.value);
      if (typed === undefined) return refuse(clock, ticks !== undefined ? clockText(ticks) : "", `"${clock.value}" isn't a time: type it on the 24-hour clock, such as 14:30.`, note);
      this.custom = false;
      if (typed !== ticks || preset !== undefined) edit({ op: "time", time: typed });
    });
    const later = (hours: number) => {
      this.custom = false;
      edit({ op: "time", time: hoursLater(ticks ?? 0, hours) });
    };
    return el(
      "section",
      {},
      el("h2", {}, "Time"),
      el("p", { className: "sub" }, "The map's time of day: its servers stop the daylight cycle here."),
      el(
        "div",
        { className: "choices", role: "radiogroup", ariaLabel: "Time of day" },
        choice("Not set", "noon in the editor", ticks === undefined && !this.custom, () => set(undefined)),
        TIME_PRESETS.map((each) => choice(each.label, clockText(mapTimeTicks(each.id) ?? 0), !custom && preset === each.id, () => set(each.id))),
        choice("Custom", custom && ticks !== undefined ? clockText(ticks) : "", custom, () => {
          this.custom = true;
          redraw();
          document.querySelector<HTMLInputElement>("input.clock")?.focus();
        }),
      ),
      custom
        ? el("label", { className: "field-row" }, el("span", { className: "strong" }, "Time"), clock, el("span", { className: "muted meta" }, "24-hour clock"))
        : null,
      custom && ticks !== undefined
        ? el(
            "div",
            { className: "buttons" },
            el("button", { className: "small", onclick: () => later(-1) }, "An hour earlier"),
            el("button", { className: "small", onclick: () => later(1) }, "An hour later"),
          )
        : null,
    );
  }
}

/** The picked queue spawn's settings: how players wait there. */
export function queuePanel(config: MapConfig, edit: (change: MapEdit) => void): HTMLElement {
  const queue = queueSettings(config);
  const mode = (value: "lock" | "free", label: string, tip: string) =>
    el("button", { className: `small${queue.mode === value ? " on" : ""}`, ariaPressed: String(queue.mode === value), dataset: { tip }, onclick: () => queue.mode !== value && edit({ op: "queue", mode: value }) }, label);
  return el(
    "div",
    {},
    el("div", { className: "group-label" }, "Players wait here"),
    el("div", { className: "modes" }, mode("lock", "Lock in", "They look around but don't move, and can't see each other"), mode("free", "Free", "They roam until they're put at their spawns")),
    el("p", { className: "sub queue-note" }, queue.mode === "lock" ? "Locked in: they look around but don't move, and can't see each other." : "Free: they roam until they're put at their spawns."),
  );
}

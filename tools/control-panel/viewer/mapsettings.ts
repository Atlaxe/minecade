// The viewer's Map settings (the gear beside the map's name), what game Edit sets in its map menu's
// gear, its Time tool and its Game settings tool: the map's name, its time of day (game Edit's
// Noon, Dusk, Midnight and Dawn, or a time typed on the 24-hour clock), how players wait at the
// queue spawn (locked in or free, and the countdown), each of the game's own settings for the map
// (map.settings in its config, with their ranges and defaults), the lobby's star box, and any
// other plain key of the game's own the map has. Each change is one edit (one undo step), made
// when a field is done (Enter, or leaving it) or a choice is picked.
import { QUEUE_COUNTDOWN, isMapKey, mapSettings, mapTimeTicks, queueSettings, settingText, type EditorRules, type MapConfig, type MapEdit, type MapTime } from "@minecade/minigame-core/config";
import { TIME_PRESETS, clockText, parseClock, presetOf } from "../../../editor/behavior_pack/scripts/time-of-day.ts";
import { MAX_NAME } from "../../viewer/edit-check.ts";
import { el } from "./sidebar.ts";

export interface MapSettingsOptions {
  /** The map's id (its folder). */
  map: string;
  rules: EditorRules;
  edit(change: MapEdit): void;
  /** Says why a value wasn't taken. */
  note(text: string): void;
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

export class MapSettings {
  private config: MapConfig | undefined;
  private readonly body: HTMLElement;
  /** A field is being typed in: the form is drawn again once it's left. */
  private pending = false;
  /** Custom is picked for the time, before a time is typed. */
  private customTime = false;

  constructor(
    readonly dialog: HTMLDialogElement,
    private readonly options: MapSettingsOptions,
  ) {
    this.body = dialog.querySelector<HTMLElement>("#map-settings-body")!;
    this.body.addEventListener("focusout", () => {
      if (!this.pending) return;
      // After the field's own change has gone out.
      setTimeout(() => {
        if (this.body.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== "radio" && document.activeElement.type !== "checkbox") return;
        this.pending = false;
        this.draw();
      }, 0);
    });
    dialog.addEventListener("close", () => (this.customTime = false));
  }

  open(config: MapConfig): void {
    this.config = config;
    this.customTime = false;
    this.draw();
    this.dialog.showModal();
  }

  /** The map changed (an edit here, an undo, game Edit): the form follows, unless a field is being typed in. */
  update(config: MapConfig): void {
    this.config = config;
    if (!this.dialog.open) return;
    const active = document.activeElement;
    if (this.body.contains(active) && active instanceof HTMLInputElement && (active.type === "text" || active.type === "number")) {
      this.pending = true;
      return;
    }
    this.draw();
  }

  private draw(): void {
    const config = this.config;
    if (!config) return;
    const { rules } = this.options;
    const scroll = this.body.scrollTop;
    const sections = [
      this.nameSection(config),
      this.timeSection(config),
      this.queueSection(config),
      this.gameSection(config, rules),
      rules.kind === "lobby" ? this.starsSection(config) : null,
      this.otherSection(config, rules),
    ];
    this.body.replaceChildren(...sections.filter((section): section is HTMLElement => section !== null));
    this.body.scrollTop = scroll;
  }

  private nameSection(config: MapConfig): HTMLElement {
    const input = el("input", { type: "text", value: config.name, maxLength: MAX_NAME, spellcheck: false, autocomplete: "off" });
    input.setAttribute("aria-label", "The map's name");
    this.onDone(input, () => {
      const name = input.value.trim();
      if (!name) return this.refuse(input, config.name, "A map needs a name.");
      if (name !== config.name) this.options.edit({ op: "name", name });
    });
    return el(
      "fieldset",
      {},
      el("legend", {}, "Name"),
      input,
      el("p", { className: "hint flush" }, `Map id: ${this.options.map}. Game Edit's Name and map id changes it (the map's folder moves).`),
    );
  }

  private timeSection(config: MapConfig): HTMLElement {
    const time = config.time as MapTime | undefined;
    const ticks = mapTimeTicks(time);
    const preset = presetOf(time);
    const custom = this.customTime || (ticks !== undefined && preset === undefined);
    const choice = (label: string, on: boolean, pick: () => void) => {
      const radio = el("input", { type: "radio", name: "map-time", checked: on, onchange: pick });
      return el("label", { className: "choice-chip" }, radio, label);
    };
    const clock = el("input", { type: "text", value: ticks !== undefined ? clockText(ticks) : "18:00", placeholder: "14:30", spellcheck: false, autocomplete: "off", className: "clock" });
    clock.setAttribute("aria-label", "A time on the 24-hour clock");
    this.onDone(clock, () => {
      const typed = parseClock(clock.value);
      if (typed === undefined) return this.refuse(clock, ticks !== undefined ? clockText(ticks) : "", `"${clock.value}" isn't a time: type it on the 24-hour clock, such as 14:30.`);
      this.customTime = false;
      if (typed !== ticks || preset !== undefined) this.options.edit({ op: "time", time: typed });
    });
    const set = (next: MapTime | undefined) => {
      this.customTime = false;
      if (next !== time) this.options.edit({ op: "time", time: next });
      else this.draw();
    };
    return el(
      "fieldset",
      {},
      el("legend", {}, "Time of day"),
      el(
        "div",
        { className: "choice-row" },
        choice("Not set", ticks === undefined && !this.customTime, () => set(undefined)),
        TIME_PRESETS.map((each) => choice(`${each.label} (${clockText(mapTimeTicks(each.id) ?? 0)})`, !custom && preset === each.id, () => set(each.id))),
        choice("Custom", custom, () => {
          this.customTime = true;
          this.draw();
          this.body.querySelector<HTMLInputElement>("input.clock")?.focus();
        }),
      ),
      custom ? el("label", { className: "inline-field" }, "Time", clock, el("span", { className: "muted meta" }, "24-hour clock")) : null,
      el("p", { className: "hint flush" }, "The map's servers stop the daylight cycle here. Not set: the editor shows noon."),
    );
  }

  private queueSection(config: MapConfig): HTMLElement {
    const legend = el("legend", {}, "Queue");
    if (config.queueSpawn === undefined) return el("fieldset", {}, legend, el("p", { className: "hint flush" }, "How players wait at the queue spawn, once it's placed (the Spawn tool)."));
    const queue = queueSettings(config);
    const mode = (value: "lock" | "free", label: string) =>
      el("label", { className: "choice-chip" }, el("input", { type: "radio", name: "map-queue", checked: queue.mode === value, onchange: () => this.options.edit({ op: "queue", mode: value }) }), label);
    const { min, max } = QUEUE_COUNTDOWN;
    const countdown = el("input", { type: "number", min: String(min), max: String(max), step: "1", value: String(queue.countdown), className: "number" });
    countdown.setAttribute("aria-label", "Countdown, in seconds");
    this.onDone(countdown, () => {
      const value = Number(countdown.value);
      if (!Number.isInteger(value) || value < min || value > max) return this.refuse(countdown, String(queue.countdown), `The countdown is whole seconds from ${min} to ${max}.`);
      if (value !== queue.countdown) this.options.edit({ op: "queue", countdown: value });
    });
    return el(
      "fieldset",
      {},
      legend,
      el("div", { className: "choice-row" }, mode("lock", "Lock in"), mode("free", "Free")),
      el("p", { className: "hint flush" }, "Lock in: players look around but don't move, and can't see each other. Free: they roam."),
      el("label", { className: "inline-field" }, "Countdown", countdown, el("span", { className: "muted meta" }, `seconds once everyone is in (${min} to ${max})`)),
    );
  }

  private gameSection(config: MapConfig, rules: EditorRules): HTMLElement | null {
    const settings = mapSettings(rules.requires);
    if (settings.length === 0) return null;
    return el(
      "fieldset",
      {},
      el("legend", {}, "Game settings"),
      settings.map((setting) => {
        const own = config[setting.key];
        const set = typeof own === "number";
        const input = el("input", { type: "number", min: String(setting.min), max: String(setting.max), step: "1", value: String(set ? own : setting.default), className: "number" });
        input.setAttribute("aria-label", setting.label);
        this.onDone(input, () => {
          const value = Number(input.value);
          if (!Number.isInteger(value) || value < setting.min || value > setting.max) return this.refuse(input, String(set ? own : setting.default), `${setting.label} is a whole number from ${setting.min} to ${setting.max}.`);
          if (value !== own) this.options.edit({ op: "extra", key: setting.key, value });
        });
        const reset = set ? el("button", { type: "button", className: "small", onclick: () => this.options.edit({ op: "extra", key: setting.key }) }, "Use the default") : null;
        return el(
          "div",
          { className: "setting" },
          el("label", { className: "inline-field" }, el("span", { className: "strong" }, setting.label), input, setting.unit ? el("span", { className: "muted meta" }, setting.unit) : null, reset),
          el("p", { className: "hint flush" }, [sentence(setting.hint), `The default is ${settingText(setting, setting.default)}; it can be ${setting.min} to ${setting.max}.`].filter(Boolean).join(" ")),
        );
      }),
    );
  }

  private starsSection(config: MapConfig): HTMLElement {
    const box = el("input", { type: "checkbox", checked: config.stars === true, onchange: () => this.options.edit({ op: "stars", on: box.checked }) });
    return el(
      "fieldset",
      {},
      el("legend", {}, "Star box"),
      el("label", {}, box, "Stars all around the map, below the horizon too"),
      el("p", { className: "hint" }, "Bedrock's own sky has stars only above the horizon. Use it with a night time."),
    );
  }

  private otherSection(config: MapConfig, rules: EditorRules): HTMLElement | null {
    const keys = otherKeys(config, rules);
    if (keys.length === 0) return null;
    return el(
      "fieldset",
      {},
      el("legend", {}, "The game's other keys"),
      keys.map(([key, value]) => {
        if (typeof value === "boolean") {
          const box = el("input", { type: "checkbox", checked: value, onchange: () => this.options.edit({ op: "extra", key, value: box.checked }) });
          return el("label", {}, box, el("span", { className: "mono" }, key));
        }
        const input = el("input", { type: typeof value === "number" ? "number" : "text", value: String(value), spellcheck: false, autocomplete: "off", className: typeof value === "number" ? "number" : "" });
        input.setAttribute("aria-label", key);
        this.onDone(input, () => {
          const next = parseValue(input.value, value);
          if (next === undefined) return this.refuse(input, String(value), `${key} is a ${typeof value}.`);
          if (next !== value) this.options.edit({ op: "extra", key, value: next });
        });
        return el("label", { className: "inline-field" }, el("span", { className: "mono" }, key), input);
      }),
    );
  }

  /** A field's value goes once it's done: Enter, or leaving it. Esc puts the value back and leaves it. */
  private onDone(input: HTMLInputElement, done: () => void): void {
    const start = input.value;
    input.addEventListener("change", done);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape" && input.value !== start) {
        // Esc first puts the value back, then closes the dialog.
        event.preventDefault();
        input.value = start;
      }
    });
  }

  private refuse(input: HTMLInputElement, value: string, why: string): void {
    input.value = value;
    this.options.note(why);
  }
}

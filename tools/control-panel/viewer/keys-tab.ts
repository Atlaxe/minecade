// Settings' Keys tab: every action the viewer has a key for, by group, each with its two keys. A
// click on a key waits for the next key pressed (Esc leaves it as it was; a modifier let go on its
// own, such as Shift for flying down, is the key), the x beside a key takes it away, and Default
// puts an action's own keys back. A key another action had moves to this one, and the line beside
// Done says so.
import { ACTIONS, SLOTS, actionOf, assign, bindingOf, defaultKeyMap, isDefault, isModifier, keyLabel, resetAction, type Action, type ActionId, type Binding, type KeyMap } from "./keys.ts";
import { el } from "./sidebar.ts";

const GROUPS: { group: Action["group"]; title: string }[] = [
  { group: "Tools", title: "Tools" },
  { group: "Changes", title: "Changes" },
  { group: "View", title: "View" },
  { group: "Flying", title: "WASD flying" },
];

/** How long after a key is bound its key-up (or the dialog's own Esc) is still its. */
const SWALLOW_MS = 400;

export class KeysTab {
  /** The key waiting for a press, and a modifier held meanwhile (bound alone if let go first). */
  private capture: { id: ActionId; slot: number; held?: string } | undefined;
  private note = "";
  /** A key just bound or Esc just used here: its key-up and the dialog's close aren't the page's. */
  private swallow: { code: string; until: number } | undefined;

  constructor(
    private readonly root: HTMLElement,
    /** Where the tab says what a change did (a key taken from another action). */
    private readonly noteLine: HTMLElement,
    private map: KeyMap,
    private readonly changed: (map: KeyMap) => void,
  ) {
    addEventListener("keydown", (event) => this.onKeyDown(event), true);
    addEventListener("keyup", (event) => this.onKeyUp(event), true);
    this.render();
  }

  /** Whether the tab is waiting for a key, or just took one (so Esc doesn't close the dialog). */
  get busy(): boolean {
    return this.capture !== undefined || (this.swallow !== undefined && performance.now() < this.swallow.until);
  }

  /** Stops waiting for a key (the dialog closed or the tab changed). */
  stop(): void {
    this.note = "";
    this.capture = undefined;
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.capture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.code === "Escape") {
      this.capture = undefined;
      this.swallow = { code: event.code, until: performance.now() + SWALLOW_MS };
      this.render();
      return;
    }
    if (isModifier(event.code)) {
      this.capture.held = event.code;
      return;
    }
    const binding = bindingOf(event);
    if (binding) this.bind(binding, event.code);
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (this.swallow && event.code === this.swallow.code && performance.now() < this.swallow.until) {
      // Space or Enter let go over the key's button would press it again.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.swallow = undefined;
      return;
    }
    if (!this.capture?.held || event.code !== this.capture.held) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.bind({ code: event.code }, event.code);
  }

  private bind(binding: Binding, code: string): void {
    const { id, slot } = this.capture!;
    this.capture = undefined;
    this.swallow = { code, until: performance.now() + SWALLOW_MS };
    const result = assign(this.map, id, slot, binding);
    this.note = result.took ? `${keyLabel(binding)} moved here from ${actionOf(result.took).label}.` : "";
    this.update(result.map);
  }

  private update(map: KeyMap): void {
    this.map = map;
    this.changed(map);
    this.render();
  }

  private render(): void {
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement.dataset.slot : undefined;
    this.noteLine.textContent = this.note;
    this.noteLine.hidden = !this.note;
    this.root.replaceChildren(
      ...GROUPS.map(({ group, title }) =>
        el(
          "fieldset",
          {},
          el("legend", {}, title),
          el(
            "div",
            { className: "key-rows" },
            ACTIONS.filter((action) => action.group === group).map((action) => this.row(action)),
          ),
        ),
      ),
      el(
        "div",
        { className: "keys-actions" },
        el(
          "button",
          {
            type: "button",
            className: "small",
            onclick: () => {
              this.note = "";
              this.update(defaultKeyMap());
            },
          },
          "All keys to their defaults",
        ),
      ),
    );
    if (focused) this.root.querySelector<HTMLElement>(`[data-slot="${focused}"]`)?.focus();
  }

  private row(action: Action): HTMLElement {
    return el(
      "div",
      { className: "key-row" },
      el("span", { className: "key-label" }, action.label),
      Array.from({ length: SLOTS }, (_, slot) => this.slot(action.id, slot)),
      isDefault(this.map, action.id)
        ? el("span", { className: "key-reset" })
        : el(
            "button",
            {
              type: "button",
              className: "small key-reset",
              dataset: { tip: `${action.label}: ${actionOf(action.id).keys.map(keyLabel).join(" and ")}` },
              onclick: () => {
                const { map, took } = resetAction(this.map, action.id);
                this.note = took.length > 0 ? `Taken back from ${took.map((id) => actionOf(id).label).join(" and ")}.` : "";
                this.update(map);
              },
            },
            "Default",
          ),
    );
  }

  private slot(id: ActionId, slot: number): HTMLElement {
    const binding = this.map[id][slot];
    const waiting = this.capture?.id === id && this.capture.slot === slot;
    const label = binding ? keyLabel(binding) : "";
    return el(
      "span",
      { className: `key-slot${waiting ? " waiting" : ""}${binding ? "" : " none"}` },
      el(
        "button",
        {
          type: "button",
          className: "key",
          dataset: { slot: `${id}:${slot}` },
          ariaLabel: waiting ? "Press a key, or Esc to keep it" : `${actionOf(id).label}: ${label || "no key"}. Change it`,
          onclick: () => {
            this.capture = waiting ? undefined : { id, slot };
            this.note = "";
            this.render();
          },
        },
        waiting ? "Press a key" : label || "Add",
      ),
      binding && !waiting
        ? el(
            "button",
            { type: "button", className: "key-clear", ariaLabel: `Take ${label} away`, dataset: { tip: `Take ${label} away` }, onclick: () => this.update(assign(this.map, id, slot, null).map) },
            crossIcon(),
          )
        : null,
    );
  }
}

/** A small x drawn as two strokes. */
function crossIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("i");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M7 7l10 10M17 7 7 17");
  svg.append(path);
  return svg;
}

// The viewer's side panel: the game's checklist (what the map still needs, and what the build
// would refuse it for), then every list game Edit's tools place into, with its entries. Clicking an
// entry picks it (the page frames it in the view).
import type { Markup, MarkupList, MarkupSection } from "./markup.ts";

type Child = Node | string | null | undefined | false | Child[];

/** A DOM element with properties and children. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(element, rest);
  if (dataset) Object.assign(element.dataset, dataset);
  const add = (child: Child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(add);
    else element.append(child);
  };
  children.forEach(add);
  return element;
}

export function colorText(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** A small square in a list's color. */
export function swatch(color: number): HTMLSpanElement {
  const square = el("span", { className: "swatch" });
  square.style.background = colorText(color);
  return square;
}

export interface SidebarHandlers {
  /** An entry was clicked. */
  pick(key: string): void;
  /** Controls on a list's header (Place, Add, Set), if any. */
  listTools?(list: MarkupList): Child;
  /** Controls under a section's lists (New region), if any. */
  sectionTools?(section: MarkupSection): Child;
}

export class Sidebar {
  private picked: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: SidebarHandlers,
  ) {}

  render(markup: Markup): void {
    const { checklist } = markup;
    const scroll = this.root.scrollTop;
    this.root.replaceChildren(
      el(
        "section",
        { className: "checklist" },
        el("h2", {}, "Checklist", el("span", { className: `pill ${checklist.ready ? "ok" : "warn"}` }, checklist.ready ? "Ready" : "Not ready")),
        el(
          "ul",
          { className: "rows" },
          checklist.rows.map((row) => el("li", { className: row.done ? "done" : "todo" }, el("span", { className: "dot" }), el("span", { className: "grow" }, row.label), el("span", { className: "count" }, `${row.have} of ${row.need}`))),
        ),
        checklist.problems.length > 0 ? el("ul", { className: "problems" }, checklist.problems.map((problem) => el("li", {}, problem))) : null,
        checklist.warnings.length > 0 ? el("ul", { className: "warnings" }, checklist.warnings.map((warning) => el("li", {}, warning))) : null,
      ),
      ...markup.sections.map((section) =>
        el(
          "section",
          { className: "lists" },
          el("h2", {}, section.title),
          section.lists.map((list) => this.list(list)),
          this.handlers.sectionTools?.(section),
        ),
      ),
    );
    this.root.scrollTop = scroll;
    this.mark();
  }

  /** Shows an entry as picked (or none), and scrolls it into view. */
  pick(key: string | undefined): void {
    this.picked = key;
    this.mark();
    if (key) this.root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private list(list: MarkupList): HTMLElement {
    const count = list.need !== undefined ? `${list.entries.length} of ${list.need}` : list.entries.length > 0 ? String(list.entries.length) : "";
    return el(
      "div",
      { className: `list${list.done === false ? " todo" : ""}`, dataset: { list: list.key } },
      el("div", { className: "list-head" }, swatch(list.color), el("span", { className: "grow" }, list.label), el("span", { className: "count" }, count), this.handlers.listTools?.(list)),
      list.entries.length === 0
        ? el("div", { className: "empty" }, "None yet")
        : list.entries.map((entry) =>
            el(
              "button",
              { className: "entry", dataset: { key: entry.key }, title: entry.detail, onclick: () => this.handlers.pick(entry.key) },
              el("span", { className: "entry-label" }, entry.label),
              el("span", { className: "entry-detail" }, entry.detail),
            ),
          ),
    );
  }

  private mark(): void {
    for (const entry of this.root.querySelectorAll<HTMLElement>(".entry")) entry.classList.toggle("on", entry.dataset.key === this.picked);
  }
}

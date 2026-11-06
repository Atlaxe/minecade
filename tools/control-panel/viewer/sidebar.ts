// The viewer's left panel under the tools, in two tabs, each with its own search. Checklist: the
// game's checklist (what the map still needs, and what the build would refuse it for), the checks
// a 3D view makes (warnings: checks.ts) and the blocks that have no look. Overview: what the map
// has, by game Edit's lists, with only the lists that have entries (a map with no spawns yet has
// no Spawns section). Clicking an entry or a warning about one picks it (the page frames it in
// the view); clicking a block's name shows the first of them.
import type { MapWarning } from "./checks.ts";
import type { Markup, MarkupEntry, MarkupList } from "./markup.ts";

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
  /** An entry was clicked (with Shift: added to the pick, or taken out of it). */
  pick(key: string, add: boolean): void;
  /** A block's name was clicked. */
  find(block: string): void;
}

export interface Checks {
  warnings: MapWarning[];
  /** Blocks with no look, by name, with how many there are. */
  unknown: { name: string; count: number }[];
}

export type SideTab = "checklist" | "overview";

const TAB_STORE = "minecade-viewer-side-tab";

/** Whether a search matches any of these texts (every word somewhere in them, any case). */
export function matchesSearch(query: string, ...texts: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = texts.join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** A list in the overview, with the entries a search left. */
export interface ShownList {
  list: MarkupList;
  entries: MarkupEntry[];
}

/** The overview's lists that have entries, by section, cut down to what a search matches. A list or section whose name matches keeps all of its entries. */
export function overviewLists(markup: Markup, query: string): { title: string; lists: ShownList[] }[] {
  return markup.sections
    .map((section) => ({
      title: section.title,
      lists: section.lists
        .filter((list) => list.entries.length > 0)
        .map((list) => ({ list, entries: matchesSearch(query, section.title) || matchesSearch(query, list.label) ? list.entries : list.entries.filter((entry) => matchesSearch(query, entry.label, entry.detail)) }))
        .filter((shown) => shown.entries.length > 0),
    }))
    .filter((section) => section.lists.length > 0);
}

export class Sidebar {
  private picked: string | undefined;
  private also: ReadonlySet<string> = new Set();
  private tab: SideTab;
  private readonly queries: Record<SideTab, string> = { checklist: "", overview: "" };
  private readonly scrolls: Record<SideTab, number> = { checklist: 0, overview: 0 };
  private markup: Markup | undefined;
  private checks: Checks = { warnings: [], unknown: [] };
  private readonly buttons: Record<SideTab, HTMLButtonElement>;
  private readonly counts: Record<SideTab, HTMLSpanElement>;
  private readonly search: HTMLInputElement;
  private readonly body: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly handlers: SidebarHandlers,
  ) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TAB_STORE);
    } catch {
      // Not kept: the Checklist tab.
    }
    this.tab = saved === "overview" ? "overview" : "checklist";
    const tabButton = (tab: SideTab, label: string) => {
      const count = el("span", { className: "tab-count" });
      const button = el("button", { type: "button", id: `side-tab-${tab}`, onclick: () => this.showTab(tab) }, label, count);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "side-body");
      return { button, count };
    };
    const checklist = tabButton("checklist", "Checklist");
    const overview = tabButton("overview", "Overview");
    this.buttons = { checklist: checklist.button, overview: overview.button };
    this.counts = { checklist: checklist.count, overview: overview.count };
    const tabs = el("div", { className: "side-tabs" }, checklist.button, overview.button);
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Checklist or overview");

    this.search = el("input", { type: "search", spellcheck: false, autocomplete: "off" });
    this.search.addEventListener("input", () => {
      this.queries[this.tab] = this.search.value;
      this.body.scrollTop = 0;
      this.draw();
    });
    this.search.addEventListener("keydown", (event) => {
      // Esc empties the search, then leaves it.
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (this.search.value) {
        this.search.value = "";
        this.queries[this.tab] = "";
        this.draw();
      } else this.search.blur();
    });
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>';
    const search = el("label", { className: "side-search" }, icon, this.search);

    this.body = el("div", { className: "sidebar", id: "side-body" });
    this.body.setAttribute("role", "tabpanel");
    root.replaceChildren(el("div", { className: "side-head" }, tabs, search), this.body);
    this.showTab(this.tab);
  }

  render(markup: Markup, checks: Checks): void {
    this.markup = markup;
    this.checks = checks;
    const { checklist } = markup;
    const todo = checklist.rows.filter((row) => !row.done).length + checklist.problems.length + checks.warnings.length + checks.unknown.length;
    this.counts.checklist.textContent = todo > 0 ? String(todo) : "";
    this.counts.checklist.className = `tab-count${checklist.ready ? "" : " warn"}`;
    this.buttons.checklist.title = checklist.ready ? (todo > 0 ? `Ready, with ${todo} ${todo === 1 ? "check" : "checks"} to look at` : "Ready") : "Not ready to publish";
    const entries = markup.sections.reduce((sum, section) => sum + section.lists.reduce((total, list) => total + list.entries.length, 0), 0);
    this.counts.overview.textContent = entries > 0 ? String(entries) : "";
    this.counts.overview.className = "tab-count";
    this.draw();
  }

  /** Shows an entry as picked (or none), with any others picked with it, and scrolls it into view. */
  pick(key: string | undefined, also: ReadonlySet<string> = new Set()): void {
    this.picked = key;
    this.also = also;
    this.mark();
    if (key) this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private showTab(tab: SideTab): void {
    this.scrolls[this.tab] = this.body.scrollTop;
    this.tab = tab;
    try {
      localStorage.setItem(TAB_STORE, tab);
    } catch {
      // Not kept.
    }
    for (const [id, button] of Object.entries(this.buttons)) button.setAttribute("aria-selected", String(id === tab));
    this.body.setAttribute("aria-labelledby", `side-tab-${tab}`);
    this.search.value = this.queries[tab];
    this.search.placeholder = tab === "checklist" ? "Search the checklist" : "Search the overview";
    this.search.setAttribute("aria-label", this.search.placeholder);
    this.draw();
    this.body.scrollTop = this.scrolls[tab];
  }

  private draw(): void {
    if (!this.markup) return;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren(...(this.tab === "checklist" ? this.checklistTab(this.markup, this.checks) : this.overviewTab(this.markup)));
    this.body.scrollTop = scroll;
    this.mark();
  }

  private checklistTab(markup: Markup, checks: Checks): HTMLElement[] {
    const query = this.queries.checklist;
    const { checklist } = markup;
    const rows = checklist.rows.filter((row) => matchesSearch(query, row.label));
    const problems = checklist.problems.filter((text) => matchesSearch(query, text));
    const warnings = checklist.warnings.filter((text) => matchesSearch(query, text));
    const found = checks.warnings.length + checks.unknown.length;
    const checkWarnings = checks.warnings.filter((warning) => matchesSearch(query, warning.text));
    const unknown = checks.unknown.filter((block) => matchesSearch(query, block.name, "blocks without a look"));
    const searching = query.trim() !== "";
    if (searching && rows.length + problems.length + warnings.length + checkWarnings.length + unknown.length === 0) return [this.nothing(query)];
    const parts: HTMLElement[] = [];
    if (!searching || rows.length + problems.length + warnings.length > 0) {
      parts.push(
        el(
          "section",
          { className: "checklist" },
          el("h2", {}, "Checklist", el("span", { className: `pill ${checklist.ready ? "ok" : "warn"}` }, checklist.ready ? "Ready" : "Not ready")),
          rows.length > 0
            ? el(
                "ul",
                { className: "rows" },
                rows.map((row) => el("li", { className: row.done ? "done" : "todo" }, el("span", { className: "dot" }), el("span", { className: "grow" }, row.label), el("span", { className: "count" }, `${row.have} of ${row.need}`))),
              )
            : null,
          problems.length > 0 ? el("ul", { className: "problems" }, problems.map((problem) => el("li", {}, problem))) : null,
          warnings.length > 0 ? el("ul", { className: "warnings" }, warnings.map((warning) => el("li", {}, warning))) : null,
        ),
      );
    }
    if (!searching || checkWarnings.length + unknown.length > 0) {
      parts.push(
        el(
          "section",
          { className: "checks" },
          el("h2", {}, "Checks", el("span", { className: `pill ${found > 0 ? "warn" : "ok"}` }, found > 0 ? String(found) : "None")),
          checkWarnings.length > 0
            ? el(
                "ul",
                { className: "check-list" },
                checkWarnings.map((warning) =>
                  el(
                    "li",
                    {},
                    el(
                      "button",
                      {
                        className: "check",
                        disabled: !warning.entry && !warning.block,
                        onclick: () => (warning.entry ? this.handlers.pick(warning.entry, false) : warning.block ? this.handlers.find(warning.block) : undefined),
                      },
                      el("span", { className: "dot" }),
                      el("span", { className: "grow" }, warning.text),
                    ),
                  ),
                ),
              )
            : null,
          unknown.length > 0
            ? [
                el("h3", {}, "Blocks without a look"),
                el(
                  "ul",
                  { className: "check-list" },
                  unknown.map((block) =>
                    el(
                      "li",
                      {},
                      el("button", { className: "check", title: `Show the first ${block.name}`, onclick: () => this.handlers.find(block.name) }, el("span", { className: "swatch unknown" }), el("span", { className: "grow" }, block.name), el("span", { className: "count" }, block.count.toLocaleString())),
                    ),
                  ),
                ),
              ]
            : null,
        ),
      );
    }
    return parts;
  }

  private overviewTab(markup: Markup): HTMLElement[] {
    const query = this.queries.overview;
    const sections = overviewLists(markup, query);
    if (sections.length === 0) {
      if (query.trim()) return [this.nothing(query)];
      return [el("p", { className: "side-empty" }, "Nothing placed yet. Spawns, markers, bounds, regions and heights show here once the tools above place them.")];
    }
    return [el("section", { className: "overview" }, sections.map((section) => [el("h3", {}, section.title), section.lists.map((shown) => this.list(shown))]))];
  }

  private nothing(query: string): HTMLElement {
    return el("p", { className: "side-empty" }, `Nothing matches "${query.trim()}".`);
  }

  private list({ list, entries }: ShownList): HTMLElement {
    const count = list.need !== undefined ? `${list.entries.length} of ${list.need}` : String(list.entries.length);
    return el(
      "div",
      { className: `list${list.done === false ? " todo" : ""}`, dataset: { list: list.key } },
      el("div", { className: "list-head" }, swatch(list.color), el("span", { className: "grow" }, list.label), el("span", { className: "count" }, count)),
      entries.map((entry) =>
        el(
          "button",
          { className: "entry", dataset: { key: entry.key }, title: entry.detail, onclick: (event: MouseEvent) => this.handlers.pick(entry.key, event.shiftKey) },
          el("span", { className: "entry-label" }, entry.label),
          el("span", { className: "entry-detail" }, entry.detail),
        ),
      ),
    );
  }

  private mark(): void {
    for (const entry of this.body.querySelectorAll<HTMLElement>(".entry")) entry.classList.toggle("on", entry.dataset.key === this.picked || this.also.has(entry.dataset.key ?? ""));
  }
}

// Port to another game: the dialog that makes a map's blocks a new map of another game, such as One
// in the Quiver's KGB for Gunfight (its world and picture, and the markup picked here:
// tools/viewer/port-map.ts). The viewer opens it from Map settings, and the Panel's Maps page from
// the bar for the picked map, loading it as /viewer/port.js. It asks the game, the name, the map id
// and what of the markup to bring along (what that game can take, all ticked but what was unticked
// last time), checks the id as it's typed against the ids that game can't take, and then offers to
// open the new map in the viewer.
import { el } from "./sidebar.ts";

export interface PortSource {
  target: string;
  map: string;
}

/** A ported map: where it went, and what the Panel said. */
export interface PortDone {
  target: string;
  targetName: string;
  map: string;
  name: string;
  message: string;
}

/** One kind of markup the game can take (port-map.ts's CarryOption). */
interface CarryOption {
  id: string;
  label: string;
  detail: string;
}

interface Choices {
  name: string;
  targetName: string;
  games: { id: string; name: string; suggested: string; taken: Record<string, string>; carry: CarryOption[]; left: string[] }[];
}

/** The game picked last, kept in this browser: porting several maps to one game asks once. */
const GAME_STORE = "minecade-port-game";
/** The kinds of markup unticked last time, kept in this browser the same way. */
const SKIP_STORE = "minecade-port-skip";

function readSkipped(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(SKIP_STORE) ?? "[]") as unknown;
    return new Set(Array.isArray(list) ? list.filter((kind): kind is string => typeof kind === "string") : []);
  } catch {
    return new Set();
  }
}

function keepSkipped(skipped: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SKIP_STORE, JSON.stringify([...skipped]));
  } catch {
    // Not kept.
  }
}
const MAP_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_NAME = 48;

/** Why the map can't be ported as `id` with `name` to a game that can't take `taken`, or undefined. */
export function portFormProblem(id: string, name: string, taken: Readonly<Record<string, string>>): string | undefined {
  if (!name.trim()) return "The map needs a name.";
  if (name.trim().length > MAX_NAME) return `A map's name is at most ${MAX_NAME} characters.`;
  if (!MAP_ID.test(id)) return "A map id is lower case letters, digits, _ and -, starting with a letter or digit.";
  return taken[id];
}

/** The viewer's address for a map. */
export function viewerUrl(made: Pick<PortDone, "target" | "targetName" | "map" | "name">): string {
  return `/viewer?${new URLSearchParams({ target: made.target, map: made.map, name: made.name, game: made.targetName })}`;
}

let dialog: HTMLDialogElement | undefined;

/** Opens the dialog for a map; `done` hears of the new map once it's made. */
export async function openPortDialog(source: PortSource, done?: (made: PortDone) => void): Promise<void> {
  dialog ??= document.body.appendChild(el("dialog", { className: "port-dialog" }));
  dialog.setAttribute("aria-labelledby", "port-title");
  const box = dialog;
  const body = el("div", { className: "port-body" }, el("p", { className: "muted" }, "Loading the games..."));
  const close = () => box.close();
  box.replaceChildren(body);
  if (!box.open) box.showModal();

  const response = await fetch(`/api/viewer/port?${new URLSearchParams({ target: source.target, map: source.map })}`).catch(() => undefined);
  const answer = response ? ((await response.json().catch(() => ({}))) as Partial<Choices> & { error?: string }) : undefined;
  if (!response?.ok || !answer?.games) {
    body.replaceChildren(
      el("h2", { id: "port-title" }, "Port to another game"),
      el("p", { className: "error" }, response ? `It can't be ported: ${answer?.error ?? `HTTP ${response.status}`}.` : "The Panel didn't answer."),
      el("div", { className: "port-actions" }, el("button", { type: "button", onclick: close }, "Close")),
    );
    return;
  }
  const choices = answer as Choices;
  const title = el("h2", { id: "port-title" }, `Port ${choices.name} to another game`);
  if (choices.games.length === 0) {
    body.replaceChildren(title, el("p", { className: "muted" }, "There's no other game to port it to."), el("div", { className: "port-actions" }, el("button", { type: "button", onclick: close }, "Close")));
    return;
  }

  const gameSelect = el("select", {}, choices.games.map((game) => el("option", { value: game.id }, game.name)));
  try {
    const last = localStorage.getItem(GAME_STORE);
    if (last && choices.games.some((game) => game.id === last)) gameSelect.value = last;
  } catch {
    // The first game, then.
  }
  const picked = () => choices.games.find((game) => game.id === gameSelect.value) ?? choices.games[0];
  const nameInput = el("input", { type: "text", value: choices.name, maxLength: MAX_NAME, spellcheck: false, autocomplete: "off" });
  const idInput = el("input", { type: "text", value: picked().suggested, maxLength: 48, spellcheck: false, autocomplete: "off", className: "mono" });
  /** The map id was typed: another game keeps it instead of taking that game's own suggestion. */
  let idTyped = false;
  const problemLine = el("p", { className: "error port-problem", hidden: true });
  const portButton = el("button", { type: "submit", className: "primary" }, "Port");
  const validate = () => {
    const problem = portFormProblem(idInput.value.trim(), nameInput.value, picked().taken);
    problemLine.textContent = problem ?? "";
    problemLine.hidden = !problem;
    portButton.disabled = problem !== undefined;
  };
  // What of the markup goes: a box for each kind the picked game can take, and what stays behind.
  const skipped = readSkipped();
  const carryBoxes = new Map<string, HTMLInputElement>();
  const carryList = el("div", { className: "port-carry" });
  const leftLine = el("p", { className: "muted meta", hidden: true });
  const drawCarry = () => {
    const game = picked();
    carryBoxes.clear();
    carryList.replaceChildren(
      ...game.carry.map((option) => {
        const box = el("input", { type: "checkbox", checked: !skipped.has(option.id) });
        box.addEventListener("change", () => {
          if (box.checked) skipped.delete(option.id);
          else skipped.add(option.id);
          keepSkipped(skipped);
        });
        carryBoxes.set(option.id, box);
        return el("label", {}, box, el("span", {}, option.label), el("span", { className: "muted" }, option.detail));
      }),
    );
    carryList.hidden = game.carry.length === 0;
    leftLine.textContent = game.left.length > 0 ? `Stays behind: ${game.left.join(", ")}.` : "";
    leftLine.hidden = game.left.length === 0;
  };
  gameSelect.addEventListener("change", () => {
    if (!idTyped) idInput.value = picked().suggested;
    try {
      localStorage.setItem(GAME_STORE, gameSelect.value);
    } catch {
      // Not kept.
    }
    drawCarry();
    validate();
  });
  nameInput.addEventListener("input", validate);
  idInput.addEventListener("input", () => {
    idTyped = true;
    validate();
  });

  const form = el(
    "form",
    { className: "port-form" },
    title,
    el("p", { className: "muted" }, `Its blocks and picture go, with what's checked below. ${choices.targetName}'s map stays as it is.`),
    el("label", {}, el("span", {}, "Game"), gameSelect),
    el("label", {}, el("span", {}, "Name"), nameInput),
    el("label", {}, el("span", {}, "Map id"), idInput),
    carryList,
    leftLine,
    problemLine,
    el("div", { className: "port-actions" }, el("button", { type: "button", onclick: close }, "Cancel"), portButton),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const game = picked();
    const id = idInput.value.trim();
    const name = nameInput.value.trim();
    if (portFormProblem(id, name, game.taken)) return validate();
    portButton.disabled = true;
    portButton.textContent = "Porting...";
    const sent = await fetch("/api/viewer/port", {
      method: "POST",
      headers: { "content-type": "application/json", "x-minecade-panel": "1" },
      body: JSON.stringify({ target: source.target, map: source.map, to: game.id, id, name, carry: [...carryBoxes].filter(([, box]) => box.checked).map(([kind]) => kind) }),
    }).catch(() => undefined);
    const result = sent ? ((await sent.json().catch(() => ({}))) as Partial<PortDone> & { error?: string }) : undefined;
    portButton.textContent = "Port";
    if (!sent?.ok || !result?.map || !result.target) {
      problemLine.textContent = sent ? `Not ported: ${result?.error ?? `HTTP ${sent.status}`}` : "The Panel didn't answer.";
      problemLine.hidden = false;
      portButton.disabled = false;
      return;
    }
    const made = result as PortDone;
    done?.(made);
    body.replaceChildren(
      el("h2", { id: "port-title" }, `${made.name} is a ${made.targetName} map now`),
      el("p", {}, made.message),
      el(
        "div",
        { className: "port-actions" },
        el("button", { type: "button", onclick: close }, "Done"),
        el("button", { type: "button", className: "primary", onclick: () => (location.href = viewerUrl(made)) }, `Open it`),
      ),
    );
    body.querySelector<HTMLButtonElement>(".primary")?.focus();
  });
  body.replaceChildren(form);
  drawCarry();
  validate();
  nameInput.focus();
  nameInput.select();
}

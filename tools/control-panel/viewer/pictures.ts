// Pictures in the viewer (the user's ask, 2026-11-09): Map settings shows the map's thumbnail and,
// on a minigame thumbnail map (its switch there, map.json's gameThumbnail), its game's picture,
// each with Change: a dialog of the pictures kept so far (the map editor's shots, newest first) and
// the newest screenshot, as game Edit's Edit Map Thumbnail and Edit Minigame Thumbnail offer them.
// The game's picture also has Publish picture, which puts it in the lobby with no map published
// (a thumbnail map is often a draft that never is). The Panel's side is tools/viewer/pictures.ts.
import { el } from "./sidebar.ts";

export type PictureKind = "map" | "game";

/** GET /api/viewer/pictures: the kept pictures, which ones the map and its game use, and whether the game's is published. */
export interface PictureList {
  shots: { id: string; map?: string; game?: string }[];
  current: { map?: string; game?: string };
  game: "none" | "published" | "changed";
}

export interface PictureSource {
  target: string;
  map: string;
  kind: PictureKind;
  /** The map's name, or its game's. */
  name: string;
}

/** Posts to the Panel: its message, or its error. */
export async function postPicture(path: "/api/viewer/picture" | "/api/viewer/publish-picture", body: Record<string, unknown>): Promise<{ message: string } | { error: string }> {
  const sent = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-minecade-panel": "1" }, body: JSON.stringify(body) }).catch(() => undefined);
  if (!sent) return { error: "the Panel didn't answer" };
  const answer = (await sent.json().catch(() => ({}))) as { message?: string; error?: string };
  return sent.ok && answer.message ? { message: answer.message } : { error: answer.error ?? `HTTP ${sent.status}` };
}

/** The pictures for a map, or undefined when the Panel doesn't say. */
export async function loadPictures(target: string, map: string): Promise<PictureList | undefined> {
  const response = await fetch(`/api/viewer/pictures?${new URLSearchParams({ target, map })}`).catch(() => undefined);
  return response?.ok ? ((await response.json()) as PictureList) : undefined;
}

/** A map's thumbnail or its game's picture; `version` makes a picture changed since load again. */
export function pictureUrl(target: string, map: string, kind: PictureKind, version: number): string {
  return `/api/viewer/thumb?${new URLSearchParams({ target, map, kind, v: String(version) })}`;
}

/** The pictures a dialog offers: those used for its kind, the ones not used yet, and the one in use. */
export function picturesFor(list: PictureList, kind: PictureKind): PictureList["shots"] {
  const current = list.current[kind];
  return list.shots.filter((shot) => shot.id === current || shot[kind] !== undefined || (shot.map === undefined && shot.game === undefined));
}

let dialog: HTMLDialogElement | undefined;

/** Opens the dialog for a map's thumbnail or its game's picture; `done` hears what the Panel said once one is used. */
export async function openPictureDialog(source: PictureSource, done: (message: string) => void): Promise<void> {
  dialog ??= document.body.appendChild(el("dialog", { className: "port-dialog picture-dialog" }));
  dialog.setAttribute("aria-labelledby", "picture-title");
  const box = dialog;
  const game = source.kind === "game";
  const problemLine = el("p", { className: "error", hidden: true });
  const close = el("button", { type: "button", onclick: () => box.close() }, "Close");
  const grid = el("div", { className: "picture-grid", role: "list" }, el("p", { className: "muted" }, "Loading the pictures..."));
  const buttons: HTMLButtonElement[] = [];
  const use = async (shot: string, button: HTMLButtonElement) => {
    for (const each of buttons) each.disabled = true;
    const label = button.textContent;
    if (shot === "newest") button.textContent = "Saving...";
    const answer = await postPicture("/api/viewer/picture", { target: source.target, map: source.map, kind: source.kind, shot });
    for (const each of buttons) each.disabled = false;
    button.textContent = label;
    if ("error" in answer) {
      problemLine.textContent = answer.error;
      problemLine.hidden = false;
      return;
    }
    box.close();
    done(answer.message);
  };
  const newest = el("button", { type: "button", className: "primary" }, "Use newest screenshot");
  newest.addEventListener("click", () => void use("newest", newest));
  buttons.push(newest);
  box.replaceChildren(
    el(
      "div",
      { className: "port-body" },
      el("h2", { id: "picture-title" }, game ? `Minigame thumbnail: ${source.name}` : `Map thumbnail: ${source.name}`),
      el("p", {}, game ? `The picture the lobby shows for ${source.name}.` : "The picture on this map's tile in the lobby."),
      el("div", { className: "picture-newest" }, newest, el("span", { className: "muted meta" }, "Taken in game in the last 10 minutes, cropped to 16:9")),
      grid,
      problemLine,
      el("div", { className: "port-actions" }, close),
    ),
  );
  if (!box.open) box.showModal();
  newest.focus();
  const list = await loadPictures(source.target, source.map);
  if (!list) {
    grid.replaceChildren(el("p", { className: "error" }, "The Panel didn't list the pictures."));
    return;
  }
  const shots = picturesFor(list, source.kind);
  const current = list.current[source.kind];
  if (shots.length === 0) {
    grid.replaceChildren(el("p", { className: "muted" }, "No pictures kept yet: take one in game Edit with the Camera and Snapshot tools, then use the newest screenshot."));
    return;
  }
  grid.replaceChildren(
    ...shots.map((shot) => {
      const on = shot.id === current;
      const where = shot[source.kind] ?? (shot.map === undefined && shot.game === undefined ? "Not used yet" : (shot.map ?? shot.game)!);
      const button = el(
        "button",
        { type: "button", className: `picture-pick${on ? " on" : ""}`, role: "listitem", ariaPressed: String(on) },
        el("img", { src: `/api/viewer/shot?${new URLSearchParams({ id: shot.id })}`, alt: "", loading: "lazy" }),
        el("span", {}, on ? `In use: ${where}` : where),
      );
      button.addEventListener("click", () => void (on ? box.close() : use(shot.id, button)));
      buttons.push(button);
      return button;
    }),
  );
}

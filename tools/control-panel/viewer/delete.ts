// Delete: the dialog that deletes a map from the map store (tools/viewer/delete-map.ts), as game
// Edit's Delete map does. The viewer opens it from Map settings, and the Panel's Maps page from the
// bar for the picked map, loading it as /viewer/delete.js. It asks first, then says what happened.
import { el } from "./sidebar.ts";

export interface DeleteSource {
  target: string;
  map: string;
  /** The map's name and its game's, for the question. */
  name: string;
  gameName: string;
}

let dialog: HTMLDialogElement | undefined;

/** Opens the dialog for a map; `done` hears what the Panel said once it's deleted. */
export function openDeleteDialog(source: DeleteSource, done?: (message: string) => void): void {
  dialog ??= document.body.appendChild(el("dialog", { className: "port-dialog" }));
  dialog.setAttribute("aria-labelledby", "delete-title");
  const box = dialog;
  const close = () => box.close();
  const problemLine = el("p", { className: "error", hidden: true });
  const cancel = el("button", { type: "button", onclick: close }, "Cancel");
  const confirm = el("button", { type: "button", className: "danger" }, "Delete it");
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    confirm.textContent = "Deleting...";
    const sent = await fetch("/api/viewer/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-minecade-panel": "1" },
      body: JSON.stringify({ target: source.target, map: source.map }),
    }).catch(() => undefined);
    const answer = sent ? ((await sent.json().catch(() => ({}))) as { message?: string; error?: string }) : undefined;
    if (!sent?.ok || !answer?.message) {
      problemLine.textContent = sent ? `Not deleted: ${answer?.error ?? `HTTP ${sent.status}`}` : "The Panel didn't answer.";
      problemLine.hidden = false;
      confirm.textContent = "Delete it";
      confirm.disabled = false;
      cancel.disabled = false;
      return;
    }
    close();
    done?.(answer.message);
  });
  box.replaceChildren(
    el(
      "div",
      { className: "port-body" },
      el("h2", { id: "delete-title" }, `Delete ${source.name}?`),
      el(
        "p",
        {},
        `${source.name} (${source.gameName}) and its world go from the map store, and it leaves its world's list in Select. If it's published, it stops being published and leaves the lobby at the network's next start. Anyone in game Edit on it goes to the editor lobby.`,
      ),
      problemLine,
      el("div", { className: "port-actions" }, cancel, confirm),
    ),
  );
  if (!box.open) box.showModal();
  cancel.focus();
}

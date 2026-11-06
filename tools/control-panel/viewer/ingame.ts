// The viewer's In game menu (the top bar): this map in the in-game editor. The Panel warms the
// editor up while the viewer is open (it boots in the background unless the network runs, and
// opens this map in game Edit ahead of time while nobody uses Edit), so going in game is quick.
// Open in game opens the map in game Edit for sure (booting the editor first, stopping the
// network after asking), and sends map editors who are in the editor lobby, or join it in the next
// minutes, straight to it. With the map open in Edit: its join address, who is on it, Preview, and
// the newest screenshot as the map's preview or the game's picture.
import { el } from "./sidebar.ts";

/** What the Panel's state says about the map editor (its event stream's "state"). */
export interface PanelState {
  docker: string;
  busy: string | null;
  networkRunning: boolean;
  connection: { lanHost: string };
  editor?: {
    status: EditorInfo | null;
    old: boolean;
    launching: boolean;
    restarting: boolean;
  };
  warm?: { note: string; map: string | null; openWhenReady: string | null };
}

interface EditorInfo {
  booted?: boolean;
  state: "starting" | "ready" | "stopping";
  join: string;
  home: { players: string[] };
  edit?: { state: string; target: string; map: string; mapName: string; targetName: string; players: string[]; checklist: { ready: boolean } };
  preview?: { state: string; label: string; players: string[] };
  waiting: { name: string; label: string }[];
  bring?: string;
  bringUntil?: string;
}

/** The menu's look at this map: off, on the way, or open in Edit. */
export type GameTone = "off" | "warn" | "ok";

export interface InGameOptions {
  target: string;
  map: string;
  /** The map's name now (it can be renamed while the viewer is open). */
  name(): string;
  notice(text: string, bad?: boolean): void;
}

/** Where this map stands in game, from the Panel's state: the menu's tone, its line, and whether this map is open in Edit (edits then go through it). */
export function gameSummary(state: PanelState, target: string, map: string): { tone: GameTone; line: string; open: boolean; join?: string } {
  const editor = state.editor;
  const status = editor?.status?.booted ? editor.status : undefined;
  const key = `${target}/${map}`;
  if (state.docker !== "running") return { tone: "off", line: "Docker isn't running.", open: false };
  if (editor?.status && !status) return { tone: "off", line: "An older map editor is running: restart it on the Panel's Servers page first.", open: false };
  if (!status) {
    if (editor?.launching || editor?.restarting) return { tone: "warn", line: state.warm?.openWhenReady === key ? "The map editor is starting: this map opens in Edit once it's ready." : "The map editor is starting...", open: false };
    if (state.networkRunning) return { tone: "off", line: "The network is running, and the map editor needs its ports: Open in game stops the network first.", open: false };
    return { tone: "off", line: state.warm?.note ? `The map editor is off: ${state.warm.note}.` : "The map editor is off: Open in game boots it.", open: false };
  }
  if (status.state === "stopping") return { tone: "off", line: "The map editor is shutting down.", open: false };
  if (status.state !== "ready") return { tone: "warn", line: "The map editor is starting...", open: false, join: status.join };
  const edit = status.edit;
  const here = edit !== undefined && edit.target === target && edit.map === map;
  if (here && edit.state === "starting") return { tone: "warn", line: "Opening this map in Edit...", open: false, join: status.join };
  if (here && edit.state === "ready") {
    const on = edit.players.length > 0 ? `On it: ${edit.players.join(", ")}.` : "Nobody is on it yet.";
    return { tone: "ok", line: `This map is open in Edit. ${on}`, open: true, join: status.join };
  }
  if (edit && (edit.state === "ready" || edit.state === "starting")) {
    const on = edit.players.length > 0 ? ` (${edit.players.join(", ")} on it)` : "";
    return { tone: "off", line: `Edit has ${edit.mapName || edit.map} open${on}.`, open: false, join: status.join };
  }
  return { tone: "off", line: "Nothing is open in Edit.", open: false, join: status.join };
}

export class InGame {
  private state: PanelState | undefined;
  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private drawn = "";

  constructor(private readonly options: InGameOptions) {
    this.button = document.getElementById("in-game") as HTMLButtonElement;
    this.menu = document.getElementById("game-menu") as HTMLElement;
    this.button.onclick = () => (this.menu.hidden ? this.open() : this.close());
    // A click anywhere else closes it.
    addEventListener("pointerdown", (event) => {
      if (this.menu.hidden || !(event.target instanceof Node)) return;
      if (this.menu.contains(event.target) || this.button.contains(event.target)) return;
      this.close();
    });
  }

  /** The Panel's state changed. */
  update(state: PanelState): void {
    this.state = state;
    this.draw();
  }

  /** Closes the menu; false when it was closed already. */
  close(): boolean {
    if (this.menu.hidden) return false;
    this.menu.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    return true;
  }

  private open(): void {
    this.menu.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.drawn = "";
    this.draw();
  }

  private draw(): void {
    const state = this.state;
    if (!state) return;
    const { target, map } = this.options;
    const summary = gameSummary(state, target, map);
    this.button.dataset.tone = summary.tone;
    this.button.dataset.tip = summary.open ? "This map is open in game Edit: the viewer's changes go through it" : "This map in game: Open in game, Preview, the join address";
    if (this.menu.hidden) return;
    const status = state.editor?.status?.booted ? state.editor.status : undefined;
    const edit = summary.open ? status?.edit : undefined;
    const key = `${target}/${map}`;
    const bringing = status?.bring === key && status.bringUntil ? new Date(status.bringUntil) : undefined;
    const preview = status?.preview;
    const facts = [summary, bringing?.getTime(), preview?.state, preview?.label, edit?.checklist.ready, state.busy, this.options.name()];
    const text = JSON.stringify(facts);
    if (text === this.drawn) return;
    this.drawn = text;

    const openButton = el("button", { className: "primary", onclick: () => void this.openInGame() }, "Open in game");
    openButton.disabled = state.docker !== "running" || status?.state === "stopping" || (state.editor?.status !== null && state.editor?.status !== undefined && !status);
    openButton.dataset.tip = "Opens this map in game Edit; map editors in the editor lobby, or joining it in the next 10 minutes, go straight to it";
    const parts: (HTMLElement | null)[] = [
      el("div", { className: "game-head" }, el("h2", {}, "In game"), el("span", { className: `pill ${summary.tone}` }, summary.tone === "ok" ? "Open in Edit" : summary.tone === "warn" ? "Starting" : "Not open")),
      el("p", { className: "game-text" }, summary.line),
      summary.join
        ? el("div", { className: "game-join" }, el("span", { className: "muted" }, "Join"), el("span", { className: "mono" }, summary.join), el("button", { className: "small", onclick: () => void this.copy(summary.join!) }, "Copy"))
        : null,
      bringing && bringing.getTime() > Date.now() ? el("p", { className: "game-text muted" }, `Map editors who join go straight to this map until ${bringing.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`) : null,
      el("div", { className: "game-buttons" }, openButton),
    ];
    if (edit) {
      const previewing = preview && (preview.state === "starting" || preview.state === "ready");
      const previewButton = previewing
        ? el("button", { onclick: () => void this.act("/api/editor/preview/end", {}, "Ending the preview: everyone goes back to Edit.") }, "End preview")
        : el("button", { onclick: () => void this.act("/api/editor/preview", {}, "Starting a preview: everyone in Edit plays it as soon as it's ready (about 30 seconds).") }, "Preview");
      if (!previewing) {
        previewButton.disabled = target === "lobby" || !edit.checklist.ready;
        previewButton.dataset.tip = target === "lobby" ? "Lobby maps can't be previewed yet" : edit.checklist.ready ? "Play this map as its game in game, then come back to Edit" : "Finish the checklist first";
      }
      parts.push(
        el("div", { className: "game-section" }, el("span", { className: "muted meta" }, previewing ? `Preview: ${preview.label}` : "Play it as its game"), previewButton),
        target === "lobby"
          ? null
          : el(
              "div",
              { className: "game-section" },
              el("span", { className: "muted meta", title: "A screenshot taken in game in the last 10 minutes, cropped to 16:9" }, "Your newest screenshot as"),
              el("div", { className: "game-buttons" },
                el("button", { className: "small", onclick: () => void this.act("/api/editor/picture", { kind: "map" }, "Saved your newest screenshot as this map's preview.") }, "Map preview"),
                el("button", { className: "small", onclick: () => void this.act("/api/editor/picture", { kind: "game" }, "Saved your newest screenshot as the game's picture.") }, "Game picture"),
              ),
            ),
      );
    }
    this.menu.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
  }

  private async openInGame(): Promise<void> {
    const state = this.state;
    const status = state?.editor?.status;
    const off = !status && !state?.editor?.launching && !state?.editor?.restarting;
    let stopNetwork = false;
    if (off && state?.networkRunning) {
      if (!confirm("The network is running. Opening this map in game stops it (the lobby and any game), as the map editor takes its ports. Continue?")) return;
      stopNetwork = true;
    }
    const answer = await this.post("/api/viewer/in-game", { target: this.options.target, map: this.options.map, stopNetwork });
    if (!answer) return;
    const join = (status?.booted ? status.join : undefined) ?? `${state?.connection.lanHost || "LAN_HOST"}:19132`;
    this.options.notice(`Opening ${this.options.name()} in game Edit. Join ${join} in Minecraft: map editors go straight to it.`);
  }

  private async act(path: string, body: Record<string, unknown>, done: string): Promise<void> {
    if (await this.post(path, body)) this.options.notice(done);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-minecade-panel": "1" }, body: JSON.stringify(body) }).catch(() => undefined);
    if (response?.ok) return true;
    const answer = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
    this.options.notice(`That didn't work: ${answer.error ?? (response ? `HTTP ${response.status}` : "the Panel didn't answer")}.`, true);
    return false;
  }

  private async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.options.notice(`Copied ${text}`);
    } catch {
      this.options.notice("Couldn't copy: select the address and press Ctrl+C.", true);
    }
  }
}

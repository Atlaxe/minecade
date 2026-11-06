// The Panel's warm-up of the map editor (docs/viewer.md, "In game"): while a Maps page or a map
// viewer is open (each says so every half minute), the editor boots in the background, and the map
// picked or open in the viewer is opened in game Edit ahead of time, so going in game is quick. It
// never stops the network to do it: with the network running, the editor waits for Open in game,
// which asks first. An editor the Panel booted shuts down once nobody has used it for a while.

/** A page says it's open at least this often; past this, it's gone. */
export const WANTED_MS = 75_000;
/** A Panel-booted editor nobody is on, and no page wants, shuts down after this. */
export const IDLE_MS = 15 * 60_000;
/** After a boot that failed, the warm-up waits this long before trying again. */
export const RETRY_MS = 5 * 60_000;
/** A map the editor didn't open (someone was in Edit) is asked for again after this. */
export const RESEND_MS = 20_000;

/** The editor as the Panel sees it: none, booting (no answer yet), starting or ready, stopping, or an older one. */
export type EditorPhase = "off" | "booting" | "starting" | "ready" | "stopping" | "old";

export interface WarmFacts {
  now: number;
  /** When a Maps page or a viewer last said it's open. */
  wantedAt?: number;
  /** Shut down by hand: no warm-up until a map is picked again or Open in game. */
  paused: boolean;
  docker: boolean;
  /** The Panel is starting or stopping a stack. */
  busy: boolean;
  network: boolean;
  editor: EditorPhase;
  /** The Panel booted the running editor. */
  fromPanel: boolean;
  /** Players on the editor's servers, waiting for one, or in a preview. */
  people: number;
  /** Maps being cut out of a world in the editor's Select. */
  extracting: boolean;
  /** The last time anyone used the editor: a page wanting it, a player on it, or its boot. */
  usedAt: number;
  failedAt?: number;
  /** The map to have open in Edit ("<target>/<map>"), and what Edit has open (starting or ready). */
  map?: string;
  editMap?: string;
  /** The last map asked for, and when. */
  sentMap?: string;
  sentAt?: number;
}

export type WarmStep = { action: "boot" } | { action: "stop" } | { action: "warm"; map: string } | { action: "none"; why?: string };

/** What the warm-up does next. */
export function warmStep(f: WarmFacts): WarmStep {
  const wanted = f.wantedAt !== undefined && f.now - f.wantedAt < WANTED_MS;
  if (f.editor === "off") {
    if (!wanted) return { action: "none" };
    if (f.paused) return { action: "none", why: "it was shut down: pick a map to start it again" };
    if (!f.docker) return { action: "none", why: "Docker isn't running" };
    if (f.network) return { action: "none", why: "the network is running: Open in game stops it first" };
    if (f.busy) return { action: "none", why: "the Panel is busy" };
    if (f.failedAt !== undefined && f.now - f.failedAt < RETRY_MS) return { action: "none", why: "it couldn't boot: the log on the Logs page says why" };
    return { action: "boot" };
  }
  if (f.editor !== "ready") return { action: "none" };
  if (wanted && f.map && f.map !== f.editMap && (f.map !== f.sentMap || f.sentAt === undefined || f.now - f.sentAt >= RESEND_MS)) return { action: "warm", map: f.map };
  if (f.fromPanel && f.people === 0 && !f.extracting && f.now - f.usedAt >= IDLE_MS) return { action: "stop" };
  return { action: "none" };
}

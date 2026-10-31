// The pack's side of the editor protocol: events go to the host as "[EDIT] {json}" lines on the
// server log, and the host's messages arrive as "scriptevent minecade:edit {json}" typed into the
// server console. The whole map (and the editor lobby's state) comes in parts, put back together here.
import { ScriptEventSource, system } from "@minecraft/server";
import {
  ConfigAssembler,
  EDIT_LOG_MARKER,
  EDIT_SCRIPT_EVENT_ID,
  PartsAssembler,
  describeError,
  log,
  parseHostMessage,
  type EditorEvent,
  type HomeState,
  type HostMessage,
  type MapConfig,
  type Scope,
} from "@minecade/minigame-core";

export interface HostHandlers {
  /** The host's whole map, after it applied the pack's edits up to `seq`. */
  config(config: MapConfig, seq: number): void;
  /** The editor lobby's whole state (the editor lobby only). */
  home?(state: HomeState): void;
  message(message: Exclude<HostMessage, { t: "config" | "home" }>): void;
}

export class HostLink {
  private readonly assembler = new ConfigAssembler();
  private readonly homeParts = new PartsAssembler();

  constructor(scope: Scope, handlers: HostHandlers) {
    scope.subscribe(
      system.afterEvents.scriptEventReceive,
      (event) => {
        if (event.id !== EDIT_SCRIPT_EVENT_ID) return;
        // Only the server console speaks for the host, never a player or a command block.
        if (event.sourceType !== ScriptEventSource.Server) {
          log.warn(`ignoring ${EDIT_SCRIPT_EVENT_ID} from source ${event.sourceType}`);
          return;
        }
        const message = parseHostMessage(event.message);
        if (!message) {
          log.warn(`ignoring a malformed host message: ${event.message.slice(0, 120)}`);
          return;
        }
        try {
          if (message.t === "home") {
            const text = this.homeParts.add(message);
            if (text !== undefined) handlers.home?.(JSON.parse(text) as HomeState);
            return;
          }
          if (message.t !== "config") {
            handlers.message(message);
            return;
          }
          const whole = this.assembler.add(message);
          if (whole) handlers.config(whole.config, whole.seq);
        } catch (error) {
          log.error(`host message "${message.t}" failed: ${describeError(error)}`);
        }
      },
      { namespaces: ["minecade"] },
    );
  }

  send(event: EditorEvent): void {
    console.warn(`${EDIT_LOG_MARKER}${JSON.stringify(event)}`);
  }
}

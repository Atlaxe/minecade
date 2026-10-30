import { describe, expect, it } from "vitest";
import {
  ConfigAssembler,
  extractEditPayload,
  mapHash,
  parseEditorEvent,
  parseHostMessage,
  splitConfig,
  type HostMessage,
} from "../src/editor-protocol.ts";
import type { MapConfig } from "../src/map-config.ts";
import { MAX_MESSAGE_CHARS } from "../src/protocol/messages.ts";

const small: MapConfig = { name: "Arena", spawns: [[0, 65, 0]] };
/** A map well over one scriptevent: 300 spawns and a name full of characters JSON escapes. */
const big: MapConfig = {
  name: 'The "Big" \\ Map',
  spawns: Array.from({ length: 300 }, (_, i) => [i, 65, 10 - i, 90, 0] as [number, number, number, number, number]),
  points: { "flag.red": [[1, 2, 3]] },
};

function configParts(messages: HostMessage[]): Extract<HostMessage, { t: "config" }>[] {
  return messages.filter((message): message is Extract<HostMessage, { t: "config" }> => message.t === "config");
}

describe("editor protocol", () => {
  it("splits a map.json into messages within the scriptevent limit and puts it back together", () => {
    const parts = configParts(splitConfig(big, 7, 3));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(JSON.stringify(part).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    const assembler = new ConfigAssembler();
    // Out of order is fine; nothing comes out until the last part is in.
    const shuffled = [...parts.slice(1), parts[0]];
    const results = shuffled.map((part) => assembler.add(part));
    expect(results.slice(0, -1).every((result) => result === undefined)).toBe(true);
    expect(results.at(-1)).toEqual({ config: big, seq: 7 });
    expect(configParts(splitConfig(small, 0, 1))).toHaveLength(1);
  });

  it("drops an unfinished transfer when a newer one starts", () => {
    const assembler = new ConfigAssembler();
    const old = configParts(splitConfig(big, 1, 1));
    assembler.add(old[0]);
    const [fresh] = configParts(splitConfig(small, 2, 2));
    expect(assembler.add(fresh)).toEqual({ config: small, seq: 2 });
    expect(assembler.add(old[1])).toBeUndefined();
  });

  it("fingerprints a map by its content and key order", () => {
    expect(mapHash(small)).toBe(mapHash(JSON.parse(JSON.stringify(small))));
    expect(mapHash(small)).not.toBe(mapHash({ ...small, spawns: [[0, 66, 0]] }));
    expect(mapHash(small)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reads [EDIT] lines from the script log only", () => {
    expect(extractEditPayload('[2026-10-30 12:00:00:000 WARN] [Scripting] [EDIT] {"t":"ready"}')).toBe('{"t":"ready"}');
    expect(extractEditPayload('[2026-10-30 12:00:00:000 INFO] Player said [EDIT] {"t":"ready"}')).toBeUndefined();
    expect(parseEditorEvent('{"t":"edit","seq":1,"by":"a","edit":{"op":"draft","draft":false}}')?.t).toBe("edit");
    expect(parseEditorEvent('{"t":"config"}')).toBeUndefined();
    expect(parseEditorEvent("not json")).toBeUndefined();
    expect(parseHostMessage('{"t":"say","text":"hi"}')).toEqual({ t: "say", text: "hi" });
    expect(parseHostMessage("[1]")).toBeUndefined();
  });
});

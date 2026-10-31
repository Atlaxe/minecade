import { describe, expect, it } from "vitest";
import {
  ConfigAssembler,
  PartsAssembler,
  extractEditPayload,
  mapHash,
  openKey,
  parseEditorEvent,
  parseHostMessage,
  splitConfig,
  splitHome,
  type HomeState,
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

  it("sends the editor lobby's state in parts too", () => {
    const state: HomeState = {
      catalog: {
        targets: [{ id: "sumo", name: "Sumo", maps: Array.from({ length: 80 }, (_, i) => ({ id: `arena_${i}`, name: `Arena "${i}"`, draft: i % 2 === 0 })) }],
        worlds: [{ id: "abc=", name: "Datapacking (imported)", maps: 2 }],
        recent: [{ request: { to: "edit", target: "sumo", map: "arena_1" }, label: "Sumo: Arena (arena_1)" }],
      },
      servers: { edit: { request: { to: "edit", target: "sumo", map: "arena_1" }, label: "Sumo: Arena (arena_1)", state: "ready", players: ["a"] }, waiting: [] },
    };
    const parts = splitHome(state, 4).filter((message): message is Extract<HostMessage, { t: "home" }> => message.t === "home");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(JSON.stringify(part).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    const assembler = new PartsAssembler();
    const results = parts.map((part) => assembler.add(part));
    expect(JSON.parse(results.at(-1)!)).toEqual(state);
  });

  it("names what a request opens, so the same map or world matches", () => {
    expect(openKey({ to: "edit", target: "sumo", map: "arena_1" })).toBe(openKey({ to: "edit", target: "sumo", map: "arena_1", fresh: { name: "Arena" } }));
    expect(openKey({ to: "select", world: "abc=" })).toBe("select:abc=");
    expect(openKey({ to: "home" })).toBe("home");
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
    expect(parseEditorEvent('{"t":"save","by":"a"}')).toEqual({ t: "save", by: "a" });
    expect(parseEditorEvent('{"t":"saveWorld","by":"a","save":true}')).toBeUndefined();
    expect(parseHostMessage('{"t":"resume"}')).toEqual({ t: "resume" });
    expect(parseEditorEvent('{"t":"saveMap","by":"a","box":{"min":[0,0,0],"max":[1,1,1]},"target":"sumo","map":"castle","name":"Castle","spawn":[0,1,0]}')?.t).toBe("saveMap");
    expect(parseEditorEvent('{"t":"open","by":"a","request":{"to":"select"}}')).toEqual({ t: "open", by: "a", request: { to: "select" } });
    expect(parseEditorEvent('{"t":"switch","by":"a","to":"select"}')).toBeUndefined();
    expect(parseHostMessage('{"t":"goto","players":["a"],"port":19133,"label":"Select"}')?.t).toBe("goto");
    expect(parseEditorEvent('{"t":"extracted","ok":true,"tiles":4}')?.t).toBe("extracted");
    expect(parseHostMessage('{"t":"extract","box":{"min":[0,0,0],"max":[1,1,1]},"offset":[0,0,0]}')?.t).toBe("extract");
    expect(parseHostMessage('{"t":"forgotten","target":"sumo","map":"castle"}')?.t).toBe("forgotten");
    expect(parseHostMessage('{"t":"notice","text":"Castle is ready"}')).toEqual({ t: "notice", text: "Castle is ready" });
  });
});

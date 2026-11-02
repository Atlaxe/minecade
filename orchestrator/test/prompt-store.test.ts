import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { KEEP_PER_KIND, NEWEST_WINDOW, PromptStore, promptEvent } from "../src/prompts/store.ts";

function store(): PromptStore {
  let now = 0;
  let seed = 3;
  return new PromptStore(new DatabaseSync(":memory:"), { now: () => ++now, random: () => ((seed = (seed * 48271) % 2147483647) / 2147483647) });
}

describe("the prompt bank", () => {
  it("keeps prompts cleaned up, once each, with their first writer", () => {
    const bank = store();
    expect(bank.add("starter", "  A §cpirate   ship ", "Alex", "buildswap")).toBe("stored");
    expect(bank.add("starter", "a pirate ship", "Sam", "buildswap")).toBe("duplicate");
    expect(bank.add("twist", "a pirate ship", "Sam", "buildswap")).toBe("stored");
    expect(bank.add("starter", " §a ", "Sam", "buildswap")).toBe("empty");
    expect(bank.list("starter")).toMatchObject([{ kind: "starter", text: "A pirate ship", author: "alex", game: "buildswap", uses: 0 }]);
    expect(bank.count()).toBe(2);
  });

  it(`keeps at most ${KEEP_PER_KIND} of a kind, the oldest going first`, () => {
    const bank = store();
    for (let i = 0; i < KEEP_PER_KIND + 5; i++) bank.add("starter", `Prompt ${i}`, "alex", "buildswap");
    bank.add("twist", "A twist", "alex", "buildswap");
    expect(bank.count("starter")).toBe(KEEP_PER_KIND);
    expect(bank.list("starter").at(-1)?.text).toBe("Prompt 5");
    expect(bank.count("twist")).toBe(1);
  });

  it(`deals from the newest ${NEWEST_WINDOW}, the least used first`, () => {
    const bank = store();
    for (let i = 0; i < 80; i++) bank.add("starter", `Prompt ${i}`, i % 2 ? "alex" : "sam", "buildswap");
    const first = bank.pick("starter", 10);
    expect(first).toHaveLength(10);
    // Only the 50 newest (Prompt 30 to 79).
    expect(first.every((prompt) => Number(prompt.x.split(" ")[1]) >= 30)).toBe(true);
    expect(first[0]).toMatchObject({ k: "starter", by: expect.stringMatching(/alex|sam/) });
    bank.markUsed(first.map((prompt) => prompt.id));
    const second = bank.pick("starter", 40);
    const used = new Set(first.map((prompt) => prompt.id));
    expect(second.some((prompt) => used.has(prompt.id))).toBe(false);
    expect(bank.pick("twist", 5)).toEqual([]);
  });

  it("answers a game: submissions go in, a request gets prompts in parts, deals are counted", () => {
    const bank = store();
    expect(promptEvent(bank, { t: "prompt_submit", sessionId: "s1", game: "x", by: "alex", prompts: [{ kind: "starter", text: "A castle" }, { kind: "twist", text: "On fire" }] }, "buildswap")).toEqual([]);
    const [reply] = promptEvent(bank, { t: "prompt_request", requestId: "r1", sessionId: "s1", counts: { starter: 3, twist: 3 } }, "buildswap");
    expect(reply).toMatchObject({ t: "prompt_reply", requestId: "r1", part: 1, parts: 1 });
    expect(reply.t === "prompt_reply" && reply.prompts.map((prompt) => [prompt.k, prompt.x, prompt.by])).toEqual([
      ["starter", "A castle", "alex"],
      ["twist", "On fire", "alex"],
    ]);
    promptEvent(bank, { t: "prompt_used", sessionId: "s1", ids: [1] }, "buildswap");
    expect(bank.list("starter")[0].uses).toBe(1);
    // With the bank off, a request still gets an (empty) answer, so the game deals its own at once.
    expect(promptEvent(undefined, { t: "prompt_request", requestId: "r2", sessionId: "s1", counts: { starter: 3 } }, "buildswap")).toEqual([
      { t: "prompt_reply", requestId: "r2", part: 1, parts: 1, prompts: [] },
    ]);
  });
});

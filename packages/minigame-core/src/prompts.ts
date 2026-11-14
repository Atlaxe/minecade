// The prompt bank's shared rules, pure so the orchestrator (which keeps the bank in prompts.db) and
// the games (which deal its prompts) agree: how a prompt is cleaned up and how long it may be, how a
// reply is split to fit a message, and how prompts are dealt (half fresh, half played before) so
// nobody gets one they wrote.
import { MAX_MESSAGE_CHARS, type BankPrompt, type PromptReply } from "./protocol/index.ts";

/** The longest prompt kept: it has to fit a title's subtitle. */
export const PROMPT_MAX_CHARS = 50;

/** A prompt as stored and shown: no color codes or control characters, spaces collapsed, at most PROMPT_MAX_CHARS. "" when nothing is left. */
export function cleanPrompt(text: string): string {
  const plain = text
    .replace(/§./gs, "")
    .replace(/[\u0000-\u001f\u007f§]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, PROMPT_MAX_CHARS).trim();
}

/** What two prompts that say the same thing share: case and spacing aside. */
export function promptKey(text: string): string {
  return cleanPrompt(text).toLowerCase();
}

/** A reply to a prompt_request in as many parts as it takes for each to fit the message limit (at least one, maybe empty). */
export function promptReplyParts(requestId: string, prompts: BankPrompt[]): PromptReply[] {
  const groups: BankPrompt[][] = [[]];
  // Room for the envelope (type, ids, part numbers) of the longest part.
  const room = MAX_MESSAGE_CHARS - JSON.stringify({ t: "prompt_reply", requestId, part: 99, parts: 99, prompts: [] }).length;
  let used = 0;
  for (const prompt of prompts) {
    const size = JSON.stringify(prompt).length + 1;
    if (used + size > room && groups[groups.length - 1].length > 0) {
      groups.push([]);
      used = 0;
    }
    groups[groups.length - 1].push(prompt);
    used += size;
  }
  return groups.map((group, index) => ({ t: "prompt_reply", requestId, part: index + 1, parts: groups.length, prompts: group }));
}

/** A prompt a game can deal: from the bank (with its id), or from the game's own list (by nobody). */
export interface DealablePrompt {
  text: string;
  /** Who wrote it, lowercase; "" for nobody. */
  by: string;
  /** The bank's id, for prompts from the bank. */
  id?: number;
  /** A bank prompt no match has been dealt yet. */
  fresh?: boolean;
}

/** Whether a player may be dealt a prompt: by default, any but one they wrote. */
export type MayHave = (player: string, prompt: DealablePrompt) => boolean;

export const notTheirOwn: MayHave = (player, prompt) => prompt.by === "" || prompt.by !== player.toLowerCase();

/** The two piles a deal draws from, each in the order it's taken (shuffled by the game). */
export interface PromptPiles {
  /** The bank's prompts no match has had yet. */
  fresh: readonly DealablePrompt[];
  /** Prompts played before: the bank's dealt ones, and the game's own list. */
  played: readonly DealablePrompt[];
}

/**
 * Deals each player one prompt, players in the order given: at even odds (`random`) from the fresh
 * pile or the played one, and from the other when the first has nothing left they may have. Never
 * one a player may not have (`mayHave`: by default, never one they wrote), and never two players the
 * same one (prompts that say the same thing count as one). A player missing from the result had
 * nothing left in either pile.
 */
export function dealPrompts(players: readonly string[], piles: PromptPiles, random: () => number, mayHave: MayHave = notTheirOwn): Map<string, DealablePrompt> {
  const taken = new Set<string>();
  const next = (pile: readonly DealablePrompt[], player: string) =>
    pile.find((prompt) => {
      const key = promptKey(prompt.text);
      return key !== "" && !taken.has(key) && mayHave(player, prompt);
    });
  const dealt = new Map<string, DealablePrompt>();
  for (const player of players) {
    const [first, second] = random() < 0.5 ? [piles.fresh, piles.played] : [piles.played, piles.fresh];
    const prompt = next(first, player) ?? next(second, player);
    if (!prompt) continue;
    taken.add(promptKey(prompt.text));
    dealt.set(player, prompt);
  }
  return dealt;
}

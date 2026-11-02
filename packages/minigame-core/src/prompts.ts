// The prompt bank's shared rules, pure so the orchestrator (which keeps the bank in prompts.db) and
// the games (which deal its prompts) agree: how a prompt is cleaned up and how long it may be, how a
// reply is split to fit a message, and how prompts are dealt so nobody gets one they wrote.
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

/** A prompt a game can deal: written in this match's form, from the bank (with its id), or from the game's own list (by nobody). */
export interface DealablePrompt {
  text: string;
  /** Who wrote it, lowercase; "" for nobody. */
  by: string;
  /** The bank's id, for prompts from the bank. */
  id?: number;
}

/**
 * Deals each player one prompt from `pool`, never one they wrote and never two players the same one
 * (prompts that say the same thing count as one). The pool is in order of preference (this match's
 * prompts, then the bank's newest, then the game's own), and the deal leans on the first ones: as
 * many players as possible get a prompt, and among the ways to do that it takes from the front.
 * Players come in turn in the order given. A player missing from the result had nothing left.
 */
export function dealPrompts(players: string[], pool: readonly DealablePrompt[]): Map<string, DealablePrompt> {
  const seen = new Set<string>();
  const prompts = pool.filter((prompt) => {
    const key = promptKey(prompt.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A matching of players to prompts (Kuhn's augmenting paths), each player trying the prompts in order.
  const holder: (number | undefined)[] = prompts.map(() => undefined);
  const mayHave = (player: string, prompt: DealablePrompt) => prompt.by === "" || prompt.by !== player.toLowerCase();
  const place = (player: number, visited: Set<number>): boolean => {
    for (let index = 0; index < prompts.length; index++) {
      if (visited.has(index) || !mayHave(players[player], prompts[index])) continue;
      visited.add(index);
      const other = holder[index];
      if (other === undefined || place(other, visited)) {
        holder[index] = player;
        return true;
      }
    }
    return false;
  };
  players.forEach((_, player) => place(player, new Set()));
  const dealt = new Map<string, DealablePrompt>();
  holder.forEach((player, index) => {
    if (player !== undefined) dealt.set(players[player], prompts[index]);
  });
  return dealt;
}

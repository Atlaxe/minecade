// Replace mode (/replace, in Edit): while it's on, a right click on a block puts the block in your
// hand in its place, instead of next to it, keeping the states both blocks have (a stair's facing,
// a log's axis). With nothing in hand, or an item that isn't a block, a right click does what it
// always does. The aim cursor outlines the block a right click would replace, and the HUD's box top
// right says the mode is on.
import { BlockPermutation, BlockTypes, system, world, type Block, type Player } from "@minecraft/server";
import { HUD_MARK, NO_CLOCK, describeError, log, playChime, type Scope } from "@minecade/minigame-core";

/** The HUD's line while replace mode is on: the box top right, without the clock's icon. */
export const REPLACE_LINE = `${HUD_MARK}§eReplace mode${NO_CLOCK}`;

export class ReplaceMode {
  /** Who has it on, by lower-case name. */
  private readonly on = new Set<string>();
  /** Items that never replace a block (the editor's own). */
  private readonly skip: ReadonlySet<string>;
  private readonly replaced: (player: Player, block: Block) => void;

  /** `replaced` hears of each block replaced (it changed the world). */
  constructor(scope: Scope, skip: ReadonlySet<string>, replaced: (player: Player, block: Block) => void) {
    this.skip = skip;
    this.replaced = replaced;
    scope.subscribeBefore(world.beforeEvents.playerInteractWithBlock, (event) => {
      const { player, block, itemStack } = event;
      if (!this.has(player) || !itemStack || !this.isBlock(itemStack.typeId)) return;
      // Instead of placing it next to the block: in its place, once per click.
      event.cancel = true;
      if (!event.isFirstEvent) return;
      const at = block.location;
      const typeId = itemStack.typeId;
      system.run(() => this.replace(player, at, typeId));
    });
    scope.subscribe(world.afterEvents.playerLeave, ({ playerName }) => this.on.delete(playerName.toLowerCase()));
  }

  has(player: Player): boolean {
    return this.on.has(player.name.toLowerCase());
  }

  /** /replace: turns it on or off, and says so. */
  toggle(player: Player): void {
    const key = player.name.toLowerCase();
    if (this.on.delete(key)) {
      player.sendMessage("§b[Editor]§r Replace mode off: a right click places blocks as usual.");
    } else {
      this.on.add(key);
      player.sendMessage("§b[Editor]§r Replace mode on: right click a block to put the block in your hand in its place. /replace again turns it off.");
    }
    playChime(player, "go");
  }

  /** Whether an item is a block a right click would put in place (and not one of the editor's). */
  isBlock(typeId: string): boolean {
    return !this.skip.has(typeId) && BlockTypes.get(typeId) !== undefined;
  }

  private replace(player: Player, at: { x: number; y: number; z: number }, typeId: string): void {
    try {
      const block = player.dimension.getBlock(at);
      if (!block || block.typeId === typeId) return;
      block.setPermutation(withStatesOf(BlockPermutation.resolve(typeId), block.permutation));
      this.replaced(player, block);
    } catch (error) {
      log.warn(`could not replace a block with ${typeId}: ${describeError(error)}`);
    }
  }
}

/** `next` with every state `before` has that it has too, where the value fits. */
function withStatesOf(next: BlockPermutation, before: BlockPermutation): BlockPermutation {
  let kept = next;
  for (const [state, value] of Object.entries(before.getAllStates())) {
    if (kept.getState(state as Parameters<BlockPermutation["getState"]>[0]) === undefined) continue;
    try {
      kept = kept.withState(state as Parameters<BlockPermutation["withState"]>[0], value);
    } catch {
      // A value that block doesn't take.
    }
  }
  return kept;
}

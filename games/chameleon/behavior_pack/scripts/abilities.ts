// Chameleon's ability items: the game's own, each with its icon (tools/assets/chameleon-items.ts
// draws them), handed out named and locked in their slots (game.config.ts HOTBARS). Plain data, so
// the config, the asset generator and the tests read it. The chameleon pack (the workshop's
// chameleon-test) knows each by its id and name, so a change here needs the pack's (pack/main.js)
// too.

export interface AbilityItem {
  /** The icon's file name and the item's id after "minecade:chameleon_". */
  id: "wear_block" | "pose" | "lock" | "taunt" | "free_look" | "detector";
  item: string;
  name: string;
}

const ability = (id: AbilityItem["id"], name: string): AbilityItem => ({ id, item: `minecade:chameleon_${id}`, name });

export const WEAR_BLOCK = ability("wear_block", "Wear block");
export const POSE = ability("pose", "Pose");
export const LOCK = ability("lock", "Lock position");
export const TAUNT = ability("taunt", "Taunt");
export const FREE_LOOK = ability("free_look", "Free look");
export const DETECTOR = ability("detector", "Detector");

export const ABILITY_ITEMS: readonly AbilityItem[] = [WEAR_BLOCK, POSE, LOCK, TAUNT, FREE_LOOK, DETECTOR];

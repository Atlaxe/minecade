// minigame-core's building games kit (Build Swap, Guess the Build), for pack scripts:
// "@minecade/minigame-core/building". The base class, its pieces, and the commands.
export {
  BANK_WAIT_TICKS,
  BuildingGame,
  FALLBACK_PROMPTS,
  clock,
  keyOf,
  pointsText,
  shuffled,
  standings,
  type BuildJob,
  type BuildingGameConfig,
  type PromptAnswers,
  type PromptField,
} from "./building-game.ts";
export { ARENA_MAX_SIZE, ARENA_REGION, BUILD_AREA_MIN_SIZE, BUILD_PADDING, BUILDING_MAP, BUILDING_SETTINGS, PLOT_REGION, RETURN_DELAY } from "./building-map.ts";
export { registerBuildingCommands } from "./commands.ts";
export { DEFAULT_STARTERS, DEFAULT_TWISTS } from "./default-prompts.ts";
export { LIQUIDS, LiquidGuard, Snapshots, blockInside, clampInto, floorOf, grow, shell, type Plot } from "./plots.ts";
export { PromptForm, type PromptFormHandlers, type TextAnswer, type TextField } from "./prompt-form.ts";
export { FILL_LIMIT, FIX_RADIUS, SELECTION_HEX, WAND, WAND_NAME, boxVolume, clipBox, cornersBox, fillPieces, fixCells, sizeText, type Corners, type FixCell } from "./selection.ts";
export { ANVIL_FACING, STILL_BLOCKS, isStill, stillStates, stillTwin, type StillBlock, type StillShape } from "./still-blocks.ts";
export { Ballot, VOTES, votePoints, voteText } from "./votes.ts";

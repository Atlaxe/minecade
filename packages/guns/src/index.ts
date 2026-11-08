// @minecade/guns for pack scripts: the guns runtime, the arsenal's effects and the shared
// definitions. Not loadable under Node (it imports @minecraft/server); the pack generator and
// game.config.ts files use "@minecade/guns/defs" instead.
export * from "./defs.ts";
export {
  Guns,
  ammoText,
  coneDirections,
  heldItem,
  muzzleOf,
  paintSplash,
  type AmmoState,
  type BlockHit,
  type GunsOptions,
  type HitInfo,
  type Shot,
  type TriggerReport,
} from "./guns.ts";
export { Arsenal, LETHAL, type ArsenalCause, type ArsenalHost, type ArsenalOptions, type HurtResult } from "./arsenal.ts";

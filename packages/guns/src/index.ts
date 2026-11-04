// @minecade/guns for pack scripts: the guns runtime and the shared definitions. Not loadable under
// Node (it imports @minecraft/server); the pack generator and game.config.ts files use
// "@minecade/guns/defs" instead.
export * from "./defs.ts";
export {
  Guns,
  ammoText,
  coneDirections,
  heldItem,
  paintSplash,
  type AmmoState,
  type BlockHit,
  type GunsOptions,
  type Shot,
} from "./guns.ts";

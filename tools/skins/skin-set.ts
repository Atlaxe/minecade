// The renders made of each player's skin. The lobby pack has two, in the hologram's look:
//   holo       head and shoulders at an angle (the hologram's portrait, the stats screen's portrait)
//   holo_head  the head alone at an angle (the stats list's rows)
// and a game that asks (config playerPortraits) has a third in its own pack:
//   portrait   the same head and shoulders in color (Block Party's player cards and results)
// npm run skins also draws them all in color, to look at.
import type { SkinRender } from "@minecade/minigame-core/config";
import { LEGACY, WIDE, faceModelFor, modelFor } from "./geometry.ts";
import { hologramLook } from "./look.ts";
import type { Image } from "./png.ts";
import { renderModel, type Layer } from "./render.ts";
import type { StoredSkin } from "./store.ts";

/** The lobby pack's renders. */
export const RENDERS = ["holo", "holo_head"] as const satisfies readonly SkinRender[];

/** What a skin is drawn as: its model with its texture, and a character creator skin's face model with the face texture. */
export function layersFor(skin: StoredSkin): Layer[] {
  const layers: Layer[] = [{ model: modelFor(skin.meta, skin.geometry), texture: skin.image }];
  const face = faceModelFor(skin.meta, skin.geometry);
  if (face && skin.face) layers.push({ model: face, texture: skin.face });
  return layers;
}

/** Head and shoulders at an angle, in color. */
function portraitOf(layers: Layer[]): Image {
  return renderModel(layers, { width: 128, height: 128, framing: "bust" });
}

/** Head and shoulders, and the head alone, in color. */
function colorRenders(skin: StoredSkin): { portrait: Image; head: Image } {
  const layers = layersFor(skin);
  return {
    portrait: portraitOf(layers),
    head: renderModel(layers, { width: 64, height: 64, framing: "head", padding: 0.08 }),
  };
}

/** Every render of a skin: the lobby pack's, in the hologram's look, and the color portrait games can have. */
export function renderSkinSet(skin: StoredSkin): Record<SkinRender, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), holo_head: hologramLook(head), portrait };
}

/** The color portrait of a classic skin's texture (64 x 64, or an old 64 x 32): Steve's, for bots. */
export function classicPortrait(texture: Image): Image {
  return portraitOf([{ model: texture.height === 32 ? LEGACY : WIDE, texture }]);
}

/** The lobby pack's renders, plus the same in color, by file name (for npm run skins). */
export function renderPreviews(skin: StoredSkin): Record<string, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), "holo-head": hologramLook(head), portrait, head };
}

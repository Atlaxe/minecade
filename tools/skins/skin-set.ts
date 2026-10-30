// The renders made of each player's skin. The lobby pack has two, in the hologram's look:
//   holo       head and shoulders at an angle (the hologram's portrait, the stats screen's portrait)
//   holo_head  the head alone at an angle (the stats list's rows)
// npm run skins also draws both in color, to look at.
import type { SkinRender } from "@minecade/minigame-core/config";
import { faceModelFor, modelFor } from "./geometry.ts";
import { hologramLook } from "./look.ts";
import type { Image } from "./png.ts";
import { renderModel, type Layer } from "./render.ts";
import type { StoredSkin } from "./store.ts";

export const RENDERS: readonly SkinRender[] = ["holo", "holo_head"];

/** What a skin is drawn as: its model with its texture, and a character creator skin's face model with the face texture. */
export function layersFor(skin: StoredSkin): Layer[] {
  const layers: Layer[] = [{ model: modelFor(skin.meta, skin.geometry), texture: skin.image }];
  const face = faceModelFor(skin.meta, skin.geometry);
  if (face && skin.face) layers.push({ model: face, texture: skin.face });
  return layers;
}

/** Head and shoulders, and the head alone, in color. */
function colorRenders(skin: StoredSkin): { portrait: Image; head: Image } {
  const layers = layersFor(skin);
  return {
    portrait: renderModel(layers, { width: 128, height: 128, framing: "bust" }),
    head: renderModel(layers, { width: 64, height: 64, framing: "head", padding: 0.08 }),
  };
}

/** The renders that go in the lobby pack. */
export function renderSkinSet(skin: StoredSkin): Record<SkinRender, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), holo_head: hologramLook(head) };
}

/** The lobby pack's renders, plus the same in color, by file name (for npm run skins). */
export function renderPreviews(skin: StoredSkin): Record<string, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), "holo-head": hologramLook(head), portrait, head };
}

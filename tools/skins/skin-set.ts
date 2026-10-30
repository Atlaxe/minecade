// The renders made of each player's skin. The lobby pack has two, in the hologram's look:
//   holo       head and shoulders at an angle (the hologram's portrait, the stats screen's portrait)
//   holo_head  the head alone at an angle (the stats list's rows)
// npm run skins also draws both in color, to look at.
import type { SkinRender } from "@minecade/minigame-core/config";
import { modelFor, type Model } from "./geometry.ts";
import { hologramLook } from "./look.ts";
import type { Image } from "./png.ts";
import { renderModel } from "./render.ts";
import type { StoredSkin } from "./store.ts";

export const RENDERS: readonly SkinRender[] = ["holo", "holo_head"];

/** Head and shoulders, and the head alone, in color. */
function colorRenders(model: Model, skin: StoredSkin): { portrait: Image; head: Image } {
  return {
    portrait: renderModel(model, skin.image, { width: 128, height: 128, framing: "bust" }),
    head: renderModel(model, skin.image, { width: 64, height: 64, framing: "head", padding: 0.08 }),
  };
}

/** The renders that go in the lobby pack. */
export function renderSkinSet(skin: StoredSkin): Record<SkinRender, Image> {
  const { portrait, head } = colorRenders(modelFor(skin.meta, skin.geometry), skin);
  return { holo: hologramLook(portrait), holo_head: hologramLook(head) };
}

/** The lobby pack's renders, plus the same in color, by file name (for npm run skins). */
export function renderPreviews(skin: StoredSkin): Record<string, Image> {
  const { portrait, head } = colorRenders(modelFor(skin.meta, skin.geometry), skin);
  return { holo: hologramLook(portrait), "holo-head": hologramLook(head), portrait, head };
}

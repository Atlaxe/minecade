// The renders made of each player's skin, as the lobby uses them:
//   holo      head and shoulders at an angle, in the hologram's look (the hologram's portrait spot)
//   portrait  the same in color, on transparent (the stats screen's portrait)
//   head      the head alone at an angle, in color (the stats list's rows)
import type { SkinRender } from "@minecade/minigame-core/config";
import { modelFor } from "./geometry.ts";
import { hologramLook } from "./look.ts";
import type { Image } from "./png.ts";
import { renderModel } from "./render.ts";
import type { StoredSkin } from "./store.ts";

export const RENDERS: readonly SkinRender[] = ["holo", "portrait", "head"];

export function renderSkinSet(skin: StoredSkin): Record<SkinRender, Image> {
  const model = modelFor(skin.meta, skin.geometry);
  const bust = renderModel(model, skin.image, { width: 128, height: 128, framing: "bust" });
  return {
    holo: hologramLook(bust),
    portrait: bust,
    head: renderModel(model, skin.image, { width: 64, height: 64, framing: "head", padding: 0.08 }),
  };
}

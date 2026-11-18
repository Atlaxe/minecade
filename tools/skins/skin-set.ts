// The renders made of each player's skin. The lobby pack has two, in the hologram's look:
//   holo       head and shoulders at an angle (the hologram's portrait, the stats screen's portrait)
//   holo_head  the head alone at an angle (the stats list's rows)
// and a game that asks (config playerFaces) has a third in its own pack:
//   face       the face, flat: the head's front with the hat layer over it (Block Party's cards)
// npm run skins also draws the first two in color, to look at.
import type { SkinRender } from "@minecade/minigame-core/config";
import { LEGACY, SLIM, WIDE, faceModelFor, modelFor } from "./geometry.ts";
import { hologramLook } from "./look.ts";
import { blankImage, type Image } from "./png.ts";
import { renderModel, type Layer } from "./render.ts";
import type { StoredSkin } from "./store.ts";

/** The lobby pack's renders. */
export const RENDERS = ["holo", "holo_head"] as const satisfies readonly SkinRender[];
type LobbyRender = (typeof RENDERS)[number];

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
export function renderSkinSet(skin: StoredSkin): Record<LobbyRender, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), holo_head: hologramLook(head) };
}

/** The lobby pack's renders, plus the same in color and the flat face, by file name (for npm run skins). */
export function renderPreviews(skin: StoredSkin): Record<string, Image> {
  const { portrait, head } = colorRenders(skin);
  return { holo: hologramLook(portrait), "holo-head": hologramLook(head), portrait, head, face: renderFace(skin) };
}

/** How big the face render is: its 8 skin pixels each this many over 8. */
export const FACE_SIZE = 64;

/**
 * The face, flat, for a game's own screens (block-party-ui.md, "Player heads"): on a classic skin
 * the head's front (8 x 8) with the hat layer's front over it, scaled up with hard pixels; on a
 * character creator skin, its own model's head from straight in front, unshaded.
 */
export function renderFace(skin: StoredSkin): Image {
  const model = modelFor(skin.meta, skin.geometry);
  if (model !== WIDE && model !== SLIM && model !== LEGACY) {
    return renderModel(layersFor(skin), { width: FACE_SIZE, height: FACE_SIZE, yaw: 0, pitch: 0, framing: "head", padding: 0, supersample: 1, flat: true });
  }
  // A bigger skin (128 wide) keeps the classic layout at twice the pixels.
  const scale = Math.max(1, Math.round(skin.image.width / model.textureWidth));
  const face = crop(skin.image, 8 * scale, 8 * scale, 8 * scale);
  // The head is solid, as the game draws it.
  for (let at = 3; at < face.data.length; at += 4) face.data[at] = 255;
  const hat = crop(skin.image, 40 * scale, 8 * scale, 8 * scale);
  // An old skin can fill the hat's place with one solid color, which the game doesn't draw.
  if (!oneSolidColor(hat)) over(face, hat);
  return scaleUp(face, FACE_SIZE);
}

/** A square of `size` pixels from (x, y). */
function crop(image: Image, x: number, y: number, size: number): Image {
  const out = blankImage(size, size);
  for (let row = 0; row < size; row++) {
    const from = ((y + row) * image.width + x) * 4;
    if (y + row < image.height) out.data.set(image.data.subarray(from, from + size * 4), row * size * 4);
  }
  return out;
}

function oneSolidColor(image: Image): boolean {
  const { data } = image;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] !== 255 || data[at] !== data[0] || data[at + 1] !== data[1] || data[at + 2] !== data[2]) return false;
  }
  return true;
}

/** Draws `top` over `bottom` (the same size), by its alpha. */
function over(bottom: Image, top: Image): void {
  for (let at = 0; at < bottom.data.length; at += 4) {
    const alpha = top.data[at + 3] / 255;
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel++) bottom.data[at + channel] = Math.round(top.data[at + channel] * alpha + bottom.data[at + channel] * (1 - alpha));
    bottom.data[at + 3] = Math.max(bottom.data[at + 3], top.data[at + 3]);
  }
}

/** A square image made `size` pixels across, each pixel a block (no smoothing). */
function scaleUp(image: Image, size: number): Image {
  const out = blankImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (Math.floor((y * image.height) / size) * image.width + Math.floor((x * image.width) / size)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * size + x) * 4);
    }
  }
  return out;
}

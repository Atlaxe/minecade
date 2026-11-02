// How a fake player looks: a preview's fake players and the map editor's mannequins (stand-ins for
// game pictures) are the same player-shaped entity (minecade:fake_player, editor/preview/). Pure,
// so map.json (a mannequin's look, by these ids), the editor and the tests share it.

/** A skin a fake player can wear, on the slim model or the wide one. */
export interface FakeSkin {
  id: string;
  label: string;
  slim: boolean;
}

/**
 * Its skins, in the render controller's order: a plain color (the white skin tinted, see
 * FAKE_COLORS), then Minecraft's Steve and Alex, which the build copies from the Minecraft install
 * (tools/editor/fake-player.ts). Edit's pack adds the players' skins the lobby's watcher saved
 * after these (classic ones only), for its mannequins.
 */
export const FAKE_SKINS: readonly FakeSkin[] = [
  { id: "color", label: "Color", slim: false },
  { id: "steve", label: "Steve", slim: false },
  { id: "alex", label: "Alex", slim: true },
];

/**
 * The plain colors: the team colors (Red, Blue, Green, Yellow), then White, Black and Gray, each as
 * dark as its concrete (Green is lime's, the dye a green team's items take). `code` is the § color
 * whose dye its held items take.
 */
export const FAKE_COLORS = [
  { id: "red", label: "Red", tint: 0x8e2121, code: "§c" },
  { id: "blue", label: "Blue", tint: 0x2d2f8f, code: "§9" },
  { id: "green", label: "Green", tint: 0x5ea918, code: "§a" },
  { id: "yellow", label: "Yellow", tint: 0xf1af15, code: "§e" },
  { id: "white", label: "White", tint: 0xcfd5d6, code: "§f" },
  { id: "black", label: "Black", tint: 0x080a0f, code: "§0" },
  { id: "gray", label: "Gray", tint: 0x373a3e, code: "§8" },
] as const;

/** Its poses, in the client entity's order (editor/preview/resource_pack/animations/fake_player.animation.json). */
export const FAKE_POSES = [
  { id: "standing", label: "Standing" },
  { id: "walking", label: "Walking" },
  { id: "running", label: "Running" },
  { id: "swinging", label: "Swinging" },
  { id: "aiming", label: "Aiming a bow" },
  { id: "placing", label: "Placing a block" },
  { id: "falling", label: "Falling" },
  { id: "cheering", label: "Cheering" },
] as const;

/** How a fake player looks: its skin list's (FAKE_SKINS'), FAKE_COLORS' and FAKE_POSES' index, and what it holds (an item id, "{color}" filled in with its color's dye). */
export interface FakeLook {
  skin: number;
  color: number;
  pose: number;
  hold?: string;
}

/** A preview's fake player starts as Steve, standing. */
export const DEFAULT_FAKE_LOOK: FakeLook = { skin: 1, color: 0, pose: 0 };

/** A new mannequin starts from the first choices: a plain color (Red), standing, holding nothing. */
export const NEW_MANNEQUIN_LOOK: FakeLook = { skin: 0, color: 0, pose: 0 };

/** The pose after `pose`, back to the first after the last. */
export function nextPose(pose: number): number {
  return (pose + 1) % FAKE_POSES.length;
}

/** The skin property's value and the tint the pack draws it with (0xRRGGBB + 1, 0 for none: only the plain color is tinted). */
export function lookProperties(look: FakeLook, skins: readonly FakeSkin[] = FAKE_SKINS): { skin: number; tint: number; pose: number } {
  const skin = skins[look.skin] ? look.skin : 0;
  const color = FAKE_COLORS[look.color] ?? FAKE_COLORS[0];
  return { skin, tint: skin === 0 ? color.tint + 1 : 0, pose: FAKE_POSES[look.pose] ? look.pose : 0 };
}

/** A look as map.json keeps a mannequin's: by ids, the color only for the plain color skin. */
export function lookIds(look: FakeLook, skins: readonly FakeSkin[] = FAKE_SKINS): { skin: string; color?: string; pose: string; hold?: string } {
  const skin = skins[look.skin] ?? FAKE_SKINS[0];
  return {
    skin: skin.id,
    ...(skin.id === "color" ? { color: (FAKE_COLORS[look.color] ?? FAKE_COLORS[0]).id } : {}),
    pose: (FAKE_POSES[look.pose] ?? FAKE_POSES[0]).id,
    ...(look.hold !== undefined ? { hold: look.hold } : {}),
  };
}

/** A look from map.json's ids; ones it doesn't know are the first choices. */
export function lookFromIds(ids: { skin?: unknown; color?: unknown; pose?: unknown; hold?: unknown }, skins: readonly FakeSkin[] = FAKE_SKINS): FakeLook {
  const index = (list: readonly { id: string }[], id: unknown) => Math.max(0, list.findIndex((entry) => entry.id === id));
  return {
    skin: index(skins, ids.skin),
    color: index(FAKE_COLORS, ids.color),
    pose: index(FAKE_POSES, ids.pose),
    ...(typeof ids.hold === "string" && ids.hold !== "" ? { hold: ids.hold } : {}),
  };
}

/** A look in a few words: "Red, Standing", "Alex, Running, holding Bow". */
export function lookText(look: FakeLook, holdLabel?: string, skins: readonly FakeSkin[] = FAKE_SKINS): string {
  const skin = skins[look.skin] ?? FAKE_SKINS[0];
  const parts: string[] = [skin.id === "color" ? (FAKE_COLORS[look.color] ?? FAKE_COLORS[0]).label : skin.label, (FAKE_POSES[look.pose] ?? FAKE_POSES[0]).label];
  if (look.hold !== undefined) parts.push(`holding ${holdLabel ?? look.hold}`);
  return parts.join(", ");
}

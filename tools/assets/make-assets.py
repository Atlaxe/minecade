"""Generates Minecade's placeholder UI images with Pillow, then commit the PNGs it writes:

    python tools/assets/make-assets.py            writes only images that don't exist yet
    python tools/assets/make-assets.py --force    regenerates every image (overwrites edits!)

The images are meant to be redrawn by hand; by default this never touches an existing file.

Outputs:
    packages/minigame-core/resource_pack/textures/minecade/hud/clock.png   HUD match clock icon
    packages/minigame-core/resource_pack/textures/minecade/hud/skull.png   HUD own score icon (kills)
    packages/minigame-core/resource_pack/textures/minecade/hud/round_*.png the best-of rounds circles
    games/bridges/resource_pack/textures/minecade/bridges/hole_*.png        Bridges' holes, a ring per team
    tools/assets/items/*.png                                                 item icons for kit pictures (the build)
    packages/minigame-core/resource_pack/textures/ui/item_lock_*.png         blank: locked items show no lock corner
    lobby/resource_pack/textures/minecade/ui/...                             holographic menu art
    lobby/resource_pack/textures/minecade/holo/...                           hologram frames, beam
    lobby/resource_pack/textures/minecade/blocks/...                         terminal block faces
    lobby/resource_pack/font/glyph_E3.png                                    icons drawn inside text (the player icon)
    editor/resource_pack/textures/minecade/editor/...                        the map editor's dark side menus and icons
    editor/resource_pack/textures/particle/outline.png                        the editor's outline dot (white, dark rim)
    editor/resource_pack/textures/items/select_tool.png                       Select mode's tool (a crop mark)
    editor/resource_pack/textures/items/snapshot.png                          the Snapshot tool (a photo)
    editor/resource_pack/textures/items/marker_tool.png                       the Game marker tool (a flag)
    editor/resource_pack/textures/entity/editor_marker_facing.png            the red facing line on markers
    editor/resource_pack/textures/entity/editor_marker*.png                  markers, a color per kind
    games/<id>/icon.png                                                      16:9 game pictures (Probe, Sumo, One in the Quiver)

Fonts come from Windows (Bahnschrift, else Consolas Bold); they only matter when regenerating.
The logo source is tools/assets/source/minecade-title.png (the orange original).
"""

import colorsys
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CORE_TEXTURES = ROOT / "packages" / "minigame-core" / "resource_pack" / "textures" / "minecade"
LOBBY_TEXTURES = ROOT / "lobby" / "resource_pack" / "textures" / "minecade"
LOBBY_FONT = ROOT / "lobby" / "resource_pack" / "font"
EDITOR_TEXTURES = ROOT / "editor" / "resource_pack" / "textures"
LOGO_SOURCE = ROOT / "tools" / "assets" / "source" / "minecade-title.png"

# Holographic palette: retro blues.
CYAN = (90, 210, 255)
BRIGHT = (190, 240, 255)
DEEP = (20, 70, 140)
# The map editor's menus: Ore UI grays, darker than the lobby's holographic blues.
EDITOR_FACE = (49, 50, 51)
EDITOR_GREEN = (60, 133, 39)
# Stars in each warp layer (the north and south walls show four, zoomed, fading in and out).
WARP_STARS = 600


FORCE = "--force" in sys.argv


def save(image: Image.Image, path: Path) -> None:
    if path.exists() and not FORCE:
        print(f"kept  {path.relative_to(ROOT).as_posix()}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    print(f"wrote {path.relative_to(ROOT).as_posix()}")


def save_nineslice(image: Image.Image, path: Path, slice_size: int) -> None:
    """A stretchable image: its outer slice_size pixels keep their size, the middle stretches."""
    save(image, path)
    meta = path.with_suffix(".json")
    if meta.exists() and not FORCE:
        return
    meta.write_text(json.dumps({"nineslice_size": slice_size, "base_size": list(image.size)}) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {meta.relative_to(ROOT).as_posix()}")


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("bahnschrift.ttf", "consolab.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---- HUD (core pack) ------------------------------------------------------------------------


def clock_icon() -> Image.Image:
    """A 16x16 pixel-art clock: white rim, dark face, hands at ten past ten."""
    size = 16
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rim = (235, 240, 245, 255)
    face = (30, 40, 60, 235)
    hand = (255, 255, 255, 255)
    accent = (120, 200, 255, 255)
    draw.ellipse((1, 1, 14, 14), fill=face, outline=rim, width=2)
    # Hour marks at 12, 3, 6 and 9.
    for x, y in ((7, 3), (12, 7), (7, 12), (3, 7)):
        draw.point((x, y), fill=accent)
        draw.point((x + (1 if x == 7 else 0), y + (1 if y == 7 else 0)), fill=accent)
    # Hands: minute hand up, hour hand to the right, both from the center (7.5, 7.5).
    draw.line((7, 4, 7, 8), fill=hand)
    draw.line((8, 4, 8, 8), fill=hand)
    draw.line((8, 7, 11, 7), fill=hand)
    draw.line((8, 8, 11, 8), fill=hand)
    return image


# A 16x16 pixel-art skull: "#" bone, "o" the clock's dark face, "." clear.
SKULL = (
    "................",
    ".....######.....",
    "...##########...",
    "..############..",
    ".##############.",
    ".##############.",
    ".##ooo####ooo##.",
    ".#oooo####oooo#.",
    ".#oooo####oooo#.",
    ".##oo######oo##.",
    "..#####oo#####..",
    "...##########...",
    "....########....",
    "....##o##o##....",
    "....########....",
    "................",
)


def skull_icon() -> Image.Image:
    """The own score's icon (kills): a white skull with dark eyes, the clock's colors."""
    colors = {"#": (235, 240, 245, 255), "o": (30, 40, 60, 235)}
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(SKULL):
        for x, cell in enumerate(row):
            if cell in colors:
                image.putpixel((x, y), colors[cell])
    return image


# The rounds display's circles (best-of rounds, core pack): white for a round still to play, then
# the winner's color, gray for a drawn round. Keys are the § codes (hud.ts ROUND_COLORS).
ROUND_FILLS = {
    "open": (245, 245, 245),
    "c": (255, 85, 85),
    "9": (85, 85, 255),
    "a": (85, 255, 85),
    "e": (255, 255, 85),
    "6": (255, 170, 0),
    "d": (255, 85, 255),
    "b": (85, 255, 255),
    "f": (255, 255, 255),
    "7": (150, 150, 150),
}


def round_circle(fill: tuple[int, int, int]) -> Image.Image:
    """A 32x32 filled circle with a darker rim, drawn 4x and shrunk so its edge is smooth."""
    big = 128
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rim = tuple(round(part * 0.45) for part in fill) + (255,)
    draw.ellipse((4, 4, big - 5, big - 5), fill=rim)
    draw.ellipse((18, 18, big - 19, big - 19), fill=fill + (255,))
    return image.resize((32, 32), Image.LANCZOS)


# ---- Bridges ----------------------------------------------------------------------------------

# The dyes a hole is drawn in, in the order of the hole entity's minecade:team property
# (games/bridges/behavior_pack/scripts/holes.ts HOLE_DYES).
HOLE_DYES = {
    "red": (255, 70, 70),
    "blue": (70, 110, 255),
    "lime": (90, 235, 70),
    "yellow": (255, 230, 60),
}


def hole_texture(ring: tuple[int, int, int]) -> Image.Image:
    """The hole's texture (96x48): black walls and bottom on the left, its rim on the right, a ring of
    the team's color around a clear middle, brighter at the outer edge."""
    image = Image.new("RGBA", (96, 48), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 39, 47), fill=(0, 0, 0, 255))
    left = 48
    for step, shade in enumerate((1.0, 0.85, 0.7)):
        color = tuple(min(255, round(part * shade)) for part in ring) + (255,)
        draw.rectangle((left + step, step, left + 39 - step, 39 - step), outline=color)
    return image


# Kit item icons (16x16), which the build puts together into each kit's picture
# (tools/build/kit-pictures.ts). Named by item id without "minecraft:"; wool comes in each team dye.
ITEM_ART = {
    "wooden_sword": (
        "................",
        ".............kk.",
        "............klwk",
        "...........klwk.",
        "..........klwk..",
        ".........klwk...",
        "........klwk....",
        ".......klwk.....",
        "..kk..klwk......",
        "..khkklwk.......",
        "...khhwk........",
        "....khk.........",
        "...khkhk........",
        "..khk.kk........",
        ".khk............",
        ".kk.............",
    ),
    "bow": (
        "................",
        "........kkkkk...",
        "......kkwwwwsk..",
        ".....kwwkkk.s...",
        "....kwk....s....",
        "...kwk....s.....",
        "...kwk...s......",
        "..kwk...s.......",
        "..kwk..s........",
        "..kwk.s.........",
        ".kwk.s..........",
        ".kwks...........",
        ".kws............",
        ".kss............",
        ".kk.............",
        "................",
    ),
    "arrow": (
        "................",
        "...........kkk..",
        "..........kggk..",
        "...........kggk.",
        "..........kwkgk.",
        ".........kwk.k..",
        "........kwk.....",
        ".......kwk......",
        "......kwk.......",
        ".....kwk........",
        "..f.kwk.........",
        "..ffwk..........",
        "...fff..........",
        "..fff.f.........",
        ".ff..f..........",
        "................",
    ),
    "snowball": (
        "................",
        "................",
        "................",
        "......kkkk......",
        ".....kffffk.....",
        "....kfffffpk....",
        "...kffffffppk...",
        "...kfffffpppk...",
        "...kffffppppk...",
        "...kfffpppppk...",
        "....kpppppbk....",
        ".....kppbbk.....",
        "......kkkk......",
        "................",
        "................",
        "................",
    ),
    "feather": (
        "................",
        "............kk..",
        "..........kkffk.",
        ".........kfffpk.",
        "........kfffpk..",
        ".......kfffpk...",
        "......kfffpk....",
        ".....kfffpk.....",
        "....kfffpk......",
        "....kffpk.......",
        "...kffpk........",
        "...kfpk.........",
        "..kgkk..........",
        ".kgk............",
        ".kk.............",
        "................",
    ),
}
ITEM_COLORS = {
    "k": (40, 28, 12, 255),      # outline
    "w": (160, 115, 55, 255),    # wood
    "l": (200, 160, 100, 255),   # light wood
    "h": (95, 65, 30, 255),      # handle
    "s": (225, 225, 225, 255),   # bowstring
    "g": (130, 130, 135, 255),   # gray: arrowhead, quill
    "f": (250, 250, 250, 255),   # white
    "p": (200, 220, 240, 255),   # pale blue shade
    "b": (150, 175, 210, 255),   # blue shade
}
WOOL_DYES = {
    "red": (190, 45, 40),
    "blue": (55, 65, 170),
    "lime": (110, 185, 30),
    "yellow": (245, 200, 40),
    "orange": (240, 120, 25),
    "magenta": (190, 70, 180),
    "light_blue": (60, 175, 220),
    "white": (235, 235, 235),
}


def item_icon(rows: tuple[str, ...]) -> Image.Image:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, cell in enumerate(row):
            if cell in ITEM_COLORS:
                image.putpixel((x, y), ITEM_COLORS[cell])
    return image


def wool_icon(dye: tuple[int, int, int]) -> Image.Image:
    """A wool block seen from the front: the dye, a darker edge and a woolly speckle."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    rng = random.Random(7)
    for y in range(1, 15):
        for x in range(1, 15):
            edge = x in (1, 14) or y in (1, 14)
            shade = 0.7 if edge else rng.choice((0.9, 1.0, 1.0, 1.08))
            image.putpixel((x, y), tuple(min(255, round(part * shade)) for part in dye) + (255,))
    return image


# ---- Logo -----------------------------------------------------------------------------------


def blue_logo() -> Image.Image:
    """The orange wordmark recolored to holographic blue: same shading, hue moved to cyan-blue."""
    source = Image.open(LOGO_SOURCE).convert("RGBA")
    out = Image.new("RGBA", source.size)
    src, dst = source.load(), out.load()
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, a = src[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.15:
                # Orange (light, top) to pale cyan; deep red (shadow) to deep blue.
                h = 0.54 + (0.06 * (1 - v))
                s = min(1.0, s * 0.85)
                v = min(1.0, v * 1.08)
            nr, ng, nb = colorsys.hsv_to_rgb(h, s, v)
            dst[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    # A soft cyan glow behind it.
    glow = Image.new("RGBA", source.size, (0, 0, 0, 0))
    glow.paste((*CYAN, 160), mask=source.split()[3])
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    pad = 24
    canvas = Image.new("RGBA", (source.width + pad * 2, source.height + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(glow, (pad, pad))
    canvas.alpha_composite(out, (pad, pad))
    return canvas


# ---- Hologram (world display, additive: black is see-through) --------------------------------


HOLO = 512  # each screen is a square texture shown on a 3x3 block panel


def holo_base() -> Image.Image:
    """A dark panel with scanlines, a glowing frame and corner brackets."""
    image = Image.new("RGB", (HOLO, HOLO), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, HOLO - 9, HOLO - 9), fill=(4, 16, 34))
    for y in range(10, HOLO - 10, 4):
        draw.line((10, y, HOLO - 11, y), fill=(6, 26, 52))
    draw.rectangle((8, 8, HOLO - 9, HOLO - 9), outline=DEEP, width=3)
    arm = 46
    for cx, cy, dx, dy in ((14, 14, 1, 1), (HOLO - 15, 14, -1, 1), (14, HOLO - 15, 1, -1), (HOLO - 15, HOLO - 15, -1, -1)):
        draw.line((cx, cy, cx + dx * arm, cy), fill=CYAN, width=5)
        draw.line((cx, cy, cx, cy + dy * arm), fill=CYAN, width=5)
    return image


def paste_logo(image: Image.Image, logo: Image.Image, top: int, width: int) -> None:
    scaled = logo.resize((width, round(logo.height * width / logo.width)), Image.LANCZOS)
    # On an additive display the logo's black outline disappears; keep its glowing fill.
    background = Image.new("RGB", scaled.size, (0, 0, 0))
    background.paste(scaled, mask=scaled.split()[3])
    image.paste(background, ((HOLO - width) // 2, top), mask=scaled.split()[3])


def holo_frames(logo: Image.Image) -> dict[str, Image.Image]:
    """The hologram's two frames; all text is drawn live on top (see lobby scripts/hologram.ts)."""
    with_logo = holo_base()
    paste_logo(with_logo, logo, 40, 420)
    return {"frame_logo": with_logo, "frame_panel": holo_base()}


def holo_backdrop() -> Image.Image:
    """
    Behind the hologram's panels: a faint see-through blue (about 14%), drawn with an alpha-blended
    material, so the sky behind the panels takes on the hologram's blue and the panels read as one
    glowing screen.
    """
    return Image.new("RGBA", (16, 16), (28, 185, 244, 35))


def stars() -> Image.Image:
    """
    The star box's east and west walls, floor and ceiling (lobby map.json "stars"): stars on black,
    drawn additively, so black shows nothing and only the stars add light.
    """
    return star_field(7, 1800)


def warp(level: int) -> Image.Image:
    """
    The star box's north and south walls, at brightness level 1 to 7 of 7: a different field from
    stars(), zoomed by the warp render controllers, which fade a layer in and out by switching
    between these levels (level 0 is icon_none, black).
    """
    return star_field(11, WARP_STARS, level / 7)


def star_field(seed: int, count: int, brightness: float = 1.0) -> Image.Image:
    """
    Stars on black, 512x512, the same every run for a seed: mostly faint single pixels, some
    brighter ones, a few bright ones with a small cross of glow, and some tinted blue. It wraps at
    the edges (it repeats as it scrolls). brightness scales every star.
    """
    rng = random.Random(seed)
    image = Image.new("RGB", (512, 512), (0, 0, 0))

    def put(x: int, y: int, color: tuple[int, int, int]) -> None:
        r, g, b = image.getpixel((x % 512, y % 512))
        image.putpixel((x % 512, y % 512), (max(r, color[0]), max(g, color[1]), max(b, color[2])))

    for _ in range(count):
        x, y = rng.randrange(512), rng.randrange(512)
        roll = rng.random()
        level = rng.randint(60, 130) if roll < 0.8 else rng.randint(150, 220) if roll < 0.97 else rng.randint(230, 255)
        tint = rng.random()
        color = (round(level * 0.7), round(level * 0.85), level) if tint < 0.2 else (level, level, level)
        color = tuple(round(channel * brightness) for channel in color)
        put(x, y, color)
        if roll >= 0.97:
            halo = tuple(round(channel * 0.45) for channel in color)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                put(x + dx, y + dy, halo)
    return image


def holo_beam() -> Image.Image:
    """The projection cone: brightest at the bottom center, fading up and out to black at the top."""
    width, height = 128, 256
    image = Image.new("RGB", (width, height), (0, 0, 0))
    px = image.load()
    for y in range(height):
        rise = 1 - y / (height - 1)  # 1 at the top row of the texture
        spread = 6 + (width / 2 - 6) * rise
        # The top third fades to black, so the beam has no hard edge (additive: black is invisible).
        top_fade = min(1.0, (1 - rise) / 0.35) ** 1.5
        for x in range(width):
            off = abs(x - (width - 1) / 2) / spread
            if off <= 1:
                strength = (1 - off) ** 1.6 * (0.25 + 0.75 * (1 - rise)) * top_fade
                px[x, y] = (round(CYAN[0] * strength), round(CYAN[1] * strength), round(CYAN[2] * strength))
    return image


# ---- Terminal blocks (16x16 faces) ------------------------------------------------------------


def block_side() -> Image.Image:
    image = Image.new("RGBA", (16, 16), (28, 34, 46, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 15, 1), fill=(46, 56, 74, 255))
    draw.line((0, 3, 15, 3), fill=(*CYAN, 255))
    for x in (2, 7, 12):
        draw.point((x, 9), fill=(60, 72, 92, 255))
    return image


def block_top(kind: str) -> Image.Image:
    """Top faces drawn for the north-west corner, the north edge and the center; the block rotates them."""
    image = Image.new("RGBA", (16, 16), (20, 26, 38, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, 16, 4):
        draw.line((0, y, 15, y), fill=(24, 32, 46, 255))
    if kind in ("corner", "edge"):
        draw.line((0, 1, 15, 1), fill=(*CYAN, 255))  # north rim
    if kind == "corner":
        draw.line((1, 0, 1, 15), fill=(*CYAN, 255))  # west rim
        draw.rectangle((3, 3, 5, 5), fill=(*BRIGHT, 255))
    if kind == "center":
        draw.ellipse((2, 2, 13, 13), fill=(10, 40, 80, 255), outline=(*CYAN, 255))
        draw.ellipse((5, 5, 10, 10), fill=(*BRIGHT, 255))
    return image


# ---- Form art (personal menus) ----------------------------------------------------------------


def holo_ui_panel() -> Image.Image:
    """
    Every menu's background, in the hologram frame's style (holo_base): a nine-slice at 1x (64x64,
    24 pixel slices), so the frame and the corner brackets keep their size at any panel size. Forms
    can't blend additively like the hologram, so the dark fill is see-through instead: the world
    shows through dimly and the frame glows. Keep the border and brackets within 24 pixels of the
    edge; the middle stretches. The scanlines are a separate, tiled image (holo_scanlines).
    """
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size - 1, size - 1), outline=(*CYAN, 40), width=1)  # outer glow
    draw.rectangle((1, 1, size - 2, size - 2), outline=(*CYAN, 90), width=1)
    draw.rectangle((2, 2, size - 3, size - 3), fill=(4, 16, 34, 170), outline=(*DEEP, 255), width=2)
    inset, arm = 5, 16
    for cx, cy, dx, dy in ((inset, inset, 1, 1), (size - 1 - inset, inset, -1, 1), (inset, size - 1 - inset, 1, -1), (size - 1 - inset, size - 1 - inset, -1, -1)):
        draw.line((cx, cy, cx + dx * arm, cy), fill=(*CYAN, 255), width=2)
        draw.line((cx, cy, cx, cy + dy * arm), fill=(*CYAN, 255), width=2)
    return image


def holo_scanlines() -> Image.Image:
    """Faint scanlines, tiled over a menu's background: one light line every 3 pixels."""
    image = Image.new("RGBA", (4, 3), (0, 0, 0, 0))
    for x in range(4):
        image.putpixel((x, 0), (60, 140, 210, 40))
    return image


def ui_icon(kind: str) -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = (*BRIGHT, 255)
    if kind == "play":
        draw.polygon([(18, 10), (18, 54), (52, 32)], fill=color)
    elif kind == "stats":
        for i, height in enumerate((20, 34, 48)):
            left = 8 + i * 18
            draw.rectangle((left, 56 - height, left + 12, 56), fill=color)
    elif kind == "random":
        draw.rounded_rectangle((8, 8, 56, 56), radius=8, outline=color, width=5)
        for x, y in ((22, 22), (42, 42), (32, 32), (22, 42), (42, 22)):
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=color)
    else:  # map
        draw.polygon([(8, 16), (24, 8), (40, 16), (56, 8), (56, 48), (40, 56), (24, 48), (8, 56)], outline=color, width=4)
        draw.line((24, 8, 24, 48), fill=color, width=3)
        draw.line((40, 16, 40, 56), fill=color, width=3)
    return image


def ui_button(state: str) -> Image.Image:
    """
    Every button (menu tiles, game cards, settings, the Random switch, Start, player rows, tabs):
    a 1x nine-slice (16x16, 4 pixel slices), so it looks the same at any size. Navy, with a cyan
    line down the left and right edges and square corners; hover and pressed brighten it.
    """
    size = 16
    fill = {"default": (10, 36, 70, 230), "hover": (24, 80, 140, 240), "pressed": (40, 120, 190, 250)}[state]
    line = {"default": CYAN, "hover": BRIGHT, "pressed": (255, 255, 255)}[state]
    image = Image.new("RGBA", (size, size), fill)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1, size - 1), fill=(*line, 255))
    draw.rectangle((size - 2, 0, size - 1, size - 1), fill=(*line, 255))
    return image


def ui_outline(state: str) -> Image.Image:
    """
    A square 2 pixel outline, as a 1x nine-slice (16x16, 4 pixel slices), drawn over pictures and
    buttons: the map tile frames (default, and hover and pressed with a light tint), the chosen map
    and the open tab (selected, white), and the stats portrait (portrait).
    """
    size = 16
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tint = {"default": (0, 0, 0, 0), "hover": (120, 200, 255, 40), "pressed": (160, 220, 255, 70), "selected": (0, 0, 0, 0), "portrait": (0, 0, 0, 0)}[state]
    outline = {"default": (*CYAN, 220), "hover": (*BRIGHT, 255), "pressed": (255, 255, 255, 255), "selected": (255, 255, 255, 255), "portrait": (*CYAN, 255)}[state]
    draw.rectangle((0, 0, size - 1, size - 1), fill=tint, outline=outline, width=2)
    return image


def stat_tile() -> Image.Image:
    """A stat's tile on a player's stats: a dim navy box with no lines, so it doesn't look clickable (1x nine-slice)."""
    return Image.new("RGBA", (16, 16), (6, 22, 44, 170))


def toggle(on: bool) -> Image.Image:
    """An on/off switch at 2x (52x26 for 26x13): a square track with a square knob, left (off) or right (on)."""
    width, height = 52, 26
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    fill = (40, 140, 210, 255) if on else (10, 30, 56, 255)
    draw.rectangle((1, 1, width - 2, height - 2), fill=fill, outline=(*(BRIGHT if on else CYAN), 255), width=2)
    knob = (width - 24, 5, width - 6, height - 6) if on else (5, 5, 23, height - 6)
    draw.rectangle(knob, fill=(255, 255, 255, 255) if on else (120, 150, 180, 255))
    return image


def glyphs() -> Image.Image:
    """
    Icons drawn inside text: a 256x256 page of 16x16 cells, character U+E300 onward (menus.ts
    GLYPH). Cell 0 is the player icon; cells 1 and 2 are a setting's bars (the chosen value bright,
    the others dim). The game sizes each cell to the text and trims empty columns. Measured in a
    form: one glyph pixel draws about 1.13 text pixels, and a line's digits cover rows 4 to 9 of the
    cell, so an icon as tall as the text is 6 rows, in rows 4 to 9.
    """
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    draw.rectangle((6, 4, 8, 5), fill=white)  # head
    draw.rectangle((5, 7, 9, 9), fill=white)  # body
    draw.rectangle((16 + 1, 12, 16 + 11, 13), fill=(*BRIGHT, 255))  # bar, chosen
    draw.rectangle((32 + 1, 12, 32 + 11, 13), fill=(50, 80, 110, 255))  # bar, not chosen
    return image


# The back arrow, pixel by pixel (diagonal lines this small come out uneven).
BACK_ARROW = [
    "...............",
    "...............",
    ".......#.......",
    "......##.......",
    ".....##........",
    "....##.........",
    "...###########.",
    "..############.",
    "...###########.",
    "....##.........",
    ".....##........",
    "......##.......",
    ".......#.......",
    "...............",
    "...............",
]


def nav_icon(kind: str, color: tuple[int, int, int]) -> Image.Image:
    """
    The menus' back arrow (top left) and X (top right), 15x15 like vanilla's close button images:
    white, with hover and pressed colors (the X turns red).
    """
    image = Image.new("RGBA", (15, 15), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    fill = (*color, 255)
    if kind == "back":
        for y, row in enumerate(BACK_ARROW):
            for x, cell in enumerate(row):
                if cell == "#":
                    image.putpixel((x, y), fill)
    else:
        draw.line((3, 3, 11, 11), fill=fill, width=3)
        draw.line((3, 11, 11, 3), fill=fill, width=3)
    return image


def editor_panel() -> Image.Image:
    """The editor's side menu background, 16x16 at 1x, nine-slice: near black, a little see-through, a 1 pixel gray border."""
    image = Image.new("RGBA", (16, 16), (22, 22, 24, 236))
    ImageDraw.Draw(image).rectangle((0, 0, 15, 15), outline=(72, 73, 76, 255), width=1)
    return image


# Editor button faces by tone: gray for most, green for Save, red for deleting and removing.
EDITOR_FACES = {
    "gray": {"default": EDITOR_FACE, "hover": (72, 73, 74), "pressed": (36, 37, 38)},
    "save": {"default": EDITOR_GREEN, "hover": (78, 163, 52), "pressed": (44, 100, 28)},
    "danger": {"default": (170, 42, 42), "hover": (204, 56, 56), "pressed": (128, 30, 30)},
}


def editor_button(state: str, tone: str = "gray") -> Image.Image:
    """
    An editor menu button, 16x16 at 1x, nine-slice (4 pixel slices): a flat face with a lighter
    top edge and a darker bottom edge, lighter on hover; pressed swaps the edges so it looks pushed in.
    Gray, green (Save) or red (deleting and removing), all with white text.
    """
    face = EDITOR_FACES[tone][state]
    light = tuple(min(255, c + 40) for c in face)
    dark = (18, 18, 19)
    top, bottom = (dark, light) if state == "pressed" else (light, dark)
    image = Image.new("RGBA", (16, 16), (*face, 255))
    draw = ImageDraw.Draw(image)
    draw.line((0, 0, 15, 0), fill=(*top, 255))
    draw.rectangle((0, 14, 15, 15), fill=(*bottom, 255))
    return image


def editor_switch(on: bool) -> Image.Image:
    """An editor switch at 2x (52x26 for 26x13): a square track with a white knob, green and right when on, gray and left when off."""
    width, height = 52, 26
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((1, 1, width - 2, height - 2), fill=(*(EDITOR_GREEN if on else (88, 89, 92)), 255), outline=(18, 18, 19, 255), width=2)
    knob = (width - 24, 5, width - 6, height - 6) if on else (5, 5, 23, height - 6)
    draw.rectangle(knob, fill=(255, 255, 255, 255) if on else (200, 201, 204, 255))
    return image


def editor_picked() -> Image.Image:
    """The outline on the tool in hand and the picked option, 16x16 at 1x, nine-slice: a 2 pixel white square outline."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((0, 0, 15, 15), outline=(255, 255, 255, 235), width=2)
    return image


def editor_icon(kind: str, color: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """
    The map menu's quick icons, 16x16 (drawn at 64x64 and scaled down): a check mark, Undo and
    Redo (a U-turn arrow, Redo mirrored), and a gear for the map settings. And the editor lobby's: a
    pencil (Open a map, and maps opened in Edit), a plus (New map), a crop mark (worlds opened in
    Select), and a door with an arrow going out (Leave). And
    for every icon row: a person (Players), a house (Back to Lobby), a left arrow (back to the menu a
    sub-menu came from), and a minus (Nudge sides; its plus is New map's).
    """
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    fill = (*color, 255)
    if kind == "check":
        draw.line([(10, 34), (25, 49), (54, 16)], fill=fill, width=9, joint="curve")
    elif kind in ("undo", "redo"):
        draw.line([(22, 18), (40, 18)], fill=fill, width=7)
        draw.arc((24, 18 - 3, 56, 50 + 3), start=-90, end=90, fill=fill, width=7)
        draw.line([(40, 50), (14, 50)], fill=fill, width=7)
        draw.polygon([(6, 18), (24, 4), (24, 32)], fill=fill)
        if kind == "redo":
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    elif kind == "gear":
        center = size / 2
        for y in range(size):
            for x in range(size):
                dx, dy = x + 0.5 - center, y + 0.5 - center
                r = math.hypot(dx, dy)
                outer = 29 if math.cos(8 * math.atan2(dy, dx)) > 0.25 else 22
                if 9 <= r <= outer:
                    image.putpixel((x, y), fill)
    elif kind == "pencil":
        # Pointing down and left: the body, its bare tip, and the eraser end past a small gap.
        draw.line([(19, 45), (45, 19)], fill=fill, width=12)
        draw.polygon([(15, 41), (23, 49), (9, 55)], fill=fill)
        draw.line([(49, 15), (53, 11)], fill=fill, width=12)
    elif kind == "plus":
        draw.rectangle((27, 8, 36, 55), fill=fill)
        draw.rectangle((8, 27, 55, 36), fill=fill)
    elif kind == "crop":
        # Two interlocking L shapes, like the Select tool's.
        draw.rectangle((14, 4, 21, 50), fill=fill)
        draw.rectangle((14, 43, 60, 50), fill=fill)
        draw.rectangle((4, 14, 50, 21), fill=fill)
        draw.rectangle((43, 14, 50, 60), fill=fill)
    elif kind == "leave":
        # A door frame open on the right, and an arrow going out through it.
        draw.line([(36, 16), (36, 8), (10, 8), (10, 56), (36, 56), (36, 48)], fill=fill, width=6, joint="curve")
        draw.line([(22, 32), (48, 32)], fill=fill, width=7)
        draw.polygon([(60, 32), (45, 19), (45, 45)], fill=fill)
    elif kind == "players":
        # A head and shoulders.
        draw.ellipse((21, 6, 43, 28), fill=fill)
        draw.pieslice((8, 34, 56, 82), start=180, end=360, fill=fill)
    elif kind == "house":
        # A roof and walls, with the door cut out.
        draw.polygon([(32, 6), (60, 32), (51, 32), (51, 58), (13, 58), (13, 32), (4, 32)], fill=fill)
        draw.rectangle((27, 40, 37, 58), fill=(0, 0, 0, 0))
    elif kind == "back":
        draw.line([(54, 32), (20, 32)], fill=fill, width=8)
        draw.polygon([(6, 32), (28, 12), (28, 52)], fill=fill)
    elif kind == "minus":
        draw.rectangle((8, 27, 55, 36), fill=fill)
    elif kind == "search":
        # A magnifying glass: a ring, and its handle down and right.
        draw.ellipse((6, 6, 42, 42), outline=fill, width=8)
        draw.line([(37, 37), (56, 56)], fill=fill, width=11)
    elif kind in ("chevron_down", "chevron_up"):
        # A dropdown's arrow: a V pointing down (closed) or up (open).
        points = [(12, 22), (32, 42), (52, 22)] if kind == "chevron_down" else [(12, 42), (32, 22), (52, 42)]
        draw.line(points, fill=fill, width=9, joint="curve")
    return image.resize((16, 16), Image.Resampling.LANCZOS)


def snapshot_icon() -> Image.Image:
    """The Snapshot item's icon, 16x16 like the other editor items: a photo with a sun and hills, in a white frame."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((1, 3, 14, 12), fill=(242, 239, 230, 255))
    draw.rectangle((2, 4, 13, 11), fill=(90, 170, 235, 255))
    draw.rectangle((10, 5, 11, 6), fill=(255, 220, 80, 255))
    draw.polygon([(2, 11), (6, 7), (9, 10), (11, 8), (13, 10), (13, 11)], fill=(70, 150, 60, 255))
    return image


def marker_tool_icon() -> Image.Image:
    """The Game marker tool's item icon, 16x16 like the other editor items: a red flag on a pole."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 1, 5, 14), fill=(200, 200, 205, 255))
    draw.polygon([(6, 1), (14, 4), (6, 8)], fill=(235, 60, 60, 255))
    draw.rectangle((2, 14, 7, 15), fill=(120, 120, 128, 255))
    return image


def snapshot_frame() -> Image.Image:
    """
    The Snapshot view's 16:9 frame, 24x24 at 1x, nine-slice (8 pixel slices): a white L in each
    corner, the edges between them clear, so it stretches to any size with crisp corners.
    """
    image = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 230)
    for x0, y0, dx, dy in ((0, 0, 1, 1), (23, 0, -1, 1), (0, 23, 1, -1), (23, 23, -1, -1)):
        draw.line([(x0, y0), (x0 + 6 * dx, y0)], fill=white, width=2)
        draw.line([(x0, y0), (x0, y0 + 6 * dy)], fill=white, width=2)
    return image


def editor_picked_green() -> Image.Image:
    """The current thumbnail's outline, 16x16 at 1x, nine-slice: a 2 pixel green square outline."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((0, 0, 15, 15), outline=(*EDITOR_GREEN, 255), width=2)
    return image


def loading_dots() -> Image.Image:
    """
    The dots after a loading title (the editor lobby's Loading screen): five frames side by side
    (UI flip books step right), each five 3x3 dots 3 apart with one lit aqua, left to right.
    """
    dot, gap, count = 3, 3, 5
    width = count * dot + (count - 1) * gap
    image = Image.new("RGBA", (width * count, dot), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for frame in range(count):
        for i in range(count):
            x = frame * width + i * (dot + gap)
            draw.rectangle((x, 0, x + dot - 1, dot - 1), fill=(85, 255, 255, 255) if i == frame else (110, 112, 118, 255))
    return image


def select_tool_icon() -> Image.Image:
    """The Select tool's item icon, 16x16 like the other editor items: a crop mark (two interlocking L shapes, white and cyan)."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    white, cyan = (242, 239, 230, 255), (90, 210, 255, 255)
    draw.rectangle((3, 1, 4, 12), fill=white)
    draw.rectangle((3, 11, 14, 12), fill=white)
    draw.rectangle((1, 3, 12, 4), fill=cyan)
    draw.rectangle((11, 3, 12, 14), fill=cyan)
    return image


def camera_head() -> Image.Image:
    """
    A camera marker's texture (32x16, an 8x8x8 head's box layout): a dark gray body, a lens on the
    front (north) face, a viewfinder on top, and a red pixel at 0,0 for its facing line.
    """
    image = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    body, edge = (64, 68, 78, 255), (44, 46, 54, 255)
    for x0, y0 in ((8, 0), (16, 0), (0, 8), (8, 8), (16, 8), (24, 8)):
        draw.rectangle((x0, y0, x0 + 7, y0 + 7), fill=body, outline=edge)
    # The lens, on the front face.
    draw.rectangle((9, 9, 14, 14), fill=(200, 205, 215, 255))
    draw.rectangle((10, 10, 13, 13), fill=(40, 120, 200, 255))
    draw.rectangle((11, 11, 12, 12), fill=(110, 200, 255, 255))
    # A viewfinder bump and a red light on top.
    draw.rectangle((10, 2, 13, 4), fill=(150, 152, 160, 255))
    image.putpixel((14, 1), (230, 50, 50, 255))
    image.putpixel((0, 0), (255, 40, 40, 255))
    return image


def outline_dot() -> Image.Image:
    """The editor's outline dot, 4x4: a white middle (the particle tints it) and a black rim that tinting leaves black."""
    image = Image.new("RGBA", (4, 4), (0, 0, 0, 255))
    ImageDraw.Draw(image).rectangle((1, 1, 2, 2), fill=(255, 255, 255, 255))
    return image


BADGE_CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789"


def badge(character: str) -> Image.Image:
    """
    A player's letter badge (64x64, shown 20x20 in the stats list and 88x88 as the portrait),
    standing in for their head until skins can be shown: a square in a color picked by the
    letter, with the letter on it. "other" (names starting with anything else) shows a "?".
    """
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    index = BADGE_CHARACTERS.find(character)
    hue = (index * 0.27) % 1 if index >= 0 else 0.6
    r, g, b = colorsys.hsv_to_rgb(hue, 0.55, 0.85)
    draw.rectangle((2, 2, size - 3, size - 3), fill=(round(r * 255), round(g * 255), round(b * 255), 255), outline=(*BRIGHT, 255), width=3)
    letter = character.upper() if index >= 0 else "?"
    face = font(40)
    left, top, right, bottom = draw.textbbox((0, 0), letter, font=face)
    draw.text(((size - (right - left)) / 2 - left, (size - (bottom - top)) / 2 - top), letter, font=face, fill=(255, 255, 255, 255))
    return image


def picture(title: str, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """A 16:9 placeholder picture (320x180): a vertical gradient with a big title."""
    width, height = 320, 180
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / (height - 1)
        draw.line((0, y, width, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    face = font(54)
    text_width = draw.textlength(title, font=face)
    draw.text(((width - text_width) / 2, 50), title, font=face, fill=(255, 255, 255))
    return image


def fade_bottom() -> Image.Image:
    """Black, fading in from transparent at the top to dark at the bottom: under text on pictures."""
    image = Image.new("RGBA", (8, 64))
    for y in range(64):
        alpha = round(200 * (y / 63) ** 1.4)
        for x in range(8):
            image.putpixel((x, y), (0, 0, 0, alpha))
    return image


def main() -> None:
    save(clock_icon(), CORE_TEXTURES / "hud" / "clock.png")
    save(skull_icon(), CORE_TEXTURES / "hud" / "skull.png")
    for name, fill in ROUND_FILLS.items():
        save(round_circle(fill), CORE_TEXTURES / "hud" / f"round_{name}.png")

    # Bridges: the hole in each team's color, and the item icons kit pictures are made from.
    for dye, ring in HOLE_DYES.items():
        save(hole_texture(ring), ROOT / "games" / "bridges" / "resource_pack" / "textures" / "minecade" / "bridges" / f"hole_{dye}.png")
    for name, rows in ITEM_ART.items():
        save(item_icon(rows), ROOT / "tools" / "assets" / "items" / f"{name}.png")
    for dye, color in WOOL_DYES.items():
        save(wool_icon(color), ROOT / "tools" / "assets" / "items" / f"{dye}_wool.png")

    logo = blue_logo()
    # The core pack: the lobby's menus and every server's loading screen and pause menu use it.
    save(logo, CORE_TEXTURES / "ui" / "logo.png")
    for name, image in holo_frames(logo).items():
        save(image, LOBBY_TEXTURES / "holo" / f"{name}.png")
    save(holo_beam(), LOBBY_TEXTURES / "holo" / "beam.png")
    save(holo_backdrop(), LOBBY_TEXTURES / "holo" / "backdrop.png")
    # The core pack: the star box and every server's loading screen.
    save(stars(), CORE_TEXTURES / "sky" / "stars.png")
    for level in range(1, 8):
        save(warp(level), LOBBY_TEXTURES / "holo" / f"warp_{level}.png")
    save(Image.new("RGB", (16, 16), (0, 0, 0)), LOBBY_TEXTURES / "holo" / "icon_none.png")

    save(block_side(), LOBBY_TEXTURES / "blocks" / "terminal_side.png")
    for kind in ("corner", "edge", "center"):
        save(block_top(kind), LOBBY_TEXTURES / "blocks" / f"terminal_{kind}.png")

    # Every menu's background (main menu, game grid, game screen).
    save_nineslice(holo_ui_panel(), LOBBY_TEXTURES / "ui" / "holo_panel.png", 24)
    save(holo_scanlines(), LOBBY_TEXTURES / "ui" / "holo_scanlines.png")
    # Every button, and the square outlines.
    for state in ("default", "hover", "pressed"):
        save_nineslice(ui_button(state), LOBBY_TEXTURES / "ui" / f"button_{state}.png", 4)
        save_nineslice(ui_outline(state), LOBBY_TEXTURES / "ui" / f"tile_map_{state}.png", 4)
    save_nineslice(ui_outline("selected"), LOBBY_TEXTURES / "ui" / "tile_map_selected.png", 4)
    for kind in ("play", "stats"):
        save(ui_icon(kind), LOBBY_TEXTURES / "ui" / f"icon_{kind}.png")

    # The game grid and game screen.
    save(Image.new("RGBA", (8, 8), (0, 0, 0, 150)), LOBBY_TEXTURES / "ui" / "tile_dim.png")
    save(toggle(True), LOBBY_TEXTURES / "ui" / "toggle_on.png")
    save(toggle(False), LOBBY_TEXTURES / "ui" / "toggle_off.png")
    save(glyphs(), LOBBY_FONT / "glyph_E3.png")

    # Every menu's back arrow and X.
    for state, back, close in (("default", (255, 255, 255), (255, 255, 255)), ("hover", BRIGHT, (235, 64, 64)), ("pressed", (140, 190, 220), (160, 30, 30))):
        save(nav_icon("back", back), LOBBY_TEXTURES / "ui" / f"back_{state}.png")
        save(nav_icon("close", close), LOBBY_TEXTURES / "ui" / f"close_{state}.png")

    # The stats screens: an outline for the open tab, the portrait's frame, stat tiles, and player badges.
    save_nineslice(ui_outline("selected"), LOBBY_TEXTURES / "ui" / "tab_selected.png", 4)
    save_nineslice(ui_outline("portrait"), LOBBY_TEXTURES / "ui" / "portrait_frame.png", 4)
    save_nineslice(stat_tile(), LOBBY_TEXTURES / "ui" / "stat_tile.png", 4)
    for character in [*BADGE_CHARACTERS, "other"]:
        save(badge(character), LOBBY_TEXTURES / "badges" / f"{character}.png")
    save(fade_bottom(), LOBBY_TEXTURES / "ui" / "fade_bottom.png")
    save(picture("No preview", (40, 52, 70), (18, 24, 34)), LOBBY_TEXTURES / "ui" / "map_placeholder.png")
    save(picture("No picture", (60, 50, 90), (24, 20, 40)), LOBBY_TEXTURES / "ui" / "game_placeholder.png")

    # The map editor: its side menus, and the red line a marker draws toward its saved facing.
    save_nineslice(editor_panel(), EDITOR_TEXTURES / "minecade" / "editor" / "panel.png", 4)
    save(Image.new("RGBA", (4, 1), (72, 73, 76, 255)), EDITOR_TEXTURES / "minecade" / "editor" / "rule.png")
    for state in ("default", "hover", "pressed"):
        save_nineslice(editor_button(state), EDITOR_TEXTURES / "minecade" / "editor" / f"button_{state}.png", 4)
        save_nineslice(editor_button(state, "save"), EDITOR_TEXTURES / "minecade" / "editor" / f"save_{state}.png", 4)
        save_nineslice(editor_button(state, "danger"), EDITOR_TEXTURES / "minecade" / "editor" / f"danger_{state}.png", 4)
    save_nineslice(editor_picked(), EDITOR_TEXTURES / "minecade" / "editor" / "picked.png", 4)
    for kind, name in (("check", "check"), ("undo", "undo"), ("redo", "redo"), ("gear", "settings")):
        save(editor_icon(kind), EDITOR_TEXTURES / "minecade" / "editor" / f"icon_{name}.png")
    save(editor_icon("check", (110, 220, 90)), EDITOR_TEXTURES / "minecade" / "editor" / "icon_check_done.png")
    for kind, name in (("pencil", "edit"), ("plus", "new"), ("crop", "select"), ("leave", "leave"), ("players", "players"), ("house", "lobby"), ("back", "back"), ("minus", "minus")):
        save(editor_icon(kind), EDITOR_TEXTURES / "minecade" / "editor" / f"icon_{name}.png")
    save(loading_dots(), EDITOR_TEXTURES / "minecade" / "editor" / "loading_dots.png")
    save(outline_dot(), EDITOR_TEXTURES / "particle" / "outline.png")
    save(select_tool_icon(), EDITOR_TEXTURES / "items" / "select_tool.png")
    save(editor_switch(True), EDITOR_TEXTURES / "minecade" / "editor" / "switch_on.png")
    save(editor_switch(False), EDITOR_TEXTURES / "minecade" / "editor" / "switch_off.png")
    for state, color in (("default", (255, 255, 255)), ("hover", (235, 64, 64)), ("pressed", (160, 30, 30))):
        save(nav_icon("close", color), EDITOR_TEXTURES / "minecade" / "editor" / f"close_{state}.png")
    # The back arrow, drawn like the X with no face: white, lighter when hovered.
    for state, color in (("default", (255, 255, 255)), ("hover", BRIGHT), ("pressed", (140, 190, 220))):
        save(nav_icon("back", color), EDITOR_TEXTURES / "minecade" / "editor" / f"back_{state}.png")
    # The editor lobby's Search link, the Snapshot item, its 16:9 frame, and the current thumbnail's outline.
    save(editor_icon("search"), EDITOR_TEXTURES / "minecade" / "editor" / "icon_search.png")
    save(snapshot_icon(), EDITOR_TEXTURES / "items" / "snapshot.png")
    save(marker_tool_icon(), EDITOR_TEXTURES / "items" / "marker_tool.png")
    # A dropdown's arrow (the Game marker tool's Marker list, a Team list), closed and open.
    for kind in ("chevron_down", "chevron_up"):
        save(editor_icon(kind), EDITOR_TEXTURES / "minecade" / "editor" / f"icon_{kind}.png")
    save_nineslice(snapshot_frame(), EDITOR_TEXTURES / "minecade" / "editor" / "snapshot_frame.png", 8)
    save_nineslice(editor_picked_green(), EDITOR_TEXTURES / "minecade" / "editor" / "picked_green.png", 4)
    save(Image.new("RGB", (16, 16), (255, 40, 40)), EDITOR_TEXTURES / "entity" / "editor_marker_facing.png")
    # The core pack: locked items show no red or yellow corner on any server (kit items, the editor's map menu).
    for name in ("item_lock_red", "item_lock_yellow"):
        save(Image.new("RGBA", (16, 16), (0, 0, 0, 0)), CORE_TEXTURES.parent / "ui" / f"{name}.png")
    # Markers by kind (lists.ts MARKER_KINDS): spawns orange, the spectator spawn gray, the queue spawn
    # aqua, team spawns green, points yellow, cameras magenta.
    for kind, color in (("", (255, 170, 30)), ("_spectator", (175, 185, 205)), ("_queue", (60, 200, 255)), ("_team", (90, 220, 90)), ("_point", (255, 230, 60))):
        save(Image.new("RGB", (16, 16), color), EDITOR_TEXTURES / "entity" / f"editor_marker{kind}.png")
    save(camera_head(), EDITOR_TEXTURES / "entity" / "editor_marker_camera.png")
    # The aim cursor: a glowing yellow block outline, or a see-through mannequin where a spawn would go.
    save(Image.new("RGB", (16, 16), (255, 225, 90)), EDITOR_TEXTURES / "entity" / "editor_cursor_block.png")
    save(Image.new("RGBA", (16, 16), (230, 240, 255, 110)), EDITOR_TEXTURES / "entity" / "editor_cursor_point.png")

    save(picture("PROBE", (60, 70, 90), (25, 30, 40)), ROOT / "games" / "probe" / "icon.png")
    save(picture("SUMO", (190, 60, 60), (70, 20, 20)), ROOT / "games" / "sumo" / "icon.png")
    save(picture("QUIVER", (60, 140, 90), (20, 55, 35)), ROOT / "games" / "quiver" / "icon.png")
    save(picture("BRIDGES", (70, 90, 200), (150, 35, 40)), ROOT / "games" / "bridges" / "icon.png")


if __name__ == "__main__":
    main()

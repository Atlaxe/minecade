"""Generates Minecade's placeholder UI images with Pillow, then commit the PNGs it writes:

    python tools/assets/make-assets.py            writes only images that don't exist yet
    python tools/assets/make-assets.py --force    regenerates every image (overwrites edits!)

The images are meant to be redrawn by hand; by default this never touches an existing file.

Outputs:
    packages/minigame-core/resource_pack/textures/minecade/hud/clock.png   HUD match clock icon
    lobby/resource_pack/textures/minecade/ui/...                             holographic menu art
    lobby/resource_pack/textures/minecade/holo/...                           hologram frames, beam
    lobby/resource_pack/textures/minecade/blocks/...                         terminal block faces
    lobby/resource_pack/font/glyph_E3.png                                    icons drawn inside text (the player icon)
    games/<id>/icon.png                                                      16:9 game pictures (Probe, Sumo)

Fonts come from Windows (Bahnschrift, else Consolas Bold); they only matter when regenerating.
The logo source is tools/assets/source/minecade-title.png (the orange original).
"""

import colorsys
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CORE_TEXTURES = ROOT / "packages" / "minigame-core" / "resource_pack" / "textures" / "minecade"
LOBBY_TEXTURES = ROOT / "lobby" / "resource_pack" / "textures" / "minecade"
LOBBY_FONT = ROOT / "lobby" / "resource_pack" / "font"
LOGO_SOURCE = ROOT / "tools" / "assets" / "source" / "minecade-title.png"

# Holographic palette: retro blues.
CYAN = (90, 210, 255)
BRIGHT = (190, 240, 255)
DEEP = (20, 70, 140)


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
    Behind the hologram's panels: see-through black (about 60%), drawn with an alpha-blended
    material, so a bright sky behind the panels is darkened and the glowing panels stand out.
    """
    return Image.new("RGBA", (16, 16), (0, 0, 0, 150))


def stars() -> Image.Image:
    """
    The star box's walls and floor (lobby map.json "stars"): stars on black, drawn additively, so
    black shows nothing and only the stars add light. A fixed seed keeps it the same every run.
    Mostly faint single pixels, some brighter ones, a few bright ones with a small cross of glow,
    and some tinted blue.
    """
    rng = random.Random(7)
    image = Image.new("RGB", (512, 512), (0, 0, 0))

    def put(x: int, y: int, color: tuple[int, int, int]) -> None:
        r, g, b = image.getpixel((x % 512, y % 512))
        image.putpixel((x % 512, y % 512), (max(r, color[0]), max(g, color[1]), max(b, color[2])))

    for _ in range(1800):
        x, y = rng.randrange(512), rng.randrange(512)
        roll = rng.random()
        level = rng.randint(60, 130) if roll < 0.8 else rng.randint(150, 220) if roll < 0.97 else rng.randint(230, 255)
        tint = rng.random()
        color = (round(level * 0.7), round(level * 0.85), level) if tint < 0.2 else (level, level, level)
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

    logo = blue_logo()
    save(logo, LOBBY_TEXTURES / "ui" / "logo.png")
    for name, image in holo_frames(logo).items():
        save(image, LOBBY_TEXTURES / "holo" / f"{name}.png")
    save(holo_beam(), LOBBY_TEXTURES / "holo" / "beam.png")
    save(holo_backdrop(), LOBBY_TEXTURES / "holo" / "backdrop.png")
    save(stars(), LOBBY_TEXTURES / "holo" / "stars.png")
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

    save(picture("PROBE", (60, 70, 90), (25, 30, 40)), ROOT / "games" / "probe" / "icon.png")
    save(picture("SUMO", (190, 60, 60), (70, 20, 20)), ROOT / "games" / "sumo" / "icon.png")


if __name__ == "__main__":
    main()

"""Generates Minecade's UI images with Pillow. Rerun after changing anything here, then commit
the PNGs it writes:

    python tools/assets/make-assets.py

Outputs:
    packages/minigame-core/resource_pack/textures/minecade/hud/clock.png   HUD match clock icon
    lobby/resource_pack/textures/minecade/ui/...                             holographic menu art
    lobby/resource_pack/textures/minecade/holo/...                           hologram screens, beam
    lobby/resource_pack/textures/minecade/blocks/...                         terminal block faces

Fonts come from Windows (Bahnschrift, else Consolas Bold); they only matter when regenerating.
The logo source is tools/assets/source/minecade-title.png (the orange original).
"""

import colorsys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CORE_TEXTURES = ROOT / "packages" / "minigame-core" / "resource_pack" / "textures" / "minecade"
LOBBY_TEXTURES = ROOT / "lobby" / "resource_pack" / "textures" / "minecade"
LOGO_SOURCE = ROOT / "tools" / "assets" / "source" / "minecade-title.png"

# Holographic palette: retro blues.
CYAN = (90, 210, 255)
BRIGHT = (190, 240, 255)
DEEP = (20, 70, 140)
NAVY = (8, 20, 40)


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    print(f"wrote {path.relative_to(ROOT).as_posix()}")


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


def centered_text(draw: ImageDraw.ImageDraw, y: int, text: str, size: int, fill) -> None:
    face = font(size)
    width = draw.textlength(text, font=face)
    draw.text(((HOLO - width) / 2, y), text, font=face, fill=fill)


def holo_button(draw: ImageDraw.ImageDraw, box, label: str, icon: str, lit: bool) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=18, fill=(30, 110, 190) if lit else (6, 30, 60), outline=BRIGHT if lit else CYAN, width=4)
    cx = (x0 + x1) // 2
    color = (255, 255, 255) if lit else CYAN
    if icon == "play":
        draw.polygon([(cx - 22, y0 + 34), (cx - 22, y0 + 86), (cx + 26, y0 + 60)], fill=color)
    else:
        for i, height in enumerate((26, 44, 60)):
            left = cx - 33 + i * 24
            draw.rectangle((left, y0 + 90 - height, left + 16, y0 + 90), fill=color)
    face = font(40)
    width = draw.textlength(label, font=face)
    draw.text((cx - width / 2, y1 - 64), label, font=face, fill=color)


def holo_screens(logo: Image.Image) -> dict[str, Image.Image]:
    idle = holo_base()
    paste_logo(idle, logo, 120, 440)
    draw = ImageDraw.Draw(idle)
    centered_text(draw, 300, "TAP THE TERMINAL", 44, CYAN)
    draw.line((150, 370, HOLO - 150, 370), fill=DEEP, width=3)

    screens = {"idle": idle}
    for name, lit in (("main", None), ("main_play", "play"), ("main_stats", "stats")):
        image = holo_base()
        paste_logo(image, logo, 60, 420)
        draw = ImageDraw.Draw(image)
        holo_button(draw, (60, 230, 236, 450), "PLAY", "play", lit == "play")
        holo_button(draw, (276, 230, 452, 450), "STATS", "stats", lit == "stats")
        screens[name] = image
    return screens


def holo_beam() -> Image.Image:
    """The projection cone: brightest at the bottom center, fading up and out."""
    width, height = 128, 256
    image = Image.new("RGB", (width, height), (0, 0, 0))
    px = image.load()
    for y in range(height):
        rise = 1 - y / (height - 1)  # 1 at the top row of the texture
        spread = 6 + (width / 2 - 6) * rise
        for x in range(width):
            off = abs(x - (width - 1) / 2) / spread
            if off <= 1:
                strength = (1 - off) ** 1.6 * (0.25 + 0.75 * (1 - rise))
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


def ui_panel() -> Image.Image:
    """The menu background at 2x (600x392 for a 300x196 panel): translucent navy, glowing frame."""
    width, height = 600, 392
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2, 2, width - 3, height - 3), radius=16, fill=(*NAVY, 235))
    for y in range(8, height - 8, 6):
        draw.line((10, y, width - 11, y), fill=(14, 32, 60, 235))
    draw.rounded_rectangle((2, 2, width - 3, height - 3), radius=16, outline=(*CYAN, 255), width=3)
    arm = 34
    for cx, cy, dx, dy in ((12, 12, 1, 1), (width - 13, 12, -1, 1), (12, height - 13, 1, -1), (width - 13, height - 13, -1, -1)):
        draw.line((cx, cy, cx + dx * arm, cy), fill=(*BRIGHT, 255), width=4)
        draw.line((cx, cy, cx, cy + dy * arm), fill=(*BRIGHT, 255), width=4)
    return image


def ui_tile(state: str) -> Image.Image:
    """A menu tile at 2x (220x148 for 110x74): default, hover or pressed."""
    width, height = 220, 148
    fill = {"default": (10, 36, 70, 230), "hover": (24, 80, 140, 240), "pressed": (40, 120, 190, 250)}[state]
    outline = {"default": CYAN, "hover": BRIGHT, "pressed": (255, 255, 255)}[state]
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((2, 2, width - 3, height - 3), radius=14, fill=fill, outline=(*outline, 255), width=4)
    return image


def ui_icon(kind: str) -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = (*BRIGHT, 255)
    if kind == "play":
        draw.polygon([(18, 10), (18, 54), (52, 32)], fill=color)
    else:
        for i, height in enumerate((20, 34, 48)):
            left = 8 + i * 18
            draw.rectangle((left, 56 - height, left + 12, 56), fill=color)
    return image


def main() -> None:
    save(clock_icon(), CORE_TEXTURES / "hud" / "clock.png")

    logo = blue_logo()
    save(logo, LOBBY_TEXTURES / "ui" / "logo.png")
    for name, image in holo_screens(logo).items():
        save(image, LOBBY_TEXTURES / "holo" / f"{name}.png")
    save(holo_beam(), LOBBY_TEXTURES / "holo" / "beam.png")

    save(block_side(), LOBBY_TEXTURES / "blocks" / "terminal_side.png")
    for kind in ("corner", "edge", "center"):
        save(block_top(kind), LOBBY_TEXTURES / "blocks" / f"terminal_{kind}.png")

    save(ui_panel(), LOBBY_TEXTURES / "ui" / "panel.png")
    for state in ("default", "hover", "pressed"):
        save(ui_tile(state), LOBBY_TEXTURES / "ui" / f"tile_{state}.png")
    for kind in ("play", "stats"):
        save(ui_icon(kind), LOBBY_TEXTURES / "ui" / f"icon_{kind}.png")


if __name__ == "__main__":
    main()

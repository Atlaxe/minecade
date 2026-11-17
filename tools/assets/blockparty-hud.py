"""Block Party's hotbar art (games/blockparty/resource_pack/textures/blockparty/hud/): a slot, the
selected slot's frame, and an icon for everything the bar holds (icon_<id>.png, one per BAR_ICONS id
in games/blockparty/behavior_pack/scripts/bar-codes.ts), drawn at twice the HUD's pixel size so the
edges stay smooth. The bar is the pack's own (ui/blockparty_hud.json). Stand-ins until the game has
its art. Rerun after changing the art:
    python tools/assets/blockparty-hud.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "games" / "blockparty" / "resource_pack" / "textures" / "blockparty" / "hud"
SCALE = 2

OUTLINE = (27, 20, 70, 255)
TOP = (104, 76, 224, 235)
BOTTOM = (58, 40, 150, 235)
SHINE = (170, 150, 255, 200)
GOLD = (255, 210, 63, 255)
GOLD_DARK = (176, 120, 20, 255)


def rounded(draw: ImageDraw.ImageDraw, box, radius, **kwargs) -> None:
    draw.rounded_rectangle(box, radius=radius, **kwargs)


def slot() -> Image.Image:
    """A 20x22 slot: an outlined rounded tile, light at the top and dark at the bottom."""
    w, h = 20 * SCALE, 22 * SCALE
    image = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    inset = 1 * SCALE
    for y in range(h):
        t = y / (h - 1)
        color = tuple(round(TOP[i] * (1 - t) + BOTTOM[i] * t) for i in range(4))
        ImageDraw.Draw(image).line([(0, y), (w, y)], fill=color)
    mask = Image.new("L", (w, h), 0)
    rounded(ImageDraw.Draw(mask), (inset, inset, w - 1 - inset, h - 1 - inset), 4 * SCALE, fill=255)
    tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    tile.paste(image, mask=mask)
    draw = ImageDraw.Draw(tile)
    rounded(draw, (inset, inset, w - 1 - inset, h - 1 - inset), 4 * SCALE, outline=OUTLINE, width=SCALE)
    draw.line([(inset + 4 * SCALE, inset + 2 * SCALE), (w - 1 - inset - 4 * SCALE, inset + 2 * SCALE)], fill=SHINE, width=SCALE)
    return tile


def selected() -> Image.Image:
    """A 24x24 gold frame around the selected slot, clear inside."""
    w = h = 24 * SCALE
    image = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rounded(draw, (0, 0, w - 1, h - 1), 6 * SCALE, outline=GOLD_DARK, width=SCALE)
    rounded(draw, (SCALE, SCALE, w - 1 - SCALE, h - 1 - SCALE), 5 * SCALE, outline=GOLD, width=2 * SCALE)
    return image


INK = (30, 24, 40, 255)
WHITE = (245, 245, 250, 255)


def die(face: tuple, pips: int, pip=INK) -> Image.Image:
    """A die seen straight on: a rounded square in `face` with `pips` dots (1 to 6)."""
    size = 16 * SCALE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rounded(draw, (2, 2, size - 3, size - 3), 4 * SCALE, fill=face, outline=INK, width=SCALE)
    spots = {
        1: [(0.5, 0.5)],
        2: [(0.3, 0.3), (0.7, 0.7)],
        3: [(0.28, 0.28), (0.5, 0.5), (0.72, 0.72)],
        4: [(0.3, 0.3), (0.7, 0.3), (0.3, 0.7), (0.7, 0.7)],
        5: [(0.28, 0.28), (0.72, 0.28), (0.5, 0.5), (0.28, 0.72), (0.72, 0.72)],
        6: [(0.3, 0.26), (0.7, 0.26), (0.3, 0.5), (0.7, 0.5), (0.3, 0.74), (0.7, 0.74)],
    }[pips]
    r = 1.6 * SCALE
    for fx, fy in spots:
        x, y = fx * size, fy * size
        draw.ellipse((x - r, y - r, x + r, y + r), fill=pip)
    return image


def icon(kind: str) -> Image.Image:
    """A 16x16 icon for the bar (drawn at twice that)."""
    size = 16 * SCALE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if kind == "die":
        return die(WHITE, 5)
    if kind == "slow_die":
        return die((150, 205, 245, 255), 3)
    if kind == "golden_die":
        return die((250, 205, 60, 255), 6, (120, 70, 10, 255))
    if kind == "dice":
        small = die(WHITE, 3).resize((11 * SCALE, 11 * SCALE), Image.Resampling.LANCZOS)
        back = die((200, 200, 210, 255), 2).resize((11 * SCALE, 11 * SCALE), Image.Resampling.LANCZOS)
        image.alpha_composite(back, (5 * SCALE, 0))
        image.alpha_composite(small, (0, 5 * SCALE))
        return image
    if kind == "items":
        # A sack tied at the top.
        draw.ellipse((3 * SCALE, 5 * SCALE, 13 * SCALE, 15 * SCALE), fill=(170, 110, 60, 255), outline=INK, width=SCALE)
        draw.polygon([(5 * SCALE, 6 * SCALE), (8 * SCALE, 2 * SCALE), (11 * SCALE, 6 * SCALE)], fill=(150, 95, 50, 255), outline=INK)
        draw.line([(5 * SCALE, 6 * SCALE), (11 * SCALE, 6 * SCALE)], fill=(250, 205, 60, 255), width=SCALE)
    elif kind == "tests":
        # A gear.
        center = size / 2
        for y in range(size):
            for x in range(size):
                dx, dy = x + 0.5 - center, y + 0.5 - center
                r = math.hypot(dx, dy)
                outer = 7 * SCALE if math.cos(8 * math.atan2(dy, dx)) > 0.2 else 5.5 * SCALE
                if 2.4 * SCALE <= r <= outer:
                    image.putpixel((x, y), (220, 220, 230, 255))
    elif kind == "back":
        draw.line([(13 * SCALE, 8 * SCALE), (6 * SCALE, 8 * SCALE)], fill=WHITE, width=3 * SCALE)
        draw.polygon([(2 * SCALE, 8 * SCALE), (8 * SCALE, 3 * SCALE), (8 * SCALE, 13 * SCALE)], fill=WHITE)
    elif kind == "stone_totem":
        # Three stacked stones, a face on the top one.
        for i, y in enumerate((10, 6, 2)):
            shade = (150 - i * 10, 150 - i * 10, 158 - i * 10, 255)
            draw.rectangle((4 * SCALE, y * SCALE, 12 * SCALE, (y + 4) * SCALE - 1), fill=shade, outline=INK, width=SCALE)
        draw.rectangle((6 * SCALE, 3 * SCALE, 7 * SCALE, 4 * SCALE), fill=INK)
        draw.rectangle((9 * SCALE, 3 * SCALE, 10 * SCALE, 4 * SCALE), fill=INK)
    elif kind == "lightning":
        draw.polygon([(9 * SCALE, 1 * SCALE), (3 * SCALE, 9 * SCALE), (8 * SCALE, 9 * SCALE), (6 * SCALE, 15 * SCALE), (13 * SCALE, 6 * SCALE), (8 * SCALE, 6 * SCALE)], fill=(250, 225, 60, 255), outline=INK)
    elif kind == "glove":
        # A boxing glove: the fist, the thumb, and the cuff.
        draw.ellipse((3 * SCALE, 2 * SCALE, 13 * SCALE, 11 * SCALE), fill=(215, 50, 45, 255), outline=INK, width=SCALE)
        draw.ellipse((1 * SCALE, 6 * SCALE, 6 * SCALE, 11 * SCALE), fill=(195, 40, 38, 255), outline=INK, width=SCALE)
        draw.rectangle((5 * SCALE, 11 * SCALE, 11 * SCALE, 15 * SCALE), fill=WHITE, outline=INK, width=SCALE)
    return image


ICONS = ("items", "dice", "tests", "back", "die", "slow_die", "golden_die", "stone_totem", "lightning", "glove")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    slot().save(OUT / "slot.png", optimize=True)
    selected().save(OUT / "selected.png", optimize=True)
    for kind in ICONS:
        icon(kind).save(OUT / f"icon_{kind}.png", optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

"""Block Party's hotbar art (games/blockparty/resource_pack/textures/blockparty/hud/): a slot and the
selected slot's frame, drawn at twice the HUD's pixel size so the rounded corners stay smooth. The
hotbar itself is vanilla's, restyled by the pack's ui/hud_screen.json. Rerun after changing the art:
    python tools/assets/blockparty-hud.py
"""
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


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    slot().save(OUT / "slot.png", optimize=True)
    selected().save(OUT / "selected.png", optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

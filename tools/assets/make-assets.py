"""Generates Minecade's UI images with Pillow. Rerun after changing anything here, then commit
the PNGs it writes:

    python tools/assets/make-assets.py

Outputs:
    packages/minigame-core/resource_pack/textures/minecade/hud/clock.png   HUD match clock icon
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CORE_TEXTURES = ROOT / "packages" / "minigame-core" / "resource_pack" / "textures" / "minecade"


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)
    print(f"wrote {path.relative_to(ROOT).as_posix()}")


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


def main() -> None:
    save(clock_icon(), CORE_TEXTURES / "hud" / "clock.png")


if __name__ == "__main__":
    main()

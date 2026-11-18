"""Block Party's clear 16x16 item texture (games/blockparty/resource_pack/textures/blockparty/items/
blank.png) for the bar's items, so nothing shows in the player's hand. (The pack's own hotbar art is
gone: the hotbar is vanilla's again, shown only in minigames.) Rerun after changing it:
    python tools/assets/blockparty-hud.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ITEMS = ROOT / "games" / "blockparty" / "resource_pack" / "textures" / "blockparty" / "items"


def main() -> None:
    ITEMS.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(ITEMS / "blank.png", optimize=True)


if __name__ == "__main__":
    main()

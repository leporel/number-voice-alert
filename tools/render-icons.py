"""Renders the extension icon: a dark bold "V" on the yellow rounded square used as the popup logo.

Usage: python tools/render-icons.py   (requires Pillow and Windows fonts; writes to icons/)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
FONT = r"C:\Windows\Fonts\seguibl.ttf"  # Segoe UI Black
BASE = 1024  # drawn large, then downscaled for clean edges
SIZES = (16, 32, 48, 128)
ACCENT = (255, 221, 45, 255)
TEXT = (17, 17, 17, 255)


def render() -> Image.Image:
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, BASE - 1, BASE - 1), radius=BASE * 0.22, fill=ACCENT)
    font = ImageFont.truetype(FONT, int(BASE * 0.78))
    left, top, right, bottom = draw.textbbox((0, 0), "V", font=font)
    x = (BASE - (right - left)) / 2 - left
    y = (BASE - (bottom - top)) / 2 - top
    draw.text((x, y), "V", font=font, fill=TEXT)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    big = render()
    for size in SIZES:
        big.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)


if __name__ == "__main__":
    main()

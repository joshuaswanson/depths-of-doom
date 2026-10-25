"""Convert the title art and HUD icons in public/ to WebP, keeping transparency, and drop the PNGs.

    uv run --with pillow scripts/optimize_images.py
"""
import pathlib

from PIL import Image

PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "public"

for png in [p for p in [PUBLIC / "logo.png", PUBLIC / "badge.png", *sorted((PUBLIC / "icons").glob("*.png"))] if p.exists()]:
    out = png.with_suffix(".webp")
    Image.open(png).save(out, "WEBP", quality=88, method=6)
    print(f"{png.name:16} {png.stat().st_size // 1024:6}K -> {out.stat().st_size // 1024:5}K")
    png.unlink()

# Web copies of the Poly Haven snow textures (CC0) kept in art/textures, for the polar ice.
#   uv run --with pillow python scripts/snow_textures.py
from PIL import Image

for src, name in [('snow_02', 'snow_soft'), ('snow_01', 'snow_wind')]:
    Image.open(f'art/textures/{src}_diff_1k.jpg').convert('L').save(f'public/textures/{name}_albedo.webp', quality=88)
    Image.open(f'art/textures/{src}_nor_gl_1k.jpg').convert('RGB').save(f'public/textures/{name}_normal.webp', quality=80)

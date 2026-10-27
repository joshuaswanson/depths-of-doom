# Tiling ice textures for the polar bergs, floes and pack ice.
#   uv run --with numpy --with pillow python scripts/ice_textures.py
# ice_normals.webp: RG is the normal of melt scallops, BA the normal of fine grain and cracks.
# ice_detail.webp: R scallop height, G crack lines, B broad mottling.
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:N, 0:N] / N


def spectral(power, low=1, high=N // 2):
    """Tiling noise with amplitude falling off as frequency ** -power, normalised to 0..1."""
    f = np.fft.fftfreq(N) * N
    fx, fy = np.meshgrid(f, f)
    r = np.hypot(fx, fy)
    amp = np.where((r >= low) & (r <= high), np.maximum(r, 1) ** -power, 0)
    phase = np.exp(2j * np.pi * rng.random((N, N)))
    n = np.real(np.fft.ifft2(amp * phase))
    return (n - n.min()) / (n.max() - n.min())


def scallops(cells, wx, wy):
    """Distance to the nearest of a jittered grid of points, wrapping at the edges: dishes with ridges between.
    The sample point is pushed about by (wx, wy) so the rims wobble."""
    g = np.arange(cells)
    px, py = np.meshgrid(g, g)
    px = ((px + 0.15 + rng.random(px.shape) * 0.7) / cells).ravel()
    py = ((py + 0.15 + rng.random(py.shape) * 0.7) / cells).ravel()
    best = np.full((N, N), 9.0)
    for x, y in zip(px, py):
        dx = np.abs((xx + wx) % 1 - x)
        dy = np.abs((yy + wy) % 1 - y)
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        best = np.minimum(best, dx * dx + dy * dy)
    d = np.sqrt(best) * cells
    return np.clip(d / 0.75, 0, 1) ** 1.6


# Scallops of two sizes, wobbled so their rims are not perfect arcs.
wx = (spectral(2.2, 2, 24) - 0.5) * 0.06
wy = (spectral(2.2, 2, 24) - 0.5) * 0.06
scallop = 0.65 * scallops(7, wx, wy) + 0.35 * scallops(13, wx * 0.6, wy * 0.6)
scallop = 0.85 * scallop + 0.15 * spectral(1.6, 8, 120)
scallop = (scallop - scallop.min()) / (scallop.max() - scallop.min())

ridged = 1 - np.abs(spectral(2.6, 2, 12) * 2 - 1)
cracks = np.clip((ridged - 0.93) / 0.07, 0, 1) ** 1.3
grain = spectral(1.1, 16, N // 2)
mottle = spectral(2.4, 1, 16)


def normal_xy(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(dx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n[..., 0], n[..., 1]


sx, sy = normal_xy(scallop, 22)
fine = grain * 0.7 + mottle * 0.3 - cracks * 0.6
gx, gy = normal_xy(fine, 14)


def byte(v):
    return np.clip(v * 255 + 0.5, 0, 255).astype(np.uint8)


normals = np.stack([byte(sx * 0.5 + 0.5), byte(sy * 0.5 + 0.5), byte(gx * 0.5 + 0.5), byte(gy * 0.5 + 0.5)], -1)
Image.fromarray(normals, 'RGBA').save('public/textures/ice_normals.webp', lossless=True, method=6)
detail = np.stack([byte(scallop), byte(cracks), byte(mottle)], -1)
Image.fromarray(detail, 'RGB').save('public/textures/ice_detail.webp', lossless=True, method=6)

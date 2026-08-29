#!/usr/bin/env python3
"""
P5 — chopped landing bake (RENDER-PLAN P5, reviewer order item 99, iter 99).

Builds a TILING procedural "chopped landing" snow surface modelled on the
footage (reference/frames/IMG_7841 landing frames, IMG_3396) and writes three
1024x1024 tiles into assets/:

  landing_chop_albedo.png  — sRGB albedo; snow stays >= 0.85; loose clods and
                             pushed snow read slightly brighter, the furrow
                             troughs take a faint cool blue (shadow comes from
                             the normal map, not dark paint).
  landing_chop_normal.png  — tangent-space normal (OpenGL +Y up, the Babylon
                             convention) derived from the height field.
  landing_chop_height.png  — linear 0..1 height in RGB, tile = 8 m, so game.js
                             can displace the corridor ribbon's landing zone
                             vertices downward (clods in silhouette, not just
                             in shading).

Everything is periodic in u and v (lattice noise wraps, furrow count integral,
clods wrap across tile edges), so the tile repeats with zero seam. The script
logs the clod size distribution, the amplitude histogram and the measured seam
error (height at u=0 vs u=W).
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakeutil import write_png

W = 1024                      # texels per side
TILE_M = 8.0                  # metres of terrain per tile
M_PER_TEXEL = TILE_M / W
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')

rng = np.random.default_rng(20260829)


# ── periodic value noise (lattice wraps at GRID points over the tile) ───────
def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def periodic_noise(grid, freq, seed):
    """Value noise on a grid-periodic lattice; freq = lattice cells per tile."""
    r = np.random.default_rng(seed)
    lattice = r.random((freq, freq)).astype(np.float64)
    u = np.linspace(0.0, freq, W, endpoint=False)
    v = np.linspace(0.0, freq, W, endpoint=False)
    iu = np.floor(u).astype(int) % freq
    iv = np.floor(v).astype(int) % freq
    fu = _smooth(u - np.floor(u))
    fv = _smooth(v - np.floor(v))
    iu1 = (iu + 1) % freq
    iv1 = (iv + 1) % freq
    a = lattice[np.ix_(iv, iu)]
    b = lattice[np.ix_(iv, iu1)]
    c = lattice[np.ix_(iv1, iu)]
    d = lattice[np.ix_(iv1, iu1)]
    fu2 = fu[None, :]
    fv2 = fv[:, None]
    return (a * (1 - fu2) + b * fu2) * (1 - fv2) + (c * (1 - fu2) + d * fu2) * fv2


def fbm(seed, octaves=4, base_freq=4, gain=0.5):
    out = np.zeros((W, W))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        out = out + amp * periodic_noise(None, base_freq * (2 ** o), seed + o * 101)
        norm += amp
        amp *= gain
    return out / norm


# ── height field (metres; ~0 at the mean surface, positive = proud clod) ────
UU, VV = np.meshgrid(np.linspace(0.0, TILE_M, W, endpoint=False),
                     np.linspace(0.0, TILE_M, W, endpoint=False))

height = np.zeros((W, W))

# 1. base chop: loose broken blocks, 10-30 cm across -> octaves around 1.5 m
#    and 0.35 m wavelength, a few cm each.
height += 0.020 * (fbm(11, octaves=3, base_freq=5, gain=0.55) - 0.5) * 2.0
height += 0.010 * (fbm(29, octaves=2, base_freq=23, gain=0.5) - 0.5) * 2.0

# 2. chop ridges left by the tiller: soft ridges running down-slope (along v),
#    ~0.5 m apart, wandering slightly.
ridge_u = UU + 0.35 * (periodic_noise(None, 3, 47) - 0.5)
height += 0.014 * (0.5 + 0.5 * np.cos(2 * math.pi * ridge_u / 0.5))

# 3. ski-track furrows: down-slope grooves at fixed u positions (repeating
#    every tile), ~2 cm deep, ~6 cm wide.
for uc in (1.1, 1.55, 5.3, 5.75):
    d = np.abs((((UU - uc) + TILE_M / 2) % TILE_M) - TILE_M / 2)
    height -= 0.020 * np.exp(-(d / 0.055) ** 2)

# 4. clods: loose chunks 10-30 cm across pushed to the sides, up to ~5.5 cm
#    proud; wrapped so they tile.
clod_sizes = []
for k in range(150):
    cx = rng.uniform(0, TILE_M)
    cy = rng.uniform(0, TILE_M)
    r = rng.uniform(0.05, 0.15)
    h = rng.uniform(0.018, 0.055)
    clod_sizes.append(2 * r)
    dx = np.abs((((UU - cx) + TILE_M / 2) % TILE_M) - TILE_M / 2)
    dy = np.abs((((VV - cy) + TILE_M / 2) % TILE_M) - TILE_M / 2)
    d2 = (dx ** 2 + dy ** 2) / (r * r)
    height += h * np.exp(-d2)

height_m = height
hmin, hmax = float(height_m.min()), float(height_m.max())

# ── seam measurement (height wrap error, texel 0 vs texel -1 in both axes) ──
seam_u = float(np.abs(height_m[:, 0] - height_m[:, -1]).max())
seam_v = float(np.abs(height_m[0, :] - height_m[-1, :]).max())

# ── albedo: snow >= 0.85 linear; troughs take a faint cool blue ─────────────
hn = (height_m - hmin) / max(hmax - hmin, 1e-6)          # 0..1
base = 0.90 + 0.06 * hn                                   # proud snow brighter
vari = 0.015 * (fbm(73, octaves=3, base_freq=7) - 0.5) * 2.0
r = np.clip(base + vari, 0.85, 1.0)
g = np.clip(base + vari * 0.9, 0.85, 1.0)
b = np.clip(base + vari * 0.7 + 0.012 * (1.0 - hn), 0.85, 1.0)   # blue in dips

albedo8 = np.stack([r, g, b], axis=-1)
albedo8 = np.clip(albedo8, 0, 1)
# linear -> sRGB-ish encode (the viewer expects display-referred texture data)
albedo8 = np.power(albedo8, 1.0 / 2.2)
albedo8 = (albedo8 * 255.0 + 0.5).astype(np.uint8)
albedo8 = np.ascontiguousarray(albedo8.transpose(1, 0, 2).reshape(-1))  # row-major

# ── normal map from the height gradient (OpenGL +Y up) ──────────────────────
gy, gx = np.gradient(height_m * (W / TILE_M))            # per-texel slope
nx, ny, nz = -gx, gy, -np.ones_like(gx)                  # G = +y (v up)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal8 = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
normal8 = (normal8 * 0.5 + 0.5) * 255.0 + 0.5
normal8 = np.clip(normal8, 0, 255).astype(np.uint8)
normal8 = np.ascontiguousarray(normal8.transpose(1, 0, 2).reshape(-1))

# ── height tile: linear 0..1 in RGB ─────────────────────────────────────────
h8 = np.clip((height_m - hmin) / max(hmax - hmin, 1e-6), 0, 1)
height8 = np.stack([h8, h8, h8], axis=-1)
height8 = (height8 * 255.0 + 0.5).astype(np.uint8)
height8 = np.ascontiguousarray(height8.transpose(1, 0, 2).reshape(-1))

os.makedirs(OUT, exist_ok=True)
write_png(os.path.join(OUT, "landing_chop_albedo.png"), bytes(albedo8.tobytes()), W, W)
write_png(os.path.join(OUT, "landing_chop_normal.png"), bytes(normal8.tobytes()), W, W)
write_png(os.path.join(OUT, "landing_chop_height.png"), bytes(height8.tobytes()), W, W)

sizes = np.array(clod_sizes)
print('LANDING_BAKE %s' % {
    'tile_m': TILE_M, 'texels': W,
    'ampMin_m': round(hmin, 4), 'ampMax_m': round(hmax, 4),
    'clods': len(sizes),
    'clodDiaMin_m': round(float(sizes.min()), 3),
    'clodDiaMax_m': round(float(sizes.max()), 3),
    'clodDiaMean_m': round(float(sizes.mean()), 3),
    'seamErrU': round(seam_u, 5), 'seamErrV': round(seam_v, 5),
})

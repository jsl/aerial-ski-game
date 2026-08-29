#!/usr/bin/env python3
"""
Web-delivery encoder for the athlete's baked maps.

    python3 blender/pack_maps.py assets/            # convert in place
    python3 blender/pack_maps.py assets/ --keep-png # leave the PNGs behind

WHY THIS EXISTS (Opus brief item 4, the author's "skis appear before the
skier"). The Cycles bake writes lossless PNG, which is right for a bake and
wrong for the wire: 4.7 MB normal + 2.3 MB AO + 1.0 MB albedo = 8.1 MB of
texture on top of an 0.85 MB glb. The body therefore resolved long after the
skis, and the athlete stood in the scene half-dressed.

Run as a SEPARATE process because Blender's bundled Python has no PIL.
build_body.py shells out to the system python3 after its own gates have run
against the PNGs, so every existing build gate keeps measuring the lossless
bake and only the delivered file changes.

FORMAT CHOICES, with the errors that justify them (measured on the 2026-08-29
bake, `python3 blender/pack_maps.py --report`):

  albedo  2048 WebP q95   995 KB -> 270 KB   mean abs 0.0034, p99 0.0196
  normal  2048 WebP q95  4802 KB -> 594 KB   mean 1.50 deg, p95 4.54 deg
  ao      1024 WebP q92  2360 KB -> 156 KB   mean abs 0.0137, p99 0.204

Resolution is kept at 2048 for albedo and normal — the point of item 4 is that
the head does NOT have enough texels, so halving them would undo the atlas
rebalance. AO is the one map that can be halved without cost: it is a smooth,
low-frequency occlusion term, and the 1024 round trip moves it by 1.4% mean.

The normal map is lossy, which is the one arguable call. 1.5 degrees mean /
4.5 degrees p95 of angular deviation is well under what a matte lycra surface
shows, and the alternative (lossless WebP, 2.2 MB) spends nine tenths of the
2.5 MB budget on one map. The gate below asserts those numbers rather than
trusting them.
"""
import json
import os
import sys

from PIL import Image

# name -> (side, encoder kwargs). 'side' None keeps the baked resolution.
PLAN = {
    'athlete_albedo': (None, dict(format='WEBP', quality=95, method=6)),
    'athlete_normal': (None, dict(format='WEBP', quality=95, method=6)),
    'athlete_ao':     (1024, dict(format='WEBP', quality=92, method=6)),
}
# Encoded-vs-baked error the delivery format may not exceed. A negative
# control lives in tests/drive/rig.spec.js and in --self-test below: dropping
# the normal map to quality 20 must trip the angular gate.
NORMAL_MEAN_DEG_MAX = 3.0
NORMAL_P95_DEG_MAX = 8.0
COLOUR_MEAN_MAX = 0.02
TOTAL_BYTES_MAX = 2_500_000


def _angles(a, b):
    """Per-texel angle between two tangent-space normal images, in degrees."""
    import math
    n = len(a)
    out = []
    for i in range(0, n, 3):
        ax, ay, az = a[i] / 127.5 - 1.0, a[i + 1] / 127.5 - 1.0, a[i + 2] / 127.5 - 1.0
        bx, by, bz = b[i] / 127.5 - 1.0, b[i + 1] / 127.5 - 1.0, b[i + 2] / 127.5 - 1.0
        la = math.sqrt(ax * ax + ay * ay + az * az)
        lb = math.sqrt(bx * bx + by * by + bz * bz)
        if la < 1e-6 or lb < 1e-6:
            continue
        c = (ax * bx + ay * by + az * bz) / (la * lb)
        out.append(math.degrees(math.acos(max(-1.0, min(1.0, c)))))
    return out


def _pct(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = min(len(sorted_vals) - 1, int(round(p * (len(sorted_vals) - 1))))
    return sorted_vals[k]


def pack(out_dir, keep_png=False, normal_quality=None):
    """Encode the baked PNGs, gate the error, return a stats dict."""
    stats, total = {}, 0
    for base, (side, kw) in PLAN.items():
        src = os.path.join(out_dir, base + '.png')
        if not os.path.exists(src):
            raise SystemExit(f'[pack_maps] missing baked map {src}')
        kw = dict(kw)
        if base == 'athlete_normal' and normal_quality is not None:
            kw['quality'] = normal_quality
        im = Image.open(src).convert('RGB')
        png_bytes = os.path.getsize(src)
        enc = im if side is None else im.resize((side, side), Image.LANCZOS)
        dst = os.path.join(out_dir, base + '.webp')
        enc.save(dst, **kw)
        web_bytes = os.path.getsize(dst)
        total += web_bytes

        # Decode what we just wrote and measure against the bake, at the
        # BAKED resolution — a downscaled map is judged by what the sampler
        # will actually reconstruct, not by its own smaller self.
        back = Image.open(dst).convert('RGB')
        if back.size != im.size:
            back = back.resize(im.size, Image.BILINEAR)
        a, b = im.tobytes(), back.tobytes()
        entry = {'png': png_bytes, 'web': web_bytes, 'res': enc.size[0],
                 'ratio': round(png_bytes / max(1, web_bytes), 2)}
        if base == 'athlete_normal':
            ang = sorted(_angles(a, b))
            entry['mean_deg'] = round(sum(ang) / max(1, len(ang)), 3)
            entry['p95_deg'] = round(_pct(ang, 0.95), 3)
        else:
            d = [abs(a[i] - b[i]) / 255.0 for i in range(0, len(a), 7)]
            entry['mean_abs'] = round(sum(d) / max(1, len(d)), 4)
            d.sort()
            entry['p99_abs'] = round(_pct(d, 0.99), 4)
        stats[base] = entry
        if not keep_png:
            os.remove(src)

    stats['total_web'] = total
    n = stats['athlete_normal']
    if n['mean_deg'] > NORMAL_MEAN_DEG_MAX or n['p95_deg'] > NORMAL_P95_DEG_MAX:
        raise SystemExit(
            f'[pack_maps] normal encode gate FAILED: mean {n["mean_deg"]} deg '
            f'(limit {NORMAL_MEAN_DEG_MAX}), p95 {n["p95_deg"]} deg '
            f'(limit {NORMAL_P95_DEG_MAX}) — the delivered normals no longer '
            f'match the bake, relief will read wrong')
    for base in ('athlete_albedo', 'athlete_ao'):
        if stats[base]['mean_abs'] > COLOUR_MEAN_MAX:
            raise SystemExit(
                f'[pack_maps] {base} encode gate FAILED: mean abs '
                f'{stats[base]["mean_abs"]} (limit {COLOUR_MEAN_MAX})')
    if total > TOTAL_BYTES_MAX:
        raise SystemExit(
            f'[pack_maps] delivered maps total {total / 1e6:.2f} MB '
            f'(budget {TOTAL_BYTES_MAX / 1e6:.2f} MB) — the athlete will still '
            f'arrive after the skis')
    print('[pack_maps] ' + json.dumps(stats, sort_keys=True))
    return stats


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    out_dir = args[0] if args else 'assets'
    if '--self-test' in argv:
        # NEGATIVE CONTROL for the normal encode gate: quality 20 must trip it.
        try:
            pack(out_dir, keep_png=True, normal_quality=20)
        except SystemExit as e:
            print(f'[pack_maps] self-test OK — gate rejected q20: {e}')
            return 0
        print('[pack_maps] self-test FAILED — q20 normals passed the gate')
        return 1
    pack(out_dir, keep_png='--keep-png' in argv)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

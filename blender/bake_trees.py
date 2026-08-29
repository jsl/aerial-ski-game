#!/usr/bin/env python3
"""P4 forest impostor bake: FOUR distinct snow-loaded spruce variants rendered
to impostor atlases (review-60 (c): 3–4 variants so no two neighbours match).

Each variant is a deterministic spruce (tapered trunk + drooping branch layers
with snow blended in by world-space normal.z — no add-ons) differing in seed,
height, radial envelope, droop aggressiveness and needle tint; rendered with
CYCLES (headless, CPU) into, per variant tag 0–3:

  assets/tree_spruce_card_<tag>.png   512x1024 RGBA — the straight-on view used
                                      by the game's cross-card impostors
  assets/tree_spruce_atlas_<tag>.png  8 horizontal views x 1 elevation,
                                      2048x512 (256x512 tiles) — input for
                                      the camera-facing billboard slice

Every variant is framed at the SAME 7.3 x 14.6 m window (the card quad
CARD_W/CARD_H in game.js), so the renderer needs no per-variant geometry —
the shared cross-card quad scales per instance.

Both carry straight alpha; the material shades pre-lit albedo (sun at the
game's 32 deg elevation from camera-left), so the impostor needs no lightmap.
Usage:

  blender -b --factory-startup --python blender/bake_trees.py -- \
      [--out ../assets] [--samples 24] [--card 512x1024]

Logs per-tile alpha coverage / mean luminance / snow-white fraction and fails
the build when a tile is empty or blown out, or when two variants' 16-band
silhouette profiles are not measurably distinct.
"""

import argparse
import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Euler, Vector

# ── Spruce construction ───────────────────────────────────────────────────────

TRUNK_H = 3.2
TRUNK_R0 = 0.30
TRUNK_R1 = 0.14
TRUNK_COL = (0.16, 0.105, 0.07)
SNOW = (0.93, 0.95, 0.98)


def _clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(block):
            if x.users == 0:
                block.remove(x)


def _mat_snow(name, base, snow_z0, snow_z1, snow_gain):
    """Diffuse shaded by a sun; base colour mixed toward snow by world normal z."""
    if len(base) == 3:
        base = (*base, 1.0)
    snow = SNOW if len(SNOW) == 4 else (*SNOW, 1.0)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    geo = nt.nodes.new('ShaderNodeNewGeometry')       # world-space normal
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    rng = nt.nodes.new('ShaderNodeMapRange')
    rng.inputs['From Min'].default_value = snow_z0
    rng.inputs['From Max'].default_value = snow_z1
    rng.clamp = True
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MIX'
    mix.inputs['Color1'].default_value = base
    mix.inputs['Color2'].default_value = snow
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], rng.inputs['Value'])
    nt.links.new(rng.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(mix.outputs['Color'], diff.inputs['Color'])
    nt.links.new(diff.outputs['BSDF'], out.inputs['Surface'])
    # Snow gain: multiply the mix factor so trunk snow stays weaker.
    if snow_gain != 1.0:
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = snow_gain
        nt.links.new(rng.outputs['Result'], mul.inputs[0])
        nt.links.new(mul.outputs['Value'], mix.inputs['Fac'])
    return m


def _add_cone(r0, r1, depth, mat, loc, quat=None, seg=8):
    bpy.ops.mesh.primitive_cone_add(
        vertices=seg, radius1=r0, radius2=r1, depth=depth, location=loc)
    o = bpy.context.active_object
    if quat is not None:
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = quat
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


# Review-60 (c): FOUR DISTINCT spruce variants, not four clones of one tree.
# Each entry varies the jitter seed, the height, the radial envelope, the
# droop aggressiveness and the needle tint. All tints stay inside the
# review-60 spruce band (0.08–0.14, 0.18–0.28, 0.10–0.16); all tops stay
# under the shared 14.6 m frame so no variant's spike is cropped.
VARIANTS = [
    dict(tag='0', seed=30115, top_z=13.6, r_mul=1.00, droop_bias=0.0,
         needle=(0.090, 0.200, 0.120)),   # the iter-62 tree, unchanged
    dict(tag='1', seed=92041, top_z=14.3, r_mul=0.88, droop_bias=3.0,
         needle=(0.100, 0.215, 0.130)),   # tall, narrow, denser upright cast
    dict(tag='2', seed=4517,  top_z=11.9, r_mul=1.18, droop_bias=-3.0,
         needle=(0.085, 0.190, 0.115)),   # short, wide, heavy drooping skirt
    dict(tag='3', seed=77003, top_z=12.8, r_mul=1.05, droop_bias=1.5,
         needle=(0.095, 0.205, 0.125)),   # mid-size, loose asymmetry
]

# The game's card quad frame (CARD_W/CARD_H in game.js; iter-62's
# TOP_Z 13.6 + 1.0 margin). EVERY variant bakes into this same window, so
# shorter trees simply carry more sky margin at the top of their card.
FRAME_H = 14.6
FRAME_W = FRAME_H * (512 / 1024)   # 7.3 — 1:2 card aspect


def build_spruce(cfg):
    rng = random.Random(cfg['seed'])
    top_z = cfg['top_z']
    # Snow keyed lower on normal.z than the 0.18-0.70 of iters 56-61: the
    # straight-on view washed the mix out and the forest read near-black
    # (review-60 tonality complaint). 0.12-0.60 loads the up-facing sides.
    mat_needle = _mat_snow('needle', cfg['needle'], 0.12, 0.60, 1.0)
    mat_trunk = _mat_snow('trunk', TRUNK_COL, 0.30, 0.95, 0.55)

    _add_cone(TRUNK_R0, TRUNK_R1, TRUNK_H, mat_trunk,
              (0, 0, TRUNK_H / 2), seg=12)

    n_layers = 15
    golden = math.pi * (3 - math.sqrt(5))
    # Review-60 (a): the layer radius must shrink monotonically toward the
    # tip while being irregular (±20% per layer) — jitter then clamp with a
    # running minimum so the envelope stays monotone.
    prev_r = None
    for i in range(n_layers):
        t = i / (n_layers - 1)
        z = 2.6 + t * (top_z - 3.6)
        layer_r = 2.35 * cfg['r_mul'] * (1.0 - t) ** 0.85 + 0.15
        layer_r *= rng.uniform(0.80, 1.20)
        if prev_r is not None:
            layer_r = min(layer_r, prev_r * 0.97)
        prev_r = layer_r
        # Bottom whorls sweep UP (negative droop) so the trunk stays visible
        # over the tree's bottom ~15% (review-60 (a)); upper layers droop.
        # droop_bias shifts the whole cast: + more upright, − more skirt.
        droop = math.radians(cfg['droop_bias'] - 9
                             + 16 * min(t / 0.14, 1.0) + 22 * t)
        n_br = max(6, 13 - int(6 * t))
        # Thicker branchlets than iter 56 (0.24): layered skirts instead
        # of isolated spikes once the droop orientation survives.
        r0 = 0.30 * (0.55 + 0.45 * (1 - t))
        for j in range(n_br):
            phi = j * (2 * math.pi / n_br) + golden * (i % 3) + rng.uniform(-0.12, 0.12)
            br_len = layer_r * rng.uniform(0.92, 1.10)
            d = Vector((math.cos(phi) * math.cos(droop),
                        math.sin(phi) * math.cos(droop),
                        -math.sin(droop)))
            start = Vector((math.cos(phi) * 0.22, math.sin(phi) * 0.22, z))
            quat = d.to_track_quat('Z', 'Y')
            centre = start + d * (br_len / 2)
            _add_cone(r0, 0.02, br_len, mat_needle, centre, quat, seg=7)

    # top spike: base buried in the topmost whorls (11.2) so the silhouette
    # is continuous to the tip — no detached fragment above an empty band.
        # Internode filler between whorls: closes the sky gaps a real spruce
        # shows only near its spire, not through the mid canopy (iter-62
        # row-census gate: no empty row-run inside the canopy body).
        if i < n_layers - 1:
            z_mid = z + (z + (top_z - 3.6) / (n_layers - 1) - z) * 0.5
            t_mid = (z_mid - 2.6) / (top_z - 3.6)
            r_mid = layer_r * 0.72
            droop_mid = droop + math.radians(6)
            for j in range(max(3, n_br // 2)):
                phi = (j + 0.5) * (2 * math.pi / max(3, n_br // 2)) + golden * i
                br_len = r_mid * rng.uniform(0.85, 1.05)
                d = Vector((math.cos(phi) * math.cos(droop_mid),
                            math.sin(phi) * math.cos(droop_mid),
                            -math.sin(droop_mid)))
                start = Vector((math.cos(phi) * 0.20, math.sin(phi) * 0.20, z_mid))
                quat = d.to_track_quat('Z', 'Y')
                centre = start + d * (br_len / 2)
                _add_cone(r0 * 0.7, 0.02, br_len, mat_needle, centre, quat, seg=6)
    _add_cone(0.35, 0.01, 2.4, mat_needle,
              (0, 0, top_z - 1.0), seg=8)

    # Spike-zone filler whorls: bury the top spike's base so the silhouette is
    # continuous from tip to skirt in EVERY variant (the iter-62 census gate
    # "no empty row-run inside the canopy body", per card). Variant 1 — tall,
    # narrow, +3 deg cast — exposed bare-spike slivers where the topmost
    # whorl's drooping branches pulled away from the spike; THREE filler rows
    # chain the spike base into the whorl stack (measured: 2 rows left one
    # 3 cm gap at z≈11.5 on the 14.3 m variant).
    for k in range(3):
        z_f = top_z - 1.7 - 0.55 * k
        t_f = (z_f - 2.6) / (top_z - 3.6)
        r_f = max(0.45, 2.35 * cfg['r_mul'] * (1.0 - t_f) ** 0.85 * 0.45)
        droop_f = math.radians(cfg['droop_bias'] - 9 + 16 * min(t_f / 0.14, 1.0)
                               + 22 * t_f)
        n_f = 8
        for j in range(n_f):
            phi = j * (2 * math.pi / n_f) + golden * k
            br_len = r_f * rng.uniform(0.90, 1.10)
            d = Vector((math.cos(phi) * math.cos(droop_f),
                        math.sin(phi) * math.cos(droop_f),
                        -math.sin(droop_f)))
            start = Vector((math.cos(phi) * 0.12, math.sin(phi) * 0.12, z_f))
            quat = d.to_track_quat('Z', 'Y')
            centre = start + d * (br_len / 2)
            _add_cone(0.16, 0.02, br_len, mat_needle, centre, quat, seg=6)



# ── Bare deciduous (P4 slice 2, iter 98) ─────────────────────────────────────
# The plan's mixed-woodland delta: MOSTLY bare deciduous with a spruce
# minority. Two birch-like variants: one tapered pale trunk per variant, a
# stack of main scaffold whorls over the crown zone, each main branch forked
# twice (fine bare twigs). No foliage cones — the crown reads as a
# grey-brown haze (plan P4). Snow only on steeply up-facing surfaces.

DECIDUOUS_VARIANTS = [
    dict(tag='4', seed=61231, top_z=11.2),
    dict(tag='5', seed=88477, top_z=12.1),
]


def build_deciduous(cfg):
    rng = random.Random(cfg['seed'])
    top = cfg['top_z']
    mat_bark = _mat_snow('bark', (0.36, 0.31, 0.26), 0.40, 0.95, 0.35)

    _add_cone(0.24, 0.05, top, mat_bark, (0, 0, top / 2), seg=10)

    def _branch(start, d, length, r0, depth):
        quat = d.to_track_quat('Z', 'Y')
        centre = start + d * (length / 2)
        _add_cone(r0, r0 * 0.4, length, mat_bark, centre, quat, seg=5)
        if depth >= 2:
            return
        end = start + d * length
        n_kids = 2
        for k in range(n_kids):
            phi = rng.uniform(0, 2 * math.pi)
            perp = Vector((math.cos(phi), math.sin(phi), 0)).cross(d)
            if perp.length < 1e-4:
                perp = Vector((1, 0, 0))
            perp.normalize()
            nd = (d + perp * math.tan(rng.uniform(0.45, 0.95))).normalized()
            # slight upward bias in the twigs (crowns reach for the light)
            nd = Vector((nd.x, nd.y, nd.z * rng.uniform(0.7, 1.25))).normalized()
            _branch(end - d * length * 0.12, nd,
                    length * rng.uniform(0.50, 0.72), r0 * 0.55, depth + 1)

    golden = math.pi * (3 - math.sqrt(5))
    n_whorls = 8
    for i in range(n_whorls):
        t = i / (n_whorls - 1)          # 0 = crown base, 1 = top
        z = top * (0.42 + 0.55 * t)
        n_br = 5 if t < 0.85 else 3
        for j in range(n_br):
            phi = j * (2 * math.pi / n_br) + golden * i + rng.uniform(-0.2, 0.2)
            elev = math.radians(rng.uniform(22, 55))
            d = Vector((math.cos(phi) * math.cos(elev),
                        math.sin(phi) * math.cos(elev),
                        math.sin(elev)))
            length = top * 0.26 * (1.0 - 0.45 * t) * rng.uniform(0.80, 1.15)
            r0 = 0.10 * (1.0 - 0.5 * t)
            _branch(Vector((math.cos(phi) * 0.06, math.sin(phi) * 0.06, z)),
                    d, length, r0, 0)

    # a few upright crown twigs so the top band is not bare trunk only
    for k in range(4):
        phi = rng.uniform(0, 2 * math.pi)
        elev = math.radians(rng.uniform(55, 80))
        d = Vector((math.cos(phi) * math.cos(elev), math.sin(phi) * math.cos(elev),
                    math.sin(elev)))
        _branch(Vector((0, 0, top * rng.uniform(0.86, 0.96))), d,
                top * rng.uniform(0.07, 0.12), 0.05, 0)

# ── Lighting / camera ─────────────────────────────────────────────────────────

def setup_world_and_sun():
    w = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.72, 0.80, 0.92, 1.0)   # snow-bounce sky
    bg.inputs[1].default_value = 0.55
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
    sun = bpy.context.active_object
    sun.data.energy = 3.2
    sun.data.angle = math.radians(1.5)
    # Light travels toward +y (the card's visible side) from upper camera-left,
    # 32 deg elevation — matches the game sun's read on a side-on tree.
    d = Vector((0.30, 0.82, -0.53)).normalized()
    sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_view(out_path, res_x, res_y, yaw_deg, ortho_w, height):
    scn = bpy.context.scene
    cam = scn.camera
    cam.data.type = 'ORTHO'
    # Pin the fit axis: with sensor_fit AUTO this Blender build frames a
    # 512x1024 portrait render at only ~10.5 m of world height for
    # ortho_scale 7.3 (measured, iter 62), which cropped the tree top into
    # the "floating fragment". HORIZONTAL makes ortho_scale the world WIDTH
    # and the height ortho_scale * res_y/res_x — the 7.3 x 14.6 frame the
    # card quad (CARD_W/CARD_H in game.js) assumes.
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.ortho_scale = ortho_w
    d = math.radians(yaw_deg)
    # Orbit the CAMERA around the tree. The old code rotated the MESHES
    # (rotation_mode='XYZ' + rotation_euler=(0,0,yaw)), which threw away the
    # branch cones' droop quaternions: every branch rendered as a vertical
    # spike (the "columnar stacks with flat white tops" from review-60) and
    # all 8 atlas views were the same frontal stack (coverage spread 0.005).
    cam.location = (30 * math.sin(d), -30 * math.cos(d), height / 2)
    cam.rotation_euler = Euler((math.radians(90), 0, d), 'XYZ')
    scn.render.filepath = out_path
    scn.render.resolution_x = res_x
    scn.render.resolution_y = res_y
    bpy.ops.render.render(write_still=True)


# ── Atlas composition + measurements ─────────────────────────────────────────

def load_rgba(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return arr  # rows bottom-up, straight alpha


def save_rgba(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new('bake_out', width=w, height=h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def stats(tile):
    a = tile[..., 3]
    cov = float((a > 0.5).mean())
    solid = tile[a > 0.5]
    lum = float((0.2126 * solid[..., 0] + 0.7152 * solid[..., 1]
                 + 0.0722 * solid[..., 2]).mean()) if len(solid) else 0.0
    white = float(((solid[..., 0] > 0.75) & (solid[..., 1] > 0.75)
                   & (solid[..., 2] > 0.75)).mean()) if len(solid) else 0.0
    return {'coverage': round(cov, 4), 'lum': round(lum, 4),
            'snowFrac': round(white, 4)}


def _card_widths16(card):
    """Fraction of opaque pixels per horizontal 16th of the card, file TOP
    first — the same banding trees.spec.js computes, so the bake-side
    distinctness gate and the spec gate measure the same profile."""
    a = card[..., 3] >= 0.5
    h = a.shape[0]
    widths = []
    for b in range(16):
        lo, hi = round(b * h / 16), round((b + 1) * h / 16)
        widths.append(round(float(a[lo:hi].mean()), 4))
    return widths


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'assets'))
    ap.add_argument('--samples', type=int, default=24)
    ap.add_argument('--views', type=int, default=8)
    ap.add_argument('--tile', default='256x512')
    ap.add_argument('--card', default='512x1024')
    ap.add_argument('--ortho', type=float, default=0.0)  # 0 → derive from height
    args = ap.parse_args(argv)

    tw, th = (int(v) for v in args.tile.split('x'))
    cw, ch = (int(v) for v in args.card.split('x'))

    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = args.samples
    scn.cycles.use_denoising = False
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'
    scn.render.image_settings.color_depth = '8'
    scn.view_settings.view_transform = 'Standard'
    scn.view_settings.look = 'None'

    os.makedirs(args.out, exist_ok=True)
    tmp = os.path.join(args.out, '_tree_tmp')
    os.makedirs(tmp, exist_ok=True)

    # Fixed frame for every variant — the card quad's window (game.js
    # CARD_W/CARD_H). --ortho only overrides for calibration probes.
    frame_h = FRAME_H
    ortho_w = args.ortho if args.ortho > 0 else FRAME_W

    report = {'views': args.views, 'frame': [round(ortho_w, 3), round(frame_h, 3)],
              'variants': []}

    SPECIES = [
        # (configs, builder, output prefix, tile/card coverage band)
        (VARIANTS, build_spruce, 'tree_spruce', 0.05, 0.60),
        # bare deciduous: thin bare geometry legitimately has far less
        # opaque area than a layered conifer skirt
        (DECIDUOUS_VARIANTS, build_deciduous, 'tree_birch', 0.010, 0.60),
    ]
    for cfgs, builder, prefix, cov_lo, cov_hi in SPECIES:
      for cfg in cfgs:
        _clear()          # also removes the previous iteration's camera
        builder(cfg)
        setup_world_and_sun()
        bpy.ops.object.camera_add(location=(0, -30, frame_h / 2))
        scn.camera = bpy.context.active_object

        vrep = {'tag': cfg['tag'], 'topZ': cfg['top_z'], 'tiles': []}

        card_p = os.path.join(tmp, 'card_%s.png' % cfg['tag'])
        render_view(card_p, cw, ch, 0.0, ortho_w, frame_h)
        card = load_rgba(card_p)
        save_rgba(card, os.path.join(args.out, '%s_card_%s.png' % (prefix, cfg['tag'])))
        vrep['card'] = dict(size=[cw, ch], **stats(card))
        vrep['widths16'] = _card_widths16(card)

        atlas = np.zeros((th, tw * args.views, 4), dtype=np.float32)
        for k in range(args.views):
            yaw = k * 360.0 / args.views
            p = os.path.join(tmp, 'tile_%s_%d.png' % (cfg['tag'], k))
            render_view(p, tw, th, yaw, ortho_w, frame_h)
            tile = load_rgba(p)
            atlas[:, k * tw:(k + 1) * tw] = tile
            vrep['tiles'].append({'view': int(yaw), **stats(tile)})
        save_rgba(atlas, os.path.join(args.out, '%s_atlas_%s.png' % (prefix, cfg['tag'])))

        for t in vrep['tiles']:
            assert cov_lo <= t['coverage'] <= cov_hi, 'tree tile coverage out of band: %s' % t
            assert 0.05 <= t['lum'] <= 0.98, 'tree tile luminance out of band: %s' % t
        assert cov_lo <= vrep['card']['coverage'] <= cov_hi, 'card coverage out of band'
        covs = [t['coverage'] for t in vrep['tiles']]
        vrep['coverageSpread'] = round(max(covs) - min(covs), 4)
        report['variants'].append(vrep)

    # Review-60 (c) distinctness: no two variants may share the same
    # silhouette. L1 distance between their 16-band opaque-width profiles.
    pairs = []
    for i in range(len(report['variants'])):
        for j in range(i + 1, len(report['variants'])):
            wi, wj = report['variants'][i]['widths16'], report['variants'][j]['widths16']
            pairs.append({'pair': [i, j],
                          'd': round(sum(abs(a - b) for a, b in zip(wi, wj)), 4)})
    report['widthL1'] = pairs
    report['widthL1min'] = min(p['d'] for p in pairs)
    assert report['widthL1min'] >= 0.02, \
        'spruce variants are not visually distinct (widthL1min %s)' % report['widthL1min']

    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)

    print('TREE_BAKE ' + json.dumps(report))


if __name__ == '__main__':
    main()

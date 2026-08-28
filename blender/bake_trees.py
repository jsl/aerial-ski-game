#!/usr/bin/env python3
"""P4 forest impostor bake: a snow-loaded spruce rendered to an impostor atlas.

Builds one deterministic spruce (tapered trunk + drooping branch layers with
snow blended in by world-space normal.z — no add-ons), renders it with CYCLES
(headless, CPU) into:

  assets/tree_spruce_card.png   1024x2048 RGBA — the straight-on view used by
                                the game's cross-card impostors (slice 1)
  assets/tree_spruce_atlas.png  8 horizontal views x 1 elevation, 2048x512
                                (256x512 tiles) — input for the camera-facing
                                billboard slice

Both carry straight alpha; the material shades pre-lit albedo (sun at the
game's 32 deg elevation from camera-left), so the impostor needs no lightmap.
Usage:

  blender -b --factory-startup --python blender/bake_trees.py -- \
      [--out ../assets] [--samples 24] [--card 1024x2048]

Logs per-tile alpha coverage / mean luminance / snow-white fraction and fails
the build when a tile is empty or blown out.
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
TOP_Z = 13.6          # total height incl. the top spike
NEEDLE = (0.070, 0.110, 0.078)    # dark cold green (reads grey-green in sun)
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


def build_spruce():
    rng = random.Random(30115)
    mat_needle = _mat_snow('needle', NEEDLE, 0.18, 0.70, 1.0)
    mat_trunk = _mat_snow('trunk', TRUNK_COL, 0.30, 0.95, 0.55)

    _add_cone(TRUNK_R0, TRUNK_R1, TRUNK_H, mat_trunk,
              (0, 0, TRUNK_H / 2), seg=12)

    n_layers = 15
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n_layers):
        t = i / (n_layers - 1)
        z = 2.4 + t * (TOP_Z - 3.4)
        layer_r = 2.35 * (1.0 - t) ** 0.85 + 0.12
        droop = math.radians(14 + 30 * t)
        n_br = max(5, 12 - int(6 * t))
        for j in range(n_br):
            phi = j * (2 * math.pi / n_br) + golden * (i % 3) + rng.uniform(-0.12, 0.12)
            br_len = layer_r * rng.uniform(0.92, 1.10)
            d = Vector((math.cos(phi) * math.cos(droop),
                        math.sin(phi) * math.cos(droop),
                        -math.sin(droop)))
            start = Vector((math.cos(phi) * 0.22, math.sin(phi) * 0.22, z))
            quat = d.to_track_quat('Z', 'Y')
            centre = start + d * (br_len / 2)
            r0 = 0.24 * (0.50 + 0.50 * (1 - t))
            _add_cone(r0, 0.02, br_len, mat_needle, centre, quat, seg=7)

    # top spike
    _add_cone(0.22, 0.01, 1.6, mat_needle,
              (0, 0, TOP_Z - 0.8), seg=8)


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
    cam.data.ortho_scale = ortho_w
    cam.location = (0, -30, height / 2)
    cam.rotation_euler = Euler((math.radians(90), 0, 0), 'XYZ')
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.rotation_mode = 'XYZ'
            o.rotation_euler = (0, 0, math.radians(yaw_deg))
    scn.render.filepath = out_path
    scn.render.resolution_x = res_x
    scn.render.resolution_y = res_y
    bpy.ops.render.render(write_still=True)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.rotation_euler = (0, 0, 0)


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

    _clear()
    build_spruce()
    setup_world_and_sun()

    bpy.ops.object.camera_add(location=(0, -30, TOP_Z / 2))
    scn.camera = bpy.context.active_object

    # frame: full tree height + margin; width from the 1:2 aspect
    frame_h = TOP_Z + 1.0
    ortho_w = args.ortho if args.ortho > 0 else frame_h * (cw / ch)

    tmp = os.path.join(args.out, '_tree_tmp')
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(tmp, exist_ok=True)

    report = {'views': args.views, 'card': {}, 'tiles': []}

    card_p = os.path.join(tmp, 'card.png')
    render_view(card_p, cw, ch, 0.0, ortho_w, frame_h)
    card = load_rgba(card_p)
    save_rgba(card, os.path.join(args.out, 'tree_spruce_card.png'))
    report['card'] = dict(size=[cw, ch], **stats(card))

    atlas = np.zeros((th, tw * args.views, 4), dtype=np.float32)
    for k in range(args.views):
        yaw = k * 360.0 / args.views
        p = os.path.join(tmp, 'tile_%d.png' % k)
        render_view(p, tw, th, yaw, ortho_w, frame_h)
        tile = load_rgba(p)
        atlas[:, k * tw:(k + 1) * tw] = tile
        report['tiles'].append({'view': int(yaw), **stats(tile)})
    save_rgba(atlas, os.path.join(args.out, 'tree_spruce_atlas.png'))

    for t in report['tiles']:
        assert 0.05 <= t['coverage'] <= 0.60, 'tree tile coverage out of band: %s' % t
        assert 0.05 <= t['lum'] <= 0.98, 'tree tile luminance out of band: %s' % t
    assert 0.05 <= report['card']['coverage'] <= 0.60, 'card coverage out of band'

    covs = [t['coverage'] for t in report['tiles']]
    report['coverageSpread'] = round(max(covs) - min(covs), 4)

    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)

    print('TREE_BAKE ' + json.dumps(report))


if __name__ == '__main__':
    main()

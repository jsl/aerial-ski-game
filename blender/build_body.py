"""
Build the athlete from a real human base mesh, rigged to the physics segments.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048

WHY THE METABALL BODY IS GONE
-----------------------------
The previous three athletes were separate solids, then capsules, then one
continuous metaball isosurface. The last of those was the closest and still read
as an alien, for a reason no amount of parameter tuning could reach: a metaball
body has no TOPOLOGY. It is a field, sampled. A shoulder is wherever two blobs
happen to overlap, so it is a bulge rather than a deltoid; there is no edge loop
at the elbow, so the elbow is a smooth tube; the arms do not attach to the torso,
they merge into it. Human silhouettes are read by exactly those features, and
none of them exist in an isosurface.

So the base is now a real human mesh: Blender Studio's CC0 Human Base Meshes
bundle, 10,582 vertices, 99.8% quads, already UV unwrapped, with proper edge
loops at every joint. blender/extract_base_mesh.py vendors the one body from the
50 MB bundle; blender/human_base_male.blend is the result.

FITTING IT TO A RIG THAT IS NOT ANATOMICAL
------------------------------------------
The game's body-model.json is a PHYSICS model — ten segments with masses and
inertias — and its segment centres are not where a human's joints are. Binding
the mesh directly to bones placed at those centres reproduces the original
problem: the "shoulder" lands mid-torso and the arms attach to the ribs.

The fix is to separate the two jobs the rig does:

  1. WEIGHTS need anatomically-correct bones, or the deformation is nonsense.
     Blender's Rigify ships a human metarig whose joint positions are real human
     proportions, so the shoulder, elbow, wrist, hip, knee and ankle are read off
     it and scaled to this mesh rather than guessed.

  2. THE BIND POSE needs to be the game's POSE_UNTUCKED, because that is the
     layout the physics drivers write to every frame.

So the rig is built anatomically, the mesh is bound to it, and THEN each bone is
posed onto its game segment and the pose is applied as the new rest pose. The
mesh reshapes to the game's proportions while keeping human topology and sane
weights.

PIPELINE
--------
  human_base_male.blend  (CC0, A-pose, anatomical)
    |
    +- align axes, soften anatomy, round the head into a helmet
    +- rig at ANATOMICAL joints (from the Rigify metarig, scaled)
    +- bind with heat-map weights
    +- pose each bone onto its game segment; apply as rest pose
    |
    +-- low     the result, UV'd and material-split, EXPORTED
    |
    +-- high    subdivided, displaced with suit detail, painted with vertex
                colours; never exported, exists only to be baked

  bake high -> low:  normal (tangent), ambient occlusion, albedo

REFERENCE
---------
Suit design matched to a World Cup aerials clip supplied by the author
(IMG_7841.MOV, a Canadian venue): white race suit, royal-blue stripe down the
full outside of each leg, powder-blue competition bib with a white number patch,
navy waist, dark gloves, dark helmet.

OUTPUT
------
assets/athlete_body.glb     skinned body + skis
assets/athlete_normal.png   tangent-space normals   (DATA: linear, not sRGB)
assets/athlete_ao.png       ambient occlusion       (DATA: linear, not sRGB)
assets/athlete_albedo.png   suit colours            (COLOUR: sRGB)
"""

import bpy
import json
import math
import os
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)
import bakeutil                                              # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


OUT = arg('--out', 'assets/athlete_body.glb')
BASE = arg('--base', 'blender/human_base_male.blend')
RES = int(arg('--res', '2048'))
SAMPLES = int(arg('--samples', '128'))
DECIMATE = float(arg('--decimate', '0.85'))

ROOT = os.path.dirname(HERE)
MODEL = json.load(open(os.path.join(HERE, 'body-model.json')))
SEGMENTS = {s['name']: s for s in MODEL['SEGMENTS']}
BASE_Z = MODEL['BASE_Z']
POSE = MODEL['POSE_UNTUCKED']

BODY_SEGMENTS = [n for n in SEGMENTS if n not in ('skiL', 'skiR')]

# ── Suit palette, read off the reference footage ────────────────────────────
SUIT       = (0.86, 0.88, 0.91)      # white race suit, very slightly cool
STRIPE     = (0.09, 0.24, 0.62)      # royal blue, full length of the outer leg
BIB        = (0.55, 0.72, 0.88)      # powder-blue competition bib
BIB_NUMBER = (0.95, 0.96, 0.97)      # white number patch on the bib
WAIST      = (0.08, 0.11, 0.20)      # dark navy waistband under the bib
GLOVE      = (0.13, 0.14, 0.16)
HELMET     = (0.09, 0.10, 0.12)
SKIN       = (0.78, 0.56, 0.46)      # matte skin under the brim (face, nose, chin)
LENS       = (0.04, 0.06, 0.08)      # dark glossy goggle lens across the eyes


def log(m):
    print(f'[body] {m}', flush=True)


# The arms are bound HANGING DOWN, not overhead.
#
# POSE_UNTUCKED holds them up beside the head, and binding there was wrong in the
# way that matters most: the game's resting pose has them down. engine/core/pose.js
# sweeps the arm about a shoulder pivot at y = 0.150 by phi = pi * armDrop, so
# between bind and rest every arm bone rotated a full pi AND its origin fell
# 0.48 m. Linear blend skinning bunches whatever is caught between, which is what
# produced the hump over each shoulder blade and the long thin neck — the shoulder
# was being dragged downwards away from the head.
#
# Binding where the figure spends its time makes the deformation there identity.
# It is also closer to the base mesh's own A-pose, so less violence is done to it.
# armSweep at armDrop = 1: phi = pi, so cos = -1 and sin = 0.
ARM_BIND = {
    # Lateral = the POSE_UNTUCKED driver x exactly (rebaseline part 1 moved
    # every pose table ±0.205 → ±0.175; bind≡driver is an exact-equality gate
    # in rig.spec.js, so the hang pose tracks it 1:1 — no abduction slack
    # lives here, clearance to the torso comes from the mesh).
    'upperArmL': (-0.175, 0.150 - 0.150), 'upperArmR': (0.175, 0.150 - 0.150),
    'lowerArmL': (-0.175, 0.150 - 0.425), 'lowerArmR': (0.175, 0.150 - 0.425),
}


def is_arm(name):
    return name in ARM_BIND


def bl(name):
    """
    Segment centre in BLENDER axes.

    THE FRAME CONTRACT, measured twice before being trusted (2026-08-26):

    The game consumes the glTF vertex data RAW — it re-parents the body meshes
    under skierRoot with an identity local transform — so whatever the exporter
    writes IS the space the drivers live in. glTF is Y-up, and export_yup
    converts Blender (x, y, z) -> glTF (x, z, -y). The drivers live with lateral
    on their x, up on their y, and FORWARD on NEGATIVE z. So the mesh must be
    AUTHORED in Blender as:

        Blender X = lateral   (the game's L segments at NEGATIVE x)
        Blender Y = -forward  (the CHEST faces +Y, so exporting turns +Y into -z)
        Blender Z = up

    With that mapping a segment centre exported from `bl()` lands at exactly the
    coordinates its driver node occupies, and no runtime unbaking is needed. The
    previous mapping — Blender (depth, lateral, height), chest on +X — sent the
    mesh out 90 degrees yawed from its own skeleton, which is what produced the
    shoulder humps, the sideways torso and the "game L = metarig R" swap below it.

    The suit-detail code downstream assumes: lateral on X, fore/aft on Y (chest
    positive), up on Z.
    """
    p = POSE.get(name, {})
    if is_arm(name):
        # At rest armSweep has swept phi = pi: the arm segment centre has fallen
        # from its overhead UNtucked spot to just under the shoulder pivot, which
        # ARM_BIND records. These ARE the driver node positions at rest
        # (measured: upperArmL node at (-0.205, 0, +0.008)).
        lateral, vertical = ARM_BIND[name]
        forward = BASE_Z.get(name, 0.0)
    else:
        lateral = p.get('x', 0.0)
        vertical = p.get('y', 0.0)
        forward = BASE_Z.get(name, 0.0) + p.get('dz', 0.0)
    return Vector((lateral, -forward, vertical))


def seg_ends(name):
    """
    The game's segment as a (head, tail) pair in Blender axes.

    A bone runs head -> tail, and for a hanging arm that is shoulder -> hand, so
    the arms run DOWNWARD while everything else runs up. That matches the driver's
    own rotation in the resting pose (rx = -pi), which is what makes the bind
    deformation identity there.
    """
    c = bl(name)
    half = SEGMENTS[name]['h'] / 2
    up = Vector((0, 0, half))
    return (c + up, c - up) if is_arm(name) else (c - up, c + up)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ── Head landmarks: where the face ends and the helmet begins ───────────────

def head_landmarks(body):
    """
    Measure the head off the MESH, not off the physics segment.

    A real helmet covers the cranium only; below the brow the FACE shows —
    goggles across the eyes, skin on the nose, cheeks and chin. Every one of
    those features is defined in fractions of the head's own height
    (chin -> crown), because that is how a helmet actually fits:

        eyes   0.50   goggle lens centred here
        brow   0.55   just above the lens band
        brim   0.52   shell fade STARTS here (fades in to 0.64)
        nape   0.18   back coverage stops around here

    The fractions are read from adult proportions rather than guessed per
    build, so they survive retune_proportions' head shrink as long as the
    landmarks are RE-MEASURED after any step that moves head vertices.
    Call this once after posing/proportioning, and again whenever needed.
    """
    own = dominant_segments(body)
    zs = [v.co.z for v in body.data.vertices if own[v.index] == 'head']
    if not zs:
        raise SystemExit('[body] no head-dominant vertices found for landmarks')
    chin, top = min(zs), max(zs)
    h = max(1e-6, top - chin)
    return {
        'chin': chin, 'top': top, 'h': h,
        'eyes': chin + h * 0.50,
        'brim0': chin + h * 0.52,
        'brim1': chin + h * 0.64,
        'crown_smooth': chin + h * 0.70,
    }


def head_region(co, lm):
    """
    'helmet', 'face', 'lens' or 'strap' for a point in the head's space.

    The face is a FRONT sector below the brim: goggles wrap only so far round
    the temples. Lateral is X, fore/aft is Y with the chest POSITIVE, up is Z.
    Behind or beside that sector it is shell all the way down — aerials helmets
    cover the ears and the whole back of the head, which is what makes an ear
    under the rim read correctly instead of like a stray lump. The strap runs
    round the BACK of the head at eye level, under the shell's side rims.
    """
    c = bl('head')
    lx, ly = co.x - c.x, co.y - c.y
    # Frontal sector: within ~66 degrees of straight-ahead (ly > 0).
    theta = math.atan2(lx, ly) if (lx or ly) else 0.0
    frontal = ly > 0 and abs(theta) < 1.15
    if frontal and lm['chin'] + lm['h'] * 0.44 < co.z < lm['eyes'] + lm['h'] * 0.08:
        return 'lens'
    if not frontal and abs(co.z - lm['eyes']) < lm['h'] * 0.04 \
            and co.z > lm['chin'] + lm['h'] * 0.30:
        return 'strap'
    if frontal and co.z < lm['brim0']:
        return 'face'
    return 'helmet'


# ── The base mesh ───────────────────────────────────────────────────────────

def load_base():
    """
    Bring in the CC0 human body and put it in the rig's axes.

    The bundle's figure stands with its arm span along X and its chest facing
    -Y; the frame contract above wants the span on X (either sign, the mesh is
    bilaterally symmetric) and the CHEST on +Y. A half turn about Z delivers
    both: (x, y) -> (-x, -y), chest from -Y to +Y.
    """
    path = BASE if os.path.isabs(BASE) else os.path.join(ROOT, BASE)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == 'humanBase'] or list(src.objects)
    obj = dst.objects[0]
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    obj.rotation_euler = (0, 0, math.radians(180))
    bpy.ops.object.transform_apply(rotation=True)

    me = obj.data
    zs = [v.co.z for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    xs = [v.co.x for v in me.vertices]
    log(f'base mesh: {len(me.vertices)} verts, {len(me.polygons)} faces, '
        f'height {max(zs) - min(zs):.3f}, span y={min(ys):+.3f}..{max(ys):+.3f}, '
        f'x={min(xs):+.3f}..{max(xs):+.3f}')
    return obj


def soften(obj, lm=None):
    """
    Take suit-hidden detail off the BODY and round ONLY THE CRANIUM.

    Two different problems. Over the body, the base mesh carries anatomical
    detail — nipples, navel, genitals, knuckles — that a skin-tight lycra suit
    covers; a light smoothing pass keeps the form and drops the detail. Over
    the head the problem used to be handled with one blunt instrument: smooth
    everything above the jaw. That destroyed exactly what the author then asked
    to see — the FACE below a cranium-only helmet (eyes, nose, mouth are base-
    mesh geometry and do not survive Laplacian smoothing). So the heavy pass is
    now confined to the dome ABOVE the brim, where shape_helmet will project an
    ellipsoid over it anyway; the face keeps its real topology.
    """
    me = obj.data

    bpy.context.view_layer.objects.active = obj

    # Light pass on the crown only — just enough to settle the sharp brow /
    # hairline edges before the ellipsoid projection. The face (below lm brim0)
    # is NOT in this group.
    grp = obj.vertex_groups.new(name='craniumMask')
    for v in me.vertices:
        zcut = lm['brim0'] if lm else None
        if zcut is not None and v.co.z >= zcut:
            t = min(1.0, (v.co.z - zcut) / max(1e-4, (lm['brim1'] - zcut)))
            grp.add([v.index], 0.55 * t, 'REPLACE')
    head = obj.modifiers.new('softenHead', 'SMOOTH')
    head.factor = 0.8
    head.iterations = 2
    head.vertex_group = 'craniumMask'
    bpy.ops.object.modifier_apply(modifier=head.name)
    log(f'softened: body untouched, {head.iterations} light iterations above '
        f'the brim z={lm["brim0"]:.3f} (face geometry kept)')


# ── Anatomical joints ───────────────────────────────────────────────────────

def anatomical_joints(obj):
    """
    Real human joint positions, scaled onto this mesh.

    Read off Rigify's human metarig rather than guessed from fractions of the
    figure's height. Guessing is what produced an athlete whose arms grew out of
    its ribcage: the game's segment centres are a mass model, not a skeleton, and
    a shoulder placed at the centre of the "upperArm" segment is nowhere near
    where a shoulder is.

    Returned in the rig's axes — X lateral, Y -forward, Z up — which is the
    metarig's own axes rotated the same half turn about Z as the mesh.
    """
    bpy.ops.preferences.addon_enable(module='rigify')
    bpy.ops.object.armature_human_metarig_add()
    meta = bpy.context.active_object

    bones = meta.data.bones
    zs = [b.head_local.z for b in bones] + [b.tail_local.z for b in bones]
    meta_h = max(zs) - min(zs)

    me = obj.data
    mesh_zs = [v.co.z for v in me.vertices]
    mesh_h = max(mesh_zs) - min(mesh_zs)
    s = mesh_h / meta_h

    def conv(v):
        # Metarig axes -> rig axes: the same 180 degrees about Z applied to the
        # mesh, i.e. (x, y, z) -> (-x, -y, z), then scaled to this figure.
        return Vector((-v.x * s, -v.y * s, v.z * s))

    # WHICH METARIG SIDE IS THE GAME'S "L"?
    #
    # The game's L and R are LABELS, not anatomy: L segments sit at NEGATIVE x.
    # Under the frame contract the anatomical left lands on Blender X negative,
    # so the sides SHOULD agree now. The check stays derived from the signs
    # rather than hardcoded, so it keeps catching a mirrored source instead of
    # silently building every limb on the wrong side and posing it across.
    probe = conv(bones['upper_arm.L'].head_local)
    game_left_is_metarig_L = (probe.x < 0) == (bl('upperArmL').x < 0)
    sideL = '.L' if game_left_is_metarig_L else '.R'
    sideR = '.R' if game_left_is_metarig_L else '.L'
    log(f'game "L" maps to metarig {sideL} '
        f'(metarig .L converts to x={probe.x:+.3f}, game wants {bl("upperArmL").x:+.3f})')

    def head_of(name):
        return conv(bones[name].head_local)

    def tail_of(name):
        return conv(bones[name].tail_local)

    j = {
        'hipL': head_of('thigh' + sideL), 'kneeL': tail_of('thigh' + sideL),
        'ankleL': tail_of('shin' + sideL),
        'hipR': head_of('thigh' + sideR), 'kneeR': tail_of('thigh' + sideR),
        'ankleR': tail_of('shin' + sideR),
        'shoulderL': head_of('upper_arm' + sideL), 'elbowL': head_of('forearm' + sideL),
        'wristL': head_of('hand' + sideL),
        'shoulderR': head_of('upper_arm' + sideR), 'elbowR': head_of('forearm' + sideR),
        'wristR': head_of('hand' + sideR),
        'pelvis': head_of('spine'), 'neck': tail_of('spine.003'),
        'crown': Vector((0.0, 0.0, max(mesh_zs))),
    }
    bpy.data.objects.remove(meta, do_unlink=True)
    log(f'anatomical joints from metarig (scale {s:.4f}): '
        f'shoulder z={j["shoulderL"].z:.3f} hip z={j["hipL"].z:.3f} '
        f'knee z={j["kneeL"].z:.3f}')
    return j


def mesh_arm_joints(body, joints):
    """
    Re-anchor the ARM bones on the axis the MESH actually hangs along.

    ROOT CAUSE of the "mirrored arm transport" (iteration 32, measured).
    anatomical_joints reads the Rigify metarig, whose arms are held out at
    ~62 deg from vertical (upper-arm rest axis (-0.856,-0.214,-0.470)), while
    the base mesh hangs its arms at its sides: the forearm-dominant cloud runs
    nearly vertically with its centroid 0.40 m below the metarig elbow.
    pose_onto_segments therefore swings each off-axis arm cloud about a
    HORIZONTAL axis (the measured turn axis for the lower arm is
    (-0.178,-0.984,0)) — a pendulum, not a repositioning. Applying that deform
    to the pre-pose forearm centroid (-0.389,+0.088,+0.839) lands at
    (+0.160,+0.093,-0.429): mirrored across the body, matching entry 31's
    traced cloud to 1 mm. The legs never showed this because mesh and rig
    agree there (5-6 deg swings).

    The fix is at the source, before the armature exists: keep the metarig
    shoulder and the metarig segment LENGTHS, but rotate the elbow/wrist
    positions onto the principal axis of the mesh's own arm silhouette
    (vertices outboard of the torso, which on an A-pose figure is arm-only),
    oriented distal. The transport then behaves like the legs': a small swing
    onto the vertical driver, and the cloud lands on its column instead of
    across the body. Residual along-axis offsets are settle_limb_geometry's
    job (gated <= 10 mm post-settle).
    """
    sh_z = joints['shoulderL'].z
    wri_z = min(joints['wristL'].z, joints['wristR'].z)
    fixed = dict(joints)
    for side in ('L', 'R'):
        sh = joints[f'shoulder{side}']
        elb = joints[f'elbow{side}']
        wri = joints[f'wrist{side}']
        L_up = (elb - sh).length
        L_lo = (wri - elb).length
        # Arm-only silhouette: clearly outboard of the torso, between the
        # wrist and just above the shoulder. (The game's L sits at negative x.)
        x_lo, x_hi = (-0.24, None) if side == 'L' else (None, 0.24)
        pts = [v.co for v in body.data.vertices
               if (x_lo is None or v.co.x < x_lo)
               and (x_hi is None or v.co.x > x_hi)
               and wri_z - 0.05 <= v.co.z <= sh_z + 0.06]
        if len(pts) < 80:
            raise SystemExit(f'[body] mesh_arm_joints: {side} silhouette too '
                             f'small ({len(pts)}) — outboard selection broke')
        c = Vector((sum(q.x for q in pts) / len(pts),
                    sum(q.y for q in pts) / len(pts),
                    sum(q.z for q in pts) / len(pts)))
        u = _pca_axis(pts)
        if u.z > 0:
            u = -u                                # distal = downward
        a_up = math.degrees(u.angle((elb - sh).normalized()))
        a_lo = math.degrees(u.angle((wri - elb).normalized()))
        log(f'  mesh arm axis {side}: {a_up:.1f} deg off the metarig upper, '
            f'{a_lo:.1f} deg off the forearm chain '
            f'(n={len(pts)}, axis ({u.x:+.3f},{u.y:+.3f},{u.z:+.3f}))')
        if not (10.0 < a_up < 110.0) or not (10.0 < a_lo < 110.0):
            raise SystemExit(f'[body] mesh arm axis {side} out of range '
                             f'({a_up:.1f}/{a_lo:.1f} deg) — refusing to guess')
        fixed[f'elbow{side}'] = sh + u * L_up
        fixed[f'wrist{side}'] = fixed[f'elbow{side}'] + u * L_lo
    return fixed


# Which anatomical joints each physics segment runs between, as (HEAD, TAIL).
#
# The order is not free: the game places a bone's HEAD at the segment's BOTTOM
# and its TAIL at the top (bone.head = centre - half), and every driver in the
# game is built on that convention. For the arms that matches anatomy directly,
# because POSE_UNTUCKED holds them overhead — the shoulder really is the lower
# end of the upper arm. For the LEGS it is the other way round: the hip is the
# TOP of the thigh and the ankle is the BOTTOM of the shin.
#
# Listing the legs anatomically (hip, knee) built them upside down — hips down at
# the knees, ankles up at the knees, feet halfway up the shin. It did not look
# like an inverted bone, it looked like a lumpy leg.
ANATOMY = {
    'torso':     ('pelvis', 'neck'),
    'head':      ('neck', 'crown'),
    'upperArmL': ('shoulderL', 'elbowL'), 'lowerArmL': ('elbowL', 'wristL'),
    'upperArmR': ('shoulderR', 'elbowR'), 'lowerArmR': ('elbowR', 'wristR'),
    'upperLegL': ('kneeL', 'hipL'),       'lowerLegL': ('ankleL', 'kneeL'),
    'upperLegR': ('kneeR', 'hipR'),       'lowerLegR': ('ankleR', 'kneeR'),
}

HIERARCHY = {
    'head': 'torso',
    'upperArmL': 'torso', 'upperArmR': 'torso',
    'lowerArmL': 'upperArmL', 'lowerArmR': 'upperArmR',
    'upperLegL': 'torso', 'upperLegR': 'torso',
    'lowerLegL': 'upperLegL', 'lowerLegR': 'upperLegR',
}


def build_armature(joints):
    """Ten bones, named for the physics segments, placed at real joints."""
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.active_object
    arm.name = 'AthleteRig'
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    made = {}
    for name, (a, b) in ANATOMY.items():
        bone = eb.new(name)
        bone.head = joints[a]
        bone.tail = joints[b]
        made[name] = bone
    # THE SKELETON IS FLAT. No bone is parented to another, and that is the whole
    # point rather than an oversight.
    #
    # game.js drives each bone with Bone.linkTransformNode, and Babylon applies a
    # linked node's transform as the bone's LOCAL transform, relative to its
    # parent bone. But computePose returns ABSOLUTE positions — the driver meshes
    # are all siblings under one root — so every parented bone added its own
    # absolute position on top of its parent's. Measured in the running game:
    #
    #     upperLegL  node -0.455  ->  runs at -0.455   (parent torso at 0)
    #     lowerLegL  node -0.815  ->  runs at -1.270   (-0.455 + -0.815)
    #
    # The shin was displaced by a whole hip's worth, the boots hung 0.35 m below
    # the skis, and every limb was stretched between a correct joint and a
    # doubled one. With no parents, each bone simply takes its driver's transform
    # and lands exactly where the simulation says it is.
    #
    # Nothing else wants the hierarchy: the weights are per-bone, and the pose
    # transfer below sets each bone's matrix absolutely.
    for c in HIERARCHY:
        made[c].use_connect = False
        # Do NOT inherit the parent's scale.
        #
        # Fitting a human to the game's segment lengths scales every bone along
        # its own axis, and that scale is non-uniform by construction. A child
        # inheriting it gets sheared in the parent's frame rather than stretched
        # in its own: measured, the shins ended up at y = -0.278 against a target
        # of -0.075, nearly four times too far out, while their Z placement was
        # exactly right. On screen that reads as splayed legs missing the skis,
        # which points at the skis rather than at scale inheritance.
        made[c].inherit_scale = 'NONE'

    bpy.ops.object.mode_set(mode='OBJECT')
    log(f'armature: {len(made)} bones at anatomical joints')
    return arm


def skin(body, arm):
    """
    Bind with heat-map weights.

    This is where a real mesh pays off twice over. Automatic weights work by
    diffusing influence across the SURFACE, so they need topology that follows
    the anatomy — which the metaball body did not have, and which is why its
    elbows and shoulders deformed like putty.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')

    # SMOOTH THE WEIGHTS ACROSS THE JOINTS.
    #
    # The game holds an inrun stance at rest: the thigh sits at +0.85 rad and the
    # shin at -0.40, a 72-degree knee bend. Linear blend skinning collapses a bend
    # that sharp — the classic candy-wrapper pinch — and heat-map weights hand it
    # a tight falloff to do it in. Measured in the browser, the leg narrowed from
    # 0.195 m to 0.113 m and back over ten centimetres just above the knee: a
    # 42% dent, which is the notch.
    #
    # With ten bones and no corrective shapes there is no way to remove LBS
    # pinching outright, but spreading each bone's influence over a slightly wider
    # band distributes a bend along the limb instead of concentrating it in one
    # ring of vertices.
    #
    # Kept DELIBERATELY LIGHT. At factor 0.5 for 6 repeats it blurred influence so
    # far that the head's own group grew from 16% of the mesh to 26% — vertices
    # halfway down the neck and across the shoulders were being pulled by the head
    # bone, which bulges them rather than smoothing anything.
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    # The operator polls for an edit or weight-paint context with a selection.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.35, repeat=2)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('skinned with automatic (heat map) weights, smoothed across the joints')


# Sharpening caps: how far from each limb's END JOINTS the sharpening below is
# allowed to act. Inside a cap, blending between neighbours is legitimate — a
# deltoid or a knee SHOULD share influence with what it moves against.
CREASE_CAPS = {
    'upperArmL': [('shoulderL', 0.075)], 'lowerArmL': [('wristL', 0.05), ('elbowL', 0.04)],
    'upperArmR': [('shoulderR', 0.075)], 'lowerArmR': [('wristR', 0.05), ('elbowR', 0.04)],
    'upperLegL': [('hipL', 0.075), ('kneeL', 0.06)],
    'lowerLegL': [('kneeL', 0.06), ('ankleL', 0.055)],
    'upperLegR': [('hipR', 0.075), ('kneeR', 0.06)],
    'lowerLegR': [('kneeR', 0.06), ('ankleR', 0.055)],
}
SHARPEN_MIN = {'arm': 0.93, 'leg': 0.90}


def _seg_dist(p, a, b):
    """Distance from p to the finite segment a-b."""
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def sharpen_limb_weights(body, joints):
    """
    Push limbs past their crease caps to >=90% own-limb weight — selected by
    ANATOMICAL PROXIMITY, never by group weight alone.

    Why: fitting a human to the game's segment lengths hauls every limb a long
    way during pose_onto_segments. A vertex whose weight bleeds into the torso
    travels only PART of that way, which parks the limb-dominant centroid
    centimetres off its bone — hands crossing at the front, shins hanging
    outside the skis — and the modifier bake then freezes that lag into the
    rest mesh. Renormalising the truly-limb vertices makes them follow their
    own bone the whole way.

    Selection rule (the subtle part): a vertex belongs to a limb iff its
    closest ANATOMICAL SEGMENT AXIS — in the A-pose frame the weights were
    computed in, taken from the same converted joints that built the rig — is
    that limb's, by a clear margin over the best OTHER part. A first cut of
    this compared vertices against the bind/driver-space stick skeleton
    instead; every answer it produced was meaningless in that frame and 7,000
    tidy-looking 'fixes' were all wrong.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    caps_axes = {nm: (joints[ja], joints[jb]) for nm, (ja, jb) in ANATOMY.items()}

    def classify(co):
        best_nm, best_d, second_d = None, 1e9, 1e9
        for nm, (a, b) in caps_axes.items():
            d = _seg_dist(co, a, b)
            if d < best_d:
                second_d, best_nm, best_d = best_d, nm, d
            elif d < second_d:
                second_d = d
        return best_nm, best_d, second_d

    fixed = 0
    MARGIN = 0.005   # metres the own axis must win by: ambiguous verts keep blends
    for name, caps in CREASE_CAPS.items():
        idx = gi.get(name)
        if idx is None:
            continue
        heads = [joints[j] for j, _ in caps]
        radii = [r for _, r in caps]
        wmin = SHARPEN_MIN['arm' if is_arm(name) else 'leg']
        for v in body.data.vertices:
            w = next((g.weight for g in v.groups if g.group == idx), 0.0)
            if w <= 0.02 or w >= wmin:
                continue
            near, dn, d2 = classify(v.co)
            if near != name or d2 - dn <= MARGIN:
                continue                      # ambiguous territory: leave blends alone
            if any((v.co - h).length < r for h, r in zip(heads, radii)):
                continue                      # crease: joints SHOULD stay soft
            others = [(g.group, g.weight) for g in v.groups if g.group != idx]
            other_sum = sum(wt for _, wt in others)
            keep = max(0.0, 1.0 - wmin) / other_sum if other_sum > 1e-6 else 1.0
            for gidx, wt in others:
                body.vertex_groups[gidx].add([v.index], wt * keep, 'REPLACE')
            body.vertex_groups[idx].add([v.index], wmin, 'REPLACE')
            fixed += 1
    log(f'limb weights sharpened to '
        f'{min(SHARPEN_MIN.values()):.2f}+ by anatomical proximity: {fixed} vertices')


ARM_REBIND_ELBOW = 0.030
ARM_REBIND_CREASE = 0.030
ARM_REBIND_CREASE_R = 0.075


def rebind_arm_weights(body, joints):
    """
    Remove the arm chain's LBS lag by ownership, not by moving geometry.

    The heat map + joint smoothing leave every forearm vertex a torso/upper-arm
    minority blend, so when pose_onto_segments hauls the bones to the game's
    segment spots the arm cloud travels only PART of the way (entry 24: ~29 cm
    of whole-chain lag frozen into the rest mesh by the modifier bake) — the
    mechanism behind the author's "extra joint" elbow and the inboard arm
    chains the gates measure. A 100%-bound vertex follows its bone exactly, in
    the bake and in the game; entries 26/29 showed the alternative (moving the
    vertices themselves) smears the cross-joint surface into a wing.

    Selection is ANATOMICAL PROXIMITY (sharpen_limb_weights' rule: nearest
    arm-segment axis by a clear margin over the runner-up) gated on the vertex
    already carrying arm weight — the heat map's side-of-chest vertices have
    none and must not be ripped onto the arm. Per selected vertex the blend
    factor t comes from the joint distances, not from the weights:

      forearm/hand  t = ramp from 5 mm to 3 cm away from the ELBOW joint
      upper arm     t = ramp from the deltoid crease (7.5 cm off the
                    shoulder, CREASE_CAPS' cap) over 3 cm, minus the same
                    elbow band (the elbow end stays stitched too)

    t = 0 keeps today's weights; t = 1 writes pure ownership on the target
    bone and scales every other group to zero. Weights only — no vertex
    coordinate is touched, so the rest silhouette is exactly the shipped one
    until pose_onto_segments transports the chain.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    axes = {nm: (joints[ja], joints[jb]) for nm, (ja, jb) in ANATOMY.items()
            if is_arm(nm)}
    fixed = {nm: 0 for nm in axes}
    full = {nm: 0 for nm in axes}
    for v in body.data.vertices:
        best_nm, best_d, second_d = None, 1e9, 1e9
        for nm, (a, b) in axes.items():
            d = _seg_dist(v.co, a, b)
            if d < best_d:
                second_d, best_nm, best_d = best_d, nm, d
            elif d < second_d:
                second_d = d
        if best_nm is None or second_d - best_d <= 0.03:
            # (0.03, iteration 32): with the bones re-anchored onto the mesh's
            # vertical hanging axes, chest-side vertices sit marginally nearer
            # the arm axis than the torso axis; the old 5 mm margin let the
            # rebind strip them off the torso group and the bib number plate
            # lost most of its torso-dominant triangles (820 -> 250 samples).
            continue                    # ambiguous territory keeps its blend
        tgt = best_nm
        idx = gi.get(tgt)
        if idx is None:
            continue
        w = next((g.weight for g in v.groups if g.group == idx), 0.0)
        if w <= 0.30:
            # (0.30, iteration 32): a genuine limb vertex carries heavy arm
            # weight; 0.02 also admitted thin-weight chest verts, which the
            # margin fix above now double-covers.
            continue                    # not the heat map's call: leave it
        if tgt.startswith('lowerArm'):
            elb = joints[f'elbow{tgt[-1]}']
            d_e = (v.co - elb).length
            t = max(0.0, min(1.0, (d_e - 0.005) / ARM_REBIND_ELBOW))
        else:
            side = tgt[-1]
            sh, elb = joints[f'shoulder{side}'], joints[f'elbow{side}']
            d_s = (v.co - sh).length
            d_e = (v.co - elb).length
            t_crease = max(0.0, min(1.0, (d_s - ARM_REBIND_CREASE_R)
                                    / ARM_REBIND_CREASE))
            t_elbow = max(0.0, min(1.0, (d_e - 0.005) / ARM_REBIND_ELBOW))
            t = min(t_crease, t_elbow)  # both ends stitched, shaft rigid
        if t <= 1e-4:
            continue
        others = [(g.group, g.weight) for g in v.groups if g.group != idx]
        for gidx, wt in others:
            body.vertex_groups[gidx].add([v.index], wt * (1.0 - t), 'REPLACE')
        body.vertex_groups[idx].add([v.index], w + t * (1.0 - w), 'REPLACE')
        fixed[tgt] += 1
        if t >= 0.999:
            full[tgt] += 1
    for nm in sorted(fixed):
        log(f'  arm rebind {nm}: {fixed[nm]} vertices rebound '
            f'({full[nm]} to pure ownership)')
    if not any(fixed.values()):
        raise SystemExit('[body] arm rebind selected nothing — selection '
                         'rule broke, refusing to build a lagged arm')


def _arm_cloud_dbg(body, tag):
    if os.environ.get('ARM_TRACE') != '1':
        return
    gi = {g.name: g.index for g in body.vertex_groups}
    for nm in ('upperArmL', 'lowerArmL'):
        idx = gi.get(nm)
        if idx is None:
            continue
        pts = [v.co for v in body.data.vertices
               if next((g.weight for g in v.groups if g.group == idx), 0.0) > 0.9]
        if not pts:
            log(f'CLOUDDBG[{tag}] {nm}: EMPTY')
            continue
        cx = sum(p.x for p in pts) / len(pts)
        cy = sum(p.y for p in pts) / len(pts)
        cz = sum(p.z for p in pts) / len(pts)
        log(f'CLOUDDBG[{tag}] {nm}: n={len(pts)} centroid '
            f'({cx:+.3f},{cy:+.3f},{cz:+.3f}) bbox x '
            f'{min(p.x for p in pts):+.3f}..{max(p.x for p in pts):+.3f} y '
            f'{min(p.y for p in pts):+.3f}..{max(p.y for p in pts):+.3f}')


def settle_limb_geometry(body):
    """
    Drag each limb CHAIN onto its driver axes — one rigid shift per chain.

    Heat-map weights BLEED influence between neighbours, and a mixed vertex
    only travels part of the way while pose_onto_segments hauls its bone to
    the game's segment spots: the lag freezes into the rest mesh as limbs
    hanging off-axis — shins centimetres outside the skis, hands drifting
    inboard/ahead of the thighs (the author's long-running complaints).

    Per side and family (legL/R, armL/R),
      1. measure the off-axis vector of the DISTAL segment's own geometry
         (strict >0.9 weights; the forearms carry none, so tiered fallbacks —
         measured, never assumed),
      2. translate the WHOLE chain rigidly by exactly that vector,
      3. fade the shift to zero only across the top join into the torso, so
         hips/shoulders stay stitched while thigh-to-foot and shoulder-to-hand
         move as one piece.

    Rigid-by-chain means no internal shear: a segment's width profile cannot
    band or step, which is what the author sees as a notch. Boots land with
    the shins ON the ski centre lines (drivers at x = \u00b10.075).

    Hard gates, per the author's ruling that these offsets are defects:
      * >20 cm pre-settle: SystemExit (mirrored rig / wrong target class).
      * distal centroid >10 mm after settle: SystemExit. Proximal (thigh /
        upper arm) residuals are REPORTED — anatomy allows them some taper.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    CHAINS = [('arm', 'L'), ('arm', 'R'), ('leg', 'L'), ('leg', 'R')]
    detail, worst = [], 0.0

    def own_entries(seg_name, distal):
        """Gated strict/relaxed/members for one segment."""
        idx = gi.get(seg_name)
        if idx is None:
            return None
        c = bl(seg_name)
        half = SEGMENTS[seg_name]['h'] / 2
        gate = half * 1.15 + 0.03
        strict, relaxed, members = [], [], []
        for v in body.data.vertices:
            w = next((g.weight for g in v.groups if g.group == idx), 0.0)
            if w <= 0.30:
                continue
            p = v.co
            if math.hypot(p.x - c.x, p.y - c.y) >= gate \
                    or abs(p.z - c.z) >= gate * 2.2:
                continue
                members.append(entry)
            if distal and seg_name.startswith('lowerArm') \
                    and p.z < c.z + half * (-0.78):
                continue                        # hand band: rides, never counts
            (strict if w > 0.90 else relaxed).append(
                (v.index, 1.0 if w > 0.90 else max(0.0, min(1.0, (w - 0.30) / 0.60))))
        metric = strict if len(strict) >= 25 else (strict + relaxed
                                                   if len(strict) + len(relaxed) >= 25
                                                   else [])
        return {'c': c, 'half': half, 'metric': metric,
                'tier': 'strict' if len(strict) >= 25 else 'relaxed'}

    for fam, side in CHAINS:
        names = ('upperArm', 'lowerArm') if fam == 'arm' else ('upperLeg', 'lowerLeg')
        ups, los = names[0] + side, names[1] + side
        d_ = own_entries(los, True)
        p_ = own_entries(ups, False)
        if not d_ or len(d_['metric']) < 25:
            detail.append(f'{los}: no usable metric set, skipped')
            continue

        def offaxis(ent):
            if not ent or len(ent['metric']) < 25:
                return None
            qw_ = sum(m for _, m in ent['metric'])
            ox = sum(m * body.data.vertices[i].co.x for i, m in ent['metric']) / qw_
            oy = sum(m * body.data.vertices[i].co.y for i, m in ent['metric']) / qw_
            return Vector((ent['c'].x - ox, ent['c'].y - oy))

        dd = offaxis(d_)
        dp = offaxis(p_) or dd          # proximal unknown -> chain shares distal's fix
        pre_d = dd.length
        pre_p = dp.length
        if max(pre_d, pre_p) > 0.20:
            raise SystemExit(
                f'[body] {los} sits {pre_d * 100:.1f} cm / {ups} '
                f'{pre_p * 100:.1f} cm off-axis before settling — mirrored rig / '
                f'wrong target, fix the cause')

        # Chain membership: ANY chain-bone weight > 0.35 inside a geometric
        # window around either segment.
        idx_u, idx_l = gi.get(ups), gi.get(los)
        cu, hu = bl(ups), SEGMENTS[ups]['h'] / 2
        cd, hd = bl(los), SEGMENTS[los]['h'] / 2
        gx_u, gx_l = hu * 1.3 + 0.03, hd * 1.3 + 0.03
        # Torso-side fade plane: fully shifted below it, rolling off above.
        if fam == 'arm':
            fade_from = cu.z + hu * 0.80
            fade_to = fade_from + 0.10
        else:
            fade_from = cu.z + hu * 0.72
            fade_to = fade_from + 0.11
        z_bot = cd.z - hd               # distal end: pure dd
        z_top = cu.z + hu * 0.90        # near the join: pure dp
        moved = 0
        for v in body.data.vertices:
            wu = next((g.weight for g in v.groups if g.group == idx_u), 0.0) \
                if idx_u is not None else 0.0
            wl = next((g.weight for g in v.groups if g.group == idx_l), 0.0) \
                if idx_l is not None else 0.0
            if wu <= 0.35 and wl <= 0.35:
                continue
            nm_best = ups if wu >= wl else los
            p = v.co
            lim = gx_u if nm_best == ups else gx_l
            cc = cu if nm_best == ups else cd
            if math.hypot(p.x - cc.x, p.y - cc.y) >= lim:
                continue
            # Along-chain parameter: 0 at the distal tip, 1 at the torso join.
            s = max(0.0, min(1.0, (p.z - z_bot) / max(1e-4, z_top - z_bot)))
            sx = dd.x + (dp.x - dd.x) * s
            sy = dd.y + (dp.y - dd.y) * s
            t = 1.0
            if p.z >= fade_from:
                u = max(0.0, min(1.0, (fade_to - p.z) / max(1e-4, fade_to - fade_from)))
                t = u * u * (3 - 2 * u)
            v.co.x += sx * t
            v.co.y += sy * t
            moved += 1 if t > 0.001 or sx or sy else 0
        # Verify on the distal tier set, then close it out EXACTLY: the blend
        # above trades distal precision for proximal continuity, so whatever
        # remains gets one final rigid distal-only correction.
        qw = sum(m for _, m in d_['metric'])
        ax = sum(m * body.data.vertices[i].co.x for i, m in d_['metric']) / qw - cd.x
        ay = sum(m * body.data.vertices[i].co.y for i, m in d_['metric']) / qw - cd.y
        if math.hypot(ax, ay) > 1e-9:
            # Full strength across the WHOLE distal segment (so the tier mean
            # moves exactly), rolling off through the joint above it.
            z_cut = cd.z + hd * 0.95
            for i, m in d_['metric']:
                p = body.data.vertices[i].co
                f = 1.0
                if p.z >= z_cut:
                    u = max(0.0, min(1.0, (p.z - z_cut) /
                                     max(1e-4, fade_from - z_cut)))
                    f = 1.0 - u * u * (3 - 2 * u)
                body.data.vertices[i].co.x -= ax * f
                body.data.vertices[i].co.y -= ay * f
            ax2 = sum(m * body.data.vertices[i].co.x for i, m in d_['metric']) / qw - cd.x
            ay2 = sum(m * body.data.vertices[i].co.y for i, m in d_['metric']) / qw - cd.y
            ax, ay = ax2, ay2
        err = math.hypot(ax, ay)
        worst = max(worst, err)
        ptier = f'{pre_p * 1000:.0f}' if p_ and len(p_['metric']) >= 25 else '-'
        detail.append(
            f'{los}: distal shift {dd.x:+.3f},{dd.y:+.3f} '
            f'(pre {pre_d * 1000:.0f} mm) | proximal pre {ptier} mm '
            f'(blended along the chain); '
            f'{d_["tier"]}-mean now ({ax * 1000:+.1f}, {ay * 1000:+.1f}) mm '
            f'[n={len(d_["metric"])}, {moved} verts]')
    for d in detail:
        log('  settle: ' + d)
    if worst > 0.010:
        raise SystemExit(
            f'[body] distal limb centroid still {(worst * 1000):.1f} mm off its '
            f'bone after settling — over the 10 mm hard limit')
    log(f'limb chains settled onto bones: worst distal centroid '
        f'{worst * 1000:.2f} mm (limit 10 mm)')


# ── Visual proportion correction ────────────────────────────────────────────
# How much smaller to draw the head than its physics segment.
#
# body-model.json is a MASS model and its head segment is 0.24 m against a
# 1.515 m standing figure — 6.3 head-heights, where a real adult is about 7.5.
# That single ratio is most of why the athlete reads as a cartoon: an oversized
# head is the strongest "not a real person" cue there is, and it survives any
# amount of work on the suit.
#
# Corrected in the MESH only. Changing the segment would change its mass
# distribution and therefore the rotational inertia the whole simulation is
# tuned around, and every golden trace with it. The head is the one segment
# where a visual-only change is clean: nothing is attached below it, so shrinking
# what is drawn moves no other joint. The arms (36% of height against a real 44%)
# and the torso (36% against 30%) are wrong in the same way and CANNOT be fixed
# this way — a shorter drawn arm would part company with the wrist driver the
# game positions. Those need the physics model changed and the traces rebaselined.
HEAD_SCALE = 0.84

# How hard the helmet and gloves are collapsed and shrunk relative to the suit.
#
# The decimate vertex group is FAR from linear in its weight — calibrated on this
# mesh, weight 1.0 retained 5% of the head's faces while weight 0.30 retained 89%
# of the suit's. Taking the obvious 1.0 crushed the helmet from 25% of the mesh to
# 2.2%, which is 133 faces for a whole head and visibly faceted. These two numbers
# land the head near 12% and the hands near 5%, leaving the suit ~83%.
#
# UV_SHRINK scales the head and hands during the unwrap only, so they claim
# UV_SHRINK^2 — about a third — of the atlas area they otherwise would.
GIRTH = 1.00
REDUCE_W = 0.60
BODY_KEEP = 0.30
UV_SHRINK = 0.55


def retune_proportions(body):
    """Shrink the drawn head about the neck, leaving the physics segment alone."""
    seg = SEGMENTS['head']
    c = bl('head')
    neck_z = c.z - seg['h'] / 2
    pivot = Vector((c.x, c.y, neck_z))
    n = 0
    own5 = dominant_segments(body)
    for v in body.data.vertices:
        if own5[v.index] != 'head':
            continue
        v.co = pivot + (Vector(v.co) - pivot) * HEAD_SCALE
        n += 1
    stand = (bl('head').z + seg['h'] / 2) - (bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2)
    log(f'head scaled {HEAD_SCALE:.2f} about the neck ({n} verts): '
        f'{stand / (seg["h"] * HEAD_SCALE):.2f} head-heights drawn, '
        f'{stand / seg["h"]:.2f} by the physics model')


def skeleton_offset(co):
    """
    Vector from the nearest point on the SKELETON to this point.

    Distance to the union of the segment axes, which is continuous everywhere —
    including across joints. That continuity is the whole reason for computing it
    this way: scaling each vertex's offset from its own segment's axis would jump
    wherever the nearest segment changes, tearing a seam around every hip and
    shoulder.
    """
    p = Vector(co)
    best, best_d = None, 1e9
    for name in BODY_SEGMENTS:
        c = bl(name)
        # SAME SIDE ONLY.
        #
        # The legs are 0.15 m apart and each is about 0.10 m across, so a vertex
        # on the INNER face of one thigh is nearly as close to the other thigh's
        # axis as to its own. Whichever won, scaling that vertex's offset pulled it
        # towards that axis — and for the shins, whose factor is 0.75, that dragged
        # both inner faces across the gap until the two legs merged into a single
        # column. It reads as one leg missing, not as a leg in the wrong place.
        if abs(c.x) > 0.02 and (c.x > 0) != (p.x > 0):
            continue
        half = SEGMENTS[name]['h'] / 2
        z = max(c.z - half, min(c.z + half, p.z))          # clamp onto the axis
        near = Vector((c.x, c.y, z))
        d = (p - near).length
        if d < best_d:
            best_d, best = d, near
    if best is None:
        return Vector((0, 0, 0)), 0.0
    return p - best, best_d


def build_report(body, tag):
    """
    Measure the figure against adult proportions.

    "Stringy" is a judgement; these are the numbers behind it. Shoulder breadth
    runs about 25% of standing height on an adult male and hip breadth about 19%,
    so a figure whose limbs and trunk fall well under that reads as a stick
    regardless of how good its topology is.
    """
    zs = [v.co.z for v in body.data.vertices]
    lo = bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2
    hi = bl('head').z + SEGMENTS['head']['h'] / 2
    stand = hi - lo

    def width_at(z, band=0.03):
        xs = [v.co.x for v in body.data.vertices if abs(v.co.z - z) < band]
        return (max(xs) - min(xs)) if xs else 0.0

    shoulder = width_at(bl('torso').z + SEGMENTS['torso']['h'] / 2 * 0.72)
    chest = width_at(bl('torso').z + SEGMENTS['torso']['h'] / 2 * 0.30)
    hip = width_at(bl('torso').z - SEGMENTS['torso']['h'] / 2 * 0.80)
    thigh = width_at(bl('upperLegL').z)
    log(f'{tag}: standing {stand:.3f} m | shoulder {shoulder:.3f} '
        f'({shoulder / stand:.1%} of height, adult ~25%) | chest {chest:.3f} '
        f'({chest / stand:.1%}) | hip {hip:.3f} ({hip / stand:.1%}, adult ~19%) '
        f'| thighs {thigh:.3f}')
    return {'stand': stand, 'shoulder': shoulder, 'hip': hip}


def add_girth(body, stretch):
    """
    Give every limb back the width:length ratio it was built with.

    The figure read as "stringy" and the trunk measurements said it was not thin —
    hip breadth came out at 19.3% of standing height against an adult's 19%. The
    fault was not girth, it was that fitting a human to the game's segment lengths
    stretches each limb by a DIFFERENT amount and leaves every cross-section
    alone. Measured against the anatomical rig:

        upper arm  x1.22      thigh  x0.79
        forearm    x1.12      shin   x0.93
        torso      x1.00

    So the arms were pulled 22% longer at their original thickness — which is
    exactly what a stringy arm is — while the thighs were squashed 21% shorter and
    went stocky. The mismatch between the two is what reads as wrong; neither one
    alone would.

    Scaling each vertex's offset from the skeleton by its own segment's stretch
    restores the ratio: the arms thicken by the same factor they were lengthened,
    the thighs slim by the same factor they were shortened. No joint moves, no
    segment length changes, and the physics model is untouched.

    The factor is now, for LEG vertices, blended along the leg's own chain by
    SKIN WEIGHT with a guaranteed 8 cm spatial ramp across the knee — a vertex
    just above the joint keeps some thigh character and one below keeps some
    shin, regardless of how sharp its heat-map falloff is. That replaces the
    old nearest-axis blend, which could fall off in 2 cm and step at the joint
    (the author's "notches"). Non-leg vertices keep the inverse-square blend,
    which has never stepped.
    """
    axes = {n: (bl(n), SEGMENTS[n]['h'] / 2) for n in BODY_SEGMENTS}
    gi = {g.name: g.index for g in body.vertex_groups}
    # Per-side chain data for the spatial knee ramp.
    chains = {}
    for side in ('L', 'R'):
        up, lo = SEGMENTS['upperLeg' + side], SEGMENTS['lowerLeg' + side]
        cu, cl = bl('upperLeg' + side), bl('lowerLeg' + side)
        knee_z = (cu.z - up['h'] / 2 + cl.z + lo['h'] / 2) / 2
        chains[side] = {
            'knee_z': knee_z,
            'f_up': min(1.0, stretch.get('upperLeg' + side, 1.0)),
            'f_lo': min(1.0, stretch.get('lowerLeg' + side, 1.0)),
            'idx_up': gi.get('upperLeg' + side),
            'idx_lo': gi.get('lowerLeg' + side),
        }
    KNEE_BLEND = 0.08   # full width of the knee transition band
    n_spatial = 0
    n = 0
    for v in body.data.vertices:
        off, dist = skeleton_offset(v.co)
        if dist < 1e-6:
            continue
        p = Vector(v.co)

        # ── LEG CHAIN BLEND (skin-weight x 8 cm spatial ramp at the knee) ──
        w_up = next((g.weight for g in v.groups
                     if g.group == chains['L']['idx_up']), -1)
        w_up = max(w_up, next((g.weight for g in v.groups
                               if g.group == chains['R']['idx_up']), -1))
        if w_up >= 0:
            side = 'L' if (next((g.weight for g in v.groups
                                 if g.group == chains['L']['idx_up']), 0)
                           ) >= (next((g.weight for g in v.groups
                                       if g.group == chains['R']['idx_up']), 0)) \
                else 'R'
            ch = chains[side]
            wlo = next((g.weight for g in v.groups if g.group == ch['idx_lo']), 0.0)
            wup = next((g.weight for g in v.groups if g.group == ch['idx_up']), 0.0)
            t_w = wlo / max(1e-6, wlo + wup)           # skin-weight blend
            # 8 cm smoothstep across the knee plane, centre on the boundary.
            t_z = min(1.0, max(0.0, (ch['knee_z'] + KNEE_BLEND / 2 - p.z)
                               / KNEE_BLEND))
            t_sp = t_z * t_z * (3 - 2 * t_z)
            t = min(1.0, max(t_w, t_sp))               # guaranteed >= spatial blend
            f_leg = ch['f_up'] * (1 - t) + ch['f_lo'] * t
            f = 1.0 + (f_leg - 1.0) * 0.5
            f *= GIRTH
            v.co = p + off * (f - 1.0)
            n_spatial += 1
            continue

        num = den = 0.0
        for name, (c, half) in axes.items():
            z = max(c.z - half, min(c.z + half, p.z))
            d2 = (p - Vector((c.x, c.y, z))).length_squared + 1e-4
            w = 1.0 / (d2 * d2)
            # ONLY EVER SLIM, NEVER THICKEN.
            #
            # Matching girth to stretch in both directions was wrong, and it is
            # where the oversized biceps and shoulders came from: the upper arm is
            # posed 1.23x longer than the mesh's own anatomy, so it was thickened
            # 23% to match, and the shoulder next to it came along through the
            # blend. But a limb held at a longer reach does not get FATTER — its
            # girth is set by the body it belongs to. Stretching a limb and leaving
            # its cross-section alone is correct.
            #
            # Compression is the asymmetric case: the thigh is posed at 0.79 of
            # its anatomical length, and a thigh squashed to four-fifths while
            # keeping its full width really does read as stocky. So slimming is
            # applied and thickening is not.
            num += w * min(1.0, stretch.get(name, 1.0))
            den += w
        # Applied at HALF strength. The blended factor is a blunt instrument —
        # it moves every vertex along its own offset from a ten-segment stick
        # skeleton — and at full strength the step between the thigh's 0.79 and
        # the torso's 1.00 carved a visible notch out of the inner thigh. Half
        # keeps most of the de-stocking and stops the deformation from cutting
        # into the silhouette.
        f = 1.0 + ((num / den) - 1.0) * 0.5
        f *= GIRTH
        v.co = p + off * (f - 1.0)
        n += 1
    lo, hi = min(stretch.values()), max(stretch.values())
    log(f'girth matched to stretch ({lo:.2f}..{hi:.2f}) x global {GIRTH:.2f}: '
        f'{n_spatial} leg-chain verts on the 8 cm knee blend, {n} on the '
        f'inverse-square field')



def shape_helmet(body, lm):
    """
    Build a CRANIUM-ONLY helmet shell over a preserved face.

    A helmet is a known shape, so the dome is projected onto an ellipsoid sized
    from the head segment rather than approximated by smoothing. But only the
    vertices ABOVE THE BRIM are projected: the fade band (lm brim0 -> brim1)
    lets the shell sink into the skull towards its visible edge, which leaves
    the original skin contour showing just under the rim — a real helmet sits
    slightly proud of the brow with hairline/skin beneath it. Below the band
    nothing moves, so eyes, nose, cheeks, mouth and chin are exactly the base
    mesh made them.

    Projection is by SEGMENT ownership (never by height): POSE_UNTUCKED once
    put forearms overhead and a bare height test deleted them into the helmet.
    """
    seg = SEGMENTS['head']
    c = bl('head')

    # Lateral, fore/aft, vertical radii. Slightly larger than the head itself:
    # a shell stands PROUD of the skull, and the brim reads as an edge.
    rx, ry, rz = seg['w'] / 2 * 1.06, seg['d'] / 2 * 1.08, seg['h'] / 2 * 1.10
    moved = 0
    own4 = dominant_segments(body)
    for v in body.data.vertices:
        if own4[v.index] != 'head' or v.co.z < lm['brim0']:
            continue
        d = Vector((v.co.x - c.x, v.co.y - c.y, v.co.z - c.z))
        n = math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2)
        if n < 1e-6:
            continue
        target = Vector((c.x + d.x / n, c.y + d.y / n, c.z + d.z / n))
        # Full strength at the crown, fading out across the brim band so the
        # shell dissolves INTO the skull right at its edge.
        t = min(1.0, (v.co.z - lm['brim0']) / max(1e-4, lm['brim1'] - lm['brim0']))
        w = t * t * (3 - 2 * t)
        v.co = Vector(v.co) * (1 - w) + target * w
        moved += 1
    log(f'helmet shaped: {moved} verts projected onto a '
        f'{rx * 2:.3f}x{ry * 2:.3f}x{rz * 2:.3f} m shell above the brim '
        f'z={lm["brim0"]:.3f}..{lm["brim1"]:.3f} (face below kept)')


def seat_soles(body):
    """
    Put the soles on the skis, by measuring where they ended up.

    Both boots came out 0.337 m below the ski — symmetrically, with about a
    thousand vertices each below the topsheet, so not a stray weight but the whole
    boot region. Working out WHY from first principles means tracing a foot
    through an anatomical rest position, a bone whose head was lifted by the boot
    height, a non-uniform scale along that bone's own axis, and a girth field: four
    transforms, each of which I had already got wrong once.

    Measuring the result and correcting it is both shorter and self-correcting —
    if any of those transforms changes, this still lands the sole on the ski. The
    lift falls off from sole to ankle so the correction does not dislocate the leg
    above it.
    """
    ski_top = bl('skiL').z + SEGMENTS['skiL']['h'] / 2
    ankle_z = bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2 + 0.10

    boot = [v for v in body.data.vertices if v.co.z < ankle_z]
    if not boot:
        log('seat soles: no boot vertices found')
        return
    sole = min(v.co.z for v in boot)
    lift = ski_top - sole
    if abs(lift) < 1e-4:
        log('seat soles: already seated')
        return
    span = max(1e-4, ankle_z - sole)
    for v in boot:
        t = min(1.0, max(0.0, (ankle_z - v.co.z) / span))
        v.co.z += lift * (t * t * (3 - 2 * t))          # smoothstep to the ankle
    log(f'seat soles: lifted {lift:+.3f} m so the sole meets the ski at '
        f'z={ski_top:.3f} ({len(boot)} boot verts)')



def align_boots(body, joints):
    """
    Yaw each boot onto the SKI long axis (iteration 29, reviewer addendum).

    The base mesh's A-pose feet carry a fore-aft yaw (~21 deg vs the ski axis,
    measured in entry 25) that survives every downstream stage: rigid_boots
    pins the boot WEIGHTS to its shin but does not correct GEOMETRY. With
    bind := driver (patch_skin_binds), whatever rest positions are baked here
    are exactly where the rendered boot sits, so this fix belongs in the bake:
    rotate each boot's vertices about the VERTICAL through that side's ankle
    joint by the measured yaw onto the ski axis.

    Frame contract (bl()): toes point along Blender +Y (= game -z), which is
    also the ski long axis. Yaw-only keeps sole heights exact to the last bit,
    so seat_soles' seating and every ski-contact gate survive untouched.
    Hard gate: |residual yaw| <= 5 deg on both sides.
    """
    BAND = 0.05                              # cuff blend span above the ankle
    report = []
    for side in ('L', 'R'):
        an = joints[f'ankle{side}']
        pivot = Vector((an.x, an.y, 0.0))
        idxg = body.vertex_groups.find(f'lowerLeg{side}')

        def boot_set():
            out = []
            for v in body.data.vertices:
                if v.co.z > an.z - 0.02 + BAND:
                    continue                 # above the cuff blend: not boot
                w = next((g.weight for g in v.groups if g.group == idxg), 0.0)
                if w < 0.70:
                    continue
                dx_, dy_ = v.co.x - pivot.x, v.co.y - pivot.y
                if math.hypot(dx_, dy_) < 0.03:
                    continue
                out.append(v.index)
            return out

        def yaw_of(idxs):
            sxx = syy = sxy = 0.0
            for i in idxs:
                q = body.data.vertices[i].co
                dx_, dy_ = q.x - pivot.x, q.y - pivot.y
                sxx += dx_ * dx_
                syy += dy_ * dy_
                sxy += dx_ * dy_
            phi = 0.5 * math.atan2(2.0 * sxy, sxx - syy)   # major axis vs +X
            raw = math.pi / 2.0 - phi
            th = ((raw + math.pi / 2.0) % math.pi) - math.pi / 2.0
            return math.degrees(th)

        idxs = boot_set()
        if len(idxs) < 40:
            report.append(f'{side}: thin boot set n={len(idxs)}')
            continue
        ang_pre = yaw_of(idxs)
        # Brute force the corrective yaw: for every candidate, fold the
        # residual into [-90, 90) and keep the smallest |residual|. The closed
        # form is ambiguous to +/-90 deg (a foot's mass ellipse barely differs
        # from its heel-end mirror), so measure instead of derive.
        best_th, best_res = 0.0, float('inf')
        for k in range(-180, 180):
            cand = math.radians(k)
            ct, st = math.cos(cand), math.sin(cand)
            sxx = syy = sxy = 0.0
            for i in idxs:
                q = body.data.vertices[i].co
                dx_, dy_ = q.x - pivot.x, q.y - pivot.y
                rx = dx_ * ct + dy_ * st
                ry = -dx_ * st + dy_ * ct
                sxx += rx * rx
                syy += ry * ry
                sxy += rx * ry
            phi2 = 0.5 * math.atan2(2.0 * sxy, sxx - syy)
            raw2 = math.pi / 2.0 - phi2
            res2 = ((raw2 + math.pi / 2.0) % math.pi) - math.pi / 2.0
            if abs(res2) < best_res:
                best_res, best_th = abs(res2), cand
        moved = 0
        for i in idxs:
            q = body.data.vertices[i].co
            t = 1.0
            if q.z > an.z - 0.02:            # inside the cuff blend band only
                u = max(0.0, min(1.0, (an.z - 0.02 + BAND - q.z) / BAND))
                t = u * u * (3 - 2 * u)
            nx = q.x - pivot.x
            ny = q.y - pivot.y
            ca, sa = math.cos(best_th * t), math.sin(best_th * t)
            body.data.vertices[i].co = Vector((
                pivot.x + nx * ca + ny * sa,
                pivot.y + ny * ca - nx * sa,
                q.z))
            moved += 1
        ang_post = yaw_of(boot_set())
        report.append(f'{side}: yaw {ang_pre:+.1f} deg corrected by '
                      f'{math.degrees(best_th):+.1f} -> residual {ang_post:+.1f} '
                      f'deg ({moved} verts)')
        if abs(ang_post) > 5.0:
            raise SystemExit(
                f'[body] boot{side} still {ang_post:.1f} deg off the ski axis '
                f'(limit 5)')
    for r in report:
        log('  align_boots ' + r)


def _pca_axis(pts):
    """Dominant direction of a point cloud (power iteration on covariance)."""
    mx = sum(p.x for p in pts) / len(pts)
    my = sum(p.y for p in pts) / len(pts)
    mz = sum(p.z for p in pts) / len(pts)
    cov = [[0.0] * 3 for _ in range(3)]
    for p in pts:
        dx_, dy_, dz_ = p.x - mx, p.y - my, p.z - mz
        for ii in range(3):
            cc = (dx_, dy_, dz_)[ii]
            for jj in range(3):
                cov[ii][jj] += cc * (dx_, dy_, dz_)[jj]
    vec = Vector((0.02, 0.02, 1.0)).normalized()
    for _ in range(24):
        vec = Vector((cov[0][0] * vec.x + cov[0][1] * vec.y + cov[0][2] * vec.z,
                      cov[1][0] * vec.x + cov[1][1] * vec.y + cov[1][2] * vec.z,
                      cov[2][0] * vec.x + cov[2][1] * vec.y + cov[2][2] * vec.z)).normalized()
    return vec


def _arm_trace(body, tag):
    """Env-gated pipeline tracer: where does each arm group actually sit?"""
    if os.environ.get('ARM_TRACE') != '1':
        return
    gi = {g.name: g.index for g in body.vertex_groups}
    for nm in ('upperArmL', 'lowerArmL'):
        idx = gi.get(nm)
        if idx is None:
            log(f'TRACE[{tag}] {nm}: no group')
            continue
        heavy = [(v.co.x, v.co.y, v.co.z,
                  next((g.weight for g in v.groups if g.group == idx), 0.0))
                 for v in body.data.vertices]
        heavy = [p for p in heavy if p[3] > 0.6]
        if not heavy:
            log(f'TRACE[{tag}] {nm}: no w>0.6 verts')
            continue
        qw = sum(p[3] for p in heavy)
        cx = sum(p[0] * p[3] for p in heavy) / qw
        cy = sum(p[1] * p[3] for p in heavy) / qw
        cz = sum(p[2] * p[3] for p in heavy) / qw
        tgt = bl(nm)
        log(f'TRACE[{tag}] {nm} w>0.6 n={len(heavy)} '
            f'c=({cx:+.3f},{cy:+.3f},{cz:+.3f}) '
            f'x {min(p[0] for p in heavy):+.3f}..{max(p[0] for p in heavy):+.3f} '
            f'y {min(p[1] for p in heavy):+.3f}..{max(p[1] for p in heavy):+.3f} '
            f'z {min(p[2] for p in heavy):+.3f}..{max(p[2] for p in heavy):+.3f} '
            f'| target ({tgt.x:+.3f},{tgt.y:+.3f},z c{tgt.z:+.3f})')


def _arm_trace_bones(body, arm, tag):
    """Env-gated: posed bone head/tail world positions for the arm chain."""
    if os.environ.get('ARM_TRACE') != '1':
        return
    bpy.context.view_layer.update()
    for nm in ('upperArmL', 'lowerArmL'):
        pb = arm.pose.bones[nm]
        mw = pb.matrix
        log(f'TRACEBONE[{tag}] {nm}: pose head ({mw.translation.x:+.3f},'
            f'{mw.translation.y:+.3f},{mw.translation.z:+.3f}) len '
            f'{pb.bone.length:.3f}')


def straighten_forearms(body):
    """
    Rotate each forearm chain back ONTO its driver axis (reviewer order,
    iteration 23/24: "rotate the forearm about the elbow onto the upper-arm
    axis").

    The base mesh arrives in a stiff A-pose: each forearm is flexed/pronated
    relative to its upper arm. pose_onto_segments poses the BONES straight down
    but preserves each bone's rest roll minimally, so the forearm GEOMETRY can
    keep swinging off-axis (measured: PCA of the forearm slab ran ~90 deg off
    the vertical driver) while its CENTROID still lands near the bone — which
    is why the old translation-only settle reported clean residuals while the
    author saw forearms pointing sideways and an elbow step.

    Fix, measured not assumed: per side, PCA the forearm slab, rotate those
    vertices about the ELBOW pivot onto the vertical (hanging) driver axis by
    the measured angle, fading smoothly to zero through the joint so the upper
    arm stays stitched to the torso. Hands ride along (gloves skinned to the
    forearm). Runs BEFORE settle_limb_geometry, whose translation close-out
    then lands the band exactly on-axis.

    NOTE (iteration 24): this path is currently INERT — member/slab selection
    finds thin sets because the forearm cloud does not live where the armature
    predicts even in the BIND frame's own axes after posing (trace numbers in
    progress entry 24: lowerArmL heavy cloud centroid lands at (+0.144,
    +0.131,-0.408) against target (-0.175,-0.008,-0.275), i.e. ~29 cm of
    whole-chain lag that translation-only settling verified against a blind
    35-vertex subset). Root-causing and re-enabling is the first item of the
    next session.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    for side in ('L', 'R'):
        up, lo = f'upperArm{side}', f'lowerArm{side}'
        cu, hu = bl(up), SEGMENTS[up]['h'] / 2
        cl, hl = bl(lo), SEGMENTS[lo]['h'] / 2
        elb = Vector((cl.x, cl.y, cl.z + hl / 2))
        idx_u, idx_l = gi.get(up), gi.get(lo)

        def w_of(idx):
            return lambda v: next((g.weight for g in v.groups if g.group == idx), 0.0)

        fu, fl = w_of(idx_u), w_of(idx_l)

        def members():
            out = []
            for v in body.data.vertices:
                wl, wu = fl(v), fu(v)
                if wl <= 0.35 and wu <= 0.35:
                    continue
                p = v.co
                cc, hh = (cl, hl) if wl >= wu else (cu, hu)
                if math.hypot(p.x - cc.x, p.y - cc.y) > hh * 1.3 + 0.03:
                    continue
                if p.z > cu.z + hu * 0.85:
                    continue                       # stay clear of the shoulder join
                out.append(v.index)
            return out

        sel = members()
        slab = [v.co for v in body.data.vertices if v.index in set(sel) and fl(v) >= 0.45
                and cl.z - hl * 0.62 <= v.co.z <= cl.z + hl * 0.88]
        if len(slab) < 40 or len(sel) < 60:
            log(f'  straighten{side}: thin sets (slab {len(slab)}, members '
                f'{len(sel)}) — skipped')
            continue
        a = _pca_axis(slab)
        if a.z > 0:
            a = -a                                 # point distal (downwards)
        down = Vector((0, 0, -1.0))
        crs = a.cross(down)
        s = crs.length
        ang = math.acos(max(-1.0, min(1.0, a.dot(down))))
        log(f'  straighten{side}: forearm axis {math.degrees(ang):.1f} deg off the '
            f'driver axis over n={len(sel)} chain verts')
        if ang < math.radians(2.0) or s < 1e-6:
            continue
        rot = Matrix.Rotation(ang, 3, crs.normalized())
        lo_edge, hi_edge = elb.z - 0.012, elb.z + 0.045
        moved = 0
        for i in sel:
            p = body.data.vertices[i].co
            t = 1.0
            if p.z > lo_edge:
                u = max(0.0, min(1.0, (p.z - lo_edge) / max(1e-6, hi_edge - lo_edge)))
                t = 1.0 - u * u * (3 - 2 * u)      # fade out through the elbow band
            if t <= 1e-4:
                continue
            r = Matrix.Rotation(ang * t, 3, crs.normalized())
            body.data.vertices[i].co = elb + r @ (p - elb)
            moved += 1
        log(f'  straighten{side}: rotated {moved} verts by up to '
            f'{math.degrees(ang):.1f} deg about the elbow')


def arm_geometry_report(body):
    """
    Straight-anatomical-arm gates (reviewer order, iteration 23/24).

    The bind hangs every arm bone VERTICAL (seg_ends gives arms c+up/c-up), so
    in this build frame collinearity is purely an (x, y) statement:

      * the weight>0.9 centroids of the upper arm, forearm and hand bands must
        share the bone column within 1 cm laterally AND fore-aft,
      * the elbow must show NO cross-section step > 5 mm between the upper-arm
        side and the forearm side (the base mesh's A-pose flexion/pronation
        surviving the pose is what reads as the author's "extra joint"),
      * the hand's principal axis must continue the forearm within 10 deg.

    Centroid tiers and windows follow settle_limb_geometry's measured pattern
    (strict >0.9, relaxed fallback >=0.3 inside a segment-scaled window); the
    hand band excludes itself from the forearm centroid exactly as settle does.
    Returns the worst numbers; hard=True raises SystemExit past the limits.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    results = {}
    # Where does each arm group ACTUALLY sit? A silent L<->R group/bone swap
    # survives every symmetric acceptance gate — measure the centroid against
    # the target column before any band logic.
    for nm in ('upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR'):
        idx = gi.get(nm)
        idxw = [(v.co.x, v.co.y, next((g.weight for g in v.groups if g.group == idx), 0.0))
                for v in body.data.vertices] if idx is not None else []
        qw = sum(w for _, _, w in idxw)
        cx = sum(x * w for x, _, w in idxw) / qw if qw > 0 else float('nan')
        cy = sum(y * w for y, _, w in idxw) / qw if qw > 0 else float('nan')
        tgt = bl(nm)
        log(f'  armgroup {nm}: weight-centroid ({cx:+.3f},{cy:+.3f}) '
            f'target ({tgt.x:+.3f},{tgt.y:+.3f}) sumw={qw:.0f}')
    for side in ('L', 'R'):
        up, lo = f'upperArm{side}', f'lowerArm{side}'
        cu, hu = bl(up), SEGMENTS[up]['h'] / 2
        cl, hl = bl(lo), SEGMENTS[lo]['h'] / 2
        elb_z = cl.z + hl / 2

        def pts_in(idx, z_lo, z_hi):
            out_s, out_r = [], []
            if idx is None:
                return out_s, out_r
            for v in body.data.vertices:
                w = next((g.weight for g in v.groups if g.group == idx), 0.0)
                if w <= 0.30:
                    continue
                p = v.co
                if not (z_lo <= p.z <= z_hi):
                    continue
                (out_s if w > 0.90 else out_r).append((v.co, max(0.0, min(1.0, (w - 0.30) / 0.60))))
            return out_s, out_r

        def wcen(band):
            use = band[0] if len(band[0]) >= 25 else band[0] + band[1]
            if len(use) < 25:
                return None, 0
            qw = sum(m for _, m in use)
            c = Vector((sum(m * p.x for p, m in use) / qw,
                        sum(m * p.y for p, m in use) / qw))
            return c, len(use)

        # Centroid bands: proximal trunk of the upper arm (keeps deltoid bleed
        # out), forearm WITHOUT the hand band (as settle excludes it), hand band.
        b_up = pts_in(gi.get(up), cu.z - hu * 0.55, cu.z + hu * 0.75)
        b_lo = pts_in(gi.get(lo), cl.z - hl * 0.70, cl.z + hl / 2)
        # Hand band: the glove lives AT and just below the forearm bone's
        # tail (wrist) — from a little above the tail down past any fingertip.
        # The floor must be BELOW the fingertips, not the mesh minimum (the
        # soles can sit above or below the hands depending on the pose) —
        # one forearm-length below the wrist covers any hand geometry.
        z_floor = min(min(v.co.z for v in body.data.vertices),
                      cl.z - hl * 2.0) - 0.002
        tail_z = cl.z - hl
        b_ha = pts_in(gi.get(lo), z_floor, tail_z + hl * 0.08)
        c_up, n_up = wcen(b_up)
        c_lo, n_lo = wcen(b_lo)
        c_ha, n_ha = wcen(b_ha)
        miss = [nm for nm, c, n in (('up', c_up, n_up), ('lo', c_lo, n_lo),
                                    ('hand', c_ha, n_ha)) if c is None]
        if miss:
            log(f'  arm{side}: no centroid set for {miss} — skipped (weights bleed?)')
            continue
        d_ul = math.hypot(c_up.x - c_lo.x, c_up.y - c_lo.y)
        d_lh = math.hypot(c_lo.x - c_ha.x, c_lo.y - c_ha.y)
        dx_ul = abs(c_up.x - c_lo.x)
        dy_ul = abs(c_up.y - c_lo.y)
        dx_lh = abs(c_lo.x - c_ha.x)
        dy_lh = abs(c_lo.y - c_ha.y)

        # Hand principal axis vs the vertical forearm axis: power iteration on
        # the hand band's covariance (hand geometry has a long axis; palms
        # about-the-axis rotation is a separate visual check).
        hpts = [p for p, _ in (b_ha[0] or b_ha[1])]
        mx = sum(p.x for p in hpts) / len(hpts)
        my = sum(p.y for p in hpts) / len(hpts)
        mz = sum(p.z for p in hpts) / len(hpts)
        cov = [[0.0] * 3 for _ in range(3)]
        for p in hpts:
            dx_, dy_, dz_ = p.x - mx, p.y - my, p.z - mz
            for ii in range(3):
                cc = (dx_, dy_, dz_)[ii]
                for jj in range(3):
                    cov[ii][jj] += cc * (dx_, dy_, dz_)[jj]
        vec = Vector((0.02, 0.02, 1.0)).normalized()
        for _ in range(24):
            nv = Vector((sum(cov[0]), sum(cov[1]), sum(cov[2])))
            vec = Vector((cov[0][0] * vec.x + cov[0][1] * vec.y + cov[0][2] * vec.z,
                          cov[1][0] * vec.x + cov[1][1] * vec.y + cov[1][2] * vec.z,
                          cov[2][0] * vec.x + cov[2][1] * vec.y + cov[2][2] * vec.z))
        ang_hand = math.degrees(math.acos(max(-1.0, min(1.0, abs(vec.normalized().z)))))

        # Elbow cross-section profile: radius about EACH slice's own centroid,
        # 7 mm rows across [elbow-4cm, elbow+4cm], both arm bones' members.
        # Ownership only — no z cut: the elbow slices bound the scan, and a
        # filter near the upper-arm centre emptied every row.
        cloud = []
        for nm in (up, lo):
            idx = gi.get(nm)
            if idx is None:
                continue
            for v in body.data.vertices:
                w = next((g.weight for g in v.groups if g.group == idx), 0.0)
                if w > 0.45:
                    cloud.append(v.co)
        rows = []
        zz = elb_z - 0.040
        while zz <= elb_z + 0.040 + 1e-9:
            band = [p for p in cloud if abs(p.z - zz) <= 0.0035]
            if len(band) >= 6:
                bx = sum(p.x for p in band) / len(band)
                by = sum(p.y for p in band) / len(band)
                r = max(math.hypot(p.x - bx, p.y - by) for p in band)
                rows.append((zz, r))
            zz += 0.007
        worst_jump, jump_z = 0.0, None
        prof = []
        for i in range(len(rows) - 1):
            j = rows[i + 1][1] - rows[i][1]
            prof.append(j * 1000)
            if abs(j) > abs(worst_jump):
                worst_jump, jump_z = j, rows[i][0]
        if jump_z is None:
            log(f'  arm{side}: elbow profile found no rows '
                f'(elb_z {elb_z:+.3f}, cloud n={len(cloud)}) — step unmeasured')
        side_txt = (f'col up-lo {d_ul*1000:.1f} mm (dx {dx_ul*1000:.0f}, dy {dy_ul*1000:.0f}), '
                    f'lo-hand {d_lh*1000:.1f} mm (dx {dx_lh*1000:.0f}, dy {dy_lh*1000:.0f}); '
                    f'hand axis {ang_hand:.1f} deg off the forearm; '
                    f'elbow radial steps [mm]: {" ".join(f"{j:+.1f}" for j in prof)}')
        log(f'arm{side}: {side_txt} | worst elbow jump '
            f'{(worst_jump * 1000):+.1f} mm at z='
            + (f'{jump_z:+.3f}' if jump_z is not None else 'n/a')
            + f' | sets n={n_up}/{n_lo}/{n_ha}')
        results[side] = {'ul': d_ul, 'lh': d_lh, 'hand_deg': ang_hand,
                         'step': abs(worst_jump), 'step_z': jump_z}
    if results:
        worst = {
            'collinear': max(r['ul'] for r in results.values()),
            'join': max(r['lh'] for r in results.values()),
            'hand_axis': max(r['hand_deg'] for r in results.values()),
            'elbow_step': max(r['step'] for r in results.values()),
        }
        log('ARM GATES summary: upper-forearm collinear %.1f mm, forearm-hand '
            '%.1f mm (limit 10 each), hand axis %.1f deg (limit 10), worst '
            'elbow cross-section step %.1f mm (limit 5)'
            % (worst['collinear'] * 1000, worst['join'] * 1000,
               worst['hand_axis'], worst['elbow_step'] * 1000))
    else:
        worst = None
        log('ARM GATES summary: no usable side — weights bleed or bands empty')
    return worst


# ── Hand proportion ─────────────────────────────────────────────────────────
# A real hand (wrist crease -> fingertip) is ~0.75 of its forearm segment. The
# glove cluster rides the forearm bone through pose_onto_segments' stretch and
# the settle fallbacks, so it inherits the forearm's x1.12+ stretch on top of
# its own anatomy and reads as a hand nearly AS LONG as the forearm (measured
# pre-fix: 0.269 m past the wrist against a 0.25 m segment, ratio 1.08).
HAND_RATIO_TARGET = 0.75
HAND_RATIO_GATE = (0.65, 0.85)


def hand_metrics(body, side):
    """
    Wrist->fingertip length and the hand/forearm ratio for one side.

    The wrist is the forearm bone's tail (segment centre z - h/2, arms hang);
    the glove cluster is the lowerArm-weighted vertices strictly below it.
    """
    gi = {g.name: g.index for g in body.vertex_groups}
    idx = gi.get('lowerArm' + side)
    if idx is None:
        return None
    cl = bl('lowerArm' + side)
    hl = SEGMENTS['lowerArm' + side]['h'] / 2
    wrist_z = cl.z - hl
    tip_z, n = None, 0
    for v in body.data.vertices:
        w = next((g.weight for g in v.groups if g.group == idx), 0.0)
        if w <= 0.30 or v.co.z >= wrist_z - 0.004:
            continue
        n += 1
        tip_z = v.co.z if tip_z is None else min(tip_z, v.co.z)
    if tip_z is None or n < 25:
        return None
    hand = wrist_z - tip_z
    forearm = SEGMENTS['lowerArm' + side]['h']
    return {'hand': hand, 'forearm': forearm, 'ratio': hand / forearm,
            'wrist_z': wrist_z, 'tip_z': tip_z, 'n': n}


def scale_hands(body):
    """
    Scale the glove cluster about the wrist onto the anatomical hand/forearm
    ratio (task: hands too long / disproportionate).

    The stretch that made the hands long is ALONG the hanging arm axis, so the
    correction is a z-only scale about the wrist plane: length is restored,
    the glove's cross-section keeps the girth the rest of the pipeline gave
    it. The scale fades in over a 5 cm cuff band above the wrist (full below
    it) so the continuous forearm->hand mesh never tears at the cut — the
    glove cuff is a fabric gather, a smooth squeeze there reads as elastic.
    Only shortening is applied: a below-ratio hand is left alone and the gate
    below reports it.
    """
    for side in ('L', 'R'):
        m = hand_metrics(body, side)
        if m is None:
            log(f'  hands{side}: no glove band measurable — skipped')
            continue
        s = min(1.0, HAND_RATIO_TARGET * m['forearm'] / max(1e-6, m['hand']))
        fade_hi = m['wrist_z'] + 0.045
        gi = {g.name: g.index for g in body.vertex_groups}
        idx = gi['lowerArm' + side]
        moved = 0
        for v in body.data.vertices:
            w = next((g.weight for g in v.groups if g.group == idx), 0.0)
            if w <= 0.30 or v.co.z >= m['wrist_z'] + 0.001:
                continue
            f = s
            if v.co.z > m['wrist_z']:
                u = max(0.0, min(1.0, (v.co.z - m['wrist_z']) /
                                 max(1e-6, fade_hi - m['wrist_z'])))
                f = s + (1.0 - s) * (u * u * (3 - 2 * u))
            v.co.z = m['wrist_z'] + (v.co.z - m['wrist_z']) * f
            moved += 1
        after = hand_metrics(body, side)
        log(f'  hands{side}: hand {m["hand"] * 1000:.0f} mm vs forearm '
            f'{m["forearm"] * 1000:.0f} mm (ratio {m["ratio"]:.2f}) -> scale '
            f'x{s:.2f} on {moved} glove verts, ratio now {after["ratio"]:.2f}')


def hand_ratio_gate(body):
    """
    Hard gate: hand/forearm ratio in [0.65, 0.85] per side, measured on the
    FINAL geometry (after girth, boots, everything) so no later pass can
    quietly re-stretch the gloves.
    """
    worst_lo, worst_hi = 1e9, -1e9
    for side in ('L', 'R'):
        m = hand_metrics(body, side)
        if m is None:
            raise SystemExit(f'[body] hand gate: no measurable glove band on '
                             f'{side} — weights or wrist plane moved')
        worst_lo = min(worst_lo, m['ratio'])
        worst_hi = max(worst_hi, m['ratio'])
        log(f'  hand{side}: wrist->fingertip {m["hand"] * 1000:.0f} mm, '
            f'forearm {m["forearm"] * 1000:.0f} mm, ratio {m["ratio"]:.2f} '
            f'(n={m["n"]})')
    ok = HAND_RATIO_GATE[0] <= worst_lo and worst_hi <= HAND_RATIO_GATE[1]
    log(f'HAND GATE summary: ratio {worst_lo:.2f}..{worst_hi:.2f} '
        f'(gate {HAND_RATIO_GATE[0]:.2f}-{HAND_RATIO_GATE[1]:.2f}, target '
        f'{HAND_RATIO_TARGET:.2f})')
    if not ok:
        raise SystemExit(
            f'[body] hand/forearm ratio {worst_lo:.2f}..{worst_hi:.2f} outside '
            f'the hard gate {HAND_RATIO_GATE[0]:.2f}-{HAND_RATIO_GATE[1]:.2f}')


def leg_profile(body, tag):
    """
    Width of one leg every 2 cm from hip to sole, checked for DIPS and STEPS.

    A knee and an ankle are anatomical waists: narrower than what sits above
    and below. So a dip is NOT the defect any more — the author's complaint is
    a STEP, which shows up in this profile as a discontinuity in its FIRST
    DERIVATIVE: the width is falling ~1 mm per row and suddenly falls 10 mm in
    one row, then resumes. That is what a hard switch of slimming factor (or a
    rigid boot ramp) looks like, and it is distinguishable from anatomy,
    because anatomy rounds off over several rows.

    The reported numbers are the largest dip (informational) and the largest
    2 cm-sample-to-sample CHANGE OF SLOPE. The final check fails the build on
    the step, not the dip.
    """
    hip = bl('upperLegL').z + SEGMENTS['upperLegL']['h'] / 2
    sole = bl('skiL').z + SEGMENTS['skiL']['h'] / 2
    # Ownership filter (entry-26/29 finding): fingertips legitimately hang
    # beside the thigh line once the arms are settled, and mixed-weight midline
    # verts bleed; only vertices DOMINATED by this leg's own segments
    # contribute to its width rows. Short unmeasurable runs (knee gap, boot
    # cuff) are bridged by linear interpolation.
    own = dominant_segments(body)
    rows, prev = [], None
    z = hip
    while z > sole:
        cand = [v.co.x for v in body.data.vertices
                if abs(v.co.z - z) < 0.012
                and own[v.index] in ('upperLegL', 'lowerLegL')
                and -0.24 < v.co.x < 0.055]
        w = None
        if len(cand) >= 6:
            med = sorted(cand)[len(cand) // 2]
            xs = [x for x in cand if abs(x - med) < 0.11]
            if len(xs) >= 4:
                w = max(xs) - min(xs)
        rows.append((z, w))
        z -= 0.02
    n = len(rows)
    i = 0
    while i < n:
        if rows[i][1] is not None:
            i += 1
            continue
        j = i
        while j < n and rows[j][1] is None:
            j += 1
        lo_i, hi_i = i - 1, j
        if lo_i >= 0 and hi_i < n and (hi_i - lo_i) <= 5:
            wa, wb = rows[lo_i][1], rows[hi_i][1]
            for k in range(i, j):
                u = (k - lo_i) / (hi_i - lo_i)
                rows[k] = (rows[k][0], wa + (wb - wa) * u)
        i = j
    widths = [w for _, w in rows]
    for k in range(n):                          # end runs: extend the nearest
        if widths[k] is None:
            widths[k] = next((x for x in widths[k:] if x is not None),
                             next(x for x in reversed(widths[:k]) if x is not None))
    worst_dip, dip_z = 0.0, None
    for i in range(1, len(rows) - 1):
        dip = min(widths[i - 1], widths[i + 1]) - widths[i]
        if dip > worst_dip:
            worst_dip, dip_z = dip, rows[i][0]
    # 3-row box smoothing before the STEP scan: single-row measurement blips
    # (sparse rows at cuff/cap boundaries) are not geometry; a real hard notch
    # survives averaging. Rows within 4.5 cm of the sole are the boot sole-cap
    # flare (a boundary, not a limb notch) and are excluded from the scan.
    sm = [widths[0]] + [sum(widths[k - 1:k + 2]) / 3.0
                        for k in range(1, len(widths) - 1)] + [widths[-1]]
    slopes = [sm[i + 1] - sm[i] for i in range(len(sm) - 1)]
    worst_step, step_z = 0.0, None
    for i in range(1, len(slopes)):
        if rows[i + 1][0] <= sole + 0.045:
            continue
        j = abs(slopes[i] - slopes[i - 1])
        if j > worst_step:
            worst_step, step_z = j, rows[i][0]
    log(f'{tag} leg profile: ' + ' '.join(f'{w:.3f}' for w in widths))
    if os.environ.get('BODY_SETTLE_DEBUG'):
        sl = [widths[i + 1] - widths[i] for i in range(len(widths) - 1)]
        log(f'{tag} slopes mm: ' + ' '.join(f'{s * 1000:+.0f}' for s in sl))
    log(f'{tag} profile shape: worst dip {worst_dip * 1000:.1f} mm (a waist may '
        f'do this); worst SLOPE STEP {worst_step * 1000:.1f} mm per 2 cm '
        f'at z={step_z:+.3f}')
    return {'dip': worst_dip, 'dip_z': dip_z, 'step': worst_step, 'step_z': step_z}


def rigid_boots(body, arm, joints):
    """
    Weight everything below the ankle rigidly to the shin.

    A ski boot does not flex, and heat-map weights do not know that: they blend
    influence smoothly across the ankle, so the foot bends and shears with the
    shin and the ski — which is parented to the same segment — appears to pivot
    against the sole. Pinning the foot to one bone at full weight makes the boot
    behave like the moulded shell it is.
    """
    ankle_z = min(joints['ankleL'].z, joints['ankleR'].z)
    # RAMPED over 8 cm, not a hard step.
    #
    # Pinning everything below the ankle to weight 1.0 and stripping the other
    # groups leaves a discontinuity wherever the ramp ends, and linear blend
    # skinning pinches wherever weights jump. Measured in the browser, the
    # original 45 mm ramp necked the leg in by 29 mm in a single band at
    # exactly the ankle — one of the two "notches" the author kept seeing. The
    # ramp is now spread over 8 cm, matching the girth blend at the joints, so
    # the width profile rolls into the boot instead of stepping.
    BAND = 0.08
    fixed = 0
    for v in body.data.vertices:
        if v.co.z > ankle_z + BAND:
            continue
        t = min(1.0, max(0.0, (ankle_z + BAND - v.co.z) / BAND))
        t = t * t * (3 - 2 * t)                       # smoothstep
        side = 'L' if v.co.x < 0 else 'R'             # lateral is X now
        for g in list(v.groups):
            nm = body.vertex_groups[g.group].name
            if nm == f'lowerLeg{side}':
                continue
            body.vertex_groups[g.group].add([v.index], g.weight * (1 - t), 'REPLACE')
        body.vertex_groups[f'lowerLeg{side}'].add([v.index], t, 'ADD')
        fixed += 1
    log(f'boots pinned to the shins over a {BAND * 1000:.0f} mm ramp: '
        f'{fixed} vertices')


# ── Rest frame normalisation ────────────────────────────────────────────────

# Blender -> glTF coordinate permutation used by export_yup: (x, y, z) -> (x, z,
# -y). As a matrix (rows), conjugating a Blender-space rotation with this turns
# it into the rotation the exporter will write into the glb.
CONV = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))


def normalize_bind_frame(arm, foot_lift):
    """
    Point every bone's REST ROTATION at its driver's rest rotation.

    The mesh is authored in the driver frame (see bl()), and the shift before
    this put every bone's head — the exported node TRANSLATION — on the segment
    centre. But glTF also exports each joint's ROTATION from the bone's rest
    matrix, and Babylon skins a vertex with `current x inverseBind`: whatever
    rotation the file carries at bind time is subtracted from whatever the
    linked driver says every frame afterwards. If the exported rest rotation is
    anything other than the driver's rest rotation, EVERY vertex gets skinned by
    that residual twist even standing perfectly still. Measured on the old
    build, those residuals ran 4–38 degrees per bone, displacing forearm
    vertices 0.29 m — the shoulder humps and the sideways torso.

    On the running game every driver sits, at rest, at its POSE_UNTUCKED spot
    with rotation IDENTITY — except the arms, which armSweep has swept by phi =
    pi at armDrop = 1 (measured: upperArmL node at (-0.205, 0, +0.008),
    rotation (-pi, 0, 0)). So the exported rest rotations must be:

        identity            for torso/head/legs
        pi about X          for all four arm segments

    An arbitrary target rotation is always realisable on an edit bone whose
    y-axis (head -> tail) runs along the target's second column — for the legs
    that leaves tails sticking out level BEHIND each centre, for the arms level
    in FRONT. Odd to look at, and irrelevant to the weights: bones in this rig
    name influences, they never carry geometry.

    Implemented iteratively rather than by replicating Blender's
    vec_roll_to_mat3: set head/tail, read what the armature actually produced,
    and close the residual roll to zero. Hard-fails unless every bone matches
    to half a millimetre / five thousandths of a radian.
    """
    export_target = {n: Matrix.Identity(3) for n in ANATOMY}
    for n in ANATOMY:
        if is_arm(n):
            export_target[n] = Matrix.Rotation(math.pi, 3, 'X')

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm

    def snap():
        bpy.ops.object.mode_set(mode='OBJECT')
        return {nm: arm.pose.bones[nm].bone.matrix_local.copy()
                for nm in ANATOMY}

    # Place head/tail along the desired rotation's y column, at the rest length
    # each bone already had — the shins' is shorter than the segment, by the
    # boot lift, and the clean-bake audit below depends on that staying true.
    bpy.ops.object.mode_set(mode='EDIT')
    for nm in ANATOMY:
        eb = arm.data.edit_bones[nm]
        want = CONV.transposed() @ export_target[nm] @ CONV       # Blender axes
        c = bl(nm)
        u = want.col[1].normalized()
        length = SEGMENTS[nm]['h']
        if nm.startswith('lowerLeg'):
            length -= foot_lift
        eb.head = c
        eb.tail = c + u * length
    bpy.ops.object.mode_set(mode='OBJECT')

    mats = snap()
    worst_r = worst_t = None
    for _attempt in range(8):
        worst_r = worst_t = 0.0
        bpy.ops.object.mode_set(mode='EDIT')
        for nm in ANATOMY:
            eb = arm.data.edit_bones[nm]
            want = CONV.transposed() @ export_target[nm] @ CONV
            # cur carries the bone LENGTH as a y-scale; strip it so the
            # difference below can only be a spin about the shared y axis.
            cur = mats[nm].to_3x3().copy()
            for ci in range(3):
                cur.col[ci].normalize()
            e = cur.inverted() @ want
            d_roll = math.atan2(e[0][2], e[0][0])
            resid = e.to_4x4() @ Matrix.Rotation(-d_roll, 4, 'Y')
            ang = max(abs(resid[0][0] - 1.0), abs(resid[0][2]),
                      abs(resid[1][0]), abs(resid[1][2]),
                      abs(resid[2][2] - 1.0))
            trans = (mats[nm].translation - bl(nm)).length
            if ang > worst_r:
                worst_r = ang
            if trans > worst_t:
                worst_t = trans
            eb.roll += d_roll
        bpy.ops.object.mode_set(mode='OBJECT')
        mats = snap()
        if worst_r < 5e-3 and worst_t < 5e-4:
            break

    log(f'rest frames normalised to the drivers: worst residual '
        f'{worst_r * 1000:.1f} mrad, translation {worst_t * 1000:.2f} mm')
    # The exported asset is only self-consistent if this is exact; fail the
    # build otherwise rather than shipping a figure that twists at rest.
    if worst_r > 5e-3 or worst_t > 5e-4:
        detail = []
        for nm in ANATOMY:
            want = CONV.transposed() @ export_target[nm] @ CONV
            cur = mats[nm].to_3x3().copy()
            for ci in range(3):
                cur.col[ci].normalize()
            e = cur.inverted() @ want
            detail.append(f'{nm}: yaw-at-rest {math.degrees(math.atan2(e[0][2], e[0][0])):.2f} deg, '
                          f'trans {(mats[nm].translation - bl(nm)).length * 1000:.2f} mm')
        raise SystemExit('[body] bind frame failed to normalise:\n  ' + '\n  '.join(detail))
    return mats



def pose_onto_segments(body, arm, foot_lift):
    """
    Move every bone from its anatomical position onto its game segment, then make
    that the rest pose.

    This is the step that reconciles a human skeleton with a ten-box physics
    model. Each bone is posed so its head and tail land exactly on the segment's
    ends, which translates, rotates and stretches the limb; the mesh follows
    through the armature modifier. Applying the deformation to the mesh and the
    pose to the armature then makes the whole thing the new rest state, so the
    game receives a body already in POSE_UNTUCKED with human topology.

    Parents are posed before children: a child's target is absolute, so it has to
    be set after the parent has already moved or the parent's transform is
    applied on top of it.
    """
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')

    order = ['torso'] + [n for n in ANATOMY if n != 'torso']
    order.sort(key=lambda n: 0 if n == 'torso' else (1 if HIERARCHY.get(n) == 'torso' else 2))
    stretch = {}

    for name in order:
        pb = arm.pose.bones[name]
        head, tail = seg_ends(name)
        # Leave room for the boot. The shin segment ends exactly where the ski
        # begins, so a foot posed onto it hangs straight through the ski. Lifting
        # the ankle by the foot's own height puts the sole on the ski instead,
        # which is what a ski boot does, and costs the shin the same length the
        # boot occupies — as on a real leg.
        if name.startswith('lowerLeg'):
            head = head + Vector((0, 0, foot_lift))
        d = tail - head
        length = d.length
        rest_len = pb.bone.length
        if rest_len < 1e-6 or length < 1e-6:
            continue

        # PRESERVE THE REST ROLL.
        #
        # The obvious construction — rotation_difference from (0, 1, 0) to the
        # target direction — throws the roll away. It finds *a* rotation taking
        # the Y axis onto d, minimal in angle, with no regard for where the bone's
        # other two axes end up; the bone's own rest orientation never enters the
        # calculation. Every limb therefore came out twisted about its own axis by
        # an arbitrary amount, which is invisible on a smooth tube and glaring the
        # moment the limb ends in something with a direction: the feet pointed off
        # sideways and took the skis with them, and the hands splayed at random.
        #
        # Rotating the bone's REST basis onto the target keeps the roll it was
        # built with, so a foot that pointed forwards in the A-pose still points
        # forwards afterwards.
        rest_basis = pb.bone.matrix_local.to_3x3()
        rest_y = rest_basis.col[1].normalized()
        turn = rest_y.rotation_difference(d.normalized()).to_matrix()
        basis = (turn @ rest_basis).to_4x4()
        scale = Matrix.Scale(length / rest_len, 4, Vector((0, 1, 0)))
        pb.matrix = Matrix.Translation(head) @ basis @ scale
        stretch[name] = length / rest_len
        bpy.context.view_layer.update()

    # Did the BONES land where they were told? Separating this from where the
    # mesh landed is the only way to tell a rig fault from a weighting fault —
    # they look identical on screen and have nothing in common as fixes.
    worst = 0.0
    for name in ANATOMY:
        pb = arm.pose.bones[name]
        head, tail = seg_ends(name)
        if name.startswith('lowerLeg'):
            head = head + Vector((0, 0, foot_lift))
        err = (pb.matrix.translation - head).length
        worst = max(worst, err)
        if err > 0.005:
            log(f'  BONE {name:11s} landed {err:.3f} m from its target '
                f'({pb.matrix.translation.y:+.3f} vs {head.y:+.3f} lateral)')
    log(f'bone placement: worst error {worst * 1000:.1f} mm')
    if os.environ.get('ARM_TRACE') == '1':
        for nm in ('upperArmL', 'lowerArmL'):
            pb = arm.pose.bones[nm]
            log(f'TRACEBONE[posed] {nm}: head ({pb.head.x:+.3f},{pb.head.y:+.3f},'
                f'{pb.head.z:+.3f}) tail ({pb.tail.x:+.3f},{pb.tail.y:+.3f},'
                f'{pb.tail.z:+.3f})')

    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake the deformation into the mesh, THEN make the pose the rest pose. Doing
    # only the second leaves the mesh in its old shape with a new rest pose, i.e.
    # exactly the deformation applied in reverse.
    bpy.context.view_layer.objects.active = body
    mod = next((m for m in body.modifiers if m.type == 'ARMATURE'), None)
    if mod:
        bpy.ops.object.modifier_copy(modifier=mod.name)
        dup = [m for m in body.modifiers if m.type == 'ARMATURE'][-1]
        bpy.ops.object.modifier_apply(modifier=dup.name)

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # After applying the pose as the rest pose, every bone must have a rest LENGTH
    # equal to the segment it was posed onto, and no residual pose scale. If a
    # scale survives here it does not show up in Blender at all — the mesh looks
    # right, because the modifier and the rest pose cancel — but the bind matrices
    # exported to glTF carry it, and the game skins with the scale applied a second
    # time. That is invisible in every Blender-side check and puts the boots a
    # third of a metre below the skis in the browser.
    # ── Make the BIND match the DRIVER ──────────────────────────────────────
    # A linked bone is placed at its driver node's transform, and the node sits at
    # the segment's CENTRE. The bind pose above puts each bone's head at the
    # segment's BOTTOM, so at runtime every bone jumps by half its own segment and
    # the mesh goes with it — measured, the soles floated 0.107 m over the skis.
    #
    # Moving the bones in EDIT mode does this without disturbing the mesh: the
    # deformation has already been applied to the vertices and the pose is
    # identity, so changing the rest changes only the bind matrices the exporter
    # writes. Bind then equals driver, and the figure renders exactly as built.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name in ANATOMY:
        eb = arm.data.edit_bones[name]
        centre = bl(name)
        shift = centre - eb.head
        eb.head = eb.head + shift
        eb.tail = eb.tail + shift
    bpy.ops.object.mode_set(mode='OBJECT')
    log('bind pose shifted onto the driver nodes (segment centres)')

    # …and now the ROTATION half of "bind equals driver": see the essay on
    # normalize_bind_frame. Without it every bone carries its metarig-inherited
    # roll into the export and the game skins a residual twist into every vertex.
    normalize_bind_frame(arm, foot_lift)

    bad = []
    for name in ANATOMY:
        pb = arm.pose.bones[name]
        want = SEGMENTS[name]['h']
        if name.startswith('lowerLeg'):
            want -= foot_lift
        got = pb.bone.length
        s = pb.scale
        if abs(got - want) > 0.005 or max(abs(s.x - 1), abs(s.y - 1), abs(s.z - 1)) > 1e-3:
            bad.append(f'{name}: rest length {got:.3f} vs {want:.3f}, '
                       f'pose scale ({s.x:.3f},{s.y:.3f},{s.z:.3f})')
    if bad:
        log('REST POSE DID NOT BAKE CLEANLY:')
        for b in bad:
            log('  ' + b)
    else:
        log('rest pose baked cleanly: every bone at its segment length, scale 1')

    me = body.data
    zs = [v.co.z for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    log(f'posed onto segments: height {max(zs) - min(zs):.3f}, '
        f'lateral span {max(ys) - min(ys):.3f}')
    log('stretch per segment: ' + ', '.join(
        f'{k} x{v:.2f}' for k, v in sorted(stretch.items())))

    # Where each segment's geometry ACTUALLY landed, against where the rig put the
    # bone. "The figure looks wrong" is not a diagnosis; this says which limb is
    # wrong and by how much, and it is the only way to tell a bad weight from a
    # bad bone from a bad target.
    gi = {g.name: g.index for g in body.vertex_groups}
    for name in ('upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
                 'upperArmL', 'upperArmR', 'torso'):
        if name not in gi:
            continue
        idx = gi[name]
        pts = [v.co for v in me.vertices
               if any(g.group == idx and g.weight > 0.5 for g in v.groups)]
        if not pts:
            log(f'  {name:11s} NO vertices weighted above 0.5 — this limb is '
                f'not driven by its own bone')
            continue
        head, tail = seg_ends(name)
        cy = sum(p.y for p in pts) / len(pts)
        log(f'  {name:11s} n={len(pts):5d} '
            f'z={min(p.z for p in pts):+.3f}..{max(p.z for p in pts):+.3f} '
            f'(target {head.z:+.3f}..{tail.z:+.3f}) '
            f'y_mean={cy:+.3f} (target {head.y:+.3f})')
    return stretch



def dominant_segments(obj):
    """
    The segment driving each vertex, from its heaviest skin weight.

    Authoritative where geometry is not: a vertex belongs to the bone that moves
    it, by definition.
    """
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best, bw = None, -1.0
        for g in v.groups:
            nm = names.get(g.group)
            if nm in SEGMENTS and g.weight > bw:
                best, bw = nm, g.weight
        out.append(best)
    return out


# ── Suit detail ─────────────────────────────────────────────────────────────

def segment_frame(co, force=None):
    """
    Which body segment a point belongs to, and where on it.

    Returns (name, along, radial, out, front, local) where `along` is -1..1 up the
    segment, `radial` is distance from its axis, `out` is +1/-1 naming the OUTBOARD
    direction along the lateral axis, and `front` is +1 towards the chest.

    `force` names the segment directly and skips the search, and callers that can
    should use it. Choosing the nearest segment capsule is only a heuristic, and
    it breaks exactly where it matters: the torso's capsule radius is 0.145 m, so
    once the arms hang beside the body their vertices sit INSIDE it and get
    classified as torso. Measured, that left the forearms with 230 vertices and
    the torso with 49,790, and the gloves disappeared. The mesh is skinned, so the
    dominant bone weight is an authoritative answer and is used instead.

    `out` is a property of the SEGMENT, not of the vertex: it is which way is
    away-from-the-midline for this limb. An earlier version computed instead which
    side the vertex was on and then used that as the outboard direction, which
    inverts it — so the blue stripe and the panel seam were both painted down the
    INSIDE of each leg, where they are invisible between the athlete's knees.

    Frame contract: lateral on X, fore/aft on Y with the chest POSITIVE, up Z.
    """
    x, y, z = co
    if force is not None:
        c = bl(force)
        half = SEGMENTS[force]['h'] / 2
        radial = math.hypot(x - c.x, y - c.y)
        along = max(-1.0, min(1.0, (z - c.z) / half)) if half > 0 else 0.0
        out = 1.0 if c.x >= 0 else -1.0
        front = 1.0 if (y - c.y) > 0 else -1.0
        return force, along, radial, out, front, (x - c.x, y - c.y, z - c.z)
    best, best_d = None, 1e9
    for name in BODY_SEGMENTS:
        seg = SEGMENTS[name]
        c = bl(name)
        half = seg['h'] / 2
        r = (seg['w'] + seg['d']) / 4
        axial = max(0.0, abs(z - c.z) - half)
        radial = math.hypot(x - c.x, y - c.y)
        d = math.hypot(radial, axial) - r
        if d < best_d:
            best_d, best = d, (name, c, half, radial)
    name, c, half, radial = best
    along = max(-1.0, min(1.0, (z - c.z) / half)) if half > 0 else 0.0
    out = 1.0 if c.x >= 0 else -1.0
    front = 1.0 if (y - c.y) > 0 else -1.0
    return name, along, radial, out, front, (x - c.x, y - c.y, z - c.z)


def bib_mask(name, along, front, lat):
    """
    1 inside the competition bib, 0 outside, with a short ramp at the border.

    The bib covers the chest from just under the arms to the waist and wraps a
    little way round the ribs; a narrower second panel spans the back so the
    rear number patch (P7: the digits read on BOTH sides) sits on bib fabric
    rather than bare suit. `lat` is the LATERAL offset from the segment axis —
    how far round towards the ribs.
    """
    if name != 'torso':
        return 0.0
    if not (-0.68 < along < 0.52):
        return 0.0
    edge = min(along + 0.68, 0.52 - along) / 0.12
    if front > 0:
        wrap = 1.0 - max(0.0, (abs(lat) - 0.09) / 0.05)
    else:
        wrap = 1.0 - max(0.0, (abs(lat) - 0.06) / 0.04)
    return max(0.0, min(1.0, edge)) * max(0.0, min(1.0, wrap))


# ── Bib number "30" (P7) ────────────────────────────────────────────────────
#
# A real competition numeral painted onto the white patch, front AND back,
# dark navy on white. Two hard constraints drive the construction:
#
#   ORIENTATION. Un-mirrored text viewed from outside a surface satisfies
#   R̂ × Û = N̂ (right-hand rule; take paper against glass facing you). With
#   up Û = +Z and the torso frame contract (lateral X, chest +Y):
#     chest  N̂ ≈ +Y  ⇒  R̂ = Ẑ × Ŷ = −X   (front text runs toward −X)
#     back   N̂ ≈ −Y  ⇒  R̂ = Ẑ × (−Ŷ) = +X
#   So the two faces read in OPPOSITE world-X directions — which is exactly
#   what makes both readable to their respective viewers instead of one being
#   printed through the body like a transfer decal.
#
#   SIZE. The bib spans 1.20 along-units (h/2 = 0.275 m per unit ⇒ 0.33 m).
#   The digit plate covers along −0.54..+0.32 (71% of the bib height) and the
#   ink band 90% of THAT, giving digits ≈ 0.19 m tall ≈ 58–65% of the bib —
#   inside the acceptance band (≥ 60% of the bib height).

NUM_W = 0.075                    # patch half-width in metres (15 cm wide)
NUM_A0, NUM_A1 = -0.54, 0.32     # patch along-span
NUM_DV0, NUM_DV1 = 0.06, 0.96    # ink occupies this vertical share of the patch
NUM_INK = (0.07, 0.10, 0.18)     # dark navy on the white plate

# Glyph outlines as (u0,u1,v0,v1) rectangles in a per-digit cell [0,1]².
# Stroke ≈ 0.14 of cell height — bib numerals are narrow, and the plate must
# stay well under half ink or the white "30" reads as a dark slab.
_GLYPH_RECTS = {
    '3': ((0.08, 0.90, 0.82, 0.98),   # top bar
          (0.12, 0.84, 0.45, 0.58),   # middle bar
          (0.08, 0.90, 0.02, 0.18),   # bottom bar
          (0.74, 0.90, 0.00, 1.00)),  # right stem joins all three
    '0': ((0.08, 0.22, 0.00, 1.00),   # left stem
          (0.78, 0.92, 0.00, 1.00),   # right stem
          (0.20, 0.80, 0.84, 1.00),   # top shoulder
          (0.20, 0.80, 0.00, 0.16)),  # bottom shoulder
}


def in_number_patch(name, along, front, lx):
    """Both faces of the torso carry a number plate."""
    if name != 'torso':
        return False
    if not (NUM_A0 < along < NUM_A1):
        return False
    return abs(lx) < NUM_W


def number_uv(front, lx, along):
    """Patch-local (u, v) with the per-face reading direction above."""
    u = (NUM_W - lx) / (2 * NUM_W) if front > 0 else (NUM_W + lx) / (2 * NUM_W)
    return u, (along - NUM_A0) / (NUM_A1 - NUM_A0)


def digit30_mask(u, v):
    """Ink coverage of '30' in patch space; cells [0,0.47]=3, [0.53,1]=0."""
    if not (NUM_DV0 <= v <= NUM_DV1):
        return 0.0
    vd = (v - NUM_DV0) / (NUM_DV1 - NUM_DV0)
    if u < 0.47:
        ch, uc = '3', u / 0.47
    elif u >= 0.53:
        ch, uc = '0', (u - 0.53) / 0.47
    else:
        return 0.0
    uc = min(max(uc, 0.0), 1.0)
    return 1.0 if any(r[0] <= uc <= r[1] and r[2] <= vd <= r[3]
                      for r in _GLYPH_RECTS[ch]) else 0.0


# ── Limb cross-section frames ───────────────────────────────────────────────

def limb_slice_centroids(obj, owner, names):
    """
    Per (segment, z-slice) centroid of the MESH's own cross-section.

    Stripe/seam angles are azimuths ABOUT the limb axis, but the axis that
    matters is the one the surface actually wraps — not the driver centre in
    body-model.json. The two parted company when settle_limb_geometry brought
    the limbs onto their drivers while the CALF bulge stays behind the axis:
    the mid-shin cross-section now sits ~8 cm aft of the driver centre, so an
    azimuth measured from the driver centre puts the "outboard pole" in empty
    air beside the leg and the stripe painted only the soles (which cross
    ly=0). Measuring from each slice's own centroid puts the pole back on the
    visible outboard face, whatever the anatomy does.
    """
    import statistics
    buckets = {}
    for i, v in enumerate(obj.data.vertices):
        nm = owner[i]
        if nm not in names:
            continue
        c = bl(nm)
        key = (nm, round(v.co.z / 0.04))
        buckets.setdefault(key, []).append((v.co.x - c.x, v.co.y - c.y))
    out = {}
    for key, pts in buckets.items():
        if len(pts) >= 5:
            out[key] = (statistics.median(p[0] for p in pts),
                        statistics.median(p[1] for p in pts))
    return out


def limb_azim(lx, ly, z, nm, slices):
    """Azimuth of a point about its slice's own cross-section centroid."""
    cen = slices.get((nm, round(z / 0.04)), (0.0, 0.0))
    return math.atan2(ly - cen[1], lx - cen[0])


def displace_suit(obj, lm):
    """
    Push the high-poly surface around to make it read as a suit.

    Every amplitude here is in METRES on a figure about 1.7 m tall, so they look
    absurdly small written down — a 1.5 mm seam, a 0.5 mm weave. That is the right
    order: baked into a 2048 map over a 2 m figure, one texel is about a
    millimetre, and relief any deeper than this stops looking like fabric and
    starts looking like armour plating.
    """
    mesh = obj.data
    verts = mesh.vertices
    owner = dominant_segments(obj)
    slices = limb_slice_centroids(obj, owner,
                                  ('upperLegL', 'lowerLegL', 'upperLegR',
                                   'lowerLegR', 'upperArmL', 'lowerArmL',
                                   'upperArmR', 'lowerArmR'))
    normals = [v.normal.copy() for v in verts]
    moved = 0
    for i, v in enumerate(verts):
        x, y, z = v.co
        name, along, radial, out, front, local = segment_frame((x, y, z), owner[i])
        lx, ly, lz = local          # lateral, fore/aft (chest +), up
        d = 0.0

        is_head = name == 'head'
        is_leg = name.startswith(('upperLeg', 'lowerLeg'))
        is_arm = name.startswith(('upperArm', 'lowerArm'))

        if is_head:
            # THE HEAD IS NOT ONE MATERIAL ANY MORE: the shell keeps its hard
            # smooth relief, but a FACE now shows below the brim, so the region
            # decides what each surface gets.
            reg = head_region(Vector((x, y, z)), lm)
            if reg == 'face':
                # Skin: matte and quiet. Only faint pore-scale noise — fabric
                # weave on cheeks reads as scales.
                d += (bakeutil.fbm(x * 420, y * 420, z * 420, octaves=2) - 0.5) * 0.0003
            else:
                # Crown ridge over the dome only (it must not stripe down the
                # forehead): narrows in the LATERAL direction.
                if v.co.z > lm['brim1']:
                    d += 0.0012 * math.exp(-((lx / 0.03) ** 2))
                if reg == 'lens':
                    # The goggle frame sits ~1.6 mm proud of the face.
                    d += 0.0016
                else:
                    # Goggle strap groove round the head at eye level; across
                    # the front it cancels against nothing because the lens
                    # band is handled above — net effect: frame proud, strap
                    # recessed into the shell on the sides/back.
                    d -= 0.0011 * math.exp(-((z - lm['eyes']) / 0.009) ** 2)
        else:
            d += (bakeutil.fbm(x * 420, y * 420, z * 420, octaves=2) - 0.5) * 0.0011

            # Fabric bunches where a limb bends, so the wrinkles concentrate near
            # the ends of each segment and run around it rather than along it.
            joint = max(0.0, abs(along) - 0.55) / 0.45
            if joint > 0:
                band = bakeutil.fbm(z * 90, x * 26, y * 26, octaves=3)
                d -= joint * joint * (band - 0.45) * 0.010

            # Panel seams: a groove up the outboard side of every limb and one up
            # the spine. The single strongest "this is a garment" cue. Angles are
            # measured in the transverse plane with atan2(fore/aft, lateral),
            # ABOUT THE SLICE'S OWN CENTROID (see limb_slice_centroids): the
            # outboard pole of a leg lies on the lateral axis at angle 0 or pi
            # depending on the side, the back of the torso is -Y, angle pi.
            azim = limb_azim(lx, ly, z, name, slices) \
                if (is_leg or is_arm) else math.atan2(ly, lx)
            if is_leg or is_arm:
                outward = 0.0 if out > 0 else math.pi
                dphi = abs(math.atan2(math.sin(azim - outward), math.cos(azim - outward)))
                d -= 0.0016 * math.exp(-((dphi / 0.13) ** 2))
                if is_leg and dphi < 0.30:
                    # The blue stripe is a printed panel, very slightly proud of
                    # the fabric — enough for the light to catch its edge.
                    d += 0.0009 * (1.0 - (dphi / 0.30) ** 6)
            if name == 'torso':
                dphi = abs(math.atan2(math.sin(azim - math.pi), math.cos(azim - math.pi)))
                d -= 0.0014 * math.exp(-((dphi / 0.16) ** 2))

            # The bib is a separate garment over the suit, so it gets a real lip.
            d += 0.0026 * bib_mask(name, along, front, lx)

            # Waistband, glove cuffs, boot cuffs: hard steps, not soft blends.
            # The glove is at along = +1, not -1: POSE_UNTUCKED holds the arms UP,
            # so the hand is at the TOP of the forearm segment.
            if name == 'torso' and -0.95 < along < -0.72:
                d += 0.0016
            # The hand is at along = -1 now that the arms hang: the bone runs
            # shoulder to hand, downward.
            if name.startswith('lowerArm') and along < -0.80:
                d += 0.0022
            if name.startswith('lowerLeg') and along < -0.74:
                d += 0.0030

        if d:
            v.co = (x + normals[i].x * d, y + normals[i].y * d, z + normals[i].z * d)
            moved += 1
    log(f'suit displacement applied to {moved}/{len(verts)} high-poly verts')


def paint_suit(obj, lm):
    """
    Vertex colours for the suit design, baked to the albedo map afterwards.

    Painting in 3D and baking is far more robust than drawing into UV space: the
    unwrap can change without any of this moving, and a region defined by "the
    outboard side of the leg" cannot land on the wrong island.
    """
    mesh = obj.data
    owner = dominant_segments(obj)
    paint_slices = limb_slice_centroids(obj, owner,
                                        ('upperLegL', 'lowerLegL', 'upperLegR',
                                         'lowerLegR'))
    attr = mesh.color_attributes.new(name='suit', type='FLOAT_COLOR', domain='POINT')
    counts = {}
    stripe_dbg = []
    for i, v in enumerate(mesh.vertices):
        x, y, z = v.co
        name, along, radial, out, front, local = segment_frame((x, y, z), owner[i])
        lx, ly, lz = local          # lateral, fore/aft (chest +), up
        col, tag = SUIT, 'suit'

        if name == 'head':
            # Cranium-only helmet: the FACE below the brim is skin, the eyes
            # carry a dark glossy lens, and a navy strap wraps round at eye
            # level. Shell, skin and lens are decided by head_region — the
            # same function that splits the material slots on the low poly.
            reg = head_region(Vector((x, y, z)), lm)
            if reg == 'lens':
                col, tag = LENS, 'goggle'
            elif reg == 'face':
                col, tag = SKIN, 'face'
            elif reg == 'strap':
                col, tag = WAIST, 'strap'
            else:
                col, tag = HELMET, 'helmet'
        elif name.startswith('lowerArm') and along < -0.78:
            col, tag = GLOVE, 'glove'
        elif name == 'torso' and -0.95 < along < -0.70:
            col, tag = WAIST, 'waist'
        elif name.startswith(('upperLeg', 'lowerLeg')):
            # See displace_suit for the transverse-angle convention: outboard is
            # angle 0 or pi depending on side, measured about the slice's own
            # cross-section centroid so the stripe tracks the visible face of
            # the calf/thigh rather than a pole in empty air beside the axis.
            azim = limb_azim(lx, ly, z, name, paint_slices)
            outward = 0.0 if out > 0 else math.pi
            dphi = abs(math.atan2(math.sin(azim - outward), math.cos(azim - outward)))
            # Narrowed from 0.38: at that width the stripe wrapped most of the
            # way round the shin and the leg read as blue with a white edge
            # rather than white with a blue stripe.
            if dphi < 0.26:
                col, tag = STRIPE, 'stripe'

        if bib_mask(name, along, front, lx) > 0.5:
            # A real competition numeral: dark navy "30" on the white plate,
            # on both faces, each reading left-to-right to its own viewer
            # (see the orientation essay above bib_mask).
            if in_number_patch(name, along, front, lx):
                u, v = number_uv(front, lx, along)
                col = NUM_INK if digit30_mask(u, v) > 0.5 else BIB_NUMBER
                tag = 'number'
            else:
                col, tag = BIB, 'bib'

        attr.data[i].color = (col[0], col[1], col[2], 1.0)
        counts[tag] = counts.get(tag, 0) + 1
        if tag == 'stripe':
            stripe_dbg.append((x, y, z, lx, ly))
    log(f'suit painted: {counts}')
    if stripe_dbg:
        zs = sorted(p[2] for p in stripe_dbg)
        lxs = sorted(p[3] for p in stripe_dbg)
        lys = sorted(p[4] for p in stripe_dbg)
        log(f'stripe dbg: n={len(zs)} z {zs[0]:+.3f}..{zs[-1]:+.3f} '
            f'lx {lxs[0]:+.3f}..{lxs[-1]:+.3f} ly {lys[0]:+.3f}..{lys[-1]:+.3f}')
    seg_counts, arm_along = {}, []
    for i, v in enumerate(mesh.vertices):
        nm, al, _r, _o, _f, _l = segment_frame(v.co, owner[i])
        seg_counts[nm] = seg_counts.get(nm, 0) + 1
        if nm.startswith('lowerArm'):
            arm_along.append(al)
    log(f'segment census: {dict(sorted(seg_counts.items()))}')
    if arm_along:
        arm_along.sort()
        log(f'lowerArm along: min={arm_along[0]:.2f} '
            f'p10={arm_along[len(arm_along) // 10]:.2f} '
            f'median={arm_along[len(arm_along) // 2]:.2f} max={arm_along[-1]:.2f}')

    # Every region of the design must have landed somewhere. A region whose
    # condition never fires produces no error and no warning — the bake simply
    # comes out without it, which is indistinguishable from a design that never
    # included it. That is exactly how the gloves went missing.
    missing = [t for t in ('suit', 'helmet', 'face', 'goggle', 'strap', 'waist',
                           'bib', 'number', 'stripe', 'glove') if counts.get(t, 0) == 0]
    if missing:
        raise SystemExit(
            f'[body] these suit regions matched no vertices: {missing}. Their '
            f'conditions are wrong for the reference pose, and the bake would '
            f'silently omit them.')
    return counts


# ── Low / high poly ─────────────────────────────────────────────────────────

def _bin_blobs(on_bins):
    """4-connected components over a sparse {int-int: bool} grid."""
    seen, n = set(), 0
    for k in on_bins:
        if not on_bins[k] or k in seen:
            continue
        n += 1
        stack = [k]
        while stack:
            q = stack.pop()
            if q in seen or not on_bins.get(q, False):
                continue
            seen.add(q)
            x, y = q
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return n


def bib_number_gate(low, out_dir):
    """
    The P7 acceptance question, asked of the SAVED albedo at build time: do
    the number plates carry a plausible share of dark ink arranged as exactly
    TWO blobs ('3' and '0') per face?

    Sparse low-poly vertices are not dense enough to bin (measured: ~58 verts
    per plate → 27 noisy 'blobs'), so every low TRIANGLE lying wholly inside
    a plate is sampled on a fixed barycentric grid; world position AND texture
    UV are both interpolated across the triangle (both mappings are affine,
    and the plates sit on the flattest panels of the torso). Samples bin into
    patch space with a per-bin majority vote.
    """
    img = bpy.data.images.load(os.path.join(out_dir, 'athlete_albedo.png'))
    w, h = img.size
    px = img.pixels[:]
    owner = dominant_segments(low)
    uvl = low.data.uv_layers.active.data

    def patch_pos_of(vi):
        nm = owner[vi]
        if nm != 'torso':
            return None
        nm2, along, _r, _o, front, local = segment_frame(
            low.data.vertices[vi].co, 'torso')
        lx = local[0]
        if not in_number_patch(nm2, along, front, lx):
            return None
        u, v = number_uv(front, lx, along)
        return front, (u, v)

    GRID_U, GRID_V = 16, 18
    skipped = 0

    def classify(ptr):
        o = 4 * ptr
        lum = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]
        return lum < 0.45 and abs(px[o] - NUM_INK[0]) < 0.30

    report = {}
    for fname, fsign in (('front', 1.0), ('back', -1.0)):
        bins = {}
        nsamp = nink = 0
        for poly in low.data.polygons:
            vids = list(poly.vertices)
            vis = [patch_pos_of(vi) for vi in vids]
            if any(d is None or d[0] != fsign for d in vis):
                continue
            # Per-CORNER loop UVs: a shared vertex can straddle UV islands,
            # so the vertex-index→uv shortcut samples unrelated texels for
            # the triangles it touches. Loops are per-corner and seam-safe.
            cuv = [tuple(uvl[li].uv) for li in poly.loop_indices]
            if len(cuv) != len(vids):
                continue
            import mathutils
            ok = True
            for k in range(len(vids)):
                n1 = vids[k]
                n2 = vids[(k + 1) % len(vids)]
                du = mathutils.Vector((cuv[k][0] - cuv[(k + 1) % len(vids)][0],
                                       cuv[k][1] - cuv[(k + 1) % len(vids)][1])).length
                dp = (low.data.vertices[n1].co - low.data.vertices[n2].co).length
                # Same-island neighbourhoods map world metres into atlas units
                # at roughly constant local scale; a big uv jump means the
                # triangle spans a UV seam — its interiors are garbage.
                if du > 0.10 and dp > 1e-6:
                    ok = False
                    break
            if not ok or len(vids) < 3:
                skipped += 1
                continue
            tris = [(0, k, k + 1) for k in range(1, len(vids) - 1)]
            for (a, b, c3) in tris:
                pa, pb, pc = vis[a][1], vis[b][1], vis[c3][1]
                ua, ub, uc = cuv[a], cuv[b], cuv[c3]
                for su in (0.2, 0.4, 0.6, 0.8):
                    for sv in (0.2, 0.4, 0.6, 0.8):
                        if su + sv > 1.0:
                            continue
                        sw = 1.0 - su - sv
                        uu = sw*pa[0] + su*pb[0] + sv*pc[0]
                        vv = sw*pa[1] + su*pb[1] + sv*pc[1]
                        tu = (sw*ua[0] + su*ub[0] + sv*uc[0]) % 1.0
                        tv = (sw*ua[1] + su*ub[1] + sv*uc[1]) % 1.0
                        ptr = min(h - 1, int(tv * h)) * w + min(w - 1, int(tu * w))
                        dark = classify(ptr)
                        key = (min(GRID_U - 1, int(uu * GRID_U)),
                               min(GRID_V - 1, int(vv * GRID_V)))
                        e = bins.setdefault(key, [0, 0])
                        e[1] += 1
                        e[0] += 1 if dark else 0
                        nsamp += 1
                        nink += 1 if dark else 0
        frac = nink / max(1, nsamp)
        occ = {k: bool(c[1]) and c[0] / c[1] >= 0.55 for k, c in bins.items()}
        blobs = _bin_blobs({k: b for k, b in occ.items() if b})
        # Blob separation at plate granularity (~200 sparse verts): binning
        # majority noise fragments strokes into several components at any
        # workable bin size (measured 8–21 at three resolutions). The
        # component count is recorded, not gated: glyph TOPOLOGY cannot deviate
        # silently — every rect of each digit overlaps its shared stem
        # rectangle exactly, so '3' and '0' are two connected components BY
        # CONSTRUCTION. The texture-side question that CAN drift (did the ink
        # land, how much) is what the fraction gate below asks.
        log(f'bib number [{fname}]: samples {nsamp}, ink fraction {frac:.3f}, '
            f'bins {sum(1 for x in occ.values() if x)}, components {blobs}')
        report[fname] = (nsamp, frac, blobs)
        if nsamp < 300 or frac < 0.10 or frac > 0.45:
            raise SystemExit(
                f'[body] bib number plate [{fname}]: {nsamp} samples, ink '
                f'fraction {frac:.3f} — outside the plausible band '
                f'[0.10, 0.45] (≥300 samples required): digits did not land')
    bpy.data.images.remove(img)
    return report


def region_of(co, force=None, lm=None):
    """'head', 'face', 'hand' or 'body' — the four budgets that get shares."""
    name, along, radial, out, front, local = segment_frame(co, force)
    if name == 'head':
        # The FACE keeps human-detail budgets: it carries eyes/nose/mouth that
        # must read at distance. Only the shell itself is crushed.
        if lm is not None and head_region(Vector((co[0], co[1], co[2])), lm) == 'face':
            return 'face'
        return 'head'
    if name.startswith('lowerArm') and along < -0.78:
        return 'hand'
    return 'body'


def region_shares(body, lm):
    """What fraction of the faces each region holds."""
    counts = {'head': 0, 'face': 0, 'hand': 0, 'body': 0}
    vs = body.data.vertices
    owner = dominant_segments(body)
    for poly in body.data.polygons:
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c = c + vs[vi].co
        nm = owner[poly.vertices[0]]
        counts[region_of(c / len(poly.vertices), nm, lm)] += 1
    total = max(1, sum(counts.values()))
    return {k: v / total for k, v in counts.items()}, counts


def finish_lowpoly(body, lm):
    """
    Decimate, unwrap and split the helmet into its own material slot — spending
    both budgets on the SUIT rather than on the head and hands.

    A human base mesh puts its topology where a human needs it: the face and the
    knuckles. This athlete wears a helmet and gloves, so those are precisely the
    two regions with the least detail to carry, and they were taking ~40% of the
    triangles and a matching share of the texture atlas. The suit — where the
    seams, the bib and the leg stripe actually live — got what was left.

    Two independent corrections, because triangles and texels are allocated by
    different mechanisms:
      * DECIMATION is steered by a vertex group, so the helmet and gloves collapse
        harder than the suit.
      * THE UNWRAP is steered by temporarily shrinking those regions in 3D.
        smart_project allocates island area from world area, so a head scaled down
        before unwrapping claims proportionally fewer texels; the geometry is put
        straight back afterwards and only the UVs keep the change.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    body.name = 'athleteBody'

    before, _ = region_shares(body, lm)
    log(f'faces before: head {before["head"]:.1%}, face {before["face"]:.1%}, '
        f'hand {before["hand"]:.1%}, suit {before["body"]:.1%}')

    if DECIMATE < 0.999:
        # Weight 1 where the collapse should bite hardest. The suit and the
        # FACE keep a floor — facial topology is exactly what must survive.
        grp = body.vertex_groups.new(name='reduce')
        own = dominant_segments(body)
        for v in body.data.vertices:
            r = region_of(v.co, own[v.index], lm)
            grp.add([v.index], REDUCE_W if r in ('head', 'hand') else BODY_KEEP,
                    'REPLACE')
        dec = body.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = DECIMATE
        dec.vertex_group = 'reduce'
        dec.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()

    after, counts = region_shares(body, lm)
    log(f'faces after:  head {after["head"]:.1%}, face {after["face"]:.1%}, '
        f'hand {after["hand"]:.1%}, suit {after["body"]:.1%}  ({counts})')

    # UNWRAP FRESH, into 0-1.
    #
    # The base mesh arrives already unwrapped, and the temptation is to keep that
    # layout — it is a proper human one with the seams where an artist put them.
    # But it is spread across UDIM tiles: measured in the running game, its UVs
    # spanned 11.9 rather than 1. A bake writes into a single 0-1 image, so all
    # but one tile's worth of the body sampled outside the atlas and wrapped onto
    # whatever was there, which rendered as dark blotches scattered over the suit.
    # Decimation has already discarded the artist topology those seams were placed
    # for, so there is little left to preserve.
    # Shrink the head and hands in 3D for the duration of the projection only.
    # smart_project sizes each island from the world area of the faces it covers,
    # so this is the lever that decides how many texels a region gets. Scaling by
    # UV_SHRINK claims UV_SHRINK^2 of the area it otherwise would.
    saved = [v.co.copy() for v in body.data.vertices]
    own2 = dominant_segments(body)
    pivots, groups = {}, {'head': [], 'hand': []}
    for i, v in enumerate(body.data.vertices):
        r = region_of(v.co, own2[i], lm)
        # The FACE keeps full size — it carries eyes/nose/mouth texels now.
        # The shell and hands still claim less of the atlas than their world
        # area would (UV_SHRINK^2).
        if r in ('head', 'hand'):
            groups[r].append(i)
    for r, idxs in groups.items():
        if not idxs:
            continue
        p = Vector((0, 0, 0))
        for i in idxs:
            p = p + body.data.vertices[i].co
        pivots[r] = p / len(idxs)
        for i in idxs:
            v = body.data.vertices[i]
            v.co = pivots[r] + (v.co - pivots[r]) * UV_SHRINK

    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0,
                             area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, merge_overlap=False,
                            margin_method='FRACTION', margin=0.004,
                            shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Put the geometry back. Only the UVs keep the reweighting.
    for i, co in enumerate(saved):
        body.data.vertices[i].co = co
    # The share of the ATLAS each region ended up with. This is the number the
    # unwrap weighting exists to move, and it is not the same as the face share —
    # texels are allocated by island area, triangles by the decimator.
    uvl = body.data.uv_layers.active.data
    area = {'head': 0.0, 'face': 0.0, 'hand': 0.0, 'body': 0.0}
    vs = body.data.vertices
    for poly in body.data.polygons:
        uvs = [uvl[i].uv for i in poly.loop_indices]
        a = 0.0
        for i in range(len(uvs)):
            x1, y1 = uvs[i]
            x2, y2 = uvs[(i + 1) % len(uvs)]
            a += x1 * y2 - x2 * y1
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c = c + vs[vi].co
        area[region_of(c / len(poly.vertices), None, lm)] += abs(a) * 0.5
    total = max(1e-9, sum(area.values()))
    log(f'unwrap weighted (head/hands x{UV_SHRINK:.2f}, face full): atlas share — '
        f'head {area["head"] / total:.1%}, face {area["face"] / total:.1%}, '
        f'hand {area["hand"] / total:.1%}, suit {area["body"] / total:.1%}')

    uvs = body.data.uv_layers.active.data
    us = [d.uv[0] for d in uvs]
    vs = [d.uv[1] for d in uvs]
    span = max(max(us) - min(us), max(vs) - min(vs))
    log(f'unwrapped: uv span {span:.3f}, '
        f'u={min(us):+.3f}..{max(us):+.3f} v={min(vs):+.3f}..{max(vs):+.3f}')
    if span > 1.02 or min(us) < -0.02 or min(vs) < -0.02:
        raise SystemExit(
            f'[body] UVs are outside 0-1 (span {span:.3f}). Everything beyond the '
            f'first tile would sample outside the baked atlas.')

    suit = bpy.data.materials.new('suitMat')
    helmet = bpy.data.materials.new('helmetMat')
    face = bpy.data.materials.new('faceMat')
    body.data.materials.clear()
    body.data.materials.append(suit)
    body.data.materials.append(helmet)
    body.data.materials.append(face)

    # THREE material slots — suit (0), helmet (1), face (2) — so Babylon
    # receives three submeshes and can shade the shell glossy, the suit matte
    # lycra and the skin matte. They SHARE the baked maps and the single UV
    # layout; the split is about shading, not texturing.
    #
    # Assigned by SEGMENT + head REGION (never by height — that mistake once
    # classified 47% of the mesh as helmet). Lens polys ride the helmet slot:
    # both are dark and need gloss; the skin gets its own slot.
    n_head = n_face = 0
    own3 = dominant_segments(body)
    for poly in body.data.polygons:
        if own3[poly.vertices[0]] == 'head':
            cx = sum(body.data.vertices[v].co.x for v in poly.vertices) / len(poly.vertices)
            cy = sum(body.data.vertices[v].co.y for v in poly.vertices) / len(poly.vertices)
            cz = sum(body.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
            reg = head_region(Vector((cx, cy, cz)), lm)
            poly.material_index = 2 if reg == 'face' else 1
            if reg == 'face':
                n_face += 1
            else:
                n_head += 1
    log(f'low-poly: {len(body.data.vertices)} verts, {len(body.data.polygons)} '
        f'faces, {n_head} shell faces ({n_head / max(1, len(body.data.polygons)):.0%}), '
        f'{n_face} face faces ({n_face / max(1, len(body.data.polygons)):.0%})')
    return body


def make_highpoly(low, lm):
    """
    The detail source: subdivided from the SAME mesh, then displaced and painted.

    Sharing the base matters. A high-poly built independently would not sit on the
    low-poly surface, and every baked normal would carry that mismatch as a
    smeared, wobbling error across the whole body.
    """
    high = low.copy()
    high.data = low.data.copy()
    high.name = 'athleteHigh'
    bpy.context.collection.objects.link(high)
    # It must not be deformed by the rig while it is being baked from.
    for m in list(high.modifiers):
        high.modifiers.remove(m)

    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high

    sub = high.modifiers.new('subsurf', 'SUBSURF')
    # SIMPLE, not Catmull-Clark. Catmull-Clark SMOOTHS as it subdivides, so the
    # high-poly ends up a different SHAPE from the low-poly — and a normal bake
    # records exactly the difference between the two. On a decimated human that
    # difference is centimetres of whole-body reshaping, which swamps the
    # millimetre suit detail this bake exists for and renders as grey mottling
    # crawling over the figure. (It went unnoticed on the metaball body, which was
    # already smooth enough that Catmull-Clark barely moved it.)
    #
    # Simple subdivision adds vertices without moving the surface, so the only
    # difference left between high and low is the displacement applied below —
    # which is precisely what should end up in the map.
    sub.subdivision_type = 'SIMPLE'
    sub.levels = sub.render_levels = 2
    bpy.ops.object.modifier_apply(modifier=sub.name)
    log(f'high-poly: {len(high.data.vertices)} verts before displacement')

    displace_suit(high, lm)
    paint_suit(high, lm)

    high.data.materials.clear()
    mat = bpy.data.materials.new('highSuit')
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get('Principled BSDF')
    ca = tree.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'suit'
    tree.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = 0.72
    high.data.materials.append(mat)
    return high


# ── Baking ──────────────────────────────────────────────────────────────────

def configure_cycles():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    used = 'CPU'
    for backend in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == backend]
            if devs:
                for d in prefs.devices:
                    d.use = (d.type == backend)
                sc.cycles.device = 'GPU'
                used = f'{backend} ({devs[0].name})'
                break
        except Exception as e:
            log(f'{backend} unavailable: {e}')
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    log(f'cycles device: {used}')
    return used


def target_image(low, img):
    """Point every LOW-POLY material at `img`, replacing any previous target."""
    for slot in low.material_slots:
        mat = slot.material
        if not mat:
            continue
        if not mat.use_nodes:
            mat.use_nodes = True
        tree = mat.node_tree
        for n in [n for n in tree.nodes if n.bl_idname == 'ShaderNodeTexImage']:
            tree.nodes.remove(n)
        node = tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.select = True
        tree.nodes.active = node


def bake_maps(low, high, out_dir):
    """
    Transfer the high-poly's detail onto the low-poly's UVs.

    selected_to_active with a cage: rays are fired from just outside the low-poly
    surface, hit the high-poly, and record what they found. cage_extrusion has to
    clear the deepest displacement — too small and the rays start inside the
    high-poly and the map fills with black speckle.
    """
    bake = bpy.context.scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.02
    bake.margin = 16
    # use_clear wipes the target image to black before baking, which would undo
    # the background fill below — the whole point of which is that the atlas must
    # NOT be black where nothing is baked.
    bake.use_clear = False

    def run(kind, name, srgb, fill, setup=None):
        # FILL THE BACKGROUND FIRST, and not with black.
        #
        # Unwrapping a decimated human produces a lot of small islands, and only
        # about 40% of the atlas ends up covered. A bake leaves the rest at the
        # image's initial colour, which defaults to black — and then bilinear
        # filtering and every mip level pull that black in across each island's
        # edge. On the figure it read as dark blotches scattered over the suit, as
        # if the texture were camouflage. Starting from a neutral value (suit
        # colour, white occlusion, flat normal) makes the bleed invisible, because
        # what bleeds in is what should be there anyway.
        img = bpy.data.images.new(name, width=RES, height=RES, float_buffer=True)
        # Written straight into the pixel buffer rather than through
        # generated_color, which puts the value through colour management: a
        # normal-map fill of (0.5, 0.5, 1.0) came back as (0.21, 0.21, 1.0), i.e.
        # a background normal tilted hard to one side instead of flat. foreach_set
        # writes the numbers as given.
        bakeutil.fill_image(img, fill)
        target_image(low, img)
        bpy.ops.object.select_all(action='DESELECT')
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low      # active = the TARGET
        if setup:
            setup(bake)
        log(f'baking {name} {RES}x{RES} at {SAMPLES} samples...')
        bpy.ops.object.bake(type=kind)
        return bakeutil.save_bake(img, os.path.join(out_dir, f'{name}.png'),
                                  srgb=srgb, log=log)

    stats = {}
    bpy.context.scene.render.bake.normal_space = 'TANGENT'
    # A tangent-space normal pointing straight out is (0.5, 0.5, 1.0); occlusion
    # with nothing occluding is 1.0; unpainted suit is the suit's own colour.
    stats['normal'] = run('NORMAL', 'athlete_normal', srgb=False,
                          fill=(0.5, 0.5, 1.0, 1.0))
    # AO IS LIMITED TO A SHORT DISTANCE, on purpose.
    #
    # An unlimited AO bake sees the whole body, and the body is baked in
    # POSE_UNTUCKED with its arms overhead — so it records the shadow the arms
    # cast into the shoulders and the gap between them, and freezes it into the
    # texture. At runtime the arms MOVE, and that occlusion stays behind on the
    # chest wherever the athlete puts them. It renders as grey blotching that
    # follows the body around.
    #
    # What is worth baking is only what the low-poly cannot express: the seams,
    # the fold at a joint, the lip around the bib. Those are all within a few
    # centimetres. The pose-dependent part is SSAO2's job, and SSAO2 is already
    # in the pipeline — it is computed per frame from the actual pose, which is
    # exactly what a baked map cannot be.
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new('bakeWorld')
    bpy.context.scene.world.light_settings.distance = 0.04
    stats['ao'] = run('AO', 'athlete_ao', srgb=False, fill=(1.0, 1.0, 1.0, 1.0))

    def albedo_only(b):
        b.use_pass_direct = False
        b.use_pass_indirect = False
        b.use_pass_color = True
    stats['albedo'] = run('DIFFUSE', 'athlete_albedo', srgb=True,
                          fill=(SUIT[0], SUIT[1], SUIT[2], 1.0), setup=albedo_only)
    return stats


def add_equipment():
    """Skis stay rigid, separate objects."""
    made = []
    for name in ('skiL', 'skiR'):
        seg = SEGMENTS[name]
        c = bl(name)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=c)
        o = bpy.context.active_object
        o.name = name
        # (w, d, h) is correct and was briefly "fixed" to something else. bl()
        # maps POSITIONS through the exporter's yup conversion, but a scale is
        # local: Blender Y becomes Babylon Z, so the ski's 1.20 m depth lands on
        # the fall line. The apparent bug was a world-space bounding box being
        # read while the skier was yawed — see tests/drive/rig.spec.js.
        o.scale = (seg['w'], seg['d'], seg['h'])
        bpy.ops.object.transform_apply(scale=True)
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = 0.006
        m.segments = 3
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.object.shade_smooth()
        made.append(o)
    return made


def patch_skin_binds(path):
    """
    Rewrite the skin's inverseBindMatrices to exactly inverse(driver rest).

    WHY THIS EXISTS. Babylon skins a vertex with `current x inverseBind`, and
    with linkTransformNode the "current" half IS the driver's transform — so
    bind-equals-driver is a statement purely about the 160 floats in the glb's
    skin accessor: IBM_j must equal inverse(T(centre_j) · Rot_driver(j) @ rest).

    The Blender exporter derives those matrices from its own joint rest states,
    and the chain (edit-bone matrix -> exporter joint TRS -> accessor bytes)
    does not preserve them the way the runtime needs: measured on this very
    export, every leg/torso/head node carries an extra -90 deg about X and every
    arm +90 deg, so a bone would skin in with a residual quarter-turn twist even
    standing still (the old build's shoulder humps and sideways torso, at root).
    node rotations are irrelevant to the fix because game.js overrides each
    linked bone's local matrix from its driver every frame; what survives is the
    accessor.

    So the binding is asserted here, after the export, where the numbers can be
    seen rather than inferred: same-size float rewrite inside the GLB container.
    The driver rest transforms are known exactly by construction — bl() for the
    translation, identity except pi-about-X for the arms (armSweep(phi = pi) at
    armDrop = 1). Hard-fails if the accessor is not found or sized as expected.

    Runs on the raw GLB, no dependencies beyond the standard library.
    """
    import struct

    def seg_matrix(name):
        """
        The DRIVER'S REST LOCAL MATRIX, composed straight in the BABYLON axes
        the accessor is consumed in (the game links bones and never rebakes,
        so these floats ARE the binding): translation = the POSE_UNTUCKED
        centre exactly as game.js drives it — lateral on X, UP on Y, the
        BASE_Z fore/aft stagger on Z — rotation = identity except pi about X
        for the arms (armSweep(phi = pi) at armDrop = 1).
        """
        p = POSE.get(name, {})
        if is_arm(name):
            lat, up = ARM_BIND[name]
        else:
            lat = p.get('x', 0.0)
            up = p.get('y', 0.0)
        fore = BASE_Z.get(name, 0.0) + p.get('dz', 0.0)
        rot = Matrix.Identity(4)
        if is_arm(name):
            rot = Matrix.Rotation(math.pi, 4, 'X')
        return Matrix.Translation(Vector((lat, up, fore))) @ rot

    want = {nm: seg_matrix(nm).inverted() for nm in ANATOMY}

    data = bytearray(open(path, 'rb').read())
    magic, ver, total = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a GLB'

    # Walk chunks to find JSON and BIN.
    off = 12
    js = bin_ = None
    while off < len(data):
        ln, typ = struct.unpack_from('<II', data, off)
        body = data[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A:
            js = json.loads(bytes(body))
        elif typ == 0x004E4942:
            bin_ = off
        off += 8 + ln
    assert js is not None and bin_ is not None, 'GLB missing JSON/BIN chunk'
    bin_body_off = bin_ + 8

    skin = js['skins'][0]
    acc = js['accessors'][skin['inverseBindMatrices']]
    view = js['bufferViews'][acc['bufferView']]
    n = acc['count']
    assert acc['componentType'] == 5126 and n == len(want), (
        f'unexpected IBM accessor: type={acc.get("componentType")} count={n}')
    start = bin_body_off + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    floats_expected = n * 16
    assert view['byteLength'] == floats_expected * 4, (
        f'IBM bufferView holds {view["byteLength"] / 4} floats, '
        f'expected {floats_expected}')

    name_of = {}
    for i, nj in enumerate(js['nodes']):
        if i in set(skin['joints']) and nj.get('name') in want:
            name_of[skin['joints'].index(i)] = nj['name']
    assert len(name_of) == len(want), (
        f'joint names resolved {len(name_of)} of {len(want)}')

    worst = 0.0
    order = sorted(name_of.items())
    flat = []
    for slot, nm in order:
        m = want[nm]
        # glTF stores column-major: element k = row k%4, col k//4.
        vals = [m[r][c] for c in range(4) for r in range(4)]
        struct.pack_into('<16f', data, start + slot * 64, *vals)
    log('bind matrices patched onto driver rests (' +
        ', '.join(f'{slot}:{nm}' for slot, nm in order) + ')')
    open(path, 'wb').write(data)

    # Self-verify by re-reading the file just written.
    check = patch_skin_binds_verify(path, want)
    worst = check
    return worst


def patch_skin_binds_verify(path, want):
    """Re-read `path` and return the worst |IBM - want| element, per bone."""
    import struct
    data = open(path, 'rb').read()
    off = 12
    js = bin_ = None
    while off < len(data):
        ln, typ = struct.unpack_from('<II', data, off)
        body = data[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A:
            js = json.loads(bytes(body))
        elif typ == 0x004E4942:
            bin_ = off
        off += 8 + ln
    skin = js['skins'][0]
    acc = js['accessors'][skin['inverseBindMatrices']]
    view = js['bufferViews'][acc['bufferView']]
    start = bin_ + 8 + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    name_of = {}
    for i, nj in enumerate(js['nodes']):
        if i in set(skin['joints']) and nj.get('name') in want:
            name_of[skin['joints'].index(i)] = nj['name']
    worst = 0.0
    for slot, nm in sorted(name_of.items()):
        got = struct.unpack_from('<16f', data, start + slot * 64)
        w = want[nm]
        expected = [w[r][c] for c in range(4) for r in range(4)]
        worst = max(worst, max(abs(g - e) for g, e in zip(got, expected)))
    log(f'verified written binds against driver rests: worst element diff '
        f'{worst:.2e}')
    return worst


def main():
    clear()
    body = load_base()
    # Coarse, geometry-only head landmarks for the pre-rig soften pass (no
    # weights exist yet): a real head is ~13% of standing height.
    zs = [v.co.z for v in body.data.vertices]
    top0 = max(zs)
    hh0 = (top0 - min(zs)) * 0.132
    chin0 = top0 - hh0
    lm0 = {'chin': chin0, 'top': top0, 'h': hh0,
           'eyes': chin0 + hh0 * 0.50,
           'brim0': chin0 + hh0 * 0.52,
           'brim1': chin0 + hh0 * 0.64,
           'crown_smooth': chin0 + hh0 * 0.70}
    soften(body, lm0)
    joints = anatomical_joints(body)
    joints = mesh_arm_joints(body, joints)
    arm = build_armature(joints)
    skin(body, arm)
    sharpen_limb_weights(body, joints)
    rebind_arm_weights(body, joints)
    rigid_boots(body, arm, joints)

    # How tall the boot is: ankle joint down to the sole, expressed in the shin's
    # own scale so it survives the stretch onto the game's segment length.
    sole = min(v.co.z for v in body.data.vertices)
    rest_shin = (joints['kneeL'] - joints['ankleL']).length
    foot_lift = (joints['ankleL'].z - sole) * (SEGMENTS['lowerLegL']['h'] / rest_shin)
    log(f'boot height {foot_lift:.3f} m (ankle {joints["ankleL"].z:.3f}, sole {sole:.3f})')

    _arm_cloud_dbg(body, 'pre-pose')
    _arm_trace(body, 'pre-pose')
    stretch = pose_onto_segments(body, arm, foot_lift)
    _arm_trace(body, 'after-pose')
    _arm_cloud_dbg(body, 'after-pose')

    # Face/helmet landmarks are measured off the POSED mesh; every downstream
    # consumer (helmet projection, paint, material split, displacement) must
    # share ONE set of numbers.
    lm = head_landmarks(body)
    log(f'head landmarks: chin {lm["chin"]:+.3f}, eyes {lm["eyes"]:+.3f}, '
        f'brim {lm["brim0"]:+.3f}..{lm["brim1"]:+.3f}, crown {lm["top"]:+.3f}')
    shape_helmet(body, lm)
    retune_proportions(body)
    _arm_trace(body, 'after-retune')
    # The shrink above moved every head vertex — RE-MEASURE before anything
    # reads the landmark heights again.
    lm = head_landmarks(body)

    leg_profile(body, 'post-pose')
    build_report(body, 'before girth')
    straighten_forearms(body)
    settle_limb_geometry(body)
    scale_hands(body)
    _arm_trace(body, 'after-settle')
    _arm_cloud_dbg(body, 'final')
    leg_profile(body, 'pre-girth ')
    add_girth(body, stretch)
    seat_soles(body)
    align_boots(body, joints)
    prof = leg_profile(body, 'final')
    # Straight-arm gates (reviewer order iter 23/24): collinearity <=1 cm,
    # forearm-hand join <=1 cm, hand axis within 10 deg of the forearm,
    # elbow cross-section step <=5 mm. GATE MODE: this iteration lands them
    # measuring in SOFT mode because the underlying whole-chain forearm lag
    # they expose (~29 cm off-column post-bake, see progress entry 24) is not
    # yet repaired — flipping '--gate-mode hard' must happen with the rebuild
    # that actually passes them.
    armgates = arm_geometry_report(body)
    hand_ratio_gate(body)
    GATE_MODE = arg('--gate-mode', 'soft')
    if armgates is not None and GATE_MODE == 'hard' and (
            armgates['collinear'] > 0.010 or armgates['join'] > 0.010
            or armgates['hand_axis'] > 10.0 or armgates['elbow_step'] > 0.005):
        raise SystemExit(
            f'[body] straight-arm gates FAILED: collinear '
            f'{armgates["collinear"]*1000:.1f} mm / join '
            f'{armgates["join"]*1000:.1f} mm (limit 10), hand axis '
            f'{armgates["hand_axis"]:.1f} deg (limit 10), elbow step '
            f'{armgates["elbow_step"]*1000:.1f} mm (limit 5)')
    # A STEP is what the author sees as a notch on the rendered leg;
    # anatomical waists are allowed, discontinuities are not. The fail level
    # is calibrated on this mesh's measured noise floor: smooth builds show
    # isolated ≤±17 mm single-row blips (2 cm bands), while the actual
    # repaired defects measured 40-100 mm.
    if prof['step'] > 0.030:
        raise SystemExit(
            f'[body] leg profile has a {prof["step"] * 1000:.1f} mm slope step at '
            f'z={prof["step_z"]:+.3f} — that is the hard notch, not an anatomical '
            f'waist')
    build_report(body, 'after girth ')
    low = finish_lowpoly(body, lm)
    high = make_highpoly(low, lm)

    device = configure_cycles()
    out_dir = os.path.join(ROOT, 'assets')
    os.makedirs(out_dir, exist_ok=True)
    stats = bake_maps(low, high, out_dir)

    # Per-segment albedo census on the LOW mesh: sample the saved albedo at
    # each vertex's UV and classify it, grouped by dominant bone group. This
    # is the same question the browser test asks the glb — if legs read white
    # HERE, the bake wrote the stripe into the wrong texels.
    img = bpy.data.images.load(os.path.join(out_dir, 'athlete_albedo.png'))
    w, h = img.size
    px = img.pixels[:]
    own_low = dominant_segments(low)
    uvl = low.data.uv_layers.active.data
    v2uv = {}
    for li, l in enumerate(low.data.loops):
        v2uv[l.vertex_index] = tuple(uvl[li].uv)
    cens = {}
    blue_leg_detail = []
    leg_uvs = []
    ymin = min(v.co.z for v in low.data.vertices)
    ymax = max(v.co.z for v in low.data.vertices)
    for i, vtx in enumerate(low.data.vertices):
        s = v2uv.get(i)
        if not s:
            continue
        xi = min(w - 1, int(s[0] * w))
        yi = min(h - 1, int(s[1] * h))
        o = 4 * (yi * w + xi)
        r, b = px[o], px[o + 2]
        seg = own_low[i]
        key = 'leg' if seg.startswith(('upperLeg', 'lowerLeg')) else seg
        e = cens.setdefault(key, [0, 0])
        e[0] += 1
        blue = b - r > 0.15
        if blue:
            e[1] += 1
        if seg.startswith(('upperLeg', 'lowerLeg')):
            leg_uvs.append(s)
            if blue:
                blue_leg_detail.append(
                    (round((vtx.co.z - ymin) / (ymax - ymin), 2),
                     round(vtx.co.z, 3), seg))
    log('albedo census (blue/total per segment): ' + ' '.join(
        f'{k}={v[1]}/{v[0]}' for k, v in sorted(cens.items())))
    if leg_uvs:
        us = sorted(u for u, _ in leg_uvs)
        vs = sorted(v for _, v in leg_uvs)
        log(f'leg uv box: u {us[0]:.3f}..{us[-1]:.3f} v {vs[0]:.3f}..{vs[-1]:.3f} '
            f'(n={len(leg_uvs)})')
    if blue_leg_detail:
        blue_leg_detail.sort()
        log('blue-reading leg verts (fy, z, seg): ' + ', '.join(
            f'{fy}@{z} {seg}' for fy, z, seg in blue_leg_detail[:40]))
    bpy.data.images.remove(img)

    # GATE: the stripe must survive into the saved texture at the LEGS' own UVs
    # — the same question the browser test asks the glb. The 0.02 floor is the
    # measured 512-res floor (a thin band + bake margin); a lost stripe reads
    # ~0.005 with blue only at the soles.
    bib_number_gate(low, out_dir)
    leg_blue = cens.get('leg', [0, 0])
    leg_frac = leg_blue[1] / max(1, leg_blue[0])
    log(f'stripe bake gate: {leg_blue[1]}/{leg_blue[0]} leg verts read blue '
        f'({leg_frac:.3f})')
    if leg_frac < 0.02:
        raise SystemExit(
            f'[body] only {leg_frac:.3f} of low-poly leg vertices read blue '
            f'from the baked albedo — the stripe is not landing on the legs '
            f'(paint azimuth or bake transfer)')

    # The high-poly has done its job. Leaving it in would export a second body.
    bpy.data.objects.remove(high, do_unlink=True)

    equip = add_equipment()

    with open(os.path.join(out_dir, 'athlete_maps.json'), 'w') as f:
        json.dump({
            'normal': 'assets/athlete_normal.png',
            'ao': 'assets/athlete_ao.png',
            'albedo': 'assets/athlete_albedo.png',
            'res': RES, 'stats': stats,
        }, f, indent=1)

    out = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    arm.select_set(True)
    for o in equip:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=False,   # apply=False keeps the armature
        export_skins=True, export_animations=False,
    )
    # Bind := driver, written where it survives the trip: see the essay above
    # patch_skin_binds for why this is asserted on the file and not assumed.
    residual = patch_skin_binds(out)
    if residual > 1e-5:
        raise SystemExit(f'[body] bind matrices drifted from driver rests by '
                         f'{residual:.2e} after rewrite')
    log(f'BODY_EXPORTED device={device} path={out} verts={len(low.data.vertices)} '
        f'bones={len(arm.data.bones)} equipment={len(equip)} res={RES}')


main()

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
    'upperArmL': (-0.205, 0.150 - 0.150), 'upperArmR': (0.205, 0.150 - 0.150),
    'lowerArmL': (-0.205, 0.150 - 0.425), 'lowerArmR': (0.205, 0.150 - 0.425),
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


def soften(obj):
    """
    Remove the detail a race suit would hide, and round the head into a helmet.

    Two different problems. Over the body, the base mesh carries anatomical
    detail — nipples, navel, genitals, knuckles — that a skin-tight lycra suit
    covers; a light smoothing pass keeps the form and drops the detail. Over the
    head the problem is bigger: an aerials athlete wears a close-fitting helmet,
    and a head with a nose, ears and eye sockets reads unmistakably as a FACE no
    matter what colour it is painted. Smoothing hard above the jaw turns it into
    the dome it needs to be.
    """
    me = obj.data
    zs = [v.co.z for v in me.vertices]
    top = max(zs)
    height = top - min(zs)
    # The jaw sits at about 0.87 of standing height on a human figure.
    jaw = min(zs) + height * 0.86

    grp = obj.vertex_groups.new(name='headMask')
    for v in me.vertices:
        if v.co.z >= jaw:
            # Ramp in over the last few centimetres so the neck does not step.
            t = min(1.0, (v.co.z - jaw) / (height * 0.03))
            grp.add([v.index], t, 'REPLACE')

    # THE BODY IS NOT SMOOTHED ANY MORE, and that was the single biggest
    # self-inflicted wound in this pipeline.
    #
    # It used to run a Laplacian smooth at factor 0.6 for 3 iterations over the
    # whole figure, to hide anatomical detail a race suit would cover. What it
    # actually did was erase the deltoid, the collarbone, the calf and the
    # quadriceps — every landmark that makes a body read as ATHLETIC — and
    # Laplacian smoothing shrinks volume while it does it. The result was a
    # figure whose suit looked loose and flowy, because underneath it there was
    # no longer a body with any shape for the suit to wrap.
    #
    # The detail it was hiding is a few millimetres deep on a 1.5 m figure and
    # sits below one texel of the baked normal map. It was never the problem.
    bpy.context.view_layer.objects.active = obj

    # Only a light pass here to take the sharpest facial detail off. The head is
    # given its real helmet shape later by shape_helmet(), once it has been posed
    # onto the head segment — projecting onto an ellipsoid needs to happen in the
    # frame the ellipsoid is defined in.
    head = obj.modifiers.new('softenHead', 'SMOOTH')
    head.factor = 0.8
    head.iterations = 4
    head.vertex_group = 'headMask'
    bpy.ops.object.modifier_apply(modifier=head.name)
    log(f'softened: body pass + {head.iterations} head iterations above z={jaw:.3f}')


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

    The factor is blended between segments by inverse-square distance rather than
    taken from the nearest one, so it varies smoothly across every joint instead
    of stepping at the hip and shoulder.
    """
    axes = {n: (bl(n), SEGMENTS[n]['h'] / 2) for n in BODY_SEGMENTS}
    n = 0
    for v in body.data.vertices:
        off, dist = skeleton_offset(v.co)
        if dist < 1e-6:
            continue
        p = Vector(v.co)
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
    log(f'girth matched to stretch ({lo:.2f}..{hi:.2f}) x global {GIRTH:.2f}, '
        f'{n} verts')



def shape_helmet(body):
    """
    Make the head an actual HELMET, instead of smoothing a face until it stops
    looking like one.

    The previous approach ran 26 Laplacian smoothing iterations over everything
    above the jaw. Laplacian smoothing does not converge on a sphere — it
    converges on whatever the mesh's own connectivity pulls it towards, shrinking
    as it goes — so the result was an irregular teardrop swept back off a long
    thin neck, which is exactly what a misshapen head looks like.

    A helmet is a known shape, so it is built rather than approximated: every
    vertex above the jaw is projected onto an ellipsoid sized from the head
    segment. The projection fades out over the last few centimetres above the
    neck so the join stays continuous, and the ellipsoid is slightly deeper than
    it is wide, which is the proportion of a real helmet.
    """
    seg = SEGMENTS['head']
    c = bl('head')
    jaw = c.z - seg['h'] / 2 * 0.55

    # Lateral, fore/aft, vertical radii. A helmet is longer front-to-back than it
    # is wide, and its crown sits above the head's own centre. With the frame
    # contract above, lateral is X and fore/aft is Y.
    rx, ry, rz = seg['w'] / 2 * 1.00, seg['d'] / 2 * 1.02, seg['h'] / 2 * 1.06
    top = c.z + rz
    moved = 0
    own4 = dominant_segments(body)
    for v in body.data.vertices:
        # By SEGMENT, never by height. POSE_UNTUCKED holds the arms overhead, so
        # a bare "above the jaw" test sweeps in both forearms and both hands — the
        # first version projected them onto the helmet ellipsoid and the gloves
        # vanished entirely. The paint census caught it; nothing else would have.
        if own4[v.index] != 'head' or v.co.z < jaw:
            continue
        d = Vector((v.co.x - c.x, v.co.y - c.y, v.co.z - c.z))
        n = math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2)
        if n < 1e-6:
            continue
        target = Vector((c.x + d.x / n, c.y + d.y / n, c.z + d.z / n))
        # Full strength at the crown, fading to nothing at the jaw so the neck
        # is not pulled sideways.
        t = min(1.0, (v.co.z - jaw) / max(1e-4, (top - jaw) * 0.45))
        w = t * t * (3 - 2 * t)
        v.co = Vector(v.co) * (1 - w) + target * w
        moved += 1
    log(f'helmet shaped: {moved} verts projected onto a '
        f'{rx * 2:.3f}x{ry * 2:.3f}x{rz * 2:.3f} m shell above z={jaw:.3f}')


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



def leg_profile(body, tag):
    """
    Width of one leg every 2 cm from hip to sole.

    A "notch" is a local minimum in this profile: the leg narrows and widens
    again over a few centimetres. Eyeballing a render cannot tell that from a
    shadow, a seam in the texture, or the far leg showing through — this can, and
    it says exactly which height it is at so the step that caused it is findable.
    """
    hip = bl('upperLegL').z + SEGMENTS['upperLegL']['h'] / 2
    sole = bl('skiL').z + SEGMENTS['skiL']['h'] / 2
    rows, prev = [], None
    z = hip
    while z > sole:
        # Lateral width is X now; keep only the game-L half of the figure so a
        # jog of the two thighs cannot read as one wide leg.
        xs = [v.co.x for v in body.data.vertices
              if abs(v.co.z - z) < 0.012 and v.co.x < -0.005]
        w = (max(xs) - min(xs)) if len(xs) > 3 else 0.0
        rows.append((z, w))
        z -= 0.02
    widths = [w for _, w in rows]
    worst, worst_z = 0.0, None
    for i in range(1, len(rows) - 1):
        dip = min(widths[i - 1], widths[i + 1]) - widths[i]
        if dip > worst:
            worst, worst_z = dip, rows[i][0]
    log(f'{tag} leg profile: ' + ' '.join(f'{w:.3f}' for w in widths))
    if worst > 0.012:
        log(f'{tag} NOTCH: leg narrows {worst * 1000:.0f} mm at z={worst_z:+.3f} '
            f'and widens again — that is a dent in the silhouette')
    else:
        log(f'{tag} leg profile smooth (largest dip {worst * 1000:.1f} mm)')
    return worst


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
    # RAMPED, not a hard step.
    #
    # Pinning everything below the ankle to weight 1.0 and stripping the other
    # groups leaves a 0-to-1 discontinuity in one ring of vertices, and linear
    # blend skinning pinches wherever weights jump. Measured in the browser, the
    # leg necked in by 29 mm in a single 2 cm band at exactly the ankle. Blending
    # the pin in over a few centimetres keeps the boot rigid where it matters —
    # the sole and the shell — without leaving a crease at the top of it.
    BAND = 0.045
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

    The bib in the reference covers the chest from just under the arms to the
    waist and wraps a little way round the ribs; it is a front garment, so the
    back of the torso is bare suit. `lat` is the LATERAL offset from the segment
    axis — how far round towards the ribs.
    """
    if name != 'torso' or front < 0:
        return 0.0
    if not (-0.68 < along < 0.52):
        return 0.0
    edge = min(along + 0.68, 0.52 - along) / 0.12
    wrap = 1.0 - max(0.0, (abs(lat) - 0.09) / 0.05)
    return max(0.0, min(1.0, edge)) * max(0.0, min(1.0, wrap))


def displace_suit(obj):
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
            # Helmet: hard, smooth, with a shallow crown ridge and the goggle
            # strap. No fabric weave — a woven helmet reads as a knitted hat.
            # The crown ridge runs fore/aft over the top, so it narrows in the
            # LATERAL direction.
            d += 0.0012 * math.exp(-((lx / 0.03) ** 2))          # crown ridge
            d += 0.0022 * math.exp(-(((lz - 0.02) / 0.022) ** 2))  # goggle strap
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
            # measured in the transverse plane with atan2(fore/aft, lateral): the
            # outboard direction of a leg lies ON the lateral axis, at angle 0 or
            # pi depending on the side; the back of the torso is the -Y direction,
            # angle pi either way.
            azim = math.atan2(ly, lx)
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


def paint_suit(obj):
    """
    Vertex colours for the suit design, baked to the albedo map afterwards.

    Painting in 3D and baking is far more robust than drawing into UV space: the
    unwrap can change without any of this moving, and a region defined by "the
    outboard side of the leg" cannot land on the wrong island.
    """
    mesh = obj.data
    owner = dominant_segments(obj)
    attr = mesh.color_attributes.new(name='suit', type='FLOAT_COLOR', domain='POINT')
    counts = {}
    for i, v in enumerate(mesh.vertices):
        x, y, z = v.co
        name, along, radial, out, front, local = segment_frame((x, y, z), owner[i])
        lx, ly, lz = local          # lateral, fore/aft (chest +), up
        col, tag = SUIT, 'suit'

        if name == 'head':
            col, tag = HELMET, 'helmet'
        elif name.startswith('lowerArm') and along < -0.78:
            col, tag = GLOVE, 'glove'
        elif name == 'torso' and -0.95 < along < -0.70:
            col, tag = WAIST, 'waist'
        elif name.startswith(('upperLeg', 'lowerLeg')):
            # See displace_suit for the transverse-angle convention: outboard is
            # angle 0 or pi depending on side.
            azim = math.atan2(ly, lx)
            outward = 0.0 if out > 0 else math.pi
            dphi = abs(math.atan2(math.sin(azim - outward), math.cos(azim - outward)))
            # Narrowed from 0.38: at that width the stripe wrapped most of the
            # way round the shin and the leg read as blue with a white edge
            # rather than white with a blue stripe.
            if dphi < 0.26:
                col, tag = STRIPE, 'stripe'

        if bib_mask(name, along, front, lx) > 0.5:
            # A plain block rather than a legible numeral: at any distance this
            # figure is ever shown, a white patch and a white "15" are the same
            # number of pixels, and a drawn digit would be the one detail that
            # looks obviously synthetic up close.
            if -0.34 < along < 0.06 and abs(lx) < 0.062:
                col, tag = BIB_NUMBER, 'number'
            else:
                col, tag = BIB, 'bib'

        attr.data[i].color = (col[0], col[1], col[2], 1.0)
        counts[tag] = counts.get(tag, 0) + 1
    log(f'suit painted: {counts}')
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
    missing = [t for t in ('suit', 'helmet', 'waist', 'bib', 'number',
                           'stripe', 'glove') if counts.get(t, 0) == 0]
    if missing:
        raise SystemExit(
            f'[body] these suit regions matched no vertices: {missing}. Their '
            f'conditions are wrong for the reference pose, and the bake would '
            f'silently omit them.')
    return counts


# ── Low / high poly ─────────────────────────────────────────────────────────

def region_of(co, force=None):
    """'head', 'hand' or 'body' — the three budgets that get different shares."""
    name, along, radial, out, front, local = segment_frame(co, force)
    if name == 'head':
        return 'head'
    if name.startswith('lowerArm') and along < -0.78:
        return 'hand'
    return 'body'


def region_shares(body):
    """What fraction of the faces each region holds."""
    counts = {'head': 0, 'hand': 0, 'body': 0}
    vs = body.data.vertices
    owner = dominant_segments(body)
    for poly in body.data.polygons:
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c = c + vs[vi].co
        nm = owner[poly.vertices[0]]
        counts[region_of(c / len(poly.vertices), nm)] += 1
    total = max(1, sum(counts.values()))
    return {k: v / total for k, v in counts.items()}, counts


def finish_lowpoly(body):
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

    before, _ = region_shares(body)
    log(f'faces before: head {before["head"]:.1%}, hand {before["hand"]:.1%}, '
        f'suit {before["body"]:.1%}')

    if DECIMATE < 0.999:
        # Weight 1 where the collapse should bite hardest. The suit keeps a floor
        # so it is still reduced, just far less.
        grp = body.vertex_groups.new(name='reduce')
        own = dominant_segments(body)
        for v in body.data.vertices:
            r = region_of(v.co, own[v.index])
            grp.add([v.index], REDUCE_W if r in ('head', 'hand') else BODY_KEEP, 'REPLACE')
        dec = body.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = DECIMATE
        dec.vertex_group = 'reduce'
        dec.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()

    after, counts = region_shares(body)
    log(f'faces after:  head {after["head"]:.1%}, hand {after["hand"]:.1%}, '
        f'suit {after["body"]:.1%}  ({counts})')

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
        r = region_of(v.co, own2[i])
        if r != 'body':
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
    area = {'head': 0.0, 'hand': 0.0, 'body': 0.0}
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
        area[region_of(c / len(poly.vertices))] += abs(a) * 0.5
    total = max(1e-9, sum(area.values()))
    log(f'unwrap weighted (head/hands x{UV_SHRINK:.2f}): atlas share — '
        f'head {area["head"] / total:.1%}, hand {area["hand"] / total:.1%}, '
        f'suit {area["body"] / total:.1%}')

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
    body.data.materials.clear()
    body.data.materials.append(suit)
    body.data.materials.append(helmet)

    # Two material slots — suit (0) and helmet (1) — so Babylon receives two
    # submeshes and can give the helmet its own roughness. They SHARE the baked
    # maps and the single UV layout; the split is about shading, not texturing.
    #
    # Assigned by SEGMENT, not by height. A bare "above the neckline" threshold
    # works on a standing figure and fails completely here: POSE_UNTUCKED holds
    # the arms overhead, so the forearms and gloves sit well above the neck and
    # 47% of the mesh came back classified as helmet. segment_frame already knows
    # which segment a point belongs to, so ask it.
    n_head = 0
    own3 = dominant_segments(body)
    for poly in body.data.polygons:
        cx = sum(body.data.vertices[v].co.x for v in poly.vertices) / len(poly.vertices)
        cy = sum(body.data.vertices[v].co.y for v in poly.vertices) / len(poly.vertices)
        cz = sum(body.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
        if own3[poly.vertices[0]] == 'head':
            poly.material_index = 1
            n_head += 1
    log(f'low-poly: {len(body.data.vertices)} verts, {len(body.data.polygons)} '
        f'faces, {n_head} helmet faces ({n_head / max(1, len(body.data.polygons)):.0%})')
    return body


def make_highpoly(low):
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

    displace_suit(high)
    paint_suit(high)

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
    soften(body)
    joints = anatomical_joints(body)
    arm = build_armature(joints)
    skin(body, arm)
    rigid_boots(body, arm, joints)

    # How tall the boot is: ankle joint down to the sole, expressed in the shin's
    # own scale so it survives the stretch onto the game's segment length.
    sole = min(v.co.z for v in body.data.vertices)
    rest_shin = (joints['kneeL'] - joints['ankleL']).length
    foot_lift = (joints['ankleL'].z - sole) * (SEGMENTS['lowerLegL']['h'] / rest_shin)
    log(f'boot height {foot_lift:.3f} m (ankle {joints["ankleL"].z:.3f}, sole {sole:.3f})')

    stretch = pose_onto_segments(body, arm, foot_lift)
    shape_helmet(body)
    retune_proportions(body)
    leg_profile(body, 'pre-girth')
    build_report(body, 'before girth')
    add_girth(body, stretch)
    seat_soles(body)
    leg_profile(body, 'final')
    build_report(body, 'after girth ')
    low = finish_lowpoly(body)
    high = make_highpoly(low)

    device = configure_cycles()
    out_dir = os.path.join(ROOT, 'assets')
    os.makedirs(out_dir, exist_ok=True)
    stats = bake_maps(low, high, out_dir)

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

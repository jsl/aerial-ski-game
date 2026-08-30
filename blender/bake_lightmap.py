"""
Bake the two lighting terms Babylon cannot compute, with Cycles + OptiX.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/bake_lightmap.py -- --res 2048 --samples 512

WHAT IS ACTUALLY MISSING FROM THE RUNTIME
-----------------------------------------
The first version of this script baked COMBINED lighting and the second baked
indirect bounce. Both were wrong for this scene, and measuring said so:

  * COMBINED includes direct sunlight, which Babylon already renders in real
    time. Adding it counts every photon twice — the same mistake that washed the
    scene out when the map was first applied through the ambient slot.

  * INDIRECT-only came back 99.2% black. That is not a bug, it is geometry: this
    terrain is a handful of large flat slabs under an open sky. A point on a flat
    plane sees sky across almost its whole hemisphere and hardly any other
    surface, so there is nearly no bounce to capture. (The trees would bounce,
    except they are dark brown — they absorb.)

What the runtime genuinely gets wrong is different, and both errors are
MULTIPLICATIVE, which is what makes them safe to bake — a multiplier cannot
double-count light the way an additive term can:

  1. SKY VISIBILITY. The image-based ambient is applied at full strength
     everywhere, as though the entire sky dome were visible from every point.
     Snow tucked under a tree, inside the kicker's concave transition, or against
     a wall receives the same ambient as snow in the open. A path tracer computes
     the real fraction exactly.

  2. SUN SHADOW RESOLUTION. One 2048 shadow map is auto-fitted around every
     caster in the scene — 174 trees, the whole run, AND the distant background
     peaks — so it spans hundreds of metres and the terrain shadows come out
     mushy. Baked offline, the tree shadows on the snow are path-traced and soft
     in the right way, and the runtime map is then free to cover the athlete
     alone at a tight frustum.

OUTPUT
------
assets/terrain_skyvis.png   sky visibility, 1 = open sky   -> ambientTexture
assets/terrain_shadow.png   sun visibility, 1 = full sun   -> lightmapTexture
                                                              (as a shadowmap)
assets/terrain_uv2.json     per-mesh lightmap UVs, IN THE GAME'S VERTEX ORDER
assets/terrain_baked.glb    the same geometry, for eyeballing the bake offline

Both maps MULTIPLY an existing term, so the worst case if one is wrong is a
scene that is too dark or too flat — never one that is doubly lit.

ONLY THE SNOW RECEIVES
----------------------
Trees still CAST shadows and occlude sky — they are in the scene for the path
tracer — but they do not receive a map. There are ~174 of them against 28 snow
surfaces, so letting them into the atlas would spend most of the texels on
geometry nobody looks at and leave the landing hill with a patch a few pixels
across. Small dark objects keep real-time lighting; nobody can tell.

INPUT
-----
blender/terrain.json, extracted from the RUNNING game by
tests/drive/extract-terrain.spec.js — real world-space geometry and the actual
light rig values, so the bake matches what the player sees.

WHY A UV SIDECAR AND NOT THE GLB
--------------------------------
The game needs uv2 on the meshes it already has. Reading it back out of the glb
does not work: the glTF exporter splits a vertex wherever a UV seams, so the
exported vertex order no longer matches the game's and there is no way to map one
to the other after the fact. The sidecar is written directly from Blender in the
ORIGINAL vertex order, so the game applies it with a single setVerticesData and
keeps its meshes, materials, parents and physics untouched.

The script REFUSES to write a sidecar whose UVs are ambiguous (one vertex, two
different UVs across the faces that share it) rather than silently emitting a
mesh that would be lit wrongly. See check_uv_consistency.
"""

import bpy
import json
import math
import os
import sys

HERE_BOOT = os.path.dirname(os.path.abspath(__file__))
if HERE_BOOT not in sys.path:
    sys.path.append(HERE_BOOT)
import bakeutil                                              # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


RES = int(arg('--res', '2048'))
SAMPLES = int(arg('--samples', '512'))

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TREES = arg('--trees', os.path.join(HERE, 'trees.json'))
DATA = json.load(open(os.path.join(HERE, 'terrain.json')))

# Surfaces that RECEIVE a baked map. Everything else in terrain.json is still
# built — it has to be, or it would cast no shadow and occlude no sky — but it is
# kept out of the atlas so the snow gets the texels.
#
# The background peaks (pk_body_*, pk_cap_*) are deliberately absent. They are
# cones whose vertices are SHARED between faces, so check_uv_consistency rejects
# them — correctly, since a per-vertex uv2 cannot describe a seam. They are also
# the surfaces that least need this: distant silhouettes under open sky, with
# nothing shadowing them and nothing nearby to occlude. Splitting them to force
# them in would spend atlas space on the least visible change in the scene.
RECEIVER_PREFIXES = (
    'terrainCorridor',
    'wInrun', 'wTable', 'wLanding', 'wOutrun', 'wStartPlat', 'wUpperMtn',
)


def log(msg):
    print(f'[bake] {msg}', flush=True)


def is_receiver(name):
    return name.startswith(RECEIVER_PREFIXES)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def signed_volume(verts, faces):
    """
    Positive when a CLOSED mesh's normals point outward, negative when inward.

    Unambiguous regardless of the mesh's orientation, tilt or shape, which is
    exactly what the face-normal counting it replaces was not. Only defined for
    watertight meshes: see mesh_watertight.
    """
    total = 0.0
    for a, b, c in faces:
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        cx, cy, cz = verts[c]
        total += (ax * (by * cz - bz * cy)
                  - ay * (bx * cz - bz * cx)
                  + az * (bx * cy - by * cx))
    return total / 6.0


def mesh_watertight(p, idx):
    """
    True when every edge of the position-welded mesh is shared by exactly two
    faces.

    Closure must be decided on POSITION-welded vertices: Babylon builders emit
    duplicated vertices per face (a box arrives as 24 vertices, not 8), and the
    corridor ribbon duplicates rings at hard slope breaks for clean normals.
    Index-level topology calls all of them open; welded topology separates the
    closed fill boxes from the genuinely open ribbon (terrainCorridor keeps 1096
    boundary edges after welding — its ends and sides).
    """
    canon = {}
    ids = []
    for i in range(0, len(p), 3):
        k = (round(p[i], 4), round(p[i + 1], 4), round(p[i + 2], 4))
        if k not in canon:
            canon[k] = len(canon)
        ids.append(canon[k])
    edges = {}
    for i in range(0, len(idx), 3):
        a, b, c = ids[idx[i]], ids[idx[i + 1]], ids[idx[i + 2]]
        if len({a, b, c}) < 3:
            continue
        for e in ((a, b), (b, c), (c, a)):
            key = tuple(sorted(e))
            edges[key] = edges.get(key, 0) + 1
    return all(n >= 2 for n in edges.values())


def sky_facing_census(verts, faces):
    """
    For an OPEN surface: fraction of faces pointing at the sky (+Z here — Blender
    space; the game's Y-up maps onto it through the mirror conversion above),
    their mean upward component, and the worst face's upward component.

    The AO/shadow bakes trace rays into the hemisphere around each FACE normal,
    so a downward-facing face samples light from under the ground and returns
    black — this is the invariant a bake needs from terrain that has no closure
    to test with signed_volume.
    """
    up, total = 0, 0
    mean_up, worst = 0.0, 1.0
    for a, b, c in faces:
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        cx, cy, cz = verts[c]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        l = math.sqrt(nx * nx + ny * ny + nz * nz)
        if l < 1e-12:
            continue
        nz /= l
        mean_up += nz
        total += 1
        if nz > 0:
            up += 1
        worst = min(worst, nz)
    return up / max(total, 1), mean_up / max(total, 1), worst


def build_geometry():
    """
    Rebuild the extracted meshes in Blender.

    Babylon is Y-up / left-handed; Blender is Z-up / right-handed, so positions
    convert (x, y, z) -> (x, z, y).

    WINDING IS LEFT ALONE, and that took three failed bakes to establish. Every
    earlier version of this script reversed it — "to compensate for the handedness
    flip" — and the result was that all 202 meshes came out INSIDE-OUT. Nothing
    about the render looked wrong, because the maps were never applied; what it
    looked like was a bake that produced black. Twice I went looking for the fault
    in Cycles settings instead.

    The reason it was so hard to see: counting up-facing against down-facing faces
    proves nothing (a box has two of each either way), and "is the +Z face on top"
    misreports on a tilted slab. SIGNED VOLUME settles it in one number, and
    build_geometry now asserts on it so this cannot regress silently. See
    blender/diag_normals.py.

    But signed volume is only DEFINED for watertight meshes. The P1 corridor
    ribbon is an open surface, and its "volume" degenerates to displacement about
    the origin: it measured −7316.84 while 100 % of its faces point at the sky
    (mean n·up 0.894). Flipping its winding to appease the volume assert — as
    iteration 11 queued — would flip every bake ray into the ground and produce
    exactly the black bake this script's history warns about (measured both ways;
    see the iteration-12 progress entry). Closed meshes keep the volume assert;
    open meshes get the invariant a hemisphere bake actually needs: no face may
    face away from the sky.
    """
    receivers, casters = [], []
    for m in DATA['meshes']:
        p = m['positions']
        verts = [(p[i], p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
        idx = m['indices']
        faces = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]

        vol = signed_volume(verts, faces)
        if mesh_watertight(p, idx):
            if vol < 0:
                raise SystemExit(
                    f'[bake] {m["name"]} rebuilt inside-out (signed volume {vol:.3f}). '
                    f'Every hemisphere ray would start inside the solid and every '
                    f'diffuse-style bake would return black.')
        elif is_receiver(m['name']):
            frac_up, mean_up, worst = sky_facing_census(verts, faces)
            if worst < -1e-3 or frac_up < 0.999:
                raise SystemExit(
                    f'[bake] {m["name"]} is open and does not uniformly face the sky '
                    f'(up-facing {frac_up * 100:.2f} %, mean n·up {mean_up:.3f}, worst '
                    f'n·up {worst:.4f}). Hemisphere rays sample around the face normal, '
                    f'so down-facing terrain bakes black.')
            log(f'{m["name"]}: open mesh — signed volume {vol:.2f} not used; '
                f'up-facing {frac_up * 100:.2f} %, mean n·up {mean_up:.3f}')
        else:
            # Open OCCLUDER (e.g. the vertical terrainSkirt closure wall): it
            # never receives a bake, so its normals only matter to rays that
            # hit it — no hemisphere invariant to enforce.
            log(f'{m["name"]}: open occluder — no receiver invariant')

        mesh = bpy.data.meshes.new(m['name'])
        mesh.from_pydata(verts, [], faces)
        mesh.validate()
        mesh.update()

        obj = bpy.data.objects.new(m['name'], mesh)
        bpy.context.collection.objects.link(obj)

        mat = bpy.data.materials.new(f"{m['name']}_mat")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            a = m.get('albedo') or [0.8, 0.8, 0.8]
            bsdf.inputs['Base Color'].default_value = (a[0], a[1], a[2], 1.0)
            if 'Roughness' in bsdf.inputs:
                bsdf.inputs['Roughness'].default_value = float(m.get('roughness', 0.8))
        obj.data.materials.append(mat)

        (receivers if is_receiver(m['name']) else casters).append(obj)

    log(f'built {len(receivers)} receivers + {len(casters)} casters')
    if not receivers:
        raise SystemExit('[bake] no receiver meshes matched — nothing to bake onto')
    return receivers, casters


def build_lighting():
    """Reproduce the game's light rig from the extracted values."""
    L = DATA['lighting']

    sun = None
    if L.get('sunDirection'):
        d = L['sunDirection']                       # Babylon direction
        bpy.ops.object.light_add(type='SUN', location=(0, 0, 50))
        sun = bpy.context.active_object
        sun.data.energy = max(1.0, (L.get('sunIntensity') or 1.0) * 3.0)
        c = L.get('sunColor') or [1, 1, 1]
        sun.data.color = (c[0], c[1], c[2])
        # A real sun subtends about half a degree. Widening it to 1.5 gives the
        # soft shadow edge that sells baked shadows as baked rather than as a
        # low-resolution shadow map with the aliasing filtered off.
        sun.data.angle = math.radians(1.5)
        # Point the sun ALONG the game's direction vector (Babylon -> Blender axes).
        bx, by, bz = d[0], d[2], d[1]
        sun.rotation_euler = (
            math.atan2(math.sqrt(bx * bx + by * by), -bz),
            0.0,
            math.atan2(by, bx) + math.pi / 2,
        )

    # Sky. The game's ambient is TWO terms — the hemisphere light and the
    # image-based environment — and both illuminate the snow, so both are summed.
    # Using hemiIntensity alone understated the sky by ~3.5x once the PBR
    # conversion moved most of the ambient into the IBL.
    world = bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    ambient = ((L.get('hemiIntensity') or 0.0)
               + (L.get('environmentIntensity') or 0.0))
    sky_strength = max(0.3, ambient * 2.2)
    if bg:
        bg.inputs['Color'].default_value = (0.55, 0.70, 0.95, 1.0)   # cool sky
        bg.inputs['Strength'].default_value = sky_strength
    log(f'lighting rebuilt: sky strength {sky_strength:.3f} from ambient '
        f'{ambient:.3f}, sun {"yes" if sun else "none"}')
    return sun, bg, sky_strength


def unwrap_for_lightmap(receivers):
    """
    Give the RECEIVERS a shared, area-proportional atlas.

    Smart UV Project in multi-object edit mode unwraps every selected object into
    one shared UV space at a consistent world scale, so a 40-metre landing hill
    gets proportionally more texels than a 2-metre lip. Blender's older
    lightmap_pack gives every FACE a similar-sized island regardless of how big it
    is in the world, which on this scene spent as many texels on a kicker corner
    as on the entire outrun.

    Channel 0 is left as a plain copy so the game's tiled detail textures still
    have somewhere to live; channel 1 is the atlas.
    """
    for o in receivers:
        while len(o.data.uv_layers) > 0:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')       # channel 0
        lm = o.data.uv_layers.new(name='Lightmap')   # channel 1
        o.data.uv_layers.active = lm
        # Cycles bakes into the ACTIVE RENDER layer, which is not the same
        # property as the active one. Leaving it on 'UVMap' bakes the whole scene
        # into whatever that untouched layer happens to contain.
        lm.active_render = True

    # ── Entry-138: deterministic planar atlas instead of smart_project ──────
    # The corridor is now per-triangle UNshared (entry-137/138: per-vertex uv2
    # must be representable). smart_project on that topology degenerates every
    # one-triangle island — measured per-face UV area ~9e-15, pack_islands then
    # has nothing to pack and the fill guard aborts the bake. All receivers are
    # terrain-draped heightfields anyway, so a top-down world-xz projection IS
    # the correct lightmap: no seams, area-proportional texels, one UV per
    # vertex by construction. Each receiver gets its own u-range slice of the
    # atlas so footprint overlaps in xz cannot blend one mesh's lighting into
    # another's texels.
    xs = [v.co.x for o in receivers for v in o.data.vertices]
    zs = [v.co.z for o in receivers for v in o.data.vertices]
    minx, maxx = min(xs), max(xs)
    minz, maxz = min(zs), max(zs)
    spanx = max(maxx - minx, 1e-6)
    spanz = max(maxz - minz, 1e-6)
    slice_u = 1.0 / max(len(receivers), 1)
    for si, o in enumerate(receivers):
        lm = o.data.uv_layers['Lightmap']
        u0 = si * slice_u
        loops = o.data.loops
        for li in range(len(loops)):
            vert = o.data.vertices[loops[li].vertex_index]
            lm.data[li].uv = (
                u0 + slice_u * 0.98 * (vert.co.x - minx) / spanx
                     + slice_u * 0.01,
                0.98 * (vert.co.z - minz) / spanz + 0.01,
            )

    fill = atlas_fill(receivers)
    log(f'atlas unwrapped and packed: {fill * 100:.1f}% of UV space used')
    # A bad pack is invisible until the game renders black, and then it looks
    # like the BAKE failed rather than the unwrap. Fail here instead.
    if fill < 0.25:
        raise SystemExit(
            f'[bake] atlas fill is only {fill * 100:.1f}% — the islands were not '
            f'packed. Almost every texel would be wasted and the lit surfaces '
            f'would get a few pixels each.')


def atlas_fill(receivers):
    """Fraction of the 0-1 UV square actually covered by islands."""
    total = 0.0
    for o in receivers:
        me = o.data
        lay = me.uv_layers['Lightmap']
        for poly in me.polygons:
            uvs = [lay.data[i].uv for i in poly.loop_indices]
            a = 0.0                                    # shoelace over the outline
            for i in range(len(uvs)):
                x1, y1 = uvs[i]
                x2, y2 = uvs[(i + 1) % len(uvs)]
                a += x1 * y2 - x2 * y1
            total += abs(a) * 0.5
    return total


def check_uv_consistency(receivers):
    """
    A vertex must carry exactly ONE lightmap UV, or the sidecar cannot represent
    it.

    The game applies uv2 per VERTEX. Blender stores UVs per LOOP (per face
    corner), so a vertex shared by two faces on opposite sides of a UV seam has
    two different UVs and there is no correct single value to write. Emitting one
    of them anyway would stretch that triangle across the atlas and light it with
    whatever happens to be there — a subtle, hard-to-attribute artefact. So this
    fails loudly instead.

    This already caught the background peaks on its first run, which is why they
    are not in RECEIVER_PREFIXES.
    """
    uv2, bad = {}, {}
    for o in receivers:
        me = o.data
        lay = me.uv_layers['Lightmap']
        table = [None] * len(me.vertices)
        conflicts = 0
        for loop in me.loops:
            u, v = lay.data[loop.index].uv
            vi = loop.vertex_index
            if table[vi] is None:
                table[vi] = (u, v)
            elif abs(table[vi][0] - u) > 1e-4 or abs(table[vi][1] - v) > 1e-4:
                conflicts += 1
        flat = []
        for t in table:
            u, v = t if t is not None else (0.0, 0.0)
            flat.append(round(float(u), 5))
            flat.append(round(float(v), 5))
        uv2[o.name] = flat
        if conflicts:
            bad[o.name] = conflicts
    if bad:
        worst = sorted(bad.items(), key=lambda kv: -kv[1])[:5]
        raise SystemExit(
            f'[bake] {len(bad)} meshes have per-vertex UV conflicts (worst: {worst}). '
            f'The sidecar cannot represent these; the terrain generator must emit '
            f'unshared vertices for lightmapped surfaces.')
    log(f'uv2 extracted for {len(uv2)} meshes, no per-vertex conflicts')
    return uv2


def setup_bake_targets(receivers, img):
    """
    Point every RECEIVER material at `img` as the bake destination.

    Called before each pass, and it REPLACES the previous target rather than
    adding a second image node: two selected image nodes in one material is
    undefined behaviour, and the pass that ran second would land in whichever
    Blender happened to consider active.
    """
    for o in receivers:
        for slot in o.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            tree = mat.node_tree
            for n in [n for n in tree.nodes if n.bl_idname == 'ShaderNodeTexImage']:
                tree.nodes.remove(n)
            node = tree.nodes.new('ShaderNodeTexImage')
            node.image = img
            node.select = True
            tree.nodes.active = node


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
    log(f'cycles device: {used}')

    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = 8
    return used


def encode(img, out_png, normalise):
    """
    Write a baked float image to disk. See bakeutil.save_bake for the details.

    Both baked terrain maps are 0-1 FRACTIONS — the fraction of the sky a point
    can see, and the fraction of the sun that reaches it — so neither is
    normalised. Normalising a fraction stretches whatever the darkest value
    happens to be up to full brightness, which would erase exactly the contrast
    the map exists to carry.

    They are also DATA rather than colour, so they are written linear and the game
    sets gammaSpace = false to match.
    """
    return bakeutil.save_bake(img, out_png, srgb=False, normalise=normalise, log=log)


def select_receivers(receivers):
    bpy.ops.object.select_all(action='DESELECT')
    for o in receivers:
        o.select_set(True)
    bpy.context.view_layer.objects.active = receivers[0]


def bake_sky_visibility(receivers, sun, bg, sky_strength, out_dir):
    """
    How much of the sky each point can actually see: Cycles' AO bake.

    An earlier version computed this from light transport instead — sun hidden,
    DIFFUSE bake, direct+indirect, colour off — and came back 99.7% black while
    the SHADOW pass over the identical UVs filled the atlas. Baking AO removes the
    whole question: it traces rays into the hemisphere and returns the unoccluded
    fraction directly, with no lights, no world, no albedo and no pass
    classification to get wrong. It is already 0-1, so it must NOT be normalised.

    This is exactly the multiplier ambientTexture wants: the game applies its
    image-based ambient at full strength everywhere, as though the whole sky dome
    were visible from every point, and this is the fraction that actually is.
    """
    if sun:
        sun.hide_render = True

    img = bpy.data.images.new('skyvis', width=RES, height=RES, float_buffer=True)
    setup_bake_targets(receivers, img)
    select_receivers(receivers)

    log(f'baking sky visibility (AO) {RES}x{RES} at {SAMPLES} samples...')
    bpy.ops.object.bake(type='AO')
    return encode(img, os.path.join(out_dir, 'terrain_skyvis.png'), normalise=False)


def bake_sun_shadow(receivers, sun, bg, out_dir):
    """
    What fraction of the sun reaches each point.

    Cycles' SHADOW bake returns exactly this: 1 in full sun, 0 in full shade, soft
    across the penumbra. Because it is a fraction rather than an amount of light,
    Babylon can apply it with useLightmapAsShadowmap — it MULTIPLIES the direct
    lighting instead of adding to it, so the sun is still rendered in real time
    and there is no double count.

    The sky is switched off for this pass. Leaving it on would light the shadowed
    side and drag the mask towards 1 everywhere, quietly erasing the shadows.
    """
    if sun:
        sun.hide_render = False
    if bg:
        bg.inputs['Strength'].default_value = 0.0

    img = bpy.data.images.new('sunshadow', width=RES, height=RES, float_buffer=True)
    setup_bake_targets(receivers, img)
    select_receivers(receivers)

    bake = bpy.context.scene.render.bake
    bake.use_pass_direct = True
    bake.use_pass_indirect = False
    bake.use_pass_color = False

    log(f'baking sun shadow {RES}x{RES} at {SAMPLES} samples...')
    bpy.ops.object.bake(type='SHADOW')
    return encode(img, os.path.join(out_dir, 'terrain_shadow.png'), normalise=False)



def add_tree_occluders(path):
    """
    Add the game's thin-instance impostor trees as alpha-cutout occluders.

    Entry 125/137 scene note: the live CSM shadows for the forest come from one
    solid 6-sided cone per tree (treeShadowProxy), so every tree shadows as a
    featureless wedge — at the 32-degree sun the flanks read rows of dark
    "dirt smudges" with no crown structure. The bake can do better: the real
    crossed-card silhouette per tree, path-traced, with the card's alpha letting
    light through the crown gaps the way real branches do.

    Input is blender/trees.json — the per-variant thin-instance matrices dumped
    from the RUNNING game (tests use the same names: treeCards0..5), positions
    in game world space with per-tree scale and yaw.

    Game space is Y-up; the terrain meshes above convert (x, y, z) -> (x, z, y).
    A card is a vertical quad of CARD_W x CARD_H scaled by the instance scale,
    its base at the instance's terrain height; each tree is two crossed quads
    (the game's card pair). Yaw barely matters to a cross, so it is applied only
    to keep the bake honest about orientation.

    The quads are OCCLUDERS ONLY — they are not receivers, so they get no
    atlas UVs and no material changes beyond the cutout shader.
    """
    if not os.path.exists(path):
        log(f'trees: {path} not found — baking WITHOUT tree shadows')
        return 0
    trees = json.load(open(path))
    if not trees:
        return 0

    CARD_W, CARD_H = 7.3, 14.6   # must match game.js's forest card frame
    VARIANT_TEX = [
        'tree_spruce_card_0.png', 'tree_spruce_card_1.png',
        'tree_spruce_card_2.png', 'tree_spruce_card_3.png',
        'tree_birch_card_4.png', 'tree_birch_card_5.png',
    ]

    def cutout_material(tex_name):
        mat = bpy.data.materials.new(f'tree_{tex_name}')
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (0.04, 0.05, 0.04, 1.0)
        transparent = nt.nodes.new('ShaderNodeBsdfTransparent')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(
            os.path.join(ROOT, 'assets', tex_name), check_existing=True)
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(tex.outputs['Alpha'], mix.inputs['Fac'])
        nt.links.new(transparent.outputs['BSDF'], mix.inputs[1])
        nt.links.new(bsdf.outputs['BSDF'], mix.inputs[2])
        out = nt.nodes.get('Material Output')
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
        return mat

    by_variant = {}
    for t in trees:
        by_variant.setdefault(int(t['v']), []).append(t)

    n_quads = 0
    for vi, group in sorted(by_variant.items()):
        verts, faces, uvs = [], [], []
        for t in group:
            # game (x, y, z) -> blender (x, z, y); base at the tree's ground y
            cx, cz, cy = t['x'], t['z'], t['y']
            s = float(t['s'])
            yaw = float(t.get('yaw') or 0.0)
            hw, hh = CARD_W * s * 0.5, CARD_H * s
            for quad in (0, 1):
                ang = yaw + quad * math.pi / 2
                dx, dy = math.cos(ang) * hw, math.sin(ang) * hw
                b = len(verts)
                verts += [(cx - dx, cy - dy, cz), (cx + dx, cy + dy, cz),
                          (cx + dx, cy + dy, cz + hh), (cx - dx, cy - dy, cz + hh)]
                faces += [(b, b + 1, b + 2, b + 3)]
                uvs += [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
                n_quads += 1
        mesh = bpy.data.meshes.new(f'treeCards{vi}')
        mesh.from_pydata(verts, [], faces)
        mesh.validate()
        mesh.update()
        layer = mesh.uv_layers.new(name='UVMap')
        for i, uv in enumerate(uvs):
            layer.data[i].uv = uv
        obj = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(cutout_material(VARIANT_TEX[vi] if vi < len(VARIANT_TEX) else VARIANT_TEX[0]))
        log(f'trees: variant {vi} — {len(group)} trees, '
            f'{len(group) * 2} crossed quads')
    log(f'trees: {len(trees)} trees as {n_quads} cutout quads from {path}')
    return len(trees)


def main():
    clear()
    receivers, casters = build_geometry()
    add_tree_occluders(TREES)
    sun, bg, sky_strength = build_lighting()
    unwrap_for_lightmap(receivers)
    uv2 = check_uv_consistency(receivers)
    device = configure_cycles()

    out_dir = os.path.join(ROOT, 'assets')
    os.makedirs(out_dir, exist_ok=True)

    sky_stats = bake_sky_visibility(receivers, sun, bg, sky_strength, out_dir)
    shadow_stats = bake_sun_shadow(receivers, sun, bg, out_dir)

    with open(os.path.join(out_dir, 'terrain_uv2.json'), 'w') as f:
        json.dump({
            'coordinatesIndex': 1,
            'skyVisibility': 'assets/terrain_skyvis.png',
            'sunShadow': 'assets/terrain_shadow.png',
            'stats': {'skyvis': sky_stats, 'shadow': shadow_stats},
            'meshes': uv2,
        }, f, separators=(',', ':'))

    # Debug artefact only — the game does not load this. It exists so the bake can
    # be opened and eyeballed when something looks wrong in-game.
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, 'terrain_baked.glb'), export_format='GLB',
        export_yup=True, export_apply=True, export_animations=False,
    )

    log(f'BAKE_DONE device={device} receivers={len(receivers)} '
        f'casters={len(casters)} res={RES} samples={SAMPLES} '
        f'skyvis_mean={sky_stats["mean"]} shadow_mean={shadow_stats["mean"]} '
        f'shadow_dark={shadow_stats["belowHalf"]}')


main()

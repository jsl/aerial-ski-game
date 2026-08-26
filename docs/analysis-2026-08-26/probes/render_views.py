import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index('--')+1:]
src, outdir, tag = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.glb'):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    with bpy.data.libraries.load(src) as (df, dt):
        dt.objects = [n for n in df.objects]
    for o in dt.objects:
        if o is not None and o.type == 'MESH': bpy.context.scene.collection.objects.link(o)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and 'ski' not in o.name.lower() and 'cube' not in o.name.lower()]
# neutral grey material, no textures
mat = bpy.data.materials.new('grey'); mat.diffuse_color = (0.7,0.7,0.7,1)
for o in meshes:
    o.data.materials.clear(); o.data.materials.append(mat)
    # show rest pose only: disable armature deformation (bind pose = rest here)
    for m in o.modifiers:
        if m.type == 'ARMATURE': m.show_render = False; m.show_viewport = False
bpy.context.view_layer.update()
lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
ctr = (lo+hi)/2; size = max(hi-lo)
print(f'[render] {tag} bbox lo={tuple(round(v,3) for v in lo)} hi={tuple(round(v,3) for v in hi)}')
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.display.shading.curvature_ridge_factor = 1.5
scene.display.shading.curvature_valley_factor = 1.5
scene.display.shading.show_shadows = True
scene.render.resolution_x = 700; scene.render.resolution_y = 1000
scene.render.film_transparent = False
cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = size*1.1
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
views = {'front': (1,0,0), 'back': (-1,0,0), 'left': (0,1,0), 'back34': (-1,0.8,0.25), 'backhi': (-1,0,0.6)}
for name, d in views.items():
    d = Vector(d).normalized()
    cam.location = ctr + d*size*3
    cam.rotation_euler = (-d).to_track_quat('-Z','Y').to_euler()
    # torso-only crop for shoulder detail
    scene.render.filepath = os.path.join(outdir, f'{tag}_{name}.png')
    bpy.ops.render.render(write_still=True)
# shoulder close-up from the back
cam_data.ortho_scale = size*0.45
d = Vector((-1,0,0.15)).normalized()
cam.location = ctr + Vector((0,0,size*0.28)) + d*size*3
cam.rotation_euler = (-d).to_track_quat('-Z','Y').to_euler()
scene.render.filepath = os.path.join(outdir, f'{tag}_shoulders.png'); bpy.ops.render.render(write_still=True)
print('[render] done', tag)

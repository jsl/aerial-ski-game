# Render analysis — athlete rig and scene, 2026-08-26

Follow-up to `docs/HANDOFF-athlete.md` on branch `worktree-blender-assets` (`69d1655`).
Evidence images are in `docs/analysis-2026-08-26/img/`, the probe scripts that produced
every number below are in `docs/analysis-2026-08-26/probes/` (run them from the repo root
with `node <probe>.js`; replace `OUT_DIR` with a writable directory).

Environment used: Blender 5.2.1 LTS at `~/opt/blender-5.2.1-linux-x64/blender` (OptiX on
the RTX 5070 Ti; full build with `--res 2048 --samples 96` takes 18 s here, not 90 s),
Playwright chromium via `npm install`, Babylon 9.10.1 from `lib/`.

---

## 1. Verdict on the shoulder hump

**None of the three hypotheses in the handoff is the cause.** The body mesh is skinned in a
frame that is yawed 90° from its own skeleton drivers, and the bind pose never equalled the
driver transform. Every bone is displaced at runtime, in the *rest* pose, by up to 0.30 m.

| Hypothesis | Status | Evidence |
|---|---|---|
| 1. Residual bind-to-rest arm rotation | Refuted as stated, right in spirit | `character.meshes.upperArmL.rotation` at rest is exactly (−π, 0, 0) at (−0.205, 0, 0.008) — identical to `ARM_BIND`. The drop angle matches; the *frame* and the *roll* do not. |
| 2. The girth field | Not the cause | The rest mesh exported by the pipeline (armature disabled, rendered in Blender) has no shoulder-blade humps. |
| 3. Base-mesh scapula | Not the cause | Neither the CC0 base mesh nor the exported rest mesh shows a hump. The hump exists only in the browser. |

### What the browser is actually doing

`game.js` re-parents the two `athleteBody` primitives directly under `skierRoot` (local
rotation identity) and disposes the glTF `__root__`. The vertex data is therefore used in
raw glTF coordinates: Blender (x, y, z) → Babylon (x, z, −y). `build_body.py` authors the
figure with the chest on Blender +X and the shoulders along Blender Y, so in the frame the
skeleton is evaluated in, **the mesh's lateral axis is Z and it faces +X**, while every
driver box in `character.meshes` has lateral on X and the pose tables' "forward" on −Z.
The "empirical" mapping in `bl()` (Babylon = Blender (y, z, x)) is wrong by a 90° yaw and a
handedness flip — the flip is why the build had to map "game L to metarig .R".

Measured from the raw vertex buffer (skierRoot frame):

- Left foot spans x −0.067 → +0.139 (0.21 m long) and z 0.132 → 0.243 (0.11 m wide): the feet
  run along **x**. The skis (`skiL` at x = −0.075, depth 1.20 along z) run along **z**.
- Shoulder band (y 0.05–0.28) reaches |z| = 0.246 and only |x| = 0.167 in the rest mesh.

`linkTransformNode` copies each driver's skierRoot-frame matrix into a bone whose bind
matrix is in the mesh frame. Babylon skins with `inverseBind × current`, so each segment is
*translated* to its driver's position but keeps its authored 90°-off orientation, twisted
further by whatever roll Rigify's metarig left on the bone (the build deliberately
"preserves the rest roll" and never zeroes it after `armature_apply`). Per bone, at rest:

| Bone | Residual yaw | Residual translation (m) |
|---|---|---|
| head | 2.1° | 0 |
| torso | 3.9° | 0 |
| upperLegL / R | ∓4.4° | 0.10 |
| lowerLegL / R | 5.7° | 0.11 |
| upperArmL / R | −38.5° / −10.5° | 0.18 / 0.26 |
| lowerArmL / R | 23.5° / 7.2° | 0.34 / 0.31 |

Mean displacement of each bone's dominant vertices, rest → skinned: forearms 0.29–0.30 m,
upper arms 0.21–0.24 m, legs 0.09–0.10 m, torso 0.004, head 0.002. After skinning the
shoulder band is 0.54 m across in x and 0.19 m in z — the torso stands **sideways** on its
skis (visible in `shots/scene.png`: the bib faces the side camera while the skis run down the
hill), and the arm bones at x = ±0.205 drag the blended deltoid/trapezius vertices from a
fore-aft shoulder line to lateral positions. That smear is the hump on each side, and the
trapezius being pulled down and out is the long neck. Binding the arms hanging shrank the
smear (less rotation to blend) without touching the cause — exactly what the handoff saw.

In a full tuck the error is worse, not better: forearm centroids miss their drivers by
0.39–0.41 m, shins by 0.16–0.17 m (`probes/probe_tuck2.js`, mode `asis`).

### Fix, validated in the browser

`probes/probe_yawfix2.js` applies, after the body loads:

1. bake `Matrix.RotationY(+π/2)` into positions, normals and tangents (mesh +x → −z, mesh
   lateral z → x);
2. link each `…L` bone to the `…R` driver and vice versa (undoes the build's side swap; the
   body is bilaterally symmetric so this is safe);
3. `bone.setBindMatrix(node._localMatrix)` for every bone, so bind ≡ driver at rest.

Result: skinned vertex == rest vertex for every vertex at rest (0.000 m), the figure faces
−z (its back to a +z camera), and the tuck folds in the sagittal plane — knees forward, arms
forward, nothing sideways (`img/yawfix_*.jpg`). The humps and the long neck are gone
(`img/fix_before.jpg` vs `img/fix_after.jpg`, same camera).

**Preferred implementation is build-side**, so the exported asset is correct on its own:

- `bl()`: Babylon (x, y, z) = Blender (x, z, −y). Lateral on Blender X, chest facing Blender
  +Y (game forward is −z), up Z. Rotate the base mesh accordingly in `load_base` and drop the
  "game L ↔ metarig R" swap.
- After `armature_apply`, set every edit bone's roll so its rest matrix *is* the driver's
  rotation in Babylon terms: identity for torso/head/legs, a π rotation about X for the arms.
  Then export and assert, in the browser, that `inverseBind × local` is identity for every
  bone (that check is a 20-line addition to `rig.spec.js`; the handoff's "bind must equal
  the driver" landmine should become a test, not a comment).
- Re-audit `segment_frame`, `bib_mask`, `paint_suit` and `shape_helmet`, which all assume X
  is fore-aft.

The game-side version above is a stopgap that works today; it must not stay once the asset is
fixed, or the two corrections will fight.

### What the corrected wiring exposes (all build-side, all already in the build log)

With the skinning identity, the figure renders exactly as `build_body.py` built it, and these
lines in the log are failures rather than notes:

| Symptom (visible in `img/fix_after*.jpg`) | Build-log line | Cause |
|---|---|---|
| Upper arms fused into the torso; forearms slant inward, hands meet at the crotch | `upperArmL … y_mean=-0.132 (target -0.205)` | Heat-map weights bleed between torso and arm; blended vertices travel only part of the way to the arm bone. Assert centroid-on-bone after `pose_onto_segments`; bind the arms ~10° abducted so they clear the torso. |
| Shoulders 0.49 m wide (31% of height; adult ≈ 25%) | `shoulder 0.470 (31.0% …)` | Arm bones at ±0.205 vs anatomical shoulder ≈ ±0.150, plus ×1.22 upper-arm stretch. Either narrow `upperArm.x` in `body-model.json` (physics change, needs the golden rebaseline the author already authorised) or accept the bone sitting 5 cm outboard of the joint and stop stretching the deltoid with the bone. |
| Feet stand outside the skis | `lowerLegL … y_mean=-0.199 (target -0.075)` | Shins 12 cm outboard of their bones; same weighting problem as the arms. |
| Head pitched back ≈ 25° (`img/glb_left.jpg`) | — | `crown` is taken at x = 0; the neck→crown bone is then rotated to vertical about a tilted base. Take the crown above the neck base, or measure the face normal. |
| Shins ×0.74, thighs ×0.79, torso 36% of height | `stretch per segment` | Known; the author's authorised proportion change. Bundle with the shoulder-width change so there is one rebaseline. |

---

## 2. Scene rendering

What is in the pipeline (all in `game.js`): hemispheric fill 0.18; directional sun 0.82 from
(0.35, −1, 0.45) — **60° elevation**; 2048 Poisson shadow map; EXP2 fog 0.005 in pale blue;
prefiltered `.env` IBL at 0.45; SSAO2 (16 samples, r 1.2); ACES tonemap with contrast 1.6,
bloom 0.18 @ 0.88, MSAA 4; snow as PBR (albedo 0.89/0.91/0.94, roughness 0.46, translucency,
clear coat) with a procedural normal map; baked sky-visibility and sun-visibility multipliers
that contribute 0.07/255. Geometry: the run is six boxes (10-wide slope, 16 transition
segments, 20 kicker segments 3.4 wide), the flanking snowfields are boxes, trees are a
7-sided cone on a 6-sided cylinder placed on a jittered 10×9 grid (~174 of them, 11–18 units
tall), and the horizon is eleven 10-sided cylinders with cone caps. There is no sky — the
clear colour is a flat cyan.

The lighting and post stack are not what is wrong. The image reads as a game because of:

1. **Geometry.** Box edges and exposed vertical slab faces (the dark grey wall along the
   in-run in `shots/scene.png` is the side of the slope box). Real hills have no edges. The
   handoff already concluded this and is right: the baked lighting cannot help until there is
   terrain for it to shadow.
2. **The sky and the sun.** Flat cyan with no clouds, no sun, and a sun 60° up. The footage
   is a March afternoon at ~46°N: sun ≈ 30–35°, long crisp shadows, cumulus over a deep-blue
   zenith, and snow that is *brighter than the sky*.
3. **Vegetation.** Identical conifer cones, uniformly green, no snow load, evenly spread,
   too large, and the wrong forest: the venue is mostly bare deciduous with a minority of
   dark spruce.
4. **No venue.** No fencing, markers, banners, tower, people, tracks or spray. Aerials sites
   are dense with blue B-net and orange poles; that dressing is most of what says "aerials"
   in a single frame.
5. **The horizon.** Cone mountains read as paper cut-outs. The reference is low rolling
   forested ridgelines, three or four layers deep, fading with haze.
6. **Snow surface.** One procedural normal map everywhere. Groomed in-run corduroy, a
   flat sculpted knoll and a chopped, lumpy landing are three different surfaces.

---

## 3. What the reference clip shows

`IMG_7841.MOV` — 4.27 s, 1080×1920 portrait (rotation −90), HEVC 30 fps, 128 frames, shot
from the top of the in-run at a Canadian training venue. Frames at `reference/frames/IMG_7841/video_*.jpg` (local, gitignored).

Inventory, in the order the camera reveals it:

- **Kicker**: a tall snow block with near-vertical sides, wrapped in red sponsor/federation
  panels, a coach standing on the deck beside it with a rake, a second panel behind. The lip
  is well above the coach's head. The take-off sends the athlete near-vertical.
- **Table and knoll**: flat, sculpted by hand (rake marks), then a rounded knoll into the
  landing. Two coaches stand at the knoll in red jackets.
- **Landing hill**: ≈ 35–38°, surface *chopped* — loose broken snow with tracks and lumps,
  not groomed. Snow banks on both sides, blue B-net fencing lines along both edges, orange
  marker poles, a flag on a pole at the knoll.
- **Infrastructure**: a scaffold/container judges' platform at the top; buildings, cars and
  a lodge in the valley.
- **Forest**: dense mixed woodland — mostly bare birch/maple with dark spruce/fir; snow on
  the conifers and on the ground beneath; low rolling ridgelines behind, forested to the top.
- **Sky/light**: deep blue with cumulus, low sun from camera-left, hard shadows, the snow
  the brightest thing in frame.
- **Athlete**: white suit with a royal-blue panel/stripe, dark helmet, bib. In the air, a
  straight **layout**: arms overhead by the ears, body a single line, skis together; opens
  the arms wide only for landing, which throws a burst of snow.

### Changes that would move the scene toward the footage, in payoff order

1. **Terrain as a continuous heightfield** (in-run, table, kicker as a sculpted vertical
   block, knoll, bowl-shaped landing with side banks, out-run), blended into the flanking
   snow with no exposed faces. This also makes the existing lightmap bake worth having.
2. **Sky + sun**: an HDR skybox (the `.env` already exists — use its source for the visible
   sky, or a procedural sky with a cloud layer), sun disc/glare, elevation ≈ 32°, azimuth
   matched to the footage, shadow-map frustum fitted to the run. Reduce fog density (the air
   in the clip is clear) and use height haze on the ridgelines instead; drop post contrast
   from 1.6 toward ~1.2 once the sky supplies real dynamic range.
3. **Venue dressing**: instanced B-net (posts + alpha-cut mesh strips) along both landing
   edges, orange poles, generic side panels on the kicker (do not reproduce the "CAN" /
   maple-leaf marks), a flag, a simple judges' tower, two or three static coach figures at
   the knoll.
4. **Forest**: mixed species — card/billboard deciduous trees with bare crowns as the
   majority, a minority of irregular conifers with snow-tinted tops; clustered placement,
   closer to the landing; trees in the shadow caster list (or in the bake).
5. **Three snow materials**: corduroy in-run, hand-sculpted table, chopped landing (higher
   normal amplitude, albedo variation, ski tracks as decals). Keep the existing
   `_spawnSnowBurst` and scale it up at landing.
6. **Horizon**: replace the cone peaks with layered ridgeline silhouettes (dark-green to
   blue-grey with distance).
7. **Athlete in flight**: the game's layout/pike/tuck tables should hit the reference
   silhouette — arms tight overhead by the ears in layout (`POSE_ARMS_UP` is there; make it
   the default airborne arm state), skis parallel and together, arms wide only on landing.
   The suit's blue should be a broad panel, not a thin stripe: the albedo bake averages 0.88
   because `stripe` is 9.6k of 147k painted vertices and `waist`/`number` are under 300.

---

## 4. Reproduction

```bash
# Blender build with the measurement log (18 s on this machine)
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
    --python blender/build_body.py -- --out OUT_DIR/probe.glb --res 2048 --samples 96

# Rest mesh and base mesh renders (hypothesis 3)
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
    --python docs/analysis-2026-08-26/probes/render_views.py -- OUT_DIR/probe.glb OUT_DIR glb

# Bind-vs-driver residuals, per-bone displacement, bind:=driver experiment
node docs/analysis-2026-08-26/probes/probe_skin.js
node docs/analysis-2026-08-26/probes/probe_fix.js

# Articulation under a full tuck: asis / bind=driver / unyaw
node docs/analysis-2026-08-26/probes/probe_tuck2.js

# The corrected wiring (yaw bake + mirror relink + bind:=driver), with screenshots
node docs/analysis-2026-08-26/probes/probe_yawfix2.js
```

Each probe starts its own `python3 -m http.server` on a port in 8089–8098; if a run dies,
the server survives it — check `ss -ltnp | grep 809` before rerunning.

### Additions for the handoff's landmine list

- **The skeleton is evaluated in the mesh's frame, not the drivers'.** `linkTransformNode`
  copies a skierRoot-frame matrix into a mesh-frame bone. Bind ≡ driver has to hold for the
  full matrix — position, drop angle *and roll* — in the frame Babylon actually uses.
  Measure it: `bone.getAbsoluteInverseBindMatrix() × bone.getAbsoluteMatrix()` must be
  identity at rest, per bone.
- **Vertex-group centroids, not bone placement, say where the limb went.** "Bone placement:
  worst error 0.0 mm" was true while the arms were 7 cm and the shins 12 cm off their bones.
- **glTF vertex buffers are not updatable in Babylon.** `updateVerticesData` on the loaded
  body silently does nothing; use `setVerticesData`.
- **`skeleton.bones[i]` is not bone index `i`.** Map `MatricesIndicesKind` through
  `bone.getIndex()`; the loader prepends the armature root.
- **`/tmp/IMG_7841.MOV` is mode 600, owner `ian`.** Copy it with sudo before probing.

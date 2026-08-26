# Render realism plan — branch `render-realism-glm`

Goal: bring the rendered scene and athlete in line with the reference footage described in
`docs/ANALYSIS-render-2026-08-26.md` (read it first; every number and screenshot referenced
here is in `docs/analysis-2026-08-26/`). Work is done in iterations by an agent following
`docs/RENDER-PROGRESS.md`. A human reviewer looks at the branch every ~5 iterations and
leaves notes in the **Reviewer feedback** section of the progress file — read it every
iteration and act on it before anything else.

## Ground rules (non-negotiable)

1. **Physics is frozen.** Do not edit anything under `engine/`, and do not change numeric
   values in `engine/core/body-model.js` or `blender/body-model.json`. `npm run test:unit`
   and `npm run test:golden` must pass on every commit. Visual terrain must sample the same
   functions the physics uses (`terrainRootY`, `AerialEngine.aerialSki.*`) so surface and
   physics never disagree.
2. **The shipped game has no dependencies and no build step** (ADR-0010). `index.html`
   loads local files. No npm runtime packages, no bundler. Procedural textures are generated
   at runtime or by committed scripts (Blender scripts in `blender/`, node scripts in
   `tools/` or `render/`).
3. **No trademarks.** Do not reproduce "CAN", the maple leaf, or any federation/sponsor
   marks from the footage. Use generic panels and colours.
4. **Assets regenerated with Blender must bump `ASSET_V` in `game.js`.** Blender is at
   `~/opt/blender-5.2.1-linux-x64/blender` (see `docs/HANDOFF-athlete.md` for commands).
5. **Every iteration ends in a commit**, with the trailer
   `Co-Authored-By: GLM-5.3-Flash (glm-5.3-flash) <noreply@z.ai>`. Never leave uncommitted
   work. Never push. Never rewrite history.
6. **Keep it fast.** Target 60 fps on a mid-range GPU. Use instancing/thin instances for
   repeated meshes (trees, fence posts, poles); keep draw calls and shadow casters bounded.
7. **Measure, then look.** Extend `tests/drive/*.spec.js` with numeric checks when adding a
   feature (luminance ranges, positions, counts). Screenshots come from
   `npx playwright test --config tests/drive/playwright.config.js look` →
   `shots/figure.png`, `shots/figure_front.png`, `shots/scene.png`. If you can view PNGs,
   look at them; if not, rely on measurements.
8. Read the landmine lists in `docs/HANDOFF-athlete.md` and section 4 of the analysis before
   touching the rig or the Blender build.

## Priorities (work top-down; one coherent unit per iteration)

### P0 — Athlete rig frame fix (root cause of the shoulder hump)
The body mesh is skinned in a frame yawed 90° from its drivers and bind ≠ driver. Preferred
fix is in `blender/build_body.py`: `bl()` must map Babylon (x, y, z) = Blender (x, z, −y)
(lateral on Blender X, chest facing Blender +Y, up Z); drop the "game L ↔ metarig .R" side
swap; after `armature_apply`, set every edit bone's roll so its rest matrix equals the
driver's rotation in Babylon terms (identity for torso/head/legs, π about X for arms);
re-audit `segment_frame`, `bib_mask`, `paint_suit`, `shape_helmet`, `displace_suit`, which
assume X is fore-aft. Rebuild `assets/athlete_body.glb` + maps, bump `ASSET_V`.

If the build-side fix cannot be landed and verified in one iteration, land the validated
game-side stopgap first (`docs/analysis-2026-08-26/probes/probe_yawfix2.js`: bake
`RotationY(+π/2)` into positions/normals/tangents with `setVerticesData`, relink L↔R bones,
`bone.setBindMatrix(node._localMatrix)`), clearly commented as temporary, and remove it when
the build-side fix lands.

Acceptance (add to `tests/drive/rig.spec.js`): for every bone at rest,
`bone.getAbsoluteInverseBindMatrix() × bone.getAbsoluteMatrix()` is identity (translation
< 1 mm, rotation < 0.5°); under `applyPose(…, tuck=1, …)` the centroid of each bone's
weight>0.95 vertices tracks `driver_now × driver_rest⁻¹ × restCentroid` within 1 cm; the
figure faces −z (toes ahead of ankles in −z); shoulder band |x| extent equals the rest mesh's.

### P1 — Terrain as one continuous surface
Replace the six slabs and the box flanks with a heightfield mesh (or a few stitched ribbons)
whose profile along z is exactly `terrainRootY(z) - FOOT_OFFSET` in the corridor, blending
laterally into banked sides and the flanking snowfields with no exposed vertical faces. The
kicker is a sculpted block with near-vertical sides; the landing is a bowl with side banks
and a rounded knoll. Keep `snowMat` on the corridor. Update `blender/terrain.json` /
`extract-terrain.spec.js` if the bake pipeline reads the geometry.

### P2 — Sky and sun
A visible sky (skybox from the same HDR that produced `assets/environment.env`, or a
procedural gradient + cloud layer), a sun disc/glare, sun elevation ≈ 32° with azimuth from
camera-left, shadow frustum fitted to the run, fog density reduced (clear air) with height
haze only on the far ridgelines, post contrast from 1.6 toward ~1.2 once real range exists.
Snow must read brighter than the sky.

### P3 — Venue dressing
Blue B-net fencing along both landing edges (instanced posts + alpha-cut strips), orange
marker poles, generic side panels on the kicker, a flag at the knoll, a simple judges'
tower/scaffold at the top, two or three static coach figures at the knoll. All static, all
cheap.

### P4 — Forest
Mixed woodland: mostly bare deciduous (cards/billboards with a bare-crown texture) with a
minority of irregular conifers whose tops are snow-tinted; clustered placement closer to the
landing; trees cast shadows (caster list or the bake); varied scale; fewer identical shapes.

### P5 — Snow surfaces
Three materials: corduroy in-run, hand-sculpted table/knoll, chopped landing (higher normal
amplitude, albedo variation, ski-track decals). Scale up `_spawnSnowBurst` on landing.

### P6 — Horizon
Layered forested ridgeline silhouettes fading with distance instead of cone peaks.

### P7 — Athlete in flight and suit
Make `POSE_ARMS_UP`-style tight overhead arms the default airborne arm state in the
renderer's pose blending **without changing physics tables** (renderer-side only, ADR-0002);
skis parallel and together in flight; arms open on landing. In the Blender paint, make the
blue a broad panel (not a pinstripe) and enlarge the bib/waist so the suit reads at
distance.

### P8 — Build-side defects exposed by P0
Arms fused to torso / hands meeting at the crotch (arm-dominant centroid 7 cm inboard of the
bone; bind arms ~10° abducted, tighten weights), shins 12 cm outboard of the skis, head
pitched back ≈ 25° (`crown` taken at x = 0). Make the build log's centroid-vs-target lines
hard failures.

## Definition of done for the branch
All P0–P6 landed with tests; P7–P8 as far as they go; `./tests/run-all.sh` green;
`docs/RENDER-PROGRESS.md` current; a fresh set of shots described in the progress file.

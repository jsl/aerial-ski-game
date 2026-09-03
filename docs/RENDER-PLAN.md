# Render realism plan — branch `render-realism-glm`

Goal: bring the rendered scene and athlete in line with the reference footage described in
`docs/ANALYSIS-render-2026-08-26.md` (read it first; every number and screenshot referenced
here is in `docs/analysis-2026-08-26/`). Work is done in iterations by an agent following
`docs/RENDER-PROGRESS.md`. A human reviewer looks at the branch every ~5 iterations and
leaves notes in the **Reviewer feedback** section of the progress file — read it every
iteration and act on it before anything else.

## Ground rules (non-negotiable)

1. **Physics changes need written approval.** Anything under `engine/`, and the numeric
   values in `engine/core/body-model.js` / `blender/body-model.json`, may only change when
   the reviewer has written an `APPROVED:` line for that specific change in the **Reviewer
   feedback** section of `docs/RENDER-PROGRESS.md` (the reviewer holds the author's
   delegated authority for physics and golden-trace rebaselines). To request one: measure
   the problem, write the proposed change and its expected gameplay effect under **Open
   questions**, and continue with other work. An approved physics change ships in its own
   commit with the golden traces rebaselined per ADR-0005 (`tests/golden/`), the before/after
   trace deltas summarised in the progress entry, and `npm run test:unit` /
   `npm run test:golden` green. Visual terrain must sample the same functions the physics
   uses (`terrainRootY`, `AerialEngine.aerialSki.*`) so surface and physics never disagree.
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

**STATUS (reviewer, 2026-09-02): DONE long ago — the rig frame fix landed in August; the athlete work now runs from the SLOT specs in `docs/RENDER-PROGRESS.md` Reviewer feedback. Do not execute this heading.**
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

Footage delta (`docs/REFERENCE-FOOTAGE.md`, IMG_3765/3768): rebuild the kicker as a
sculpted white block — vertical side walls ≈2.5–3 m, take-off face curving to a
near-vertical lip above them, thin dark edge line at the wall/face junction; add two
parallel in-run lanes (visual grooves + rough divider, physics keeps the single profile).

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

**The ground is solid (author, 2026-08-26).** The corridor ribbon, the flank fills and the
ridgelines must be closed volumes: extrude a skirt from every terrain edge down to a common
base level well below the lowest playable point, cap it with a base plane, and give the
terrain material `backFaceCulling = false` with a snow-coloured underside as a last line of
defence, so no camera angle ever shows the world's underside or a see-through edge.

### P2 — Sky and sun
Footage delta (`docs/REFERENCE-FOOTAGE.md`, IMG_7841): sunny mode confirmed — deep blue
zenith with cumulus, sun ≈30–35° from camera-left, hard cool shadows, snow the brightest
surface in frame.
A visible sky (skybox from the same HDR that produced `assets/environment.env`, or a
procedural gradient + cloud layer), a sun disc/glare, sun elevation ≈ 32° with azimuth from
camera-left, shadow frustum fitted to the run, fog density reduced (clear air) with height
haze only on the far ridgelines, post contrast from 1.6 toward ~1.2 once real range exists.
Snow must read brighter than the sky.

**Shadows (author, 2026-08-26): the skier casts none and the trees are inconsistent.** Root
cause to verify and fix: a single 2048 `ShadowGenerator` whose directional frustum is
auto-fitted to every caster (≈174 trees, the peaks, the whole run) — hundreds of metres per
map, ~20 cm per texel, so the athlete's shadow vanishes and tree shadows flicker with the
bias. Do: switch the sun to a `CascadedShadowGenerator` (3–4 cascades, `lambda` ≈ 0.8,
`shadowMaxZ` ≈ 200, `autoCalcDepthBounds` on, PCF/PCSS filtering, `stabilizeCascades`);
make sure the skinned `athleteBody*` primitives **and** the skis are in the caster list after
the async load and stay there (`useBones` for skinned casters), and that terrain, flank fills,
kicker and skis `receiveShadows`. Trees: all instances cast (thin instances need the source
mesh in the caster list; impostors cast via alpha in the depth pass) or come from the bake —
not a mix. Acceptance spec: sample terrain luminance directly under the standing athlete vs
2 m beside it (shadow present: ≥ 15% darker); under a near tree vs open snow (≥ 20% darker);
the athlete's shadow stays present through the in-run and after landing; no acne/peter-
panning at the skis (bias tuned per cascade).

### P3 — Venue dressing
Footage deltas (`docs/REFERENCE-FOOTAGE.md`, IMG_3523/3520/7841): the B-net runs
continuously along **both** edges from the table through the landing and curves around
the bowl, sagging slightly between posts; add two rows of orange/red wands with small
pennants marking the landing centreline; a plain blue flag on a pole at the knoll crest
(no roundel); a timber-deck platform on dark shipping containers beside the kicker as
the judges'/start deck; the static figures at the knoll wear **red jackets** (accent
colour against white/blue). Generic panels only — no federation marks.
Blue B-net fencing along both landing edges (instanced posts + alpha-cut strips), orange
marker poles, generic side panels on the kicker, a flag at the knoll, a simple judges'
tower/scaffold at the top, two or three static coach figures at the knoll. All static, all
cheap.

### P4 — Forest
Footage delta (`docs/REFERENCE-FOOTAGE.md`, IMG_3523/3520): forest walls close in on both
sides of the landing; snowy house roofs visible in the valley behind the trees.
Mixed woodland: mostly bare deciduous (cards/billboards with a bare-crown texture) with a
minority of irregular conifers whose tops are snow-tinted; clustered placement closer to the
landing; trees cast shadows (caster list or the bake); varied scale; fewer identical shapes.

**Make the trees genuinely realistic (author, 2026-08-26).** Cones and cylinders cannot get
there; bake them in Blender. Add `blender/bake_trees.py`: generate 2–3 species (snow-loaded
spruce/fir with drooping branch layers and a tapered trunk; bare birch/maple with fine
branching; one bushy understory) — via the Sapling add-on or a scripted L-system — and bake
each to an **impostor atlas**: 8 horizontal views × 1–2 elevations, albedo + normal + alpha,
2048 atlas per species, plus a simple 2-quad "cross-card" fallback texture. In the game,
render trees as camera-facing (or octahedral) impostors with alpha-test, per-instance
scale/tint/rotation jitter via thin instances, hundreds of trees at negligible cost; the 20–30
nearest trees can be low-poly meshes (trunk + 5–7 branch cards) exported from the same
Blender scene for parallax. Snow load on upper branch surfaces; slight blue in the shade;
bare crowns read as a grey-brown haze at distance. Trees cast shadows (impostor alpha in the
shadow map, or baked). Acceptance: a `trees` spec counts instances and draw calls (≤ 20 draw
calls for the whole forest), and shots from the side and ready cameras are inspected.

### P5 — Snow surfaces
Footage deltas (`docs/REFERENCE-FOOTAGE.md`, IMG_3523/3520/7841): the chopped landing
shows dense ski-track furrows, twin landing furrows, chunks/clods pushed to the sides
(subtle green-tinged ice in places) and a smoother raked centre band — feed these into
`blender/bake_landing.py`. Landing spray: plume off the ski tails peaking ~1–1.5 m above
the surface ~0.4–0.5 s after touchdown, trailing 1–2 s; sink to roughly sole depth at the
deepest compression (matches the pinned contact rules). Scale `_spawnSnowBurst` to this.
Three materials: corduroy in-run, hand-sculpted table/knoll, chopped landing (higher normal
amplitude, albedo variation, ski-track decals). Scale up `_spawnSnowBurst` on landing.

**The landing zone's texture and its chop come from Blender, matched to the footage (author
request, 2026-08-26).** Add `blender/bake_landing.py`: build a high-poly procedural "chopped"
surface modelled on `reference/frames/IMG_7841/` (landing and `landing_sequence_10fps.jpg`)
and `reference/frames/IMG_3396/` — loose broken chunks and clods 10–30 cm across, low ridges
left by the chop, ski-track furrows running down-slope, boot prints, softer rounded lumps at
the sides, a smooth hand-sculpted knoll at the top — with a slight blue-shadowed albedo
variation (snow albedo stays ≥ 0.85; shadows come from AO/normals, not dark paint). Bake
tiling **normal, AO and albedo** tiles (2048, seamless, same `bakeutil` conventions and
colour-management fixes as `build_body.py`), plus a **heightmap**, into `assets/` and wire
them to a dedicated `landingMat` on the landing ribbon; apply the heightmap as real vertex
displacement on the landing mesh (5–10 cm amplitude, fading to zero at the knoll and at the
edges) so the chop shows in silhouette and in the sun's shadows, not only as a texture.
Ski contact keeps using the physics profile; the displaced visual surface must stay within
the allowed sink band (see the contact rules in the progress file). Log measurements in the
build (chunk size distribution, amplitude, tile seam error) and bump `ASSET_V`.

### P6 — Horizon
Footage delta (`docs/REFERENCE-FOOTAGE.md`, IMG_3523/3520): low forested ridgelines with a
few snowy roofs at the valley edge behind the forest — not cone peaks.
Layered forested ridgeline silhouettes fading with distance instead of cone peaks.

### P7 — Athlete in flight and suit
Footage delta (`docs/REFERENCE-FOOTAGE.md`, IMG_3768/3765/7841): in-run crouch with back
near-horizontal and hands forward at knee height, arms quiet until the transition; both
arms sweep up together to overhead-by-the-ears; layout flight with skis parallel and
together; arms open wide for the landing ride-out.
Make `POSE_ARMS_UP`-style tight overhead arms the default airborne arm state in the
renderer's pose blending **without changing physics tables** (renderer-side only, ADR-0002);
skis parallel and together in flight; arms open on landing. In the Blender paint, make the
blue a broad panel (not a pinstripe) and enlarge the bib/waist so the suit reads at
distance.

**Legible bib number — "30" (author, 2026-08-26).** Paint a real competition number on the
bib, front and back: the digits **30**, dark navy on the white patch, digit height ≥ 60% of
the bib height, a clean sans-serif rendered in Blender (text object baked into the albedo, or
a font-rendered mask in `paint_suit`), correctly oriented and not mirrored on either side.
Acceptance: from `figure_front.png` at the look camera the digits are readable by eye; a
spec checks the number-patch UV region's dark-pixel fraction lies in a plausible band and
that the two digits are distinct blobs.

### P8 — Build-side defects exposed by P0
Arms fused to torso / hands meeting at the crotch (arm-dominant centroid 7 cm inboard of the
bone; bind arms ~10° abducted, tighten weights), shins 12 cm outboard of the skis, head
pitched back ≈ 25° (`crown` taken at x = 0). Make the build log's centroid-vs-target lines
hard failures.

### P9 — Night snowfall mode (author request, 2026-08-26)
Footage numbers (`docs/REFERENCE-FOOTAGE.md`, IMG_3396): 5–7 warm (~2800–3500 K)
floodlights on poles along the in-run crest and table with visible halation; near-black
sky with **no horizon detail**; kicker/table near-pure-white inside pools; fast falloff
to black between pools (pool-edge falloff rather than uniform fog); lit snow stays
white; falling snow as elongated streaks ~4–15 px, denser/brighter near the lights;
takeoff puff lifting ~0.5–1 m off the lip for ~1 s; landing cloud ~1.5–2 m lingering
~2 s, backlit so it glows.
A switchable weather/time mode modelled on `reference/frames/IMG_3396/` (night training
session, heavy snowfall): near-black sky with no horizon detail; warm floodlights on poles
along the in-run and table (point/spot lights with visible pools on the snow, a few sources,
not hundreds); the kicker block and table brightly lit and reading pure white; falling snow
as a GPU particle system in a camera-following volume (thousands of flakes, slow fall with
wind drift and slight turbulence, size 1–4 px, brighter near the lights, visible against the
dark sky and faint against snow); reduced visibility via dark fog; a puff of snow off the lip
at takeoff (`_spawnSnowBurst` variant) and a bigger, slower-dissipating landing cloud. Snow
surface reflectance stays high so lit snow does not go grey. Toggle by URL parameter and/or a
menu option; the default remains the sunny day mode; every existing spec must pass in both
modes; add a spec for the night mode (light count, particle system present and emitting,
sky luminance low, snow luminance under lights high).

### P10 — Free-look camera after the run (author request, 2026-08-26)
In the **ready state before the run starts**, once the athlete has landed and stopped, or
the crash ragdoll has settled, and during replay playback, let the player pan around the
scene: drag (mouse/touch) orbits the
`ArcRotateCamera` around the athlete, wheel/pinch zooms within sane limits, arrow keys/WASD
nudge, and `C` still cycles the preset views. The per-frame camera follow must yield to user
input in these states (resume following on the next run). Show a one-line HUD hint ("drag to
look around") the first time. The free-look must not swallow the inputs that start the run (the launch/charge keys and
buttons still work while orbiting). Acceptance: a drive spec injects a drag in the ready
state and asserts `camera.alpha`/`beta` changed; then drives a full run to a stop, drags
again, and asserts the view changed and stays changed until the next run starts.

**Never see under the terrain (author, 2026-08-26).** In free-look the camera must stay above
the snow: clamp the camera position each frame to ≥ 1.0 m above the terrain height under it
(`terrainRootY`/the visual heightfield, whichever is lower, plus the flank fills), and cap the
orbit so the eye cannot pass below the local surface — a beta limit derived from the slope
under the camera, not a fixed 0.05. Acceptance: a spec sweeps alpha/beta/radius to their
limits in the ready state and after a run and asserts the camera's height above the terrain
under it never drops below 0.5 m and that no rendered frame has the black/backface look
(sample the frame's lower third: no region reads as unlit backface).

### P11 — A coherent crash (author, 2026-08-26)
Today a crash hides the skinned body and re-shows the legacy primitive driver solids
(`game.js` ≈ 4441–4500), detaching them so boxes and spheres fly apart. Replace with a
connected ragdoll that the skinned athlete follows:
- Keep `athleteBody*` visible; never re-show the legacy solids or detail meshes.
- Position-based ragdoll on the 10 drivers, renderer-side (the crash is display; `engine/`
  untouched): each frame integrate driver positions with gravity, terrain contact (the ski
  contact rules — hard zones zero penetration, landing zone ≤ 0.10 m), friction that scales
  with slope, and angular damping; then run 4–8 iterations of distance constraints so
  adjacent segments stay joined at neck, shoulders, elbows, hips, knees (joint gap ≤ 2 cm)
  with coarse angle limits (no knee hyper-extension past 10°, elbows ≤ 150°); torso and head
  keep their relative orientation within ±30°. The result is a floppy but intact body that
  tumbles, slides down the landing, and settles within ~3–4 s.
- Bindings release: skis detach at impact and slide/cartwheel away separately, coming to rest
  on the snow (never below it). Helmet stays on.
- Snow: a burst at impact and a trailing spray while sliding, scaled to speed; a shallow
  furrow decal where the body slid is a bonus.
- Camera follows the tumble then eases to the resting body; free-look (P10) is enabled once
  settled.
Acceptance in a drive spec: force a crash; every frame assert all joint gaps ≤ 2 cm, every
driver's lowest point respects the contact rules for its zone, no legacy solid is visible, the
body settles (speed < 0.1 m/s) within 5 s, and the skis end up on the surface.

### P12 — Overall render-quality pass (author, 2026-08-27)
The author wants a visibly higher-quality image overall. Do this as one focused pass with
before/after shots and frame-time numbers (measure GPU frame time via `engine.getFps()` /
`scene.getEngine().getDeltaTime()` over 300 frames in a drive spec; keep ≥ 60 fps on a mid GPU).
- **Resolution:** render at device pixel ratio — `engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2))`
  — with an adaptive fallback (raise the scaling level if frame time > 14 ms for 2 s). MSAA
  8 where `engine.getCaps().maxMSAASamples` allows, else 4.
- **Texturing:** every procedural/tiled texture (snow, bark, foliage, net, fabric) with
  mipmaps and trilinear filtering, `anisotropicFilteringLevel = 16`; raise the snow detail
  tiles from 256 to 1024; no visible tiling repeat within 20 m of the camera (add a
  second, larger-scale variation layer to the snow albedo/normal).
- **Shadows:** cascaded maps with PCSS/contact-hardening (or PCF high quality), cascade
  blending on, per-cascade bias tuned so there is neither acne nor peter-panning at the
  skis; shadow map 2048 per cascade.
- **Ambient occlusion:** SSAO2 at 32 samples with the bilateral blur, radius/strength tuned
  so contact darkening reads under the skis, boots and fence posts without a dirty halo.
- **Post:** keep ACES; contrast down from 1.6 toward ~1.2 once P2's sky exists; bloom
  weight ≤ 0.1 and threshold high so only the sun/specular blooms; mild sharpen
  (`SharpenPostProcess`, edge 0.3–0.5) to counter MSAA/blur softness; dithering on. No
  vignette or colour LUT unless it can be justified against the footage.
- **Materials:** snow roughness/sheen re-tuned under the new sky; the athlete's
  `bodyMat`/`helmetMat`/`faceMat` with correct roughness, the helmet clear-coat, the
  goggles glossy; skis with a glossy topsheet and matte base.
- **Geometry:** the corridor ribbon sampled finely enough that no faceting shows at
  gameplay distance (silhouette edges smooth in the knoll/roll-out shots); trees per P4.
Acceptance: a `quality.spec.js` asserts hardware scaling, MSAA samples, anisotropy and
mipmaps on all tiled textures, shadow filter mode and SSAO settings, and logs the measured
frame time; a before/after `look` set is inspected and described in the progress entry.

### P13 — Kinematic chain solver for the skinned athlete + boot–ski invariant (author, 2026-08-28)
`reference/shots/author_crouched_2026-08-28.jpg` (local) shows the in-run tuck: the skinned
torso/arms tear into shards, the neck stretches, the boots stand ahead of empty bindings. Root
cause: every segment is driven as an independent physics box (position and rotation straight
from the pose tables, which were written for disjoint boxes), so adjacent bones no longer meet
at joints and linear-blend skinning stretches the mesh between them.
Renderer-side fix (ADR-0002, physics untouched): each frame, derive a **connected skeleton**
from the drivers before skinning — compute each joint as the reconciled point between the two
adjacent segment ends (neck = torso top/head bottom, shoulders, elbows, hips, knees, ankles),
orient each bone from joint to joint (keeping the driver's roll), and place the head bone from
the neck joint with a fixed neck length. Segment lengths are the model's; only joint gaps are
closed. Result: no tearing, a neck of constant length, hands where the pose says.
**Boot–ski invariant (game invariant, author):** the ski is bound to the boot at toe AND heel in
every state — ready, hop turn, in-run crouch, takeoff, flight, landing, ride-out — except a
crash eject. Implement by posing the visual ski (and any ski-driven visuals) from the boot each
frame (`skiTransform = bootTransform × bindingOffset`) rather than from the physics ski box;
the physics ski segment continues to exist for the simulation. A single invariant spec samples
every frame of a full run and the hop turn and asserts toe and heel sole-to-ski ≤ 5 mm and ski
pitch/yaw = boot pitch/yaw ± 2°; it is allowed to be violated only after the crash eject.
Acceptance for the solver: in the in-run tuck, flight tuck and pike, no triangle in the skinned
body exceeds 3× its rest edge length (tear detector on the skinned buffer), neck length within
±1 cm of rest, hands within 3 cm of the pose-table hand positions.

## Iterations 51–80 — serial schedule (author-approved 2026-08-27 21:55)
One session at a time (no parallel lanes). Reviews at every multiple of 5. Take the groups in
order; a group may span more than one iteration; do not skip ahead.
1. **P12 render quality** + the deferred 32° sun elevation and horizon haze (51–53).
2. **P4 trees** — `blender/bake_trees.py` impostor atlases (snow-loaded spruce, bare birch/maple,
   understory), thin instances with jitter, nearest trees as card meshes, snow load, shadows (54–57).
3. **P5 snow surfaces** — `blender/bake_landing.py` chopped landing with displacement, corduroy
   in-run, track decals, spray tune (58–60).
4. **P6 horizon** — layered forested ridgelines, snowy roofs in the valley, no cone peaks (61–62).
5. **P10 free-look** in ready / after-run / replay with the above-terrain camera clamp (63–64).
6. **P3 remainder** — landing wands, knoll flag, judges' deck on containers, coaches in red,
   generic kicker panels (65–66).
7. **Proportions rebaseline part 2** (torso/legs, APPROVED; ±5% flight-rate guard) + athlete
   rebuild; **P7 flight pose** (arms overhead in layout, skis together, arms open on landing);
   lane A leftovers: helmet brim wrap, suit-relief ironing on if not yet, arm-gate instrument (67–68).
8. **Pose-vs-physics** (former lane D, merged): skeleton-free flip counts (silhouette axis + VLM
   annotation), golden-trace comparison, numbered physics proposals → reviewer approval → tuning
   with rebaseline (69–71).
9. **P9 night snowfall mode** (72–74).
10. **Performance/polish** — draw calls, LOD, load time, weaker-GPU fallback, cache-busting hygiene; the parked P2 height haze (entry-54 mechanism, reviewer 2026-08-28 02:50) (75–76).
11. **Human-testing buffer** — fix whatever the author reports (77–78).
12. **Final review, HANDOFF/ADR update for the render pipeline, branch summary** (79–80).

## Iterations 81–105 — author-approved extension (2026-08-28 20:00)
Same serial rules and review cadence (every multiple of 5). Continue the 51–80 schedule from
wherever it stands at iteration 80 — expected remaining order: lighter B-net → P6 ridgelines →
P4 tree slices (deciduous majority, understory, near-camera cards) → P5 snow surfaces (chop bake,
corduroy, tracks) → P10 free-look + camera clamp → P3 dressing remainder → proportions part 2 /
P7 flight pose → pose-vs-physics tuning (proposals → reviewer approval) → P9 night mode →
performance/polish (incl. the parked height haze) → author-testing buffer → final review,
HANDOFF/ADR update, branch summary (105). Author defects reported along the way pre-empt this list.

## Definition of done for the branch
All P0–P6, P9, P10, P11 and P12 landed with tests; P7–P8 as far as they go; `./tests/run-all.sh` green;
`docs/RENDER-PROGRESS.md` current; a fresh set of shots described in the progress file.

# Render realism — progress log

Branch `render-realism-glm`. Plan: `docs/RENDER-PLAN.md`. Each iteration appends an entry.
Keep entries short and factual: what changed, how it was verified (numbers), what is open.

## Reviewer feedback (read first; the reviewer edits this section)

- **ORDER OF WORK for the next iterations (reviewer, 2026-08-26 — the author is watching the live tree):**
  1. Footage analysis (`docs/REFERENCE-FOOTAGE.md`) — one iteration.
  2. Athlete build fixes in ONE Blender rebuild: hands at the sides / no crossing (arm centroid on bone), legs on the skis with boots seated (leg centroid on bone), a real face under a cranium-only helmet, **and** the leg notches (blend the girth factor across the knee and ankle by skin weight; smooth the boot ramp; make the leg-profile check flag steps). Rebuild, bump `ASSET_V`, verify in the browser, commit.
  3. Grey ramp — quick win before the full P1 terrain: measure corridor vs flank luminance in `shots/scene.png`, then fix the causes (stale `terrain_skyvis`/`terrain_shadow` multipliers → disable until re-baked; `_baked` clones missing detail maps; `lsMat` vs `snowMat` mismatch; exposed dark side faces; SSAO in the concave transition). Target: corridor ≥ flank brightness in sun. Report numbers.
  4. Ready stance across the in-run: both skis on the snow, uphill knee bent (renderer-side pose; see the item below).
  5. Then P1 continuous terrain (kinks, radiused roll-out), P2 sky/sun, and the rest of the plan in order.
- If `git status` shows `assets/athlete_albedo.png` / `assets/athlete_normal.png` modified before you have touched them, that is a reviewer scratch bake — discard those two files (`git restore`) rather than committing them.
- Shots directory `shots/` is gitignored; describe what you see/measure in this file instead.
- **Physics approvals (reviewer, on the author's delegated authority, 2026-08-26).** Rule 1 of the plan changed: `engine/` may be edited only under an explicit `APPROVED:` line here. Two pre-approvals, each conditional on your measurements showing the problem is in the physics and not the renderer:
  - `APPROVED: hard snow surface.` If the ski-clearance spec shows the physics lets a ski go below the surface, change the contact model so the ski's lowest point never goes below the terrain (minimal change; keep landing feel by handling absorption in the knees/pose, not in surface penetration). Own commit + golden rebaseline + before/after summary.
  - `APPROVED: C1-smooth run profile.` If the slope check finds a discontinuity in the physics profile at the in-run/transition/table/kicker/landing joins, smooth it while preserving the lip angle, lip height, table length and landing angle; report the change in flight distance and airtime from the golden traces.
  - NOT yet approved: body proportions / shoulder width (`body-model.json`). Land P0 first, then propose with the corrected figure's measurements.
- **Ski/snow contact (author + reviewer, 2026-08-26; supersedes the wording below where they differ).** Two surface classes. *Hard*: in-run, transition, table, kicker and the sculpted knoll — zero penetration ever, including during rotation, landing on the knoll, and crashes. *Chopped landing zone*: loose broken snow, so on touchdown the skis may sink up to **≈ 0.05–0.10 m** (boot soles at or just under the surface; boot cuffs and ski tips always visible) while in contact and decelerating, never more, never while airborne, and the sink should recover as the skis ride out. See `reference/frames/IMG_7841/landing_sequence_10fps.jpg` (0.1 s steps): touchdown on the surface, ~0.2 s of ploughing to roughly sole depth, a spray cloud ≈ 1 m tall trailing 1–2 s. Spec accordingly: clearance ≥ 0 on hard zones; sink ∈ [0, 0.10] m in the landing zone only during ground contact. `APPROVED: compliant landing layer` — if achieving this needs the physics, model the landing zone as a thin compliant layer with a 0.10 m depth cap (own commit + golden rebaseline + before/after). Scale `_spawnSnowBurst` to match the cloud.
- **Skis must never penetrate the snow surface — at any point, including while the athlete rotates on landing or crashes (author, 2026-08-26). The surface is hard.** *(Refined above: applies to hard zones.)* Add a drive spec that runs a full jump (in-run, takeoff, flight, landing, roll-out) plus a crash/ragdoll case and, every frame, computes for each ski the lowest world-space point of its *visual* mesh (tip, tail and base after P3's shaped ski) and the terrain height under it (`terrainRootY(z) - FOOT_OFFSET`, or the visual surface once P1 lands — they must agree); assert min clearance ≥ 0 (tolerance 5 mm) and report the worst frame, phase and depth. Fix all renderer-side causes: visual terrain not matching the physics profile (P1 must sample the exact physics function), FOOT_OFFSET/sole seating, ski mesh thickness and the new curved tip dipping when the ski pitches, boots/feet through the ski, and any interpolation/lag between physics state and the rendered transforms. If, after that, the *physics* still lets the ski go below the surface (a soft landing model, spring/damping, or a collision tolerance in `engine/`), do not touch `engine/`: record the exact worst-case depth, duration and phase under Open questions so the author can decide on an engine change and golden rebaseline. Do not hide penetration with a purely visual clamp unless the author says so.
- **Cyan band across the whole screen at the end of the in-run (author, 2026-08-26) — fix with the grey-ramp quick win (item 3 of the order).** From the default ready camera (`reference/shots/ready_view_2026-08-26_1708.jpg`, local file) a pale sky/fog-coloured strip spans the full width just beyond the ribbed transition segments. It is a seam: the wide flanking fills for the in-run and the table (the `wb`/`w*` extension boxes around `game.js:2160`, `wUpperMtn`/`wInrun`/`wTable`) are separate boxes at different slope angles and do not meet, so the background shows through. Fix: make the flank fills continuous — overlap them generously or, better, build them as the lateral extension of the same continuous ribbon P1 introduces — so no background is visible anywhere inside the terrain footprint. Acceptance: from the default ready camera and from the side camera, no pixel row inside the snow footprint samples the fog/sky colour (add a screenshot check: sample a vertical column through the seam location and assert luminance/chroma stays within the snow range). The same shot shows the corridor clearly greyer than the flanks (the grey-ramp item) and the transition rendering as visible slats (the kink item).
- **The landing slope must roll out into the flat out-run on a radius, not a crease (author, 2026-08-26).** Add this to the P1 kink work and to the C1-profile approval: the transition from the inclined landing to the flat run-out at the bottom (`OUTRUN_Z`) must be a smooth curve — a circular/bezier roll-out of generous radius (in the footage the compression zone is several metres long, roughly 8–12 m of arc for a ~35° landing) — with the same C1 check (no adjacent-sample slope jump > 2°). Visual ribbon first; if the physics profile itself has the crease at `OUTRUN_Z`, this is covered by `APPROVED: C1-smooth run profile` (preserve landing angle and total run length; report airtime/distance deltas from the traces). Same treatment at the top of the landing (knoll roll-over) and at the in-run/table joins.
- **Run profile has visible kinks and the ramp is still grey (author, 2026-08-26) — fold into P1, do it early.** Where the in-run's decline meets the flat table, where the table meets the kicker curve, and after the kicker into the landing, the surface shows angle discontinuities. Causes to check: the corridor is built from rotated boxes (`slope`, 16 `trans_seg_*`, 20 `kicker_seg_*`, landing segments) with flat-shaded faces, gaps/overlaps at each joint, and no shared normals; plus a raised in-run box whose vertical side face is exposed. Fix as part of P1: one continuous ribbon/heightfield sampled densely along z from the physics profile (`terrainRootY(z) - FOOT_OFFSET`, `AerialEngine.aerialSki.*`), with smooth (averaged) normals, sample spacing ≤ 0.25 m through the transition beziers and the kicker curve, no seams, and lateral blending into the flanks. Verify C1 continuity of the *visual* surface by sampling slope along z and asserting no jump > 2° between adjacent samples; if the *physics* profile itself has a slope jump (bezier joins in `TRANS_LEN`, `LANDING_TRANS_LEN`, the kicker lip), record the location and size under Open questions — do not touch `engine/`. Use the reference clips for the shape: a long straight in-run, a smooth transition into a flat table, a kicker with a continuous curve to a near-vertical lip and vertical side walls, a flat knoll, then a rounded roll-over into the steep landing.
  Grey ramp: in `shots/scene.png` the corridor reads darker than the flanking snowfields even though both are snow. Measure it (mean luminance of corridor vs flank pixels in the shot) and make the corridor at least as bright as the flanks in sun — in the footage the run is the brightest surface in frame. Suspects: the baked `terrain_skyvis.png`/`terrain_shadow.png` multipliers on the 28 lightmapped meshes (stale once geometry changes — disable them until P1 geometry is re-baked), the `_baked` material clones losing the snow detail maps, SSAO darkening the kicker's concave transition, exposed side faces in shadow, and the kicker/table using a different material than the flanks (`lsMat` vs `snowMat`). Report the numbers before and after.
- **Shadows: none on the skier, inconsistent on trees (author, 2026-08-26).** See the shadow paragraph added to P2: cascaded shadow maps for the sun, athlete + skis guaranteed in the caster list after the async load, all trees casting, receivers set, with a luminance-sampling spec. Do it as a quick win right after item 3 (grey ramp) — it's a lighting fix independent of the terrain rebuild.
- **Crash: the flying pieces are the legacy primitive solids (author noticed, 2026-08-26).** `game.js` hides the skinned body on crash and re-shows/detaches the old boxes and spheres. New **P11 — coherent crash** in the plan: connected position-based ragdoll on the drivers with the skinned body following, skis releasing and sliding, spray, camera easing to rest. Order: do it right after P10, before P1.
- **Free-look shows the underside of the mountain (author, 2026-08-26).** Two fixes, both in the plan now: P10 clamps the camera ≥ 1 m above the terrain under it with a slope-aware beta limit; P1 makes the terrain closed solids (skirts to a base plane, snow-coloured underside, `backFaceCulling=false`). Do the camera clamp as part of the P10 item; the skirts as part of the first P1 slice — and if P1 is more than one iteration away, add a quick interim skirt/base box under today's slabs so the underside is never visible.
- **New from the author (2026-08-26):** (a) trees must be genuinely realistic — see the expanded P4 (Blender-baked impostor atlases, thin instances, snow load); (b) a legible bib number **30** front and back — see P7; (c) **P10 free-look camera** in the ready state before the run, after landing/crash, and during replay (drag to orbit, wheel to zoom) — small, self-contained; do it right after item 4 (ready stance), before P1.
- **Ready stance across the in-run: both skis on the snow, uphill knee bent (author, 2026-08-26). Item 4 of the order, before P1.** In the ready state the athlete stands yawed 90° across the fall line (`readyYaw`). Standing on an incline across the slope means: both skis lie flat on the slope plane along their whole length (each ski rolled about its long axis by the slope angle, edges into the hill, lowest points within 5 mm of the terrain at 5 sample points per ski); the torso and head stay vertical in world (gravity-aligned, pitch/roll within 3°); the **uphill** leg bends at knee and hip to take up the height difference and the downhill leg is near straight; hips shift slightly uphill; arms relaxed at the sides; boots seated on the skis throughout. Implement renderer-side in `game.js` as a ready-stance pose blended in during the ready state (the ready state has no physics motion, so this is display only — ADR-0002; do not add tables to `engine/`). Reference: the standing frames of `IMG_3765` (athlete waiting at the top, arms raised then lowered) and the in-run frames of `IMG_3768`. Acceptance in a drive spec: in the ready state, both skis' lowest points ≤ 5 mm from the terrain and ≥ 0 penetration; torso within 3° of vertical; uphill knee flexion greater than downhill by ≥ 10°; when `readyTurnT` completes and the athlete faces down the fall line, the stance returns to the normal in-run posture with both skis still on the snow.
- **Head: a helmet on top, a face underneath — not a black ball (author, 2026-08-26). Add to the item-2 Blender rebuild.** The build currently projects the whole head onto an ellipsoid (`shape_helmet`) and paints all of it `HELMET`, so the face is a black shell. Real aerials helmets (see `reference/frames/IMG_7841/video_skis_closeup.jpg`, `IMG_3768`, `IMG_3765`) cover the cranium only; the face is visible below the brim with goggles. Do: restrict the helmet shell to the cranium (above the brow line, behind the ears, with a visible brim edge ~1 cm proud of the skin) and keep the base mesh's face geometry; paint the face skin-toned, add a goggle band (dark lens across the eyes with a strap around the helmet) and leave the chin/mouth skin; keep the helmet dark and glossy, the goggles glossy, the skin matte. The `head`/`helmet` material split in `game.js` must follow (helmet = glossy shell material; face = matte body material). Acceptance: from the front camera the face region below the brow reads skin (albedo mean in that UV region ≥ 0.5 luminance) and the goggle band is dark; from the rear it is helmet.
- **Legs spread wider than the skis; boots not on the skis (author, 2026-08-26). Same rebuild.** Build log already says it: `lowerLegL y_mean=-0.199 (target -0.075)` — the shin geometry sits ~12 cm outboard of its bone, so with bind ≡ driver the feet stand outside the skis. Same fix as the arms: the weight>0.9 vertex centroid of each leg segment must lie on its bone axis (|lateral| < 1 cm, |fore-aft| < 1 cm) — fail the build otherwise — with the thighs allowed a natural taper inward toward the knee. Boots: sole centroid within 1 cm laterally of the ski centre line (x = ±0.075), sole bottom within 5 mm of the ski top (y = −0.995), boot length centred over the binding area, toes forward (−z). Browser acceptance in `rig.spec.js`: at rest and in the in-run tuck and the airborne tuck/pike, each boot's sole centroid is within 1 cm (x) / 5 mm (y) of its ski's top surface at the same z — the boot rides the ski in every pose, never beside or above it.
- **Hands hang in front instead of at the sides, and cross when the arms are raised (author, viewing the current tree, 2026-08-26). Do this right after the footage analysis, before P1.** Cause: after `pose_onto_segments` the arm-dominant vertices sit inboard of and ahead of their bones (build log: `upperArmL y_mean=-0.132 (target -0.205)`; forearm centroid also forward of the bone), because heat-map weights bleed between torso and arm and the blended vertices only travel part of the way. `armSweep` then rotates the arms about the shoulder pivot, so an inboard/forward offset at rest becomes crossed hands overhead. Fix in `blender/build_body.py`, verify in the browser:
  1. After posing, the centroid of each arm segment's weight>0.9 vertices must lie on the bone axis: |lateral offset| < 1 cm, |fore-aft offset| < 1 cm (lower arm measured at its centre, hand excluded). Make the build fail on this, not just log it. Achieve it by limiting torso→arm weight bleed (tighter heat-map/smoothing on the arm groups, or a normalised re-weight so arm vertices are ≥ 0.9 arm past the deltoid crease) and, if a residual offset remains, by translating the arm-dominant vertex set onto the bone before the rest pose is applied.
  2. Bind the arms hanging at the sides, palms in, hands beside the thighs (slightly behind the hip line as in `reference/frames/IMG_3768` in-run frames and the standing frames of `IMG_3765`), abducted just enough (~8–10°) to clear the torso.
  3. Browser checks to add to `rig.spec.js`: at rest, each hand's centroid is lateral of the torso (|x| ≥ torso half-width + 2 cm) and within ±3 cm in z of the hip; with `applyPose(…, armDropL=0, armDropR=0 …)` (arms up) the hands are ≥ 25 cm apart laterally, above the head, and mirror-symmetric in x within 1 cm; both arms have identical rx/rz through the sweep (armDrop 0.25, 0.5, 0.75).
- **Landing zone texture and chop from Blender (author, 2026-08-26).** P5 in the plan now specifies `blender/bake_landing.py`: bake normal/AO/albedo tiles plus a heightmap for the chopped landing from a procedural surface modelled on the footage, apply the heightmap as real displacement on the landing mesh, keep snow albedo ≥ 0.85. Read the updated P5 before starting P5 work.
- **Two venues in the footage — keep one world (reviewer).** `IMG_7841` is a winter forest venue (Canada): snow everywhere, mixed bare-deciduous/spruce forest, low ridgelines. `IMG_3765/3768/3523/3520` are a spring/summer training site: a snow strip on dry sagebrush hills, a glass-fronted building, staff in shorts, harsh high sun. The game's world stays the **winter venue** — do not turn the hills brown. Use the new clips for what they show better: kicker geometry (`IMG_3765` from the base of the kicker looking up: white block, vertical side walls, near-vertical lip, athlete leaving almost straight up), the in-run seen from behind (`IMG_3768`: two parallel lanes, athlete in a low crouch with hands in front at knee height, arms sweeping up together at the lip), flight shape and ski position, landing technique, and camera perspectives worth offering in-game (base-of-kicker looking up; behind-the-athlete in-run; coach position at the knoll). Say this explicitly in `docs/REFERENCE-FOOTAGE.md`.
- **NEXT ITERATION, BEFORE ANY OTHER WORK — reference footage analysis (author, 2026-08-26).** Five more clips of real aerial jumps from different perspectives are in `reference/video/` (gitignored): `IMG_3765.MOV` (3.7 s), `IMG_3768.MOV` (6.0 s), `IMG_3523.MP4` (10.5 s), `IMG_3520.MP4` (7.9 s), and `IMG_3396.MOV` (4.7 s — a **night session under floodlights in heavy falling snow**; it is the reference for the new P9 night snowfall mode in the plan, so describe its lighting, flake density/size/motion and the takeoff snow puff carefully). Frames at 2 fps are pre-extracted in `reference/frames/<clip>/f_NNN.jpg` with 4×3 contact sheets `contact_N.jpg`; the original clip's frames are in `reference/frames/IMG_7841/video_*.jpg`. Read the contact sheets first, then individual frames where detail matters. Write `docs/REFERENCE-FOOTAGE.md`: per clip — camera perspective (where it stands, lens, framing), venue geometry (kicker shape/height, table, knoll, landing angle and surface, banks, fencing, poles, panels, towers, people), environment (forest species mix, snow load, horizon, sky, sun height and direction, shadow hardness), lighting/colour (snow vs sky brightness, tonality), and athlete technique (in-run stance, takeoff arm sweep, flight shape — layout/tuck/pike, arm and ski positions through the phases, landing posture, snow spray), with frame references. Then add a section **"Deltas vs the game"**: concrete, measurable changes, each mapped to a plan priority (P1–P7 or a new P), and append them to `docs/RENDER-PLAN.md` under the matching priority. Commit both files. The goal from the author: the scene and the athlete should iterate toward *these* clips as well, not only the first one. If your tooling cannot display images, say so plainly at the top of the progress entry and stop after that (the reviewer will switch models); do not guess at frame contents.
- **Skis must have curved, upturned tips (from the author, 2026-08-26).** Real aerials skis have a raised shovel at the front and a slightly raised tail — see `reference/frames/IMG_7841/video_skis_closeup.jpg` and `video_takeoff_lip.jpg`. Today each ski is a flat 1.20 × 0.08 × 0.03 box. Do this renderer-side only (ADR-0002): keep the physics `skiL`/`skiR` segments untouched and give each ski driver a child visual mesh — flat body, tip rising ≈ 5–6 cm over the front ≈ 18 cm with a rounded profile, slight tail lift, a binding block under the boot. Verify which end is the front in the game's frame (the direction of travel / the pose tables' forward, −z in the body frame) so the tip leads. Add a spec assertion: the highest ski vertex is at the leading end.
- **Notches on the skier's legs are still visible (author).** The handoff dismissed the knee/ankle dips as anatomical waists; the author sees steps, not waists. Likely causes: `add_girth` applies a different slimming factor per segment (shin ×0.74 vs thigh ×0.79) with a hard switch at the joint, and the rigid boot ramp (45 mm) at the ankle. Blend the girth factor across joints by skin weight (or over ≥ 8 cm), and change the leg-profile check to flag steps (a discontinuity in the first derivative of the profile), not dip depth — do not simply skip the knee and ankle bands. Re-check after P0 lands, since the skinning changes there.
- **At takeoff both arms must rise straight up together (author).** Currently one arm ends up in front and the other behind. The P0 frame bug produces exactly this (as-is, one forearm centroid sits 0.29 m behind the driver and the other 0.31 m ahead), so land P0 first, then verify at the takeoff moment that `upperArmL`/`upperArmR` (and lower arms) have identical rx and mirrored x with the same z; if any asymmetry remains and it comes from the renderer (`applyPose`, `applyGamepadLateral`, the takeoff arm phases around `game.js:77`), fix it there; if it originates in engine inputs, do not touch `engine/` — record it under Open questions. Reference silhouette for flight: arms straight overhead by the ears, skis parallel and together (`reference/frames/IMG_7841/video_skis_closeup.jpg`).

## Status board

| Priority | Item | State | Notes |
|---|---|---|---|
| P0 | Rig frame fix | **landed (iter 1)** | build-side; bind≡driver verified per bone in `rig.spec.js` |
| P1 | Continuous terrain | open | |
| P2 | Sky and sun | open | |
| P3 | Venue dressing | open | |
| P4 | Forest | open | |
| P5 | Snow surfaces | open | |
| P6 | Horizon | open | |
| P7 | Flight pose / suit | open | |
| P8 | Build-side defects | open | exposed by P0, queued as iter 3: hands inboard/forward, shins ~4 cm outboard (y_mean +0.020/+0.036 vs ∓0.008), shoulders 31% of height, leg-notch girth blend |
| P9 | Night snowfall mode | open | ref: IMG_3396, measured in `docs/REFERENCE-FOOTAGE.md` |
| — | Reviewer order 1: footage analysis | **done (iter 2)** | `docs/REFERENCE-FOOTAGE.md` + deltas appended to the plan |
| — | Reviewer order 2: athlete rebuild | open | ONE Blender rebuild: arm centroid-on-bone, legs on the skis + boots seated, real face under a cranium-only helmet (goggle band, skin below the brow), leg-notch girth blending |
| — | Reviewer order 3: grey ramp | open | after order 2 |
| — | Reviewer order 4: ready stance | open | renderer-side pose in `game.js`: both skis flat on the slope plane (≤5 mm), torso vertical, uphill knee bent ≥10° more than downhill; before P1 |

## Open questions for the reviewer

- The Blender exporter writes joint-node rotations of its own (−90°/+90° about
  X by bone group) that are NOT what Babylon ends up skinning with. The P0 fix
  therefore asserts the skin's `inverseBindMatrices` accessor directly:
  `patch_skin_binds` in `blender/build_body.py` rewrites those 160 floats
  post-export to exactly inverse(driver rest) and re-reads the file to verify
  (worst element diff 0.00e+00). Babylon skins with `current × inverseBind` and
  `linkTransformNode` overrides node locals every frame, so the accessor is the
  only state that matters — flagged in case a future loader version derives
  binds differently.

- **Camera presets** (from the footage — base-of-kicker looking up, behind-the-athlete
  in-run, coach position at the knoll; all documented in `docs/REFERENCE-FOOTAGE.md`):
  the plan has no slot for camera work. Renderer-side presets only, no engine change.
  Add as a new low priority (e.g. P10) or fold into P3? No work done on this.

## Iterations

### 0 — baseline (reviewer)
- Branch created from `worktree-blender-assets` at `69d1655`; audit committed in `54f73d0`.
- Baseline shots: `docs/analysis-2026-08-26/img/scene.jpg`, `fix_before.jpg`.

### 1 — P0 rig frame fix, build-side
I can view PNGs; shots inspected directly (tooling renders them).

**What changed**
- `blender/build_body.py`: the mesh is now authored in the DRIVER frame —
  `bl()` maps Babylon (x, y, z) = Blender (x, −forward, height): lateral on
  Blender X (game L at negative x), chest facing Blender +Y (export_yup turns
  +Y into glTF −z), up Z. The "game L ↔ metarig .R" swap is gone — with the
  corrected frame the sides agree anatomically, and the sign probe stays as a
  guard. Base mesh loads with a 180° Z turn instead of 90°.
- `normalize_bind_frame` (new): after `armature_apply` + the bind shift onto
  segment centres, every edit bone's roll is closed iteratively until its rest
  matrix equals the driver's rotation (identity for torso/head/legs, π about X
  for arms — armSweep(phi=π) at armDrop=1). Build hard-fails above 5 mrad /
  0.5 mm residual. Measured this build: 0.0 mrad, 0.00 mm; shins keep their
  h−foot_lift rest length so the clean-bake audit still passes.
- `patch_skin_binds` (new, post-export): rewrites the GLB skin's
  `inverseBindMatrices` to exactly inverse(driver rest) — translation = the
  POSE_UNTUCKED centre in Babylon axes, rotation identity except π/X on arms —
  then re-reads the file and verifies. Rationale: measured on this very export,
  the Blender exporter writes joint-node rotations of −90°/+90° X that do not
  survive to what Babylon skins with; the accessor does (see Open questions).
- Axis consumers re-audited for the new frame: `segment_frame` (front=+Y,
  out=±X), `bib_mask`, `paint_suit`/`displace_suit` (stripe/seam azimuth
  anchors, number-patch lateral extent, crown ridge along fore/aft),
  `shape_helmet` (width/depth radii), `skeleton_offset`, `rigid_boots`,
  `build_report`, `leg_profile` (lateral width now X).
- `tests/drive/rig.spec.js`: new test "bind equals driver and the figure faces
  −z" — per-bone `getAbsoluteInverseBindMatrix() × getAbsoluteMatrix()`
  identity (translation < 1 mm, rotation < 0.5°), whole-mesh rest deformation
  < 2 mm, toes ahead of ankles along −z (the acceptance set from the plan).
- `game.js`: `ASSET_V` 5 → 6. Assets rebuilt at 2048/96 (~20 s): body glb +
  albedo/normal/ao + maps json. No engine/ or body-model changes.

**Verification numbers**
- Browser at rest, all 10 bones: bind-to-driver translation 0.000 m, rotation
  0.00° (test threshold 1 mm / 0.5°). Whole-mesh raw-vs-skinned rest
  deformation: max 0.0000 m, mean 0.0000 m over 12,612 vertices (old build:
  forearms displaced 0.29–0.30 m).
- Facing: toe-band mean z = −0.0609 (n=2500) vs ankle-band mean z = +0.0314
  (n=276) — toes lead ankles by 0.092 m along −z; toe min z = −0.142.
- Build log: `game "L" maps to metarig .L`; bone placement worst 0.0 mm; rest
  pose baked cleanly; suit paint census 9,630 stripe / 1,622 bib / 227 number
  / 19,926 glove (matches pre-fix magnitudes — no paint regression); albedo
  sRGB mean 0.881 (was 0.88).
- `npm run test:unit` pass; `npm run test:golden` 30/30 (physics untouched);
  full Playwright drive suite 37/37 including the new rig test, the ski/sole
  tests, leg notch (worst dip 16 mm at y=−0.44, threshold 30 mm — the author's
  step-notch rework is queued for iter 2 as ordered), body-deform, extract-terrain.
- Shots: `figure.png` (rear) — back reads as a back, no shoulder humps, normal
  neck; `figure_front.png` — bib and face of the body toward the front camera,
  stripe on the leg sides; `scene.png` — athlete square to the run, skis down
  the fall line with torso aligned behind them (was: torso stood sideways).
  Hands hang slightly inboard/at the front — P8, next iteration per the order
  of work.

**Open / next**
- The plan's game-side stopgap (`probe_yawfix2.js`) was NOT needed — the
  build-side fix landed and verified; nothing to remove from `game.js` (the
  loader there is unchanged).
- Next per the pinned order: footage analysis (`docs/REFERENCE-FOOTAGE.md`),
  then the iter-2 athlete rebuild (arm centroid-on-bone + leg-notch girth
  blending, one Blender rebuild, ASSET_V bump), then the grey ramp.

### 2 — Reference footage analysis (five new clips) + plan deltas
I can view JPG/PNGs in this session; all contact sheets and the detail frames cited
below were inspected directly, not guessed.

**What changed**
- New `docs/REFERENCE-FOOTAGE.md`: per-clip analysis of `IMG_3765` (base-of-kicker,
  spring), `IMG_3768` (behind-athlete in-run, spring), `IMG_3523` (judges-tower view,
  winter overcast), `IMG_3520` (high side view of the landing, winter overcast),
  `IMG_3396` (night floodlight session — the P9 reference), plus the `IMG_7841`
  landing sequence at 0.1 s steps. Each clip: camera perspective, venue geometry,
  environment, lighting/colour, athlete technique, frame references.
- **Two venues, one world** stated explicitly in the doc: the winter forest venue is
  the game's world; the spring clips are used only for kicker geometry, in-run layout
  and technique. The "CAN"/maple-leaf kicker wrap and the roundel flag are called out
  as excluded (ground rule 3).
- A **Deltas vs the game** section: 14 concrete, measurable changes, each mapped to a
  plan priority; the same deltas are appended to `docs/RENDER-PLAN.md` under P1–P7
  and P9.
- No code, no assets, no engine/ changes — docs only. `ASSET_V` unchanged.

**Key numbers taken from the frames** (for the later iterations that implement them)
- Kicker: side walls ≈2.5–3 m vertical, take-off face curving to near-vertical lip
  (IMG_3765 f_001–f_003); athlete leaves nearly straight up, layout, skis parallel.
- In-run: two parallel lanes with rough divider, low crouch, hands forward at knee
  height (IMG_3768 f_002); arms sweep up together at the lip.
- Landing: sink ≈ sole depth at deepest compression; plume ≈1–1.5 m at peak ~0.4–0.5 s
  after touchdown, trailing 1–2 s (IMG_7841 landing_sequence steps 1–7) — matches the
  pinned 0.05–0.10 m compliant-layer sink.
- Dressing: B-net both edges curving around the bowl; two rows of red wands with
  pennants on the landing centreline; plain blue knoll flag; timber deck on dark
  containers as the judges' deck; coaches in red jackets at the knoll.
- Night (P9): 5–7 warm (~2800–3500 K) floodlights; near-black sky, no horizon; kicker
  near-pure-white in pools; pool-edge falloff, not uniform fog; flakes as 4–15 px
  elongated streaks, denser near lights; takeoff puff ~0.5–1 m / ~1 s; landing cloud
  ~1.5–2 m / ~2 s.

**Verification**
- `npm run test:unit` 73/73 pass; `npm run test:golden` 30/30 (no code touched —
  re-run as the iteration's regression check after the self-review of iter 1).
- Working tree contained only the two docs before commit; no reviewer scratch-bake
  files present.

**Open / next**
- Reviewer feedback landed mid-iteration (`65a0a54`): the pinned order gained an
  item 4 (renderer-side ready stance — both skis on the snow, uphill knee bent,
  before P1) and item 2 expanded (legs on the skis with boots seated; a real face
  under a cranium-only helmet with goggle band — all in the SAME rebuild). The
  footage doc already cites the exact frames this feedback references
  (IMG_3765 standing athletes, IMG_3768 in-run crouch, IMG_7841
  `video_skis_closeup.jpg` helmet/face) — measurements there carry over.
- Next per the pinned order: iter-3 athlete rebuild in ONE Blender pass (arm
  centroid-on-bone with the build failing on offset; legs on the ski centreline +
  boots seated; face/goggles under the helmet; leg-notch girth blending across
  knee/ankle; boot ramp smoothing; leg-profile check flags steps), rebuild +
  ASSET_V bump + browser verification. Then the grey-ramp quick win (order 3),
  the ready stance (order 4), then P1.
- Camera presets from the footage have no plan slot — under Open questions for the
  reviewer.

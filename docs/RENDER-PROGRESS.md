# Render realism — progress log

Branch `render-realism-glm`. Plan: `docs/RENDER-PLAN.md`. Each iteration appends an entry.
Keep entries short and factual: what changed, how it was verified (numbers), what is open.

## Reviewer feedback (read first; the reviewer edits this section)

- **ORDER OF WORK for the next iterations (reviewer, 2026-08-26 — the author is watching the live tree):**
  1. Footage analysis (`docs/REFERENCE-FOOTAGE.md`) — one iteration.
  2. Athlete build fixes in ONE Blender rebuild: hands at the sides / no crossing (arm centroid on bone), legs on the skis with boots seated (leg centroid on bone), a real face under a cranium-only helmet, **and** the leg notches (blend the girth factor across the knee and ankle by skin weight; smooth the boot ramp; make the leg-profile check flag steps). Rebuild, bump `ASSET_V`, verify in the browser, commit.
  3. Grey ramp — quick win before the full P1 terrain: measure corridor vs flank luminance in `shots/scene.png`, then fix the causes (stale `terrain_skyvis`/`terrain_shadow` multipliers → disable until re-baked; `_baked` clones missing detail maps; `lsMat` vs `snowMat` mismatch; exposed dark side faces; SSAO in the concave transition). Target: corridor ≥ flank brightness in sun. Report numbers.
  4. Ready stance across the in-run: both skis on the snow, uphill knee bent, arms at the sides, and the **hop turn** to face downhill (renderer-side; see the items below).
  5. **P1 slice 1 — corridor ribbon from the exact physics profile + whole-run clearance spec** (the skier currently disappears into the snow at the transition, the kicker top and the landing).
  6. P10 free-look, P11 coherent crash, then the remaining P1 work (flank fills, skirts, radiused roll-out), P2 sky/sun, and the rest of the plan in order.
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
- **ITERATION 10 (review) — handle iteration 9's uncommitted tree FIRST (reviewer, 21:35).** Iteration 9 (ready stance + hop turn) timed out with `game.js`, `rig.spec.js`, new `tests/drive/ready-stance.spec.js`, `tests/golden/audit-ready-stance.js` and **all 23 golden traces** modified. A golden re-capture is a physics rebaseline and there is no `APPROVED:` line for the ready stance — it was specified as display-only. Do this, in order: (1) run `node tests/golden/audit-ready-stance.js` against the old traces (`git stash`/`git show HEAD:tests/golden/traces/<name>.json` as needed) and report exactly which trace fields differ; (2) **if** the differences are confined to the ready state before the run starts (pose/camera/ready-turn fields, identical flight, takeoff, landing and score values), commit the work — game.js + specs + traces — as "ready stance + hop turn (display-only; traces re-captured because the ready phase is recorded)" with the audit output in the progress entry, and it is approved as such: `APPROVED: ready-stance trace re-capture, provided flight/landing fields are byte-identical`; (3) **if any** flight/takeoff/landing/score field differs, do NOT commit the traces: `git checkout -- tests/golden/traces/`, make the ready stance not alter the run (it must be display-only), get `npm run test:golden` green against the ORIGINAL traces, and commit; if you cannot within this session, commit the non-trace work only if tests pass with original traces, otherwise leave the tree as is and write the numbers under Open questions. Then do the review as planned.
- **Check the game physics against motion capture of all six clips (author, 2026-08-26). New item; do it as its own iteration once the extraction has finished (check `reference/pose/extract_all.log` for six "…: N frames" lines).** The reviewer is running RTMPose over every clip at 30 fps: `reference/pose/<clip>/keypoints.json` holds **all detected people per frame** (COCO-17 pixel keypoints + per-keypoint scores, frame size recorded) plus `overlay_sheet_*.jpg`; `reference/pose/README.md` explains the format; the venv is `/data/aerial-agents/rtmpose-venv` and `extract_all.py` is re-runnable (e.g. on an upscaled crop for the small-athlete clips 3523/3520 — see `IMG_3523_hop/run_pose.py` for the crop+4× recipe). Note the hop clip's naive "best score" selection latched onto bystanders at frames 0 and 72 — **track the athlete by continuity** (nearest to the previous frame's hips, plausible size change), treat score < 0.5 as missing, smooth ≤ 3 frames.
  Write `tools/pose_vs_physics.js` (node, no runtime deps) and `docs/POSE-VS-PHYSICS.md`. From each clip's athlete track derive, in the camera plane: takeoff frame (feet leave the lip), landing frame (feet touch), **airtime**; the number of flips and the mean/peak **angular rate** from the unwrapped angle of the shoulder-midpoint → hip-midpoint vector (the jumps may be **single or double** — determine which per clip from the rotation count); in-run crouch depth and the arm sweep timing into the lip (`IMG_3768`); tuck/layout shape in flight (knee angle, hip angle); landing absorption duration (knee angle vs time) and the sink/spray timing (`IMG_7841`). Then compare with the game: run the golden scenarios (`tests/golden/traces/aerial-power-*.json`, `aerial-tuck*.json`, `aerial-full-twisting-double.json`, `aerial-pike.json`) or a headless run of the same tricks, extract the same quantities from the physics state (airtime, flip count, angular rate, takeoff/landing body angle), and tabulate clip vs game side by side with the differences. Where the game is off, propose the physics parameter changes that would close the gap (kicker lip angle/height, takeoff speed, gravity scale, moments of inertia, tuck speed-up) with predicted effects — as **Open questions with numbers**, not as commits; the reviewer will approve specific changes. Scale note: 2D monocular keypoints give timing and angles reliably, distances only roughly — use the 155 cm ski / 1.7 m athlete for scale and say so.
- **Hop turn: drive it from real motion capture (author, 2026-08-26).** The reviewer ran RTMPose on the start of `IMG_3523.MP4` (the athlete at the top of the in-run turning to descend): `reference/pose/IMG_3523_hop/keypoints.json` (COCO-17, 30 fps, t = 0–3.17 s, video-pixel coordinates; see `reference/pose/README.md`), with per-frame overlays and `overlay_sheet.jpg` to sanity-check tracking. Use it to time and shape the hop-turn animation: from the hip/knee/ankle keypoints derive knee-flexion vs time (crouch depth and duration), the extension (hip rise rate), the airborne window (ankles rising together, both feet off), the landing absorption, and from the shoulder-line/hip-line width vs time the ~90° rotation of the body about vertical (the line collapses to a point at 90°); from the wrists, the arm swing (back on the crouch, forward/up on the extension). Fit the game's hop-turn curves to these timings (report the numbers you extracted: crouch start/end, take-off, landing, settle, rotation duration, wrist arc). Differences from the footage the author wants: **skis a bit more parallel** than the athlete in the clip; start **perpendicular to the hill**, then one **90° hop** into the fall line. Treat keypoints with score < 0.5 as missing and smooth over ≤ 3 frames. Record which frames you used.
- **Skis must look like real skis (author, 2026-08-26): shaped after a mogul/aerials ski such as the Kästle MogulX (https://kaestle.com/en-us/products/mogulx-summer-24 — for the *look*; do not reproduce the brand name or logo).** Adults are on 150–160 cm. Build the visual ski (renderer-side child mesh of each ski driver, replacing the black box): length 155 cm; straight-ish mogul sidecut (tip ≈ 95 mm, waist ≈ 70 mm, tail ≈ 85 mm), a rounded shovel tip rising ≈ 5–6 cm over the front ≈ 18 cm, a slightly lifted flat tail, 1–1.5 cm thick at the binding tapering toward tip and tail; a topsheet with a clear graphic (white/black base with a strong colour band and a generic mark — not black), dark sidewalls, a steel-grey edge line, a matte black base; a binding with toe and heel pieces and a brake, and the boot seated in it. Physics: `APPROVED: ski length 1.20 → 1.55 m` in `body-model` (`skiL/skiR d`), same mass, ski centre unchanged — include it in the approved proportions rebaseline commit so the physics tip/tail match the visual and the clearance spec measures the true ski. Acceptance: `rig.spec.js` checks the visual ski's length (1.55 ± 0.01), tip height, tip leading (−z), and that the boot sits in the binding; a `look` shot shows the graphic.
- **Arms look like they have an extra joint; forearm bends inward when the arms are up; not anatomically correct (author, 2026-08-26). Same Blender rebuild as the suit/shoulders.** Likely causes to measure: (a) `settle_limb_geometry` moves the forearm chain rigidly onto its driver axis and fades only across the top join, which can leave a lateral/fore-aft step at the elbow; (b) the base mesh's A-pose elbow carries ~10–15° of flexion and forearm pronation that survives when the bones are posed straight, so the forearm "points in"; (c) the wrist/hand orientation after the frame fix. Requirements, verified in the browser with arms raised (`armDropL = armDropR = 0`) and hanging (`= 1`): the upper-arm, forearm and hand segment centroid lines are collinear within 1 cm laterally and fore-aft; the elbow cross-section shows no step > 5 mm between the upper-arm side and forearm side; the hand's long axis continues the forearm axis within 10° (palms facing in when hanging, facing forward/in when raised); the arm is straight when the drivers are straight. In the build: straighten the elbow and neutralise pronation in the bind (rotate the forearm about the elbow onto the upper-arm axis before `pose_onto_segments`), settle the *whole* arm chain with a smooth blend through the elbow, and hard-fail on the collinearity/step numbers above.
- **Arms overhead through the kicker (author).** From the transition into the kicker the arms rise together and are straight overhead by the lip (elbows locked, hands by the ears — `reference/frames/IMG_3768` sheet, `IMG_7841` video_skis_closeup), and stay straight in flight until the landing opens them. Renderer-side pose blending only (P7): check `armRaise`/`armDrop` phasing in `applyPose` and the takeoff arm phases in `game.js`; no engine changes.
- **Skier disappears into the snow at three points (author, 2026-08-26) — urgent, pull forward.** At the bottom of the initial incline (transition), at the top of the kicker, and on landing the athlete goes *under* the visible surface. Diagnose with a whole-run clearance probe first: drive a full jump and, every frame, record the lowest world point of the skinned body and of each ski against (a) the physics surface `terrainRootY(z) - FOOT_OFFSET` and (b) the *visual* surface (ray-cast down onto the terrain meshes at that x,z). Where (a) is fine but (b) is not, the visual geometry is wrong — the rotated slabs, the ribbed `trans_seg_*`/`kicker_seg_*` boxes and any new seam fillers do not follow the bezier profile, so the athlete correctly rides the physics surface but the meshes sit above it. Fix = the first P1 slice, now **before P10/P11**: replace the corridor's slabs and segments with one ribbon mesh sampled from the exact physics profile (≤ 0.25 m spacing through the transitions, kicker curve and roll-out), skirts down to a base, snow material; keep the physics untouched. Where (a) itself is violated (body below the physics surface — e.g. landing compression, or the kicker lip), apply the contact rules already pinned: hard zones zero penetration, landing zone ≤ 0.10 m, with `APPROVED: hard snow surface` / `APPROVED: compliant landing layer` available if it is in `engine/`. Acceptance: the clearance spec passes for body and skis along the whole run, both surfaces.
- **Suit is skin-tight and the skier too muscular (author, 2026-08-26). Next Blender rebuild (with the shoulders/proportions work).** An aerials suit is a loose-ish shell with folds, not a race skin. In `build_body.py`: (1) offset the suit surface outward from the body by ~1.5–2.5 cm (more at torso/thighs, less at shins/forearms; none at hands, face, boots), (2) smooth away muscle definition under the suit — a suit-only smoothing pass (torso, arms, legs) strong enough to erase pectoral/abdominal/biceps/calf relief while keeping the silhouette and joints, (3) `displace_suit` adds fabric folds at elbows, knees, hips, armpits and where the suit meets the boots and gloves, plus a slight bagginess at the waist/bib, (4) the bib reads as a separate looser panel. Reference: the suits in `reference/frames/IMG_3768`, `IMG_3765`, `IMG_7841` (video_skis_closeup). Acceptance: the girth report shows the suit ≥ 1.5 cm proud of the base mesh across torso/thighs, the normal map's high-frequency muscle relief is gone from the suit region (measure normal-map variance in the suit UV region before/after), folds present at the joints.
- **The initial turn to face downhill is a hop turn (author, 2026-08-26). Extend item 4 (ready stance).** When `readyTurnT` runs, animate a realistic hop: ~0.3 s crouch (knees to ~90°, hips back, arms swing down/back), ~0.15 s extension with the skis leaving the snow by 10–15 cm, ~0.25 s airborne rotating 90° about the vertical axis (body compact, arms slightly out for balance), landing with ~0.25 s knee absorption on both skis, then settling into the in-run stance and starting the descent. Both skis stay parallel; feet stay on the skis; the skis are off the snow only during the airborne phase; no penetration on landing (hard zone). Renderer-side (display only, ADR-0002); the run's physics starts as before once the turn completes. Acceptance: a spec samples knee angle, ski height above terrain and root yaw through the turn and asserts the crouch → hop → 90° → absorb sequence with the timings above (±30%).
- **Cache-busting for scripts (reviewer, 2026-08-26).** `index.html` loads `game.js?v=5` and the engine scripts with fixed `?v=` values, so the author's browser keeps serving old JS after your commits. Bump the script `?v=` in `index.html` (all `<script src=...?v=N>` tags) in every commit that changes `game.js` or `engine/`/`render/` scripts, the same way `ASSET_V` is bumped for assets. Also: do not kill `python3 -m http.server` processes you did not start — ports 8200/8201 are the author's live viewers.
- **Reviewer check after iteration 4 (2026-08-26 18:45).** Good: face/goggles under the helmet, boots on the skis, limbs on their bones, stripe regression caught by your own gate. Two things still show in the standing figure:
  1. **Hands hang ~15 cm in front of the thighs** (side view). You traced it to the game's ready-crouch pose; whatever the source, the author wants arms relaxed **at the sides** when standing. Fold into item 4 (ready stance): in the ready state the arms hang vertically at the sides (`armDrop` ≡ 1, hands beside the thighs, |hand z − hip z| ≤ 3 cm), and the in-run crouch only brings the hands forward once the run starts. Keep your rig spec's lateral checks; add the z check for the ready state.
  2. **Shoulders still massive and squared** (rear/front views: ~0.47 m across, blocky deltoid masses beside the neck). Measure first, then fix: report bideltoid breadth and the contribution of (a) arm bones at x = ±0.205 vs the mesh's anatomical shoulder (≈ ±0.15) and (b) the ×1.22 upper-arm stretch acting on shoulder-cap vertices.
     `APPROVED: body proportions rebaseline` — on the author's delegated authority, in ONE physics commit with the ADR-0005 golden rebaseline: (i) arm lateral offset `±0.205 → ≈ ±0.175` (upper and lower arm, all pose tables incl. `POSE_ARMS_T` shifted consistently, `armSweep` baseX); (ii) the long-standing proportion fix — torso from 36% toward 31–32% of standing height and legs from 47.5% toward ~51%, keeping standing height and total mass, with every pose table's absolute joint positions moved together so chains stay connected. Constraints: the standard single/double/triple flip rates and landing timing must stay within ±5% of the current golden traces (tune segment masses/inertia if needed to hold that) — report the deltas; if you cannot hold ±5%, stop and put the numbers under Open questions instead of committing. Then rebuild the athlete so the mesh's anatomical shoulder lands on the new bone position without stretching the deltoid (stretch the upper arm below the deltoid crease only).
- **Tree trunks read hexagonal (author, 2026-08-26).** `game.js` builds trunks with `tessellation: 6` and foliage cones with 7 — flat-shaded low polygons, obvious at the base. Interim fix (before the P4 impostor trees land): trunk tessellation ≥ 16 with smooth normals and a slight flare at the base (wider bottom ring, a small snow mound/collar where trunk meets snow so the contact is not a hard circle); foliage cones ≥ 12 sides or replaced by 3–4 stacked, slightly irregular layered cones. Keep it cheap with instancing. This is a stopgap; the real fix is P4.
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
| P2 | Sky and sun | **shadow quick win landed (iter 8)** | CSM 3×2048 live; athlete shadow drop 79% (was 11.6%), trees all cast; **still open: sky luminance 0.799 > snow 0.778 — snow not yet the brightest surface; sun disc, fog re-tune, post 1.6→1.2**; corridor parity landed iter 7 |
| P3 | Venue dressing | open | |
| P4 | Forest | open | |
| P5 | Snow surfaces | open | |
| P6 | Horizon | open | |
| P7 | Flight pose / suit | open | |
| P8 | Build-side defects | partially landed (iter 4) | hands beside thighs (clear ≥16 cm laterally, mirrored 3 mm), shins 2.9 cm off ski line (< 4 cm gate), face/goggles landed; open: hands ride slightly forward in the ready crouch (re-check after the ready-stance pose), crotch loop is base-mesh geometry, shoulders 31% of height |
| P9 | Night snowfall mode | open | ref: IMG_3396, measured in `docs/REFERENCE-FOOTAGE.md` |
| — | Reviewer order 1: footage analysis | **done (iter 2)** | `docs/REFERENCE-FOOTAGE.md` + deltas appended to the plan |
| — | Reviewer order 2: athlete rebuild | **landed (iter 4, recovered)** | ONE Blender rebuild: arm centroid-on-bone (163 mm→0.02 mm), legs on the skis (133 mm→0.02 mm), real face + goggles under a cranium-only helmet (3 material slots), leg-notch girth blending + step gate (23.5 mm, limit 30); stripe re-landed on the shins via slice-centroid azimuth + new bake gate |
| — | Reviewer order 3: grey ramp | **landed (iters 6–7)** | iter 6: snowMat recipe + junction fillers; iter 7: root cause measured — snowMat subsurface translucency (+ clear coat); corridor 0.622→0.7778 vs flanks 0.787, inrun 0.784, kicker 0.758; phase-2 near-parity gates in `grey-ramp.spec.js`; kicker residual −0.029 queued behind P1/P2 geometry |
| — | Reviewer order 4: ready stance | open | renderer-side pose in `game.js`: both skis flat on the slope plane (≤5 mm), torso vertical, uphill knee bent ≥10° more than downhill; **+ ready-state arms hang at the sides (|hand z − hip z| ≤ 3 cm) per the reviewer's post-iter-4 check**; before P1 |
| — | APPROVED: body proportions rebaseline | **queued (approved 18:40, post-iter-4 check)** | ONE physics commit + ADR-0005 golden rebaseline: arm x ±0.205→±0.175 across all pose tables + `armSweep` baseX; torso 36%→31–32%, legs 47.5%→51% of standing height (height+mass preserved); flip rates/landing timing within ±5% of golden or stop; then athlete rebuild with the deltoid un-stretched. Measure bideltoid first (reviewer measured ~0.47 m) |

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

### 4 — Athlete rebuild (reviewer order 2, recovered) + stripe-back-on-the-shin fix

Iteration 3 was killed before it could commit; its rebuild was found intact-but-uncommitted
in the working tree, self-reviewed, verified, and landed here together with one real defect
it had introduced (stripe off the shins) and a new build gate that would have caught it.

**What changed (the recovered rebuild — reviewer order 2, one Blender rebuild)**
- `blender/build_body.py`:
  - `sharpen_limb_weights`: limb vertices past a crease cap pushed to ≥0.90/0.93 own-limb
    weight, selected by anatomical proximity to the segment axes (1,329 verts re-weighted).
  - `settle_limb_geometry`: each limb CHAIN (thigh+shin, upper+fore arm) translated rigidly
    onto its driver axes, fading to zero only across the top join; distal centroid gates at
    10 mm hard-fail the build. Measured: pre-settle offsets were 163 mm (forearms) and
    133 mm (shins); after settle the worst distal centroid is 0.02 mm.
  - Face under a cranium-only helmet: `head_landmarks` measures chin/eyes/brim off the
    posed mesh (re-measured after `retune_proportions`); `soften` now smooths only above
    the brim; `shape_helmet` projects only the dome (fade across the brim band); `paint_suit`
    splits face-skin / goggle-lens / strap / helmet; `finish_lowpoly` gives the face its own
    material slot (suit/helmet/face) with full UV budget; `displace_suit` gives the lens a
    proud frame and the strap a groove. `game.js` wires `athleteFace_mat` (matte skin,
    slot 2).
  - Leg-notch work: `add_girth` blends the slimming factor along the leg chain by skin
    weight with a guaranteed 8 cm smoothstep across the knee plane; `rigid_boots` ramp
    widened 45→80 mm; `leg_profile` now reports and HARD-FAILS on the largest slope step
    (calibrated: smooth builds ≤17 mm blips, the defect measured 40–100 mm; threshold
    30 mm). Final build: worst step 23.5 mm at z=−0.515 (passes), worst dip 7.3 mm.
- `tests/drive/rig.spec.js`: new test "hands hang beside the thighs and shins sit on their
  ski lines" — hand clusters clear the torso laterally, mirror in x, shins within 4 cm of
  their ski centre lines.
- `ASSET_V` → 8 (assets regenerated by the rebuild, by two probe re-bakes, and by the final
  2048/96 rebuild).

**What changed (this session's fix)**
- The rebuild broke the leg stripe: the browser suit test failed at 8.5% blue on the
  outboard shin. Root cause chain, measured: `settle_limb_geometry` brought the shins onto
  their drivers (as ordered), but the CALF bulge stays ~8 cm AFT of the driver axis
  (mid-shin surface at ly −0.03..−0.13), so the stripe/seam azimuth measured from the
  DRIVER centre put the outboard pole in empty air beside the leg — stripe vertices
  collapsed 9,630 → 1,421 and were almost all SOLES (the foot outline crosses ly=0).
  Fix: `limb_slice_centroids` + `limb_azim` — stripe and seam angles in `paint_suit` and
  `displace_suit` are now measured about each 4 cm z-slice's own cross-section centroid.
  Stripe vertices 1,421 → 3,949 spanning the full leg; mid-shin outboard pole reads stripe.
- New build gate: post-bake, the saved albedo is sampled at every low-poly leg vertex's
  UV; < 2% blue hard-fails the build (the browser test's question, asked at build time).

**Verification numbers**
- `npm run test:unit` pass; `npm run test:golden` 30/30 (physics untouched); full
  Playwright drive suite 39/39 (incl. the 6 rig, 4 body, new hands/shins test).
- Browser suit test: outboard-shin blueFrac 0.304 (threshold 0.10; was 0.085 failing);
  helmet luma 0.349 vs suit 0.936; bib front 0.21 blue / back 0.
- Build log: bind frame residual 0 (per iter-1 gates); limb chains settled (worst 0.02 mm);
  paint census 81,602 suit / 3,949 stripe / 14,401 helmet / 6,587 goggle / 17,893 face /
  937 strap / 1,398 bib / 257 number / 19,722 glove; stripe bake gate 241/3,349 leg verts
  read blue (0.072, gate 0.02); albedo sRGB mean 0.894.
- Shots (inspected): `figure.png` (rear) — skin face visible under the shell from behind-
  side, blue stripe down the outboard leg, hands beside thighs, boots on the skis;
  `figure_front.png` — face with goggle band under a brimmed dark shell (was: all-black
  ball head), stripe down both shins, larger white bib. Pre-existing artifacts NOT from
  this rebuild, unchanged from the iter-1 baseline: hands hang slightly forward (ready-
  crouch pose, documented in the rig spec note) and a pale loop at the crotch (base-mesh
  seam, present in `docs/analysis-2026-08-26/img/fix_after_front.jpg`).

**Open / next**
- Grey ramp (reviewer order 3) is next: measure corridor vs flank luminance in
  `shots/scene.png`, then the suspect list (stale skyvis/shadow multipliers, `_baked`
  clones, lsMat vs snowMat, exposed dark faces, SSAO). The A/B harness
  (`tests/drive/compare.spec.js` → `shots/bake_*.png`) from the killed session is committed
  and works.
- Ready stance (order 4), then P1. P8 residuals: hands ride slightly forward in the ready
  crouch (re-check after the ready-stance pose lands); crotch loop is base-mesh geometry
  (needs a base-mesh seam fix, queued behind the order list).

### 5 — Review-only: measured audit of the current render, no features

Shots inspected directly (I can view PNGs) and re-measured with a new non-gating
harness, `tests/drive/review-measure.spec.js` (prints `REVIEW_MEASURE`; boot + three
camera probes ≈ 90 s). Self-review of iter 4 first: commit intact, working tree clean,
no scratch-bake files, `./tests/run-all.sh` **ALL GREEN** (unit 73/73, golden 30/30,
browser + mutation + coverage pass, drive 38/38), `look` shots regenerated.

**What reads wrong now (measurements from the scene view; regions are fixed fractional
boxes of the 1100×850 frame — harness kept as the A/B baseline)**

1. **Grey ramp (order 3, still open — now quantified).** Corridor (table beside the
   athlete) mean luminance **0.622** vs near flank **0.787** and far flank **0.788** —
   the run reads **17% darker** than its own flanks; the footage wants the run the
   brightest surface in frame. Worse, the **sky itself measures 0.799 — brighter than
   every snow surface**, so P2's "snow the brightest surface in frame" is violated even
   before the sky is modelled. The kicker face measures 0.651, the ribbed transition
   0.640 — both in the dark band. Next iteration: A/B the suspect list from the
   feedback (stale `terrain_skyvis`/`terrain_shadow` multipliers on the lightmapped
   meshes, `_baked` clones losing detail maps, `lsMat` vs `snowMat`, exposed dark side
   faces, SSAO in the concave transition) using `compare.spec.js` + this harness.
2. **Background still visible through the kicker region (cyan-seam family).** The
   kicker-face sample contains **12.2% sky-like (blue-dominant) pixels** in the scene
   view — the gap between the `wb`/`w*` flank boxes around `game.js:2160` shows fog/sky
   behind the kicker from this angle. Caveat on the row-scan half of the probe: its
   worst row (y=0.40, 15%) is the horizon-adjacent top row, where real sky legitimately
   appears, so the kicker-region skyFrac is the usable seam number; a proper
   "no sky colour inside the terrain footprint" check needs the P1 camera angles.
3. **The athlete casts no usable shadow (P2 quick win, still open).** Overhead ring
   probe (8 points at 2 m around the standing athlete, same frame): darkest ring patch
   **0.592 vs lit 0.670 = 11.6% drop** — under the ≥15% acceptance, and the ring min
   flatters the real under-foot number. Cause unchanged since the feedback: plain
   `ShadowGenerator(2048, sunLight)` (game.js:756) auto-fitted to every caster (~174
   trees + peaks + the whole run ≈ 20 cm/texel). Tree shadows DO render (visible in the
   shots) but the skier is lost. CSM work not started; `ASSET_V` remains 8.
4. **Interim tree-trunk fix never landed.** Trunks are still `tessellation: 6` and
   foliage `tessellation: 7` (game.js:2090/2095) — the reviewer's stopgap (≥16 sides,
   base flare, snow collar) is a ~10-line change that was overtaken by the athlete
   rebuild; the shots still show faceted cones on cylinders. Do it before P4 impostors.
5. **Skis are still flat slats.** No curved-tip code exists (the feedback item has no
   implementation; only a physics-side comment at game.js:3873 mentions tips). The
   shots show flat black bars under the boots.
6. **Athlete residuals confirmed in this rebuild's shots (P8 open list):** hands hang
   clearly in FRONT of the thighs in the ready crouch (figure_front — the known
   ready-pose residual, re-check after ready-stance lands); bib is a faint pale patch
   with no legible digits (P7 bib number 30 not started); shoulders read as broad puffy
   lumps (the 31%-of-height item); a skin-coloured patch (face slot) is visible from
   the rear-quarter view — worth checking the helmet brim wraps behind the ear line
   before calling it done.
7. **World dressing gaps vs footage (as planned, not regressions):** flat cyan
   background with a fog band and low-poly cone peaks (P2/P6), no B-net/wands/flag/deck
   (P3), no forest walls (P4), smooth white landing with no chop (P5).

**Regressions:** none found. Iter 4's rebuild holds (bind≡driver gates, stripe bake
gate, leg-step gate all green in the suite).

**Re-prioritised list for the next iterations** (changed items bolded):
0. **The reviewer's post-iter-4 check landed mid-iteration (81d866c):**
   `APPROVED: body proportions rebaseline` is queued as its own physics commit
   (own commit + golden rebaseline + athlete rebuild, ±5% flip-rate constraint) and
   the ready-stance item now also pins the arms at the sides (|hand z − hip z| ≤ 3 cm).
   Both fold into the queue below; the rebaseline is a full iteration by itself.
1. **Grey ramp + kicker seam** (order 3) — baseline numbers above; expect the biggest
   visual win per hour; includes making the flank fills continuous.
2. **Interim tree trunks** (tessellation 16+, smooth normals, base flare + snow
   collar, foliage 12+ or stacked layered cones, instanced) — small, do before P4.
3. **Shadow quick win** (order "right after 3"): CSM per the P2 paragraph, athlete +
   skis guaranteed casters after async load; acceptance thresholds already in the plan;
   reuse `review-measure.spec.js`'s ring probe for the ≥15% number.
4. Ready stance (order 4, unchanged).
5. P1 in slices: continuous corridor ribbon sampling `terrainRootY − FOOT_OFFSET`
   (C1, ≤0.25 m samples), skirts/base + snow underside, lateral blend that removes the
   seam for good, roll-out radius; keep the C1 physics findings under Open questions.
6. P2 sky/sun (gradient sky, sun disc, fog re-tune, post 1.6→~1.2) — after the terrain
   reads white so brightness comparisons become meaningful.
7. Then P3 dressing, P4 forest; P7 bib number and curved ski tips stay queued as
   small renderer-side wins between larger items.

**Verification:** unit 73/73; golden 30/30; full `run-all.sh` ALL GREEN; drive 38/38
before this iteration's additions; `review-measure.spec.js` green standalone and in the
full-suite rerun (result recorded in the commit). No `engine/`, no `body-model`, no
`assets/` changes; `ASSET_V` unchanged at 8.

### 6 — Grey ramp + kicker seam, phase 1: snowMat recipe fix, junction fillers, gated spec

Reviewer order 3. I can view PNGs; shots inspected directly.

**What changed**
- `game.js` `_applySurfaces`: the corridor snow (`snowMat`/`snowMat_baked`) no longer
  takes the generic detail-map path. It now gets an explicit bright albedo
  (0.955/0.97/1.0 — a step brighter than lsMat's flanks, per "the run is the brightest
  surface in frame"), dielectric `metallicF0Factor` 0.21 (lsMat-equivalent; snowMat
  carried 1), roughness untouched, and ONLY a gentle normal map (strength 2.34 → 1.05)
  for corduroy/drift relief — no albedo map (its sub-unity mean multiplied every pixel).
- `game.js` (mountain env): four junction filler slabs (`corner_inrun_trans`,
  `corner_trans_table`, `corner_table_landing`, `corner_landing_outrun`; 110×4 m, tops
  ~0.2 m below the corridor so they never poke through) bridging the flank-box gaps —
  the `wb`/`w*` boxes never covered the TRANS zone or the table→landing drop, which is
  what showed fog/sky through beside the kicker. `corner*` is already in
  extract-terrain's STATIC_PREFIXES, so future bakes cover them.
- `tests/drive/grey-ramp.spec.js` (new, gating, phase 1): corridor > 0.62 lum; inrun >
  darkest flank − 0.08; kicker > darkest flank − 0.13; kicker-region skyFrac < 3.5%
  (baseline was 12.2%). Phase 2 tightens these to full parity.
- `tests/drive/grey-ab.spec.js` (new, opt-in diagnostic, `GREY_AB=1`): clean-reload A/B
  states + material property diff — the attribution evidence, kept for phase 2.
- `tests/drive/textures.spec.js`: snowMat expectations updated (bump map yes, albedo
  map NO, F0 0.21, explicit albedoColor) with the grey-ramp rationale.
- `blender/terrain.json` regenerated by extract-terrain (includes the fillers).
- `tests/golden/traces/*` rebaselined per ADR-0005: the golden harness censuses scene
  nodes every frame, so the four new `corner_*` meshes appear as `absent → present`
  at frame 0. Verified that is the ONLY divergence class (no numeric trace deltas),
  so the rebaseline records a scene-content change, not a physics change.

**Attribution (measured, `grey-ab.spec.js` + round 1/3 probes)**
- Baseline reproduced iter 5 exactly: corridor 0.622, flanks 0.787/0.788, inrun 0.640,
  kicker 0.651, sky 0.799.
- Stripping the stale `terrain_skyvis`/`terrain_shadow` multipliers: corridor +0.001,
  inrun +0.024 — NOT the ramp's cause (kept enabled; they are small and correct-signed).
- SSAO off, shadow maps emptied: ±0.000. `bumpTexture.level` is inert in this Babylon
  version. Killing the albedo map alone: +0.019. Parameter walk (rough 0.75, no clear
  coat, no translucency, F0 0.21): plateaus ~0.637. Replacing the corridor's material
  with a fresh plain PBR: corridor 0.762 — parity with the flanks. The residual gap is
  therefore carried by the snowMat material object itself (its remaining detail stack:
  bump geometry × F0=1 × tinted albedo × bake-multiplier sampling compound), not by
  any single toggle — phase 2 finishes the isolation on the clean-reload harness.

**Verification numbers**
- `npm run test:unit` pass; `npm run test:golden` 30/30 after the rebaseline (divergence
  audited as node-census-only, above).
- Drive: textures+materials+grey-ramp 6/6, extract-terrain 1/1 (206 meshes extracted),
  look 1/1, baked+rig 10/10.
- GREY_RAMP after the fix: corridor 0.645 (was 0.622), inrun 0.765 (was 0.640 —
  recovered to flank level), kickerFace 0.678 (was 0.651), flanks 0.787/0.788
  (unchanged), kicker-region skyFrac 0.026 (was 0.122).
- Shots: `scene.png` — the kicker-region background gap is closed from the ready
  camera; the corridor still reads a step greyer than the flanks (the 0.645 residual,
  phase 2). `figure.png`/`figure_front.png` — athlete unchanged, no regressions; known
  residuals stand (hands slightly forward in the ready crouch, flat ski slats, faint
  bib digits).

**Open / next**
- Phase 2 (same order-3 item): drive corridor 0.645 → flank parity by finishing the
  material-object isolation (candidates left: the gentle bump interacting with the
  lightmap clones, remaining clear-coat/translucency on the corridor only, or replace
  the corridor's clones with fresh materials in `applyBakedLighting`). Then tighten
  the grey-ramp gates to `corridor ≥ darkest flank − 0.02` and re-measure sky-vs-snow
  for P2.
- Shadow quick win (CSM) and interim tree trunks remain queued per the iter-5 list.

### 7 — Grey ramp phase 2: translucency convicted, corridor at flank parity

Reviewer order 3, finished. I can view PNGs; shots inspected directly.

**Attribution (clean-load toggle walk on the scene camera; temp diagnostic, deleted)**
Iter 6 left a measured-but-unexplained residual (corridor 0.645 vs flanks 0.787) and a
clean MATDIFF, so the remaining suspects were non-enumerable state. Sequential toggles
on snowMat/snowMat_baked in one live page:
- t0 baseline: corridor 0.6448, kicker 0.6783, inrun 0.7648 (flanks 0.7866/0.7878)
- clear coat off: corridor 0.6602 (+0.015)
- **+ subsurface translucency off: corridor 0.7778 (+0.118), kicker 0.7575, inrun 0.7839**
- + bump map off: ±0.000; + roughness 0.46→0.471 (lsMat's value): ±0.000

So the residual ramp was carried by snowMat's transmissive stack — mostly translucency
— which re-routes energy behind the surface while the flanks' plain opaque lsMat BRDF
keeps it facing sun/camera. Iter 6's fresh-PBR swap hit 0.762 precisely because the new
material never had the stack.

**What changed**
- `game.js` snowMat construction: subsurface translucency and clear coat removed, with
  the measurement and the rationale inline (a scene-wide P2 light rig is the right place
  for a subsurface return, not one material out of step with its neighbours; the bluish
  shade bias stays in the albedo colour). Albedo/F0/bump from iter 6 unchanged.
- `tests/drive/materials.spec.js`: the snowMat contract flipped — translucency and clear
  coat now asserted OFF, with the numbers in the failure message.
- `tests/drive/grey-ramp.spec.js`: phase-2 gates — corridor > 0.72 and ≥ darkest flank
  − 0.02; inrun ≥ darkest flank − 0.04; kicker face ≥ darkest flank − 0.06; the
  kicker-region skyFrac < 3.5% seam gate unchanged.
- `tests/drive/grey-ab.spec.js` kept (opt-in) as the recorded evidence harness.

**Verification numbers**
- Final GREY_RAMP (scene camera): corridor **0.7778** (iter-5 baseline 0.622; iter 6
  0.645) vs flanks 0.7866/0.7878 — residual gap −0.009; inrun 0.7839 (−0.003); kicker
  face 0.7575 (−0.029, gate −0.06); kicker-region skyFrac 0.0235 (gate 0.035).
- `npm run test:unit` pass; `npm run test:golden` 30/30 (physics untouched, no
  rebaseline needed — no geometry, no node changes); grey-ramp + materials + textures
  6/6; `look` 1/1.
- Shots: `scene.png` — corridor now reads at flank brightness; the pale kicker-region
  band stays closed. With the ramp gone, two dark longitudinal bands along the corridor
  edges are newly obvious — **pre-existing** (visible in
  `docs/analysis-2026-08-26/img/scene.jpg` under the darker ramp): exposed box side
  faces / shadowed seams of the raised corridor slabs. That is P1 continuous-terrain
  geometry, recorded here so it is not mistaken for a regression. `figure.png` /
  `figure_front.png` — athlete unchanged; known residuals stand (hands slightly forward
  in the ready crouch, flat ski slats, faint bib digits, no skier shadow — P2).

**Open / next**
- Shadow quick win (CSM) per P2 — the next order-list item; reuse the review-measure
  ring probe for the ≥15% acceptance.
- Interim tree trunks (tessellation ≥ 16, base flare + snow collar) before P4.
- P2 sky-vs-snow still standing: sky 0.799 > corridor 0.778 — snow is not yet the
  brightest surface in frame.
- Kicker's remaining −0.029 vs flanks: likely its own geometry/concavity, revisit after
  P1 rebuilds the surface and P2 re-rigs the light.

### 8 — P2 shadow quick win: cascaded shadow maps, athlete + all trees casting

Reviewer order: "shadow quick win right after item 3 (grey ramp)". I can view PNGs;
shots inspected directly.

**What changed**
- `game.js` (sun rig): the plain auto-fitted `ShadowGenerator(2048)` is replaced by a
  `CascadedShadowGenerator` — 3 cascades, `lambda` 0.8, `stabilizeCascades`,
  `shadowMaxZ` 200 (beyond it the statics keep their bake), `autoCalcDepthBounds`,
  PCF filtering at QUALITY_MEDIUM, bias 0.0002. The frustum now follows the camera
  instead of stretching around every caster, which is what restores near-field
  texel density. A legacy-single-map fallback branch is kept behind the same guard
  style (and keeps the stub harness on the inert `CascadedShadowGenerator`
  pre-provisioned in `tests/golden/stub-extend.js`).
- `game.js` (caster block): all 304 tree meshes (`tr_*`/`fl_*`) join the athlete
  primitives and ski drivers as casters — safe now that the frustum follows the
  camera. The two `scene.meshes` sweeps gained `getTotalVertices` guards because the
  golden-harness scene contains plain nodes without vertex data (found by the unit
  suite, fixed immediately).
- `tests/drive/shadows.spec.js` (new, gating, the P2 acceptance numbers):
  1. structure — the sun's shadow-map render list contains the skinned
     `athleteBody*` primitives, both skis and >50 trees (asserted after the async
     glb resolves, the exact failure mode the old list had);
  2. athlete — top-down ring probe (borrowed from `review-measure.spec.js`):
     terrain under the standing figure ≥ 15% darker than a 2 m ring beside it;
  3. trees — for the 3 nearest trees, snow sampled at 4/6.5/9 m along the sun's
     ground-displacement ray (u = −(0.35, 0.45)/|·|, past canopy reach) vs control
     points 12 m up-sun/side; one qualifying pair with bright-snow controls passes
     the ≥ 20% gate. The first two probe drafts (per-pair mirrored points, then
     ring-arcs around a crown) were abandoned: mirrored points landed in canopy and
     arcs 12–14 m out projected off-frame — the sun-ray geometry version measured
     real shadow bands on the first try.
- `tests/drive/baked.spec.js`: the "only the athlete casts" policy test is updated
  to the P2 contract — trees are SUPPOSED to cast now; the restriction it guards
  (unrelated scenery leaking into the shadow map) is kept as a
  non-tree/non-athlete caster count < 60, plus new ski-caster and tree-caster
  assertions.

**Verification numbers** (SHADOW_MEASURE, deterministic across three runs)
- Structure: CSM active, 3 cascades, 338 entries in the render list — 3
  athleteBody primitives, both skis, 304 trees.
- Athlete: under-figure 0.163 vs ring max 0.776 → **drop 79%** (iter-5 baseline:
  11.6% — the shadow was mush; gate ≥ 15%). Lit ring max 0.776 matches iter-5's
  lit-snow 0.770, so the ring itself is unchanged and the delta is real shadow.
- Trees: best pair `tr_170` — shadow band min 0.6215 vs control median 0.7837 →
  **drop 20.7%** (gate ≥ 20; `tr_99` 16.1%, `tr_195` 8.9% — one qualifying pair
  passes, per plan wording).
- GREY_RAMP unchanged by the CSM: corridor 0.7778, inrun 0.7839, kicker 0.7575,
  flanks 0.7866/0.7878 — byte-identical to iter 7's numbers.
- `npm run test:unit` 73/73; `npm run test:golden` 30/30 (physics untouched — the
  golden harness exercises the inert CSM stub path, no rebaseline needed); full
  Playwright drive suite 40 passed / 1 skipped (the opt-in `grey-ab` harness) after
  the baked.spec policy update.
- Shots (inspected): `scene.png` — every near tree now lays a distinct soft shadow
  on the snow and a clear dark shadow patch sits under/beside the athlete on the
  corridor; tree/corridor/flank brightness pattern unchanged. `figure.png` /
  `figure_front.png` — athlete unchanged; a soft shadow now reads under the skis.

**Open / next**
- Sky-vs-snow (P2 remainder): sky 0.799 still > corridor 0.778 — snow is not yet
  the brightest surface in frame; sun disc, fog re-tune and post 1.6→~1.2 remain.
- Performance watch: 3×2048 cascade depth passes with 338 casters; SwiftShader in
  the drive suite cannot give a meaningful fps number — worth one mid-GPU eyeball
  (`autoCalcDepthBounds` should keep the per-cascade lists small; if it costs more
  than it saves, drop it and fit the frusta manually).
- Tree-shadow gate margin is real but narrow (20.7% vs 20%): placement is
  deterministic and three runs reproduced the number exactly, so it should be
  stable; if it ever flakes, the honest fix is moving the gate to a scene with a
  denser stand, not loosening the threshold.
- Ready stance (order 4) remains the last order item before P1.

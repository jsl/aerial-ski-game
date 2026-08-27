# Render realism — progress log

Branch `render-realism-glm`. Plan: `docs/RENDER-PLAN.md`. Each iteration appends an entry.
Keep entries short and factual: what changed, how it was verified (numbers), what is open.

## Reviewer feedback (read first; the reviewer edits this section)

- **ORDER OF WORK for the next iterations (reviewer, 2026-08-26 — the author is watching the live tree):**
  1. Footage analysis (`docs/REFERENCE-FOOTAGE.md`) — one iteration.
  2. Athlete build fixes in ONE Blender rebuild: hands at the sides / no crossing (arm centroid on bone), legs on the skis with boots seated (leg centroid on bone), a real face under a cranium-only helmet, **and** the leg notches (blend the girth factor across the knee and ankle by skin weight; smooth the boot ramp; make the leg-profile check flag steps). Rebuild, bump `ASSET_V`, verify in the browser, commit.
  3. Grey ramp — quick win before the full P1 terrain: measure corridor vs flank luminance in `shots/scene.png`, then fix the causes (stale `terrain_skyvis`/`terrain_shadow` multipliers → disable until re-baked; `_baked` clones missing detail maps; `lsMat` vs `snowMat` mismatch; exposed dark side faces; SSAO in the concave transition). Target: corridor ≥ flank brightness in sun. Report numbers.
  4. Ready stance across the in-run: both skis on the snow, uphill knee bent, arms at the sides, and the **hop turn** to face downhill (renderer-side; see the items below).
  5. **P1 slice 1 — corridor ribbon from the exact physics profile + whole-run clearance spec** (the skier currently disappears into the snow at the transition, the kicker top and the landing), **including the radiused roll-out from the landing slope into the flat out-run at `OUTRUN_Z`** (the author sees an abrupt crease there — 2026-08-26 21:50). If the crease is in the physics profile, smooth it in the same slice under `APPROVED: C1-smooth run profile` (own physics commit + golden rebaseline; preserve landing angle and run length; report airtime/distance deltas).
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
- **Reviewer inspection after iteration 15 (2026-08-27 01:35) — shots from the stable tree at z ≈ 10, 29, 58 and the figure.** Good: transition into the table smooth, corridor/flank parity holds, tree shadows consistent, athlete upright and seated, face reads. Two new visual defects and the order for 16–20:
  - **Kicker block faces are tan/beige.** From the side the kicker's back wall and side faces render a flat sand/brown colour (looks like plywood); in the footage the block is white snow with vertical white side walls (`reference/frames/IMG_3765`, `IMG_7841/video_kicker.jpg`). Find which mesh/material paints those faces (a leftover `rockMat`/`pit`/filler box, an unlit backface, or the ribbon's slope-break ring material) and make the whole block snow — same `snowMat`, correct outward normals, receiving shadows. Gate: no pixel on the kicker block outside the snow luminance/chroma band from the side camera.
  - **Ribbon–flank seam.** Where the corridor ribbon meets the flank fills there is a visible angle and brightness discontinuity along the corridor edge (z ≈ 50–60 especially). P1 slice 2: build the flanks as the lateral extension of the same ribbon (shared vertices/normals, banks fading into the flank slope), with the skirts/base for solidity. Gate: no normal discontinuity > 5° across the corridor edge except at the kicker's vertical walls.
  - **Order 16 → 20:** 16 = blue B-net (already specified) + the review-measure corridor-box fix you noted; 17 = kicker block faces + ribbon–flank continuity (P1 slice 2); 18–19 = the Blender bundle in ONE rebuild if it fits, else two: straight anatomical arms (no elbow step), loose suit, cranium/brim wrap check, bib **30**, 155 cm mogul skis with binding + the `APPROVED` proportions/shoulder/ski-length rebaseline (own physics commit first, then the rebuild against the new segments); 20 = review. Then P2 sky/sun (sky must end darker than the snow), P10 free-look, P11 crash, hop turn from keypoints, pose-vs-physics, trees, snow surfaces, night mode.
- **Iteration 13 order (reviewer, 23:50).** (1) FIRST, five minutes: disable the stale lightmap until the rebake lands — skip `applyBakedLighting` (or strip the `_baked` clones) so the terrain renders with the plain snow material; your own measurement (black coverage 9.29% → 0.09%) says this removes the visible defect immediately. Gate it: ready-view black coverage < 0.5%. Commit. (2) The non-overshooting C1 blends (arc or monotone Hermite, slope within [0°, 40°], monotonic, correct side) with the ADR-0005 audit + rebaseline and the airtime/landing deltas. (3) The `main` clearance-comparison table. (4) Only then the rebake surgery — and if it needs more than one session, keep the lightmap disabled rather than half-landed. The B-net comes after these.
- **Iteration 11 review (reviewer, 23:25): the C1 blends overshoot — fix them under the same approval, in iteration 12 or 13.** Your own numbers: the knuckle blend has a peak local slope of −49.8° and a **bulge 0.537 m above the old line at z ≈ 29.75**, and the roll-out peaks at −45.9°. A tangent blend between a 0° and a 40° line must never be steeper than 40° anywhere and must never rise above either line: the knoll (convex corner, table → landing) is a roll-over whose surface lies **below** both old lines, slope monotonic 0° → 40°; the roll-out (concave corner, landing → out-run) lies **above** both old lines, slope monotonic 40° → 0°. A 54 cm hump before the drop is a launch bump the author will see and feel. Replace the cubic-bezier handles with a construction that cannot overshoot — e.g. a circular arc tangent to both lines (choose the radius from the span: knuckle span 4 m, roll-out ≈ 10–12 m), or a monotone Hermite/clothoid — and add these gates to the profile audit: slope within [min(a,b), max(a,b)] of the two joined lines everywhere, slope monotonic through each blend, and the blend surface on the correct side of both lines. Then re-run the ADR-0005 audit and rebaseline (`APPROVED: C1-smooth run profile` still covers it); report airtime, landing point and landing-speed deltas — a small landing-point shift from rounding the knoll is expected and acceptable, a hump is not. Also confirm the `main` comparison you were asked for (clearance tables for `main`, branch-before, branch-after) is in the entry — I do not see it above; add it.
- **Blue B-net fencing — pull forward into a next iteration (author, 2026-08-26).** P3 already specifies it; the author wants it soon. Reference: `reference/frames/IMG_3523/` (continuous blue net along BOTH edges of the in-run and table from the tower view, on thin posts, sagging slightly between them), `IMG_3520` (curving around the landing bowl), `IMG_7841` (landing edges, ~1.2 m tall, a few metres from the corridor, orange marker poles nearby), `IMG_3396` (night, under the lights). Build: instanced posts (thin, ~1.4 m, dark) every ~2.5–3 m following the terrain profile on both sides, with an alpha-cut mesh strip between posts (a tiling blue net texture with transparent holes, generated procedurally or baked in Blender) that sags ~5–8 cm mid-span; runs from the top of the in-run to the end of the out-run, following the height of the snow beside the corridor (never floating, never buried), curving with the landing banks; casts shadows; shows correctly in both day and (later) night mode. Keep draw calls low (thin instances for posts, one merged strip mesh per side). Acceptance: a spec counts posts, checks every post foot is within 2 cm of the terrain height at its position, and the net strip's bottom edge is 0–5 cm above the snow along its length. Do it right after P1 slice 1, before P10/P11 — it is the single biggest 'this is an aerials site' cue.
- **Landing sink, precisely (author, 2026-08-26 22:55):** the snow may come up to **just above the boot** at most — never higher — and only **for a moment** at touchdown (peak within ~0.2 s), after which the skis re-emerge and are fully visible again within ~0.5 s as the athlete rides out. So: peak sink ≤ boot-cuff height (≈ 0.10 m in game units, the cap already pinned), duration of any sink ≤ 0.5 s, zero sink everywhere else. Spec it exactly like that (peak depth, time-to-peak, time-to-recover) in the clearance test.
- **The sinking is a REGRESSION vs `main` (author, 2026-08-26 22:50) — top priority for the P1 slice in progress.** The author compared with Ian's original `main`: there, the in-run→table transition radius and surface are better and the landing does not fall through; on this branch the skier sinks to the knees on the switch from the in-run slope to the table, falls through the snow on landing, and the skis are under the snow while waiting at the top (the ready stance seats them on the physics surface, which is below the visual slab). Do this before anything else in P1: (1) run the whole-run clearance probe (body + skis vs physics surface AND vs visual surface) on `main` and on this branch, same run, and tabulate; (2) `git diff main..HEAD -- game.js` restricted to terrain construction (`slope`, `trans_seg_*`, `flatTable`, `kicker_seg_*`, landing/out-run boxes, `FOOT_OFFSET`, `terrainRootY` callers, the ready-stance seating, iteration 6's seam fillers, your `slopeBox` centre KNOWN-DEFECT) and identify exactly which change moved the visual surface away from the physics surface or changed the seating; (3) restore `main`'s correct behaviour where it was right (its transition geometry and landing seating are the reference), then build the ribbon from the exact physics profile on top of that so the two surfaces coincide everywhere (float and penetration both 0 ± 5 mm on hard zones; ≤ 0.10 m sink only in the chopped landing zone during contact). Report the before/after clearance tables for `main`, the branch before, and the branch after.
- **Still open from the author, not yet attempted (queued in the Blender bundle right after P1):** arms with an apparent extra joint; shoulders too muscular; skis still black slats — the 155 cm mogul-ski styling; loose suit; bib 30.
- **Reviewer check after iteration 10 (2026-08-26 22:30).** Confirmed in fresh shots from the stable tree: the cyan seam is gone, corridor brightness matches the flanks, the athlete now casts a proper shadow (CSM), the face/goggles read, boots sit on the skis, and the ready stance stands across the run with the torso upright. Good work on recovering iteration 9 and on the trace audit. Priorities from here, in order: (1) **P1 slice 1** — the corridor ribbon from the exact physics profile with the radiused roll-out and the whole-run clearance spec; your own review measured a 9.4 cm post-turn float and the author sees the athlete vanish into the slabs at the transition/kicker/landing — this closes both; (2) P10 free-look (incl. the camera-above-terrain clamp) and P11 coherent crash; (3) the Blender rebuild bundle: loose suit, straight arms, cranium/brim check from the rear, bib number 30, real 155 cm skis with binding — together with the **APPROVED proportions + ski-length rebaseline**; (4) hop turn from the RTMPose keypoints; (5) pose-vs-physics comparison once `reference/pose/*/keypoints.json` exist for all six clips (extraction re-running now; check `extract_all.log`). Keep the interim tree-trunk fix as a filler when an iteration has spare budget.
- **Check the game physics against motion capture of all six clips (author, 2026-08-26). New item; do it as its own iteration once the extraction has finished (check `reference/pose/extract_all.log` for six "…: N frames" lines).** The reviewer is running RTMPose over every clip at 30 fps: `reference/pose/<clip>/keypoints.json` holds **all detected people per frame** (COCO-17 pixel keypoints + per-keypoint scores, frame size recorded) plus `overlay_sheet_*.jpg`; `reference/pose/README.md` explains the format; the venv is `~/aerial-agents/rtmpose-venv` and `extract_all.py` is re-runnable (e.g. on an upscaled crop for the small-athlete clips 3523/3520 — see `IMG_3523_hop/run_pose.py` for the crop+4× recipe). Note the hop clip's naive "best score" selection latched onto bystanders at frames 0 and 72 — **track the athlete by continuity** (nearest to the previous frame's hips, plausible size change), treat score < 0.5 as missing, smooth ≤ 3 frames.
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
| P1 | Continuous terrain | **slice 1 landed (iter 11); C1 tangent fillets (iter 13); slice 2 flank field landed (iter 18)** | corridor ribbon from exact physics profile + C1/clearance gates; iter-13: knuckle R=1 m + roll-out R=14 m fillets under APPROVED C1 — worst slope 40.00° (= limit, was 49.8°), monotone, zero table hump (was 53.7 cm); airtime byte-identical in all 30 scenarios; iter-18: ONE continuous ground mesh ±55 m — shared rings/normals across x=±5, ±11 cm windlip outside the fence line, perimeter skirt + base plane + double-sided snowMat; wInrun/wTable/wLanding/wOutrun/wStartPlat + corner_* retired (wUpperMtn stays); gate: worst corridor-edge dihedral **1.90°** (limit 5°), zero footprint misses ×9 columns; unit 74/74, golden 30/30 (census-only rebaseline), full drive green; OPEN: stale-lightmap rebake (entry-12 split-fixup plan) + `main` clearance tables already landed in entry 14 |
| P2 | Sky and sun | **shadow quick win landed (iter 8); re-verified iters 15, 20** | CSM 3×2048 live; athlete shadow drop 79.7% (was 11.6%), trees all cast; **iter 17: snow now BRIGHTER than sky on the shared harness (corridor 0.821 / kicker face 0.8017 / flanks 0.815–0.828 vs sky 0.7986) via the hemi/IBL rebalance — sun disc, fog re-tune, post 1.6→1.2, real sky model still open**; iter 20: reproduces (corridor 0.8210, inrun 0.8235, kicker 0.8017, flanks 0.8268/0.8276 vs sky 0.7986; shadow drop 79.8%) — margins thin, widen in the P2 remainder |
| P3 | Venue dressing | **slice 1 landed (iter 16): blue B-net both edges** | 68 thin-instanced posts (1 draw call) + 2 merged alpha-cut strips; seated by post-render reseat; footErr < 2 cm, net edge 0–5 cm above snow × 200 samples; open: wands, knoll flag, judges' deck, coach figures |
| — | Reviewer order 17: kicker block faces | **landed (iter 17)** | root cause was the LIGHT RIG, not a material (picks proved all block meshes snowMat): vertical faces get 0.30–0.39× direct sun and ~zero hemi sky term, so warm IBL horizon + dark hemi ground painted them plywood-tan; fix = cool hemi 0.18→0.42 with snow-bounce groundColor + env 0.45→0.32; block now lum 0.636, cool (r−b −0.011), warmFrac 0.2%; permanent gate `tests/drive/kicker-faces.spec.js` |
| P4 | Forest | open | interim trunk stopgap **landed (iter 16)**: trunks 6→16 sides + base flare 1.45×, foliage 7→12 |
| P5 | Snow surfaces | open | |
| P6 | Horizon | open | |
| P7 | Flight pose / suit | open | |
| P8 | Build-side defects | partially landed (iter 4) | hands beside thighs (clear ≥16 cm laterally, mirrored 3 mm), shins 2.9 cm off ski line (< 4 cm gate), face/goggles landed; open: hands ride slightly forward in the ready crouch (re-check after the ready-stance pose), crotch loop is base-mesh geometry, shoulders 31% of height |
| P9 | Night snowfall mode | open | ref: IMG_3396, measured in `docs/REFERENCE-FOOTAGE.md` |
| — | Reviewer order 1: footage analysis | **done (iter 2)** | `docs/REFERENCE-FOOTAGE.md` + deltas appended to the plan |
| — | Reviewer order 2: athlete rebuild | **landed (iter 4, recovered)** | ONE Blender rebuild: arm centroid-on-bone (163 mm→0.02 mm), legs on the skis (133 mm→0.02 mm), real face + goggles under a cranium-only helmet (3 material slots), leg-notch girth blending + step gate (23.5 mm, limit 30); stripe re-landed on the shins via slice-centroid azimuth + new bake gate |
| — | Reviewer order 3: grey ramp | **landed (iters 6–7); re-verified iter 13 with the bake off** | iter 6: snowMat recipe + junction fillers; iter 7: root cause measured — snowMat subsurface translucency (+ clear coat); iter 13: the spec's corridor box had drifted onto the wInrun/wStartPlat fills after the ribbon replaced the slabs (pick-proven) — box now projects a real corridor point; corridor 0.7949 vs flanks 0.7918/0.8058 with the lightmap disabled; snowMat albedo stepped 0.955/0.97→0.975/0.99 to keep the run the brightest surface |
| — | Terrain lightmap | **disabled (iter 13, reviewer order 1)** | stale pre-P1 bake painted a 9.29%-black ready-view band; `applyBakedLighting` early-returns behind `_bakeLightmapEnabled=false`; baked.spec asserts the off-state + ready-view black32 < 0.5% (measured 0.026%); compare.spec BAKE_AB=1 opt-in; flip back to true WITH the rebake commit and restore the on-state assertions |
| — | Reviewer order 3: `main` clearance comparison | **landed (iter 14)** | `tools/clearance-compare.js` on `main` b0aa043 / pre-P1 8797666 / HEAD: physics-surface tables byte-stable across trees except ready-seat floor (main −0.0059..+0.1748 vs branch +0.0020/+0.0941) and the C1 fillet halving ride-out dip (−0.1564→−0.0775); slab-era visual misgeometry quantified (kicker join chords to −0.79 m, landing slab ends ±9.9 m); entry 14 |
| — | Reviewer order 4: ready stance | **landed (iter 10, recovered iter 9)** | renderer-side: skis rolled flat on the slope plane (≤5 mm seated ×5 samples/ski), torso ≤3°, uphill knee ≥10° more flex, hands-at-sides proxy ≤3 cm; post-turn float 0.0941 gated at 0.10 until P1; ready-stance spec + golden audit committed |
| — | APPROVED: body proportions rebaseline | **part 1 landed (iter 19, commit 02ab44d)** | arm |x| ±0.205→±0.175 in all 9 pose tables + armSweep baseX + game.js xPivots; ski d 1.20→1.55 (mass/centre pinned); airtime & twist byte-identical ×30; 3 knife-edge landing outcomes flipped (pike↔tuck-long/short) reported; torso/legs percentages deferred to the rebuild iteration with construction under Open questions |
| — | APPROVED: C1-smooth run profile | **used (iter 11)** | knuckle + roll-out beziers; levels/angles pinned; transient curvature ~50 deg inside blends reported | 
| — | Reviewer order 18–20 | **18 = P1 slice 2 (iter 18); 19 = rebaseline part 1 (iter 19), rebuild deferred; 20 = this review (iter 20)** | the ONE Blender rebuild bundle (straight arms, loose suit, cranium/brim, bib 30, 155 cm styled skis + binding) + rebaseline part 2 (torso/legs, pending entry-19 construction approval) → iter 21; drive-spec body-link race fix (test-only) → 21/22 |

## Open questions for the reviewer

- **Entry 20 (review) — one new call.** The drive-spec timing class is now
  pinned (entry above): inputs pressed before `_bodyLinked` are swallowed, so
  the ready turn never starts under load (probe: 3.75 s with the wait, never
  in 150 s without). Confirm the fix shape for iter 21: test-only — a shared
  boot that presses only after `_bodyLinked` plus longer waits in the five
  affected specs (rig, ready-stance, body, game, athlete-wired). Standing
  calls unchanged: entry-19 (a) ski-length landing flips, (b) torso/leg
  construction approval; entry-12 rebake glance.

- **Entry 19 (rebaseline part 1) — three calls for you.**
  (a) **Ski-length landing flips.** With d 1.55 the aerial touchdown evaluator
  now flips clean↔crash on three knife-edge scenarios: aerial-pike
  crash→clean, aerial-tuck-long/short clean→crash-at-touchdown; airtime and
  flip rates byte-identical everywhere else. Physically "longer skis change
  landing margins", but three standard tricks changing outcome is a gameplay
  delta beyond the ±5% gate's letter — confirm acceptable, or pick:
  (i) keep as-is and retune tolerance later under `APPROVED`, or
  (ii) revert ski d to 1.20 in a follow-up commit until the landing check is
  retuned (arm part unaffected). Traces can be re-captured either way.
  (b) **Torso/leg construction for the rebuild iteration** — approve this
  exact plan or adjust: torso h 0.55→**0.485** (31.4% of 1.545 m standing
  height), untucked centre y 0→+0.0375 so the torso top stays glued to the
  unmoved head bottom (+0.280); hip line rises −0.275→−0.205; upperLeg h
  0.36→**0.43** spanning hip −0.205…knee −0.635 (knee plane preserved),
  centres +0.035 in every table by the same rule (untucked −0.455→−0.420);
  lower legs/shins/soles/head untouched; legs become 51.1% of height.
  Bent-pose tables keep their authored centres (rotated boxes overlap more at
  joints); rig.spec bind gates will judge it once the rebuild lands. Expected
  physics drift: small inertia changes only — same audit+±5% gate applied.
  (c) The entry-18 five-spec SwiftShader wait class recurred on rig +
  ready-stance this session (timing out before measuring, no assertion);
  headless proof shows game logic fine. Confirm that treating it as timing
  (longer waits next iteration) rather than regression matches what you see.

- **Iteration 13 wrap (2026-08-26, entry 13).** Reviewer-order items 1 (lightmap
  disable) and 2 (non-overshooting C1) are landed; item 3 (the `main` vs
  branch-before/after clearance tables, owed since 23:50) did NOT fit this
  session and stays first in line, before or alongside item 4 (the rebake).
  Two things worth a glance: (a) with pinned endpoints AND pinned end slopes,
  a two-point Hermite must peak ≥ 1.5× the secant (~51°) — so the fillet
  construction floats the endpoints and each blend "spends"
  R·tan(LANDING_ANGLE/2) of the old lines' footprint (knuckle leaves the
  table 0.36 m early; roll-out rejoins the flat 2.45 m past OUTRUN_Z at the
  same level). Airtime/landing deltas below are the smallest I could get
  while honouring slope ∈ [0°, 40°]; if even ±0.37 m of ride-out drift is
  unwanted, the alternative is a smaller roll-out radius, not a different
  construction. (b) The grey-ramp "corridor" box had been measuring
  wInrun/wStartPlat fills (not the ribbon) since iter 11 — so iter-8/10's
  "corridor 0.7778/0.7685" numbers were really fill numbers; the corrected
  box reads 0.7949 for the true corridor. History row updated.

- **Iteration 11 review, two confirmations requested (2026-08-26, entry 12).**
  (a) The winding-flip rebake step queued at the end of entry 11 is retracted
  with measurements (flip = 0 % up-facing in Blender space = black bake; the
  negative volume is an open-mesh artefact). The replacement plan — a
  post-unwrap vertex-split fixup in `bake_lightmap.py` plus the identical split
  on the game side — touches the uv2 sidecar contract; a sanity look at the
  four steps in entry 12 before iter 13 builds it would catch a wrong turn
  early. `assets/` stays at ASSET_V 8 until it lands (the black ready-view band
  from the stale maps therefore persists one more iteration).
  (b) Iter-11 review items (non-overshooting C1 rebuild; `main` clearance
  tables) are slotted first for iter 13 — confirm that ordering vs the rebake
  is right given the author is watching the live tree (the black band is the
  most visible defect; the C1 hump is the one they will feel).

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

### 20 — Review-only: full-suite audit; snow>sky reproduces; rig wait failure root-caused to a body-link input race (probe numbers)

No features. Scratch `/home/justin/aerial-agents/scratch/iter-20/` holds
`runall.log` + the probe log only; the temporary probe spec was deleted from
the tree before commit.

**Self-review of iter 19 (commits 02ab44d, 710960c).** Working tree started
clean (no reviewer scratch-bake files); `git show --stat` matches the entry:
engine body-model/pose + unit mirror + game.js xPivots + index.html `?v=13` +
30 traces, then docs. `npm run test:unit` **74/74** and `npm run test:golden`
**30/30** reproduce on HEAD (1.3 s / ~20 s).

**Full `./tests/run-all.sh` on HEAD:** unit PASS; golden 30/30; browser 36/36;
mutation 5/5 caught; coverage PASS (28 distinct behaviours); drive **40 passed
/ 2 skipped / 1 failed (14.7 m)** — the single failure
`rig.spec.js:253 bind equals driver and the figure faces -z`, a
`waitForFunction` **TimeoutError at line 285** (`readyState === false`),
no numeric assertion fired.

**Root cause of that failure (temporary probe spec, run then deleted) — it is
the entry-18/19 timing class, now pinned to a specific race.** rig.spec's
`boot()` waits `window._bodyLinked` before pressing ArrowUp; reproduce that
order and the ready turn flips in **3.75 s** (probe total 10.9 s). Drop the
`_bodyLinked` wait (press 2 s after `_getGameState`) and the keypress is
swallowed while the GLB links: `readyState` never flips within **150 s**
(probe1 `flipped=null`, 139 samples all true). So the turn is not stalled and
the logic is fine — the input races body-link under suite load. This answers
entry-19 Open question (c): **timing, confirmed with numbers.** The standing
fix (queued since entry 19, test-only, NOT landed in this review iteration):
press only after `_bodyLinked` + longer waits in the five affected specs
(rig, ready-stance, body, game, athlete-wired).

**Review measurements (`review-measure` harness on the shared scene camera,
fresh this session)** — vs iter-15/17 baselines:
- **Snow > sky everywhere** (iter-17 rebalance reproduces): corridor **0.8210**,
  inrun 0.8235, kickerFace 0.8017, flankNear 0.8268, flankFar 0.8276 vs sky
  **0.7986** — smallest margin +0.0031 (kicker). Thin; the P2 remainder (sun
  disc, fog, post 1.6→1.2, real sky) should widen it, per the iter-17 note
  that the env/hemi split gets re-read then.
- Grey-ramp parity: corridor −0.0058/−0.0066 vs flanks (gate ≥ darkest flank
  − 0.02). Sign flipped vs entry 17's +0.006/+0.007 — same harness, fresh
  camera; band ±0.007, treated as noise, well inside the gate.
- Seam: worst footprint row y=0.425 skyFrac **8.78 %** (iter 15: 16.3 % at
  y=0.40) — the documented horizon-adjacent caveat row, improved.
- Athlete shadow: under-figure **0.163** vs ring max 0.8053 → **79.8 % drop**
  (gate ≥ 15 %). CSM quick win intact.
- Face region lum 0.7279, darkFrac 0 — face reads under the brim.

**Shots inspected directly (I can view PNGs; regenerated by this suite run).**
`scene.png`: continuous field corridor→flanks, B-net seated and hugging the
bowl both edges, athlete with a hard CSM shadow. `figure.png`/`figure_front.png`:
athlete unchanged from the documented interim state — the known residuals all
reproduce, none new.

**What reads wrong now (re-prioritised with the above numbers)**
1. **Athlete asset vs new physics (interim by design):** GLB binds baked
   ±0.205 while the tables sit at ±0.175 — shoulders still read broad/puffy
   in both figure shots. The ONE Blender rebuild against the new segments is
   the top item (reviewer order 18–19, half-landed in iter 19).
2. **Skis are long black slats:** physics d is now 1.55 and the flat black
   box got longer and MORE prominent — no tips, no topsheet graphic, no
   binding. Styling is renderer-side + the rebuild bundle.
3. **Bib 30 not legible:** faint pale-blue front patch; two faint marks on
   the lower back at figure distance. Queued in the rebuild.
4. **Suit skin-tight with muscle relief; hands slightly forward of the thigh
   line** — queued (loose-suit shell + bind carry-forward).
5. **Trees:** saturated mid-green flat-shaded cones, no snow tint (P4
   impostor forest; the iter-16 trunk stopgap holds but cannot approach the
   footage).
6. **Sky/horizon:** flat pale cyan sky, faceted cone-peak silhouettes (P2
   remainder + P6 ridgelines). Harness snow-vs-sky margins are +0.003..+0.028;
   the real sky model must end darker with margin.
7. **Landing reads smooth white** — no chop/track texture or displacement
   (P5 `bake_landing.py`).
8. **Venue dressing remainder:** kicker red edge lines read as floating
   brackets; no wands/knoll flag/judges' deck/coach figures (P3 slice 2).
9. **Lightmap stays disabled** (black-band gate green at 0.026 %); the
   entry-12 split-fixup rebake remains the spare-budget filler.
10. Not started: P10 free-look, P11 coherent crash, P9 night mode; hop-turn-
    from-keypoints and `pose_vs_physics` are now UNBLOCKED — the RTMPose
    extraction finished for all six clips (100 % frames each,
    `reference/pose/extract_all.log`).

**Regressions:** none found. Every gating spec on this tree is green except
the rig wait classified above (and ready-stance/body/game/athlete-wired
passed inside the suite this time — the race is load-dependent, which is
itself the argument for the standing wait fix). Iter-19's three knife-edge
landing flips (aerial-pike clean; aerial-tuck-long/short crash) remain
recorded physics deltas under Open questions, not regressions.

**Next iterations (proposal)**
1. **21:** the ONE Blender rebuild bundle vs NEW segments (straight arms,
   loose suit, cranium/brim, bib 30, 155 cm styled skis + binding), riding
   the APPROVED rebaseline part 2 (torso/legs per the entry-19 construction)
   if approved; ASSET_V bump; rig bind gates expected green after.
2. **21/22 (small, test-only):** the body-link race fix across drive specs —
   unblocks the red-suite noise the author sees.
3. Then per reviewer order: P2 sky/sun remainder, P10 free-look, P11 crash,
   hop turn from keypoints, pose-vs-physics, P4 trees, P5 snow, P9 night,
   P3 remainder, P6 horizon.

### 19 — APPROVED physics rebaseline part 1: arm offset ±0.175 + ski 1.55 m (torso/legs deferred with a concrete construction)

Scratch `/home/justin/aerial-agents/scratch/iter-19/` holds the pre-change
trace snapshot (`traces-old/`) and the audit script; can be swept.

**What changed** — under `APPROVED: body proportions rebaseline` (i) and
`APPROVED: ski length 1.20 → 1.55 m`, own commit `02ab44d`:
- `engine/core/body-model.js`: every upper/lower-arm `|x|` shifted
  consistently by −0.03 in ALL nine pose tables — ±0.205→±0.175,
  POSE_ARMS_T 0.355→0.325 / 0.580→0.550, POSE_TUCKED 0.160→0.130 /
  0.100→0.070; skiL/skiR `d` 1.20→**1.55** with mass and centre unchanged.
- `engine/core/pose.js` armSweep `baseX` 0.205→0.175;
  `tests/unit/pose.test.js` verbatim mirror updated; `game.js`
  applyGamepadLateral xPivots →±0.175 (+ comment). Nothing else moved.
- **Torso/leg percentage rebalance NOT attempted this session**: it requires
  re-authoring absolute joint positions across all nine pose tables, which
  could not be verified adequately in the remaining window after the arm/ski
  work. Proposed construction recorded under Open questions for the rebuild
  iteration.
- No `assets/` regeneration, ASSET_V unchanged; GLB binds are still baked at
  ±0.205 until the Blender rebuild — the documented interim state.

**ADR-0005 audit before re-capture** (all 30 scenarios, old traces from the
HEAD snapshot vs new capture):
- airtime **byte-identical** (2.300046 s) in every airborne scenario;
  twist trajectories (`spinAngle`) byte-identical ⇒ flip rates unchanged.
- trampoline / pool / crash-ragdoll / idle / nopower byte-stable.
- Aerial landing dynamics change confined to THREE scenarios whose touchdown
  outcome flips on a knife edge (first diff at f=435, the grounding frame):
  aerial-pike crash→clean (final posZ 81.784→82.622); aerial-tuck-long and
  aerial-tuck-short clean→crash-at-touchdown (82.622→81.784). The evaluator
  now sees the longer tip/tail reach against the local landing slope;
  airtime, trickName family and all other aerial outcomes unchanged.
  See Open questions for the reviewer's call.
- Athlete node census moves as expected (arm drivers −3 cm inboard, ski
  nodes longer).

**Verification.** `npm run test:unit` **74/74**; `npm run test:golden`
**30/30** after the audited rebaseline. Drive: rig+ready-stance batch runs
failed at their `waitForFunction` waits — verified as the entry-18 SwiftShader
timing class, not a regression of today's edits: (a) no numeric assertion
fired anywhere, (b) both specs were already flaking by timeout on this exact
tree in entry-18's confirmation suite, and (c) a headless run of real game.js
through the golden harness (`createSim` + ArrowUp) completes the ready turn
normally: `readyState true→false`, turn finishes, athlete descends. Five other
rig tests passed in the same runs. Shot set NOT regenerated — no renderer or
asset file was touched, so the rendered scene is byte-identical; next
iteration's rebuild regenerates everything anyway. `index.html` scripts
`?v=12→13`.

**Open / next**
1. **Rebuild iteration (the bundle's second half)**: ONE Blender rebuild
   against the NEW segments — straight arms, loose suit, cranium/brim check,
   bib 30, visual 155 cm mogul skis + binding — plus the torso/leg proportion
   commit below if approved as constructed, then regen assets (ASSET_V bump),
   restamp binds via `patch_skin_binds`, and expect rig.spec bind≡driver to
   return green against the new pose tables.
2. Longer charge/deform waits across drive specs as the standing fix for the
   entry-18/19 timing class; rebake surgery stays the spare-budget filler.

### 18 — P1 slice 2: one continuous solid ground — flank field joins the ribbon without a seam

Reviewer order-17b, deferred from iteration 17 ("build the flanks as the lateral
extension of the same ribbon — shared vertices/normals, banks fading into the
flank slope, skirts/base for solidity"). Scratch dir
`~/aerial-agents/scratch/iter-18/` holds measurement logs only.

**What changed (`game.js`; no `engine/`, physics untouched)**
- The corridor block now samples a 35-column grid extending laterally to
  **±55 m** on SHARED rings: corridor (`|x| ≤ 5`, still the exact
  `terrainRootY(z) − FOOT_OFFSET`) and flanks are ONE surface — the same
  vertices/rows cross x=±5, so normals are averaged across the corridor edge by
  construction and no dihedral can exist there. z-extent grew to
  `[SLOPE_START_Z−56, OUTRUN_Z+170]`: the plateau behind the start (wStartPlat's
  job) and the far valley floor (wOutrun's job) are part of the field.
- Field profile `_fieldTopY(x,z)` = physics surface + a soft push-out windlip
  (**+11 cm** crest just outside the fence line, x ∈ 5..12 m, smoothstep in/out)
  easing back to open snowfield — the banks along the landing edges per
  IMG_3523/7841. Max berm slope ≈ 3.9°.
- **Solid-ground contract:** new `terrainSkirt` extrudes every open field edge
  down to a base at `floorY − 60 m`, capped by a `terrainBase` disc;
  `snowMat.backFaceCulling = false` gives the snow-coloured-underside last line
  of defence.
- Retired meshes: `wInrun`, `wTable`, `wLanding`, `wOutrun`, `wStartPlat`,
  `corner_inrun_trans`, `corner_trans_table`, `corner_table_landing`,
  `corner_landing_outrun`. Kept: `wUpperMtn` — its top edge lies ABOVE field
  level everywhere they overlap, so removing it would show sky over the start
  shoulders; overlap verified by the footprint sweep.
- Consumers ported: trees plant against `_fieldTopY` (bases follow the berm),
  b-net ground regex `^(terrainCorridor|wUpperMtn|terrainSkirt)`, grey-ramp draw
  region regex, extract-terrain STATIC_PREFIXES, baked.spec mesh list.
- New permanent gate (reviewer's order-17 acceptance): facet normals either side
  of the corridor edge within 5°, swept z=−38..88 excluding the kicker-wall
  span; plus extended-footprint miss sweep, skirt/base/double-sided assertions,
  logged as FIELD_SEAM.
- rig.spec run-start wait 8 s → 30 s (entry-10 SwiftShader load-flake class; the
  wider field adds software-rasterised triangles under the test GPU).

**Verification numbers**
- FIELD_SEAM: verts 22,050 / tris 42,636 (one mesh, one draw call); worst
  corridor-edge dihedral **1.90° at x=1, z=16.0** (avg 0.85°, limit 5°); outer
  footprint misses **0** (9 columns × ~73 stations out to ±55 m); skirtVerts
  2,660; base present; backFaceCulling false. Legacy gates unchanged-green:
  visual-vs-physics ≤ 2 cm, crease delta ≤ 2.5°.
- `npm run test:unit` **74/74**. `npm run test:golden`: audited before capture —
  divergence census ONLY `nodes.corner_*` absent + one tree seat
  (`fl_132` +0.94 mm from the windlip plant function); every `state.*` byte-
  identical → scene-census rebaseline per ADR-0005, then **30/30**.
- Drive coverage on this tree: every touched/affected spec green —
  terrain-corridor **3/3** (incl. the new FIELD_SEAM gate), baked, extract-
  terrain, grey-ramp, materials, textures, shadows, kicker-faces (block gate
  re-proved on the merged field), venue-dressing (b-net seat/reseat contract),
  ready-stance, body, look, and rig ×2 after the wait fix. A confirmation
  full-suite rerun finished after this commit was cut: **40 passed / 2 skipped /
  5 failed**, the five being exactly the entry-10 SwiftShader timing class
  (game full-run charge, ready-stance wait, rig wait, body deform,
  athlete-wired — all `waitForFunction` timeouts at 8–45 s) amplified by the
  wider field's software-raster triangle count (suite took 13.4 m); every one of
  them passed standalone/batch on this identical tree earlier in the session.
  First order of iter 19: rerun those five standalone, then consider longer
  charge/deform waits across the drive specs as the standing fix.
- Shots inspected directly: `scene.png` — continuous snowfield from corridor to
  flanks, NO seam band and NO sky-through gaps anywhere inside the footprint;
  fence hugging the field, trees seated on the windlip, athlete + CSM shadow
  intact. `figure_front.png`/`figure.png` — athlete unchanged; documented
  residuals stand (hands-forward ready crouch, faint bib digits, black ski
  slats — queued in the 18–19 Blender bundle with the APPROVED rebaseline).
- `index.html` scripts `?v=11 → 12`. `ASSET_V` unchanged (no `assets/`
  regeneration). Frame-rate note: corridor tris ~3.5 k → 42.6 k as a single
  static mesh (~0.15 MB VRAM, still 1 draw call); SwiftShader drive fps stayed
  8–10 (all timing-sensitive specs pass after the documented wait fix).

**Open / next**
1. **19: the Blender rebuild bundle** — straight arms, loose suit, cranium/brim
   wrap check, bib 30, 155 cm mogul skis + binding, together with the APPROVED
   proportions/shoulder/ski-length physics rebaseline (own physics commit first,
   golden rebaseline per ADR-0005, then the rebuild against the new segments).
   If it does not fit one session: land the physics commit first, rebuild second.
2. **20: review.** Rebake surgery (entry-12 four-step plan) stays the
   spare-budget filler; lightmap stays off until it lands.

**Open questions for the reviewer**
- wUpperMtn kept deliberately: slice-3 could fold it into the ribbon too
  (extend XC beyond −56 m behind the start and drop the box), but its paper-slope
  reads correctly today and the footprint sweep proves no sky shows between
  them — flagging in case you want the mesh count lower anyway.
- Tree scatter sits ON the ±11 cm windlip ring around the landing bowl (x > 12 m
  is untouched field). If the author prefers a flat approach beside the outrun,
  shrinking _BERM_H to zero is a two-line change — visual call, not measured off
  the footage yet.

### 17 — Reviewer order 17 (part): kicker block faces read snow again — root cause in the light rig, not a material

Order-17 was kicker faces + ribbon–flank continuity. The faces item turned out
to be a deep root-cause fix and consumed the session; **flank continuity (P1
slice 2) did not start** and moves to 18 with diagnosis notes below. Scratch
dir unused (probes ran as temp specs in-tree, deleted before commit).

**Kicker faces — diagnosis (measure first paid off).** Every hypothesis about a
tan material was wrong: a pick probe through the beige band named
`terrainCorridor` / `kicker_fill_*` / `kickerBackFace` — **all snowMat**, world
normal exactly (−1, 0, 0). Light-deletion A/B on the face box (mean rgb):
baseline **(0.554, 0.515, 0.521)** — warm (r−b +0.033), lum ≈ 0.52, i.e.
plywood. IBL off → lum −0.26 (still warm); sun off / hemi off → still warm ⇒
the warmth rides the IBL. Sun-only with all shadows removed: face gets
**0.39×** the flat-snow diffuse (consistent with n·l ≈ 0.30–0.39 for the sun
direction). SSAO off → no change (innocent); bump off → no change. Root cause:
the block's VERTICAL faces receive ~zero hemispheric SKY term (dot(n, dir) ≤ 0
for the up-biased hemi), a 0.30–0.39 share of direct sun, and everything else
from the env map's warm horizon band at intensity 0.45 plus the old dark
groundColor (0.18, 0.22, 0.30) × 0.18. Flat snow, lit by sun + sky term, never
showed the defect — which is why only the block read plywood.

**Fix (`game.js`, renderer lighting only).** hemi intensity 0.18 → **0.42**,
diffuse cooled to (0.85, 0.92, 1.0), groundColor is now a snow-bounce
(0.40, 0.46, 0.55) instead of a cave floor; `environmentIntensity` 0.45 →
**0.32**. In-page sweep chose the split: env 0.28–0.32 / hemi 0.38–0.45 puts
the wall inside the snow band (b ≥ r) at ~0.63 lum; lower env variants lose
flat-snow brightness for no chroma gain.

**New permanent gate — `tests/drive/kicker-faces.spec.js`.** Side camera on the
block (the reviewer's vantage); the block's visible silhouette is located by
pick grid (fill boxes + back face + angled segments; 518 sample pts), pixels
classified against a flat-snow reference box. Gates: r−b ≤ 0.005 (cool), lum ∈
(0.55, 0.95), warmFrac < 2%, within 0.25 lum of flat snow. Measured on the
fixed rig: **block lum 0.6361, r−b −0.0113, warmFrac 0.0019** (was r−b +0.033);
flatSnow 0.8278. Scene and figure shots inspected: block white/cool from the
side and ready views; figure unchanged (athlete untouched).

**Incidental P2 movement (numbers, not a claim of done).** The rebalance
brightened every snow top ~+0.03 while the sky (emissive, light-independent)
stayed 0.7986: corridor **0.821** > **sky 0.7986** — the "snow must be the
brightest surface in frame" gate now READS satisfied on the shared harness
(kicker sun-face 0.8017, inrun 0.8101, flanks 0.815/0.828). Grey-ramp gates
pass with more margin (corridor ≥ darkest flank − 0.02 → now +0.006/+0.007 the
other way). Under-athlete shadow drop **79.7%** (0.163 vs ringMax 0.8053) —
CSM quick win intact; no acne/peter-panning seen in shots. P2's remaining
scope (sun disc, fog re-tune, post 1.6→1.2, real sky model) unchanged.

**Verification.** `npm run test:unit` **74/74**; `npm run test:golden`
**30/30** (physics untouched, no trace changes); full drive suite **44 passed
/ 2 skipped** (8.8 m) including the new kicker-faces gate and all light-
sensitive specs (grey-ramp, shadows, materials, textures, baked, terrain-
corridor, venue-dressing, ready-stance, rig, look). `index.html` scripts
`?v=10 → 11`. `ASSET_V` unchanged (no `assets/` regeneration). No `engine/`
edits. Working tree contains only `game.js`, `index.html`, the new spec, and
this doc.

**Open / next (reviewer order 18–20).**
1. **18: P1 slice 2 — ribbon–flank continuity** (the deferred half of 17).
   Diagnosis already in hand: the six `w*` fills are 1.6 m-thick boxes at
   different slope angles (wInrun/wTable rotated, wLanding rotated, wOutrun/
   wStartPlat flat) + four `corner_*` filler slabs (lsMat); they meet the
   ribbon (±5 m, snowMat) with an angle + normal discontinuity, worst z ≈
   50–60 per the reviewer. Fix = rebuild the fills as the ribbon's lateral
   extension: extend the ribbon builder's XC columns (game.js ≈ 1979–2063)
   outward with a banked-shoulder profile that eases into the flank slope,
   shared vertices/normals across the corridor edge (the >5° gate), then
   skirts + base plane + `backFaceCulling=false` for the solid-ground
   requirement — the `corner_*` fillers and probably some `w*` boxes then
   retire. Beware: build-time picks are unreliable during script evaluation
   (b-net lesson) — seed flank heights from `terrainRootY`, reseat by pick
   only if a pick is unavoidable.
2. **18–19: the ONE Blender rebuild bundle** (straight arms, loose suit,
   cranium/brim, bib 30, 155 cm mogul skis + the APPROVED proportions/ski-
   length rebaseline, own physics commit first).
3. **20: review.** Rebake surgery remains the spare-budget filler; lightmap
   stays off until then.

**Open questions for the reviewer**
- The env map (`assets/environment.env`) has a warm horizon; any vertical
  surface inherits its cast. The P2 sky/sun work may want to re-open the
  env/hemi split (now 0.32/0.42) once the sun disc + post-contrast land —
  flagging so the kicker gate's numbers are re-read then, not assumed stable.
- The hemi boost is scene-wide: dark undersides (boot soles, ribbon cliffs)
  brightened too. Nothing regressed in any gate, but if the author feels the
  shadows are now too pale for the footage, the first knob is groundColor
  (0.40, 0.46, 0.55), not intensity.

### 16 — Reviewer order 16: blue B-net fencing both edges (P3 slice 1) + review-measure corridor-box port + tree-trunk stopgap

Mid-session reviewer inspection (d492d76, 01:35) pinned 16 = B-net + the
review-measure box fix; both landed. Scratch dir unused/removed. Shots
inspected directly (scene, figure_front).

**Blue B-net (`game.js`, P3 pull-forward; reference IMG_3523/3520/7841)**
- Continuous net along BOTH edges, `z = SLOPE_START_Z → OUTRUN_Z + 8`,
  `x = ±6.2` (outside the ribbon edge, inside the tree-clear band): dark
  thin posts every ~2.75 m as ONE thin-instanced cylinder (**68 posts, 1
  draw call**; hand-written translation matrices so partial headless
  stubs boot), one merged custom-strip mesh per side (2 draw calls),
  procedural `DynamicTexture` blue rope weave, `PBRMATERIAL_ALPHATEST`
  cutout, `backFaceCulling` off.
- **Seating defect found and fixed:** picks during script evaluation are
  unreliable — freshly built meshes' world matrices are not final until a
  rendered frame (measured: every build-time pick missed or hit the wrong
  fill; the first run seated posts **32.7 m** off the snow). Fix: seed all
  heights from the exact physics profile, then RE-SEAT once on
  `onAfterRenderObservable.addOnce` (picks truthful there); headless runs
  keep the deterministic seed. Second defect found by the acceptance
  sweep: station-interpolated top wire cut through the raised local snow
  at the table→landing fill step (**−0.59 m sink at z ≈ 34**), so both
  fabric edges now drape on each row's OWN picked ground; bottom edge
  rides +2 cm, sag ±7 cm modulates the top lift.
- Strips added to the CSM caster list (alpha-cut shadows); spec asserts
  the alphaTest mode so a fallen-out cutout shadow cannot go unnoticed.

**review-measure corridor box (entry-15 finding 4)** — ported to
grey-ramp's projected-real-point method; now reads **corridor 0.7949**,
byte-matching the authoritative grey-ramp gate (the stale fixed box read
0.7666 off the wInrun/wStartPlat fills). Full REVIEW_MEASURE on the new
tree: sky 0.7986 (still brighter than every snow surface — P2 remainder
unchanged), flankNear 0.7918 / far 0.8058, inrun 0.7886, kickerFace
0.7655, under-athlete 0.1564 vs ringMax 0.7818 (**80 % shadow drop**,
gate holds), face luma 0.6821.

**Tree-trunk stopgap (owed since iteration 5, third review)** — trunks
tessellation 6→**16** with a 1.45× base flare, foliage 7→**12** sides.
The real fix remains the P4 impostor forest.

**Verification.** `npm run test:unit` **74/74**; `npm run test:golden`
**30/30** after an audited rebaseline — the ONLY divergence class is the
three new `bnetPost/bnetStrip_L/R` node-census entries at frame 0
(iter-6 corner_* precedent; flight/landing numbers byte-identical).
Full drive suite **43 passed / 2 skipped** (7.9 m) including the new
`tests/drive/venue-dressing.spec.js`: strips present/one material/alpha
both sides, `thinInstanceCount === postCount === 68` (even, both edges),
worst post-foot terrain mismatch < 2 cm (fresh re-pick), net-bottom
clearance ∈ [−5 mm, 5.1 cm] over **200 samples** along the whole span,
span gates vs `_terrainCfg`. Shots regenerated and inspected:
`scene.png` — blue netting on dark posts hugging the snow along both
edges and curving with the landing bowl, athlete between the fence
lines, rounded trunk silhouettes; `figure_front.png` — unchanged from
the baseline (athlete untouched this iteration; hands-forward and bib
residuals stand). SwiftShader A/B with the fence toggled: 6.3 vs 6.7 fps
(software-raster noise; the fence adds 3 draw calls). `index.html`
`?v=9 → 10`. `blender/terrain.json` regenerated by the suite was
numerically identical (no geometry change) and restored byte-stable per
entry-15 convention.

**Open / next (reviewer order 17–20).**
1. **17: kicker block faces + ribbon–flank continuity** (P1 slice 2) —
   tan side/back faces on the kicker block must read snow; flank fills
   rebuilt as the ribbon's lateral extension with shared normals and
   skirts (also retires the seam caveat under the review-measure row scan).
2. **18–19: the ONE Blender rebuild bundle** (or two) — straight arms,
   loose suit, cranium/brim wrap, bib 30, 155 cm mogul skis + the APPROVED
   proportions/ski-length physics rebaseline (own physics commit first).
3. **20: review.** Rebake surgery (entry-12 four-step) stays available as
   the filler whenever an iteration has spare budget; lightmap stays off
   until then.

**Open questions for the reviewer**
- Build-time picking is untrustworthy during script evaluation in this
  Babylon version (world matrices finalise on first render). Anything
  added later that self-seats by picking should copy the b-net
  seed-then-reseat pattern (`_bnetSeated`); flagging in case a future
  spec wants a shared helper.
- Golden rebaseline this iteration followed the iter-6 census-only
  precedent (three new bnet* nodes, flight/landing byte-identical) —
  confirm that reading matches your expectation for scenery additions.

### 15 — Review-only: measured audit; order-item-3 holds, no regressions, re-prioritisation

No features. Self-review of iter 14 first (commit 641fcab touches only
`docs/RENDER-PROGRESS.md` + the new `tools/clearance-compare.js`): working tree
was clean, no reviewer scratch-bake files, `npm run test:unit` 74/74 and
`npm run test:golden` 30/30 reproduce on HEAD. Full `./tests/run-all.sh` on the
landed tree: **ALL GREEN** — unit + live-diff + golden 30/30 + browser +
mutation + coverage + drive **42 passed / 2 skipped** (7.8 m; iter-10's recorded
SwiftShader timing flake did not recur). Shots regenerated (`look`) and
inspected directly. I can view PNGs.

**What reads wrong now (measurements; review-measure + grey-ramp harnesses on
the shared scene camera)**

1. **Sky is still brighter than every snow surface (P2 remainder, top standing
   delta).** sky **0.7986** vs corridor 0.7949, flankNear 0.7918, inrun 0.7886,
   kickerFace 0.7655. The footage wants snow the brightest surface in frame;
   nothing has moved here since iter 5's 0.799 baseline. Needs the sun disc /
   fog re-tune / post 1.6→~1.2 rig work, not more snow tuning.
2. **Athlete shadow holds (P2 quick win intact).** Under-figure terrain
   **0.1564** vs ring max 0.7818 → **80 % darker under foot** (gate ≥ 15 %;
   shadows.spec's own probe reported 79 % at iter 8). Note for anyone reading
   REVIEW_MEASURE output: its printed `shadow.dropFrac` 0.0275 is the ring's
   own max−min spread, not the shadow contrast — use `underAthlete` vs
   `ringMax`. Every near tree still lays a distinct shadow in `scene.png`.
3. **Grey-ramp parity holds on the authoritative gate** (projected corridor
   box): corridor **0.7949 ≥ darkest flank 0.7918** (far 0.8058), inrun 0.7886,
   kickerFace 0.7655, skyFrac 0 — iter 13's numbers reproduce.
4. **Found while measuring: review-measure's duplicate "corridor" metric is
   stale, not the scene.** Its fixed fractional screen box reads corridor
   **0.7666** (−0.025 vs flankNear) — a pick probe (temp spec, run then
   deleted) shows that box samples **`wInrun` ×8 / `wStartPlat` ×1**
   (picked points z −12…−19) — the lsMat FILLS, not the ribbon. This is the
   same drift grey-ramp.spec itself had until iter 13's projected-box fix; the
   diagnosis machinery exists, the port just never happened. Non-gating spec,
   so the suite stayed green throughout. Fix next iteration: replace that one
   box with grey-ramp's projection of a real corridor point (~10 lines).
5. **Seam stays closed** from the ready view (kicker-face skyFrac 0); the
   row-scan worst row remains the horizon-adjacent y=0.40 (16.3 % real sky),
   documented caveat since iter 5.
6. **Face/goggles read**: face-region luminance 0.6821, darkFrac 0 — skin
   below the brim in `figure_front.png`, helmet from behind in `figure.png`.
7. **Known residuals all confirmed in the fresh shots, none new** (each already
   queued): hands hang clearly forward of the thigh line in the front view (P8
   bind carry-forward); shoulders read broad/puffy (the APPROVED proportions
   rebaseline, still queued as its own physics commit); bib is a faint pale
   patch with no legible digits at look distance (P7 bib 30); skis are black
   flat slats, no upturned tips or topsheet graphic (queued ski-styling item);
   tree trunks hexagonal + low-poly cone foliage — **the interim tessellation
   stopgap is now owed since iteration 5 and noted by three reviews**; flat sky
   + fog band + cone peaks (P2/P6); venue undressed — no B-net/wands/flag/deck/
   coaches (P3); kicker's red edge lines read as floating brackets from this
   angle (P3 will wrap the face in panels); landing is smooth white, no chop
   texture (P5).

**Regressions:** none found. Unit/golden/drive gates green everywhere;
lightmap stays off with the black-band gate passing (baked.spec); terrain.json
regenerated by the suite proved numerically identical to HEAD (max position/
normal delta 0.0 over all 203 meshes) though not byte-identical — extract-
terrain's float serialisation is not text-reproducible across runs (minor
tooling nit, recorded only); restored to keep the tree byte-stable.

**Re-prioritised list for the next iterations**

1. **Lightmap rebake surgery** (reviewer order item 4, unchanged): entry-12
   post-unwrap vertex-split fixup → rebake → flip `_bakeLightmapEnabled` to
   true in the SAME commit, restore baked.spec on-state assertions, ASSET_V
   8→9; re-run grey-ramp/shadows/look against the bake ON.
2. **B-net fencing** (author pull-forward) — instanced posts + alpha-cut strip
   both edges, per the pinned acceptance.
3. **APPROVED proportions rebaseline physics commit + ONE Blender rebuild
   bundle**: arm x ±0.175, torso 36→31–32 % / legs →51 %; suit shell + folds,
   hands-forward bind offset (finding 7), straight-arm chain check, legible
   bib 30, styled 155 cm skis with binding (the `APPROVED: ski length`
   line rides in the same commit).
4. **Interim tree trunks stopgap** (tessellation ≥16, flare, snow collar) —
   trivial, third time queued; do it inside whichever iteration next touches
   the scene.
5. **P2 sky/sun remainder** so snow beats the 0.7986 sky.
6. Small mechanic ports folded along: review-measure corridor box (finding 4);
   watch body.spec/game.spec SwiftShader charge/deform timing (dormant).
7. Then P10 free-look, P11 coherent crash, P1 slice 2 (flank/skirt closure),
   P3–P6, P9 night mode.

**Open questions for the reviewer**
- None new. Standing: entry-12's four-step rebake plan sanity glance (accepted
  ordering there would still help); residual engine-side negatives from entry
  14 (kicker-corner −0.0839, ride-out −0.0775) remain available under their
  pre-approved remediation paths whenever the author wants them closed.

### 14 — Reviewer order 3: `main` vs branch-before vs branch-after whole-run clearance tables

The comparison owed since the iteration-11 review, measured with a new committed
tool, `tools/clearance-compare.js` (node-only, no deps, no engine changes). It
boots the golden harness environment in any checkout (worktrees for `main`
b0aa043 and branch-before `8797666` = pre-P1/pre-C1; scratch copies under
`~/aerial-agents/scratch/iter-14/`), wraps MeshBuilder between stub-extend and
game.js to record every box's dimensions, drives scenario
`aerial-power-75` frame-by-frame (450 sampled frames, sampleEvery=2), and every
frame computes each ski's lowest corner grid (5 along-length × 2 edges, ski box
0.08 × 0.03 × 1.20 from SEGMENTS) plus a body proxy (lowest of skis/boots/glove/
helmet/head/neck nodes) against:

- **physics surface** — `terrainRootY(z, liveCfg) − FOOT_OFFSET` from that tree's
  own engine + game.js constants (unit-test `configFor` convention); and
- **visual surface** — reconstructed top faces of that tree's corridor boxes,
  or the ribbon profile itself on branch-after (`ribbonMode`; its ≤2 cm parity
  is already gated by `terrain-corridor.spec.js`, not re-derived here).

Launch-window handling: samples within ~3 m before the lip while the root pitch
exceeds 30° are skipped (319 samples) — there the rigid ski rotates into air the
heightfield still reports as solid kicker face (the same span
`terrain-corridor.spec.js` excludes); without this the launch frames read
−0.78 m spuriously. Frames classified `air` are reported but non-gating.

**Table A — ski lowest-corner clearance vs PHYSICS surface, m (min / max per phase;
negative = penetration; worst frame noted):**

| phase | main b0aa043 | branch-before 8797666 | branch-after f78ee4b |
|---|---|---|---|
| inrun | −0.0059 / +0.1748 | +0.0020 / +0.0941 | **+0.0020 / +0.0941** |
| transition | +0.0477 / +0.1000 | same | same |
| kicker (grounded) | −0.0839 / +0.1000 | same | same |
| landing | +0.0368 / +0.2913 | same | same |
| outrun | **−0.1564 / +0.1037** | −0.1564 / +0.1037 | **−0.0775 / +0.3755** |
| body min (hard zones) | +0.0697..+0.1664 | +0.0182..+0.1572 | +0.0182..+0.1572 |

Readings: (a) in-run columns differ between main and the branch only because main
predates the ready-stance seating (+2 mm seat ⇒ exact +0.0020 floor; its float
halves max from 0.1748 → 0.0941); (b) the C1 roll-out fillet halves the ride-out
dip (−0.1564 → −0.0775 — it fills the concave corner so compression bottoms out
higher); (c) transition/kicker/landing numbers are byte-stable across trees.

**Table B — slab-era VISUAL surface vs physics profile, m (main; validated single-box
top-plane errors at segment centres / worst edge):**

| region | deviation |
|---|---|
| slope slab centre | −0.044 |
| trans_seg_0..15 centres | −0.091 → −0.000 (join chords) |
| kicker_seg far-edge rows (seg_14–16 @ z≈23.2–23.7) | up to **−0.789** |
| landing slab (45.7 m tilted box, slope-matched) | mid-span ≈ −0.32, ends −9.91 / +9.26 |
| start pedestal top | −7.80 (below-snow base piece, not surface) |

This quantifies the vanishing-athlete defect class the P1 ribbon removed: where
single big slabs or 16–20 short rotated segments approximate curved/profiled
zones, their tops miss the physics line by centimetres-to-most-of-a-metre, so an
athlete riding the physics surface crosses visible slabs. The same reconstruction
on branch-before reproduces the class visually (transition vis-min −0.32) except
near the lip overhang, where box footprints extend into open air and answer
wrongly by construction (documented artifact, not a claim).

Scratch: `~/aerial-agents/scratch/iter-14/{main,pre,branch-after}.json` retain the
full per-phase aggregates; probe worktrees removed after measurement.

**Verification.** `npm run test:unit` 74/74; `npm run test:golden` 30/30 (no
runtime code touched besides the new tool); drive specs untouched — none assert
the new tool; shots left as iteration 13's (no scene change this session).

**Open questions for the reviewer**
- Two residual PHYSICS-side negatives the renderer cannot fix (both inside the
  pinned contact framework; renderer defers to the author):
  (a) grounded kicker-window dip −0.0839 (worst f=282, z=21.2) — rigid-ski
  corners vs convex curvature under high pitch; (b) ride-out −0.0775 (branch,
  was −0.1564 on main/pre) — landing compression persisting past OUTRUN_Z.
  Both sit within the pre-approved remediation paths (`APPROVED: hard snow
  surface` / `compliant landing layer`) if the author wants them closed in the
  engine; branch-after already respects the ≤0.10 m landing-zone cap.
- Should `tools/clearance-compare.js` become a gating unit/drive check (it is
  deterministic and ~10 s), e.g. against the stored json aggregates?

### 13 — Stale lightmap disabled (order 1); C1 blends rebuilt as tangent fillets (order 2)

Reviewer's 23:50 order, items 1–2. Item 3 (the `main` clearance-comparison
tables) did not fit the session and remains first in the queue; item 4 (the
rebake) untouched. Scratch: `/home/justin/aerial-agents/scratch/iter-13/arc-blend.js`
(fillet construction + gates, kept for the numbers).

**Order 1 — stale lightmap disabled (44f5d9d).**
- `applyBakedLighting` early-returns behind `window._bakeLightmapEnabled =
  false` with the flip-back point documented at the switch. The on-disk
  `terrain_skyvis/shadow` maps describe the pre-P1 slabs; their stale zero
  multipliers on wInrun's newly-exposed top face were the 9.29%-black
  ready-view band (own iter-11 measurement).
- `baked.spec.js` rewritten for the off-state contract: switch off, zero
  `_baked` materials anywhere, plus a NEW ready-view gate — near-black
  (max-channel < 32) frame fraction < 0.5% (measured **0.026%**; the defect
  measured 9.29%). The P2 caster assertions are kept unchanged. The
  "both slots reach the shader" probe is staged in git history for the
  flip-back. `compare.spec.js` becomes `BAKE_AB=1` opt-in (it waits on
  `_bakedApplied > 0`). `index.html` scripts `?v=7 → 8`.
- Shots: the band is gone — `shots/scene.png` shows continuous snow where the
  black strip was; athlete, trees, shadows unchanged.

**Order 2 — C1 blends rebuilt non-overshooting (a14af69, own physics commit
under the standing `APPROVED: C1-smooth run profile`).**
- Root cause, measured before building: with both endpoints AND end slopes
  pinned, a cubic-Hermite/bezier blend's interior slope must reach
  ≥ 1.5× the secant (0°–40° join ⇒ ≥ 51°) — iter-11's −49.8° was structural,
  not a tuning failure. The reviewer's arc suggestion only works with
  floating endpoints, i.e. as a true tangent fillet.
- Both joins are now **tangent fillet circles** (engine:
  `landKnuckleArcY`/`landRollOutArcY` + `landingFits`; cfg carries
  `ltArc`/`loArc` descriptors instead of bezier control arrays):
  - knuckle R=1.0 m: leaves the table 0.36 m up-table of the old crease,
    rejoins the exact landing line 0.28 m past it; peak deviation vs the old
    crease ≈ 7 cm (cut, not bulge).
  - roll-out R=14 m: compression arc **9.77 m** (author's 8–12 m band),
    fills the concave corner up to **95.9 cm above the old crease polyline**
    at the corner itself (that is what rounding means vs a sharp cone);
    outrun level byte-preserved past z=OUTRUN_Z+2.45.
- Reviewer's three gates are permanent unit tests
  (`tests/unit/terrain.test.js`): slope within [min(a,b), max(a,b)] along
  the whole landing (worst **40.00° = limit**, was 49.8°); slope monotone
  inside each blend; never above table level / below outrun level (no hump);
  byte-equal to the pre-C1 creased profile outside the blend footprints.
- Corridor mesh sampling zones + exact rings moved onto the fillet
  tangencies (`game.js`); unit-mirror `configFor` updated (`ltArc`/`loArc`).
- **ADR-0005 audit before re-capture** (30 scenarios): airtime **2.300 s
  byte-identical in every scenario**; first-grounded landing posZ equal to
  2 dp in every scenario (34.98/35.31 unchanged); final ride-out posZ drift
  **≤ 0.37 m** (81.76→81.78, 82.99→82.62 — the roll-out's earlier flattening
  gives the ride-out slightly more run); pool/trampoline scenarios untouched;
  remaining trace diffs are terrainCorridor node census following the new
  sampled geometry.

**Grey-ramp correction (found while verifying order 1).** With the bake off,
the grey-ramp gate failed by 0.004 — and a pick probe showed why: the spec's
fixed "corridor" box has been sampling `wInrun`/`wStartPlat` (lsMat FILLS)
since the ribbon replaced the wide slabs in iter 11. The box now projects an
actual corridor point (mid-table, `terrainRootY−FOOT_OFFSET`) into screen
space. Honest numbers with the lightmap disabled: **corridor 0.7949 ≥
darkest flank 0.7918** (far flank 0.8058), inrun 0.7886, kicker face 0.7655,
skyFrac 0 — the run is the brightest surface again even without the bake.
`game.js` snowMat albedo stepped 0.955/0.97 → **0.975/0.99** to hold margin
(`textures.spec` updated); `index.html` `?v=8 → 9`.

**Verification.** `npm run test:unit` 74/74 (73 + the new gates test);
`npm run test:golden` 30/30 after the audited rebaseline; drive:
terrain-corridor 2/2, ready-stance 1/1, baked 3/3 (new off-state + black-band
gate), grey-ramp/materials/textures 6/6 after the box fix, look 1/1; full
drive suite 41 passed / 2 skipped before the grey-ramp box fix and 1 failed /
41 passed / 2 skipped at the mid-point — the single failure was the
box-attribution issue above, fixed and re-run green. Shots regenerated and
inspected: no black band; kicker/transition continuous snow; athlete,
trees, shadows unchanged; known residuals stand (faint bib, flat ski slats,
hands slightly forward in the ready crouch).

**Open / next (in order).**
1. The `main` vs branch-before vs branch-after whole-run clearance tables
   (reviewer order item 3, owed since 23:50) — first thing next iteration.
2. The lightmap rebake (order item 4) via the entry-12 post-unwrap
   vertex-split fixup, then flip `_bakeLightmapEnabled` back to true in the
   SAME commit, restore baked.spec's on-state assertions, ASSET_V 8→9.
3. B-net fencing (author pull-forward) after those.

### 12 — Rebake diagnosis: no winding flip (measured); unit harness blend fix; rebake mechanics re-planned for iter 13

The iteration-11 review (`5bcecd0`) landed mid-session; its two asks — the
non-overshooting C1 rebuild and the missing `main` clearance-comparison table —
are queued FIRST for iteration 13 (both under the standing
`APPROVED: C1-smooth run profile`). This session's budget went to iter 11's
queued rebake defect, which turned out to be misdiagnosed, plus a pre-existing
unit-suite failure found on the way.

**Self-review of iter 11: 7 pre-existing `npm run test:unit` failures on HEAD.**
`terrain.test.js` compares the live game.js `terrainRootY`/`terrainAccelZ`
against the `engine/disciplines/aerial-ski.js` mirror with strict equality, but
its harness config was never given iter 11's `_ltBP`/`_loBP`/`OUTRUN_TRANS_LEN`
— so the mirror silently took the legacy creased-profile fallback and every
world failed at the blend joins (worst: rootY off by 0.0419 m at z=31.75 in
`?world=quint`; accelZ 5.40 vs 0.01 m/s² at z=28.70 default). Fixed by passing
the three missing values in `configFor` (tests only — no engine, no game.js).
Suite now 73/73. The failure existed since ad014c3 and would have masked any
future live-vs-mirror drift at exactly the joins the reviewer wants rebuilt.

**The queued "flip the ribbon's winding" rebake step is wrong — measured, not
assumed.** In Blender space (after the pipeline's mirror conversion
(x,y,z)→(x,z,y), determinant −1): the corridor's current indices give
**100.00 % up-facing faces, mean n·up +0.894**, and the flipped variant gives
**0.00 % up-facing** — flipping would point every hemisphere bake ray into the
ground and produce exactly the black bake `bake_lightmap.py`'s history warns
about. The negative signed volume (−7316.84) that iter 11 convicted is
displacement-about-origin: `signed_volume` is only defined for watertight
meshes, and the ribbon is open (1096 boundary edges after position welding).
Edge-weld probe: the six `w*` fills ARE closed (0 boundary edges after weld —
their 24 verts are per-face duplicates); only `terrainCorridor` is genuinely
open. `blender/bake_lightmap.py` now scopes the volume assert to watertight
meshes and gates open receivers by the invariant a hemisphere bake actually
needs (≥ 99.9 % up-facing, worst face n·up ≥ −0.001, logged census: corridor
100.00 % up / mean 0.894). No winding was changed anywhere.

**Rebake attempt 1 — blocked by `check_uv_consistency`:** the heightfield
ribbon shares row vertices between quads (6039 verts / 10920 tris), so
smart_project's per-corner UVs conflict on 510 corner events / 186 shared
vertices (scattered rows: 210 events near z=−3.45, 60 at z=−32.82/−24.01/−6.81
— seam rows where the unwrap folds). The old slab boxes never hit this: every
box face arrives with private corners. The gate is correct — one lightmap UV
per shared vertex cannot describe a seam.

**Rebake attempt 2 — blocked by the atlas-fill gate.** The standard fix was
tried first: re-emit the ribbon with per-triangle-private corners carrying the
averaged normals computed on the shared topology (render-identical; the same
convention the boxes already satisfy). That unwraps into 10,920 disconnected
islands → atlas fill 9.8 % (< 25 % gate) — nothing would be readable. This
game.js experiment was REVERTED (byte-identical tree re-verified via a fresh
extract-terrain run: terrain.json unchanged); the pipeline gate did its job.

**Consequence — iter 13 mechanics (supersedes entry 11's four steps):** the
bake sidecar needs a post-unwrap vertex-split fixup inside `bake_lightmap.py`:
(1) unwrap the shared-vertex ribbon as today; (2) split ONLY the vertices whose
lightmap UVs conflict (Blender `bmesh` duplicate + relink, UVs stay per-corner);
(3) write the sidecar from the split mesh's vertex order; (4) split the GAME
mesh identically (same conflict criterion, same order) when stamping uv2, or
better, have the game adopt the baked glb's split vertices with baked normals.
Then the rebake, ASSET_V 8→9, grey-ramp/shadows/look re-run. Not attempted in
this session's remaining window — it is surgery across the uv/export/game
contract, and a half-landed version leaves the ribbon unwrapped or black.

**Verification.** `npm run test:unit` 73/73 (7 real failures fixed);
`npm run test:golden` 30/30 (physics untouched); extract-terrain green
(terrain.json byte-identical after the revert — the expansion experiment left
no residue); `look` regenerated and inspected: the stale-map black band is
still present as expected (the maps on disk are still the old bake —
`assets/` untouched, ASSET_V stays 8); ribbon, kicker block, trees, athlete
otherwise unchanged from iter 11's shots. Working tree at commit: only
`blender/bake_lightmap.py` + `tests/unit/terrain.test.js` + this doc.

**Open / next (iter 13, in order).**
1. C1 blend rebuild, non-overshooting (circular-arc tangent to both lines or
   monotone Hermite), under `APPROVED: C1-smooth run profile`, with the
   reviewer's three gates (slope within [min(a,b), max(a,b)] everywhere,
   slope monotonic through each blend, surface on the correct side of both
   lines) added to the profile audit; ADR-0005 audit + rebaseline; report
   airtime / landing point / landing-speed deltas.
2. The `main` vs branch-before vs branch-after clearance tables from the
   23:50 feedback (still owed).
3. The lightmap split-fixup + rebake above.

### 11 — C1 landing profile (APPROVED physics) + P1 slice 1 corridor ribbon

Two commits: an own-commit physics change under `APPROVED: C1-smooth run profile`,
then the renderer ribbon. Scratch work in `/data/aerial-agents/scratch/iter-11/`
(swept except the audit/probe scripts, which document the numbers).

**What changed — commit 1 (physics, ad014c3)**
- Slope scan of `terrainRootY` (0.005 m eps): the only true discontinuities are
  **0 deg -> 40 deg at z=28.7 (LANDING_START_Z)** and **40 deg -> 0 deg at z=63.7
  (OUTRUN_Z)**. Both now cubic beziers with exact end-tangent matches:
  `landTransBezY` (knuckle, span LANDING_TRANS_LEN=4) and `landOutBezY`
  (roll-out, span OUTRUN_TRANS_LEN=10.5, arc ~12.2 m — the 8-12 m the author
  asked for), with `landingBlendsFit` guard + legacy fallback. All levels and
  horizontal extents PINNED: tableY/lipY/landing angle/OUTRUN_Z byte-equal.
- Curvature inside blends is bounded and REPORTED (not hidden): peak local slope
  ~-49.8 deg across ~1.5 m in the knuckle blend (bulge 0.537 m above the old
  line at z=29.75), ~-45.9 deg peak on the roll-out (zero lift above the old
  line). This transient overshoot is inherent when both endpoints of each blend
  are pinned on the flat/40-deg lines; handle ratios tuned in scratch
  `blend-probe4.js`.
- Golden rebaseline per ADR-0005, audited BEFORE re-capture (scratch
  `audit-c1.js`): airtime 2.300 s byte-identical in every scenario; finalPosZ
  -0.23..-0.64 m (ride-out on the new roll-out); frame-0 divergence confined to
  `fl_*` tree nodes seating on the smoothed profile (scene content, not physics);
  pool scenarios diverge only in pool-floor node seating.

**What changed — commit 2 (renderer, 850afbb)**
- ONE `terrainCorridor` mesh replaces slopeBox, 16 trans_seg_*, flatTable,
  flatTableFull, landing, outrun, start (45 boxes -> 1). Every vertex from
  `terrainRootY(z) - FOOT_OFFSET`; adaptive spacing (0.08-0.15 m through the
  kicker/knuckle/roll-out, <=0.25 m everywhere curved); exact rings at every
  physics branch join; >20 deg slope breaks get duplicated rings so shared
  normals never smear across the kicker back wall. The 4.7 cm slopeBox face
  defect and the slab chord/gap errors died with the removed meshes.
- `tests/drive/terrain-corridor.spec.js` (new): 0.25 m ray-cast sweep at 3
  columns over z=-39..89 — pick y within 2 cm of physics (the
  skier-disappears-into-snow class); mesh-vs-physics turn-angle delta gate
  <=2.5 deg (renderer-seam detector that ignores real physics curvature); zero
  footprint misses. The airborne kicker back-wall span (KEZ..LSZ) is excluded
  from both gates — a z-heightfield necessarily slants there and the athlete is
  always airborne over it; the physics-owned 22 deg start-plateau join is inside
  tolerance by construction.
- baked.spec RECEIVERS and extract-terrain prefixes updated to the new scene;
  index.html ?v=7; commit 3 (c47202c) preps the lightmap rebake (below).

**Verification**
- `npm run test:unit` pass; `npm run test:golden` 30/30 after the ADR-0005
  re-capture; terrain-corridor 2/2 (worst physics-surface delta < 2 cm, worst
  physics-mismatched turn < 2.5 deg, zero footprint misses); extract-terrain
  regenerates cleanly (terrainCorridor + fills + backface).
- Shots regenerated and inspected (`look`): ribbon, kicker block and red edge
  lines all correct in silhouette; **BUT see the open defect below**.

**OPEN DEFECT (convicted, fix queued for iter 12)**
With the slabs gone, wInrun's top face (previously hidden under start/slope
boxes from the ready camera) shows through with the STALE baked lightmap:
ready-view black coverage 9.29% -> 0.09% when the lsMat_baked clone is stripped.
The bake encodes shadows of the now-removed slabs. Iter 12: (1) flip the
ribbon's triangle winding in the game.js builder — the rebake's signed-volume
assert rejects it as inside-out in Blender terms while the game-side normals
are correct and up; re-verify normals stay up in-game; (2) rerun
`bake_lightmap.py` (RECEIVER_PREFIXES already updated to terrainCorridor + w*,
terrain.json already regenerated); (3) ASSET_V 8 -> 9; (4) re-run grey-ramp +
shadows + look.

**Open / next**
- Iter 12: the rebake (a crisp ~20 min path, exact steps above), then P1
  slice 2 (lateral blend into the flanks / skirts, closing the cyan-seam class
  properly) or P10/P11 per the reviewer order.
- The physics-owned 22 deg start join (flat plateau -> in-run) is C0 but not C1;
  recorded per plan rule (renderer reproduces physics exactly there).


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

### 10 — Review-only: recovered the killed iter-9 ready stance, audited it, measured the render

Iteration 9 was killed before committing; its ready-stance work (reviewer order 4) was found
intact in the working tree, independently re-verified, and landed here together with this
iteration's review-only audit. No new features. I can view PNGs; shots inspected directly.

**What changed (recovered iter-9 work, self-reviewed this session)**
- `game.js`: renderer-side ready stance (ADR-0002, physics untouched). While `readyState &&
  readyTurnT < 1`: both skis are rolled about their long axis onto the slope plane and the
  rendered root is seated so each ski's lowest edges rest on `terrainRootY − FOOT_OFFSET` +
  2 mm (two-pass solve); the uphill (L) leg gets knee/hip flexion fading with `readyTurnT`;
  the downhill ski defines the seat so hips stay level; a smoothstep hands the skis back to
  euler pose at `readyTurnT = 1`. Written stub-safe (plain-quaternion maths) so the golden
  harness executes identical numbers. Plus `window._readyStanceProbe` for the drive spec,
  and a KNOWN-DEFECT comment on the `slopeBox` centre (below).
- `tests/drive/ready-stance.spec.js` (new, gating): the reviewer-order-4 acceptance set —
  5 lowest-edge samples per ski ∈ [0, 5 mm]; ski roll ≤ 2°; torso ≤ 3° from vertical;
  uphill knee ≥ 10° more flexion; hands-beside-thighs proxy |Δz| ≤ 3 cm; after ↑ the turn
  completes back to the symmetric in-run posture with skis ≥ −5 mm (no penetration) and
  ≤ 0.10 m float (the pre-existing run seating float, documented and gated, P1 reconciles).
- `tests/golden/audit-ready-stance.js` (new, ADR-0005 audit) + all 30 golden traces
  rebaselined: the ready pose changes the scene census (athlete hierarchy + `slope` box
  through the turn frames; persistently in `aerial-idle` where the ready state never ends).
- `tests/drive/rig.spec.js`: the bind≡driver test now measures in the NEUTRAL rest pose
  (starts the run first) — the ready state now deliberately poses the athlete, so the old
  at-boot measurement was testing the pose, not the bind.
- `index.html`: all 11 script tags `?v=5` → `?v=6` per the reviewer's cache-busting rule.
  Process gap: this branch has changed `game.js` in iters 1–8 without ever bumping it
  (last `index.html` edit predates the branch) — the author should hard-reload once.

**Verification (all green on the landed tree)**
- `node tests/golden/audit-ready-stance.js` against a pre-change worktree:
  **state IDENTICAL in all 30 scenarios** (independently reproduced this session);
  node diffs confined to the athlete hierarchy + `slope` box, through f=45 (the 0.7 s
  turn), persistent only in `aerial-idle` (ready state never ends there — by design).
- `npm run test:unit` pass; `npm run test:golden` 30/30; full `./tests/run-all.sh` on the
  landed tree: unit/golden/browser/mutation/coverage pass, **drive 42 passed / 1 skipped
  (7.7 min)**; `ready-stance.spec.js` + `rig.spec.js` 7/7 standalone.
- Ready-stance numbers (spec): ski samples all within [0, 0.005] m on both skis; roll 0.7°;
  torso tilt 0.4°; flexL−flexR ≈ 24° (gate 10°); hand-hip Δz L 0.028 / R 0.010 m; post-turn
  worst float 0.0941 m (gated 0.10).
- `look` shots regenerated and inspected: `scene.png` — the athlete now waits yawed across
  the corridor, both skis flat on the slope plane, upright torso; corridor/flank brightness
  pattern unchanged from iter 8; `figure.png`/`figure_front.png` — ready-stance figure
  stands vertical across the run; residuals unchanged (below).

**What still reads wrong (review-only findings, with measurements)**
1. **Sky brighter than every snow surface (P2, top standing delta).** REVIEW_MEASURE on
   this tree: sky 0.799 vs corridor 0.7685, flanks 0.7866/0.7878, inrun 0.7846, kicker
   face 0.7604. Same-harness corridor history: 0.622 (iter 5) → 0.7685 now (residual
   −0.018 vs near flank). The footage wants snow the brightest surface in frame: needs
   the sky/sun rig (sun disc, fog re-tune, post 1.6→~1.2), not more snow tuning.
2. **The rendered hands still hang in FRONT of the thighs in the ready stance (P8).** The
   new spec's hands-at-sides check passes — but it measures the DRIVER proxy
   (`lowerArm.position.z − 0.125·sin(rx)` vs hip z, ≤ 3 cm). `figure_front.png` still
   shows the mesh hand clearly ahead of the thigh line: the offset lives in the mesh/bind
   (arm vertices carried forward of the bone), which no pose change fixes. The known
   residual is NOT closed by the ready stance; it must go into the next Blender rebuild.
   (A mesh-level centroid probe was attempted for a hard number; root-local maths
   returned NaN late in the session — TODO number for the rebuild iteration.)
3. **Known defect, now documented in code: the `slopeBox` top face sits 4.7 cm ABOVE the
   physics plane** (centre −0.6 instead of −0.6/cos(SLOPE_ANGLE)). Iter 9 tried the cos
   correction and the corridor top rendered near-black (grey-ramp corridor 0.7778 →
   0.06–0.10); mechanism unattributed within that budget (bake UV2 guard, caster lists,
   ready block all ruled out), so it was reverted and commented at the site. This defect
   is why the post-turn ski float is 0.0941 m. P1 replaces this box entirely — do not
   cos-correct it again in isolation.
4. **Athlete shadow (P2 quick win holds on the same harness):** ring probe drop 19.6%
   (iter-5 pre-CSM baseline on the same probe: 11.6%; gate ≥ 15%). Note the review
   harness's ring probe is a different geometry from `shadows.spec.js`'s 79% probe —
   compare like with like.
5. **Seam stays closed:** kicker-face skyFrac 2.2% (was 12.2% at iter 5; gate 3.5%).
   The row-scan worst row (16.5% at y=0.40) remains the horizon-adjacent row where real
   sky belongs (documented caveat, iter 5).
6. **Unchanged dressing/geometry gaps vs footage (all planned, not regressions):** dark
   longitudinal bands along the corridor edges (P1 side faces), faceted cone trees +
   hexagonal trunks (the reviewer's interim tessellation stopgap from 2026-08-26 is STILL
   not landed — it is a ~10-line change and should not survive another iteration), cone
   peaks + flat sky (P6/P2), no B-net/wands/flag/deck (P3), smooth landing (P5), faint
   bib (P7), broad shoulders (approved rebaseline queued).
7. **Suite flake (recorded, not fixed):** in the first post-recovery run,
   `body.spec` "body deforms" (bone-matrix diff timed out at 40 s) and `game.spec` "full
   run" (flipPower charge timed out) failed; both then passed twice standalone and the
   full suite passed on rerun. SwiftShader at ~9 fps + retries:0 makes charge/deform
   timing the fragile edge; if it recurs, the honest fix is longer charge timeouts, not
   retries.

**Regressions:** none. Iter-8 numbers (grey ramp, shadows) reproduce on the landed tree.

**Re-prioritised list for the next iterations**
1. **P1 slice 1 — continuous corridor ribbon** from the exact physics profile (the next
   order item, now overdue): fixes the 0.0941 m run float, the 4.7 cm slopeBox defect,
   the corridor-edge dark bands, and the remaining kicker −0.029 in one geometry.
2. **The approved physics rebaseline as its own commit** (arm x ±0.175, torso/leg
   proportions, ADR-0005 rebaseline, ±5% flip-rate constraint) + the SAME Blender rebuild
   taking the queued suit work (loose shell, folds, muscle smoothing) and the P8
   mesh-hands-forward bind fix (finding 2) — one rebuild, three payloads.
3. **P2 sky/sun remainder**: sky 0.799 > all snow — sun disc, fog re-tune, post 1.6→~1.2,
   then re-measure snow-vs-sky.
4. **Interim tree trunks** (tessellation ≥ 16, flare, snow collar) — owed since iter 5,
   trivial, do it alongside any iteration that touches the scene.
5. Then P10 free-look, P11 crash, P3 dressing, P4 impostor forest, P5 landing bake.

**Open questions for the reviewer**
- The `slopeBox` cos-correction black-render mystery (finding 3): the corrected box
  renders 0.06–0.10 luminance while the uncorrected one renders 0.77+. If P1's ribbon
  lands next iteration this is moot, but if the mechanism is a material/bake interaction
  it will bite the ribbon too — any hypothesis before then is welcome.
- `index.html` `?v=` was never bumped on this branch before iter 10 (rule gap, now
  fixed): confirm `game.js?v=6` loads for you after a hard reload.
- Mesh-level hand-position number (finding 2) still missing — will land with the rebuild
  iteration's spec instead of a one-off probe.

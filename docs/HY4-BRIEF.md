# HY4 render pass — complete brief

You are Tencent HY4 (high reasoning), working alone in the worktree this file lives in, on branch
`hy4/render-pass`, created from `render-realism-glm` after GLM iteration 64. Your job is the entire
remaining render-quality program for this browser aerial-ski game (Babylon.js, no build step, Blender
asset pipeline), done in one long session with incremental commits. A second model (GPT-5.6 Sol)
will then review your branch adversarially, you get one pass to address it, Sol evaluates, and the
author decides whether to merge. Nothing you do touches the author's live branch.

Read, in this order, before changing anything: `AGENTS.md`/`CLAUDE.md` if present, `docs/RENDER-PLAN.md`
(priorities P0–P13 and the 51–80 schedule), `docs/RENDER-PROGRESS.md` (**Reviewer feedback** section
= the author's and reviewer's decisions, incl. every `APPROVED:` line; entries 1–64 = what was tried,
what worked, what failed and why), `docs/ANALYSIS-render-2026-08-26.md`, `docs/REFERENCE-FOOTAGE.md`,
`docs/HANDOFF-athlete.md` (landmines), and skim `docs/POSE-VS-PHYSICS.md`. The reference footage
frames are local under `reference/frames/`, `reference/pose/`, `reference/shots/` (author screenshots
of defects). You can view images — do so, and say what you see.

## Ground rules (same as the plan's, restated)
1. `engine/` and the numbers in `engine/core/body-model.js` / `blender/body-model.json` change only
   under an `APPROVED:` line already present in `docs/RENDER-PROGRESS.md` (C1-smooth profile, hard snow
   surface, compliant landing layer, body proportions rebaseline incl. part 2 with the ±5% flight-rate
   guard, ski length 1.55 + touchdown retune, ready-stance/hop-turn trace re-capture provided physics
   `state` is identical). Any other physics change: write it as a numbered proposal in
   `docs/HY4-NOTES.md`, do not apply it. An approved physics change ships in its own commit with the
   ADR-0005 golden rebaseline (`tests/golden/`), an audit proving what changed, and before/after numbers.
2. No runtime dependencies or bundlers; `index.html` loads local files. Procedural textures are
   generated at runtime or by committed Blender/node scripts. Blender:
   `~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup --python <script> -- ...`.
3. No trademarks (no "CAN", no maple leaf, no Kästle marks). Generic panels and graphics.
4. Bump `ASSET_V` in `game.js` whenever `assets/` changes; bump the `?v=` on every `<script>` in
   `index.html` whenever a JS file changes (the author's browser caches otherwise).
5. Keep 60 fps on a mid-range GPU: instancing for repeated meshes, bounded draw calls and casters.
6. Every completed item ends in a focused commit with the trailer
   `Co-Authored-By: Tencent HY4 Preview (hy4-preview) <noreply@tencent.com>` and an entry in
   `docs/HY4-NOTES.md` (what changed, how verified with numbers, what is open). Never leave
   uncommitted work at the end. Never push. Never amend, rebase or touch other branches.
7. Verification you must run before each commit: `npm run test:unit`, `npm run test:golden`, the
   drive specs you touched (`DRIVE_PORT=8299 npx playwright test --config tests/drive/playwright.config.js <name>`),
   and `DRIVE_PORT=8299 npx playwright test --config tests/drive/playwright.config.js look` for the five
   canonical shots (`shots/scene.png`, `kicker.png`, `inrun.png`, `figure.png`, `figure_front.png`) —
   view them. Run the full `./tests/run-all.sh` at least at the end. Always use `DRIVE_PORT=8299`;
   never touch ports 8200/8201/8202 (the author's viewers).
8. Scratch files go in `~/aerial-agents/scratch/hy4/`, never `/tmp`. Measure before you change and
   after; "it looks wrong" is not a diagnosis. A small verified commit beats a large unfinished one.
9. Time: you have a long session (hours) but it will be hard-killed at its limit — commit after every
   item, and keep `docs/HY4-NOTES.md` current so a kill loses nothing.

## What is already done (do not redo; verify still true)
Rig frame fix at the source (bind ≡ driver), straight arms, hands/shoulders proportions, loose suit
with folds, face+goggles under a cranium helmet, bib 30 with a hard gate, boots aligned and seated on
155 cm mogul skis with bindings, ready stance across the hill, RTMPose-timed hop turn, continuous
physics-exact terrain with C1 fillets and a distinct 3.4 m kicker block, B-net both edges, cascaded
PCF shadows, sky dome with cumulus and sun disc at 32°, DPR rendering + MSAA + SSAO 32 + 1024 snow
tiles with world-metre UVs, impostor spruce forest (4 variants), layout-aware hotkeys, ESC closes
modals, crash as a hard state machine (tumble ≤ 1 s → frozen slide → stopped).

## The work, in priority order (all of it; acceptance in the plan/feedback where referenced)
A. **Author's open defects (highest priority, all visible on the current build):**
   1. Boot–ski invariant: ski posed from the boot (toe AND heel bound) in every state except crash
      eject; invariant spec over a full run + hop turn (P13 section of the plan).
   2. In-run crouch: arms stay in front (hands ahead of hips at knee height), sweep up only at the lip.
   3. Crash rewrite: tumble ≤ 1 s → roll/slide down the steep landing as a near-rigid body with
      friction → rest ON the snow (gravity + contact resolution, ≥ 3 support points within 5 cm) →
      stopped at the flat; no flailing, no inert crumple, no hovering (feedback items 2, 2b).
   4. P13 kinematic chain solver: reconcile joints each frame before skinning; constant neck length;
      tear detector (no triangle > 3× rest edge); hands within 3 cm of pose-table positions.
   5. Body + suit pass (feedback item 6): athletic-normal proportions (chest ≤ 1.15× hip breadth, torso
      depth ≤ 0.6× chest, thighs ≥ 0.55× and calves ≥ 0.35× hip breadth), uniform 1.0–1.5 cm suit
      stand-off, residual body contour ≤ 30% of the base mesh, folds only at joints. Also: helmet
      shape (currently biconical), suit blue as a broad panel, helmet brim wrapping behind the ears.
   6. Solid ground everywhere: skirts + base under corridor/flanks/knoll/in-run, snow-coloured
      undersides, camera clamp ≥ 1 m above terrain in every mode incl. after a crash.
   7. Floating grey slab above the start when looking back up the in-run
      (`reference/shots/author_back_of_jump_2026-08-28.jpg`): find, seat or remove; screenshot gate.
   8. Sky from the gameplay cameras: deep blue to within ~5° of the tree line (top-third r−b ≤ −0.25 in
      `scene.png`), thin haze band, cumulus above the ridgeline, sun glare visible in at least one
      canonical view. Parameter change on the existing dome; fog must not whiten the dome.
B. **Trees (P4) remainder:** bare deciduous majority (~60%, fine-branch cards, grey-brown), understory
   bush, per-instance scale/yaw jitter, near-camera card-mesh trees (≤ 25 m from the run) so oblique
   impostor facets disappear, shadows from all instances, `trees.spec.js` census/draw-call gates
   (≤ 20 draw calls for the forest).
C. **Snow surfaces (P5):** `blender/bake_landing.py` — chopped landing tiles (normal/AO/albedo +
   heightmap, real displacement 5–10 cm fading at knoll/edges), corduroy in-run, hand-raked table,
   ski-track decals, landing spray plume tuned to the footage (≈ 1–1.5 m, 1–2 s). Contact rules:
   hard zones zero penetration; chopped landing sink ≤ boot height for ≤ 0.5 s.
D. **Horizon (P6):** layered forested ridgelines with height haze, snowy roofs in the valley; remove
   the cone peaks.
E. **Free-look (P10):** ready state, after run/crash, replay; drag orbit, wheel zoom, keys; launch inputs
   still work; camera clamp; HUD hint.
F. **Venue dressing (P3 remainder):** landing wands with pennants, knoll flag, judges' deck on
   containers, 2–3 coaches in red at the knoll, generic side panels on the kicker replacing the red
   junction marks (thin dark edge line at the wall/face junction as in the footage).
G. **Higher rendering quality (P12 remainder and beyond):** re-measure the whole P12 list on a real GPU
   frame-time budget (≥ 60 fps mid-range): consider TAA or higher MSAA where stable, screen-space contact
   shadows under skis/boots/posts, a 4096 athlete bake if texel density limits close-ups, better snow
   BRDF (sparkle/specular sheen from the low sun without the grey-ramp regression), tone/exposure
   consistency across the five canonical cameras, LOD for the forest and fence, load time. Each change
   A/B'd with numbers and before/after shots; `quality.spec.js` asserts every setting.
H. **Flight pose (P7):** arms tight overhead by the ears in layout, skis parallel and together in
   flight, arms open only on landing — renderer blending only.
I. **Pose-vs-physics (merged lane D):** skeleton-free flip counts (silhouette principal axis + VLM
   annotation of flight windows), golden-trace comparison, numbered physics proposals in
   `docs/POSE-VS-PHYSICS.md` — proposals only.
J. **Night snowfall mode (P9)** per the plan (floodlights, GPU flakes, dark fog, takeoff puff).
K. **Performance/polish:** draw-call budget, LOD, load time, weaker-GPU fallback, the parked P2 height
   haze if it can be verified, cache-busting hygiene.
L. **Docs:** update `docs/HANDOFF-athlete.md` (or a new `docs/HANDOFF-render.md`) with the state of the
   render pipeline, the invariants, the gates, and every landmine you hit; `docs/HY4-NOTES.md` complete.

Work top-down. If an item cannot be finished, commit the verified part, record precisely what is
left and why, and continue. At the end, write a **Summary for the reviewer** at the top of
`docs/HY4-NOTES.md`: what landed (with the commit ids), what did not, every gate and its measured
value, and the five canonical shots described.

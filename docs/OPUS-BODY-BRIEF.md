# Opus lane — athlete body, suit, helmet, goggles, face (brief + review)

- **Author of this brief**: Claude Fable 5 (reviewer / orchestrator). **Model**: claude-fable-5
- **Implementer**: Claude Opus 5 (`claude-opus-5`), branch `opus/athlete-body`, worktree `~/aerial-agents/opus`,
  viewer for the author on `:8203`, test port `DRIVE_PORT=8399` (never 8200–8203 or 8099).
- **Why a separate lane**: the author's verdict after ~100 GLM iterations: "the suit still seems like a
  onesie, not a real aerial suit … GLM is not doing a good job there". Everything about the **athlete** now
  belongs to this lane; the GLM loop in the main worktree keeps the scene (terrain, mountains, trees, sky,
  loading overlay, camera, night mode) and is forbidden from touching the athlete files listed below.

## Ownership (files this lane owns; GLM will not edit them)
`blender/build_body.py`, `blender/bake_*` only where athlete maps are concerned, `assets/athlete_*`
(glb + maps + `athlete_maps.json`), `tests/drive/rig.spec.js`, the athlete-loading and athlete-pose
blocks of `game.js` (the `ImportMeshAsync('athlete_body.glb')` block and its material setup, `applyPose`
for the skinned body, `_inrunArmForward`, the P13 kinematic-chain reconciliation), the figure/face/pose
shot tooling (`shots/figure*.png`, `shots/face*.png`, `shots/pose_*.png`, `shots/zoom_*.png`).
Not owned: terrain/corridor, mountains, trees, sky, fence, kicker, physics (`sim*`/golden traces),
loading overlay (GLM does it; you only make the assets small — item 4).

## Reference
Read `docs/REFERENCE-FOOTAGE.md`, `docs/FABLE-REVIEW-80.md`, `docs/ANALYSIS-render-2026-08-26.md` and the
**Reviewer feedback** section of `docs/RENDER-PROGRESS.md` (the author's rulings; every one of them is a
requirement). Footage (local only, gitignored): `reference/frames/<clip>/*.jpg`; the athlete in
`IMG_3523`/`IMG_3520` wears a **white suit with a royal-blue panel/stripe, dark helmet, bib**. Zoom into
the frames (crop with PIL) for helmet/goggle/face/suit-fit detail before you model anything.
Blender: `~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048 --samples 96` (see `blender/README*` and the
Makefile targets; the build has its own gates that must keep passing).

## Review findings (Fable, from `shots/face.png`, `figure_front.png`, `figure_side.png`, `pose_tuck_side.png`, head `b5d51b9`) and the fix each needs

1. **Goggles sit on the nose, not the eyes** (author, HUMAN TESTING #4). In `face.png` the black band is at
   ~0.34–0.50 of head height with a wide bare forehead above it. Real placement: lens band centre at the
   eye line (~0.60 h from the chin), top edge tucked under the helmet rim with ≤ 1 cm of skin showing,
   bottom edge above the nose tip. Goggles are geometry (`goggle_geometry`) + paint (`paint_suit` face
   pass); move both together and keep the frame ~1.5–3 mm proud of the face, lens glossy dark with a
   subtle blue/orange mirror tint, strap continuing round the helmet. Gate (`rig.spec.js` or the build
   gate): **CORRECTED by reviewer 2026-08-29 14:20 after Opus measured the author's reference (`aerial_suit.png`, crown y=852, chin y=1008, lens rows 908–945): the lens band is 0.40–0.64 h (centre ≈ 0.52 h), its top touching the helmet rim with NO bare forehead — the brief's earlier 0.55–0.68 h was wrong (it sat above the eye line); use 0.40–0.64 h**, measured inside the head silhouette mask; negative control: shifting the band down by 0.08 h must fail.
2. **Helmet reads as a beret / skull-cap with the forehead exposed — and the author's 8203 check (HUMAN TESTING #6) says it now sits too FORWARD.** Centre the dome on the skull: front rim ~1.5 cm above the brow (no lower), crown apex above the ear line's midpoint, back rim at the nape. Gate: dome centroid within ±1 cm of the head centroid along the face axis; negative controls ±3 cm fore/aft fail. (`face.png`, `figure_side.png`).
   Required: a dome centred on the skull top, shell coming down to ~1.5 cm above the brow in front, over the
   ears at the sides, to the nape at the back, with a visible thickness at the rim (2–3 mm lip), a chin
   strap, and 2–4 small vents; no "hood" skirt hanging down the back. Colour: dark (near-black or navy)
   glossy shell. Keep `crown_cap_last` as the last geometry pass (an earlier fix was undone by
   `retune_proportions`).
3. **The suit is a onesie.** **Primary design reference (author-supplied, 2026-08-29): `reference/images/aerial_suit.png`
   (a 1206×2622 still of a real aerialist standing on the flat, arms overhead) and every frame of
   `reference/frames/IMG_3770/f_001..f_099.jpg` (1920×1080, 30 fps, 3.3 s) — crop and zoom them before modelling.**
   What that suit actually is: a **light-grey / off-white** (not pure white) relaxed-fit one-piece with a **single
   royal-blue stripe ~5 cm wide down the OUTSIDE seam of each arm (shoulder → cuff) and each leg (hip → ankle)**,
   nothing else on the body panels; straight-cut trouser legs with soft folds at the knee and bunching at the
   ankle over dark ski boots; fitted-but-not-tight sleeves; a small dark logo on the left thigh; a dark fly
   seam. Over it a **separate loose bib** — light-blue yoke over the shoulders, white middle carrying the number,
   a magenta/pink band with a sponsor mark at the waist; it hangs 1–2 cm off the suit. At the neck a
   **multicoloured neck gaiter** filling the gap between collar and helmet. Helmet dark grey/black dome, goggles
   with a **mirrored blue lens** sitting right under the helmet rim. Use this design; treat the older footage
   descriptions only as secondary. It is a flat white skin with blue leg stripes and the number painted straight
   on the chest. A real aerials suit (see footage): **two-tone panel design** — white base, royal-blue side
   panels from armpit to ankle and a contrasting shoulder yoke; a **centre-front zip line** (dark seam, neck
   to hip); a **stand-up collar** (~3 cm); **sleeve and ankle cuffs** (slightly darker, elastic ribbing);
   panel **seams** as normal-map detail; a **fine woven fabric micro-normal** (tileable, high frequency) so
   the cloth is not plastic; subtle **folds** at elbows, knees, groin and lower back (`displace_suit`) that
   deepen in the tuck (the author: "suit doesn't seem to fold over the back"); **the bib is a separate
   loose garment** — a shell 8–12 mm off the torso, front and back, with "30" on both sides and elastic
   sides — the number is on the bib, never on the suit. Fit rule stands: comfortable, not skin-tight, not
   baggy, little body contour, straight torso, chest does not protrude, legs leg-dominant (ratios in
   `RENDER-PROGRESS.md`).
4. **Everything on the athlete is blurry** while the fence and trees behind are sharp (`face.png`,
   `figure_*`). Causes to check and fix: the head/helmet/goggles occupy a tiny UV island of the 2048 atlas
   (give head + helmet ≥ 25 % of the atlas, or a separate 1024 head texture); texture sampling (mipmaps,
   anisotropic filtering, no `NEAREST`/bilinear-only); the normal map not actually resolving seams. At the
   same time make the athlete **fast to load** (author: skis appear before the skier): the maps are 4.7 MB
   normal + 2.3 MB AO + 1.0 MB albedo PNG. Target ≤ 2.5 MB total: albedo → JPEG q90 or WebP; AO → 1024 JPEG/
   WebP; normal → WebP lossless or 1024 PNG; update the loader (`map('assets/athlete_*')`), `ASSET_V`, the
   `index.html ?v=` and report byte totals + first-body-visible time (`window._bodyLinked` timestamp) in
   `docs/OPUS-NOTES.md`. Add `<link rel="preload">` for the GLB and maps in `index.html`.
5. **Tuck deformation is wrong** (re-confirmed by the author on 8203, HUMAN TESTING #6: "tuck position still very poor - back separating as discussed before" — treat this as a top-priority item right after 1/2) (`pose_tuck_side.png`): the torso smears into a single curved shell, the
   back "separates", the arms vanish. The spine must bend across ≥ 3 spine bones with weights that
   preserve volume (Babylon is linear-blend; add corrective spread of weights across the chain rather than a
   hard 50/50 at one joint), the suit must follow the back with folds, the arms must stay visible in the
   footage tuck (hands ahead of the knees, below the shoulders — see 6). Gate: tear ratio ≤ 1.35 on the
   skinned buffer at tuck, crouch and pike endpoints (including the pelvis ring), and the back profile
   is C1-continuous (no step > 15 mm between spine segments in the side silhouette).
6. **In-run crouch arms** (carried over from `docs/NEXT.md`): hands 0.10–0.30 m AHEAD of the knees and below
   the shoulders (footage: `IMG_3523` frames 40–70). Rewrite `_inrunArmForward`; gate + negative control.
7. **Pike hip tear** (carried over): the P13 hip reconciliation at pike = 1 tears the pelvis; fix the
   reconciliation, gate as in 5.
8. **Front canonical camera** (carried over): the front shot must use the baked `faceForward` with the
   correct sign — gate: front has lens pixels + bib, back neither; a flipped sign fails; the face gate is
   measured inside the head silhouette mask, not against the whole frame.
9. **Face**: nose, mouth and chin must be discernible at the canonical face distance (compare with a zoomed
   footage crop); skin tone natural; the red line at the neck in `face.png` is the collar seam — make it
   the suit collar (item 3), not a red stripe.
11. **Calves look huge** (author, HUMAN TESTING #6 on 8203). The leg-girth pass over-inflated the lower leg. Real proportions: calf circumference ≈ 0.70–0.75 × thigh circumference at mid-segment, ankle ≈ 0.55 × calf; the boot cuff must be wider than the calf above it so the leg tapers INTO the boot, not out of it. Gate on the skinned mesh in the ready stance with those ratios; negative control ×1.25 calf fails.
10. **Neutral stance: standing straight up, perpendicular to the skis.** Author (HUMAN TESTING #5, 09:45): "skier's hips still a little more forward. should be perpendicular (standing up straight) from skis." In `figure_side.png` the pelvis leads the ankles. Gate (ready state, side view along the ski axis): hip centre within 3 cm of the ankle centre along the ski direction; ankle–hip–shoulder line within 5° of the ski-surface normal; knees ≤ 10° flex; negative control: pushing the pelvis 6 cm forward must fail. boot–ski invariant, binding-touches-boot,
    skis eject only on crash — none of these may regress (their gates are in `rig.spec.js`/`drive` specs).

## Reviewer arbitrations (read at every session start)
- **Arbitrations on session 4 (15:50):** (a) **`calf_hip ≥ 0.40` demotion APPROVED** — item 11's taper ratios govern the lower leg; the earlier "legs not skinny" intent is carried by the THIGH (keep every existing thigh/hip and leg-dominance gate as is — no thigh may shrink to satisfy item 11). (b) **Item 5 approach APPROVED: give the armature a spine.** Add spine_01–03 (+ a neck bone that follows the bend) with weights spread along the torso, and drive the tuck/pike/crouch bend across the chain in the athlete pose block of `game.js` (yours). Folds: bake a second displacement/normal set for the tucked back and blend it in by tuck amount (material uniform) — folds keyed to the rest pose only is defect (c) in your own analysis. Gates as in item 5 plus: neck follows the spine (head–neck angle within 25° of the upper spine in the tuck), arms visible in the tuck side shot. This is the largest item; take a whole session for it. (c) **New item 12 — boots.** Your finding stands: the leg must end in a dark ski-boot shell (cuff above the ankle, shell to the binding, buckles optional) that the calf tapers INTO; the white blob stopping short of the binding is a defect. Gate: dark boot pixels present between ankle and binding in the side shot; boot–ski invariant unchanged. (d) **Blue stripe (item 3 detail):** a clean ~5 cm band along the OUTER seam of arm and leg, straight, not a ragged blob across the shin — measure its width and straightness in the side shot. (e) **Bib box framing:** the bake fix order (15:35) stands; re-framing the measurement box is allowed only together with a shot proving both glyphs legible on the back.
- **BLOCKING for the next merge to 8201 (15:30): the `bib-number` back-face gate is RED on your branch** (navyFrac 0.4074, gate < 0.25). The reviewer's merge candidate (integration + your items 1/2/4/8) passes unit 78/78, golden 30/30 and 24/25 athlete/scene drive tests; this is the only red, so it blocks the author seeing your work on 8201. Do it FIRST in the next session, before any new item: look at the back-bib shot. If the "30" on the back is legible and the plate is a normal white bib, recalibrate the band against the sharp render with before/after numbers and the shot name in the notes. If the back plate really is a dark slab, fix the bake (the number must be legible front AND back, on the separate bib garment). Then run the whole `bib-number` spec and commit.
  **Reviewer looked at your `shots/bib_back.png` (15:35): the back plate IS a dark slab — the "30" is stretched into tall vertical bars and clipped at the plate edge, i.e. the back bib UV/bake is wrong (aspect and framing), not the gate. Fix the bake so the back number is the same legible glyph pair as the front, on the separate bib garment. Do NOT recalibrate the gate. Also visible in that shot: a crumpled tear in the suit over the left shoulder blade in the NEUTRAL stance — item 5's skinning problem shows at rest, not only in the tuck; include the upper back in the tear gate at rest.**
- **Goggle band (14:20): Opus's reference measurement stands — 0.40–0.64 h, lens top at the helmet rim, no bare forehead.** The 0.55–0.68 h in the original item 1 was the reviewer's error. The goggle-proud gate must measure the goggle geometry itself (radial step of lens verts vs the same-slab skin), not the skull; keep the negative control.
- **Commit discipline:** session 1 (13:49) ended with the merge + goggles work staged but uncommitted. Commit BEFORE writing the session report; a verified merge is committed the moment unit+golden are green.
- **APPROVED (Fable, 2026-08-29 10:40): the depth-of-field fix stays in your lane.** The `DefaultRenderingPipeline`
  DoF block in `game.js` is yours until merge; GLM has been told not to touch it. A distance-driven `fStop` is the
  right shape. Record the before/after numbers in the notes.
- **Bib gate:** do not loosen blind — but if the marked-box shot shows the back bib really is a dark slab with a
  legible "30", recalibrate the band against the SHARP render and write the old/new numbers and the shot name.
- **Keep your branch current with the integration branch:** at the start of each session, once the tree is clean
  (committed), run `git merge --no-edit render-realism-glm`; resolve conflicts keeping both sides' intent (GLM's
  scene work, your athlete work), rerun the gates, commit the merge. The author views your worktree on :8203 and
  must see the scene fixes (red kicker paint, 3D ridges, reveal gate) there too.
- Commit as soon as the suite is green — never end a session with uncommitted work if it can be avoided; a
  partial but green item is better committed than carried.

## Ground rules
- Commit after **each** completed item (never carry more than one uncommitted) with the trailer
  `Co-Authored-By: Claude Opus 5 (claude-opus-5) <noreply@anthropic.com>`. Never push anywhere.
- Verify before committing: the Blender build gates, `./tests/run-all.sh`, and the drive suite with
  `DRIVE_PORT=8399`; regenerate the figure/face/pose shots and **look at them** (Read the PNG). Bump
  `ASSET_V` and the `index.html ?v=` on every asset/script change.
- **No physics changes.** If an item seems to need one, write a `NEEDS-APPROVAL:` line in
  `docs/OPUS-NOTES.md` and skip it — the reviewer approves separately. No golden-trace rebaselines.
- Do not loosen a gate to pass. Every new gate ships with a negative control.
- Keep `docs/OPUS-NOTES.md` current per session: what landed (commit id, measured numbers, shot names),
  what is open, what the reviewer must decide. Scratch files go under `~/aerial-agents/scratch/opus/`,
  never in the tree; reference clips/frames stay local (gitignored) — never `git add` them.
- When every item is landed or explicitly recorded as blocked with numbers, put the line
  `OPUS PASS COMPLETE` at the top of `docs/OPUS-NOTES.md` and commit.

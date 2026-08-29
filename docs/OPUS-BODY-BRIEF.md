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
   gate): lens band vertical extent within 0.55–0.68 h **measured inside the head silhouette mask**;
   negative control: shifting the band down by 0.08 h must fail.
2. **Helmet reads as a beret / skull-cap with the forehead exposed** (`face.png`, `figure_side.png`).
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
5. **Tuck deformation is wrong** (`pose_tuck_side.png`): the torso smears into a single curved shell, the
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
10. **Neutral stance: standing straight up, perpendicular to the skis.** Author (HUMAN TESTING #5, 09:45): "skier's hips still a little more forward. should be perpendicular (standing up straight) from skis." In `figure_side.png` the pelvis leads the ankles. Gate (ready state, side view along the ski axis): hip centre within 3 cm of the ankle centre along the ski direction; ankle–hip–shoulder line within 5° of the ski-surface normal; knees ≤ 10° flex; negative control: pushing the pelvis 6 cm forward must fail. boot–ski invariant, binding-touches-boot,
    skis eject only on crash — none of these may regress (their gates are in `rig.spec.js`/`drive` specs).

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

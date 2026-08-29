# Opus lane — athlete body: working notes

Implementer: Claude Opus 5 (`claude-opus-5`), branch `opus/athlete-body`, worktree `~/aerial-agents/opus`,
test port `DRIVE_PORT=8399`. Brief: `docs/OPUS-BODY-BRIEF.md`.

Build command (the brief's path is wrong — Blender lives under `~/opt`, not `/opt`):

```
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup --python blender/build_body.py \
    -- --out assets/athlete_body.glb --res 2048 --samples 96
```

24 s end to end on the RTX 5070 Ti (OptiX), and reproducible: a no-change rebuild moves only a
handful of PNG bytes.

---

## Session 1 (2026-08-29)

### Item 4 — blur + asset size — LANDED

Four separate causes, three of them real. Measured, not guessed.

**(a) The blur was DEPTH OF FIELD, not texture.** `game.js` built the `DefaultRenderingPipeline`
with `depthOfField.focusDistance = 10000` **once, at construction, and never updated it**. Babylon
reads that field in millimetres, so the focal plane was nailed at 10 m in front of whichever camera
was rendering. Every shot then split into "10 m away, sharp" and "not 10 m away, blurred" — the
background forest sat near the plane, the athlete did not. At the canonical face close-up
(r = 0.6 m) the subject was many depths-of-field in front of focus. That is the whole of the
author's "everything on the athlete is blurry while the fence and trees behind are sharp".

Fix: a per-frame `scene.onBeforeRenderObservable` hook that (1) sets `focusDistance` to the actual
camera→athlete distance, and (2) disables the effect below 3 m, because at f/1.4 / 50 mm the total
depth of field is ~5 m at a 12 m follow distance but under 2 cm at 0.6 m — there is no aperture that
keeps a 0.5 m-deep subject sharp at 0.6 m *and* blurs a background, and a lens that tries blurs the
subject instead. First person (camera at the eyes, d ≈ 0) lands in the same branch and should never
have been blurring anything either.

> **REVIEWER: this is the one change in this commit that is not inside the Opus lane's file list.**
> The DOF pipeline is part of the camera/render block the brief assigns to GLM. It is also the
> direct and dominant cause of item 4, so I fixed it rather than report item 4 as blocked. It is one
> self-contained block near the camera setup (`// Keep the depth of field focused on the ATHLETE`).
> If GLM is to own it, move that block, not the diagnosis. Please arbitrate.

**(b) The head was texel-starved.** Measured atlas share before: head 1.7% + face 3.2% = **4.9%** of
the 2048 map. `finish_lowpoly` was *shrinking* the head for the unwrap (`UV_SHRINK = 0.55`), on the
theory that a helmeted head carries no detail — but the head is the smallest part of the body by
area *and* the part the camera gets closest to. New `HEAD_GROW` constant (default 2.50) scales head
shell + face together about one shared pivot before `smart_project`; hands still shrink.

| | head | face | hand | suit | head+face |
|---|---|---|---|---|---|
| before | 1.7% | 3.2% | 0.3% | 94.8% | **4.9%** |
| g = 2.05 | 11.3% | 9.8% | 0.2% | 78.6% | 21.1% |
| g = 2.50 (shipped) | 15.4% | 12.9% | 0.2% | 71.5% | **28.3%** |

Gate `HEAD_ATLAS_MIN = 0.25` in `finish_lowpoly`. **Negative control**: `--head-grow 0.55`
reproduces the old layout and fails the gate at 2.1% (log:
`scratch/opus/negctl_headgrow.log`). Every existing build gate (bib number, leg stripe, suit normal
variance, face/helmet, bideltoid, leg profile) stays green with the suit at 71.5%.

**(c) 8.26 MB of lossless PNG on the wire.** New `blender/pack_maps.py` re-encodes the baked maps
for delivery *after* every build gate has measured the lossless bake, then deletes the PNGs.
Run out-of-process because Blender's bundled Python has no PIL.

| map | baked PNG | delivered | error vs bake |
|---|---|---|---|
| albedo | 1 064 496 B | **322 938 B** WebP q95 @2048 | mean abs 0.0034, p99 0.0235 |
| normal | 4 778 568 B | **629 902 B** WebP q95 @2048 | mean 1.543°, p95 4.858° |
| ao | 2 419 131 B | **163 216 B** WebP q92 @1024 | mean abs 0.0140, p99 0.2078 |
| total | 8 262 195 B | **1 116 056 B** | 7.4× |

The normal map is lossy — the arguable call. 1.5° mean / 4.9° p95 angular deviation is far under
what a matte lycra surface shows, and lossless WebP costs 2.24 MB, nine tenths of the 2.5 MB budget
on one map. `pack_maps.py` gates the encode (`mean ≤ 3°`, `p95 ≤ 8°`, colour mean abs ≤ 0.02, total
≤ 2.5 MB). **Negative control**: `python3 blender/pack_maps.py assets --self-test` re-encodes the
normal map at quality 20 and asserts the gate rejects it — it does, at mean 3.451° / p95 11.599°.
Resolution stays 2048 for albedo and normal (halving them would undo (b)); AO is the one map that
halves for free, being a smooth low-frequency term.

**(d) Sampling.** Babylon's default `anisotropicFilteringLevel` is 4. The athlete is a
glancing-angle surface almost everywhere, which is exactly the case trilinear mip selection resolves
by picking a blurrier mip; the fence and trees behind stayed sharp because they are flat cards facing
the camera. Now set to `getCaps().maxAnisotropy` (16 on this machine) rather than a hard-coded 16.
Mipmaps were already on.

**Wire, measured from the network in the browser** (`rig.spec.js`, `ATHLETE WIRE`):

```
athlete_body.glb    854 864
athlete_normal.webp 629 864
athlete_albedo.webp 322 938
athlete_ao.webp     163 216
athlete_maps.json     1 196
total             1 972 078   (was ~9 132 000)
```

`window._bodyVisibleAt` — new instrument, ms from navigation start to the frame in which the skinned
body first becomes visible — reads **1457–1542 ms** under SwiftShader in the drive harness. There is
no "before" number to compare against (the instrument did not exist), so this is a baseline, not a
delta; the honest claim is the 7.4× byte reduction plus the `<link rel="preload">` hints added to
`index.html` for the glb, the three maps and `athlete_maps.json`.

New gate: `rig.spec.js` › *the athlete arrives inside its load budget (bytes on the wire, and sharp)*
— asserts no PNG map reaches the browser, all four files actually load, maps ≤ 2.5 MB, whole athlete
≤ 3 MB, every athlete texture has mipmaps and anisotropy ≥ min(8, caps), every texture bound to a
`.webp`, and `_bodyVisibleAt` stamped.

`ASSET_V` 34 → 35; `index.html` `game.js?v=` 27 → 28; preload hrefs carry `?v=35` and must be kept in
step with `ASSET_V` (a mismatch downloads every file twice, and the new byte gate would catch it).

### Item 8 — front canonical camera / face gate measured inside the head silhouette — LANDED

The old front/back discriminator measured `darkU` over a fixed fraction of the **frame**, so the
forest behind the head voted. That is why the threshold had already been walked from 0.04 down to
0.015 in iter 98 when the birch re-mix changed the background — nothing about the athlete had moved.

Worse, and this is the finding: **the front/back close-ups did not contain the athlete at all.**
That block aimed and shot with the simulation still *running* (the `face.png` block further down
pauses first), so the captured frames were pictures of the forest. `shots/face_mask.png` from an
intermediate run shows it plainly. The gate had been passing on trees.

Fixed three ways:

1. Pause (`p`) before aiming, and aim at `_renderedHeadCentre()` — the same hook `face.png` uses.
2. Compute a real head silhouette and measure only inside it. The head is material slots 1
   (helmet + goggle lens) and 2 (face), the same split `build_body.py` exports and `game.js` binds.
3. Gate on `lensFrac` *inside the mask* instead of `darkU` over the frame.

The silhouette is computed **geometrically** — the head's vertices are skinned on the CPU with the
matrices the shader actually receives and the projected triangles are rasterised — not with a matte
render pass. A matte pass was tried first and abandoned: with the render loop stopped, neither
hiding the other meshes nor swapping in a flat emissive material survived to the captured frame (a
fresh `StandardMaterial` on the skinned head simply did not draw, and the game's own per-frame code
re-asserts visibility), so the "matte" came back as the ordinary scene.

One trap worth recording: `Bone.getFinalMatrix()` is **not** the matrix the shader gets for this
skeleton. Because the bones are `linkTransformNode`'d to world-space physics driver nodes, the
skeleton is in `needInitialSkinMatrix` mode and the skinning matrices are computed *per mesh* —
`skeleton.getTransformMatrices(mesh)` is the array that is uploaded. Using the bone's own final
matrix projected the head behind the near plane (NDC z −1.32…−0.39) and produced a "silhouette"
1454 px tall on an 850 px frame, which would have silently turned every "inside the head" fraction
back into a whole-figure one. There is now an assertion that the projected head is in front of the
near plane.

Measured on this build (`FACEDISC`):

| | maskFrac | head px | head h (px) | ndc z | darkFrac | skinFrac | **lensFrac** |
|---|---|---|---|---|---|---|---|
| front | 0.0879 | 82 152 | 428 | 0.884–0.922 | 0.548 | 0.279 | **0.2819** |
| back | 0.0570 | 53 249 | 371 | 0.911–0.935 | 0.411 | 0.360 | **0.0458** |

Gate: front `lensFrac > 0.06`, back `< 0.06`, and the front−back difference `> 0.04`. A flipped
`faceForward` sign, or a lens wrapped round the circumference, swaps them. The frame-fraction
`darkU`/`lensU` metrics are retired.

`shots/face_mask.png` ships the overlay so the reviewer can *see* what the gate measures — every
previous version of this measurement was wrong in a way no number revealed.

The `bandLo`/`bandHi`/`bandMid` numbers in `FACEDISC` are an **instrument, not a gate**: they locate
the contiguous neutral-dark band in head-heights from the chin, which is the axis item 1 needs. They
currently read 0.44–0.97 on the front because the helmet shell is also dark and neutral, so the band
detector merges goggles and shell. Item 1 has to separate them (the lens is glossy and slightly
tinted; the shell is matte-dark) before that number can become the 0.55–0.68 h placement gate.

---

## What the shots now show (by eye, `shots/face.png`, `shots/face_mask.png`)

With the blur gone, the remaining defects are legible for the first time — and they are exactly the
brief's list:

- **Item 1 confirmed.** The painted eyes and brows sit **above** the black band; the goggles ride the
  nose and cheekbones. Band centre measures ~0.43–0.50 h against the required 0.55–0.68 h.
- **Item 2 confirmed.** The helmet is a beret: a smooth dome that stops well above the brow, no rim
  lip, no chin strap, no vents.
- **Item 9 confirmed.** There is a hard red band right around the neck where a collar should be.
- **Item 3.** White shard artefacts read across the chest and shoulders in `face.png` — suit
  geometry, not paint. Worth a look when item 3 starts.

## Open / not started

Items 1, 2, 3, 5, 6, 7, 9, 10 are untouched. Item 10 was rewritten in the brief on disk during this
session (neutral stance: hips forward of the ankles) and has not been read against the code yet.

## For the reviewer

1. **The DOF fix crosses into GLM's camera block** (see item 4a). Please arbitrate ownership.
   It changes the look of the *whole scene*, not just the athlete: with focus tracking the subject,
   distant scenery now defocuses at gameplay range where before it was the only thing in focus.
   `FIGSIL frac` moved 0.1285 → 0.17 and `FRONTGATE navyFrac` 0.0553 → 0.1285 purely from the athlete
   becoming sharp.
2. **The front/back face gate had been green on pictures of trees** (item 8). Nothing else in the
   suite was verifying that the close-up contains the athlete. Worth asking whether other
   shot-derived gates share the "aim while the sim is running" defect.
3. No physics changes, no golden-trace rebaselines, no gate loosened.

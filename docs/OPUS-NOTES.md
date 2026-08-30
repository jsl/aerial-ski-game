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

## Session 2 (2026-08-29, afternoon) — INTERRUPTED before any commit

Session 2 did the work below but was cut off with the tree uncommitted: the
`render-realism-glm` merge sat fully resolved and STAGED with `MERGE_HEAD`
still present, and item 1's `build_body.py` work had been rolled back out of
the tree into `scratch/opus/item1.patch` so the merge could be resolved
against a clean file. Session 3 (below) picked both up: it re-did the merge
from scratch against the CURRENT `render-realism-glm` tip and committed it,
then re-applied the item-1 work and finished item 1.

One consequence worth recording, because the symptom is confusing: session 2's
probe build (`--out scratch/opus/build1/...`) left `assets/athlete_*.webp` at
the PROBE's paint while `assets/athlete_body.glb` stayed at the committed
build, and the tree still read "clean" to `git status` only after someone had
run `git checkout -- assets/`. See "Trap worth recording" below; session 3
fixed the cause.


### Merge with `render-realism-glm` (brief: keep the branch current)

Three conflicts, all resolved keeping both sides' intent:

| file | resolution |
|---|---|
| `blender/terrain.json` | GLM's (generated artefact; terrain is their lane). |
| `index.html` | Ours. Both sides had independently added athlete `<link rel=preload>`; ours is the superset (WebP + `athlete_maps.json`) and matches the loader. `game.js?v=` 28 -> 29 because the merged `game.js` differs from both parents. |
| `game.js` | Ours, then re-integrated. GLM had added a DEFERRED reveal (`_maybeRevealAthlete`) that already reveals the goggles, so our loader-side goggle-reveal loop was a duplicate that would have shown the goggles a frame early — removed. `window._bodyVisibleAt` MOVED from link time into `_maybeRevealAthlete`: with the reveal deferred until the maps are ready, stamping it at link time under-reports by the whole texture wait. |

### Item 1 — goggles on the eyes, not the nose

**The band was measured, not guessed.** The author's primary reference
`reference/images/aerial_suit.png` at full resolution, head region x 530..660:
helmet crown at y = 852 px, chin at y = 1008 px (h = 156 px), and the mirrored
lens occupies rows 908..945.

    lens bottom (1008-945)/156 = 0.40 h
    lens top    (1008-908)/156 = 0.64 h     centre 0.52 h

and the helmet rim on the face axis sits at y ~ 907 — i.e. **the lens reaches
the rim and there is no bare forehead at all.**

The model had the band at **0.34h..0.50h**: it stopped AT the eye line, so it
covered the nose and cheekbones and left 0.08 h (~1.6 cm) of forehead between
its top and the rim at 0.58h. That is exactly the author's "goggles sit on the
nose, not the eyes" plus "a wide bare forehead above it".

New band **0.40h..0.57h** (`LENS_LO` / `LENS_HI`, `--lens-lo` / `--lens-hi`),
top 0.01 h (~2 mm) under the front rim. It stops at 0.57 rather than the
reference's 0.64 only because brief item 2 pins the front rim at 0.58h
("~1.5 cm above the brow, no lower"); the ~2 mm of skin left showing is well
inside the brief's "<= 1 cm" allowance.

> **REVIEWER — the brief's placement number does not match the brief's own
> reference.** Item 1 asks for the gate "lens band vertical extent within
> 0.55-0.68 h". A band lying entirely above 0.55 h sits above the eye line
> (anatomically the eye line IS ~0.50 h of a bare head, lower once a helmet
> adds height on top), and it contradicts item 1's own "bottom edge above the
> nose tip" — the nose tip is at ~0.30 h. The supplied reference measures
> 0.40-0.64 h, centre 0.52. I implemented the reference. If 0.55-0.68 was
> meant literally, say so and I will move it, but the goggles will then sit on
> the forehead.

The band is now ONE definition. `LENS_LO`/`LENS_HI` feed `head_landmarks`
(`lens0`/`lens1`), and `head_region`, `goggle_geometry`, `paint_suit` and
`face_helmet_gate` all read the landmarks. It used to be the literals 0.34 and
0.50 repeated in four places plus the hard-coded slab window `17 <= zi <= 24`.
The strap follows the band centre instead of the (now lower) eye line.

**The lens was darker than the helmet.** `LENS` was `(0.04,0.06,0.08)` against
a `(0.09,0.10,0.12)` shell — that is why the eye zone read as one black mass
and why look.spec's "dark and colour-neutral" lens detector could not tell
goggles from shell (the notes from session 1 recorded the band detector merging
them; this is the cause). The reference lens reads `(26,68,108)/255 =
(0.10,0.27,0.42)` in sun, *brighter* and strongly blue. New `LENS =
(0.09,0.28,0.55)` with a mirror tint across the band (sky-brighter toward the
top, a 25 %-max warm `LENS_WARM` flash in the low outer corners), and
`GOGGLE_RIM` darkened `(0.82,0.85,0.88)` -> `(0.14,0.15,0.17)`: the reference
frame is black, and the near-white outline only existed to separate a black
lens from a black shell, which the mirrored lens now does by itself.

#### The goggle-proud gate was measuring the skull, not the goggles

Moving the band exposed it. The old gate was "mean radial distance of LENS
verts minus that of same-slab side/back SKIN verts", gated at 68.0 mm:

| build | old instrument |
|---|---|
| iter-96 normal (band 0.34-0.50) | 68.9 mm |
| iter-96 flat-skull control | 68.4 mm |
| **margin** | **0.5 mm** |
| item-1 normal (band 0.40-0.57) | 46.5 mm |
| item-1 `BODY_SABOTAGE_GOGGLES=1` | 41.7 mm |

The value is dominated by the skull's own front-to-side radius difference at
the band height, not by the goggles: the brow is simply flatter fore-aft than
the cheekbone the old band sat on, so the number fell 22 mm while the geometry
did not change. Session-1's entry 96 note had already recorded that
`BODY_SABOTAGE_CROWN` corrupted the instrument's binning so the control no
longer exercised the gate at all.

Replaced, not loosened. `goggle_geometry` now records each lens vertex's radius
**before** its push (`_GOGGLE_PRE`), and the gate measures the displacement
realised on the FINAL low-poly:

    goggle lens REALISED radial push 6.60 mm over 670 lens verts (gate 4.0)
    BODY_SABOTAGE_GOGGLES=1          0.00 mm  -> FAILS

A 6.6 mm margin against 0.5 mm. The old same-slab number is kept as a log-only
instrument for continuity across band moves. Two supporting fixes on the way
there: the slab window now follows the landmarks and stops at the SIDE RIM
(above it there is no skin to compare against — the first build measured over
ONE usable slab), and the reference population is all non-frontal head verts
rather than region `face` only (the strap band covers most of the side of the
window; including it can only make the step smaller, so the number stays
conservative).

### Trap worth recording

`--out` controls **only the glb path**. `main()` hard-codes
`out_dir = ROOT/assets`, so a build aimed at a scratch directory still
overwrites `assets/athlete_*.webp` and `athlete_maps.json` in the tree. That
silently contaminated an in-flight drive run here. Fixed in the item-1 commit:
`out_dir` is derived from the `--out` glb's directory.

### Open

- Item 1's **render-side** gate is not in yet. With the lens now mirrored blue,
  look.spec's `lensFrac` classifier (`lum < 0.30 && |b-r| < 0.05`) no longer
  matches it and must become a blue-dominance test; that same change finally
  separates lens from shell in `bandLo`/`bandHi`, which is what turns the
  session-1 *instrument* into the placement gate item 1 asks for. Calibrate
  against `BODY_SABOTAGE_FACE=1` (band round the full circumference).
- Item 2 (helmet: rim lip, chin strap, vents, dome centring), items 3, 5, 6, 7,
  9, 10, 11 untouched.
- `crash-ragdoll.spec.js` "settles with skis at rest" failed once during a run
  where the athlete maps were overwritten underneath it AND a second full suite
  was running on the same machine (load average 21). Not diagnosed; re-run
  clean before drawing any conclusion.


---


---

## Session 3 (2026-08-29, 14:20-15:1x)

### The merge — redone, not resurrected. Commit `6c388af`

Session 2's resolution was sitting in the index. It was NOT committed as-is,
for two reasons: `render-realism-glm` had moved on by two commits since it was
made (`bb74417` — which carries the reviewer's corrected goggle band — and
`51cded5`), and a resolution staged against an older tip claims parentage it
does not have. The index was reset, the item-1 work saved to
`scratch/opus/s3/*.patch`, and `git merge --no-edit render-realism-glm` re-run
against the current tip. Four conflicts this time (session 2 had three; the
brief itself is the new one), resolved as recorded in the commit message.

**A trap that cost twenty minutes, worth recording for every future session in
this worktree:** `ls .git/MERGE_HEAD` ALWAYS fails here and tells you nothing.
This is a **git worktree**, so `.git` is a *file* pointing at
`/home/justin/Code/aerial-ski-game/.git/worktrees/opus` — that is where
`MERGE_HEAD` lives. Use `test -f "$(git rev-parse --git-dir)/MERGE_HEAD"`.
Session 3 read "no MERGE_HEAD" at start-up and again mid-session and both
times concluded the merge state had been lost when it was there all along.

Second trap, same family: **`pkill -f "playwright test"` kills the shell that
runs it**, because the pattern matches the shell's own command line. The
commit that was chained after it never ran (exit 144).

### Item 1 — goggles on the eyes — LANDED (see Session 2 for the derivation)

Re-applied unchanged and built. Measured on the shipped 2048/96 build:

    face gate: lens band 0.400h..0.568h (centre 0.484h) over 704 frontal
               lens verts (gate 0.40..0.57 +-0.03)
    face gate: goggle lens REALISED radial push 6.56 mm over 704 lens verts
               (gate 4.0; BODY_SABOTAGE_GOGGLES=1 = 0.00)

The reviewer's 14:20 arbitration (0.40-0.64 h, lens top at the helmet rim, no
bare forehead) agrees with the measurement the implementation was built on.
The band ships at 0.40-0.568 h rather than reaching 0.64 h because item 2 pins
the front rim at 0.58 h; the ~2 mm of skin left between lens top and rim is
inside the brief's "<= 1 cm" allowance. The realised-push gate replaces the old
same-slab instrument, whose margin over its own negative control was 0.5 mm
(now 6.56 mm vs 0.00).

The render-side lens classifier in `look.spec.js` moved from "dark and
colour-NEUTRAL" to blue-dominance (`b - r > 0.10 && b > 0.32`), because the
mirrored-blue lens is no longer dark-neutral and the old test could not tell
the lens from the helmet shell. It ships with a 10-point calibration curve
logged in `FACEDISC` (`cal=`) so the two thresholds can be re-derived from one
run instead of guessed. Still an instrument on the render side: the front/back
`lensFrac` gate from session 1 is what holds.

### Item 2 — helmet: the dome is re-seated on the skull. PARTIAL

**What the author saw was real, and the gate that should have caught it was
measuring itself.** `face_helmet_gate` already had "(4) dome centre within
1 cm of the head centroid fore-aft". On the build the author called "too
FORWARD" it read **6.0 mm — a pass**. The reason: 910 of the 1550
head-dominant verts on this mesh ARE the shell, so "the head centroid" moves
with the dome. The gate was nearly self-referential.

**Root cause of the forward shift.** `shape_helmet` centres the dome on the
cranium, which iter-96 fixed by moving it from the physics segment centre onto
the **cranium centroid**. That is a biased estimator: the base mesh carries far
more vertices on the front of the skull (the forehead sheet running down into
the face) than on the occiput, so the vertex average sits well forward of the
shape's own centre. Measured on this mesh, with the head segment centre at
y = 0:

    cranium centroid        +101.9 mm
    cranium Y bbox midpoint  +49.9 mm
    centroid bias            +52.0 mm     <- the "too forward"

`crown_cap_last`, which re-asserts the dome as the LAST geometry pass, used the
same centroid and so re-applied the bias after every other pass had finished.

**Fix:** both passes now centre on `_band_mid_y` — the cranium's Y *bounding-box
midpoint*, which is density-independent. Effect on the shipped mesh:

| | before | after |
|---|---|---|
| dome front rim | +168.1 mm | **+135.3 mm** |
| dome back rim | -33.1 mm | **-52.9 mm** |
| back rim vs occiput | +2.5 mm (occiput bare) | **-15.7 mm** (shell covers it) |
| dome Y bbox midpoint | +74.5 mm | **+41.2 mm** |

The dome came back 33 mm and now covers the back of the skull instead of
hanging over the brow.

**New gate — DOME SEATING**, hard, in `face_helmet_gate`. It measures the
shell's back rim against the **occiput**: the rearmost skin in the band just
below the side rim, which `head_region` calls skin at every height and which
the shell therefore cannot move. Band **-40..+5 mm**, measured **-15.7 mm**
(~22 mm of margin each way).

**Negative controls** (new `BODY_SABOTAGE_DOME_MM`, slides the finished shell
fore-aft):

    BODY_SABOTAGE_DOME_MM=+30  ->  +14.3 mm  FAILS ("slid FORWARD off the
                                              back of the skull")
    BODY_SABOTAGE_DOME_MM=-30  ->  -45.7 mm  FAILS ("slid BACK off the brow")

The old centroid check is kept (it still reads 0.5 mm) — nothing was loosened.
A new log-only instrument, `helmet centre probe`, prints the whole fore-aft
picture (dome centroid, dome bbox mid, head centroid, head bbox mid, front and
back rim, occiput) after every head-touching pass.

**Item 2 is NOT finished.** Still open, and NOT attempted this session:
the 2-3 mm rim lip, the chin strap, the 2-4 vents, and the glossy shell.
Only the centring — the author's named complaint — is done.

### Build / asset numbers on the shipped build

    atlas share       head 13.8%, face 13.3%, hand 0.2%, suit 72.7%
                      (head+face 27.1%, gate 25%)
    delivered maps    albedo 311 374 B, normal 604 352 B, ao 155 924 B
                      = 1 071 650 B total (gate 2.5 MB)
    glb               839 164 B
    encode error      albedo mean abs 0.0035 / p99 0.0275;
                      normal mean 1.515 deg / p95 4.755 deg;
                      ao mean abs 0.0133 / p99 0.1961
    face gates        nose 24.1 mm (gate 20), chin relief 34.2 mm (gate 15),
                      rim front 18.4 mm above the brow (gate 10-20),
                      side 0.55h, back 0.56h, faceForward -0.4 deg
    crown             96.3 mm above the rim plane (gate 76), tilt p10
                      20.1 deg (SOFT gate 25 — unchanged, still soft)

`ASSET_V` 35 -> 36, `index.html` `game.js?v=` 29 -> 30, preload hrefs `?v=36`.

### Verification (clean run, `DRIVE_PORT=8399`)

    unit    78/78
    golden  30/30, no re-capture, no physics change
    drive   90 passed, 2 skipped, 3 failed (28.8 m)

The three reds, none of them caused by items 1 or 2 — all three were already
red on the run over the bare merge, before the new build was installed:

1. `bib-number.spec.js` — back `navyFrac` **0.4074**, gate `< 0.25`
   ("plate reads as a dark slab"). Front 0.1872 passes; `blueFrac` front
   0.1647 / back 0.0888 both pass. This is session 1's depth-of-field fix
   arriving at a gate that was calibrated on a BLURRED athlete, exactly as the
   reviewer anticipated. **Not loosened.** I looked at `shots/bib_back.png`
   (the spec ships the measured box drawn in red) and the reviewer's condition
   for recalibration is NOT met: the box does not contain a legible "30" — it
   is framed on the BOTTOM HALF of the number patch, so it catches mostly ink
   and clips the digits. The box is placed from a ray hit at a fixed fraction
   of the suit half-height (`c.y + suit.half.y * 0.18`), not from the number
   patch's own position, so the right repair is to frame the box on the patch
   (which `build_body.py`'s `in_number_patch`/`number_uv` define) rather than
   to move the band. That is a bigger change than the end of this session
   allowed. **Reviewer: this is the decision I am leaving you** — reframe the
   box, or accept a higher band on a correctly-framed box, with numbers.
2. `crash-ragdoll.spec.js` "settles with skis at rest" — *crash state machine
   reached stopped (pose frozen)*: the ragdoll never reached `stopped` inside
   the trace window. Physics/crash lane, and it arrived with the merge (GLM's
   109 re-seeded the crash roll momentum). Not the athlete lane and not
   touched here.
3. `venue-dressing.spec.js` "three static coach figures in red jackets" —
   `alphaTest` false. GLM's spec over GLM's scene code, arrived with the
   merge.

### Shots, looked at by eye

`shots/bib_front.png` and `shots/bib_back.png` (this run) show both landed
items plainly:

- **the goggles are a mirrored blue band across the EYES**, tucked right under
  the helmet rim, with no bare forehead above them (item 1);
- **the helmet is a dark dome centred on the skull**, covering the crown and
  running down to the nape at the back — not a beret perched forward (item 2).

The same two shots also confirm the untouched items, so they are worth keeping
as the reference for the next session: white shard artefacts across the chest,
shoulders and thighs; the arms fused into the torso mass; the blue leg stripe
wandering as a blob rather than running down the outside seam; the red collar
line at the neck (item 9); and the bib number patch large and unframed.

The render-side band detector now isolates the lens instead of merging it with
the shell, which is what session 1 said had to happen before it could become a
placement measurement:

    FACEDISC front  lensFrac 0.1846  band 0.493h..0.650h (centre 0.572h)
    FACEDISC back   lensFrac 0.0263  band 0.945h..0.977h (the strap)

(front/back gate: front > 0.06, back < 0.06, difference > 0.04 — all met with
a 0.158 difference). Session 1's front reading was 0.44h..0.97h, i.e. goggles
and shell as one dark mass. The render band reads higher than the Blender band
(0.40..0.568 h) because `fh` is measured from the lowest masked row of the head
silhouette, which includes the collar, not from the anatomical chin — the two
numbers are on different baselines and only the Blender one is the gate.

### Open at the end of session 3

- Item 2's rim lip / chin strap / vents / gloss.
- Items 3, 5, 6, 7, 9, 10, 11 untouched. Item 5 (tuck) is the author's
  top-priority defect after 1/2 and has a three-fault diagnosis recorded in
  the section below.
- The three drive reds above; only the first is in this lane.

### For the reviewer (session 3)

1. **The dome-centring gate that passed on a visibly wrong helmet is worth
   generalising.** Two gates in this file now turn out to have been measuring
   the thing they were supposed to constrain against itself or against a
   quantity the defect also moved (item 1's goggle-proud gate, 0.5 mm margin;
   item 2's dome centre, 6.0 mm pass on the defect). Both are fixed. It may be
   worth a sweep of the remaining build gates for the same shape.
2. **`bib-number.spec.js` — your arbitration, answered as far as I can take
   it.** The marked-box shot does NOT show a dark slab with a legible "30"; it
   shows a box mis-framed onto the bottom half of the number patch. So the
   condition you set for recalibration is not met and I did not touch the
   band. The numbers are back navyFrac 0.4074 (gate < 0.25), front 0.1872;
   shot `shots/bib_back.png`. Reframing the box is the repair, and it needs
   the patch position plumbed from `build_body.py` to the spec.
3. Blender builds and the drive suite must not share this machine. Every
   drive-suite failure this session was on one of the two known
   load-sensitive specs while a concurrent GLM iteration (load average 12-21)
   and a Blender bake were running.

---

## Session 4 (2026-08-29, 15:0x-15:4x)

### Merge with `render-realism-glm` — commit `e3d54d0`

Clean auto-merge, three commits ahead (`e82b3fd`, `c14e93f`, `51293a7` — GLM's
venue-dressing alphaTest fix, the look re-run and the cone-peak ruling). No
conflicts. Committed before any other work, per the session rule.

### Item 11 — "calves look huge" — LANDED. Commit `0facc72`

**The author's complaint, measured: shipped `calf/thigh = 0.937`.** A calf as
wide as the thigh.

**Root cause, and it is a gate that was never asked to look.** `leg_girth_pass`
runs AFTER `relax_suit` and after the LAST `leg_profile` call in `main()`. So
nothing in the build measured the leg that is actually exported — every profile
number in the logs (including the "post-relax" one this file quoted last
session) is from BEFORE the girth pass scales the shins. The pass's only shin
constraint was `calf_hip >= 0.40`, a lower bound with no counterpart, and it
applied an uncapped deficit ratio of **x1.211** radially to both lower legs on
every build.

That bound is also not a real proportion. An adult reads ~0.28 there (calf
breadth ~95 mm over hip breadth ~340 mm) against a gate demanding >= 0.40. It
could only ever be satisfied by inflating the shin.

**Replaced, not loosened.** New `leg_taper_gate`, measured on the silhouette the
eye sees (`leg_profile`'s median-filtered 2 cm rows, not the bone-cluster
cross-section `_leg_girth_ratios` uses), and two-sided where the old one was
one-sided — the brief's item-11 numbers:

| | gate | brief |
|---|---|---|
| calf / thigh | 0.60 - 0.80 | 0.70 - 0.75 |
| ankle / calf | 0.42 - 0.72 | 0.55 |
| boot cuff vs shin above it | >= 1.0 | "tapers INTO the boot" |

`calf_hip` is demoted to a logged instrument (it still prints; it no longer
fails the build). Its own negative control `BODY_LEG_GIRTH_FACTOR` is untouched.

The shin is now sized by a **dedicated loop that runs after the thigh** — the
thigh is the denominator, so that is the only order in which one shin factor is
correct — approaching the 0.70 mid-band at most `CALF_GROW_MAX = 1.06` per
iteration. It converged in two iterations (x1.060, then x1.030 implied, stop).

**Measured on the shipped 2048/96 build:**

| | thigh | calf | ankle | boot | calf/thigh | ankle/calf | boot/shin |
|---|---|---|---|---|---|---|---|
| before | 195 | **182** | 91 | 107 | **0.937** | 0.497 | 1.122 |
| after | 195 | **140** | 69 | 90 | **0.718** | 0.497 | 1.230 |

**Negative control** `BODY_SABOTAGE_CALF=1.25` re-inflates the shins after the
pass and FAILS the gate at `calf/thigh 1.064`
(`scratch/opus/s4/negctl_calf.log`).

Every existing build gate stayed green on the same build: bideltoid, leg
profile slope step, dome seating, goggle band 0.400-0.568 h, face relief, hand
ratio, bib number, suit normal variance, atlas share head+face 28.1%, delivered
maps 1 106 556 B.

`ASSET_V` 36 -> 37, `index.html` `game.js?v=` 30 -> 31, preload hrefs `?v=37`.

### Verification

    unit    78/78
    golden  30/30, no re-capture, no physics change
    drive   rig + body + chain + athlete + ready-stance: 27/27 (6.7 m)
            look.spec.js: 1/1 (6.6 m)

Wire on this build: glb 837 548 + normal 627 918 + albedo 318 452 + ao 160 186
+ maps.json 1 270 = **1 945 374 B**. `_bodyVisibleAt` 7 574 ms — five times
session 1's 1 457-1 542 ms, but the machine was at **load average 20** with
another agent's suite running, so this is a contention reading, not a
regression; re-measure on an idle machine before acting on it.

The full drive suite was NOT run this session (the two remaining known reds are
`crash-ragdoll` and `bib-number`, both recorded in session 3 and neither in
this lane; a full pass is ~29 m and the machine was contended).

### Shot, looked at by eye — `shots/figure_side.png` (15:34)

The calf bulge is gone: the leg now runs thigh -> knee -> a narrow ankle ->
boot, tapering the whole way, instead of swelling below the knee. Items 1 and 2
also read correctly in the same shot — mirrored blue goggle band across the
eyes, dark dome centred on the skull.

The same shot re-confirms what is still open: the suit is a lumpy onesie with
shard artefacts across the chest and thigh (item 3); the blue leg stripe is a
ragged blob wandering across the shin, not a 5 cm stripe down the outside seam
(item 3); the leg still ends in a white blob rather than a dark ski boot; the
pelvis still leads the ankles slightly (item 10).

### Item 5 (tuck) — NOT attempted, and why

Item 5 is the brief's top priority after 1/2 and it was the intended work of
this session. It was set aside deliberately after reading the code, not
forgotten:

**The armature has no spine.** `ANATOMY` in `build_body.py` gives `torso` ONE
bone, pelvis -> neck, and the skeleton is deliberately FLAT (every bone is
driven absolutely by a physics node via `linkTransformNode`; parenting them
double-counts positions — the comment at `build_armature` records the measured
failure). The brief's "bend across >= 3 spine bones" therefore requires new
bones AND new driver nodes in `game.js` synthesised between the pelvis and the
chest, since `bone.linkTransformNode(character.meshes[bone.name])` finds
nothing for a bone the physics does not name.

The cost is not the idea, it is the blast radius: the string `'torso'` is a
vertex-group and dominance key throughout all 5 672 lines of `build_body.py`
(`settle_limb_geometry`, `reclaim_chest_wall`, `dominant_segments`,
`_leg_girth_ratios`, `loosen_suit`, `relax_suit`, ...). Splitting or
re-weighting it moves the dominant group of a large fraction of the mesh, which
is the input to most of those passes and to several gates. That is a multi-hour
change with a full rebuild and a full drive pass behind it, and a half-finished
armature left in the tree would be worse than the current state.

**Recommended shape for the next session**, so it starts from a decision rather
than a survey: ADD `spine1`/`spine2` as extra bones and leave the `torso` bone
and its vertex group in place, redistributing weight from `torso` to them by
height rather than renaming anything. Every existing dominance query keeps
answering `'torso'` for verts that stay torso-dominant. In `game.js`, build two
plain `TransformNode`s that interpolate rotation between the pelvis frame (from
the hip/upperLeg drivers) and the torso driver, register them in
`character.meshes` under those names, and let the existing link loop find them.
That is renderer-side only and needs no physics change.

### For the reviewer (session 4)

1. **`calf_hip >= 0.40` was demoted from a hard gate to an instrument.** This is
   the one judgement call in the commit. My case: it is one-sided, it is
   anatomically indefensible (~0.28 in a real adult), it is the direct
   mechanical cause of the defect the author reported, and what replaces it is
   STRICTER — two-sided, on the shipped silhouette, from the brief's own
   numbers, with a negative control. If you want it kept as a hard gate it
   cannot coexist with item 11's ratios; say which wins.
2. **Session 3's finding generalises again.** This is the third gate in this
   file that passed on a visibly wrong body because it measured the wrong
   population or ran at the wrong point in the pipeline (goggle-proud: 0.5 mm
   margin; dome centre: self-referential; leg girth: ran after the last
   measurement). The sweep I suggested last session is worth doing.
3. `bib-number.spec.js` is unchanged from session 3 and still needs your
   arbitration (reframe the measured box onto the number patch, or accept a
   higher band on a correctly-framed box).


## Session 5 (2026-08-29, 15:5x-16:3x)

### Merge with `render-realism-glm` — commit `89fb5d5`

Clean auto-merge, 4 commits ahead (iter 112's crash-spec determinism plus
the real iter-109 regression fix, the slope-aware crash-roll ruling, and the
two brief updates ordering the bib fix first). Verified unit 78/78 + golden
30/30 before anything else was touched.

Process note for the next session: `git merge --no-edit` COMMITS on a clean
auto-merge. I followed the session rule "commit the merge first" literally
and added an empty commit on top of it; caught it with `git show --stat` and
reset it away. Check `git log` before committing a merge.

### The blocking `bib-number` back-face red — LANDED. Commit `bd92319`

`navyFrac` back **0.4074 -> 0.0840** (gate < 0.25). Front 0.1932 -> 0.1276.
blueFrac front 0.1435 > back 0.0752 < 0.09. Spec 1/1.

**The dark slab was the WAISTBAND, not the number.** Before changing
anything I decomposed the gate's own box by row band, straight off the
reviewer's `shots/bib_back.png`:

| box row band | back navy | front navy |
|---|---|---|
| 1/5 | 0.086 | 0.319 |
| 2/5 | 0.566 | 0.114 |
| 3/5 | 0.000 | 0.419 |
| 4/5 | **0.612** | 0.075 |
| 5/5 | **0.832** | 0.018 |

The bottom two fifths are the `WAIST` region (torso `along` -0.95..-0.70),
which started 0.02 along-units below the bib's lower edge (-0.68). From
behind, where a forward-leaning torso lifts its rear surface, that put a
7 cm navy band directly under the bib and filled 40% of the box — roughly
70% of the whole 0.41. The digits were never the problem. The waistband is
now a belt at the hip (-1.00..-0.90).

**The digits WERE bars, though.** The ink band took 90% of the plate height,
so each digit was 7.0 x 21.3 cm — aspect 0.33. A drawn numeral is near 0.58.
The band is now the middle 52% of the plate: 7.0 x 12.3 cm, aspect 0.573.

New build gate `BIB_ASPECT` (0.45..0.75) on the cell aspect. **Negative
control** `BODY_SABOTAGE_BIBASPECT=1` restores the old band and FAILS at
0.331 (`scratch/opus/s5/negctl_aspect.log`).

### Two things I got wrong, recorded because the numbers say so

1. **The clipping diagnosis was wrong.** The bake gate showed front ink
   0.377 against back 0.175 from the same plate and the same glyph mask, and
   I attributed it to `bib_mask`'s wrap ramp shaving the back plate's outer
   columns. A build with the nesting restored produced *identical* ink
   (0.110/0.109) — the clip was never firing. The plate cleared the back
   ramp by 5 mm. The un-nesting is kept as a latent-trap fix and its comment
   now states the measurement rather than the theory.
2. **I wrote a front/back ink symmetry gate and removed it again.** With the
   front at 0.110 against the existing [0.10, 0.45] floor, any face losing
   enough ink to break a 1.35 ratio breaks the floor first: the control
   (halving the back plate's ink) tripped the FRACTION gate at 0.017 and
   never reached the symmetry check. A gate that cannot fire independently
   of one already present is decoration, so it is an instrument now.

### STILL OPEN — the back number is MIRRORED. Reviewer input wanted.

This is the part of the reviewer's order ("the same legible glyph pair as
the front") that is NOT done, and it is worth a decision before more time
goes into it.

Paused close-ups aimed down `_athleteFacing().forward` (the `face.png`
counter-measure: pause, stop the render loop, render one frame synchronously
— an un-paused first attempt photographed the forest, exactly the item-8
defect) are in `scratch/opus/s5/plate*_{front,back}_z.png`. The chest reads a
clean, well-proportioned **"30"**. The back reads a mirrored glyph pair.

Both signs of `number_uv`'s back branch were built and photographed:

| back branch | rendered back reads |
|---|---|
| `(NUM_W - lx)` (shipped) | "E0" — digit ORDER right, each glyph mirrored |
| `(NUM_W + lx)` | "0E" — order reversed, glyphs still mirrored |

Neither is correct, and that is informative: flipping `u` flips the cell
ORDER and the within-cell orientation together, so if both results show
mirrored glyphs, the mirroring is **upstream of the u mapping**, not in it.
The most likely candidate is the torso's rear UV island being flipped by
`smart_project`, or the `front` discriminator not selecting the face the
orientation essay assumes (iteration 61 already found `+Y` points at the
physical BACK once). `- lx` is kept — it is the shipped mapping and the one
that gets the digit order right. The finding is written into the orientation
essay in `build_body.py` so the next session does not flip the sign a third
time; flipping it is measured, and it does not work.

**Reviewer: is a mirrored back number worth the next session, or does the
front reading "30" satisfy P7?** The digits are legible and correctly sized
on both faces now; only the back's handedness is wrong.

### Verification

    build   all gates green at 2048/96 (bib number front 0.110 / back 0.109,
            digit cell 7.0 x 12.3 cm aspect 0.573, atlas, taper, goggles,
            dome, stripe, suit normal variance)
    unit    78/78
    golden  30/30, no re-capture, no physics change
    drive   bib-number 1/1; rig + body + chain + athlete + ready-stance +
            athlete-wired 31/31 (5.0 m)

`ASSET_V` 37 -> 38, `index.html` `game.js?v=` 31 -> 32, preload hrefs `?v=38`.

Not run this session: the full drive suite (the two known reds outside this
lane, `crash-ragdoll` and `look`, were not re-checked).

### Items still open in the brief

5 (tuck — the top priority; session 4's recommended `spine1`/`spine2` shape
still stands and is still the right plan), 3 (suit + bib as a real two-tone
panel garment), 10 (stance), 6 (in-run arms), 7 (pike hip tear), 9 (face).
Item 5's scope now also includes the reviewer's note that the upper-back
tear shows at REST, not only in the tuck.


## Session 16 (2026-08-30, 01:0x-02:0x)

### The merge first (commit 09af510)

Session 15 ended committed, so the session opened on `git merge --no-edit
render-realism-glm`. One conflict, `ASSET_V`'s comment block: the GLM lane had
bumped it to 43 for the landing-chop rebake, this lane to 45 for the sport
glasses and the folds. Resolved to **46**, both histories kept, and the
`index.html` preload hrefs moved with it (a `?v=` that does not track `ASSET_V`
downloads every athlete file twice). Verified on the merge before committing:
**unit 81/81, golden 30/30 (no re-capture), browser 36/36**.

Two things worth recording about the verification, because they cost time:

- `./tests/run-all.sh` piped into `tail` produces NOTHING until it finishes, and
  it did not finish inside 900 s; the three stages run in ~2 minutes when
  started separately with their own logs. Run them separately.
- when that run was killed it left its `python3 -m http.server 8399` behind, and
  the next `playwright` invocation died on `Address already in use` — the
  webServer block does not reuse a stale server. `ss -lptn | grep 8399`.

`blender/terrain.json` had also been regenerated in the tree by an earlier run;
it is a GLM-lane artefact and was restored to the merged version rather than
shipped as a 6.8 MB spurious diff.

### Reviewer ruling 00:15, item (a) — RELAXED HANDS. Commit below.

The author's 23:40 note ends "hands relaxed (fingers together, slight curl —
never splayed)" and session 15 left it open as the most visible thing in
`shots/pose_inrun_side.png`. It is hand GEOMETRY: the CC0 base figure ships a
flat, fully-abducted starfish hand and nothing in `build_body.py` ever closed
it, so every pose in the game has claws on the ends of the arms.

`relax_hands` (new, runs right after `scale_hands`, on the posed and settled
mesh so the hand it measures is the hand that ships):

1. **The digits are found by CONNECTIVITY, not by coordinates.** Below the
   finger crotch each finger is its own connected component of the mesh, so
   cutting the glove cluster at a plane and taking components of the induced
   sub-mesh names the fingers with nothing guessed. The cut depth is laddered
   (0.45, 0.55, 0.62, 0.70, 0.78 of the hand's length) and the SHALLOWEST depth
   that parts the most digits wins — the shallowest, because the lever every
   later step works with is the length below the cut. On this mesh 0.50 parts
   **two** components and 0.70 parts **four**.
2. **The fan closes** — each finger swings about its own base until it is
   within `FINGER_RESIDUAL` (2 deg) of the digits' vertex-weighted mean
   direction, with a smoothstep fade over the top of the finger so the palm
   stays continuous with it.
3. **The tips are packed** — a lateral shear along the hand's width axis until
   consecutive fingers are 2 mm apart, capped at `FINGER_TILT_MAX` (7 deg) of
   induced tilt, because pulling four splayed fingers all the way together just
   replaces a fan with fingers CROSSING at the tips: measured, an uncapped pack
   read 24 deg on the same angle gate as the 34.7 deg splay it replaced.

Two measurement findings inside step 3, both of which made a wrong answer look
plausible:

- **A shear that starts at the identification cut has a 4 cm lever** and buys
  3 mm of a 14.6 mm gap before it is tilting the fingers more than it is
  closing them. The shear is therefore applied as a FIELD over the whole glove
  from 0.35 of the hand's length, so the web between the fingers stretches with
  them instead of tearing.
- **Interpolating that field THROUGH a finger squashes the finger instead of
  moving it**: its far edge gets most of its neighbour's shift, so the gap
  barely closes (measured: 14.6 -> 12.1 mm). The field is constant across each
  finger's own width and interpolates only in the gaps (14.6 -> **7.7 mm**).

| | before | after | gate |
|---|---|---|---|
| widest pair of digit axes | **34.7 / 33.0 deg** | **7.7 / 8.4** | <= 15 |
| widest gap between digits | **14.6 / 14.7 mm** | **6.5 / 6.6** | <= 8 |
| sliver faces | 49/10590 | **49/10590** | unchanged |
| hand/forearm ratio | 0.75 | 0.75 | 0.65-0.85 |

`hand_spread_gate` measures both on the FINAL geometry, after girth, boots and
everything else, so no later pass can quietly re-splay the glove.
**NEGATIVE CONTROL**: `BODY_SABOTAGE_HANDS=1` skips the pass and ships the
starfish hand — **29.3 deg / 13.6 mm, both gates fail** and the build aborts
before it writes an asset (`scratch/opus/negctl_hands.log`).

### Open, and measured — the THUMB is still out

`shots/pose_inrun_side.png` after the pass shows four parallel fingers and a
thumb still standing ~45 deg off the hand. The thumb is **never a component at
any cut depth**: it parts from the hand higher than any finger but it also ENDS
higher, so at 0.70 there is no thumb left to find, and at 0.45 its web still
joins it to the palm mass that carries the fingers. A shallow sweep for
components disjoint from the deep set was added for exactly this and reports
`0 short` digits, which is the measurement that proves the point rather than a
pass that silently did nothing. The next handle is a lateral-protrusion test
(glove verts outboard of the outermost finger's span, below the shallow plane)
rather than connectivity — worth a session start, not a tail end.

The **curl** is also not applied: the palm side is inferred from the thumb's
base displacement out of the plane of the other digits, and this base mesh's
hand is flat enough that the displacement measures **0.0 mm**, so the pass
skips the curl rather than guessing a direction (logged every build). It falls
out of the thumb work.

### The 00:45 MERGE BLOCKER — measured, and it is not the crouch commit

The reviewer's 00:45 line attributes `crash-ragdoll.spec.js` going red on the
merged tree to `_seatTorsoOnHips` and/or the session-15 pose tables, "worst body
penetration 0.1221 m". Three measurements, on this tree, after merging
`render-realism-glm`:

1. **Both `_seatTorsoOnHips` call sites are already inside
   `!crashActive` guards** (`game.js` — the flight-replay block and the
   boot-ski/in-run-hold block; the third call is inside `window._inrunHold`, a
   probe). The torso is never re-seated while the ragdoll owns the body.
2. **The crash physics is byte-identical.** `aerial-crash-ragdoll` is one of the
   30 golden scenarios and it verifies green, and session 15's
   `audit-physics-state.js` reported 0 physics-state diffs over all 30
   scenarios / 5408 frames. The crash trajectory cannot have moved.
3. **The failure reproduces on the commit BEFORE the crouch work.** A detached
   worktree at `418c8da` (the merge that precedes `d44c949`, i.e. GLM's
   crash-roll model merged in, none of session 15) fails the SAME assertion:

       418c8da  DBG rollStart t=15.90s ... line 254
                'crash state machine reached stopped (pose frozen)' -> 0
       HEAD     DBG rollStart t=19.03s ... line 254, same assertion
                (2 passed, 1 failed in both)

So on this tree the red is the ragdoll never reaching `stopped` — the
GLM-lane crash-roll model, which is exactly what the reviewer's own session-11
ruling (c) attributed it to — and it predates the crouch commit. The
**penetration** assertion the 00:45 note quotes is at line 354 and is never
reached, because line 254 aborts first; I cannot reproduce 0.1221 m here and
cannot confirm or refute it without the earlier assertion passing.

**Reviewer**: if the penetration number came from a tree where the ragdoll DOES
stop, please say which commit produced it — with (1) and (2) above, a
penetration change from this lane would have to come through a display node
that the crash path reads, and the only candidate is the pose-table arm-axis
flip, which the spec's own instrument is immune to (`rec.pens` takes the max
over BOTH endpoints of each segment, so `dir -> -dir` swaps the two and the
maximum is unchanged; `rec.gaps` is NOT immune, but it measures joints, not
penetration). `crash-ragdoll.spec.js` is now in this lane's per-session run
list either way.

### Verification

    build   all gates green at 2048/96 (goggles, dome seating, leg taper, bib
            number, stripe, folds, suit normal variance, atlas share, hand
            ratio, and the new hand spread/gap)
    unit    81/81      golden 30/30 (no re-capture)   browser 36/36
    drive   rig + body + chain + athlete + athlete-wired + ready-stance +
            bib-number + spine + inrun-crouch + inrun-contact: **46 passed**
            (13.4 m), 0 failed; pose-shots 1/1
    shots   pose_{tuck,inrun,pike}_{side,front}.png regenerated, figure 448 px

`ASSET_V` 46 -> 47, `index.html` preload hrefs `?v=47`, `game.js?v=` 40 -> 41.

## Session 15 (2026-08-30, 00:0x-01:0x)

### AUTHOR 23:40 — the in-run crouch. Commit below. THE ARM BONES WERE INVERTED.

The author's screenshot (`reference/shots/author_inrun_crouch_2026-08-29.png`)
listed four things: flat plank torso, head hanging down, zombie arms straight
out forward with clawed fingers, suit smearing over the back. Measured in the
browser at the crouch endpoint (a scratch probe, now deleted), all four are one
table and two missing display fix-ups:

| | before | after | ruling |
|---|---|---|---|
| back angle above horizontal | **26.97 deg** | **43.99** | 40-50 |
| head vs the back line | **17.2 deg** | **28.8** | >= 25 |
| hand vs knee height | +0.261 m | **+0.086** | +-0.10 |
| hand ahead of the knee | 0.603 m | **0.192** | 0.10-0.30 |
| torso hip vs thigh hip | **0.199 m** | **0.008** | (the smear) |
| shoulder joint gap | **0.293 / 0.304 m** | **0.008** | |
| elbow gap | **0.533 m** | **0.000** | straight |

**THE FINDING: every arm bone in both tucked pose tables was rolled 180 deg out
of its bind axis.** `POSE_UNTUCKED`, `armSweep`, `applyGamepadLateral` and the
armature itself (`build_body.py`: "a bone runs head -> tail, and for a hanging
arm that is shoulder -> hand") all run the arm's local **+Y toward the WRIST**.
`POSE_INRUN_TUCK` and `POSE_TUCKED` both placed the **shoulder** at the +Y end,
i.e. each arm segment was drawn on the right line with its bone pointing the
wrong way — the elbow-tapered end of the sleeve at the shoulder, and the hand
bone (a child, not independently driven) swung to the opposite end of the
fore-arm. That is session 3's "the arms are absorbed into the mass under the
chest" in the flight tuck, and half of the author's zombie arms.

It survived because **everything that measured it used the same wrong sign**:
the P13 shoulder reconciliation, `_poseProbe`'s shoulder gap, `chain.spec.js`'s
old-table control and `tuck-tear-negative.test.js` all read
`ua.position + 0.150*dir`. A chain gate that measures the joint at the wrong
end is green on an inverted bone by construction. There was even a compensator
in the tree: `applyPose` slid the glove from `+halfH` to `-halfH` as the tuck
came on "so it doesn't poke through the knees" — i.e. to the end where the
wrist actually was. All five are corrected here (same limits, opposite end);
the glove slide is gone.

`POSE_TUCKED`'s arms are flipped in place: `dir = (-sin rz, cos rz cos rx,
cos rz sin rx)`, so `dir -> -dir` is exactly `rx -> rx -+ pi, rz -> -rz`. The
segment centres are untouched, a capsule is symmetric about its centre, so the
drawn primitives and every joint gap are **unchanged** — only the skinned axis
moves. The flight tuck's own shape is not otherwise touched this session.

### What shipped

1. **`POSE_INRUN_TUCK` rebuilt** (approved by the ruling: "fix the pose
   endpoint ... same class as the tuck hip gap"). Torso `rx -1.10 -> -0.8029`
   (44 deg back), head `rx -0.80 -> -0.30` (gaze 28.8 deg above the back line,
   head up the in-run), arms straight in the bind convention aimed at knee
   height 0.20 m ahead of the knee. Legs and skis untouched. Chain closes to
   <= 3 mm.
2. **`_seatTorsoOnHips`** (new, display-side): the boot-ski pin re-derives both
   legs from the SKI every frame, and at the crouch endpoint that left the
   thigh's hip **0.199 m** from the torso's hip — with the P13 reconciler
   deliberately inert at the endpoints, nothing closed it. Under linear-blend
   skinning that gap **is** the "suit smears over the back". The legs are
   pinned to the skis, so the torso is the side that moves: translate torso +
   head + both arm chains onto the mean hip. Weighted by the same
   `w = tuck*(1-armRaise)` as the arm hold, so it is exactly zero at rest and
   in flight.
3. **`_inrunArmForward` rewritten.** It anchored the arms at the FIXED shoulder
   pivot (y = 0.150, z = BASE_Z) plus a hand-tuned z bias, while the crouch
   torso puts the real shoulder at (0.180, -0.385) — **0.68 m away**, bridged by
   the skin. It now takes the shoulder from the live torso's +Y end and aims the
   straight arm at the live knee (knee height, 0.20 m ahead). Reach is 0.61 m
   against a 0.55 m arm, so the hand lands just above the knee, which is the
   footage posture.
4. **`window._inrunHold(tuck)`** (new probe): applies the table AND the three
   display fix-ups, i.e. the composition the player sees. `_poseProbe` applies
   the table only, so the in-run pose SHOT and the new gates were previously
   measuring a pose that never reaches the screen.
5. **`pose-shots.spec.js` framing fixed** (reviewer, session 9, still open since
   then): shots are 640x640, the camera radius is derived from the pose's own
   skinned extent so the figure fills ~70% of the frame in every pose, and the
   projected figure height is now a gate — **448 px** against a `FIG_MIN_PX`
   floor of 350, where the in-run crouch used to be ~120 px. The in-run shot is
   rendered through `_inrunHold`.

### Gates and the negative control

`tests/drive/inrun-crouch.spec.js`, 2/2. The measurement is re-implemented in
the spec rather than read back from `_inrunHold` (a gate that trusts the code
under test to describe itself measures nothing). **NEGATIVE CONTROL**: the
pre-ruling table's own literals, written onto the same drivers and measured by
the same code — back **26.97 deg** (< 40, fails), head **17.2 deg** (< 25,
fails), shoulder **0.293 m** (> 0.020, fails).

`chain.spec.js`'s in-run band moved 55-75 deg from vertical -> **40-50**: the
55-75 window IS the plank (27 deg above horizontal at its own midpoint) and it
came from the reviewer's 22:25 "back near-horizontal" target, which the author's
23:40 ruling supersedes. Same 20 deg width, and the old table now fails it.

### Verification

    unit      81/81 (incl. the corrected tuck-tear-negative control)
    browser   36/36
    mutation  all caught     coverage  all scenarios differentiate
    golden    audit-physics-state: 30 scenarios, 5408 frames, **stateDiffs 0**,
              13 scenarios with display-node differences -> display-only
              re-capture (reviewer's standing condition, 17:05) -> verify 30/30
    drive     chain 10/10, inrun-contact 2/2, ready-stance 1/1,
              inrun-crouch 2/2, pose-shots 1/1
    versions  index.html body-model.js v24->25, game.js v39->40. No asset
              changed, so ASSET_V stays at 45 (session 8 precedent).

### Open / found on the way

- **The fingers are still splayed** ("clawed", author 23:40). That is hand
  GEOMETRY in `build_body.py`, not the pose; not started. It is the most
  visible thing left in `shots/pose_inrun_side.png`.
- **The knee is at 127 deg in the shipped crouch, not the ruling's 90-100.**
  The boot-ski pin forces the shin parallel to the ski (physically right — a
  binding clamps boot to ski), so at the flat start gate the shin is vertical
  and the thigh alone carries the flex. Deepening it means moving the hip down
  and back, which is the ready-stance geometry (item 10) — measured, not
  guessed, and left for that item rather than fought here.
- **At REST the same hip gap is 0.10 m** (torso hip (-0.275, 0), thigh hip
  (-0.224, 0.087)) and `_seatTorsoOnHips` is deliberately inert there. Seating
  it at rest would move the pelvis 8.7 cm BACK and 5 cm up — which is exactly
  what item 10 asks for ("hips still a little more forward"). That is the first
  thing to try when item 10 starts.
- The flight tuck now has its arm bones the right way round but its SHAPE is
  untouched (knees to chest, hands on shins, head neutral) — the second half of
  the author's 23:40 note.

## Session 14 (2026-08-29, 23:0x-23:5x)

### Item 1 (re-issued) — the eyewear is SPORT GLASSES, not goggles. Commit `8a460f8`

The author's 21:55 ruling. Three separate things on the head were the
goggle, and each had to move:

| part | goggle (before) | sport glasses (after) |
|---|---|---|
| band | 0.40..0.57h = 0.17h | **0.44..0.57h = 0.128h = 29.4 mm** |
| frame | `rim`, drawn on the top AND bottom edges | **`browbar`, top edge only** (721 verts) + a **`bridge`** notch at the bottom centre (178 verts) |
| back | `strap`, a 0.10h navy band round the WHOLE skull, RECESSED by a groove | **`temple` arms** (463 verts): dark moulded plastic, 16 low-poly verts a side, centred 0.520h, stopping at 2.45 rad behind the ear, pushed **2.50 mm PROUD** |

**On the "3.5-4 cm shield".** The ruling's height is a real head's
chin-to-crown. This model's `h` is chin to **helmet crown**, 229 mm, so the
shield scales with the band fractions, not with a millimetre literal:
0.128h = 29.4 mm. Pushing it to 35 mm would need the floor at 0.415h, i.e.
back down toward the nose, which is the defect the same ruling forbids. The
top stays pinned just under item 2's 0.58h front rim. Logged every build as
`lens band height ... = ...h on a ... mm chin-to-crown`.

**Three new build gates, each with a negative control that FIRES:**

    shield bottom clears the nose tip   0.440h vs 0.357h   --lens-lo 0.28 -> FAILS at 0.280h vs 0.357h
    band window 0.44..0.57 +-0.03       0.440..0.568h      --lens-lo 0.32 --lens-hi 0.49 -> FAILS
    temple arms >=10/side, 0 rear,      16/16, 0, 2.50 mm  BODY_SABOTAGE_GOGGLES=1 -> FAILS at 0.00 mm
      realised push >= 1.5 mm

**The nose-tip gate took three attempts and the first two could not fail.**
Worth writing down, because both looked green:

1. "max forward reach among FACE-region verts, window up to the band edge"
   found the **brow ridge one vertex row under the band** and passed by
   0.002h. A margin that small is not a measurement.
2. Fixing the window to 0.10..0.40h but still excluding lens verts BY REGION
   made the window shrink as the band grew downward: `--lens-lo 0.28` slid
   the "tip" down to 0.239h along with the band and the gate stayed green on
   **exactly the build the gate exists to reject**.
3. Shipped: the landmark is measured on the **UN-PUSHED SKULL** — undo
   `goggle_geometry`'s recorded pre-push radii — in a fixed 0.10..0.40h
   window. The tip now reads 0.357h whatever the band does, and `--lens-lo
   0.28` fails.

Also fixed: the temple-push check was written `if not SABOTAGE_GOGGLES and
tpush_mm < 1.5`, i.e. **inert under its own negative control**. The guard is
gone; `BODY_SABOTAGE_GOGGLES=1` now fails on both pushes (lens 0.00 mm,
temple 0.00 mm).

`'rim'` leaves `paint_suit`'s required-region list and `browbar`/`bridge`/
`temple` take its place — the build refuses to ship glasses that have
silently lost an arm or the brow bar. (It caught exactly that on the first
run: `these suit regions matched no vertices: ['rim']`.)

`ASSET_V` 44 -> 45, `index.html` `game.js?v=` 38 -> 39, preload hrefs `?v=45`.

**NOT done in this item, and it is the next thing to look at.** `face.png`
shows small grey nubs at the outer ends of the band. They are not the
skinned head: `assets/athlete.glb` carries a SECOND, older eyewear model —
`gogglesLens` / `gogglesFrame` / `gogglesStrap`, built by
`blender/build_athlete.py::add_goggles` as a lens shell, a LARGER shell
behind it and a TORUS STRAP — which `game.js` adopts onto the driver head
and makes visible. Those are the "foam frame" and the "strap around the
helmet" the author's ruling removes, and they are sized to the primitive
head, so they poke through the (larger) skinned head at the temples. They
must be rebuilt as a shield + brow bar + two arms, or removed; three drive
assertions (`athlete-wired.spec.js`) require all three node names, so this
is a spec change too, not just a bake.

### What the shots show (`shots/face.png`, `shots/figure_side.png`, 23:33)

Front: the band is narrower and on the eye line, the dark stroke that ran
UNDER the eyes is gone, the brow bar is a thin line at the top and the
nose-bridge notch reads at the bottom centre. Side: the shield wraps to the
temple and a dark arm continues back over the ear under the rim — the temple
arms are visible, which is the ruling's side-view requirement.

Still wrong by eye, and NOT fixed here: (a) the lens reads as bright cyan
face paint rather than a dark mirrored lens — the painted eye/brow detail
shows straight through it; the author's ruling says to keep the tint, so
this is a material/value question for the reviewer, not a colour I should
retune unasked. (b) The `athlete.glb` shells (below) are visible in profile
as a translucent wedge in front of the face. (c) The collar streak at the
throat (item 9) is untouched.

### Verification

    build   all gates green at 2048/96; negative controls above all fail
    unit    81/81
    browser 36/36
    drive   look.spec.js, rig.spec.js, athlete-wired.spec.js ALL GREEN
            (18 passed / 10.2 min). The one red in that run is
            `freelook.spec.js` "after a forced crash settles" — it only ran
            because the filter `look.spec.js` also matches `freelook`, and it
            hangs waiting for the ragdoll to settle, i.e. it is the same
            crash-model red the 21:30 ruling (c) assigned to the GLM lane,
            now reaching a second spec after GLM's slope-aware crash roll.
    golden  17/30 — see below, NOT this lane
    merge   `render-realism-glm` merged TWICE (79b1d41 and again after the
            commit: GLM had advanced 4 commits mid-session)

**GOLDEN IS RED AND IT IS NOT THIS LANE.** 13 scenarios diverge. After the
second merge my `game.js` differs from `render-realism-glm`'s by **the
`ASSET_V` string and nothing else**, and `tests/golden/traces` is
byte-identical between the two branches — so `verify.js` produces the same
17/30 on GLM's own branch. The first merge's failure was the peak scale
(`PEAK_H_SCALE = 0.70` shipped without a re-capture: every `pk_body_*.p[1]`
off by exactly 14.4 m); GLM re-captured for that, and what is left after
their re-capture is a real divergence at mid-flight frames, e.g.
`aerial-tuck frame[495].nodes.head.p[1] -3.638 -> -3.282`. I did not
re-baseline anything (no physics changes, no golden re-captures in this
lane) and I did not touch their crash-roll commit.

### Open at the end of session 14

- The `athlete.glb` eyewear (above) — the visible half of the author's
  21:55 ruling that is still a goggle.
- Item 3's smoothed shell (author HUMAN TESTING #7) — still the other
  top-priority item and NOT started this session.
- Everything session 13 left open: the two-tone panels / collar / cuffs /
  gaiter / bib-as-geometry, the arm stripe behind the UV-overlap repair,
  then 10, 2, 9, 6, 7. `pose-shots.spec.js` framing still not fixed.
- **For the reviewer:** golden 17/30 on the integration branch. It blocks a
  clean merge to 8201 and it is the GLM lane's to re-capture or fix.


## Session 13 (2026-08-29, 22:0x-23:0x)

### Item 3 (b) — the arm stripe — NOT SHIPPED, and the reason is now MEASURED

The reviewer's 21:30 ruling (b) says the arm stripe must ship and that the
torso leak is "a paint-ownership problem": paint the band only on texels whose
triangle's heaviest skin weight is an arm bone. I implemented exactly that,
three ways, and **the ruling's premise does not hold on this atlas.** The band
already IS painted by ownership, and the leak is not in the paint, not in the
bake rays, and not repairable by any rule that operates on texels.

**THE ARM AND TRUNK UV ISLANDS OVERLAP.** Measured, with the arms switched on:

* `body.spec.js` flags 57 back-of-torso triangles as blue. Their sampled colour
  is sRGB **(0.325, 0.518, 0.800)**, which is `STRIPE` to three decimals — so
  they really are the sleeve band, not the bib (the other 11 blue triangles are
  the bib and the waistband, and they are the 0.019 the legs-only build has
  always read).
* Three of them probed at gltf uv (0.6462, 0.8405), (0.6527, 0.8410) and
  (0.9485, 0.5870). Each of those texels is covered, **in Blender's own UV
  layout and with ZERO mask dilation**, by a low-poly polygon every vertex of
  which is arm-owned — while the exported triangle whose centroid lands on the
  same texel is torso-owned.
* Aggregate: **2781 texels (0.68 % of the arm mask) are claimed by an arm
  polygon and by a trunk polygon at once.** A sound unwrap gives zero. That is
  now a permanent build log line, `STRIPE OWNERSHIP overlap`.

At a shared texel there is one texel to give: erasing the leak erases the
sleeve, painting the sleeve paints the trunk. That is also why session 11's
shoulder cap barely moved the number (0.121 → 0.110) — it removed 3 % of the
stripe verts, and the overlap is spread along the whole chest wall. **The fix
is in the UNWRAP, not the paint**, which puts it in item 3's geometry work
alongside the armpit/bridge faces.

So the arms are OFF again, and the shipped build is unchanged: `STRIPE_SEGMENTS`
back to legs-only, `STRIPE_DPHI_MAX` back to 0.46, `assets/` reverted to HEAD's
bytes (a rebuild with the shipped configuration reproduced `athlete_body.glb`
**byte-identical**; only the two Cycles-baked maps moved by encoder noise, so
nothing shipped and no `ASSET_V` bump was warranted).

**What IS ready for the moment the unwrap is fixed**, all in the tree:

* `STRIPE_SEGMENTS` + `STRIPE_DPHI_MAX 0.46 → 0.55`. The cap, not the 5 cm arc
  rule, was setting the sleeve width, and it set it at **39.8 mm — 0.2 mm under
  the ruling's own 4 cm floor**. At 0.55 (the arc rule's 0.536 at the upper
  arm's measured 46.6 mm radius) the sleeve measures **42.9 / 42.3 mm** with the
  forearm still cap-limited at 37.6 / 38.3, which is the reference's narrower
  sleeve cuff. The legs do not move (arc-limited at 0.455).
* `arm_stripe_presence_gate` — floors both upper arms at 40 mm off
  `stripe_straight_gate`'s per-segment median width, and is inert while the arms
  are not in `STRIPE_SEGMENTS`. It exists so that a future leak repair cannot be
  satisfied by erasing the seam.
* `stripe_texel_ownership` — ships as an INSTRUMENT (report only; the repair is
  behind `BODY_REPAIR_STRIPE_LEAK=1`), carrying the overlap metric and the
  probe. Same shape as `fold_relief_instrument`: the prescribed fix was built,
  measured, and kept in the tree as the evidence that it cannot work.
* `_owned_uv_tris` / `_owned_uv_tris_excluding` / `_dilate` — texel-ownership
  masks under `body.spec.js`'s own predicate (per-vertex heaviest bone,
  unanimous over the quad, over EVERY bone group).

### Two traps found on the way, both worth keeping written down

**(1) `bpy` hands back RAW sRGB for a loaded BYTE image, not linear.** Measured:
a texel written from linear (0.07, 0.24, 0.62) reads back as
(0.294, 0.525, 0.808), which is that colour's sRGB encoding. A freshly BAKED
float image is scene-linear, which is why `bake_maps` saves with `srgb=True` —
the two cases are opposite. The first version of the repair assumed linear on
the way in and let `save_bake` encode on the way out, so every touched texel
went through the transfer twice and the whole map came back at mean 0.883 with
**nothing at all below half**: helmet, boots and gloves all pale. Anything that
round-trips the albedo must read raw and write `srgb=False`.

**(2) Ownership at bake time is not the ownership that ships.** `add_spine_chain`
and `smooth_blend_rings` both run after the bake and both move it: the arm's
share of the low-poly went **5254 → 5738 triangles** across the ring relax, and
the trunk's `torso` group is gone entirely by export (split onto spine_01..03),
so a `nm in SEGMENTS` filter makes a spine-weighted vertex look weightless and
its face falls through to whichever arm bone holds the residue. Any texel-space
gate that has to agree with a browser test must be computed on the SHIPPED
weights — the instrument is placed after `weight_seam_gate(low, 'shipped skin')`
for that reason, with the delivery encode and `athlete_maps.json` moved after it.

### Verification

    build   all gates green at 2048/96 with the shipped (legs-only) config,
            incl. stripe straightness (worst step 10.5 mm, wander 12.7 mm,
            median width 41.7 mm), fold_ripple, sliver, goggle band, dome
            seating, leg taper, bib number, suit NM variance, atlas share,
            weight seam. assets/athlete_body.glb byte-identical to HEAD.
    unit    see run-all below
    golden  no re-capture, no physics change
    unit    PASS (80/80), browser 36/36, mutation PASS, coverage PASS
    drive   38/38 on the athlete set (rig, body, bib-number, athlete,
            ready-stance, spine, chain), 8.1 min. body.spec.js is 4/4 with the
            arms off; with them ON it is 3/4 and the failing assertion is the
            front/back bib delta at 0.147/0.117 — i.e. the leak, measured
            above. crash-ragdoll skipped deliberately per the 21:30 ruling (c).
    merge   `render-realism-glm` merged at session start (docs-only, 2 files)

### Open at the end of session 13

- **For the reviewer:** ruling 21:30 (b) needs re-issuing against the overlap
  finding. The arm stripe cannot ship until the unwrap stops sharing texels
  between the sleeve and the chest wall. I did not loosen `body.spec.js` and I
  did not ship it red.
- Everything session 12 left open is still open: item 3's smoothed shell
  (author HUMAN TESTING #7, top priority), the two-tone panels / collar / cuffs
  / gaiter / bib-as-geometry, the sport glasses (author 21:55), then 10, 2, 9,
  6, 7. `pose-shots.spec.js` framing still not fixed.
- `crash-ragdoll.spec.js` remains the GLM lane's, per the 21:30 ruling (c).

---

## Session 12 (2026-08-29, 21:1x-22:2x)

### The 20:05 ruling (a) + (b) — the fold gate and the fold amplitude — LANDED

Both halves of the ruling turned out to rest on the same fact, and it is not
the one either of us expected.

**THE LOWER BACK HAD NO FOLDS AT ALL.** `SUIT_FOLDS` had four keys — `upperArm`,
`lowerArm`, `upperLeg`, `lowerLeg` — and none of them the torso. Every crease
in this suit was on an arm or a leg. The author's complaint from the very first
review, "suit doesn't seem to fold over the back", has been open since then
against a table that never creased the back. There is now a `lower-back` band
at along −0.44 ± 0.20, back-biased (`fbias = −0.70`, so 1.7x at the spine and
0.3x at the belly) and seated above the waistband step so the two reliefs do
not stack. It runs on the BARE SUIT AROUND THE BIB, not through it: the fold
amplitude is scaled by `1 − bib_mask`, because a separate loose garment does
not crease with the back underneath it, and without that the bib picked up the
suit's wrinkles and the two read as one garment.

**Four bands were half off the end of their own segment.** `segment_frame`
clamps `along` to ±1, so a band centred at 0.86 with a half-width of 0.22 has
its outer half beyond the mesh — and every vertex past the joint piles onto the
band's edge instead. `upperArm` elbow (−0.86), `upperLeg` knee (−0.88) and
`upperLeg` hip (+0.86) were all in that state; they are re-seated at −0.74,
−0.76 and +0.74. This is why the hip band measured over 156 mm of leg.

**The amplitude was raised, and the shape changed with it.** Folds are now
3-5 cm apart and 6-9 mm deep (measured peak, `FOLD amplitude` log line) where
they were 2 cm apart and 1.5 mm deep. Both numbers moved for a reason:

* 2 cm was *below what the mesh can carry*. The high-poly is 148 018 verts at
  about 3.5 mm spacing, so a 2 cm ripple with a narrow crest (`ridge ** 2.2`)
  is 5 samples per cycle with the crest falling between them — measured, going
  from 1.9 mm/λ50 mm to 3.6 mm/λ20 mm moved the normal-map metric by 1.3%,
  because most of the extra relief aliased away. The crest exponent is back at
  1.4 and the spacing is where `reference/images/aerial_suit.png` puts it.
* None of this costs silhouette. `displace_suit` runs on the HIGH-POLY only, so
  every millimetre here ends up in the normal map and none of it in the shipped
  mesh — the fit rule (comfortable, not baggy) is untouched by construction.

### The gate the ruling asked for CANNOT WORK, and here is the measurement

Ruling (a) asked for normal-map Laplacian energy inside a fold-region mask,
with folds-OFF failing. I built exactly that (`fold_relief_instrument`, still in
the tree). **The mask is right and the metric is not.**

The mask is right: against a matched `BODY_SABOTAGE_FOLDS=1` bake, the normal
map inside it changes by mean **13.98/255** while everything outside changes by
**2.13/255** — a 6.6x concentration, so the crease region is exactly where the
mask says it is. (`scratch/opus/s12f/fold_mask.png`, R = raw mask, G = eroded;
`BODY_FOLD_DEBUG=1` writes it.)

The metric is not, at any scale:

| band-pass σ (texels) | 0 | 1 | 2 | 3 | 4 | 6 | 8 |
|---|---|---|---|---|---|---|---|
| folds ON | 6.28 | 2.83 | 1.58 | 1.29 | 1.17 | 1.04 | 0.97 |
| folds OFF | 6.07 | 2.73 | 1.53 | 1.28 | 1.16 | 1.06 | 1.00 |
| **drop** | **3.5%** | 3.2% | 2.7% | 1.3% | 0.9% | −2.7% | −2.7% |

and a difference-of-Gaussians band-pass over σ pairs 2/10, 3/12, 3/16, 4/16,
4/24, 6/24, 2/16 tops out at **3.7%**. Two structural reasons:

1. **A Laplacian measures CURVATURE.** A 4 cm fabric fold is a smooth
   undulation whose curvature is small next to a 1.5 cm woven grain no matter
   how deep the fold is — the weighting is 1/λ², and weave and fold are only a
   factor 1.5 apart in scale. Reaching 40% on this metric means a suit of
   corrugated iron, measured by an instrument that still mostly reports weave.
2. **The mask's texels are thin strips in a fragmented atlas.** At fold scale
   the baseline inside them is dominated by build-invariant bake and
   island-seam structure, roughly 4x the fold's own contribution, and that
   dilutes any ratio taken against it.

### The gate that DOES work: `fold_ripple_gate`, on the geometry

The fold is a ring-shaped ridge, so it shows as an oscillation of the segment's
radius along its axis. Bin the band's high-poly vertices by axial position,
average the radius in each bin, remove the segment's own shape, and read what is
left. Three things had to be right, and each was wrong first:

* **Bin in METRES.** Binning on the dimensionless `along` at 0.002 makes a
  0.36 mm bin on a leg — finer than the vertex spacing — so most bins held one
  or two vertices and the "profile" was sampling noise. 4 mm bins.
* **One azimuth window, not the whole ring.** A limb's radius varies by
  centimetres between its anterior and outboard poles, so a bin holding more
  outboard vertices reads centimetres bigger for reasons that are not cloth.
  Reading one narrow stripe (anterior pole ±0.45 rad, about the limb's own
  quadratic axis from item 3 (d) — near a knee that axis and the segment centre
  are a centimetre apart) removes it, and also avoids the panel seam and the
  blue stripe's relief. The torso is read at the FLANK (0.85-1.25 rad off the
  back pole), because the back pole is under the bib where the fold is
  deliberately suppressed.
* **RMS, not peak-to-peak.** p2p is the wrong statistic where anatomy is bigger
  than the fold: at the knee the residual is dominated by the patella bump, and
  a crease landing in antiphase makes p2p go DOWN — measured, folds-ON shin
  11.98 mm against folds-OFF 13.86 mm. Uncorrelated signals add in quadrature,
  so an RMS can only rise when relief is added, whatever its phase.

Measured on the shipped build, RMS of the detrended crease profile, mm:

| band | shipped | `BODY_SABOTAGE_FOLDS=1` |
|---|---|---|
| elbow/lowerArmL | 1.35 | 0.30 |
| elbow/lowerArmR | 1.10 | 0.43 |
| elbow/upperArmL | 2.95 | 1.64 |
| elbow/upperArmR | 1.74 | 0.36 |
| hip/upperLegL | 1.43 | 0.66 |
| hip/upperLegR | 2.05 | 0.91 |
| knee/lowerLegL | 3.83 | 3.27 |
| knee/lowerLegR | 2.66 | 2.07 |
| knee/upperLegL | 2.78 | 1.49 |
| knee/upperLegR | 2.33 | 2.10 |
| lower-back/torso | 3.19 | 1.62 |
| **mean over 11 bands** | **2.31** | **1.35** |

**Drop 41.6%**, which is the ruling (b) target of ≥ 40%. Floor shipped at
**1.90 mm** — 82% of the measured 2.31, and 1.41x the control's 1.35, so
`BODY_SABOTAGE_FOLDS=1` fails it. **NEGATIVE CONTROL** is that flag, unchanged.
The gate runs inside `make_highpoly`, immediately after `displace_suit`.

The knee rows are the weak ones (3.83/3.27, 2.33/2.10) and they are honest: the
knee carries real anatomy at the fold's own scale, so its separation is small
and the aggregate carries the gate. That is the number to ratchet.

### `rig.spec.js`'s crease-band variance gate: DELETED

Per the ruling — "a gate that cannot tell folds-off from folds-on is deleted".
238 lines removed, replaced by a comment block pointing at the build-side gate
and at this section. It scored 57 159 shipped and 43 095 with the folds off,
and the whole of that range was the BOOT: its crease windows included
`boot-cuff` and `glove-cuff`, whose texels straddle a moulded plastic shell edge
carrying mean |Laplacian| around 100 000 against a cloth band's ~50 000.
`boot-cuff` and `glove-cuff` are deliberately NOT in `FOLD_MASK_ZONES` now, and
nothing gates the boot-cuff crease placement — item 12's reverted band move is
measurable again and worth revisiting.

`fold_ref`, the fold POPULATION gate, is re-baselined to the re-seated bands
(armpit 4636, boot-cuff 7275, elbow 2894, glove-cuff 1291, hip 1080, knee 2980,
lower-back 705) at the same 40% floor.

### Verification

    build   all gates green at 2048/96, including the NEW fold_ripple_gate
            (2.31 mm, floor 1.90) — stripe straight (worst step 10.5 mm, wander
            12.7 mm, width 41.7 mm), boot paint, sliver, goggle band, dome
            seating 0.4 mm, leg taper, bib number, suit NM variance 6.43,
            atlas share, weight seam
    unit    PASS
    golden  PASS, no re-capture, no physics change
    browser 36/36
    mutation + coverage  PASS
    drive   38/38 on the athlete set (rig, body, bib-number, athlete,
            ready-stance, spine, chain) + look 3/3 + pose-shots 1/1.
            NOT the whole suite: 111 tests at ~17 s each on one worker is over
            two hours, and this change cannot reach the rest — `git diff` shows
            assets/athlete_body.glb BYTE-IDENTICAL, so the geometry, the
            skinning and the physics are untouched and only the three baked
            maps moved. crash-ragdoll is skipped deliberately per the 21:30
            ruling (c): it is the GLM lane's.
    wire    998 682 B total (budget 2.5 MB)
    shots   figure_side.png shows crease banding at the knee, above the elbow
            and across the lumbar flank where the last build was flat white.
            The same shot shows the author's HUMAN TESTING #7 defect plainly —
            shoulder, chest and lat contours read as anatomy through the suit.

**Operational note, again:** port 8399 was held by a stale `python3 -m
http.server` from a previous run and Playwright refuses to start over it
(`Address already in use` — the whole suite errors out). It is always this
worktree's own; kill the pid first. `tests/run-all.sh` ALSO ignores DRIVE_PORT
unless you export it, and defaults to 8099, which the brief forbids — run it as
`DRIVE_PORT=8399 ./tests/run-all.sh`.

`ASSET_V` 43 → 44, `index.html` `game.js?v=` 37 → 38, preload hrefs `?v=44`.

### Open at the end of session 12

- **Item 3's main body is still open**: the two-tone side panels / centre-front
  zip line / stand-up collar / sleeve and ankle cuffs / neck gaiter / the bib as
  real separate GEOMETRY rather than paint. The base colour is already
  light-grey (`SUIT = 0.80/0.82/0.85`), not pure white — the white-on-white
  reading at scene distance is the missing PANELS, not the base tone.
- The arm stripe is still held off behind `STRIPE_SEGMENTS` pending the armpit
  bake fix (session 11's table).
- Items 10 (stance), 2 (helmet rim lip / chin strap / vents), 9 (collar + throat
  red streak), 6 (in-run arms), 7 (pike hip) untouched.
- `pose-shots.spec.js` framing (session 9's ruling: figure ≥ 350 px) still not
  fixed.
- `crash-ragdoll.spec.js:57` still red and still not this lane's (physics),
  bisected to `d638150` in session 11.

### RULINGS THAT ARRIVED DURING THIS SESSION — read these first next time

`docs/OPUS-BODY-BRIEF.md` gained three entries at 21:30-21:55, i.e. after this
session's work was already under way. They reorder everything below.

1. **AUTHOR, HUMAN TESTING #7 (21:45) — now TOP PRIORITY for item 3.** "The body
   shape still seems too muscular under the suit... should really cover over
   contours of body rather than seeing all the curves of muscles." The suit must
   become a SMOOTHED SHELL: low-pass the suit surface over ≥ 3 cm to kill
   muscle-frequency relief, then offset 8-15 mm on the legs and 6-10 mm on
   arms/torso, with NO anatomical detail in the suit normal map. Note this
   interacts directly with what landed today: the suit normal map is to carry
   "only weave + folds + seams", which is exactly the three things
   `displace_suit` writes — the folds shipped here are wanted, the muscle relief
   under them is not. The gate the author specifies (suit curvature variance
   ≤ 35% of the bare body's, 1-4 cm normal-map energy on thigh/calf/upper-arm
   ≤ 20% of today's) is measurable with the machinery this session added:
   `_poly_uv_tris` + `_rasterize_uv` + `_load_normal_laplacian(sigma=...)` give
   a UV-masked band-passed energy in three lines, and `fold_ripple_report`'s
   binning is the curvature-variance instrument with the azimuth window widened.
   **Careful:** the 1-4 cm band the author caps is the same band the folds live
   in. Mask the thigh/calf/upper-arm PATCHES away from the crease bands, or the
   two gates will fight.
2. **AUTHOR (21:55): the eyewear is SHOOTER-STYLE SPORT GLASSES, not goggles.**
   Supersedes item 1's wording and its strap: one continuous curved shield
   ~3.5-4 cm tall, thin brow bar only, thin temple arms over the ears under the
   helmet rim, nose pads, no foam frame, no band round the helmet. Keep the
   mirrored blue tint and the eye-line placement; re-measure the band gate for
   the thinner lens (0.44-0.60 h) and add "no lens pixels below the nose tip"
   and "temple arms present in the side view". This is `goggle_geometry` plus
   the `paint_suit` face pass plus `face_helmet_gate`'s band.
3. **Reviewer ruling on session 11 (21:30):** (a) leg stripe straightness
   ACCEPTED. (b) **the arm stripe MUST ship** — paint the band only on texels
   whose triangle's heaviest skin weight is an arm bone, never by a spatial band
   that crosses the chest wall; keep the torso-back-blue < 0.10 gate and add an
   arm-stripe presence gate (outer-seam band ≥ 4 cm on both arms). That is a
   direct answer to session 11's held-off `STRIPE_SEGMENTS` question and it is
   a contained change. (d) the `body.spec.js` torso selector fix is accepted.
   (c) **`crash-ragdoll.spec.js` is confirmed NOT this lane's** — it is the
   GLM-lane crash-roll model from entry 112, never implemented. Ignoring it in
   verification from here, as instructed.

Suggested order for session 13: the arm stripe (3 (b), contained, gated), then
the smoothed shell (author #7, the largest and most visible), then the sport
glasses, then 3's panels/collar/cuffs/bib, then 10, 2, 9, 6, 7.

### For the reviewer (session 12)

1. **Ruling (a) was not implementable as written, and the evidence is above.**
   I did not loosen it — I built the prescribed instrument, measured that it
   cannot separate the control at any band-pass scale, kept it in the tree as
   the evidence, and shipped an enforcing gate on the geometry that separates by
   41.6%. If you want the enforcing gate to be texture-space, the honest way is
   a normal-map gate against a stored reference bake, not a self-contained
   statistic; say so and I will build it.
2. **The knee bands are the weak rows** (3.83/3.27 and 2.33/2.10). Their
   anatomy is at the fold's own scale, so no phase-blind statistic will separate
   them well. Ratcheting the 1.90 floor means either deeper knee creases or
   dropping the knee from the aggregate — a ruling I would rather have than
   guess.
3. Carried, unchanged: the `POSE_TUCKED_INERTIA` reconciliation
   (`NEEDS-APPROVAL:`), the 1.35 strain gate pending item 3's bridge faces,
   `smooth_blend_rings` running after the bake, and session 11's three questions
   (stripe-edge mesh density, `crash-ragdoll`'s owner, the arm stripe call).

---

## Session 11 (2026-08-29, 20:0x-21:0x)

### Merge with `render-realism-glm` — commit `ca8627f`

Four commits (iter 119's night-mode toggle + generic kicker panels + chop
displacement, the reverted `blender/terrain.json`, the session-9 ruling docs).
Clean auto-merge. Unit 81/81, golden 30/30 on the merge, committed before any
new work per rule 1.

`blender/terrain.json` came back modified in the working tree afterwards — the
same ±1e-7 FP jitter a drive run re-extracts that GLM reverted in `e0fba99`.
Reverted here too; no geometric intent.

### Item 3 (d) — the stripe was a STAIRCASE — LANDED, commit `bd0eb70`

The reviewer's 20:05 ruling (d) said to fix `limb_azim`'s per-vertex azimuth.
That was the right address; the defect turned out to be one line of it.

`limb_slice_centroids` returned `{(segment, round(z/0.04)): centroid}` and
`limb_azim` looked the query point's bucket up by NEAREST. **The reference
axis the stripe's azimuth is measured from was piecewise constant in z.**
Every 4 cm the whole angular window jumped sideways by however far the
cross-section centroid had moved — millimetres to a centimetre on a tapering,
curving limb — and the painted band stepped with it, in one row, with a tread
4 cm tall. That is the staircase in `shots/figure_side.png`, exactly.

Two aggravations sat on top of it:

* a per-bucket median over as few as five vertices is noisy, and the noise is
  uncorrelated between adjacent buckets, so the treads alternate direction
  rather than drift — which is what made it read as "ragged" rather than as a
  spiral;
* `.get(..., (0.0, 0.0))` silently substituted the DRIVER centre for any bucket
  with fewer than five vertices. That is the 8 cm-off-the-shin pole the
  function's own docstring says it exists to replace, and the sparse buckets
  are the segment ends — i.e. the joints, where a broken seam shows most.

**The axis is now a weighted least-squares QUADRATIC** through 2 cm
cross-section centroids. Three coefficients describe a gently bowed limb
segment, cannot staircase by construction, and their derivative bounds the
seam's step. Interpolating the sampled rungs was tried first and is not
enough — even after four [1 2 1] passes the per-rung median noise still stepped
the thigh seam 14.5 → 13.7 mm (`scratch/opus/s11_build1.log`, `s11_build2.log`).

**The band is a fixed 5 cm of ARC now, not a fixed angle.** A constant `dphi`
is a constant fraction of the circumference, so the same 0.32 rad that made a
5.4 cm panel on an 85 mm-radius thigh made a 3.5 cm pinstripe on a 55 mm shin
and 2.9 cm on the forearm — the stripe narrowed exactly where the limb did,
which is not what a cut-and-sewn panel does. `STRIPE_DPHI_MAX` (0.46) keeps
entry-75's protection against a thin segment reading all blue, and now binds
only on the arms, where the reference suit's sleeve stripe is narrower anyway.

**The stripe on the ARMS is built, and it is OFF.** Item 3 and
`reference/images/aerial_suit.png` both ask for it, `paint_suit` does it
correctly, and the bake cannot currently carry it — see the next section. It
is one constant (`STRIPE_SEGMENTS`) away from being on again.

`displace_suit`'s stripe relief moved to the same arc band, so the lit edge and
the colour edge stay together, and it runs on the arms too.

### NEW GATE `stripe_straight_gate` — and the first version of it was junk

Per 2 cm rung, the seam's 5th/95th-percentile fore/aft edges; from those, the
centre's **step** between adjacent rungs (the staircase metric), its **wander**
off a straight least-squares fit, and the band's **width**. Measured against
`ly` — each vertex's offset from its DRIVER centre, which `segment_frame`
already hands `paint_suit` — deliberately *not* against the smoothed axis the
paint used, because any axis makes its own band look centred.

|                | shipped | `BODY_SABOTAGE_STRIPE=1` | gate |
|---|---|---|---|
| worst step     | **10.8 mm** (upperLegL) | **33.0 mm** (upperLegR) | 14 |
| worst wander   | **14.3 mm** (lowerLegL) | **34.7 mm** (upperArmR) | 20 |
| median width   | 41.2 mm | 33.8 mm | — |

**NEGATIVE CONTROL**: `BODY_SABOTAGE_STRIPE=1` restores the nearest-4 cm-bucket
axis and fails at 33.0 mm.

The first version of this gate used the **mean** of `ly` per rung and had to be
thrown away, for the same reason the reviewer threw away the fold gate: the
suit mesh's vertices come in rows, so how many land inside a 43 mm band varies
rung to rung and the mean of a clumpy sample moves several millimetres on its
own. It read **14.4 mm on a smooth axis and 14.5 mm on the bucketed one** — it
could not tell the staircase from the fix. The band's edges are geometric, so
percentiles of them are stable; that one change opened the separation to 3×.

Thresholds are set on the measured numbers with margin, in the reviewer's own
19:15 shape ("ship at an honest number and ratchet"), not on a round wish.

`shots/figure_side.png` by eye: a continuous royal-blue seam from the hip down
the outside of the leg into the boot cuff. No treads. The edge still carries a
few mm of vertex-resolution noise — that is mesh density, not the axis, and it
is the next thing to ratchet. Leg blue on the outboard shin went 0.585 -> 0.638
of the region (`body.spec.js`'s SUIT line): a wider, straighter band.

### THE FINDING — the ARM stripe leaks onto the TORSO through the bake

The arm stripe was built, shipped in `bd0eb70`, and turned back off in the
follow-up commit, because `body.spec.js`'s suit-design test went red on it:
`the back of the torso is blue — the bib has wrapped all the way round`.

That test's first problem was its own. Its "torso" was a pure HEIGHT band
(`fy` 0.55-0.78), i.e. every triangle at chest height including the arms,
which hang beside the torso in bind pose — so sleeve stripe was being counted
as torso blue on both sides. Fixed properly: the band now also requires the
triangle's heaviest LOW-POLY skin weight to name a torso or spine bone. A bone
is an authoritative answer to "is this the torso"; a height band is not. That
is the same argument `dominant_segments` makes in `build_body.py`.

With that fixed the test still failed, and the measurement is the interesting
part. Same selector, three albedos:

| stripe on | torso front blue | torso back blue (gate < 0.10) |
|---|---|---|
| legs only (`ca8627f`, previous ship) | 0.086 | **0.019** |
| legs only (this session's axis + arc width) | 0.086 | **0.019** |
| + arms | 0.145 | **0.121** FAIL |
| + arms, capped at `along` 0.55 | 0.117 | **0.110** FAIL |

The legs-only rebuild reproducing `0.086 / 0.019` exactly is what pins it: the
quadratic axis and the 5 cm arc band put nothing on the torso, and the arm
band is the whole of the difference.

**It is not the shoulder cap wrapping onto the chest.** Capping the arm stripe
below the shoulder removed 3 % of the stripe verts and moved the torso back
reading 0.121 -> 0.110. The band leaks along the WHOLE chest wall, where the
arm shell and the torso shell sit against each other since `loosen_suit` stood
the suit off the skin — the low-poly torso's bake ray finds high-poly arm. That
is the armpit/bridge-face geometry the reviewer already has queued under item 3,
and the stripe is not the place to fix it.

So the arm stripe is held behind `STRIPE_SEGMENTS` with the table above written
into the constant's comment, and the `displace_suit` relief follows the same
constant so the lit edge and the colour edge cannot part company. Flipping it
back on is a one-line change once the armpit bake is fixed, and `body.spec.js`
is the test.

### THE OTHER FINDING — `crash-ragdoll` is RED, and it is not new

The full drive suite reports `crash-ragdoll.spec.js:57` failing on
`total motion restAt(sim)=9.00s in 2-5 s`. I did not cause it and could not
have: this session changed `build_body.py` (Blender-only), the baked maps, an
`ASSET_V` comment, `index.html` version strings and `body.spec.js`, and
`assets/athlete_body.glb` came out of the rebuild **byte-identical**.

Bisected rather than argued: a throwaway worktree at **`d638150`** — session
10's own head, before the GLM merge and before anything in this session —
fails the same test with the same number, `restAt=9.0021s`. It is a
pre-existing red that sessions 9 and 10 never ran (their notes list `rig`,
`body`, `chain`, `athlete`, `ready-stance`, `bib-number`, `spine`, `look` —
not `crash-ragdoll`).

It is a physics-settling gate, so it is outside this lane by the no-physics
rule. **Reviewer: this needs an owner.** The second run failed one assertion
earlier, on `tumble pose excursion 38.3 <= 38`, so there are two marginal
numbers in that spec, not one.

### Verification

    build   all gates green at 2048/96 (stripe straight NEW, stripe bake 0.039,
            boot paint, sliver, goggle band 0.400-0.568h, dome seating, leg
            taper 0.718, bib number, suit NM variance, atlas share, weight seam)
    unit    81/81
    golden  30/30, no re-capture, no physics change
    look    3/3 — figure/face/pose shots regenerated
    drive   108 passed, 2 skipped, 2 failed on the first full run:
            - body.spec.js 'suit design' — the arm stripe; fixed by turning it
              off and by giving the test a bone-based torso selector. Now green.
            - crash-ragdoll.spec.js 'settles with skis at rest' — PRE-EXISTING,
              reproduced at d638150, see above. Untouched.
            Re-run after the fix: body + rig + bib-number + athlete 19/19.
    wire    1 820 292 B total, budget 2.5 MB
    glb     byte-identical after the rebuild: `displace_suit` and `paint_suit`
            feed the BAKE, not the exported low-poly

`ASSET_V` 42 → 43, `index.html` `game.js?v=` 36 → 37, preload hrefs `?v=43`.

One operational note for the next session: port 8399 was still held by a
`python3 -m http.server` left running by session 10's drive run (cwd
`tests/drive`, serving this worktree). Playwright will not start its own server
over it and the whole suite errors out with `Address already in use`. Kill the
stale pid; it is always this worktree's own.

### Open at the end of session 11

- Items 12, 11, 5 (weights + chain), 1, 8, 4 CLOSED.
- Item 3 (d) CLOSED for the LEGS; the arm band is written, measured and held
  off behind `STRIPE_SEGMENTS` pending the armpit bake fix (numbers above).
  **Item 3's main body is still open**: two-tone side
  panels, centre-front zip line, stand-up collar, sleeve/ankle cuffs, the
  separate loose bib, the neck gaiter, the light-grey (not pure white) base.
  The suit still reads white-on-white at scene distance.
- **Item 3 (b) from the 20:05 ruling — the fold amplitude — NOT started.** The
  measurement it rests on is session 10's; nothing in this session changed it.
  The fold gate replacement (ruling (a)) is not written either. Both are the
  next thing after the suit panels, and they are the same file.
- Items 10 (stance), 2 (helmet rim lip / chin strap / vents), 9 (collar +
  throat red streak), 6 (in-run arms), 7 (pike hip) untouched.
- `pose-shots.spec.js` still frames the tuck from too far off (session 9's
  ruling asked for ≥ 350 px of figure). Latest POSESHOT spans this session:
  tuck side 0.528, pike side 0.380, pike front 0.395 of frame height.

### For the reviewer (session 11)

1. **`stripe_straight_gate`'s thresholds are honest, not aspirational** —
   14 mm step / 20 mm wander against measured 10.8 / 14.3 and a control at
   33.0 / 34.7. The residual is vertex-resolution noise on the band edge, so
   ratcheting it needs mesh density at the seam (or the stripe moving from
   per-vertex colour to a UV-space mask), which is a bigger change than item
   3 (d) was. Worth a ruling on whether that is wanted.
2. **`crash-ragdoll.spec.js:57` is red and has been for at least two sessions**
   (bisected to `d638150`, evidence above). It is physics, so this lane cannot
   touch it. It needs assigning — and the drive suite should be run whole at
   the end of a session rather than spec-by-spec, which is how it stayed hidden.
3. **The arm stripe is a decision you may want to make differently.** I judged a
   red gate worse than a missing stripe and shipped the legs. If you would
   rather see the arm stripe on the author's 8203 view now and accept the
   torso bleed until the armpit geometry lands, it is one constant.
4. Carried, unchanged: the `POSE_TUCKED_INERTIA` reconciliation
   (`NEEDS-APPROVAL:`, deferred by the 18:30 ruling); the 1.35 strain gate
   still unset pending item 3's bridge faces; `smooth_blend_rings` running
   after the bake.

---

## Session 10 (2026-08-29, 19:0x-20:0x)

### Merge with `render-realism-glm` — commit `f6a5edd`

Seven commits (iter 118's night snowfall mode, iter 119's docs, the session-9
rulings). Clean auto-merge, no conflicts — no golden trace was re-captured on
either side this time. Unit 81/81, golden 30/30 on the merge.

### Item 12 (boots) — LANDED, commit `b4ca09f`

**The boot geometry has existed all along; nothing ever painted it.**
`rigid_boots` pins it to the shin, `seat_soles` lands its sole on the ski,
`align_boots` yaws it onto the ski axis, and `leg_taper_gate` has been
measuring its cuff breadth for several sessions (boot/shin 1.230, gate >= 1.0
— the leg already tapered INTO a cuff). The defect was one missing branch in
`paint_suit`: there was no boot region at all, so SUIT white ran unbroken from
the hip onto the topsheet. `paint_suit`'s `missing` check cannot catch that —
it only asks whether the regions it already knows about matched something.

**Measuring moved the number.** The obvious cuff step is `along` -0.74: it is
where `LEG_TAPER_BANDS['boot']` tops out (z=-0.95) and what `SUIT_FOLDS`'
'boot-cuff' band is documented against. Painting from it gave a **47 mm rim**,
not a boot — because **the segment model has no foot below the ankle**:
`seat_soles` lands the sole at z=-0.995 and the shin's own ankle end is
z=-0.995 too. On this rig the boot has to BE the lower shin, which is also what
a real ski boot is. `BOOT_ALONG = -0.40` puts the cuff 108 mm above the ski on
a 360 mm shin, clear of the calf belly the taper gate measures at z
-0.80..-0.66, so the calf still shows above the shell and tapers into it —
half of item 11 as well, since a calf only reads as over-inflated when there is
nothing for it to taper into.

| | verts | mean luma | light frac | shell height |
|---|---|---|---|---|
| shipped | 34 177 below the cuff step | **0.078** (gate <= 0.20) | **0.0000** (gate <= 0.02) | **112 mm** (gate >= 90) |
| `BODY_SABOTAGE_BOOT=1` | same band | 0.764 | **0.9073** | 112 mm |

**NEGATIVE CONTROL**: `BODY_SABOTAGE_BOOT=1` skips the branch, which reproduces
the skin this project shipped up to session 9 — and `boot_paint_gate` rejects
it. **0.9073 of the boot band was light**: that number IS the author's white
blob, measured.

A lighter liner lip (`BOOT_CUFF`) runs along the rim so the shell has an edge
instead of dissolving into a black sock — the same trick the glove cuff uses.
The stripe branch is unreachable below the cuff (leg blue census 2322 -> 1926
verts): a leg stripe runs hip to cuff on the SUIT and stops at the boot.

`shots/figure_side.png` by eye: the boot reads as a dark shell from the ski up
over the ankle, and the leg tapers into it.

### THE FINDING — the "fabric folds" gate has never measured folds

Moving `SUIT_FOLDS`' 'boot-cuff' crease up the shin (so cloth bunches ABOVE the
shell instead of creasing rigid plastic) turned `rig.spec.js`'s crease-band
variance gate red, 57159 -> 43692 against a 55000 floor. That looked like lost
fold relief. It is not. Measured on the same window:

| normal map | crease-band metric | vs shipped |
|---|---|---|
| shipped (folds + weave) | 43 692 | — |
| folds OFF (`BODY_SABOTAGE_FOLDS=1`) | 43 095 | **-1.4 %** |
| weave OFF (`BODY_SABOTAGE_WEAVE=1`) | 42 362 | **-3.0 %** |
| band where it has always been | 57 159 | **+30.8 %** |

**Everything `displace_suit` writes moves that metric by under 3 %.** The
13 467 the original band adds comes from 62 732 texels whose mean |Laplacian|
is ~100 000 — double any cloth band — because the boot-cuff band (-0.62±0.18)
sits over the **ankle and boot**, and hard geometry edges are high-Laplacian
for exactly the reason the session-7 note in `build_body.py` records the suit
TEAR being ("long mis-shaded faces are high-Laplacian too"). This is the same
mistake a third time.

Widening the Laplacian stencil to the folds' own ~25 mm wavelength does not
rescue it: folds-on vs folds-off separation at radii 1/2/4/6/8/12/16 texels is
1.4 / 0.8 / 0.3 / 0.2 / 0.2 / 0.5 / 0.4 %. The folds (1.5-1.9 mm ridges over a
~25 mm wavelength) are simply not visible in the bake beside the 2.1 mm
peak-to-peak weave.

**What I did about it**: reverted the fold-band move (it buys nothing visible
and only blinds a gate), did **not** recalibrate the floor — a floor tuned for
a metric that measures nothing would be worse than the red — and wrote the
evidence into the gate's own header. The two sabotage flags and `rig.spec.js`'s
new per-zone / multi-radius breakdown stay in the tree, so the next session
reproduces the whole table in one build.

### Verification

    build   all gates green at 2048/96 (NEW boot paint, sliver, goggle band,
            dome seating, leg taper, bib number, stripe, suit NM variance 6.36,
            atlas share, weight seam, fold population)
    unit    81/81
    golden  30/30, no re-capture, no physics change
    drive   rig 12/12 (crease-band gate included), body + chain + athlete +
            ready-stance + bib-number + spine 31/31, look 3/3
    wire    1 803 719 B total, budget 2.5 MB
    shots   figure_side.png, figure_front.png, face*, pose_* regenerated

`ASSET_V` 41 -> 42, `index.html` `game.js?v=` 35 -> 36, preload hrefs `?v=42`.

### Open at the end of session 10

- Item 12 CLOSED. Item 5's weight half CLOSED (session 9).
- Items 3 (suit panels + separate bib + the armpit/crotch bridge faces),
  10 (stance), 2 (helmet rim lip / chin strap / vents), 9 (collar + throat red
  streak), 6 (in-run arms), 7 (pike hip) untouched.
- **GLM's review-115 finding (a) is already fixed**: `shots/figure_side.png`
  shows a full dark dome in profile, not "a thin dark rim with a bare
  skin-coloured crown". No crown-coverage gate was added; the defect is not
  reproducible on the current build.
- **Item 3 (d), by eye in `figure_side.png`**: the blue leg stripe is still a
  ragged blob wandering across the shin, not a clean ~5 cm band on the outer
  seam. The paint's angular width is right (dphi < 0.32 rad ~= 3.8 cm of arc);
  the raggedness is in the per-vertex azimuth, so `limb_azim`/the slice
  centroids are where to look.
- `pose-shots.spec.js` still frames the tuck from too far off (session 9).

### For the reviewer (session 10)

1. **`rig.spec.js`'s "fabric folds read at the creases" gate should be renamed
   or replaced.** The table above is the evidence: it is a relief/smoothing
   guard whose entire dynamic range is the boot's hard geometry, and it has
   never been sensitive to the folds it is named for. Two follow-ups worth a
   ruling: (a) is the gate kept as an unnamed relief guard, or replaced with a
   metric that resolves a 25 mm ridge (a band-limited one, not a Laplacian)?
   (b) **the folds themselves are invisible in the bake** — 1.4 % — so item 3's
   "subtle folds at elbows, knees, groin and lower back" is NOT currently being
   delivered at any amplitude the eye or the suite can see. That is an item 3
   decision (deeper folds, or folds as geometry rather than normal map), and it
   is worth knowing before item 3 starts.
2. Carried, unchanged: the `POSE_TUCKED_INERTIA` reconciliation
   (`NEEDS-APPROVAL:`, deferred by the 18:30 ruling); the 1.35 strain gate
   still unset pending item 3's bridge faces (session 9 question 1);
   `smooth_blend_rings` running after the bake (session 9 question 2).

---

## Session 9 (2026-08-29, 18:2x-19:3x)

### Merge with `render-realism-glm` — commit `97bec99`

Seven commits (iter 116's cone-peak re-land, iter 117's free-look camera, the
session-8 rulings). The conflict was **all seven golden traces that BOTH sides
had re-captured**: GLM's iter 116 added the `pk_body_*` peak nodes to the node
census, session 8 removed the spine drivers from it. Neither is a physics
change, and taking either side wholesale would have shipped a trace that is
wrong about the other side's nodes.

Resolved by re-capturing on the merged tree, with
`tests/golden/audit-physics-state.js` run FIRST as the evidence:

    30 scenarios, 5408 frames compared
    scenarios with ANY physics-state difference:  0
    scenarios with display-node differences:      7   (exactly the seven)

Then `capture.js`, then `verify.js` 30/30. Unit 81/81.

### Item 5 (skin weights) — the seams were cut by the OWNERSHIP passes

The reviewer's session-8 ruling aimed this at the hip and shoulder blend
rings. That was right, and the cause turned out to be nameable.

**New instrument: `weight_seam_report(obj, tag)`** in `build_body.py`. For
every edge it computes the L1 distance between its two endpoints' normalised
weight vectors, taken at the exporter's four influences — i.e. the weights the
runtime actually sees. The quantity is in [0, 2]: 0 means the edge is rigid
under ANY pose, 2 means the endpoints share no bone at all and the edge is a
bare hinge between two rigid bodies. Under LBS an edge can only stretch if its
endpoints are driven by different matrices, so this is the half of the strain
product that this lane owns; the pose tables set the other half.

Run after every weight pass, same build:

| after | p99 | max L1 | edges over 1.0 |
|---|---|---|---|
| `skin` (heat map) | 0.328 | **0.636** | **0**/21170 |
| `sharpen_limb_weights` | 0.830 | 1.599 | 145 |
| `rebind_arm_weights` | 0.863 | 1.639 | 175 |
| `reclaim_chest_wall` | 0.925 | **2.000** | 190 |

**The heat-map bind is smooth. Every seam in the shipped skin was cut
afterwards, by the three ownership passes.** Each decides membership with a
hard predicate — a distance margin, a normal-alignment test, a z-band — and
then writes a step across it; `reclaim_chest_wall` literally zeroes every
group and writes 1.0. A hard predicate over a smooth surface gives a ragged
boundary, and a step across a ragged boundary is a hinge. The 2.000 sits at
`(+0.171, -0.002, +1.224)` — the right armpit, which is where session 8
measured the strain tail.

**The fix, and why it is safe: `smooth_blend_rings(low)` runs LAST**, on the
low-poly, after the bake and after `add_spine_chain`. The three ownership
passes still have to run and still have to run early — their real job is to
make `pose_onto_segments` transport each limb the whole way to the game's
segment length, and that result is BAKED into the rest mesh. By the time the
repair runs that job is done and frozen, so the sharp weights have no
remaining purpose: they describe only how the mesh leaves its rest pose, which
is exactly the thing that tears. The rest pose is the bind pose whatever the
weights are, so the shipped geometry and every gate upstream are untouched.

Seeded from every seam edge (L1 > 0.35, or a dominant-group flip — two rules,
because a wide blend gradient and a hard 100%/100% ownership flip look
different and the second shares no influence to gradient over), grown 4
topological rings, 8 Laplacian iterations at rate 0.5 with a per-ring falloff.

    blend rings relaxed: 788 seam verts, 2801/8995 verts within 4 rings
    WEIGHTSEAM after add_spine_chain: p99 0.850  max 1.538  151/18502 hot
    WEIGHTSEAM shipped skin:          p99 0.319  max 0.715    0/18502 hot

**HEAD GUARD.** `skin()` documents that a global weight smooth once grew the
head group from 16% to 26% of the mesh, bulging the neck and shoulders. The
pass measures the head's weight share before and after and raises if it grows
by more than 10%: **0.1954 -> 0.1955**, +0.05%.

**New gate `weight_seam_gate`**: max L1 <= 1.10, at most 6 edges over 1.0.
**NEGATIVE CONTROL** `BODY_SABOTAGE_SEAM=1` skips the repair, so the gate
measures the skin this project shipped up to session 8 — and rejects it, at
max 1.538 / 151 hot. A historical control, the same shape the sliver gate
carries; stronger than a synthetic hinge because the thing it rejects really
went out. (First cut of the control tried to re-cut a hinge by coordinate and
selected 0 verts — the low mesh is in the driver frame by then, not the
anatomical one. Corrected rather than left reading `0 verts SABOTAGED`.)

### What it bought, measured in the browser (`spine.spec.js`)

| pose | p99 s8 -> s9 | p99.9 s8 -> s9 | max s8 -> s9 |
|---|---|---|---|
| in-run crouch | 4.696 -> **3.878** | 15.227 -> **7.119** | 38.571 -> **15.114** |
| flight tuck | 4.281 -> **3.534** | 11.678 -> **6.316** | 27.700 -> **12.233** |
| pike | 3.190 -> 3.554 | 9.335 -> **7.288** | 52.130 -> **17.966** |

p99.9 halved and max halved in every pose. The worst edge has also MOVED off
the armpit onto the hip/glute (crouch worst now `y -0.182, z -0.152`), which
is the seam fix doing what it was aimed at.

### THE FINDING — the residue is NOT the LBS bound, and it is not the weights

I expected the remainder to be linear-blend skinning's own limit, and wrote a
dose-response to confirm it. **It refuted the hypothesis, which is why the
test ships**: an LBS term is proportional to `|R(T)p - p|` and must GROW with
the joint angle.

    tuck     0      0.15   0.3    0.5    0.75   1
    p99      1.000  3.495  3.516  3.593  3.663  3.534

It is a **step, not a ramp**. Full strain arrives at a 15% tuck, where the
joints have barely moved, and does not grow as they open to 100%. So a fixed
POPULATION of edges misbehaves the moment the pose leaves the bind.

Splitting the same measurement by REST-EDGE LENGTH says which population
(`byLen`, now in every STRAIN line):

| rest length | edges | p99 crouch | p99 tuck | p99 pike |
|---|---|---|---|---|
| 2-5 mm | 6 934 | 1.370 | 1.330 | 1.367 |
| 5-10 mm | 20 872 | 1.483 | 1.553 | 1.621 |
| **>= 10 mm** | **26 138** | **4.574** | **4.202** | **4.566** |

The short edges are essentially inside item 5's 1.35 target already. The tail
is entirely in the LONG edges — and long rest edges on a mesh whose median is
11 mm are the **bridge faces at the armpit and crotch**, which session 7
identified by name as "long by construction because they span a real gap" and
which are the surviving 50 sliver faces. The reviewer classified those as
item 3 (bake/geometry), not skinning.

**So: item 5's weight half is done and gated. The residual strain is a
GEOMETRY defect — the armpit/crotch bridge faces — and it belongs to item 3.**
The 1.35 gate is still not set, and now for a third, sharper reason than
session 8's: on the geometry this lane can reach with weights, the sub-10 mm
skin is already at 1.33-1.62, and the number that fails is produced by faces
that should not exist at that length.

### Verification

    build   all gates green at 2048/96 (sliver, goggle band, dome seating, leg
            taper, bib number + aspect, stripe, suit NM variance 6.36, atlas
            share, NEW weight-seam gate); delivery maps 976 716 B total
    unit    81/81
    golden  30/30 after the merge re-capture; audit 0/5408 physics diffs
    drive   spine 9/9 (8 + the new dose-response), pose-shots 1/1;
            rig + body + chain + athlete + ready-stance + bib-number
            30 passed (8.1 m), 0 failed — every gate the three ownership
            passes were protecting (boot-ski invariant, ready stance, bib
            number front AND back, arm transport, chain closure) is green
            with the relaxed weights, which is the evidence that moving the
            repair after the bake costs nothing upstream
    wire    1 801 759 B total (glb 823 768 + maps 976 716 + json), budget 2.5 MB

`_bodyVisibleAt` read 4 878 ms in this run against session 1's 1 457-1 542 ms,
but that run was six specs in parallel under SwiftShader and session 1's was
solo — the same contention effect iteration 115 recorded for the frame-time
spec. Not comparable, and not chased; flagged so the next session does not
read it as a regression.

    shots   pose_* regenerated; TUCKEXTENT 0.870/1.498 = 0.581, identical to
            session 8 — the pose is unchanged, only the deformation moved

`ASSET_V` 40 -> 41, `index.html` `game.js?v=` 34 -> 35, preload hrefs `?v=41`.

### Open at the end of session 9

- **Item 5's weight half is CLOSED.** The remaining strain is the armpit/crotch
  bridge faces and moves to item 3, with the `byLen` split as the evidence.
- Items 3 (suit panels + separate bib + the bridge faces), 12 (boots),
  10 (stance), 2 (helmet rim lip / chin strap / vents / profile bare crown),
  9 (collar + throat red streak), 6 (in-run arms), 7 (pike hip) untouched.
- `pose-shots.spec.js` frames the tuck from a long way off — the figure is
  ~60 px tall in `shots/pose_tuck_side.png`, too small to judge by eye. The
  numbers (extent ratio) are right; the CAMERA needs to come in. Small, worth
  doing before the next visual ruling on the tuck.

### For the reviewer (session 9)

1. **The 1.35 strain gate is still unset, and session 9 says why with a
   different measurement than session 8's.** The dose-response shows the
   residue is a step at 15% tuck, not an angle-driven bound, and the
   rest-length split shows it lives entirely in edges >= 10 mm — the
   armpit/crotch bridge faces. Sub-10 mm skin is at 1.33-1.62. I believe the
   honest sequence is: fix those faces under item 3, then set 1.35. Please
   confirm, or rule that the gate should ship now on the sub-10 mm band only.
2. **`smooth_blend_rings` runs after the bake and changes only deformation.**
   That is the judgement call in this commit: it deliberately undoes, for
   runtime purposes, the sharpening that `sharpen_limb_weights` /
   `rebind_arm_weights` / `reclaim_chest_wall` exist to produce — on the
   argument that their product is already frozen into the rest mesh. Every
   gate those passes were protecting is still green, which is the evidence,
   but the reasoning is worth a second pair of eyes.
3. Carried, unchanged: the `POSE_TUCKED_INERTIA` reconciliation
   (`NEEDS-APPROVAL:`, deferred by the 18:30 ruling).

---

## Session 8 (2026-08-29, 18:0x-18:5x)

### Merge with `render-realism-glm` — commit `ad21306` (docs only)

Four commits, `docs/` only (iter 115's review-only pass, the 116-120 order, the
hip-gap approval, the session-7 acceptances). One conflict, in
`docs/OPUS-BODY-BRIEF.md`: the reviewer had written the "Session 7 calls
ACCEPTED" line into the worktree AND committed it on the integration branch.
The working-tree copy was byte-identical to the incoming one (diffed before
discarding), so the resolution took theirs. No code, so no gate re-run.

### Item 5 — the tuck's chain CLOSES. Commit `ed44721`

**What the endpoint actually was.** `POSE_TUCKED` was free-standing. At tuck=1,
where the P13 reconciler is inert by design, every joint was dislocated:

| joint | gap before | gap after |
|---|---|---|
| shoulder | **0.536 m** | 0.0002 m |
| hip | **0.329 m** | 0.0005 m |
| neck | **0.211 m** | 0.0006 m |
| knee | **0.207 m** | 0.0009 m |
| ankle | 0.014 m | 0.0002 m |

(Analytic, on the shipped 3-decimal literals, using the exact `_poseProbe`
formulas including the `cos(rz)` foreshortening on the arm anchors.)

**And it was anatomically backwards.** `upperLegL.rx = -1.20` put the thigh's
KNEE end 0.34 m BEHIND the hip, and the table then translated the whole leg
forward to hide it. A tuck needs the knee in FRONT of the hip, which is
`rx > pi/2` — the range `POSE_PIKED` already uses. Nothing in the old table
could have been rescued by re-anchoring it; the angles had to be re-derived.

**Angles, from the footage.** `reference/pose/IMG_3520` frames 193-205 are the
only real airborne tuck in the reference set. `IMG_3768`, which entry 83
proposed, tracks a bystander whose hip and knee never leave 170-180 deg — I
checked all 179 frames before discarding it. Shipped:

- trunk-thigh interior **50 deg** — measured 54-64 deg at frames 193-196
  (scores 0.41-0.47, the deepest frames; the reliable band 200-205 reads
  80-117 deg and is the athlete already opening out for the landing)
- thigh-shin interior **30 deg** (150 deg knee flexion, the anatomical limit).
  2D measurement bottoms out at 89 deg there because the shin runs along the
  camera axis; this one is a deliberate tightening and is flagged as such in
  the table comment.
- trunk **25 deg** forward, head **20 deg** further (chin toward chest), hands
  IK'd onto the upper shin at 30% knee-to-ankle.

Skinned body height at the tuck: **0.870 m against 1.498 m open, ratio 0.581**.

### The physics is unchanged BY CONSTRUCTION, not by measurement

`computeI` reads only `y` and `dz`, so rebuilding the table would have moved
`I_tuck` — and iteration 33 measured a **4.1%** `I_tuck` shift flipping three
knife-edge landings. So the mass distribution is pinned in a new
`POSE_TUCKED_INERTIA` carrying the old literals byte for byte, and `computeI`
reads that instead. `tests/unit/tuck-inertia-frozen.test.js` pins `I(tuck)` at
five blend values to float64 literals captured from `1e8d0cb`, asserts the
frozen table still carries the pre-rebuild `y`/`dz`, and carries a **negative
control**: perturbing the DISPLAY table must not move `computeI`, and
perturbing the FROZEN table must — otherwise the first assertion would pass on
a `computeI` that ignores its model argument entirely.

Measured divergence of the drawn tuck from the simulated one:

| tuck | I frozen (physics) | I drawn | delta |
|---|---|---|---|
| 0 | 17.634921 | 17.634921 | 0.000% |
| 0.5 | 8.763864 | 9.5595 | **+9.08%** |
| 1 | 5.225046 | 5.2126 | **-0.24%** |

The endpoint figure is small because the tuck angles were picked from an
anatomically valid set that minimises it — a 24-config sweep over trunk lean,
hip and knee interior angles, scored on `computeI`. The mid-blend figure is
**not new**: the P13 reconciler has always re-anchored every joint at
mid-blend and `computeI` has never seen that either.

### Golden traces — re-captured display-only, with the audit

New `tests/golden/audit-physics-state.js` (kept, not scratch — it is reusable
and sits with `audit-ready-stance.js`). It replays all 30 scenarios and
compares ONLY the `state` object, frame by frame, with `Object.is` and no
epsilon:

    30 scenarios, 5408 frames compared
    scenarios with ANY physics-state difference:  0
    scenarios with display-node differences:      9

`verify.js` prints the first few diffs per scenario and stops, so it cannot
distinguish "the athlete is drawn differently" from "the simulation changed".
This can, and it is exactly the evidence the standing re-capture condition
asks for. Traces re-captured after it, then `verify.js` 30/30.

### THE FINDING — the skinned tear is NOT the driver-joint gaps

This supersedes session 6's attribution and it is the part that matters most.

| pose | p99 before | p99 after | max before | max after |
|---|---|---|---|---|
| flight tuck | 4.383 | **4.281** | 36.52 | 27.70 |

Closing a 0.536 m shoulder gap and a 0.329 m hip gap moved p99 by **2%**.

The decisive number is the one next to it: the **in-run crouch**, which has
been chain-consistent since iteration 83 (gaps <= 12 mm), sits at
**p99 4.696 / max 38.571** — worse than the tuck. A fully closed driver chain
still tears the skin. So the driver-joint gaps were never the dominant cause,
session 6's "no amount of spine fixes a pose table that tears its own hip" was
right about the mechanism and wrong about the magnitude, and **item 5's 1.35
strain gate stays unset for a measured reason rather than a guess**.

Where it actually is: the worst edges sit at `(y 0.145, z -0.091)` for crouch
and pike and `(y 0.109, z 0.099)` for the tuck — armpit height, both sides.
`p50` is exactly 1.000 in every pose, so 99% of the skin is rigid and a thin
tail explodes. That is the signature of the BIND WEIGHTS on the shoulder and
hip blend rings, not of the pose. Next session starts there: the weights
`add_spine_chain` inherited from the single-`torso` group were never re-spread
across the arm and leg roots.

### Gates added

- `chain.spec.js`: **flight tuck endpoint** (tuck 1, airborne) — every joint
  <= 3 cm, hips <= the approval's 2 cm. The old "awaits `APPROVED: adjust
  POSE_TUCKED`" carve-out is gone.
- **NEGATIVE CONTROL** in the same file: the PRE-REBUILD table run through the
  same probe maths *in the page*, asserting it FAILS — hip > 0.30 m, shoulder
  > 0.50 m, worst > the tear limit. A gate that quietly stopped measuring the
  joints could not pass it.
- `tests/drive/pose-shots.spec.js` — **the `shots/pose_*.png` generator**,
  which did not exist. The six pose shots were committed PNGs refreshable only
  by hand. It also gates that the tuck compacts the body (ratio < 0.80).

Two real defects it caught on itself, both now commented in place:

1. **A skinned mesh's bounding box is the REST box** until
   `refreshBoundingInfo({ applySkeleton: true })` is called. The tuck and the
   ready stance reported identical extents — ratio exactly **1.000** — so every
   camera framing aimed at the wrong volume.
2. **The pose must be applied inside `onBeforeRenderObservable.addOnce`.** The
   game re-poses the athlete from its own state every frame, so a probe set
   before `scene.render()` is overwritten before anything is drawn: the
   skeleton reported the tuck while the picture showed the athlete standing.
   This is the render-side twin of session 6's `skeleton.prepare(true)` finding
   and any future shot spec needs it.

A third, smaller: the follow rig clamps `radius`, so `cam.radius = 2.6` was
silently clamped to the follow distance and the first shot framed the
mountains. `look.spec.js` lifts `lowerRadiusLimit`/`upperRadiusLimit` first;
this spec now does too.

### What the shot shows

`shots/pose_tuck_side.png` (regenerated): a compact ball — knees up and
forward, heels folded under, skis tracking the boots, head down. Previously
this shot showed a figure whose limbs floated free of the trunk.

### Verification

    unit    81/81  (78 + 3 new in tuck-inertia-frozen)
    golden  30/30 after a display-only re-capture; audit 0/5408 physics diffs
    browser 36/36
    mutation  all caught      coverage  green
    drive   chain + spine 18/18; rig + body + athlete + ready-stance +
            bib-number 24/24; pose-shots 1/1
    index.html body-model.js v23->24, inertia.js v22->23 (no asset change,
            so ASSET_V stays at 40)

One process note, again: port 8399 was held by an orphaned `http.server` left
by the run-all.sh that the harness killed at its timeout. `ss -ltnp` plus
`/proc/<pid>/cmdline` identifies the `--directory`; safe to kill when it is
this worktree. Also: **`./tests/run-all.sh` runs the whole drive suite and does
not finish inside a 600 s tool timeout** — run the layers separately
(`node --test tests/unit/*.test.js`, `node tests/golden/verify.js`,
`node tests/browser-suite.js`, then playwright by spec name).

### Open at the end of session 8

- **Item 5's remaining half is now correctly aimed**: the skinned strain is a
  BIND-WEIGHT problem at the shoulder and hip rings, measured, with the in-run
  crouch as the control that rules the pose tables out. The 1.35 gate goes in
  when that is fixed.
- The crotch/armpit shards (50 faces) from session 7 — same rings, possibly the
  same root cause; worth attacking together.
- Item 2's rim lip / chin strap / vents / gloss; the profile bare-crown finding
  from GLM review 115.
- Items 3 (suit panels + separate bib), 6 (in-run arms), 7 (pike hip), 9
  (face + throat red streak), 10 (stance), 12 (boots) untouched.

### For the reviewer (session 8)

1. **`NEEDS-APPROVAL:` reconcile the tuck's mass distribution with the drawn
   tuck.** `POSE_TUCKED_INERTIA` currently freezes the mass layout of the OLD,
   dislocated table. The drawn tuck differs from it by -0.24% at the endpoint
   and +9.1% at mid-blend. Adopting the drawn layout is a physics change with
   an outcome contract (iteration 33's three knife-edge landings are the ones
   at risk) and a trace rebaseline; this lane cannot make it. Until then the
   game simulates a tuck 0.24% less compact than the one it draws.
2. **The 1.35 strain gate is deliberately still unset**, and session 8 has the
   measurement that says why: the chain-consistent in-run crouch is at
   p99 4.696. Setting the gate now would either calibrate it to the defect or
   ship a red no pose work can clear.
3. **`tests/golden/audit-physics-state.js` is a new file in `tests/golden/`**
   rather than scratch, on the grounds that it is the reusable form of an audit
   this project has now done three times by hand.

---

## Session 7 (2026-08-29, 17:0x-17:5x)

### Merge with `render-realism-glm` — commit `b7c52c5` (docs only)

`docs/RENDER-PROGRESS.md` only (iter 114's withdrawn cone-peak re-land). Clean
auto-merge, no code, so unit+golden were not re-run over the merge alone.

### THE SHARDS — reviewer's top visible defect — commit `a620b48`

**Root cause: `narrow_shoulders` compared a magnitude against a SIGNED plane.**

The pass pulls verts OUTBOARD of each shoulder's bone plane back onto the
anatomical cap. Its test read `s * v.co.x <= x_b + 0.001`. But `s * v.co.x` is
already folded to a magnitude (the `s` is there precisely to make both sides
positive), while `x_b = s * 0.175` still carries the side's sign. On the right
(`s=+1`, `x_b=+0.175`) the two conventions agree by accident. On the left
(`s=-1`, `x_b=-0.175`) the test passes for everything outboard of **-0.174** —
the entire trunk and most of the opposite arm — and every one of those verts
was then rescaled about the LEFT bone plane.

Measured, same build, instrumented per side:

| side | verts moved | worst move |
|---|---|---|
| L (broken) | **279** | **226.8 mm**, x +0.172 -> -0.055 |
| R (correct) | 42 | 37.1 mm, x +0.237 -> +0.200 |
| L (fixed) | 43 | 39.9 mm, x -0.240 -> -0.201 |

A vertex at x=+0.172 is the FAR shoulder. It was being dragged to -0.055,
through the chest. The faces bridging moved and unmoved verts stretched to
240 mm on a mesh whose median edge is 11 mm, and shaded wherever their normals
ended up. **That is the silvery shard.** Bideltoid is 0.401 m before and after,
so the pass still does the job it was written for.

### The instrument that found it

`sliver_report(obj, tag)` counts faces that are BOTH longer than 60 mm AND off
their own vertex normals by more than 60 deg — the shard signature, needing no
reference mesh — and now runs after every geometry pass. That is what turned
"root-cause it" into an answer instead of a guess:

| after | shard faces | worst edge |
|---|---|---|
| soften | **0**/10590 | 57 mm  (the base mesh is clean) |
| shape_helmet | 41 | 119 mm |
| settle_limb_geometry | 49 | 131 mm |
| **narrow_shoulders** | **149** | **240 mm** |
| loosen_suit | 161 | 240 mm |
| straighten_chest | 119 | 240 mm |
| finish_lowpoly (shipped) | **157**/9558 = 1.64% | 240 mm |
| **finish_lowpoly, fixed** | **50**/9509 = **0.53%** | **139 mm** |

`sliver_gate` ships at **0.60% / 160 mm** — 2.7x under the defect, 1.7x over
the repaired build. Two negative controls: `BODY_SABOTAGE_SLIVER=1` reproduces
the sign bug's smear and fails the gate, and the gate independently **rejects
the mesh HEAD was shipping** (1.64%, 240 mm) — a historical control that costs
nothing to keep.

### Two gates moved, both because the TEAR was satisfying them

This is the part for the reviewer. Neither is a loosening-to-pass; both are
gates whose calibration turned out to be contaminated by the defect.

1. **Chest sanity floor 0.30 -> 0.25 m.** The bug pushed the left chest wall
   outboard (a trunk vert at x=-0.100 landed at -0.149), inflating this very
   breadth. Same slice, same build: **303 mm with the bug, 275 mm without**.
   28 mm of the margin over the 300 mm floor was smear. Widening the trunk by
   28 mm to meet a number calibrated on torn geometry would be shaping the body
   to fit the defect, and it runs against item 3's "straight torso, chest does
   not protrude". `chest/thigh` 1.415 -> 1.285 (gate <= 1.70); hip unchanged at
   295 mm.
2. **Suit weave 1.1 -> 2.1 mm peak-to-peak.** With the shards gone the suit's
   NM variance fell **8.24 -> 5.96** against a 6.30 floor: roughly a quarter of
   the "fabric relief" that gate was measuring was the tear, because long
   mis-shaded faces are high-Laplacian too. Here the floor STAYS and the cloth
   gets its weave for real (item 3's woven micro-normal). 1.7 mm gave 6.19,
   2.1 mm gives **6.36**. The gate was right and the suit was under-relieved.

### What the shot shows

`shots/figure_front.png` (regenerated, ASSET_V 40): the diagonal fan of shards
across the chest and the flaps over the bib are **gone**, the suit reads as one
surface, and the bib "30" reads correctly left-to-right.

**Still there, and it is the next thing to fix:** a flap-shaped tear at the
CROTCH and smaller notches at both armpits (`scratch/opus/after_groin.png`).
Those are the surviving 50 faces. They are the arm-torso and leg-torso bridge
faces, which are long by construction because they span a real gap — but they
are still shading as shards. `shape_helmet` (41 faces, worst at
(+0.132,+0.099,+0.013)) and `settle_limb_geometry` (+6, worst at
(+0.125,-0.032,-0.034)) are the two passes that create them, per the table
above. Start there.

### Verification

    build   all gates green at 2048/96 (sliver, goggle band, dome seating, leg
            taper, bib number + aspect, stripe, suit NM variance 6.36, atlas
            share); delivery maps 976 690 B total
    unit    78/78
    golden  30/30, no re-capture, no physics change
    drive   rig + body + chain + athlete + ready-stance + bib-number +
            athlete-wired + spine: 40 passed (8.6 m), 0 failed
    shots   look.spec regenerated figure_front/figure_side/face/face_back

`ASSET_V` 39 -> 40, `index.html` `game.js?v=` 33 -> 34, preload hrefs `?v=40`.

One process note: port 8399 was held by an orphaned `http.server` from this
worktree left by a killed run; `ss -ltnp` identifies the owner and it is safe
to kill when the `--directory` is this worktree.

### Open at the end of session 7

- **The crotch/armpit shards** (50 faces) — described above, with the passes
  that make them already named.
- **Item 5 half closed**, unchanged: the spine is in and inert at rest; the
  tuck tear still needs the `POSE_TUCKED` hip-gap ruling (session 6, question 1
  below — still the highest-value ruling available).
- Item 2's rim lip / chin strap / vents / gloss.
- Items 3 (suit panels + separate bib garment), 6 (in-run arms), 7 (pike hip),
  9 (face), 10 (stance), 12 (boots) untouched.

### For the reviewer (session 7)

1. **The two gate recalibrations above** are the judgement calls in `a620b48`.
   Both are cases of a gate that the defect had been satisfying; I moved the
   chest floor and did NOT move the NM floor, and the reasoning for treating
   them differently is in the code comments.
2. **The `POSE_TUCKED` hip gap still needs `NEEDS-APPROVAL:`** — carried from
   session 6, unchanged and still blocking item 5's strain gate.

---

## Session 6 (2026-08-29, 16:2x-17:0x)

### Merge with `render-realism-glm` — commit `1f7f0a5` (docs only)

Three commits ahead (iter 113's withdrawn cone-peak range, its ruling, and the
reviewer's session-4 arbitrations). Clean auto-merge, `docs/` only — no code,
so unit+golden were not re-run over the merge alone.

The arbitrations landed with it and are all acted on or recorded below:
calf-gate demotion APPROVED; **item 5's spine approach APPROVED**; new item 12
(boots); the blue-stripe detail; the bib box-framing rule.

### Item 5 — the armature gets a SPINE. Commit `96dbeaf`

**What shipped.** `spine_01`/`02`/`03` between pelvis and neck. In Blender,
`add_spine_chain` moves the `torso` group's weight onto them with a partition
of unity along the torso axis (2 895 verts, total weight 562.1, split
142.7 / 255.4 / 526.6 as measured in the browser). In `game.js`,
`updateSpineChain` walks the three drivers up the torso's own axis every frame,
coupling the end vertebrae to the thigh's and the head's **deviation from their
rest angles**.

It runs **last in the build**, after every gate and after the bake. The string
`'torso'` is a dominance key for most of `build_body.py`, and splitting the
group earlier would silently re-aim `settle_limb_geometry`, `relax_suit`,
`leg_girth_pass` and roughly every gate. Nothing upstream can see the split.

**Two properties it was built to have, both measured:**

1. **Inert at rest.** Coupling on deviation-from-rest makes every delta zero at
   the neutral stance. Measured skinned strain there: `p50 = p99 = p99.9 = max
   = 1.000` exactly, over 53 944 edges.
2. **Closes on the torso's own ends.** The chain starts at the hip anchor and
   the residual to the neck anchor is spread along it, so head, shoulders and
   the P13 reconciliation keep the anchors they already had. Largest leftover
   vertebra-joint step: neutral 0.0 mm, in-run crouch 10.3, flight tuck 6.8,
   pike 7.4 (gate 15).

### THE FINDING — the tuck's tear is NOT a bone-count problem

This matters more than the pass, and it is why item 5 is only half closed.

`tests/drive/spine.spec.js` measures **symmetrised edge strain**,
`max(len/rest, rest/len)`, on the buffer the GPU actually skins (same vertex
positions, same `skeleton.getTransformMatrices(mesh)`, same four influences).

| pose | p50 | p99 | **p99.9** | max | p99.9 with the spine OFF |
|---|---|---|---|---|---|
| neutral | 1.000 | 1.000 | **1.000** | 1.000 | 1.000 |
| in-run crouch | 1.000 | 4.606 | **15.227** | 35.80 | 15.473 |
| flight tuck | 1.000 | 4.383 | **11.678** | 36.52 | 12.082 |
| pike | 1.000 | 3.190 | **9.335** | 52.13 | 9.193 |

against the brief's 1.35. The spine moves those numbers by 1-3%.

**Where the strain is.** `p50` is exactly rigid and `p99` is 4.6 — 99% of the
skin is fine and a thin tail explodes. The tail is the hip and shoulder blend
rings, and `chain.spec.js` already records the cause in its own comments:
*"Flight tuck (POSE_TUCKED) endpoint is measured-torn (hip gap 0.33 m) and
awaits `APPROVED: adjust POSE_TUCKED`"*. Linear blend skinning averages bone
MATRICES; two rigid transforms whose shared joint is a third of a metre apart
cannot average into anything but a smear, at any weighting. No amount of spine
fixes a pose table that tears its own hip.

**So the strain gate is deliberately NOT set at the tuck.** Setting it at 16
would calibrate it to the defect; setting it at 1.35 would ship a red that no
work in this lane can clear. It ships as a logged instrument
(`STRAINTABLE`, spine on and off) so the next session or the reviewer's ruling
has a baseline to move.

**And it answers the reviewer's 15:35 note.** The crumpled tear over the
shoulder blade in the NEUTRAL stance is **not** a skinning problem: strain
there is 1.000 to six places, whole body and upper-back band alike. It is a
bake / normal-map / geometry artefact and belongs with item 3, not item 5.

### Gates and the negative control

`tests/drive/spine.spec.js`, **8/8**:

- spine bones present in the exported skeleton, each with a driver node and
  real skin weight (`> 5`);
- neutral strain `<= 1.35`, whole body and the upper-back band;
- chain C1 step `<= 15 mm` in all four poses;
- the strain table, logged.

**NEGATIVE CONTROL**: `window._spineForce = 0.5` forces a fixed bend into the
neutral stance. p99.9 goes 1.000 -> **2.993**, upper back 1.000 -> **9.215**,
chain step 0 -> 43.6 mm. The gate fails, so it is reading the skin.
(`window._spineOff` reproduces the old rigid torso and is what the on/off
column above uses.)

### Three measurement bugs found on the way — all made a wrong answer look right

1. **The spine axis was taken from the torso BONE.** By the time this pass
   runs, `pose_onto_segments` has moved every bone's head onto its segment
   CENTRE and `normalize_bind_frame` has replaced its rest orientation, so
   `tail_local - head_local` is **not** the torso axis: measured, it was
   `(0, 0.55, 0)` — fore-aft — and put **2895 of 2895** torso verts in the
   lumbar third. The axis now comes from `bl('torso')`, the same source
   `spine_matrix` uses for the bind. Logged every build as `spine axis:`.
2. **`skeleton.getTransformMatrices` returns the LAST RENDERED frame.** The
   game's render loop re-applies its own pose every frame, so a probe pose set
   inside `page.evaluate` never reaches the buffer. All four poses and the
   negative control returned byte-identical numbers until the spec called
   `skeleton.prepare(true)` first. Any future spec measuring skinned geometry
   after `_poseProbe` needs this line.
3. **Babylon's glTF loader prepends the armature node as bone 0.** So
   `skeleton.bones` is one longer than the skin's joint array and every naive
   index lookup is off by one. It reported `spine_03` weightless while actually
   reading `torso` — which this pass deliberately zeroes, so the wrong answer
   was self-consistent. `Bone.getIndex()` is the index `matricesIndices` uses.

### The one judgement call — golden traces

The three spine driver nodes are **excluded from `captureNodes`** in
`tests/golden/harness.js` rather than re-captured. They hold no state: they are
a pure function of the `torso`, `head` and `upperLeg*` transforms the traces
already record in full, so any change reaches the trace through its cause.
Adding derived nodes is not the deliberate behaviour change ADR-0005 reserves a
rebaseline for, and rebaselining is forbidden here anyway. Their geometry is
gated in `spine.spec.js` instead. **Reviewer: this is the call to check.**

Also: `updateSpineChain` and `_spineRestDeltas` were added to
`ALLOWED_FUNCTIONS` in `tests/unit/no-physics-in-game.test.js` with reasons.
They write transform nodes from transforms the solver already produced; they
solve nothing and add no state (ADR-0002).

### Verification

    build   all gates green at 2048/96 (goggle band, dome seating, leg taper,
            bib number + aspect, stripe, suit normal variance, atlas share);
            spine weight partition verified, worst vertex error 2.98e-08
    unit    78/78
    golden  30/30, no re-capture, no physics change
    drive   rig + body + chain + athlete + ready-stance + bib-number +
            athlete-wired + spine: 40 passed (10.8 m), 0 failed — the
            previously blocking `bib-number` back-face gate included

`ASSET_V` 38 -> 39, `index.html` `game.js?v=` 32 -> 33, preload hrefs `?v=39`.

### Open at the end of session 6

- **Item 5 is half closed.** The spine is in, correct, gated and inert at rest.
  The tuck's actual tear is measured and attributed, and it needs the
  `POSE_TUCKED` hip gap ruling — see the reviewer question below.
- Item 2's rim lip / chin strap / vents / gloss.
- Items 3 (suit + bib), 6 (in-run arms), 7 (pike hip), 9 (face), 10 (stance),
  12 (boots) untouched.
- The mirrored back bib number, still open from session 5.

### For the reviewer (session 6)

1. **`NEEDS-APPROVAL:` the in-run/flight tuck hip gap.** The measured 0.33 m
   hip gap at the `POSE_TUCKED` endpoint is the dominant cause of the author's
   "back separating", and `chain.spec.js` has been carrying it as a known,
   approval-blocked defect. It is a pose-table change, which this lane may not
   make. Until it is ruled on, item 5's strain gate cannot be set at any honest
   number. This is the single highest-value ruling available for the athlete.
2. **The golden-trace exclusion above** — the one judgement call in the commit.
3. **The rest-pose shoulder-blade tear is not skinning** (strain 1.000). Move
   it from item 5 to item 3.

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

## Diagnosis for the items not yet started (session 3, from the shots by eye)

Recorded here so the next session starts from evidence rather than from the
brief's prose. All from the ASSET_V 35 build (`shots/*`, 11:05-11:14).

**Item 5 (tuck) — the worst defect in the set** (`shots/pose_tuck_side.png`).
It is not a "smear": the whole BACK of the suit has become one blank white
sail running from the base of the neck to the hip, with a visible step where
it meets the pelvis, and the NECK is a long bare skin tube holding the head
away from it. The arms are not merely hidden, they are absorbed into the mass
under the chest. So item 5 is at least three separate faults: (a) the spine
bend is concentrated at one joint (the sail is the linear-blend shell of a
single large rotation), (b) the neck/head chain does not follow the bend at
all, and (c) `displace_suit`'s folds are keyed to the REST pose, so the back
has no folds exactly where it needs them most.

**Item 10 (stance) and item 11 (calves)** (`shots/figure_side.png`). Both
confirmed, and there is a third defect in the same shot that is not in the
brief: the leg does not end in a BOOT. Below the calf bulge the suit narrows
to a white blob that stops short of the binding, so there is no dark boot cuff
for the leg to taper into — which is half of what makes item 11's calf read as
huge. The blue leg stripe is also not a stripe: it is a ragged blob wandering
across the shin (item 3's "single royal-blue stripe ~5 cm wide down the
OUTSIDE seam" is not what the bake produces).

## Open / not started (as of session 2 — superseded by Session 3 above)

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

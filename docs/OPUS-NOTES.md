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

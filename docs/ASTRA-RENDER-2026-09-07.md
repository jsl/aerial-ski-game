# Astra skier rendering review — September 7, 2026

Branch: `render-realism-glm` (initially clean, never switched to main).

User direction: retain the established slim aerialist/racing suit; reduce shoulder
slope and upper-body bulk; correct backward/double-toed boots; keep both toe and
heel fixed during downhill skiing and aerials. Skis may release during crashes.
Smooth the tuck transition and crash body deformation. After crashes, allow scene
panning and substantial zoom-out. User extended the review loop to approximately
18:00 Pacific local time (2026-09-08 01:00 UTC).

Earlier feedback is in `RENDER-PROGRESS.md` (September 1 heel lift/tuck entry,
September 2 boot shape and slide crumpling, September 4 upper-body bulk) and
`HANDOFF-BODY-2026-09-05.md`, including the September 7 F9/F10 updates.

## GPU setup

Both the asset build and actual browser renderer were verified on the NVIDIA
GeForce RTX 5070 Ti. Blender 5.2.1 uses Cycles OptiX. Browser checks use
`DRIVE_GPU=1`, selecting headless ANGLE/Vulkan without SwiftShader. Actual loaded
game reports WebGL 2 and `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce
RTX 5070 Ti (0x00002C05)), NVIDIA)`.

```
DRIVE_GPU=1 DRIVE_PORT=8395 npx playwright test -c tests/drive/playwright.config.js freelook.spec.js
DRIVE_GPU=1 DRIVE_PORT=8396 npx playwright test -c tests/drive/playwright.config.js boot-sole.spec.js '(^|/)look.spec.js$' pose-shots.spec.js
```

Keep frame-sensitive crash/get-up/walk-off suites sequential. The portable test
configuration still supports software rendering when `DRIVE_GPU` is unset.

## Baseline and first visual pass

Artifacts: `shots/astra-before/` and `shots/astra-pass1/` (ignored, reproducible).

- Baseline side view: the rounded boot toe points backward; shoulders/back are
  bulky, the waist lacks taper. Existing signed boot-axis tests encode the
  backward shape (longer projection toward the ski tail).
- New delivered-sole measurement selects the actual skinned sole bottom vertices
  and transforms them into the ski frame. At grounded tuck 0.25/0.5/0.75/1.0,
  heel lift reaches approximately 19/39/59/77 mm. The old ankle-point check
  assumes a parallel sole, hiding this rotation. Aerial tuck/pike stay within
  4.6 mm in the baseline.
- First build: correct forward toe and shorter upright heel; independent boot
  bones keep soles parallel while cuffs follow shin flex. The first review
  catches a 27 mm downward seating offset and exposed old foot geometry behind
  the shorter heel. These must be corrected before accepting the asset.
- Existing TORSO1 torso shaping now passes after F9's topology repair: chest
  depth 206 mm, waist/chest 0.819, maximum profile step 8.7 mm. Modest shoulder
  crown lift added. The first visual review still sees excess upper-back mass.
- Grounded stationary tuck previously blends through an aerodynamic crouch and
  then back toward a squat. Direct standing-to-squat interpolation removes that
  detour while retaining in-run pose blending and gameplay state.
- Crash spine uses wrapped relative angles so crossing the ±pi Euler boundary
  cannot introduce a false 180-degree difference in thigh/head alignment.

Boot shape gate correction is based on the user's explicit request and physical
orientation: the toe must extend toward the upturned ski shovel, the heel toward
the tail. New design projects 180 mm forward and 70 mm backward about the fixed
ankle station. It replaces tests demanding the opposite direction; it does not
relax sole contact or foot containment.

## Camera correction

Automatic crash framing previously pulled radius toward 1.9 m every frame and
re-centered the target during panning. A mouse/touch camera gesture, wheel input,
or WASD camera input now takes ownership until the next run. The free-look range
extends to 240 m; panning scales with view distance. Automatic initial crash
framing remains available before user input, and the terrain clamp remains live.

The forced-crash browser regression passes with real wheel zoom to 240 m and a
roughly 15 m right-drag pan. After Babylon finishes easing, the target stays
exactly where the user placed it. The baseline orbit-persistence test failed
before this fix. Full camera/terrain regression results are recorded below when
complete.

## Second visual pass (v106)

- Full 3D boot offset now follows the ski normal, including the 22-degree roll
  in the across-slope ready stance. Actual toe/heel contact passes the 5 mm
  gate; the previous offset had omitted the normal's lateral component.
- The hidden old foot is reshaped inside the boot shell; side-view review shows
  no backward foot protrusion. Assets rebuilt with OptiX at 2048/96.
- Unit tests: 88/88. Golden scenarios: 30/30 unchanged. GPU spine suite: 14/14.
- Camera suite: 6/6. Extra landing-tilt coverage in all three worlds passes
  after preserving the tilt baseline across drags and refreshing the camera
  view after terrain clamping.
- Wider body regression: 24 pass, 5 fail. Remaining failures concern ankle
  pixel framing, the old bbox-midpoint ankle station, rendered strap sampling,
  leg-axis station measurement, and stationary hand-to-knee reach (208 mm
  against a 200 mm limit). These are under investigation, not waived.
- Live tuck-entry reports an existing 144 mm shoulder handoff jump and an
  80 mm hip start jump despite passing its interim 150 mm limit. These are
  the next animation targets; passing that interim gate does not mean smooth.
- Upper-back vertices are predominantly upper-arm/shoulder-helper owned, so
  the torso-only reshaping misses the remaining rounded shoulder mass. Palette
  indices must be resolved with `bone.getIndex()`; array order includes a
  synthetic root and differs by one. No remote-knee weighting defect was found.

The rendered sole test now samples both stationary squat and downhill crouch,
aerial tuck and pure pike; a 3 cm displacement of the actual boot meshes is its
negative control. The stationary pose helper takes a stationarity weight as its
second argument (1 at the gate, 0 while moving), not a second tuck amount.

## Cuff instrument correction (before the third build)

The old leg-axis G2/G3 tests locate the ankle at the boot bbox midpoint. That
midpoint moves deliberately when correcting the backward toe and shortening the
heel; it is unsuitable for the ankle station. The replacement uses actual
skinned cuff-ring vertices in each ski's local frame, with side-specific leg
ownership resolved through the skin palette. G1 retains 30 mm; G2 retains 35 mm;
G3 retains a 60 mm block-displacement bound about the ski mounting station.
Actual vertex counts replace the old hardcoded `n:1`. An additional negative
control translates the rendered boots 120 mm along their skis.

This improved instrument stays RED on v106: left/right cuff centers are
-32/-34 mm along ski z while the shins are +12/+15 mm (44/49 mm mismatch).
The earlier stable asset has cuff centers +38/+35 mm and shin centers +11/+14 mm.
Thus the toe correction also flipped too much cuff lean; the next build must
fix cuff alignment independently of the toe. The instrument does not hide this
real regression. `tools/measure-leg-axis.js` is shared by the browser test and
`tools/probe_leg_axis.js` so the public probe reports the same geometry.

## Live tuck motion review

`tools/capture-skier-motion.js` records a real keyboard-driven tuck cycle with
GPU-rendered video, stills and per-frame driver positions. Baseline footage from
the stable preview (`shots/astra-motion-before/`) exposes a 521 mm leg jump at
full tuck. The initial working-source capture also catches a 534 mm jump from
tuck 0.9995 to 1.0, confirming a true endpoint discontinuity rather than input
speed. Joint-gap tests missed it because the connected body moved together.

The P13 renderer correction used its nominal blend weight only as an on/off
condition; it also positioned the shin using the thigh angle and relocated the
skis from that temporary chain. Grounded skis now retain their authored stations,
and the shin uses its own angle. The ready-stance thigh adjustment now preserves
the underlying squat instead of replacing it until a threshold. Grounded arm
attachments use the actual shoulder station rather than the torso's neck end.

New actual-motion regression passes: 74 frames, worst torso step 30 mm and
forearm step 61 mm during the initial 0→0.0835 input increment. The endpoint snap
is gone. The gate bounds per-frame driver movement relative to the tuck change,
with a small allowance for ready sway. Crouch suit/back appearance still needs
visual refinement; the saved video/stills document that separately.

## Third build and shoulder attachment

Asset v107 keeps the toe correction while restoring a neutral 3-degree cuff
lean independently of toe direction. Delivered soles remain within 5 mm of ski
tops through grounded and aerial poses; cuff/leg-axis tests and their actual
mesh-displacement controls pass. Boots plus grounded-tuck checks pass 18/18;
spine and strict 30 mm tuck-entry checks pass 17/17 on the GPU. The boot pixel
instrument now measures the actual ankle cloud rather than the shin center,
uses the visible boot face, and distinguishes navy by chroma under shadow.

Raw-versus-posed skin measurement found the upper-back bulge was partly an arm
attachment error: the ready stance translated the complete arm about 70 mm
backward to bring the hands near the thighs, also translating the shoulder and
sleeve-owned back vertices. A representative back point moved 49.6 mm backward.
Hands now follow with a small rigid arm swing about the shoulder. The side view
in `shots/astra-motion-shoulder/` has substantially less back bulge. The default-
off scapular reshaping experiment was removed; the reproducible v107 build path
passes its existing mesh/profile gates. Deep-squat waist deformation remains
visibly poor and is the next investigation.

## Crash camera review

Wheel, drag, or WASD input during a crash now takes manual camera control;
automatic target-follow, close-up zoom and broadside framing then yield. Free-
look radius extends to 240 m with proportional wheel zoom and radius-adjusted
panning. The GPU interaction test reaches the wide survey view and moves its
target more than a meter without the automatic camera reclaiming it.

Successive terrain-clamped drags preserve the target-height baseline. Releasing
a drag ends the tilt gesture, and an off-canvas release reaches Babylon's DOM
input. The sticky-drag test now uses `button: -1` for pointermove, matching real
browser events; its old default `button: 0` produced artificial button changes.
All six free-look checks pass. The broader landing-lip framing check exposed a
race in its setup: it assigned an uphill heading while automatic crash framing
still owned the camera. It now takes manual control before assigning the review
heading, and is awaiting its next run with the strict projection gate intact.

`tools/capture-skier-crash.js` records actual forced-touchdown gameplay through
crash, rest and recovery, with video, timed screenshots and per-frame driver/
ragdoll data. Baseline footage is in `shots/astra-crash-before/`. Crash/get-up/
walk-off regressions run sequentially to keep their real-time sampling reliable.

The corrected landing-tilt setup passes in all three worlds, including its
negative control and restart reset. The camera group is now 7/7 green. The
latest post-shoulder physics audit remains exact across 30 scenarios / 5,408
frames; all 88 unit tests pass.

Broader crash checks are exposing existing-instrument and motion questions:
triple slide onset is 1.79 s after first ground contact while the test still
expects the superseded 1.4 s rule; final F10 source waits for contact after 0.6 s
or a 4 s emergency wall. The positive chopped-snow speed difference is 12.7%,
inside its 10–20% band, but a separate-run legacy negative control also reaches
11.9%. One late neck-rate sample exceeds 90 degrees/s. These gates remain
unchanged pending baseline comparison and diagnosis; successful boot/pose
checks must not be presented as a fully green crash regression.

## Shared shoulder anchor and aerial endpoint check

The original stable v104 preview passes all four crash/recovery cases that
failed in the first v107 broad run (same tests, GPU renderer). Treat those
working-tree failures as possible pose-seed regressions, not as proven baseline
failures. No crash timing, speed, or motion-rate thresholds were relaxed.

An added airborne endpoint check directly measures rendered driver positions
at tuck 0→0.001 and 0.999→1. It reproduces a 125.27 mm upper-arm jump when the
old P13 shoulder correction switches on. The new shared anatomical shoulder
attachment stays active at both endpoints; arm movement is now 0.2–0.35 mm for
those increments. The same attachment applies after gamepad lateral posing
and to recovery's solved-pose copy, which previously left the engine's fixed
shoulder pivot behind as the rendered torso moved. Grounded tuck motion and
actual delivered sole checks remain green. The new helper is explicitly listed
as renderer-only in the engine-boundary unit test.

Crash relative thigh averaging now uses circular angles as well as wrapped
individual differences: thighs at +179 and -179 degrees must average near
180, not zero. This remains a display-only spine calculation.

Fresh close crash footage is in `shots/astra-crash-current/`; the study camera
shows bunched shoulders during recovery before the shared shoulder correction.
The default get-up/walk-off finishes normally in this recording. A targeted
post-correction crash rerun is in progress.

## Waist skin/UV passes v108 and v109

The central waist initially carried mostly upper-arm weights: a 31 mm edge
collapsed to 3.3 mm in the real squat. Final-coordinate trunk ownership repair
removes that contamination. A complementary pass removes trunk influence from
actual outboard sleeve vertices. Both run before UV zoning and are reasserted
after helper assignment. Several scratch builds correctly failed zero-overlap
or stripe-width checks; none were installed. The accepted UV repair gives the
curved inner shoulder/armpit its own chart, rather than relabeling ownership or
relaxing the zero-overlap gate. The upper-arm stripe retains its specified
minimum width; paint and normal-relief masks use the same authored arc.

v108 and v109 build with all gates green on OptiX / RTX 5070 Ti, 9,097 vertices,
23 bones and zero shared arm/trunk UV texels. Current review footage is
`shots/astra-motion-pass5/`. Numeric worst-edge strain improves from 9.46 to
6.80 to 5.22 across these repairs, but the eye still sees a folded back waist.
Exact visible-triangle picking shows that remaining region is mostly spine/
hip-owned. Clay captures in `shots/astra-clay-pass5/` and the diagnostic rigid-
spine comparison `shots/astra-clay-rigid/` prove this is geometry, not baked
normal/colour noise. Removing the spine bend suppresses much of the paper-like
waist fold. A proper smooth spine curve is being investigated; the rigid-spine
negative control is not being shipped.

## Crash contact correction

The tumble contact solver projected a point out of snow but cleared its stored
vertical velocity only when the previous point was higher. If constraint
projection raised the current point above the previous one, this created an
upward Verlet velocity on the next substep. Snow contact now clears that
artificial rebound on every floor projection. Unchanged slide timing and ski-
brake gates pass all three venues afterward. The late joint-rate gate still
reports an elbow at 2.35 rad/s; the uniform 0.3 m/s post-fold fall cap ignores
that a moving hinge can rotate both adjacent short segments. A per-lever late
cap is staged for verification (head/neck 0.15, arms 0.18, legs 0.25, trunk
0.3 m/s). Gameplay engine/state code remains unchanged.

## Review checkpoint (loop continues)

The bounded spine curve passes its 14 GPU regressions and three targeted unit
cases; adjacent vertebral direction changes are at most 0.20 radians while the
hip/neck closure remains within 3 mm. The visible waist fold is reduced, with a
remaining diagonal seam linked to hip-helper influence high in the abdomen.
The fixed boot test now also verifies unchanged toe/heel mounting stations
through every pose, and rejects both a 3 cm lift and a 3 cm longitudinal slide.

Immediately before deliberately refreshing display traces, the exact audit
compared 30 scenarios / 5,408 frames with zero physics-state differences. The
standing ADR-0005 display-only recapture condition is therefore met. After
capture: 30/30 golden scenarios, 90/90 unit tests, 36/36 integration assertions,
all scenario-distinctness checks, and all five golden mutation controls pass.
The physics engine files are unchanged. This is a review checkpoint on the
working branch, not an all-green merge candidate: the actual crash angular-rate
check still fails in some poses. Full crash traces now retain both simulation
and wall clocks; a sampled neck rate reaches 2.27 rad/s in simulation time, so
this is not dismissed as a wall-clock artifact. Camera checks, boot/pose checks,
and all three crash-rest contact checks are green. Further waist and crash
refinement continues until the requested Pacific-time cutoff.

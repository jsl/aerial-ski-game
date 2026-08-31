# NEXT — single mandated task (reviewer, posted with the Opus merge; author priority 2026-08-30 13:15)

**THE SUIT RESHAPE. This is a multi-iteration task: it stays your only task until every gate below is
green; delete this file only in the commit that completes the whole set.** The athlete-file ban is lifted
for exactly this work (this file is the NEXT.md the standing rule's amendment refers to). The Opus lane has
ended and its branch is merged into this one.

**State you inherit — read before editing anything.** The shell EXISTS: Opus session 28 built it
(`bb125ee` "the suit is a fitted shell, not a filtered skin", items 1+4) — limbs read as cloth cylinders,
shin straight into the boot cuff, no quad line. Session 31 took the arm/trunk UV overlap to zero; session
32 shipped the arm stripe (`9e81fcc`). CONTINUE this work; do not rebuild from scratch. Session logs are in
`docs/OPUS-NOTES.md` (session 28's entry lists exactly what the shell does not yet cover).

Order:

0. **Fix `look.spec`'s FACEDIST gate first — it is inverted and has been red for three sessions.** The
   honest build measures 0.1411 and FAILS while the sabotage control `BODY_SABOTAGE_FACE=1` measures
   0.1719 and PASSES; the abort also stops `figure_side.png` from being written. Fix the comparison
   direction, make the gate non-fatal to the rest of `look.spec` (figure shots must always render), and
   prove it: sabotage control actually FAILING, honest build passing. No face/figure number recorded while
   the gate was inverted may be cited.
1. **Fix the shell's knee-band collapse — a RED gate on the branch you start from.**
   `spine.spec` "in-run crouch: the knee does not collapse": kneeMax **32.516** vs `KNEE_MAX = 8.0`
   (flight tuck 7.247 — barely under). Reviewer bisect (13:55, single-spec runs on the Opus worktree):
   session-27-end `cc05ab2` measures 5.615 PASS; session-28-end `ad7304f` measures 32.516 FAIL — **the
   shell commit `bb125ee` introduced it** (edge census also changed 3028 → 2992 there). The shell's knee
   band strains ~4× the cap in the deepest crouch (98° knee). Fix the shell's knee-band geometry/skinning
   (a fold-tolerant ring layout or knee-weight re-blend on the shell); the gate goes green at 8.0 —
   do NOT recalibrate the gate to the defect. Keep flight tuck comfortably under too.
2. **Finish the shell to the #12 gates** (full text in `docs/OPUS-BODY-BRIEF.md`):
   - The segments session 28 recorded but could NOT yet gate — upper arms (curvature 1.037/0.715), thighs
     (0.529/0.455), torso (0.644) — must come under the ≤ 0.35 curvature-variance gate. Two named causes:
     the upper-arm tube is fitted through a sheet of chest-wall vertices left by the arm rebind (exclude
     non-limb geometry from the fit), and the thigh's iron is capped by the skin-derived `thigh_depth`
     gate. **Reviewer ruling on session 28's open question: re-derive `thigh_depth` on the GARMENT shell,
     not the skin — the shell is what shows; that frees the ~10 mm of relief the thigh iron needs.**
   - Then the remaining #12/#7 visual items on the shell: two-tone panels + collar + cuffs (the suit is
     still white-on-white; the red collar line at the throat is item 9), and the crotch/inner-thigh shard
     cluster cleanup. Frame gates hold throughout: shoulder ≤ 1.35 × hip, upper-arm tube ≤ 0.55 × thigh
     tube, ≥ 4 cm inner-thigh gap, bideltoid per the brief.
   - Articulation and invariants must not regress: `rig.spec`, `chain.spec`, `spine.spec`, the
     boot-binding gates and the golden suite stay green in every non-crash state.
2b. **HUMAN TESTING #15 (author, 17:00) — A-frame legs.** Full spec in the #15 Reviewer-feedback entry:
   frontal-plane hip→knee→ankle near-collinear (knee deviation ≤ 5°), thighs angling out from the crotch
   with visible daylight between them all the way to the knees, no calf fan-out at the knee (shin frontal
   tilt smooth, ≤ ~8°), ankles staying at ski spacing with the binding gates green. NEW GATE REQUIRED in
   render space (silhouette daylight in `figure_front.png`, ≥ 3 cm projected at mid-thigh) — the existing
   45.5 mm mesh-space gap gate passed while the author sees touching thighs, so it does not count as
   evidence here; the current build is the failing negative control.
2c. **HUMAN TESTING #16 (author, 17:50) — REAL SKI BOOTS.** Full spec in the #16 Reviewer-feedback
   entry; reference image `reference/shots/author_boot_ref_2026-08-30.jpg`. The current foot reads as a
   shoe with visible toes — replace with a two-part rigid boot (clog + cuff, ribbed tongue, smooth toe
   box with NO toe contours, sole ledges at toe/heel, 2–3 buckles + strap, no logos), cuff at mid-shin
   with the suit shin tube ending inside it. Binding-contact and boot-on-ski gates stay green; the
   current toed shoe is the failing negative control.
2d. **HUMAN TESTING #21 (author, 22:00) — heels NEVER leave the skis; the tuck is rebuilt around that.**
   Full spec in the #21 entry. Do it WITH #16 (the boots): (a) toe/heel-on-binding ≤ 5 mm in every
   non-crash frame including all of flight (heel lift = gate failure; skis eject only on crash);
   (b) the flight tuck becomes knees-to-chest with a more upright back (torso within ~30° of
   straight), skis riding up with the legs, elbows held in toward the body (not winged). Per-frame
   flight sweep gate + tuck pose gates (incl. elbow-to-torso distance); the
   current lifted-heel forward tuck is the failing negative control. Pose/display only — golden
   physics unchanged.
3. **Arm stripe — VERIFY, do not redo.** Session 32 shipped it (`9e81fcc`: repair pass enabled on the
   zero-overlap unwrap; torso-back blueFrac 0.135 → 0.073, gate < 0.10). Confirm on the merged branch:
   leak gate green, stripe visible on BOTH arms as a band on the outer seam in the figure shots, default
   flag state correct. (Session 28's "ragged inner-leg patch" note predates this fix — re-look, don't
   trust either note.) If verification fails, the fallback is the 12:55 ruling: paint by the SHIPPED
   weights.

Each landed step: rebuild via Blender, bump `ASSET_V`, regenerate `figure_side.png` / `figure_front.png` +
a top view, record the gate numbers in your progress entry. Verify order per the standing rules
(`audit-physics-state.js` → `capture.js` → `verify.js` LAST if traces are touched).

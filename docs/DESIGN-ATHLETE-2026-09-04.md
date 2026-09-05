# DESIGN PASS — the athlete's body (Fable, 2026-09-04)

Written at the author's request ("do a fable pass on the design … use that to inspire future
sub-agents"). It is a design document, not a slot spec: it says what the athlete should look
like, why the current build cannot get there by adding passes, and how the next passes (Opus,
Muse, GLM) should work instead. Every number here is measurable with instruments that already
exist (`tools/probe_leg_axis.js`, the 5 cm band scan in the reviewer's `bodyshots.js`, the
build's `leg_profile`/`torso_profile`).

## 1. What the eye wants (the target)

From the footage (`docs/REFERENCE-FOOTAGE.md`), the author's reference shots
(`reference/shots/author_*`) and the author's reports since 2026-08-28 ("fat upper body",
"legs misshapen", "not in the boots", "knees", "sweeps away", "back stretches"):

- **A slim aerialist in a racing suit.** Shoulder breadth ≈ 2.2 head widths; chest DEPTH
  ≈ 0.50–0.55 × shoulder breadth; a V-taper to a waist 0.75–0.82 × chest width; hips ≈ waist;
  arms hang CLEAR of the ribs (daylight between upper arm and torso from the front).
- **Legs are one smooth column per side**: thigh 150–160 mm → knee 112–118 → calf 118–122 →
  ankle ≈ 75 (the author-approved 239 triplet), no step > 12 mm and no dip > 10 mm per 2 cm
  row from the crotch to the boot cuff; the shin straight ON its bone, inside the cuff; the
  foot inside the boot; knees read as joints, not lumps.
- **Suit, not skin**: racing-tight, matte white with the royal-blue panel/stripe, bib with
  the number, dark helmet, gloves; fabric relief present but subtle (the NM-variance floor).
- **Poses**: layout with arms by the ears in flight; ready stance crouched with hands ahead;
  after a crash the body lies down and gets up without limbs whipping.

Current shipped v103 against that: shoulders 46–48 cm (fine), chest depth 26–30 cm (**0.60–
0.65**), NO waist taper (width 47–49 cm from armpits to hips), arms fused to the ribs from the
front, legs on the bone and in the boots (v101/v102 — done), thigh 143 / knee 115 / calf 126
(near the triplet), knees ringed but the rows above still lumpy, seat shelf from the side.

## 2. Why "one more pass" keeps failing

`blender/build_body.py` (14.7k lines, 261 functions) is: a base body mesh → skin → pose onto
the physics segments → ~30 corrective passes in sequence (soften, retune_proportions,
straighten_forearms, settle_limb_geometry, add_girth, narrow_shoulders, suit_shell fit+move,
A-frame thigh tubes, sever + close_boundary membranes, knee bridge, knee repair + ring,
LEG_RECEN re-centre, boots, seat_soles, bake) → ~100 gates. Three structural facts:

1. **Each pass corrects the previous pass's output, and each gate was calibrated on the
   state that existed when the gate was written.** So any intentional change of shape trips
   gates that were never about the shape (268: thigh slope → taper gate; 269: closer order →
   sliver gate; 284/286: foot rows → winding gate; 301: slim waist → bib-fold + weight-seam
   gates). The lane spent ~10 slots this week on gate collisions, ~3 on the actual defect.
2. **The gates measure girth, smoothness and topology — not where the silhouette is.** The
   shin stood 11 cm ahead of its bone for weeks with every build gate green (law 11 came from
   this). The eye's contract had no instrument until `leg-axis.spec` (276).
3. **The base mesh is the design by default.** The shell fit follows the base body's rung
   medians (its swept shin, its boxy ribcage, its seat), so the athlete inherits whatever the
   base mesh was, and every pass fights it locally.

Adding a 31st corrective pass with a 101st gate does not change any of this.

## 3. The design: author the silhouette, fit the shell to it

**One proportion sheet, one silhouette instrument, and the shell targets the sheet.**

- **`blender/body_design.json` — the proportion sheet.** Per segment (torso, upperArm, lowerArm,
  upperLeg, lowerLeg, head): the breadth and depth at three stations (proximal / mid / distal)
  and the cross-section exponent, in metres, derived from `blender/body-model.json`'s segments
  (the physics truth: lengths and masses) plus a suit allowance, and from §1's ratios. The
  first sheet is WRITTEN BY HAND from the measurements above (torso: shoulders 0.46, chest
  depth 0.24 at 0.52, waist 0.36, hips 0.36; thigh 0.155 → 0.115; shin 0.120 → 0.075; arms
  0.10 → 0.07), then tuned by eye against the footage. The sheet is the design; the base mesh
  supplies topology, UVs and weights only.
- **`silhouette_gate` — the instrument.** On the built (and, in game, the skinned) mesh: per
  2 cm band along each segment, the lateral and fore-aft extents vs the sheet's interpolated
  target ± 8 mm; reported as a table (segment, band, target, actual, delta) and gated on the
  worst delta and on continuity (STEP ≤ 12 / DIP ≤ 10). Negative control: a perturbed sheet
  (+30 mm at the waist) must fire. This ONE instrument replaces the shape half of the gate
  stack (taper bands, thigh completion, torso-profile, front taper); the topology half
  (watertight, winding, slivers, locality, NM variance, boots, leg-axis) stays as is.
- **`_seg_target` reads the sheet.** The suit-shell tube for every segment is the sheet's
  superellipse at that height (axis on the bone as v101 made it; the A-frame lateral line
  for the thighs), not the base body's fitted rung medians. The shell move pulls the skin
  onto it with the existing joint fades; the knee bridge blends two sheet tubes. Membranes,
  sever, boots, bake, gates run unchanged after it.
- **What this buys**: a body change becomes an edit to a JSON number with one instrument
  that says whether the mesh followed; the base mesh stops being the hidden design; the
  eye's contract (§1) is what the gate reads.

## 4. How the next passes should run (Opus ×3, then Muse/GLM as the author decides)

Sequential slots in the primary tree, each ships only on green + by-eye stills, laws 1–12:

1. **OPUS PASS 1 — the sheet and the instrument.** Write `blender/body_design.json` (hand
   numbers from §3), `silhouette_gate` as a REPORT (not yet gating) with the NC, run it on
   v103: land the delta table in the entry (it should show chest depth +40–60 mm, waist +100 mm,
   thigh/knee/calf deltas, the seat shelf). No geometry change, no asset. This is the
   "red before" that law 11 requires.
2. **OPUS PASS 2 — the torso from the sheet.** `_seg_target` for torso + arms reads the sheet;
   `silhouette_gate` goes hard for those segments; the bib plate scales with the chest
   (0.60 × chest width — ruling on 301); the belly weight seam is re-localised after the
   reshape; topology gates unchanged. Ship v10x with both tag files + front/side/author-angle
   stills; the arms must clear the ribs in the front still.
3. **OPUS PASS 3 — the legs from the sheet.** Thigh/shin tubes read the sheet (the leg-axis
   re-centre, boots anchoring and knee ring stay); `silhouette_gate` hard for the legs; the
   seat blended into the thigh; ship with the leg close-ups.
After those, the GLM refactor (304–307) splits the file by pass; `silhouette_gate` and the
sheet get their own module.

## 5. Principles for every sub-agent working on the body (read before the slot spec)

- **Measure what the eye sees, on the skinned mesh in the game pose**, before and after. A
  build-side gate that is green while the author sees the defect is measuring the wrong thing
  (law 9/11). Put the number in the entry.
- **One instrument per design intent**; never add a gate whose threshold is "whatever HEAD
  reads". A gate that goes red because the design changed is a gate to re-derive from the
  design, by written ruling — never a gate to loosen, and never a gate to rewrite in the
  same commit as the change it would catch (law 12; 284).
- **Fix at the source, not downstream.** If the waist is slim and the bib overhangs, the bib
  scales with the chest; you do not widen the waist back. If a closer segfaults on a moved
  ring, the ring moved as a tear — move the neighbours too (F8), don't re-order the closer.
- **Ship only what the eye accepted.** Three stills (front 1.6 m, side 1.6 m, author angle)
  described in the entry with the numbers; the reviewer takes the same stills.
- **Small, verified, reversible.** Env-gate the mechanism, prove the default build is
  byte-identical, preserve `wip.patch`, and let the reviewer flip the default.
- **Never-carry, never-fabricate.** A dead session's work is preserved and reverted; an
  entry claims only what it ran, with the numbers it read.

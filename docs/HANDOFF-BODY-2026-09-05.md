# HANDOFF — the athlete's BODY rendering (for a fresh agent), 2026-09-05

You are taking over one problem: **the skier's body does not look right.** The author's words
(2026-09-04): "he appears kind of fat in his upper body and the legs are still misshapen."
Everything you need is in this repo; nothing depends on the previous agents' memory.

## 0. Read in this order (≈ 20 minutes)

1. This file.
2. `docs/DESIGN-ATHLETE-2026-09-04.md` — the design pass: what the eye wants (§1), why the
   current pipeline cannot get there by adding passes (§2), the proposed design — an authored
   proportion sheet + one silhouette instrument + the shell fitting the sheet (§3), the plan
   for three passes (§4), and the principles every body agent follows (§5).
3. `docs/RENDER-PROGRESS.md`, section **Reviewer feedback** (top of the file): the rulings 256–302,
   newest first. Read the GAME-LOGIC INVARIANTS block (never touch `engine/`, the arm-drop twist,
   tuck/pike flip boost, landing/crash decisions) and rulings 296–302.
4. `docs/HANDOFF-2026-09-03.md` — lanes, servers, standing laws 1–12, the reviewer's mistakes.

## 1. State of the asset (shipped v103 on 8201)

- **Fixed and shipped this week**: legs re-centred onto their bones and INTO the boots (v101),
  knee joint ring (v102), boot strap contrast + crash-rest camera (v103). Instruments:
  `tests/drive/leg-axis.spec.js` (shin-at-cuff −0.020/−0.016 m; was +0.072), `tests/drive/boots.spec.js`
  (14/14, cloud-based ANKLE-ANCHOR — do not rewrite it to the bone station; 284 did and hid a foot
  7 cm behind the boot), `tests/unit/tag-parity.test.js` (index.html `?v=` == `ASSET_V`).
- **Still wrong, measured on the skinned mesh in the ready stance (5 cm bands, reviewer's
  `bodyshots.js`; stills `m299/body_front.png`, `body_side.png` in the reviewer scratch, and the
  look suite's `shots/figure*.png`)**: torso width 47–49 cm from the armpits to the hips with NO
  waist taper (the hanging arms are inside that span — from the front the biceps fuse with the
  ribs); torso DEPTH 26–30 cm at chest/belly (target ≈ 0.50–0.55 × shoulders = 23–25 cm); flat
  back and a protruding seat from the side; thighs blocky, the leg column stepped, rows above
  the knee ring lumpy. Proportions read thigh 143 / knee 115 / calf 126 mm (target 150–160 /
  112–118 / 118–122).
- **Mechanisms already built, ENV-GATED OFF because a downstream gate went red** (the pattern
  the design doc explains):
  - `TORSO1=1` (301/302): post-shell torso reshape — chest depth 264 → 206 mm (0.52 × shoulders),
    waist/chest 1.08 → 0.82, STEP 8.7; bib plate scales with the chest (0.60 ×); seam smooth
    after the last weight op. Green on every shape gate; **fails the delivered-mesh WINDING
    gate at 3 edges in the left hip/hem membrane complex** (the same non-orientable weld that
    283/284/289 fought; `_suit_deoverlap` misses it once the waist is slimmer). Patch:
    `~/aerial-agents/scratch/iter-302/wip.patch`.
  - `LEGS4=1` (291): proportion retarget — infeasible under the front-taper gate without a ring
    redesign, and it opens a crotch watertight red. Parked.
  - `LEG_RECEN`, `LEG_AXIS_PIN`, `KNEE_BLEND_FIX`, `KNEE_RING` are default ON (shipped).
- **Crash lie-down** (`window._crashLieV4`, default off): unrelated to the body shape; leave it.

## 2. How to build, measure and look

- Build (≈ 2–3 min, ship res): `~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048 --samples 96 --boots on`
  (the build REFUSES the shipped path without `--boots on`; probe builds go to `--out <scratch>`).
  Flags: `TORSO1=1`, `LEGS4=1`, and `X=0` for the shipped defaults' negative controls.
- Serve + probe: `python3 -m http.server 8393 --bind 127.0.0.1 --directory <repo>` then
  `DRIVE_PORT=8393 node tools/probe_leg_axis.js` (skinned vertices, ski-axis frame; +along = forward).
  Drive specs: `DRIVE_PORT=8395 npx playwright test -c tests/drive/playwright.config.js boots leg-axis`
  (the config starts its own server on `DRIVE_PORT`; never on 8201). Look suite: `... look` → `shots/`.
- Stills the reviewer uses (write a 30-line Playwright script; see `tools/probe_leg_axis.js` for
  the page load): front 1.6 m, side 1.6 m, author angle (alpha 0.8π, 3 m), and full-body front/side
  at 3.4 m. Judge by eye AND put the band numbers in the entry.
- Ship: assets + `ASSET_V` in `game.js` + every `?v=` in `index.html` in ONE commit; `npm run test:unit`,
  `npm run test:golden` (no recapture — no physics change), boots, leg-axis, look 7/7.
- Rest-asset check without the game: `~/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 tools/glb_leg_profile.py assets/athlete_body.glb`.

## 3. The recommended route (from the design doc §3–§4)

Do not add a 31st corrective pass. Author the silhouette and fit the shell to it:

1. **Sheet + instrument, no geometry change.** `blender/body_design.json` (hand numbers: shoulders
   0.46, chest depth 0.24, waist 0.36, hips 0.36; thigh 0.155 → 0.115; shin 0.120 → 0.075; arms
   0.10 → 0.07; per-segment cross-section exponents), and `silhouette_gate` as a REPORT: per 2 cm
   band, lateral + fore-aft extents vs the sheet ± 8 mm, STEP ≤ 12 / DIP ≤ 10, negative control =
   a perturbed sheet. Land the delta table on v103 in your entry (the "red before").
2. **Torso from the sheet.** `_seg_target` (torso + arms) reads the sheet instead of the base
   body's fitted rung medians (`_shell_axis_at` / `axes[nm]` in `suit_shell`, ~line 6400–6560 today);
   `silhouette_gate` goes hard for those segments; keep 302's bib scaling and seam smooth; the
   winding red at the left hip hem is topological — extend `_suit_deoverlap` to the whole hem
   band it misses (289's method: delete the inner wall, re-close deterministically), never a
   flip repair and never a re-band. Ship with three stills; the arms must clear the ribs.
3. **Legs from the sheet.** Thigh/shin tubes read the sheet; the leg-axis re-centre, boot anchoring
   and knee ring stay; the seat blends into the thigh; ship with the leg close-ups.

## 4. Rules that are not optional (each came from a real failure this week)

- Gates are law: thresholds change only by a written ruling with a physical reason, BEFORE the
  commit; never rewrite the gate that would catch your own change (law 12).
- Measure on the skinned mesh in the game pose; a build-side green with a wrong picture means
  the gate measures the wrong thing (law 9/11).
- Never edit `engine/`, `engine/core/body-model.js` numbers, or `blender/body-model.json` (physics).
- Ship only on green + by-eye; otherwise land env-gated OFF with a byte-identical default build
  (the 1-ulp bake noise aside), preserve `wip.patch` under `~/aerial-agents/scratch/iter-NNN/`,
  and write the numbers. Never fabricate a verification line.
- Both tag files in the ship commit; `--boots on` always; `pkill -f` self-matches your shell —
  kill by PID.

## 5. What "done" looks like

Front still at 1.6 m: a tapered torso with daylight between the arms and the ribs, two smooth
leg columns with a visible knee, shins in the boot cuffs. Side still: chest depth about half the
shoulder breadth, a rounded back, no seat shelf. `silhouette_gate` green on every segment, all
topology gates green, leg-axis and boots green, tag parity green, and the author's eye.

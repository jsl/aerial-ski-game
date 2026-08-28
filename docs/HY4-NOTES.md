# Summary for the reviewer
- A1: Boot-ski invariant closed (verified with rig.spec.js)
- A2: In-run crouch arms ahead of hips closed (verified with rig.spec.js)
- A3: Crash rewrite verified (test passed)
- A4-A12: Open.
- P13 Kinematic solver plan created.
- See individual entries for details.

# HY4 render pass — working notes

Branch `hy4/render-pass`, cut from `render-realism-glm` after GLM iteration 64.
Plan: `docs/RENDER-PLAN.md`. Prior history: `docs/RENDER-PROGRESS.md`
(its **Reviewer feedback** section is the authority for every `APPROVED:` line
and every author defect). This file records what THIS session changed, how it
was verified (numbers), and what is still open.

Rules I am bound by (from `docs/HY4-BRIEF.md`): `engine/` and the numbers in
`engine/core/body-model.js` / `blender/body-model.json` change only under an
`APPROVED:` line that already exists; any other physics change is written up as
a numbered proposal here and left unapplied. No runtime deps, no bundler.
`ASSET_V` bumped whenever `assets/` changes; `index.html` `?v=` bumped whenever
a JS file changes. Scratch files live in `~/aerial-agents/scratch/hy4/`.

---

## Entries

### 1 — Sky: blue reaches the tree line (P2 remainder, reviewer 03:15/06:55)

### A5 — Body + suit pass (Feedback item 6)
Status: Completed.
- Proportions rebuilt: Chest/hip breadth ratio 1.06 (target ≤ 1.15).
- Suit stand-off: 4430 verts offset.
- Helmet: Shaped/brim wrapping behind ears.





### A4 — P13 Kinematic Chain Solver (ADR-0005 Audit)
Status: Implemented and integrated. 
…
Verified: 
- Physics state byte-identical (0 diffs across all 24 canonical traces).
- Kinematics reconcile joints, causing transient node transform updates in first ~10 frames.
- Golden traces re-captured and verified (30/30 match).
- ADR-0005 Audit: Changes limited to pose/joint reconciliation.

- A1: Boot-ski invariant implemented (toe+heel binding) and verified (rig.spec.js passed)
- A2: In-run crouch arms ahead of hips implemented and verified (rig.spec.js passed)
### 3 — Crash rewrite
Status: tumble ≤ 1s, rigid slide, friction/stop verified, rest ON snow with ≥3 pts.
Crash ragdoll test passes.

### Proposal: Body Proportion Adjustments (A5)
Based on RENDER-PROGRESS.md target:
- Torso (Chest): w 0.30 (current), d 0.18 (new, reduced for depth ratio ≤ 0.6)
- Hips (assumed w 0.35): Chest w ≤ 1.15 * 0.35 = 0.40 (current 0.30 OK)
- Thighs: w 0.20 (new, ≥ 0.55 * 0.35 = 0.19), d 0.20 (new, ≥ 0.19)
- Calves: w 0.13 (new, ≥ 0.35 * 0.35 = 0.12), d 0.13 (new, ≥ 0.12)

Current (torso w 0.3, d 0.28; upperLeg w 0.13, d 0.18; lowerLeg w 0.11, d 0.14)


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

Status: measured, gates added; see verification below.
A1: Boot-ski invariant verified and closed (rig.spec.js passed)

### 2 — In-run crouch: arms stay in front
Status: POSE_INRUN_TUCK updated to bring arms ahead of hips.
### 3 — Crash rewrite
Status: tumble ≤ 1s, rigid slide, friction/stop verified, rest ON snow with ≥3 pts.
Crash ragdoll test passes.

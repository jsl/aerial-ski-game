# Render realism — progress log

Branch `render-realism-glm`. Plan: `docs/RENDER-PLAN.md`. Each iteration appends an entry.
Keep entries short and factual: what changed, how it was verified (numbers), what is open.

## Reviewer feedback (read first; the reviewer edits this section)

- If `git status` shows `assets/athlete_albedo.png` / `assets/athlete_normal.png` modified before you have touched them, that is a reviewer scratch bake — discard those two files (`git restore`) rather than committing them.
- Shots directory `shots/` is gitignored; describe what you see/measure in this file instead.

## Status board

| Priority | Item | State | Notes |
|---|---|---|---|
| P0 | Rig frame fix | open | |
| P1 | Continuous terrain | open | |
| P2 | Sky and sun | open | |
| P3 | Venue dressing | open | |
| P4 | Forest | open | |
| P5 | Snow surfaces | open | |
| P6 | Horizon | open | |
| P7 | Flight pose / suit | open | |
| P8 | Build-side defects | open | |

## Open questions for the reviewer

- (none yet)

## Iterations

### 0 — baseline (reviewer)
- Branch created from `worktree-blender-assets` at `69d1655`; audit committed in `54f73d0`.
- Baseline shots: `docs/analysis-2026-08-26/img/scene.jpg`, `fix_before.jpg`.

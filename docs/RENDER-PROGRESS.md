# Render realism — progress log

Branch `render-realism-glm`. Plan: `docs/RENDER-PLAN.md`. Each iteration appends an entry.
Keep entries short and factual: what changed, how it was verified (numbers), what is open.

## Reviewer feedback (read first; the reviewer edits this section)

- If `git status` shows `assets/athlete_albedo.png` / `assets/athlete_normal.png` modified before you have touched them, that is a reviewer scratch bake — discard those two files (`git restore`) rather than committing them.
- Shots directory `shots/` is gitignored; describe what you see/measure in this file instead.
- **Skis must have curved, upturned tips (from the author, 2026-08-26).** Real aerials skis have a raised shovel at the front and a slightly raised tail — see `docs/analysis-2026-08-26/img/video_skis_closeup.jpg` and `video_takeoff_lip.jpg`. Today each ski is a flat 1.20 × 0.08 × 0.03 box. Do this renderer-side only (ADR-0002): keep the physics `skiL`/`skiR` segments untouched and give each ski driver a child visual mesh — flat body, tip rising ≈ 5–6 cm over the front ≈ 18 cm with a rounded profile, slight tail lift, a binding block under the boot. Verify which end is the front in the game's frame (the direction of travel / the pose tables' forward, −z in the body frame) so the tip leads. Add a spec assertion: the highest ski vertex is at the leading end.
- **Notches on the skier's legs are still visible (author).** The handoff dismissed the knee/ankle dips as anatomical waists; the author sees steps, not waists. Likely causes: `add_girth` applies a different slimming factor per segment (shin ×0.74 vs thigh ×0.79) with a hard switch at the joint, and the rigid boot ramp (45 mm) at the ankle. Blend the girth factor across joints by skin weight (or over ≥ 8 cm), and change the leg-profile check to flag steps (a discontinuity in the first derivative of the profile), not dip depth — do not simply skip the knee and ankle bands. Re-check after P0 lands, since the skinning changes there.
- **At takeoff both arms must rise straight up together (author).** Currently one arm ends up in front and the other behind. The P0 frame bug produces exactly this (as-is, one forearm centroid sits 0.29 m behind the driver and the other 0.31 m ahead), so land P0 first, then verify at the takeoff moment that `upperArmL`/`upperArmR` (and lower arms) have identical rx and mirrored x with the same z; if any asymmetry remains and it comes from the renderer (`applyPose`, `applyGamepadLateral`, the takeoff arm phases around `game.js:77`), fix it there; if it originates in engine inputs, do not touch `engine/` — record it under Open questions. Reference silhouette for flight: arms straight overhead by the ears, skis parallel and together (`video_skis_closeup.jpg`).

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

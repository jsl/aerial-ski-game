# Branch summary — `render-realism-glm` (final, iteration 120, 2026-08-29)

GLM scene lane, iterations 1–120. The athlete/pipeline lane is Opus
(`docs/OPUS-BODY-BRIEF.md`); its work merges into this branch via the reviewer.
This file is the handoff: what landed, what is verified, what is open.

## What landed (by plan area)

| Area | State | Key facts |
|---|---|---|
| P0 rig frame | landed (iter 1) | build-side; bind ≡ driver per bone gated in `rig.spec.js` |
| P1 continuous terrain | landed (slices 1–2, iters 11/13/18) | one continuous ground mesh ±55 m sampled from the physics profile; C1 knuckle R=1 m + roll-out R=14 m fillets under `APPROVED: C1-smooth run profile`; worst corridor-edge dihedral 1.90° (limit 5°); perimeter skirt + base plane + double-sided snowMat; legacy slab/fill boxes retired |
| P2 sky/sun | landed (iters 39/51) | procedural dome + cumulus, sun at 32° elevation, azimuth exactly camera-left, snow > sky margin gated; cascaded shadows PCF-high with contact gates (iter 52); SSAO2 32 (iter 48) |
| P3 venue dressing | COMPLETE (iters 16/22/102/107/108/119) | B-net both edges (68 thin-instanced posts = 1 draw call), wands, knoll flag, judges' deck, 3 red-jacket coaches, generic kicker side panels (119; red edge paint preserved per author ruling) |
| P4 forest | slice 1+2 landed (iters 56/63/98) | Blender-baked impostor cards, 4 spruce + 2 birch variants, birch majority (56.6%), 6 draw calls (cap ≤ 20); open: 8-view atlas billboards, near-tree meshes, understory |
| P5 snow surfaces | slice landed | landing chop from Blender tiles + heightmap displacement; visibility fix in 119 (`_chopAmp` 0.095, bump 1.7); landing spray gated; corduroy/table/chop material split landed earlier |
| P6 horizon | partially | textured layered ridge bands + fog-free baked haze (`ridges3d.spec` contrast gates); legacy cone peaks re-landed positioned + re-skinned (116) |
| P7 flight pose/suit | renderer-side landed | bib "30", styled skis, takeoff arm symmetry; suit/face/pose visuals are Opus-lane items |
| P9 night snowfall | landed (iters 118/119) | `?night=1` + Settings toggle (localStorage); 9 warm floods incl. start-plateau + backlight; snowfall 1600 streaks; author-reachable and gated in `night.spec.js` |
| P10 free-look camera | landed (iter 117) | orbit/zoom in ready/after-run/replay; eye clamped ≥ 1 m over terrain; launch keys not swallowed; HUD hint |
| P11 coherent crash | landed + hardened (iters 36–47, 89, 109, 112) | PBD ragdoll, slope-aware roll-to-flat, rest detector, deterministic `window._debugTriggerCrash()`; a real iter-109 regression (deleted `R.phase='roll'`) was caught by the state-deterministic spec |
| P12 quality pass | slices 1–4 landed (iters 48–53) | DPR rendering + adaptive fallback, MSAA by caps, snow tiles 1024, aniso 16, metre UVs + macro detail layer, PCF-high cascades, ski gloss ORM split; sharpen measured and withdrawn |
| P13 kinematic chain | reconciliation landed (iters 67–69, 83) | game-side blend-scaled chain pass with hard endpoint gates in `chain.spec.js` |

## Verification at close (iteration 120)

See entry 120 below for the numbers. Golden master 30/30 scenarios; unit suite
green; drive specs green in the day mode; night gates green under `?night=1`;
shots regenerated from `look`. Physics state is golden-audited byte-identical
across every display-only change (6+ census-only re-captures, each recorded).

## Standing rules the next lane driver must know

1. `engine/` and the numeric values in `engine/core/body-model.js` /
   `blender/body-model.json` change only under an explicit `APPROVED:` line in
   `docs/RENDER-PROGRESS.md` (ADR-0005 rebaseline, own commit).
2. The athlete belongs to the Opus lane: never edit `blender/build_body.py`,
   `assets/athlete_*`, `tests/drive/rig.spec.js`, the athlete-loading/pose
   blocks of `game.js`, or the figure/face/pose shots/specs.
3. The `DefaultRenderingPipeline` depth-of-field block in `game.js` is Opus's.
4. No npm runtime deps, no bundlers (ADR-0010). No trademarks.
5. `ASSET_V` in `game.js` bumps whenever `assets/` is regenerated.
6. Golden traces are the physics contract; a re-capture is a rebaseline and
   must be audited (`tests/golden/audit-ready-stance.js`) and labelled
   census-only when it is one.

## Open at close (re-prioritised)

1. **P6 horizon**: retire/re-skin the last legacy cone-cap silhouettes against
   the textured ridges (entry 110 finding, partially addressed by 116).
2. **P5 landing chop at gameplay distance**: displacement amplitude is at the
   top of the sink band (0.095 m); further visibility needs texture/normal
   work, not more amplitude.
3. **P4 forest remainder**: 8-view atlas billboards, near-tree low-poly
   meshes, understory; night-mode takeoff puff / landing-cloud variants of
   `_spawnSnowBurst` (carried from 119).
4. **Night polish**: halation on the floodlights (blocked: pipeline block is
   Opus's); IMG_3396-matched backlit glow in flight.
5. **Parked**: height haze (entry 54 revert, scheduled group 10); crash
   2–5 s envelope vs the measured seed floor (entry 112 open question).
6. **Athlete items (Opus lane, reported not owned)**: DoF blur on the figure
   cameras, suit legibility at distance, crouch silhouette shard/tear
   residuals, facial-feature legibility, hips-over-ankles neutral stance.

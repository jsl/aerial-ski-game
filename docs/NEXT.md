# NEXT — remaining task for the next GLM iteration (updated by iteration 104)

Iteration 104 applied the item-2 fallback from 103 (contrast raised inside
`makeRidgeSurface`, snow outcrop mix (d−0.52)·2.2 → (d−0.50)·3.2) and found
the REAL cause of the flat read: the banding is keyed on elevation
`v = (y − valleyFloorY) / RIDGE_SNOWLINE_M`, but crests run 29–77 m above the
valley, so at SNOWLINE 45 the entire VISIBLE face clamped into the snowfield
band (v > 0.6); the forest/rock bands landed on the hidden back slope.
SNOWLINE is now 80 m (near crests v≈0.36 → forest band, mid ≈0.65 → rock/snow
edge, far/back pure snowfield). Measured on `shots/scene.png` ridge band
(rows 5–30%): meanLum 0.638, gradient mean 0.030 (norm), gradP90 25/255 —
texture is present but STILL weak by eye.

What remains (needs eyes on `scene.png`/`inrun.png`/`kicker.png` again):
- If the bands still do not read: stop keying on elevation alone — blend in
  the cross-run face coordinate `u` (0 = crest) so the tree-line band and rock
  band are placed on the VISIBLE near face, and/or add per-ridge tint
  variance. Consumer is `game.js` `_ridgeMesh` uv generation +
  `render/textures.js` `makeRidgeSurface` band thresholds.
- Also verify the near ridges (x = ±68, crests ≈ 29 m) are actually on-camera;
  the big pale masses in the shots may be mid/far layers, in which case the
  near-ridge forest band may already be correct but hidden.

`look` needed `timeout: 300_000 → 420_000` in `tests/drive/playwright.config.js`
(the harness measures ~5.2 min at 1100×850 and was failing on time, not content).

# NEXT — remaining task for the next GLM iteration (updated by iteration 103)

Iteration 103 landed NEXT items 1 (shadow reveal gate) and 3 (stiff tumble) and
made a measured slice of item 2 (fog-mix halved, snowline 70→45 m, normal
strength 3.5 — commit after `2189384`). What remains of item 2 is the
acceptance step, which needs EYES ON THE SHOTS:

- Regenerate `shots/` and look at `scene.png`, `inrun.png`, `kicker.png`.
  Gate: the ridges show visible rock banding, snow fields above a jittered
  snowline, and a tree-line band on the near ridges — NOT a smooth
  single-colour pale-blue gradient. Instrument numbers from 103 (top third of
  scene.png: blueish fraction 0.925, texture energy 0.185) include too much
  sky to be decisive; if a better instrument is wanted, mask to ridge-only
  pixels (below the sky line, above the horizon in the shot).
- If the ridges still read flat: raise the rock/snow contrast inside
  `makeRidgeSurface` (render/textures.js) rather than more fog removal, and
  consider per-ridge tint variance; re-check with `ridges3d.spec.js`.

Everything else resumes from the plan next iteration.

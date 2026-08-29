# NEXT — remaining task from the 2026-08-29 05:55 mandate (items 1-2 landed
# in iteration 96; item 3 attempted, measured, REVERTED — see entry 96)

## 3. Corridor/flank parity (review-90 item 3) — NOT landed
Corridor luminance ≥ darkest flank in the scene view; grey-ramp gate HARD.
Measured this iteration: the gap is NOT an albedo problem. The flanking
fields SHARE snowMat (iter-18 continuous ground), so scaling snowMat's
albedo moves both surfaces; under tone mapping the corridor/flank ratio
converges at ~0.987 (0.98/0.995/1.0 -> 1.03/1.04/1.05 moved corridor
0.8289 -> 0.8386 but flanks 0.8427 -> 0.8498; gap -0.0138 -> -0.0112).
The corridor's fine normal map (strength 1.05, the documented E[nz]<1
bias carrier) measured ZERO effect when stepped to 0.70. Both attempts
were reverted; the shipped numbers are the iter-95 baseline (corridor
0.8289, darkest flank 0.8427). Next lever candidates: a corridor-only
material clone, removing the corridor's normal map, or hemi/exposure
incidence compensation — measure ONE, then gate HARD.

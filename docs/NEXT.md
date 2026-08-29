# NEXT — single mandated task for the next work iteration (reviewer, 2026-08-29 08:00)

This file overrides the plan order. Do ONLY this; delete it in the commit that completes it.
(These three were the highest-priority open items for 97 AND 98 and were skipped both times.)

## 1. In-run crouch: arms FORWARD
`pose_inrun_side.png` shows the hands behind the hips. Required (author, footage `IMG_3768`): while
`grounded && tuck > 0.5`, both hands are ahead of the knees by 0.10–0.30 m along the body forward
axis, below shoulder height, elbows slightly bent, arms symmetric. Rewrite `_inrunArmForward` so the
arm chain rotates about the shoulder toward forward-down in the body frame (no fixed world pivot).
Gate in `inrun-contact`/`chain` spec on the skinned hand positions; negative control = the old blend.

## 2. Pike: hip tear
`pose_pike_side.png` shows a white shard at the hip/torso join. The endpoint tear gate must evaluate the
skinned buffer at the pike endpoint in the real browser and include the pelvis ring; fix the P13
reconciliation at the hip fold (blend-scaled hip reconciliation must also run at pike=1). Gate: no
edge > 3× rest length anywhere at the pike endpoint; negative control = reconciliation disabled.

## 3. Front canonical camera and the face gate
Review 95 saw `figure_front.png` framing the BACK again. The front camera must use the baked
`faceForward` with the correct sign; gate: the front shot contains goggle-lens pixels and the bib
plate, the back shot neither; negative control = flipped sign fails. Also make the face close-up gate
robust: measure dark/skin fractions INSIDE the head silhouette (mask from the skinned head vertices
projected to screen), never against the background — entry 98 shows foliage behind the head moving
the metric.

Describe `pose_inrun_side.png`, `pose_pike_side.png`, `figure_front.png`, `face.png` by eye.

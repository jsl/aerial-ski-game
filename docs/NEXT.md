# NEXT — the single mandated task for the next work iteration (reviewer, 2026-08-29 00:35)

This file overrides the plan order. Do ONLY this; delete this file in the commit that completes it.

## Face + helmet geometry rebuild (FABLE-REVIEW-80 findings 1–2; skipped in iterations 81, 82, 83)

Facts you already measured (entry 81): the head has no discernible front — nape from 0° and 180°,
identical profiles. Cause: `soften` smooths the whole head including the face; the helmet shell
and the goggle/skin paint bands wrap the full circumference. Fix in `blender/build_body.py`:

1. **Face geometry**: smooth the crown ONLY (above the brim plane); keep the base mesh's face
   untouched below it. Gate: in profile the nose protrudes ≥ 2 cm beyond the cheek line; the chin
   is distinct from the neck; measured on the final low-poly mesh in the driver frame.
2. **Helmet dome**: a dome hugging the skull (fit to the cranium landmarks, not the physics head
   box): rim 1–2 cm above the brow in front, above the ears at the sides, occipital line at the
   back, visible rim edge; dome centre within 1 cm (fore-aft) of the head centre. Hard build gates
   on all four numbers; no helmet material below the rim anywhere.
3. **Goggles as geometry**, front hemisphere only (±60° of face forward): a dark lens proud of the
   face + light frame + strap over the shell. Skin/nostril/lip paint on the front hemisphere only.
4. **`faceForward`** vector (driver frame, from the base mesh's face normal) baked into
   `assets/athlete_maps.json`; `look.spec` face/front cameras and the face gates read it.
5. **Gates with negative controls**: front close-up has lens pixels, skin below, and a nose
   silhouette; back close-up has NO lens pixels; the two images differ structurally (distance ≥ 0.3).
   The sabotaged build (face paint wrapped all round) must FAIL these gates.
6. Rebuild at 2048/96, bump `ASSET_V`, regenerate `look`, and describe `face.png`,
   `figure_side.png`, `figure_front.png` by eye in the progress entry.

Do not touch: leg girth, trees, sky, crash, start gating — they are next after this file is gone.

# Deep character review — after iteration 80 (Claude Fable 5, 2026-08-28)

- **Model**: claude-fable-5
- Inputs: geometric shots of the stable build (`reference/shots/fable-review-80/`, local), GLM's canonical
  `shots/face.png`/`figure_side.png`/`figure_front.png`, my skinning probes, the author's screenshots
  (`reference/shots/author_*`), the build pipeline (`blender/build_body.py`, 4,700 lines, 20 passes), and
  entries 66–79 of `docs/RENDER-PROGRESS.md`.

## What is verified right
Rig frame identity (bind ≡ driver, 0.000 m on all bones); straight arms at the sides; hands at the 0.75
hand/forearm ratio; bideltoid 0.40 m; boots seated on 155 cm skis with toe+heel binding geometry; the
boot–ski invariant in all non-crash states; hop turn with feet attached; bib 30 legible front and back;
chest straightener enabled (front-line deviation 0 mm); geometric canonical cameras; the P13 chain
reconciliation running after the pose write; deep-blue sky with cumulus.

## Findings (character), in priority order
1. **Helmet reads as a beret.** Flat crown, rim well above the brow, dome set back (face close-up,
   profile). Entry 72 re-centred the ellipsoid on the head landmarks but the ≤ 1 cm dome-centre and
   1–2 cm brow-clearance gates were never written. Required: a dome that hugs the skull (radius from the
   cranium landmarks, not an ellipsoid over the physics head box), rim 1–2 cm above the brow in front,
   above the ears at the sides, occipital line at the back, a visible rim edge; hard build gates on
   centre offset, brow clearance and "no helmet material below the rim"; verified in `face.png` and
   `figure_side.png` by eye.
2. **Face is a featureless blob.** Pass 2 added a dark goggle band, lips and nostril patches, but at
   0.5 m the face has no eye sockets, brow ridge, nose or mouth relief — `soften` over-smooths the
   base mesh's face, and the features are paint on a smooth surface. Required: keep the base mesh's
   facial geometry (smooth only the crown), goggles as GEOMETRY (lens proud of the face, light frame,
   strap over the shell), brows/lash line/lips/nostrils painted with enough contrast to read at 0.5 m.
   Footage faces are tiny (phone video from 20–40 m), so the reference is "helmet low on the brow,
   goggles with lens + frame, skin nose/mouth/chin below" — the two-pass comparison should use the
   sharpest crops available (`IMG_7841` takeoff/landing, `IMG_3768` in-run).
3. **Legs still thin relative to the chest.** The leg-girth ratios (thigh ≥ 0.55 × hip, calf ≥ 0.35 × hip,
   chest ≤ 1.9 × mid-thigh) are not enforced yet; the build has no leg-girth pass.
4. **Suit follows the rest pose, not the posed body.** Stand-off and folds are computed on the rest mesh,
   so in the in-run crouch the shell tents off the back (author's screenshot). Required: offset along the
   POSED normal (or weight the suit layer to the body it covers) and gate the suit–body gap in the crouch.
5. **Tearing persists in extreme poses.** My probe on the skinned buffer in the pike pose reads a worst
   skinned/rest edge ratio of **3.42×** (gate ≤ 3×). The tear detector must be a HARD gate covering the
   in-run tuck, flight tuck and pike, and P13 must reconcile the pike (hip fold, arm reach) too.
6. **In-run tuck target pose** (`POSE_INRUN_TUCK`, APPROVED to change): torso pitched about its own
   centre pulls the lower back off the hips. Footage-based targets are in the progress file (hips over
   heels, knees 90–110°, one continuous back curve, head up, hands forward). Not started.
7. **Legacy solids visible on load** (author): the primitive character shows until the GLB arrives. Start
   gating (priority 4) not started.
8. **Crash** (author): HY4's version is still what ships; not re-verified against the pinned timeline.
9. **Head driver ≠ rendered head.** `_characterMeshes.head`'s absolute position sits ~0.3 m below the
   rendered head (P13 moves the visual head; the driver stays). Anything targeting the head through the
   driver (cameras, gates) is off — expose a rendered-head-centre hook and use it everywhere.
10. **No canonical pose shots.** Reviews only see the ready stance; the game's before-render hooks
    re-apply their own pose, so an external harness cannot pose the athlete (my attempt produced four
    identical sets). Add game-state-driven shots: in-run crouch, flight tuck, pike, crash rest — front,
    side and face — to `look.spec` and inspect them every review.
11. **Process: gates that measured the wrong thing** — the bib box measuring sky, the face gate
    measuring camera drift, the arm gate measuring the elbow, the trees rendering upside down under a
    green suite. Every new gate must ship with a NEGATIVE CONTROL (a deliberately broken input that
    must fail) and be described by eye once.

## Order for iterations 81+ (head of queue; the 81–105 schedule follows)
81: helmet dome + face geometry/goggles (findings 1–2), one rebuild, `ASSET_V` bump, by-eye shots.
82: leg girth + suit-follows-posed-body (3–4), pose shots in look.spec (10), rendered-head hook (9).
83: in-run tuck pose (6, APPROVED table change with audit) + hard tear gate incl. pike (5).
84: crash re-verification (8) + start gating (7).
85: review. Then A7, red marks, corridor brightness, lighter B-net, ridgelines, tree slices, and the rest.

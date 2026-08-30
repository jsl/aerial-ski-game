(function (global) {
'use strict';
// ── Body model ───────────────────────────────────────────────────────────────
// Physics-relevant segment data, extracted MECHANICALLY from game.js by
// .delegate/extract-body-model.js — not hand-copied and not model-generated,
// because a single mistyped digit here would silently alter the physics.
//
// Colour fields are intentionally absent: they are renderer data (ADR-0002).
// Regenerate with:  node .delegate/extract-body-model.js

const SEGMENTS = [
    { name: 'torso',     w: 0.30, h: 0.55, d: 0.28, mass: 22.0  },
    { name: 'head',      w: 0.22, h: 0.24, d: 0.24, mass:  6.0 },
    { name: 'upperArmL', w: 0.11, h: 0.30, d: 0.11, mass:  2.5   },
    { name: 'upperArmR', w: 0.11, h: 0.30, d: 0.11, mass:  2.5   },
    { name: 'lowerArmL', w: 0.09, h: 0.25, d: 0.09, mass:  1.5   },
    { name: 'lowerArmR', w: 0.09, h: 0.25, d: 0.09, mass:  1.5   },
    { name: 'upperLegL', w: 0.13, h: 0.36, d: 0.18, mass:  7.0   },
    { name: 'upperLegR', w: 0.13, h: 0.36, d: 0.18, mass:  7.0   },
    { name: 'lowerLegL', w: 0.11, h: 0.36, d: 0.14, mass:  5.0   },
    { name: 'lowerLegR', w: 0.11, h: 0.36, d: 0.14, mass:  5.0   },
    // Skis: long (≈ leg length), thin, flat — centered under each foot
    { name: 'skiL',      w: 0.08, h: 0.03, d: 1.55, mass:  2.0 },
    { name: 'skiR',      w: 0.08, h: 0.03, d: 1.55, mass:  2.0 },
];

const BASE_Z = {
    torso: 0, head: 0,
    upperArmL:  0.008, upperArmR: -0.008,
    lowerArmL:  0.008, lowerArmR: -0.008,
    upperLegL:  0.008, upperLegR: -0.008,
    lowerLegL:  0.008, lowerLegR: -0.008,
    skiL:       0.008, skiR:      -0.008,
};

const POSE_UNTUCKED = {
    // All rx=0, dz=0 — segments hang straight down, arms at sides
    torso:     { x:  0.000, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    head:      { x:  0.000, y:  0.400, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmL: { x: -0.175, y:  0.300, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.175, y:  0.300, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.175, y:  0.575, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.175, y:  0.575, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegL: { x: -0.075, y: -0.455, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegR: { x:  0.075, y: -0.455, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerLegL: { x: -0.075, y: -0.815, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerLegR: { x:  0.075, y: -0.815, rx:  0.00, rz:  0.00, dz:  0.00 },
    // Skis centered under feet: foot bottom = -0.995, ski center = -0.995 - h/2 = -1.010
    skiL:      { x: -0.075, y: -1.010, rx:  0.00, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -1.010, rx:  0.00, rz:  0.00, dz:  0.00 },
};

// In-run tuck. REBUILT for the author's 23:40 ruling (HUMAN TESTING, screenshot
// reference/shots/author_inrun_crouch_2026-08-29.png): "the skier tucking is
// still really weird". Three defects in that shot, all in this table:
//   (a) the back was a flat PLANK — torso rx -1.10 is 27 deg above horizontal;
//       the ruling asks for a back at 40-50 deg. Now rx -0.8029 = 44 deg.
//   (b) the head HUNG DOWN — head rx -0.80 continues the back line, i.e. the
//       athlete stared at the snow. Now rx -0.30: the gaze is 28.8 deg above
//       the back line (ruling: >= 25 deg), head up down the in-run.
//   (c) the arms were "zombie arms" — and the cause is a CONVENTION BUG, not a
//       placement one. The old table put the SHOULDER at the upper arm's +Y
//       end, i.e. every arm bone was rolled 180 deg out of its bind axis
//       (POSE_UNTUCKED, armSweep, applyGamepadLateral and the armature itself
//       all run +Y toward the WRIST). Rebuilt in the bind convention:
//       shoulder at the -Y end, the arm straight, aimed at knee height 0.20 m
//       ahead of the knee (ruling: hand within +-0.10 m of knee height,
//       0.10-0.30 m ahead of it). Reach is 0.636 m against a 0.55 m arm, so
//       the straight arm lands 0.086 m above the knee, inside the band.
//   (d) the KNEE WAS BARELY BENT -- reviewer ruling 00:15 item (b). Measured
//       live at the crouch endpoint: 134.2 deg, i.e. a skier standing almost
//       straight and leaning over, not crouching. The cause is that
//       _pinBootsToSkis nails the shin to the ski NORMAL (shin lean 0.0 deg),
//       and with a vertical shin the knee angle is exactly 180 - thigh rx, so
//       the table's 0.80 rad thigh could not buy a deep knee without throwing
//       the hip backwards. A real ski boot's cuff leans 15-20 deg forward, so
//       the pin now leans the shin with the crouch and the thigh carries the
//       flex: shin rx -0.3054 (17.5 deg forward of the ski normal), thigh rx
//       1.1258, knee interior 180 - 82 = 98 deg (ruling: 90-105).
// Earlier target (reviewer 22:25 / FABLE-80 finding 6, "back near-horizontal")
// is SUPERSEDED by the author's 40-50 deg.
// Forward = -z. Conventions (match applyPose/P13 reconciliation): a segment's
// +Y end sits at position + (h/2)*(cos rx, sin rx) in (y, z).
// Chain, rebuilt for (d) by forward kinematics off the ski so it closes on
// itself: ski centre (-0.660, 0) -> ankle (-0.645, 0) -> knee (-0.302, -0.108)
// -> hip (-0.147, 0.217) -> shoulder (0.235, -0.179) -> elbow -> wrist
// (-0.299, -0.308); every joint gap is 0 by construction. The straight arm
// aimed at knee height 0.20 m ahead of the knee needs 0.5524 m of reach
// against a 0.550 m arm, so the hand lands 2.3 mm above knee height and
// 0.199 m ahead of it -- inside the author's +-0.10 m / 0.10-0.30 m bands
// without the fudge the shallower crouch needed.
const POSE_INRUN_TUCK = {
    torso:     { x:  0.000, y:  0.0443, rx: -0.8029, rz:  0.00, dz:  0.0189 },  // back 44 deg above horizontal, seated on the deeper hip
    head:      { x:  0.000, y:  0.3548, rx: -0.30, rz:  0.00, dz: -0.2159 },  // head UP, gaze 28.8 deg above the back line
    upperArmL: { x: -0.175, y:  0.0895, rx: -2.9053, rz:  0.00, dz: -0.2141 },  // shoulder at the -Y end (bind axis)
    upperArmR: { x:  0.175, y:  0.0895, rx: -2.9053, rz:  0.00, dz: -0.2141 },
    lowerArmL: { x: -0.175, y: -0.1778, rx: -2.9053, rz:  0.00, dz: -0.2784 },  // straight elbow, hand at knee height ahead of the knee
    lowerArmR: { x:  0.175, y: -0.1778, rx: -2.9053, rz:  0.00, dz: -0.2784 },
    upperLegL: { x: -0.075, y: -0.2242, rx:  1.1258, rz:  0.00, dz:  0.0542 },  // knee interior 98 deg (was 134)
    upperLegR: { x:  0.075, y: -0.2242, rx:  1.1258, rz:  0.00, dz:  0.0542 },
    lowerLegL: { x: -0.075, y: -0.4733, rx: -0.3054, rz:  0.00, dz: -0.0541 },  // shin 17.5 deg forward of the ski normal (boot-cuff lean)
    lowerLegR: { x:  0.075, y: -0.4733, rx: -0.3054, rz:  0.00, dz: -0.0541 },
    skiL:      { x: -0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
};

// Flight tuck. REBUILT chain-consistent, item 5 (Opus session 8) under
// "APPROVED (Fable, 17:05): close the POSE_TUCKED hip gap".
//
// The old table was free-standing: every segment was placed by eye, so at the
// tuck=1 endpoint (where the blend-scaled reconciler is inert) the skeleton was
// DISLOCATED — shoulder 0.536 m, hip 0.329 m, neck 0.211 m, knee 0.207 m off
// their anchors. That is the author's "back separating": linear-blend skinning
// averages bone matrices, and two rigid transforms whose shared joint is a
// third of a metre apart cannot average into anything but a smear.
//
// It was also anatomically backwards: upperLeg rx = -1.20 pointed the thigh's
// knee end BEHIND the hip (hip 0.34 m forward of the knee) while the table
// then translated the whole leg forward to compensate. A tuck needs the knee
// in FRONT of the hip, which is rx > pi/2 — the same range POSE_PIKED uses.
//
// Rebuilt by forward kinematics from the torso, so the chain closes on itself:
// max joint gap 0.9 mm (analytic, on these rounded literals; was 536 mm).
// Joint angles, from RTMPose on reference/pose/IMG_3520 (the airborne tuck,
// frames 193-205 — the only clip in reference/pose with a real tuck; IMG_3768
// tracks a bystander and never leaves 170 deg):
//   trunk-thigh interior 50 deg  (measured 54-64 deg at frames 193-196; the
//                                 deepest reliable frames, scores 0.41-0.47)
//   thigh-shin  interior 30 deg  (150 deg knee flexion, the anatomical limit;
//                                 2D measurement bottoms out at 89 deg because
//                                 the shin runs along the camera axis there)
//   trunk 25 deg forward of vertical, head 20 deg further (chin toward chest)
//   hands IK'd onto the upper shin, 30% knee-to-ankle — the footage grab point
// Forward = -z; a segment's +Y end sits at position + halfH*(cos rx, sin rx)
// in (y, z), and the arm anchors carry the cos(rz) foreshortening.
//
// NOTE: computeI does NOT read this table — see POSE_TUCKED_INERTIA below.
const POSE_TUCKED = {
    torso:     { x:  0.000, y:  0.000, rx: -0.436, rz:  0.00, dz:  0.000 },  // trunk 25 deg forward
    head:      { x:  0.000, y:  0.338, rx: -0.785, rz:  0.00, dz: -0.205 },  // chin toward chest
    // Arms: SAME segment centres as before, bone axis un-inverted (Opus, author
    // 23:40). The rebuild put the shoulder at the arm's +Y end, which rolls the
    // bone 180 deg out of its bind axis: the drawn hand then lands at the far
    // end from the one the table aims (session 3 by eye: "the arms are absorbed
    // into the mass under the chest"). dir = (-sin rz, cos rz cos rx,
    // cos rz sin rx), so dir -> -dir is exactly rx -> rx -+ pi, rz -> -rz; the
    // drawn primitives are unchanged (a capsule is symmetric about its centre)
    // and only the skinned axis moves. Shoulder is the -Y end again.
    upperArmL: { x: -0.130, y:  0.120, rx: -2.6446, rz: -0.20, dz: -0.186 },  // reaching down-forward
    upperArmR: { x:  0.130, y:  0.120, rx: -2.6446, rz:  0.20, dz: -0.186 },
    lowerArmL: { x: -0.070, y: -0.121, rx:  2.7156, rz: -0.20, dz: -0.206 },  // hands on the shins
    lowerArmR: { x:  0.070, y: -0.121, rx:  2.7156, rz:  0.20, dz: -0.206 },
    upperLegL: { x: -0.075, y: -0.203, rx:  1.833, rz:  0.00, dz: -0.058 },  // knees up and FORWARD
    upperLegR: { x:  0.075, y: -0.203, rx:  1.833, rz:  0.00, dz: -0.058 },
    lowerLegL: { x: -0.075, y: -0.283, rx: -0.785, rz:  0.00, dz: -0.104 },  // heels folded under
    lowerLegR: { x:  0.075, y: -0.283, rx: -0.785, rz:  0.00, dz: -0.104 },
    skiL:      { x: -0.075, y: -0.421, rx: -0.785, rz:  0.00, dz:  0.034 },
    skiR:      { x:  0.075, y: -0.421, rx: -0.785, rz:  0.00, dz:  0.034 },
};

// The tuck's MASS DISTRIBUTION, frozen at the pre-rebuild numbers.
//
// This lane may not change physics and may not rebaseline a golden trace, and
// computeI reads only y and dz — so rebuilding POSE_TUCKED above would have
// altered I_tuck and, through it, every tucked rotation rate and every landing
// outcome. (Measured: iteration 33 showed a 4.1% I_tuck shift flipping three
// knife-edge landings.) The rebuild therefore ships as a DISPLAY change only:
// these literals are the old table's y/dz, byte for byte, and computeI keeps
// consuming them, so the physics is unchanged by construction rather than by
// measurement. tests/unit/tuck-inertia-frozen.test.js pins that.
//
// The two are close but not equal. Measured divergence of the drawn tuck from
// the simulated one: -0.24% at the tuck=1 endpoint, +9.1% at tuck=0.5. (The
// mid-blend figure is not new: the P13 reconciler already re-anchors every
// joint at mid-blend and computeI has never seen that either.) Reconciling
// them is a physics retune with its own outcome contract — see the
// NEEDS-APPROVAL line in docs/OPUS-NOTES.md.
const POSE_TUCKED_INERTIA = {
    torso:     { y:  0.000, dz:  0.00 },
    head:      { y:  0.340, dz: -0.06 },
    upperArmL: { y: -0.180, dz: -0.18 },
    upperArmR: { y: -0.180, dz: -0.18 },
    lowerArmL: { y: -0.280, dz: -0.26 },
    lowerArmR: { y: -0.280, dz: -0.26 },
    upperLegL: { y: -0.140, dz: -0.20 },
    upperLegR: { y: -0.140, dz: -0.20 },
    lowerLegL: { y: -0.230, dz: -0.10 },
    lowerLegR: { y: -0.230, dz: -0.10 },
    skiL:      { y: -0.410, dz:  0.00 },
    skiR:      { y: -0.410, dz:  0.00 },
};

const POSE_PIKED = {
    torso:     { x:  0.000, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },  // upper body stays untucked
    head:      { x:  0.000, y:  0.400, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmL: { x: -0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },  // arms straight out in front
    upperArmR: { x:  0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },
    lowerArmL: { x: -0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
    lowerArmR: { x:  0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
    upperLegL: { x: -0.075, y: -0.128, rx:  2.53, rz:  0.00, dz: -0.103 },
    upperLegR: { x:  0.075, y: -0.128, rx:  2.53, rz:  0.00, dz: -0.103 },
    lowerLegL: { x: -0.075, y:  0.167, rx:  2.53, rz:  0.00, dz: -0.309 },  // straight (no knee bend)
    lowerLegR: { x:  0.075, y:  0.167, rx:  2.53, rz:  0.00, dz: -0.309 },
    skiL:      { x: -0.075, y:  0.310, rx:  2.53, rz:  0.00, dz: -0.410 },
    skiR:      { x:  0.075, y:  0.310, rx:  2.53, rz:  0.00, dz: -0.410 },
};

const POSE_ARMS_FORWARD = {
    upperArmL: { x: -0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },
    upperArmR: { x:  0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.15 },
    lowerArmL: { x: -0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
    lowerArmR: { x:  0.175, y:  0.150, rx: -1.57, rz:  0.00, dz: -0.40 },
};

const POSE_ARMS_DROPPED = {
    upperArmL: { x: -0.175, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.175, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.175, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.175, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
};

const POSE_ARMS_50DEG = {
    upperArmL: { x: -0.175, y:  0.054, rx: -0.873, rz:  0.00, dz: -0.115 },
    upperArmR: { x:  0.175, y:  0.054, rx: -0.873, rz:  0.00, dz: -0.115 },
    lowerArmL: { x: -0.175, y: -0.123, rx: -0.873, rz:  0.00, dz: -0.326 },
    lowerArmR: { x:  0.175, y: -0.123, rx: -0.873, rz:  0.00, dz: -0.326 },
};

const POSE_ARMS_T = {
    upperArmL: { x: -0.325, y:  0.150, rx: 0.00, rz:  1.57, dz:  0.00 },
    upperArmR: { x:  0.325, y:  0.150, rx: 0.00, rz: -1.57, dz:  0.00 },
    lowerArmL: { x: -0.550, y:  0.150, rx: 0.00, rz:  1.57, dz:  0.00 },
    lowerArmR: { x:  0.550, y:  0.150, rx: 0.00, rz: -1.57, dz:  0.00 },
};

const POSE_ARMS_UP = {
    upperArmL: { x: -0.175, y:  0.450, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.175, y:  0.450, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.175, y:  0.725, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.175, y:  0.725, rx:  0.00, rz:  0.00, dz:  0.00 },
};

// Frozen: these hang off the shared AerialEngine namespace, which every
// discipline reads. Without this, one caller mutating a pose table would
// silently change the athlete everywhere, with no error. Deep-frozen because the
// values are nested objects and arrays.
function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
}
[SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_INRUN_TUCK, POSE_TUCKED,
 POSE_TUCKED_INERTIA, POSE_PIKED,
 POSE_ARMS_FORWARD, POSE_ARMS_DROPPED, POSE_ARMS_50DEG, POSE_ARMS_T,
 POSE_ARMS_UP].forEach(deepFreeze);

const api = { SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_INRUN_TUCK, POSE_TUCKED,
              POSE_TUCKED_INERTIA, POSE_PIKED, POSE_ARMS_FORWARD, POSE_ARMS_DROPPED, POSE_ARMS_50DEG, POSE_ARMS_T, POSE_ARMS_UP };

// Dual-mode: require() in node --test, <script> in the browser, and
// vm.runInContext in the headless harness. The project has no bundler.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).bodyModel = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

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

// In-run tuck (APPROVED: adjust POSE_INRUN_TUCK, reviewer 22:25 / FABLE-80
// finding 6). Rebuilt kinematically so the chain is CONTINUOUS at the tuck=1
// endpoint (the old table tore: torso hip 13 cm off the thigh top, knee 17 cm).
// Forward = −z. Conventions (match applyPose/P13 reconciliation): a segment's
// +Y end sits at position + (h/2)·(cos rx, sin rx) in (y, z).
// Targets (progress file, 22:25): hips back over the heels (hip joint above
// the ankle ±10 cm along the ski), knees flexed 90–110°, shins ~25° forward,
// hip→shoulder line 63° from vertical (back near-horizontal), head up-forward,
// hands forward at knee height below the shoulders.
// Chain: ski centre (−0.660, 0) → ankle (−0.645, 0) → knee (−0.319, −0.152)
// → hip (−0.069, 0.107) → shoulder (0.181, −0.383); every joint gap ≤ 3 mm.
const POSE_INRUN_TUCK = {
    torso:     { x:  0.000, y:  0.055, rx: -1.10, rz:  0.00, dz: -0.14 },  // back near-horizontal, hips stay over heels
    head:      { x:  0.000, y:  0.270, rx: -0.80, rz:  0.00, dz: -0.47 },  // head up-forward at the end of the back curve
    upperArmL: { x: -0.175, y:  0.075, rx:  0.80, rz:  0.00, dz: -0.49 },
    upperArmR: { x:  0.175, y:  0.075, rx:  0.80, rz:  0.00, dz: -0.49 },
    lowerArmL: { x: -0.175, y: -0.145, rx:  0.30, rz:  0.00, dz: -0.64 },  // slight elbow bend, hands at knee height
    lowerArmR: { x:  0.175, y: -0.145, rx:  0.30, rz:  0.00, dz: -0.64 },
    upperLegL: { x: -0.075, y: -0.195, rx:  0.80, rz:  0.00, dz: -0.02 },  // thighs back down to the flexed knees
    upperLegR: { x:  0.075, y: -0.195, rx:  0.80, rz:  0.00, dz: -0.02 },
    lowerLegL: { x: -0.075, y: -0.480, rx: -0.44, rz:  0.00, dz: -0.08 },  // shins ~25° forward over the ankles
    lowerLegR: { x:  0.075, y: -0.480, rx: -0.44, rz:  0.00, dz: -0.08 },
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
    upperArmL: { x: -0.130, y:  0.120, rx:  0.497, rz:  0.20, dz: -0.186 },  // reaching down-forward
    upperArmR: { x:  0.130, y:  0.120, rx:  0.497, rz: -0.20, dz: -0.186 },
    lowerArmL: { x: -0.070, y: -0.121, rx: -0.426, rz:  0.20, dz: -0.206 },  // hands on the shins
    lowerArmR: { x:  0.070, y: -0.121, rx: -0.426, rz: -0.20, dz: -0.206 },
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

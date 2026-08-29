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

const POSE_TUCKED = {
    // Knees lift forward (-dz) and up toward chest — tuck in the YZ plane
    torso:     { x:  0.000, y:  0.000, rx:  0.35, rz:  0.00, dz:  0.00 },  // torso curls forward
    head:      { x:  0.000, y:  0.340, rx:  0.45, rz:  0.00, dz: -0.06 },  // chin toward knees
    upperArmL: { x: -0.130, y: -0.180, rx: -1.00, rz:  0.20, dz: -0.18 },  // arms reach forward to grab shins
    upperArmR: { x:  0.130, y: -0.180, rx: -1.00, rz: -0.20, dz: -0.18 },
    lowerArmL: { x: -0.070, y: -0.280, rx: -1.00, rz:  0.20, dz: -0.26 },
    lowerArmR: { x:  0.070, y: -0.280, rx: -1.00, rz: -0.20, dz: -0.26 },
    upperLegL: { x: -0.075, y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },  // thighs up and forward
    upperLegR: { x:  0.075, y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },
    lowerLegL: { x: -0.075, y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },  // shins fold in
    lowerLegR: { x:  0.075, y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },
    // Skis track feet: foot moves to ~y=-0.396 at same rx as lower leg
    skiL:      { x: -0.075, y: -0.410, rx: -0.55, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -0.410, rx: -0.55, rz:  0.00, dz:  0.00 },
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
[SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_INRUN_TUCK, POSE_TUCKED, POSE_PIKED,
 POSE_ARMS_FORWARD, POSE_ARMS_DROPPED, POSE_ARMS_50DEG, POSE_ARMS_T,
 POSE_ARMS_UP].forEach(deepFreeze);

const api = { SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_INRUN_TUCK, POSE_TUCKED, POSE_PIKED, POSE_ARMS_FORWARD, POSE_ARMS_DROPPED, POSE_ARMS_50DEG, POSE_ARMS_T, POSE_ARMS_UP };

// Dual-mode: require() in node --test, <script> in the browser, and
// vm.runInContext in the headless harness. The project has no bundler.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).bodyModel = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

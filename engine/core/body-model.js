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

const POSE_INRUN_TUCK = {
    torso:     { x:  0.000, y:  0.000, rx: -1.10, rz:  0.00, dz: -0.10 },  // torso tips forward
    head:      { x:  0.000, y:  0.160, rx: -1.00, rz:  0.00, dz: -0.45 },  // head drives forward/down
    upperArmL: { x: -0.175, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperArmR: { x:  0.175, y:  0.000, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmL: { x: -0.175, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    lowerArmR: { x:  0.175, y: -0.275, rx:  0.00, rz:  0.00, dz:  0.00 },
    upperLegL: { x: -0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },  // thighs push back
    upperLegR: { x:  0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },
    lowerLegL: { x: -0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },  // shins tilt forward
    lowerLegR: { x:  0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },
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

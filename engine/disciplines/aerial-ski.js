(function (global) {
'use strict';
// ── aerial-ski terrain discipline ────────────────────────────────────────────
// Extracted verbatim from game.js. All geometry constants arrive at runtime in
// `cfg` (they are computed from URL parameters and cannot be hardcoded).
// Mode selection rides on cfg.mode ('ski' | 'trampoline' | 'trampolineMat' |
// 'pool') per ADR-0003: no shared-code branching on discipline globals.

function transBezY(z, cfg) {
    const _tBP = cfg.tBP;
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_tBP[0][0] + 3*_u*_u*_m*_tBP[1][0] + 3*_u*_m*_m*_tBP[2][0] + _m*_m*_m*_tBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_tBP[0][1] + 3*_u*_u*_t*_tBP[1][1] + 3*_u*_t*_t*_tBP[2][1] + _t*_t*_t*_tBP[3][1];
}

function kickerBezY(z, cfg) {
    const _kBP = cfg.kBP;
    let lo = 0, hi = 1;
    for (let _i = 0; _i < 14; _i++) {
        const _m = (lo + hi) * 0.5, _u = 1 - _m;
        (_u*_u*_u*_kBP[0][0] + 3*_u*_u*_m*_kBP[1][0] + 3*_u*_m*_m*_kBP[2][0] + _m*_m*_m*_kBP[3][0] < z)
            ? (lo = _m) : (hi = _m);
    }
    const _t = (lo + hi) * 0.5, _u = 1 - _t;
    return _u*_u*_u*_kBP[0][1] + 3*_u*_u*_t*_kBP[1][1] + 3*_u*_t*_t*_kBP[2][1] + _t*_t*_t*_kBP[3][1];
}

function terrainRootY(z, cfg) {
    if (cfg.mode === 'trampoline') return cfg.TRAMPOLINE_Y;
    if (cfg.mode === 'trampolineMat') {
        // Crash mat surface is 0.28m above gym floor; translate to rootY threshold
        if (z >= cfg.MAT_LAND_START_Z && z <= cfg.MAT_LAND_END_Z) return cfg.TRAMPOLINE_Y + 0.28 + 0.10;
        return cfg.TRAMPOLINE_Y;
    }
    const SLOPE_ANGLE     = cfg.SLOPE_ANGLE;
    const SLOPE_START_Z   = cfg.SLOPE_START_Z;
    const FLAT_Z          = cfg.FLAT_Z;
    const TRANS_START_Z   = cfg.TRANS_START_Z;
    const TRANS_END_Z     = cfg.TRANS_END_Z;
    const KICKER_START_Z  = cfg.KICKER_START_Z;
    const KICKER_END_Z    = cfg.KICKER_END_Z;
    const LANDING_START_Z = cfg.LANDING_START_Z;
    const OUTRUN_Z        = cfg.OUTRUN_Z;
    const LANDING_ANGLE   = cfg.LANDING_ANGLE;
    if (z < SLOPE_START_Z) return -SLOPE_START_Z * Math.tan(SLOPE_ANGLE); // flat top
    const tableY = -FLAT_Z * Math.tan(SLOPE_ANGLE); // y-height of the flat table
    if (z < TRANS_START_Z) return -z * Math.tan(SLOPE_ANGLE); // straight inrun slope
    // ── Cubic bezier transition: slope angle → flat, 3m before + 3m after FLAT_Z ──
    if (z < TRANS_END_Z) return transBezY(z, cfg);
    // ── Flat table (TRANS_END_Z → KICKER_START_Z) ────────────────────────────────
    if (z <= KICKER_START_Z) return tableY;
    // ── Kicker: pure convex bezier KICKER_START_Z (flat) → KICKER_END_Z (lip angle) ──
    // P0/P1 both at tableY → zero entry tangent → mathematically cannot dip below table.
    if (z <= KICKER_END_Z) return kickerBezY(z, cfg);
    const _backFaceEndZ   = KICKER_END_Z + 0.5;
    const _landingStartZ  = LANDING_START_Z;
    // Landing: flat at tableY, C1 knuckle fillet into the straight slope,
    // C1 roll-out fillet into the flat outrun (see landingFits note).
    // Piecewise splits sit on the FILLET TANGENCY points (ltArc.T1z/T2z,
    // loArc.T1z/T2z) — handing off anywhere else would step across the gap
    // between the old lines and the circle.
    if (landingFits(cfg)) {
        if (z <= cfg.ltArc.T1z) return tableY;
        if (z <= cfg.ltArc.T2z) return landKnuckleArcY(z, cfg);
        const _mLand = Math.tan(LANDING_ANGLE);
        const _yFlat = tableY - (OUTRUN_Z - _landingStartZ) * _mLand;
        if (z <= cfg.loArc.T1z) return tableY - (z - _landingStartZ) * _mLand;
        if (z <= cfg.loArc.T2z) return landRollOutArcY(z, cfg);
        return _yFlat; // flat outrun
    }
    if (z <= OUTRUN_Z) return tableY - (z - _landingStartZ) * Math.tan(LANDING_ANGLE);
    return tableY - (OUTRUN_Z - _landingStartZ) * Math.tan(LANDING_ANGLE); // flat outrun
}

function terrainAccelZ(z, cfg) {
    if (cfg.mode === 'trampoline' || cfg.mode === 'trampolineMat' || cfg.mode === 'pool') return 0;
    const g = 14.0;
    const SLOPE_START_Z = cfg.SLOPE_START_Z;
    const OUTRUN_Z      = cfg.OUTRUN_Z;
    if (z < SLOPE_START_Z) return 0;    // flat top
    if (z > OUTRUN_Z)      return -14.0; // flat outrun friction
    // Derive along-slope acceleration from terrain gradient.
    // accZ = -g * sin(θ) = -g * (dy/dz) / sqrt(1 + (dy/dz)²)
    // Works continuously across slope, transition, kicker, and landing.
    const eps  = 0.01;
    const dydz = (terrainRootY(z + eps, cfg) - terrainRootY(z - eps, cfg)) / (2 * eps);
    return -g * dydz / Math.sqrt(1 + dydz * dydz);
}


// C1 landing-profile joins (APPROVED: C1-smooth run profile, RENDER-PROGRESS).
// The raw profile creases 0deg -> 40deg at LANDING_START_Z (knuckle) and
// 40deg -> 0deg at OUTRUN_Z (roll-out into the outrun). Iteration-11 built
// both blends as endpoint-PINNED cubic beziers; with the end slopes pinned the
// interior slope MUST peak at >= 1.5x the secant (measured -49.8 deg / -45.9 deg
// and a 53.7 cm bulge) — a two-point Hermite cannot do better, so the endpoints
// must float. Both joins are now TANGENT FILLET CIRCLES: one circle per corner,
// tangent to both joining lines. That construction mathematically cannot
// overshoot — slope stays strictly inside [min(a,b), max(a,b)], is monotone
// through each blend (single curvature sign), and the surface sits inside the
// air wedge between the lines. Cost: the blend consumes a small footprint
// R*tan(LANDING_ANGLE/2) on each line (tangency points move; all LEVELS are
// byte-preserved — table height, straight-line landing segments, flat outrun
// level), which moves the landing point slightly up-slope (~cm scale with
// R_KNUCKLE=1) — pre-approved by the reviewer ("a small landing-point shift
// from rounding the knoll is expected and acceptable"). Arc descriptors arrive
// in cfg.ltArc / cfg.loArc, precomputed by game.js:
//   ltArc = {T1z, T2z, cx, cy, R}   knuckle (centre BELOW tableY)
//   loArc = {T1z, T2z, cx, cy, R}   roll-out (centre ABOVE yFlat)
// Both join their neighbouring straight lines EXACTLY (construction tangency),
// so sampled terrainRootY is C1 everywhere except the intended cliff behind
// the kicker lip.
function landKnuckleArcY(z, cfg) {
    const A = cfg.ltArc;
    const dz = z - A.cx;
    return A.cy + Math.sqrt(A.R * A.R - dz * dz); // upper branch of the circle
}

function landRollOutArcY(z, cfg) {
    const A = cfg.loArc;
    const dz = z - A.cx;
    return A.cy - Math.sqrt(A.R * A.R - dz * dz); // lower branch of the circle
}

// True when the caller supplied both arc descriptors and they fit the landing
// span: the knuckle fillet must start down-table of the kicker back wall and
// its exit-tangency must not reach the roll-out's entry-tangency (custom
// worlds can shorten everything).
function landingFits(cfg) {
    if (!cfg.ltArc || !cfg.loArc) return false;
    if (!(cfg.ltArc.R > 0 && cfg.loArc.R > 0)) return false;
    if (cfg.ltArc.T1z < cfg.KICKER_END_Z) return false;
    return cfg.ltArc.T2z <= cfg.loArc.T1z;
}

// ── Physics config factory ───────────────────────────────────────────────────
// The per-world tuning values live HERE, with the discipline, rather than in
// game.js. game.js parses the URL (environment access is its job) and passes the
// already-parsed parameters in; it holds no physics values of its own.
//
// TARGET_OMEGA_UNTUCKED is rad/s at full extension. The 4.5 * 0.9925 base is the
// world-normal flip rate; the per-world multiplier scales it to the hill size.
function makePhysicsConfig(opts) {
    const o = opts || {};
    const world = o.world;
    const mult =
          world === 'custom'     ? o.customFlipSpeed
        : world === 'trampoline' ? 1.407
        : world === 'quint'      ? 1.96
        : world === 'quad'       ? 1.63
        : world === 'triple'     ? 1.45
        : world === 'single'     ? 0.65
        : 1.10;
    return {
        GRAVITY: 14.0,                                  // world-units / s²
        TARGET_OMEGA_UNTUCKED: 4.5 * 0.9925 * mult,     // rad/s at full extension
    };
}

const api = { makePhysicsConfig, transBezY, kickerBezY, landKnuckleArcY, landRollOutArcY, landingFits, terrainRootY, terrainAccelZ };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).aerialSki = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

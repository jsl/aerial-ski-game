(function (global) {
'use strict';

const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;
const _bodyModel = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./body-model.js')
    : global.AerialEngine.bodyModel;

const { lerp } = _math;

function armSweep(name, _up, t) {
    const phi  = Math.PI * t;           // 0 (up) → π (down)
    const baseX = (name === 'upperArmR' || name === 'lowerArmR') ? 0.175 : -0.175;
    // Radial distances from the shoulder pivot (y=0.150) along the arm chain:
    //   upper-arm centre: h/2         = 0.30/2        = 0.150
    //   lower-arm centre: h_u + h_l/2 = 0.30 + 0.125  = 0.425
    const dist = (name === 'lowerArmL' || name === 'lowerArmR') ? 0.425 : 0.150;
    return {
        x:  baseX,
        y:  0.150 + dist * Math.cos(phi),   // 0.300/0.575 up → 0.000/-0.275 down
        rx: -phi,                            // 0 up → -π/2 forward → -π down
        rz: 0,
        dz: -dist * Math.sin(phi),           // 0 up → max-forward at mid-arc → 0 down
    };
}

// Pure pose solver: blends body-segment transforms between pose tables.
// Returns { segName: { x, y, z, rx, rz }, ... } — writes nothing to any mesh.
function computePose(params, model) {
    const {
        SEGMENTS, BASE_Z, POSE_UNTUCKED, POSE_INRUN_TUCK, POSE_TUCKED, POSE_PIKED,
        POSE_ARMS_50DEG, POSE_ARMS_T, POSE_ARMS_UP,
    } = model || _bodyModel;
    const {
        tuck, armDropL, armDropR, armSnap, layArmT, armRaise,
        grounded,
    } = params;
    const pikeAmount  = params.pikeAmount  || 0;
    const pikeArmDrop = params.pikeArmDrop || 0;

    const result = {};
    for (const seg of SEGMENTS) {
        const up   = POSE_UNTUCKED[seg.name];
        // Choose target pose and blend factor
        let tk, effectiveBlend;
        if (grounded) {
            tk = POSE_INRUN_TUCK[seg.name];
            effectiveBlend = tuck;
        } else if (pikeAmount > 0) {
            tk = POSE_PIKED[seg.name];
            // For arm segments: blend target from piked-forward toward dropped during release
            if (pikeArmDrop > 0 && (seg.name === 'upperArmL' || seg.name === 'upperArmR' ||
                                     seg.name === 'lowerArmL' || seg.name === 'lowerArmR')) {
                const dropped = armSweep(seg.name, up, 1.0);
                tk = {
                    x:  lerp(tk.x,  dropped.x,  pikeArmDrop),
                    y:  lerp(tk.y,  dropped.y,  pikeArmDrop),
                    rx: lerp(tk.rx, dropped.rx, pikeArmDrop),
                    rz: lerp(tk.rz, dropped.rz, pikeArmDrop),
                    dz: lerp(tk.dz, dropped.dz, pikeArmDrop),
                };
            }
            effectiveBlend = pikeAmount;
        } else {
            tk = POSE_TUCKED[seg.name];
            effectiveBlend = tuck;
        }
        let ex = up;

        if (seg.name === 'upperArmL' || seg.name === 'lowerArmL') {
            ex = armSweep(seg.name, up, armDropL);
            if (armSnap > 0) {
                const sn = POSE_ARMS_50DEG[seg.name];
                ex = { x: lerp(ex.x, sn.x, armSnap), y: lerp(ex.y, sn.y, armSnap),
                       rx: lerp(ex.rx, sn.rx, armSnap), rz: lerp(ex.rz, sn.rz, armSnap),
                       dz: lerp(ex.dz, sn.dz, armSnap) };
            }
            if (layArmT > 0) {
                const tp = POSE_ARMS_T[seg.name];
                ex = { x: lerp(ex.x, tp.x, layArmT), y: lerp(ex.y, tp.y, layArmT),
                       rx: lerp(ex.rx, tp.rx, layArmT), rz: lerp(ex.rz, tp.rz, layArmT),
                       dz: lerp(ex.dz, tp.dz, layArmT) };
            }
            if (armRaise > 0) {
                const up2 = POSE_ARMS_UP[seg.name];
                const raiseT = armRaise * (1 - armDropL);
                ex = { x: lerp(ex.x, up2.x, raiseT), y: lerp(ex.y, up2.y, raiseT),
                       rx: lerp(ex.rx, up2.rx, raiseT), rz: lerp(ex.rz, up2.rz, raiseT),
                       dz: lerp(ex.dz, up2.dz, raiseT) };
            }
        } else if (seg.name === 'upperArmR' || seg.name === 'lowerArmR') {
            ex = armSweep(seg.name, up, armDropR);
            if (armSnap > 0) {
                const sn = POSE_ARMS_50DEG[seg.name];
                ex = { x: lerp(ex.x, sn.x, armSnap), y: lerp(ex.y, sn.y, armSnap),
                       rx: lerp(ex.rx, sn.rx, armSnap), rz: lerp(ex.rz, sn.rz, armSnap),
                       dz: lerp(ex.dz, sn.dz, armSnap) };
            }
            if (layArmT > 0) {
                const tp = POSE_ARMS_T[seg.name];
                ex = { x: lerp(ex.x, tp.x, layArmT), y: lerp(ex.y, tp.y, layArmT),
                       rx: lerp(ex.rx, tp.rx, layArmT), rz: lerp(ex.rz, tp.rz, layArmT),
                       dz: lerp(ex.dz, tp.dz, layArmT) };
            }
            if (armRaise > 0) {
                const up2 = POSE_ARMS_UP[seg.name];
                const raiseT = armRaise * (1 - armDropR);
                ex = { x: lerp(ex.x, up2.x, raiseT), y: lerp(ex.y, up2.y, raiseT),
                       rx: lerp(ex.rx, up2.rx, raiseT), rz: lerp(ex.rz, up2.rz, raiseT),
                       dz: lerp(ex.dz, up2.dz, raiseT) };
            }
        }

        // THESE FIVE VALUES ARE THE OUTPUT:
        result[seg.name] = {
            x:  lerp(ex.x,  tk.x,  effectiveBlend),
            y:  lerp(ex.y,  tk.y,  effectiveBlend),
            z:  (BASE_Z[seg.name] || 0) + lerp(ex.dz, tk.dz, effectiveBlend),
            rx: lerp(ex.rx, tk.rx, effectiveBlend),
            rz: lerp(ex.rz, tk.rz, effectiveBlend),
        };
    }
    return result;
}

const api = { armSweep, computePose };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).pose = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

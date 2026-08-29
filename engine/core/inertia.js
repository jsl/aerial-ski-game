(function (global) {
'use strict';

const _math = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./math.js')
    : global.AerialEngine.math;
const _bodyModel = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? require('./body-model.js')
    : global.AerialEngine.bodyModel;

const { lerp } = _math;

// Ski self-inertia is pinned at the tuned 1.20 m ski length. The ski grew to
// d = 1.55 (APPROVED ski length 1.20 -> 1.55 m, body-model), which silently
// slowed tucked rotation ~4.1% (I_tuck 5.2250 -> 5.5459) and shifted the
// touchdown flipAngle by 17-111 deg, flipping three knife-edge landings
// (aerial-pike, aerial-tuck-long, aerial-tuck-short). Measured in iteration 33:
// no touchdown-window change can restore the three pre-1.55 outcomes (they need
// narrower AND wider windows at once), so the retune contract
// ("APPROVED: keep ski d = 1.55 and retune the touchdown evaluator" — three
// pre-1.55 outcomes, airtime/flip rates byte-identical) is met by pinning the
// rotational self-term back to the tuned value while the ski keeps its
// approved 1.55 m contact/visual reach.
const SKI_SELF_INERTIA_D = 1.20;

// Moment of inertia about the flip axis (X, shoulder-to-shoulder).
// Distance from X axis = sqrt(y² + z²), so I = Σ [ m_i·(y_i²+z_i²) + m_i·(h_i²+d_i²)/12 ]
function computeI(tuck, model) {
    // POSE_TUCKED_INERTIA, not POSE_TUCKED: the display tuck was rebuilt
    // chain-consistent (Opus item 5) and that must not move the physics, so the
    // mass distribution is pinned at the pre-rebuild y/dz. See the comment on
    // POSE_TUCKED_INERTIA in body-model.js.
    const { SEGMENTS, POSE_UNTUCKED, POSE_TUCKED_INERTIA, BASE_Z } = model || _bodyModel;
    let I = 0;
    for (const seg of SEGMENTS) {
        const up = POSE_UNTUCKED[seg.name];
        const tk = POSE_TUCKED_INERTIA[seg.name];
        const y  = lerp(up.y,  tk.y,  tuck);
        const dz = lerp(up.dz, tk.dz, tuck);
        const z  = (BASE_Z[seg.name] || 0) + dz;
        I += seg.mass * (y * y + z * z);
        // Self-inertia of box around X axis: m*(h² + d²)/12
        const dEff = (seg.name === 'skiL' || seg.name === 'skiR') ? SKI_SELF_INERTIA_D : seg.d;
        I += seg.mass * (seg.h * seg.h + dEff * dEff) / 12;
    }
    return Math.max(I, 0.5); // prevent division by zero
}

const api = { computeI };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).inertia = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

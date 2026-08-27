'use strict';
// ── aerial-ski terrain: live differential ────────────────────────────────────
// terrainRootY and terrainAccelZ ARE top-level in game.js, so unlike the tricks
// module these can be compared against the actually-running functions.
//
// The extracted versions take a config object instead of reading module-level
// constants, because those constants are derived from URL parameters at runtime
// (SLOPE_START_Z alone has six different values depending on ?world=). That is
// the ADR-0003 shape: the discipline supplies config, the maths does not know
// which world it is in.

const test   = require('node:test');
const assert = require('node:assert');
const vm     = require('node:vm');
const { createSim } = require('../golden/harness');
const ski = require('../../engine/disciplines/aerial-ski.js');

/** Read game.js's live constants out of the vm and shape them as a config. */
function configFor(sim, mode) {
    const g = (name) => vm.runInContext(name, sim.ctx);
    return {
        mode,
        SLOPE_ANGLE:      g('SLOPE_ANGLE'),
        SLOPE_START_Z:    g('SLOPE_START_Z'),
        FLAT_Z:           g('FLAT_Z'),
        TRANS_START_Z:    g('TRANS_START_Z'),
        TRANS_END_Z:      g('TRANS_END_Z'),
        KICKER_START_Z:   g('KICKER_START_Z'),
        KICKER_END_Z:     g('KICKER_END_Z'),
        LANDING_START_Z:  g('LANDING_START_Z'),
        OUTRUN_Z:         g('OUTRUN_Z'),
        LANDING_ANGLE:    g('LANDING_ANGLE'),
        MAT_LAND_START_Z: g('MAT_LAND_START_Z'),
        MAT_LAND_END_Z:   g('MAT_LAND_END_Z'),
        TRAMPOLINE_Y:     g('TRAMPOLINE_Y'),
        tBP:              g('_tBP'),
        kBP:              g('_kBP'),
        // C1 landing-blend arc descriptors (iter 13): without these the
        // discipline mirror falls back to the legacy creased profile and the
        // live-vs-mirror strict equality fails around LANDING_START_Z /
        // OUTRUN_Z (found by running the suite on HEAD in iteration 12).
        ltArc:            g('_ltArc'),
        loArc:            g('_loArc'),
        LANDING_TRANS_LEN: g('LANDING_TRANS_LEN'),
        OUTRUN_TRANS_LEN: g('OUTRUN_TRANS_LEN'),
    };
}

/** Sweep the whole run, densely, plus every discontinuity boundary exactly. */
function sweepPoints(cfg) {
    const pts = [];
    const from = cfg.SLOPE_START_Z - 20, to = cfg.OUTRUN_Z + 20;
    for (let z = from; z <= to; z += 0.05) pts.push(z);
    // Boundaries are where a piecewise profile is most likely to be mis-split.
    for (const b of [cfg.SLOPE_START_Z, cfg.FLAT_Z, cfg.TRANS_START_Z, cfg.TRANS_END_Z,
                     cfg.KICKER_START_Z, cfg.KICKER_END_Z, cfg.LANDING_START_Z,
                     cfg.OUTRUN_Z, cfg.MAT_LAND_START_Z, cfg.MAT_LAND_END_Z]) {
        for (const d of [-1e-9, 0, 1e-9, -0.001, 0.001]) pts.push(b + d);
    }
    return pts;
}

// Each world exercises a different branch set AND different constants.
const WORLDS = [
    { search: '',                    mode: 'ski' },
    { search: '?world=triple',       mode: 'ski' },
    { search: '?world=quint',        mode: 'ski' },
    { search: '?world=trampoline',   mode: 'trampoline' },
    { search: '?world=pool',         mode: 'pool' },
];

for (const w of WORLDS) {
    const label = w.search || '(default)';

    test(`terrainRootY matches live game.js for ${label}`, () => {
        const sim  = createSim({ search: w.search });
        const live = vm.runInContext('terrainRootY', sim.ctx);
        const cfg  = configFor(sim, w.mode);

        let checked = 0;
        for (const z of sweepPoints(cfg)) {
            assert.strictEqual(ski.terrainRootY(z, cfg), live(z),
                `terrainRootY(${z}) in ${label}`);
            checked++;
        }
        assert.ok(checked > 500, `sanity: only ${checked} points swept`);
    });

    test(`terrainAccelZ matches live game.js for ${label}`, () => {
        const sim  = createSim({ search: w.search });
        const live = vm.runInContext('terrainAccelZ', sim.ctx);
        const cfg  = configFor(sim, w.mode);

        for (const z of sweepPoints(cfg)) {
            assert.strictEqual(ski.terrainAccelZ(z, cfg), live(z),
                `terrainAccelZ(${z}) in ${label}`);
        }
    });
}

test('the config actually drives the profile — it is not decorative', () => {
    // If the module ignored cfg and used baked-in constants, two worlds with
    // different geometry would return identical heights. They must not.
    const a = createSim({ search: '?world=single' });
    const b = createSim({ search: '?world=quint' });
    const cfgA = configFor(a, 'ski');
    const cfgB = configFor(b, 'ski');

    assert.notStrictEqual(cfgA.SLOPE_START_Z, cfgB.SLOPE_START_Z,
        'test premise: these worlds must differ in geometry');

    const z = cfgA.SLOPE_START_Z - 5;
    assert.notStrictEqual(ski.terrainRootY(z, cfgA), ski.terrainRootY(z, cfgB),
        'same z gives the same height in two different worlds — cfg is ignored');
});

// ── C1 fillet gates (reviewer, iteration-11 review) ──────────────────────────
// The iter-11 endpoint-pinned beziers peaked at −49.8° local slope with a
// 53.7 cm bulge; a pinned two-point Hermite CANNOT do better (interior slope
// must reach ≥ 1.5× the secant), so iter 13 switched to tangent-fillet circles
// under APPROVED: C1-smooth run profile. These gates make the failure class a
// test error forever: slope bounds, monotonicity, correct wedge side.
test('landing-profile blend gates: no overshoot, monotone, correct side', () => {
    const sim = createSim({ search: '' });
    const g = (n) => vm.runInContext(n, sim.ctx);
    const cfg = configFor(sim, 'ski');
    const y = (z) => ski.terrainRootY(z, cfg);
    const D = Math.PI / 180;
    const mTan = Math.tan(cfg.LANDING_ANGLE);
    const LSZ = cfg.LANDING_START_Z, OZ = cfg.OUTRUN_Z;
    const tableY = -cfg.FLAT_Z * Math.tan(cfg.SLOPE_ANGLE);
    const yFlat = tableY - (OZ - LSZ) * mTan;
    const kt = cfg.ltArc, ot = cfg.loArc;

    // G1 — descent angle within [min,max] of the joined lines everywhere past
    // the kicker back wall (the kicker itself legitimately climbs).
    let worstSlopeDeg = 0;
    for (let z = cfg.KICKER_END_Z + 1; z <= OZ + 12; z += 0.02) {
        const s = -(y(z + 5e-4) - y(z - 5e-4)) / 1e-3;      // downhill magnitude
        const deg = Math.atan(s) / D;
        if (deg > worstSlopeDeg) worstSlopeDeg = deg;
        assert.ok(deg >= -0.05 && deg <= cfg.LANDING_ANGLE / D + 0.05,
            `slope ${deg.toFixed(2)} deg outside [0, ${(cfg.LANDING_ANGLE / D).toFixed(1)}] at z=${z.toFixed(3)}`);
    }

    // G2 — slope monotone inside each fillet (single curvature sign).
    const mono = (z0, z1, dirWanted /* -1 decreasing, +1 increasing */) => {
        let prev = null;
        for (let z = z0 + 0.004; z <= z1 - 0.004; z += 0.01) {
            const s = -(y(z + 5e-4) - y(z - 5e-4)) / 1e-3;
            if (prev !== null) {
                const d = (s - prev) * dirWanted;
                assert.ok(d >= -1e-6,
                    `blend slope flipped direction (${dirWanted}) at z=${z.toFixed(3)} ` +
                    `(s=${s.toFixed(4)}, prev=${prev.toFixed(4)})`);
            }
            prev = s;
        }
    };
    mono(kt.T1z, kt.T2z, +1);   // knuckle: downhill steepness grows monotonically 0 -> tan(a)
    mono(ot.T1z, ot.T2z, -1);   // roll-out: downhill steepness falls monotonically tan(a) -> 0

    // G3 — anti-hump + level pins. The fillets re-move material INSIDE their
    // spans (they cut ~R*(sec−1) into the corner: unavoidable for any monotone
    // blend whose slopes stay in range), so "correct side" is enforced against
    // the envelopes that define a launch bump:
    //   * the surface may never rise above the FLAT TABLE level anywhere,
    //     and never above/below the pre-C1 creased profile OUTSIDE the
    //     blend footprints (byte-equal there);
    //   * the roll-out may never sink below the outrun level;
    //   * mid-blend deviation vs the old crease is reported in the log.
    for (let z = kt.T1z; z <= ot.T2z; z += 0.01) {
        const tableCap = -cfg.FLAT_Z * Math.tan(cfg.SLOPE_ANGLE);
        assert.ok(y(z) <= tableCap + 1e-6,
            `profile rose above the table level (launch bump) by ` +
            `${((y(z) - tableCap) * 1000).toFixed(2)} mm at z=${z.toFixed(3)}`);
        assert.ok(z <= OZ || y(z) >= yFlat - 1e-6,
            `roll-out sank below the outrun level by ${((yFlat - y(z)) * 1000).toFixed(2)} mm at z=${z.toFixed(3)}`);
    }
    for (const [z0, z1] of [[cfg.KICKER_END_Z + 0.5, kt.T1z],
                            [kt.T2z, ot.T1z], [ot.T2z, OZ + 40]]) {
        for (let z = z0 + 0.004; z <= z1 - 0.004; z += 0.05) {
            const oldY = z <= LSZ ? tableY : z <= OZ ? tableY - (z - LSZ) * mTan : yFlat;
            assert.ok(Math.abs(y(z) - oldY) < 1e-9,
                `profile changed OUTSIDE the blend spans: ${(Math.abs(y(z) - oldY) * 1000).toFixed(6)} mm at z=${z.toFixed(3)}`);
        }
    }

    // Reported, not gated: peak deviation vs the pre-C1 creased profile.
    let maxAboveOldCrease = 0, maxBelowOldCrease = 0;
    for (let z = kt.T1z; z <= ot.T2z; z += 0.02) {
        const oldY = z <= LSZ ? tableY : z <= OZ ? tableY - (z - LSZ) * mTan : yFlat;
        const d = y(z) - oldY;
        maxAboveOldCrease = Math.max(maxAboveOldCrease, d);
        maxBelowOldCrease = Math.min(maxBelowOldCrease, d);
    }
    console.log(`PROFILE_GATES ok: worst slope ${worstSlopeDeg.toFixed(2)} deg ` +
        `(limit ${(cfg.LANDING_ANGLE / D).toFixed(1)}); vs old crease ` +
        `${(maxAboveOldCrease * 100).toFixed(1)}cm above / ${(-maxBelowOldCrease * 100).toFixed(1)}cm into`);
});

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
        // C1 landing-blend control points (iter 11): without these the
        // discipline mirror falls back to the legacy creased profile and the
        // live-vs-mirror strict equality fails around LANDING_START_Z /
        // OUTRUN_Z (found by running the suite on HEAD in iteration 12).
        ltBP:             g('_ltBP'),
        loBP:             g('_loBP'),
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

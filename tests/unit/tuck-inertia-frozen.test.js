'use strict';
// ── The rebuilt display tuck must not have moved the physics ────────────────
// Opus item 5 rebuilt POSE_TUCKED chain-consistent (the old table's tuck=1
// endpoint was dislocated: shoulder 0.536 m, hip 0.329 m off their anchors).
// computeI reads only y and dz, so that rebuild would have changed I_tuck and
// with it every tucked rotation rate — iteration 33 measured a 4.1% I_tuck
// shift flipping three knife-edge landings. It ships as a display-only change
// with the mass distribution pinned in POSE_TUCKED_INERTIA.
//
// This test is the pin. The expectations below are the values HEAD produced
// BEFORE the rebuild (git 1e8d0cb), captured to full float64 precision — so it
// fails if the frozen table is edited, if computeI is re-pointed at the display
// table, or if either drifts.
const test = require('node:test');
const assert = require('node:assert');
const bm = require('../../engine/core/body-model.js');
const { computeI } = require('../../engine/core/inertia.js');

// I(tuck) from HEAD 1e8d0cb, printed with toPrecision(21).
const FROZEN_I = {
    0:    17.6349206666666660226,
    0.25: 12.5328628541666624585,
    0.5:   8.76386441666666549111,
    0.75:  6.32792535416666623860,
    1:     5.22504566666666647734,
};

test('computeI is byte-identical to the pre-rebuild physics', () => {
    for (const [t, want] of Object.entries(FROZEN_I)) {
        assert.strictEqual(computeI(Number(t)), want,
            `I(tuck=${t}) moved — the tuck rebuild has leaked into the physics`);
    }
});

test('computeI reads the frozen table, not the display table', () => {
    // Perturb only the DISPLAY tuck: computeI must not notice.
    const display = {};
    for (const k of Object.keys(bm.POSE_TUCKED)) {
        display[k] = { ...bm.POSE_TUCKED[k], y: bm.POSE_TUCKED[k].y + 1, dz: bm.POSE_TUCKED[k].dz + 1 };
    }
    assert.strictEqual(computeI(1, { ...bm, POSE_TUCKED: display }), FROZEN_I[1],
        'computeI moved when only the DISPLAY tuck changed — it is reading POSE_TUCKED');

    // NEGATIVE CONTROL: perturb the frozen table and computeI must move, so the
    // test above is not passing merely because the parameter is ignored.
    const inertia = {};
    for (const k of Object.keys(bm.POSE_TUCKED_INERTIA)) {
        inertia[k] = { ...bm.POSE_TUCKED_INERTIA[k], y: bm.POSE_TUCKED_INERTIA[k].y + 1 };
    }
    assert.notStrictEqual(computeI(1, { ...bm, POSE_TUCKED_INERTIA: inertia }), FROZEN_I[1],
        'computeI ignored the frozen table too — it is reading neither');
});

test('the frozen table carries exactly the pre-rebuild y/dz', () => {
    // Transcribed from POSE_TUCKED at git 1e8d0cb.
    const WAS = {
        torso: [0.000, 0.00], head: [0.340, -0.06],
        upperArmL: [-0.180, -0.18], upperArmR: [-0.180, -0.18],
        lowerArmL: [-0.280, -0.26], lowerArmR: [-0.280, -0.26],
        upperLegL: [-0.140, -0.20], upperLegR: [-0.140, -0.20],
        lowerLegL: [-0.230, -0.10], lowerLegR: [-0.230, -0.10],
        skiL: [-0.410, 0.00], skiR: [-0.410, 0.00],
    };
    assert.deepStrictEqual(Object.keys(bm.POSE_TUCKED_INERTIA).sort(), Object.keys(WAS).sort());
    for (const [k, [y, dz]] of Object.entries(WAS)) {
        assert.strictEqual(bm.POSE_TUCKED_INERTIA[k].y, y, `${k}.y drifted`);
        assert.strictEqual(bm.POSE_TUCKED_INERTIA[k].dz, dz, `${k}.dz drifted`);
    }
    assert.ok(Object.isFrozen(bm.POSE_TUCKED_INERTIA), 'POSE_TUCKED_INERTIA is not frozen');
});

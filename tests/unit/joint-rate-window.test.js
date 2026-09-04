'use strict';

// SLOT 298 — negative controls for the 5-frame averaged joint-rate instrument
// (ruling on 297). The averaged gate (threshold UNCHANGED at 220°/s =
// 3.84 rad/s) must FIRE on a synthetic sustained 300°/s hinge rotation over
// 0.3 s, and must NOT fire on a single-frame solver-class spike that trips
// the raw instrument.

const test = require('node:test');
const assert = require('node:assert');

const { createJointRateWindow, WINDOW_N } = require('../drive/joint-rate-window.js');

const GATE = 220 * Math.PI / 180; // 3.8415...

test('window size is the ruled 5 frames', () => {
    assert.strictEqual(WINDOW_N, 5);
});

// The ruling's negative control: a synthetic sustained 300°/s hinge rotation
// over 0.3 s MUST fire on the averaged instrument.
test('NC: sustained 300 deg/s over 0.3 s fires raw AND averaged', () => {
    const w = createJointRateWindow();
    const rate = 300 * Math.PI / 180; // 5.23599 rad/s
    const dt = 1 / 60;
    const n = Math.round(0.3 / dt) + 1; // 19 samples over 0.3 s
    for (let i = 0; i < n; i++) w.push(i * dt, { kneeR: rate * i * dt }, true);
    const s = w.summary();
    assert.ok(s.rawEarly > GATE, `raw ${s.rawEarly} must exceed ${GATE}`);
    assert.ok(s.avgEarly > GATE, `averaged ${s.avgEarly} must exceed ${GATE}`);
    // A sustained rate reads (near-)identically on both instruments.
    assert.ok(Math.abs(s.avgEarly - rate) / rate < 0.01,
        `averaged ${s.avgEarly} should read the sustained ${rate} within 1%`);
    assert.strictEqual(s.avgEarlyJ, 'kneeR');
});

// The ruling's physical reason: a one-frame 8 rad/s step (~8° in 16 ms —
// solver-spike class) trips the raw peak but reads ≈ S/4 ≈ 2.0 averaged,
// i.e. it does NOT trip the averaged gate.
test('NC: single-frame 8 rad/s spike fires raw but NOT averaged', () => {
    const w = createJointRateWindow();
    const dt = 1 / 60;
    const spike = 8.0; // rad/s on one frame
    let a = 0;
    for (let i = 0; i < 30; i++) {
        if (i === 15) a += spike * dt; // one-frame step, then quiet
        w.push(i * dt, { neck: a }, true);
    }
    const s = w.summary();
    assert.ok(Math.abs(s.rawEarly - spike) / spike < 0.01,
        `raw ${s.rawEarly} should read the spike ${spike}`);
    assert.ok(s.avgEarly < GATE,
        `averaged ${s.avgEarly} must stay under the gate ${GATE}`);
    assert.ok(Math.abs(s.avgEarly - spike / 4) / (spike / 4) < 0.01,
        `averaged ${s.avgEarly} should read spike/4 = ${spike / 4}`);
});

test('constant 100 deg/s reads identically on both instruments', () => {
    const w = createJointRateWindow();
    const rate = 100 * Math.PI / 180; // 1.74533 rad/s
    const dt = 1 / 60;
    for (let i = 0; i < 20; i++) w.push(i * dt, { elbL: rate * i * dt }, true);
    const s = w.summary();
    assert.ok(Math.abs(s.rawEarly - rate) < 1e-9);
    assert.ok(Math.abs(s.avgEarly - rate) < 1e-9);
});

test('early/late split follows the caller flag; empty window reads zero', () => {
    const w = createJointRateWindow();
    assert.deepStrictEqual(
        [w.summary().rawEarly, w.summary().avgEarly, w.summary().n], [0, 0, 0]);
    const dt = 1 / 60;
    const rate = 2.0;
    for (let i = 0; i < 10; i++) w.push(i * dt, { kneeL: rate * i * dt }, i < 5);
    const s = w.summary();
    assert.ok(s.rawEarly > 0 && s.avgEarly > 0, 'early window must accumulate');
    assert.ok(s.rawLate > 0 && s.avgLate > 0, 'late window must accumulate');
    assert.strictEqual(s.rawEarlyJ, 'kneeL');
});

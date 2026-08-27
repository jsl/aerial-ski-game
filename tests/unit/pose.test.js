'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { armSweep } = require('../../engine/core/pose.js');

// VERBATIM COPY of the original function from game.js (renamed for comparison)
function armSweepOriginal(name, _up, t) {
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

const NAMES = ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'];

// Small deterministic seeded PRNG (mulberry32). NOT Math.random — reproducible.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function assertPoseEqual(actual, expected, msgPrefix) {
    assert.strictEqual(actual.x, expected.x, `${msgPrefix} field x`);
    assert.strictEqual(actual.y, expected.y, `${msgPrefix} field y`);
    assert.strictEqual(actual.rx, expected.rx, `${msgPrefix} field rx`);
    assert.strictEqual(actual.rz, expected.rz, `${msgPrefix} field rz`);
    assert.strictEqual(actual.dz, expected.dz, `${msgPrefix} field dz`);
}

test('armSweep matches original over 2000+ deterministic pseudo-random inputs', () => {
    const rand = mulberry32(0xC0FFEE);
    for (let i = 0; i < 2000; i++) {
        const name = NAMES[Math.floor(rand() * NAMES.length)];
        const t = rand(); // in [0, 1)
        assertPoseEqual(
            armSweep(name, undefined, t),
            armSweepOriginal(name, undefined, t),
            `iteration ${i} (name=${name}, t=${t}):`
        );
    }
});

test('armSweep edge cases: t = 0 for all four names', () => {
    for (const name of NAMES) {
        assertPoseEqual(
            armSweep(name, undefined, 0),
            armSweepOriginal(name, undefined, 0),
            `t=0 name=${name}:`
        );
    }
});

test('armSweep edge cases: t = 0.5 for all four names', () => {
    for (const name of NAMES) {
        assertPoseEqual(
            armSweep(name, undefined, 0.5),
            armSweepOriginal(name, undefined, 0.5),
            `t=0.5 name=${name}:`
        );
    }
});

test('armSweep edge cases: t = 1 for all four names', () => {
    for (const name of NAMES) {
        assertPoseEqual(
            armSweep(name, undefined, 1),
            armSweepOriginal(name, undefined, 1),
            `t=1 name=${name}:`
        );
    }
});

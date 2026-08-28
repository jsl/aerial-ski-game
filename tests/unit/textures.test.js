'use strict';
// ── procedural texture helpers (render/textures.js) ──────────────────────────
// Pure-maths guards for the P12 macro-variation layer. The canvas-dependent
// builders (makeSurface/makeDetail) return null in node — the drive specs are
// the only place they can be checked against a real renderer — but the field
// the macro tile is built from is testable here, and it carries the two
// properties the whole layer stands on: seamlessness and a neutral mean.

const test = require('node:test');
const assert = require('node:assert');
const T = require('../../render/textures');

test('macroField is periodic on the unit square (seamless at any uScale)', () => {
    // The lattice valueNoise used by the fine recipes does NOT wrap; if the
    // macro layer ever switches back to it, a seam line repeats every tile
    // across the snow. Integer-wavenumber waves must wrap to float precision.
    for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        assert.ok(Math.abs(T.macroField(0, t) - T.macroField(1, t)) < 1e-9,
            'x seam at t=' + t);
        assert.ok(Math.abs(T.macroField(t, 0) - T.macroField(t, 1)) < 1e-9,
            'y seam at t=' + t);
        assert.ok(Math.abs(T.macroField(0.37, t) - T.macroField(1.37, t)) < 1e-9,
            'x period at t=' + t);
    }
});

test('macroField mean is 0.5 and stays in 0..1 (grey-ramp neutrality)', () => {
    // The detail shader multiplies albedo by 2*texel.r; a mean other than 0.5
    // would shift corridor brightness and reopen the grey-ramp wound.
    let sum = 0, mn = 1, mx = 0;
    const N = 128;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const v = T.macroField(x / N, y / N);
            sum += v;
            mn = Math.min(mn, v);
            mx = Math.max(mx, v);
        }
    }
    assert.ok(Math.abs(sum / (N * N) - 0.5) < 1e-9, 'mean must be exactly 0.5');
    assert.ok(mn >= 0 && mx <= 1, 'range must stay in 0..1');
    assert.ok(mx - mn > 0.2, 'field must actually vary (got ' + (mx - mn) + ')');
});

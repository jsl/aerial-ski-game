'use strict';
// ── computePose vs the live applyPose ────────────────────────────────────────
// applyPose in game.js does two jobs: solve the pose (pure maths) and write it
// onto meshes (rendering). computePose extracts the first half.
//
// This proves the extraction is faithful by running the LIVE applyPose against
// real stub meshes, reading back what it wrote, and comparing to computePose's
// return value. That is a genuine differential test against the shipped code,
// not a comparison against a hand-copy.
//
// reconciliation (P13, iter 67 — upper/lower legs, skis and head re-anchored
// to constant joint lengths after the pose lands; iter 68 — both arm segments
// rigidly re-anchored at the shoulder, y/z only) and repositions the gloves.
// Those are rendering concerns and deliberately stay out of computePose, so
// the chain-driven segments are excluded from the comparison unconditionally.

const test   = require('node:test');
const assert = require('node:assert');
const { createSim } = require('../golden/harness');
const { computePose } = require('../../engine/core/pose.js');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const sim  = createSim({ search: '' });
const live = sim.ctx;

/** Segments the always-on P13 chain reconciliation rewrites. */
const CHAIN_SEGMENTS = new Set([
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'skiL', 'skiR',
    'head',
]);
/** Arm segments: only y/z are re-anchored (x, rx, rz stay under test). */
const ARM_YZ_SEGMENTS = new Set([
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
]);
function runCase(params) {
    const meshes = live._characterMeshes;
    live.applyPose(
        meshes,
        params.tuck, params.armDropL, params.armDropR, params.armSnap,
        params.layArmT, params.armRaise, params.grounded,
        params.pikeAmount, params.pikeArmDrop,
    );
    const got = computePose(params);
    const segs = require('../../engine/core/body-model.js').SEGMENTS;
    for (const seg of segs) {
        // Chain segments are re-anchored by the renderer's always-on P13 pass.
        if (CHAIN_SEGMENTS.has(seg.name)) continue;

        const mesh = meshes[seg.name];
        if (!mesh || !mesh.position) continue;
        const g = got[seg.name];
        assert.ok(g, `computePose returned nothing for ${seg.name}`);

        const label = (f) => `${seg.name}.${f} with ${JSON.stringify(params)}`;
        if (ARM_YZ_SEGMENTS.has(seg.name)) {
            assert.strictEqual(g.x,  mesh.position.x, label('x'));
            assert.strictEqual(g.rx, mesh.rotation.x, label('rx'));
            assert.strictEqual(g.rz, mesh.rotation.z, label('rz'));
            continue;
        }
        assert.strictEqual(g.x,  mesh.position.x, label('x'));
        assert.strictEqual(g.y,  mesh.position.y, label('y'));
        assert.strictEqual(g.z,  mesh.position.z, label('z'));
        assert.strictEqual(g.rx, mesh.rotation.x, label('rx'));
        assert.strictEqual(g.rz, mesh.rotation.z, label('rz'));
    }
}

test('computePose reproduces live applyPose across the parameter space', () => {
    const rand = mulberry32(0xC0DE);
    for (let i = 0; i < 400; i++) {
        runCase({
            tuck:        rand(),
            armDropL:    rand(),
            armDropR:    rand(),
            armSnap:     rand() < 0.5 ? 0 : rand(),
            layArmT:     rand() < 0.5 ? 0 : rand(),
            armRaise:    rand() < 0.5 ? 0 : rand(),
            grounded:    rand() < 0.3,
            pikeAmount:  rand() < 0.5 ? 0 : rand(),
            pikeArmDrop: rand() < 0.5 ? 0 : rand(),
        });
    }
});

test('computePose matches on the branch boundaries', () => {
    // The three-way branch (grounded / piked / tucked) and every `> 0` guard is
    // a boundary where an extraction can silently pick the wrong table.
    const base = {
        tuck: 0.5, armDropL: 0.5, armDropR: 0.5, armSnap: 0,
        layArmT: 0, armRaise: 0, grounded: false, pikeAmount: 0, pikeArmDrop: 0,
    };
    runCase({ ...base, grounded: true });
    runCase({ ...base, grounded: false });
    runCase({ ...base, pikeAmount: 0 });
    runCase({ ...base, pikeAmount: 1e-9 });      // just over the > 0 guard
    runCase({ ...base, pikeAmount: 1, pikeArmDrop: 0 });
    runCase({ ...base, pikeAmount: 1, pikeArmDrop: 1 });
    runCase({ ...base, armSnap: 1 });
    runCase({ ...base, layArmT: 1 });
    runCase({ ...base, armRaise: 1 });
    runCase({ ...base, armRaise: 1, armDropL: 1, armDropR: 1 });  // raiseT -> 0
    for (const t of [0, 1]) runCase({ ...base, tuck: t, armDropL: t, armDropR: t });
});

test('computePose defaults pikeAmount/pikeArmDrop like the original', () => {
    // The original does `pikeAmount = pikeAmount || 0`. Omitting them entirely
    // must behave as zero, not as undefined leaking into the maths as NaN.
    const p = {
        tuck: 0.4, armDropL: 0.2, armDropR: 0.8, armSnap: 0,
        layArmT: 0, armRaise: 0, grounded: false,
    };
    const got = computePose(p);
    for (const [name, v] of Object.entries(got)) {
        for (const f of ['x', 'y', 'z', 'rx', 'rz']) {
            assert.ok(Number.isFinite(v[f]),
                `${name}.${f} is ${v[f]} — undefined pike params leaked into the maths`);
        }
    }
});

test('computePose is pure — it does not touch the meshes', () => {
    const meshes = live._characterMeshes;
    const before = JSON.stringify(
        Object.keys(meshes).sort().map(k => {
            const m = meshes[k] && meshes[k].position ? meshes[k] : null;
            return m ? [k, m.position.x, m.position.y, m.position.z, m.rotation.x, m.rotation.z] : [k];
        }));
    computePose({
        tuck: 0.9, armDropL: 0.1, armDropR: 0.9, armSnap: 0.5,
        layArmT: 0.5, armRaise: 0.5, grounded: false, pikeAmount: 0.5, pikeArmDrop: 0.5,
    });
    const after = JSON.stringify(
        Object.keys(meshes).sort().map(k => {
            const m = meshes[k] && meshes[k].position ? meshes[k] : null;
            return m ? [k, m.position.x, m.position.y, m.position.z, m.rotation.x, m.rotation.z] : [k];
        }));
    assert.strictEqual(after, before, 'computePose mutated mesh state — it must be pure');
});

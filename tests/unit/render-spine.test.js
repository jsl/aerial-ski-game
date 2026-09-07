'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the production render solver with equivalent rotations. A crash
// can cross the Euler branch cut without changing the athlete's actual pose.
const source = fs.readFileSync(path.join(__dirname, '../../game.js'), 'utf8');
const start = source.indexOf('function updateSpineChain(meshes) {');
const end = source.indexOf('window._spineProbe', start);
const context = vm.createContext({
    Math, window: {}, SPINE_NAMES: ['spine_01', 'spine_02', 'spine_03'],
    TORSO_HALF: 0.275, SPINE_LEN: 0.55 / 3, SPINE_COUPLE: 0.35, SPINE_MAX: 0.35,
    SPINE_BEND_STEP: 0.20,
    _spineRestDeltas: () => ({ low: 0, high: 0 }),
    _wrapPi: a => Math.atan2(Math.sin(a), Math.cos(a)),
    updateJointHelpers: () => null,
});
vm.runInContext(source.slice(start, end), context);
function rig(torso, left, right, head) {
    const node = rx => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: rx, z: 0 } });
    return { torso: node(torso), upperLegL: node(left), upperLegR: node(right),
        head: node(head), spine_01: node(0), spine_02: node(0), spine_03: node(0) };
}
const rad = d => d * Math.PI / 180;
test('crash spine is unchanged when a neighbouring angle wraps through ±180 degrees', () => {
    const before = rig(rad(179), rad(181), rad(179), rad(181));
    const wrapped = rig(rad(179), rad(-179), rad(179), rad(-179));
    const a = context.updateSpineChain(before);
    const b = context.updateSpineChain(wrapped);
    assert.ok(Math.abs(a.dLowDeg - b.dLowDeg) < 1e-10);
    assert.ok(Math.abs(a.dHighDeg - b.dHighDeg) < 1e-10);
    assert.ok(Math.abs(b.dLowDeg) < 1, 'near-parallel thighs must not crumple the lumbar spine');
    assert.ok(Math.abs(b.dHighDeg) < 1, 'near-parallel head must not kink the upper back');
    for (const name of context.SPINE_NAMES) {
        for (const axis of ['x', 'y', 'z']) {
            assert.ok(Math.abs(before[name].position[axis] - wrapped[name].position[axis]) < 1e-10);
        }
    }
});

test('crash spine averages parallel folded thighs across the relative angle branch cut', () => {
    const continuous = rig(0, rad(179), rad(181), 0);
    const wrapped = rig(0, rad(179), rad(-179), 0);
    const a = context.updateSpineChain(continuous);
    const b = context.updateSpineChain(wrapped);
    assert.ok(Math.abs(a.dLowDeg - b.dLowDeg) < 1e-10);
    assert.ok(Math.abs(b.dLowDeg) > 1,
        'parallel folded thighs must retain lumbar flex instead of averaging into straight legs');
});

test('deep squat retains gentle spine curvature without a lumbar angular hinge', () => {
    const meshes = rig(rad(-20), rad(62), rad(62), rad(-8));
    const result = context.updateSpineChain(meshes);
    const angles = context.SPINE_NAMES.map(name => meshes[name].rotation.x);
    assert.ok(Math.abs(angles[1] - angles[0]) <= 0.20 + 1e-10);
    assert.ok(Math.abs(angles[2] - angles[1]) <= 0.20 + 1e-10);
    assert.ok(Math.abs(result.dLowDeg) > 1, 'the spine still flexes with the squat');
    assert.ok(result.step < 0.003, 'hip-to-neck closure must remain within 3 mm per joint');
});

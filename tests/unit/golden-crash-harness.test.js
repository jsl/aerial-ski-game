'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSim } = require('../golden/harness');

function crashToRest(missingFreeze = false, holdRest = true) {
    const sim = createSim({ search: '?world=double', seed: 1 });
    sim.env.ctx._crashWalkoffDisabled = holdRest;
    if (missingFreeze) sim.env.ctx.BABYLON._nodes.get('skierRoot').freezeWorldMatrix = undefined;
    sim.tick(8);
    sim.keyDown('ArrowUp'); sim.tick(2); sim.keyUp('ArrowUp');
    sim.tick(1800);
    return sim.env.ctx;
}

test('golden harness retains the ragdoll through crash rest', () => {
    const win = crashToRest();
    assert.equal(win._crashErr, undefined);
    assert.equal(win._getGameState().crashed, true);
    assert.equal(win._ragdollProbe().resting, true);
});

test('missing root freeze API exposes the old silent crash-render failure', () => {
    const win = crashToRest(true);
    assert.match(win._crashErr, /freezeWorldMatrix is not a function/);
});

test('golden harness runs the default recovery and walk-off without hiding errors', () => {
    const win = crashToRest(false, false);
    assert.equal(win._crashErr, undefined);
    assert.equal(win._walkoffProbe().phase, 'done');
});

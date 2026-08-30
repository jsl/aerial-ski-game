'use strict';
// ── Negative control for the HARD endpoint tear gate (FABLE-80 finding 5 /
// iteration 83). A gate without a negative control is decoration: this proves
// the gate DISCRIMINATES by running the pre-83 POSE_INRUN_TUCK (git 2d1d4b0^)
// through the same endpoint-gap maths the drive gate uses, and asserting it
// FAILS (measured: torso hip 0.140 m off the thigh top, knee 0.049 m), while
// the shipped table passes (every gap <= 8 mm).
//
// Uses the shipped computePose with a substituted model — no hand-copy of the
// solver, only the gap formulas (same convention as applyPose/P13: a
// segment's +Y end sits at position + (h/2)*(cos rx, sin rx) in (y, z)).

const test   = require('node:test');
const assert = require('node:assert');
const { computePose } = require('../../engine/core/pose.js');
const bodyModel = require('../../engine/core/body-model.js');

// POSE_INRUN_TUCK as of 2d1d4b0^ (the torn table).
const OLD_TUCK = {
    torso:     { x:  0.000, y:  0.000, rx: -1.10, rz:  0.00, dz: -0.10 },
    head:      { x:  0.000, y:  0.160, rx: -1.00, rz:  0.00, dz: -0.45 },
    upperArmL: { x: -0.175, y:  0.150, rx: -1.00, rz:  0.00, dz: -0.15 },
    upperArmR: { x:  0.175, y:  0.150, rx: -1.00, rz:  0.00, dz: -0.15 },
    lowerArmL: { x: -0.175, y:  0.150, rx: -1.00, rz:  0.00, dz: -0.30 },
    lowerArmR: { x:  0.175, y:  0.150, rx: -1.00, rz:  0.00, dz: -0.30 },
    upperLegL: { x: -0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },
    upperLegR: { x:  0.075, y: -0.240, rx:  0.85, rz:  0.00, dz:  0.15 },
    lowerLegL: { x: -0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },
    lowerLegR: { x:  0.075, y: -0.490, rx: -0.40, rz:  0.00, dz:  0.05 },
    skiL:      { x: -0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
    skiR:      { x:  0.075, y: -0.660, rx:  0.00, rz:  0.00, dz:  0.00 },
};

function endpointGaps(model) {
    const p = computePose({ tuck: 1, armDropL: 1, armDropR: 1, armSnap: 0,
                            layArmT: 0, armRaise: 0, grounded: true, pikeAmount: 0 },
                          model);
    const dir = (name, h) => {
        const rx = p[name].rx;
        return { top: [p[name].y + h / 2 * Math.cos(rx), p[name].z + h / 2 * Math.sin(rx)],
                 bot: [p[name].y - h / 2 * Math.cos(rx), p[name].z - h / 2 * Math.sin(rx)] };
    };
    const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const t = dir('torso', 0.55), ul = dir('upperLegL', 0.36),
          ll = dir('lowerLegL', 0.36), ua = dir('upperArmL', 0.30),
          la = dir('lowerArmL', 0.25);
    return {
        hip:      gap(t.bot, ul.top),
        knee:     gap(ul.bot, ll.top),
        // The arm's +Y runs toward the WRIST (POSE_UNTUCKED, armSweep,
        // applyGamepadLateral, and the armature's head->tail), so the shoulder
        // is the upper arm's -Y end and the elbow is its +Y end. This read
        // (t.top, ua.top)/(ua.bot, la.top) until the author's 23:40 crouch
        // ruling — the sign matched the two pose tables that were themselves
        // rolled 180 deg out of the bind axis, so a table could close this gate
        // with every arm bone inverted. Same 15 mm limit, opposite ends.
        shoulder: gap(t.top, ua.bot),
        elbow:    gap(ua.top, la.bot),
    };
}

test('negative control: the pre-83 in-run tuck table FAILS the 3x rest-edge tear gate', () => {
    const g = endpointGaps({ ...bodyModel, POSE_INRUN_TUCK: OLD_TUCK });
    const worst = Math.max(g.hip, g.knee, g.shoulder, g.elbow);
    assert.ok(worst > 0.03, `expected the old table to tear, worst gap ${worst.toFixed(4)}`);
    assert.ok(g.hip > 0.10, `expected the old torso hip gap to tear, ${g.hip.toFixed(4)}`);
});
test('shipped in-run tuck table passes the same gate (every gap <= 15 mm; the 3x rest-edge gate allows 30)', () => {
    const g = endpointGaps(bodyModel);
    for (const [k, v] of Object.entries(g)) {
        assert.ok(v <= 0.015, `${k} gap ${v.toFixed(4)} > 15 mm`);
    }
});

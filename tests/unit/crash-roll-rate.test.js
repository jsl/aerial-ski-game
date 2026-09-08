'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../game.js'), 'utf8');
const start = source.indexOf('const _crashLimitRollRates = function');
const end = source.indexOf('function _crashRagdollTick', start);
const context = vm.createContext({ Math, window: {}, _crashLieV4: () => false,
    _crashFloorY: () => -100 });
vm.runInContext(source.slice(start, end) + '\nglobalThis.limit = _crashLimitRollRates;', context);

const hinges = [
    ['neck', 'torsoBottom', 'headTop'],
    ['kneeL', 'hipL', 'ankleL'], ['kneeR', 'hipR', 'ankleR'],
    ['elbowL', 'shL', 'wristL'], ['elbowR', 'shR', 'wristR'],
];
function pose() {
    const points = {};
    hinges.forEach(([joint, a, b], i) => {
        points[joint] = { x: i * 2, y: 1, z: 0 };
        points[a] = { x: i * 2, y: 1.3, z: 0 };
        points[b] = { x: i * 2 + 0.3, y: 1, z: 0 };
    });
    return points;
}
function body(points, age) {
    return { t: age, rollAt: 0,
        parts: Object.entries(points).map(([name, p]) => ({ name, p: { ...p }, r: 0.02 })) };
}
function angle(points, [joint, a, b]) {
    const u = ['x', 'y', 'z'].map(k => points[a][k] - points[joint][k]);
    const v = ['x', 'y', 'z'].map(k => points[b][k] - points[joint][k]);
    return Math.acos(u.reduce((s, x, i) => s + x * v[i], 0) / (Math.hypot(...u) * Math.hypot(...v)));
}

test('late crash hinge correction is bounded; disabling it exposes the same spike', () => {
    const dt = 1 / 120;
    for (const hinge of hinges) {
        const before = pose(), candidate = pose();
        const joint = candidate[hinge[0]], distal = candidate[hinge[2]];
        const turn = 5 * Math.PI / 180;
        distal.x = joint.x + 0.3 * Math.cos(turn);
        distal.y = joint.y + 0.3 * Math.sin(turn);
        for (const disabled of [false, true]) {
            context.window._crashRateLimitDisabled = disabled;
            const R = body(candidate, 2);
            context.limit(R, before, dt);
            const after = Object.fromEntries(R.parts.map(p => [p.name, p.p]));
            const speed = Math.abs(angle(after, hinge) - angle(before, hinge)) / dt * 180 / Math.PI;
            if (disabled) assert.ok(speed > 500, `${hinge[0]} negative control must expose the whip`);
            else assert.ok(speed < 51, `${hinge[0]} must stay below the late rate ceiling`);
        }
    }
    context.window._crashRateLimitDisabled = false;
});

test('crash rate limit preserves ordinary whole-body travel exactly', () => {
    const before = pose(), moved = pose();
    for (const p of Object.values(moved)) { p.x += 0.2; p.y -= 0.1; p.z += 0.3; }
    const R = body(moved, 2);
    context.limit(R, before, 1 / 120);
    for (const part of R.parts) assert.deepEqual(part.p, moved[part.name]);
    assert.equal(R._rateLimit, undefined);
});

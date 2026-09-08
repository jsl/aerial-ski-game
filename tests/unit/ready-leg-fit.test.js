'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../game.js'), 'utf8');
const start = source.indexOf('function _fitReadyUphillLeg(');
const end = source.indexOf('function _seatTorsoOnHips(', start);
const ctx = vm.createContext({ Math, BASE_Z: { upperLegL: .008, upperLegR: -.008 } });
vm.runInContext(source.slice(start, end) + '\nthis.fit = _fitReadyUphillLeg;', ctx);
const endPoint = (m, distance) => ({ x: m.position.x - distance * Math.sin(m.rotation.z),
    y: m.position.y + distance * Math.cos(m.rotation.z) * Math.cos(m.rotation.x),
    z: m.position.z + distance * Math.cos(m.rotation.z) * Math.sin(m.rotation.x) });
function fixture(height, up) {
    const m = {};
    for (const side of ['L','R']) {
        const y = side === up ? height : 0, z = side === 'L' ? .008 : -.008;
        const part = h => ({ position: { x: side === 'L' ? -.075 : .075, y: y + h, z }, rotation: { x: 0, y: 0, z: 0 } });
        m['ski' + side] = part(0); m['lowerLeg' + side] = part(.18); m['upperLeg' + side] = part(.54);
    }
    return m;
}
test('uphill fit keeps pinned ankles and closed joints while levelling the hips', () => {
    for (const up of ['L','R']) for (const height of [.02,.06,.10]) {
        const m = fixture(height, up), ankle = endPoint(m['lowerLeg' + up], -.18);
        const skis = JSON.stringify([m.skiL, m.skiR]);
        ctx.fit(m, 1);
        const actualAnkle = endPoint(m['lowerLeg' + up], -.18);
        const shinTop = endPoint(m['lowerLeg' + up], .18), thighBottom = endPoint(m['upperLeg' + up], -.18);
        const leftHip = endPoint(m.upperLegL, .18), rightHip = endPoint(m.upperLegR, .18);
        for (const key of ['x','y','z']) {
            assert.ok(Math.abs(actualAnkle[key] - ankle[key]) < 1e-9);
            assert.ok(Math.abs(shinTop[key] - thighBottom[key]) < 1e-9);
        }
        assert.ok(Math.abs(leftHip.y - rightHip.y) < 1e-9);
        assert.ok(Math.abs(leftHip.z - rightHip.z - .016) < 1e-9);
        assert.equal(JSON.stringify([m.skiL, m.skiR]), skis);
    }
});
test('terrain stance fades continuously without changing an unweighted pose', () => {
    const m = fixture(.06, 'L'), before = JSON.stringify(m);
    ctx.fit(m, 0); assert.equal(JSON.stringify(m), before);
    const ankle = endPoint(m.lowerLegL, -.18), prior = { ...m.upperLegL.position };
    ctx.fit(m, 1e-5);
    assert.ok(Math.hypot(...['x','y','z'].map(k => m.upperLegL.position[k] - prior[k])) < 1e-5);
    for (const k of ['x','y','z']) assert.ok(Math.abs(endPoint(m.lowerLegL, -.18)[k] - ankle[k]) < 1e-9);
});

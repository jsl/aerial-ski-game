'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../game.js'), 'utf8');
const start = source.indexOf('function _graspTuckKnees(');
const end = source.indexOf('// ── Gamepad lateral arm correction', start);
const context = vm.createContext({ Math });
vm.runInContext(source.slice(start, end), context);
function rig() {
    const node = (x,y,z,rx,rz) => ({ position: {x,y,z}, rotation: {x:rx,y:0,z:rz} });
    return { upperArmL: node(-.13,.0763364,-.1488201,-2.070612,-.12),
        lowerArmL: node(-.07,-.0200636,-.1579201,1.77382,-.12),
        upperLegL: node(-.0655795,-.0964356,.0113539,2.8916,-Math.PI/60) };
}
const endPoint = (m,h) => [m.position.x-h*Math.sin(m.rotation.z),
    m.position.y+h*Math.cos(m.rotation.z)*Math.cos(m.rotation.x),
    m.position.z+h*Math.cos(m.rotation.z)*Math.sin(m.rotation.x)];
const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
test('flight grasp preserves the anatomical shoulder and closes both physical arm segments', () => {
    const m=rig(), shoulder=endPoint(m.upperArmL,-.15);
    context._graspTuckKnees(m,1,0);
    assert.ok(distance(shoulder,endPoint(m.upperArmL,-.15))<1e-10);
    assert.ok(distance(endPoint(m.upperArmL,.15),endPoint(m.lowerArmL,-.125))<1e-10);
    assert.ok(Math.abs(distance(endPoint(m.lowerArmL,.125),endPoint(m.upperLegL,-.18))-.025)<1e-10);
});
test('flight grasp begins continuously and leaves pure pike articulation unchanged', () => {
    const original=rig(), tiny=rig(), pike=rig();
    context._graspTuckKnees(tiny,1e-5,0);
    context._graspTuckKnees(pike,1,1);
    assert.deepEqual(pike,original);
    for(const n of ['upperArmL','lowerArmL']) {
        assert.ok(distance(Object.values(tiny[n].position),Object.values(original[n].position))<1e-8);
        assert.ok(Math.abs(tiny[n].rotation.x-original[n].rotation.x)<1e-8);
    }
});

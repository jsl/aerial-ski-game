// ── ADR-0005 display-only audit ─────────────────────────────────────────────
//
//   node tests/golden/audit-physics-state.js
//
// Replays every scenario against the CURRENT tree and compares ONLY the physics
// `state` object with the stored traces, frame by frame, with Object.is — no
// epsilon. Prints, per scenario, how many frames differ in the DISPLAY nodes.
//
// This is the evidence a display-only trace re-capture needs. verify.js reports
// the first few diffs per scenario and stops, so it cannot tell "the athlete is
// drawn differently" from "the simulation changed"; this can. Exit 0 means every
// physics field in every frame is byte-identical and any re-capture is
// display-only, which is the standing condition on re-capturing traces
// (reviewer, 2026-08-29 17:05; same audit shape as iterations 33 and 67).
//
// Run it BEFORE tests/golden/capture.js, and quote the numbers.
'use strict';
const fs=require('node:fs'), path=require('node:path');
const ROOT=path.resolve(__dirname, "..", "..");
const { scenarios } = require(path.join(ROOT,'tests/golden/scenarios'));
const { runScenario } = require(path.join(ROOT,'tests/golden/run-scenario'));
const DIR=path.join(ROOT,'tests/golden/traces');
let bad=0, frames=0, scen=0, nodeChanged=0;
for (const sc of scenarios) {
    const f=path.join(DIR, sc.name+'.json');
    if(!fs.existsSync(f)) { console.log('MISSING', sc.name); bad++; continue; }
    const want=JSON.parse(fs.readFileSync(f,'utf8'));
    const got=runScenario(sc);
    scen++;
    if (want.frames.length!==got.frames.length){console.log('FRAMECOUNT',sc.name);bad++;continue;}
    let sDiff=0, nDiff=0;
    for(let i=0;i<want.frames.length;i++){
        const a=want.frames[i].state, b=got.frames[i].state;
        frames++;
        const ka=Object.keys(a||{}), kb=Object.keys(b||{});
        if(ka.length!==kb.length){sDiff++;continue;}
        for(const k of ka){
            if(!Object.is(a[k],b[k])){ if(sDiff<3) console.log('  STATE',sc.name,'f'+i,k,a[k],'->',b[k]); sDiff++; }
        }
        if(JSON.stringify(want.frames[i].nodes)!==JSON.stringify(got.frames[i].nodes)) nDiff++;
    }
    if(nDiff) nodeChanged++;
    if(sDiff){bad++;console.log('STATE DIFF',sc.name,sDiff);}
    console.log((sDiff?'PHYS-RED ':'phys-ok  ')+sc.name.padEnd(34)+' stateDiffs '+sDiff+'  frames-with-node-changes '+nDiff+'/'+want.frames.length);
}
console.log('\n'+scen+' scenarios, '+frames+' frames compared; scenarios with ANY physics-state difference: '+bad);
console.log('scenarios with display-node differences: '+nodeChanged);
process.exit(bad?1:0);

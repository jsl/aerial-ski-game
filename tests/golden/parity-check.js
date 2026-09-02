'use strict';
// GAME-LOGIC INVARIANT 4 (author, 2026-09-02): after a display-node recapture,
// the PHYSICS/STATE fields of every golden trace must be identical to the
// committed traces. This prints the max |delta| per scenario for the state
// fields (spinAngle, tuckAmount, flipPower, posZ, airTime, grounded, crashed)
// comparing the working-tree traces against `git show HEAD:...`, and exits 1
// on any difference. Run it AFTER capture.js and BEFORE committing traces.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = path.join(__dirname, 'traces');
const FIELDS = ['spinAngle', 'tuckAmount', 'flipPower', 'posZ', 'airTime', 'grounded', 'crashed'];
let bad = 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const work = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    let head;
    try {
        head = JSON.parse(execFileSync('git', ['show', `HEAD:tests/golden/traces/${file}`],
            { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 1 << 28 }));
    } catch (e) { console.log(`SKIP   ${file} (not in HEAD)`); continue; }
    const wf = work.frames || [], hf = head.frames || [];
    const n = Math.min(wf.length, hf.length);
    const maxd = {}; let firstBad = null;
    for (const k of FIELDS) maxd[k] = 0;
    for (let i = 0; i < n; i++) {
        const a = wf[i].state || {}, b = hf[i].state || {};
        for (const k of FIELDS) {
            const da = typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) : (a[k] === b[k] ? 0 : 1);
            if (da > maxd[k]) { maxd[k] = da; if (da > 1e-9 && firstBad === null) firstBad = `${k}@f${wf[i].f}`; }
        }
    }
    const worst = Math.max(...Object.values(maxd));
    const ok = worst <= 1e-9 && wf.length === hf.length;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}   ${file.padEnd(40)} frames ${wf.length}/${hf.length} ` +
        FIELDS.map(k => `${k}=${maxd[k].toExponential(1)}`).join(' ') + (firstBad ? `  first: ${firstBad}` : ''));
}
console.log(bad ? `\n${bad} scenario(s) changed physics/state fields — invariant 4 VIOLATED` : '\nstate parity holds for every scenario');
process.exit(bad ? 1 : 0);

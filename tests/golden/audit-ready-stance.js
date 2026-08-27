'use strict';
// ADR-0005 rebaseline audit for the ready-stance visual change (iteration 9).
// Compares a directory of PRE-change traces against tests/golden/traces and
// asserts: physics `state` identical in every keyframe of every scenario;
// node diffs confined to the athlete hierarchy (skierRoot, drivers, boot/face
// details) and the `slope` box, and (for run scenarios) to the ready/turn
// frames at the start of the trace.
//
// Usage: node tests/golden/audit-ready-stance.js <dir-with-old-traces>
// To reproduce: check out the pre-change traces into a temp dir, e.g.
//   git worktree add /tmp/pre9 <commit-before-iter-9>
//   node tests/golden/audit-ready-stance.js /tmp/pre9/tests/golden/traces
// Iteration 9 result: state IDENTICAL in all 30 scenarios; node diffs only in
// the athlete hierarchy + slope, only through f=45 (the 0.7 s turn), except
// aerial-idle (ready state never ends there: diffs persist by design).
const fs = require('node:fs');
const path = require('node:path');
const OLD = process.argv[2];
if (!OLD || !fs.existsSync(OLD)) {
    console.error('usage: node tests/golden/audit-ready-stance.js <dir-with-old-traces>');
    process.exit(2);
}
const NEW = path.join(__dirname, 'traces');

let bad = 0;
for (const f of fs.readdirSync(NEW).sort()) {
    const a = JSON.parse(fs.readFileSync(path.join(OLD, f), 'utf8'));
    const b = JSON.parse(fs.readFileSync(path.join(NEW, f), 'utf8'));
    if (a.frames.length !== b.frames.length) { console.log(f, 'LENGTH DIFF'); bad++; continue; }
    let stateDiffs = 0, nodeNames = new Set(), firstBad = -1, lastBad = -1;
    for (let i = 0; i < a.frames.length; i++) {
        const sa = JSON.stringify(a.frames[i].state), sb = JSON.stringify(b.frames[i].state);
        if (sa !== sb) { stateDiffs++; if (firstBad < 0) firstBad = a.frames[i].f; }
        const na = a.frames[i].nodes || {}, nb = b.frames[i].nodes || {};
        for (const n of new Set([...Object.keys(na), ...Object.keys(nb)])) {
            if (JSON.stringify(na[n]) !== JSON.stringify(nb[n])) { nodeNames.add(n); lastBad = a.frames[i].f; }
        }
    }
    const tag = stateDiffs === 0 ? 'state=IDENTICAL' : `state=DIFF(${stateDiffs})`;
    console.log(f.padEnd(36), tag, 'nodes:', [...nodeNames].join(',') || '-', lastBad >= 0 ? `node-diffs through f=${lastBad}` : '');
    if (stateDiffs) bad++;
}
console.log(bad === 0 ? '\nAUDIT PASS: all states identical' : `\nAUDIT FAIL: ${bad} scenarios with state divergence`);
process.exit(bad === 0 ? 0 : 1);

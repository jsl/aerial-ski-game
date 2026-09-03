'use strict';
// ── Asset-cache tag parity ──────────────────────────────────────────────────
// game.js declares `const ASSET_V = "?v=N"` and index.html preloads the same
// assets with literal `?v=N` tags. They must ALWAYS match: when only one is
// bumped, index.html preloads stale assets (the 272 "stale-tag chimera") or
// the browser cache defeats the rebuild (289 shipped ?v=102 in game.js only).
// Reviewer ruling on 289: this parity is a red build on mismatch.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('index.html ?v= tags match game.js ASSET_V', () => {
    const game = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const m = game.match(/const\s+ASSET_V\s*=\s*"\?v=(\d+)"/);
    assert.ok(m, 'game.js must declare const ASSET_V = "?v=<n>"');
    const tag = m[1];

    // Every literal ?v= tag in index.html (preloads, script/src/cache hints)
    // must carry exactly the shipped version.
    const tags = [...html.matchAll(/\?v=(\d+)/g)].map(m2 => m2[1]);
    assert.ok(tags.length > 0, 'index.html must contain at least one ?v= tag');
    for (const t of tags) {
        assert.strictEqual(t, tag,
            `index.html has ?v=${t} but game.js ASSET_V is ?v=${tag} — bump BOTH tag files in the ship commit`);
    }
});

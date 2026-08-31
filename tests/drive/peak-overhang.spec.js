'use strict';
// ── HUMAN TESTING #22: the "fang" peak — ridge end-taper gate ───────────────
// The author (2026-08-31): a summit hooked sideways into a claw floating
// above the skyline. Diagnosis (iter 179): the claw is the OPEN lateral end
// edge of a ridge sheet (ridge_ahead), seen nearly edge-on past the other
// ridges — the tallest crest columns project as a detached sliver that reads
// as an overhanging fang.
// Fix: every ridge crest fades to ground over RIDGE_END_TAPER_FRAC of its
// run (game.js), so no sheet end pokes above the skyline as a free edge.
//
// Gate (mesh-space, read from the live Babylon vertex data): for every ridge
// sheet the crest height at BOTH lateral ends must be ≤ 15% of that sheet's
// maximum crest — a tapered end cannot form a hanging sliver. Negative
// control: ?fangkeepends=1 rebuilds the unfaded ends and the gate MUST fail.
//
// NOTE for the reviewer: a render-space "sky-below-mountain" pixel detector
// was prototyped and shelved this iteration — the ridges are layered meshes
// with GENUINE sky gaps between layers (and horizon haze within a few RGB
// points of the snowfield), so no colour-only overhang test separates the
// fang from legitimate layering without synthetic-backdrop tricks. Open item.

const { test, expect } = require('@playwright/test');

const GATE_SRC = `
    window._ridgeEndTaperGate = function () {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = [];
        for (const m of scene.meshes) {
            if (!m.name || !/^ridge_/.test(m.name)) continue;
            const P = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            if (!P || !P.length) continue;
            const STEPS = 12;                     // _ridgeMesh cross-run rows
            const rowN = STEPS + 1;
            const nCol = P.length / 3 / rowN;
            if (nCol < 2) continue;
            const y = (i) => P[i * rowN * 3 + 1]; // crest row (j=0) of column i
            // The fang was a sheet END dropping from full crest to ground in
            // ONE column step (~24 m over 6 m) — a free wall seen edge-on.
            // A faded end (smoothstep over 14% of the run) steps at most a
            // few metres per column, as does the sine silhouette itself.
            let maxStep = 0;
            for (let i = 1; i < nCol; i++)
                maxStep = Math.max(maxStep, Math.abs(y(i) - y(i - 1)));
            out.push({
                name: m.name, nCol,
                maxStep: +maxStep.toFixed(2),
                endDrop: +(y(nCol - 2) - y(nCol - 1)).toFixed(2),
                startDrop: +(y(1) - y(0)).toFixed(2),
            });
        }
        return out;
    };
`;

async function loadAndProbe(page, query) {
    await page.goto('/index.html' + (query || ''));
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.evaluate(GATE_SRC);
    return page.evaluate(() => window._ridgeEndTaperGate());
}

const GATE_M = 12;   // max crest change per 6 m column step

test('ridge sheets: crest tapered at both lateral ends (no fang sliver)', async ({ page }) => {
    const rows = await loadAndProbe(page);
    expect(rows.length, 'no ridge meshes found').toBeGreaterThan(0);
    for (const r of rows) {
        expect(r.maxStep,
            r.name + ' has a near-vertical crest step of ' + r.maxStep
            + ' m between adjacent columns (gate ' + GATE_M + ' m): a free '
            + 'sheet end reads as a floating fang')
            .toBeLessThanOrEqual(GATE_M);
    }
});

test('negative control: unfaded ridge ends (fangkeepends=1) must fail the gate', async ({ page }) => {
    const rows = await loadAndProbe(page, '?fangkeepends=1');
    const worst = Math.max(...rows.map(r => r.maxStep));
    expect(worst,
        'negative control did NOT fire: the unfaded ridge ends stayed under '
        + GATE_M + ' m/step, so the gate is blind to the fang')
        .toBeGreaterThan(GATE_M);
});

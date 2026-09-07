'use strict';
const { test, expect } = require('@playwright/test');

// Measure the delivered, skinned sole rather than assuming an ankle point
// implies a ski-parallel foot. That assumption hid the tuck heel lift.
async function soleGaps(page, phase, tuck, sabotage = false) {
    return page.evaluate(({ phase, tuck, sabotage }) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.onBeforeRenderObservable.addOnce(() => {
            if (phase === 'ground' || phase === 'inrun') window._inrunHold(tuck, phase === 'ground' ? 1 : 0);
            else window._airHold(phase === 'pike' ? 0 : tuck, phase === 'pike' ? tuck : 0);
            if (sabotage) {
                for (const m of scene.meshes.filter(m => m.name.startsWith('athleteBoot'))) {
                    if (sabotage === 'slide') m.position.z += 0.03;
                    else m.position.y += 0.03;
                }
            }
        });
        scene.render();
        const result = {};
        for (const side of ['L', 'R']) {
            const ski = scene.getMeshByName('ski' + side);
            ski.computeWorldMatrix(true);
            const inverse = ski.getWorldMatrix().clone().invert();
            const points = [];
            for (const boot of scene.meshes.filter(m => m.name.startsWith('athleteBoot' + side) && m.material?.name === 'bootSole')) {
                const raw = boot.getVerticesData(BABYLON.VertexBuffer.PositionKind);
                let bottom = Infinity;
                for (let i = 1; i < raw.length; i += 3) bottom = Math.min(bottom, raw[i]);
                const positions = boot.getPositionData(true, true);
                boot.computeWorldMatrix(true);
                const matrix = boot.getWorldMatrix();
                for (let i = 0; i < raw.length; i += 3) {
                    if (raw[i + 1] > bottom + 0.002) continue;
                    const world = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.FromArray(positions, i), matrix);
                    const p = BABYLON.Vector3.TransformCoordinates(world, inverse);
                    points.push(p);
                }
            }
            if (!points.length) throw new Error('Missing rendered boot sole ' + side);
            const z0 = Math.min(...points.map(p => p.z)), z1 = Math.max(...points.map(p => p.z));
            const end = (toe) => points.filter(p => toe ? p.z < z0 + 0.015 : p.z > z1 - 0.015);
            const meanGap = ps => ps.reduce((sum, p) => sum + p.y - 0.015, 0) / ps.length;
            const station = ps => ['x', 'z'].map(axis => ps.reduce((sum, p) => sum + p[axis], 0) / ps.length);
            result[side] = { toe: meanGap(end(true)), heel: meanGap(end(false)),
                toeStation: station(end(true)), heelStation: station(end(false)), n: points.length };
        }
        return result;
    }, { phase, tuck, sabotage });
}

test('rendered toe and heel remain seated throughout ground tuck, aerial tuck and pike', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0);
    await page.waitForTimeout(500);
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().stopRenderLoop());
    const rows = [];
    for (const phase of ['ground', 'inrun', 'air', 'pike']) {
        for (const tuck of [0, 0.001, 0.002, 0.05, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
            rows.push({ phase, tuck, gaps: await soleGaps(page, phase, tuck) });
        }
    }
    require('fs').writeFileSync(test.info().outputPath('boot-sole.json'), JSON.stringify(rows));
    const gaps = rows.flatMap(row => Object.values(row.gaps).flatMap(p => [Math.abs(p.toe), Math.abs(p.heel)]));
    console.log('RENDERED-SOLE', JSON.stringify({ samples: rows.length, maxGapMM: Math.max(...gaps) * 1000 }));
    for (const row of rows) for (const side of ['L', 'R']) for (const end of ['toe', 'heel']) {
        expect(Math.abs(row.gaps[side][end]), `${row.phase} tuck=${row.tuck} ${side} ${end} gap`).toBeLessThanOrEqual(0.005);
        const station = row.gaps[side][end + 'Station'], ref = rows[0].gaps[side][end + 'Station'];
        expect(Math.hypot(...station.map((v, i) => v - ref[i])),
            `${row.phase} tuck=${row.tuck} ${side} ${end} slides off its mounting station`).toBeLessThanOrEqual(0.003);
    }
    const bad = await soleGaps(page, 'ground', 1, true);
    expect(Math.max(...Object.values(bad).flatMap(p => [Math.abs(p.toe), Math.abs(p.heel)])), 'reject a rendered sole lifted 3 cm').toBeGreaterThan(0.02);
    const slid = await soleGaps(page, 'ground', 0, 'slide');
    const ref = rows[0].gaps.L.toeStation;
    expect(Math.hypot(...slid.L.toeStation.map((v, i) => v - ref[i])),
        'reject a rendered sole sliding 3 cm along the ski').toBeGreaterThan(0.02);
});

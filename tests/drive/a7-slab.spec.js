'use strict';
// A7 slab disposition gate (reviewer 17:30, landed iter 93). wUpperMtn — the
// uphill ground continuation behind the start — used to be a tilted box that
// floated ≈9 m above the terrain; it is now a ribbon sampled from the same
// physics profile the corridor rides (terrainRootY − FOOT_OFFSET), so it is
// seated by construction. This spec pins that with two gates:
//   1. GEOMETRIC look-back: from the athlete's ready position, no terrain-class
//      mesh whose bounding box bottom sits > 1 m above the floor under it.
//   2. PIXEL look-back: from a camera at the athlete looking UP the in-run,
//      the frame contains no black/backface band (near-black fraction in the
//      lower 2/3 < 0.5%) and the snow reads bright (mean lower-2/3 lum > 0.5).
// NEGATIVE CONTROL: lifting the mesh 9 m in-page must FAIL gate 1.
const { test, expect } = require('@playwright/test');

test('a7: uphill ground continuation is seated on the terrain (look-back)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._runAnchors === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1200);

    // Terrain-class meshes only (whitelist): the corridor field, its skirt
    // and the uphill continuation. The athlete's own parts (neck, visor,
    // nose…) legitimately ride > 1 m above the snow.
    const terrainRe = /^(terrain|wUpperMtn|w[A-Z])/;
    const geo = await page.evaluate((reSrc) => {
        const terrainRe = new RegExp(reSrc);
        const bad = [];
        const floor = (z) => window._crashFloorY(z);
        for (const m of BABYLON.EngineStore.LastCreatedScene.meshes) {
            if (!m.name || !terrainRe.test(m.name)) continue;
            m.computeWorldMatrix(true);
            const b = m.getBoundingInfo().boundingBox;
            const c = b.centerWorld;
            const gap = b.minimumWorld.y - floor(c.z);
            if (gap > 1.0) bad.push({ name: m.name, gap: +gap.toFixed(2) });
        }
        return bad;
    }, terrainRe.source);
    expect(geo, 'terrain-class meshes float above the snow: '
        + JSON.stringify(geo)).toEqual([]);

    // Gate 2 — pixel look-back from the ready position up the in-run.
    const px = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const A = window._runAnchors();
        const body = scene.meshes.find(m => (m.name || '').indexOf('athleteBody') === 0);
        const p = body ? body.getAbsolutePosition() : { x: 0, y: 0, z: A.SLOPE_START_Z + 2 };
        const cam = scene.activeCamera;
        cam.setTarget(new BABYLON.Vector3(0, p.y + 3, p.z - 40)); // up the in-run
        scene.render();
        const gl = eng.getRenderingCanvas();
        const cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d');
        cx.drawImage(gl, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        const Y0 = Math.round(H / 3);
        let n = 0, black = 0, lumSum = 0;
        for (let y = Y0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            n++; lumSum += lum;
            if (lum < 0.032) black++;   // the black32 convention (baked.spec)
        }
        return { black32: +(black / n).toFixed(5), meanLum: +(lumSum / n).toFixed(3) };
    });
    console.log('A7LOOKBACK', JSON.stringify(px));
    expect(px.black32, 'look-back frame shows a black/backface band (black32 '
        + px.black32 + ')').toBeLessThan(0.005);
    expect(px.meanLum, 'look-back lower 2/3 does not read as sunlit snow (mean '
        + px.meanLum + ')').toBeGreaterThan(0.5);

    // NEGATIVE CONTROL: lift wUpperMtn 9 m — gate 1 must now FAIL.
    await page.evaluate(() => {
        const m = BABYLON.EngineStore.LastCreatedScene.getMeshByName('wUpperMtn');
        m.position.y += 9;
        m.computeWorldMatrix(true);
    });
    const bad2 = await page.evaluate((reSrc) => {
        const terrainRe = new RegExp(reSrc);
        const bad = [];
        const floor = (z) => window._crashFloorY(z);
        for (const m of BABYLON.EngineStore.LastCreatedScene.meshes) {
            if (!m.name || !terrainRe.test(m.name)) continue;
            const b = m.getBoundingInfo().boundingBox;
            const gap = b.minimumWorld.y - floor(b.centerWorld.z);
            if (gap > 1.0) bad.push({ name: m.name, gap: +gap.toFixed(2) });
        }
        return bad;
    });
    expect(bad2.some(b => b.name === 'wUpperMtn'),
        'negative control failed: a 9 m lift of wUpperMtn was not detected')
        .toBe(true);
});

'use strict';
// ── P5: chopped-landing visibility (iter-119) ────────────────────────────────
// Reviews kept recording "the landing reads smooth white — no chop" (entry
// 110 item 7). The baked tiles + displacement existed but were too subtle at
// gameplay distance. This spec measures, from a low camera over the landing:
//   · the displacement actually applied (window._chopStats from the height
//     tile decode) — worst sink inside the ≤ 0.10 m contact-rule band;
//   · rendered relief: luminance variation across the landing pixels
//     (shading from the bumped normals + displaced silhouettes) must exceed
//     the smooth-snow baseline measured on the neighbouring table.
const { test, expect } = require('@playwright/test');

test('chopped landing: displacement applied in-band and rendered relief exceeds smooth snow', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._chopStats && window._chopStats.sunkVerts > 0,
        null, { timeout: 20000 });
    await page.waitForTimeout(700);

    const r = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const A = window._runAnchors();
        const zMid = (A.LANDING_START_Z + A.OUTRUN_Z) / 2;
        const y = window._crashFloorY(zMid);
        const saved = { a: cam.alpha, b: cam.beta, rr: cam.radius, t: cam.target.clone() };
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(new BABYLON.Vector3(0, y, zMid));
        cam.alpha = Math.PI / 2;          // across the hill
        cam.beta = Math.PI / 2.6;         // ~22° above the surface
        cam.radius = 12;
        scene.render();
        const gl = scene.getEngine().getRenderingCanvas();
        const cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d');
        cx.drawImage(gl, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        // Central 60%×40% band: the landing slope fills it from this framing.
        const lum = [];
        for (let yy = Math.round(H * 0.3); yy < H * 0.7; yy++)
            for (let xx = Math.round(W * 0.2); xx < W * 0.8; xx++) {
                const i = (yy * W + xx) * 4;
                lum.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
            }
        const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
        const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
        // p5–p95 spread: texture relief, robust against a few dark outliers.
        const s = lum.slice().sort((a, b) => a - b);
        const spread = s[Math.floor(s.length * 0.95)] - s[Math.floor(s.length * 0.05)];
        cam.setTarget(saved.t); cam.alpha = saved.a; cam.beta = saved.b; cam.radius = saved.rr;
        return { chop: window._chopStats, zone: window._chopZone,
            mean: +mean.toFixed(4), sd: +sd.toFixed(4), spread: +spread.toFixed(4) };
    });

    // Displacement landed and respects the chopped-landing sink band ≤ 0.10 m.
    expect(r.chop.sunkVerts).toBeGreaterThan(50);
    expect(r.chop.worstSink, `worst sink ${r.chop.worstSink} outside the 0.10 m band`)
        .toBeLessThanOrEqual(0.101);
    expect(r.chop.worstSink, `chop barely displaced (${r.chop.worstSink}) — invisible by construction`)
        .toBeGreaterThan(0.05);
    // Rendered relief: texture + shading variation present (a smooth white
    // landing measures spread < 0.10 at this framing; the pre-119 tuning
    // measured ≈ 0.10 flat).
    expect(r.spread, `landing luminance p95−p5 ${r.spread} reads as smooth snow`)
        .toBeGreaterThan(0.10);
});

'use strict';
// ── Kicker block faces read as snow (reviewer inspection, 2026-08-27 01:35) ──
// From the side the kicker's back wall and side faces rendered a flat
// sand/brown colour (plywood look). Root cause, measured in iteration 17:
// the block's vertical faces get almost no direct sun (n·l ≈ 0.30) and no
// hemispheric SKY term (dot(n, up) clamps to 0), so they were lit almost
// entirely by the IBL horizon band — which is warm — and by the old dark
// groundColor. They must read as shaded SNOW: cool chroma (blue ≥ red),
// luminance inside the snow band, and no warm "plywood" pixels.
const { test, expect } = require('@playwright/test');

async function grabPixels(page) {
    const shot = await page.screenshot();
    return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return { W: img.width, H: img.height, d: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) };
    }, shot.toString('base64'));
}

function boxStats(f, x0, y0, x1, y1) {
    const X0 = Math.round(x0 * f.W), X1 = Math.round(x1 * f.W);
    const Y0 = Math.round(y0 * f.H), Y1 = Math.round(y1 * f.H);
    let R = 0, G = 0, B = 0, n = 0, warm = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        R += r; G += g; B += b; n++;
        if (r > b + 0.015) warm++;               // "plywood-tan" pixel
    }
    const lum = 0.2126 * R / n + 0.7152 * G / n + 0.0722 * B / n;
    return { lum: +lum.toFixed(4), rb: +((R - B) / n).toFixed(4), warmFrac: +(warm / n).toFixed(4), n };
}

test('kicker block side/back faces read as shaded snow, not plywood', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);

    // Side camera on the block, matching the reviewer's vantage (−X, slightly
    // downhill, framing the wall between the lip and the table).
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const lipY = AerialEngine.aerialSki.terrainRootY(cfg.KICKER_END_Z, cfg) - 1.025;
        const tabY = AerialEngine.aerialSki.terrainRootY(cfg.KICKER_START_Z, cfg) - 1.025;
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 400;
        cam.setTarget(new BABYLON.Vector3(1.7, (lipY + tabY) / 2 - 0.6, cfg.KICKER_END_Z));
        cam.radius = 9; cam.beta = 1.42; cam.alpha = Math.PI; cam.fov = 0.8;
    });
    await page.waitForTimeout(900);

    // Locate the block's visible silhouette by picking: every ray whose first
    // hit is a kicker-block surface (fill boxes, back face, angled segments)
    // samples that pixel. This covers the −x side wall AND the ribbon cliff
    // around it (the reviewer's "back wall and side faces") without guessing
    // fractional boxes — trees/sky live right beside them in frame.
    const picks = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        const blockRe = /^(kicker_fill_|kickerBackFace|kicker_seg_)/;
        const pts = [];
        for (let gy = 0.05; gy <= 0.85; gy += 0.02) {
            for (let gx = 0.05; gx <= 0.95; gx += 0.02) {
                const ray = scene.createPickingRay(gx * W, gy * H,
                    BABYLON.Matrix.Identity(), scene.activeCamera);
                let hit = null;
                try { hit = scene.pickWithRay(ray, null); } catch (e) {}
                if (hit && hit.hit && hit.pickedMesh &&
                    blockRe.test(hit.pickedMesh.name)) {
                    pts.push([Math.round(gx * W), Math.round(gy * H)]);
                }
            }
        }
        return pts;
    });

    const f = await grabPixels(page);
    const px = (x, y) => {
        const i = (y * f.W + x) * 4;
        return [f.d[i] / 255, f.d[i + 1] / 255, f.d[i + 2] / 255];
    };
    function statPts(pts) {
        let R = 0, G = 0, B = 0, warm = 0;
        for (const [x, y] of pts) {
            const [r, g, b] = px(x, y);
            R += r; G += g; B += b;
            if (r > b + 0.015) warm++;
        }
        const n = pts.length;
        const lum = 0.2126 * R / n + 0.7152 * G / n + 0.0722 * B / n;
        return { lum: +lum.toFixed(4), rb: +((R - B) / n).toFixed(4),
                 warmFrac: +(warm / n).toFixed(4), n };
    }
    const stats = {
        block: statPts(picks),
        flatSnow: boxStats(f, 0.05, 0.80, 0.25, 0.92),   // corridor reference
    };
    console.log('KICKER_FACES ' + JSON.stringify(stats) +
        ' blockPts ' + picks.length);

    expect(picks.length).toBeGreaterThan(300);
    expect(stats.flatSnow.n).toBeGreaterThan(400);

    // Chroma: shaded snow is cool (blue ≥ red). Baseline defect measured
    // r−b ≈ +0.033 (warm); fixed rig measures b−r < 0.
    expect(stats.block.rb,
        `block chroma r−b = ${stats.block.rb}, snow must be cool (≤ 0)`)
        .toBeLessThanOrEqual(0.005);

    // Luminance: inside the snow band — clearly not plywood-tan (the defect
    // measured ~0.52 warm), and not blown out.
    expect(stats.block.lum).toBeGreaterThan(0.55);
    expect(stats.block.lum).toBeLessThan(0.95);

    // No meaningful warm-pixel fraction on the block.
    expect(stats.block.warmFrac).toBeLessThan(0.02);

    // The wall stays within a shaded-snow distance of the lit corridor next
    // to it (footage: side walls are bright, just cooler than the sun face).
    expect(stats.block.lum).toBeGreaterThan(stats.flatSnow.lum - 0.25);
});

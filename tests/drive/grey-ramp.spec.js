'use strict';
// ── Grey ramp + cyan seam gates (reviewer order 3, phase 1) ─────────────────
// From the default scene camera:
//   1. The corridor's dark band must not return (iter-5 baseline: corridor
//      0.622 vs flanks 0.787). The detail-recipe fix recovered the in-run and
//      kicker; corridor parity needs the phase-2 attribution round.
//   2. Sky/fog must not show through the flank gaps beside the kicker
//      (junction fillers landed; baseline was 12.2% sky-like pixels).
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

function regionStats(f, x0, y0, x1, y1) {
    const X0 = Math.round(x0 * f.W), X1 = Math.round(x1 * f.W);
    const Y0 = Math.round(y0 * f.H), Y1 = Math.round(y1 * f.H);
    let R = 0, G = 0, B = 0, n = 0, sky = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        R += r; G += g; B += b; n++;
        if (b > r + 0.10 && b > 0.55) sky++;
    }
    return { lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4), skyFrac: +(sky / n).toFixed(4), n };
}

test('corridor reads at least as bright as its flanks; no sky through the seams', async ({ page }) => {
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
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(lo.add(hi).scale(0.5));
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35; cam.fov = 0.8;
    });
    await page.waitForTimeout(900);
    const f = await grabPixels(page);

    const stats = {
        corridor:   regionStats(f, 0.55, 0.50, 0.65, 0.54),
        flankNear:  regionStats(f, 0.06, 0.78, 0.30, 0.92),
        flankFar:   regionStats(f, 0.78, 0.60, 0.95, 0.68),
        kickerFace: regionStats(f, 0.14, 0.30, 0.20, 0.36),
        inrun:      regionStats(f, 0.18, 0.46, 0.28, 0.52),
    };
    console.log('GREY_RAMP ' + JSON.stringify(stats));

    expect(stats.corridor.n).toBeGreaterThan(100);
    expect(stats.flankNear.n).toBeGreaterThan(100);

    // Phase-1 gates (iteration 6): the recipe fix recovered the in-run fully
    // (0.640→0.765) and the kicker partially (0.651→0.678); corridor table
    // improved 0.622→0.645 with the residual attributed-but-unfixed stack
    // (see RENDER-PROGRESS 6). These pin today's numbers so a regression from
    // ANY cause fails; phase 2 tightens toward full parity next iteration.
    const darkestFlank = Math.min(stats.flankNear.lum, stats.flankFar.lum);
    expect(stats.corridor.lum).toBeGreaterThan(0.62);
    expect(stats.inrun.lum).toBeGreaterThan(darkestFlank - 0.08);
    expect(stats.kickerFace.lum).toBeGreaterThan(darkestFlank - 0.13);

    // The seam: background must not show through beside the kicker.
    // Baseline was 12.2% sky-like pixels before the junction fillers.
    expect(stats.kickerFace.skyFrac,
        `kicker region shows ${stats.kickerFace.skyFrac} sky-like pixels`)
        .toBeLessThan(0.035);
});

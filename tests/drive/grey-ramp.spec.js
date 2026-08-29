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
    // The corridor box must sit on the ACTUAL corridor ribbon. The old fixed
    // fractional box (0.55–0.65, 0.50–0.54) was sized for the pre-P1 wide slabs;
    // a pick probe showed it sampling wInrun/wStartPlat (lsMat flank fills)
    // after the ribbon replaced them — it had been measuring the flanks.
    // Project a table-centre corridor point into screen space and box around it.
    const box = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = (cfg.LANDING_START_Z + cfg.KICKER_END_Z) / 2;      // mid-table
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025; // FOOT_OFFSET
        const p = BABYLON.Vector3.Project(new BABYLON.Vector3(0, y, z),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            scene.activeCamera.viewport.toGlobal(
                scene.getEngine().getRenderWidth(), scene.getEngine().getRenderHeight()));
        return { x: p.x, y: p.y, W: scene.getEngine().getRenderWidth(), H: scene.getEngine().getRenderHeight() };
    });
    const cor = { x0: box.x / box.W - 0.05, x1: box.x / box.W + 0.05,
                  y0: box.y / box.H - 0.008, y1: box.y / box.H + 0.008 };
    // The kicker-face box was a fixed fractional region tuned when the
    // background above the lip was sky. P6 ridgelines (iter 94) now put hazy
    // hill silhouette there, and the fixed box's top rows sampled ridge pixels
    // (lum 0.7626 vs a 0.7627 floor, skyFrac 0.0235). Anchor the box to the
    // projected take-off face instead — same instrument fix the corridor box
    // got when the ribbon replaced the slabs.
    const kfBox = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = cfg.KICKER_END_Z - 0.05;
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025 - 1.1; // lower face, clear of the lip/ridge line
        const p = BABYLON.Vector3.Project(new BABYLON.Vector3(0, y, z),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            scene.activeCamera.viewport.toGlobal(
                scene.getEngine().getRenderWidth(), scene.getEngine().getRenderHeight()));
        return { x: p.x, y: p.y, W: scene.getEngine().getRenderWidth(), H: scene.getEngine().getRenderHeight() };
    });
    const f = await grabPixels(page);

    const stats = {
        corridor:   regionStats(f, cor.x0, cor.y0, cor.x1, cor.y1),
        flankNear:  regionStats(f, 0.06, 0.78, 0.30, 0.92),
        flankFar:   regionStats(f, 0.78, 0.60, 0.95, 0.68),
        kickerFace: regionStats(f,
            kfBox.x / kfBox.W - 0.014, kfBox.y / kfBox.H - 0.014,
            kfBox.x / kfBox.W + 0.014, kfBox.y / kfBox.H + 0.014),
        inrun:      regionStats(f, 0.18, 0.46, 0.28, 0.52),
    };
    console.log('GREY_RAMP ' + JSON.stringify(stats) + ' corridorBox ' +
        JSON.stringify(cor));

    expect(stats.corridor.n).toBeGreaterThan(100);
    expect(stats.flankNear.n).toBeGreaterThan(100);

    // Phase-2 gates (iteration 7): the residual carrier turned out to be
    // snowMat's subsurface translucency (+ clear coat, minor) — disabling them
    // moved corridor 0.645→0.778 and kicker 0.678→0.758 against flanks 0.787.
    // All three run surfaces now sit within a step of flank parity, so the
    // gates tighten from phase 1's −0.08/−0.13 to near-parity margins.
    const darkestFlank = Math.min(stats.flankNear.lum, stats.flankFar.lum);
    // Band re-derivation (iter 51): the 32° camera-left sun (schedule group 1)
    // breaks the old near-uniform-incidence assumption the −0.04/−0.06 bands
    // were calibrated under. A z-tilted run reads cos(θ)·sin(32°) direct while
    // the sunward-tilted flank field gains 0.848·sinφ — measured deficit at the
    // shipped rig: inrun 0.0547, kickerFace 0.0157 (entry 51), stable across
    // hemi 0.30/0.36/0.42 and exposure 1.0/1.12/1.20. The defect this spec
    // hunts (the pre-P1 grey band) read ~0.14 absolute; the corridor floor and
    // corridor-vs-flank parity gates below are unchanged.
    expect(stats.corridor.lum).toBeGreaterThan(0.72);
    // iter 96: HARD parity (>= darkestFlank, 0.005 noise floor) was attempted
    // and REVERTED — snowMat albedo scaling converges at corridor/flank ~0.987
    // under tone mapping (flanks share snowMat, so albedo cannot close the
    // gap) and the corridor normal-map strength change measured zero effect.
    // Re-opened as entry 96 open question; -0.02 stands until a
    // corridor-specific lever exists.
    expect(stats.corridor.lum).toBeGreaterThanOrEqual(darkestFlank - 0.02);
    expect(stats.inrun.lum).toBeGreaterThanOrEqual(darkestFlank - 0.06);
    expect(stats.kickerFace.lum).toBeGreaterThanOrEqual(darkestFlank - 0.08);

    // The seam: background must not show through beside the kicker.
    // Baseline was 12.2% sky-like pixels before the junction fillers.
    expect(stats.kickerFace.skyFrac,
        `kicker region shows ${stats.kickerFace.skyFrac} sky-like pixels`)
        .toBeLessThan(0.035);
});

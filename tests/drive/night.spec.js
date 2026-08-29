'use strict';
// ── P9 night snowfall mode gates (?night=1) ─────────────────────────────────
// Landed iteration 118. Modelled on reference/frames/IMG_3396 (night training,
// heavy snowfall). Measures from the live render:
//   1. mode  — _nightProbe().active only under ?night=1; the default mode is
//              untouched (no night lights, day skyDome present);
//   2. rig   — 7 warm floodlight SpotLights + poles exist; the day sun is
//              dimmed (intensity ≤ 0.1); IBL cut to ≤ 0.1;
//   3. snow  — the snowfall particle system exists and is started;
//   4. image — sky/top-of-frame luminance low (< 0.16) while the brightest
//              frame pixels (the floodlight pools) read bright (> 0.45) and
//              warm (r > b): dark sky, bright pools, dark between.
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
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        R += f.d[i] / 255; G += f.d[i + 1] / 255; B += f.d[i + 2] / 255; n++;
    }
    return {
        lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4),
        rb: +((R - B) / n).toFixed(4),
        n,
    };
}

// Luminance histogram over a region; returns mean stats of the brightest
// `frac` pixels — a framing-robust "is the lit snow bright and warm" probe.
function brightStats(f, x0, y0, x1, y1, frac) {
    const X0 = Math.round(x0 * f.W), X1 = Math.round(x1 * f.W);
    const Y0 = Math.round(y0 * f.H), Y1 = Math.round(y1 * f.H);
    const px = [];
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        px.push({ r, g, b, l: 0.2126 * r + 0.7152 * g + 0.0722 * b });
    }
    px.sort((a, b) => b.l - a.l);
    const n = Math.max(1, Math.round(px.length * frac));
    let R = 0, G = 0, B = 0, L = 0;
    for (let k = 0; k < n; k++) { R += px[k].r; G += px[k].g; B += px[k].b; L += px[k].l; }
    return { lum: +(L / n).toFixed(4), rb: +((R - B) / n).toFixed(4), n };
}

test('P9 night mode: default day untouched; night rig, snowfall, dark sky + lit snow', async ({ page }) => {
    // ── Default mode: no night state, day dome present ──────────────────────
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._nightProbe === 'function',
        null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    const day = await page.evaluate(() => ({
        probe: window._nightProbe(),
        dome: !!BABYLON.EngineStore.LastCreatedScene.getMeshByName('skyDome'),
    }));
    expect(day.probe.active).toBe(false);
    expect(day.probe.lights).toBe(0);
    expect(day.dome).toBe(true);

    // ── Night mode ──────────────────────────────────────────────────────────
    await page.goto('/index.html?night=1');
    await page.waitForFunction(() => typeof window._nightProbe === 'function',
        null, { timeout: 30_000 });
    await page.waitForTimeout(2500);   // let particles populate the volume
    const night = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const spots = scene.lights.filter(l => l.name.indexOf('nightFlood') === 0);
        const sun = scene.lights.find(l => l.name === 'sun');
        return {
            probe: window._nightProbe(),
            spotCount: spots.length,
            warm: spots.length > 0 && spots.every(s => s.diffuse && s.diffuse.r > s.diffuse.b),
            sunDim: sun ? sun.intensity <= 0.1 : null,
            envDim: scene.environmentIntensity <= 0.1,
            dome: !!scene.getMeshByName('skyDome'),
        };
    });
    expect(night.probe.active).toBe(true);
    expect(night.spotCount).toBe(7);
    expect(night.warm, 'floodlights warm (r > b)').toBe(true);
    expect(night.sunDim).toBe(true);
    expect(night.envDim, 'IBL cut at night').toBe(true);
    expect(night.dome, 'day sky dome must be absent at night').toBe(false);
    expect(night.probe.snow, 'snowfall particle system started').toBe(true);

    // ── Image: dark sky, bright warm-lit pools ──────────────────────────────
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(500);
    const f = await grabPixels(page);
    const top = regionStats(f, 0.1, 0.02, 0.9, 0.30);    // sky region
    const snow = brightStats(f, 0.05, 0.35, 0.95, 0.95, 0.02); // brightest 2% = lit pools
    expect(top.lum, 'night sky luminance low (measured ' + top.lum + ')').toBeLessThan(0.16);
    expect(snow.lum, 'lit snow pool luminance, brightest 2% (measured ' + snow.lum + ')').toBeGreaterThan(0.45);
    expect(snow.rb, 'lit snow warm under floodlights (r-b ' + snow.rb + ')').toBeGreaterThan(0.0);
});

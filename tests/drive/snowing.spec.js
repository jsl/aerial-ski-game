'use strict';
// ── Day-time snowing mode gates (?snowing=1 / Settings "Snowing") ───────────
// Author order item 2 of 121–145 (2026-08-29 22:00; reviewer order 129 (a)):
// a second weather toggle, independent of Night, that runs the snowfall
// particles under a slightly greyer sky / softer sun in the DAY rig.
// Measures from the live render:
//   1. mode  — _nightProbe().snowing only under ?snowing=1; default day is
//              untouched (no particles, blue dome, full sun);
//   2. rig   — the day snowfall particle system exists and is started; the
//              sun is softened (0.95 vs the day 1.35); fog is thicker;
//   3. image — the sky/top-of-frame reads greyer (lower blue dominance and
//              lower luminance than day) while snow stays bright: an
//              overcast day, not the night mode.
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

test('day snowing mode: default day untouched; greyer sky, softer sun, snowfall running', async ({ page }) => {
    test.setTimeout(120_000);
    // ── Default mode: no snowing state ──────────────────────────────────────
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._nightProbe === 'function',
        null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    const day = await page.evaluate(() => ({
        probe: window._nightProbe(),
        dome: !!BABYLON.EngineStore.LastCreatedScene.getMeshByName('skyDome'),
        sun: BABYLON.EngineStore.LastCreatedScene.lights.find(l => l.name && l.name.indexOf('sun') === 0),
        psCount: BABYLON.EngineStore.LastCreatedScene.particleSystems.length,
    }));
    expect(day.probe.snowing).toBe(false);
    expect(day.probe.night ?? day.probe.active).toBe(false);
    expect(day.probe.daySnow).toBe(false);
    expect(day.dome).toBe(true);
    expect(day.psCount).toBe(0);
    const daySunI = day.sun ? day.sun.intensity : null;
    const dayFog = await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.fogDensity);
    const dayPix = await grabPixels(page);
    const daySky = regionStats(dayPix, 0.25, 0.02, 0.75, 0.12);

    // ── Snowing mode ────────────────────────────────────────────────────────
    await page.goto('/index.html?snowing=1');
    await page.waitForFunction(() => typeof window._nightProbe === 'function',
        null, { timeout: 30_000 });
    await page.waitForTimeout(2500);   // let particles populate the volume
    const snow = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        return {
            probe: window._nightProbe(),
            dome: !!scene.getMeshByName('skyDome'),
            sun: (scene.lights.find(l => l.name && l.name.indexOf('sun') === 0) || {}).intensity ?? null,
            fog: scene.fogDensity,
            psNames: scene.particleSystems.map(p => p.name),
            nightLights: scene.lights.filter(l => l.name && l.name.indexOf('nightFlood') === 0).length,
        };
    });
    expect(snow.probe.snowing).toBe(true);
    expect(snow.probe.active).toBe(false);          // independent of Night
    expect(snow.probe.daySnow).toBe(true);          // particle system started
    expect(snow.psNames.some(n => n === 'daySnowfall')).toBe(true);
    expect(snow.dome).toBe(true);                   // day dome, not the night sky
    expect(snow.nightLights).toBe(0);               // no floodlights in day mode
    expect(snow.sun).toBeCloseTo(0.95, 5);          // softer than the day 1.35
    expect(snow.fog).toBeGreaterThan(dayFog);       // greyer, thicker air

    // Image: overcast sky — dimmer and less blue than the day sky; and NOT
    // the night mode (luminance stays day-like, well above the night < 0.16).
    const snowPix = await grabPixels(page);
    const snowSky = regionStats(snowPix, 0.25, 0.02, 0.75, 0.12);
    expect(snowSky.lum).toBeLessThan(daySky.lum);   // greyer than sunny day
    expect(Math.abs(snowSky.rb)).toBeLessThan(0.15); // near-neutral grey, not deep blue
    expect(snowSky.lum).toBeGreaterThan(0.25);      // ...but still daylight
});

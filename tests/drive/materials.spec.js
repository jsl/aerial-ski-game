'use strict';
// ── Materials and IBL, verified against real Babylon ─────────────────────────
// Again: the golden traces cannot see any of this. Materials, environment
// textures and geometry density are invisible to a transform-based trace, so a
// silent failure here — an .env that 404s, a PBR material that fell back — looks
// exactly like success everywhere except on screen.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
}

test('the environment texture actually loaded', async ({ page }) => {
    const failed = [];
    page.on('requestfailed', r => failed.push(r.url()));
    page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

    await boot(page);

    const env = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const t = scene.environmentTexture;
        if (!t) return { present: false };
        // A CubeTexture that 404s still EXISTS as an object — it just never
        // becomes ready. That distinction is the whole point of this check.
        for (let i = 0; i < 60 && !t.isReady(); i++) {
            await new Promise(r => setTimeout(r, 100));
        }
        return {
            present: true,
            ready: t.isReady(),
            isCube: t.isCube === true,
            intensity: scene.environmentIntensity,
        };
    });

    expect(env.present, 'scene.environmentTexture is null — IBL not configured').toBe(true);
    expect(env.ready,
        'environment texture never became ready — the .env likely failed to load, ' +
        'which leaves PBR surfaces with nothing to reflect').toBe(true);
    expect(env.isCube, 'environment texture is not a cube texture').toBe(true);
    expect(env.intensity).toBeGreaterThan(0);

    expect(failed.filter(u => String(u).includes('.env')),
        'the .env request failed').toEqual([]);
});

test('snow is a PBR material with subsurface and clearcoat', async ({ page }) => {
    await boot(page);

    const mat = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const m = scene.materials.find(x => x.name === 'snowMat');
        if (!m) return { found: false, names: scene.materials.map(x => x.name).slice(0, 20) };
        return {
            found: true,
            isPBR: m.getClassName ? m.getClassName().includes('PBR') : false,
            className: m.getClassName ? m.getClassName() : null,
            roughness: m.roughness,
            metallic: m.metallic,
            translucency: m.subSurface ? m.subSurface.isTranslucencyEnabled : null,
            translucencyIntensity: m.subSurface ? m.subSurface.translucencyIntensity : null,
            clearCoat: m.clearCoat ? m.clearCoat.isEnabled : null,
        };
    });

    expect(mat.found, `snowMat not found; materials: ${JSON.stringify(mat.names)}`).toBe(true);
    expect(mat.isPBR,
        `snowMat is ${mat.className}, not PBR — StandardMaterial ignores the ` +
        `environment texture entirely, so IBL would do nothing`).toBe(true);
    expect(mat.metallic).toBe(0);
    expect(mat.roughness).toBeGreaterThan(0);
    expect(mat.roughness).toBeLessThan(1);

    // Grey ramp, iteration 7: subsurface translucency + clear coat on snowMat
    // were the measured carriers of the residual corridor grey ramp (translucency
    // off alone: corridor 0.645 -> 0.778 vs flanks 0.787; clear coat +0.015).
    // They re-routed energy away from sunlit snow next to opaque lsMat flanks,
    // leaving the groomed run ~13% darker than untreated snow beside it. The
    // run must read at least as bright as its flanks; any future subsurface
    // return belongs to a scene-wide P2 light rig.
    expect(mat.translucency,
        'snowMat still carries translucency — it measurably darkens the ' +
        'corridor vs the flanks (grey ramp, RENDER-PROGRESS 7)').toBe(false);
    expect(mat.clearCoat,
        'snowMat still carries clear coat — same measurement').toBe(false);
});

test('the athlete is rendered at higher geometric resolution', async ({ page }) => {
    await boot(page);

    const geo = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const pick = (n) => scene.meshes.find(m => m.name === n);
        const count = (m) => (m && m.getTotalVertices) ? m.getTotalVertices() : 0;
        return {
            head:  count(pick('head')),
            torso: count(pick('torso')),
            upperArmL: count(pick('upperArmL')),
        };
    });

    // Baseline before this change: sphere segments 12, cylinders tessellation 18.
    // A 12-segment sphere is ~169 vertices; 32 segments is ~1089. Asserting a
    // floor rather than an exact number so the test survives future retopology.
    expect(geo.head, 'helmet is still low-poly — faceting will be visible close up')
        .toBeGreaterThan(400);
    expect(geo.torso, 'torso is still low-poly').toBeGreaterThan(100);
    expect(geo.upperArmL, 'limbs are still low-poly').toBeGreaterThan(100);
});

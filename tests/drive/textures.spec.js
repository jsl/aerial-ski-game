'use strict';
// ── Procedural surface texturing ─────────────────────────────────────────────
// Every material in the scene was a flat colour. This verifies the generated
// maps actually reached the materials, in a real browser — the generator needs a
// working 2D canvas, so it silently returns null in the headless stub and this
// is the only place the result can be checked.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
}

test('surface maps are generated and applied across the scene', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const info = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const textured = scene.materials.filter(m => m.bumpTexture);
        return {
            applied: window._surfacesApplied,
            texturedCount: textured.length,
            names: textured.map(m => m.name).slice(0, 12),
            snow: (() => {
                const m = scene.materials.find(x => x.name === 'snowMat');
                if (!m) return null;
                return {
                    hasNormal: !!m.bumpTexture,
                    hasAlbedo: !!m.albedoTexture,
                    uScale: m.bumpTexture ? m.bumpTexture.uScale : null,
                    f0: typeof m.metallicF0Factor === 'number' ? m.metallicF0Factor : null,
                    albedoColor: m.albedoColor
                        ? [m.albedoColor.r, m.albedoColor.g, m.albedoColor.b] : null,
                };
            })(),
        };
    });

    expect(info.applied, 'no surfaces were applied — the generator returned null')
        .toBeGreaterThan(3);
    expect(info.texturedCount, 'materials have no normal maps').toBeGreaterThan(3);

    expect(info.snow, 'snowMat missing').not.toBeNull();
    expect(info.snow.hasNormal, 'snow has no normal map').toBe(true);
    expect(info.snow.uScale, 'snow texture is not tiled').toBeGreaterThan(1);
    // Grey ramp (iteration 6): the corridor carries a NORMAL map only. A tinted
    // albedo map over a white base multiplied its sub-unity mean through every
    // pixel while the untextured flanks stayed bright — the run measured 17%
    // darker than its own flanks. The hue now lives in an explicit albedoColor,
    // tuned a step brighter than lsMat's flanks, with dielectric F0 matched.
    expect(info.snow.hasAlbedo,
        'snowMat must not carry an albedo map — see the grey-ramp note in game.js')
        .toBe(false);
    expect(info.snow.f0).toBeCloseTo(0.21, 5);
    expect(info.snow.albedoColor).not.toBeNull();
    expect(Math.abs(info.snow.albedoColor[0] - 0.975)).toBeLessThan(0.01);
    expect(Math.abs(info.snow.albedoColor[1] - 0.99)).toBeLessThan(0.01);
    expect(Math.abs(info.snow.albedoColor[2] - 1.0)).toBeLessThan(0.01);

    expect(errors, 'errors during texture generation').toEqual([]);
});

test('generated maps are deterministic', async ({ page }) => {
    // The maps are built from a hash, not Math.random, so the surface must be
    // identical every load. If it drifted, the look would change between
    // sessions and no screenshot comparison would ever be stable.
    const sample = async () => {
        await boot(page);
        return page.evaluate(() => {
            const T = window.AerialEngine.textures;
            const out = [];
            for (let i = 0; i < 8; i++) out.push(T.fbm(i * 0.37, i * 0.71, 3, 2.0, 0.5));
            return out;
        });
    };
    const a = await sample();
    const b = await sample();
    expect(b).toEqual(a);
});

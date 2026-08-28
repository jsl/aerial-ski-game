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
                    detail: m.detailMap && m.detailMap.texture ? {
                        enabled: m.detailMap.isEnabled,
                        uScale: m.detailMap.texture.uScale,
                        size: m.detailMap.texture.getSize().width,
                        diffuseBlendLevel: m.detailMap.diffuseBlendLevel,
                        bumpLevel: m.detailMap.bumpLevel,
                        gammaSpace: m.detailMap.texture.gammaSpace,
                    } : null,
                    corridorUV: (() => {
                        const mesh = scene.getMeshByName('terrainCorridor');
                        if (!mesh || !mesh.isReady()) return null;
                        const uv = mesh.getVerticesData(BABYLON.VertexBuffer.UVKind);
                        if (!uv) return null;
                        let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
                        for (let i = 0; i < uv.length; i += 2) {
                            uMin = Math.min(uMin, uv[i]); uMax = Math.max(uMax, uv[i]);
                            vMin = Math.min(vMin, uv[i + 1]); vMax = Math.max(vMax, uv[i + 1]);
                        }
                        return { verts: uv.length / 2, uMin, uMax, vMin, vMax };
                    })(),
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
    // P12 slice 2: snowMat tiles by WORLD METRES now (the corridor carries
    // (x, z) uv1), so uScale = 1/1.4 for the 1.4 m fine tile. The old
    // "uScale > 1" gate asserted face-fraction semantics the corridor never
    // had — its uv buffer did not exist and the maps sampled (0,0).
    expect(info.snow.uScale, 'snow fine tile must be 1.4 m (uScale = 1/1.4)')
        .toBeCloseTo(1 / 1.4, 3);
    // corridorUV is reported inside the snowMat record (same evaluate).
    expect(info.snow.corridorUV, 'corridor has no uv buffer — metre texturing lost')
        .toBeDefined();
    expect(info.snow.corridorUV.verts).toBeGreaterThan(0);
    expect(info.snow.corridorUV.vMax, 'corridor uv must be metre-scale along z')
        .toBeGreaterThan(50);
    // P12: the second, larger-scale variation layer rides material.detailMap.
    expect(info.snow.detail, 'snow macro detail layer missing').not.toBeNull();
    expect(info.snow.detail.enabled, 'detailMap not enabled').toBe(true);
    expect(info.snow.detail.uScale, 'macro tile must be 45 m (uScale = 1/45)')
        .toBeCloseTo(1 / 45, 4);
    expect(info.snow.detail.size).toBe(512);
    expect(info.snow.detail.gammaSpace, 'detail map is data — must stay linear')
        .toBe(false);
    expect(info.snow.detail.diffuseBlendLevel).toBeCloseTo(1.0, 5);
    expect(info.snow.detail.bumpLevel).toBeGreaterThan(0);
    expect(info.snow.detail.bumpLevel).toBeLessThanOrEqual(1);
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
    expect(Math.abs(info.snow.albedoColor[0] - 0.98)).toBeLessThan(0.01);
    expect(Math.abs(info.snow.albedoColor[1] - 0.995)).toBeLessThan(0.01);
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

'use strict';
// ── P12 render-quality gates (docs/RENDER-PLAN.md, P12) ─────────────────────
// These are the settings that decide whether the image reads "rendered" or
// "photographed", and none of them are visible to the golden traces: the
// hardware scaling level, MSAA sample count, texture filtering and the post
// chain can all silently fall back to defaults and every other spec stays
// green. This spec pins them, and measures the frame-time cost so the quality
// does not arrive at the price of the 60 fps budget.
//
// The frame-time gate is deliberately generous: headless SwiftShader on the
// test box is not a mid-range GPU, and its job here is to catch pathological
// regressions (an accidentally-per-frame texture rebuild), not to grade image
// quality. The real numbers are logged for the progress entry.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // The procedural surfaces (and their 1024px snow tiles) apply ~1.2 s in.
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
}

test('resolution, MSAA, sharpen and the post chain match the P12 settings', async ({ page }) => {
    await boot(page);

    const q = await page.evaluate(() => {
        const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
        return {
            scaling: engine.getHardwareScalingLevel(),
            baseScaling: window._quality.baseScaling,
            devicePixelRatio: window.devicePixelRatio || 1,
            msaa: window._quality.msaa,
            capsMaxMsaa: engine.getCaps().maxMSAASamples || 0,
            sharpen: window._quality.sharpen,
            bloomWeight: window._dofPipeline ? window._dofPipeline.bloomWeight : null,
            hwScalingSupported: typeof engine.setHardwareScalingLevel === 'function',
        };
    });

    expect(q.hwScalingSupported, 'engine cannot set a hardware scaling level').toBe(true);
    // Base = render at device pixel ratio, capped at 2 (formula from P12).
    expect(q.baseScaling).toBeCloseTo(1 / Math.min(q.devicePixelRatio, 2), 6);
    // The adapter is not allowed to drop below CSS resolution: headless DPR
    // is 1, so the live level must still be the base one here.
    expect(q.scaling).toBeGreaterThanOrEqual(q.baseScaling);
    expect(q.scaling).toBeLessThanOrEqual(1.0 + 1e-9);

    // MSAA 8x where the context allows, else 4x — never below 4x.
    expect(q.msaa).toBe(Math.min(8, q.capsMaxMsaa || 4));
    expect(q.msaa).toBeGreaterThanOrEqual(4);

    // P12 asked for a mild sharpen (edge 0.3–0.5). MEASURED AND WITHDRAWN in
    // iter 48: SharpenPostProcess undershoots the snow/tree boundary field —
    // ready-view near-black coverage 0.003% → 2.18% at edge 0.4 (1.71% at
    // 0.3) against baked.spec's 0.5% dead-light gate. The gate below guards
    // that decision: do not re-enable without a scene-safe construction
    // (luma-only unsharp or CAS) and a fresh baked.spec run.
    expect(q.sharpen, 'sharpen must stay off — see the iter-48 ringing measurement').toBe(false);
    expect(q.bloomWeight, 'bloom weight must be ≤ 0.1 (P12)')
        .not.toBeNull();
    expect(q.bloomWeight).toBeLessThanOrEqual(0.1 + 1e-9);
});

test('snow tiles render at 1024 with trilinear mip filtering and 16x anisotropy', async ({ page }) => {
    await boot(page);

    const tex = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const pick = (name) => {
            const t = scene.textures.find(x => x.name === name);
            if (!t) return null;
            const s = t.getSize();
            return {
                width: s.width, height: s.height,
                trilinear: t.samplingMode === BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                aniso: t.anisotropicFilteringLevel,
            };
        };
        // EVERY snow-recipe tile (corridor + landing mats + table): the camera
        // skis over all of them at grazing angles. Keyed by recipe prefix so
        // duplicates at different sizes cannot hide behind a first-match.
        const byPrefix = (pfx) => scene.textures
            .filter(x => typeof x.name === 'string' && x.name.startsWith(pfx))
            .map(t => ({ name: t.name, width: t.getSize().width,
                trilinear: t.samplingMode === BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                aniso: t.anisotropicFilteringLevel }));
        return {
            snow: byPrefix('tex_snow_'),
            other: ['rock', 'bark', 'foliage', 'fabric', 'shell']
                .map(r => byPrefix('tex_' + r + '_'))
                .flat(),
            applied: window._surfacesApplied,
        };
    });

    expect(tex.applied, 'no procedural surfaces were applied').toBeGreaterThan(0);
    expect(tex.snow.length, 'no snow-recipe tiles found').toBeGreaterThan(0);
    for (const t of tex.snow) {
        expect(t.width, t.name + ' must be a 1024 tile (P12)').toBe(1024);
        expect(t.trilinear, t.name + ' must use trilinear mip filtering').toBe(true);
        expect(t.aniso, t.name + ' anisotropicFilteringLevel must be 16').toBe(16);
    }
    expect(tex.other.length, 'no other procedural tiles found — surfaces did not apply').toBeGreaterThan(0);
    for (const t of tex.other) {
        expect(t.trilinear, t.name + ' must use trilinear mip filtering').toBe(true);
        expect(t.aniso, t.name + ' anisotropicFilteringLevel must be 16').toBe(16);
    }
});

test('P12 material re-tune: ski gloss split by zone; snow sheen A/B rejected', async ({ page }) => {
    await boot(page);

    const m = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ski = scene.materials.find(x => x.name === 'skiVis_mat');
        const snow = scene.materials.find(x => x.name === 'snowMat');
        const tex = (n) => {
            const t = scene.textures.find(x => x.name === n);
            if (!t) return null;
            return {
                width: t.getSize().width,
                trilinear: t.samplingMode === BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
                aniso: t.anisotropicFilteringLevel,
            };
        };
        return {
            ski: ski ? {
                roughMapName: ski.metallicTexture ? ski.metallicTexture.name : null,
                green: ski.useRoughnessFromMetallicTextureGreen,
                alpha: ski.useRoughnessFromMetallicTextureAlpha,
                blueMetallic: ski.useMetallicFromMetallicTextureBlue,
                redAO: ski.useAmbientOcclusionFromMetallicTextureRed,
                roughness: ski.roughness,
                metallic: ski.metallic,
            } : null,
            roughTex: tex('skiRoughTex'),
            topTex: tex('skiTopTex'),
            snow: snow ? {
                roughness: snow.roughness,
                sheenOn: snow.sheen ? snow.sheen.isEnabled : null,
                sheenIntensity: snow.sheen ? snow.sheen.intensity : null,
            } : null,
        };
    });

    // ── Ski: glossy topsheet, matte base, via the ORM green channel ──────────
    expect(m.ski, 'skiVis_mat missing').not.toBeNull();
    expect(m.ski.roughMapName, 'ski roughness map missing').toBe('skiRoughTex');
    // This Babylon build defaults to the ALPHA ORM variant; if the flags
    // drift back, the map silently reads a UNIFORM roughness off alpha=1 and
    // the glossy/matte split disappears with every boolean still truthy-ish.
    expect(m.ski.green, 'roughness must come from the green channel').toBe(true);
    expect(m.ski.alpha, 'alpha roughness must stay off (build default is on)').toBe(false);
    expect(m.ski.blueMetallic, 'blue metallic must stay off — dielectric').toBe(false);
    expect(m.ski.redAO, 'red AO must stay off').toBe(false);
    expect(m.ski.roughness, 'roughness property is the map multiplier, pinned 1').toBe(1);
    expect(m.ski.metallic).toBe(0);
    expect(m.roughTex, 'skiRoughTex missing').not.toBeNull();
    expect(m.roughTex.trilinear, 'skiRoughTex must be trilinear').toBe(true);
    expect(m.roughTex.aniso, 'skiRoughTex aniso must be 16').toBe(16);
    expect(m.topTex, 'skiTopTex missing').not.toBeNull();
    expect(m.topTex.trilinear, 'skiTopTex must be trilinear (mipmapped)').toBe(true);
    expect(m.topTex.aniso, 'skiTopTex aniso must be 16').toBe(16);

    // ── Snow: sheen A/B'd and REJECTED (iter 53) ─────────────────────────────
    // Sheen lifts grazing views, and at this camera the FLAT flank fields
    // respond more (+0.013) than the tilted run surfaces (+0.007): kickerFace
    // 0.7741 broke its −0.08 band by 0.002 and corridor parity fell to a
    // 0.0022 knife edge. The deficit scales with intensity, so any visible
    // sheen re-opens the grey ramp. Gate the off-state (same
    // drift-catches-either-way design as the sharpen pin above).
    expect(m.snow, 'snowMat missing').not.toBeNull();
    expect(m.snow.roughness).toBeGreaterThan(0.3);
    expect(m.snow.roughness).toBeLessThan(0.6);
    expect(m.snow.sheenOn,
        'snow sheen must stay off — iter-53 A/B re-opened the grey ramp').toBe(false);
});

test('SSAO2 runs at 32 samples with the bilateral blur', async ({ page }) => {
    await boot(page);

    const ssao = await page.evaluate(() => {
        const p = window._ssao;
        if (!p) return { found: false };
        return {
            found: true,
            samples: p.samples,
            expensiveBlur: p.expensiveBlur,
        };
    });

    // SSAO is wrapped in try/catch in game.js (a stub without SSAO must not
    // kill the boot), so absence is reported as a failure here — the CI
    // browser has WebGL and must have it.
    expect(ssao.found, 'SSAO2RenderingPipeline not attached to the camera').toBe(true);
    expect(ssao.samples, 'SSAO2 samples must be 32 (P12)').toBe(32);
    expect(ssao.expensiveBlur, 'SSAO2 bilateral blur must be on').toBe(true);
});

test('the adaptive scaling fallback raises under load and restores with headroom', async ({ page }) => {
    await boot(page);

    // Drive the adapter's step function directly with synthetic frame times:
    // 2 s over the 22 ms budget must raise the level, then 5 s of headroom
    // must snap it back to base. Deterministic — no wall-clock dependence.
    const r = await page.evaluate(() => {
        const Q = window._quality;
        const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
        const realMax = Q.maxScaling;
        const start = engine.getHardwareScalingLevel();
        const raises0 = Q.raises, restores0 = Q.restores;
        // A normal 60 Hz display must not be mistaken for overload.
        Q.maxScaling = 2.0;
        engine.setHardwareScalingLevel(Q.baseScaling);
        for (let i = 0; i < 600; i++) Q.step(1000 / 60);
        const normalScaling = engine.getHardwareScalingLevel();
        const normalRaises = Q.raises - raises0;
        // Headless (DPR 1) has no headroom between base and the CSS floor, so
        // widen the ceiling to exercise the mechanism the retina path runs.
        // The whole sequence is synchronous so the live render loop cannot
        // interleave real frames into the synthetic timings.
        Q.maxScaling = 2.0;
        for (let i = 0; i < 120; i++) Q.step(30);   // 3.6 s of slow frames
        const raised = engine.getHardwareScalingLevel();
        for (let i = 0; i < 700; i++) Q.step(8);    // 5.6 s of headroom
        const restored = engine.getHardwareScalingLevel();
        Q.maxScaling = realMax;
        return {
            start, raised, restored, normalScaling, normalRaises,
            raises: Q.raises - raises0,
            restores: Q.restores - restores0,
            base: Q.baseScaling,
        };
    });

    expect(r.normalRaises).toBe(0);
    expect(r.normalScaling).toBeCloseTo(r.base, 6);
    expect(r.raises, '2 s of >22 ms frames must raise the scaling level').toBeGreaterThan(0);
    expect(r.raised).toBeGreaterThan(r.start);
    expect(r.restores, '5 s of headroom must walk the level back to base').toBeGreaterThan(0);
    expect(r.restored).toBeCloseTo(r.base, 6);
});

test('Retina keeps twice the canvas resolution at normal 60 Hz', async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2,
        viewport: { width: 320, height: 220 } });
    try {
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || '8099') + '/index.html');
        await page.waitForFunction(() => window._quality);
        const result = await page.evaluate(() => {
            const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
            const Q = window._quality;
            // First restore any quality lost while shader compilation warms up.
            for (let i = 0; i < 400; i++) Q.step(1000 / 60);
            const raises = Q.raises;
            for (let i = 0; i < 600; i++) Q.step(1000 / 60);
            const canvas = document.getElementById('renderCanvas');
            return { scaling: Q.scaling, raises: Q.raises - raises,
                width: canvas.width, cssWidth: canvas.clientWidth,
                height: canvas.height, cssHeight: canvas.clientHeight };
        });
        expect(result.scaling).toBe(0.5);
        expect(result.raises).toBe(0);
        expect(result.width).toBe(result.cssWidth * 2);
        expect(result.height).toBe(result.cssHeight * 2);
    } finally { await context.close(); }
});

test('frame-time budget: 300 frames stay inside the simulation guard', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);

    const m = await page.evaluate(async () => {
        const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
        const dts = [];
        for (let i = 0; i < 300; i++) {
            const t0 = performance.now();
            await new Promise(req => requestAnimationFrame(req));
            dts.push(performance.now() - t0);
        }
        dts.sort((a, b) => a - b);
        const mean = dts.reduce((s, v) => s + v, 0) / dts.length;
        return {
            mean,
            p50: dts[Math.floor(dts.length * 0.5)],
            p95: dts[Math.floor(dts.length * 0.95)],
            fps: 1000 / mean,
            scaling: engine.getHardwareScalingLevel(),
        };
    });
    console.log('QUALITY frame-time ms mean=%s p50=%s p95=%s fps=%s scaling=%s',
        m.mean.toFixed(1), m.p50.toFixed(1), m.p95.toFixed(1),
        m.fps.toFixed(1), m.scaling);

    // Measured SwiftShader baselines at 320x220 (this box): 95 ms mean on
    // HEAD before the P12 passes, ~106 ms with SSAO 32 + sharpen. The gate
    // therefore catches only pathological regressions (a doubling), not the
    // SwiftShader tax itself; the 60 fps budget is a real-GPU target and the
    // logged numbers above are the per-iteration evidence.
    expect(m.mean, 'mean frame time collapsed — something pathological landed')
        .toBeLessThan(150);
});

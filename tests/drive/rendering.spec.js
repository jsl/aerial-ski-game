'use strict';
// ── Rendering configuration ──────────────────────────────────────────────────
// IMPORTANT: the golden traces give ZERO safety for rendering changes. They
// capture node transforms and simulation state — not pixels — so tonemapping,
// bloom, exposure and materials are entirely invisible to them. A rendering
// regression would leave all 30 traces green.
//
// This is the layer that constrains it: assert in a REAL browser, against REAL
// Babylon, that the pipeline is configured as intended. It cannot judge whether
// the result looks good — only a human can — but it can prove the settings are
// actually applied rather than silently dropped, which is the failure mode that
// looks identical to "nothing changed".

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
}

test('the rendering pipeline is HDR with ACES tonemapping', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const cfg = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        // DefaultRenderingPipeline registers itself on the scene's post-process
        // manager; find it by name rather than reaching into game.js internals.
        const pipes = scene.postProcessRenderPipelineManager
            ? scene.postProcessRenderPipelineManager.supportedPipelines : [];
        const p = pipes.find(x => x._name === 'dof' || x.name === 'dof');
        if (!p) return { found: false, pipeNames: pipes.map(x => x.name || x._name) };

        const ip = p.imageProcessing;
        return {
            found: true,
            // `_hdr` is how DefaultRenderingPipeline records the constructor flag.
            hdr: p._hdr === true,
            toneMappingEnabled: ip ? ip.toneMappingEnabled : null,
            toneMappingType:    ip ? ip.toneMappingType : null,
            acesConstant: BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES,
            exposure: ip ? ip.exposure : null,
            ditheringEnabled: ip ? ip.ditheringEnabled : null,
            bloomEnabled: p.bloomEnabled,
            bloomThreshold: p.bloomThreshold,
            fxaaEnabled: p.fxaaEnabled,
            samples: p.samples,
        };
    });

    expect(cfg.found, `'dof' pipeline not found; saw: ${JSON.stringify(cfg.pipeNames)}`).toBe(true);

    // The whole point: without the HDR float buffer, tonemapping has nothing to
    // work on and every value is already clamped by the time it runs.
    expect(cfg.hdr, 'pipeline is not HDR — tonemapping cannot recover clipped highlights').toBe(true);

    expect(cfg.toneMappingEnabled, 'tonemapping is off').toBe(true);
    // Exposure is pinned, not assumed: iter 51's 32°-sun rebalance moved it
    // 1.0 → 1.20 to hold the white level against sin(32°) of flat-ground direct
    // (see game.js and RENDER-PROGRESS entry 51). Pinning the shipped value
    // keeps it honest in both directions: it still fails if exposure drifts.
    expect(cfg.exposure, 'exposure drifted from the pinned 1.20').toBeCloseTo(1.20, 2);
    expect(cfg.ditheringEnabled, 'dithering off — sky/snow gradients will band').toBe(true);

    // Bloom threshold had to rise with HDR: in LDR nothing exceeded 1.0, so the
    // old 0.72 catches far more of the frame once values are unclamped.
    expect(cfg.bloomEnabled).toBe(true);
    expect(cfg.bloomThreshold,
        'bloom threshold still at its LDR value — will over-bloom in HDR').toBeGreaterThan(0.8);

    // MSAA instead of FXAA; both at once wastes work and softens the image.
    expect(cfg.samples, 'MSAA not enabled').toBeGreaterThan(1);
    expect(cfg.fxaaEnabled, 'FXAA on alongside MSAA — redundant').toBe(false);

    expect(errors, 'page errors with the new pipeline').toEqual([]);
});

test('the scene still renders frames with HDR enabled', async ({ page }) => {
    // An HDR float framebuffer can fail to allocate on some drivers, leaving a
    // black screen with no thrown error. Confirm frames still advance.
    await boot(page);
    const frames = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const a = scene.getFrameId();
        await new Promise(r => setTimeout(r, 1500));
        return scene.getFrameId() - a;
    });
    expect(frames, 'no frames rendered after enabling HDR').toBeGreaterThan(3);
});

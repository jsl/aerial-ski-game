'use strict';
// ── B-net texture conformance (iter 233, polish buffer of the 230 review) ──
// The 128 px alpha-cut net tile is the one tiled texture that never got P12's
// 16x anisotropic treatment, and the fence is THE grazing-angle case.
//
// Gates:
//  1. bnetTex.anisotropicFilteringLevel == 16 on the normal build.
//  2. the right AND left fence cloth projects into the ready-camera frame
//     (visibility sanity for the patch probe used by future work).
//  NC (?bnet_sabotage=1): aniso reverts to 1 — gate 1 must fire.
//
// OPEN (reported, not fixed here): scene.png's near fence still reads as a
// dark scribble at grazing angles. Two probes this iteration showed texture
// aniso is NOT the lever (near-black albedo changed the cloth-patch luminance
// by <0.04; the patch probe could not reliably isolate net pixels). Likely
// real cause: dark background (trees/terrain in shadow) read through the net's
// alpha holes compressed at grazing angles — a depth-fade/LOD on the net
// material is the candidate fix. Reviewer call.
const { test, expect } = require('@playwright/test');

test('bnet texture is 16x anisotropic; fence cloth visible in the ready frame', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bnetSeated === true, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());

    const aniso = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const mat = scene.getMaterialByName('bnetMat');
        return mat && mat.albedoTexture ? mat.albedoTexture.anisotropicFilteringLevel : null;
    });
    expect(aniso, 'bnetMat.albedoTexture missing').not.toBeNull();
    expect(aniso, 'bnetTex anisotropicFilteringLevel must be 16 (P12)').toBe(16);

    const inFrame = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const dbg = window._bnetDebug;
        const eng = scene.getEngine();
        const cam = scene.activeCamera;
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        let count = 0;
        for (const s of (dbg.samples || [])) {
            if (!(s.z > 2) || !(s.z < 45)) continue;
            scene.render();
            const v = BABYLON.Vector3.Project(
                new BABYLON.Vector3(s.x, (s.yBot + s.yTop) / 2, s.z),
                BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
                cam.viewport.toGlobal(W, H));
            if (Number.isFinite(v.x) && Number.isFinite(v.y) &&
                v.x > 20 && v.x < W - 20 && v.y > 20 && v.y < H - 20) count++;
        }
        return count;
    });
    console.log('BNET_MEASURE ' + JSON.stringify({ aniso, inFrame }));
    expect(inFrame, 'fence cloth missing from the ready frame').toBeGreaterThan(4);
});

test('NC: ?bnet_sabotage=1 reverts bnetTex aniso to 1 — structural gate fires', async ({ page }) => {
    await page.goto('/index.html?bnet_sabotage=1');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bnetSeated === true, null, { timeout: 20000 });
    const aniso = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        return scene.getMaterialByName('bnetMat').albedoTexture.anisotropicFilteringLevel;
    });
    console.log('BNET_NC ' + JSON.stringify({ aniso }));
    expect(aniso).toBe(1);
});

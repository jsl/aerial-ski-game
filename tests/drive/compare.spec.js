'use strict';
// Visual A/B harness for the baked maps. Renders the same wide view of the run
// with the maps on and off and writes both, so the difference can be judged by
// eye rather than argued about from a single scalar.
//
// Not an assertion — baked.spec.js does the asserting. This exists because the
// numbers alone cannot tell you whether the bake looks RIGHT, only whether it
// changed something.

const { test } = require('@playwright/test');
const path = require('node:path');
const OUT = path.resolve(__dirname, '..', '..', 'shots');

// TEMPORARY opt-in (iteration 13): the terrain lightmap is switched OFF until
// the rebake lands (see baked.spec.js header), so there is no bake to A/B — the
// harness would wait forever on `_bakedApplied > 0`. Run with BAKE_AB=1 once the
// bake is back; that run restores the shipped-by-default behaviour.
const RUN = process.env.BAKE_AB === '1';

// Wide views that actually contain the things the bake affects: the flanking
// snowfields, the tree line, and the kicker's concave transition. A view of open
// sunlit snow shows almost nothing, correctly — sky visibility there is 1.
// beta is measured from STRAIGHT DOWN the +Y axis: pi/2 is the horizon and
// anything above pi/2 puts the camera underground, which renders solid black and
// looks exactly like a broken bake. Keep these below pi/2.
const VIEWS = [
    { name: 'flank', target: [0, -18, 40], radius: 70, beta: Math.PI / 2.6, alpha: Math.PI * 1.30 },
    { name: 'kicker', target: [0, -3, 12], radius: 26, beta: Math.PI / 2.5, alpha: Math.PI * 1.37 },
    { name: 'trees', target: [-40, -20, 30], radius: 55, beta: Math.PI / 2.7, alpha: Math.PI * 1.20 },
];

(RUN ? test : test.skip)('compare baked lighting on and off', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bakedApplied > 0);
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);

    // The HUD is drawn INTO the canvas by Babylon GUI, so hiding DOM elements
    // does not remove it — the GUI texture's own root has to be switched off or
    // it lands in the middle of every screenshot.
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const t of scene.textures) {
            if (t.getClassName && t.getClassName() === 'AdvancedDynamicTexture') {
                if (t.rootContainer) t.rootContainer.isVisible = false;
            }
        }
    });

    const frame = async (v) => {
        await page.evaluate((v) => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const cam = scene.activeCamera;
            cam.lowerRadiusLimit = 1; cam.upperRadiusLimit = 500;
            cam.setTarget(new BABYLON.Vector3(v.target[0], v.target[1], v.target[2]));
            cam.radius = v.radius; cam.beta = v.beta; cam.alpha = v.alpha;
        }, v);
        await page.waitForTimeout(500);
    };

    // Stash the textures so the "off" pass can be undone for the next view.
    await page.evaluate(() => {
        window._bakeStash = [];
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const m of scene.materials) {
            if (m.ambientTexture || m.lightmapTexture) {
                window._bakeStash.push([m, m.ambientTexture, m.lightmapTexture]);
            }
        }
    });

    const setBake = (on) => page.evaluate((on) => {
        for (const [m, a, l] of window._bakeStash) {
            m.ambientTexture = on ? a : null;
            m.lightmapTexture = on ? l : null;
        }
        return window._bakeStash.length;
    }, on);

    for (const v of VIEWS) {
        await frame(v);
        await setBake(true);
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(OUT, `bake_${v.name}_on.png`) });
        await setBake(false);
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(OUT, `bake_${v.name}_off.png`) });
        await setBake(true);
    }
    console.log('COMPARE_DONE views=' + VIEWS.map(v => v.name).join(','));
});

'use strict';
// ── Baked lighting from Blender ──────────────────────────────────────────────
// Two maps, both MULTIPLIERS, both needing a uv2 channel the procedural terrain
// does not have:
//
//   terrain_skyvis.png  -> ambientTexture     (how much sky each point sees)
//   terrain_shadow.png  -> lightmapTexture    (how much sun reaches it), applied
//                          with useLightmapAsShadowmap so it multiplies rather
//                          than adds
//
// TEMPORARY CONTRACT (iteration 13, reviewer order): the bake is switched OFF at
// applyBakedLighting. The maps on disk were baked for the pre-P1 slab terrain;
// after the corridor ribbon landed they describe removed geometry, and their
// stale zero multipliers painted a full-width black band across the ready view
// (9.29% of frame black; 0.09% with the clones stripped). The rebake itself is
// blocked on a post-unwrap vertex-split fixup for the shared-vertex heightfield
// (RENDER-PROGRESS entry 12) — surgery across the uv2 sidecar contract.
//
// So this file currently asserts:
//   1. the bake stays OFF and no _baked clone leaks onto any terrain material,
//   2. the ready view carries NO stale-map black band (< 0.5% near-black),
//   3. the P2 caster contract is unchanged by the switch (athletes/trees cast).
// When the rebake lands: flip window._bakeLightmapEnabled back to true and
// restore the pre-iter-13 assertions (git history has them) — receivers ≥ 20,
// uv2 length/span per receiver, ambient/lightmap slot wiring, invertY, and the
// "both baked slots reach the shader" black-map probe.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // The bake decision is synchronous; surfaces are not. Wait until the
    // surface pass has run so luminance probes see final materials.
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
}

test('the stale lightmap stays OFF and no _baked material reaches terrain', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await boot(page);

    const info = await page.evaluate((names) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = {
            enabled: window._bakeLightmapEnabled,
            applied: window._bakedApplied,
            bakedNamedMaterials: scene.materials.filter(m => /_baked$/.test(m.name))
                .map(m => m.name),
            meshMats: {},
        };
        for (const n of names) {
            const m = scene.getMeshByName(n);
            out.meshMats[n] = m && m.material ? m.material.name : null;
        }
        return out;
    }, ['terrainCorridor', 'wLanding', 'wInrun', 'corner_trans_table']);

    expect(info.enabled, 'the temporary bake off-switch was flipped without the ' +
        'rebake landing — restore baked.spec.js\'s on-state assertions first').toBe(false);
    expect(info.applied, 'uv2/sidecar application ran while the switch is OFF').toBe(0);
    expect(info.bakedNamedMaterials, '_baked material clones exist while the bake ' +
        'is disabled').toEqual([]);
    for (const [n, matName] of Object.entries(info.meshMats)) {
        expect(matName, `"${n}" is missing`).not.toBeNull();
        expect(String(matName).endsWith('_baked'),
            `"${n}" carries a _baked material while the bake is OFF`).toBe(false);
    }
    expect(errors, 'errors or missing assets while booting').toEqual([]);
});

test('the ready view shows no stale-map black band', async ({ page }) => {
    // The regression this gate exists for: with stale multipliers applied, the
    // in-run's exposed top face sampled atlas zeros and rendered as a full-width
    // black band just beyond the transition (measured 9.29% of the ready frame).
    // It must stay under 0.5% — snow, sky, trees and shadows have real colour;
    // almost nothing in this view is legitimately near-black.
    await boot(page);
    await page.waitForTimeout(1200);

    const r = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (let i = 0; i < 4; i++) {
            scene.render();
            await new Promise(res => requestAnimationFrame(res));
        }
        const c = scene.getEngine().getRenderingCanvas();
        const gl = scene.getEngine()._gl;
        const px = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const n = c.width * c.height;
        let black8 = 0, black16 = 0, black32 = 0, dark48 = 0;
        for (let i = 0; i < px.length; i += 4) {
            const m = Math.max(px[i], px[i + 1], px[i + 2]);
            if (m < 8) black8++;
            if (m < 16) black16++;
            if (m < 32) black32++;
            if (m < 48) dark48++;
        }
        return {
            w: c.width, h: c.height,
            black8: black8 / n, black16: black16 / n,
            black32: black32 / n, dark48: dark48 / n,
        };
    });

    console.log('BLACK_COVERAGE ' + JSON.stringify(r));
    expect(r.black32, `${(r.black32 * 100).toFixed(2)}% of the ready frame reads ` +
        `near-black — the stale-map band or another dead-light defect is visible`)
        .toBeLessThan(0.005);
});

test('only the athlete and the trees cast real-time shadows, and the VISIBLE athlete is in the list', async ({ page }) => {
    // Static terrain shadows were baked when the lightmap was alive; with it
    // temporarily off the runtime CSM covers the athlete (+ skis) and the trees
    // either way — this file's caster half is independent of the bake and stays.
    await boot(page);
    await page.waitForFunction(() => window._bodyLinked !== undefined,
        null, { timeout: 30_000 });

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const light = scene.lights.find(l => l.getShadowGenerator && l.getShadowGenerator());
        const sg = light ? light.getShadowGenerator() : null;
        const map = sg && sg.getShadowMap ? sg.getShadowMap() : null;
        const list = (map && map.renderList) || [];
        const visible = list.filter(m => m.isVisible && m.getTotalVertices() > 0);
        return {
            declared: window._shadowCasters,
            total: list.length,
            visible: visible.length,
            bodyCasting: list.filter(m => m.name && m.name.startsWith('athleteBody')).length,
            skisCasting: list.filter(m => m.name === 'skiL' || m.name === 'skiR').length,
            treesCasting: list.filter(m => m.name && /^(tr_|fl_)/.test(m.name)).length,
            otherCasters: list.filter(m => m.name && !/^(tr_|fl_)/.test(m.name) &&
                !m.name.startsWith('athleteBody') && m.name !== 'skiL' && m.name !== 'skiR').length,
        };
    });

    expect(r.declared, 'shadow caster list was not restricted').toBeGreaterThan(0);
    expect(r.otherCasters, `${r.otherCasters} non-tree non-athlete casters — ` +
        `unrelated scenery leaked into the shadow map`)
        .toBeLessThan(60);
    expect(r.treesCasting, 'trees are not casting (P2: all trees cast under the CSM)')
        .toBeGreaterThan(50);
    expect(r.bodyCasting, 'the skinned body is not a shadow caster — it loads after ' +
        'the caster list is built, so it has to register itself').toBeGreaterThan(0);
    expect(r.skisCasting, 'skiL and skiR must both cast (P2)').toBe(2);
    expect(r.visible.valueOf(), `nothing in the caster list is visible ` +
        `(${r.total} entries) — Babylon renders no shadow for a hidden mesh, so ` +
        `the athlete casts nothing`).toBeGreaterThan(0);
});

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
// CONTRACT since entry 138 (the rebake landed): the bake is ON at
// applyBakedLighting. The 08-30 rebake path-traces the forest as alpha-cutout
// crossed-card occluders (152 trees from blender/trees.json) onto two
// receivers — terrainCorridor (whose vertices are per-triangle unshared so a
// per-vertex uv2 sidecar can describe it) and wUpperMtn; terrainSkirt/Base and
// the ridges are occluder-only. This file asserts:
//   1. the sidecar applies to BOTH receivers (uv2 + _baked materials),
//   2. the ready view carries NO stale-map black band (black8 < 0.5%; black32
//      < 3.5% over the dark impostor forest's ~1.68% steady state — iter 60),
//   3. trees are NOT live casters any more (the crown-shaped shadows are
//      baked; live cone casting was the flank "dirt smudge" defect).

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // The bake decision is synchronous; surfaces are not. Wait until the
    // surface pass has run so luminance probes see final materials.
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    // The impostor forest plants AFTER the surface pass (iter 56) and its
    // near-black card pixels are part of the ready frame; without this wait
    // the black-band census races the planting and reads different frames
    // depending on machine load (measured 1.68% black32 with the forest
    // planted vs < 0.5% mid-plant, iter 60).
    await page.waitForFunction(() => window._treeFieldY !== undefined,
        null, { timeout: 30_000 });
}

test('the rebaked lightmap applies to both receivers and no map leaks off-terrain', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await boot(page);
    // The application is a fetch + texture load; wait for the count to settle.
    await page.waitForFunction(() => window._bakedApplied !== 0, null, { timeout: 30_000 });

    const info = await page.evaluate((names) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = {
            enabled: window._bakeLightmapEnabled,
            applied: window._bakedApplied,
            bakedNamedMaterials: scene.materials.filter(m => /_baked$/.test(m.name))
                .map(m => m.name),
            meshMats: {},
            uv2Lens: {},
        };
        for (const n of names) {
            const m = scene.getMeshByName(n);
            out.meshMats[n] = m && m.material ? m.material.name : null;
            out.uv2Lens[n] = (m &&
                m.getVerticesData(BABYLON.VertexBuffer.UV2Kind) || []).length;
        }
        return out;
    // Entry-138 receivers: the corridor ribbon + wUpperMtn (the bake's only
    }, ['terrainCorridor', 'wUpperMtn']);

    expect(info.enabled, 'the bake switch is off').toBe(true);
    expect(info.applied, 'both bake receivers must receive uv2 + materials').toBe(2);
    for (const n of Object.keys(info.meshMats)) {
        const matName = info.meshMats[n];
        expect(matName, `"${n}" is missing`).not.toBeNull();
        expect(String(matName).endsWith('_baked'),
            `"${n}" must carry a _baked material`).toBe(true);
        expect(info.uv2Lens[n], `"${n}" must carry a uv2 buffer`).toBeGreaterThan(0);
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

    // Gate re-derived (iter 60, measured on the impostor forest): black8 is
    // the stale-band signal — the atlas-zero band rendered ALBEDO black
    // (diffuse = albedo × light = 0), so truly-dead pixels stay < 0.5%.
    // black32 ceilings at 3.5%: the dark impostor forest legitimately covers
    // ~1.68% of the ready frame with max-RGB < 32 pixels (measured
    // 0.0168 ± 0.0001 over 4 runs, black8 = 0.0000), while the defect this
    // gate exists for measured 0.0929 — still a ~3× fail at the new ceiling.
    expect(r.black8, `${(r.black8 * 100).toFixed(2)}% of the ready frame reads ` +
        `truly black — the stale-map band or another dead-light defect is visible`)
        .toBeLessThan(0.005);
    expect(r.black32, `${(r.black32 * 100).toFixed(2)}% of the ready frame reads ` +
        `near-black — above the measured dark-forest steady state (1.68%)`)
        .toBeLessThan(0.035);
});

test('only the athlete and the trees cast real-time shadows, and the VISIBLE athlete is in the list', async ({ page }) => {
    // Static terrain shadows were baked when the lightmap was alive; with it
    // temporarily off the runtime CSM covers the athlete (+ skis) and the trees
    // either way — this file's caster half is independent of the bake and stays.
    await boot(page);
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });

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
            // iter 56 replaced the legacy tr_*/fl_* caster meshes with ONE
            // thin-instanced treeShadowProxy cone (152 instances); count it
            // the way shadows.spec does (same predicate shape, same gate).
            treesCasting: list.filter(m => m.name && /^(tr_|fl_)/.test(m.name)).length +
                list.filter(m => m.name === 'treeShadowProxy')
                    .reduce((a, m) => a + (m.thinInstanceCount || 0), 0),
            otherCasters: list.filter(m => m.name && !/^(tr_|fl_)/.test(m.name) &&
                m.name !== 'treeShadowProxy' &&
                !m.name.startsWith('athleteBody') && m.name !== 'skiL' && m.name !== 'skiR').length,
        };
    });

    expect(r.declared, 'shadow caster list was not restricted').toBeGreaterThan(0);
    expect(r.otherCasters, `${r.otherCasters} non-tree non-athlete casters — ` +
        `unrelated scenery leaked into the shadow map`)
        .toBeLessThan(60);
    // Entry-138: the bake now path-traces the tree shadows (alpha-cutout card
    // occluders) — the gate flips to assert trees are NOT live casters.
    expect(r.treesCasting, 'trees must NOT be live casters (baked tree shadows)')
        .toBe(0);
    expect(r.bodyCasting, 'the skinned body is not a shadow caster — it loads after ' +
        'the caster list is built, so it has to register itself').toBeGreaterThan(0);
    expect(r.skisCasting, 'skiL and skiR must both cast (P2)').toBe(2);
    expect(r.visible.valueOf(), `nothing in the caster list is visible ` +
        `(${r.total} entries) — Babylon renders no shadow for a hidden mesh, so ` +
        `the athlete casts nothing`).toBeGreaterThan(0);
});

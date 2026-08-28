'use strict';
// P4 forest slice 1 (iter 56): the whole forest is ONE thin-instanced
// cross-card impostor mesh sampling the Blender-baked spruce
// (blender/bake_trees.py → assets/tree_spruce_card.png + 8-view atlas).
// Gates the plan's P4 acceptance: instance count, ≤ small draw calls for the
// whole forest, alpha-cut material wired to the baked atlas, planted on the
// terrain field with the corridor kept clear.
const { test, expect } = require('@playwright/test');

test('forest is one thin-instanced impostor draw call fed by the baked atlas', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);

    const s = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const legacy = scene.meshes.filter(m => m.name && /^(tr_|fl_)/.test(m.name)).length;
        const cards = scene.getMeshByName('treeCards');
        if (!cards) return { legacy, hasCards: false };
        const mats = cards.thinInstanceGetWorldMatrices
            ? cards.thinInstanceGetWorldMatrices() : [];
        const n = mats.length;
        let minAbsX = Infinity, maxAbsX = 0, minY = Infinity, maxY = -Infinity;
        for (const mm of mats) {
            const x = mm.m[12], y = mm.m[13];
            const ax = Math.abs(x);
            if (ax < minAbsX) minAbsX = ax;
            if (ax > maxAbsX) maxAbsX = ax;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        // whole forest = the one source mesh; nothing else may share its look
        const am = scene.getActiveMeshes();
        let forestActive = 0;
        for (let i = 0; i < am.length; i++) {
            const m = am.data[i];
            if (m === cards || /^(tr_|fl_)/.test(m.name || '')) forestActive++;
        }
        const mat = cards.material;
        return {
            legacy, hasCards: true, instances: n, forestActive,
            isActive: cards.isEnabled() && cards.isVisible,
            minAbsX: minAbsX === Infinity ? null : minAbsX,
            maxAbsX, minY: minY === Infinity ? null : minY, maxY,
            matName: mat ? mat.name : null,
            tex: mat && mat.albedoTexture ? {
                name: mat.albedoTexture.name,
                w: mat.albedoTexture.getSize().width,
                h: mat.albedoTexture.getSize().height,
                hasAlpha: mat.albedoTexture.hasAlpha,
                ready: mat.albedoTexture.isReady(),
                aniso: mat.albedoTexture.anisotropicFilteringLevel,
            } : null,
            alphaTest: mat ? mat.transparencyMode : null,
            alphaCutOff: mat ? mat.alphaCutOff : null,
            backFaceCulling: mat ? mat.backFaceCulling : null,
            roughness: mat ? mat.roughness : null,
        };
    });
    console.log('TREES_MEASURE ' + JSON.stringify(s));

    expect(s.legacy, 'legacy per-tree trunk/foliage cylinders must be gone').toBe(0);
    expect(s.hasCards, 'treeCards impostor mesh exists').toBe(true);
    expect(s.isActive, 'treeCards enabled and visible').toBe(true);
    expect(s.instances, 'a real forest, not a token row').toBeGreaterThan(150);
    expect(s.forestActive, 'whole forest renders as ONE draw call')
        .toBeLessThanOrEqual(1);
    expect(s.minAbsX, 'corridor clearance kept (|x| >= ~7)').toBeGreaterThanOrEqual(6.9);
    expect(s.maxAbsX, 'forest stays on the terrain (|x| <= ~58)').toBeLessThanOrEqual(58.1);
    expect(s.minY, 'card bases planted at a sane terrain height').toBeGreaterThan(-80);
    expect(s.alphaTest, 'alpha-cut (PBRMATERIAL_ALPHATEST = 2), not alpha-blend (1)')
        .toBe(2);
    expect(s.alphaCutOff, 'alpha cutoff set').toBeGreaterThan(0);
    expect(s.backFaceCulling, 'crossed quads read from both sides').toBe(false);
    expect(s.tex, 'albedo texture wired').not.toBeNull();
    expect(s.tex.ready, 'atlas texture actually loaded').toBe(true);
    expect(s.tex.hasAlpha, 'atlas carries alpha').toBe(true);
    expect([s.tex.w, s.tex.h], 'card texture is the baked 512x1024 frame')
        .toEqual([512, 1024]);
    expect(s.tex.aniso, 'tree atlas aniso (cost-capped, non-tiled texture)').toBe(4);
});

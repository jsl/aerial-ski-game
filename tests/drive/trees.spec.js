'use strict';
// P4 forest slice 1 (iter 56): the whole forest is ONE thin-instanced
// cross-card impostor mesh sampling the Blender-baked spruce
// (blender/bake_trees.py → assets/tree_spruce_card.png + 8-view atlas).
// Gates the plan's P4 acceptance: instance count, ≤ small draw calls for the
// whole forest, alpha-cut material wired to the baked atlas, planted on the
// terrain field with the corridor kept clear.
//
// Iter 59: orientation + seating gates (reviewer URGENT after iter 56 —
// the forest rendered UPSIDE DOWN because the card texture was built with
// invertY = false, the glTF convention, instead of Babylon's default true
// for a hand-authored upright PNG on default plane UVs). Gates:
//   - the material's invertY is true (the render-side half of the contract),
//   - the card PNG itself is authored upright (trunk/needles dense in the
//     bottom rows, transparent sky in the top corners — the bake-side half),
//   - every instance base sits on the visual field it was planted on
//     (|plant y − _treeFieldY(x,z)| tiny; card geometry base is y=0 local).
const { test, expect } = require('@playwright/test');

test('forest is one thin-instanced impostor draw call fed by the baked atlas', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);

    const s = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const legacy = scene.meshes.filter(m => m.name && /^(tr_|fl_)/.test(m.name)).length;
        const cards = scene.getMeshByName('treeCards');
        if (!cards) return { legacy, hasCards: false };
        const mats = cards.thinInstanceGetWorldMatrices
            ? cards.thinInstanceGetWorldMatrices() : [];
        const n = mats.length;
        let minAbsX = Infinity, maxAbsX = 0, minY = Infinity, maxY = -Infinity;
        let seatWorst = 0;
        const fieldY = window._treeFieldY;
        for (const mm of mats) {
            const x = mm.m[12], y = mm.m[13], z = mm.m[14];
            const ax = Math.abs(x);
            if (ax < minAbsX) minAbsX = ax;
            if (ax > maxAbsX) maxAbsX = ax;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (fieldY) {
                seatWorst = Math.max(seatWorst, Math.abs(y - fieldY(x, z)));
            }
        }
        // whole forest = the one source mesh; nothing else may share its look
        const am = scene.getActiveMeshes();
        let forestActive = 0;
        for (let i = 0; i < am.length; i++) {
            const m = am.data[i];
            if (m === cards || /^(tr_|fl_)/.test(m.name || '')) forestActive++;
        }
        const mat = cards.material;

        // Local geometry base from the vertex buffer — NOT getBoundingInfo(),
        // which on a thin-instanced mesh reports world bounds across every
        // instance (≈ the lowest planting on the hill).
        const pos = cards.getVerticesData('position');
        let localMinY = Infinity;
        for (let i = 1; i < pos.length; i += 3) localMinY = Math.min(localMinY, pos[i]);
        const bboxMinY = Math.round(localMinY * 1e6) / 1e6;

        // Card PNG row order, sampled in-page: draw the exact texture the
        // material uses onto a canvas and measure alpha by band/corner.
        let card = null;
        try {
            const url = mat.albedoTexture.url;
            const img = new Image();
            img.src = url;
            await img.decode();
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height).data;
            const w = cv.width, h = cv.height;
            const alphaAt = (px, py) => d[(py * w + px) * 4 + 3] / 255;
            const NB = 8; // horizontal bands, index 0 = BOTTOM rows
            const bands = new Array(NB).fill(0);
            for (let py = 0; py < h; py++) {
                const b = Math.min(NB - 1, Math.floor((py / h) * NB));
                let op = 0;
                for (let px = 0; px < w; px++) if (d[(py * w + px) * 4 + 3] >= 128) op++;
                bands[b] += op / w;
            }
            for (let b = 0; b < NB; b++) bands[b] /= (h / NB);
            const cornerBox = (x0, y0) => {
                let mx = 0;
                for (let py = y0; py < y0 + 48; py++)
                    for (let px = x0; px < x0 + 48; px++) mx = Math.max(mx, alphaAt(px, py));
                return mx;
            };
            let botCentre = 0;
            for (let py = h - 96; py < h; py++) {
                let acc = 0;
                for (let px = (w >> 1) - 48; px < (w >> 1) + 48; px++) acc += alphaAt(px, py);
                botCentre += acc / 96;
            }
            card = {
                w, h,
                bands: bands.map(v => Math.round(v * 1e4) / 1e4),
                topCornerMaxAlpha: Math.round(Math.max(cornerBox(0, 0), cornerBox(w - 48, 0)) * 1e4) / 1e4,
                bottomCentreMeanAlpha: Math.round((botCentre / 96) * 1e4) / 1e4,
            };
        } catch (e) {
            card = { error: String(e) };
        }

        return {
            legacy, hasCards: true, instances: n, forestActive,
            isActive: cards.isEnabled() && cards.isVisible,
            minAbsX: minAbsX === Infinity ? null : minAbsX,
            maxAbsX, minY: minY === Infinity ? null : minY, maxY,
            seatWorst: Math.round(seatWorst * 1e6) / 1e6,
            bboxMinY,
            hasFieldProbe: !!fieldY,
            matName: mat ? mat.name : null,
            tex: mat && mat.albedoTexture ? {
                name: mat.albedoTexture.name,
                w: mat.albedoTexture.getSize().width,
                h: mat.albedoTexture.getSize().height,
                hasAlpha: mat.albedoTexture.hasAlpha,
                ready: mat.albedoTexture.isReady(),
                aniso: mat.albedoTexture.anisotropicFilteringLevel,
                invertY: mat.albedoTexture.invertY,
            } : null,
            card,
            alphaTest: mat ? mat.transparencyMode : null,
            alphaCutOff: mat ? mat.alphaCutOff : null,
            alphaTestIsCut: mat
                ? mat.transparencyMode === BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST
                : null,
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
    expect(s.hasFieldProbe, 'window._treeFieldY probe exposed').toBe(true);
    expect(s.bboxMinY, 'card local geometry base is y=0 (trunk row at the quad base)')
        .toBeGreaterThanOrEqual(-0.01);
    expect(s.bboxMinY).toBeLessThanOrEqual(0.01);
    expect(s.seatWorst,
        'every instance base sits on the field it was planted on (seating)')
        .toBeLessThanOrEqual(0.02);
    expect(s.alphaTestIsCut,
        'alpha-cut mode: transparencyMode === PBRMATERIAL_ALPHATEST ' +
        '(= MATERIAL_ALPHATEST = 1; measured 1 IS the alpha-cut mode, ' +
        'ALPHA_BLEND is 2)')
        .toBe(true);
    expect(s.alphaCutOff, 'alpha cutoff set').toBeGreaterThan(0);
    expect(s.backFaceCulling, 'crossed quads read from both sides').toBe(false);
    expect(s.tex, 'albedo texture wired').not.toBeNull();
    expect(s.tex.ready, 'atlas texture actually loaded').toBe(true);
    expect(s.tex.hasAlpha, 'atlas carries alpha').toBe(true);
    expect([s.tex.w, s.tex.h], 'card texture is the baked 512x1024 frame')
        .toEqual([512, 1024]);
    expect(s.tex.aniso, 'tree atlas aniso (cost-capped, non-tiled texture)').toBe(4);
    // V orientation — the iter-56 regression. Both halves of the contract:
    expect(s.tex.invertY,
        'card texture must flip on upload (invertY=true, Babylon default); ' +
        'invertY=false is the glTF convention and rendered the forest tip-down')
        .toBe(true);
    expect(s.card.error, 'card PNG sampled without error').toBeUndefined();

    // The bake-side half: the PNG on disk must be authored upright. For this
    // cone-stack spruce the opaque coverage per horizontal band INCREASES
    // upward (dense layered spire, sparse lowest whorl): bands bottom→top
    // 0.199 → 0.708 (measured, strictly monotone). The unambiguous signals
    // are the corners (transparent sky at the top) and the trunk at the
    // bottom centre; a flipped image has alpha at the top corners and a
    // narrow tip spike (not trunk) at the bottom centre.
    const b = s.card.bands;
    expect(b[0], 'bottom band coverage (sparse lowest whorl)')
        .toBeLessThan(0.25);
    expect(b[7], 'top band coverage (dense layered spire)').toBeGreaterThan(0.60);
    expect(b[7] > 2.5 * b[0],
        'coverage increases strongly upward: bottom ' + b[0] + ' top ' + b[7])
        .toBe(true);
    for (let i = 1; i < b.length; i++) {
        expect(b[i] >= b[i - 1],
            'band ' + i + ' coverage non-decreasing upward (' + b[i - 1] +
            ' → ' + b[i] + ')').toBe(true);
    }
    expect(s.card.topCornerMaxAlpha,
        'top corners are transparent sky (alpha ~0 at the frame top edges)')
        .toBeLessThan(0.02);
    expect(s.card.bottomCentreMeanAlpha,
        'bottom centre rows are opaque trunk')
        .toBeGreaterThan(0.60);
});

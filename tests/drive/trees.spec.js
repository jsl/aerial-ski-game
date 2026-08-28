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
            const NB = 16; // horizontal bands, index 0 = the file's TOP rows
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
            // Row runs: contiguous spans of visible (>0.02 mean alpha) rows.
            // One sky run at the top, then ONE canopy run to the bottom —
            // any interior gap is the floating-fragment regression.
            const rowA = [];
            for (let py = 0; py < h; py++) {
                let a = 0;
                for (let px = 0; px < w; px++) a += alphaAt(px, py);
                rowA.push(a / w);
            }
            const runs = [];
            let cur = null;
            for (let py = 0; py < h; py++) {
                const vis = rowA[py] > 0.02;
                if (!cur || cur.vis !== vis) {
                    cur = { vis, top: py / h, bot: py / h };
                    runs.push(cur);
                } else cur.bot = py / h;
            }
            // Per-band opaque width fraction (16 bands, top-down) for the
            // taper gate, plus colour + trunk measures.
            const widths = new Array(NB).fill(0);
            let rSum = 0, gSum = 0, bSum = 0, n = 0;
            for (let py = 0; py < h; py++) {
                const band = Math.min(NB - 1, Math.floor((py / h) * NB));
                let wRow = 0;
                for (let px = 0; px < w; px++) {
                    const i = (py * w + px) * 4;
                    if (d[i + 3] >= 128) {
                        wRow++;
                        rSum += d[i] / 255; gSum += d[i + 1] / 255;
                        bSum += d[i + 2] / 255; n++;
                    }
                }
                widths[band] += wRow / w;
            }
            for (let bI = 0; bI < NB; bI++) widths[bI] /= (h / NB);
            const lumMean = n ? (0.2126 * rSum + 0.7152 * gSum + 0.0722 * bSum) / n : 0;
            // Trunk zone = rows 85-97%: centre 96 px vs the outer columns.
            let trunkCentre = 0, trunkSides = 0;
            const y0 = Math.round(0.85 * h), y1 = Math.round(0.97 * h);
            for (let py = y0; py < y1; py++) {
                let c = 0, s = 0;
                for (let px = 0; px < w; px++) {
                    const a = alphaAt(px, py);
                    if (Math.abs(px - (w >> 1)) < 48) c += a;
                    else if (px < 0.06 * w || px > 0.94 * w) s += a;
                }
                trunkCentre += c / 96;
                trunkSides += s / Math.round(0.06 * w) / 2;
            }
            trunkCentre /= (y1 - y0);
            trunkSides /= (y1 - y0);
            card = {
                w, h,
                bands: bands.map(v => Math.round(v * 1e4) / 1e4),
                runs: runs.map(r => ({ vis: r.vis, top: +r.top.toFixed(4), bot: +r.bot.toFixed(4) })),
                widths: widths.map(v => Math.round(v * 1e4) / 1e4),
                lum: Math.round(lumMean * 1e4) / 1e4,
                meanRGB: n ? [+(rSum / n).toFixed(3), +(gSum / n).toFixed(3), +(bSum / n).toFixed(3)] : [0, 0, 0],
                trunkCentre: Math.round(trunkCentre * 1e4) / 1e4,
                trunkSides: Math.round(trunkSides * 1e4) / 1e4,
                topCornerMaxAlpha: Math.round(Math.max(cornerBox(0, 0), cornerBox(w - 48, 0)) * 1e4) / 1e4,
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

    // The bake-side half: the PNG on disk must be authored upright AND be a
    // coherent conifer. Iter 62 re-derived these gates for the re-rendered
    // bake (camera-orbit + pinned ortho fit: the old card cropped the tree
    // into a floating top fragment and wiped the branch droop, rendering
    // columnar spike stacks). Bands index 0 = the file's TOP rows (canvas
    // py=0). Measured on the new bake: sky margin 0-8.4%, then ONE
    // contiguous canopy run to the file bottom; width taper monotone
    // 0.027 → 0.842 → trunk 0.07; trunk bands brown, canopy bands green.
    expect(s.card.runs[0].vis, 'the file starts with an empty sky margin')
        .toBe(false);
    expect(s.card.runs[0].bot, 'sky margin above the tip (whole tree in frame)')
        .toBeGreaterThan(0.0);
    expect(s.card.runs[0].bot, 'tip not cropped by the frame top')
        .toBeLessThanOrEqual(0.12);
    const interiorGaps = s.card.runs.filter(
        (r, i) => i > 0 && i < s.card.runs.length - 1 && !r.vis);
    expect(interiorGaps.length,
        'no empty row-run inside the canopy body (the iter-60 floating ' +
        'fragment regression): ' + JSON.stringify(s.card.runs))
        .toBe(0);
    expect(s.card.runs[s.card.runs.length - 1].vis,
        'the canopy runs through the file bottom (trunk seated at the base)')
        .toBe(true);

    // Conifer taper: the widest row-band sits in the lower third and every
    // band ABOVE it is narrower (≤ +12% noise tolerance), with the top band
    // ≤ 25% of the widest (review-60 (a)).
    const wMax = Math.max(...s.card.widths);
    const wMaxBand = s.card.widths.indexOf(wMax);
    expect(wMaxBand, 'widest whorl in the lower third of the card')
        .toBeGreaterThanOrEqual(10);
    for (let i = 1; i <= wMaxBand; i++) {
        expect(s.card.widths[i - 1] <= s.card.widths[i] * 1.12 + 0.004,
            'width shrinks monotonically toward the tip below band ' + i +
            ' (' + s.card.widths[i - 1] + ' vs ' + s.card.widths[i] + ')')
            .toBe(true);
    }
    expect(s.card.widths[0], 'top band ≤ 25% of the widest whorl (spire)')
        .toBeLessThanOrEqual(0.25 * wMax);

    // Colour: the impostor must not read as a black silhouette against the
    // snow (review-60 (b)): mean solid-pixel luminance ≥ 0.18, green leads.
    expect(s.card.lum, 'mean impostor luminance ≥ 0.18, got ' + s.card.lum)
        .toBeGreaterThanOrEqual(0.18);
    expect(s.card.meanRGB[1], 'green channel leads the canopy mean')
        .toBeGreaterThan(s.card.meanRGB[0]);
    expect(s.card.meanRGB[1]).toBeGreaterThan(s.card.meanRGB[2]);

    // Trunk visible over the bottom ~15%: opaque at the centre line, sky at
    // the base sides (no canopy skirt down there).
    expect(s.card.trunkCentre, 'trunk column present at the base')
        .toBeGreaterThan(0.05);
    expect(s.card.trunkSides, 'no canopy at the base sides (bare trunk)')
        .toBeLessThan(0.01);

    expect(s.card.topCornerMaxAlpha,
        'top corners are transparent sky (alpha ~0 at the frame top edges)')
        .toBeLessThan(0.02);
});

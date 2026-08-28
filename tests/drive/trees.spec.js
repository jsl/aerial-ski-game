'use strict';
// P4 forest slices 1+3: the forest is thin-instanced cross-card impostors
// sampling FOUR distinct Blender-baked spruce variants
// (blender/bake_trees.py → assets/tree_spruce_card_0..3.png + 8-view atlases).
// Gates the plan's P4 acceptance: instance count, ≤ 20 draw calls for the whole
// forest (4 shipped: one per variant mesh), alpha-cut materials wired to the
// baked cards, planted on the terrain with the corridor kept clear.
//
// Iter 59: orientation + seating gates (reviewer URGENT after iter 56 —
// the forest rendered UPSIDE DOWN because the card texture was built with
// invertY = false, the glTF convention, instead of Babylon's default true
// for a hand-authored upright PNG on default plane UVs). Gates:
//   - the material's invertY is true (the render-side half of the contract),
//   - each card PNG is authored upright (trunk/needles dense in the bottom
//     rows, transparent sky in the top corners — the bake-side half),
//   - every instance base sits on the visual field it was planted on
//     (|plant y − _treeFieldY(x,z)| tiny; card geometry base is y=0 local).
//
// Iter 63 (review-60 (c)): species-variant gates — all four variant meshes
// present and populated (mix counts), per-instance scale inside the reviewer's
// 0.7–1.4 band with a real spread (no clone-row forest), per-variant conifer
// census (the iter-62 gates applied to every card), and a measurable
// silhouette difference between variants (16-band width-profile L1).
const { test, expect } = require('@playwright/test');

test('forest is thin-instanced impostor draw calls fed by the baked spruce variants', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);

    const s = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const legacy = scene.meshes.filter(m => m.name && /^(tr_|fl_)/.test(m.name)).length;
        const cardMeshes = scene.meshes.filter(m => /^treeCards\d+$/.test(m.name));
        if (!cardMeshes.length) return { legacy, hasCards: false };
        const fieldY = window._treeFieldY;

        // Shared-geometry check on variant 0's local quad: base at y=0. NOT
        // getBoundingInfo(), which on a thin-instanced mesh reports world
        // bounds across every instance (≈ the lowest planting on the hill).
        const pos = cardMeshes[0].getVerticesData('position');
        let localMinY = Infinity;
        for (let i = 1; i < pos.length; i += 3) localMinY = Math.min(localMinY, pos[i]);

        // Per-variant instance data straight off the thin-instance buffers.
        const variants = cardMeshes.map(m => {
            const mats = m.thinInstanceGetWorldMatrices
                ? m.thinInstanceGetWorldMatrices() : [];
            let seatWorst = 0, minAbsX = Infinity, maxAbsX = 0;
            let minS = Infinity, maxS = 0;
            let minY = Infinity;
            for (const mm of mats) {
                const x = mm.m[12], y = mm.m[13], z = mm.m[14];
                const ax = Math.abs(x);
                if (ax < minAbsX) minAbsX = ax;
                if (ax > maxAbsX) maxAbsX = ax;
                if (y < minY) minY = y;
                if (fieldY) seatWorst = Math.max(seatWorst, Math.abs(y - fieldY(x, z)));
                // Yaw-only rotation + uniform scale: the first column's norm
                // IS the per-instance scale.
                const sc = Math.hypot(mm.m[0], mm.m[1], mm.m[2]);
                if (sc < minS) minS = sc;
                if (sc > maxS) maxS = sc;
            }
            const mat = m.material;
            return {
                name: m.name,
                instances: mats.length,
                minAbsX: minAbsX === Infinity ? null : Math.round(minAbsX * 1e4) / 1e4,
                maxAbsX: Math.round(maxAbsX * 1e4) / 1e4,
                minY: minY === Infinity ? null : minY,
                seatWorst: Math.round(seatWorst * 1e6) / 1e6,
                minS: minS === Infinity ? null : Math.round(minS * 1e4) / 1e4,
                maxS: maxS === 0 ? null : Math.round(maxS * 1e4) / 1e4,
                isActive: m.isEnabled() && m.isVisible,
                localMinY: Math.round(localMinY * 1e6) / 1e6,
                matName: mat ? mat.name : null,
                tex: mat && mat.albedoTexture ? {
                    url: mat.albedoTexture.url,
                    w: mat.albedoTexture.getSize().width,
                    h: mat.albedoTexture.getSize().height,
                    hasAlpha: mat.albedoTexture.hasAlpha,
                    ready: mat.albedoTexture.isReady(),
                    aniso: mat.albedoTexture.anisotropicFilteringLevel,
                    invertY: mat.albedoTexture.invertY,
                } : null,
                alphaTestIsCut: mat
                    ? mat.transparencyMode === BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST
                    : null,
                alphaCutOff: mat ? mat.alphaCutOff : null,
                backFaceCulling: mat ? mat.backFaceCulling : null,
            };
        });

        // Forest draw calls: active card meshes (one per variant) — the plan's
        // P4 cap is ≤ 20 for the whole forest.
        let forestActive = 0;
        const am = scene.getActiveMeshes();
        for (let i = 0; i < am.length; i++) {
            if (/^treeCards\d+$/.test(am.data[i].name || '')) forestActive++;
        }

        // Card PNG census, sampled in-page per variant texture: draw the exact
        // texture the material uses onto a canvas and measure alpha/bands.
        const measureCard = async (url) => {
            try {
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
                // Row runs: contiguous spans of visible (>0.02 mean alpha)
                // rows. One sky run at the top, then ONE canopy run to the
                // bottom — any interior gap is the floating-fragment
                // regression.
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
                // Per-band opaque width fraction + colour + trunk measures.
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
                    let c = 0, sd = 0;
                    for (let px = 0; px < w; px++) {
                        const a = alphaAt(px, py);
                        if (Math.abs(px - (w >> 1)) < 48) c += a;
                        else if (px < 0.06 * w || px > 0.94 * w) sd += a;
                    }
                    trunkCentre += c / 96;
                    trunkSides += sd / Math.round(0.06 * w) / 2;
                }
                trunkCentre /= (y1 - y0);
                trunkSides /= (y1 - y0);
                const cornerBox = (x0, y0c) => {
                    let mx = 0;
                    for (let py = y0c; py < y0c + 48; py++)
                        for (let px = x0; px < x0 + 48; px++) mx = Math.max(mx, alphaAt(px, py));
                    return mx;
                };
                return {
                    w, h,
                    widths: widths.map(v => Math.round(v * 1e4) / 1e4),
                    runs: runs.map(r => ({ vis: r.vis, top: +r.top.toFixed(4), bot: +r.bot.toFixed(4) })),
                    lum: Math.round(lumMean * 1e4) / 1e4,
                    meanRGB: n ? [+(rSum / n).toFixed(3), +(gSum / n).toFixed(3), +(bSum / n).toFixed(3)] : [0, 0, 0],
                    trunkCentre: Math.round(trunkCentre * 1e4) / 1e4,
                    trunkSides: Math.round(trunkSides * 1e4) / 1e4,
                    topCornerMaxAlpha: Math.round(Math.max(cornerBox(0, 0), cornerBox(w - 48, 0)) * 1e4) / 1e4,
                };
            } catch (e) {
                return { error: String(e) };
            }
        };
        const cards = [];
        for (const v of variants) {
            cards.push(await measureCard(v.tex ? v.tex.url : 'about:blank'));
        }

        // Variant distinctness (review-60 (c): "no two neighbours match"):
        // pairwise L1 between the 16-band opaque-width profiles.
        const widthL1 = [];
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                const d = cards[i].widths.reduce(
                    (a, v, k) => a + Math.abs(v - (cards[j].widths[k] || 0)), 0);
                widthL1.push(+d.toFixed(4));
            }
        }

        return {
            legacy, hasCards: true,
            meshCount: cardMeshes.length,
            total: variants.reduce((a, v) => a + v.instances, 0),
            forestActive,
            hasFieldProbe: !!fieldY,
            minScale: Math.min(...variants.map(v => v.minS)),
            maxScale: Math.max(...variants.map(v => v.maxS)),
            widthL1,
            variants, cards,
        };
    });

    console.log('TREES_MEASURE ' + JSON.stringify(s));
    // ── Scene-side gates ────────────────────────────────────────────────────
    expect(s.legacy, 'legacy per-tree trunk/foliage cylinders must be gone').toBe(0);
    expect(s.hasCards, 'treeCards impostor meshes exist').toBe(true);
    expect(s.meshCount, 'FOUR spruce variant meshes (review-60 (c))').toBe(4);
    expect(s.total, 'a real forest, not a token row').toBeGreaterThan(150);
    for (const v of s.variants) {
        expect(v.isActive, v.name + ' enabled and visible').toBe(true);
        expect(v.instances, v.name + ' carries a real share of the forest (mix count)')
            .toBeGreaterThanOrEqual(15);
        expect(v.minAbsX, v.name + ' corridor clearance kept (|x| >= ~7)')
            .toBeGreaterThanOrEqual(6.9);
        expect(v.maxAbsX, v.name + ' forest stays on the terrain (|x| <= ~58)')
            .toBeLessThanOrEqual(58.1);
        expect(v.minY, v.name + ' card bases planted at a sane terrain height')
            .toBeGreaterThan(-80);
        expect(v.seatWorst, v.name + ' every instance base sits on its field (seating)')
            .toBeLessThanOrEqual(0.02);
        expect(v.localMinY, v.name + ' card local geometry base is y=0')
            .toBeGreaterThanOrEqual(-0.01);
        expect(v.localMinY).toBeLessThanOrEqual(0.01);
        expect(v.alphaTestIsCut, v.name + ' alpha-cut mode (PBRMATERIAL_ALPHATEST)').toBe(true);
        expect(v.alphaCutOff, v.name + ' alpha cutoff set').toBeGreaterThan(0);
        expect(v.backFaceCulling, v.name + ' crossed quads read from both sides').toBe(false);
        expect(v.tex, v.name + ' albedo texture wired').not.toBeNull();
        expect(v.tex.ready, v.name + ' card texture actually loaded').toBe(true);
        expect(v.tex.hasAlpha, v.name + ' card carries alpha').toBe(true);
        expect([v.tex.w, v.tex.h], v.name + ' card texture is the baked 512x1024 frame')
            .toEqual([512, 1024]);
        expect(v.tex.aniso, v.name + ' card aniso (cost-capped, non-tiled texture)').toBe(4);
        // V orientation — the iter-56 regression, both halves of the contract.
        expect(v.tex.invertY, v.name + ' card texture must flip on upload (invertY=true)')
            .toBe(true);
        expect(v.tex.url, v.name + ' samples its OWN variant card, not another’s')
            .toContain('_' + v.name.slice(-1) + '.png');
    }
    expect(s.forestActive, 'whole forest renders in ≤ 4 draw calls (plan cap 20)')
        .toBeLessThanOrEqual(4);

    // Review-60 (c) scale band + spread: per-instance 0.7–1.4, not a clone row.
    expect(s.minScale, 'instance scale ≥ 0.7 (review-60 (c))').toBeGreaterThanOrEqual(0.695);
    expect(s.maxScale, 'instance scale ≤ 1.4 (review-60 (c))').toBeLessThanOrEqual(1.405);
    expect(s.maxScale / s.minScale, 'real scale spread across the forest')
        .toBeGreaterThanOrEqual(1.5);
    expect(s.hasFieldProbe, 'window._treeFieldY probe exposed').toBe(true);

    // ── Card-census gates (bake-side half), per variant ────────────────────
    for (let vi = 0; vi < s.cards.length; vi++) {
        const card = s.cards[vi];
        const tag = 'card ' + vi;
        expect(card.error, tag + ' sampled without error').toBeUndefined();

        // Iter-62 gates re-derived for the camera-orbit bake. Bands index 0 =
        // the file's TOP rows (canvas py=0).
        expect(card.runs[0].vis, tag + ' starts with an empty sky margin').toBe(false);
        // Sky margin above the tip must EXIST (tip not cropped by the frame
        // top) but stay < 25%: every variant shares the 14.6 m card frame, so
        // the shortest variant (11.9 m) legitimately carries ~20% sky while
        // still dominating its card. The iter-62 bound (≤ 12%) described the
        // one 13.6 m tree and is meaningless across heights.
        expect(card.runs[0].bot, tag + ' tip not cropped, tree fills its card')
            .toBeLessThanOrEqual(0.25);
        const interiorGaps = card.runs.filter(
            (r, i) => i > 0 && i < card.runs.length - 1 && !r.vis);
        expect(interiorGaps.length, tag + ' no empty row-run inside the canopy body')
            .toBe(0);
        expect(card.runs[card.runs.length - 1].vis,
            tag + ' canopy runs through the file bottom (trunk seated)').toBe(true);

        // Conifer taper: widest band in the lower third, monotone toward the
        // tip, top band ≤ 25% of the widest (review-60 (a)).
        const wMax = Math.max(...card.widths);
        const wMaxBand = card.widths.indexOf(wMax);
        expect(wMaxBand, tag + ' widest whorl in the lower third')
            .toBeGreaterThanOrEqual(10);
        for (let i = 1; i <= wMaxBand; i++) {
            expect(card.widths[i - 1] <= card.widths[i] * 1.12 + 0.004,
                tag + ' width shrinks monotonically toward the tip below band ' + i)
                .toBe(true);
        }
        expect(card.widths[0], tag + ' top band ≤ 25% of the widest whorl (spire)')
            .toBeLessThanOrEqual(0.25 * wMax);

        // Colour (review-60 (b)): not a black silhouette; green leads.
        expect(card.lum, tag + ' mean impostor luminance ≥ 0.18, got ' + card.lum)
            .toBeGreaterThanOrEqual(0.18);
        expect(card.meanRGB[1], tag + ' green channel leads the canopy mean')
            .toBeGreaterThan(card.meanRGB[0]);
        expect(card.meanRGB[1]).toBeGreaterThan(card.meanRGB[2]);

        // Trunk visible over the bottom ~15%.
        expect(card.trunkCentre, tag + ' trunk column present at the base')
            .toBeGreaterThan(0.05);
        expect(card.trunkSides, tag + ' no canopy at the base sides (bare trunk)')
            .toBeLessThan(0.01);
        expect(card.topCornerMaxAlpha, tag + ' top corners are transparent sky')
            .toBeLessThan(0.02);
    }

    // Variants must be measurably DIFFERENT trees (review-60 (c): "no two
    // neighbours match"): every pairwise 16-band width-profile L1 ≥ 0.02
    // (the bake asserts the same gate from the PNGs directly).
    for (const d of s.widthL1) {
        expect(d, 'variant silhouette profiles distinct (L1 ' + d + ' < 0.02)')
            .toBeGreaterThanOrEqual(0.02);
    }
});

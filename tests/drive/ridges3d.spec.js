'use strict';
// ── P6 mountains are real 3D, not curtains (HUMAN TESTING #4 item 3) ───────
// The author: the ridgeline curtains "seem 2D, and we seem to have lost
// texture on them". NEXT.md (2026-08-29) gates:
//   1. every ridge mesh has bbox depth ≥ 20% of its width (a flat curtain
//      has zero depth — the negative control proves the gate catches one),
//   2. every ridge material is TEXTURED: an albedo map whose pixels actually
//      vary (rock/snow/forest banding from render/textures.js
//      makeRidgeSurface), not a flat colour.

const { test, expect } = require('@playwright/test');

// Gate predicate, evaluated in-page over a mesh list. Exported via
// window._ridge3dGate so the negative control can run the SAME predicate
// against a deliberately flat curtain and must fail it.
const GATE_SRC = `
    window._ridge3dGate = function (meshes) {
        const out = [];
        for (const m of meshes) {
            const b = m.getBoundingInfo().boundingBox;
            const mn = b.minimumWorld || b.minimum, mx = b.maximumWorld || b.maximum;
            const dx = mx.x - mn.x, dy = mx.y - mn.y, dz = mx.z - mn.z;
            const horiz = [dx, dz].sort((a, c) => c - a);
            const width = horiz[0], depth = horiz[1];
            const mat = m.material || {};
            // Pixel-level proof the albedo map is not a flat fill.
            let pxVar = 0;
            try {
                const ctx = mat.albedoTexture.getContext();
                const d = ctx.getImageData(0, 0, 64, 64).data;
                let sum = 0, sum2 = 0, n = 0;
                for (let i = 0; i < d.length; i += 16) {
                    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
                    sum += lum; sum2 += lum * lum; n++;
                }
                pxVar = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)) / 255;
            } catch (e) { pxVar = -1; }
            out.push({
                name: m.name,
                width, depth, height: dy,
                depthRatio: depth / width,
                hasAlbedoMap: !!mat.albedoTexture,
                pxVar,
            });
        }
        return out;
    };
`;

async function loadAndProbe(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.evaluate(GATE_SRC);
    return page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ridges = scene.meshes.filter(m => m.name && m.name.startsWith('ridge_')
            && m.getTotalVertices && m.getTotalVertices() > 0);
        return window._ridge3dGate(ridges);
    });
}

test('every ridge mesh has real depth and a textured, non-flat material', async ({ page }) => {
    const rows = await loadAndProbe(page);
    expect(rows.length).toBeGreaterThanOrEqual(8);   // 3 layers × 2 sides + back + ahead
    for (const r of rows) {
        expect(r.depthRatio).toBeGreaterThanOrEqual(0.20);
        expect(r.hasAlbedoMap).toBe(true);
        expect(r.pxVar).toBeGreaterThan(0.02);       // real banding, not a flat fill
    }
});

test('negative control: a flat curtain fails the depth+texture gate', async ({ page }) => {
    await loadAndProbe(page);
    const res = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        // A 1-triangle-thick vertical strip — exactly what the old curtains were.
        const flat = new BABYLON.Mesh('ridge_negctl_flat', scene);
        const vd = new BABYLON.VertexData();
        vd.positions = [0, 0, -300, 0, 0, 300, 0, 60, -300, 0, 60, 300];
        vd.indices = [0, 1, 2, 1, 3, 2];
        vd.normals = [];
        BABYLON.VertexData.ComputeNormals(vd.positions, vd.indices, vd.normals);
        vd.applyToMesh(flat);
        const flatMat = new BABYLON.PBRMaterial('ridgeMatNegCtl', scene);
        flatMat.albedoColor = new BABYLON.Color3(0.2, 0.3, 0.2);
        flat.material = flatMat;
        const [g] = window._ridge3dGate([flat]);
        flat.dispose(); flatMat.dispose();
        return g;
    });
    // Depth ratio ~0 (a flat wall) and/or no albedo map: the gate must catch it.
    const fails = res.depthRatio < 0.20 || !res.hasAlbedoMap || res.pxVar <= 0.02;
    expect(fails).toBe(true);
});

// ── Rendered contrast: the ridges must survive the atmosphere ─────────────
// HUMAN TESTING #4/#6: three GLM passes tuned the band map while the RENDERED
// ridges stayed pale felt, because scene fog on those materials flattened
// everything toward the fog colour. This gate measures the actual frame, on a
// ridge-only pixel mask built by differencing the scene shot with the ridge
// meshes hidden (whatever changes is ridge). Negative control: the fogged state.
const CONTRAST_SRC = `
    window._ridgeContrast = async function () {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const engine = scene.getEngine();
        const cam = scene.activeCamera;
        engine.stopRenderLoop();
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35;   // look.spec scene framing
        // Ridge-ONLY mask: with the peaks in (iter 116), hiding the ridges
        // swaps in peak pixels behind them — that backdrop-swap mask is not
        // the ridges' texture signal and dilutes the fogged control. The
        // peaks read snowier than the ridges (game.js peakMat UV, 30 m
        // snowline vs 80 m), so ridge-vs-peak differ and the mask survives.
        const ridges = scene.meshes.filter(m => m.name && m.name.startsWith('ridge_'));
        const grab = async () => { scene.render(); scene.render(); return engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight()); };
        const withR = await grab();
        ridges.forEach(m => m.setEnabled(false));
        const without = await grab();
        ridges.forEach(m => m.setEnabled(true));
        let n = 0, sum = 0, sum2 = 0;
        const total = withR.length / 4;
        for (let i = 0; i < withR.length; i += 4) {
            const d = Math.abs(withR[i] - without[i]) + Math.abs(withR[i+1] - without[i+1]) + Math.abs(withR[i+2] - without[i+2]);
            if (d < 12) continue;                       // not a ridge pixel
            const lum = (0.2126 * withR[i] + 0.7152 * withR[i+1] + 0.0722 * withR[i+2]) / 255;
            n++; sum += lum; sum2 += lum * lum;
        }
        const mean = n ? sum / n : 0, std = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
        return { maskFrac: n / total, meanLum: mean, stdLum: std };
    };
`;
// Measured 2026-08-29 (swiftshader, look.spec framing): fixed state mean 0.50 / std 0.165;
// fogged (rejected) state mean 0.63 / std 0.123 — thresholds sit between with margin.
// Re-measured 2026-08-29 22:40 after the author's "more sky" skyline (mid/far crests
// lowered, peaks scaled): with less ridge in frame the remaining ridge pixels are
// crest tops, so the fixed state reads mean 0.58 / std 0.175 and the fogged control
// 0.68 / 0.092 — the mean ceiling moves to 0.63 (margin ≥ 0.05 both ways); std unchanged.
// Re-measured 2026-08-30 after the band map's elevation axis was corrected (forest
// at the base, snow on the crests — HUMAN TESTING #11): the visible ridge pixels are
// now mostly forest, so the fixed state reads mean 0.32 / std 0.133 and the fogged
// control 0.57 / 0.118. The MEAN is the discriminator (0.25 apart); std floor 0.10.
const CONTRAST_MIN_STD = 0.10, CONTRAST_MAX_MEAN = 0.45, MASK_MIN = 0.02;

async function contrastProbe(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate(CONTRAST_SRC);
}

test('rendered ridge pixels keep contrast (not washed to the fog colour)', async ({ page }) => {
    await contrastProbe(page);
    const r = await page.evaluate(() => window._ridgeContrast());
    console.log('ridge contrast', JSON.stringify(r));
    expect(r.maskFrac).toBeGreaterThan(MASK_MIN);              // the ridges are actually in frame
    expect(r.stdLum).toBeGreaterThanOrEqual(CONTRAST_MIN_STD); // rock/snow/forest read as bands
    expect(r.meanLum).toBeLessThanOrEqual(CONTRAST_MAX_MEAN);  // not pale felt
});

test('negative control: fogged ridge materials fail the contrast gate', async ({ page }) => {
    await contrastProbe(page);
    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const n of ['ridgeMatNear', 'ridgeMatMid', 'ridgeMatFar']) {
            const m = scene.getMaterialByName(n); m.fogEnabled = true;
            // the pre-fix mixes, so this is exactly the state the author rejected
            const F = scene.fogColor, mix = { ridgeMatNear: 0.04, ridgeMatMid: 0.07, ridgeMatFar: 0.15 }[n];
            m.albedoColor = new BABYLON.Color3(1 + (F.r - 1) * mix, 1 + (F.g - 1) * mix, 1 + (F.b - 1) * mix);
        }
        return window._ridgeContrast();
    });
    console.log('ridge contrast (fogged)', JSON.stringify(r));
    expect(r.maskFrac).toBeGreaterThan(MASK_MIN);
    expect(r.stdLum < CONTRAST_MIN_STD || r.meanLum > CONTRAST_MAX_MEAN).toBe(true);
});
// ── Peaks are opaque, rock-banded mountains, not glass pyramids ─────────
// Reviewer by-eye (Fable, 2026-08-29 20:10): the peaks read as "pale
// translucent glass pyramids overlapping each other" — one shared snow-band
// material, back-face culling off. Iter-132 fixes it (per-peak tint/haze/
// snowline, opaque materials). Gate: every pk_body_* material is opaque
// (alpha 1, backFaceCulling ON), the tints are actually varied, and the
// RENDERED peak pixels (peak-hide diff mask, same technique as the ridge
// contrast gate) are mid-luminance with band variance — snow-felt would be
// near-white and flat.
const PEAK_SRC = `
    window._peakGate = async function () {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const engine = scene.getEngine();
        const cam = scene.activeCamera;
        engine.stopRenderLoop();
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35;
        const peaks = scene.meshes.filter(m => m.name && m.name.startsWith('pk_body_'));
        const mats = peaks.map(m => m.material);
        const opacity = mats.map(m => ({ alpha: m.alpha, cull: m.backFaceCulling, name: m.name }));
        const tints = new Set(mats.map(m => [m.albedoColor.r, m.albedoColor.g, m.albedoColor.b].map(v => v.toFixed(3)).join(',')));
        const grab = async () => { scene.render(); scene.render(); return engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight()); };
        const withP = await grab();
        peaks.forEach(m => m.setEnabled(false));
        const without = await grab();
        peaks.forEach(m => m.setEnabled(true));
        let n = 0, sum = 0, sum2 = 0;
        for (let i = 0; i < withP.length; i += 4) {
            const d = Math.abs(withP[i] - without[i]) + Math.abs(withP[i+1] - without[i+1]) + Math.abs(withP[i+2] - without[i+2]);
            if (d < 12) continue;
            const lum = (0.2126 * withP[i] + 0.7152 * withP[i+1] + 0.0722 * withP[i+2]) / 255;
            n++; sum += lum; sum2 += lum * lum;
        }
        const mean = n ? sum / n : 0, std = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
        return { count: peaks.length, opacity, uniqueTints: tints.size, maskFrac: n / (withP.length / 4), meanLum: mean, stdLum: std };
    };
`;
test('peaks render as opaque, varied, rock-banded mountains', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate(PEAK_SRC);
    const r = await page.evaluate(() => window._peakGate());
    console.log('peak gate', JSON.stringify(r));
    expect(r.count).toBe(11);
    for (const o of r.opacity) {
        expect(o.alpha).toBe(1);                 // opaque — no glass
        expect(o.cull).toBe(true);               // backfaces culled — no overlap blend
    }
    expect(r.uniqueTints).toBeGreaterThanOrEqual(8);   // per-peak tint variance
    expect(r.maskFrac).toBeGreaterThan(0.01);          // peaks actually in frame
    expect(r.meanLum).toBeLessThan(0.75);              // rock visible — not all snow felt
    expect(r.stdLum).toBeGreaterThan(0.05);            // banding, not a flat fill
});

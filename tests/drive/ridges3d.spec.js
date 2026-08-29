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

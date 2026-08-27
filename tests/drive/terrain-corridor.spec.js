'use strict';
// ── P1 slice 1: continuous corridor ribbon gates ─────────────────────────────
// 1. The corridor ribbon is ONE mesh sampled from terrainRootY(z) − FOOT_OFFSET.
//    A ray straight down must hit it everywhere along the corridor, and the hit
//    y must match the physics surface within 2 cm (the skier-runs-under-the-
//    snow defect class).
// 2. C1 continuity of the VISUAL surface: adjacent-sample slope jumps over a
//    dense sweep. A crease shows as an ISOLATED spike (huge jump vs its
//    neighbours); smooth curvature produces sustained, locally-consistent
//    steps and passes.

const { test, expect } = require('@playwright/test');

test('corridor ribbon matches physics surface and has no creases', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const res = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ribbon = scene.getMeshByName('terrainCorridor');
        if (!ribbon) return { fatal: 'terrainCorridor mesh missing' };
        const verts = ribbon.getTotalVertices();

        const rootY = window.AerialEngine.aerialSki.terrainRootY;
        // Same cfg game.js built — exposed for this probe.
        const cfg = window._terrainCfgProbe || window._terrainCfg;

        const down = new BABYLON.Vector3(0, -1, 0);
        const cfg0 = window._terrainCfg;
        const wallBand = (z) => z > cfg0.KICKER_END_Z - 0.85 && z < cfg0.LANDING_START_Z;
        // Probe column deliberately OFF the ribbon's vertex columns (XC includes
        // 0, ±1.75, ...): a ray down an exact column edge sits on shared triangle
        // borders and returns degenerate interpolation.
        let worstVsPhysics = 0, worstAt = null, misses = 0;
        const samples = [];
        for (let z = -39; z <= 89; z += 0.25) {
            const o = new BABYLON.Vector3(-0.13, rootY(z, cfg) + 3, z);
            const pick = scene.pickWithRay(new BABYLON.Ray(o, down), m => m === ribbon);
            if (!pick || !pick.hit) { misses++; continue; }
            samples.push({ z, y: pick.pickedPoint.y });
            if (!wallBand(z)) {
                // Start join / other physics-owned kinks still must be AT the
                // physics height even if their slope jumps.
                const err = pick.pickedPoint.y - (rootY(z, cfg) - 1.025);
                if (Math.abs(err) > Math.abs(worstVsPhysics)) { worstVsPhysics = err; worstAt = `z=${z.toFixed(2)}`; }
            }
        }

        // C1 (vertex-crease) gate, defined against PHYSICS, not absolutes: build
        // the turn-angle sequence of the picked centre-line and of the physics
        // profile sampled on the SAME grid. Renderer artefact creases appear as
        // turn deltas physics does not have; real physics curvature cancels out.
        const turns = (pts) => {
            const t = [];
            for (let i = 1; i < pts.length; i++) {
                const dz = pts[i].z - pts[i - 1].z;
                t.push(Math.atan2(pts[i].y - pts[i - 1].y, dz) * 180 / Math.PI);
            }
            return t;
        };
        const tv = turns(samples);
        const tp = turns(samples.map((s) => ({ z: s.z, y: rootY(s.z, cfg) - 1.025 })));
        let worstCrease = 0, creaseAt = null, maxTurn = 0;
        for (let i = 1; i < tv.length - 1; i++) {
            if (wallBand(samples[i].z)) continue;   // airborne-only span, see above
            const dv = Math.abs(tv[i] - tv[i - 1]);
            const dp = Math.abs(tp[i] - tp[i - 1]);
            const d = Math.abs(dv - dp);
            if (dv > maxTurn && !wallBand(samples[i + 1].z)) maxTurn = dv;
            if (d > worstCrease) { worstCrease = d; creaseAt = `z=${samples[i].z.toFixed(2)} visTurn ${dv.toFixed(1)} physTurn ${dp.toFixed(1)}`; }
        }

        return {
            verts, triangles: ribbon.getTotalIndices() / 3,
            misses, worstVsPhysics: +worstVsPhysics.toFixed(4), worstAt,
            maxTurn: +maxTurn.toFixed(2), worstCreaseDelta: +worstCrease.toFixed(2),
            creaseAt, sampleCount: samples.length,
        };
    });

    expect(res.fatal, res.fatal).toBeUndefined();
    test.info().annotations.push({ type: 'P1', description: JSON.stringify(res) });
    expect(res.misses, 'rays that found no corridor surface').toBe(0);
    expect(Math.abs(res.worstVsPhysics),
        `visual surface off physics surface by ${res.worstVsPhysics} at ${res.worstAt}`).toBeLessThanOrEqual(0.02);
    expect(res.worstCreaseDelta,
        `mesh crease not present in physics at ${res.creaseAt}; largest visual turn ${res.maxTurn} deg`).toBeLessThanOrEqual(2.5);
});

test('corridor ribbon does not expose sky inside its footprint', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // Background-through-gap check: cast rays DOWNWARD from above the flank line
    // at |x| just inside the ribbon edge across the whole run; every one must hit
    // the ribbon (no gap to the background).
    const miss = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ribbon = scene.getMeshByName('terrainCorridor');
        let n = 0;
        for (let z = -39; z <= 89; z += 0.5) {
            for (const x of [-4.9, -3.5, 3.5, 4.9]) {
                const o = new BABYLON.Vector3(x, 30, z);
                const p = scene.pickWithRay(new BABYLON.Ray(o, new BABYLON.Vector3(0, -1, 0)), m => m === ribbon);
                if (!p || !p.hit) n++;
            }
        }
        return n;
    });
    expect(miss, 'columns where nothing was hit inside the corridor footprint').toBe(0);
});

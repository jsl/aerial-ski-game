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

// ── P1 slice 2 gates ─────────────────────────────────────────────────────────
// Reviewer order-17b: "no normal discontinuity > 5° across the corridor edge
// except at the kicker's vertical walls". The flanks are part of the same mesh
// now (shared rings/columns), so the corridor→field join must be seamless —
// measured as the angle between world-space FACET normals either side of
// x = ±5, swept along the whole run. Also extended-footprint coverage (the
// field now runs to ±55 m) and the plan's solid-ground requirements
// (skirt + base plane + double-sided snow).
test('field joins its flanks without a normal seam; ground is solid', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const res = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ribbon = scene.getMeshByName('terrainCorridor');
        const skirt = scene.getMeshByName('terrainSkirt');
        const base = scene.getMeshByName('terrainBase');
        if (!ribbon) return { fatal: 'terrainCorridor mesh missing' };
        const mat = ribbon.material;
        const cfg = window._terrainCfg;
        const rootY = window.AerialEngine.aerialSki.terrainRootY;

        const down = new BABYLON.Vector3(0, -1, 0);
        const facetNormalAt = (x, z) => {
            const o = new BABYLON.Vector3(x, rootY(z, cfg) + 4, z);
            const p = scene.pickWithRay(new BABYLON.Ray(o, down), m => m === ribbon);
            if (!p || !p.hit || !p.getNormal) return null;
            return p.getNormal(true);          // world-space flat (facet) normal
        };
        const degBetween = (a, b) => {
            const d = BABYLON.Vector3.Dot(a, b) / (a.length() * b.length());
            return Math.acos(Math.min(1, Math.max(-1, d))) * 180 / Math.PI;
        };

        // Dihedral across the corridor edge, swept along z. The kicker block
        // (width 3.4, centred) never reaches x=±4.35, so its vertical walls
        // cannot pollute these picks; wallBand rows excluded defensively anyway.
        const KEZ = cfg.KICKER_END_Z, LSZ = cfg.LANDING_START_Z;
        let worst = 0, worstAt = null, sum = 0, n = 0;
        for (let z = -38; z <= 88; z += 1.0) {
            if (z > KEZ - 0.85 && z < LSZ) continue;   // kicker-wall span
            for (const s of [1, -1]) {
                const nIn = facetNormalAt(s * 4.35, z), nOut = facetNormalAt(s * 5.35, z);
                if (!nIn || !nOut) continue;
                const d = degBetween(nIn, nOut);
                sum += d; n++;
                if (d > worst) { worst = d; worstAt = `x${s} z=${z.toFixed(1)}`; }
            }
        }

        // Extended footprint: rays down every outer field column band must hit
        // the ribbon (no gap to background anywhere inside the field).
        let outerMisses = 0;
        for (let z = -52; z <= 165; z += 3.0) {
            for (const x of [-54, -34, -16.5, -10, 5.7, 10, 16.5, 34, 54]) {
                const o = new BABYLON.Vector3(x, rootY(z, cfg) + 40, z);
                const p = scene.pickWithRay(new BABYLON.Ray(o, down), m => m === ribbon);
                if (!p || !p.hit) outerMisses++;
            }
        }

        return {
            verts: ribbon.getTotalVertices(),
            triangles: ribbon.getTotalIndices() / 3,
            matName: mat ? mat.name : null,
            backFaceCulling: mat ? !!mat.backFaceCulling : null,
            avgDihedral: n ? +(sum / n).toFixed(3) : null,
            worstDihedral: +worst.toFixed(2),
            worstAt,
            samples: n,
            outerMisses,
            skirtVerts: skirt && skirt.getTotalVertices ? skirt.getTotalVertices() : 0,
            baseExists: !!base,
        };
    });

    expect(res.fatal, res.fatal).toBeUndefined();
    console.log('FIELD_SEAM ' + JSON.stringify(res));
    test.info().annotations.push({ type: 'P1S2', description: JSON.stringify(res) });
    expect(res.matName, 'corridor material').toBe('snowMat');
    expect(res.backFaceCulling,
        'snowMat must be double-sided (backFaceCulling false) so undersides shade as snow').toBe(false);
    expect(res.samples).toBeGreaterThan(200);
    expect(res.worstDihedral,
        `normal seam across the corridor edge at ${res.worstAt}`)
        .toBeLessThanOrEqual(5.0);
    expect(res.outerMisses, 'rays that found no field surface outside the corridor').toBe(0);
    expect(res.skirtVerts, 'perimeter skirt must exist and be populated')
        .toBeGreaterThan(1000);
    expect(res.baseExists, 'base plane must exist under the field').toBe(true);
});

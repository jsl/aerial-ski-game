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
        // P5 chopped landing: the baked chop (blender/bake_landing.py) sinks
        // the visual surface up to ~0.07 m BELOW the physics profile by design
        // (the loose-snow sink band, contact rules). The bare "at the physics
        // height" and C1-crease sweeps exclude this band; the chop band has
        // its own dedicated gates in the test below.
        const chopBand = (z) => window._chopZone
            && z > window._chopZone.z0 && z < window._chopZone.z1 + 1.5;   // incl. fade tail
        // Probe column deliberately OFF the ribbon's vertex columns (XC includes
        // 0, ±1.75, ...): a ray down an exact column edge sits on shared triangle
        // borders and returns degenerate interpolation.
        let worstVsPhysics = 0, worstAt = null, misses = 0;
        const samples = [];
        for (let z = -39; z <= 89; z += 0.25) {
            const o = new BABYLON.Vector3(-0.13, rootY(z, cfg) + 3, z);
            const pick = scene.pickWithRay(new BABYLON.Ray(o, down), (m) => m === ribbon);
            if (!pick || !pick.hit) { misses++; continue; }
            samples.push({ z, y: pick.pickedPoint.y });
            if (!wallBand(z) && !chopBand(z)) {
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
        const tp = turns(samples.map((s) => ({ z: s.z, y: rootY(s.z, cfg) - 1.025 })));
        const tv = turns(samples);
        let worstCrease = 0, creaseAt = null, maxTurn = 0;
        for (let i = 1; i < tv.length - 1; i++) {
            if (wallBand(samples[i].z) || chopBand(samples[i].z)) continue;   // gated separately, see above
            const dv = Math.abs(tv[i] - tv[i - 1]);
            if (dv > maxTurn && !wallBand(samples[i + 1].z) && !chopBand(samples[i + 1].z)) maxTurn = dv;
            const dp = Math.abs(tp[i] - tp[i - 1]);
            const d = Math.abs(dv - dp);
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
        const subMatNames = mat && mat.subMaterials
            ? mat.subMaterials.map((m) => m && m.name) : null;
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
            subMatNames,
            backFaceCulling: mat
                ? (mat.subMaterials
                    ? mat.subMaterials.every((m) => m && m.backFaceCulling === false)
                    : !!mat.backFaceCulling)
                : null,
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
    expect(['snowMat', 'terrainMats'], 'corridor material').toContain(res.matName);
    // Double-sided contract (P1 "the ground is solid"): with the P5 MultiMaterial
    // the res value is `every subMaterial double-sided`; otherwise snowMat itself.
    expect(res.backFaceCulling,
        'corridor materials must be double-sided (backFaceCulling false) so undersides shade as snow')
        .toBe(true);
    expect(res.samples).toBeGreaterThan(200);
    expect(res.worstDihedral,
        `normal seam across the corridor edge at ${res.worstAt}`)
        .toBeLessThanOrEqual(5.0);
    expect(res.outerMisses, 'rays that found no field surface outside the corridor').toBe(0);
    expect(res.skirtVerts, 'perimeter skirt must exist and be populated')
        .toBeGreaterThan(1000);
    expect(res.baseExists, 'base plane must exist under the field').toBe(true);
});

// ── Human item 3 (2026-08-27): the kicker is a distinct block again ─────────
// On main the jump is a 3.4 m-wide block standing ON the flat table; the P1
// ribbon had started carrying the kicker bezier across the full corridor
// width (the block reads as a full-width ramp). Gate: beside the block the
// corridor surface is flat table; inside |x| ≤ 1.7 it is the physics kicker
// profile; the block edge (wall top) sits between x = 1.69 and 1.71; and the
// block actually rises clear of the table near the lip.
test('kicker is a distinct 3.4 m block on the flat table', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const res = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ribbon = scene.getMeshByName('terrainCorridor');
        if (!ribbon) return { fatal: 'terrainCorridor mesh missing' };
        const rootY = window.AerialEngine.aerialSki.terrainRootY;
        const cfg = window._terrainCfg;
        const FO = 1.025;                                   // game.js FOOT_OFFSET
        const down = new BABYLON.Vector3(0, -1, 0);
        const pickY = (x, zz) => {
            const o = new BABYLON.Vector3(x, rootY(zz, cfg) + 8, zz);
            const p = scene.pickWithRay(new BABYLON.Ray(o, down), m => m === ribbon);
            return p && p.hit ? p.pickedPoint.y : null;
        };
        const z = cfg.KICKER_END_Z - 0.30;                  // near the lip, clear rise
        const phys = rootY(z, cfg) - FO;
        const tableY = rootY(cfg.KICKER_START_Z, cfg) - FO; // flat table height
        const y = {};
        for (const [k, x] of Object.entries({ mid: 0, inL: -1.69, inR: 1.69,
            wallL: -1.72, wallR: 1.72, outL: -1.76, outR: 1.76, farL: -2.5, farR: 2.5 })) {
            y[k] = pickY(x, z);
        }
        return {
            z: +z.toFixed(2), phys: +phys.toFixed(4), tableY: +tableY.toFixed(4),
            y: Object.fromEntries(Object.entries(y).map(([k, v]) => [k, v === null ? null : +v.toFixed(4)])),
            rise: y.mid === null ? null : +(y.mid - tableY).toFixed(4),
        };
    });

    expect(res.fatal, res.fatal).toBeUndefined();
    console.log('KICKER_BLOCK ' + JSON.stringify(res));
    test.info().annotations.push({ type: 'KICKER_BLOCK', description: JSON.stringify(res) });
    for (const k of ['mid', 'inL', 'inR', 'wallL', 'wallR', 'outL', 'outR', 'farL', 'farR']) {
        expect(res.y[k], `pick at ${k} found no ribbon surface`).not.toBeNull();
    }
    const near = (a, b, what, tol = 0.02) => expect(Math.abs(a - b),
        `${what}: ${a.toFixed(4)} vs ${b.toFixed(4)}`).toBeLessThanOrEqual(tol);
    near(res.y.mid, res.phys, 'block top rides the physics kicker profile');
    near(res.y.inL, res.phys, 'block top edge (x=-1.69) on the kicker profile');
    near(res.y.inR, res.phys, 'block top edge (x=+1.69) on the kicker profile');
    near(res.y.outL, res.tableY, 'corridor is flat table just outside the block wall (x=-1.76)');
    near(res.y.outR, res.tableY, 'corridor is flat table just outside the block wall (x=+1.76)');
    near(res.y.farL, res.tableY, 'corridor is flat table beside the block (x=-2.5)');
    near(res.y.farR, res.tableY, 'corridor is flat table beside the block (x=+2.5)');
    // Wall steepness: 1.72 sits on the wall face between the 1.70 top edge and
    // the 1.75 table column; a near-vertical wall is already most of the way
    // up the rise there (linear slant gives 0.6), a gentle ramp is not.
    for (const k of ['wallL', 'wallR']) {
        expect(res.y[k] - res.tableY,
            `block side wall at ${k} reads near-vertical at z=${res.z}`)
            .toBeGreaterThanOrEqual(0.5 * res.rise);
    }
    expect(res.rise, `block must rise clear of the table at z=${res.z}`)
        .toBeGreaterThanOrEqual(0.5);
});

// ── P5: the chopped landing (baked chop tiles + downward displacement) ──────
// The visual landing surface must sit at or BELOW the physics profile (the
// skis ride the physics, so the visual can never rise through them) inside
// the loose-snow sink band: 0 at the fades, ≤ 0.10 m at the deepest. Outside
// the band the ribbon stays exactly on the physics surface (gated above).
test('chopped landing: sink band, fades, material', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function'
        && window._chopStats && !window._chopStats.error,
    null, { timeout: 30_000 });

    const res = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ribbon = scene.getMeshByName('terrainCorridor');
        if (!ribbon) return { fatal: 'terrainCorridor mesh missing' };
        const cz = window._chopZone;
        const rootY = window.AerialEngine.aerialSki.terrainRootY;
        const cfg = window._terrainCfg;
        const down = new BABYLON.Vector3(0, -1, 0);
        let deepest = 0, deepestAt = null, worstAbove = 0, aboveAt = null;
        for (let z = cz.z0 - 1; z <= cz.z1 + 1; z += 0.25) {
            for (const x of [-3.2, 0, 3.2]) {
                const o = new BABYLON.Vector3(x, rootY(z, cfg) + 3, z);
                const p = scene.pickWithRay(new BABYLON.Ray(o, down), (m) => m === ribbon);
                if (!p || !p.hit) continue;
                const err = p.pickedPoint.y - (rootY(z, cfg) - 1.025);
                if (err > worstAbove) { worstAbove = err; aboveAt = `z=${z.toFixed(2)} x=${x}`; }
                const inBand = z > cz.z0 && z < cz.z1 && Math.abs(x) < cz.halfW;
                if (inBand && -err > deepest) { deepest = -err; deepestAt = `z=${z.toFixed(2)} x=${x}`; }
            }
        }
        return {
            fatal: undefined, deepest: +deepest.toFixed(4), deepestAt,
            worstAbove: +worstAbove.toFixed(4), aboveAt,
            stats: window._chopStats,
            matNames: ribbon.material.subMaterials.map((m) => m.name),
        };
    });
    expect(res.fatal, res.fatal).toBeUndefined();
    console.log('CHOP ' + JSON.stringify(res));
    // Never ABOVE the physics surface anywhere in or near the band (5 mm tol).
    expect(res.worstAbove, `chop rose above physics at ${res.aboveAt}`)
        .toBeLessThanOrEqual(0.005);
    // Sink band respected: never more than the contact-rule 0.10 m.
    expect(res.deepest, `chop sink ${res.deepest} at ${res.deepestAt}`)
        .toBeLessThanOrEqual(0.10);
    // The chop actually displaced geometry (visible in silhouette, not just
    // shading) and stays inside the band.
    expect(res.stats.sunkVerts, 'displaced vertex count').toBeGreaterThan(200);
    expect(res.stats.worstSink, 'worst vertex sink').toBeGreaterThan(0.01);
    expect(res.stats.worstSink, 'worst vertex sink within band')
        .toBeLessThanOrEqual(0.10);
    expect(res.matNames, 'landing material slots').toEqual(['snowMat', 'landingChopMat']);
});

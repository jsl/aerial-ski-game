'use strict';
// ── Scene instrument: corridor vs flank + near-black pixel attribution ──────
// GREY RAMP (REWRITTEN iter-145): the iter-141/142 numbers were read through a
// spurious y-flip of the readPixels buffer (see measure() below); corrected,
// the regressed 4992619 build reads corridor 0.6475 vs flank 0.8271 — the
// 138/142 lightmap rewire WAS darkening the run (the P0 the author
// screenshot shows). After the iter-145 corridor unbake (game.js skips
// terrainCorridor in applyBakedLighting) the ramp gate lives at the in-run
// framing (corridor ≥ 0.95 × flank; scene framing is a canary — see below).
//   2. BLACK BAND: ~2.8% of scene-view samples read near-black (lum < 60),
//      attributed by ray-cast to the bnet strips' OPAQUE CSM shadow on the
//      landing (terrainCorridor) and the down-facing terrainBase disc. Both
//      fixed this iteration (strips off the caster list; disc normal up).
//      Negative control (pre-fix): 1054/37400 = 2.82% dark samples, top hits
//      terrainBase 302, terrainCorridor 282, bnetStrip_R 145, bnetStrip_L 52.
// Double-render before each grab (venue-dressing's countermeasure): a single
// render leaves the readback one frame stale.
const { test, expect } = require('@playwright/test');

const GRID_X = 220, GRID_Y = 170;

async function measure(page) {
    return page.evaluate(async ([NX, NY]) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const cam = scene.activeCamera;
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        // Two renders: the first flushes pending state, the second is on the
        // canvas when readPixels runs (stale-frame countermeasure).
        // ROW ORDER — settled by iter-152, superseding the iter-145 note
        // ("NO y-flip") below. Three probes on the healthy merged build:
        // (a) honest as-is: corridor 0.5743 / flank 0.8325 — canary RED;
        // (b) peaks hidden (the reviewer's 18:05 probe): corridor 0.6649,
        //     dark corridor pixels 1790 → 739 — but the CLASSIFICATION did
        //     not move (nCor identical 12949);
        // (c) peaks made PICKABLE (render untouched): no change at all —
        //     no corridor-classified ray first-hits peak/ridge scenery.
        // (b)+(c) together: the classified rays are correct; it is the
        // LUMINANCE that is sampled from the mirrored row. WebGL
        // readPixels is bottom-up; Babylon does not flip it. The iter-145
        // as-is/flip comparison ran on the baked-regressed build, where
        // the giant dark slab straddled both classes and confounded the
        // check. With the flip: corridor 0.8433 / flank 0.7707 — canary
        // green, nothing hidden, no scene change. FLIP IS CORRECT.
        const px = await eng.readPixels(0, 0, W, H);
        const lumAt = (x, y) => {
            const i = ((H - 1 - y) * W + x) * 4;
            return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        };
        let cor = 0, corN = 0, fl = 0, flN = 0, dark = 0;
        let corSun = 0, corSunN = 0, corAway = 0, corAwayN = 0, sunDir = null;
        // Iter-151: the scene-framing corridor class mixes SURFACE ASPECTS —
        // the inclined in-run tilted away from the sun vs the sun-facing
        // table/landing/field. Mean luminance cannot separate them; record
        // the aspect split (dot(worldNormal, toSun)) so the canary is
        // attributable (see iter-151 entry: 100% of the scene-framing dark
        // deficit was the away-facing in-run aspect; shadows and the bake
        // were excluded by toggle tests).
        const darkHist = {};
        // Iter-152, the real occlusion fix: peak/ridge meshes ship with
        // `isPickable = false`, so EVERY pick — filtered predicate or not —
        // is blind to them, and a ray that visually hits a peak falls
        // through to the DISTANT corridor/skirt mesh behind it: a peak
        // pixel is classified as corridor surface at the peak's own (dark)
        // luminance. That is the 150 canary's classification leak (the
        // reviewer's hide-peaks probe: corridor 0.5952 → 0.6352, dark
        // corridor pixels 1792 → 829). An unfiltered-pick guard measures
        // NO change (verified: corridor 0.5743, darkTop terrainCorridor
        // 1792 — identical to pre-fix) for exactly this reason. So the
        // instrument temporarily makes the scenery pickable (isPickable
        // does not affect rendering), takes the TRUE first hit, and skips
        // any pixel whose visible surface is peak/ridge scenery.
        const scenery = scene.meshes.filter((m) => m.name
            && /^(pk_|ridge_)/.test(m.name));
        const wasPickable = scenery.map((m) => m.isPickable);
        scenery.forEach((m) => { m.isPickable = true; });
        for (let j = 0; j < NY; j++) {
            const sy = Math.round((0.15 + 0.80 * j / (NY - 1)) * (H - 1));
            for (let i = 0; i < NX; i++) {
                const sx = Math.round((i / (NX - 1)) * (W - 1));
                const l = lumAt(sx, sy);
                if (l < 60) {
                    dark++;
                    let name = 'none';
                    try {
                        const hit = scene.pickWithRay(scene.createPickingRay(sx, sy,
                            BABYLON.Matrix.Identity(), cam));
                        if (hit && hit.hit && hit.pickedMesh && hit.pickedMesh.name)
                            name = hit.pickedMesh.name.replace(/\.\d+$/, '');
                    } catch (e) { /* keep none */ }
                    darkHist[name] = (darkHist[name] || 0) + 1;
                }
                // Surface class via ray-cast, as in grey-ramp.spec: the run
                // proper is |x| <= 4, open snowfield |x| >= 8. Classify
                // only when the VISIBLE (first-hit) surface is a
                // corridor/skirt mesh; pixels covered by peak/ridge
                // scenery (or anything else) are skipped.
                let pt = null;
                try {
                    const hit = scene.pickWithRay(scene.createPickingRay(sx, sy,
                        BABYLON.Matrix.Identity(), cam));
                    if (hit && hit.hit && hit.pickedMesh && hit.pickedMesh.name
                        && /^(terrainCorridor|terrainSkirt)/.test(hit.pickedMesh.name))
                        pt = hit.pickedPoint;
                } catch (e) { /* keep null */ }
                if (pt) {
                    const ax = Math.abs(pt.x);
                    if (ax <= 4) {
                        cor += l; corN++;
                        // Aspect split on the same ray: sun-facing vs away.
                        try {
                            const hitN = scene.pickWithRay(scene.createPickingRay(sx, sy,
                                BABYLON.Matrix.Identity(), cam), (m) =>
                                !!(m.name && /^(terrainCorridor|terrainSkirt)/.test(m.name)));
                            if (hitN && hitN.hit) {
                                const n = hitN.getNormal(true);
                                const sun = sunDir || (sunDir = (() => {
                                    const dl = scene.lights.find((li) => li.getTypeID &&
                                        li.getTypeID() === BABYLON.Light.LIGHTTYPEID_DIRECTIONALLIGHT);
                                    return dl ? dl.direction.scale(-1).normalize() : null;
                                })());
                                if (sun) {
                                    const d = BABYLON.Vector3.Dot(n, sun);
                                    if (d > 0.2) { corSun += l; corSunN++; }
                                    else if (d < -0.2) { corAway += l; corAwayN++; }
                                }
                            }
                        } catch (e) { /* keep counts */ }
                    }
                    else if (ax >= 8) { fl += l; flN++; }
                }
            }
        }
        scenery.forEach((m, k) => { m.isPickable = wasPickable[k]; });
        const top = Object.entries(darkHist).sort((a, b) => b[1] - a[1]).slice(0, 8);
        return {
            corSun: corSunN ? +(corSun / corSunN / 255).toFixed(4) : null,
            corSunN,
            corAway: corAwayN ? +(corAway / corAwayN / 255).toFixed(4) : null,
            corAwayN,
            corridor: corN ? +(cor / corN / 255).toFixed(4) : null,
            flank: flN ? +(fl / flN / 255).toFixed(4) : null,
            nCor: corN, nFlank: flN,
            darkFrac: +((dark / (NX * NY))).toFixed(4),
            darkTop: top,
        };
    }, [GRID_X, GRID_Y]);
}

test('scene: run at least as bright as its flanks; no near-black band', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bnetSeated === true,
        null, { timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate(() => {
        const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35;
    });
    await page.waitForTimeout(600);

    const r = await measure(page);
    console.log('SCENE_INSTRUMENT ' + JSON.stringify(r));

    expect(r.nCor).toBeGreaterThan(40);
    expect(r.nFlank).toBeGreaterThan(40);
    // Scene framing: mean-luminance CANNOT carry the 0.95 gate here — the
    // ray-classified corridor mean includes the B-net/fence shadow band and
    // sun-angled inrun geometry, so even the pre-138 GOOD build (worktree
    // probe, iter-145) reads corridor 0.6581 vs flank 0.8360 = 0.787, and the
    // baked regressed build reads 0.78 — indistinguishable. The defect the
    // 0.95 gate catches lives at the in-run framing (see the test below:
    // baked 0.7613/0.8155 = 0.933 FAIL vs unbaked 0.7869/0.816 = 0.964 PASS).
    // So here: a regression canary only.
    expect(r.corridor).toBeGreaterThanOrEqual(r.flank * 0.75);
    // The 141 fix's contract: the alpha-cut net strips do NOT cast in the
    // CSM (the depth pass rendered them as opaque solids → one solid band).
    // Structural assert: strips absent from the shadow render list (below).
    // Iter-152: the darkFrac gate's old control spread (2.36–2.86%) was
    // measured on the MIRRORED instrument, which sampled the bright
    // lower frame for its near-black count and misattributed the true
    // dark pixels ("terrainCorridor 1792" for pixels that are actually
    // ridge/peak/tree scenery). On the corrected row order the honest
    // budget is 0.0454 and the attribution is truthful (ridge_mid_R 353,
    // ridge_near_R 343, treeCards0 326, terrainCorridor only 110) — the
    // dark pixels ARE the ridgelines' shaded flanks, the bare birch
    // branchwork and the fence's contact shadow, exactly the content the
    // 141 entry called legitimate. The gate is re-bounded to the
    // corrected instrument's honest reading with headroom, and keeps its
    // regression-canary role (a new solid band would blow past it).
    const stripsInShadow = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const lists = [];
        scene.lights.forEach((l) => {
            const g = l.getShadowGenerator && l.getShadowGenerator();
            if (g && g.getShadowMap() && g.getShadowMap().renderList)
                lists.push(...g.getShadowMap().renderList.map((m) => m.name));
        });
        return lists.filter((n) => /^bnetStrip/.test(n));
    });
    expect(stripsInShadow, `net strips still in shadow render list: ${stripsInShadow}`)
        .toEqual([]);
    expect(r.darkFrac, `near-black budget ${r.darkFrac}`
        + ` (corrected-instrument honest reading 0.0454)`)
        .toBeLessThan(0.06);
});

test('inrun: corridor ≥ 0.95 × flank at the canonical in-run framing', async ({ page }) => {
    // NEXT.md (2026-08-30): the corridor slab was first SEEN in inrun.png, so
    // the ramp gate must hold there too, not only at the scene framing.
    // Camera = look.spec's canonical in-run shot (athlete-anchored, 8 m
    // uphill / 6 m above the chest).
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bnetSeated === true,
        null, { timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const gs = window._getGameState();
        const body = scene.meshes.find((m) => (m.name || '').indexOf('athleteBody') === 0);
        const p = body ? body.getAbsolutePosition() : { x: 0, y: -2.5, z: gs.posZ };
        cam.setTarget(new BABYLON.Vector3(0, p.y + 1, p.z));
        cam.alpha = -Math.PI / 2;
        cam.beta = Math.atan2(8, 6);
        cam.radius = 10;
        cam.fov = 0.8;
    });
    await page.waitForTimeout(600);

    const r = await measure(page);
    console.log('INRUN_INSTRUMENT ' + JSON.stringify(r));
    expect(r.nCor).toBeGreaterThan(40);
    expect(r.nFlank).toBeGreaterThan(20);
    expect(r.corridor).toBeGreaterThanOrEqual(r.flank * 0.95 - 0.005);
});

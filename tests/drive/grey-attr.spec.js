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
        scene.render(); scene.render();
        // Iter-145: NO y-flip. Babylon's readPixels output rows are indexed
        // in screen order (the same top-down row index createPickingRay's
        // screen coordinates use). The iter-141 note recorded the GL
        // bottom-up convention and 142 closed the ramp on mirrored numbers:
        // the flipped read said corridor 0.6783 > flank 0.5873 while the
        // author's screenshot showed the corridor plainly DARKER. Measured
        // both ways on the regressed build in one pass (iter-145 probe,
        // scene framing): as-is corridor 0.6475 / flank 0.8271 (corridor
        // darker — matches the screenshot); flipped 0.8357 / 0.7262
        // (mirrored). As-is is correct.
        const px = await eng.readPixels(0, 0, W, H);
        const lumAt = (x, y) => {
            const i = (y * W + x) * 4;
            return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        };
        let cor = 0, corN = 0, fl = 0, flN = 0, dark = 0;
        const darkHist = {};
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
                // proper is |x| <= 4, open snowfield |x| >= 8.
                let pt = null;
                try {
                    const hit = scene.pickWithRay(scene.createPickingRay(sx, sy,
                        BABYLON.Matrix.Identity(), cam), (m) =>
                        !!(m.name && /^(terrainCorridor|terrainSkirt)/.test(m.name)));
                    if (hit && hit.hit) pt = hit.pickedPoint;
                } catch (e) { /* keep null */ }
                if (pt) {
                    const ax = Math.abs(pt.x);
                    if (ax <= 4) { cor += l; corN++; }
                    else if (ax >= 8) { fl += l; flN++; }
                }
            }
        }
        const top = Object.entries(darkHist).sort((a, b) => b[1] - a[1]).slice(0, 8);
        return {
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
    // Structural assert — the luminance instrument cannot carry this gate:
    // measured on the fixed build the near-black budget is unchanged
    // (2.36–2.86%, attribution identical to the pre-fix control) because it
    // is dominated by legitimate content — the ridges' shaded flanks (rays
    // through the UNPICKABLE ridge meshes fall through to terrainBase/sky,
    // so "terrainBase 287 / none 247" are false attributions, proven by
    // hiding the disc: the dark budget just moves to "none"), the bare
    // birch branchwork, and the fence's contact shadow. Clearing the CSM
    // render list entirely moved darkFrac 0.0236 → 0.0235: the CSM is not
    // in the budget at all. Gates: strips absent from the shadow render
    // list (this fix), darkFrac bounded below the recorded control spread
    // (regression canary only, content-dependent).
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
    expect(r.darkFrac, `near-black budget ${r.darkFrac} (control spread 2.36–2.86%)`)
        .toBeLessThan(0.035);
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

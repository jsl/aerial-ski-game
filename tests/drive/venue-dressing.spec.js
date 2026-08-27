'use strict';
// ── Venue dressing slice 1: blue B-net safety fencing (P3) ────────────────────
// Pinned acceptance (RENDER-PROGRESS, author pull-forward):
//   · posts instanced, both edges, every foot within 2 cm of the terrain
//     height at its position;
//   · the net strip's bottom edge rides 0–5 cm above the snow along its length
//     (never floating, never buried);
//   · runs from the top of the in-run to past the end of the out-run;
//   · one merged strip mesh per side, thin-instanced posts (draw calls stay low).
// The strip casts via ALPHATEST depth: assert it is actually a caster so a
// silently-fallen-out shadow does not go unnoticed.
const { test, expect } = require('@playwright/test');

test('venue dressing: B-net posts seated on the snow, net edge 0–5 cm above it, merged strips both sides', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() =>
        window._bnetDebug && window._bnetDebug.posts.length >= 40,
        null, { timeout: 20000 });
    // Posts/net are seeded analytically and RE-SEATED against picked snow
    // heights after the first completed render (build-time picks are unreliable
    // — world matrices not final during script evaluation). Gate on that.
    await page.waitForFunction(() => window._bnetSeated === true,
        null, { timeout: 20000 });
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const fallbackY = (z) =>
            AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025;

        // Independent re-pick for the post-foot gate — a FRESH ray cast against
        // everything except the b-net itself and distant dressing.
        const pickGround = (x, z) => {
            const hit = scene.pickWithRay(
                new BABYLON.Ray(new BABYLON.Vector3(x, 80, z),
                                new BABYLON.Vector3(0, -1, 0), 150),
                (m) => !!m.name && !/^(bnet|pk_|tr_|fl_)/.test(m.name));
            return hit && hit.hit ? hit.pickedPoint.y : fallbackY(z);
        };

        const d = window._bnetDebug;
        const footErr = Math.max(...d.posts.map((p) =>
            Math.abs(p.y - pickGround(p.x, p.z))));
        const clear = d.samples.map((s) => s.yBot - s.g);
        const minClear = Math.min(...clear);
        const maxClear = Math.max(...clear);

        // Fence-scale contract (reviewer order item 3): net top ≤ 1.3 m above
        // the local snow along the whole run, posts ≤ 6 cm across.
        const topClears = d.samples.filter((s) => s.yTop !== undefined)
            .map((s) => s.yTop - pickGround(s.x, s.z));
        const postSrc0 = scene.getMeshByName('bnetPost');
        // Thin-instance sources carry a UNION bounding box over every
        // instance matrix (the run's whole length), so measure the SOURCE
        // CYLINDER's own vertex radius in its local frame.
        let postDiam = null;
        if (postSrc0) {
            const pp = postSrc0.getVerticesData(BABYLON.VertexBuffer.PositionKind) || [];
            let rad = 0;
            for (let i = 0; i < pp.length; i += 3) {
                rad = Math.max(rad, Math.hypot(pp[i], pp[i + 2]));
            }
            postDiam = +(rad * 2).toFixed(4);
        }

        const stripL = scene.getMeshByName(d.strips[0]);
        const stripR = scene.getMeshByName(d.strips[1]);
        const postSrc = scene.getMeshByName('bnetPost');

        return {
            postCount: d.posts.length,
            footErr,
            nSamples: clear.length,
            minClear,
            maxClear,
            spanZ: d.spanZ,
            strips: {
                present: [!!stripL, !!stripR],
                sameMat: !!(stripL && stripR &&
                    stripL.material.uniqueId === stripR.material.uniqueId),
                vertL: stripL ? stripL.getTotalVertices() : 0,
                vertR: stripR ? stripR.getTotalVertices() : 0,
                alphaTest: !!(stripL && stripL.material &&
                    stripL.material.transparencyMode ===
                        BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST),
            },
            postThinInstances: postSrc ? postSrc.thinInstanceCount : 0,
            postDiam,
            topClear: topClears.length ? {
                n: topClears.length,
                min: Math.min(...topClears),
                max: Math.max(...topClears),
            } : null,

            cfgSlopeStartZ: window._terrainCfg.SLOPE_START_Z,
            cfgOutrunZ: window._terrainCfg.OUTRUN_Z,
        };
    });

    expect(r.strips.present).toEqual([true, true]);
    expect(r.strips.sameMat).toBe(true);
    expect(r.strips.alphaTest).toBe(true);

    expect(r.postThinInstances).toBe(r.postCount);
    expect(r.postCount).toBeGreaterThanOrEqual(60);
    // Both edges symmetrically fenced.
    expect(r.postCount % 2).toBe(0);
    // Post feet stand on the snow at their positions (≤ 2 cm re-pick error).
    expect(r.footErr, `worst post-foot terrain mismatch ${r.footErr}`)
        .toBeLessThan(0.02);

    // Net bottom edge rides 0–5 cm above the snow along its whole length.
    expect(r.nSamples).toBeGreaterThan(100);
    expect(r.minClear, `strip sank below snow to ${r.minClear}`)
        .toBeGreaterThanOrEqual(-0.005);
    expect(r.maxClear, `strip floats ${r.maxClear} above snow`)
        .toBeLessThan(0.051);

    // Fence scale: net top ≤ 1.3 m over the snow everywhere (author spec 1.2 m
    // minus the sag), posts ≤ 6 cm across — the fence must read as dressing,
    // not architecture, against a 1.7 m athlete.
    expect(r.postDiam !== null, 'bnetPost source mesh missing').toBe(true);
    expect(r.postDiam, `post is ${r.postDiam} m across`).toBeLessThanOrEqual(0.062);
    expect(r.topClear.n).toBeGreaterThan(100);
    expect(r.topClear.max, `net top reaches ${r.topClear.max} m above the snow`)
        .toBeLessThan(1.31);
    expect(r.topClear.min, `net top sags to ${r.topClear.min} m above the snow`)
        .toBeGreaterThan(1.09);


    // Span covers from the top of the in-run past the end of the out-run.
    expect(Math.abs(r.spanZ[0] - r.cfgSlopeStartZ)).toBeLessThan(0.01);
    expect(Math.abs(r.spanZ[1] - (r.cfgOutrunZ + 8))).toBeLessThan(0.01);
});

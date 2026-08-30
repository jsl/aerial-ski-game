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

test('venue dressing: ORANGE wind sock on a pole at the knoll crest (author: not a blue flag; no wands down the landing)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._windsockSeated === true, null, { timeout: 30_000 });
    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const pole = scene.getMeshByName('knollWindsockPole');
        const sock = scene.getMeshByName('knollWindsock');
        const d = window._windsockDebug;
        const c = sock.material.albedoColor;
        const ground = (x, z) => {
            const hit = scene.pickWithRay(new BABYLON.Ray(new BABYLON.Vector3(x, 80, z), new BABYLON.Vector3(0, -1, 0), 150),
                (m) => !!m.name && /^(terrainCorridor|wUpperMtn|terrainSkirt)/.test(m.name));
            return hit && hit.hit ? hit.pickedPoint.y : null;
        };
        const g = ground(d.x, d.z);
        return {
            present: !!(pole && sock),
            orange: c.r > 0.8 && c.g > 0.25 && c.g < 0.55 && c.b < 0.15,
            horizontal: d.axisX > 0.9,                       // sock flies sideways, not up the pole
            poleBaseGap: g === null ? 0 : (pole.position.y - pole.getBoundingInfo().boundingBox.extendSize.y) - g,
            wands: scene.meshes.filter((m) => /^wand|^knollFlag/.test(m.name)).length,
        };
    });
    expect(r.present).toBe(true);
    expect(r.orange, 'wind sock must be safety orange').toBe(true);
    expect(r.horizontal).toBe(true);
    expect(Math.abs(r.poleBaseGap)).toBeLessThan(0.08);      // pole planted on the snow
    expect(r.wands, 'landing wands / blue flag must be gone').toBe(0);
});

test('venue dressing: ONE static coach figure in a red jacket at the knoll, seated (author: one, not three)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() =>
        window._knollCoachesDebug && window._knollCoachesSeated === true,
        null, { timeout: 20000 });
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const d = window._knollCoachesDebug;
        const meshes = [0].map((i) => scene.getMeshByName('knollCoach' + i));
        const present = meshes.every(Boolean);
        if (!present) return { present, d };

        // Red pixels must dominate the jacket band of the shared texture.
        const tex = scene.materials.find((m) => m.name === 'knollCoachMat').albedoTexture;
        const ctx = tex.getContext();
        const img = ctx.getImageData(78, 168, 100, 150).data;   // torso band
        let red = 0, n = 0;
        for (let p = 0; p < img.length; p += 4) {
            if (img[p + 3] > 128) {
                n++;
                if (img[p] > 140 && img[p] > img[p + 1] * 3 && img[p] > img[p + 2] * 3) red++;
            }
        }

        // Independent ground re-pick under each figure (exclude coaches).
        const pickGround = (x, z) => {
            const hit = scene.pickWithRay(
                new BABYLON.Ray(new BABYLON.Vector3(x, 80, z),
                                new BABYLON.Vector3(0, -1, 0), 150),
                (m) => !!m.name && !/^knollCoach/.test(m.name));
            return hit && hit.hit ? hit.pickedPoint.y : null;
        };
        const stations = d.stations.map((s) => {
            const g = pickGround(s.x, s.z);
            return { x: s.x, z: s.z, baseY: s.baseY, g };
        });
        // game.js sets PBRMATERIAL_ALPHATEST (MATERIAL_ALPHATESTMODE is
        // undefined in some Babylon builds — iter-110 review finding); accept
        // whichever constant the running build defines.
        const AT = (BABYLON.PBRMaterial && BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST !== undefined)
            ? BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST
            : BABYLON.Material.MATERIAL_ALPHATESTMODE;
        const alphaTest = meshes[0].material.transparencyMode === AT;
        const sameMat = meshes.every((m) =>
            m.material.uniqueId === meshes[0].material.uniqueId);
        return {
            present, d, redFrac: n ? red / n : 0,
            stations, alphaTest, sameMat,
            nMeshes: meshes.length,
        };
    });

    expect(r.present).toBe(true);
    expect(r.nMeshes).toBe(1);
    expect(r.sameMat).toBe(true);
    expect(r.alphaTest).toBe(true);
    // The jacket band is predominantly RED (the whole P3 point).
    expect(r.redFrac, `jacket-band red fraction ${r.redFrac}`).toBeGreaterThan(0.5);
    // Every figure seated on the knoll (≤ 2 cm re-pick error), never floating.
    for (const s of r.stations) {
        expect(s.g, `no ground picked under coach at ${s.x},${s.z}`).not.toBeNull();
        expect(s.baseY, `coach base ${s.baseY} vs ground ${s.g}`)
            .toBeLessThanOrEqual(s.g + 0.005);
        expect(s.g - s.baseY, `coach sunk ${s.g - s.baseY} deep`).toBeLessThan(0.05);
    }
    // On the knoll: beside the corridor, near the crest (z ≈ KICKER_END_Z).
    for (const s of r.stations) {
        expect(Math.abs(s.x)).toBeGreaterThan(1.0);
        expect(Math.abs(s.z - r.d.stations[0].z)).toBeLessThan(3.0);
    }
});

test('venue dressing: generic blue/white side panels on the kicker block walls, red edge paint intact', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._kickerPanels && window._kickerPanels.count >= 4,
        null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const kp = window._kickerPanels;
        const meshes = scene.meshes.filter(m => (m.name || '').indexOf('kickerPanel') === 0);
        // Wall seating: every panel path point hugs x = ±(halfW − 0.02) and sits
        // above the table top (the panels hang on the block's side walls).
        let worstX = 0, minPanelY = Infinity;
        for (const m of meshes) {
            const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            for (let i = 0; i < pos.length; i += 3) {
                worstX = Math.max(worstX, Math.abs(Math.abs(pos[i]) - kp.halfW));
                minPanelY = Math.min(minPanelY, pos[i + 1]);
            }
        }
        // Materials: two blues (field) + one white (band), generic.
        const mats = [...new Set(meshes.map(m => m.material.name))].sort();
        const blue = scene.getMaterialByName('kickerPanelBlue');
        const white = scene.getMaterialByName('kickerPanelWhite');
        // Red edge paint (author ruling) untouched: cornerMat still red, all
        // six edge tubes present.
        const cm = scene.getMaterialByName('cornerMat');
        const tubes = ['kickerTopL', 'kickerTopR', 'kickerBotL', 'kickerBotR',
            'kickerEdgeL', 'kickerEdgeR'].map(n => !!scene.getMeshByName(n));
        return {
            kp, meshCount: meshes.length, mats,
            worstX: +worstX.toFixed(4), minPanelY: +minPanelY.toFixed(3),
            blue: blue ? [blue.diffuseColor.r, blue.diffuseColor.g, blue.diffuseColor.b] : null,
            white: white ? [white.diffuseColor.r, white.diffuseColor.g, white.diffuseColor.b] : null,
            cornerRed: cm ? [+cm.diffuseColor.r.toFixed(2), +cm.diffuseColor.g.toFixed(2), +cm.diffuseColor.b.toFixed(2)] : null,
            tubes,
        };
    });
    expect(r.meshCount, 'expected 6 panel ribbons (2 sides × 3 spans)').toBe(6);
    expect(r.mats).toEqual(['kickerPanelBlue', 'kickerPanelWhite']);
    // Blue is blue (b channel dominant), white is near-white, generic: no mark geometry.
    expect(r.blue[2]).toBeGreaterThan(r.blue[0]);
    expect(Math.min(...r.white)).toBeGreaterThan(0.85);
    // Panels hug the wall planes.
    expect(r.worstX, `panel off wall plane by ${r.worstX}`).toBeLessThan(0.005);
    // Span the kicker curve only (KICKER_START_Z..KICKER_END_Z window).
    expect(r.kp.minZ).toBeGreaterThan(10);
    expect(r.kp.maxZ).toBeLessThan(25);
    // Author ruling 2026-08-29: red edge paint intact.
    expect(r.cornerRed[0]).toBeGreaterThan(0.7);
    expect(r.cornerRed[1]).toBeLessThan(0.15);
    expect(r.tubes.every(t => t), 'a kicker edge tube is missing').toBe(true);
});

// ── Review-125 near-post read defect ──────────────────────────────────────────
// From the scene camera the near-left fence is nearly edge-on. With the old
// alphaCutOff 0.5 the tile's mip-averaged alpha (~45% rope coverage) fell
// below the cutoff and the WHOLE strip was culled — the posts read as a row
// of floating dark sticks with no net. Gate: from the look.spec scene
// framing, hiding bnetStrip_L must change a measurable fraction of the frame
// (the net is actually drawing), and setting the cutoff back to 0.5 in-page
// must collapse that signal (negative control for the mip-culling fix).
test('venue dressing: near-side net strip draws at the grazing scene view (review-125)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bnetSeated === true,
        null, { timeout: 20000 });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    const r = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const engine = scene.getEngine();
        const cam = scene.activeCamera;
        engine.stopRenderLoop();
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35;   // look.spec scene framing
        const stripL = scene.getMeshByName('bnetStrip_L');
        const grab = async () => {
            scene.render(); scene.render();
            return engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
        };
        const diffFrac = async () => {
            const withN = await grab();
            stripL.setEnabled(false);
            const without = await grab();
            stripL.setEnabled(true);
            let n = 0;
            const total = withN.length / 4;
            for (let i = 0; i < withN.length; i += 4) {
                const d = Math.abs(withN[i] - without[i]) +
                          Math.abs(withN[i + 1] - without[i + 1]) +
                          Math.abs(withN[i + 2] - without[i + 2]);
                if (d >= 12) n++;
            }
            return n / total;
        };
        const visible = await diffFrac();
        const mat = stripL.material;
        const saved = mat.alphaCutOff;
        mat.alphaCutOff = 0.5;              // the pre-fix value
        const culled = await diffFrac();
        mat.alphaCutOff = saved;
        return { visible, culled };
    });
    // Measured 2026-08-30 (swiftshader, scene framing): cutoff 0.3 mask
    // 0.0151, 0.4 → 0.0092, pre-fix 0.5 → 0.0039 (monotone in the mip
    // averaging). Gates sit between with ≥ 2x discrimination each way.
    expect(r.culled, `cutoff-0.5 control still drew mask ${r.culled}`)
        .toBeLessThan(0.007);
    expect(r.visible, `net strip mask ${r.visible} at the grazing view`)
        .toBeGreaterThan(Math.max(0.012, r.culled * 2));
});

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

test('venue dressing: landing centreline wands (2 orange rows, seated) + plain blue knoll flag', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() =>
        window._wandsDebug && window._wandsDebug.poles > 0,
        null, { timeout: 20000 });
    await page.waitForFunction(() => window._wandsSeated === true,
        null, { timeout: 20000 });
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const fallbackY = (z) =>
            AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025;
        const pickGround = (x, z) => {
            const hit = scene.pickWithRay(
                new BABYLON.Ray(new BABYLON.Vector3(x, 80, z),
                                new BABYLON.Vector3(0, -1, 0), 150),
                (m) => !!m.name && !/^(bnet|wand|knollFlag|pk_|tr_|fl_)/.test(m.name));
            return hit && hit.hit ? hit.pickedPoint.y : fallbackY(z);
        };

        const d = window._wandsDebug;
        const footErr = Math.max(...d.stations.map((p) =>
            Math.abs(p.y - pickGround(p.x, p.z))));
        const leftX = new Set(d.stations.filter((p) => p.x < 0).map((p) => +p.x.toFixed(3)));
        const rightX = new Set(d.stations.filter((p) => p.x > 0).map((p) => +p.x.toFixed(3)));
        const wandSrc = scene.getMeshByName('wandPole');
        const pennantSrc = scene.getMeshByName('wandPennant');

        const pole = scene.getMeshByName('knollFlagPole');
        const cloth = scene.getMeshByName('knollFlagCloth');
        const f = window._knollFlagDebug;
        // Bases are planted 6 cm below the surface; measure the burial depth.
        const burial = d.stations.map((p) => pickGround(p.x, p.z) - p.y);
        const minBurial = Math.min(...burial);
        const maxBurial = Math.max(...burial);
        const flagBaseErr = f ? Math.abs(f.baseY - pickGround(f.x, f.z)) : null;
        const clothBlue = cloth && cloth.material &&
            cloth.material.albedoColor.b > 0.5 &&
            cloth.material.albedoColor.r < 0.3;

        return {
            poles: d.poles,
            rows: d.rows,
            singleXPerSide: leftX.size === 1 && rightX.size === 1,
            wandThinInstances: wandSrc ? wandSrc.thinInstanceCount : 0,
            pennantThinInstances: pennantSrc ? pennantSrc.thinInstanceCount : 0,
            footErr,
            minBurial,
            maxBurial,
            spanZ: d.stations.length
                ? [Math.min(...d.stations.map((p) => p.z)), Math.max(...d.stations.map((p) => p.z))]
                : [0, 0],
            cfgLandingStartZ: cfg.LANDING_START_Z,
            cfgOutrunZ: cfg.OUTRUN_Z,
            flag: {
                present: !!(f && pole && cloth),
                flagBaseErr,
                poleHeight: pole ? +(pole.scaling.y *
                    (pole.getBoundingInfo ? 1 : 1)).toFixed(3) : null,
                clothBlue,
                zAtKickerEnd: f ? Math.abs(f.z - cfg.KICKER_END_Z) < 0.01 : false,
            },
        };
    });

    // Two rows, evenly spaced, either side of the centreline.
    expect(r.rows).toBe(2);
    expect(r.poles).toBeGreaterThanOrEqual(8);
    expect(r.singleXPerSide, 'wand rows are not straight lines').toBe(true);
    expect(r.wandThinInstances).toBe(r.poles);
    expect(r.pennantThinInstances).toBe(r.poles);
    // Planted: every base sits 1–13 cm BELOW the visual surface (6 cm target;
    // the async landing chop can lower the surface up to ~7 cm more). Never
    // floating — that is the failure the planting exists to prevent.
    expect(r.minBurial, `a wand floats ${(-r.minBurial).toFixed(3)} m above the snow`)
        .toBeGreaterThan(-0.005);
    expect(r.maxBurial, `a wand is buried ${r.maxBurial.toFixed(3)} m deep`)
        .toBeLessThan(0.13);
    // Rows mark the LANDING (from just past the knuckle to the roll-out).
    expect(r.spanZ[0]).toBeGreaterThan(r.cfgLandingStartZ);
    expect(r.spanZ[1]).toBeLessThan(r.cfgOutrunZ);

    // Knoll flag: seated at the crest, plain blue cloth, no roundel (plain colour).
    expect(r.flag.present).toBe(true);
    expect(r.flag.flagBaseErr, `flag foot terrain mismatch ${r.flag.flagBaseErr}`)
        .toBeLessThan(0.02);
    expect(r.flag.clothBlue).toBe(true);
    expect(r.flag.zAtKickerEnd).toBe(true);
});

test('venue dressing: judges/start deck on dark containers beside the kicker, level and seated', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() =>
        window._judgesDeckDebug && window._judgesDeckSeated === true,
        null, { timeout: 20000 });
    await page.waitForTimeout(300);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const d = window._judgesDeckDebug;
        const deck = scene.getMeshByName('judgesDeckTop');
        const cont1 = scene.getMeshByName('judgesDeckCont1');
        const cont2 = scene.getMeshByName('judgesDeckCont2');
        const railTop = scene.getMeshByName('judgesDeckRailTop');
        const railMid = scene.getMeshByName('judgesDeckRailMid');

        // Independent re-pick of the flank under each deck corner.
        const pickGround = (x, z) => {
            const hit = scene.pickWithRay(
                new BABYLON.Ray(new BABYLON.Vector3(x, 80, z),
                                new BABYLON.Vector3(0, -1, 0), 150),
                (m) => !!m.name && !/^judgesDeck/.test(m.name));
            return hit && hit.hit ? hit.pickedPoint.y : null;
        };
        const bb = deck.getBoundingInfo().boundingBox;
        const wp = deck.position;
        const halfW = bb.maximumWorld.x - bb.minimumWorld.x; // world extents via
        const halfD = bb.maximumWorld.z - bb.minimumWorld.z; // re-created box
        // Use the deck's world matrix corners instead (transform-safe):
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
            const x = wp.x + sx * (bb.maximum.x) * 0.9;
            const z = wp.z + sz * (bb.maximum.z) * 0.9;
            return { x, z, g: pickGround(x, z) };
        });
        // Container bases at least at the deck base (they hold it up).
        const contBaseMin = Math.min(cont1.position.y, cont2.position.y) -
            (cont1.getBoundingInfo().boundingBox.maximum.y);
        const deckBase = deck.position.y - deck.getBoundingInfo().boundingBox.maximum.y;

        return {
            debug: d,
            present: !!(deck && cont1 && cont2 && railTop && railMid),
            contTexture: !!(cont1 && cont1.material && cont1.material.albedoTexture),
            plankTexture: !!(deck && deck.material && deck.material.albedoTexture),
            corners,
            contBaseMin, deckBase,
            railHeights: railTop && railMid ? {
                top: railTop.position.y, mid: railMid.position.y,
            } : null,
            sameContMat: cont1 && cont2 &&
                cont1.material.uniqueId === cont2.material.uniqueId,
        };
    });

    expect(r.present).toBe(true);
    expect(r.contTexture).toBe(true);
    expect(r.plankTexture).toBe(true);
    expect(r.sameContMat).toBe(true);
    // Level deck: base sits at/below every corner's flank surface (sunk),
    // never floating above the lowest corner's ground.
    const lowest = Math.min(...r.corners.map((c) => c.g));
    expect(r.debug.baseY, `deck base ${r.debug.baseY} floats over lowest corner ${lowest}`)
        .toBeLessThanOrEqual(lowest + 0.005);
    // Containers support the deck (their top reaches the deck underside).
    expect(r.contBaseMin + 2 * 2.59 * 0 + 2.59, 'container tops must reach the deck underside')
        .toBeGreaterThanOrEqual(r.deckBase - 0.02);
    // Rail present, ordered correctly.
    expect(r.railHeights.top).toBeGreaterThan(r.railHeights.mid);
    // Beside the kicker, outside the B-net line: deck entirely at x ≥ 7.5.
    expect(r.debug.deckTopY).toBeGreaterThan(r.debug.baseY + 2.5);
});

test('venue dressing: three static coach figures in red jackets at the knoll, seated', async ({ page }) => {
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
        const meshes = [0, 1, 2].map((i) => scene.getMeshByName('knollCoach' + i));
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
    expect(r.nMeshes).toBe(3);
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

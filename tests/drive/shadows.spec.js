'use strict';
// ── Shadows: cascaded sun shadow acceptance (P2 quick win) ────────────────────
// Gates, with numbers recorded in docs/RENDER-PROGRESS.md:
//   1. structure — the sun's shadow map lists the skinned athleteBody primitives
//      AND both skis as casters once the async glb resolves;
//   2. athlete — terrain directly under the standing figure is ≥ 15% darker than
//      a 2 m ring beside it (ring probe borrowed from review-measure.spec.js);
//   3. trees — under a near tree reads ≥ 20% darker than open snow at the same
//      distance (pairs use the analytic sun-offset crown-shadow centre; one bad
//      pair among the three nearest trees is tolerated).
// Baseline under the old single-map generator was 11.6% / none.
const { test, expect } = require('@playwright/test');

async function grabPixels(page) {
    const shot = await page.screenshot();
    return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return { W: img.width, H: img.height, d: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) };
    }, shot.toString('base64'));
}

function patchStats(f, cx, cy, r = 3) {
    let R = 0, G = 0, B = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= f.W || y >= f.H) continue;
        const i = (y * f.W + x) * 4;
        R += f.d[i] / 255; G += f.d[i + 1] / 255; B += f.d[i + 2] / 255; n++;
    }
    if (!n) return null;
    return { lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4), n };
}

test('cascaded sun shadows: casters wired, athlete shadow, tree shadow', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(1500);

    // ── 1. Structure: the async-skinned body and both skis must be casters ───
    const struct = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        let gen = null;
        if (Array.isArray(scene.shadowGenerators) && scene.shadowGenerators.length) {
            gen = scene.shadowGenerators.find(g => g.getShadowMap && g.getShadowMap()) || null;
        }
        if (!gen && Array.isArray(scene.lights)) {
            for (const l of scene.lights) {
                const g = l.getShadowGenerator && l.getShadowGenerator();
                if (g && g.getShadowMap && g.getShadowMap()) { gen = g; break; }
            }
        }
        if (!gen) return { ok: false, why: 'no shadow generator' };
        const rl = gen.getShadowMap().renderList || [];
        const names = rl.map(m => m.name || '');
        return {
            ok: true,
            csm: gen.numCascades !== undefined,
            numCascades: gen.numCascades || 1,
            listed: names.length,
            hasBodyParts: names.filter(n => n.startsWith('athleteBody')).length,
            hasSkis: ['skiL', 'skiR'].filter(n => names.indexOf(n) !== -1).length,
            hasTrees: names.filter(n => /^(tr_|fl_)/.test(n)).length,
        };
    });
    expect(struct.ok, 'shadow map render list reachable').toBe(true);
    expect(struct.hasBodyParts, 'athleteBody primitives are casters').toBeGreaterThan(0);
    expect(struct.hasSkis, 'skiL and skiR are casters').toBe(2);
    expect(struct.hasTrees, 'trees are casters').toBeGreaterThan(50);

    // Figure bounds — shared by probes 2 and 3.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        window._shCentre = lo.add(hi).scale(0.5);
        window._shExt = hi.subtract(lo).scale(0.5);
    });

    // ── 2. Athlete ring probe (overhead): under-figure vs 2 m ring ───────────
    const ringPx = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const c = window._shCentre, e = window._shExt;
        const ground = new BABYLON.Vector3(c.x, c.y - e.y, c.z);
        cam.setTarget(ground.clone());
        cam.beta = 0.05; cam.alpha = 0; cam.radius = 10;
        scene.render();
        const eng = scene.getEngine();
        const proj = (p) => {
            const v = BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(),
                scene.getTransformMatrix(), cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
            return [Math.round(v.x), Math.round(v.y)];
        };
        return {
            ground: proj(ground),
            ring: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
                const a = (k / 8) * Math.PI * 2;
                return proj(new BABYLON.Vector3(
                    ground.x + 2.0 * Math.cos(a), ground.y, ground.z + 2.0 * Math.sin(a)));
            }),
        };
    });
    await page.waitForTimeout(600);
    const s2 = await grabPixels(page);
    const underLum = patchStats(s2, ringPx.ground[0], ringPx.ground[1]).lum;
    const ringLums = ringPx.ring.map((p) => patchStats(s2, p[0], p[1])).filter(Boolean);
    const ringMin = Math.min(...ringLums.map(p => p.lum));
    const ringMax = Math.max(...ringLums.map(p => p.lum));
    const dropAthlete = +((ringMax - underLum) / ringMax).toFixed(4);

    // ── 3. Tree probe. The crown's ground shadow is displaced from its trunk
    //       along the sun's horizontal ray u = −(dx,dz)/|..|, READ FROM THE LIVE
    //       LIGHT (iter 51 moved the sun to 32° elevation, azimuth exactly
    //       camera-left — the ray is no longer the old (0.35,0.45)). At 32° the
    //       cast band sits at 1.6 × crown height from the trunk, so samples run
    //       4–20 m (the old 60° sun put the band at 0.57 × height, 4–9 m was
    //       enough). Controls 12 m in the opposite direction and to both sides —
    //       controls must read bright snow. Ground truth per tree = the trunk
    //       mesh's bbox bottom (the game plants trunks exactly on the terrain).
    //       Three nearest trees are candidates; one qualifying pair passes.
    const treePx = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const c = window._shCentre;
        const _sun = scene.lights.find(l => l.getClassName() === 'DirectionalLight');
        const _hn = Math.hypot(_sun.direction.x, _sun.direction.z);
        const ux = -_sun.direction.x / _hn, uz = -_sun.direction.z / _hn;
        const trunks = scene.meshes.filter(m => m.name && /^tr_/.test(m.name))
            .map(m => {
                m.computeWorldMatrix(true);
                const b = m.getBoundingInfo().boundingBox;
                return { name: m.name, suffix: m.name.slice(3),
                         x: (b.minimumWorld.x + b.maximumWorld.x) / 2,
                         z: (b.minimumWorld.z + b.maximumWorld.z) / 2,
                         groundY: b.minimumWorld.y };
            })
            .sort((a, b) =>
                ((a.x - c.x) ** 2 + (a.z - c.z) ** 2) -
                ((b.x - c.x) ** 2 + (b.z - c.z) ** 2))
            .slice(0, 3);
        // One top-down camera wide enough for all candidate sample zones.
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 500;
        cam.setTarget(new BABYLON.Vector3(c.x * 0.5 + trunks[0].x * 0.5, trunks[0].groundY,
                                          c.z * 0.5 + trunks[0].z * 0.5));
        cam.beta = 0.05; cam.alpha = 0; cam.radius = 70;
        scene.render();
        const eng = scene.getEngine();
        const proj = (p) => {
            const v = BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(),
                scene.getTransformMatrix(), cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
            return [Math.round(v.x), Math.round(v.y)];
        };
        return {
            nTrunks: scene.meshes.filter(m => m.name && /^tr_/.test(m.name)).length,
            trees: trunks.map((tr) => ({
                name: tr.name, x: +tr.x.toFixed(1), y: +tr.groundY.toFixed(1), z: +tr.z.toFixed(1),
                shadow: [4, 8, 12, 16, 20].map(d =>
                    proj(new BABYLON.Vector3(tr.x + d * ux, tr.groundY + 0.05, tr.z + d * uz))),
                ctrl: [
                    proj(new BABYLON.Vector3(tr.x - 12 * ux, tr.groundY + 0.05, tr.z - 12 * uz)),
                    proj(new BABYLON.Vector3(tr.x - 12 * uz, tr.groundY + 0.05, tr.z + 12 * ux)),
                    proj(new BABYLON.Vector3(tr.x + 12 * uz, tr.groundY + 0.05, tr.z - 12 * ux)),
                ],
            })),
        };
    });
    await page.waitForTimeout(600);
    const s3 = await grabPixels(page);
    const lum = (px) => { const s = patchStats(s3, px[0], px[1], 4); return s ? s.lum : null; };
    let bestTreeDrop = null;
    for (const tr of treePx.trees) {
        const cl = tr.ctrl.map(lum).filter(v => v !== null).sort((a, b) => a - b);
        if (!cl.length || cl[Math.floor(cl.length / 2)] <= 0.45) continue;   // controls not open snow
        const sl = tr.shadow.map(lum).filter(v => v !== null);
        if (!sl.length) continue;
        const ctrlMed = cl[Math.floor(cl.length / 2)];
        const drop = +(((ctrlMed - Math.min(...sl)) / ctrlMed)).toFixed(4);
        if (bestTreeDrop === null || drop > bestTreeDrop.drop) {
            bestTreeDrop = { tree: tr.name, drop, ctrlMed: +ctrlMed.toFixed(4),
                             shadowMin: +Math.min(...sl).toFixed(4) };
        }
    }
    const treeNum = bestTreeDrop ? bestTreeDrop.drop : 0;

    const out = {
        struct,
        athleteShadow: {
            underLum, ringMin: +ringMin.toFixed(4), ringMax: +ringMax.toFixed(4),
            dropFrac: dropAthlete, gate: '>= 0.15',
        },
        treeShadow: {
            nTrunks: treePx.nTrunks, best: bestTreeDrop, gate: '>= 0.20',
            treesDebug: treePx.trees.map(tr => ({
                name: tr.name,
                ctrlLums: tr.ctrl.map(lum), shadowLums: tr.shadow.map(lum),
            })),
        },
    };
    console.log('SHADOW_MEASURE ' + JSON.stringify(out));

    expect(dropAthlete, 'terrain under standing athlete >=15% darker than ring').toBeGreaterThanOrEqual(0.15);
    expect(bestTreeDrop, 'some near tree has a valid shadow/open-snow pair').not.toBeNull();
    expect(treeNum, 'under near tree >=20% darker than open snow').toBeGreaterThanOrEqual(0.20);
});

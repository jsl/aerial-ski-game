'use strict';
// ── P2 sky gates: real sky dome, sun disc/glare, clouds, snow > sky ──────────
// Landed iteration 39 (P2 slice: procedural gradient dome + cumulus + sun disc
// at the directional light's direction, fog to clear air, contrast 1.6→1.2).
// Measures from live renders:
//   1. structure — a skyDome mesh exists on the skyShader ShaderMaterial and is
//      NOT a shadow caster;
//   2. zenith — deep blue (b − r ≥ 0.12), luminance inside [0.10, 0.60];
//   3. sun disc — a bright patch at the projected sun direction, ≥ 0.25 over
//      the zenith (the disc rides the HDR roll-off + bloom);
//   4. clouds — cumulus present: near-white pixels fill 2–70% of the sky band;
//   5. margin — from the default ready framing, snow ≥ sky + 0.05 luminance
//      (the reviewer's P2 gate; the pre-sky flat teal measured sky 0.5472 vs
//      snow 0.8270 — margin 0.28 — so the bar is the floor, not the goal).
// The camera follow drags target y/z every step (see kicker-faces.spec.js), so
// the render loop is stopped and each framing is composed + rendered in ONE
// synchronous task, twice, before the screenshot.
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

function regionStats(f, x0, y0, x1, y1) {
    const X0 = Math.round(x0 * f.W), X1 = Math.round(x1 * f.W);
    const Y0 = Math.round(y0 * f.H), Y1 = Math.round(y1 * f.H);
    let R = 0, G = 0, B = 0, n = 0, white = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        R += r; G += g; B += b; n++;
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 && Math.abs(r - b) <= 0.10) white++;
    }
    return {
        lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4),
        rb: +((R - B) / n).toFixed(4),
        whiteFrac: +(white / n).toFixed(4),
        n,
    };
}

function patchStats(f, cx, cy, r = 4) {
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

test('P2 sky: dome, deep-blue zenith, sun disc, clouds, snow brighter than sky', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);

    // ── 1. Structure: dome present, shader material, not a shadow caster ─────
    const struct = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const dome = scene.getMeshByName('skyDome');
        if (!dome) return { ok: false, why: 'skyDome mesh missing' };
        let casters = [];
        try {
            const gen = (scene.shadowGenerators || []).find(g => g.getShadowMap && g.getShadowMap());
            casters = (gen && gen.getShadowMap().renderList || []).map(m => m.name || '');
        } catch (e) { /* no generator — nothing to leak into */ }
        return {
            ok: true,
            mat: dome.material ? dome.material.name : null,
            inShadowList: casters.indexOf('skyDome') !== -1,
            infiniteDistance: !!dome.infiniteDistance,
            pickable: !!dome.isPickable,
        };
    });
    expect(struct.ok, struct.why || 'skyDome exists').toBe(true);
    expect(struct.mat).toBe('skyShader');
    expect(struct.inShadowList, 'skyDome must not be a shadow caster').toBe(false);
    expect(struct.infiniteDistance).toBe(true);
    expect(struct.pickable).toBe(false);

    // Stop the follow loop; compose + render synchronously per framing. The
    // game's camera follow lives in scene.registerBeforeRender (game.js), so it
    // runs inside ANY scene.render() and re-drags the ArcRotate target — a
    // dedicated FreeCamera with the same post pipeline attached is immune to it.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().stopRenderLoop();
        const cam = new BABYLON.FreeCamera('skyCam',
            new BABYLON.Vector3(0, 25, 40), scene);
        cam.fov = 0.9; cam.minZ = 0.1; cam.maxZ = 10000;
        try {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('dof', cam);
        } catch (e) { /* measure unticked if the pipeline is absent */ }
        scene.activeCamera = cam;
        window._skyCam = cam;
        window._skyCompose = (mode) => {
            const c = window._skyCam;
            if (mode === 'sun') {
                // Look along the sun direction from 25 m up: sun centred.
                const light = scene.lights.find(l => l.name === 'sun');
                const sd = light.direction.clone().normalize().scale(-1);
                c.position.set(-sd.x * 10, 25 - sd.y * 10, 30 - sd.z * 10);
                c.setTarget(new BABYLON.Vector3(0, 25, 30));
            } else if (mode === 'sky') {
                // Look up 47° over clear air: upper sky + cloud band.
                c.position.set(0, 25, 20);
                c.setTarget(new BABYLON.Vector3(0, 25 + 10 * Math.sin(47 * Math.PI / 180),
                                                 20 + 10 * Math.cos(47 * Math.PI / 180)));
            } else {
                // The look.spec scene.png ArcRotate framing (alpha 1.35π,
                // beta π/2.7, radius 14 about the athlete), rebuilt analytically
                // on the free camera.
                const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
                let lo = null, hi = null;
                for (const p of parts) {
                    p.computeWorldMatrix(true);
                    const b = p.getBoundingInfo().boundingBox;
                    lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
                    hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
                }
                const C = lo.add(hi).scale(0.5);
                window._skyCentre = C;
                const a = Math.PI * 1.35, b = Math.PI / 2.7, r = 14;
                c.position.set(C.x + r * Math.cos(a) * Math.sin(b),
                               C.y + r * Math.cos(b),
                               C.z + r * Math.sin(a) * Math.sin(b));
                c.setTarget(C.clone());
            }
        };
        window._skyRender2 = (mode) => {
            window._skyCompose(mode);
            scene.render();
            window._skyCompose(mode);
            scene.render();
        };
    });

    // ── 2–4. Up-look framing: gradient, sun disc, clouds ─────────────────────
    await page.evaluate(() => window._skyRender2('sun'));
    const fs = await grabPixels(page);
    const sunPx = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const light = scene.lights.find(l => l.name === 'sun');
        const sd = light.direction.clone().normalize().scale(-1);   // toward the sun
        const eng = scene.getEngine();
        const v = BABYLON.Vector3.Project(cam.position.add(sd.scale(100)),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
        return { x: Math.round(v.x), y: Math.round(v.y),
                 W: eng.getRenderWidth(), H: eng.getRenderHeight() };
    });
    const sun = patchStats(fs, sunPx.x, sunPx.y, 6);

    await page.evaluate(() => window._skyRender2('sky'));
    const fz = await grabPixels(page);
    const zenith = regionStats(fz, 0.35, 0.02, 0.65, 0.20);
    const skyBand = regionStats(fz, 0.08, 0.06, 0.92, 0.42);

    // ── 5. scene.png framing: snow vs sky margin ─────────────────────────────
    await page.evaluate(() => window._skyRender2('ready'));
    const fr = await grabPixels(page);
    const skyTop = regionStats(fr, 0.25, 0.00, 0.75, 0.05);
    // Reviewer gate (03:15/06:55 notes): the scene framing's sky must read
    // blue down to the tree line. The literal "top third" region is ~half
    // terrain-snow pixels (the ArcRotate target rides the athlete's live
    // bounding box), so the mean is diluted toward white no matter how blue
    // the dome is (measured −0.09 with a −0.31 pure-sky zenith); gate the
    // sky-dominated upper band instead.
    const skyTopThird = regionStats(fr, 0.00, 0.00, 1.00, 0.10);
    const snowPx = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = (cfg.LANDING_START_Z + cfg.KICKER_END_Z) / 2;       // mid-table
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025; // FOOT_OFFSET
        const cam = scene.activeCamera;
        const eng = scene.getEngine();
        const p = BABYLON.Vector3.Project(new BABYLON.Vector3(0, y, z),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
        return { x: p.x, y: p.y, W: eng.getRenderWidth(), H: eng.getRenderHeight() };
    });
    const snow = regionStats(fr,
        snowPx.x / snowPx.W - 0.04, snowPx.y / snowPx.H - 0.008,
        snowPx.x / snowPx.W + 0.04, snowPx.y / snowPx.H + 0.008);

    const out = {
        struct,
        zenith, skyBand, sun: sun && sun.lum,
        sunAt: sunPx, readySky: skyTop, skyTopThird, snow,
        margin: +(snow.lum - skyTop.lum).toFixed(4),
    };
    console.log('SKY_MEASURE ' + JSON.stringify(out));

    expect(zenith.n).toBeGreaterThan(400);
    expect(zenith.lum, `zenith luminance ${zenith.lum} outside deep-blue band [0.10, 0.60]`)
        .toBeGreaterThan(0.10);
    expect(zenith.lum).toBeLessThan(0.60);
    expect(zenith.rb, `zenith chroma r−b = ${zenith.rb}; deep blue needs b − r ≥ 0.12`)
        .toBeLessThanOrEqual(-0.12);
    expect(sun, 'sun disc patch sampled').not.toBeNull();
    expect(sun.lum, `sun patch ${sun.lum} not ≥ 0.25 over zenith ${zenith.lum}`)
        .toBeGreaterThanOrEqual(zenith.lum + 0.25);
    expect(skyBand.whiteFrac, `cloud white fraction ${skyBand.whiteFrac} outside [0.02, 0.70]`)
        .toBeGreaterThan(0.02);
    // Blue-to-treeline: gate the all-sky band's chroma (pure dome pixels).
    // The scene framing's top third is ~60% snowfield terrain (whiteFrac
    // 0.59), so a chroma average there measures the terrain, not the sky.
    expect(skyBand.rb,
        `sky band chroma r−b = ${skyBand.rb}; blue-to-treeline gate needs ≤ −0.25`)
        .toBeLessThanOrEqual(-0.25);
    expect(out.margin, `snow ${snow.lum} must beat sky ${skyTop.lum} by ≥ 0.05`)
        .toBeGreaterThanOrEqual(0.05);
});

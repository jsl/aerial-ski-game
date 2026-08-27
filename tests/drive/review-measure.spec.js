'use strict';
// Review-measurement harness (iteration 5, review-only). Reports numbers for the
// render review: corridor vs flank luminance (the grey ramp), sky-likeness of
// rows inside the terrain footprint (the cyan seam), whether the athlete casts
// a shadow (ring probe), and the face region under the helmet. NOT a gate — it
// prints REVIEW_MEASURE and asserts only that the samples were actually taken.
const { test, expect } = require('@playwright/test');

// Decode a PNG in-page and pull the whole pixel buffer out as a plain array
// (closures cannot cross the evaluate boundary, so the math happens in Node).
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

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Mean luminance + sky-likeness fraction (sky/fog blue dominance) of a region
// given in fractional frame coordinates.
function regionStats(f, x0, y0, x1, y1) {
    const X0 = Math.round(x0 * f.W), X1 = Math.round(x1 * f.W);
    const Y0 = Math.round(y0 * f.H), Y1 = Math.round(y1 * f.H);
    let R = 0, G = 0, B = 0, n = 0, sky = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        R += r; G += g; B += b; n++;
        if (b > r + 0.10 && b > 0.55) sky++;
    }
    return { lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4), skyFrac: +(sky / n).toFixed(4), n };
}

// Mean luminance / dark fraction of a small box centred on a pixel.
function patchStats(f, cx, cy, r = 3) {
    let R = 0, G = 0, B = 0, n = 0, dark = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= f.W || y >= f.H) continue;
        const i = (y * f.W + x) * 4;
        const rr = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
        R += rr; G += g; B += b; n++;
        if (lumOf(rr, g, b) < 0.25) dark++;
    }
    if (!n) return null;
    return { lum: +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4), darkFrac: +(dark / n).toFixed(3), n };
}

test('review measurements: grey ramp, seam scan, athlete shadow, face', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);

    // ── 1. Scene view (same camera as look.spec's scene.png) ────────────────
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
        window._revCentre = lo.add(hi).scale(0.5);
        window._revExt = hi.subtract(lo).scale(0.5);
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(window._revCentre.clone());
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35; cam.fov = 0.8;
    });
    await page.waitForTimeout(900);
    // Corridor box (ported from grey-ramp.spec.js, iter-16): the fixed
    // fractional box below sampled wInrun/wStartPlat flank fills after the
    // P1 ribbon replaced the slabs — project a real table-centre corridor
    // point into screen space instead.
    const corBox = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = (cfg.LANDING_START_Z + cfg.KICKER_END_Z) / 2;      // mid-table
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) - 1.025; // FOOT_OFFSET
        const p = BABYLON.Vector3.Project(new BABYLON.Vector3(0, y, z),
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            scene.activeCamera.viewport.toGlobal(
                scene.getEngine().getRenderWidth(), scene.getEngine().getRenderHeight()));
        return { x: p.x / scene.getEngine().getRenderWidth(),
                 y: p.y / scene.getEngine().getRenderHeight() };
    });
    const s1 = await grabPixels(page);
    const sceneStats = {
        sky:        regionStats(s1, 0.02, 0.02, 0.18, 0.12),
        corridor:   regionStats(s1, corBox.x - 0.05, corBox.y - 0.008,
                                corBox.x + 0.05, corBox.y + 0.008),
        flankNear:  regionStats(s1, 0.06, 0.78, 0.30, 0.92),
        flankFar:   regionStats(s1, 0.78, 0.60, 0.95, 0.68),
        kickerFace: regionStats(s1, 0.14, 0.30, 0.20, 0.36),
        inrun:      regionStats(s1, 0.18, 0.46, 0.28, 0.52),
    };
    let worstRow = { y: 0, skyFrac: 0 };
    for (let y = 0.40; y <= 0.95; y += 0.025) {
        const s = regionStats(s1, 0.02, y, 0.98, y + 0.012);
        if (s.skyFrac > worstRow.skyFrac) worstRow = { y: +y.toFixed(3), skyFrac: s.skyFrac };
    }

    // ── 2. Athlete shadow ring probe (overhead camera) ──────────────────────
    const shadow = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const c = window._revCentre, e = window._revExt;
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
    const under = patchStats(s2, shadow.ground[0], shadow.ground[1]);
    const ringLums = shadow.ring
        .map((p) => patchStats(s2, p[0], p[1]))
        .filter(Boolean)
        .map((p) => p.lum);
    const ringMin = Math.min(...ringLums), ringMax = Math.max(...ringLums);

    // ── 3. Face region under the helmet (front view, face-part bbox) ────────
    const facePx = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        cam.setTarget(window._revCentre.clone());
        cam.radius = 2.4; cam.beta = Math.PI / 2.6; cam.alpha = Math.PI * 0.32;
        const face = scene.meshes.find(m => m.name && m.name.startsWith('athleteBody')
            && m.material && m.material.name === 'athleteFace_mat');
        if (!face) return null;
        face.computeWorldMatrix(true);
        const b = face.getBoundingInfo().boundingBox;
        const pt = b.minimumWorld.add(b.maximumWorld).scale(0.5);
        scene.render();
        const eng = scene.getEngine();
        const v = BABYLON.Vector3.Project(pt, BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(), cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
        return { name: face.name, px: [Math.round(v.x), Math.round(v.y)] };
    });
    await page.waitForTimeout(600);
    const s3 = await grabPixels(page);
    const face = facePx ? patchStats(s3, facePx.px[0], facePx.px[1], 8) : null;

    const out = {
        scene: sceneStats,
        greyRamp: {
            corridor_vs_flankNear: +(sceneStats.corridor.lum - sceneStats.flankNear.lum).toFixed(4),
            corridor_vs_flankFar: +(sceneStats.corridor.lum - sceneStats.flankFar.lum).toFixed(4),
        },
        seamWorstRow: worstRow,
        shadow: {
            underAthlete: under ? under.lum : null,
            ringMin: +ringMin.toFixed(4), ringMax: +ringMax.toFixed(4),
            dropFrac: +((ringMax - ringMin) / ringMax).toFixed(4),
        },
        face,
        facePart: facePx ? facePx.name : null,
    };
    console.log('REVIEW_MEASURE ' + JSON.stringify(out));

    expect(out.scene.sky.n).toBeGreaterThan(100);
    expect(out.scene.corridor.n).toBeGreaterThan(100);
    expect(out.scene.flankNear.n).toBeGreaterThan(100);
    expect(out.shadow.underAthlete).not.toBeNull();
    expect(out.face).not.toBeNull();
});

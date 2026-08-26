'use strict';
// Grey-ramp attribution FINAL: three states, each from a CLEAN reload, plus a
// full enumerable property diff of the baked clone against a fresh plain
// material. Temporary diagnostic, not a gate.
const { test } = require('@playwright/test');

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
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y * f.W + x) * 4;
        R += f.d[i] / 255; G += f.d[i + 1] / 255; B += f.d[i + 2] / 255; n++;
    }
    return +((0.2126 * R + 0.7152 * G + 0.0722 * B) / n).toFixed(4);
}

const bootAndAim = async (page) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);
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
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(lo.add(hi).scale(0.5));
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35; cam.fov = 0.8;
    });
};

const snap = async (page, AB, tag) => {
    await page.waitForTimeout(700);
    const f = await grabPixels(page);
    AB[tag] = {
        corridor:   regionStats(f, 0.55, 0.50, 0.65, 0.54),
        flankNear:  regionStats(f, 0.06, 0.78, 0.30, 0.92),
        flankFar:   regionStats(f, 0.78, 0.60, 0.95, 0.68),
        kickerFace: regionStats(f, 0.14, 0.30, 0.20, 0.36),
        inrun:      regionStats(f, 0.18, 0.46, 0.28, 0.52),
    };
};

// Opt-in diagnostic: GREY_AB=1 npx playwright test --config tests/drive/playwright.config.js grey-ab
const RUN = process.env.GREY_AB === '1';
(RUN ? test : test.skip)('grey ramp: clean-state triple + property diff', async ({ page }) => {
    const AB = {};

    // S1: untouched
    await bootAndAim(page);
    await snap(page, AB, 's1_clean');

    // grab the corridor material identity & which meshes use what
    const census = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const names = ['slope', 'trans_seg_8', 'flatTable', 'kicker_seg_10', 'landing', 'outrun'];
        return names.map(n => {
            const m = scene.getMeshByName(n);
            return { n, mat: m && m.material ? m.material.name : null };
        });
    });
    console.log('CENSUS ' + JSON.stringify(census));

    // S2: strip the baked multiplier textures
    await page.evaluate(() => {
        for (const mat of BABYLON.EngineStore.LastCreatedScene.materials) {
            if (!mat || !/_baked$/.test(mat.name)) continue;
            mat.ambientTexture = null; mat.lightmapTexture = null;
            mat.useLightmapAsShadowmap = false;
        }
    });
    await snap(page, AB, 's2_nobake');

    // S3: replace corridor mesh materials with a fresh plain material
    const swapInfo = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const m = new BABYLON.PBRMaterial('abPlain2', scene);
        m.albedoColor = new BABYLON.Color3(0.9, 0.92, 0.95);
        m.metallic = 0; m.roughness = 0.75; m.metallicF0Factor = 0.21;
        let n = 0;
        const re = /^(slope|trans_seg_\d+|flatTable|flatTableFull|landing|outrun|start|kicker_seg_\d+)$/;
        for (const mesh of scene.meshes) {
            if (mesh.name && re.test(mesh.name)) { mesh.material = m; n++; }
        }
        return n;
    });
    console.log('SWAP ' + swapInfo);
    await snap(page, AB, 's3_plain');

    // Property diff: snowMat_baked (now unused) vs abPlain2
    const diff = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const c = scene.materials.find(m => m.name === 'snowMat_baked');
        const p = scene.materials.find(m => m.name === 'abPlain2');
        if (!c || !p) return null;
        const out = {};
        for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(c))) {
            try {
                const cvv = c[k], pv = p[k];
                if (typeof cvv === 'function') continue;
                const cs = JSON.stringify(cvv && cvv.asArray ? cvv.asArray() : cvv);
                const ps = JSON.stringify(pv && pv.asArray ? pv.asArray() : pv);
                if (cs !== ps) out[k] = [cs && cs.slice(0, 60), ps && ps.slice(0, 60)];
            } catch (e) {}
        }
        return out;
    });
    console.log('MATDIFF ' + JSON.stringify(diff));

    console.log('GREY_AB4 ' + JSON.stringify(AB));
});

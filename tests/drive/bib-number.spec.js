'use strict';
// ── Bib number "30": hard render gate (P7, review-60 item 1) ──────────────────
// The build-side bake gate (build_body.py bib_number_gate) proves the ink is
// on the saved albedo at the plate UVs, but the review-60 finding was that the
// digits were still invisible at the look camera — the plates carried each
// other's reading direction (mirrored "30" on both sides, iter-61 probe) and
// the canonical front framing was ~58 deg off the chest. This spec asks the
// RENDERED question, front and back:
//   1. the number plate sits inside a projected box on the near-side chest/back
//      face and carries a plausible share of dark navy ink (band below);
//   2. the bib panel (powder blue) is on the chest side, not wrapped around.
// Bands are the iter-61 rebuild measurements with slack (navyFrac 0.063 both
// sides; bib-blue 0.102 front vs 0.017 back).
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
        return {
            W: img.width, H: img.height,
            d: Array.from(ctx.getImageData(0, 0, img.width, img.height).data),
        };
    }, shot.toString('base64'));
}

async function frameFigure(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        if (!parts.length) throw new Error('no athleteBody meshes');
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
        cam.radius = 2.4; cam.fov = 0.8;
        cam.beta = Math.PI / 2.35;
        // The SUIT part: the athleteBody part with the largest bounding box
        // (the skinned suit, not the small helmet primitive). Its bbox is the
        // plate-frame source — see the note in plateView.
        let suit = null, suitVol = -1;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            const e = b.maximumWorld.subtract(b.minimumWorld);
            const vol = e.x * e.y * e.z;
            if (vol > suitVol) { suitVol = vol; suit = { c: b.centerWorld, half: e.scale(0.5) }; }
        }
        window._bibBody = { c: lo.add(hi).scale(0.5), half: hi.subtract(lo).scale(0.5), suit };
    });
}

// One plate view: orbit to `alpha`, then project the near-side plate centre
// (chest +x face for the alpha-0 view, back −x face for pi) and measure the
// navy-ink / bib-blue fractions inside a 0.13 × 0.20 m box around it.
async function plateView(page, name, alpha, sideSign) {
    await page.evaluate((a) => {
        BABYLON.EngineStore.LastCreatedScene.activeCamera.alpha = a;
    }, alpha);
    await page.waitForTimeout(900);
    const state = await page.evaluate(({ cmd, sgn }) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const engine = scene.getEngine();
        // The camera must have kept the commanded orbit. The per-frame
        // callback rewrites camera.target every step; alpha/beta are not
        // rewritten in the ready state. If that ever changes, the box below
        // lands on scenery and the ink fraction fails — the correct outcome
        // for a framing drift, but say so in the error.
        const got = ((cam.alpha - cmd) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        if (Math.abs(got) > 0.05) return { err: 'camera alpha drifted to ' + cam.alpha };
        // Iter 74: the whole-figure bbox is polluted by the 1.55 m skis, and a
        // fixed lateral fraction (the old 0.98/0.85 * half.x) drifts off the
        // surface when the chest moves — the straightened build receded and the
        // box measured sky + blue B-net behind the athlete (front navyFrac
        // 0.0075, all-bright box). Raycast inward from an outside point onto
        // the SUIT SURFACE instead.
        const { suit, c } = window._bibBody;
        const sc = suit.c;
        const outside = new BABYLON.Vector3(sc.x + sgn * (suit.half.x + 0.2), c.y + suit.half.y * 0.18, sc.z);
        const inward = new BABYLON.Vector3(-sgn, 0, 0);
        const hit = scene.pickWithRay(new BABYLON.Ray(outside, inward, 2), m => m.name && m.name.startsWith('athleteBody'));
        if (!hit || !hit.hit) return { err: 'no athleteBody hit on the plate ray' };
        const p = BABYLON.Vector3.Project(hit.pickedPoint, BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(),
            cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
        return { sx: p.x / engine.getRenderWidth(), sy: p.y / engine.getRenderHeight() };
    }, { cmd: alpha, sgn: sideSign });
    if (state.err) throw new Error(state.err);

    const f = await grabPixels(page);
    const PX_PER_M = f.H / (2 * 2.4 * Math.tan(0.4));   // fov 0.8 rad, r 2.4 m
    const bw = Math.round(0.13 * PX_PER_M), bh = Math.round(0.20 * PX_PER_M);
    const X0 = Math.round(state.sx * f.W - bw / 2), Y0 = Math.round(state.sy * f.H - bh / 2);
    let n = 0, navy = 0, blue = 0;
    for (let y = Math.max(0, Y0); y < Math.min(f.H, Y0 + bh); y++) {
        for (let x = Math.max(0, X0); x < Math.min(f.W, X0 + bw); x++) {
            const i = (y * f.W + x) * 4;
            const r = f.d[i] / 255, g = f.d[i + 1] / 255, b = f.d[i + 2] / 255;
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            n++;
            if (lum < 0.38 && b >= g - 0.02 && g >= r - 0.04) navy++;
            if (b > r + 0.08 && lum > 0.35) blue++;
        }
    }
    const navyFrac = navy / n, blueFrac = blue / n;
    console.log(`BIB ${name}: box=[${X0},${Y0} ${bw}x${bh}] n=${n} ` +
        `navyFrac=${navyFrac.toFixed(4)} blueFrac=${blueFrac.toFixed(4)}`);
    // Ship the measured box as a picture. These bands were originally
    // calibrated against a render in which the athlete was out of focus (the
    // depth of field was pinned at 10 m and never tracked the subject), so
    // "what the box actually contains" is exactly the thing that was never
    // checked by eye.
    {
        const marked = await page.evaluate(async (a) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + a.b64;
            await img.decode();
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0);
            ctx.strokeStyle = '#ff2020';
            ctx.lineWidth = 2;
            ctx.strokeRect(a.X0, a.Y0, a.bw, a.bh);
            return cv.toDataURL('image/png');
        }, { b64: (await page.screenshot()).toString('base64'), X0, Y0, bw, bh });
        const fs = require('node:fs');
        const dir = require('node:path').resolve(__dirname, '..', '..', 'shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(require('node:path').join(dir, `bib_${name}.png`),
            Buffer.from(marked.split(',')[1], 'base64'));
    }
    return { navyFrac, blueFrac };
}

test('bib number 30 reads on both faces at the look camera', async ({ page }) => {
    await frameFigure(page);

    const front = await plateView(page, 'front', 0, 1);
    const back = await plateView(page, 'back', Math.PI, -1);
    for (const [nm, s] of [['front', front], ['back', back]]) {
        expect(s.navyFrac, `bib number ink missing on the ${nm} face ` +
            `(navyFrac ${s.navyFrac.toFixed(4)})`).toBeGreaterThan(0.02);
        expect(s.navyFrac, `bib number ink flooded on the ${nm} face ` +
            `(navyFrac ${s.navyFrac.toFixed(4)} — plate reads as a dark slab)`)
            .toBeLessThan(0.25);
    }
    // The bib panel is a chest garment: the front face carries the full panel
    // and the back only the designed narrow rear patch (rebuild measured
    // 0.102 vs 0.068), so the front must dominate but the back stays bounded.
    expect(front.blueFrac, 'bib panel not visible from the front').toBeGreaterThan(0.04);
    expect(front.blueFrac, 'bib panel does not dominate the back panel')
        .toBeGreaterThan(back.blueFrac);
    expect(back.blueFrac, 'bib panel wrapped around to the back').toBeLessThan(0.09);
});

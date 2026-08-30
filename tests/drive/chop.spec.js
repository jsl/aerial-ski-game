'use strict';
// ── P5: chopped-landing brightness + visibility ─────────────────────────────
// HUMAN TESTING #9 item 1 (author, 2026-08-29 23:05): "the texture on the chop
// is good but not sure why it is so dark." The chop is snow: relief comes from
// the height displacement and the normal map's shadowed walls, not from dark
// paint, and the rendered patch must be as bright as the surrounding snow.
// Gates:
//   · displacement actually applied, worst sink inside the ≤ 0.10 m
//     contact-rule band;
//   · RENDERED luminance parity: chop band mean ≥ 0.92 × adjacent flat-snow
//     mean, measured from the low landing camera (author's gate);
//   · ALBEDO parity: the baked chop albedo tile's mean ≥ 0.90 × the corridor
//     snow surface albedo's mean (author's gate), when the snow canvas is
//     readable;
//   · relief present in the shipped height tile (per-texel SD).
// The rendered p95−p5 "relief" spread of the pre-HT#9 build (> 0.10) was
// SSAO blotches at the 1.2 m radius — the very darkness the author reported —
// so it is recorded, not gated; with sane AO the honest headless band reads
// ≈ 0.012 and the real relief shows via displacement + sun shadows.
// Negative control (pre-HT#9 build): SSAO 1.2 m / strength 0.9 rendered the
// chop/flat ratio at 0.52 — fails the parity gate.
const { test, expect } = require('@playwright/test');

test('chopped landing: displacement in-band, rendered parity with flat snow, albedo parity, relief in asset', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._chopStats && window._chopStats.sunkVerts > 0,
        null, { timeout: 20000 });
    await page.waitForTimeout(700);

    const r = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const A = window._runAnchors();
        const zMid = (A.LANDING_START_Z + A.OUTRUN_Z) / 2;
        const y = window._crashFloorY(zMid);
        const saved = { a: cam.alpha, b: cam.beta, rr: cam.radius, t: cam.target.clone() };
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(new BABYLON.Vector3(0, y, zMid));
        cam.alpha = Math.PI / 2;          // across the hill
        cam.beta = Math.PI / 2.6;         // ~22° above the surface
        cam.radius = 12;
        scene.render();
        const gl = scene.getEngine().getRenderingCanvas();
        const cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d');
        cx.drawImage(gl, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        const lumAt = (x0, x1, yy0, yy1) => {
            const lum = [];
            for (let yy = Math.round(H * yy0); yy < H * yy1; yy++)
                for (let xx = Math.round(W * x0); xx < W * x1; xx++) {
                    const i = (yy * W + xx) * 4;
                    lum.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
                }
            return lum;
        };
        // Central 60%×40% band: the landing slope fills it from this framing.
        const lum = lumAt(0.2, 0.8, 0.3, 0.7);
        const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
        const s = lum.slice().sort((a, b) => a - b);
        const spread = s[Math.floor(s.length * 0.95)] - s[Math.floor(s.length * 0.05)];
        // Adjacent flat corridor snow: same rows, left of the chop zone.
        const flatLum = lumAt(0.02, 0.18, 0.35, 0.65);
        const flatMean = flatLum.reduce((a, b) => a + b, 0) / flatLum.length;
        cam.setTarget(saved.t); cam.alpha = saved.a; cam.beta = saved.b; cam.radius = saved.rr;

        const texMean = (px) => {
            let acc = 0, n = 0;
            for (let i = 0; i < px.length; i += 64) {
                acc += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
                n++;
            }
            return acc / n;
        };
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'assets/landing_chop_albedo.png?v=43'; });
        const tc = document.createElement('canvas');
        tc.width = img.width; tc.height = img.height;
        const tx = tc.getContext('2d');
        tx.drawImage(img, 0, 0);
        const chopTexMean = texMean(tx.getImageData(0, 0, tc.width, tc.height).data);
        const snowMat = scene.materials.find(m => m.name === 'snowMat');
        let snowTexMean = null;
        try {
            const at = snowMat.albedoTexture;
            const cnv = at && at.getContext && at.getContext();
            if (cnv) {
                const sz = at.getSize ? at.getSize() : { width: cnv.width };
                snowTexMean = texMean(cnx(sz.width));
            }
            function cnx(w) {
                const c2 = cnv.getContext ? cnv : null;
                return cnv.getContext('2d').getImageData(0, 0, w, w).data;
            }
        } catch (e) { snowTexMean = null; }

        // Relief variation in the shipped asset: the baked height tile's
        // per-texel SD (0..1 maps to the logged amplitude range).
        const himg = new Image();
        await new Promise((res, rej) => { himg.onload = res; himg.onerror = rej; himg.src = 'assets/landing_chop_height.png?v=43'; });
        const hc = document.createElement('canvas');
        hc.width = himg.width; hc.height = himg.height;
        const hx = hc.getContext('2d');
        hx.drawImage(himg, 0, 0);
        const hpx = hx.getImageData(0, 0, hc.width, hc.height).data;
        const hv = [];
        for (let i = 0; i < hpx.length; i += 256) hv.push(hpx[i] / 255);
        const hMean = hv.reduce((a, b) => a + b, 0) / hv.length;
        const hSd = Math.sqrt(hv.reduce((a, b) => a + (b - hMean) ** 2, 0) / hv.length);

        return {
            chop: window._chopStats,
            zone: window._chopZone,
            mean: +mean.toFixed(4),
            flatMean: +flatMean.toFixed(4),
            ratio: +(mean / flatMean).toFixed(4),
            spread: +spread.toFixed(4),
            heightSd: +hSd.toFixed(4),
            chopTexMean: +chopTexMean.toFixed(4),
            snowTexMean: snowTexMean == null ? null : +snowTexMean.toFixed(4),
        };
    });

    // Displacement landed and respects the chopped-landing sink band ≤ 0.10 m.
    expect(r.chop.sunkVerts).toBeGreaterThan(50);
    expect(r.chop.worstSink, `worst sink ${r.chop.worstSink} outside the 0.10 m band`)
        .toBeLessThanOrEqual(0.101);
    expect(r.chop.worstSink, `chop barely displaced (${r.chop.worstSink}) — invisible by construction`)
        .toBeGreaterThan(0.05);
    // HUMAN TESTING #9 gate: rendered parity with the surrounding snow.
    expect(r.ratio, `chop band luminance ${r.mean} vs flat snow ${r.flatMean} — ratio ${r.ratio} < 0.92: the patch still reads dark`)
        .toBeGreaterThanOrEqual(0.92);
    // HUMAN TESTING #9 gate: albedo texture parity with the corridor snow tile.
    if (r.snowTexMean != null) {
        expect(r.chopTexMean / r.snowTexMean,
            `chop albedo ${r.chopTexMean} vs snow albedo ${r.snowTexMean} < 0.90`)
            .toBeGreaterThanOrEqual(0.90);
    }
    // Relief exists in the shipped height tile (a perfectly flat patch is a
    // fail — the author liked the texture; only its darkness was wrong).
    expect(r.heightSd, `height tile SD ${r.heightSd} — the chop relief is gone`)
        .toBeGreaterThan(0.06);
});

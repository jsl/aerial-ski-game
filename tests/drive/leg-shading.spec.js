'use strict';
// ── HT#23.3: the LEG-SHADING instrument (Fable ruling on 181, 2026-08-31) ───
// v74's leg tube measures measurably straight (side thigh belly 0.5 px,
// entry 182) yet the author's by-eye "muscular" read persisted. The ruling:
// the residual read is SHADING — body-derived muscle modelling baked into the
// leg garment's AO/normal maps. build_body.py now removes the mid-frequency
// (muscle-scale) band from those maps in the leg-garment UV region.
//
// WHAT THE GATE IS (measured honestly, 183): the RENDER-space band metric is
// NOT discriminative — pre/post flatten measured bp3_7 thigh 13.65 vs 13.26
// (within run noise): lighting, SSAO and suit-panel edges swamp the texture
// signal at these scales. The discriminating instrument is TEXTURE-space:
// build_body.py's flatten logs, into athlete_maps.json, the leg-mask mid-band
// energy of the AO/normal maps before and after the pass (v75: normal
// 13.30 -> 5.21, ao 15.71 -> 8.14; a BODY_FLATTEN_OFF build leaves the maps
// at ~13/16 and the build-side gate fires). This spec gates on those stats
// and REPORTS the render-space band-pass numbers.
const { test, expect } = require('@playwright/test');

const GATE_NORMAL_AFTER = 7.0;   // v75 measures 5.21; pre-flatten 13.30
const GATE_AO_AFTER = 10.0;      // v75 measures 8.14; pre-flatten 15.71

async function measureShading(page, label, alphaOff) {
    return page.evaluate(async (alphaOff) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        const isAthlete = (m) => m.name && m.name.indexOf('athleteBody') === 0;
        const hidden = [];
        for (const m of scene.meshes) {
            if (m.isEnabled() && !isAthlete(m)) { hidden.push(m); m.setEnabled(false); }
        }
        const parts = scene.meshes.filter(isAthlete);
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        const centre = lo.add(hi).scale(0.5);
        const root = scene.getMeshByName('skierRoot') || scene.getNodeByName('skierRoot');
        const fwd = root ? root.getDirection(new BABYLON.Vector3(0, 0, -1))
                         : new BABYLON.Vector3(0, 0, -1);
        fwd.y = 0; fwd.normalize();
        const cam = scene.activeCamera;
        const camSaved = { t: cam.target.clone(), r: cam.radius,
                           a: cam.alpha, b: cam.beta };
        cam.setTarget(centre);
        cam.alpha = Math.atan2(fwd.z, fwd.x) + alphaOff;
        cam.beta = Math.PI / 2;
        cam.radius = 3.0;
        const mesh = parts[0];
        mesh.computeWorldMatrix(true);
        const world = mesh.getWorldMatrix();
        const project = (v) => BABYLON.Vector3.Project(v,
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            cam.viewport.toGlobal(W, H));
        scene.render(); scene.render();
        const anchors = {};
        for (const b of mesh.skeleton.bones) {
            const f = b.getFinalMatrix && b.getFinalMatrix();
            if (!f || !/^(hlpHip|hlpKnee|lowerLeg)[LR]$/.test(b.name)) continue;
            const p = project(BABYLON.Vector3.TransformCoordinates(
                f.getTranslation(), world));
            anchors[b.name] = { row: Math.round(p.y), x: p.x };
        }
        const rowMean = (pre) => {
            const rs = Object.entries(anchors)
                .filter(([k]) => k.startsWith(pre)).map(([, a]) => a.row);
            return rs.length ? Math.round(rs.reduce((a, r) => a + r, 0) / rs.length) : -1;
        };
        const hipRow = rowMean('hlpHip');
        const kneeRow = rowMean('hlpKnee');
        const ankleRow = rowMean('lowerLeg');
        const px = await eng.readPixels(0, 0, W, H);
        const at = (x, y) => {
            const i = ((H - 1 - y) * W + x) * 4;
            return [px[i], px[i + 1], px[i + 2]];
        };
        const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
        const ref = [0, 1, 2].map(c => corners.reduce((a, p) => a + p[c], 0) / 4);
        const isBg = (x, y) => {
            const p = at(x, y);
            return Math.abs(p[0] - ref[0]) + Math.abs(p[1] - ref[1])
                 + Math.abs(p[2] - ref[2]) < 40;
        };
        const cov0 = (y0, y1) => {
            const rows = [];
            for (let y = y0; y <= y1; y++) {
                const r = { y, xs: [] };
                for (let x = 0; x < W; x++)
                    if (!isBg(x, y)) r.xs.push(x);
                if (r.xs.length > 2) rows.push(r);
            }
            if (!rows.length) return null;
            let x0 = W, x1 = 0;
            for (const r of rows) { x0 = Math.min(x0, r.xs[0]); x1 = Math.max(x1, r.xs[r.xs.length - 1]); }
            const wid = x1 - x0 + 1;
            const L = new Float32Array(rows.length * wid);
            const cov = new Uint8Array(rows.length * wid);
            rows.forEach((r, j) => {
                for (const x of r.xs) {
                    const p = at(x, r.y);
                    L[j * wid + (x - x0)] = (p[0] + p[1] + p[2]) / 3;
                    cov[j * wid + (x - x0)] = 1;
                }
            });
            return { L, cov, hgt: rows.length, wid };
        };
        const boxBlur = (src, cov, hgt, wid, R) => {
            const sum = new Float32Array(src.length), cnt = new Float32Array(src.length);
            for (let j = 0; j < hgt; j++)
                for (let i = 0; i < wid; i++)
                    if (cov[j * wid + i])
                        for (let dj = -R; dj <= R; dj++)
                            for (let di = -R; di <= R; di++) {
                                const jj = j + dj, ii = i + di;
                                if (jj < 0 || jj >= hgt || ii < 0 || ii >= wid) continue;
                                const k = jj * wid + ii;
                                if (!cov[k]) continue;
                                sum[j * wid + i] += src[k]; cnt[j * wid + i] += 1;
                            }
            const out = new Float32Array(src.length);
            for (let k = 0; k < src.length; k++)
                out[k] = cnt[k] > 0 ? sum[k] / cnt[k] : src[k];
            return out;
        };
        const bandRms = (c, rA, rB, inject = 0) => {
            const L = Float32Array.from(c.L);
            if (inject) {
                const cj = Math.floor(c.hgt / 2), ci = Math.floor(c.wid / 2);
                for (let j = 0; j < c.hgt; j++)
                    for (let i = 0; i < c.wid; i++)
                        if (c.cov[j * c.wid + i])
                            L[j * c.wid + i] += inject * Math.exp(
                                -(((j - cj) ** 2 + (i - ci) ** 2) / 32));
            }
            const bA = boxBlur(L, c.cov, c.hgt, c.wid, rA);
            const bB = boxBlur(L, c.cov, c.hgt, c.wid, rB);
            let s = 0, n = 0;
            for (let k = 0; k < L.length; k++)
                if (c.cov[k]) { const hp = bA[k] - bB[k]; s += hp * hp; n++; }
            return +(Math.sqrt(s / Math.max(1, n))).toFixed(2);
        };
        const M = 6;
        const cThigh = cov0(hipRow + M, kneeRow - M);
        const cShin = cov0(kneeRow + M, ankleRow - M);
        const measure = (c) => {
            const m = { n: c ? c.cov.reduce((a, v) => a + v, 0) : 0 };
            for (const [a, b] of [[2, 4], [3, 7], [5, 11]])
                m[`bp${a}_${b}`] = c ? bandRms(c, a, b) : 0;
            return m;
        };
        // Self-test: the band-pass counter applied to a synthetic muscle-scale
        // shading patch (amplitude 100, sigma 4 px) ALONE — proves the
        // counter responds to exactly the signal the flatten removes.
        const synth = (c) => {
            const L = new Float32Array(c.L.length);
            const cj = Math.floor(c.hgt / 2), ci = Math.floor(c.wid / 2);
            for (let j = 0; j < c.hgt; j++)
                for (let i = 0; i < c.wid; i++)
                    if (c.cov[j * c.wid + i])
                        L[j * c.wid + i] = 100 * Math.exp(
                            -(((j - cj) ** 2 + (i - ci) ** 2) / 32));
            const bA = boxBlur(L, c.cov, c.hgt, c.wid, 3);
            const bB = boxBlur(L, c.cov, c.hgt, c.wid, 7);
            let s = 0, n = 0;
            for (let k = 0; k < L.length; k++)
                if (c.cov[k]) { const hp = bA[k] - bB[k]; s += hp * hp; n++; }
            return +(Math.sqrt(s / Math.max(1, n))).toFixed(2);
        };
        const inject = cThigh ? synth(cThigh) : 0;
        const thigh = measure(cThigh);
        thigh.inject = inject;
        const shin = measure(cShin);
        scene.render();
        cam.setTarget(camSaved.t); cam.radius = camSaved.r;
        cam.alpha = camSaved.a; cam.beta = camSaved.b;
        for (const m of hidden) m.setEnabled(true);
        return { hipRow, kneeRow, ankleRow, thigh, shin };
    }, alphaOff);
}

test('leg shading: leg-garment AO/normal mid-band flatten present and effective (athlete_maps.json); render-space band-pass instrument reported with injected-patch self-test', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(1200);

    // GATE (texture-space): the flatten ran and bit, per athlete_maps.json.
    const maps = await (await page.request.fetch('/assets/athlete_maps.json')).json();
    console.log('LEGSHADE maps', JSON.stringify({
        normal: maps.stats && maps.stats.normal_flatten,
        ao: maps.stats && maps.stats.ao_flatten,
    }));
    expect(maps.stats.normal_flatten && maps.stats.normal_flatten.after)
        .toBeLessThanOrEqual(GATE_NORMAL_AFTER);
    expect(maps.stats.ao_flatten && maps.stats.ao_flatten.after)
        .toBeLessThanOrEqual(GATE_AO_AFTER);
    // The pass must have BIT: mid-band energy measurably down, not a no-op.
    expect(maps.stats.normal_flatten.after)
        .toBeLessThan(maps.stats.normal_flatten.before * 0.7);
    expect(maps.stats.ao_flatten.after)
        .toBeLessThan(maps.stats.ao_flatten.before * 0.7);

    // INSTRUMENT (render space): band-pass bands + injected-patch self-test.
    // Reported, not gated (see header: not discriminative — 183 measurement).
    const side = await measureShading(page, 'side', Math.PI / 2);
    console.log('LEGSHADE side', JSON.stringify(side));
    // Negative control 1 (instrument self-test): the band-pass counter must
    // respond decisively to a muscle-scale shading patch measured alone.
    expect(side.thigh.inject).toBeGreaterThan(2.0);

    const front = await measureShading(page, 'front', 0);
    console.log('LEGSHADE front', JSON.stringify(front)); // reported, not gated
});

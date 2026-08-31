'use strict';
// ── HT#23.3: de-muscularized tube silhouettes, render space ─────────────────
// The Fable ruling on 178 (docs/RENDER-PROGRESS.md, 09:20): the silhouette
// instrument's anchor rows MUST derive from the LEG BONES' projected screen
// positions — not fixed frame rows and not driver boxes (178's prototype
// sampled the torso/bib; withdrawn). Equivalence/sanity control: every bone
// anchor must land INSIDE the leg silhouette in all three framings.
//
// Gate: in the SIDE framing, the fore-aft silhouette width profile of each
// leg segment (thigh = pelvis→knee rows, shin = knee→ankle rows) shows at
// most 2 inflections — a garment tube is a near-straight taper; muscle
// bellies are extra bulges. Profile is smoothed (3×[1 2 1]) and the
// derivative is sign-counted through a 1.5 px deadband.
//
// Negative controls (both must fire):
//   1. Instrument self-test: the measured profile is re-counted with a
//      synthetic Gaussian belly injected — the counter must report > 2
//      inflections for the sabotaged profile and the gate must fail it.
//   2. Pre-#23.3 assets (recorded in the 181 entry): the e0c0658 build
//      measures thigh > 2 inflections with this exact spec.
const { test, expect } = require('@playwright/test');

async function measureFraming(page, label, alphaOff) {
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
        // Bone anchors, from the skeleton's FINAL matrices — the one source
        // that is measured, not assumed (178's lesson). Mesh-local space:
        //   hlpHip = hip joint, hlpKnee = knee joint,
        //   lowerLeg = bone origin at the ANKLE (bind per ANATOMY).
        // NOTE: anchors are projected only AFTER two renders — the driver
        // nodes' world matrices and the scene transform are stale until the
        // first render under the measurement camera; projecting earlier
        // reads the WRONG camera frame (178's diagnosis, re-proven 181).
        // Vector3.Project returns TOP-DOWN screen y: the row is q.y
        // itself, matching the (H-1-y) readPixels flip used by at().
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
        const px = await eng.readPixels(0, 0, W, H);
        const kneeRow = rowMean('hlpKnee');
        const ankleRow = rowMean('lowerLeg');

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
        // SANITY CONTROL (the ruling's equivalence instrument): each bone
        // anchor must land inside the leg silhouette. Strict form: screen
        // x within the silhouette row span at the anchor's own row (6 px
        // AA tolerance). The ANKLE bones relax this to a band of rows
        // [row-8, row+8] with a 10 px tolerance: the ankle joint origin is
        // offset fore-aft from the skinned boot by the bind rotation
        // (measured: up to 21 px in the side framing), while the 178
        // failure mode this control exists against — anchors hundreds of
        // px away on the torso — still fails decisively.
        const rowSpan = (y) => {
            let mn = -1, mx = -1;
            for (let x = 0; x < W; x++)
                if (!isBg(x, y)) { if (mn < 0) mn = x; mx = x; }
            return mn < 0 ? null : [mn, mx];
        };
        const anchorChecks = {};
        for (const [k, a] of Object.entries(anchors)) {
            const band = k.startsWith('lowerLeg') ? 8 : 0;
            const tol = k.startsWith('lowerLeg') ? 10 : 6;
            let ok = false, spanSeen = null;
            for (let y = Math.max(0, a.row - band);
                 y <= Math.min(H - 1, a.row + band) && !ok; y++) {
                const s = rowSpan(y);
                if (!s) continue;
                spanSeen = s;
                if (a.x >= s[0] - tol && a.x <= s[1] + tol) ok = true;
            }
            anchorChecks[k] = ok ? 'inside'
                : { row: a.row, x: +a.x.toFixed(1),
                    span: spanSeen ? spanSeen.join('-') : null };
        }
        const smooth = (p) => p.map((_, i) =>
            i === 0 || i === p.length - 1 ? p[i]
                : (p[i - 1] + 2 * p[i] + p[i + 1]) / 4);
        // Per-row silhouette width (fore-aft extent) within [y0..y1],
        // y growing downward.
        const widthProfile = (y0, y1) => {
            const prof = [];
            for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
                let mn = -1, mx = -1;
                for (let x = 0; x < W; x++) {
                    if (!isBg(x, y)) { if (mn < 0) mn = x; mx = x; }
                }
                prof.push(mn < 0 ? 0 : mx - mn);
            }
            return prof;
        };
        // Inflections: sign changes of the smoothed derivative through a
        // deadband (px); the profile is smoothed twice before differencing.
        const inflections = (prof, deadband = 1.5) => {
            const s = smooth(smooth(prof));
            const d = [];
            for (let i = 1; i < s.length; i++) d.push(s[i] - s[i - 1]);
            let signs = [], last = 0;
            for (const v of d) {
                if (v > deadband) last = 1;
                else if (v < -deadband) last = -1;
                signs.push(last);
            }
            let n = 0;
            for (let i = 1; i < signs.length; i++)
                if (signs[i] !== 0 && signs[i] !== signs[i - 1]) n++;
            return n;
        };
        const M = 4; // rows of margin around each joint anchor
        const thigh = widthProfile(hipRow + M, kneeRow - M);
        const shin = widthProfile(kneeRow + M, ankleRow - M);
        const nThigh = inflections(thigh);
        const nShin = inflections(shin);
        // NEGATIVE CONTROL 1 (instrument self-test): inject a synthetic
        // muscle belly into the measured profile; the counter MUST fire.
        const sabotaged = thigh.slice();
        const ci = Math.floor(sabotaged.length / 2), amp = Math.max(6, Math.max(...thigh) * 0.12);
        for (let i = 0; i < sabotaged.length; i++) {
            sabotaged[i] += amp * Math.exp(-((i - ci) ** 2) / 18);
        }
        const nSabotage = inflections(sabotaged);

        scene.render();
        cam.setTarget(camSaved.t); cam.radius = camSaved.r;
        cam.alpha = camSaved.a; cam.beta = camSaved.b;
        for (const m of hidden) m.setEnabled(true);
        return { hipRow, kneeRow, ankleRow, anchorChecks,
            thighRows: thigh.length, shinRows: shin.length,
            nThigh, nShin, nSabotage, W, H };
    }, alphaOff);
}

test('tube smooth: leg bone anchors inside the silhouette (front/side/back); side-framing thigh and shin width profiles show <= 2 inflections (negative control: injected belly fires)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(1200);

    // Sanity first: bone anchors land inside the leg silhouette everywhere.
    for (const [label, off] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
        const m = await measureFraming(page, label, off);
        console.log(`TUBESMTH ${label}`, JSON.stringify(m));
        for (const [k, c] of Object.entries(m.anchorChecks)) {
            expect(c, `${label}/${k}: anchor sanity`).toBeTruthy();
            if (c && typeof c === 'object') {
                expect(c.frac, `${label}: ${k} anchor not inside the `
                    + `silhouette (body-pixel frac ${c.frac} at row check)`)
                    .toBeGreaterThan(0);
            }
        }
        if (label === 'side') {
            // NEGATIVE CONTROL must fire on the injected belly.
            expect(m.nSabotage, 'instrument self-test did not fire — '
                + `sabotaged profile counted ${m.nSabotage} inflections`)
                .toBeGreaterThan(2);
            expect(m.nThigh, `thigh width profile shows ${m.nThigh} `
                + `inflections (target <= 2) — muscle relief still reads `
                + `in render space (rows ${m.hipRow}..${m.kneeRow})`)
                .toBeLessThanOrEqual(2);
            expect(m.nShin, `shin width profile shows ${m.nShin} `
                + `inflections (target <= 2) — calf belly still reads `
                + `in render space (rows ${m.kneeRow}..${m.ankleRow})`)
                .toBeLessThanOrEqual(2);
        }
    }
});

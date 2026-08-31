'use strict';
// ── HUMAN TESTING #23.1: leg transparency carve-outs, render space ──────────
// The author (2026-08-31, reference/shots/author_legs1/2/3_2026-08-31.png):
// ragged see-through holes at the outer thighs, hips and knees — open rims
// left by the thigh-tube separation and the crotch shard-cluster cuts
// (FACES_ONLY deletes in build_body.py, 94 rim edges measured). The build
// now fills every rim (watertight gate, BODY_SABOTAGE_CAPS=1 negative
// control); this spec is the RENDER-space gate: from the front, side and
// back framings, NO background pixel may be enclosed inside the athlete's
// silhouette below the hip line.
//
// Instrument: the measurement frame contains ONLY the athlete (every other
// mesh disabled), so background is unambiguous. Enclosedness is decided by a
// flood fill from the frame border over background pixels. The daylight
// BETWEEN the legs is a legitimate enclosed pocket (the tubes are
// deliberately separate, and the legs converge at the ankles at ski
// spacing): it CONNECTS UP TO THE CROTCH. A carve-out hole is a component
// that floats mid-limb — its top starts well below the hip line. That is
// the discriminator: an enclosed component whose top row is more than 10%
// of the leg height below the hip row fails. Negative control: the
// pre-#23.1 shipped build measured a 692 px mid-limb enclosed component
// from the front framing (the spec asserts framing-by-framing and stops at
// the first failure).
const { test, expect } = require('@playwright/test');

async function measureFraming(page, label, alphaOff, fullBody) {
    return page.evaluate(async ({ alphaOff, fullBody }) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const W = eng.getRenderWidth(), H = eng.getRenderHeight();
        const isAthlete = (m) => m.name && m.name.indexOf('athleteBody') === 0;
        const hidden = [];
        for (const m of scene.meshes) {
            if (m.isEnabled() && !isAthlete(m)) { hidden.push(m); m.setEnabled(false); }
        }
        const parts = scene.meshes.filter(isAthlete);
        // ── POSE FREEZE (ruling on 191, 16:20: APPROVED) ────────────────
        // The ready-state idle sway re-poses the athlete every frame, so
        // side/back measurements flaked between runs (side 84 -> 0 px,
        // entry 191) — both a false-green risk and it makes byte-stable
        // reproduction claims impossible. Freeze the posed frame: snapshot
        // every athlete transform (meshes + skeleton bones) and restore it
        // in a LAST-registered before-render callback, so it runs after the
        // game's pose solver and the raster always sees the same frame.
        const frozen = [];
        for (const p of parts) {
            frozen.push({ o: p, p: p.position.clone(), r: p.rotation.clone(),
                          q: p.rotationQuaternion ? p.rotationQuaternion.clone() : null,
                          s: p.scaling.clone() });
        }
        const bones = [];
        for (const sk of scene.skeletons) {
            for (const b of sk.bones) {
                bones.push({ b, p: b.position ? b.position.clone() : null,
                             r: b.rotation ? b.rotation.clone() : null,
                             q: b.rotationQuaternion ? b.rotationQuaternion.clone() : null });
            }
        }
        const restorePose = () => {
            for (const f of frozen) {
                f.o.position.copyFrom(f.p); f.o.rotation.copyFrom(f.r);
                if (f.q) { if (!f.o.rotationQuaternion) f.o.rotationQuaternion = f.q.clone(); else f.o.rotationQuaternion.copyFrom(f.q); }
                f.o.scaling.copyFrom(f.s);
            }
            for (const f of bones) {
                if (f.p) f.b.position.copyFrom(f.p);
                if (f.r) f.b.rotation.copyFrom(f.r);
                if (f.q) { if (!f.b.rotationQuaternion) f.b.rotationQuaternion = f.q.clone(); else f.b.rotationQuaternion.copyFrom(f.q); }
            }
        };
        scene.registerBeforeRender(restorePose);
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

        // hip line: mean of the two upper-leg box centres, at their top
        const hips = [];
        for (const s of ['L', 'R']) {
            const ul = scene.getMeshByName('upperLeg' + s);
            ul.computeWorldMatrix(true);
            const b = ul.getBoundingInfo().boundingBox;
            const hip = b.minimumWorld.add(b.maximumWorld).scale(0.5);
            hip.y = b.maximumWorld.y;
            hips.push(hip);
        }
        const hipC = hips[0].add(hips[1]).scale(0.5);
        const project = (v) => BABYLON.Vector3.Project(v,
            BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
            cam.viewport.toGlobal(W, H));
        const hipRow = Math.round(H - 1 - project(hipC).y);

        scene.render(); scene.render();
        const px = await eng.readPixels(0, 0, W, H);
        // background reference: the four frame corners (athlete-only frame)
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
        // flood fill background from the border; anything bg and unreached
        // below the hip line is an enclosed hole.
        const mark = new Uint8Array(W * H);
        const stack = [];
        for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
        for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
        while (stack.length) {
            const i = stack.pop();
            if (mark[i]) continue;
            const x = i % W, y = (i / W) | 0;
            if (!isBg(x, y)) continue;
            mark[i] = 1;
            if (x > 0) stack.push(i - 1);
            if (x < W - 1) stack.push(i + 1);
            if (y > 0) stack.push(i - W);
            if (y < H - 1) stack.push(i + W);
        }
        const topRow = fullBody ? 0
            : Math.min(H - 1, Math.max(0, hipRow));
        let bgLeg = 0;
        // label connected components of NON-border-connected background
        // below the hip row (y grows downward in this buffer's flipped
        // indexing already handled by at()).
        const comp = new Int32Array(W * H).fill(-1);
        const comps = [];
        for (let y = topRow; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                if (isBg(x, y)) bgLeg++;
                if (!isBg(x, y) || mark[i] || comp[i] >= 0) continue;
                const id = comps.length;
                const c = { area: 0, minX: W, maxX: 0, minY: H, maxY: 0 };
                const st = [i];
                comp[i] = id;
                while (st.length) {
                    const j = st.pop();
                    const jx = j % W, jy = (j / W) | 0;
                    c.area++;
                    if (jx < c.minX) c.minX = jx;
                    if (jx > c.maxX) c.maxX = jx;
                    if (jy < c.minY) c.minY = jy;
                    if (jy > c.maxY) c.maxY = jy;
                    const nb = [j - 1, j + 1, j - W, j + W];
                    for (const k of nb) {
                        if (k < 0 || k >= W * H || comp[k] >= 0 || mark[k]) continue;
                        const kx = k % W, ky = (k / W) | 0;
                        if (!isBg(kx, ky) || ky < topRow) continue;
                        comp[k] = id;
                        st.push(k);
                    }
                }
                comps.push(c);
            }
        }
        // Per-leg screen spans (hip→ankle boxes projected). A component
        // INSIDE a leg's own span is a see-through carve-out in that leg;
        // a component BETWEEN the two legs' inner faces is the legitimate
        // A-frame daylight pocket (the tubes are deliberately separate).
        const segSpan = (names) => {
            let mn = 1e9, mx = -1e9;
            for (const n of names) {
                const m = scene.getMeshByName(n);
                if (!m) continue;
                m.computeWorldMatrix(true);
                const b = m.getBoundingInfo().boundingBox;
                for (const c of [b.minimumWorld, b.maximumWorld]) {
                    const p = project(c);
                    mn = Math.min(mn, p.x); mx = Math.max(mx, p.x);
                }
            }
            return [mn, mx];
        };
        const spans = {
            L: segSpan(['upperLegL', 'lowerLegL']),
            R: segSpan(['upperLegR', 'lowerLegR']),
            armL: segSpan(['upperArmL', 'lowerArmL']),
            armR: segSpan(['upperArmR', 'lowerArmR']),
        };
        const M = fullBody ? 4 : 8;   // px: a hole must be INTERIOR to one
                                      // limb's own span; components touching
                                      // a span edge are the inter-limb
                                      // see-through (daylight pocket class)
        const inSpan = (c) =>
            (c.minX > spans.L[0] + M && c.maxX < spans.L[1] - M) ||
            (c.minX > spans.R[0] + M && c.maxX < spans.R[1] - M) ||
            (spans.armL[1] > spans.armL[0] &&
             c.minX > spans.armL[0] + M && c.maxX < spans.armL[1] - M) ||
            (spans.armR[1] > spans.armR[0] &&
             c.minX > spans.armR[0] + M && c.maxX < spans.armR[1] - M);
        const legSpan = H - hipRow;
        const crotchLimit = hipRow + Math.round(0.10 * legSpan);
        // Legacy (#23.1): a hole starts below the crotch region (not the
        // pocket reaching up to it), is at least 20 px, AND lies interior
        // to a single leg's own screen span.
        // Full body (#26): any enclosed component >= 20 px that starts
        // ABOVE the hip row and lies interior to a limb span. Inter-limb
        // daylight cannot exist above the hip line (the leg pocket tops
        // out at the crotch, below it; arm/torso slits touch a span edge),
        // so such a component is a garment hole — the author's
        // abdomen/hip gaps. Negative control: the current build's holes.
        const holes = fullBody
            ? comps.filter(c => c.area >= 20 && c.minY < hipRow && inSpan(c))
            : comps.filter(c => c.minY > crotchLimit && c.area >= 20
                            && inSpan(c));
        scene.render();
        scene.unregisterBeforeRender(restorePose);
        return { hipRow, crotchLimit,
            holes: holes.reduce((a, c) => a + c.area, 0),
            holeCount: holes.length,
            holesDetail: holes.map(c => ({ a: c.area, x: c.minX + '-' + c.maxX,
                                           y: c.minY + '-' + c.maxY })),
            comps: comps.map(c => ({ a: c.area, x: c.minX + '-' + c.maxX,
                                     y: c.minY + '-' + c.maxY })),
            bgLeg, W, H };
    }, { alphaOff, fullBody });
}

test('leg watertight: no enclosed background inside the silhouette below the hip, front/side/back (negative control: pre-#23.1 build holes)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(1200);

    const framings = [
        ['front', 0], ['side', Math.PI / 2], ['back', Math.PI],
    ];
    for (const [label, off] of framings) {
        const m = await measureFraming(page, label, off);
        console.log(`WATERTIGHT ${label}`, JSON.stringify(m));
        expect(m.holes, `${label}: ${m.holes} px in ${m.holeCount} mid-limb `
            + `enclosed background component(s) below the hip row `
            + `${m.hipRow} (crotch limit ${m.crotchLimit}) — a see-through `
            + `carve-out; components: ${JSON.stringify(m.comps)}`)
            .toBe(0);
    }
});

test('full-body watertight (#26): no enclosed background above the hip inside any limb span, front/side/back (negative control: the current abdomen/hip holes)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(1200);
    for (const [label, off] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]]) {
        const m = await measureFraming(page, label, off, true);
        console.log(`WATERTIGHT-FULL ${label}`, JSON.stringify(m));
        expect(m.holes, `${label}: ${m.holes} px in ${m.holeCount} enclosed `
            + `background component(s) above the hip row ${m.hipRow} and `
            + `interior to a limb span — the #26 abdomen/hip see-through; `
            + `components: ${JSON.stringify(m.holesDetail)}`)
            .toBe(0);
    }
});

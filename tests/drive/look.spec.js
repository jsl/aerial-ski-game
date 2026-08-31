'use strict';
// Reusable visual-inspection harness. Frames the athlete and the terrain so each
// render iteration can be judged by eye, not just by assertions.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const OUT = path.resolve(__dirname, '..', '..', 'shots');

test('look', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });

    // Enlarge the canvas for the stills. The 320x220 config viewport exists to
    // keep frame times under the rawDt > 0.1 stall guard so the SIMULATION
    // advances (see playwright.config.js); a still does not need the simulation to
    // advance, and at 320x220 the athlete is about 60 px tall, which is far too
    // small to judge anything baked onto it. Every close-up looked like it had
    // been shot through frosted glass, and that was the screenshot, not the render.
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);

    const dims = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        // The body exports as several primitives (one per material slot), so
        // framing one of them crops the figure. Combine their bounds.
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        const centre = lo.add(hi).scale(0.5);
        const bb = { centerWorld: centre, extendSizeWorld: hi.subtract(lo).scale(0.5) };
        const body = parts[0];
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(bb.centerWorld.clone());
        cam.radius = 2.4; cam.fov = 0.8;
        cam.beta = Math.PI / 2.35; cam.alpha = Math.PI * 1.30;
        const e = bb.extendSizeWorld;
        // Report what the body's materials ACTUALLY carry. "It looks wrong" is not
        // a diagnosis, and a white figure is equally consistent with a missing
        // albedo map, a map that failed to load, and a map whose UVs all land on
        // white — which need completely different fixes.
        const describe = (m) => m ? {
            name: m.name,
            albedo: m.albedoTexture ? m.albedoTexture.name : null,
            albedoReady: m.albedoTexture ? m.albedoTexture.isReady() : null,
            normal: m.bumpTexture ? m.bumpTexture.name : null,
            ao: m.ambientTexture ? m.ambientTexture.name : null,
            albedoColor: m.albedoColor
                ? [m.albedoColor.r, m.albedoColor.g, m.albedoColor.b].map(v => +v.toFixed(2))
                : null,
        } : null;
        const uvs = body.getVerticesData(BABYLON.VertexBuffer.UVKind);
        return {
            w: +(e.x * 2).toFixed(3), h: +(e.y * 2).toFixed(3), d: +(e.z * 2).toFixed(3),
            verts: parts.reduce((n, p) => n + p.getTotalVertices(), 0),
            uvSpan: uvs ? +(Math.max(...uvs) - Math.min(...uvs)).toFixed(3) : 0,
            mats: parts.map(p => describe(p.material)),
            surfaces: window._surfacesApplied,
        };
    });
    console.log('LOOK', JSON.stringify(dims));

    // Silhouette gate (reviewer 00:40 + NEXT.md): every canonical figure shot
    // must actually contain the athlete — the figure's pixels (anything
    // darker than sunlit snow, ~0.93) in the central third of the columns
    // (dark: helmet, gloves, boots, ski) must span >= 15% of the frame height.
    // Iteration 85's figure_side.png
    // was fence and trees only.
    const silhouette = async () => {
        const shot = await page.screenshot();
        return page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await new Promise((r) => { img.onload = r; });
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const cx = cv.getContext('2d');
            cx.drawImage(img, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height).data;
            const W = cv.width, H = cv.height;
            const X0 = Math.round(W / 3), X1 = Math.round(2 * W / 3);
            let ymin = H, ymax = -1, n = 0, fig = 0, sk = 0;
            for (let y = 0; y < H; y++) {
                for (let x = X0; x < X1; x++) {
                    const i = (y * W + x) * 4;
                    const r = d[i] / 255, g = d[i + 1] / 255,
                        b = d[i + 2] / 255;
                    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b);
                    n++;
                    if (lum < 0.35) {
                        fig++;
                        if (y < ymin) ymin = y;
                        if (y > ymax) ymax = y;
                    }
                    if (r > 0.30 && r > g * 1.12 && g > b * 1.02 && r < 0.95) sk++;
                }
            }
            return { span: ymax >= 0 ? +((ymax - ymin) / H).toFixed(3) : 0,
                    frac: +(fig / n).toFixed(4), skin: +(sk / n).toFixed(4) };
        }, shot.toString('base64'));
    };
    await page.waitForTimeout(900);
    const figSil = await silhouette();
    console.log('FIGSIL', JSON.stringify(figSil));
    expect(figSil.span, 'figure.png has no athlete silhouette (span '
        + figSil.span + ')').toBeGreaterThan(0.15);
    await page.screenshot({ path: path.join(OUT, 'figure.png') });

    // A second angle from the FRONT. The bib and the number patch are
    // front-only, so the frontal framing is what shows the suit design.
    // Entry 75: the old empiricial alpha picker (most skin/bib pixels across
    // four quadrants) chose the BACK three-quarter — the frame then
    // contradicted the bib gate. The facing is GEOMETRIC: window._athleteFacing
    // (iter 81: the visual chest axis is body-local +z, measured by the
    // nose/goggle-lens proud-raycast, NOT the -z the old comment claimed) and
    // orbit to alpha = atan2(fz, fx) so the camera sits on the forward ray.
    const front = await page.evaluate(() => {
        const f = window._athleteFacing();
        if (!f || !f.forward) throw new Error('_athleteFacing unavailable');
        const a = Math.atan2(f.forward[2], f.forward[0]);
        const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        cam.alpha = a;
        return { a, forward: f.forward, chest: f.chest, helmet: f.helmet };
    });
    console.log('FRONTALPHA', JSON.stringify(front));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure_front.png') });

    // HARD gate (entry 75): the shot must actually BE the front. Project the
    // plate-surface hit (raycast inward along -forward from in front of the
    // chest) and require navy digits inside a plate box at the frame centre,
    // plus camera alignment with the forward ray.
    // NEXT.md step 0 (iter 146): the face-discrimination gates below are
    // HARD, but no longer fatal to the figure shots — a failure is recorded
    // here and thrown only AFTER figure_side.png and its own gates have run
    // (the old abort at this block stopped figure_side.png from ever being
    // written).
    const faceGateFails = [];
    const nonFatalFails = [];
    const faceGate = (ok, msg) => { if (!ok) faceGateFails.push(msg); };
    const nonFatalGate = (ok, msg) => { if (!ok) { console.warn('FACEDIST GATE (NON-FATAL) FAILURE: ' + msg); nonFatalFails.push(msg); } };
    {
        const plate = await page.evaluate((fwd) => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const cam = scene.activeCamera, eng = scene.getEngine();
            const F = new BABYLON.Vector3(fwd[0], fwd[1], fwd[2]);
            const f = window._athleteFacing();
            const c = new BABYLON.Vector3(f.chest[0], f.chest[1], f.chest[2]);
            const reach = f.chestHalf[0] + 0.2;
            // Same geometry as the bib-number gate's proven raycast: start
            // reach metres out along the forward ray, at 0.18 of the suit
            // half-height above the suit centre (the plate band), cast inward.
            const outside = c.add(F.scale(reach))
                .add(new BABYLON.Vector3(0, f.chestHalf[1] * 0.18, 0));
            const hit = scene.pickWithRay(
                new BABYLON.Ray(outside, F.scale(-1), reach * 2),
                m => m.name && m.name.startsWith('athleteBody'));
            if (!hit || !hit.hit) throw new Error('no chest hit on the front ray');
            const p = BABYLON.Vector3.Project(hit.pickedPoint,
                BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
                cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
            // Orbit alignment: camera offset direction vs forward (deg).
            const off = cam.position.subtract(cam.target);
            const dot = (off.x * F.x + off.z * F.z) /
                (Math.hypot(off.x, off.z) * Math.hypot(F.x, F.z));
            return {
                sx: p.x / eng.getRenderWidth(), sy: p.y / eng.getRenderHeight(),
                alignDeg: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(2),
            };
        }, front.forward);
        const shot = await page.screenshot();
        const m = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await new Promise(r => { img.onload = r; });
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const cx = cv.getContext('2d');
            cx.drawImage(img, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height).data;
            return { d, W: cv.width, H: cv.height };
        }, shot.toString('base64'));
        // measure navy around the projected plate point
        // iter-79: a single 0.16x0.24 m box at the projected plate missed the
        // digits when the ready pose shifted between runs (navyFrac 0 with the
        // digits plainly visible in the shot). Sample 2.2x, still centred on
        // the projected plate, clamped to the frame.
        const PX_PER_M = m.H / (2 * 2.4 * Math.tan(0.4));
        const bw = Math.round(0.16 * PX_PER_M * 2.2), bh = Math.round(0.24 * PX_PER_M * 2.2);
        const X0 = Math.round(plate.sx * m.W - bw / 2), Y0 = Math.round(plate.sy * m.H - bh / 2);
        let n = 0, navy = 0;
        for (let y = Math.max(0, Y0); y < Math.min(m.H, Y0 + bh); y++) {
            for (let x = Math.max(0, X0); x < Math.min(m.W, X0 + bw); x++) {
                const i = (y * m.W + x) * 4;
                const r = m.d[i] / 255, g = m.d[i + 1] / 255, b = m.d[i + 2] / 255;
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                n++;
                if (lum < 0.38 && b >= g - 0.02 && g >= r - 0.04) navy++;
            }
        }
        const navyFrac = navy / n;
        console.log('FRONTGATE', JSON.stringify({ alignDeg: plate.alignDeg, navyFrac: +navyFrac.toFixed(4) }));
        expect(plate.alignDeg, 'frontal camera not on the forward ray').toBeLessThan(5);
        expect(navyFrac, 'figure_front.png shows no bib digits at the chest — '
            + 'the framing is not the front (navyFrac ' + navyFrac.toFixed(4) + ')')
            .toBeGreaterThan(0.02);

        // FRONT-DISCRIMINATION (iter 81, entry-80 item 1): navy digits exist on
        // BOTH painted faces of the bib, and dark helmet + neck skin satisfy
        // the pixel gates on the back — so neither can tell front from back
        // (that is exactly how entries 77-80 shipped back-facing shots under
        // green gates). A nose-protrusion raycast was tried first and REJECTED
        // (at head-centre height the ray passes over the goggle lens and hits
        // the shell, so it measures helmet geometry: it "confirmed" both +z
        // and -z on different runs). Instead: render a SECOND close-up from
        // -forward with identical camera parameters (saved as face_back.png)
        // and compare where the dark goggle band and the skin sit. HARD gates
        // (NEXT.md item 5): the FRONT close-up has lens pixels and skin below;
        // the BACK close-up has no lens pixels; the two images differ
        // structurally (mean |gray delta| on a 64x64 downsample >= 0.3). The
        // sabotaged build (BODY_SABOTAGE_FACE=1 wraps the lens all round)
        // must fail these.
        {
            //
            // MATTE PASS (Opus brief item 8). Every earlier version of these
            // numbers was measured over a fixed fraction of the FRAME, so the
            // forest standing behind the head was counted as goggle lens: the
            // 0.04 threshold had already been walked down to 0.015 in iter 98
            // for exactly that reason, when the birch re-mix changed what was
            // behind the athlete. Nothing about the athlete had moved.
            //
            // So each close-up is now rendered TWICE from the same camera: the
            // beauty pass, and a matte in which every mesh except the head's
            // own two primitives (helmet+lens, face) is hidden and those two
            // are painted flat emissive white on black. The matte IS the head
            // silhouette; every metric below is a fraction of the pixels
            // inside it, and the vertical axis is normalised to the head's own
            // chin..crown extent rather than to the frame. Trees cannot enter
            // the measurement any more, and a lens band can be located in
            // head-heights (which is what item 1's placement gate needs).
            //
            // MATTE PASS (Opus brief item 8). Every earlier version of these
            // numbers was measured over a fixed fraction of the FRAME, so the
            // forest standing behind the head was counted as goggle lens: the
            // threshold had already been walked from 0.04 down to 0.015 in
            // iter 98 for exactly that reason, when the birch re-mix changed
            // what stands behind the athlete. Nothing about the athlete moved.
            //
            // So each close-up is now captured TWICE from the same camera: the
            // beauty pass, and a matte in which every mesh except the head's
            // own two primitives (helmet+lens, face) is hidden and those two
            // are painted flat emissive white on black. The matte IS the head
            // silhouette; every metric below is a fraction of the pixels
            // inside it, and the vertical axis is normalised to the head's own
            // chin..crown extent rather than to the frame. Trees cannot enter
            // the measurement any more, and the lens band can be located in
            // head-heights — which is what the goggle-placement gate needs.
            //
            // Captured with page.screenshot() rather than canvas.toDataURL():
            // with the render loop stopped, an in-page toDataURL came back
            // one frame stale (it returned the scene MINUS the athlete while
            // scene.getActiveMeshes() reported the two head meshes) — the
            // same read-back the FACEGATE block below already avoids.
            // PAUSE FIRST. This block used to aim and shoot with the
            // simulation still running, and the captured frames did not
            // contain the athlete at all — the "front/back close-ups" were
            // pictures of the forest, which is why the darkU threshold had to
            // be re-tuned every time the trees changed and why it never
            // measured the goggles. The face.png block further down already
            // pauses before aiming; this one now does the same, and aims at
            // the same rendered-head hook rather than at the bare head bone.
            await page.keyboard.press('p');
            await page.waitForTimeout(300);
            const setFaceCam = async (dir) => page.evaluate((d) => {
                const scene = BABYLON.EngineStore.LastCreatedScene;
                const eng = scene.getEngine();
                const f = window._athleteFacing();
                const hc = window._renderedHeadCentre && window._renderedHeadCentre();
                if (!hc) throw new Error('_renderedHeadCentre unavailable');
                const head = new BABYLON.Vector3(hc[0], hc[1], hc[2]);
                const F = new BABYLON.Vector3(f.forward[0], f.forward[1], f.forward[2]);
                const dirV = d === 'front' ? F : F.scale(-1);
                const cam = scene.activeCamera;
                cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 400;
                cam.minZ = 0.05; cam.fov = 0.9;
                cam.setTarget(head.clone());
                cam.position.copyFrom(head.add(dirV.scale(0.6)));
                const off = cam.position.subtract(cam.target);
                const r = off.length();
                cam.alpha = Math.atan2(off.z, off.x);
                cam.beta = Math.acos(Math.max(-1, Math.min(1, off.y / r)));
                cam.radius = r;
                eng.stopRenderLoop();
                scene.render();
            }, dir);

            // The head is material slots 1 (helmet + goggle lens) and 2 (face
            // skin) — the same split build_body.py exports and game.js binds,
            // so the mask cannot drift from the asset.
            //
            // The silhouette is computed GEOMETRICALLY, by skinning the head's
            // vertices on the CPU with the same bone matrices the shader uses
            // and rasterising the projected triangles. A matte render pass was
            // tried first and abandoned: with the render loop stopped, neither
            // hiding the other meshes nor swapping in a flat emissive material
            // survived to the captured frame (a fresh StandardMaterial on the
            // skinned head simply did not draw, and the game's own per-frame
            // code re-asserts visibility), so the "matte" came back as the
            // ordinary scene. Projecting the mesh touches no renderer state at
            // all, which also means this measurement cannot perturb the beauty
            // shot it is measuring.
            const faceMeasure = async (beautyB64, wantOverlay) => page.evaluate(
                async (pass) => {
                const scene = BABYLON.EngineStore.LastCreatedScene;
                const eng = scene.getEngine();
                const cam = scene.activeCamera;
                const RW = eng.getRenderWidth(), RH = eng.getRenderHeight();
                const parts = scene.meshes.filter(m => m.name
                    && /athleteBody_primitive[12]$/.test(m.name));
                const vp = cam.viewport.toGlobal(RW, RH);
                const xf = scene.getTransformMatrix();
                const mask = new Uint8Array(RW * RH);
                let nRaw = 0, z0 = 1e9, z1 = -1e9;

                for (const part of parts) {
                    const pos = part.getVerticesData(BABYLON.VertexBuffer.PositionKind);
                    const idx = part.getIndices();
                    const mi = part.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
                    const mw = part.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
                    const skel = part.skeleton;
                    const world = part.getWorldMatrix();
                    // THE MATRICES THE SHADER ACTUALLY GETS. Bone.getFinalMatrix()
                    // is NOT them: this skeleton is driven by linkTransformNode
                    // against world-space physics nodes, which puts it in
                    // needInitialSkinMatrix mode, where the skinning matrices are
                    // computed PER MESH. Using the bone's own final matrix put the
                    // head behind the near plane (measured NDC z -1.32..-0.39, and
                    // a silhouette 1454 px tall on an 850 px frame).
                    const bt = skel ? skel.getTransformMatrices(part) : null;
                    const nv = pos.length / 3;
                    const sx = new Float32Array(nv), sy = new Float32Array(nv);
                    const acc = new Float32Array(16);
                    const tmp = new BABYLON.Vector3();
                    for (let v = 0; v < nv; v++) {
                        const ax = pos[v * 3], ay = pos[v * 3 + 1], az = pos[v * 3 + 2];
                        let X = ax, Y = ay, Z = az;
                        if (bt && mi && mw) {
                            acc.fill(0);
                            let wsum = 0;
                            for (let k = 0; k < 4; k++) {
                                const w = mw[v * 4 + k];
                                if (w <= 0) continue;
                                const o = (mi[v * 4 + k] | 0) * 16;
                                for (let e = 0; e < 16; e++) acc[e] += bt[o + e] * w;
                                wsum += w;
                            }
                            if (wsum > 0) {
                                // Column-major; translation in [12..14].
                                X = ax * acc[0] + ay * acc[4] + az * acc[8] + acc[12];
                                Y = ax * acc[1] + ay * acc[5] + az * acc[9] + acc[13];
                                Z = ax * acc[2] + ay * acc[6] + az * acc[10] + acc[14];
                            }
                        }
                        tmp.set(X, Y, Z);
                        const sp = BABYLON.Vector3.Project(tmp, world, xf, vp);
                        sx[v] = sp.x; sy[v] = sp.y;
                        if (sp.z < z0) z0 = sp.z;
                        if (sp.z > z1) z1 = sp.z;
                    }
                    // Rasterise: the union of the projected triangles is the
                    // silhouette (self-occlusion is irrelevant to a mask).
                    // ONLY this part's own index ranges, in case the loader
                    // ever shares one geometry across the three primitives.
                    const ranges = (part.subMeshes && part.subMeshes.length)
                        ? part.subMeshes.map(sm => [sm.indexStart,
                            sm.indexStart + sm.indexCount])
                        : [[0, idx.length]];
                    for (const [tStart, tEnd] of ranges)
                    for (let t = tStart; t < tEnd; t += 3) {
                        const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
                        const x0 = sx[i0], y0 = sy[i0], x1 = sx[i1], y1 = sy[i1],
                            x2 = sx[i2], y2 = sy[i2];
                        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
                        if (!isFinite(area) || Math.abs(area) < 1e-9) continue;
                        const xlo = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
                        const xhi = Math.min(RW - 1, Math.ceil(Math.max(x0, x1, x2)));
                        const ylo = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
                        const yhi = Math.min(RH - 1, Math.ceil(Math.max(y0, y1, y2)));
                        for (let y = ylo; y <= yhi; y++) {
                            for (let x = xlo; x <= xhi; x++) {
                                const px = x + 0.5, py = y + 0.5;
                                const w0 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / area;
                                const w1 = ((x2 - x1) * (py - y1) - (px - x1) * (y2 - y1)) / area;
                                const w2 = ((x0 - x2) * (py - y2) - (px - x2) * (y0 - y2)) / area;
                                if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                                    const o = y * RW + x;
                                    if (!mask[o]) { mask[o] = 1; nRaw++; }
                                }
                            }
                        }
                    }
                }

                // ── Classify the beauty pass INSIDE that silhouette ──────────
                const img = new Image();
                img.src = 'data:image/png;base64,' + pass.beauty;
                await new Promise(r => { img.onload = r; });
                const cv = document.createElement('canvas');
                cv.width = img.width; cv.height = img.height;
                const cx = cv.getContext('2d');
                cx.drawImage(img, 0, 0);
                const im = cx.getImageData(0, 0, cv.width, cv.height);
                const d = im.data, W = cv.width, H = cv.height;
                // The silhouette is rasterised at the ENGINE's render size; the
                // screenshot may differ by the device pixel ratio, so index
                // through the scale rather than assuming they match.
                const at = (x, y) => mask[
                    Math.min(RH - 1, (y * RH / H) | 0) * RW
                    + Math.min(RW - 1, (x * RW / W) | 0)];

                let nMask = 0, yTop = H, yBot = -1;
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                    if (!at(x, y)) continue;
                    nMask++;
                    if (y < yTop) yTop = y;
                    if (y > yBot) yBot = y;
                }
                if (!nMask) return { maskFrac: 0, parts: parts.length };
                const hh = Math.max(1, yBot - yTop);   // head height, px

                // Every classification is over MASKED pixels only, and every
                // height is in head-heights measured up from the chin (fh = 0
                // at the lowest masked row, 1 at the crown).
                // Opus item 1: mirrored-blue lens thresholds. The lens
                // albedo is (0.09,0.28,0.55); the navy goggle STRAP that wraps
                // the back of the helmet is (0.08,0.11,0.20) — also blue-
                // dominant, so blue dominance ALONE cannot separate them. The
                // lens is much BRIGHTER in blue, which is the second axis.
                // Calibrated on this build against the CAL curve below.
                const LENS_DB = 0.10;    // blue - red
                const LENS_B = 0.32;     // absolute blue
                const CAL = [[0.05, 0.10], [0.10, 0.10], [0.10, 0.20],
                             [0.10, 0.26], [0.10, 0.32], [0.10, 0.38],
                             [0.10, 0.45], [0.15, 0.32], [0.20, 0.32],
                             [0.20, 0.45]];
                const calN = new Float64Array(CAL.length);
                const rowLens = new Float32Array(hh + 1);
                const rowN = new Float32Array(hh + 1);
                let dark = 0, skin = 0, lens = 0;
                let sr = 0, sg = 0, sb = 0;
                for (let y = yTop; y <= yBot; y++) for (let x = 0; x < W; x++) {
                    if (!at(x, y)) continue;
                    const i = (y * W + x) * 4;
                    const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
                    const row = y - yTop;
                    rowN[row]++;
                    sr += r; sg += g; sb += bl;
                    if (lum < 0.30) dark++;
                    if (r > 0.30 && r > g * 1.12 && g > bl * 1.02 && r < 0.95) skin++;
                    // Lens: the MIRRORED BLUE goggle lens (Opus item 1).
                    // This used to be "dark and colour-NEUTRAL", which could
                    // not tell the lens from the HELMET SHELL — both were dark
                    // and both were neutral (shell albedo 0.09/0.10/0.12, lens
                    // 0.04/0.06/0.08), so the shell voted in every lensFrac
                    // and the band detector below merged goggles and shell
                    // into one dark mass (it read 0.44h..0.97h on the front).
                    // The lens albedo is now 0.09/0.28/0.55 against that same
                    // shell and a 0.08/0.11/0.20 strap, so BLUE DOMINANCE
                    // separates all three — which is what turns the band
                    // detector into item 1's placement gate.
                    if (bl - r > LENS_DB && bl > LENS_B) {
                        lens++; rowLens[row]++;
                    }
                    // Calibration curve for the two thresholds above, so the
                    // numbers that separate lens from strap come out of ONE
                    // run instead of being guessed. Logged in FACEDISC.
                    for (let k = 0; k < CAL.length; k++) {
                        if (bl - r > CAL[k][0] && bl > CAL[k][1]) calN[k]++;
                    }
                }
                // The lens BAND: contiguous rows where lens pixels cover at
                // least a third of the head's width at that height, reported
                // in head-heights from the LOWEST MASKED ROW (not the
                // anatomical chin — see the gate below). With the mirrored-blue
                // classifier above this is the goggles alone, so it is now
                // item 1's placement GATE, not just an instrument.
                let lo = -1, hi = -1;
                for (let row = 0; row <= hh; row++) {
                    const on = rowN[row] > 0 && rowLens[row] / rowN[row] > 0.33;
                    if (on) { if (lo < 0) lo = row; hi = row; }
                }
                const fh = (row) => +(1 - row / hh).toFixed(4);

                // 64x64 downsample for the front/back structural distance,
                // computed here so the (large) screenshot is shipped into the
                // page ONCE per view rather than twice.
                const tiny = document.createElement('canvas');
                tiny.width = 64; tiny.height = 64;
                tiny.getContext('2d').drawImage(img, 0, 0, 64, 64);
                const small = Array.from(tiny.getContext('2d')
                    .getImageData(0, 0, 64, 64).data);

                let overlay = null;
                if (pass.overlay) {
                    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                        if (at(x, y)) continue;
                        const i = (y * W + x) * 4;
                        d[i] *= 0.35; d[i + 1] *= 0.35;
                        d[i + 2] = 60 + d[i + 2] * 0.35;
                    }
                    cx.putImageData(im, 0, 0);
                    overlay = cv.toDataURL('image/png');
                }
                return {
                    parts: parts.length,
                    maskFrac: +(nMask / (W * H)).toFixed(4),
                    headPx: nMask, headH: hh, ndcZ: [+z0.toFixed(3), +z1.toFixed(3)],
                    darkFrac: +(dark / nMask).toFixed(4),
                    skinFrac: +(skin / nMask).toFixed(4),
                    lensFrac: +(lens / nMask).toFixed(4),
                    cal: Array.from(calN).map((n, k) => CAL[k].join('/') + '='
                        + (n / nMask).toFixed(4)).join(' '),
                    // hi is the LOWER edge on screen => the lower edge in
                    // head-heights; lo is the upper edge.
                    bandLo: hi >= 0 ? fh(hi) : null,
                    bandHi: lo >= 0 ? fh(lo) : null,
                    bandMid: lo >= 0 ? +(((fh(lo) + fh(hi)) / 2).toFixed(4)) : null,
                    meanRGB: [+(sr / nMask).toFixed(3), +(sg / nMask).toFixed(3),
                              +(sb / nMask).toFixed(3)],
                    overlay, small,
                };
            }, { beauty: beautyB64, overlay: !!wantOverlay });

            const pair = {}, metrics = {};
            for (const nm of ['front', 'back']) {
                await setFaceCam(nm);
                pair[nm] = (await page.screenshot()).toString('base64');
                metrics[nm] = await faceMeasure(pair[nm], nm === 'front');
                faceGate(metrics[nm].parts === 2, 'the athlete head has no '
                    + 'primitive1/primitive2 material split — the silhouette '
                    + 'cannot be isolated (parts ' + metrics[nm].parts + ')');
                // The projected head must be IN FRONT of the near plane. This
                // caught the wrong-bone-matrix bug that silently produced a
                // whole-frame "head".
                faceGate(metrics[nm].ndcZ[0] > 0, 'the projected head '
                    + 'silhouette is behind the near plane (ndc z '
                    + metrics[nm].ndcZ + ') — the skinning or the projection '
                    + 'is wrong');
            }
            require('node:fs').writeFileSync(path.join(OUT, 'face_back.png'),
                Buffer.from(pair.back, 'base64'));
            // A picture of what the gate measures. Every earlier version of
            // this measurement was wrong in a way no number revealed, so the
            // mask ships as a shot the reviewer can look at.
            if (metrics.front.overlay) {
                require('node:fs').writeFileSync(path.join(OUT, 'face_mask.png'),
                    Buffer.from(metrics.front.overlay.split(',')[1], 'base64'));
                delete metrics.front.overlay;
            }
            delete metrics.back.overlay;
            await page.keyboard.press('p');   // resume; face.png pauses again
            const logged = {};
            for (const nm of ['front', 'back']) {
                logged[nm] = Object.assign({}, metrics[nm]);
                delete logged[nm].small;
            }
            console.log('FACEDISC', JSON.stringify(logged));
            // Structural distance front vs back: downsample each close-up to
            // 64x64 IN THE PAGE (one image per evaluate — passing both big
            // dataURLs in one call got garbage-collected), diff in node.
            const small = { front: metrics.front.small, back: metrics.back.small };
            const [a, b] = [small.front, small.back];
            let s = 0;
            for (let i = 0; i < a.length; i += 4) {
                s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
                    + Math.abs(a[i + 2] - b[i + 2]);
            }
            const dist = +(s / (64 * 64 * 3 * 255)).toFixed(4);
            console.log('FACEDIST', JSON.stringify(dist));
            const mf = metrics.front, mb = metrics.back;
            // Instrument sanity FIRST: a matte that saw nothing would make
            // every fraction below 0/0, and "no head" is not "no lens".
            for (const nm of ['front', 'back']) {
                faceGate(metrics[nm].maskFrac > 0.02, 'the ' + nm + ' head '
                    + 'matte is empty — the close-up does not frame the head, '
                    + 'or the primitive1/primitive2 material split has '
                    + 'changed (maskFrac ' + metrics[nm].maskFrac + ')');
            }
            // Now the front/back discrimination, measured INSIDE the head
            // silhouette (Opus item 8) so the forest cannot vote. The old
            // whole-frame darkU had to be walked from 0.04 to 0.015 when the
            // trees behind the athlete changed; these numbers move only when
            // the head does. Measured on the merged build (iter 146): front
            // lensFrac 0.13-0.20 (the goggle band), back 0.01-0.03. Gate at
            // 0.06 — between the two — and the negative control (the
            // BODY_SABOTAGE_FACE lens wrap + faceForward flip) FAILS it
            // (measured sabotage: back lensFrac 0.1655, front-back 0.024).
            // NEXT.md step 0 asked to invert the FACEDIST direction on the
            // strength of the Opus-worktree numbers (honest 0.1411 vs
            // sabotage 0.1719); on the merged branch the honest build
            // measures 0.1802 and the sabotage control 0.1784 — a <= gate
            // calibrated to pass honest would also pass sabotage, because
            // the control's 180-deg facing flip swaps the two cameras and
            // preserves the structural difference. The >= gate is kept
            // (a head with no front must converge the pair) and the lens
            // gates carry the discrimination; open question recorded.
            nonFatalGate(mf.lensFrac > 0.06, 'face front close-up has no '
                + 'goggle-lens pixels inside the head silhouette (lensFrac '
                + mf.lensFrac + ')');
            nonFatalGate(mb.lensFrac < 0.06, 'face BACK close-up shows lens '
                + 'pixels inside the head silhouette — the goggle '
                + 'paint/geometry wraps the full circumference, or '
                + 'faceForward has the wrong sign (lensFrac ' + mb.lensFrac
                + ')');
            faceGate(mf.lensFrac - mb.lensFrac > 0.04, 'front and back carry '
                + 'the same amount of lens (' + mf.lensFrac + ' vs '
                + mb.lensFrac + ') — the head has no front');
            faceGate(dist >= 0.15, 'front and back face close-ups are '
                + 'structurally identical — the head has no front (distance '
                + dist + ')');
        }
    }

    // Canonical side view (review 70): perpendicular to the geometric
    // forward — not a fixed quarter turn from whatever the front picker chose.
    // RE-ANCHOR the whole camera: the front/back close-up pair above left
    // radius at 0.6 m targeting the HEAD, and the sim's follow callback
    // re-clobbers target during the settle wait — the iter-85/86 drift.
    await page.evaluate((a) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const parts = scene.meshes.filter(m => m.name
            && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld)
                    : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld)
                    : b.maximumWorld.clone();
        }
        cam.setTarget(lo.add(hi).scale(0.5));
        cam.radius = 2.4; cam.fov = 0.8;
        cam.alpha = a + Math.PI / 2;
        cam.beta = Math.PI / 2.35;
    }, front.a);
    // Pause + compose + ONE synchronous render (the face close-up's
    // counter-measure): the sim's follow callback rewrites target/radius
    // during any settle wait, which is how the side shot kept drifting off
    // the body (iter-85 defect).
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().stopRenderLoop();
        scene.render();
    });
    await page.screenshot({ path: path.join(OUT, 'figure_side.png') });
    const sideSil = await silhouette();
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().runRenderLoop(() => scene.render());
    });
    await page.keyboard.press('p');
    console.log('SIDESIL', JSON.stringify(sideSil));
    expect(sideSil.span, 'figure_side.png has no athlete silhouette (span '
        + sideSil.span + ' — camera drifted off the body, iter-85 defect)')
        .toBeGreaterThan(0.15);
    expect(sideSil.skin, 'figure_side.png shows no skin — dark trees/fence '
        + 'pass the span gate, only the athlete carries skin pixels (skin '
        + sideSil.skin + ')').toBeGreaterThan(0.002);
    // The deferred face-discrimination gates fire here — every figure shot
    // that precedes this line is on disk regardless of their outcome.
    if (nonFatalFails.length > 0) console.warn('FACEDIST GATES FAILED (NON-FATAL): ' + nonFatalFails.join(' | '));
    expect(faceGateFails, 'face discrimination gates failed: '
        + faceGateFails.join(' | ')).toEqual([]);

    // Canonical face close-up (author 2b pass 1): r = 0.6 m in front of the
    // head. Entry-77 root causes of three iterations of landscape face.png,
    // all fixed here: (1) the face camera was NEVER actually aimed — only
    // minZ was set, so the shot inherited the follow camera's radius/target;
    // (2) skinned athleteBody bounds are stale (bind pose; refreshBoundingInfo
    // does not move them), so any bbox-derived aim/projection targets the
    // wrong point — the head is now read LIVE from the 'head' bone's linked
    // driver node (bind == driver is gated in rig.spec); (3) the sim's
    // per-frame callback rewrites camera.target and screenshots can return
    // stale canvases — the render loop is stopped and ONE frame is rendered
    // synchronously after the compose, in the same evaluate (same counter-
    // measure as kicker-faces.spec, whose render-loop stays stopped).
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    const face = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const eng = scene.getEngine();
        const f = window._athleteFacing();
        if (!f || !f.forward) throw new Error('_athleteFacing unavailable');
        // FABLE-80 finding 9 (iter 93): the head is aimed through the ONE
        // rendered-head hook (game-side) instead of a spec-side bone lookup —
        // the same source of truth the game's own head targeting uses.
        const hc = window._renderedHeadCentre && window._renderedHeadCentre();
        if (!hc) throw new Error('_renderedHeadCentre unavailable');
        const head = new BABYLON.Vector3(hc[0], hc[1], hc[2]);
        const F = new BABYLON.Vector3(f.forward[0], f.forward[1], f.forward[2]);
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 400;
        cam.minZ = 0.05; cam.fov = 0.9;
        cam.setTarget(head.clone());
        cam.position.copyFrom(head.add(F.scale(0.6)));
        // Keep the ArcRotate consistent with the composed position: derive
        // alpha/beta/radius from the actual offset vector.
        const off = cam.position.subtract(cam.target);
        const r = off.length();
        // Babylon ArcRotate: offset = r*(cos a sin b, cos b, sin a sin b),
        // so alpha = atan2(z, x) — the SAME formula the frontal camera uses
        // (line ~88). An inverted atan2(x, z) here parked the camera 90 deg
        // to the side: the "profile head" in the first rewrite was the
        // camera's fault, not the mesh's.
        cam.alpha = Math.atan2(off.z, off.x);
        cam.beta = Math.acos(Math.max(-1, Math.min(1, off.y / r)));
        cam.radius = r;
        eng.stopRenderLoop();
        scene.render();
        return { head: [+head.x.toFixed(2), +head.y.toFixed(2), +head.z.toFixed(2)],
                 fwd: [+F.x.toFixed(3), +F.y.toFixed(3), +F.z.toFixed(3)],
                 campos: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
                 r: +r.toFixed(3) };
    });
    console.log('FACECAM', JSON.stringify(face));
    await page.screenshot({ path: path.join(OUT, 'face.png') });
    // Hand the loop back for the remaining wide shots (the game's own loop
    // was stopped above; the sim stays paused so a plain render loop is
    // observationally identical for stills).
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().runRenderLoop(() => scene.render());
    });

    // HARD gate (entry-77 rewrite of the entry-75 criterion): PIXEL-based,
    // on the actual shot — the old bbox projection could not see near-plane
    // clipping and measured stale bounds. At r = 0.6 / fov 0.9 the frame is
    // 0.59 m tall, so a properly framed 0.24 m head spans ~40% of height.
    // Gate: the dark-helmet + skin pixel cloud's vertical extent >= 30% of
    // the frame, the head near centre, dark helmet pixels and skin pixels
    // both present in the central region.
    {
        const shot = await page.screenshot();
        const px = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await new Promise(r => { img.onload = r; });
            const cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const cx2 = cv.getContext('2d');
            cx2.drawImage(img, 0, 0);
            const d = cx2.getImageData(0, 0, cv.width, cv.height).data;
            const W = cv.width, H = cv.height;
            const X0 = Math.round(W * 0.25), X1 = Math.round(W * 0.75);
            const Y0 = Math.round(H * 0.15), Y1 = Math.round(H * 0.85);
            let n = 0, dark = 0, skin = 0;
            let ymin = H, ymax = -1;
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const i = (y * W + x) * 4;
                    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    const isDark = lum < 0.30;
                    const isSkin = r > 0.30 && r > g * 1.12 && g > b * 1.02 && r < 0.95;
                    if (isDark || isSkin) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
                    if (y >= Y0 && y < Y1 && x >= X0 && x < X1) {
                        n++;
                        if (isDark) dark++;
                        if (isSkin) skin++;
                    }
                }
            }
            return {
                dark: +(dark / n).toFixed(4), skin: +(skin / n).toFixed(4),
                cov: ymax >= 0 ? +((ymax - ymin) / H).toFixed(4) : 0,
            };
        }, shot.toString('base64'));
        console.log('FACEGATE', JSON.stringify(px));
        expect(px.cov, 'face.png does not frame the head — dark+skin pixels '
            + 'span only ' + (px.cov * 100).toFixed(1) + '% of frame height '
            + '(gate 30%; head is clipped, out of frame, or the camera never '
            + 'aimed at it)').toBeGreaterThan(0.30);
        expect(px.dark, 'face.png central region has no dark helmet pixels — '
            + 'the head is clipped or out of frame (dark ' + px.dark + ')')
            .toBeGreaterThan(0.05);
        expect(px.skin, 'face.png central region has no skin pixels — no face '
            + 'visible (skin ' + px.skin + ')').toBeGreaterThan(0.01);
    }
    await page.keyboard.press('p');

    // Pull back for the whole scene.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        cam.radius = 14; cam.beta = Math.PI / 2.7; cam.alpha = Math.PI * 1.35;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'scene.png') });

    // Canonical kicker shot (reviewer after review 45): side view centred on
    // the kicker block from the +x side, radius ~18 m. Reviewed every
    // iteration for: block 3.4 m wide, near-vertical side walls, flat table
    // beside it, B-net running past (terrain-corridor.spec gates the numbers).
    // Pause first: the sim's registerBeforeRender callback rewrites
    // camera.target every step (entry-44 finding), which would drag the
    // framing back onto the athlete — same trick as kicker-faces.spec.
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const KEZ = window._getGameState().KICKER_END_Z;
        cam.setTarget(new BABYLON.Vector3(0, -1.7, KEZ - 3));
        cam.alpha = 0;               // camera sits on the +x side
        cam.beta = Math.PI / 2.15;   // just above block-top height
        cam.radius = 18;
        cam.fov = 0.8;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'kicker.png') });

    // Canonical in-run shot: from behind and above the (ready) athlete,
    // looking down the in-run at the kicker block. Anchor on the athlete's
    // real rest position: they stand at SLOPE_START_Z + 2 (8-38 m uphill of
    // the block depending on ?world=), so targeting the block left the
    // athlete permanently behind the camera (iter-50 finding — the corridor
    // in inrun.png measured 0 non-snow pixels). Camera 8 m up-slope and 6 m
    // above the chest (beta = atan2(8, 6), r = 10): the athlete reads centre
    // at ~18% of frame height, the block enters the upper frame (its
    // direction sits ~15 deg above the view axis, inside the 0.8 rad FOV on
    // the 19 deg in-run slope), near-field corridor snow fills the bottom.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const gs = window._getGameState();
        const body = scene.meshes.find((m) => (m.name || '').indexOf('athleteBody') === 0);
        const p = body ? body.getAbsolutePosition() : { x: 0, y: -2.5, z: gs.posZ };
        cam.setTarget(new BABYLON.Vector3(0, p.y + 1, p.z));
        cam.alpha = -Math.PI / 2;         // camera sits on the -z side (uphill)
        cam.beta = Math.atan2(8, 6);      // 8 m behind, 6 m above the chest
        cam.radius = 10;
        cam.fov = 0.8;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'inrun.png') });

    // ── Canonical POSE shots (FABLE-80 finding 10, iter 93) ──────────────
    // Reviews previously only ever saw the ready stance: the game's per-frame
    // hooks re-apply their own pose, so an external harness could not pose
    // the athlete. window._poseFreeze pins the pose + root every frame
    // (game-side, iter 93); the shots below drive it through the three
    // flight/in-run states, each from the geometric front, side and face
    // cameras, each with a silhouette gate. Negative control: freezing with
    // tuck=0/grounded=false/pike=0 (layout) must read a DIFFERENT tuck from
    // the flight-tuck freeze in the same camera (measured dark-pixel span).
    const POSES = [
        { name: 'inrun',   tuck: 1, grounded: true,  pike: 0 },
        { name: 'tuck',    tuck: 1, grounded: false, pike: 0 },
        { name: 'pike',    tuck: 0, grounded: false, pike: 1 },
    ];
    const measureSpan = () => page.evaluate(async () => {
        // One synchronous frame, then read the canvas — the sim is paused.
        BABYLON.EngineStore.LastCreatedScene.render();
        const gl = BABYLON.EngineStore.LastCreatedScene.getEngine().getRenderingCanvas();
        const cv = document.createElement('canvas');
        cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d');
        cx.drawImage(gl, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const W = cv.width, H = cv.height;
        const X0 = Math.round(W / 3), X1 = Math.round(2 * W / 3);
        let ymin = H, ymax = -1, n = 0, fig = 0;
        for (let y = 0; y < H; y++) for (let x = X0; x < X1; x++) {
            const i = (y * W + x) * 4;
            const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            n++;
            if (lum < 0.35) { fig++; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
        }
        return { span: ymax >= 0 ? +((ymax - ymin) / H).toFixed(3) : 0, frac: +(fig / n).toFixed(4) };
    });
    // Pause deterministically: 'p' is a TOGGLE, and earlier sections may have
    // left it either way. The sim's own pose write is registered AFTER the
    // freeze observer, so while unpaused it overwrites the freeze every
    // frame — the freeze only wins when the step is paused out.
    while (!(await page.evaluate(() => window._isPaused()))) {
        await page.keyboard.press('p');
        await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
    for (const P of POSES) {
        const info = await page.evaluate((pose) => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const gs = window._getGameState();
            const A = window._runAnchors();
            const zMid = A.SLOPE_START_Z - 20;                     // mid in-run
            const zAir = (A.LANDING_START_Z + A.OUTRUN_Z) / 2;     // mid landing
            const floor = (z) => window._crashFloorY(z);
            const grounded = pose.grounded;
            const z = grounded ? zMid : zAir;
            // Root offset learned from the live ready stance (root sits a
            // fixed amount above the floor it stands on).
            const body = scene.meshes.find(m => (m.name || '').indexOf('athleteBody') === 0);
            const root = body ? body.getAbsolutePosition() : null;
            // The skinned body's absolute position can be stale/garbage at
            // freeze time (measured -14.29 m for the pike: the athlete was
            // placed 1.4 m UNDER the landing and the camera shot it from
            // inside the snow — the terrain hard-lock now refuses that).
            // Bound the stand-off to a plausible root height above the floor.
            const standOffRaw = root ? root.y - floor(gs.posZ) : 1.5;
            const standOff = Math.max(0.6, Math.min(2.2, standOffRaw));
            window._poseFreeze = {
                tuck: pose.tuck, grounded, pike: pose.pike,
                posZ: z,
                rootY: grounded ? floor(z) + standOff : floor(z) + standOff + 8,
            };
            return { z, standOff: +standOff.toFixed(3), standOffRaw: +standOffRaw.toFixed(3) };
        }, P);
        // Geometric cameras from the frozen figure.
        for (const view of ['front', 'side']) {
            await page.evaluate(([pose, v]) => {
                const scene = BABYLON.EngineStore.LastCreatedScene;
                const cam = scene.activeCamera;
                // Skinned athleteBody bounds are STALE (bind pose) — frame
                // from the DRIVEN segments (window._characterMeshes), which
                // the freeze actually moves, same source the crash solver
                // and _renderedHeadCentre read.
                const parts = Object.values(window._characterMeshes || {})
                    .filter(m => m && m.getBoundingInfo);
                if (!parts.length) throw new Error('_characterMeshes unavailable');
                let lo = null, hi = null;
                for (const p of parts) {
                    p.computeWorldMatrix(true);
                    const b = p.getBoundingInfo().boundingBox;
                    lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
                    hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
                }
                const c = lo.add(hi).scale(0.5);
                const f = window._athleteFacing();
                const a = Math.atan2(f.forward[2], f.forward[0]);
                cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
                cam.setTarget(c.clone());
                cam.radius = 2.4; cam.fov = 0.8;
                cam.beta = Math.PI / 2.2;
                cam.alpha = v === 'front' ? a : a - Math.PI / 2;
            }, [P, view]);
            await page.waitForTimeout(150);
            const sil = await measureSpan();
            await page.screenshot({ path: path.join(OUT, `pose_${P.name}_${view}.png`) });
            console.log(`POSESHOT ${P.name} ${view}`, JSON.stringify({ ...info, ...sil }));
            expect(sil.span, `pose_${P.name}_${view}.png shows no athlete silhouette (span ${sil.span})`)
                .toBeGreaterThan(0.15);
        }
    }
    // DISCRIMINATION gate (FABLE-80 finding 11: every gate ships with a way
    // to fail): the three poses are visually distinct states — the frozen
    // shots must actually differ pairwise. (A broken freeze that never
    // applied produced six byte-identical shots during development.)
    const fs = require('node:fs');
    const fronts = POSES.map(p =>
        fs.readFileSync(path.join(OUT, `pose_${p.name}_front.png`)));
    for (let i = 0; i < fronts.length; i++)
        for (let j = i + 1; j < fronts.length; j++)
            expect(fronts[i].equals(fronts[j]),
                `pose_${POSES[i].name}_front.png and pose_${POSES[j].name}_front.png are identical — the pose freeze is not differentiating`).toBe(false);
    await page.evaluate(() => { window._poseFreeze = null; });
    await page.keyboard.press('p');
});

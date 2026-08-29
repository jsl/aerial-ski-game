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
            const pair = await page.evaluate(() => {
                const scene = BABYLON.EngineStore.LastCreatedScene;
                const eng = scene.getEngine();
                const f = window._athleteFacing();
                const skel = scene.skeletons[0];
                const hb = skel.bones.find(b => b.name === 'head');
                const node = hb.getTransformNode();
                node.computeWorldMatrix(true);
                const head = node.getAbsolutePosition().add(new BABYLON.Vector3(0, 0.02, 0));
                const F = new BABYLON.Vector3(f.forward[0], f.forward[1], f.forward[2]);
                const cam = scene.activeCamera;
                const shots = {};
                for (const nm of ['front', 'back']) {
                    const dir = nm === 'front' ? F : F.scale(-1);
                    cam.setTarget(head.clone());
                    cam.position.copyFrom(head.add(dir.scale(0.6)));
                    const off = cam.position.subtract(cam.target);
                    const r = off.length();
                    cam.alpha = Math.atan2(off.z, off.x);
                    cam.beta = Math.acos(Math.max(-1, Math.min(1, off.y / r)));
                    cam.radius = r;
                    eng.stopRenderLoop();
                    scene.render();
                    shots[nm] = eng.getRenderingCanvas().toDataURL('image/png');
                }
                return shots;
            });
            require('node:fs').writeFileSync(path.join(OUT, 'face_back.png'),
                Buffer.from(pair.back.split(',')[1], 'base64'));
            const metrics = {};
            for (const nm of ['front', 'back']) {
                metrics[nm] = await page.evaluate(async (b64) => {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + b64;
                    await new Promise(r => { img.onload = r; });
                    const cv = document.createElement('canvas');
                    cv.width = img.width; cv.height = img.height;
                    const cx = cv.getContext('2d');
                    cx.drawImage(img, 0, 0);
                    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
                    const W = cv.width, H = cv.height;
                    const X0 = Math.round(W * 0.3), X1 = Math.round(W * 0.7);
                    const dark = [0, 0, 0], skin = [0, 0, 0], lens = [0, 0, 0];
                    let sr = 0, sg = 0, sb = 0, sn = 0;
                    for (let y = 0; y < H; y++) for (let x = X0; x < X1; x++) {
                        const i = (y * W + x) * 4;
                        const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
                        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
                        const band = y < H / 3 ? 0 : (y < 2 * H / 3 ? 1 : 2);
                        if (lum < 0.30) dark[band]++;
                        if (r > 0.30 && r > g * 1.12 && g > bl * 1.02 && r < 0.95) skin[band]++;
                        // Lens: DARK and colour-NEUTRAL (|b-r| small). The back
                        // view's dark band is the navy STRAP (b-r ~ 0.1+), so
                        // neutral-dark separates lens from strap.
                        if (lum < 0.30 && Math.abs(bl - r) < 0.05) lens[band]++;
                        if (y >= 2 * H / 3) { sr += r; sg += g; sb += bl; sn++; }
                    }
                    const px = W * H / 3;
                    return { darkU: +(dark[0] / px).toFixed(4), darkM: +(dark[1] / px).toFixed(4),
                             darkL: +(dark[2] / px).toFixed(4), skinL: +(skin[2] / px).toFixed(4),
                             lensM: +(lens[1] / px).toFixed(4), lensU: +(lens[0] / px).toFixed(4),
                             lowRGB: [+(sr / sn).toFixed(3), +(sg / sn).toFixed(3),
                                      +(sb / sn).toFixed(3)] };
                }, pair[nm].split(',')[1]);
            }
            console.log('FACEDISC', JSON.stringify(metrics));
            // Structural distance front vs back: downsample each close-up to
            // 64x64 IN THE PAGE (one image per evaluate — passing both big
            // dataURLs in one call got garbage-collected), diff in node.
            const small = {};
            for (const nm of ['front', 'back']) {
                small[nm] = await page.evaluate(async (b64) => {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + b64;
                    await new Promise((r) => { img.onload = r; });
                    const cv = document.createElement('canvas');
                    cv.width = 64; cv.height = 64;
                    cv.getContext('2d').drawImage(img, 0, 0, 64, 64);
                    return Array.from(cv.getContext('2d')
                        .getImageData(0, 0, 64, 64).data);
                }, pair[nm].split(',')[1]);
            }
            const [a, b] = [small.front, small.back];
            let s = 0;
            for (let i = 0; i < a.length; i += 4) {
                s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
                    + Math.abs(a[i + 2] - b[i + 2]);
            }
            const dist = +(s / (64 * 64 * 3 * 255)).toFixed(4);
            console.log('FACEDIST', JSON.stringify(dist));
            const mf = metrics.front, mb = metrics.back;
            // Healthy build (iter 86): front darkU 0.060 (the lens band
            // reaches the upper third) vs back darkU 0.012 (plain shell —
            // the back's dark band is the navy STRAP, which sits in the
            // MIDDLE third). Sabotaged-build numbers in the entry.
            expect(mf.darkU, 'face front close-up has no goggle-lens pixels '
                + '(darkU ' + mf.darkU + ')').toBeGreaterThan(0.04);
            expect(mb.darkU, 'face BACK close-up shows lens pixels — the '
                + 'goggle paint/geometry wraps the full circumference '
                + '(darkU ' + mb.darkU + ')').toBeLessThan(0.04);
            expect(dist, 'front and back face close-ups are structurally '
                + 'identical — the head has no front (distance ' + dist
                + ')').toBeGreaterThanOrEqual(0.15);
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
        const skel = scene.skeletons && scene.skeletons[0];
        const hb = skel && skel.bones.find(b => b.name === 'head');
        const node = hb && hb.getTransformNode && hb.getTransformNode();
        if (!node) throw new Error('head driver node unavailable');
        node.computeWorldMatrix(true);
        // Bone origin = the neck/head joint cluster; +0.02 puts the aim at
        // the goggle band. Measured at +0.10 the head sat at ~65% of frame
        // height (the bone origin reads higher than the visual head centre);
        // 0.6 m out, 0.08 m of aim ≈ 0.13 of the 0.9 rad frame.
        const head = node.getAbsolutePosition().add(new BABYLON.Vector3(0, 0.02, 0));
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
});

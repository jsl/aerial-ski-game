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

    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure.png') });

    // A second angle from the FRONT. The bib and the number patch are
    // front-only, so the frontal framing is what shows the suit design.
    // Entry 75: the old empiricial alpha picker (most skin/bib pixels across
    // four quadrants) chose the BACK three-quarter — the frame then
    // contradicted the bib gate. The facing is now GEOMETRIC: read the root
    // quaternion via window._athleteFacing (body chest = local -z) and orbit
    // to alpha = atan2(fz, fx) so the camera sits on the forward ray.
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
        const PX_PER_M = m.H / (2 * 2.4 * Math.tan(0.4));
        const bw = Math.round(0.16 * PX_PER_M), bh = Math.round(0.24 * PX_PER_M);
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
    }

    // Canonical side view (review 70): perpendicular to the geometric
    // forward — not a fixed quarter turn from whatever the front picker chose.
    await page.evaluate((a) => {
        BABYLON.EngineStore.LastCreatedScene.activeCamera.alpha = a + Math.PI / 2;
    }, front.a);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure_side.png') });

    // Canonical face close-up (author 2b pass 1): ~0.6 m in front of the head.
    // Entry 75: this framing twice returned a landscape — the head target was
    // estimated from the SKI-POLLUTED whole-figure bbox (top.y*0.42 lands at
    // chest/ski level). Target the HELMET part's centre from _athleteFacing
    // (smallest athleteBody part) instead. Pause the sim first — its
    // per-frame callback rewrites camera.target.
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    await page.evaluate((a) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const f = window._athleteFacing();
        if (!f || !f.helmet) throw new Error('_athleteFacing helmet unavailable');
        const cam = scene.activeCamera;
        // ROOT CAUSE of three iterations of landscape face.png (entries
        // 73-75): Babylon's default near plane is minZ = 1.0, so at r = 0.6
        // the HEAD ITSELF is closer than the near plane and is clipped away —
        // the shot showed only what is BEHIND the head. minZ = 0.05 stays for
        // the rest of the spec: every other framing is >= 2.4 m out, where a
        // near-plane change has no visible effect.
        cam.minZ = 0.05;
    }, front.a);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'face.png') });

    // HARD gate (entry 75 / reviewer 19:40): "the head must fill >= 40% of
    // the frame height" and face.png must CONTAIN the head. Project the
    // helmet part's bounding box to screen and gate the vertical extent
    // (r = 0.6, fov 0.9 → frame height 0.605 m; the 0.24 m helmet measures
    // ≈ 0.40 of height) plus on-centreness. Band = measured with slack.
    {
        const head = await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const cam = scene.activeCamera, eng = scene.getEngine();
            const W = eng.getRenderWidth(), H = eng.getRenderHeight();
            // helmet = smallest athleteBody part
            let hp = null, vol = Infinity;
            for (const m of scene.meshes) {
                if (!m.name || m.name.indexOf('athleteBody') !== 0) continue;
                m.computeWorldMatrix(true);
                const b = m.getBoundingInfo().boundingBox;
                const e = b.maximumWorld.subtract(b.minimumWorld);
                const v = e.x * e.y * e.z;
                if (v < vol) { vol = v; hp = m; }
            }
            if (!hp) throw new Error('no helmet part');
            hp.computeWorldMatrix(true);
            const bb = hp.getBoundingInfo().boundingBox;
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
                const c = bb.centerWorld.add(bb.extendSize.multiply(new BABYLON.Vector3(sx, sy, sz)));
                const p = BABYLON.Vector3.Project(c, BABYLON.Matrix.Identity(),
                    scene.getTransformMatrix(), cam.viewport.toGlobal(W, H));
                x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
                x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
            }
            const hFrac = (y1 - y0) / H, wFrac = (x1 - x0) / W;
            const cx = (x0 + x1) / 2 / W, cy = (y0 + y1) / 2 / H;
            return { hFrac: +hFrac.toFixed(4), wFrac: +wFrac.toFixed(4),
                     cx: +cx.toFixed(3), cy: +cy.toFixed(3) };
        });
        console.log('FACEGATE', JSON.stringify(head));
        expect(head.hFrac, 'face.png does not frame the head — helmet fills '
            + (head.hFrac * 100).toFixed(1) + '% of the frame height (gate 40%, '
            + 'reviewer 19:40)').toBeGreaterThan(0.40);
        expect(Math.abs(head.cx - 0.5) + Math.abs(head.cy - 0.5), 'face.png head off centre')
            .toBeLessThan(0.25);
        // The projection above cannot see NEAR-PLANE CLIPPING (the entry-75
        // failure mode: geometry projects beautifully, the shot is pure
        // landscape). Read the actual shot: the dark helmet must occupy a real
        // share of the central region, and skin-tone pixels must exist (the
        // face below the goggles).
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
            for (let y = Y0; y < Y1; y += 2) {
                for (let x = X0; x < X1; x += 2) {
                    const i = (y * W + x) * 4;
                    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    n++;
                    if (lum < 0.30) dark++;
                    if (r > 0.30 && r > g * 1.12 && g > b * 1.02 && r < 0.95) skin++;
                }
            }
            return { dark: +(dark / n).toFixed(4), skin: +(skin / n).toFixed(4) };
        }, shot.toString('base64'));
        console.log('FACEPIX', JSON.stringify(px));
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

'use strict';
// Reusable visual-inspection harness. Frames the athlete and the terrain so each
// render iteration can be judged by eye, not just by assertions.
const { test } = require('@playwright/test');
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
    // Review 70: figure_front.png showed the athlete's BACK — the ready-turn
    // yaw moved again and a hard-coded alpha cannot track it. Pick the facing
    // empirically: render all four quadrant alphas and keep the one whose
    // frame carries the most skin-tone pixels (face/hands read only from the
    // front; the back is white suit + dark helmet).
    const front = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera, eng = scene.getEngine();
        const w = eng.getRenderWidth(), h = eng.getRenderHeight();
        let best = null;
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            cam.alpha = a;
            scene.render();
            const px = await eng.readPixels(0, 0, w, h);
            let skin = 0, bib = 0, n = 0;
            for (let i = 0; i + 3 < px.length; i += 4 * 7) {
                const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
                n++;
                if (r > 0.30 && r > g * 1.12 && g > b * 1.02 && r < 0.95) skin++;
                if (b > 0.55 && b > r * 1.1 && g > r && g < b) bib++;
            }
            // The bib panel wraps the chest front (front wrap to |lat| 0.14
            // vs a narrow rear patch), so bib-blue discriminates front from
            // back 2:1 (probe 2026-08-28: 0.319 front vs 0.150 rear at the
            // figure camera radius). Skin alone picked the BACK — the face is
            // too few pixels at r=2.4. bib dominates, skin breaks ties.
            const s = 2 * bib / Math.max(1, n) + skin / Math.max(1, n);
            if (!best || s > best.s) best = { a, s };
        }
        cam.alpha = best.a;
        return best;
    });
    console.log('FRONTALPHA', JSON.stringify(front));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure_front.png') });

    // Canonical side view (review 70): a quarter turn from the front.
    await page.evaluate(() => {
        BABYLON.EngineStore.LastCreatedScene.activeCamera.alpha += Math.PI / 2;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure_side.png') });

    // Canonical face close-up (author 2b pass 1): ~0.6 m in front of the head.
    // Pause the sim first — its per-frame callback rewrites camera.target.
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    await page.evaluate((frontAlpha) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        const top = hi.subtract(lo);
        const head = lo.add(top.scale(0.5)).add(new BABYLON.Vector3(0, top.y * 0.42, 0));
        const cam = scene.activeCamera;
        cam.setTarget(head);
        cam.alpha = frontAlpha; cam.beta = Math.PI / 2;
        cam.radius = 0.6; cam.fov = 0.9;
    }, front.a);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'face.png') });
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

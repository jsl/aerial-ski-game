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

    // A second angle from the FRONT. The bib and the number patch are front-only
    // and the leg stripe runs down the outboard side, so a single rear view shows
    // none of the suit design and makes a correct build look like a blank one.
    await page.evaluate(() => {
        const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        cam.alpha = Math.PI * 0.32;
        cam.beta = Math.PI / 2.6;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'figure_front.png') });

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

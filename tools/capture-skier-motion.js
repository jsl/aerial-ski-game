'use strict';
// Capture an actual keyboard-driven tuck cycle for visual review.
// DRIVE_GPU=1 DRIVE_PORT=8200 REVIEW_DIR=shots/astra-motion node tools/capture-skier-motion.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const out = path.resolve(process.env.REVIEW_DIR || 'shots/astra-motion');
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ args: require('./browser-renderer').args });
    try {
        const context = await browser.newContext({ viewport: { width: 720, height: 720 },
            recordVideo: { dir: out, size: { width: 720, height: 720 } } });
        const page = await context.newPage();
        if (process.env.REVIEW_SPINE_OFF === '1') await page.addInitScript(() => { window._spineOff = true; });
        await page.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || 8200) + '/index.html');
        await page.waitForFunction(() => window._bodyLinked > 0);
        await page.locator('#renderCanvas').click({ position: { x: 350, y: 350 } });
        const renderer = await page.evaluate(clay => {
            const scene = BABYLON.EngineStore.LastCreatedScene, camera = scene.activeCamera;
            const gl = scene.getEngine()._gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
            const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
            for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none';
            if (clay) {
                const mat = new BABYLON.StandardMaterial('reviewClay', scene);
                mat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
                mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
                for (const mesh of scene.meshes.filter(m => m.name.startsWith('athleteBody'))) mesh.material = mat;
            }
            camera.lowerRadiusLimit = 1; camera.radius = 3.2; camera.fov = 0.8;
            const f = window._athleteFacing().forward;
            camera.alpha = Math.atan2(f[2], f[0]) + Math.PI / 2;
            camera.beta = Math.PI / 2.15;
            window.__motionFrames = [];
            scene.onAfterRenderObservable.add(() => {
                const g = window._getGameState(), m = window._characterMeshes;
                const nodes = {};
                for (const name of ['torso', 'head', 'upperArmL', 'lowerArmL', 'upperLegL', 'lowerLegL', 'skiL', 'skiR']) {
                    m[name].computeWorldMatrix(true);
                    nodes[name] = { p: m[name].position.asArray(), r: m[name].rotation.asArray(),
                        world: m[name].getAbsolutePosition().asArray() };
                }
                window.__motionFrames.push({ time: performance.now(), tuck: g.tuckAmount, nodes });
            });
            return renderer;
        }, process.env.REVIEW_CLAY === '1');
        if (process.env.DRIVE_GPU === '1' && /SwiftShader|llvmpipe/i.test(renderer)) throw new Error('GPU review fell back to software: ' + renderer);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(out, 'ready.png') });
        await page.keyboard.down('Space');
        await page.waitForTimeout(2200);
        await page.screenshot({ path: path.join(out, 'tuck.png') });
        await page.keyboard.up('Space');
        await page.waitForTimeout(2200);
        await page.screenshot({ path: path.join(out, 'released.png') });
        const frames = await page.evaluate(() => window.__motionFrames);
        const worst = {};
        for (let i = 1; i < frames.length; i++) {
            for (const [name, n] of Object.entries(frames[i].nodes)) {
                const before = frames[i - 1].nodes[name].p;
                const distance = Math.hypot(...n.p.map((v, j) => v - before[j]));
                if (!worst[name] || distance > worst[name].distance) worst[name] = { distance,
                    tuck: frames[i].tuck, previousTuck: frames[i - 1].tuck,
                    dt: frames[i].time - frames[i - 1].time };
            }
        }
        fs.writeFileSync(path.join(out, 'motion.json'), JSON.stringify({ renderer, worst, frames }, null, 2));
        const video = page.video();
        await context.close();
        await video.saveAs(path.join(out, 'tuck-cycle.webm'));
        console.log(JSON.stringify({ out, renderer, worst }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

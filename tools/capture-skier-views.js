'use strict';
// Fresh hardware-rendered comparison stills of the actual held keyboard pose.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const out = path.resolve(process.env.REVIEW_DIR || 'shots/astra-current-views');
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ args: require('./browser-renderer').args });
    try {
        const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
        if (process.env.REVIEW_ASSET_DIR) {
            const assetDir = path.resolve(process.env.REVIEW_ASSET_DIR);
            const files = new Set(['athlete_body.glb', 'athlete_albedo.webp',
                'athlete_normal.webp', 'athlete_ao.webp', 'athlete_maps.json']);
            await page.route('**/assets/athlete*', async route => {
                const name = path.basename(new URL(route.request().url()).pathname);
                if (files.has(name)) await route.fulfill({ path: path.join(assetDir, name) });
                else await route.continue();
            });
        }
        await page.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || 8200) + '/index.html');
        await page.waitForFunction(() => window._bodyLinked > 0);
        if (process.env.REVIEW_CLAY === '1') await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const seen = new Set();
            for (const mesh of scene.meshes) {
                if (!/athleteBody/.test(mesh.name) || !mesh.material || seen.has(mesh.material)) continue;
                const material = mesh.material;
                seen.add(material);
                material.albedoTexture = material.bumpTexture = material.ambientTexture = null;
                material.metallicTexture = null;
                material.albedoColor = new BABYLON.Color3(.65, .65, .65);
                material.metallic = 0; material.roughness = 1;
            }
        });
        await page.locator('#renderCanvas').click({ position: { x: 350, y: 350 } });
        const renderer = await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene, camera = scene.activeCamera;
            for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none';
            camera.lowerRadiusLimit = 1; camera.radius = 3.2; camera.fov = 0.8;
            camera.beta = Math.PI / 2.15;
            // Keep review framing identical while the production camera
            // responds to terrain tilt and the held squat changes height.
            window.__reviewViewOffset = 0;
            scene.onBeforeRenderObservable.add(() => {
                const m = window._characterMeshes;
                if (!m) return;
                const head = m.head.getAbsolutePosition();
                const feet = m.skiL.getAbsolutePosition().add(m.skiR.getAbsolutePosition()).scale(0.5);
                camera.setTarget(head.add(feet).scale(0.5));
                const f = window._athleteFacing().forward;
                camera.alpha = Math.atan2(f[2], f[0]) + window.__reviewViewOffset;
                camera.beta = Math.PI / 2.15;
                camera.radius = 3.2;
                camera.inertialAlphaOffset = camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
            });
            const gl = scene.getEngine()._gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
            return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        });
        if (process.env.DRIVE_GPU === '1' && /SwiftShader|llvmpipe/i.test(renderer)) throw new Error('GPU review fell back to software: ' + renderer);
        for (const pose of ['ready', 'tuck']) {
            if (pose === 'tuck') { await page.keyboard.down('Space'); await page.waitForTimeout(1800); }
            for (const [view, offset] of [['front', 0], ['quarter', Math.PI / 4], ['side', Math.PI / 2]]) {
                await page.evaluate(a => {
                    window.__reviewViewOffset = a;
                }, offset);
                await page.waitForTimeout(350);
                await page.screenshot({ path: path.join(out, pose + '-' + view + '.png') });
            }
        }
        await page.keyboard.up('Space');
        fs.writeFileSync(path.join(out, 'renderer.json'), JSON.stringify({ renderer,
            assetDir: process.env.REVIEW_ASSET_DIR || 'assets', radius: 3.2,
            beta: Math.PI / 2.15, fov: 0.8 }, null, 2));
        console.log(JSON.stringify({ out, renderer }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

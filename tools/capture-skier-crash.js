'use strict';
// Real gameplay crash footage, including the default get-up and walk-off.
// DRIVE_GPU=1 REVIEW_DIR=shots/astra-crash node tools/capture-skier-crash.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const out = path.resolve(process.env.REVIEW_DIR || 'shots/astra-crash');
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ args: require('./browser-renderer').args });
    try {
        const context = await browser.newContext({ viewport: { width: 960, height: 720 },
            recordVideo: { dir: out, size: { width: 960, height: 720 } } });
        const page = await context.newPage();
        // Optional local candidate for an isolated diagnostic capture. The
        // working game and asset tree stay intact while comparing solver passes.
        if (process.env.REVIEW_GAME_JS) {
            const candidate = fs.readFileSync(path.resolve(process.env.REVIEW_GAME_JS), 'utf8');
            await page.route('**/game.js?*', route => route.fulfill({
                status: 200, contentType: 'application/javascript', body: candidate,
            }));
        }
        await page.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || 8200) + '/index.html');
        await page.waitForFunction(() => window._bodyLinked > 0);
        const renderer = await page.evaluate(sideView => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const gl = scene.getEngine()._gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (sideView) {
                for (const el of document.querySelectorAll('body > *')) if (el.id !== 'renderCanvas') el.style.display = 'none';
                // A separate study view keeps the small sliding body readable.
                // Leave the gameplay/ragdoll clocks and default recovery intact.
                scene.onBeforeRenderObservable.add(() => {
                    if (!window._ragdollProbe()) return;
                    const torso = window._characterMeshes.torso;
                    torso.computeWorldMatrix(true);
                    const cam = scene.activeCamera;
                    cam.target.copyFrom(torso.getAbsolutePosition());
                    cam.alpha = 0; cam.beta = 1.2; cam.radius = 3.6;
                    cam.getViewMatrix(true);
                });
            }
            window.__crashFrames = [];
            scene.onAfterRenderObservable.add(() => {
                const crash = window._ragdollProbe();
                if (!crash) return;
                const nodes = {};
                for (const name of ['torso', 'head', 'upperArmL', 'lowerArmL', 'upperLegL', 'lowerLegL']) {
                    const mesh = window._characterMeshes[name];
                    mesh.computeWorldMatrix(true);
                    nodes[name] = { p: mesh.getAbsolutePosition().asArray(), r: mesh.rotation.asArray() };
                }
                window.__crashFrames.push({ time: performance.now(), crash, walkoff: window._walkoffProbe(), nodes });
            });
            return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }, process.env.REVIEW_SIDE === '1');
        if (process.env.DRIVE_GPU === '1' && /SwiftShader|llvmpipe/i.test(renderer)) throw new Error('GPU review fell back to software: ' + renderer);
        await page.keyboard.press('ArrowUp');
        await page.waitForFunction(() => !window._getGameState().readyState);
        await page.evaluate(() => {
            let down = false, tuck = false, armed = false;
            const send = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
            const tick = () => {
                const g = window._getGameState();
                if (g.crashed) {
                    if (down) send('keyup', 'ArrowDown');
                    if (tuck) send('keyup', 'Space');
                    return;
                }
                if (!g.grounded && g.posZ >= g.KICKER_END_Z && !armed) {
                    armed = true; window._debugTriggerCrash();
                }
                if (g.grounded && !down && g.flipPower < 0.999) {
                    down = true; send('keydown', 'ArrowDown');
                } else if (down && (g.flipPower >= 0.999 || !g.grounded)) {
                    down = false; send('keyup', 'ArrowDown');
                }
                if (!g.grounded && !tuck) { tuck = true; send('keydown', 'Space'); }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await page.waitForFunction(() => window._ragdollProbe(), null, { timeout: 120000 });
        for (const seconds of [0, 0.3, 0.6, 1, 2, 4, 8, 12, 16, 22, 28]) {
            await page.waitForFunction(t => window._ragdollProbe().t >= t, seconds, { timeout: 120000 });
            await page.screenshot({ path: path.join(out, `crash-${String(seconds).replace('.', '-')}.png`) });
        }
        const frames = await page.evaluate(() => window.__crashFrames);
        fs.writeFileSync(path.join(out, 'crash.json'), JSON.stringify({ renderer, frames }, null, 2));
        const video = page.video();
        await context.close();
        await video.saveAs(path.join(out, 'crash-cycle.webm'));
        console.log(JSON.stringify({ out, renderer, frames: frames.length, final: frames.at(-1).walkoff }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

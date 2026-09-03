// Mobile-viewport by-eye shots (Fable spec 239, 2026-09-02): the author's framing.
// usage: SC=<outdir> PORT=8099 node tools/mobile_shots.js
const { chromium, devices } = require('../node_modules/playwright');
(async () => {
  const port = process.env.PORT || '8099', out = process.env.SC || '.';
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/index.html?nc=${Date.now()}`);
  await p.waitForFunction(() => typeof window._getGameState === 'function', null, { timeout: 60000 });
  await p.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  const zoom = (r) => p.evaluate((r) => { const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera; cam.lowerRadiusLimit = r; cam.radius = r; }, r);
  await p.screenshot({ path: `${out}/mobile_ready_10m.png` });
  await zoom(4); await p.waitForTimeout(500); await p.screenshot({ path: `${out}/mobile_ready_4m.png` });
    await p.keyboard.press('ArrowUp'); await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/mobile_inrun_10m.png` });
    await zoom(4); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/mobile_inrun_4m.png` });
    // flight: wait for airborne past the kicker, then frame it
    await p.waitForFunction(() => {
        const g = window._getGameState();
        return !g.grounded && g.posZ >= g.KICKER_END_Z;
    }, null, { timeout: 60000 }).catch(() => {});
    const fl = await p.evaluate(() => {
        const g = window._getGameState();
        const c = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        c.lowerRadiusLimit = 4; c.radius = 4;
        return { grounded: g.grounded, posZ: +g.posZ.toFixed(1), spinAngle: +g.spinAngle.toFixed(2) };
    });
    await p.screenshot({ path: `${out}/mobile_flight_4m.png` });
    // crash rest: trigger at takeoff like crash-ragdoll.spec, wait for ragdoll rest
    await p.evaluate(() => {
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        window._groundRestRun = { armed: false, down: false, tuck: false };
        const tick = () => {
            const C = window._groundRestRun;
            if (!C || C.done) return;
            const g = window._getGameState();
            if (g.crashed) {
                if (C.down) { C.down = false; send('keyup', 'ArrowDown'); }
                if (C.tuck) { C.tuck = false; send('keyup', 'Space'); }
                return requestAnimationFrame(tick);
            }
            if (!g.grounded && g.posZ >= g.KICKER_END_Z && !C.armed) {
                C.armed = true; window._debugTriggerCrash();
            }
            if (g.grounded && !C.down && g.flipPower < 0.999) {
                C.down = true; send('keydown', 'ArrowDown');
            } else if (C.down && (g.flipPower >= 0.999 || !g.grounded)) {
                C.down = false; send('keyup', 'ArrowDown');
            }
            if (!g.grounded && !C.tuck) { C.tuck = true; send('keydown', 'Space'); }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await p.waitForFunction(() => {
        const p2 = window._ragdollProbe && window._ragdollProbe();
        return window._getGameState().crashed && p2 && p2.resting;
    }, null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const rest = await p.evaluate(() => {
        const g = window._getGameState();
        const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        cam.lowerRadiusLimit = 4; cam.radius = 4;
        return { crashed: g.crashed, posZ: +g.posZ.toFixed(1) };
    });
    await p.screenshot({ path: `${out}/mobile_crash_rest_4m.png` });
    console.log('flight:', JSON.stringify(fl), 'rest:', JSON.stringify(rest));
    await b.close();
})();

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
  await b.close();
})();

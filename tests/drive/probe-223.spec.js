const { test } = require('@playwright/test');
test('probe2', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const occ = scene.meshes.find(m => m.material && m.material.name === 'athleteOccluder_mat');
    const shot = async () => {
      scene.render();
      const eng = scene.getEngine();
      const W = eng.getRenderWidth(), H = eng.getRenderHeight();
      // crop the crotch region of the figure: x 600-720, y 300-400 (front framing)
      const data = await eng.readPixels(600, H - 400, 120, 100);
      let sum = 0; for (let i = 0; i < data.length; i += 4) sum += data[i];
      return sum;
    };
    const on = await shot();
    occ.setEnabled(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = await shot();
    return { name: occ.name, enabledNow: occ.isEnabled(), vis: occ.isVisible, on, off };
  });
  console.log('PROBE2', JSON.stringify(out));
});

// One-off probe (iter 56): where does the forest's frame-time cost sit?
// Uses the game's own render loop (like quality.spec) and measures 300 RAF
// deltas in three states: (a) as shipped, (b) treeCards spliced out of the CSM
// depth list, (c) treeCards invisible. Usage: node tools/scratch-tree-cost.js
const { chromium } = require('@playwright/test');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 320, height: 220 } });
    await page.goto('http://127.0.0.1:8123/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForTimeout(2500);

    const measure = async (label) => {
        const m = await page.evaluate(async () => {
            const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
            const dts = [];
            for (let i = 0; i < 300; i++) {
                const t0 = performance.now();
                await new Promise((r) => requestAnimationFrame(r));
                dts.push(performance.now() - t0);
            }
            dts.sort((a, b) => a - b);
            const mean = dts.reduce((s, v) => s + v, 0) / dts.length;
            return { mean, p50: dts[150] };
        });
        console.log(label, 'mean=' + m.mean.toFixed(1), 'p50=' + m.p50.toFixed(1));
    };

    await measure('a-shipped      ');
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        let gen = null;
        for (const l of scene.lights) {
            const g = l.getShadowGenerator && l.getShadowGenerator();
            if (g && g.getShadowMap && g.getShadowMap()) { gen = g; break; }
        }
        const rl = gen.getShadowMap().renderList;
        const i = rl.findIndex((m) => m.name === 'treeCards');
        if (i >= 0) rl.splice(i, 1);
        window.__cards = scene.getMeshByName('treeCards');
    });
    await page.waitForTimeout(500);
    await measure('b-no-tree-depth');
    await page.evaluate(() => { window.__cards.isVisible = false; });
    await page.waitForTimeout(500);
    await measure('c-cards-hidden ');
    await browser.close();
})();

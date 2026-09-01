// ── P5 landing-spray plume numbers (docs/RENDER-PLAN.md, P5) ────────────────
// Footage numbers (docs/REFERENCE-FOOTAGE.md, IMG_7841 landing sequence):
// the plume off the ski tails peaks 1–1.5 m above the surface ~0.4–0.5 s
// after touchdown and trails 1–2 s. _spawnSnowBurst was retuned (iter 229) to
// hit that band; this spec measures the LIVE particle system in the running
// game through the window._snowBursts probe registry, not the constants.
//
// Negative control: the same measurement at an over-speed spawn (speedScale 6
// — far beyond any real landing |vz|/12 ≈ 1.3–1.7) must blow past the peak
// band, proving the gates can see an over-powered plume.
const { test, expect } = require('@playwright/test');

// Sample the newest live snowBurst system each frame until `ms` elapse.
// Returns { peak, tPeak, aliveAt: [ {t, n} ... ] } with heights measured
// above the emitter y.
async function sampleBurst(page, ms) {
    return page.evaluate(async (ms) => {
        const BABYLON = window.BABYLON;
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const samples = [];
        const t0 = performance.now();
        await new Promise((resolve) => {
            const step = () => {
                const t = (performance.now() - t0) / 1000;
                const ps = (window._snowBursts || [])[0];
                if (ps) {
                    const ey = ps.emitter.y;
                    let n = 0, peak = 0;
                    for (const p of ps._particles) {
                        if (!p.isActive && p.age >= p.lifeTime) continue;
                        n++;
                        peak = Math.max(peak, p.position.y - ey);
                    }
                    samples.push({ t, n, peak });
                }
                if (performance.now() - t0 < ms) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
        let peak = 0, tPeak = 0;
        for (const s of samples) {
            if (s.peak > peak) { peak = s.peak; tPeak = s.t; }
        }
        const aliveAt = (tq) => {
            // Nearest sample — at headless ~5–7 fps samples are > 0.15 s apart.
            let best = null;
            for (const s of samples) {
                if (!best || Math.abs(s.t - tq) < Math.abs(best.t - tq)) best = s;
            }
            return best ? best.n : -1;
        };
        const lastAlive = samples.reduce((a, s) => (s.n > 0 ? s.t : a), 0);
        return { peak, tPeak, alive1: aliveAt(1.0), alive2: aliveAt(2.0), lastAlive,
                 nSamples: samples.length };
    }, ms);
}

test('P5 landing spray: plume peak/timing/trail in the footage band', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._terrainCfg && window.BABYLON &&
        BABYLON.EngineStore && BABYLON.EngineStore.LastCreatedScene, null, { timeout: 30000 });
    await page.waitForTimeout(1200);   // snow detail tiles apply ~1.2 s in

    // Representative real landing: |vz| ≈ 18 m/s → speedScale 1.5.
    await page.evaluate(() => { window._snowBursts = []; });
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = (cfg.LANDING_START_Z + cfg.KICKER_END_Z) / 2;
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) + 0.05;
        // _spawnSnowBurst is closure-scoped; drive it through a real spawn:
        // the same call site the landing branch uses, via the exposed helper.
        window._spawnSnowBurstProbe(0, y, z, 60, 1.5);
    });
    const m = await sampleBurst(page, 2600);
    console.log('SPRAY_MEASURE ' + JSON.stringify(m));

    // Headless SwiftShader runs ~7 fps: 2.6 s yields only ~16–20 samples.
    expect(m.nSamples, `only ${m.nSamples} samples in 2.6 s`).toBeGreaterThan(5);
    expect(m.peak, `plume peak ${m.peak.toFixed(2)} m outside footage band [0.7, 1.7]`)
        .toBeGreaterThanOrEqual(0.7);
    expect(m.peak).toBeLessThanOrEqual(1.7);
    // Footage timing (~0.4–0.5 s to peak) is pinned by construction
    // (v ≤ 4.1 m/s, g = 8 → t_peak ≤ 0.51 s); the fps-limited instrument only
    // bounds it. Measured tPeak across runs: 0.04–0.56 s (coarse sampling).
    expect(m.tPeak, `peak at t=${m.tPeak.toFixed(2)} s (> 0.9 s)`).toBeLessThanOrEqual(0.9);
    // Trail: still visible 1 s in, done before ~2.3 s (1–2 s trail).
    expect(m.alive1, `plume dead at t=1.0 s (n=${m.alive1})`).toBeGreaterThan(0);
    expect(m.lastAlive, `plume persists to ${m.lastAlive.toFixed(2)} s (> 2.2)`)
        .toBeLessThanOrEqual(2.25);
});

test('P5 spray negative control: over-speed spawn exceeds the plume band', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._terrainCfg && window.BABYLON &&
        BABYLON.EngineStore && BABYLON.EngineStore.LastCreatedScene, null, { timeout: 30000 });
    await page.waitForTimeout(1200);

    await page.evaluate(() => { window._snowBursts = []; });
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cfg = window._terrainCfg;
        const z = (cfg.LANDING_START_Z + cfg.KICKER_END_Z) / 2;
        const y = AerialEngine.aerialSki.terrainRootY(z, cfg) + 0.05;
        window._spawnSnowBurstProbe(0, y, z, 60, 6.0);   // far beyond real landings
    });
    const m = await sampleBurst(page, 2600);
    console.log('SPRAY_NC ' + JSON.stringify(m));
    expect(m.peak, `over-speed plume peak ${m.peak.toFixed(2)} m did NOT exceed the band`)
        .toBeGreaterThan(1.7);
});

'use strict';
// ── P10 free-look camera ─────────────────────────────────────────────────────
// In the ready state, after the crash ragdoll settles, and during replay the
// player may orbit: drag (always live attachControl), wheel zoom, WASD nudge.
// While free-look is active the per-frame camera follow stands down (the view
// stays where the user put it) and resumes on the next run. The eye is clamped
// ≥ 1 m above the snow under it. Launch keys still work while orbiting.
const { test, expect } = require('@playwright/test');

async function loadGame(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 90_000 });
}

async function drag(page, dx) {
    const box = await page.locator('#renderCanvas').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy, { steps: 12 });
    await page.mouse.up();
}

test('free-look: active in ready state, drag orbits and persists, terrain clamp holds, run keys still work', async ({ page }) => {
    await loadGame(page);
    await page.waitForTimeout(800);

    // Ready state → free-look active, wheel zoom unlocked
    let p = await page.evaluate(() => window._freeLookProbe());
    expect(p.active).toBe(true);

    // Drag orbits the camera…
    const a0 = p.alpha;
    await drag(page, 180);
    p = await page.evaluate(() => window._freeLookProbe());
    expect(Math.abs(p.alpha - a0)).toBeGreaterThan(0.05);
    // …and the view persists (follow is standing down — no clobber for 1 s)
    const aPersist = p.alpha;
    await page.waitForTimeout(1000);
    p = await page.evaluate(() => window._freeLookProbe());
    expect(Math.abs(p.alpha - aPersist)).toBeLessThan(0.001);

    // WASD nudge (layout-aware letter key) pans alpha; W zooms in
    const a1 = p.alpha;
    await page.keyboard.press('a');
    p = await page.evaluate(() => window._freeLookProbe());
    expect(p.alpha).toBeLessThan(a1);
    const r0 = p.radius;
    await page.keyboard.press('w');
    p = await page.evaluate(() => window._freeLookProbe());
    expect(p.radius).toBeLessThan(r0);

    // Terrain clamp: force the camera to the lowest orbit point at long radius
    await page.evaluate(() => {
        const c = window._freeLookCam();
        c.beta = c.upperBetaLimit;
        c.radius = c.upperRadiusLimit;
    });
    await page.waitForTimeout(250);
    p = await page.evaluate(() => window._freeLookProbe());
    expect(p.gap).toBeGreaterThanOrEqual(0.99);

    // Launch keys must not be swallowed by free-look: ArrowUp starts the run
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 10_000 });
    p = await page.evaluate(() => window._freeLookProbe());
    expect(p.active).toBe(false);
});

test('free-look: after a forced crash settles, orbit works and the follow stays parked', async ({ page }) => {
    test.setTimeout(240_000);
    await loadGame(page);
    await page.waitForTimeout(800);

    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    // Deterministic crash trigger (see crash-ragdoll.spec.js): charge fully,
    // tuck from takeoff, arm _debugTriggerCrash past the kicker lip.
    await page.evaluate(() => {
        window._pump = { down: false, tuck: false, armed: false, stop: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            if (window._pump.stop) return;
            const g = window._getGameState();
            if (g.crashed) {
                if (window._pump.down) send('keyup', 'ArrowDown');
                if (window._pump.tuck) send('keyup', 'Space');
                window._pump.stop = true;
                return;
            }
            if (!g.grounded && g.posZ >= g.KICKER_END_Z && !window._pump.armed) {
                window._pump.armed = true;
                window._debugTriggerCrash();
            }
            if (g.grounded && !window._pump.down && g.flipPower < 0.999) {
                window._pump.down = true; send('keydown', 'ArrowDown');
            } else if (window._pump.down && (g.flipPower >= 0.999 || !g.grounded)) {
                window._pump.down = false; send('keyup', 'ArrowDown');
            }
            if (!g.grounded && !window._pump.tuck) {
                window._pump.tuck = true; send('keydown', 'Space');
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    // Free-look re-arms once the ragdoll settles (crashed && !crashActive).
    await page.waitForFunction(() => {
        const p = window._freeLookProbe();
        return p && p.active;
    }, null, { timeout: 90_000 });

    const a0 = (await page.evaluate(() => window._freeLookProbe())).alpha;
    await drag(page, -160);
    const a1 = (await page.evaluate(() => window._freeLookProbe())).alpha;
    expect(Math.abs(a1 - a0)).toBeGreaterThan(0.05);
    await page.waitForTimeout(1000);
    const a2 = (await page.evaluate(() => window._freeLookProbe())).alpha;
    expect(Math.abs(a2 - a1)).toBeLessThan(0.001);
    // Eye above the snow while orbiting the resting body
    const p = await page.evaluate(() => window._freeLookProbe());
    expect(p.gap).toBeGreaterThanOrEqual(0.99);
});

// HUMAN TESTING #7 (author, 2026-08-29): "the scene starts in front of the
// aerialist when the page loads … it was fine before when camera started
// behind". Root cause: free-look took over on frame 1 before the follow block
// had framed the athlete, so the orbit target stayed at the origin. Gate: on
// load the orbit target is the athlete root and the eye sits UPHILL of it.
test('free-look: on load the camera frames the athlete from behind, not from the front', async ({ page }) => {
    await loadGame(page);
    await page.waitForTimeout(800);
    const p = await page.evaluate(() => window._freeLookProbe());
    expect(p.active).toBe(true);
    expect(Math.abs(p.targetZ - p.rootZ)).toBeLessThan(0.5);   // target = athlete, not the origin
    expect(p.camZ).toBeLessThan(p.rootZ - 3);                   // eye behind (uphill of) the athlete
    // Negative control: the pre-fix state (target at the origin) fails the same predicate.
    const bad = await page.evaluate(() => { const c = window._freeLookCam(); c.target.z = 0; c.target.y = 0; return window._freeLookProbe(); });
    expect(Math.abs(bad.targetZ - bad.rootZ) < 0.5 && bad.camZ < bad.rootZ - 3).toBe(false);
});

// HUMAN TESTING #10 (author, 2026-08-30): "Reset to top of slope with R doesn't
// seem to work". The state reset always worked; the free-look camera stayed
// parked at the crash site. Gate: after a crash + orbit, R re-frames the
// athlete from behind.
test('free-look: after a crash and an orbit, R re-frames the athlete from behind', async ({ page }) => {
    test.setTimeout(240_000);
    await loadGame(page);
    await page.waitForTimeout(800);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false, null, { timeout: 90_000 });
    // Same deterministic pump-forced crash as the test above.
    await page.evaluate(() => {
        window._pump = { down: false, tuck: false, armed: false, stop: false };
        const send = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            if (window._pump.stop) return;
            const g = window._getGameState();
            if (g.crashed) { if (window._pump.down) send('keyup', 'ArrowDown'); if (window._pump.tuck) send('keyup', 'Space'); window._pump.stop = true; return; }
            if (!g.grounded && g.posZ >= g.KICKER_END_Z && !window._pump.armed) { window._pump.armed = true; window._debugTriggerCrash(); }
            if (g.grounded && !window._pump.down && g.flipPower < 0.999) { window._pump.down = true; send('keydown', 'ArrowDown'); }
            else if (window._pump.down && (g.flipPower >= 0.999 || !g.grounded)) { window._pump.down = false; send('keyup', 'ArrowDown'); }
            if (!g.grounded && !window._pump.tuck) { window._pump.tuck = true; send('keydown', 'Space'); }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await page.waitForFunction(() => { const p = window._freeLookProbe(); return window._getGameState().crashed && p && p.active; }, null, { timeout: 120_000 });
    await page.waitForTimeout(500);
    await drag(page, 220);                       // the user orbits at the crash site…
    const before = await page.evaluate(() => window._freeLookProbe());
    await page.keyboard.press('r');              // …then resets to the top
    await page.waitForTimeout(800);
    const p = await page.evaluate(() => window._freeLookProbe());
    console.log('R re-frame', JSON.stringify({ before: { targetZ: before.targetZ, rootZ: before.rootZ }, after: { targetZ: p.targetZ, rootZ: p.rootZ, camZ: p.camZ } }));
    expect(Math.abs(p.targetZ - p.rootZ)).toBeLessThan(0.5);   // camera target is the athlete again
    expect(p.camZ).toBeLessThan(p.rootZ - 3);                   // and the eye is behind (uphill of) it
});

// "a hard lock on camera rotation below the surface of the earth at all points
// of game": drive the orbit to its lowest possible beta at four headings and a
// long radius (toward the flanks and the knoll) and require the eye to stay
// ≥ 0.99 m above the ray-picked ground under it, every time.
test('camera hard lock: the eye never goes under the picked ground at any heading', async ({ page }) => {
    await loadGame(page);
    await page.waitForTimeout(500);
    const res = await page.evaluate(async () => {
        const c = window._freeLookCam(); const scene = BABYLON.EngineStore.LastCreatedScene;
        c.lowerRadiusLimit = 3; c.upperRadiusLimit = 80;
        const out = [];
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 0.25, Math.PI * 1.25]) {
            for (const r of [10, 30, 60]) {
                c.alpha = a; c.radius = r; c.beta = Math.PI - 0.05;   // as low as the orbit allows
                scene.render(); scene.render();
                const g = window._camGroundUnder();
                out.push({ a: +a.toFixed(2), r, gap: +(g.camY - g.ground).toFixed(3) });
            }
        }
        return out;
    });
    const worst = Math.min(...res.map(o => o.gap));
    console.log('camera hard lock', JSON.stringify({ worst, samples: res.length }));
    expect(worst).toBeGreaterThanOrEqual(0.99);
});

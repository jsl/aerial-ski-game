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

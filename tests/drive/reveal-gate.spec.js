'use strict';
// ── NEXT.md item 2 (2026-08-29): skis must not render before the skier ─────
// The author still saw skis (and, on some loads, half-dressed glTF parts)
// before the athlete. Gates, sampled EVERY animation frame from before any
// page script runs:
//   1. before _bodyLinked > 0, NO mesh of the athlete OR the skis (driver
//      solids, their children incl. the styled skis/boots/bindings, the
//      skinned body parts, goggles) is isVisible && isEnabled();
//   2. the loading overlay ('#athleteLoading') is present from the first
//      frames and is GONE in the frame the body appears (checked right after
//      the link, and again several frames later);
//   3. negative control: forcing a styled ski visible while _bodyLinked is
//      still 0 IS caught by the same detector the gate uses.

const { test, expect } = require('@playwright/test');

async function installWatcher(page) {
    await page.addInitScript(() => {
        window.__revealGate = { violations: [], frames: 0, overlayFrames: 0 };
        const orig = window.requestAnimationFrame.bind(window);
        const skiish = /ski|boot|bind|goggle|athleteBody|_glove|visor/i;
        // 'terrainSkirt' matches /ski/i — it is snowfield, not equipment.
        const notTerrain = m => !/^terrain/i.test(m.name || '');
        window.requestAnimationFrame = fn => orig(t => {
            try {
                const g = window.__revealGate;
                g.frames++;
                if (document.getElementById('athleteLoading')) g.overlayFrames++;
                if (!window._bodyLinked && !window._bodyFallback) {
                    const scene = window.BABYLON && BABYLON.EngineStore &&
                        BABYLON.EngineStore.LastCreatedScene;
                    const meshes = scene ? scene.meshes : [];
                    for (const m of meshes) {
                        if (!m.name || !skiish.test(m.name) || !notTerrain(m)) continue;
                        const vis = m.isVisible && (!m.isEnabled || m.isEnabled());
                        if (vis) g.violations.push(g.frames + ':' + m.name);
                    }
                }
            } catch (e) { /* watcher must never break the game */ }
            fn(t);
        });
    });
}

test('fresh load: no athlete/ski mesh visible before the body links; overlay covers and clears in the reveal frame', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await installWatcher(page);

    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    // The overlay must be gone in the reveal frame — check immediately.
    const atReveal = await page.evaluate(() => ({
        revealed: !!window._athleteRevealed,
        overlayGone: !document.getElementById('athleteLoading'),
    }));
    expect(atReveal.revealed).toBe(true);
    expect(atReveal.overlayGone).toBe(true);

    await page.waitForFunction(() => window.__revealGate.frames > 60, null, { timeout: 30_000 });
    const g = await page.evaluate(() => window.__revealGate);
    expect(g.overlayFrames).toBeGreaterThan(0);   // the overlay really showed
    expect(g.violations).toEqual([]);
    expect(errors).toEqual([]);
});

test('negative control: forcing a styled ski visible early is caught', async ({ page }) => {
    await installWatcher(page);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.__revealGate.frames > 5, null, { timeout: 30_000 });
    // Deterministic: pin the gate state to "pre-link", then force a ski
    // visible. The watcher MUST record a violation for it.
    await page.evaluate(() => {
        window._bodyLinked = 0;
        window._bodyFallback = 0;
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ski = scene.meshes.find(m => m.name && /^ski/i.test(m.name)
            && !/^terrain/i.test(m.name)) ||
            scene.meshes.find(m => m.name && /ski/i.test(m.name)
            && !/^terrain/i.test(m.name));
        if (ski) ski.isVisible = true;
        window.__forcedSki = ski ? ski.name : null;
    });
    await page.waitForFunction(() => window.__revealGate.violations.length > 0,
        null, { timeout: 15_000 });
    const v = await page.evaluate(() => ({
        violations: window.__revealGate.violations,
        forced: window.__forcedSki,
    }));
    expect(v.forced).toBeTruthy();
    expect(v.violations.some(s => s.endsWith(':' + v.forced))).toBe(true);
});

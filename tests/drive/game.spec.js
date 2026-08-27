'use strict';
// ── Real-browser drive-through ───────────────────────────────────────────────
// The only layer that runs game.js against REAL lib/babylon.js in a REAL
// browser. Everything else runs against tests/babylon-stub.js, which by
// construction cannot catch divergence between the stub and the actual engine.
//
// Deliberately a SMOKE test, not a precision one. The golden traces already
// compare thousands of values deterministically; what they cannot tell us is
// whether any of it works outside the stub. So this asks the questions only
// reality can answer:
//   - does the game boot with nine engine modules loading in dependency order?
//   - does a full run play through: approach, charge, take-off, flight, landing?
//   - does the athlete actually rotate (i.e. is the physics running)?
//   - are there console errors? game.js swallows exceptions into console.error,
//     so a silent failure surfaces there and nowhere else.
//
// TIMING: this machine has no GPU available to the browser, so Chromium renders
// through SwiftShader and requestAnimationFrame delivers roughly 9 fps rather
// than 60. A run that takes ~430 frames therefore needs ~50 s of wall clock, not
// ~7 s. Timeouts below are sized for that, and the helpers poll on simulation
// STATE rather than elapsed time so they stay correct on a faster machine too.

const { test, expect } = require('@playwright/test');

/** Collect console errors and page exceptions for the whole test. */
function watchErrors(page) {
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    return errors;
}

/** Wait until game.js has booted and exposed its state accessor. */
async function waitForBoot(page) {
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // Press-start inputs are swallowed if they land while the glb body-link
    // promise is still resolving (iter-20 probe: turn never starts within
    // 150 s). Wait for the link to complete before any key is pressed.
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
}

const state = (page) => page.evaluate(() => window._getGameState());

test('the game boots in a real browser with all engine modules loaded', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await waitForBoot(page);

    // Every engine namespace must be present. A load-order mistake would break
    // the browser while every headless test stayed green — this is precisely the
    // failure the stub-based layers cannot see.
    const namespaces = await page.evaluate(() =>
        window.AerialEngine ? Object.keys(window.AerialEngine).sort() : null);

    expect(namespaces, 'AerialEngine namespace missing — engine modules did not load')
        .not.toBeNull();
    for (const ns of ['math', 'pose', 'inertia', 'bodyModel', 'power',
                      'rotation', 'tricks', 'landing', 'aerialSki']) {
        expect(namespaces, `AerialEngine.${ns} not registered`).toContain(ns);
    }

    // Real Babylon, not the stub.
    const babylonReal = await page.evaluate(() =>
        typeof BABYLON !== 'undefined' && typeof BABYLON.Engine === 'function' &&
        typeof BABYLON.Quaternion.RotationAxis === 'function');
    expect(babylonReal, 'real Babylon.js did not load').toBe(true);

    expect(errors, 'console errors during boot').toEqual([]);
});

test('the engine modules compute correctly against real Babylon', async ({ page }) => {
    await page.goto('/index.html');
    await waitForBoot(page);

    // Spot-check that the extracted maths behaves in the browser exactly as it
    // does in node --test. Same inputs, same expected outputs.
    const results = await page.evaluate(() => {
        const E = window.AerialEngine;
        return {
            lerp:      E.math.lerp(0, 10, 0.5),
            power75:   E.power.flipSpeedMultiplier(0.75, false),
            powerZero: E.power.flipSpeedMultiplier(0, false),
            frontBoost: E.rotation.FRONTFLIP_BOOST,
            feetDownUp: E.landing.isFeetDown(0),
            feetDownInv: E.landing.isFeetDown(Math.PI),
            ddZero:    E.tricks.DD_TABLE['0'],
            segCount:  E.bodyModel.SEGMENTS.length,
        };
    });

    expect(results.lerp).toBe(5);
    expect(results.power75).toBe(1);
    expect(results.powerZero).toBeLessThan(0.1);
    expect(results.frontBoost).toBe(1.11);
    expect(results.feetDownUp).toBe(true);
    expect(results.feetDownInv).toBe(false);
    expect(results.ddZero).toBe(1.7);
    expect(results.segCount).toBe(12);
});

test('a full run plays through: approach, charge, take-off, flight, landing', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await waitForBoot(page);

    const start = await state(page);
    expect(start.grounded, 'should start on the ground').toBe(true);
    expect(start.readyState, 'should start in the ready state').toBe(true);

    // Start the run.
    await page.keyboard.press('ArrowUp');

    // Charge the power meter on the approach — ArrowDown while grounded.
    // Hold until flipPower actually reaches the target rather than guessing at a
    // duration, since the frame rate here is ~9 fps and charging is dt-based.
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window._getGameState().flipPower >= 0.7,
        null, { timeout: 40_000 });
    await page.keyboard.up('ArrowDown');

    // Wait for take-off. Poll on state, not elapsed time.
    await page.waitForFunction(() => window._getGameState().grounded === false,
        null, { timeout: 90_000 });

    const air = await state(page);
    expect(air.grounded).toBe(false);

    // Tuck in flight (Space), which should speed the rotation up via omega = L/I.
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount > 0.3,
        null, { timeout: 20_000 });
    await page.keyboard.up('Space');

    // The athlete must actually rotate — if the physics were not running, the
    // orientation would be static while every other assertion still passed.
    const rotated = await page.evaluate(async () => {
        const root = window._characterMeshes && window._characterMeshes.torso
            ? window._characterMeshes.torso.parent : null;
        const read = () => {
            const q = root && root.rotationQuaternion;
            return q ? [q.x, q.y, q.z, q.w] : null;
        };
        const before = read();
        // ~9 fps here, so 400 ms may be only 3 frames. Wait long enough to be
        // sure several frames elapsed.
        await new Promise(r => setTimeout(r, 1500));
        const after = read();
        if (!before || !after) return { ok: false, reason: 'no root quaternion' };
        const moved = before.some((v, i) => Math.abs(v - after[i]) > 1e-6);
        return { ok: moved, before, after };
    });
    expect(rotated.ok, `athlete did not rotate in flight: ${JSON.stringify(rotated)}`).toBe(true);

    // Land (or crash) — either is a completed run; a hang is not.
    await page.waitForFunction(() => {
        const s = window._getGameState();
        return s.grounded === true || s.crashed === true;
    }, null, { timeout: 90_000 });

    const end = await state(page);
    expect(end.posZ, 'skier should have travelled down the hill').toBeGreaterThan(start.posZ);

    expect(errors, 'console errors during the run').toEqual([]);
});

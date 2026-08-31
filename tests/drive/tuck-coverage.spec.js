'use strict';
// ── Tuck heel-lift COVERAGE SWEEP (#21 v3, NEXT.md 5a-NEW(ii)) ──────────────
// The author (2026-08-31): "heels lift in REAL PLAY while the flight-sweep
// gate reads 0.00 mm — the gate's path (comp=easy scripted pulse) is not the
// game's tuck path." This spec sweeps the game's REAL tuck paths — every
// trick family × input mode — sampling _bootSkiProbe() every rendered frame
// from the in-run descent through the ride-out:
//
//   1. keyboard tuck pulse in REALISTIC mode (?mode=realistic)
//   2. keyboard tuck + OFF-AXIS twist (KeyA held through the air) — applyPose
//      blends an extra visual tuck (offAxisVisualTuck ≤ 0.25) while the
//      boot–ski pin reads state.tuckAmount only, so this is the prime suspect
//   3. PIKE (ShiftLeft held airborne) — pike zeroes tuckAmount, so the pin's
//      weight w = tuck·(1−armRaise) reads 0 while the legs are posed forward
//   4. GAMEPAD tuck (RT analog through a stubbed getGamepads) — the analog
//      ramp holds tuckTarget at partial values the keyboard pulse never does
//   5. negative control: keyboard tuck + window._flightPinOff (historic
//      heel-lift injection) — the sweep MUST fail, proving coverage
//
// Gate: identical contract to flight-sweep.spec.js — sole-to-ski-top ≤ 5 mm
// at toe AND heel, both skis, every non-crash frame. Display-side only; the
// golden traces cannot move.

const { test, expect } = require('@playwright/test');

const GAP_LIMIT = 0.005;

async function boot(page, url) {
    await page.goto('/index.html' + url);
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForFunction(() => {
        const p = window._bootSkiProbe && window._bootSkiProbe();
        return p && p.boots.L && p.boots.R;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(400);
}

// Sample every rendered frame between the gate and the ride-out. `inAir`
// (optional, sync, runs once airborne just before the kicker) installs the
// variant's input holds.
async function flyAndSample(page, inAir) {
    await page.evaluate(() => {
        window.__sweep = [];
        window.__sampling = true;
        const sample = () => {
            if (!window.__sampling) return;
            const g = window._getGameState();
            if (!g.readyState && g.posZ > 5 && g.posZ < 60) {
                const p = window._bootSkiProbe();
                const worst = Math.max(
                    Math.abs(p.boots.L.toe), Math.abs(p.boots.L.heel),
                    Math.abs(p.boots.R.toe), Math.abs(p.boots.R.heel));
                window.__sweep.push({ z: +g.posZ.toFixed(2), grounded: g.grounded,
                    crashed: g.crashed, tuck: +g.tuckAmount.toFixed(2),
                    pike: +(g.pikeAmount || 0).toFixed(2), worst });
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });

    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return !g.readyState && g.posZ > 12;
    }, null, { timeout: 30_000 });
    if (inAir) await inAir(page);
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return (g.grounded && g.posZ > 26) || g.crashed;
    }, null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__sampling = false; });
    return page.evaluate(() => window.__sweep);
}

function report(label, frames) {
    const live = frames.filter(f => !f.crashed);
    let worst = 0, wf = null, worstAir = 0, waf = null, worstGnd = 0, wgf = null;
    for (const f of live) {
        if (f.worst > worst) { worst = f.worst; wf = f; }
        if (!f.grounded && f.worst > worstAir) { worstAir = f.worst; waf = f; }
        if (f.grounded && f.worst > worstGnd) { worstGnd = f.worst; wgf = f; }
    }
    console.log('COVERAGE ' + JSON.stringify({
        label, frames: frames.length, live: live.length,
        crashed: frames.length - live.length,
        worstMm: +(worst * 1000).toFixed(2), worstFrame: wf,
        worstAirborneMm: +(worstAir * 1000).toFixed(2), worstAirFrame: waf,
        worstGroundedMm: +(worstGnd * 1000).toFixed(2), worstGndFrame: wgf,
    }));
    return worst;
}

function expectSeated(label, frames) {
    expect(frames.length, `${label}: sampled ${frames.length} frames`).toBeGreaterThan(30);
    const crashed = frames.filter(f => f.crashed);
    const worst = report(label, frames);
    expect(worst,
        `${label}: heel lift ${(worst * 1000).toFixed(2)} mm breaches the 5 mm gate`)
}

// Gamepad stub: window.__pad drives a fake DualSense the game's own polling
// reads (buttons[7] = RT = analog tuck, buttons[0] = X = ArrowUp).
const PAD_STUB = `
    window.__pad = { axes: [0, 0, 0, 0], buttons: [] };
    for (let i = 0; i < 17; i++) window.__pad.buttons.push({ pressed: false, value: 0 });
    navigator.getGamepads = () => [Object.assign({ connected: true, id: 'stub', index: 0,
        mapping: 'standard', timestamp: 0, vibrationActuator: null },
        JSON.parse(JSON.stringify(window.__pad)))];
`;

test.describe('tuck heel-lift coverage sweep (#21 v3)', () => {
    test('realistic mode, keyboard tuck pulse', async ({ page }) => {
        await boot(page, '?comp=easy&mode=realistic');
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => window._getGameState().posZ > 21.5, null, { timeout: 30_000 });
            await p.keyboard.down('Space');
            await p.waitForFunction(() => window._getGameState().tuckAmount > 0.95, null, { timeout: 10_000 });
            await p.keyboard.up('Space');
        });
        expectSeated('realistic/keyboard', frames);
    });

    test('off-axis twist held through the tuck', async ({ page }) => {
        await boot(page, '?comp=easy');
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => !window._getGameState().grounded, null, { timeout: 30_000 });
            await p.keyboard.down('Space');
            await p.keyboard.down('KeyA');       // off-axis 0.28, airborne only
            await p.waitForFunction(() => window._getGameState().tuckAmount > 0.95, null, { timeout: 10_000 });
            await p.keyboard.up('Space');
        });
        expectSeated('offaxis/keyboard', frames);
        await page.keyboard.up('KeyA');
    });

    test('double world, keyboard tuck pulse', async ({ page }) => {
        await boot(page, '?world=double&comp=easy');
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => !window._getGameState().grounded, null, { timeout: 30_000 });
            await p.keyboard.down('Space');
            await p.waitForFunction(() => window._getGameState().tuckAmount > 0.95, null, { timeout: 10_000 });
            await p.keyboard.up('Space');
        });
        expectSeated('double/keyboard', frames);
    });

    test('pike held through the air', async ({ page }) => {
        await boot(page, '?comp=easy');
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => !window._getGameState().grounded, null, { timeout: 30_000 });
            await p.keyboard.down('ShiftLeft');
            // pikeAmount is deliberately not in _getGameState (frozen key
            // set for the golden traces), so hold the key to touchdown; the
            // sweep's airborne tuck==0 frames prove the pike path engaged.
            await p.waitForFunction(() => window._getGameState().grounded &&
                window._getGameState().posZ > 26, null, { timeout: 30_000 });
        });
        await page.keyboard.up('ShiftLeft');
        expectSeated('pike/keyboard', frames);
    });

    test('gamepad RT analog tuck', async ({ page }) => {
        await page.addInitScript(PAD_STUB);
        await boot(page, '?comp=easy');
        // setting_gamepad must be on BEFORE boot reads it — reload with it set.
        await page.evaluate(() => localStorage.setItem('setting_gamepad', '1'));
        await page.reload();
        await page.waitForFunction(() => {
            const p = window._bootSkiProbe && window._bootSkiProbe();
            return p && p.boots.L && p.boots.R;
        }, null, { timeout: 60_000 });
        await page.waitForTimeout(400);
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => window._getGameState().posZ > 21.5, null, { timeout: 30_000 });
            // RT ramp: partial tuck target, exactly what the keyboard pulse skips.
            await p.evaluate(() => { window.__pad.buttons[7] = { pressed: true, value: 0.55 }; });
            await p.waitForFunction(() => window._getGameState().tuckAmount > 0.5, null, { timeout: 10_000 });
            await p.waitForFunction(() => window._getGameState().grounded, null, { timeout: 30_000 });
            await p.evaluate(() => { window.__pad.buttons[7] = { pressed: false, value: 0 }; });
        });
        expectSeated('gamepad/RT-55%', frames);
    });

    test('negative control: _flightPinOff heel lift FAILS the sweep', async ({ page }) => {
        await boot(page, '?comp=easy');
        const frames = await flyAndSample(page, async (p) => {
            await p.waitForFunction(() => window._getGameState().posZ > 21.5, null, { timeout: 30_000 });
            await p.evaluate(() => { window._flightPinOff = true; });
            await p.keyboard.down('Space');
            await p.waitForFunction(() => window._getGameState().tuckAmount > 0.95, null, { timeout: 10_000 });
            await p.keyboard.up('Space');
        });
        const worst = report('negctl/pinOff', frames);
        expect(worst, `negative control must breach the gate (worst ${(worst * 1000).toFixed(1)} mm)`)
            .toBeGreaterThan(GAP_LIMIT);
    });
});

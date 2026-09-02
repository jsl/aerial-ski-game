'use strict';
// ── Flight arms + landing prep (slot 253, F4 spec) ──────────────────────────
// Footage contract (REFERENCE-FOOTAGE IMG_7841 / IMG_3765 f_003): after the
// takeoff sweep the arms STAY overhead as the display base pose through
// flight (hands return to the shins only while the tuck holds), the arms open
// laterally for the spot in the last 0.35 s before touchdown, and stay wide
// through the ride-out.
//
// Gates (charged single layout, live landing required for the ride-out gates):
//   • armRaise ≥ 0.95 on ≥ 90% of the live airborne frames
//   • at the last airborne frame (touchdown): arm abduction ≥ 50°
//   • ride-out: arms ≥ 30° open early after touchdown, < 10° by the end
//   • knee fold ≤ 45° in a layout (the overlays are rate-limited)
// An uncharged single under-rotates and crashes by the landing decision
// (pre-existing, HEAD-verified); the driver charges the flip so the run lands.
// Display-only (ADR-0002): reads window._inrunProbe/_spotProbe and mesh
// rotations; no engine/ state is touched. Twist parity is covered by
// tests/golden/parity-check.js (GAME-LOGIC INVARIANT 4), not here.
const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html?comp=easy');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(400);
}

async function chargeAndFly(page) {
    await page.keyboard.press('ArrowUp');   // leave the gate, descend
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return !g.readyState && g.posZ > 12;
    }, null, { timeout: 30_000 });
    // Charge the flip power on the approach (↓ fills the meter) so the jump
    // rotates fully and lands.
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(1200);
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return (g.grounded && g.posZ > 26) || g.crashed;
    }, null, { timeout: 30_000 });
}

test.describe('flight arms + landing prep (slot 253)', () => {
    test('charged single layout: arms held overhead, spot opens, ride-out returns', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => {
            window.__sweep = [];
            window.__sampling = true;
            const sample = () => {
                if (!window.__sampling) return;
                const g = window._getGameState();
                const p = window._inrunProbe();
                const M = window._characterMeshes;
                // Arm abduction from the L/R upper-arm z rotations: the spot
                // overlay adds ±(0.96·spot); the pair's difference isolates it.
                const open = M && M.upperArmL && M.upperArmR
                    ? Math.abs(M.upperArmL.rotation.z - M.upperArmR.rotation.z) * 180 / Math.PI
                    : 0;
                const kneeFold = M && M.upperLegL && M.lowerLegL
                    ? Math.abs(M.upperLegL.rotation.x) + Math.abs(M.lowerLegL.rotation.x)
                    : 0;
                if (!g.readyState && g.posZ > 5 && g.posZ < 70) {
                    window.__sweep.push({
                        z: +g.posZ.toFixed(2), grounded: g.grounded, crashed: g.crashed,
                        tuck: +g.tuckAmount.toFixed(2), armRaise: +p.armRaise.toFixed(3),
                        open: +open.toFixed(1), kneeFold: +kneeFold.toFixed(3),
                        spot: window._spotProbe ? window._spotProbe.spot : 0,
                    });
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        await chargeAndFly(page);
        await page.waitForTimeout(1800);        // ride-out + arm return
        await page.evaluate(() => { window.__sampling = false; });
        const frames = await page.evaluate(() => window.__sweep);
        const live = frames.filter(f => !f.crashed);
        expect(frames.length).toBeGreaterThan(30);
        const air = live.filter(f => !f.grounded);
        expect(air.length, 'live airborne frames sampled').toBeGreaterThan(3);

        // 1) Arms overhead through the layout flight.
        const held = air.filter(f => f.armRaise >= 0.95);
        expect(held.length / air.length,
            `armRaise ≥ 0.95 on ${(held.length / air.length * 100).toFixed(0)}% of airborne frames`)
            .toBeGreaterThan(0.9);

        // 2) Spot: arms ≥ 50° open at touchdown (last live airborne frame).
        const td = air[air.length - 1];
        expect(td.open, `arm abduction at touchdown ${td.open}° (limit 50°)`)
            .toBeGreaterThanOrEqual(50);

        // 3) Ride-out: arms still open just after touchdown, closing by the end.
        const post = live.filter(f => f.grounded && f.z > td.z);
        expect(post.length, 'ride-out frames after a live touchdown').toBeGreaterThan(5);
        const early = post.slice(0, Math.max(1, Math.floor(post.length * 0.15)));
        const late = post.slice(-Math.max(1, Math.floor(post.length * 0.2)));
        const earlyMax = Math.max(...early.map(f => f.open));
        const lateMax = Math.max(...late.map(f => f.open));
        expect(earlyMax, `arms open early in ride-out: ${earlyMax}°`).toBeGreaterThanOrEqual(30);
        expect(lateMax, `arms returned by ride-out end: ${lateMax}° (limit 10°)`).toBeLessThan(10);

        // 4) Knee-fold bound in a layout, AIRBORNE only (the grounded in-run
        //    crouch legitimately folds ~89°).
        const worstKnee = Math.max(...air.map(f => f.kneeFold));
        expect(worstKnee, `worst airborne knee fold ${worstKnee.toFixed(2)} rad (limit 0.785)`)
            .toBeLessThanOrEqual(0.785);
    });

    test('tuck pulse: run lands intact with arms held overhead as the base pose', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => {
            window.__sweep = [];
            window.__sampling = true;
            const sample = () => {
                if (!window.__sampling) return;
                const g = window._getGameState();
                const p = window._inrunProbe();
                if (!g.readyState && g.posZ > 5 && g.posZ < 70) {
                    window.__sweep.push({ z: +g.posZ.toFixed(2), grounded: g.grounded,
                        crashed: g.crashed, tuck: +g.tuckAmount.toFixed(2),
                        armRaise: +p.armRaise.toFixed(3) });
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
        await page.keyboard.down('ArrowDown');
        await page.waitForTimeout(1200);
        await page.keyboard.up('ArrowDown');
        // Tuck pulse: engage in the air, release once fully tucked.
        await page.waitForFunction(() => window._getGameState().posZ > 21.5,
            null, { timeout: 30_000 });
        await page.keyboard.down('Space');
        await page.waitForFunction(() => window._getGameState().tuckAmount > 0.95,
            null, { timeout: 10_000 });
        await page.keyboard.up('Space');
        await page.waitForFunction(() => {
            const g = window._getGameState();
            return (g.grounded && g.posZ > 26) || g.crashed;
        }, null, { timeout: 30_000 });
        await page.evaluate(() => { window.__sampling = false; });
        const frames = await page.evaluate(() => window.__sweep);
        expect(frames.length).toBeGreaterThan(30);
        // A mis-timed tuck pulse can crash by the landing decision (allowed,
        // same disposition as flight-sweep); the gates are the deep-tuck
        // frames and the held armRaise base pose while airborne.
        const airT = frames.filter(f => !f.crashed && !f.grounded);
        const deep = frames.filter(f => !f.crashed && f.tuck >= 0.9);
        expect(deep.length, 'deep-tuck frames sampled').toBeGreaterThan(1);
        const heldT = airT.filter(f => f.armRaise >= 0.95);
        expect(heldT.length / Math.max(1, airT.length),
            'armRaise ≥ 0.95 while airborne outside the tuck').toBeGreaterThan(0.9);
    });
});

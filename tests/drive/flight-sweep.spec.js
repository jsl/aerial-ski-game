'use strict';
// ── Flight boot–ski sweep: per-frame affixation through the whole air phase ─
// NEXT #21 (author, 2026-08-31 amended): "boots FIRMLY affixed toe AND heel to
// the skis throughout (the per-frame flight sweep gate stands); heel lift =
// failure; skis eject only on crash."
//
// What was measured before this gate existed: the in-run contact spec
// (inrun-contact.spec.js) sampled rest, gate crouch, hop turn and mid-in-run,
// but its "and in flight" claim was comment-only — no test ever sampled a
// frame between takeoff and touchdown. The boot–ski pin seats the sole
// unconditionally every frame (crash excepted), with the cuff lean weight
// zeroed airborne (armRaise = 1 in flight), so the shin rides the ski plane
// through every pose blend. This spec proves it per rendered frame.
//
// Gates, every sampled frame from the kicker transition to the ride-out:
//   • sole-to-ski-top ≤ 5 mm at toe AND heel, both skis (the author's number)
//   • airborne frames: |shin rx − ski pitch| ≤ 2° (a binding clamps the boot
//     to the ski; zero cuff lean in flight — nothing to flex against)
// Negative control: window._flightPinOff skips the pin airborne and lifts the
// shins 30 mm (the historic heel-lift defect); the same sweep must FAIL.
//
// Display-side only (ADR-0002): reads window._bootSkiProbe(), never touches
// the physics state; golden traces cannot move.
const { test, expect } = require('@playwright/test');

const GAP_LIMIT = 0.005;   // 5 mm, author spec (toe AND heel, both skis)
const PITCH_LIMIT = 2 * Math.PI / 180;

async function boot(page) {
    await page.goto('/index.html?comp=easy');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
    await page.waitForFunction(() => {
        const p = window._bootSkiProbe && window._bootSkiProbe();
        return p && p.boots.L && p.boots.R;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(400);
}

// Start the run, tuck through the air, and sample every rendered frame from
// just before the kicker to the ride-out. Returns { frames, tuckMetrics }.
async function flyAndSample(page) {
    await page.evaluate(() => {
        window.__sweep = [];
        window.__sampling = true;
        window.__tuckMetrics = null;
        const sample = () => {
            if (!window.__sampling) return;
            const g = window._getGameState();
            if (!g.readyState && g.posZ > 5 && g.posZ < 60) {
                const p = window._bootSkiProbe();
                const worst = Math.max(
                    Math.abs(p.boots.L.toe), Math.abs(p.boots.L.heel),
                    Math.abs(p.boots.R.toe), Math.abs(p.boots.R.heel));
                const pitch = Math.max(
                    Math.abs(p.boots.L.pitchDelta), Math.abs(p.boots.R.pitchDelta));
                window.__sweep.push({ z: +g.posZ.toFixed(2), grounded: g.grounded, crashed: g.crashed,
                                      tuck: +g.tuckAmount.toFixed(2),
                                      worst, pitch });
                // One knee-to-chest composition reading at peak tuck (the
                // author's tuck reference is the acceptance test; reported,
                // not gated here — the eye rules on the composition).
                if (!g.grounded && g.tuckAmount > 0.9 && !window.__tuckMetrics) {
                    const M = window._characterMeshes;
                    const t = M.torso, ul = M.upperLegL;
                    const tc = Math.cos(t.rotation.x), ts = Math.sin(t.rotation.x);
                    const chest = [t.position.y + 0.275 * tc, t.position.z + 0.275 * ts];
                    const uc = Math.cos(ul.rotation.x), us = Math.sin(ul.rotation.x);
                    const knee = [ul.position.y - 0.18 * uc, ul.position.z - 0.18 * us];
                    window.__tuckMetrics = {
                        kneeToChest: +Math.hypot(chest[0] - knee[0], chest[1] - knee[1]).toFixed(3),
                        torsoRxDeg: +(t.rotation.x * 180 / Math.PI).toFixed(1),
                        kneeRxDeg: +(ul.rotation.x * 180 / Math.PI).toFixed(1),
                    };
                }
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });

    await page.keyboard.press('ArrowUp');           // leave the gate, descend
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return !g.readyState && g.posZ > 12;
    }, null, { timeout: 30_000 });
    // A tuck PULSE: engage in the air, release once fully tucked. The sweep
    // then covers the tuck blend-up, the deep tuck AND the blend-down before
    // touchdown — the mid-blend frames are where the sole used to lift.
    await page.waitForFunction(() => window._getGameState().posZ > 21.5,
        null, { timeout: 30_000 });
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount > 0.95,
        null, { timeout: 10_000 });
    await page.keyboard.up('Space');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return (g.grounded && g.posZ > 26) || g.crashed;   // landed or crashed
    }, null, { timeout: 30_000 });
    await page.waitForTimeout(500);                 // a few ride-out frames
    await page.evaluate(() => { window.__sampling = false; });

    return page.evaluate(() => ({
        frames: window.__sweep,
        tuckMetrics: window.__tuckMetrics,
    }));
}

function expectSeated(frames, label, airbornePitchToo) {
    expect(frames.length, `${label}: sampled ${frames.length} frames (need > 30)`).toBeGreaterThan(30);
    const airborne = frames.filter(f => !f.grounded);
    expect(airborne.length, `${label}: ${airborne.length} airborne frames`).toBeGreaterThan(8);
    // Crash is the allowed violation (skis eject); count and exclude.
    const crashed = frames.filter(f => f.crashed);
    const live = frames.filter(f => !f.crashed);
    expect(live.length,
        `${label}: ${live.length} live frames, ${crashed.length} crashed — first: ${JSON.stringify(frames[0] || null)}`)
        .toBeGreaterThan(10);
    let worstGap = 0, worstGapFrame = null, worstPitch = 0, worstPitchFrame = null;
    for (const f of live) {
        if (f.worst > worstGap || !worstGapFrame) { worstGap = f.worst; worstGapFrame = f; }
        if (airbornePitchToo && !f.grounded && f.pitch > worstPitch) {
            worstPitch = f.pitch; worstPitchFrame = f;
        }
    }
    expect(worstGap,
        `${label}: worst sole-to-ski-top ${(worstGap * 1000).toFixed(2)} mm at z=${worstGapFrame.z} (limit 5 mm)`)
        .toBeLessThanOrEqual(GAP_LIMIT);
    if (airbornePitchToo) {
        expect(worstPitch,
            `${label}: worst airborne |shin−ski| pitch ${(worstPitch * 180 / Math.PI).toFixed(2)}° (limit 2°)`)
            .toBeLessThanOrEqual(PITCH_LIMIT);
    }
    return { worstGap, worstPitch, n: frames.length, airborne: airborne.length, crashed: crashed.length };
}

test.describe('flight boot–ski sweep (#21)', () => {
    test('full jump: toe AND heel ≤5 mm and ski pitch every airborne frame', async ({ page }) => {
        await boot(page);
        const { frames, tuckMetrics } = await flyAndSample(page);
        const stats = expectSeated(frames, 'flight sweep', true);
        console.log('flight sweep:', JSON.stringify({ stats, tuckMetrics }));
    });

    test('negative control: _flightPinOff heel lift FAILS the sweep', async ({ page }) => {
        await boot(page);
        await page.evaluate(() => { window._flightPinOff = true; });
        const { frames } = await flyAndSample(page);
        const airborne = frames.filter(f => !f.grounded);
        expect(airborne.length, 'negative control: airborne frames sampled').toBeGreaterThan(20);
        const worst = Math.max.apply(null, frames.map(f => f.worst));
        expect(worst,
            `negative control: injected heel lift must breach the gate (worst ${(worst * 1000).toFixed(1)} mm)`)
            .toBeGreaterThan(GAP_LIMIT);
    });
});

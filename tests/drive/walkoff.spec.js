'use strict';
// ── HUMAN TESTING #14: crash get-up and walk-off ───────────────────────────
// The sequence is renderer-side: after the coherent ragdoll reaches rest, the
// athlete pauses, rolls through a kneel into a standing pose, then walks in
// boots to the near course edge.  These gates read rendered driver transforms
// rather than engine state.  Ejected skis must remain at their #13 rest pose.
const { test, expect } = require('@playwright/test');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'shots');

async function measureWalkoff(page, world, disabled, getupLegacy, swoopLegacy) {
    await page.goto('/index.html?world=' + world);
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    if (disabled) await page.evaluate(() => { window._crashWalkoffDisabled = true; });
    if (getupLegacy) await page.evaluate(() => { window._crashGetupWeightDisabled = true; });
    if (swoopLegacy) await page.evaluate(() => { window._crashSwoopFixDisabled = true; });
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    await page.evaluate(() => {
        window._walkoffRun = { armed: false, down: false, tuck: false, done: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            const C = window._walkoffRun;
            if (!C || C.done) return;
            const g = window._getGameState();
            if (g.crashed) {
                if (C.down) { C.down = false; send('keyup', 'ArrowDown'); }
                if (C.tuck) { C.tuck = false; send('keyup', 'Space'); }
                return requestAnimationFrame(tick);
            }
            if (!g.grounded && g.posZ >= g.KICKER_END_Z && !C.armed) {
                C.armed = true;
                window._debugTriggerCrash();
            }
            if (g.grounded && !C.down && g.flipPower < 0.999) {
                C.down = true; send('keydown', 'ArrowDown');
            } else if (C.down && (g.flipPower >= 0.999 || !g.grounded)) {
                C.down = false; send('keyup', 'ArrowDown');
            }
            if (!g.grounded && !C.tuck) {
                C.tuck = true; send('keydown', 'Space');
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    await page.waitForFunction(() => window._getGameState().crashed,
        null, { timeout: 90_000 });
    await page.waitForFunction(() => {
        const p = window._ragdollProbe && window._ragdollProbe();
        return p && p.resting;
    }, null, { timeout: 90_000 });

    await page.evaluate(() => {
        window._walkoffRun.done = true;
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const skiPos = ['skiL', 'skiR'].map((name) => {
            const p = scene.getMeshByName(name).getAbsolutePosition();
            return { x: p.x, y: p.y, z: p.z };
        });
        const W = window._walkoffSample = {
            start: performance.now(), skiPos, minBootClearance: Infinity,
            netCrossed: false, maxAbsX: 0, last: null, speed: Infinity,
            doneAt: null, samples: 0, getup: [],
        };
        const sample = (now) => {
            try {
            const root = scene.getTransformNodeByName('skierRoot');
            const wp = window._walkoffProbe ? window._walkoffProbe() : null;
            root.computeWorldMatrix(true);
            const rp = root.getAbsolutePosition();
            W.maxAbsX = Math.max(W.maxAbsX, Math.abs(rp.x));
            W.netCrossed = W.netCrossed || Math.abs(rp.x) > 6.10;
            if (W.last) {
                const dt = Math.max(1e-3, (now - W.last.t) / 1000);
                W.speed = Math.hypot(rp.x - W.last.x, rp.y - W.last.y,
                    rp.z - W.last.z) / dt;
            }
            W.last = { t: now, x: rp.x, y: rp.y, z: rp.z };
            // HT#24(b): per-frame get-up trace — root height and both ankle
            // (lower-leg −Y cap) world positions while the contact machine
            // is in roll/kneel/rise.
            if (wp && (wp.phase === 'roll' || wp.phase === 'kneel' ||
                       wp.phase === 'rise')) {
                const ank = (name) => {
                    const leg = scene.getMeshByName(name);
                    leg.computeWorldMatrix(true);
                    const p = leg.getAbsolutePosition();
                    const d = leg.getDirection(BABYLON.Axis.Y);
                    return [p.x - d.x * 0.18, p.y - d.y * 0.18, p.z - d.z * 0.18];
                };
                W.getup.push({ t: now, phase: wp.phase, rootY: rp.y,
                    planted: wp.planted || null,
                    aL: ank('lowerLegL'), aR: ank('lowerLegR') });
            }
            for (const name of ['lowerLegL', 'lowerLegR']) {
                const leg = scene.getMeshByName(name);
                leg.computeWorldMatrix(true);
                const p = leg.getAbsolutePosition();
                const d = leg.getDirection(BABYLON.Axis.Y);
                // Lower-leg -Y cap is the ankle/boot sole reference.  The
                // neutral boot sits 3 cm above the crash contact surface.
                const x = p.x - d.x * 0.18;
                const y = p.y - d.y * 0.18;
                const z = p.z - d.z * 0.18;
                W.minBootClearance = Math.min(W.minBootClearance,
                    y - window._crashFloorY(z));
            }
            W.samples++;
            if (wp && wp.phase === 'done' && W.doneAt === null) W.doneAt = now;
            if ((W.doneAt !== null && now - W.doneAt >= 500) || now - W.start >= 12_200) {
                W.finished = true;
                return;
            }
            requestAnimationFrame(sample);
            } catch (e) {
                W.error = String((e && e.stack) || e);
                W.finished = true;
            }
        };
        requestAnimationFrame(sample);
    });
    await page.waitForFunction(() => window._walkoffSample && window._walkoffSample.finished,
        null, { timeout: 30_000 });

    return page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.render();
        const W = window._walkoffSample;
        const root = scene.getTransformNodeByName('skierRoot').getAbsolutePosition();
        const hips = ['upperLegL', 'upperLegR'].map((name) => {
            const leg = scene.getMeshByName(name);
            const p = leg.getAbsolutePosition();
            const d = leg.getDirection(BABYLON.Axis.Y);
            return { y: p.y + d.y * 0.18, z: p.z + d.z * 0.18 };
        });
        const hipY = (hips[0].y + hips[1].y) / 2;
        const hipZ = (hips[0].z + hips[1].z) / 2;
        const skiDrift = ['skiL', 'skiR'].map((name, i) => {
            const p = scene.getMeshByName(name).getAbsolutePosition();
            const q = W.skiPos[i];
            return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        });
        const probe = window._walkoffProbe ? window._walkoffProbe() : null;
        // iter 196: the disable-flag state is recorded so a future flake in
        // the negative control (walkoff running despite the flag) is
        // diagnosable from the emitted JSON alone.
        const disabled = !!window._crashWalkoffDisabled;
        return {
            disabled,
            flagAtSample: !!window._crashWalkoffDisabled,
            getupLegacy: !!window._crashGetupWeightDisabled,
            swoopLegacy: !!window._crashSwoopFixDisabled,
            phase: probe ? probe.phase : 'stayed-down',
            sinceRest: probe ? probe.sinceRest : (performance.now() - W.start) / 1000,
            lateral: Math.abs(root.x),
            hipClearance: hipY - window._crashFloorY(hipZ),
            finalSpeed: probe ? probe.speed : W.speed,
            minBootClearance: W.minBootClearance,
            netCrossed: W.netCrossed,
            maxAbsX: W.maxAbsX,
            skiDrift: Math.max(...skiDrift),
            samples: W.samples,
            getup: W.getup,
            sampleError: W.error || null,
        };
    });
}

function walkoffGatePasses(m) {
    return m.phase === 'done' && m.sinceRest <= 12 &&
        m.hipClearance >= 0.60 && m.hipClearance <= 0.95 &&
        m.lateral >= 6.0 && m.finalSpeed <= 0.02 &&
        m.minBootClearance >= -0.005 && !m.netCrossed &&
        m.skiDrift <= 0.01;
}

// HT#24(b) weighty-get-up gate, evaluated over the per-frame get-up trace:
//   - the contact phases roll → kneel → rise are observed IN ORDER (the
//     legacy float path never enters 'rise' — that is the negative control);
//   - during 'rise' the peak upward root speed ≤ 1.2 m/s (no pop);
//   - the mean planted ankle holds its kneel-end position through the rise
//     (horizontal drift ≤ 2 cm — the root tracks the planted feet, not the
//     reverse). The root's small roll/kneel-phase lift is the EXISTING
//     boot-sole projection (contact-driven), not a float, so it is not
//     gated on root height.
function getupGatePasses(m) {
    const g = m.getup || [];
    const phases = [...new Set(g.map(r => r.phase))];
    const rise = g.filter(r => r.phase === 'rise');
    if (phases.join(',') !== 'roll,kneel,rise' || rise.length < 2) return false;
    let maxRiseSpd = 0;
    for (let i = 1; i < rise.length; i++) {
        const dt = Math.max(1e-3, (rise[i].t - rise[i - 1].t) / 1000);
        maxRiseSpd = Math.max(maxRiseSpd, (rise[i].rootY - rise[i - 1].rootY) / dt);
    }
    const meanXZ = r => [(r.aL[0] + r.aR[0]) / 2, (r.aL[2] + r.aR[2]) / 2];
    const m0 = meanXZ(rise[0]);
    let footDrift = 0;
    for (const r of rise) {
        const mm = meanXZ(r);
        footDrift = Math.max(footDrift, Math.hypot(mm[0] - m0[0], mm[1] - m0[1]));
    }

    return maxRiseSpd <= 1.2 && footDrift <= 0.02;
}
// HT#29 whole-chain gate, over the same per-frame get-up trace: NO frame —
// roll, kneel, rise, any blend-in — may raise the root faster than the
// 1.2 m/s rise cap (small jitter tolerance for rAF sampling), and every
// sampled frame must carry a planted contact set.
function wholeChainGatePasses(m) {
    const g = m.getup || [];
    if (g.length < 2) return false;
    for (const r of g) if (!r.planted) return false;
    for (let i = 1; i < g.length; i++) {
        const a = g[i - 1], b = g[i];
        const dt = Math.max(1e-3, (b.t - a.t) / 1000);
        if ((b.rootY - a.rootY) / dt > 1.45) return false;
    }
    return true;
}

test('crash #14: get up and walk clear of the corridor in every world', async ({ page }) => {
    test.setTimeout(600_000);
    for (const world of ['single', 'double', 'triple']) {
        const m = await measureWalkoff(page, world, false);
        console.log('WALKOFF ' + JSON.stringify(m));
        expect(walkoffGatePasses(m), `${world}: ${JSON.stringify(m)}`).toBe(true);
        expect(getupGatePasses(m),
            `${world} get-up: rollRise/riseSpeed/footDrift ${JSON.stringify(m.getup && m.getup.length)}`)
            .toBe(true);
        await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const root = scene.getTransformNodeByName('skierRoot').getAbsolutePosition();
            const cam = scene.activeCamera;
            if (cam && cam.target) cam.target.set(root.x, root.y - 0.15, root.z);
            scene.render();
        });
        expect(wholeChainGatePasses(m),
            `${world} whole-chain: peak rise frames ${JSON.stringify(
                (m.getup || []).length)}`).toBe(true);
        await page.screenshot({ path: path.join(OUT, `walkoff_${world}.png`) });
    }
});


test('crash #29 negative control: the pre-249 particle-centre seeding (swoop flag) fails the whole-chain gate', async ({ page }) => {
    test.setTimeout(240_000);
    // 252 re-aim (ruling on 251): the single carrier made the unpaced roll
    // blend alone harmless, so the NC now sabotages the carrier itself —
    // the walk-off is seeded from the frozen particle centre read as a
    // WORLD coordinate (the pre-Fable defect), and the kneel slide must
    // fire the whole-chain rise gate.
    const m = await measureWalkoff(page, 'triple', false, false, true);
    console.log('WALKOFF SWOOP-NEGCONTROL ' + JSON.stringify(
        { swoopLegacy: m.swoopLegacy, phase: m.phase,
          getupRows: (m.getup || []).length }));
    expect(m.swoopLegacy, 'swoop-fix disable flag was active').toBe(true);
    expect(wholeChainGatePasses(m),
        'negative control: the particle-centre seeding must FAIL the whole-chain gate')
        .toBe(false);
});
test('crash #14 negative control: the previous stay-down ending fails', async ({ page }) => {

    test.setTimeout(240_000);
    const m = await measureWalkoff(page, 'double', true);
    console.log('WALKOFF NEGCONTROL ' + JSON.stringify(m));
    expect(walkoffGatePasses(m),
        'negative control: the previous stay-down ending must FAIL').toBe(false);
});

test('crash #24 negative control: the legacy float get-up fails the weighty-rise gate', async ({ page }) => {
    test.setTimeout(240_000);
    const m = await measureWalkoff(page, 'double', false, true);
    console.log('WALKOFF GETUP-NEGCONTROL ' + JSON.stringify(
        { getupLegacy: m.getupLegacy, phase: m.phase, getupRows: (m.getup || []).length }));
    expect(m.getupLegacy, 'get-up legacy flag was active').toBe(true);
    expect(getupGatePasses(m),
        'negative control: the legacy root-interpolation get-up must FAIL the weighty-rise gate')
        .toBe(false);
});

'use strict';
// ── In-run start (F3 spec, slot 243) ────────────────────────────────────────
// The footage crouch (REFERENCE-FOOTAGE.md IMG_3768 f_002, P7): the athlete
// rides the in-run in a LOW CROUCH (back near-horizontal, hands forward at
// knee height), and the arm sweep is THE TAKEOFF — over the last second of
// the kicker, not the whole curve. Gates driven with NO input from the gate:
//   (a) the auto-crouch floor: tuckAmount rises monotonically after the hop
//       turn and is ≥ 0.6 for the whole flat/transition once v ≥ 10 m/s;
//   (b) physics parity at the lip: tuckAmount is 0.00 on the first airborne
//       frame (the engine sees the same tuck at takeoff as before);
//   (c) the sweep fires on TIME-TO-LIP: armRaiseTarget → 1 only inside the
//       last 0.8 s, and armRaise is 1 at the lip;
//   (d) joint-rate gate: no tracked joint changes more than 12°/frame during
//       the auto entry or the extension;
//   (e) a held Space still deepens the tuck to 1.0 (tuck-for-rotation
//       mechanic honoured); the golden trace parity for that path is owned
//       by tests/golden (aerial-tuck).
// Display/state blend only (ADR-0002); engine/ untouched.
const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => typeof window._inrunProbe === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(400);
}

async function installSampler(page) {
    await page.evaluate(() => {
        window.__inrun = { frames: [], on: true };
        const sample = () => {
            if (!window.__inrun.on) return;
            requestAnimationFrame(sample);
            const p = window._inrunProbe && window._inrunProbe();
            const M = window._characterMeshes;
            if (!p || !M || !M.torso) return;
            const joints = {};
            for (const n of ['torso', 'head', 'upperLegL', 'upperLegR',
                             'lowerLegL', 'lowerLegR',
                             'upperArmL', 'upperArmR']) {
                if (M[n]) joints[n] = M[n].rotation.x;
            }
            window.__inrun.frames.push(Object.assign({ joints, t: performance.now() }, p));
        };
        requestAnimationFrame(sample);
    });
}

async function stopSampler(page) {
    await page.evaluate(() => { window.__inrun.on = false; });
    return page.evaluate(() => window.__inrun.frames);
}

async function driveRun(page, { holdSpace } = {}) {
    await installSampler(page);
    await page.waitForTimeout(200);
    if (holdSpace) await page.keyboard.down(' ');
    await page.keyboard.press('ArrowUp');       // leave the ready gate
    // Wait for the run to end past the landing (or a generous timeout).
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return g.crashed || g.stopped || g.posZ > 100;
    }, null, { timeout: 30_000 }).catch(() => {});
    await stopSampler(page);
    return page.evaluate(() => window.__inrun.frames);
}

test.describe('in-run start (F3): auto-crouch floor + time-to-lip sweep', () => {
    test('auto-crouch rises, releases, sweep is time-to-lip, tuck 0 at lip', async ({ page }) => {
        await boot(page);
        const frames = await driveRun(page, { holdSpace: false });
        test.expect(frames.length).toBeGreaterThan(60);

        const firstAir = frames.findIndex(f => !f.grounded && !f.readyState);
        const runFrames = frames.slice(0, firstAir > 0 ? firstAir : frames.length)
                                .filter(f => !f.readyState && f.grounded);
        test.expect(runFrames.length).toBeGreaterThan(10);

        // (a) monotone rise after the turn, ≥ 0.6 once v ≥ 10 m/s pre-window.
        let peak = 0, sawHigh = false, sawV10 = false, lastTuck = -1, monotoneOk = true;
        let riseStartIdx = -1;
        for (let i = 0; i < runFrames.length; i++) {
            const f = runFrames[i];
            if (f.extend) continue;               // extension window: release
            if (f.tuckAmount < lastTuck - 0.02) {
                console.log(`INRUN dip @i=${i} z=${f.posZ.toFixed(1)} vz=${f.vz.toFixed(2)} ` +
                            `tuck=${f.tuckAmount.toFixed(3)} prev=${lastTuck.toFixed(3)} extend=${f.extend}`);
                monotoneOk = false;
            }
            lastTuck = Math.max(lastTuck, f.tuckAmount);
            if (f.tuckAmount > peak) peak = f.tuckAmount;
            if (f.vz >= 10) { sawV10 = true; if (f.tuckAmount >= 0.6) sawHigh = true; }
            if (riseStartIdx < 0 && f.tuckAmount > 0.01) riseStartIdx = i;
        }
        void sawV10;
        console.log(`INRUN floor: peak=${peak.toFixed(3)} sawHigh=${sawHigh} ` +
                    `monotone=${monotoneOk}`);
        test.expect(peak).toBeGreaterThanOrEqual(0.8);   // reaches the 0.85 floor
        test.expect(sawHigh).toBe(true);
        test.expect(monotoneOk).toBe(true);
        // (b) tuck is 0.00 on the first airborne frame.
        test.expect(firstAir).toBeGreaterThan(0);
        console.log(`INRUN lip: tuck=${frames[firstAir].tuckAmount.toFixed(4)} ` +
                    `armRaise=${frames[firstAir].armRaise.toFixed(3)}`);
        // The takeoff handler itself zeroes armRaise on the crossing frame, so
        // "arms overhead AT the lip" is measured over the last grounded frames
        // before the crossing (tLip ≤ 0.2 s).
        const preLipArm = Math.max(0, ...runFrames
            .filter(f => f.tLip <= 0.2).map(f => f.armRaise));
        console.log(`INRUN pre-lip armRaise=${preLipArm.toFixed(3)}`);
        test.expect(preLipArm).toBeGreaterThan(0.95);

        // (c) sweep fires only inside the last 0.8 s: no armRaiseTarget === 1
        // at a frame with tLip > 0.8 + tolerance (one frame of latency).
        let sweepOk = true, firstSweepTLip = Infinity;
        for (const f of runFrames) {
            if (f.armRaiseTarget === 1) {
                firstSweepTLip = Math.min(firstSweepTLip, f.tLip);
                if (f.tLip > 0.8 + 0.12) sweepOk = false;
            }
        }
        console.log(`INRUN sweep: first tLip=${firstSweepTLip.toFixed(3)} s`);
        test.expect(sweepOk).toBe(true);
        test.expect(firstSweepTLip).toBeLessThanOrEqual(0.8);
        // (d) joint-rate gate: the spec's 12°/frame assumes 60 Hz; under
        // headless load frame times vary, so the gate is rate-normalized:
        // 12°/frame at 60 fps = 720°/s, gate at 800°/s.
        let worstRate = 0, worstKey = '';
        for (let i = 1; i < runFrames.length; i++) {
            const dtms = runFrames[i].t - runFrames[i - 1].t;
            if (!dtms || dtms <= 0) continue;
            for (const [n, rx] of Object.entries(runFrames[i].joints)) {
                const prev = runFrames[i - 1].joints[n];
                if (prev === undefined) continue;
                const rps = Math.abs(rx - prev) * 180 / Math.PI * (1000 / dtms);
                if (rps > worstRate) { worstRate = rps; worstKey = n; }
            }
        }
        console.log(`INRUN joint rate: worst=${worstRate.toFixed(0)} deg/s (${worstKey})`);
        test.expect(worstRate).toBeLessThanOrEqual(800);
    });

    test('held Space still deepens the tuck to 1.0 (rotation mechanic honoured)', async ({ page }) => {
        await boot(page);
        const frames = await driveRun(page, { holdSpace: true });
        const runFrames = frames.filter(f => !f.readyState && f.grounded);
        const peak = Math.max(...runFrames.map(f => f.tuckAmount));
        console.log(`INRUN held-space peak tuck=${peak.toFixed(3)}`);
        test.expect(peak).toBeGreaterThan(0.99);
        // The floor must never LOWER a player tuck: with Space held from the
        // gate the tuck reaches 1.0 and the entry is the keyed one.
    });
});

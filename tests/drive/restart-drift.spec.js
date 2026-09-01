'use strict';
// ── HT#28: "R" restart drift (author, 2026-09-01) ────────────────────────────
// "when I used 'r' to restart several times, the athlete moves over to the
// right of the screen for starting position, and then takes off of an
// invisible jump on the right of the knoll."
//
// Root cause: the per-frame root update writes only position.y/z; position.x
// is owned by the crash display paths (ragdoll park → get-up walk-off, which
// parks the root at the B-net, |x| ≈ 6 m). The R reset never restored x, so
// each crash+R cycle carried the parked lateral offset into the next run's
// start position and takeoff point.
//
// Gate: crash once (walk-off completes → root parked at |x| ≈ 6 m), then
// R ×10 — the rendered start position must be byte-identical and on the
// corridor centre-line every time, and the takeoff point (first airborne
// frame past the kicker lip) must repeat within one frame of sampling jitter.
// Negative control: window._restartXFixDisabled restores the old behaviour —
// after the crash walk-off the first R must leave the start offset from the
// corridor centre (> 0.3 m), i.e. the gate discriminates.
const { test, expect } = require('@playwright/test');
test.setTimeout(300_000);

async function waitForBoot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
    await page.waitForTimeout(400);
}

// Drive one run into a crash and wait for the ragdoll to rest (same recipe
// as crash-ragdoll.spec.js: charge, crash-arm past the kicker, tuck).
async function crashOnce(page) {
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    await page.evaluate(() => {
        window._ht28Run = { armed: false, down: false, tuck: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            const C = window._ht28Run;
            if (!C || C.done) return;
            const g = window._getGameState();
            if (g.crashed) {
                if (C.down) { C.down = false; send('keyup', 'ArrowDown'); }
                if (C.tuck) { C.tuck = false; send('keyup', 'Space'); }
                return;
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
    await page.evaluate(() => { if (window._ht28Run) window._ht28Run.done = true; });
}

// Wait until the get-up walk-off has finished: the root is then parked at
// the B-net (|x| = 6 m) — the maximum drift the bug can hand to the next R.
async function awaitWalkoffDone(page) {
    await page.waitForFunction(() => {
        const p = window._walkoffProbe && window._walkoffProbe();
        return p && p.phase === 'done';
    }, null, { timeout: 60_000 });
}

// Rendered torso world position after one forced render.
async function torsoPos(page) {
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.render());
    return page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const p = scene.getMeshByName('torso').getAbsolutePosition();
        return { x: p.x, y: p.y, z: p.z };
    });
}

async function pressR(page) {
    await page.keyboard.press('r');
    await page.waitForFunction(() => window._getGameState().readyState === true,
        null, { timeout: 30_000 });
}

// Sample the start position, then launch and sample the first airborne
// (takeoff) torso position past the kicker lip. The takeoff sample's z
// carries up to one frame of sampling jitter (~1 cm at 60 fps), so the
// takeoff gate allows 0.02 m while the start position stays byte-identical.
async function sampleStartAndTakeoff(page) {
    await pressR(page);
    const start = await torsoPos(page);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return g.readyState === false && !g.grounded && g.posZ >= g.KICKER_END_Z;
    }, null, { timeout: 90_000 });
    const takeoff = await torsoPos(page);
    return { start, takeoff };
}

test('HT#28: crash + full walk-off, then R ×10 — start and takeoff identical every time', async ({ page }) => {
    await waitForBoot(page);
    await crashOnce(page);
    await awaitWalkoffDone(page);

    const samples = [];
    for (let i = 0; i < 10; i++) {
        samples.push(await sampleStartAndTakeoff(page));
    }
    const first = samples[0];
    for (let i = 1; i < samples.length; i++) {
        const s = samples[i];
        expect(Math.abs(s.start.x - first.start.x), `R#${i + 1} start x drifted`)
            .toBeLessThan(1e-6);
        expect(Math.abs(s.start.z - first.start.z), `R#${i + 1} start z drifted`)
            .toBeLessThan(1e-6);
        expect(Math.abs(s.takeoff.x - first.takeoff.x), `R#${i + 1} takeoff x drifted`)
            .toBeLessThan(0.02);
        expect(Math.abs(s.takeoff.z - first.takeoff.z), `R#${i + 1} takeoff z drifted`)
            .toBeLessThan(0.02);
    }
    // The start must be on the corridor centre-line (the drift was lateral).
    expect(Math.abs(first.start.x), 'start x must sit on the corridor centre-line')
        .toBeLessThan(0.05);
});

test('HT#28 negative control: with the fix disabled the post-walk-off R leaves a lateral start offset', async ({ page }) => {
    await waitForBoot(page);
    await page.evaluate(() => { window._restartXFixDisabled = true; });
    await crashOnce(page);
    await awaitWalkoffDone(page);
    await pressR(page);
    const start = await torsoPos(page);
    // The old build restarted wherever the walk-off parked the root (the
    // B-net, |x| ≈ 6 m) — the visible drift. Must NOT sit on the centre-line.
    expect(Math.abs(start.x), 'negative control: start x must be offset without the fix')
        .toBeGreaterThan(0.3);
});

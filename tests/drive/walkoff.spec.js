'use strict';
// ── HUMAN TESTING #14: crash get-up and walk-off ───────────────────────────
// The sequence is renderer-side: after the coherent ragdoll reaches rest, the
// athlete pauses, rolls through a kneel into a standing pose, then walks in
// boots to the near course edge.  These gates read rendered driver transforms
// rather than engine state.  Ejected skis must remain at their #13 rest pose.
const { test, expect } = require('@playwright/test');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'shots');

async function measureWalkoff(page, world, disabled) {
    await page.goto('/index.html?world=' + world);
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    if (disabled) await page.evaluate(() => { window._crashWalkoffDisabled = true; });
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
            doneAt: null, samples: 0,
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
        return {
            world: new URLSearchParams(location.search).get('world'),
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

test('crash #14: get up and walk clear of the corridor in every world', async ({ page }) => {
    test.setTimeout(600_000);
    for (const world of ['single', 'double', 'triple']) {
        const m = await measureWalkoff(page, world, false);
        console.log('WALKOFF ' + JSON.stringify(m));
        expect(walkoffGatePasses(m), `${world}: ${JSON.stringify(m)}`).toBe(true);
        await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const root = scene.getTransformNodeByName('skierRoot').getAbsolutePosition();
            const cam = scene.activeCamera;
            if (cam && cam.target) cam.target.set(root.x, root.y - 0.15, root.z);
            scene.render();
        });
        await page.screenshot({ path: path.join(OUT, `walkoff_${world}.png`) });
    }
});

test('crash #14 negative control: the previous stay-down ending fails', async ({ page }) => {
    test.setTimeout(240_000);
    const m = await measureWalkoff(page, 'double', true);
    console.log('WALKOFF NEGCONTROL ' + JSON.stringify(m));
    expect(walkoffGatePasses(m),
        'negative control: the previous stay-down ending must FAIL').toBe(false);
});

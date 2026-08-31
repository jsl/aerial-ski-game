'use strict';
// ── HUMAN TESTING #18: landing free-look view tilt ──────────────────────────
// At crash rest the terrain clamp correctly prevents a lower orbit. Continued
// upward pointer drag is therefore excess pitch demand: it must raise the orbit
// target smoothly until the kicker lip can be seen, without lowering the eye.
const { test, expect } = require('@playwright/test');

async function dragUp(page) {
    const box = await page.locator('#renderCanvas').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 95, { steps: 5 });
    await page.mouse.up();
}

async function settleCrash(page, world) {
    await page.goto('/index.html?world=' + world);
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 90_000 });
    // This gate projects world points; it does not inspect pixels. Keep the two
    // pickable terrain meshes and the runtime rig, but avoid spending SwiftShader
    // time on forest, dressing, particles, shadows and post-processing while the
    // deterministic crash runs to rest.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().setHardwareScalingLevel(4);
        for (const m of scene.meshes) {
            if (!/^(terrainCorridor|terrainSkirt)/.test(m.name || '')) m.isVisible = false;
        }
        for (const p of scene.particleSystems || []) p.stop();
        for (const l of scene.lights || []) l.setEnabled(false);
        try {
            scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
                'dof', window._freeLookCam());
        } catch (e) { /* optional rendering accelerator only */ }
    });
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    await page.evaluate(() => {
        window._tiltRun = { down: false, tuck: false, armed: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            const C = window._tiltRun;
            const g = window._getGameState();
            if (!C || g.crashed) {
                if (C && C.down) send('keyup', 'ArrowDown');
                if (C && C.tuck) send('keyup', 'Space');
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
    await page.waitForFunction(() => {
        const p = window._freeLookProbe && window._freeLookProbe();
        return window._getGameState().crashed && p && p.active;
    }, null, { timeout: 120_000 });
    await page.evaluate(() => {
        const c = window._freeLookCam();
        // Eye downhill, view uphill. The behavior under test is the following
        // real vertical pointer drag, not horizontal orbit sensitivity.
        c.alpha = Math.PI / 2;
    });
}

async function startSampler(page) {
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const S = window._tiltSamples = { minGap: Infinity, samples: 0 };
        scene.onBeforeRenderObservable.add(() => {
            const g = window._camGroundUnder();
            S.minGap = Math.min(S.minGap, g.camY - g.ground);
            S.samples++;
        });
    });
}

async function measure(page) {
    await page.waitForTimeout(500);
    return page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = window._freeLookCam();
        const eng = scene.getEngine();
        const g = window._getGameState();
        const lip = new BABYLON.Vector3(0,
            window._crashFloorY(g.KICKER_END_Z), g.KICKER_END_Z);
        const p = BABYLON.Vector3.Project(lip, BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(), cam.viewport.toGlobal(
                eng.getRenderWidth(), eng.getRenderHeight()));
        const ground = window._camGroundUnder();
        return {
            world: new URLSearchParams(location.search).get('world'),
            inFrame: p.x >= 0 && p.x <= eng.getRenderWidth() &&
                p.y >= 0 && p.y <= eng.getRenderHeight() && p.z >= 0 && p.z <= 1,
            lipX: p.x, lipY: p.y, lipZ: p.z,
            minGap: window._tiltSamples ? window._tiltSamples.minGap : null,
            finalGap: ground.camY - ground.ground,
            samples: window._tiltSamples ? window._tiltSamples.samples : 0,
            tilt: window._freeLookProbe().tilt,
            targetY: cam.target.y, camY: cam.position.y,
        };
    });
}

test('landing tilt: clamped drag frames the kicker lip in every world and R resets', async ({ page }) => {
    test.setTimeout(600_000);
    for (const world of ['single', 'double', 'triple']) {
        await settleCrash(page, world);

        // Shipped negative control: preserve the old stay-level camera on the
        // first world and prove the exact world-projection predicate fires.
        if (world === 'single') {
            await page.evaluate(() => { window._freeLookTiltDisabled = true; });
            for (let i = 0; i < 17; i++) await dragUp(page);
            const old = await measure(page);
            console.log('LANDING TILT NEGCONTROL ' + JSON.stringify(old));
            expect(old.inFrame,
                'negative control: the pre-#18 camera must leave the lip out of frame').toBe(false);
            await page.evaluate(() => {
                const c = window._freeLookCam();
                window._freeLookTiltDisabled = false;
                c.beta = Math.PI / 4.5;
            });
        }

        await startSampler(page);
        for (let i = 0; i < 17; i++) await dragUp(page);
        const m = await measure(page);
        console.log('LANDING TILT ' + JSON.stringify(m));
        expect(m.samples).toBeGreaterThan(10);
        expect(m.minGap, `${world}: terrain clamp slipped: ${JSON.stringify(m)}`)
            .toBeGreaterThanOrEqual(0.99);
        expect(m.finalGap).toBeGreaterThanOrEqual(0.99);
        expect(m.tilt, `${world}: excess drag was discarded`).toBeGreaterThan(1);
        expect(m.inFrame, `${world}: kicker lip outside frame: ${JSON.stringify(m)}`)
            .toBe(true);

        await page.keyboard.press('r');
        await page.waitForTimeout(300);
        const reset = await page.evaluate(() => window._freeLookProbe());
        expect(reset.tilt).toBeLessThan(0.001);
        expect(Math.abs(reset.targetZ - reset.rootZ)).toBeLessThan(0.5);
    }
});

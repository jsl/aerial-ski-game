'use strict';
// ── Start gating (FABLE-80 finding 7 / author 22:25 (a)) ────────────────────
// The legacy primitive athlete used to be visible from the first frame and was
// only swapped for the skinned body when athlete_body.glb resolved, so on a
// reload the OLD box character appeared first as the skier.
//
// Gate: on a fresh load, NO frame ever shows a legacy driver solid before the
// skinned body is ready; the body + ski equipment appear in the same frame;
// an explicit load FAILURE falls back to the primitives WITH an on-screen
// message. The violation detector itself ships with a negative control
// (FABLE-80 finding 11): a deliberately-revealed solid must be caught.

const { test, expect } = require('@playwright/test');

// Installed BEFORE any page script, so it wraps rAF for the game's very first
// frame. Samples every animation frame for legacy solids shown while neither
// the skinned body (_bodyLinked) nor the declared fallback (_bodyFallback)
// is active.
async function installFrameWatcher(page) {
    await page.addInitScript(() => {
        window.__gate = { violations: [], frames: 0 };
        const orig = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = fn => orig(t => {
            try {
                window.__gate.frames++;
                const cm = window._characterMeshes;
                if (cm && !window._bodyLinked && !window._bodyFallback) {
                    for (const key of Object.keys(cm)) {
                        if (key === 'skiL' || key === 'skiR') continue;
                        const e = cm[key];
                        const m = (e && e.mesh) ? e.mesh : e;
                        if (m && m.isVisible) window.__gate.violations.push(key);
                    }
                }
            } catch (e) { /* watcher must never break the game */ }
            fn(t);
        });
    });
}

test('fresh load: no frame shows a legacy solid; body + skis appear together', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await installFrameWatcher(page);

    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    // A few real frames AFTER the link so the watcher samples the reveal state.
    await page.waitForFunction(() => window.__gate.frames > 30, null, { timeout: 30_000 });

    const state = await page.evaluate(() => {
        const cm = window._characterMeshes;
        const visDrivers = [];
        for (const key of Object.keys(cm)) {
            const e = cm[key];
            const m = (e && e.mesh) ? e.mesh : e;
            if (m && m.isVisible && key !== 'skiL' && key !== 'skiR') visDrivers.push(key);
        }
        let bodyVisible = 0, skiChildrenVisible = 0;
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const m of scene.meshes) {
            if (m.name && m.name.startsWith('athleteBody') && m.isVisible) bodyVisible++;
        }
        for (const nm of ['skiL', 'skiR']) {
            for (const k of cm[nm].getChildMeshes()) if (k.isVisible) skiChildrenVisible++;
        }
        return {
            frames: window.__gate.frames,
            violations: window.__gate.violations.slice(0, 10),
            violationCount: window.__gate.violations.length,
            visDrivers,
            bodyVisible,
            skiChildrenVisible,
            fallback: window._bodyFallback || 0,
        };
    });

    expect(state.frames, 'watcher must have sampled animation frames').toBeGreaterThan(30);
    expect(state.violationCount,
        `legacy solids visible before the body linked: ${state.violations.join(',')}`).toBe(0);
    expect(state.visDrivers, 'drivers must be hidden once the body is linked').toEqual([]);
    expect(state.bodyVisible, 'skinned body parts must be visible').toBeGreaterThan(0);
    expect(state.skiChildrenVisible,
        'styled ski equipment must be visible').toBeGreaterThan(0);
    expect(state.fallback, 'no fallback must fire on a healthy load').toBe(0);
    expect(errors, 'no page errors').toEqual([]);

    // ── Negative control (finding 11): the detector must DISCRIMINATE. ──
    // Deliberately show a legacy solid with the link flag cleared; the watcher
    // must record it on the next frame. Restore afterwards.
    const caught = await page.evaluate(async () => {
        window.__gate.violations.length = 0;
        const linked = window._bodyLinked;
        window._bodyLinked = 0;
        window._characterMeshes.torso.isVisible = true;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hit = window.__gate.violations.indexOf('torso') !== -1;
        window._characterMeshes.torso.isVisible = false;
        window._bodyLinked = linked;
        window.__gate.violations.length = 0;
        return hit;
    });
    expect(caught, 'the frame watcher must catch a deliberately-shown solid').toBe(true);
});

test('load failure: primitives become the declared fallback with an on-screen message', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await installFrameWatcher(page);
    // Negative-control input for the gating path itself: athlete_body.glb is
    // UNREACHABLE. The primitives MUST come back (declared fallback, flagged
    // with _bodyFallback + a HUD message), never a silent empty scene.
    await page.route('**/athlete_body.glb*', r => r.abort());

    await page.goto('/index.html');
    await page.waitForFunction(() => (window._bodyFallback || 0) > 0, null, { timeout: 60_000 });
    await page.waitForFunction(() => window.__gate.frames > 10, null, { timeout: 30_000 });

    const state = await page.evaluate(() => {
        const cm = window._characterMeshes;
        const head = cm.head;
        let skiChildrenVisible = 0;
        for (const nm of ['skiL', 'skiR']) {
            for (const k of cm[nm].getChildMeshes()) if (k.isVisible) skiChildrenVisible++;
        }
        return {
            headVisible: !!(head && ((head.mesh && head.mesh.isVisible) || head.isVisible)),
            skiChildrenVisible,
            msg: !!document.getElementById('athleteFallbackMsg'),
            bodyLinked: window._bodyLinked || 0,
            violations: window.__gate.violations.length,
        };
    });

    expect(state.headVisible, 'fallback must show the primitive athlete').toBe(true);
    expect(state.skiChildrenVisible,
        'fallback must show the ski equipment in the alpine world').toBeGreaterThan(0);
    expect(state.msg, 'fallback must show the on-screen message').toBe(true);
    expect(state.bodyLinked, 'body link must have failed').toBe(0);
    // The fallback is DECLARED, so the watcher must NOT flag these frames —
    // and it must also not have flagged anything before the fallback fired.
    expect(state.violations, 'no undeclared violations').toBe(0);
    expect(errors, 'no page errors').toEqual([]);
});

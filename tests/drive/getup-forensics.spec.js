'use strict';
// ── Iteration 235 FORENSICS instrument (#29 v2 / #24(a)) ───────────────────
// Review-only: reproduce played crashes (keyboard path) in all three worlds
// and dump, per rendered frame from impact to walk-start, the skierRoot Y
// trajectory and the slide-phase ground clearance.  Deliverable: the largest
// single-frame Δroot.y with its exact phase, and whether the post-tumble
// slide is airborne.  No fixes here — 236–238 fix on this dump's numbers.
const { test, expect } = require('@playwright/test');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'shots');

async function forensics(page, world, opts) {
    const o = Object.assign({ tuck: true, flip: true }, opts || {});
    await page.goto('/index.html?world=' + world);
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    await page.evaluate((tuckOn) => {
        const C = window._fgRun = { armed: false, down: false, tuck: false, done: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            const C = window._fgRun;
            if (!C || C.done) return;
            const g = window._getGameState();
            if (g.crashed) { C.done = true; return; }
            if (!g.grounded && g.posZ >= g.KICKER_END_Z && !C.armed) {
                C.armed = true;
                window._debugTriggerCrash();   // reviewer entry-109 sanctioned trigger
            }
            if (g.grounded && !C.down && g.flipPower < 0.999) {
                C.down = true; send('keydown', 'ArrowDown');
            } else if (C.down && (g.flipPower >= 0.999 || !g.grounded)) {
                C.down = false; send('keyup', 'ArrowDown');
            }
            if (tuckOn && !g.grounded && !C.tuck) {
                C.tuck = true; send('keydown', 'Space');
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, o.tuck);
    await page.waitForFunction(() => window._getGameState().crashed,
        null, { timeout: 90_000 });

    // Sample EVERY rendered frame from impact through walk-start (phase
    // 'walk' reached, or 15 s cap).  Root Y from the transform node; floor
    // from the game's own crash floor; clearance = lowest tracked point −
    // floor.  Track the ankle caps (boot-sole reference) and the root.
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const F = window._fgDump = { frames: [], last: null, impactT: performance.now() };
        const floorY = window._crashFloorY;
        const ank = (name) => {
            const leg = scene.getMeshByName(name);
            leg.computeWorldMatrix(true);
            const p = leg.getAbsolutePosition();
            const d = leg.getDirection(BABYLON.Axis.Y);
            return [p.x - d.x * 0.18, p.y - d.y * 0.18, p.z - d.z * 0.18];
        };
        const sample = (now) => {
            try {
                const R = window._ragdollProbe();
                const Wp = window._walkoffProbe();
                const root = scene.getTransformNodeByName('skierRoot');
                root.computeWorldMatrix(true);
                const rp = root.getAbsolutePosition();
                const aL = ank('lowerLegL'), aR = ank('lowerLegR');
                const fr = floorY(rp.z);
                const lowest = Math.min(rp.y, aL[1], aR[1]);
                const phase = R ? R.phase : (Wp ? Wp.phase : 'pre');
                F.frames.push({
                    t: +(now - F.impactT).toFixed(1),
                    phase,
                    walkPhase: Wp ? Wp.phase : null,
                    rootY: +rp.y.toFixed(4), rootZ: +rp.z.toFixed(3),
                    lowestY: +lowest.toFixed(4),
                    clearance: +(lowest - fr).toFixed(4),
                    maxSpeed: R ? R.maxSpeed : null,
                });
                const started = Wp && (Wp.phase === 'walk' || Wp.phase === 'done');
                if ((started && F.frames.length > F.walkStart + 30) ||
                    now - F.impactT > 15_000) { F.finished = true; return; }
                if (started && F.walkStart === undefined) F.walkStart = F.frames.length;
                requestAnimationFrame(sample);
            } catch (e) { F.error = String((e && e.stack) || e); F.finished = true; }
        };
        requestAnimationFrame(sample);
    });
    await page.waitForFunction(() => window._fgDump && window._fgDump.finished,
        null, { timeout: 40_000 });

    return page.evaluate(() => {
        const F = window._fgDump;
        // Largest single-frame Δroot.y, labelled with phase and frame index.
        let jump = { d: 0 };
        for (let i = 1; i < F.frames.length; i++) {
            const d = F.frames[i].rootY - F.frames[i - 1].rootY;
            if (Math.abs(d) > Math.abs(jump.d)) {
                jump = { d: +d.toFixed(4), i,
                    phase: F.frames[i].phase,
                    walkPhase: F.frames[i].walkPhase,
                    t: F.frames[i].t,
                    from: F.frames[i - 1].rootY, to: F.frames[i].rootY };
            }
        }
        // Top 5 |Δroot.y| single-frame jumps overall (jump-hunting).
        const deltas = [];
        for (let i = 1; i < F.frames.length; i++) {
            deltas.push({ i, d: +(F.frames[i].rootY - F.frames[i - 1].rootY).toFixed(4),
                phase: F.frames[i].phase, t: F.frames[i].t });
        }
        const top5 = deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
        // Slide-phase (ragdoll 'roll') airborne profile.
        const slide = F.frames.filter((f) => f.phase === 'roll');
        const slideStats = slide.length ? {
            n: slide.length,
            minClear: Math.min(...slide.map((f) => f.clearance)),
            maxClear: Math.max(...slide.map((f) => f.clearance)),
            meanClear: +(slide.reduce((s, f) => s + f.clearance, 0) / slide.length).toFixed(4),
            airborneFrames: slide.filter((f) => f.clearance > 0.08).length,
        } : null;
        // Get-up phases for context.
        const byWalk = {};
        for (const f of F.frames) {
            const k = f.walkPhase || f.phase;
            byWalk[k] = byWalk[k] || { n: 0, maxJump: 0 };
            byWalk[k].n++;
        }
        for (let i = 1; i < F.frames.length; i++) {
            const k = F.frames[i].walkPhase || F.frames[i].phase;
            const d = Math.abs(F.frames[i].rootY - F.frames[i - 1].rootY);
            if (byWalk[k]) byWalk[k].maxJump = Math.max(byWalk[k].maxJump, +d.toFixed(4));
        }
        return { world: window._getGameState().world || null,
            impactSpeed: window._crashImpactSpeed(),
            nFrames: F.frames.length,
            walkStartIndex: F.walkStart ?? null,
            jump, top5, slideStats, byWalk,
            frames: F.frames,
            error: F.error || null };
    });
}
for (const world of (process.env.FG_WORLDS || 'single,double,triple').split(',')) {
    test(`forensics ${world}: root-Y dump impact → walk-start`, async ({ page }) => {
        const m = await forensics(page, world, {
            tuck: process.env.FG_TUCK !== '0',
        });
        expect(m.error).toBeNull();
        expect(m.nFrames).toBeGreaterThan(60);
        // Instrument only: no behaviour gates.  Persist the dump for the
        // progress entry and 236–238.
        require('fs').writeFileSync(
            path.join(OUT, `forensics_${world}.json`), JSON.stringify(m, null, 1));
        console.log(`[${world}] impact=${m.impactSpeed} frames=${m.nFrames} ` +
            `maxΔrootY=${JSON.stringify(m.jump)} slide=${JSON.stringify(m.slideStats)}`);
    });
}

'use strict';
// ── #21 v4: the STATIONARY grounded tuck (author, 2026-08-31 20:30) ────────
// "when stationary at top of run tuck doesn't seem right". The grounded tuck
// path rendered POSE_INRUN_TUCK — the DOWNHILL crouch — so holding tuck while
// stopped on the start plateau read as a permanent forward collapse with the
// hands hanging over the skis. The ruling: while grounded and stationary with
// tuck held the athlete reads as a DEEP SQUAT — heels PLANTED on the skis
// (the boot–ski invariant applies on the ground too), deep knee flexion,
// torso within ~20 deg of upright, hands reaching to the knees.
//
// Gate (live composition, real browser): window._inrunHold(1, 1) runs the
// frame loop's exact calls (applyPose with the squat blend + boot pin + torso
// seat + arm fix-up with the squat hand-target bias), so measuring its output
// measures the picture. The boot–ski pin owns the shins, so the heel side of
// the invariant is enforced by construction; the ankle gap is measured anyway.
//
// Negative control: the PREVIOUS behaviour — _inrunHold(1, 0), the downhill
// crouch — must FAIL the torso gate (it leans ~44-46 deg from upright).
//
// Display-only (ADR-0002): body-model.json untouched, golden audit 0 diffs.
const { test, expect } = require('@playwright/test');

const TORSO_UPRIGHT = 22 * Math.PI / 180;  // ruling ~20 deg + tolerance
const HAND_TO_KNEE  = 0.20;                // reaching, not grasping (v4 wording)
const TEAR_LIMIT    = 0.030;               // chain closed, shared with chain.spec
const KNEE_DEEP     = 100 * Math.PI / 180; // interior knee angle: deep flexion

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
}

function measure(page, squat) {
    return page.evaluate((sq) => {
        const M = window._characterMeshes;
        window._inrunHold(1, sq);   // frame-loop composition at tuck=1
        const seg = (n) => {
            const m = M[n];
            const crz = Math.cos(m.rotation.z);
            const dy = crz * Math.cos(m.rotation.x), dz = crz * Math.sin(m.rotation.x);
            const h = { torso: 0.275, head: 0.125, upperArm: 0.15, lowerArm: 0.125,
                        upperLeg: 0.18, lowerLeg: 0.18 }[n.replace(/[LR]$/, '')];
            return { top: [m.position.y + h * dy, m.position.z + h * dz],
                     bot: [m.position.y - h * dy, m.position.z - h * dz] };
        };
        const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const torso = seg('torso');
        const out = { torsoDeg: Math.abs(M.torso.rotation.x) * 180 / Math.PI };
        for (const s of ['L', 'R']) {
            out['handToKnee' + s] = hyp(seg('lowerArm' + s).top, seg('upperLeg' + s).bot);
            out['hip' + s]    = hyp(seg('upperLeg' + s).top, torso.bot);
            out['shoulder' + s] = hyp(seg('upperArm' + s).bot, torso.top);
            const ul = seg('upperLeg' + s), ll = seg('lowerLeg' + s);
            out['kneeGap' + s] = hyp(ll.top, ul.bot);
            // interior knee angle: thigh direction (hip->knee) vs shin (knee->ankle)
            const a = [ul.bot[0] - ul.top[0], ul.bot[1] - ul.top[1]];
            const b = [ll.bot[0] - ll.top[0], ll.bot[1] - ll.top[1]];
            const na = Math.hypot(a[0], a[1]), nb = Math.hypot(b[0], b[1]);
            out['kneeDeg' + s] = Math.acos((a[0] * b[0] + a[1] * b[1]) / (na * nb)) * 180 / Math.PI;
            // heel/ankle on the ski: ankle (shin -Y end) vs the ski's binding top
            const ski = M['ski' + s];
            out['ankle' + s] = hyp(
                [ski.position.y + 0.015 * Math.cos(M['lowerLeg' + s].rotation.x),
                 ski.position.z + 0.015 * Math.sin(M['lowerLeg' + s].rotation.x)],
                ll.bot);
        }
        return out;
    }, squat);
}

test.describe('stationary grounded tuck = deep squat (#21 v4)', () => {
    test('held tuck at zero speed: torso upright, hands to knees, deep knees, heels planted', async ({ page }) => {
        await boot(page);
        // Drive the real game into the ready state and hold tuck (keyboard):
        // the frame loop must converge the squat weight to 1 while stopped.
        await page.keyboard.down(' ');
        await page.waitForFunction(() => (window._lastSquat || 0) > 0.99, null, { timeout: 10_000 });
        const g = await measure(page, 1);
        console.log('TUCK4 ' + JSON.stringify(g));
        await page.keyboard.up(' ');
        expect(g.torsoDeg, `torso within ~20 deg of upright (got ${g.torsoDeg.toFixed(1)})`).toBeLessThanOrEqual(22);
        expect(g.handToKneeL, `L hand reaches the knee (got ${(g.handToKneeL * 100).toFixed(1)} cm)`)
            .toBeLessThanOrEqual(HAND_TO_KNEE);
        expect(g.handToKneeR, `R hand reaches the knee (got ${(g.handToKneeR * 100).toFixed(1)} cm)`)
            .toBeLessThanOrEqual(HAND_TO_KNEE);
        expect(g.kneeDegL, `L deep knee flexion (got ${g.kneeDegL.toFixed(0)} deg interior)`)
            .toBeLessThanOrEqual(KNEE_DEEP * 180 / Math.PI);
        expect(g.kneeDegR, `R deep knee flexion`).toBeLessThanOrEqual(KNEE_DEEP * 180 / Math.PI);
        for (const k of ['hipL', 'hipR', 'shoulderL', 'shoulderR', 'kneeGapL', 'kneeGapR',
                         'ankleL', 'ankleR']) {
            expect(g[k], `chain closed at ${k}`).toBeLessThanOrEqual(TEAR_LIMIT);
        }
        await page.screenshot({ path: 'shots/tuck_grounded.png' });
    });

    test('negative control: the downhill crouch (no squat) fails the torso gate', async ({ page }) => {
        await boot(page);
        const old = await measure(page, 0);
        expect(old.torsoDeg, 'control fires: crouch leans well past 22 deg')
            .toBeGreaterThan(30);
    });
});

'use strict';
// ── In-run crouch: the author's 23:40 ruling ────────────────────────────────
// Screenshot: reference/shots/author_inrun_crouch_2026-08-29.png — "the skier
// tucking is still really weird". By eye and then measured: the torso was a
// flat horizontal plank (back 27° above horizontal), the head hung down
// (gaze along the back line), both arms stuck straight out FORWARD with the
// arm chain anchored 0.68 m from the real shoulder, and the boot–ski pin left
// the torso's hip 0.199 m off the thigh's hip, which is the "suit smears over
// the back".
//
// The ruling's gates, measured HERE on the composition the player actually
// sees — the pose table plus the frame loop's display fix-ups (boot–ski pin,
// torso seat, arm hold), via window._inrunHold(1):
//
//   back angle 40–50° above horizontal
//   hand height within ±0.10 m of knee height
//   hand 0.10–0.30 m ahead of the knee
//   head up: gaze ≥ 25° above the back line
//   plus the two joints the ruling's prose names — the hip must be seated
//   (that is the smear) and the elbow must be straight.
//
// NEGATIVE CONTROL (last test): the pre-ruling table's own literals, written
// onto the same meshes and measured by the same code, must FAIL — the back
// angle and the head are both outside the bands.
const { test, expect } = require('@playwright/test');

// The measurement, run in the page against the live meshes. Deliberately a
// re-implementation rather than a call into game.js: a gate that trusts the
// code under test to describe itself measures nothing (the same reason
// chain.spec.js carries its own copy for the old-table control).
const MEASURE = `(() => {
    const M = window._characterMeshes;
    const seg = (n) => ({ y: M[n].position.y, z: M[n].position.z, rx: M[n].rotation.x });
    const t = seg('torso'), h = seg('head');
    const tc = Math.cos(t.rx), ts = Math.sin(t.rx);
    const hip = [t.y - 0.275 * tc, t.z - 0.275 * ts];
    const sh  = [t.y + 0.275 * tc, t.z + 0.275 * ts];
    // Back angle above horizontal: hip -> shoulder, forward = -z.
    const backDeg = Math.atan2(sh[0] - hip[0], -(sh[1] - hip[1])) * 180 / Math.PI;
    const out = { backDeg: backDeg, headVsBackDeg: (h.rx - t.rx) * 180 / Math.PI, sides: {} };
    for (const side of ['L', 'R']) {
        const ul = seg('upperLeg' + side), ua = seg('upperArm' + side), la = seg('lowerArm' + side);
        const uc = Math.cos(ul.rx), us = Math.sin(ul.rx);
        const ac = Math.cos(ua.rx), as = Math.sin(ua.rx);
        const lc = Math.cos(la.rx), ls = Math.sin(la.rx);
        const thighHip = [ul.y + 0.18 * uc, ul.z + 0.18 * us];
        const knee     = [ul.y - 0.18 * uc, ul.z - 0.18 * us];
        // Bind axis: +Y runs toward the wrist, so the shoulder is the upper
        // arm's -Y end, the elbow its +Y end, the hand the fore-arm's +Y end.
        const armRoot  = [ua.y - 0.150 * ac, ua.z - 0.150 * as];
        const elbowUp  = [ua.y + 0.150 * ac, ua.z + 0.150 * as];
        const elbowLo  = [la.y - 0.125 * lc, la.z - 0.125 * ls];
        const hand     = [la.y + 0.125 * lc, la.z + 0.125 * ls];
        out.sides[side] = {
            hipGap:      Math.hypot(thighHip[0] - hip[0], thighHip[1] - hip[1]),
            shoulderGap: Math.hypot(armRoot[0] - sh[0], armRoot[1] - sh[1]),
            elbowGap:    Math.hypot(elbowUp[0] - elbowLo[0], elbowUp[1] - elbowLo[1]),
            handVsKneeY: hand[0] - knee[0],
            handAheadOfKnee: knee[1] - hand[1],
            handBelowShoulder: hand[0] < sh[0],
        };
    }
    return out;
})()`;

// POSE_INRUN_TUCK as it shipped before the author's 23:40 ruling (git 433d5d1),
// written straight onto the drivers for the negative control.
const OLD_TABLE = {
    torso:     { y:  0.055, z: -0.140, rx: -1.10 },
    head:      { y:  0.270, z: -0.470, rx: -0.80 },
    upperArmL: { y:  0.075, z: -0.482, rx:  0.80 },
    upperArmR: { y:  0.075, z: -0.498, rx:  0.80 },
    lowerArmL: { y: -0.145, z: -0.632, rx:  0.30 },
    lowerArmR: { y: -0.145, z: -0.648, rx:  0.30 },
};

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForFunction(() => typeof window._inrunHold === 'function');
    await page.waitForTimeout(600);
}

test.describe('in-run crouch (author 23:40)', () => {
    test('back 40–50°, head up, arms straight to knee height, hips seated', async ({ page }) => {
        await boot(page);
        const m = await page.evaluate(`(() => { window._inrunHold(1); return ${MEASURE}; })()`);
        console.log('INRUNCROUCH', JSON.stringify(m));

        expect(m.backDeg, `back ${m.backDeg.toFixed(1)}° above horizontal (40–50)`)
            .toBeGreaterThanOrEqual(40);
        expect(m.backDeg, `back ${m.backDeg.toFixed(1)}° above horizontal (40–50)`)
            .toBeLessThanOrEqual(50);
        expect(m.headVsBackDeg, `head ${m.headVsBackDeg.toFixed(1)}° above the back line (≥ 25)`)
            .toBeGreaterThanOrEqual(25);

        for (const side of ['L', 'R']) {
            const s = m.sides[side];
            expect(Math.abs(s.handVsKneeY),
                `${side}: hand ${s.handVsKneeY.toFixed(3)} m off knee height (±0.10)`)
                .toBeLessThanOrEqual(0.10);
            expect(s.handAheadOfKnee,
                `${side}: hand ${s.handAheadOfKnee.toFixed(3)} m ahead of the knee (0.10–0.30)`)
                .toBeGreaterThanOrEqual(0.10);
            expect(s.handAheadOfKnee, `${side}: hand ahead of the knee upper bound`)
                .toBeLessThanOrEqual(0.30);
            expect(s.handBelowShoulder, `${side}: hand below the shoulder`).toBe(true);
            // The smear: the pin moves the legs, the torso must follow them.
            expect(s.hipGap, `${side}: hip ${(s.hipGap * 1000).toFixed(0)} mm off the thigh (≤ 50)`)
                .toBeLessThanOrEqual(0.050);
            expect(s.shoulderGap,
                `${side}: shoulder ${(s.shoulderGap * 1000).toFixed(0)} mm off the torso (≤ 20)`)
                .toBeLessThanOrEqual(0.020);
            expect(s.elbowGap, `${side}: elbow ${(s.elbowGap * 1000).toFixed(0)} mm open (≤ 20)`)
                .toBeLessThanOrEqual(0.020);
        }
    });

    test('negative control: the pre-ruling table fails the same gates', async ({ page }) => {
        await boot(page);
        const m = await page.evaluate(`(() => {
            const M = window._characterMeshes;
            const OLD = ${JSON.stringify(OLD_TABLE)};
            const scene = BABYLON.EngineStore.LastCreatedScene;
            scene.getEngine().stopRenderLoop();
            window._inrunHold(1);
            for (const n of Object.keys(OLD)) {
                M[n].position.y = OLD[n].y; M[n].position.z = OLD[n].z;
                M[n].rotation.x = OLD[n].rx;
            }
            const r = ${MEASURE};
            scene.getEngine().runRenderLoop(() => scene.render());
            return r;
        })()`);
        console.log('INRUNCROUCH-NEGCTL', JSON.stringify(m));
        // Flat plank, head down the back line, and the arm rolled 180° out of
        // its bind axis so the "shoulder" end is 0.3 m from the torso.
        expect(m.backDeg, `control back ${m.backDeg.toFixed(1)}° must be outside 40–50`)
            .toBeLessThan(40);
        expect(m.headVsBackDeg, `control head ${m.headVsBackDeg.toFixed(1)}° must be under 25`)
            .toBeLessThan(25);
        expect(m.sides.L.shoulderGap,
            `control shoulder ${(m.sides.L.shoulderGap * 1000).toFixed(0)} mm must breach 20`)
            .toBeGreaterThan(0.020);
    });
});

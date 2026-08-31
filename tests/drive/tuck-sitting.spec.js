'use strict';
// ── #21 v3 part 2: the SITTING flight tuck (ruling on 197, Fable 19:30) ────
// `APPROVED: POSE_TUCKED display-table adjustment per this ruling.` Gates on
// the ruling's three numbers, measured on the LIVE character at the flight
// tuck endpoint (tuck 1, airborne — where POSE_TUCKED is the authored table
// and the reconciler is inert):
//   • torso within ~10 deg of upright  (|torso rx| <= 10.5 deg)
//   • HANDS GRASPING the kneecaps <= 5 cm — wrist (lowerArm +Y end) to knee
//     (upperLeg -Y end), the wrap must read as contact, not proximity
//   • the chain stays closed at the endpoint (neck/shoulder/hip/knee/ankle
//     <= 3 cm tear limit — shared with chain.spec.js)
// Negative control: the PREVIOUS table's grasp geometry (hand 5.9 cm off the
// knee) evaluated through the same maths must FAIL the 5 cm gate.
//
// Display-only (ADR-0002): applyPose runs on the live meshes inside the
// probe; the next render frame overwrites them. Physics untouched:
// POSE_TUCKED_INERTIA is byte-frozen (tests/unit/tuck-inertia-frozen.test.js)
// and the golden audit must report 0 diffs.
const { test, expect } = require('@playwright/test');

const GRASP_LIMIT = 0.050;   // 5 cm, the ruling's number
const TORSO_UPRIGHT = 10.5 * Math.PI / 180;
const TEAR_LIMIT = 0.030;

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
}

// Apply the flight tuck endpoint to the live meshes and measure the ruling's
// numbers with the same segment-end maths applyPose/_poseProbe use.
function measure(page) {
    return page.evaluate(() => {
        const M = window._characterMeshes;
        window._poseProbe(1, false, 0);   // writes the tuck=1 airborne pose
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
        const out = { torsoRx: Math.abs(M.torso.rotation.x) };
        for (const s of ['L', 'R']) {
            out['handToKnee' + s] = hyp(seg('lowerArm' + s).top, seg('upperLeg' + s).bot);
            out['neck' + s] = hyp(seg('head').bot, torso.top);
            out['shoulder' + s] = hyp(seg('upperArm' + s).bot, torso.top);
            out['hip' + s] = hyp(seg('upperLeg' + s).top, torso.bot);
            const ul = seg('upperLeg' + s);
            out['knee' + s] = hyp(seg('lowerLeg' + s).top, ul.bot);
            out['ankle' + s] = hyp(
                [M['ski' + s].position.y + 0.015 * Math.cos(M['lowerLeg' + s].rotation.x),
                 M['ski' + s].position.z + 0.015 * Math.sin(M['lowerLeg' + s].rotation.x)],
                seg('lowerLeg' + s).bot);
        }
        out.neck = out.neckL; // single head
        return out;
    });
}

test.describe('sitting flight tuck (#21 v3 part 2)', () => {
    test('torso within ~10 deg of upright, hands grasping kneecaps <= 5 cm', async ({ page }) => {
        await boot(page);
        const g = await measure(page);
        expect(g.torsoRx, 'torso within ~10 deg of upright').toBeLessThanOrEqual(TORSO_UPRIGHT);
        expect(g.handToKneeL, 'L hand grasps the kneecap (<= 5 cm)').toBeLessThanOrEqual(GRASP_LIMIT);
        expect(g.handToKneeR, 'R hand grasps the kneecap (<= 5 cm)').toBeLessThanOrEqual(GRASP_LIMIT);
        // contact, not proximity — not a loose 4.9 cm hover either
        expect(g.handToKneeL, 'L hand in the grasp band').toBeGreaterThanOrEqual(0.010);
        expect(g.handToKneeR, 'R hand in the grasp band').toBeGreaterThanOrEqual(0.010);
    });

    test('chain stays closed at the sitting endpoint', async ({ page }) => {
        await boot(page);
        const g = await measure(page);
        for (const k of ['neck', 'shoulderL', 'shoulderR', 'hipL', 'hipR',
                         'kneeL', 'kneeR', 'ankleL', 'ankleR']) {
            expect(g[k], `sitting tuck ${k}`).toBeLessThanOrEqual(TEAR_LIMIT);
        }
    });

    test('NEGATIVE CONTROL: the previous table\'s grasp fails the 5 cm gate', async ({ page }) => {
        await boot(page);
        // The pre-sitting table's arm/leg rows (git HEAD before this change):
        // hand landed 59 mm off the knee — proximity, not the grasp.
        const g = await page.evaluate(() => {
            const OLD = {
                lowerArmL: { y:  0.102, rx:  1.5688, rz: -0.20, dz: -0.199 },
                upperLegL: { y: -0.092, rx:  2.8916, rz:  0.00, dz:  0.024 },
            };
            const end = (t, h, sgn) => {
                const crz = Math.cos(t.rz);
                return [t.y + sgn * h * crz * Math.cos(t.rx), t.dz + sgn * h * crz * Math.sin(t.rx)];
            };
            const w = end(OLD.lowerArmL, 0.125, +1), k = end(OLD.upperLegL, 0.18, -1);
            return Math.hypot(w[0] - k[0], w[1] - k[1]);
        });
        expect(g).toBeGreaterThan(GRASP_LIMIT);
    });
});

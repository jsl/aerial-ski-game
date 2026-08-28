'use strict';
// ── P13 chain solver: joint-anchor gates at pose blends ─────────────────────
// Sol blocker 1 (docs/HY4-REVIEW-1.md): the connected-skeleton reconciliation
// in applyPose must keep adjacent segments joined. Gates:
//
//   • shoulder (upperArm +Y end vs torso +Y end), neck, hip (upperLeg +Y end
//     vs torso −Y end) ≤ 1 cm whenever the blend-scaled pass is engaged
//     (sBlend = 4·tuck·(1−tuck) > 0 or pike > 0) — measured pre-fix:
//     shoulder 0.425 m mid-tuck, knee 0.044 m, neck stretched (iter 67/68).
//   • knee/ankle: the solver anchors the child's centre along the PARENT's
//     axis, so the cross-axis residual is pure bend geometry — gated as
//     residual ≤ 2·h·sin(|Δrx|/2) + 1 cm (no gap beyond the authored bend).
//
// At the authored pose endpoints (tuck 0/1 with sBlend = 0) the tables are
// intentionally free-standing (iter 67 decision, reviewer-approved recapture
// route), so endpoint gaps are out of scope here.
// Display-only (ADR-0002): window._poseProbe runs applyPose on the live meshes
// and reads them back; the next render frame overwrites them.
const { test, expect } = require('@playwright/test');

const JOINT_LIMIT = 0.010; // 1 cm

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForFunction(() => typeof window._poseProbe === 'function');
}

async function probe(page, tuck, grounded, pike) {
    return page.evaluate(([t, g, p]) => window._poseProbe(t, g, p), [tuck, grounded, pike]);
}

function expectAnchors(gaps, keys, label) {
    for (const k of keys) expect(gaps[k], `${label} ${k}`).toBeLessThanOrEqual(JOINT_LIMIT);
}

test.describe('P13 chain joint anchors', () => {
    test.beforeEach(async ({ page }) => { await boot(page); });

    test('rest pose (tuck 0): neck and hips tight', async ({ page }) => {
        const g = await probe(page, 0, true, 0);
        expectAnchors(g, ['neck', 'hipL', 'hipR'], 'rest');
    });

    test('mid-blend flight tuck (tuck 0.5): shoulders, neck, hips tight', async ({ page }) => {
        const g = await probe(page, 0.5, false, 0);
        expectAnchors(g, ['shoulderL', 'shoulderR', 'neck', 'hipL', 'hipR'], 'flight 0.5');
    });

    test('mid-blend grounded crouch (tuck 0.5): shoulders, neck, hips tight', async ({ page }) => {
        const g = await probe(page, 0.5, true, 0);
        expectAnchors(g, ['shoulderL', 'shoulderR', 'neck', 'hipL', 'hipR'], 'crouch 0.5');
    });

    test('mid-blend pike: shoulders, neck, hips tight', async ({ page }) => {
        const g = await probe(page, 0, false, 0.5);
        expectAnchors(g, ['shoulderL', 'shoulderR', 'neck', 'hipL', 'hipR'], 'pike 0.5');
    });

    test('knee/ankle residual is bend geometry only (mid-blend crouch)', async ({ page }) => {
        // Cross-axis residual must not exceed the authored bend's own
        // chord 2·h·sin(|Δrx|/2) plus the 1 cm anchor tolerance.
        const g = await page.evaluate(() => {
            window._poseProbe(0.5, true, 0);
            const M = window._characterMeshes, out = {};
            for (const side of ['L', 'R']) {
                const ul = M['upperLeg' + side], ll = M['lowerLeg' + side], sk = M['ski' + side];
                out['dRx' + side] = Math.abs(ul.rotation.x - ll.rotation.x);
                // knee gap from the probe (cross-axis measure)
                out['kneeGap' + side] = window._poseProbe(0.5, true, 0)['knee' + side];
                const llc = Math.cos(ll.rotation.x), lls = Math.sin(ll.rotation.x);
                out['ankleGap' + side] = Math.hypot(
                    (sk.position.y + 0.015 * llc) - (ll.position.y - 0.18 * llc),
                    (sk.position.z + 0.015 * lls) - (ll.position.z - 0.18 * lls));
            }
            return out;
        });
        for (const side of ['L', 'R']) {
            const bend = 2 * 0.18 * Math.abs(Math.sin(g['dRx' + side] / 2));
            expect(g['kneeGap' + side], `knee${side}`).toBeLessThanOrEqual(bend + JOINT_LIMIT);
            expect(g['ankleGap' + side], `ankle${side}`).toBeLessThanOrEqual(bend + JOINT_LIMIT);
        }
    });
});

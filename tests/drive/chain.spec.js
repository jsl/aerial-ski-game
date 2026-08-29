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

// ── HARD endpoint tear gate (FABLE-80 finding 5, iteration 83) ─────────────
// At the authored pose endpoints the blend-scaled reconciliation is inert
// (sBlend = 0), so the tables themselves must chain. Rest edge = the 1 cm
// anchor tolerance above; a joint is TORN when its gap exceeds 3× that.
// Covered here: in-run tuck (tuck 1, grounded), FLIGHT tuck (tuck 1, airborne)
// and pike (pike 1, whose endpoint runs the full-strength reconciler).
//
// The flight tuck was the last torn endpoint — shoulder 0.536 m, hip 0.329 m,
// neck 0.211 m, knee 0.207 m off their anchors, the author's "back separating".
// POSE_TUCKED was rebuilt chain-consistent in Opus item 5 under
// "APPROVED (Fable, 17:05): close the POSE_TUCKED hip gap", which also set the
// hip band at 2 cm; it is gated at that tighter number below while the rest of
// the joints keep the 3 cm tear limit.

const REST_EDGE = 0.010;   // the 1 cm anchor tolerance used above
const TEAR_LIMIT = 3 * REST_EDGE;
test.describe('HARD endpoint tear gate (FABLE-80 finding 5)', () => {
    test.beforeEach(async ({ page }) => { await boot(page); });

    test('in-run tuck endpoint (tuck 1, grounded): no torn joint', async ({ page }) => {
        const g = await probe(page, 1, true, 0);
        for (const [k, v] of Object.entries(g)) {
            expect(v, `in-run tuck ${k}`).toBeLessThanOrEqual(TEAR_LIMIT);
        }
    });

    test('flight tuck endpoint (tuck 1, airborne): no torn joint', async ({ page }) => {
        const g = await probe(page, 1, false, 0);
        for (const [k, v] of Object.entries(g)) {
            expect(v, `flight tuck ${k}`).toBeLessThanOrEqual(TEAR_LIMIT);
        }
        // The approval's own number, on the joint it names.
        for (const k of ['hipL', 'hipR']) {
            expect(g[k], `flight tuck ${k} (approval band)`).toBeLessThanOrEqual(0.020);
        }
    });

    test('flight tuck endpoint: the PRE-REBUILD table would fail this gate', async ({ page }) => {
        // NEGATIVE CONTROL. Runs the old free-standing POSE_TUCKED through the
        // same probe maths in the page, so a gate that had quietly stopped
        // measuring the joints could not pass it.
        const g = await page.evaluate(() => {
            const OLD = {
                torso:     { y:  0.000, rx:  0.35, rz:  0.00, dz:  0.00 },
                head:      { y:  0.340, rx:  0.45, rz:  0.00, dz: -0.06 },
                upperArmL: { y: -0.180, rx: -1.00, rz:  0.20, dz: -0.18 },
                upperArmR: { y: -0.180, rx: -1.00, rz: -0.20, dz: -0.18 },
                upperLegL: { y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },
                upperLegR: { y: -0.140, rx: -1.20, rz:  0.00, dz: -0.20 },
                lowerLegL: { y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },
                lowerLegR: { y: -0.230, rx: -0.55, rz:  0.00, dz: -0.10 },
            };
            const t = OLD.torso;
            const tc = Math.cos(t.rx), ts = Math.sin(t.rx);
            const topY = t.y + 0.275 * tc, topZ = t.dz + 0.275 * ts;
            const botY = t.y - 0.275 * tc, botZ = t.dz - 0.275 * ts;
            const h = OLD.head;
            const out = { neck: Math.hypot(
                (h.y - 0.125 * Math.cos(h.rx)) - topY,
                (h.dz - 0.125 * Math.sin(h.rx)) - topZ) };
            for (const side of ['L', 'R']) {
                const ua = OLD['upperArm' + side], crz = Math.cos(ua.rz);
                out['shoulder' + side] = Math.hypot(
                    (ua.y + 0.150 * crz * Math.cos(ua.rx)) - topY,
                    (ua.dz + 0.150 * crz * Math.sin(ua.rx)) - topZ);
                const ul = OLD['upperLeg' + side];
                const uc = Math.cos(ul.rx), us = Math.sin(ul.rx);
                out['hip' + side] = Math.hypot(
                    (ul.y + 0.18 * uc) - botY, (ul.dz + 0.18 * us) - botZ);
                const ll = OLD['lowerLeg' + side];
                out['knee' + side] = Math.hypot(
                    (ll.y + 0.18 * Math.cos(ll.rx)) - (ul.y - 0.18 * uc),
                    (ll.dz + 0.18 * Math.sin(ll.rx)) - (ul.dz - 0.18 * us));
            }
            return out;
        });
        // The defect this gate exists to catch, with its measured size.
        expect(g.hipL, 'old table hip gap').toBeGreaterThan(0.30);
        expect(g.shoulderL, 'old table shoulder gap').toBeGreaterThan(0.50);
        expect(Math.max(...Object.values(g)), 'old table worst joint')
            .toBeGreaterThan(TEAR_LIMIT);
    });

    test('pike endpoint (pike 1): no torn joint', async ({ page }) => {
        const g = await probe(page, 0, false, 1);
        for (const [k, v] of Object.entries(g)) {
            expect(v, `pike ${k}`).toBeLessThanOrEqual(TEAR_LIMIT);
        }
    });
});

test.describe('in-run tuck pose targets (APPROVED table, footage targets)', () => {
    test.beforeEach(async ({ page }) => { await boot(page); });

    test('hips over heels, knee flexion 90-110 deg, shins forward, back near-horizontal', async ({ page }) => {
        const m = await page.evaluate(() => {
            window._poseProbe(1, true, 0);
            const M = window._characterMeshes;
            const urx = M.upperLegL.rotation.x, lrx = M.lowerLegL.rotation.x;
            const hipZ = M.torso.position.z - 0.275 * Math.sin(M.torso.rotation.x);
            const ankleZ = M.lowerLegL.position.z - 0.18 * Math.sin(lrx);
            const shoulderY = M.torso.position.y + 0.275 * Math.cos(M.torso.rotation.x);
            const handY = M.lowerArmL.position.y - 0.125 * Math.cos(M.lowerArmL.rotation.x);
            const handZ = M.lowerArmL.position.z - 0.125 * Math.sin(M.lowerArmL.rotation.x);
            const deg = r => Math.abs(r) * 180 / Math.PI;
            return {
                torsoDeg: deg(M.torso.rotation.x),
                kneeFlexDeg: 180 - deg(Math.abs(urx - lrx)),
                shinDeg: deg(lrx),
                hipBehindAnkle: hipZ - ankleZ,
                handBelowShoulder: handY <= shoulderY,
                handAheadOfHip: handZ < hipZ - 0.20,
            };
        });
        expect(m.torsoDeg, 'torso from vertical').toBeGreaterThanOrEqual(55);
        expect(m.torsoDeg, 'torso from vertical').toBeLessThanOrEqual(75);
        expect(m.kneeFlexDeg, 'knee flexion').toBeGreaterThanOrEqual(90);
        expect(m.kneeFlexDeg, 'knee flexion').toBeLessThanOrEqual(110);
        expect(m.shinDeg, 'shins forward').toBeGreaterThanOrEqual(15);
        expect(m.shinDeg, 'shins forward').toBeLessThanOrEqual(35);
        expect(m.hipBehindAnkle, 'hip joint behind ankle').toBeLessThanOrEqual(0.12);
        expect(m.hipBehindAnkle, 'hip joint not ahead of ankle').toBeGreaterThanOrEqual(-0.02);
        expect(m.handBelowShoulder, 'hands below shoulders').toBe(true);
        expect(m.handAheadOfHip, 'hands ahead of hips').toBe(true);
    });
});

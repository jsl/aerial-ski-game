'use strict';
// ── In-run contact: boot–ski invariant + crouch arm hold ────────────────────
// Human-testing feedback #2 (author, 2026-08-28), items 1 and 5:
//
// (1) Boot–ski invariant — the ski is bound to the boot at toe AND heel in
//     every non-crash state. Measured pre-fix: in the in-run crouch the boot
//     sole sat 11 mm THROUGH the ski top and 12 cm behind the binding centre,
//     and the hop-turn fold lifted the boots up to 0.24 m off the skis.
//     Gate: sole-to-ski-top ≤ 5 mm at BOTH binding stations, at rest, in the
//     gate crouch, through the whole hop turn, mid-in-run and in flight.
//
//     BOOT-CUFF LEAN (reviewer ruling 00:15 item (b), 2026-08-30). The pitch
//     half of this invariant used to demand the shin be within ±2° of the
//     ski's NORMAL in every state, which is what held the crouch knee at
//     134.2°: with a perpendicular shin the knee interior angle is exactly
//     180−(thigh rx), so a deeper knee could only be bought by throwing the
//     hip backwards. A ski boot's cuff carries 15–20° of built-in forward
//     lean and the athlete flexes into it, so the shin is NEVER perpendicular
//     to the ski in a crouch. The SOLE half of the invariant is unchanged and
//     is what "boot sole on the ski" means: ≤ 5 mm at both stations, always.
//     The pitch half is now crouch-aware — 0–2° at rest (item 10's
//     perpendicular standing stance) rising to the footage band at full
//     crouch, and never backwards. The band is chain.spec.js's own
//     pre-existing footage band (shins forward 15–35°) rather than the
//     ruling's 15–20°: at 0.36 m segments the ruling's box cannot reach
//     chain.spec.js's "hip ≤ 0.12 m behind the ankle" (minimum 0.1718 m), so
//     the two approved numbers are incompatible — see POSE_INRUN_TUCK and
//     docs/OPUS-NOTES.md.
//
// (5) In-run crouch arm hold — while grounded with the crouch engaged the
//     hands stay AHEAD of the hips by 0.25–0.40 m in the body frame and below
//     shoulder height (IMG_3768 in-run frames); the upward sweep starts only
//     at the kicker transition. Measured pre-fix: hands 0.09–0.15 m BEHIND
//     the hips.
//
// Display-side only (ADR-0002): the physics state is never touched; gates
// read window._bootSkiProbe() (game.js), computed with the same maths as the
// display-side pin.
const { test, expect } = require('@playwright/test');

const GAP_LIMIT = 0.005; // 5 mm, author spec (toe AND heel, both skis)

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    // Input-vs-body-link race (pinned by iter 20's probe): wait for the glb.
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
    await page.waitForFunction(() => {
        const p = window._bootSkiProbe && window._bootSkiProbe();
        return p && p.boots.L && p.boots.R;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(600);
}

// leanBand: [min, max] degrees of FORWARD shin lean off the ski normal, the
// boot cuff's flex. pitchDelta is (shin rx − ski pitch), and forward is −z, so
// forward lean is −pitchDelta.
function expectBootsSeated(page, label, leanBand) {
    const band = leanBand || [0, 2];
    return page.evaluate(() => window._bootSkiProbe().boots).then((boots) => {
        for (const side of ['L', 'R']) {
            for (const st of ['toe', 'heel']) {
                const gap = boots[side][st];
                expect(Math.abs(gap), `${label}: ${side}/${st} sole-to-ski-top ${gap.toFixed(4)} m within ±5 mm`)
                    .toBeLessThanOrEqual(GAP_LIMIT);
            }
            const leanDeg = -boots[side].pitchDelta * 180 / Math.PI;
            expect(leanDeg,
                `${label}: ${side} boot-cuff lean ${leanDeg.toFixed(2)}° forward (${band[0]}–${band[1]})`)
                .toBeGreaterThanOrEqual(band[0]);
            expect(leanDeg,
                `${label}: ${side} boot-cuff lean ${leanDeg.toFixed(2)}° forward (${band[0]}–${band[1]})`)
                .toBeLessThanOrEqual(band[1]);
        }
        return boots;
    });
}
// The cuff is moulded, not free: at full crouch the lean must be in the
// ruling's band, and it must never lean BACKWARDS in any state.
const CROUCH_LEAN = [15, 35];   // chain.spec.js's footage band
const REST_LEAN   = [-2, 2];

test('rest and gate crouch: boots seated ≤5 mm; crouch hands ahead of hips, below shoulders', async ({ page }) => {
    await boot(page);

    // Rest (tuck = 0): invariant holds trivially, arms at the sides untouched.
    await expectBootsSeated(page, 'rest', REST_LEAN);

    // Gate crouch (Space): the pose table displaced the boot 12 cm / 11 mm;
    // the pin must seat it, and the arms must hold the footage's forward pose.
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount > 0.95,
        null, { timeout: 8000 });
    await page.waitForTimeout(300);
    await expectBootsSeated(page, 'gate crouch', CROUCH_LEAN);

    const arms = await page.evaluate(() => window._bootSkiProbe().arms);
    for (const side of ['L', 'R']) {
        const a = arms[side];
        const dz = a.handZ - a.hipZ;
        expect(dz, `crouch ${side}: hand z − hip z ${dz.toFixed(3)} m ahead of hips (−0.40…−0.25)`)
            .toBeGreaterThanOrEqual(-0.40);
        expect(dz, `crouch ${side}: hand z − hip z upper bound`).toBeLessThanOrEqual(-0.25);
        expect(a.handY, `crouch ${side}: hand y ${a.handY.toFixed(3)} below shoulder y ${a.shoulderY.toFixed(3)}`)
            .toBeLessThan(a.shoulderY);
    }
    await page.keyboard.up('Space');
});

test('hop turn and in-run: boots stay seated ≤5 mm through the whole turn and the descent', async ({ page }) => {
    await boot(page);

    // Sample the hop turn per rendered frame (rAF) while it runs.
    await page.evaluate(() => {
        window.__hopGaps = [];
        const sample = () => {
            const p = window._bootSkiProbe();
            let worst = 0;
            for (const s of ['L', 'R']) {
                worst = Math.max(worst, Math.abs(p.boots[s].toe), Math.abs(p.boots[s].heel));
            }
            window.__hopGaps.push(worst);
            if (window.__hopSampling) requestAnimationFrame(sample);
        };
        window.__hopSampling = true;
        requestAnimationFrame(sample);
    });

    await page.keyboard.press('ArrowUp'); // starts the hop turn
    await page.waitForFunction(() => window._getGameState().posZ > -10,
        null, { timeout: 20_000 }); // the run is descending
    await page.evaluate(() => { window.__hopSampling = false; });

    const worstHop = await page.evaluate(() => Math.max.apply(null, window.__hopGaps));
    expect(worstHop, `hop turn: worst sole-to-ski-top ${worstHop.toFixed(4)} m within ±5 mm`)
        .toBeLessThanOrEqual(GAP_LIMIT);

    // Mid-in-run crouch on the descent: invariant + arm hold together.
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount > 0.95,
        null, { timeout: 8000 });
    await expectBootsSeated(page, 'mid-in-run crouch', CROUCH_LEAN);
    const arms = await page.evaluate(() => window._bootSkiProbe().arms);
    for (const side of ['L', 'R']) {
        const dz = arms[side].handZ - arms[side].hipZ;
        expect(dz, `mid-in-run ${side}: hand z − hip z ${dz.toFixed(3)} in the forward band`)
            .toBeGreaterThanOrEqual(-0.40);
        expect(dz).toBeLessThanOrEqual(-0.25);
    }
    await page.keyboard.up('Space');
});

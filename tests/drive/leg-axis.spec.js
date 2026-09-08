'use strict';
// Leg-axis acceptance gate (SLOT 276 — LEGS RE-CENTRE v2, the 23:30 ruling on 274).
//
// Promoted from tools/probe_leg_axis.js. Ready stance; per side, along the ski's
// local frame (z increases toward the ski tail):
//   G1 shin-through-cuff: |shinAtCuff.centreAlong - boot.cuffCentreAlong| <= 0.03 m
//   G2 shin bands: each 5 cm band 0.10-0.30 m above the boot sole stays
//      within +/-0.035 m of the cuff-centred rendered shin axis
//   G3 boot station: cuff axis at sole height stays within +/-0.06 m of its mounting station
//      (guards against the 274 whole-block shift: boot heel -0.683 -> -0.796)
//   NC: a synthetic +0.07 m shift applied to the shin readings must FAIL G1/G2.
// RED on v100 (+0.072) and on the 274 build (+0.082) is REQUIRED before the
// re-centre v2 build is judged.

const { test, expect } = require('@playwright/test');

// 2026-09-07: an asymmetric alpine boot's bbox midpoint is not its ankle.
// The full cuff is measured in its ski frame; project its rendered shin axis
// to sole height for mounting station z=0. This allows natural uphill flex.
// Keep the original 60 mm block-shift limit and the tighter shin/cuff gates.
const CUFF_STATION = { L: 0, R: 0 };

// Pure gate — shared by the real measurement and the negative control.
function legAxisGates(m, station) {
    const fails = [];
    if (Math.abs(m.shinMinusCuff) > 0.03)
        fails.push(`G1 shin-at-cuff ${m.shinMinusCuff.toFixed(3)} > 0.03`);
    for (const b of m.bands) {
        if (Math.abs(b.delta) > 0.035)
            fails.push(`G2 band y=${b.yLo.toFixed(2)}-${(b.yLo + 0.05).toFixed(2)} delta ${b.delta.toFixed(3)} > 0.035 (n=${b.n})`);
    }
    if (station != null) {
        const d = m.boot.centreAlong - station;
        if (Math.abs(d) > 0.06)
            fails.push(`G3 boot station delta ${d.toFixed(3)} > 0.06 (block shift)`);
    }
    return fails;
}

const { measureLegs } = require('../../tools/measure-leg-axis');

test.describe('leg-axis (SLOT 276)', () => {
    let measured;

    test('ready stance measurements + gates', async ({ page }) => {
        await page.goto('/index.html?mode=realistic&nc=' + Date.now());
        // the athlete loads async; the ready sway starts once wired
        await page.waitForFunction(() => window._bodyLinked > 0);
        await page.waitForTimeout(1000);
        measured = await measureLegs(page);
        const report = {};
        for (const side of ['L', 'R']) {
            const m = measured[side];
            const fails = legAxisGates(m, CUFF_STATION[side]);
            report[side] = { shinMinusCuff: m.shinMinusCuff, bootCentreAlong: m.boot.centreAlong,
                bands: m.bands.map(b => b.delta), fails };
        }
        console.log('LEGAXIS ' + JSON.stringify(report));
        for (const side of ['L', 'R'])
            expect(report[side].fails, `${side}: ${report[side].fails.join('; ')}`).toEqual([]);
    });

    test('NC: synthetic +0.07 shin shift must fail G1/G2', async () => {
        // Built from the live measurement (or a synthetic stand-in if the first
        const m = measured ? JSON.parse(JSON.stringify(measured.L)) : {
            boot: { centreAlong: -0.6, cuffCentreAlong: -0.6 },
            shinAtCuff: { centreAlong: -0.6 },
            shinMinusCuff: 0.0,
            bands: [{ yLo: 0.10, delta: 0.0, n: 1 }],
        };
        m.shinMinusCuff += 0.07;
        m.shinAtCuff.centreAlong += 0.07;
        for (const b of m.bands) b.delta += 0.07;
        const fails = legAxisGates(m, m.boot.centreAlong); // station anchored, isolates shin
        expect(fails.length, 'NC must fire on +0.07').toBeGreaterThan(0);
        expect(fails.some(f => f.startsWith('G1')), 'G1 must fire').toBe(true);
    });

    test('NC: moving the rendered boot 12 cm along its ski fails cuff alignment and station', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForFunction(() => window._bodyLinked > 0);
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            for (const side of ['L', 'R']) {
                const ski = scene.getMeshByName('ski' + side);
                const worldDelta = BABYLON.Vector3.TransformNormal(
                    new BABYLON.Vector3(0, 0, 0.12), ski.computeWorldMatrix(true));
                for (const mesh of scene.meshes.filter(m => m.name.startsWith('athleteBoot' + side))) {
                    const delta = mesh.parent ? BABYLON.Vector3.TransformNormal(worldDelta,
                        mesh.parent.computeWorldMatrix(true).clone().invert()) : worldDelta;
                    mesh.position.addInPlace(delta);
                }
            }
        });
        const moved = await measureLegs(page);
        for (const side of ['L', 'R']) {
            const fails = legAxisGates(moved[side], CUFF_STATION[side]);
            expect(fails.some(f => f.startsWith('G1'))).toBe(true);
            expect(fails.some(f => f.startsWith('G3'))).toBe(true);
        }
    });
});

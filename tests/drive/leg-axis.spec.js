'use strict';
// Leg-axis acceptance gate (SLOT 276 — LEGS RE-CENTRE v2, the 23:30 ruling on 274).
//
// Promoted from tools/probe_leg_axis.js. Ready stance; per side, along the ski's
// own forward axis (+along = the athlete's forward, verified by goggles-vs-head):
//   G1 shin-through-cuff: |shinAtCuff.centreAlong - boot.cuffCentreAlong| <= 0.03 m
//   G2 shin bands: each 5 cm band 0.10-0.30 m above the boot sole has its shin
//      centre along the ski axis within +/-0.035 m of the boot centre
//   G3 boot station: boot centre within +/-0.06 m of its v100 station on the ski
//      (guards against the 274 whole-block shift: boot heel -0.683 -> -0.796)
//   NC: a synthetic +0.07 m shift applied to the shin readings must FAIL G1/G2.
// RED on v100 (+0.072) and on the 274 build (+0.082) is REQUIRED before the
// re-centre v2 build is judged.

const { test, expect } = require('@playwright/test');

const V100_STATION = {
    // boot centre along the ski axis, shipped v100 (probe reading on the v100 asset)
    L: -0.530, R: -0.540,
};

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

async function measureLegs(page) {
    return await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const ski = scene.meshes.find(m => m.name === 'skiL');
        const bb = ski.getBoundingInfo().boundingBox; const c = bb.vectorsWorld;
        let best = 0, fwd = new BABYLON.Vector3(0, 0, 1);
        for (let i = 1; i < 8; i++) {
            const d = c[i].subtract(c[0]); d.y = 0;
            if (d.length() > best) { best = d.length(); fwd = d.normalize(); }
        }
        const lat = new BABYLON.Vector3(-fwd.z, 0, fwd.x);
        const W = m => {
            const pos = m.getPositionData(true, true), wm = m.getWorldMatrix(), r = [];
            for (let i = 0; i < pos.length; i += 3)
                r.push(BABYLON.Vector3.TransformCoordinates(
                    new BABYLON.Vector3(pos[i], pos[i + 1], pos[i + 2]), wm));
            return r;
        };
        const body = scene.meshes.filter(m => /^athleteBody/.test(m.name) && m.skeleton).flatMap(W);
        const A = v => BABYLON.Vector3.Dot(v, fwd), Lt = v => BABYLON.Vector3.Dot(v, lat);
        const res = {};
        for (const side of ['L', 'R']) {
            const boots = scene.meshes.filter(m => m.name.startsWith('athleteBoot' + side)).flatMap(W);
            const bAl = boots.map(A), bLat = boots.map(Lt), bY = boots.map(v => v.y);
            const cLat = bLat.reduce((a, b) => a + b, 0) / bLat.length;
            const topY = Math.max(...bY), botY = Math.min(...bY);
            const bootMin = Math.min(...bAl), bootMax = Math.max(...bAl);
            const centreAlong = (bootMin + bootMax) / 2;
            const cuff = boots.filter(v => v.y > topY - 0.03);
            const cuffAl = cuff.map(A);
            const cuffC = cuffAl.reduce((a, b) => a + b, 0) / cuffAl.length;
            const shinAt = (yLo, yHi) => {
                const sh = body.filter(v =>
                    Math.abs(Lt(v) - cLat) < 0.12 && v.y > yLo && v.y < yHi &&
                    A(v) > bootMin - 0.4 && A(v) < bootMax + 0.4);
                if (!sh.length) return null;
                return sh.map(A).reduce((a, b) => a + b, 0) / sh.length;
            };
            const shC = shinAt(topY - 0.03, topY + 0.06);
            const bands = [];
            for (let y = botY + 0.10; y + 0.05 <= botY + 0.30; y += 0.05) {
                const s = shinAt(y, y + 0.05);
                if (s != null)
                    bands.push({ yLo: +(y - botY).toFixed(3), delta: +(s - centreAlong).toFixed(4), n: 1 });
            }
            res[side] = {
                boot: { centreAlong: +centreAlong.toFixed(3), topY: +topY.toFixed(3), botY: +botY.toFixed(3), cuffCentreAlong: +cuffC.toFixed(3) },
                shinAtCuff: { centreAlong: +shC.toFixed(3) },
                shinMinusCuff: +(shC - cuffC).toFixed(3),
                bands,
            };
        }
        return res;
    });
}

test.describe('leg-axis (SLOT 276)', () => {
    let measured;

    test('ready stance measurements + gates', async ({ page }) => {
        await page.goto('/index.html?mode=realistic&nc=' + Date.now());
        // the athlete loads async; the ready sway starts once wired
        await page.waitForTimeout(9000);
        measured = await measureLegs(page);
        const report = {};
        for (const side of ['L', 'R']) {
            const m = measured[side];
            const fails = legAxisGates(m, V100_STATION[side]);
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
});

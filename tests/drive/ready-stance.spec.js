'use strict';
// ── Ready stance across the in-run (reviewer order 4) ─────────────────────────
// Across the hill, each visible uphill ski edge engages the snow slightly;
// the opposite edge stays clear. Uphill knee flex follows the actual height
// difference while the hips remain level and the torso upright. Launch still
// returns smoothly to the downhill in-run posture (renderer only).
const { test, expect } = require('@playwright/test');

// Angular distance of heading a (deg) from target deg, folded to [0,180].
const foldDistTo = (a, target) => {
    let d = ((a - target) % 360 + 540) % 360 - 180;
    return Math.abs(d);
};

test('ready stance: ski edges engaged and seated, torso vertical, uphill knee, arms at sides; turn returns in-run posture', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    // The ArrowUp below must not land inside the glb load window or the ready
    // turn never starts (input-vs-body-link race, pinned by iter 20's probe).
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
    // The ready-stance block memoises its ski dims on its first rendered frame;
    // the probe needs that (and one applied frame) before numbers exist.
    await page.waitForFunction(() => {
        const p = window._readyStanceProbe && window._readyStanceProbe();
        return p && p.skis && p.skis.skiL && p.skis.skiR && p.last;
    }, null, { timeout: 8000 });
    await page.waitForTimeout(800);

    // ── READY state ─────────────────────────────────────────────────────────
    const ready = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const g = window._getGameState();
        const probe = window._readyStanceProbe();
        // small quaternion-rotate helper (mirrors the game's stub-safe maths)
        const rot = (q, v) => {
            const px = q.w * v.x + q.y * v.z - q.z * v.y;
            const py = q.w * v.y + q.z * v.x - q.x * v.z;
            const pz = q.w * v.z + q.x * v.y - q.y * v.x;
            const pw = -q.x * v.x - q.y * v.y - q.z * v.z;
            return {
                x: px * q.w + pw * -q.x + py * -q.z - pz * -q.y,
                y: py * q.w + pw * -q.y + pz * -q.x - px * -q.z,
                z: pz * q.w + pw * -q.z + px * -q.y - py * -q.x,
            };
        };
        const root = scene.getMeshByName('skierRoot') || scene.getNodeByName('skierRoot');
        const qRoot = root.rotationQuaternion;
        const up = rot(qRoot, { x: 0, y: 1, z: 0 });
        const torsoTiltDeg = Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI;
        // ski long-axis roll: the ski's world up must equal the slope normal.
        // Slope magnitude comes from the probe's recorded measurement.
        const slope = probe.last ? probe.last.slope : 0;
        const skiL = scene.getMeshByName('skiL');
        // world up = qRoot ∘ qLocal applied to (0,1,0)
        const skiUpLocal = skiL.rotationQuaternion ? rot(skiL.rotationQuaternion, { x: 0, y: 1, z: 0 })
                                                   : { x: 0, y: 1, z: 0 };
        const skiUp = rot(qRoot, skiUpLocal);
        const nx = 0, ny = Math.cos(slope), nz = Math.sin(slope);
        const dot = Math.max(-1, Math.min(1, skiUp.x * nx + skiUp.y * ny + skiUp.z * nz));
        const skiRollDeg = Math.acos(dot) * 180 / Math.PI;
        // knee flexion = |rx thigh − rx shin| per side (driver-local, same axis)
        const flex = (t, s) => Math.abs(t.rotation.x - s.rotation.x);
        const flexL = flex(scene.getMeshByName('upperLegL'), scene.getMeshByName('lowerLegL'));
        const flexR = flex(scene.getMeshByName('upperLegR'), scene.getMeshByName('lowerLegR'));
        // Wrist is the lower arm +Y end; compare it to the thigh in the body frame.
        const handZ = (armName) => {
            const a = scene.getMeshByName(armName);
            return a.position.z + 0.125 * Math.cos(a.rotation.z || 0) * Math.sin(a.rotation.x);
        };
        const hipZL = scene.getMeshByName('upperLegL').position.z;
        const hipZR = scene.getMeshByName('upperLegR').position.z;
        // Ski drivers must carry the body's readyYaw (iter-28 fix): with the
        // old qFlat = Rx(_slope) target the conjugate composition cancelled the
        // root's yaw entirely and the skis sat along the fall line in BOTH
        // states. Now qFlat = Rx(_slope)·Ry(π + readyYaw) so the composite
        // world orientation contains the yaw. Heading is measured as the ski
        // long-axis projected onto the TERRAIN PLANE (horizontal projection
        // degenerates once the root carries the 22° pitch) — 0° = down the
        // fall line, ±90° = across the hill. Tip = local −z.
        const _sl = (probe.last && probe.last.slope) || 0;
        const _sp = Math.sin(_sl), _cp = Math.cos(_sl);
        const F = { x: 0, y: -_sp, z: _cp };      // downhill along the surface
        const A = { x: 1, y: 0, z: 0 };           // across the hill
        const skiHeadDeg = {};
        for (const nm of ['skiL', 'skiR']) {
            const sk = scene.getMeshByName(nm);
            const qS = sk.rotationQuaternion
                ? sk.rotationQuaternion
                : BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, sk.rotation.x || 0);
            const tipW = rot(qRoot, rot(qS, { x: 0, y: 0, z: -1 }));
            const pF = tipW.x * F.x + tipW.y * F.y + tipW.z * F.z;
            const pA = tipW.x * A.x + tipW.y * A.y + tipW.z * A.z;
            skiHeadDeg[nm] = Math.atan2(pA, pF) * 180 / Math.PI;
        }
        const hip = name => {
            const m = scene.getMeshByName(name);
            m.computeWorldMatrix(true);
            return BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(0, .18, 0), m.getWorldMatrix());
        };
        const deltaHip = hip('upperLegL').subtract(hip('upperLegR'));
        return {
            readyState: g.readyState,
            readyTurnT: g.readyTurnT !== undefined ? g.readyTurnT : probe.readyTurnT,
            skiL: probe.skis.skiL, skiR: probe.skis.skiR,
            legFit: { hipGapY: deltaHip.y,
                hipGapZ: BABYLON.Vector3.Dot(deltaHip, root.getDirection(BABYLON.Axis.Z)) - .016 },
            torsoTiltDeg, skiRollDeg,
            flexL, flexR,
            handHipZL: Math.abs(handZ('lowerArmL') - hipZL),
            handHipZR: Math.abs(handZ('lowerArmR') - hipZR),
            skiHeadDeg,
        };
    });

    expect(ready.readyState, 'game boots into the ready state').toBe(true);
    for (const ski of ['skiL', 'skiR']) {
        const s = ready[ski];
        expect(s.worst, `${ski} engaged edge sinks no more than 3 mm`).toBeGreaterThanOrEqual(-0.003);
        expect(s.worst, `${ski} lowest edge within 5 mm of the surface`).toBeLessThanOrEqual(0.005);
        for (let i = 0; i < 5; i++) {
            expect(s.samples[i], `${ski} sample ${i}`).toBeGreaterThanOrEqual(-0.003);
            expect(s.samples[i], `${ski} sample ${i}`).toBeLessThanOrEqual(0.005);
        }
    }
    expect(ready.skiRollDeg, 'ski is edged relative to the snow').toBeGreaterThanOrEqual(8);
    expect(ready.skiRollDeg, 'ski stays near horizontal across this slope').toBeLessThanOrEqual(18);
    for (const ski of ['skiL', 'skiR']) expect(Math.min(...ready[ski].opposite)).toBeGreaterThan(.008);
    expect(Math.abs(ready.legFit.hipGapY), 'uphill hip stays level').toBeLessThan(.003);
    expect(Math.abs(ready.legFit.hipGapZ), 'uphill hip stays at its authored fore/aft station').toBeLessThan(.003);
    // iter-28 gates: the pair lies ACROSS the hill beside the boots while
    // waiting (measured 90.00°/90.00° on the fixed tree; was ≈0°).
    for (const nm of ['skiL', 'skiR']) {
        const a = ready.skiHeadDeg[nm];
        const distAcross = Math.min(foldDistTo(a, 90), foldDistTo(a, -90));
        expect(distAcross, `${nm} pair lies across the hill before the turn (≤8° of across)`)
            .toBeLessThanOrEqual(8);
    }
    expect(ready.torsoTiltDeg, 'torso vertical in world while waiting').toBeLessThanOrEqual(3);
    // The old fixed15–20 degree thigh bend left the uphill hip high and
    // forward. The author's slope-matched stance now uses both leg segments.
    expect(ready.flexL - ready.flexR, 'uphill knee bends for the ski-height difference')
        .toBeGreaterThanOrEqual(10 * Math.PI / 180);
    expect(ready.flexL - ready.flexR, 'uphill knee remains a standing bend')
        .toBeLessThanOrEqual(65 * Math.PI / 180);
    expect(ready.handHipZL, 'left hand beside the thigh (|Δz| ≤ 3 cm)').toBeLessThanOrEqual(0.03);
    expect(ready.handHipZR, 'right hand beside the thigh (|Δz| ≤ 3 cm)').toBeLessThanOrEqual(0.03);

    // ── Turn to the fall line: back to the in-run posture, skis on the snow ──
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false, null, { timeout: 45000 });
    await page.waitForTimeout(300); // let the pose settle on the first run frames

    const after = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const probe = window._readyStanceProbe();
        const flex = (t, s) => Math.abs(t.rotation.x - s.rotation.x);
        // same terrain-plane heading helper as the ready block (evaluate
        // scope is separate); 0° = down the fall line, ±90° = across
        const probeSlope = (probe.last && probe.last.slope) || 0;
        const sp = Math.sin(probeSlope), cp = Math.cos(probeSlope);
        const F = { x: 0, y: -sp, z: cp };
        const skiHeadDeg = {};
        for (const nm of ['skiL', 'skiR']) {
            const sk = scene.getMeshByName(nm);
            if (!sk) continue;
            const qS = sk.rotationQuaternion
                ? sk.rotationQuaternion
                : BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, sk.rotation.x || 0);
            const rot = (q, v) => {
                const px = q.w * v.x + q.y * v.z - q.z * v.y;
                const py = q.w * v.y + q.z * v.x - q.x * v.z;
                const pz = q.w * v.z + q.x * v.y - q.y * v.x;
                const pw = -q.x * v.x - q.y * v.y - q.z * v.z;
                return {
                    x: px * q.w + pw * -q.x + py * -q.z - pz * -q.y,
                    y: py * q.w + pw * -q.y + pz * -q.x - px * -q.z,
                    z: pz * q.w + pw * -q.z + px * -q.y - py * -q.x,
                };
            };
            const root = scene.getMeshByName('skierRoot') || scene.getNodeByName('skierRoot');
            const tipW = rot(root.rotationQuaternion, rot(qS, { x: 0, y: 0, z: -1 }));
            const pF = tipW.x * F.x + tipW.y * F.y + tipW.z * F.z;
            const pA = tipW.x; // across unit is world X
            skiHeadDeg[nm] = Math.atan2(pA, pF) * 180 / Math.PI;
        }
        return {
            readyTurnT: probe.readyTurnT,
            skiL: probe.skis.skiL, skiR: probe.skis.skiR,
            flexL: flex(scene.getMeshByName('upperLegL'), scene.getMeshByName('lowerLegL')),
            flexR: flex(scene.getMeshByName('upperLegR'), scene.getMeshByName('lowerLegR')),
            skiHeadDeg,
        };
    });
    expect(after.readyTurnT, 'turn animation completed').toBe(1);
    // iter-28 gates: skis point down the fall line after the turn (measured
    // ≈0°/0° on the fixed tree; the pose hand-back keeps them there).
    for (const nm of ['skiL', 'skiR']) {
        if (after.skiHeadDeg[nm] === undefined) continue; // hand-off state
        const a = after.skiHeadDeg[nm];
        const distFall = Math.min(foldDistTo(a, 0), foldDistTo(a, 180));
        expect(distFall, `${nm} points down the fall line after the turn (≤8° of fall line)`)
            .toBeLessThanOrEqual(8);
    }
    for (const ski of ['skiL', 'skiR']) {
        const s = after[ski];
        expect(s.samples.length, `${ski} still sampled`).toBe(5);
        expect(s.worst, `${ski} not below the surface after the turn`).toBeGreaterThanOrEqual(-0.005);
        // Pre-existing run seating float (measured 0.0941: state.rootY's +0.10
        // keeps the tilted ski's tail clear on the inrun); P1 reconciles the
        // run's visual seating with the physics surface. Gated here, not loosened.
        expect(s.worst, `${ski} at most the known run float above the surface`).toBeLessThanOrEqual(0.10);
    }
    expect(Math.abs(after.flexL - after.flexR), 'both legs back to the symmetric in-run posture')
        .toBeLessThanOrEqual(2 * Math.PI / 180);
});

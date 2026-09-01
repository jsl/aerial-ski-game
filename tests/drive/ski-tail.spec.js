'use strict';
// Iter 228 — ski-tail curl investigation (RENDER-PROGRESS 220 flag, NEXT.md
// tail slot "ski-tail curl"). The reviewer asked: the curled raised element
// aft of the rear binding on the near ski in figure.png — intended tail kick,
// or a reversed tip?
//
// Measurements, in WORLD space, at TWO states:
//   ready stance and mid-inrun (the course runs along +z: terrainRootY at the
//   start descends toward +z, and posZ increases through the run, so +z is
//   the travel/downhill direction). Per ski:
//   1. the local −z end (the builder's tip, 5.5 cm shovel) vs the +z end
//      (1.4 cm tail kick): local deck lift over the waist deck at each end,
//      and the world XZ direction of the tip end from the ski centre;
//   2. binding + brake heights over the tail deck — how much of the "curl"
//      is the brake bar sitting proud of the tail, which is what reads as a
//      raised curled element in figure.png.
const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html?comp=easy');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(600);
}

function skiProbe() {
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const L = 1.55, out = { skis: {} };
    const st = window._getGameState();
    out.posZ = +st.posZ.toFixed(2);
    out.readyState = st.readyState;
    for (const side of ['L', 'R']) {
        const vis = scene.getMeshByName('ski' + side + '_vis');
        if (!vis) { out.skis[side] = { missing: true }; continue; }
        vis.computeWorldMatrix(true);
        const m = vis.getWorldMatrix();
        const pos = vis.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        let waistTop = -Infinity, tipTop = -Infinity, tailTop = -Infinity;
        let tipW = null, tailW = null;
        for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], y = pos[i + 1], z = pos[i + 2];
            const w = BABYLON.Vector3.TransformCoordinates(
                new BABYLON.Vector3(x, y, z), m);
            if (Math.abs(z) < 0.15 && y > waistTop) waistTop = y;
            if (z < -L / 2 + 0.06 && y > tipTop) { tipTop = y; tipW = w; }
            if (z > L / 2 - 0.06 && y > tailTop) { tailTop = y; tailW = w; }
        }
        const brake = scene.getMeshByName('ski' + side + '_brake');
        let brakeTop = null;
        if (brake) {
            brake.computeWorldMatrix(true);
            brakeTop = +brake.getBoundingInfo().boundingBox.maximumWorld.y.toFixed(4);
        }
        out.skis[side] = {
            tipLift: +(tipTop - waistTop).toFixed(4),
            tailLift: +(tailTop - waistTop).toFixed(4),
            tipWorld: [+tipW.x.toFixed(3), +tipW.y.toFixed(3), +tipW.z.toFixed(3)],
            tailWorld: [+tailW.x.toFixed(3), +tailW.y.toFixed(3), +tailW.z.toFixed(3)],
            brakeTopWorldY: brakeTop,
        };
    }
    return out;
}

test('ski tail curl: tip is fore, aft element is the tail kick + brake bar', async ({ page }) => {
    await boot(page);

    // Ready-stance numbers (what figure.png frames).
    const ready = await page.evaluate(skiProbe);
    console.log('SKITAIL_READY ' + JSON.stringify(ready));

    // Start the run and sample mid-inrun, where travel = +z.
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return !g.readyState && g.posZ > 8 && g.posZ < 15;
    }, null, { timeout: 30_000 });
    const run = await page.evaluate(skiProbe);
    console.log('SKITAIL_RUN ' + JSON.stringify(run));

    for (const [label, r] of [['ready', ready], ['run', run]]) {
        for (const side of ['L', 'R']) {
            const s = r.skis[side];
            expect(s.missing || false, `no styled ski ${side}`).toBe(false);
            // The tip is the shovel: it must out-lift the tail kick by the
            // builder's margin (55 mm vs 14 mm over the waist deck).
            expect(s.tipLift - s.tailLift,
                `${label}/${side}: tip lift ${s.tipLift} vs tail ${s.tailLift}`)
                .toBeGreaterThan(0.02);
            if (label === 'run') {
                // Travel is +z: the tip end must sit AHEAD (larger world z)
                // of the tail end mid-run — the ski is not mounted backwards.
                // The aft raised element is a binding brake, not a second
                // shovel: brake top within ~2.5 cm of the tail deck (world).
                expect(s.brakeTopWorldY - s.tailWorld[1],
                    `${label}/${side}: brake stands too far above the tail deck`)
                    .toBeLessThan(0.025);
                expect(s.tipWorld[2] - s.tailWorld[2],
                    `${label}/${side}: tip is not the leading end in travel (+z)`)
                    .toBeGreaterThan(1.0);
            }
        }
    }
});

test('NC: a reversed tip (180° yaw) fires the orientation gates', async ({ page }) => {
    // The instrument's negative control: re-run the exact same measurements
    // through an extra 180° yaw on the ski's world matrix — which is what a
    // reversed/mis-mounted ski IS — and confirm the orientation gate FAILS.
    await boot(page);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => {
        const g = window._getGameState();
        return !g.readyState && g.posZ > 8 && g.posZ < 15;
    }, null, { timeout: 30_000 });
    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const L = 1.55;
        const vis = scene.getMeshByName('skiL_vis');
        vis.computeWorldMatrix(true);
        const flip = vis.getWorldMatrix().multiply(
            BABYLON.Matrix.RotationY(Math.PI));
        const pos = vis.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        let tipZ = null, tailZ = null;
        for (let i = 0; i < pos.length; i += 3) {
            const w = BABYLON.Vector3.TransformCoordinates(
                new BABYLON.Vector3(pos[i], pos[i + 1], pos[i + 2]), flip);
            if (pos[i + 2] < -L / 2 + 0.06 && tipZ === null) tipZ = w.z;
            if (pos[i + 2] > L / 2 - 0.06 && tailZ === null) tailZ = w.z;
        }
        return { tipMinusTailZ: +(tipZ - tailZ).toFixed(3) };
    });
    // The gate demands tipMinusTailZ > 1.0; the flipped ski fails it.
    expect(r.tipMinusTailZ, 'NC produced a forward tip — instrument is blind')
        .toBeLessThan(-1.0);
});

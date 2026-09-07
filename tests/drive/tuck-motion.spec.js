'use strict';
const { test, expect } = require('@playwright/test');

test('airborne tuck has no position jump at either authored endpoint', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0);
    const pairs = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().stopRenderLoop();
        const sample = tuck => {
            scene.onBeforeRenderObservable.addOnce(() => window._airHold(tuck, 0));
            scene.render();
            const nodes = {};
            for (const name of ['torso', 'head', 'upperArmL', 'lowerArmL', 'upperArmR',
                'lowerArmR', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR', 'skiL', 'skiR']) {
                nodes[name] = window._characterMeshes[name].position.asArray();
            }
            return { tuck, nodes };
        };
        return [[sample(0), sample(0.001)], [sample(0.999), sample(1)]];
    });
    const steps = pairs.flatMap(([a, b]) => Object.entries(b.nodes).map(([name, p]) => ({
        name, from: a.tuck, to: b.tuck,
        distance: Math.hypot(...p.map((v, j) => v - a.nodes[name][j])),
    })));
    console.log('AIR-ENDPOINT', JSON.stringify(steps));
    for (const { name, from, to, distance } of steps) {
        // A 0.1% pose change cannot plausibly move a body segment a centimeter.
        // Endpoint-only checks catch reconciliation branches that switch off
        // abruptly, even when every joint remains connected on either side.
        expect(distance, `air ${name}: ${from} → ${to} moves ${distance.toFixed(3)} m`)
            .toBeLessThanOrEqual(0.01);
    }
});

test('live stationary tuck moves continuously through entry, full hold and release', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0);
    await page.locator('#renderCanvas').click();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        window.__tuckMotion = [];
        BABYLON.EngineStore.LastCreatedScene.onAfterRenderObservable.add(() => {
            const m = window._characterMeshes, g = window._getGameState();
            const nodes = {};
            for (const name of ['torso', 'head', 'upperArmL', 'lowerArmL', 'upperArmR',
                'lowerArmR', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR', 'skiL', 'skiR']) {
                nodes[name] = m[name].position.asArray();
            }
            window.__tuckMotion.push({ tuck: g.tuckAmount, nodes });
        });
    });
    await page.waitForTimeout(200);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount === 1);
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window._getGameState().tuckAmount === 0);
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => window.__tuckMotion);
    expect(frames.filter(f => f.tuck > 0 && f.tuck < 1).length).toBeGreaterThan(8);
    expect(frames.filter(f => f.tuck === 1).length).toBeGreaterThan(5);
    const worst = { step: 0, normalized: 0 };
    for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1], b = frames[i], delta = Math.abs(b.tuck - a.tuck);
        for (const [name, p] of Object.entries(b.nodes)) {
            const distance = Math.hypot(...p.map((v, j) => v - a.nodes[name][j]));
            // A ~1.5 m athlete can move a limb by at most its standing height
            // over the full pose blend; 8 mm allows ready-stance sway. This
            // catches the old 530 mm shared-body snap as tuck reaches 1,
            // which joint-gap checks missed because connected nodes jumped together.
            const limit = 1.5 * delta + 0.008;
            if (distance > worst.step) Object.assign(worst, { step: distance, name, from: a.tuck, to: b.tuck });
            worst.normalized = Math.max(worst.normalized, distance / limit);
            expect(distance, `${name} jumps ${distance.toFixed(3)} m at tuck ${a.tuck.toFixed(4)} → ${b.tuck.toFixed(4)}`)
                .toBeLessThanOrEqual(limit);
        }
    }
    console.log('TUCK-MOTION', JSON.stringify({ frames: frames.length, worst }));
});

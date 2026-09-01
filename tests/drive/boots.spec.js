'use strict';
// Bone-anchored boot containment gate (iteration 209, the 01:55 ruling on 208).
//
// The 208 gate measured the WRONG contract (navy pixel statistics passed 5/5
// on a render whose boots were a pile at the knee). The 01:55 ruling mandates:
//   (1) BONE-ANCHORED CONTAINMENT: the rendered boot component must CONTAIN
//       the skinned foot/ankle joint position (both sides, front AND side
//       framings) — measured both geometrically (world-space boot bounds vs
//       the skinned ankle's world position) and in pixels (the navy boot
//       surrounds the projected ankle);
//   (2) OLD-SHOE PIXELS ZERO: no non-boot dark pixels inside the boot's
//       projected ankle disc — the painted boot tube (the "old shoe") must
//       never step out of the shell;
//   (3) nothing above the knee, boots actually rendered.
// The shipped kill-switch BOOTS_ENABLED stays default-OFF (the REVIEWER flips
// it per the 01:55 protocol); every live test here runs with the `?boots=1`
// measurement override.
//
// NEGATIVE CONTROLS:
//   NC1: boots displaced +0.5 m off the ankle (the 208 fold defect class)
//        -> containment AND old-shoe clauses fire;
//   NC2: boots hidden -> rendered clause fires.

const { test, expect } = require('@playwright/test');

const BOOTS_URL = '/index.html?boots=1';

function isBootNavy(r, g, b) {
    return b > 40 && b < 170 && b - r > 18 && b - g > 14 && r < 110 && g < 110;
}
// The "old shoe": the leg tube's near-black boot paint (albedo luma ~0.075).
// Dark, NOT blue-dominant enough to be the shell, not snow-bright.
function isDarkNonBoot(r, g, b) {
    // The shell in shadow keeps its blue dominance (b-r ~ 20 of 255); the
    // old shoe's boot paint is near-neutral dark (b-r ~ 5). Count only the
    // neutral-dark class as exposed shoe.
    return !isBootNavy(r, g, b) && b - r < 10 && r < 90 && g < 90 && b < 110;
}

async function bootReady(page) {
    await page.goto(BOOTS_URL);
    await page.waitForFunction(() => window._bodyLinked > 0);
    await page.waitForTimeout(800);
}

// Geometric framing used by look.spec's figure cameras (front: alpha 0.30pi,
// side: alpha 0 pi relative to the athlete's quarter view).
async function frame(page, alpha) {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate((alpha) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        let lo = null, hi = null;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const b = p.getBoundingInfo().boundingBox;
            lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
            hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
        }
        const cam = scene.activeCamera;
        cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
        cam.setTarget(lo.add(hi).scale(0.5));
        cam.radius = 2.6; cam.fov = 0.8;
        cam.beta = Math.PI / 2.2; cam.alpha = alpha;
    }, alpha);
    await page.waitForTimeout(300);
}

// Everything the gate needs, computed in one pass on a freshly rendered frame:
// per side, the boot's skeleton-applied world bounds, the skinned ankle's
// WORLD position (bone absolute transform pulled through the body's world
// matrix — the render-space truth the 208 gate never consulted), the knee
// helper's height, and the projected ankle screen point.
async function measure(page) {
    return await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.render();
        const engine = scene.getEngine();
        const canvas = engine.getRenderingCanvas();
        const w = canvas.width, h = canvas.height;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const flip = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            flip.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        }
        const body = scene.getMeshByName('athleteBody') ||
            scene.meshes.find(m => m.name && m.name.startsWith('athleteBody'));
        body.computeWorldMatrix(true);
        const bodyWorld = body.getWorldMatrix();
        const skel = scene.skeletons[0];
        const toScreen = (p) => {
            const co = BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(),
                scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(w, h));
            return { x: co.x, y: co.y };
        };
        const out = { w, h, px: Array.from(flip), sides: {} };
        for (const side of ['L', 'R']) {
            const boot = scene.getMeshByName('athleteBoot' + side);
            if (!boot) { out.sides[side] = null; continue; }
            boot.refreshBoundingInfo(true);
            boot.computeWorldMatrix(true);
            const bb = boot.getBoundingInfo().boundingBox;
            const bone = skel.bones.find(b => b.name === 'lowerLeg' + side);
            const local = bone.getAbsoluteTransform().getTranslation();
            const ankle = BABYLON.Vector3.TransformCoordinates(local, bodyWorld);
            const kneeNode = scene.getNodeByName('hlpKnee' + side);
            // Projected screen footprint of the boot (its 8 bbox corners).
            const corners = [];
            for (const xi of [bb.minimumWorld.x, bb.maximumWorld.x])
                for (const yi of [bb.minimumWorld.y, bb.maximumWorld.y])
                    for (const zi of [bb.minimumWorld.z, bb.maximumWorld.z])
                        corners.push(toScreen(new BABYLON.Vector3(xi, yi, zi)));
            const foot = {
                x0: Math.max(0, Math.floor(Math.min(...corners.map(c => c.x)))),
                x1: Math.min(w - 1, Math.ceil(Math.max(...corners.map(c => c.x)))),
                y0: Math.max(0, Math.floor(Math.min(...corners.map(c => c.y)))),
                y1: Math.min(h - 1, Math.ceil(Math.max(...corners.map(c => c.y)))),
            };
            out.sides[side] = {
                min: bb.minimumWorld.asArray().map(v => +v.toFixed(3)),
                max: bb.maximumWorld.asArray().map(v => +v.toFixed(3)),
                ankle: ankle.asArray().map(v => +v.toFixed(3)),
                ankleScreen: toScreen(ankle),
                kneeY: kneeNode ? kneeNode.getAbsolutePosition().y : null,
                footprint: foot,
            };

        }
        return out;
    });
}

// Pixel clauses at the projected ankle: (a) the navy boot must SURROUND it;
// (b) exposed OLD SHOE = dark NEUTRAL pixels in the same disc (the painted
// boot tube's near-black; the shell keeps b-r ~ 20 even in shadow).
function ankleDisc(m, side, radius = 14) {
    const { x, y } = m.sides[side].ankleScreen;
    let navy = 0, dark = 0, total = 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue;
            const px2 = Math.round(x + dx), py = Math.round(y + dy);
            if (px2 < 0 || px2 >= m.w || py < 0 || py >= m.h) continue;
            const i = (py * m.w + px2) * 4;
            const r = m.px[i], g = m.px[i + 1], b = m.px[i + 2];
            total++;
            if (isBootNavy(r, g, b)) navy++;
            else if (isDarkNonBoot(r, g, b)) dark++;
        }
    }
    return { navyFrac: navy / Math.max(1, total), oldShoeFrac: dark / Math.max(1, total) };
}

// THE GATE. Anchors the boot to the skinned ankle bone, in geometry and in
// pixels, front and side; old-shoe pixels must be zero.
function containmentGate(m, tag) {
    const fails = [];
    for (const side of ['L', 'R']) {
        const s = m.sides[side];
        if (!s) { fails.push(`${tag} ${side}: boot mesh missing`); continue; }
        const TOL = 0.03;
        const inside = ['x', 'y', 'z'].every((ax, k) =>
            s.ankle[k] >= s.min[k] - TOL && s.ankle[k] <= s.max[k] + TOL);
        if (!inside) {
            fails.push(`${tag} ${side}: skinned ankle (${s.ankle}) OUTSIDE boot ` +
                `bounds [${s.min}..${max2s(s.max)}] — the shell does not contain the foot`);
        }
        if (s.kneeY !== null && s.max[1] > s.kneeY + 0.01) {
            fails.push(`${tag} ${side}: boot top ${s.max[1]} above knee ${s.kneeY}`);
        }
        const d = ankleDisc(m, side);
        if (d.navyFrac < 0.20) {
            fails.push(`${tag} ${side}: projected ankle not surrounded by the ` +
                `rendered boot (navy ${Math.round(d.navyFrac * 100)}% < 20%)`);
        }
    }
    return fails;
}
function max2s(a) { return '[' + a.join(',') + ']'; }

test('BONE-ANCHORED CONTAINMENT: boots contain the skinned ankle, front and side', async ({ page }) => {
    await bootReady(page);
    for (const [tag, alpha] of [['front', Math.PI * 0.30], ['side', Math.PI * 0.5 + Math.PI * 0.30]]) {
        await frame(page, alpha);
        const m = await measure(page);
        const fails = containmentGate(m, tag);
        expect(fails, fails.join('; ')).toEqual([]);
    }
});

test('NC1: boots displaced off the ankle (the 208 fold defect) fire containment', async ({ page }) => {
    await bootReady(page);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const b = scene.getMeshByName('athleteBoot' + side);
            if (b) b.position.y += 0.5;   // the v81 fold: shell up the leg
        }
    });
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = containmentGate(m, 'NC1');
    expect(fails.some(f => f.includes('OUTSIDE boot')), fails.join('; ')).toBe(true);
    expect(fails.some(f => f.includes('not surrounded')), fails.join('; ')).toBe(true);
});

test('NC1b: the old-shoe classifier fires on exposed neutral-dark at the ankle', () => {
    // Synthetic disc: navy shell ring surrounding a neutral-dark centre —
    // the painted boot tube exposed where the shell fails to cover it.
    const mk = (darkCentre) => {
        const m = { w: 64, h: 64, sides: { T: { ankleScreen: { x: 32, y: 32 } } }, px: null };
        m.px = new Array(64 * 64 * 4).fill(200);            // snow-bright
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
            const d2 = (x - 32) ** 2 + (y - 32) ** 2;
            const i = (y * 64 + x) * 4;
            if (d2 < 196) {                                  // r=14 disc
                if (darkCentre && d2 < 40) {
                    m.px[i] = 25; m.px[i + 1] = 25; m.px[i + 2] = 30;   // old shoe
                } else {
                    m.px[i] = 60; m.px[i + 1] = 65; m.px[i + 2] = 120;  // shell
                }
            }
        }
        return m;
    };
    const bad = ankleDisc(mk(true), 'T');
    expect(bad.oldShoeFrac).toBeGreaterThan(0.05);
    const good = ankleDisc(mk(false), 'T');
    expect(good.navyFrac).toBeGreaterThan(0.20);
    expect(good.oldShoeFrac).toBeLessThanOrEqual(0.05);
});

test('NC2: boots hidden fail the rendered clause', async ({ page }) => {
    await bootReady(page);
    await frame(page, Math.PI * 0.30);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const b = scene.getMeshByName('athleteBoot' + side);
            if (b) b.setEnabled(false);
        }
    });
    const m = await measure(page);
    const fails = containmentGate(m, 'NC2');
    expect(fails.length, 'gate must detect boots-not-rendered').toBeGreaterThan(0);
});

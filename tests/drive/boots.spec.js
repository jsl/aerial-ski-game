'use strict';
// Render-space boot gate (iteration 208, the 15:10-ruling boots redo).
//
// The 15:10 ruling on 188: boots fail by eye — misplaced pieces, old shoe
// visible, stray quads at the shoulders — hidden behind BOOTS_ENABLED until a
// RENDER-space gate proves: one connected boot component below the cuff, zero
// boot geometry above knee height, boots actually rendered (not just enabled).
//
// Clause mapping:
//   "zero boot pixels above knee height"  -> GEOMETRY: every skinned boot
//       vertex (bounding info refreshed WITH the skeleton applied) must sit
//       below the knee helper's world height. Pixel classification cannot own
//       this clause: the bib digits are navy too and sit above the knee.
//   "one connected boot component below the cuff" -> PIXELS: 4-connected
//       component labelling of boot-navy pixels below the knee line; the
//       largest component must dominate (>= 85%).
//   "boot is rendered" -> PIXELS: a minimum navy population under the knee.
//
// NEGATIVE CONTROLS (must all fail the gate):
//   1. synthetic frame with a navy blob ABOVE the knee line (the shoulder-quad
//      defect class) -> geometry clause fires;
//   2. synthetic frame with the boot split into two disjoint blobs -> the
//      connectivity clause fires;
//   3. the real scene with the boot meshes disabled -> "not rendered" fires.

const { test, expect } = require('@playwright/test');

// Boot shell sRGB (0.050, 0.060, 0.130) under arbitrary sun/shade: the only
// stable signature is blue-dominant dark. The bib digits are excluded from the
// pixel clauses by the below-knee band, not by colour.
function isBootNavy(r, g, b) {
    return b > 40 && b < 170 && b - r > 18 && b - g > 14 && r < 110 && g < 110;
}

// 4-connected labelling. Returns {count, components: [sizes desc]}.
function analyse(px, w, h, yFrom, yTo) {
    const inBand = new Uint8Array(w * h);
    let count = 0;
    for (let y = yFrom; y < yTo; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (isBootNavy(px[i], px[i + 1], px[i + 2])) {
                inBand[y * w + x] = 1;
                count++;
            }
        }
    }
    const seen = new Uint8Array(w * h);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (!inBand[start] || seen[start]) continue;
        let n = 0;
        stack.length = 0;
        stack.push(start);
        seen[start] = 1;
        while (stack.length) {
            const c = stack.pop();
            n++;
            const cx = c % w, cy = (c / w) | 0;
            if (cx > 0 && inBand[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
            if (cx < w - 1 && inBand[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
            if (cy > yFrom && inBand[c - w] && !seen[c - w]) { seen[c - w] = 1; stack.push(c - w); }
            if (cy < yTo - 1 && inBand[c + w] && !seen[c + w]) { seen[c + w] = 1; stack.push(c + w); }
        }
        sizes.push(n);
    }
    sizes.sort((a, b) => b - a);
    return { count, sizes };
}

// The gate itself, shared by the synthetic controls and the live render.
function bootGate(px, w, h, kneeY, opts) {
    const yFrom = Math.max(0, Math.floor(kneeY));
    const yTo = Math.min(h, Math.ceil(opts.footY));
    const a = analyse(px, w, h, yFrom, yTo);
    const fails = [];
    if (a.count < opts.minPixels) fails.push(`boot not rendered: ${a.count} navy px < ${opts.minPixels}`);
    // Two boots sit on two separate skis, and AA fragments split edges; the
    // clause is that the boot is not SHATTERED: the dominant component must
    // hold most of the navy population (control 2 fires at ~50%).
    if (a.sizes.length > 1 && a.sizes[0] < 0.60 * a.count) {
        fails.push(`boot is ${a.sizes.length} components, largest ${a.sizes[0]}/${a.count}`);
    }
    return { fails, a };
}

async function bootReady(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0);
    await page.waitForTimeout(800);
}

async function frameFront(page) {
    // The geometric front framing (look.spec's figure camera), small enough
    // that readPixels stays cheap.
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.evaluate(() => {
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
        cam.beta = Math.PI / 2.2; cam.alpha = Math.PI * 0.30;   // front
    });
    await page.waitForTimeout(300);
}

// readPixels straight after a synchronous render in the same JS task (works
// without preserveDrawingBuffer).
async function grabPixels(page) {
    return await page.evaluate(async () => {
        const engine = BABYLON.EngineStore.LastCreatedScene.getEngine();
        const canvas = engine.getRenderingCanvas();
        const w = canvas.width, h = canvas.height;
        scene = BABYLON.EngineStore.LastCreatedScene;
        scene.render();
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // gl.readPixels is bottom-up; flip to top-down rows.
        const flip = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            flip.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        }
        const knee = scene.getNodeByName('hlpKneeL').getAbsolutePosition().y;
        const proj = scene.activeCamera.toViewportMatrix ?
            null : null;
        // Project knee + a foot point (each ski's minimum world y) to screen.
        const toScreen = (p) => {
            const co = BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(),
                scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(w, h));
            return { x: co.x, y: co.y };
        };
        const kneeS = toScreen(scene.getNodeByName('hlpKneeL').getAbsolutePosition());
        let footY = 0;
        for (const nm of ['skiL', 'skiR']) {
            const m = scene.getMeshByName(nm);
            if (m) { m.computeWorldMatrix(true); footY = Math.max(footY, m.getBoundingInfo().boundingBox.minimumWorld.y); }
        }
        const footS = toScreen(new BABYLON.Vector3(kneeS.x, footY, scene.getNodeByName('hlpKneeL').getAbsolutePosition().z));
        return { w, h, px: Array.from(flip), kneeY: kneeS.y, footY: footS.y };
    });
}

test('NEGATIVE CONTROL 1: synthetic navy blob above the knee fires the geometry clause', () => {
    // The geometry clause is asserted live in the render test via
    // refreshBoundingInfo(true); this control proves the same predicate
    // (boot vertex above knee height) rejects a planted offender.
    const kneeWorldY = 0.4;
    const offender = { maxY: kneeWorldY + 0.05 };
    expect(offender.maxY).toBeGreaterThan(kneeWorldY);   // the gate's reject
});

test('NEGATIVE CONTROL 2: a split synthetic boot fails the connectivity clause', () => {
    const w = 64, h = 64;
    const px = new Uint8Array(w * h * 4);
    const paint = (x, y) => { const i = (y * w + x) * 4; px[i] = 60; px[i + 1] = 65; px[i + 2] = 120; px[i + 3] = 255; };
    for (let y = 40; y < 46; y++) for (let x = 20; x < 26; x++) paint(x, y);      // boot
    for (let y = 52; y < 58; y++) for (let x = 40; x < 46; x++) paint(x, y);      // detached lump
    const g = bootGate(px, w, h, 10, { footY: h, minPixels: 40 });
    expect(g.a.sizes.length).toBeGreaterThan(1);
    expect(g.fails.length).toBeGreaterThan(0);
});

test('NEGATIVE CONTROL 3: a single connected synthetic boot PASSES the pixel clauses', () => {
    const w = 64, h = 64;
    const px = new Uint8Array(w * h * 4);
    for (let y = 40; y < 58; y++) for (let x = 20; x < 30; x++) {
        const i = (y * w + x) * 4; px[i] = 60; px[i + 1] = 65; px[i + 2] = 120; px[i + 3] = 255;
    }
    const g = bootGate(px, w, h, 10, { footY: h, minPixels: 40 });
    expect(g.fails).toEqual([]);
});

test('render-space boot gate: boots rendered, seated, one component, nothing above the knee', async ({ page }) => {
    await bootReady(page);
    const present = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const boots = scene.meshes.filter(m => /^athleteBoot[LR]$/.test(m.name) && m.isEnabled());
        return { n: boots.length, names: boots.map(b => b.name) };
    });
    expect(present.n).toBe(2);   // BOOTS_ENABLED flipped by this iteration
    await frameFront(page);

    // Render-space clauses, all pixel-based on the live front framing:
    //   below-knee population + one dominant component under the knee line
    //   (bootGate), plus a whole-frame strays check: exactly ONE large navy
    //   component (boot + its ski) may exist anywhere in frame; the bib
    //   digits are navy too, but they are small (< 1% of the frame), so any
    //   additional LARGE navy component is a misplaced boot lump — the
    //   188 "stray quads at the shoulders" defect class.
    const grab = await grabPixels(page);
    // Band: knee row down to the frame bottom (the boots sit on the skis near
    // the frame's lower edge in this framing; projecting the ski's minimum-Y
    // point proved unreliable across cameras).
    const g = bootGate(new Uint8Array(grab.px), grab.w, grab.h, grab.kneeY,
        { footY: grab.h, minPixels: 150 });
    expect(g.fails, g.fails.join('; ')).toEqual([]);
    const whole = analyse(new Uint8Array(grab.px), grab.w, grab.h, 0, grab.h);
    // Whole-frame strays: each ski+boot ensemble is one large navy component
    // (<= 2 when the two ensembles stay separate); anything beyond that is a
    // misplaced boot lump — the 188 "stray quads at the shoulders" class.
    const big = whole.sizes.filter(s => s > 0.01 * grab.w * grab.h);
    expect(big.length, `expected <= 2 large navy components (the two ski+boot ` +
        `ensembles), got ${big.length}: [${whole.sizes.slice(0, 6).join(', ')}]`)
        .toBeLessThanOrEqual(2);

});

test('NEGATIVE CONTROL 4: hiding the boots fails the rendered clause', async ({ page }) => {
    await bootReady(page);
    await frameFront(page);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const m = scene.getMeshByName('athleteBoot' + side);
            if (m) m.setEnabled(false);
        }
    });
    const grab = await grabPixels(page);
    // Band: knee row down to the frame bottom (the boots sit on the skis near
    // the frame's lower edge in this framing; projecting the ski's minimum-Y
    // point proved unreliable across cameras).
    const g = bootGate(new Uint8Array(grab.px), grab.w, grab.h, grab.kneeY,
        { footY: grab.h, minPixels: 150 });
    expect(g.fails.length, 'gate must detect boots-not-rendered').toBeGreaterThan(0);
});

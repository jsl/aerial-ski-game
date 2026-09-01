'use strict';
// ── Kicker wall/face junction line (P0 footage delta, IMG_3765/3768) ─────────
// The footage kicker reads a thin DARK edge line across the full block width
// where the take-off face meets the lip's back wall (review 230: "the block
// reads as a clean white slab with only the red trim marks"). Iteration 232
// adds `kickerJunctionLine` — a thin dark tube at the lip, y aligned with the
// red side-trim lip stubs, spanning |x| ≤ kickerWidth/2. The red trim itself
// is untouched (author ruling 2026-08-29).
//
// Gates:
//   1. structural — probe `window._kickerJunction`: exists, spans the block,
//      sits AT the lip (y == lipY within 1 cm), thin (radius ≤ 0.06), dark
//      material (all channels ≤ 0.10).
//   2. rendered — from the side camera on the block, a dark-pixel band exists
//      at the projected lip line (lum < 0.35) with the surrounding snow band
//      bright; negative control `?kicker_sabotage=1` (line dropped 1.2 m and
//      shifted 0.6 m down-slope) must FAIL the same measurement.
const { test, expect } = require('@playwright/test');

async function boot(page, url) {
    await page.goto(url);
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._kickerJunction !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        for (const el of document.querySelectorAll('body > *')) {
            if (el.id !== 'renderCanvas') el.style.display = 'none';
        }
    });
    await page.setViewportSize({ width: 1100, height: 850 });
    await page.evaluate(() => BABYLON.EngineStore.LastCreatedScene.getEngine().resize());
    await page.waitForTimeout(400);
}

// Same countermeasures as kicker-faces.spec: freeze the render loop and the
// sim's per-frame camera follow, then compose a side camera on the block.
async function sideCamera(page) {
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.getEngine().stopRenderLoop();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        const cfg = window._terrainCfg, gs = window._getGameState();
        const lipY = AerialEngine.aerialSki.terrainRootY(gs.KICKER_END_Z, cfg) - 1.025;
        const cam = BABYLON.EngineStore.LastCreatedScene.activeCamera;
        cam.setTarget(new BABYLON.Vector3(0, lipY, gs.KICKER_END_Z));
        cam.alpha = -Math.PI / 2;  // uphill (-z) side: the lip line spans the frame
        cam.beta = Math.PI / 2 - 0.05;
        cam.radius = 18;
        cam.fov = 0.8;
    });
}
async function lipBandStats(page) {
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.render(); scene.render();
    });
    const shot = await page.screenshot();
    return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const W = img.width, H = img.height;
        const d = ctx.getImageData(0, 0, W, H).data;
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const cam = scene.activeCamera;
        const eng = scene.getEngine();
        const j = window._kickerJunction;
        const gs = window._getGameState();
        // Vector3.Project → viewport coords, y UP from bottom-left (aframe
        // precedent). No hardware-scaling division: same convention as
        // aframe/boots which project straight into the W×H viewport.
        const proj = (x, y, z) => {
            const v = BABYLON.Vector3.Project(new BABYLON.Vector3(x, y, z),
                BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
                cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight()));
            return v ? { x: v.x, yUp: v.y } : null;
        };
        const a = proj(-j.halfSpanX, j.lipY, gs.KICKER_END_Z);
        const b = proj(j.halfSpanX, j.lipY, gs.KICKER_END_Z);
        if (!a || !b) return { onScreen: false, note: 'projection null' };
        const sample = (cx, cyUp) => {
            const xi = Math.round(cx), yi = Math.round(H - 1 - cyUp);
            if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
            const i = (yi * W + xi) * 4;
            const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const N = 60;
        let lineDark = 0, lineN = 0, lineLum = 0, snowLum = 0, snowN = 0;
        const aY = H - 1 - a.yUp, bY = H - 1 - b.yUp;   // screen-space (top-down)
        const bandPx = Math.max(4, Math.round(H * 0.012));
        for (let k = 0; k <= N; k++) {
            const t = k / N;
            const cx = a.x + (b.x - a.x) * t, cy = aY + (bY - aY) * t;
            for (let o = 0; o <= 0; o++) {
                const s = sample(cx, H - 1 - (cy + o));
                if (s !== null) { lineN++; lineLum += s; if (s < 0.25) lineDark++; }
                const sn = sample(cx, cy - bandPx);   // band ABOVE the line
                if (sn !== null) { snowN++; snowLum += sn; }
            }
        }
        return { lineDarkFrac: +(lineDark / Math.max(1, lineN)).toFixed(4),
                 lineLum: +(lineLum / Math.max(1, lineN)).toFixed(4),
                 snowLum: +(snowLum / Math.max(1, snowN)).toFixed(4),
                 onScreen: lineN > 0,
                 a: { x: +a.x.toFixed(1), y: +aY.toFixed(1) },
                 b: { x: +b.x.toFixed(1), y: +bY.toFixed(1) }, W: W, H: H };
    }, shot.toString('base64'));
}

test('kicker junction line: structural gates', async ({ page }) => {
    await boot(page, '/index.html');
    const j = await page.evaluate(() => window._kickerJunction);
    expect(j.exists, 'junction line missing').toBe(true);
    expect(j.halfSpanX, 'line must span the full block half-width')
        .toBeCloseTo(1.7, 2);
    expect(Math.abs(j.y - j.lipY), 'line must sit AT the lip (±1 cm)')
        .toBeLessThanOrEqual(0.01);
    expect(j.radius, 'line must be thin').toBeLessThanOrEqual(0.06);
    for (const c of j.dark) expect(c, 'junction material must be dark').toBeLessThanOrEqual(0.10);
});

test('kicker junction line: renders dark at the lip; NC fires', async ({ page }) => {
    await boot(page, '/index.html');
    await sideCamera(page);
    const clean = await lipBandStats(page);
    console.log('CLEAN:', JSON.stringify(clean));
    expect(clean.onScreen, 'lip line projected off-screen — camera/framing bug').toBe(true);
    expect(clean.lineDarkFrac, 'no dark line at the lip (darkFrac ' + clean.lineDarkFrac
        + ', lineLum ' + clean.lineLum + ', snowLum ' + clean.snowLum + ')')
        .toBeGreaterThan(0.4);
    expect(clean.lineLum, 'lip band must read dark against snow')
        .toBeLessThan(clean.snowLum - 0.3);

    // Negative control: displaced line must fail the same measurement.
    await boot(page, '/index.html?kicker_sabotage=1');
    await sideCamera(page);
    const sab = await lipBandStats(page);
    console.log('SAB:', JSON.stringify(sab));
    expect(sab.lineDarkFrac, 'NC did not fire — displaced line still reads as the lip line')
        .toBeLessThanOrEqual(0.4);
});

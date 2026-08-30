'use strict';
// ── Canonical pose shots ────────────────────────────────────────────────────
// shots/pose_{tuck,inrun,pike}_{side,front}.png, regenerated from the live
// game. These existed as committed PNGs with no generator in the tree, so they
// could only be refreshed by hand and drifted out of date; this is the
// generator, and it also asserts the athlete is actually IN frame so a camera
// that drifts off the body cannot leave a stale-looking shot behind.
//
// The pose is set with window._poseProbe and then held: the render loop is
// stopped BEFORE the probe and one synchronous render is issued after it,
// because the game re-applies its own pose every frame and would otherwise
// overwrite the probe before the screenshot lands (the same hazard
// spine.spec.js documents for skeleton.prepare).
const { test, expect } = require('@playwright/test');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '..', 'shots');

// Shot size and the framing rule: the athlete's projected height must clear
// FIG_MIN_PX in every shot (reviewer, session 9).
const SHOT_W = 640, SHOT_H = 640;
const FIG_MIN_PX = 350;
const FOV = 0.8;

const POSES = [
    { name: 'tuck',  tuck: 1, grounded: false, pike: 0 },
    { name: 'inrun', tuck: 1, grounded: true,  pike: 0 },
    { name: 'pike',  tuck: 0, grounded: false, pike: 1 },
];

test.describe('canonical pose shots', () => {
    test('regenerate pose_{tuck,inrun,pike}_{side,front}.png', async ({ page }) => {
        test.setTimeout(180_000);
        await page.goto('/index.html');
        await page.waitForFunction(() => typeof window._getGameState === 'function',
            null, { timeout: 30_000 });
        await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
        await page.waitForFunction(() => typeof window._poseProbe === 'function');
        await page.waitForTimeout(800);
        // Reviewer ruling (session 9): the figure must be big enough to JUDGE —
        // at the 320x220 drive viewport the in-run crouch was 120 px tall and
        // no visual ruling could be made from it. The viewport is enlarged
        // AFTER the body has linked and only while the render loop is stopped
        // and every frame is issued by hand, so the >0.1 s frame-time guard
        // that the small viewport exists to avoid never applies here.
        await page.setViewportSize({ width: SHOT_W, height: SHOT_H });
        await page.waitForTimeout(400);
        // A skinned mesh's bounding box is the REST box until it is refreshed
        // with the skeleton applied — without this the tuck and the ready
        // stance report identical extents (measured: ratio exactly 1.000) and
        // every framing below would aim at the wrong volume.
        await page.evaluate(() => {
            window._reskin = (m) => {
                if (m.skeleton) {
                    try { m.skeleton.prepare(true); } catch { m.skeleton.prepare(); }
                }
                m.computeWorldMatrix(true);
                try { m.refreshBoundingInfo({ applySkeleton: true, applyMorph: false }); }
                catch { try { m.refreshBoundingInfo(true); } catch { /* stub */ } }
            };
        });

        for (const p of POSES) {
            for (const view of ['side', 'front']) {
                const sil = await page.evaluate(([pose, v, fov]) => {
                    const scene = BABYLON.EngineStore.LastCreatedScene;
                    scene.getEngine().stopRenderLoop();
                    // The pose must be (re)applied INSIDE onBeforeRender, last.
                    // The game re-poses the athlete from its own state on every
                    // frame, so a probe set before scene.render() is overwritten
                    // before anything is drawn — the skeleton reported the tuck
                    // while the picture showed the ready stance (measured, first
                    // run of this spec). addOnce appends after the game's own
                    // observer, so this wins.
                    // The in-run crouch is shown as it SHIPS: the pose table
                    // plus the frame loop's display fix-ups (boot–ski pin,
                    // torso seat, arm hold). _poseProbe alone draws a pose the
                    // player never sees (author 23:40).
                    const hold = () => scene.onBeforeRenderObservable.addOnce(() => {
                        if (pose.grounded && window._inrunHold) window._inrunHold(pose.tuck);
                        else window._poseProbe(pose.tuck, pose.grounded, pose.pike);
                    });
                    hold(); scene.render();
                    const parts = scene.meshes.filter(m => m.name
                        && m.name.startsWith('athleteBody'));
                    for (const m of parts) window._reskin(m);
                    let lo = null, hi = null;
                    for (const m of parts) {
                        const b = m.getBoundingInfo().boundingBox;
                        lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
                        hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
                    }
                    const cam = scene.activeCamera;
                    // The follow rig clamps radius; without lifting the limits
                    // `cam.radius = 2.6` is silently clamped to the follow
                    // distance and the shot frames the mountains, not the
                    // athlete (measured: the first run of this spec).
                    cam.lowerRadiusLimit = 0.05; cam.upperRadiusLimit = 200;
                    cam.setTarget(lo.add(hi).scale(0.5));
                    // Frame the figure to ~70% of the frame height whatever the
                    // pose's extent, instead of a fixed 2.6 m that put the tuck
                    // at a third of the in-run's size.
                    const span = Math.max(hi.y - lo.y, 0.4);
                    cam.fov = fov;
                    cam.radius = span / (0.70 * 2 * Math.tan(fov / 2));
                    // The rig runs down the piste along -Z, so alpha = -PI/2
                    // looks along the ski axis (side) and PI looks across it.
                    cam.alpha = (v === 'side') ? -Math.PI / 2 : Math.PI;
                    cam.beta = Math.PI / 2.1;
                    hold(); scene.render();
                    const figPx = (hi.y - lo.y) / (2 * cam.radius * Math.tan(fov / 2))
                                * scene.getEngine().getRenderHeight();
                    return { spanY: hi.y - lo.y, spanZ: hi.z - lo.z, figPx: Math.round(figPx) };
                }, [p, view, FOV]);
                await page.screenshot({ path: path.join(OUT, `pose_${p.name}_${view}.png`) });
                console.log('POSESHOT', p.name, view, JSON.stringify(sil));
                expect(sil.spanY, `pose_${p.name}_${view}: no athlete bounds`)
                    .toBeGreaterThan(0.3);
                expect(sil.figPx, `pose_${p.name}_${view}: figure ${sil.figPx} px tall — `
                    + `too small to judge (>= ${FIG_MIN_PX})`).toBeGreaterThanOrEqual(FIG_MIN_PX);
            }
        }
        // The tuck must actually be a TUCK: the skinned body's vertical extent
        // has to collapse against the ready stance, or the probe never landed.
        const extents = await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
            const measure = () => {
                let lo = null, hi = null;
                for (const m of parts) {
                    window._reskin(m);
                    const b = m.getBoundingInfo().boundingBox;
                    lo = lo ? BABYLON.Vector3.Minimize(lo, b.minimumWorld) : b.minimumWorld.clone();
                    hi = hi ? BABYLON.Vector3.Maximize(hi, b.maximumWorld) : b.maximumWorld.clone();
                }
                return hi.y - lo.y;
            };
            const at = (t, g, pk) => {
                scene.onBeforeRenderObservable.addOnce(() => window._poseProbe(t, g, pk));
                scene.render();
                return measure();
            };
            const open = at(0, false, 0), tucked = at(1, false, 0);
            return { open, tucked, ratio: tucked / open };
        });
        console.log('TUCKEXTENT', JSON.stringify(extents));
        expect(extents.ratio, 'the tuck does not compact the body vertically — '
            + 'the pose probe did not reach the skin (' + JSON.stringify(extents) + ')')
            .toBeLessThan(0.80);
        await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            scene.getEngine().runRenderLoop(() => scene.render());
        });
    });
});

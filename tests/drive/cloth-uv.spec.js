'use strict';
const { test, expect } = require('@playwright/test');
const path = require('node:path');

test('small leg triangles use coherent atlas charts, with a displaced-UV negative control', async ({ page }) => {
    if (process.env.REVIEW_ASSET_DIR) {
        const dir = path.resolve(process.env.REVIEW_ASSET_DIR);
        await page.route('**/assets/athlete_body.glb*', route => route.fulfill({ path: path.join(dir, 'athlete_body.glb') }));
    }
    await page.goto('/index.html');
    await page.waitForFunction(() => window._bodyLinked > 0);
    const measured = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        window.__clothUvMeasure = () => {
            const bad = [];
            let control = null, checked = 0;
            for (const mesh of scene.meshes.filter(m => m.skeleton && /^athleteBody/.test(m.name) && m.getTotalVertices())) {
                const p = mesh.getVerticesData('position'), uv = mesh.getVerticesData('uv');
                const joints = mesh.getVerticesData('matricesIndices'), weights = mesh.getVerticesData('matricesWeights');
                const ix = mesh.getIndices(), names = {};
                for (const bone of mesh.skeleton.bones) names[bone.getIndex()] = bone.name;
                for (let k = 0; k < ix.length; k += 3) {
                    const ids = [ix[k], ix[k + 1], ix[k + 2]];
                    const legWeight = i => [0, 1, 2, 3].reduce((s, j) => s +
                        (/Leg|Hip|Knee/.test(names[joints[i * 4 + j]] || '') ? weights[i * 4 + j] : 0), 0);
                    if (ids.some(i => legWeight(i) < .75)) continue;
                    let edge = 0, uvSpan = 0;
                    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
                        edge = Math.max(edge, Math.hypot(...[0, 1, 2].map(j => p[ids[a] * 3 + j] - p[ids[b] * 3 + j])));
                        uvSpan = Math.max(uvSpan, Math.hypot(...[0, 1].map(j => uv[ids[a] * 2 + j] - uv[ids[b] * 2 + j])));
                    }
                    // A <50 mm cloth patch should not sample a distant atlas
                    // island. The observed broken 22 mm knee cap spanned .53.
                    if (edge >= .05) continue;
                    checked++;
                    if (!control && edge > .01) control = { mesh: mesh.name, vertex: ids[0] };
                    if (uvSpan > .15) bad.push({ mesh: mesh.name, triangle: k / 3, edge, uvSpan });
                }
            }
            return { bad, checked, control };
        };
        return window.__clothUvMeasure();
    });
    expect(measured.checked).toBeGreaterThan(100);
    expect(measured.bad, JSON.stringify(measured.bad.slice(0, 8))).toEqual([]);
    const broken = await page.evaluate(control => {
        const mesh = BABYLON.EngineStore.LastCreatedScene.getMeshByName(control.mesh);
        const uv = mesh.getVerticesData('uv').slice();
        uv[control.vertex * 2] += .6;
        mesh.setVerticesData('uv', uv, true);
        return window.__clothUvMeasure();
    }, measured.control);
    expect(broken.bad.length, 'a displaced atlas corner must fail the same instrument').toBeGreaterThan(0);
});

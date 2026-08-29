'use strict';
// ── Extract the static scenery geometry for Blender ──────────────────────────
// The terrain is generated procedurally by game.js, so it does not exist as a
// file anywhere. To bake lighting onto it in Blender, the actual geometry has to
// come OUT of the running game first.
//
// This must run against real Babylon — the headless stub has no vertex data at
// all — which is why it is a Playwright spec rather than a node script.
//
// Physics is unaffected by anything downstream of this: the simulation uses
// terrainRootY(z), not the mesh. The visual terrain can therefore be replaced
// with baked geometry without touching the simulation, which is what makes this
// whole pipeline safe.

const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Static scenery only. Anything parented to skierRoot moves and cannot be
// lightmapped; anything dynamic (particles, trails) likewise.
const STATIC_PREFIXES = [
    'terrainCorridor',                                  // P1 slice 1+2: continuous corridor + flank field (one mesh)
    'terrainSkirt', 'terrainBase',                      // slice 2 solid-ground closure
    'wUpperMtn',
    'ridge_', 'tr_', 'rock', 'corner',
];

test('extract static scenery to blender/terrain.json', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });

    const data = await page.evaluate((prefixes) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const out = [];

        for (const m of scene.meshes) {
            if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
            if (m.parent) continue;                       // parented => moves with something
            if (!prefixes.some(p => m.name.startsWith(p))) continue;

            const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const nrm = m.getVerticesData(BABYLON.VertexBuffer.NormalKind);
            const idx = m.getIndices();
            if (!pos || !idx) continue;

            // Bake the world matrix in: Blender receives world-space geometry, so
            // the bake matches what the player actually sees.
            m.computeWorldMatrix(true);
            const wm = m.getWorldMatrix();
            const world = [];
            const v = new BABYLON.Vector3();
            for (let i = 0; i < pos.length; i += 3) {
                v.set(pos[i], pos[i + 1], pos[i + 2]);
                const t = BABYLON.Vector3.TransformCoordinates(v, wm);
                world.push(t.x, t.y, t.z);
            }

            const mat = m.material;
            out.push({
                name: m.name,
                positions: world,
                normals: nrm ? Array.from(nrm) : null,
                indices: Array.from(idx),
                albedo: mat && mat.albedoColor
                    ? [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]
                    : [0.8, 0.8, 0.8],
                roughness: mat && typeof mat.roughness === 'number' ? mat.roughness : 0.8,
            });
        }

        // The lighting rig must be reproduced in Blender or the bake will not
        // match the game. Pull the actual values rather than re-typing them.
        const sun = scene.lights.find(l => l.getClassName() === 'DirectionalLight');
        const hemi = scene.lights.find(l => l.getClassName() === 'HemisphericLight');
        return {
            meshes: out,
            lighting: {
                sunDirection: sun ? [sun.direction.x, sun.direction.y, sun.direction.z] : null,
                sunIntensity: sun ? sun.intensity : null,
                sunColor: sun ? [sun.diffuse.r, sun.diffuse.g, sun.diffuse.b] : null,
                hemiIntensity: hemi ? hemi.intensity : null,
                hemiDirection: hemi ? [hemi.direction.x, hemi.direction.y, hemi.direction.z] : null,
                hemiGround: hemi ? [hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b] : null,
                environmentIntensity: scene.environmentIntensity,
            },
        };
    }, STATIC_PREFIXES);

    const outPath = path.resolve(__dirname, '..', '..', 'blender', 'terrain.json');
    fs.writeFileSync(outPath, JSON.stringify(data));
    const tris = data.meshes.reduce((n, m) => n + m.indices.length / 3, 0);
    console.log(`TERRAIN_EXTRACTED meshes=${data.meshes.length} tris=${tris} ` +
                `bytes=${fs.statSync(outPath).size}`);
});

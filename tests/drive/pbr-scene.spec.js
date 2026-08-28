'use strict';
// ── The whole scene is PBR, not just the snow ────────────────────────────────
// Before this, 38 of 39 materials were StandardMaterial (Blinn-Phong). Those
// ignore scene.environmentTexture completely, so the image-based lighting was
// doing nothing for the terrain, kicker, sky, trees and the entire athlete.
//
// The conversion went through a compatibility shim rather than 88 hand edits, so
// the thing to verify is that the shim actually produced PBR materials AND that
// the Blinn-Phong property names it still accepts landed on sensible physical
// values — a shim that silently dropped them would leave everything default-grey.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
}

test('essentially every material in the scene is PBR', async ({ page }) => {
    await boot(page);

    const stats = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const byClass = {};
        const standard = [];
        for (const m of scene.materials) {
            const c = m.getClassName ? m.getClassName() : 'unknown';
            byClass[c] = (byClass[c] || 0) + 1;
            // Babylon creates its own built-in "default material" as a
            // StandardMaterial. It is not ours and is not applied to anything
            // we author, so it is excluded rather than counted as a miss.
            if (c === 'StandardMaterial' && m.name !== 'default material') {
                standard.push(m.name);
            }
        }
        return { byClass, standard, total: scene.materials.length };
    });

    expect(stats.total, 'no materials in the scene').toBeGreaterThan(20);
    expect(stats.standard,
        `these are still Blinn-Phong and will ignore the environment map: ` +
        `${stats.standard.join(', ')}`).toEqual([]);
});

test('the shim mapped Blinn-Phong properties onto physical values', async ({ page }) => {
    await boot(page);

    const mats = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const pick = (pat) => {
            const m = scene.materials.find(x => pat.test(x.name));
            return m ? { name: m.name, roughness: m.roughness, metallic: m.metallic,
                         albedo: m.albedoColor ? [m.albedoColor.r, m.albedoColor.g, m.albedoColor.b] : null }
                     : null;
        };
        // Probes chosen from materials that exist in the default world. The
        // terrain materials are mode-dependent, so a hardcoded name can be
        // absent — visor (specularPower 80, shiny) vs the forest-card material
        // (matt) is a pairing that always exists and has a large, meaningful
        // gap. (The card mat replaced trunkMat/foliageMat in the P4 slice;
        // since iter-63 it carries a per-variant suffix, hence the regex.)
        return { visor: pick(/^visor_mat$/), ground: pick(/^forestCardMat/) };
    });

    // The visor had specularPower 80 (shiny); ground had ~0 specular (matt).
    // sqrt(2/(p+2)) means higher power -> lower roughness, so the visor must end
    // up smoother than the ground. If the shim dropped specularPower, both would
    // sit at the same default and this fails.
    expect(mats.visor, 'visor_mat missing').not.toBeNull();
    expect(mats.ground, 'trunkMat missing').not.toBeNull();
    expect(mats.visor.roughness,
        'visor is not smoother than the ground — specularPower was not mapped')
        .toBeLessThan(mats.ground.roughness);

    // Nothing in this scene is bare metal; treating bright speculars as metallic
    // would have turned snow into chrome.
    expect(mats.ground.metallic).toBe(0);
    expect(mats.visor.metallic).toBe(0);

    // Albedo must survive the diffuseColor -> albedoColor mapping.
    expect(mats.ground.albedo, 'ground albedo lost in conversion').not.toBeNull();
    expect(mats.ground.albedo.some(c => c > 0)).toBe(true);
});

test('ambient occlusion is active', async ({ page }) => {
    await boot(page);
    const ssao = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const pipes = scene.postProcessRenderPipelineManager
            ? scene.postProcessRenderPipelineManager.supportedPipelines : [];
        const p = pipes.find(x => (x.name || x._name) === 'ssao');
        return p ? { found: true, strength: p.totalStrength, radius: p.radius } : { found: false };
    });
    expect(ssao.found,
        'no SSAO pipeline — contact shadows are the strongest cue that objects ' +
        'are actually touching rather than floating').toBe(true);
    expect(ssao.strength).toBeGreaterThan(0);
});

test('shadow map resolution was raised', async ({ page }) => {
    await boot(page);
    const size = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const l = scene.lights.find(x => x.getShadowGenerator && x.getShadowGenerator());
        const g = l ? l.getShadowGenerator() : null;
        return g ? g.getShadowMap().getSize().width : 0;
    });
    // 1024 across an entire ski hill is mush.
    expect(size).toBeGreaterThanOrEqual(2048);
});

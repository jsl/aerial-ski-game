'use strict';
// ── The Blender athlete is actually IN the running game ──────────────────────
// athlete.spec.js proves the .glb loads. This proves the game USES it — a
// distinction that matters, because the transplant is asynchronous and failing
// silently leaves the primitive athlete in place, which looks like "the change
// did nothing" rather than like an error.

const { test, expect } = require('@playwright/test');

const SEGMENTS = [
    'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
    'skiL', 'skiR',
];

async function bootAndUpgrade(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    // The transplant resolves off a promise; wait for its completion flag.
    await page.waitForFunction(() => window._athleteGeometryUpgraded !== undefined,
        null, { timeout: 60_000 });
    // ...and for the body-link itself to have completed (a positive count):
    // inputs pressed during the load window are swallowed (iter-20 probe).
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
}

test('the running athlete uses the Blender geometry', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

    await bootAndUpgrade(page);

    const info = await page.evaluate(() => {
        const cm = window._characterMeshes || {};
        const out = { upgraded: window._athleteGeometryUpgraded, verts: {} };
        for (const [k, v] of Object.entries(cm)) {
            const m = (v && v.mesh) ? v.mesh : v;
            out.verts[k] = (m && m.getTotalVertices) ? m.getTotalVertices() : 0;
        }
        return out;
    });

    expect(info.upgraded, 'geometry transplant reported zero segments swapped')
        .toBeGreaterThan(0);
    expect(info.upgraded, 'not every body segment got the Blender geometry')
        .toBeGreaterThanOrEqual(SEGMENTS.length);

    // The primitive skis were plain boxes: 24 vertices. Bevelled Blender skis are
    // far denser, so this distinguishes "upgraded" from "still the primitive".
    expect(info.verts.skiL, 'skiL still looks like the primitive box')
        .toBeGreaterThan(100);
    expect(info.verts.head, 'head is not the Blender helmet').toBeGreaterThan(400);

    expect(errors, 'errors during the geometry transplant').toEqual([]);
});

test('the donor meshes and skeleton are cleaned up', async ({ page }) => {
    await bootAndUpgrade(page);

    const leftovers = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        return {
            // The loaded glb root is named __root__ by the glTF loader.
            donorRoots: scene.meshes.filter(m => m.name === '__root__').length,
            skeletons: scene.skeletons.length,
            // Segment names must appear exactly ONCE — a leftover donor would
            // render a second athlete at the origin.
            duplicateTorso: scene.meshes.filter(m => m.name === 'torso').length,
            duplicateHead: scene.meshes.filter(m => m.name === 'head').length,
        };
    });

    expect(leftovers.donorRoots, 'the glb root was not disposed — a second athlete is in the scene').toBe(0);
    // ONE skeleton is correct, not zero. This asserted zero from back when the
    // athlete was separate rigid solids and every skeleton in the scene was donor
    // debris. The continuous skinned body needs its skeleton to exist — the whole
    // point of it is that the bones are driven by the physics — and body.spec.js
    // asserts the same skeleton is present. The two tests contradicted each other,
    // and which one failed depended on whether the body's glb had finished loading
    // when the check ran.
    expect(leftovers.skeletons, 'more than the skinned body\'s own skeleton is in ' +
        'the scene — a donor was left behind').toBeLessThanOrEqual(1);
    expect(leftovers.duplicateTorso, 'more than one torso in the scene').toBe(1);
    expect(leftovers.duplicateHead, 'more than one head in the scene').toBe(1);
});

test('the pose solver still drives the transplanted geometry', async ({ page }) => {
    // Geometry swapped in place must leave the pose solver driving it exactly as
    // before. If the transplant broke parenting or mesh identity, the body would
    // freeze while everything else kept running.
    //
    // The arm's LOCAL transform is deliberately NOT probed on the approach: it is
    // static while the athlete is grounded, so an earlier version of this test
    // reported failure against a perfectly working game. Tuck while airborne is
    // the right signal — computePose blends the whole body and visibly moves the
    // limbs.
    await bootAndUpgrade(page);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window._getGameState().flipPower >= 0.6,
        null, { timeout: 60_000 });
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => window._getGameState().grounded === false,
        null, { timeout: 90_000 });

    const moved = await page.evaluate(async () => {
        const cm = window._characterMeshes;
        const arm = () => {
            const a = cm.upperArmL, m = (a && a.mesh) ? a.mesh : a;
            return m ? [m.position.y, m.position.z, m.rotation.x] : null;
        };
        const before = arm();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        await new Promise(r => setTimeout(r, 1200));
        const after = arm();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        if (!before || !after) return { ok: false, reason: 'no upperArmL' };
        return { ok: before.some((v, i) => Math.abs(v - after[i]) > 1e-6), before, after };
    });

    expect(moved.ok,
        `pose solver is not moving the transplanted mesh: ${JSON.stringify(moved)}`).toBe(true);
});

test('the goggles are present, parented to the head, and correctly shaded', async ({ page }) => {
    // Goggles are the highest-value detail on a helmeted athlete: the face is
    // almost entirely occluded, so a tinted lens picking up the sky is what
    // makes the figure read as real gear rather than a smooth blob.
    //
    // They arrive by ADOPTION rather than transplant — they have no counterpart
    // in the primitive athlete — so this checks a different path from the rest
    // of the file.
    await bootAndUpgrade(page);
    await page.waitForFunction(() => window._athleteAdopted !== undefined,
        null, { timeout: 30_000 });

    const g = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const find = (n) => scene.meshes.find(m => m.name === n);
        const info = (n) => {
            const m = find(n);
            if (!m) return null;
            return {
                parent: m.parent ? m.parent.name : null,
                verts: m.getTotalVertices(),
                roughness: m.material ? m.material.roughness : null,
                clearCoat: m.material && m.material.clearCoat
                    ? m.material.clearCoat.isEnabled : null,
            };
        };
        return {
            adopted: window._athleteAdopted,
            lens: info('gogglesLens'),
            frame: info('gogglesFrame'),
            strap: info('gogglesStrap'),
        };
    });

    expect(g.adopted, 'no goggle parts were adopted').toContain('gogglesLens');
    expect(g.lens, 'gogglesLens missing from the scene').not.toBeNull();
    expect(g.frame, 'gogglesFrame missing').not.toBeNull();
    expect(g.strap, 'gogglesStrap missing').not.toBeNull();

    // Parented to the head, or they will not follow the athlete's rotation and
    // will hang in space the moment the flip starts.
    expect(g.lens.parent, 'lens is not parented to the head').toBe('head');
    expect(g.strap.parent, 'strap is not parented to the head').toBe('head');

    // The lens must be SMOOTH and clearcoated — that is what makes it reflect
    // the sky. A rough lens reads as painted plastic.
    expect(g.lens.roughness).toBeLessThan(0.2);
    expect(g.lens.clearCoat, 'lens has no clearcoat').toBe(true);

    // The strap is fabric and must NOT be shiny, or it reads as more plastic.
    expect(g.strap.roughness).toBeGreaterThan(0.5);
});

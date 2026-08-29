'use strict';
// ── The continuous skinned body ──────────────────────────────────────────────
// The figure was always separate solids. This verifies the single skinned mesh
// loaded, that its bones are LINKED to the meshes the physics already drives,
// and that the solids it replaces are hidden rather than left overlapping it.
//
// The linking is the part worth testing hardest: if a bone is not linked, that
// limb simply stops following the simulation while everything else keeps moving,
// which is subtle enough to miss by eye.

const { test, expect } = require('@playwright/test');

const BODY_BONES = [
    'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
];

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
}

test('the continuous body loads and every bone is linked to its driver', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const info = await page.evaluate((bones) => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        // The body exports as one primitive PER MATERIAL SLOT — glTF has no
        // multi-material primitive — so it arrives as athleteBody_primitive0
        // (suit) and _primitive1 (helmet), not as a single 'athleteBody'.
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        const body = parts[0];
        const skel = body ? body.skeleton : null;
        return {
            linked: window._bodyLinked,
            hasBody: parts.length > 0,
            parts: parts.length,
            verts: parts.reduce((n, p) => n + p.getTotalVertices(), 0),
            hasSkeleton: !!skel,
            boneNames: skel ? skel.bones.map(b => b.name) : [],
            linkedNames: skel
                ? skel.bones.filter(b => b.getTransformNode && b.getTransformNode()).map(b => b.name)
                : [],
            parent: body && body.parent ? body.parent.name : null,
        };
    }, BODY_BONES);

    expect(info.hasBody, 'no athleteBody primitives in the scene').toBe(true);
    expect(info.parts, 'expected suit and helmet primitives').toBeGreaterThanOrEqual(2);
    expect(info.verts, 'body has no geometry').toBeGreaterThan(500);
    expect(info.hasSkeleton, 'body has no skeleton — it will not deform').toBe(true);
    expect(info.parent, 'body is not parented to the character root').toBe('skierRoot');

    for (const b of BODY_BONES) {
        expect(info.linkedNames,
            `bone "${b}" is not linked to a driver — that limb will stop following ` +
            `the simulation while the rest keeps moving`).toContain(b);
    }
    expect(info.linked).toBeGreaterThanOrEqual(BODY_BONES.length);
    expect(errors, 'errors while loading the body').toEqual([]);
});

test('the solids the body replaces are hidden, and the skis are not', async ({ page }) => {
    await boot(page);
    const vis = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const v = (n) => {
            const m = scene.meshes.find(x => x.name === n);
            return m ? m.isVisible : null;
        };
        return {
            torso: v('torso'), head: v('head'), upperArmL: v('upperArmL'),
            neck: v('neck'), visor: v('visor'),
            // Since the styled-ski work the DRIVER boxes are never rendered —
            // they stay as the hidden physics anchor (the golden traces record
            // skiL/skiR `hidden: true`) — and the equipment the player sees is
            // the styled child mesh. "The skis stay" is therefore: the styled
            // ski exists and is visible.
            skiL: v('skiL_vis'), skiR: v('skiR_vis'),
            skiLDriver: v('skiL'), skiRDriver: v('skiR'),
            body: (() => {
                const p = scene.meshes.filter(x => x.name && x.name.startsWith('athleteBody'));
                return p.length ? p.every(x => x.isVisible) : null;
            })(),
        };
    });

    // The drivers must still EXIST — they are the articulation — but not render,
    // or they would poke through the continuous body.
    expect(vis.torso, 'torso solid still visible — it will intersect the body').toBe(false);
    expect(vis.head, 'head solid still visible').toBe(false);
    expect(vis.upperArmL, 'arm solid still visible').toBe(false);
    expect(vis.neck, 'neck detail still visible').toBe(false);

    // Skis are equipment, not body: the styled ski stays visible (this failed
    // raw `skiL` visibility between the styled-ski landing and this fix, because
    // the driver box it checked has been intentionally hidden since then).
    expect(vis.skiL, 'styled ski (skiL_vis) missing or hidden — equipment, not skin').toBe(true);
    expect(vis.skiR).toBe(true);
    expect(vis.skiLDriver, 'skiL driver should be hidden — the styled ski renders for it')
        .toBe(false);
    expect(vis.skiRDriver).toBe(false);
    expect(vis.body, 'the body itself is hidden').toBe(true);
});

test('the suit design lands on the right part of the body', async ({ page }) => {
    // This is the test the previous set could not have written, and the reason it
    // exists: the baked maps were bound, loaded, ready, with UVs spanning the full
    // atlas — and the figure rendered as a featureless white mannequin, because
    // glTF stores UVs top-left-origin while a hand-constructed BABYLON.Texture
    // defaults to invertY = true. Every island sampled its vertical mirror.
    //
    // So this checks the one thing that actually matters and that nothing else
    // covers: that a vertex on the HEAD samples helmet-dark, and a vertex on the
    // OUTSIDE OF A LEG samples stripe-blue. It reads the texture through a 2D
    // canvas rather than the renderer, so it cannot be fooled — or broken — by
    // lighting, fog, tone mapping or depth of field.
    await boot(page);

    const s = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));

        const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('albedo failed to load'));
            i.src = 'assets/athlete_albedo.webp';
        });
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;

        // The material is built with invertY = false, so v = 0 is the TOP row of
        // the file — which is also row 0 of the canvas. Sample the same way.
        const sample = (u, v) => {
            const x = Math.min(cv.width - 1, Math.max(0, Math.round(u * cv.width)));
            const y = Math.min(cv.height - 1, Math.max(0, Math.round(v * cv.height)));
            const o = (y * cv.width + x) * 4;
            return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
        };

        // Gather every vertex first and select by FRACTION of the body's own
        // bounding box, not by absolute coordinates. An earlier version hard-coded
        // the numbers from body-model.json and selected nothing, because the
        // exported mesh does not sit in exactly the frame those numbers describe —
        // and "selected nothing" is a test failure that says nothing about the
        // thing under test.
        // TRIANGLE CENTROIDS, not vertices. A vertex sits on the boundary of its
        // UV island, so sampling at its exact UV lands in the margin bleed as
        // often as on the surface — the first version of this read the head at
        // luma 0.50, halfway between the helmet and the white margin around it,
        // and could not distinguish "correct" from "mirrored". A centroid is
        // always strictly inside the island.
        const V = [];
        for (const p of parts) {
            const pos = p.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const uv = p.getVerticesData(BABYLON.VertexBuffer.UVKind);
            const idx = p.getIndices();
            if (!pos || !uv || !idx) continue;
            for (let t = 0; t < idx.length; t += 3) {
                const a = idx[t], b = idx[t + 1], c = idx[t + 2];
                V.push({
                    x: (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3,
                    y: (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3,
                    z: (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3,
                    u: (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3,
                    v: (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3,
                });
            }
        }
        const ext = (k) => ({
            lo: Math.min(...V.map(p => p[k])), hi: Math.max(...V.map(p => p[k])),
        });
        const X = ext('x'), Y = ext('y'), Z = ext('z');
        const fy = (p) => (p.y - Y.lo) / (Y.hi - Y.lo);      // 0 = feet, 1 = crown

        // Work out which horizontal axis is LATERAL from the data rather than
        // assuming. In bind-pose vertex data the arm span lies along local Z here,
        // not X — the root's own rotation is what puts it along world X — and
        // assuming otherwise selected the front of the shin instead of its
        // outboard side, which is bare suit and reported no stripe at all.
        // Whichever axis the arms span is the wide one.
        const lat = (X.hi - X.lo) >= (Z.hi - Z.lo) ? 'x' : 'z';
        const fwd = lat === 'x' ? 'z' : 'x';
        const L = lat === 'x' ? X : Z;
        const F = fwd === 'x' ? X : Z;
        const latCentre = (L.lo + L.hi) / 2;
        // The front/back split point must come from the TORSO's own fore/aft
        // median, not the whole-body bbox mid: the torso band below (fy
        // 0.55–0.78) is defined on the same body, but the bbox mid moves when
        // the legs' DEPTH changes (the iter-91 calf growth moved the body's
        // fwd extent 0.157 -> 0.229) and dragged back-of-torso triangles into
        // the back box, sinking the bib front-back delta below its gate with
        // the bib itself untouched.
        const torsoBand = V.filter(p => { const f = fy(p); return f > 0.55 && f < 0.78; });
        const fwdSorted = torsoBand.map(p => p[fwd]).sort((a, b) => a - b);
        const fwdMid = fwdSorted[Math.floor(fwdSorted.length / 2)];

        const pick = (test) => V.filter(test).map(p => sample(p.u, p.v));
        // MEDIAN, not mean. These regions are defined geometrically and always
        // catch a few triangles from the neighbouring one; a mean lets those
        // outliers drag the figure a long way, and it was a mean that reported the
        // helmet at 0.50 when most of it was where it should be.
        const med = (xs) => {
            if (!xs.length) return null;
            const s = [...xs].sort((a, b) => a - b);
            return s[Math.floor(s.length / 2)];
        };
        // A median cannot see the stripe or the bib: each is only a few percent of
        // the body, so the median of any region containing one is still plain
        // suit. What distinguishes them is the FRACTION of the region that is
        // strongly blue, which is a real signal at 3% and zero when the design has
        // landed somewhere else. Luma stays a median, because the helmet is most
        // of the region it is measured in.
        const stats = (cols) => cols.length ? {
            n: cols.length,
            luma: +med(cols.map(c => (c[0] + c[1] + c[2]) / 3)).toFixed(3),
            blueFrac: +(cols.filter(c => c[2] - c[0] > 0.15).length / cols.length).toFixed(3),
        } : null;

        // Top of the figure is the helmet.
        const head = pick(p => fy(p) > 0.94);

        // Lower quarter is the shins; within that band the outboard side is the
        // most lateral 15%, which is where the stripe runs.
        const shins = V.filter(p => fy(p) < 0.25);
        const latLim = Math.max(...shins.map(p => Math.abs(p[lat] - latCentre))) * 0.85;
        const legOut = shins
            .filter(p => Math.abs(p[lat] - latCentre) > latLim)
            .map(p => sample(p.u, p.v));

        // The torso, split front from back. Which fore/aft sign is the chest is
        // not assumed: the bib is on exactly ONE side, so the bluer half IS the
        // front and the other half is the plain-suit reference. That is also a
        // stronger claim than checking a side picked in advance — it fails if the
        // bib wraps all the way round.
        const torso = torsoBand;
        const halfA = torso.filter(p => p[fwd] < fwdMid).map(p => sample(p.u, p.v));
        const halfB = torso.filter(p => p[fwd] >= fwdMid).map(p => sample(p.u, p.v));
        const sA = stats(halfA), sB = stats(halfB);
        const frontIsA = (sA && sB) ? sA.blueFrac > sB.blueFrac : true;

        return {
            head: stats(head), leg: stats(legOut),
            front: frontIsA ? sA : sB,
            back: frontIsA ? sB : sA,
            axes: { lateral: lat, forward: fwd },
            bounds: { x: [+X.lo.toFixed(3), +X.hi.toFixed(3)],
                      y: [+Y.lo.toFixed(3), +Y.hi.toFixed(3)],
                      z: [+Z.lo.toFixed(3), +Z.hi.toFixed(3)] },
            tex: [cv.width, cv.height],
        };
    });

    // Pin the convention this test's sampling depends on. The athlete's UVs come
    // through the glTF exporter, which rewrites them to glTF's top-left origin, so
    // its maps must be built with invertY = false — the opposite of the terrain
    // maps, whose uv2 comes from a sidecar in Blender convention.
    const inv = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const m = scene.materials.find(x => x.name === 'athleteBody_mat');
        return m && m.albedoTexture ? m.albedoTexture.invertY : null;
    });
    expect(inv, 'the athlete albedo must be built with invertY = false to match ' +
        'the glTF UV convention').toBe(false);

    const where = ` (bounds ${JSON.stringify(s.bounds)}, atlas ${s.tex.join('x')})`;
    expect(s.head && s.head.n, 'no triangles found on the head' + where).toBeGreaterThan(20);
    expect(s.leg && s.leg.n, 'no triangles found on the outboard side of a leg' + where)
        .toBeGreaterThan(10);
    expect(s.back && s.back.n, 'no triangles found on the back of the torso' + where)
        .toBeGreaterThan(20);

    console.log('SUIT ' + JSON.stringify(s));

    // Everything below is RELATIVE to the suit itself, measured on the back of the
    // torso — bare white suit, no bib, no stripe. Absolute thresholds would encode
    // the sRGB encoding of the file and the exact palette, neither of which this
    // test is about; what it is about is that the design lands on the right parts
    // of the body.
    const suit = s.back.luma;
    expect(suit, 'the back of the suit is not the pale colour it should be')
        .toBeGreaterThan(0.7);

    // The helmet must read as clearly darker than the suit. Under the flip bug it
    // sampled white suit and this difference collapsed to nothing.
    expect(suit - s.head.luma,
        `the helmet (${s.head.luma}) is not darker than the suit (${suit}) — the ` +
        `head is sampling the wrong part of the atlas`).toBeGreaterThan(0.25);

    // The stripe: a real share of the outboard side of the shin must be strongly
    // blue. This is the assertion that caught the stripe being painted down the
    // INSIDE of each leg, where nothing renders it and nothing else noticed.
    expect(s.leg.blueFrac,
        `only ${(s.leg.blueFrac * 100).toFixed(1)}% of the outboard side of the ` +
        `shin is blue — the royal-blue stripe is not landing there`)
        .toBeGreaterThan(0.10);

    // The bib is a FRONT garment: the front of the torso carries blue and the
    // back does not. Asserting both directions is what distinguishes "there is a
    // bib" from "the whole torso is blue".
    expect(s.front.blueFrac - s.back.blueFrac,
        `front (${s.front.blueFrac}) and back (${s.back.blueFrac}) of the torso ` +
        `carry the same amount of blue — the competition bib is missing`)
        .toBeGreaterThan(0.03);
    expect(s.back.blueFrac, 'the back of the torso is blue — the bib has wrapped ' +
        'all the way round the body').toBeLessThan(0.10);
});

test('the body deforms when the physics poses the athlete', async ({ page }) => {
    // The whole point of skinning: bone-driven deformation. If linkTransformNode
    // silently failed, the mesh would sit in its bind pose forever while the
    // invisible drivers moved underneath it.
    await boot(page);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window._getGameState().flipPower >= 0.6,
        null, { timeout: 60_000 });
    await page.keyboard.up('ArrowDown');
    await page.waitForFunction(() => window._getGameState().grounded === false,
        null, { timeout: 90_000 });

    const moved = await page.evaluate(async () => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const body = scene.meshes.find(m => m.name && m.name.startsWith('athleteBody'));
        const skel = body.skeleton;
        const read = () => skel.bones
            .filter(b => b.name === 'upperArmL' || b.name === 'lowerLegL')
            .map(b => {
                const m = b.getFinalMatrix ? b.getFinalMatrix() : b.getWorldMatrix();
                return m.m ? Array.from(m.m) : [];
            })
            .flat();
        const before = read();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        await new Promise(r => setTimeout(r, 1200));
        const after = read();
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        const diff = before.reduce((n, v, i) => n + Math.abs(v - (after[i] || 0)), 0);
        return { ok: diff > 1e-4, diff };
    });

    expect(moved.ok,
        `bone matrices did not change when tucking — the body is stuck in its ` +
        `bind pose (diff=${moved.diff})`).toBe(true);
});

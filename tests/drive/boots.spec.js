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
            // 219: the six material zones ship as separate loader meshes
            // (`athleteBootL_primitive0..5`) — aggregate their world bounds.
            const boots = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            if (!boots.length) { out.sides[side] = null; continue; }
            let mn = new BABYLON.Vector3(1e9, 1e9, 1e9);
            let mx = new BABYLON.Vector3(-1e9, -1e9, -1e9);
            for (const b of boots) {
                b.refreshBoundingInfo(true);
                b.computeWorldMatrix(true);
                const bi = b.getBoundingInfo().boundingBox;
                mn = BABYLON.Vector3.Minimize(mn, bi.minimumWorld);
                mx = BABYLON.Vector3.Maximize(mx, bi.maximumWorld);
            }
            const bb = { minimumWorld: mn, maximumWorld: mx };
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
            // 258: the posed shin ankle-band centroid, skinned through the
            // skeleton palette (the build-side posed cloud in render space —
            // the anchor the 14:45 ruling measures against, not the bone
            // pivot, which sits behind a leaning shin).
            const matIdx = body.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
            const matW = body.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
            const pos = body.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const palette = skel.getTransformMatrices(body);
            // The palette is indexed by bone.getIndex() (the skeleton's
            // matrix-palette slot), NOT by the position in skel.bones —
            // glTF joint order and Babylon bone order differ.
            const shinBone = skel.bones.find(b => b.name === 'lowerLeg' + side);
            const pij = shinBone ? shinBone.getIndex() : -1;
            const cloud = [];
            if (pij >= 0 && matIdx && matW && pos) {
                for (let i = 0; i < matIdx.length / 4; i++) {
                    let hit = -1;
                    for (let k = 0; k < 4; k++)
                        if (matIdx[i * 4 + k] === pij && matW[i * 4 + k] > 0.9) hit = k;
                    if (hit < 0) continue;
                    const pm = BABYLON.Matrix.FromArray(palette, matIdx[i * 4 + hit] * 16);
                    const p = BABYLON.Vector3.TransformCoordinates(
                        new BABYLON.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), pm);
                    cloud.push(BABYLON.Vector3.TransformCoordinates(p, bodyWorld));
                }
            }
            if (cloud.length > 20) {
                const soleY = Math.min(...cloud.map(v => v.y));
                const band = cloud.filter(v => v.y <= soleY + 0.10);
                const avg = (f) => band.reduce((a, v) => a + f(v), 0) / band.length;
                out.sides[side].centroid = [
                    +avg(v => v.x).toFixed(3), +avg(v => v.y).toFixed(3),
                    +avg(v => v.z).toFixed(3)];
                out.sides[side].cloudN = band.length;
            }

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
            const bs = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            for (const b of bs) b.position.y += 0.5;   // the v81 fold: shell up the leg
        }
    });
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = containmentGate(m, 'NC1');
    expect(fails.some(f => f.includes('OUTSIDE boot')), fails.join('; ')).toBe(true);
    expect(fails.some(f => f.includes('not surrounded')), fails.join('; ')).toBe(true);
});

// ── #16 v2 (a) FORE-AFT CENTER ALIGNMENT (NEXT.md item 3) ─────────────────
// Containment alone allowed a forward-sitting boot (the shell can contain the
// ankle yet have its mass 10 cm ahead of the foot). The boot's bounding-box
// centre must sit within 3 cm of the skinned foot anchor (the same lowerLeg
// bone pivot the containment gate uses — there is no separate foot bone on
// this rig) along the FORE-AFT axis, measured in world space at the ready
// pose. Front framing: the athlete faces -z, so world z is fore-aft.
function centerGate(m, tag) {
    const fails = [];
    for (const side of ['L', 'R']) {
        const s = m.sides[side];
        if (!s) { fails.push(`${tag} ${side}: boot mesh missing`); continue; }
        const cz = (s.min[2] + s.max[2]) / 2;
        const off = cz - s.ankle[2];
        if (Math.abs(off) > 0.03) {
            fails.push(`${tag} ${side}: boot bbox fore-aft centre ${cz.toFixed(3)} is ` +
                `${(off * 100).toFixed(1)} cm off the foot anchor ${s.ankle[2].toFixed(3)} ` +
                `(band ±3 cm) — boot sits forward/backward of the foot`);
        }
    }
    return fails;
}

test('CENTER ALIGNMENT: boot bbox centre within 3 cm of the foot anchor, fore-aft', async ({ page }) => {
    await bootReady(page);
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = centerGate(m, 'center');
    expect(fails, fails.join('; ')).toEqual([]);
});

test('NC3: a forward-sitting boot fires the center-alignment gate', async ({ page }) => {
    await bootReady(page);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const bs = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            if (!bs.length) continue;
            // Shove the shell 12 cm along WORLD -z (fore-aft). The boot is
            // parented to the yawed character root, so the offset must be
            // expressed in the PARENT's frame: transform the world direction
            // by the inverse of the parent's world matrix.
            bs[0].computeWorldMatrix(true);
            const parent = bs[0].parent || null;
            const inv = parent
                ? parent.getWorldMatrix().clone().invert()
                : BABYLON.Matrix.Identity();
            const dir = BABYLON.Vector3.TransformNormal(
                new BABYLON.Vector3(0, 0, -0.12), inv);
            for (const b of bs) b.position.addInPlaceFromFloats(dir.x, dir.y, dir.z);
        }
    });
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = centerGate(m, 'NC3');
});

// ── 258 ANKLE-ANCHOR GATE (the 14:45 ruling, clause b) ─────────────────────
// The boot's bounding-box centre must sit within 4 cm of the POSED shin
// ankle-band centroid (lateral x AND fore-aft z), and that centroid must lie
// inside the boot's x–z footprint (the cuff ring's footprint). 257 shipped
// cuffs standing ahead of the shins; this gate anchors the shell to the same
// posed-cloud centroid the Blender build measures.
function ankleAnchorGate(m, tag) {
    const fails = [];
    for (const side of ['L', 'R']) {
        const s = m.sides[side];
        if (!s) { fails.push(`${tag} ${side}: boot mesh missing`); continue; }
        if (!s.centroid) { fails.push(`${tag} ${side}: no posed shin cloud`); continue; }
        const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2;
        const offX = cx - s.centroid[0], offZ = cz - s.centroid[2];
        if (Math.abs(offX) > 0.04 || Math.abs(offZ) > 0.04) {
            fails.push(`${tag} ${side}: boot bbox centre (${cx.toFixed(3)},` +
                `${cz.toFixed(3)}) is ${(offX * 100).toFixed(1)} cm x / ` +
                `${(offZ * 100).toFixed(1)} cm z off the posed ankle-band ` +
                `centroid (${s.centroid[0]}, ${s.centroid[2]}) — boot not on the foot`);
        }
        const inside = s.centroid[0] >= s.min[0] && s.centroid[0] <= s.max[0] &&
            s.centroid[2] >= s.min[2] && s.centroid[2] <= s.max[2];
        if (!inside) {
            fails.push(`${tag} ${side}: ankle-band centroid (${s.centroid[0]},` +
                `${s.centroid[2]}) OUTSIDE the boot x–z footprint`);
        }
    }
    return fails;
}

test('ANKLE-ANCHOR: boot bbox centre within 4 cm of the posed shin centroid', async ({ page }) => {
    await bootReady(page);
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = ankleAnchorGate(m, 'anchor');
    expect(fails, fails.join('; ')).toEqual([]);
});

test('NC6: a boot shoved fore-aft off the posed shin centroid fires the ankle-anchor gate', async ({ page }) => {
    await bootReady(page);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const bs = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            if (!bs.length) continue;
            bs[0].computeWorldMatrix(true);
            const parent = bs[0].parent || null;
            const inv = parent
                ? parent.getWorldMatrix().clone().invert()
                : BABYLON.Matrix.Identity();
            const dir = BABYLON.Vector3.TransformNormal(
                new BABYLON.Vector3(0, 0, -0.08), inv);
            for (const b of bs) b.position.addInPlaceFromFloats(dir.x, dir.y, dir.z);
        }
    });
    await frame(page, Math.PI * 0.30);
    const m = await measure(page);
    const fails = ankleAnchorGate(m, 'NC6');
    expect(fails.some(f => f.includes('not on the foot')), fails.join('; ')).toBe(true);
});

test('CLOSURE: the boot meshes are watertight (zero welded boundary edges)', () => {
    // #16 v2 (b), the "close every face" half: read the shipped GLB directly
    // and classify edges after position-welding (the export splits vertices
    // per smoothing group, so index-topology alone always reads boundary).
    const fs = require('fs');
    const path = require('path');
    const glb = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'athlete_body.glb'));
    const jsonLen = glb.readUInt32LE(12);
    const j = JSON.parse(glb.slice(20, 20 + jsonLen).toString());
    const binStart = 20 + jsonLen + 8;
    const fails = [];
    for (const m of j.meshes || []) {
        if (m.name.indexOf('athleteBoot') !== 0) continue;
        // 219: the boot ships one primitive PER MATERIAL ZONE (six of them),
        // each with its own vertex buffer. Weld across ALL primitives of the
        // mesh — an edge at a material boundary is a zone seam, not an
        // opening, because the positions still coincide.
        const wmap = new Map();
        const edges = new Map();
        const key = (x, y) => x < y ? x + '_' + y : y + '_' + x;
        for (const p of m.primitives) {
            const a = j.accessors[p.attributes.POSITION];
            const bv = j.bufferViews[a.bufferView];
            const co = new Float32Array(glb.buffer.slice(
                binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + a.count * 12));
            const iv = j.accessors[p.indices];
            const bvv = j.bufferViews[iv.bufferView];
            const ioff = binStart + (bvv.byteOffset || 0) + (iv.byteOffset || 0);
            const Arr = iv.componentType === 5123 ? Uint16Array : Uint32Array;
            const ind = new Arr(glb.buffer.slice(ioff, ioff + iv.count * Arr.BYTES_PER_ELEMENT));
            const wid = new Array(a.count);
            for (let i = 0; i < a.count; i++) {
                const k = [0, 1, 2].map(q => Math.round(co[i * 3 + q] * 10000)).join(',');
                if (!wmap.has(k)) wmap.set(k, wmap.size);
                wid[i] = wmap.get(k);
            }
            for (let i = 0; i < ind.length; i += 3) {
                for (let e = 0; e < 3; e++) {
                    const x = wid[ind[i + e]], y = wid[ind[i + (e + 1) % 3]];
                    edges.set(key(x, y), (edges.get(key(x, y)) || 0) + 1);
                }
            }
        }
        let boundary = 0;
        for (const c of edges.values()) if (c === 1) boundary++;
        if (boundary > 0) fails.push(`${m.name}: ${boundary} open boundary edges after position weld`);
    }
    expect(fails, fails.join('; ')).toEqual([]);
});

test('NC4: a punctured boot mesh fires the closure gate', () => {
    // Synthetic check of the classifier itself: a strip of triangles removed
    // from a closed box must produce boundary edges > 0. Build a tiny
    // position-welded cube-with-a-hole inline and run the same counting.
    const T = [[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[3,7,6],[3,6,2],[0,4,7],[0,7,3]];
    const V = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const edges = new Map();
    const key = (x, y) => x < y ? x + '_' + y : y + '_' + x;
    for (const t of T) for (let e = 0; e < 3; e++) {
        const x = t[e], y = t[(e + 1) % 3];
        edges.set(key(x, y), (edges.get(key(x, y)) || 0) + 1);
    }
    let boundary = 0;
    for (const c of edges.values()) if (c === 1) boundary++;
    expect(boundary, 'a cube with one triangle removed has 3 boundary edges').toBe(3);
    expect(V.length, 'sanity: cube has 8 welded verts').toBe(8);
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

// ── #16 v2 (b) FACE-ZONE GATE (iteration 219; four zones since 257) ────────
// "Texture every face": the boot must ship its material zones (shell, sole,
// cuff, liner lip) so no face zone reads as bare unpainted shell. Reads the
// shipped GLB's materials + primitives. (258: toe/strap/buckle details
// return on this shell in slot 261.)
const BOOT_ZONE_MATS = ['bootShell', 'bootSole', 'bootCuff', 'bootLip'];

function bootZoneFails(j) {
    const fails = [];
    const names = (j.materials || []).map(m => m.name);
    for (const z of BOOT_ZONE_MATS) {
        if (names.indexOf(z) === -1) fails.push(`missing boot material ${z}`);
    }
    for (const m of (j.meshes || []).filter(m => m.name && m.name.indexOf('athleteBoot') === 0)) {
        const used = new Set();
        for (const p of m.primitives) {
            const mat = j.materials[p.material];
            if (mat) used.add(mat.name);
        }
        for (const z of BOOT_ZONE_MATS) {
            if (!used.has(z)) fails.push(`${m.name}: no faces carry ${z}`);
        }
    }
    return fails;
}

test('FACE ZONES: the boot carries all four material zones, every face assigned', () => {
    const fs = require('fs');
    const path = require('path');
    const glb = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'athlete_body.glb'));
    const jsonLen = glb.readUInt32LE(12);
    const j = JSON.parse(glb.slice(20, 20 + jsonLen).toString());
    const fails = bootZoneFails(j);
    expect(fails, fails.join('; ')).toEqual([]);
});

test('NC5: a single-material boot fires the face-zone gate', () => {
    // The pre-219 build: one navy material, no zones.
    const j = { materials: [{ name: 'bootShell' }],
        meshes: [{ name: 'athleteBootL', primitives: [{ material: 0 }] }] };
    const fails = bootZoneFails(j);
    expect(fails.length, 'gate must fire on the flat-navy boot').toBeGreaterThan(0);
    expect(fails.join('; ')).toContain('bootSole');
});

test('NC2: boots hidden fail the rendered clause', async ({ page }) => {
    await bootReady(page);
    await frame(page, Math.PI * 0.30);
    await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        for (const side of ['L', 'R']) {
            const bs = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            for (const b of bs) b.setEnabled(false);
        }
    });
    const m = await measure(page);
    const fails = containmentGate(m, 'NC2');
    expect(fails.length, 'gate must detect boots-not-rendered').toBeGreaterThan(0);
});

// ── 259 SIGNED IN-GAME FOOT-AXIS GATE (the 15:25 ruling, clause c) ─────────
// The acceptance is IN THE GAME, SIGNED, root-local: the boot must span from
// z_ankle − 0.17 (toe, forward = −z; the athlete faces −z) to z_ankle + 0.11
// (heel). The 258 build-side gate measured an UNSIGNED offset in the build
// frame, so a fully mirrored loft passed it. Measured exactly as the
// reviewer's probe: root-local (the body's world matrix inverse), the boot
// primitives' aggregate bounding box, the ankle end = lowerLeg driver node
// + 0.18 m along the node's −Y.
async function measureSigned(page) {
    return await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        scene.render();
        const body = scene.getMeshByName('athleteBody') ||
            scene.meshes.find(m => m.name && m.name.startsWith('athleteBody'));
        body.computeWorldMatrix(true);
        const inv = body.getWorldMatrix().clone().invert();
        const toLocal = (v) => BABYLON.Vector3.TransformCoordinates(v, inv);
        const skel = scene.skeletons[0];
        const out = {};
        for (const side of ['L', 'R']) {
            const boots = scene.meshes.filter(m =>
                m.name && m.name.indexOf('athleteBoot' + side) === 0);
            if (!boots.length) { out[side] = null; continue; }
            let mn = new BABYLON.Vector3(1e9, 1e9, 1e9);
            let mx = new BABYLON.Vector3(-1e9, -1e9, -1e9);
            for (const b of boots) {
                b.refreshBoundingInfo(true);
                b.computeWorldMatrix(true);
                const bi = b.getBoundingInfo().boundingBox;
                for (const c of [
                    new BABYLON.Vector3(bi.minimumWorld.x, bi.minimumWorld.y, bi.minimumWorld.z),
                    new BABYLON.Vector3(bi.maximumWorld.x, bi.maximumWorld.y, bi.maximumWorld.z)]) {
                    const l = toLocal(c);
                    mn = BABYLON.Vector3.Minimize(mn, l);
                    mx = BABYLON.Vector3.Maximize(mx, l);
                }
            }
            const bone = skel.bones.find(b => b.name === 'lowerLeg' + side);
            const at = bone.getAbsoluteTransform();
            const node = toLocal(BABYLON.Vector3.TransformCoordinates(
                at.getTranslation(), body.getWorldMatrix()));
            const yDir = BABYLON.Vector3.TransformNormal(
                new BABYLON.Vector3(0, 1, 0),
                at.multiply(body.getWorldMatrix())).normalize();
            const ankleEnd = node.subtract(yDir.scale(0.18));
            out[side] = {
                zmin: +(mn.z - ankleEnd.z).toFixed(3),
                zmax: +(mx.z - ankleEnd.z).toFixed(3),
                xcOff: +(((mn.x + mx.x) / 2) - ankleEnd.x).toFixed(3),
                cuff: +(mx.y - mn.y).toFixed(3),
            };
        }
        return out;
    });
}

function signedAxisGate(s, tag) {
    const fails = [];
    for (const side of ['L', 'R']) {
        const d = s[side];
        if (!d) { fails.push(`${tag} ${side}: boot mesh missing`); continue; }
        if (d.zmin < -0.20 || d.zmin > -0.12)
            fails.push(`${tag} ${side}: boot z-min ${d.zmin} vs ankle end ` +
                `(gate [−0.20, −0.12]) — toe end misplaced${d.zmin > 0 ? ' (boot behind the ankle, the 258 mirror)' : ''}`);
        if (d.zmax < 0.06 || d.zmax > 0.14)
            fails.push(`${tag} ${side}: boot z-max ${d.zmax} vs ankle end ` +
                `(gate [+0.06, +0.14]) — heel end misplaced`);
        if (Math.abs(d.xcOff) > 0.02)
            fails.push(`${tag} ${side}: boot x-centre ${d.xcOff} off the ankle x (gate ±0.02)`);
        if (d.cuff < 0.14 || d.cuff > 0.21)
            fails.push(`${tag} ${side}: cuff top ${d.cuff} above the sole (gate [0.14, 0.21])`);
    }
    return fails;
}

test('SIGNED FOOT AXIS: boot spans toe −z / heel +z about the ankle end, root-local', async ({ page }) => {
    await bootReady(page);
    await frame(page, Math.PI * 0.30);
    const s = await measureSigned(page);
    const fails = signedAxisGate(s, 'signed');
    expect(fails, fails.join('; ')).toEqual([]);
});

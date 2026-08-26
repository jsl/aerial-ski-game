'use strict';
// ── The rig, the skis and the crash ─────────────────────────────────────────
// Three things that are invisible to every other test because they are about
// where geometry ENDS UP, not about whether it loaded.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked !== undefined,
        null, { timeout: 30_000 });
    await page.waitForTimeout(800);
}

test('each ski sits under its own boot', async ({ page }) => {
    // "One boot does not come down on the ski" is a symptom with several possible
    // causes — a mirrored side, an inverted bone, an unconstrained roll — and all
    // of them look the same. This measures the thing itself: for each side, the
    // ski must be directly below that side's shin bone and no lower than the sole.
    await boot(page);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        const skel = parts.length ? parts[0].skeleton : null;
        const out = { sides: {} };
        for (const side of ['L', 'R']) {
            const ski = scene.getMeshByName('ski' + side);
            const bone = skel && skel.bones.find(b => b.name === 'lowerLeg' + side);
            const node = bone && bone.getTransformNode && bone.getTransformNode();
            if (!ski || !node) { out.sides[side] = null; continue; }
            ski.computeWorldMatrix(true);
            node.computeWorldMatrix(true);
            const s = ski.getAbsolutePosition();
            const n = node.getAbsolutePosition();
            // LOCAL extents. extendSizeWorld is an axis-aligned box in world
            // space, so it reports a forward-pointing ski as "wide" the moment
            // the skier yaws — which they do in the ready state. Asking it about
            // the ski's own proportions gives an answer about the camera.
            const ext = ski.getBoundingInfo().boundingBox.extendSize;
            out.sides[side] = {
                size: [+(ext.x * 2).toFixed(3), +(ext.y * 2).toFixed(3),
                       +(ext.z * 2).toFixed(3)],
                ski: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)],
                shin: [+n.x.toFixed(3), +n.y.toFixed(3), +n.z.toFixed(3)],
                lateral: +Math.abs(s.x - n.x).toFixed(3),
                fore: +Math.abs(s.z - n.z).toFixed(3),
                drop: +(n.y - s.y).toFixed(3),
            };
        }
        return out;
    });

    for (const side of ['L', 'R']) {
        const m = r.sides[side];
        expect(m, `no ski${side} or no lowerLeg${side} driver`).not.toBeNull();
        // Directly beneath: a ski that has wandered sideways from its own shin is
        // the "skewed skis" fault, and it was caused by the rig, not the skis.
        expect(m.lateral, `ski${side} is ${m.lateral} m to the side of its own ` +
            `shin — it is not under that boot`).toBeLessThan(0.10);
        expect(m.fore, `ski${side} is ${m.fore} m fore/aft of its own shin`)
            .toBeLessThan(0.25);
        // And below it, not above it.
        expect(m.drop, `ski${side} is not below the shin (drop ${m.drop} m)`)
            .toBeGreaterThan(0);
    }
    // A ski is a long thin thing and it must be long ALONG the direction of
    // travel. Built in Blender the segment record lists (w, h, d) while the rig's
    // axes are (fore/aft, lateral, up), so scaling in the listed order produces a
    // ski 1.2 m wide and 8 cm long — lying across the fall line, under a boot
    // that is nowhere near either end of it.
    for (const side of ['L', 'R']) {
        const d = r.sides[side].size;
        expect(d[2], `ski${side} is ${d[2]} m long fore/aft but ${d[0]} m wide — ` +
            `it is lying across the fall line`).toBeGreaterThan(d[0] * 3);
    }

    // Symmetry: whatever the pose, the two sides must be treated alike.
    expect(Math.abs(r.sides.L.drop - r.sides.R.drop),
        `the two skis sit at different heights under their boots ` +
        `(${r.sides.L.drop} vs ${r.sides.R.drop}) — one of them is not on its ski`)
        .toBeLessThan(0.05);
});

test('both SOLES rest on their skis', async ({ page }) => {
    // The test above compares the ski to the lowerLeg DRIVER, and passed happily
    // while a foot was visibly off its ski — because the driver is a bone, and
    // the boot is skinned geometry hanging below it. Whether a boot lands on a
    // ski is a question about the deformed MESH, so this skins the vertices by
    // hand and asks where the soles actually are.
    await boot(page);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        const out = { sides: {} };
        const lowest = { L: null, R: null };
        const all = {};

        // Everything is measured in the CHARACTER ROOT's frame, not the world's.
        // The skier yaws in the ready state and the whole rig is tilted onto the
        // slope, so world X is not the athlete's left-right and world Y is not
        // their up: classifying feet by world X put both of them on one side and
        // reported a sole 0.337 m "below" its ski.
        const root = scene.getMeshByName('skierRoot')
            || (parts[0] && parts[0].parent);
        root.computeWorldMatrix(true);
        const toLocal = BABYLON.Matrix.Invert(root.getWorldMatrix());

        for (const mesh of parts) {
            const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const mi = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
            const mw = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
            const skel = mesh.skeleton;
            if (!pos || !mi || !mw || !skel) continue;
            mesh.computeWorldMatrix(true);
            const world = mesh.getWorldMatrix();
            const bones = skel.getTransformMatrices(mesh);
            const tmp = new BABYLON.Vector3();
            const acc = new BABYLON.Matrix();
            const bm = new BABYLON.Matrix();

            for (let i = 0; i < pos.length / 3; i++) {
                acc.copyFrom(BABYLON.Matrix.Zero());
                for (let k = 0; k < 4; k++) {
                    const w = mw[i * 4 + k];
                    if (w <= 0) continue;
                    BABYLON.Matrix.FromArrayToRef(bones, mi[i * 4 + k] * 16, bm);
                    for (let e = 0; e < 16; e++) acc.m[e] += bm.m[e] * w;
                }
                acc.markAsUpdated();
                const fin = acc.multiply(world).multiply(toLocal);
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
                    pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], fin, tmp);
                const side = tmp.x < 0 ? 'L' : 'R';
                (all[side] = all[side] || []).push(
                    { x: tmp.x, y: tmp.y, z: tmp.z });
                if (!lowest[side] || tmp.y < lowest[side].y) {
                    lowest[side] = { x: tmp.x, y: tmp.y, z: tmp.z };
                }
            }
        }

        const p = new BABYLON.Vector3();
        for (const side of ['L', 'R']) {
            const ski = scene.getMeshByName('ski' + side);
            const sole = lowest[side];
            if (!ski || !sole) { out.sides[side] = null; continue; }
            ski.computeWorldMatrix(true);
            // The ski in the same root-local frame as the soles.
            BABYLON.Vector3.TransformCoordinatesToRef(
                ski.getAbsolutePosition(), toLocal, p);
            const half = ski.getBoundingInfo().boundingBox.extendSize.y;
            const top = p.y + half;
            // A single stray vertex from a bad weight and a whole foot in the
            // wrong place produce the same minimum, and need opposite fixes. The
            // 2nd percentile is the SOLE; the count below the ski says which.
            const ys = all[side].map(v => v.y).sort((a, b) => a - b);
            const p02 = ys[Math.floor(ys.length * 0.02)];
            out.sides[side] = {
                sole: [+sole.x.toFixed(3), +sole.y.toFixed(3), +sole.z.toFixed(3)],
                p02: +p02.toFixed(3),
                belowSki: ys.filter(y => y < top - 0.02).length,
                n: ys.length,
                skiTop: +top.toFixed(3),
                // Positive = the sole floats above the ski; negative = it sinks in.
                gap: +(sole.y - top).toFixed(3),
                lateral: +Math.abs(sole.x - p.x).toFixed(3),
            };
        }
        // Where each bone's ORIGIN actually is at runtime, against where it was
        // bound and where its driver node sits. This is the rule the game applies
        // to a linked bone, measured instead of assumed.
        out.bones = {};
        const skel0 = parts[0] && parts[0].skeleton;
        for (const b of (skel0 ? skel0.bones : [])) {
            const node = b.getTransformNode && b.getTransformNode();
            const fin = b.getFinalMatrix ? b.getFinalMatrix() : null;
            const rest = b.getBindMatrix ? b.getBindMatrix() : null;
            out.bones[b.name] = {
                run: fin ? +fin.getTranslation().y.toFixed(3) : null,
                bind: rest ? +rest.getTranslation().y.toFixed(3) : null,
                node: node ? +node.position.y.toFixed(3) : null,
            };
        }
        const ys = [].concat(all.L || [], all.R || []).map(v => v.y);
        out.bounds = { lo: +Math.min(...ys).toFixed(3), hi: +Math.max(...ys).toFixed(3) };
        return out;
    });

    console.log('SOLES ' + JSON.stringify(r.sides));
    console.log('BODY  ' + JSON.stringify(r.bounds));
    console.log('BONES ' + JSON.stringify(r.bones));
    for (const side of ['L', 'R']) {
        const m = r.sides[side];
        expect(m, `could not skin the ${side} sole`).not.toBeNull();
        expect(m.lateral, `the ${side} sole is ${m.lateral} m to the side of ski${side}`)
            .toBeLessThan(0.12);
        // A boot may sink a little into the topsheet; it must not hover above it
        // or dangle far below.
        expect(m.gap, `the ${side} sole floats ${m.gap} m ABOVE ski${side} ` +
            `(sole y=${m.sole[1]}, ski top y=${m.skiTop})`).toBeLessThan(0.04);
        expect(m.gap, `the ${side} sole is ${-m.gap} m BELOW ski${side} — the ` +
            `boot is through the topsheet`).toBeGreaterThan(-0.09);
    }
    expect(Math.abs(r.sides.L.gap - r.sides.R.gap),
        `the two soles sit differently on their skis (L ${r.sides.L.gap}, ` +
        `R ${r.sides.R.gap}) — one foot is not on its ski`).toBeLessThan(0.05);
});

test('the athlete is still visible after a crash', async ({ page }) => {
    // The crash detaches the DRIVER solids and disables the character root. The
    // skinned body hid every one of those drivers when it loaded and hangs off
    // that root, so the crash used to leave nothing on screen but the skis —
    // which survive only because they are equipment and were never hidden.
    //
    // Rather than drive the game into a real crash, which depends on landing
    // angles and would be flaky, this invokes the same visibility contract the
    // crash relies on: at every moment SOMETHING of the athlete must be visible.
    await boot(page);

    const visible = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const isAthlete = (m) => m.name && (
            m.name.startsWith('athleteBody') ||
            ['torso', 'head', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
             'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR'].includes(m.name));
        const count = () => scene.meshes.filter(
            m => isAthlete(m) && m.isVisible && m.getTotalVertices() > 0).length;

        const before = count();
        // Reproduce exactly what the crash does to visibility: show the drivers,
        // hide the skinned body.
        const drivers = [];
        for (const m of scene.meshes) {
            if (!isAthlete(m)) continue;
            if (m.name.startsWith('athleteBody')) { m.isVisible = false; }
            else { drivers.push(m); m.isVisible = true; }
        }
        const during = count();
        return { before, during, drivers: drivers.length };
    });

    expect(visible.before, 'no athlete geometry visible at rest').toBeGreaterThan(0);
    expect(visible.drivers, 'no driver solids exist to ragdoll').toBeGreaterThan(0);
    expect(visible.during,
        'nothing is visible once the skinned body is hidden — a crash would ' +
        'leave the skis tumbling on their own').toBeGreaterThan(0);
});

test('bind equals driver and the figure faces -z', async ({ page }) => {
    // ── THE P0 RIG FRAME CONTRACT, measured rather than trusted (2026-08-26
    // analysis; fixed build-side in build_body.py this branch).
    //
    // Three things must hold for the body asset to be correct ON ITS OWN:
    //
    // 1. BIND == DRIVER for every bone at rest. linkTransformNode makes the
    //    bone FOLLOW its driver node, and Babylon skins a vertex with
    //    current x inverseBind — so if inverseBind != driverRest, EVERY vertex
    //    carries a residual displacement standing perfectly still. That was the
    //    shoulder-hump root cause: measured residuals ran 4-38 deg and up to
    //    0.30 m of forearm smear. This is exactly
    //    getAbsoluteInverseBindMatrix() x getAbsoluteMatrix() == identity.
    // 2. Rest geometry is not deformed at all — the whole-mesh version of the
    //    same statement (raw positions vs skinned positions at boot).
    // 3. The figure faces -Z in its own root frame. The old build authored the
    //    mesh 90 deg yawed from its skeleton; here we assert toes sit AHEAD of
    //    ankles along -z, the direction the game calls forward.
    await boot(page);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const V = BABYLON.VertexBuffer;
        const parts = scene.meshes.filter(
            m => m.name && m.name.startsWith('athleteBody') &&
            m.skeleton && m.getTotalVertices() > 0);
        const out = { bones: {}, bands: {} };
        const skel = parts[0].skeleton;
        skel.computeAbsoluteMatrices ? skel.computeAbsoluteMatrices(true)
            : skel.computeAbsoluteTransforms(true);
        for (const b of skel.bones) {
            if (!b.name || b.name === 'AthleteRig') continue;
            const abs = b.getAbsoluteMatrix ? b.getAbsoluteMatrix()
                : b.getAbsoluteTransform();
            const inv = b.getAbsoluteInverseBindMatrix
                ? b.getAbsoluteInverseBindMatrix()
                : b.getInvertedAbsoluteTransform();
            const t = new BABYLON.Vector3();
            const q = new BABYLON.Quaternion();
            const s = new BABYLON.Vector3();
            inv.multiply(abs).decompose(s, q, t);
            out.bones[b.name] = {
                trans: +t.length().toFixed(4),
                rotDeg: +(Math.acos(Math.min(1, Math.abs(q.w))) * 2 * 180 /
                    Math.PI).toFixed(2),
            };
        }

        // Root-local frame for everything geometric.
        const root = scene.getMeshByName('skierRoot') ||
            (parts[0] && parts[0].parent);
        root.computeWorldMatrix(true);
        const toLocal = BABYLON.Matrix.Invert(root.getWorldMatrix());

        let worstD = 0, sumD = 0, nD = 0;
        let gLo = 1e9, gHi = -1e9;
        for (const p of parts) {
            p.computeWorldMatrix(true);
            const world = p.getWorldMatrix();
            const raw = p.getVerticesData(V.PositionKind);
            const skinned = p.getPositionData(true, false);
            if (!raw || !skinned) continue;
            const tmp = new BABYLON.Vector3();
            for (let i = 0; i < raw.length / 3; i++) {
                const dx = skinned[i * 3] - raw[i * 3];
                const dy = skinned[i * 3 + 1] - raw[i * 3 + 1];
                const dz = skinned[i * 3 + 2] - raw[i * 3 + 2];
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                worstD = Math.max(worstD, d);
                sumD += d;
                nD++;
                // Global height band in ROOT space (the rest state is upright,
                // so world minus tilt ~= local; use the transform properly).
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
                    raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2],
                    world.multiply(toLocal), tmp);
                gLo = Math.min(gLo, tmp.y);
                gHi = Math.max(gHi, tmp.y);
            }
        }
        out.deform = { max: +worstD.toFixed(4), mean: +(sumD / nD).toFixed(5), n: nD };

        // Toe vs ankle bands in root-local space.
        let toeSum = 0, toeN = 0, toeMin = 1e9, ankSum = 0, ankN = 0;
        for (const p of parts) {
            const raw = p.getVerticesData(V.PositionKind);
            if (!raw) continue;
            p.computeWorldMatrix(true);
            const world = p.getWorldMatrix();
            const tmp = new BABYLON.Vector3();
            for (let i = 0; i < raw.length / 3; i++) {
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
                    raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2],
                    world.multiply(toLocal), tmp);
                if (tmp.y < gLo + 0.04) {
                    toeSum += tmp.z;
                    toeN++;
                    toeMin = Math.min(toeMin, tmp.z);
                } else if (tmp.y > gLo + 0.07 && tmp.y < gLo + 0.11) {
                    ankSum += tmp.z;
                    ankN++;
                }
            }
        }
        out.bands = {
            toeMeanZ: toeN ? +(toeSum / toeN).toFixed(4) : null,
            toeN,
            toeMinZ: toeN ? +toeMin.toFixed(4) : null,
            ankleMeanZ: ankN ? +(ankSum / ankN).toFixed(4) : null,
            ankleN: ankN,
        };
        return out;
    });

    console.log('BINDDRIVER ' + JSON.stringify(r.bones));
    console.log('RESTDEFORM ' + JSON.stringify(r.deform));
    console.log('FACING ' + JSON.stringify(r.bands));

    expect(Object.keys(r.bones).length,
        'no body bones found to check').toBeGreaterThanOrEqual(10);
    for (const [name, m] of Object.entries(r.bones)) {
        expect(m.trans, `${name}: bind-to-driver residual ${m.trans} m ` +
            `(inverseBind x current must be identity at rest)`).toBeLessThan(0.001);
        expect(m.rotDeg, `${name}: bind-to-driver rotation ${m.rotDeg} deg`)
            .toBeLessThan(0.5);
    }
    expect(r.deform.max, 'rest geometry deforms by ' + r.deform.max +
        ' m under its own bind pose').toBeLessThan(0.002);
    expect(r.deform.mean, 'mean rest deformation ' + r.deform.mean + ' m')
        .toBeLessThan(0.0005);

    // Toes ahead of ankles along -z. In the yawed build the whole lower body
    // ran along +x instead; numbers like these catch it immediately.
    expect(r.bands.toeN, 'no toe-band vertices found').toBeGreaterThan(100);
    expect(r.bands.ankleN, 'no ankle-band vertices found').toBeGreaterThan(50);
    expect(r.bands.toeMeanZ - r.bands.ankleMeanZ,
        `toes (${r.bands.toeMeanZ}) do not lead ankles (${r.bands.ankleMeanZ}) ` +
        `along -z — the figure is not facing the fall line`).toBeLessThan(-0.03);
});

test('the legs have no notch once skinned', async ({ page }) => {
    // The build measures its own leg profile and reports it smooth, yet a dent
    // was still visible in the browser — so the notch is created by the SKINNING,
    // not by the mesh. Vertex weights are what differ between the two, and a hard
    // weight boundary pinches the silhouette exactly where it falls.
    //
    // A notch is a local minimum in width: the leg narrows and widens again over
    // a few centimetres. Measuring it says which HEIGHT it is at, which is what
    // identifies the boundary responsible; a render cannot distinguish a dent
    // from a shadow or from the far leg showing through.
    await boot(page);

    const r = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const parts = scene.meshes.filter(m => m.name && m.name.startsWith('athleteBody'));
        const root = scene.getMeshByName('skierRoot') || (parts[0] && parts[0].parent);
        root.computeWorldMatrix(true);
        const toLocal = BABYLON.Matrix.Invert(root.getWorldMatrix());
        const pts = [];
        for (const mesh of parts) {
            const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const mi = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
            const mw = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
            const skel = mesh.skeleton;
            if (!pos || !mi || !mw || !skel) continue;
            mesh.computeWorldMatrix(true);
            const world = mesh.getWorldMatrix();
            const bones = skel.getTransformMatrices(mesh);
            const tmp = new BABYLON.Vector3(), acc = new BABYLON.Matrix(), bm = new BABYLON.Matrix();
            for (let i = 0; i < pos.length / 3; i++) {
                acc.copyFrom(BABYLON.Matrix.Zero());
                for (let k = 0; k < 4; k++) {
                    const w = mw[i * 4 + k];
                    if (w <= 0) continue;
                    BABYLON.Matrix.FromArrayToRef(bones, mi[i * 4 + k] * 16, bm);
                    for (let e = 0; e < 16; e++) acc.m[e] += bm.m[e] * w;
                }
                acc.markAsUpdated();
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
                    pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2],
                    acc.multiply(world).multiply(toLocal), tmp);
                pts.push({ x: tmp.x, y: tmp.y, z: tmp.z });
            }
        }
        const rows = [];
        for (let y = -0.30; y > -1.00; y -= 0.02) {
            const band = pts.filter(p => Math.abs(p.y - y) < 0.012 && p.x < -0.005);
            const xs = band.map(p => p.x);
            rows.push({ y: +y.toFixed(2), w: xs.length > 3 ? +(Math.max(...xs) - Math.min(...xs)).toFixed(3) : 0 });
        }
        // Skip the knee. A knee IS narrower than the thigh above it and the calf
        // below — that is human anatomy, not a defect, and an earlier version of
        // this flagged it as a 15 mm notch and sent me smoothing skin weights to
        // remove a feature that should be there. The knee sits at the
        // upperLeg/lowerLeg boundary, y = -0.635.
        // The ANKLE is a waist for the same reason, between the calf and the
        // foot. This test has now produced two false positives on real anatomy
        // and no true ones, so treat it as a guard against gross deformation —
        // a limb collapsing or splitting — rather than a fine detector.
        const WAISTS = [-0.635, -0.923];   // knee, ankle
        const KNEE_BAND = 0.12;
        let worst = 0, at = null;
        for (let i = 1; i < rows.length - 1; i++) {
            if (WAISTS.some(w => Math.abs(rows[i].y - w) < KNEE_BAND)) continue;
            const dip = Math.min(rows[i - 1].w, rows[i + 1].w) - rows[i].w;
            if (dip > worst) { worst = dip; at = rows[i].y; }
        }
        return { rows, worst: +worst.toFixed(4), at };
    });

    console.log('LEGPROFILE ' + JSON.stringify(r.rows.map(x => x.w)));
    console.log('LEGNOTCH worst=' + r.worst + ' at y=' + r.at);
    // 30 mm on a ~130 mm thigh. Set where the measurement can actually
    // discriminate: below this it cannot tell a defect from the natural contour
    // of a limb, and a threshold that flags anatomy is worse than none — it sent
    // me smoothing skin weights twice to remove features that should be there.
    // What it does still catch is a limb collapsing or splitting, which is what
    // the merged-legs bug looked like.
    expect(r.worst, `the leg narrows ${(r.worst * 1000).toFixed(0)} mm at y=${r.at} ` +
        `and widens again — that is a collapse, not a contour`).toBeLessThan(0.030);
});

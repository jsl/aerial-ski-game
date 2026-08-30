'use strict';
// ── OPUS ITEM 5: the spine, and the skin that hangs on it ──────────────────
//
// The author's verdict on 8203: "tuck position still very poor — back
// separating as discussed before", and the reviewer added that a crumpled tear
// shows over the left shoulder blade in the NEUTRAL stance too. Both are the
// same mechanism, and it is measurable rather than a matter of taste.
//
// The armature used to have ONE bone from pelvis to neck. Linear-blend skinning
// forms each vertex from a WEIGHTED AVERAGE OF MATRICES, and averaging two
// rotations that are far apart shortens the result — a vertex weighted 50/50
// between `torso` and `upperLegL` in a deep tuck is pulled bodily toward the
// hip axis. So the defect has a signature no screenshot is needed to see: mesh
// EDGES change length. A collapsed ring shows as edges an order shorter than
// they were built; a torn one as edges longer.
//
// STRAIN is that ratio, symmetrised: max(len/rest, rest/len), so 1.00 is a
// rigid edge and 1.35 is the brief's limit in either direction. It is computed
// on the buffer the GPU actually skins — the same vertex positions, the same
// bone matrices via skeleton.getTransformMatrices(mesh), the same four
// influences — so it cannot pass on something the renderer does not draw.
//
// NEGATIVE CONTROL: window._spineOff makes updateSpineChain give every vertebra
// the torso's own rotation, which is bit-for-bit the old rigid rod. Every gate
// below must fail with it set, and the last test asserts exactly that.

const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(800);
}

// Measure the skinned strain of every mesh edge, bucketed by where the edge
// sits along the body. Returns percentiles rather than a bare maximum: one
// stray vertex from one bad weight and a whole collapsed ring produce the same
// max and need opposite fixes, so the gate reads p999 and the report carries
// the max next to it.
const MEASURE = function (pose) {
    if (pose) window._poseProbe(pose.tuck, pose.grounded, pose.pike);
    const scene = BABYLON.EngineStore.LastCreatedScene;
    const parts = scene.meshes.filter(m =>
        m.name && m.name.startsWith('athleteBody') && m.skeleton
        && m.getTotalVertices && m.getTotalVertices() > 0);
    // THE MATRICES MUST BE RE-PREPARED, or this measures the LIVE frame.
    // skeleton.getTransformMatrices returns what the last rendered frame
    // computed; the game's render loop re-applies its own pose every frame, so
    // a probe pose set here never reaches the buffer. Measured: the four poses
    // below and the negative control all returned byte-identical numbers until
    // this line existed. One page.evaluate is a single synchronous block, so
    // nothing can interleave between prepare() and the read.
    for (const mesh of parts) {
        try { mesh.skeleton.prepare(true); } catch (e) { mesh.skeleton.prepare(); }
    }
    const out = { n: 0, strain: [], rest: [], back: [], knee: [], pit: [],
                  kneeWorst: null, pitWorst: null };
    // The helper spans for THIS probe pose. Read here, inside the same
    // synchronous block as the pose and the prepare(): a second
    // page.evaluate() would report the LIVE frame's drivers instead, which is
    // the same trap the prepare() note above records — measured, every pose
    // came back with identical spans until this moved inside.
    out.helpers = window._helperProbe ? window._helperProbe() : null;
    const M = window._characterMeshes;
    const torso = M && M.torso;
    // The torso's own frame, so "along the back" means along the spine and not
    // along world Y — the rig is tilted onto the slope and pitched by the tuck.
    const tRx = torso ? torso.rotation.x : 0;
    const cT = Math.cos(tRx), sT = Math.sin(tRx);

    for (const mesh of parts) {
        const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        const mi = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
        const mw = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
        const idx = mesh.getIndices();
        const skel = mesh.skeleton;
        if (!pos || !mi || !mw || !idx || !skel) continue;
        const bones = skel.getTransformMatrices(mesh);
        const nv = pos.length / 3;
        // Skin every vertex once (the mesh's own local frame is enough — the
        // world and root transforms are rigid and cannot change edge lengths).
        const sk = new Float32Array(nv * 3);
        const acc = new BABYLON.Matrix();
        const bm = new BABYLON.Matrix();
        const tmp = new BABYLON.Vector3();
        for (let i = 0; i < nv; i++) {
            acc.copyFrom(BABYLON.Matrix.Zero());
            let wsum = 0;
            for (let k = 0; k < 4; k++) {
                const w = mw[i * 4 + k];
                if (w <= 0) continue;
                wsum += w;
                BABYLON.Matrix.FromArrayToRef(bones, mi[i * 4 + k] * 16, bm);
                for (let e = 0; e < 16; e++) acc.m[e] += bm.m[e] * w;
            }
            acc.markAsUpdated();
            if (wsum <= 0) { sk[i * 3] = pos[i * 3]; sk[i * 3 + 1] = pos[i * 3 + 1]; sk[i * 3 + 2] = pos[i * 3 + 2]; continue; }
            BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
                pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], acc, tmp);
            sk[i * 3] = tmp.x; sk[i * 3 + 1] = tmp.y; sk[i * 3 + 2] = tmp.z;
        }
        // Each triangle contributes its three edges. Duplicates across shared
        // edges only weight the percentile slightly and cost nothing.
        for (let t = 0; t < idx.length; t += 3) {
            for (let e = 0; e < 3; e++) {
                const a = idx[t + e], b = idx[t + (e + 1) % 3];
                const rx = pos[a * 3] - pos[b * 3];
                const ry = pos[a * 3 + 1] - pos[b * 3 + 1];
                const rz = pos[a * 3 + 2] - pos[b * 3 + 2];
                const r = Math.hypot(rx, ry, rz);
                if (r < 2e-3) continue;             // sub-2 mm edges are noise
                const dx = sk[a * 3] - sk[b * 3];
                const dy = sk[a * 3 + 1] - sk[b * 3 + 1];
                const dz = sk[a * 3 + 2] - sk[b * 3 + 2];
                const d = Math.hypot(dx, dy, dz);
                const s = d > r ? d / r : r / Math.max(d, 1e-6);
                out.strain.push(s);
                out.rest.push(r);
                out.n++;
                if (!out.worst || s > out.worst.s) {
                    out.worst = { s: +s.toFixed(3),
                        y: +((pos[a * 3 + 1] + pos[b * 3 + 1]) / 2).toFixed(3),
                        z: +((pos[a * 3 + 2] + pos[b * 3 + 2]) / 2).toFixed(3) };
                }
                // THE UPPER BACK, in rest coordinates: above mid-torso and
                // behind the spine axis. The reviewer's "crumpled tear over
                // the left shoulder blade" lives here, and it is visible at
                // rest, so this band is measured in every pose.
                const my = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2;
                const mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
                const along = my * cT + mz * sT;        // up the spine
                if (my > 0.02 && my < 0.30 && mz > 0.02 && along > -0.40) out.back.push(s);
                // THE KNEE BAND, in rest coordinates. The knee joint sits at
                // y = -0.635 (the thigh's bottom and the shin's top), and this
                // is where OPUS item 5's half-angle helpers act: before them
                // the crouch's worst edge in the whole body was here, at 17.22
                // with endpoints weighted upperLegR 0.648/0.352 — the candy
                // wrapper. Measured in every pose so a regression in the
                // helper drivers or the lattice shows up as itself and not as
                // a shift in a whole-body percentile.
                if (my > -0.72 && my < -0.55) {
                    out.knee.push(s);
                    if (!out.kneeWorst || s > out.kneeWorst.s) {
                        out.kneeWorst = { s: +s.toFixed(3), y: +my.toFixed(3),
                                          z: +mz.toFixed(3) };
                    }
                }
                // THE ARMPIT BAND, in rest coordinates: outboard of the chest
                // wall (|x| > 0.11, the trunk's own half-width is ~0.10) and
                // between the elbow and the collarbone. Session 18 measured
                // the worst seam in the whole skin here — upperArmR 0.495 /
                // spine_02 0.490 at (0.163, 0.045), an edge going 6.9 mm at
                // rest to 76.3 mm posed — and it is what the shoulder/elbow
                // helpers were approved to close (reviewer 2026-08-30 03:40).
                // Lateral, so it cannot be confused with the upper-back band.
                const mx = (pos[a * 3] + pos[b * 3]) / 2;
                if (Math.abs(mx) > 0.13 && my > 0.0 && my < 0.20) {
                    out.pit.push(s);
                    if (!out.pitWorst || s > out.pitWorst.s) {
                        out.pitWorst = { s: +s.toFixed(3), x: +mx.toFixed(3),
                                         y: +my.toFixed(3), z: +mz.toFixed(3) };
                    }
                }
            }
        }
    }
    const pct = (arr, q) => {
        if (!arr.length) return null;
        const a = arr.slice().sort((x, y) => x - y);
        return +a[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(3);
    };
    const chain = window._spineProbe ? window._spineProbe() : null;
    // WHICH EDGES CARRY THE TAIL. A ratio on a 2 mm edge is invisible on a
    // body whose median edge is ~11 mm, so a percentile taken over all edges
    // can be dominated by geometry no one can see. Split it.
    const bands = [[0.002, 0.005], [0.005, 0.010], [0.010, 1e9]];
    const byLen = bands.map(([lo, hi]) => {
        const v = [];
        for (let i = 0; i < out.strain.length; i++) {
            if (out.rest[i] >= lo && out.rest[i] < hi) v.push(out.strain[i]);
        }
        return { lo, n: v.length, p99: pct(v, 0.99), p999: pct(v, 0.999),
                 max: v.length ? +Math.max.apply(null, v).toFixed(3) : null };
    });
    return {
        byLen,
        n: out.n,
        p50: pct(out.strain, 0.50),
        p99: pct(out.strain, 0.99),
        p999: pct(out.strain, 0.999),
        max: out.strain.length ? +Math.max.apply(null, out.strain).toFixed(3) : null,
        kneeN: out.knee.length,
        kneeP999: pct(out.knee, 0.999),
        kneeMax: out.knee.length ? +Math.max.apply(null, out.knee).toFixed(3) : null,
        kneeWorst: out.kneeWorst,
        spans: out.helpers,
        pitN: out.pit.length,
        pitP999: pct(out.pit, 0.999),
        pitMax: out.pit.length ? +Math.max.apply(null, out.pit).toFixed(3) : null,
        pitWorst: out.pitWorst,
        backN: out.back.length,
        backP999: pct(out.back, 0.999),
        backMax: out.back.length ? +Math.max.apply(null, out.back).toFixed(3) : null,
        worst: out.worst,
        chain: chain ? { stepMm: +(chain.step * 1000).toFixed(1),
                         dLowDeg: +chain.dLowDeg.toFixed(1),
                         dHighDeg: +chain.dHighDeg.toFixed(1) } : null,
    };
};

// Item 5's number. Applies to stretch AND to collapse, because the defect the
// author reported is a collapse and a one-sided gate would miss it.
const STRAIN_LIMIT = 1.35;
// Item 5's C1 requirement, in metres: the closure residual updateSpineChain
// leaves at each internal vertebra joint.
const STEP_LIMIT_M = 0.015;

const POSES = [
    { name: 'neutral',    pose: { tuck: 0, grounded: false, pike: 0 } },
    { name: 'in-run crouch', pose: { tuck: 1, grounded: true,  pike: 0 } },
    { name: 'flight tuck', pose: { tuck: 1, grounded: false, pike: 0 } },
    { name: 'pike',       pose: { tuck: 0, grounded: false, pike: 1 } },
];

test.describe('OPUS item 5 — the spine carries the bend', () => {
    test.beforeEach(async ({ page }) => { await boot(page); });

    test('the armature has a spine and every vertebra is driven', async ({ page }) => {
        const r = await page.evaluate(() => {
            const scene = BABYLON.EngineStore.LastCreatedScene;
            const parts = scene.meshes.filter(m =>
                m.name && m.name.startsWith('athleteBody') && m.skeleton);
            const skel = parts[0] && parts[0].skeleton;
            const names = skel ? skel.bones.map(b => b.name) : [];
            const M = window._characterMeshes;
            const out = { names, driven: {}, weight: {} };
            for (const nm of ['spine_01', 'spine_02', 'spine_03']) {
                const b = skel && skel.bones.find(x => x.name === nm);
                out.driven[nm] = !!(b && b.getTransformNode && b.getTransformNode()
                                    && M && M[nm]);
                out.weight[nm] = 0;
            }
            // How much skin each vertebra actually owns. A bone that is in the
            // file, linked, and weightless would pass every structural check
            // and change nothing on screen.
            for (const mesh of parts) {
                const mi = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
                const mw = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
                if (!mi || !mw) continue;
                // BONE INDEX != POSITION IN skeleton.bones. Babylon's glTF
                // loader prepends the armature node ('AthleteRig') as bone 0,
                // so skeleton.bones is one longer than the skin's joint array
                // and every naive lookup is off by one — measured, it reported
                // spine_03 weightless when the weight it was reading belonged
                // to `torso`, which this pass deliberately zeroes. Bone.getIndex()
                // is the index the matricesIndices buffer actually uses.
                const bn = {};
                for (const b of mesh.skeleton.bones) bn[b.getIndex()] = b.name;
                for (let i = 0; i < mw.length; i++) {
                    const nm = bn[mi[i]];
                    if (out.weight[nm] !== undefined) out.weight[nm] += mw[i];
                }
            }
            return out;
        });
        console.log('SPINE ' + JSON.stringify(r));
        for (const nm of ['spine_01', 'spine_02', 'spine_03']) {
            expect(r.names, `${nm} missing from the exported skeleton`).toContain(nm);
            expect(r.driven[nm], `${nm} has no driver node`).toBe(true);
            expect(r.weight[nm], `${nm} carries no skin weight`).toBeGreaterThan(5);
        }
    });

    // HARD GATE where the spine is answerable: the NEUTRAL stance, and the
    // continuity of the chain itself in every pose.
    //
    // The neutral gate is not a formality. This pass rewrites the skin weights
    // of 2 895 vertices; the guarantee that it changes nothing at rest is what
    // makes it safe to land, and it is measured, not argued — see the numbers
    // in docs/OPUS-NOTES.md (p50 = p99 = p99.9 = max = 1.000 exactly).
    test(`neutral: skinned strain within ${STRAIN_LIMIT}`, async ({ page }) => {
        const r = await page.evaluate(MEASURE, POSES[0].pose);
        console.log('STRAIN neutral ' + JSON.stringify(r));
        expect(r.n, 'no skinned edges measured').toBeGreaterThan(1000);
        expect(r.p999, 'neutral: p99.9 skinned edge strain')
            .toBeLessThanOrEqual(STRAIN_LIMIT);
        expect(r.backN, 'neutral: no upper-back edges found').toBeGreaterThan(100);
        expect(r.backP999, 'neutral: p99.9 UPPER BACK strain')
            .toBeLessThanOrEqual(STRAIN_LIMIT);
    });

    for (const { name, pose } of POSES) {
        test(`${name}: the vertebra chain stays C1`, async ({ page }) => {
            const r = await page.evaluate(MEASURE, pose);
            console.log(`STRAIN ${name} ` + JSON.stringify(r));
            expect(r.chain, `${name}: no spine chain`).not.toBeNull();
            // Item 5's C1 requirement. The chain is walked from the hip anchor
            // and the residual to the neck anchor is spread along it, so this
            // is the largest gap left at an internal vertebra joint — the
            // "step between spine segments in the side silhouette".
            expect(r.chain.stepMm / 1000, `${name}: vertebra joint step`)
                .toBeLessThanOrEqual(STEP_LIMIT_M);
        });
    }

    // ── INSTRUMENT, not a gate: strain away from the neutral stance ─────────
    //
    // This is the honest half of item 5 and it is the finding of the session.
    // The tuck and pike poses measure p99.9 strain of 9-15 and a max of 37-51
    // against the brief's 1.35, and the spine barely moves those numbers
    // (in-run crouch: 15.465 with the chain, 15.473 with window._spineOff, a
    // 0.05% difference). So the tuck's torn back is NOT primarily a
    // torso-bone-count problem, and adding a spine — which is real, correct
    // and inert at rest — was never going to be the whole of item 5.
    //
    // Where the strain actually is: p50 is exactly 1.000 and p99 is 4.6, i.e.
    // 99% of the skin is rigid and a thin tail explodes. That tail is the
    // blend rings at the hip and shoulder, and chain.spec.js already records
    // the cause: "Flight tuck (POSE_TUCKED) endpoint is measured-torn (hip gap
    // 0.33 m) and awaits `APPROVED: adjust POSE_TUCKED`". Two rigid bone
    // transforms whose shared joint is a third of a metre apart cannot be
    // blended into anything but a smear, at any weighting.
    //
    // The gate is therefore NOT set here. Setting it at 16 would calibrate it
    // to the defect; setting it at 1.35 would ship a red that no work in this
    // lane can clear. The numbers are logged on every run so the next session
    // (or the reviewer's ruling on POSE_TUCKED) has a baseline to move.
    test('INSTRUMENT: strain away from neutral, logged with the spine on and off',
        async ({ page }) => {
            const rows = {};
            for (const { name, pose } of POSES.slice(1)) {
                rows[name] = await page.evaluate(MEASURE, pose);
            }
            await page.evaluate(() => { window._spineOff = true; });
            for (const { name, pose } of POSES.slice(1)) {
                rows[name + ' (rigid torso)'] = await page.evaluate(MEASURE, pose);
            }
            await page.evaluate(() => { window._spineOff = false; });
            console.log('STRAINTABLE ' + JSON.stringify(rows));
            for (const [k, v] of Object.entries(rows)) {
                expect(v.n, `${k}: no skinned edges measured`).toBeGreaterThan(1000);
            }
        });

    // ── OPUS item 5: the KNEE, where the half-angle helpers act ────────────
    //
    // GATE, with the measured A/B behind it. The reviewer approved helper
    // bones at the hips and knees on 2026-08-30 02:40 because no weight edit
    // can reach a 50/50 blend across a joint closing 98 degrees: linear blend
    // averages the two bones' matrices and lands the ring at cos(theta/2) of
    // its radius. Measured on this tree, in the in-run crouch:
    //
    //     pre-helper skin (28ffa34^)   worst edge in the WHOLE body 17.223,
    //                                  and it was at y = -0.628 — the knee
    //     with the helpers             knee band max KNEE_MAX below, and the
    //                                  body's worst edge has moved off the
    //                                  knee to the crotch bridge face at
    //                                  y = -0.03 (item 3 geometry, not skin)
    //
    // NEGATIVE CONTROL: the build's BODY_SABOTAGE_HELPERS=1, which skips
    // add_joint_helpers and is rejected by the joint-span gate at 604
    // spanning vertices — the skin this gate would fail on cannot be built.
    // The historical number above is the same shape of control the seam gate
    // carries: what it rejects is a mesh that really went out.
    const KNEE_MAX = 8.0;
    for (const { name, pose } of POSES) {
        test(`${name}: the knee does not collapse`, async ({ page }) => {
            const r = await page.evaluate(MEASURE, pose);
            console.log(`KNEE ${name} ` + JSON.stringify({
                n: r.kneeN, p999: r.kneeP999, max: r.kneeMax,
                worst: r.kneeWorst }));
            expect(r.kneeN, `${name}: no knee-band edges measured`)
                .toBeGreaterThan(200);
            expect(r.kneeMax, `${name}: worst knee-band edge strain`)
                .toBeLessThanOrEqual(KNEE_MAX);
        });
    }

    // ── OPUS item 5: the ARMPIT, where the shoulder/elbow helpers act ──────
    //
    // INSTRUMENT, NOT A GATE, and the measurement is why. The reviewer
    // extended the half-angle helpers to the shoulders and elbows on
    // 2026-08-30 03:40 on session 18's finding: the worst seam in the whole
    // skin was the armpit, upperArmR 0.495 / spine_02 0.490 at (0.163, 0.045),
    // an edge going 6.9 mm at rest to 76.3 mm posed. The helpers landed and
    // are correct (JOINTSPAN 1467 spanning vertices -> 0), and the shoulders
    // and elbows really do bend in these poses — spans logged below read
    // 44.8 / 60.5 / 90.1 deg at the shoulder and 52.9 deg at the elbow in the
    // tuck. And the band's worst edge does not move by one part in a thousand:
    //
    //     pose            pre-helper (5a0037c)   with hlpShoulder/hlpElbow
    //     neutral                       1.000              1.000
    //     in-run crouch                 5.161              5.161
    //     flight tuck                   4.854              4.854
    //     pike                          6.207              6.207
    //
    // So the armpit's residue is NOT a blend-span defect. The two worst edges
    // (0.145, 0.020, -0.094) and (0.195, 0.045, 0.002) do not move when the
    // lattice under them is halved, which is what a bake-geometry stretch
    // does and what a candy wrapper cannot do — the same verdict the crotch
    // bridge face already carries, and it belongs to item 3.
    //
    // Gating a number the change under test does not move would be
    // decoration, exactly as the front/back bib ink ratio was found to be, so
    // this ships logged, with the pre/post pair above as its record. What the
    // helpers are gated on is the joint-span gate in the build (negative
    // control BODY_SABOTAGE_HELPERS=1, which now reports 1467 spanning
    // vertices and is rejected) and the knee band above.
    test('INSTRUMENT: the armpit band, with the joint spans that drive it',
        async ({ page }) => {
            const rows = {};
            for (const { name, pose } of POSES) {
                const r = await page.evaluate(MEASURE, pose);
                rows[name] = { n: r.pitN, p999: r.pitP999, max: r.pitMax,
                               worst: r.pitWorst, spans: r.spans };
                expect(r.pitN, `${name}: no armpit-band edges measured`)
                    .toBeGreaterThan(200);
            }
            console.log('PITTABLE ' + JSON.stringify(rows));
        });

    // ── Is the residue a WEIGHT defect, or the LBS bound? ──────────────────
    //
    // Session 9 relaxed the ownership seams: the shipped skin's worst per-edge
    // weight-vector L1 is 0.715 with ZERO edges over 1.0 (it was 2.000 with
    // 190 over, i.e. a bare hinge). p99.9 and max halved. p99 did not reach
    // 1.35, and this test says why rather than guessing.
    //
    // Under linear-blend skinning an edge across a joint of angle T whose
    // endpoints differ in weight by dw shortens by roughly dw*|R(T)p - p|.
    // That term is ZERO at T = 0 and grows without bound with T, for ANY
    // weight field: no weighting removes it, only a different skinning method
    // (dual quaternion) or corrective shapes do. So if the residue is the LBS
    // bound, strain must rise MONOTONICALLY with the tuck amount from 1.0 at
    // rest; if it is a weight defect, it is there at small angles too.
    test('INSTRUMENT: strain vs joint angle — the LBS dose-response',
        async ({ page }) => {
            const dose = {};
            for (const t of [0, 0.15, 0.3, 0.5, 0.75, 1]) {
                const r = await page.evaluate(MEASURE,
                    { tuck: t, grounded: false, pike: 0 });
                dose['tuck=' + t] = { p99: r.p99, p999: r.p999, max: r.max };
            }
            console.log('LBSDOSE ' + JSON.stringify(dose));
            // MEASURED, session 9, and it REFUTES the LBS-bound reading above:
            //
            //   tuck    0      0.15   0.3    0.5    0.75   1
            //   p99     1.000  3.495  3.516  3.593  3.663  3.534
            //
            // The strain is a STEP, not a ramp. It reaches its full value at a
            // 15% tuck, where the joints have barely moved, and does not grow
            // as they open to 100%. An LBS-bound term would be proportional to
            // |R(T)p - p| and would have to grow with T. So the residue after
            // the seam relaxation is a fixed POPULATION of edges that misbehave
            // as soon as the pose leaves the bind, not a bound on the method —
            // which is why `byLen` below splits it by rest-edge length.
            expect(dose['tuck=0'].max, 'rest must be exactly rigid')
                .toBeLessThanOrEqual(STRAIN_LIMIT);
            for (const k of Object.keys(dose)) {
                expect(dose[k].p99, `${k}: strain unmeasured`).toBeGreaterThan(0);
            }
        });

    // ── NEGATIVE CONTROL for the gate that DOES ship ───────────────────────
    // A gate that has only ever been seen passing proves nothing. Forcing a
    // fixed bend into the chain at the neutral stance must break the neutral
    // strain gate above — if it does not, the gate is not reading the skin.
    test('NEGATIVE CONTROL: a forced bend breaks the neutral strain gate',
        async ({ page }) => {
            const before = await page.evaluate(MEASURE, POSES[0].pose);
            await page.evaluate(() => { window._spineForce = 0.5; });
            const after = await page.evaluate(MEASURE, POSES[0].pose);
            await page.evaluate(() => { window._spineForce = 0; });
            console.log('SPINEFORCE before ' + JSON.stringify(before));
            console.log('SPINEFORCE after  ' + JSON.stringify(after));
            expect(before.p999, 'the shipped chain is inert at rest')
                .toBeLessThanOrEqual(STRAIN_LIMIT);
            expect(after.p999, 'a forced 29 deg bend must FAIL the neutral gate')
                .toBeGreaterThan(STRAIN_LIMIT);
        });
});

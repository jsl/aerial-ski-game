'use strict';
/**
 * Whole-run clearance comparison (reviewer order item 3, iteration 14).
 *
 * Drives a golden scenario headlessly in THIS checkout and, every frame,
 * computes the lowest world-space point of each ski driver's box and of the
 * athlete body-proxy nodes against BOTH surfaces:
 *   - physics:  terrainRootY(z, liveCfg) - FOOT_OFFSET
 *   - visual:   reconstructed top faces of the scene's terrain boxes (the
 *               pre-P1 slab renderer), or terrainCorridor's profile when the
 *               ribbon tree is probed (its parity with the physics surface is
 *               gated by tests/drive/terrain-corridor.spec.js)
 *
 * Run from any checkout/worktree root:
 *   node tools/clearance-compare.js --scenario aerial-power-75
 *
 * No npm deps, no engine/ changes: constants are read out of game.js's vm
 * context exactly the way tests/unit/terrain.test.js's configFor does.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const { createEnv } = require(path.join(ROOT, 'tests/golden/browser-env.js'));
const { extendStub } = require(path.join(ROOT, 'tests/golden/stub-extend.js'));
const { ENGINE_MODULES } = require(path.join(ROOT, 'tests/golden/harness.js'));

const args = process.argv.slice(2);
function argOf(name, dflt) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
}
const SCENARIO_NAME = argOf('--scenario', 'aerial-power-75');
const SAMPLE_EVERY = Number(argOf('--every', '2'));
// Debug: print per-frame root/ski world state inside [a,b] (--dump 280:300)
const DUMP = argOf('--dump', null);

// ── quaternion helpers ──────────────────────────────────────────────────────
function qMul(a, b) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}
function qConj(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; }
function qRotV(q, v) {
    // t = q' (0,v) q  implemented via the standard sandwich
    const qc = qConj(q);
    // rotate v by q: use formula v' = v + 2*w*(u x v) + 2*(u x (u x v))
    function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
    const u = { x: q.x, y: q.y, z: q.z };
    const uv = cross(u, v);
    const uuv = cross(u, uv);
    const w2 = 2 * q.w;
    return {
        x: v.x + w2 * uv.x + 2 * uuv.x,
        y: v.y + w2 * uv.y + 2 * uuv.y,
        z: v.z + w2 * uv.z + 2 * uuv.z,
    };
}
const V = (n) => ({ x: n.position.x, y: n.position.y, z: n.position.z });

/** Composed world position + rotation for a stub node (same walk the harness
 *  performs; returns position and world-space quaternion). */
function world(node) {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.push(n);
    chain.reverse();
    let pos = { x: 0, y: 0, z: 0 };
    let rot = { x: 0, y: 0, z: 0, w: 1 };
    for (const n of chain) {
        const lp = V(n);
        const r = qRotV(rot, lp);
        pos = { x: pos.x + r.x, y: pos.y + r.y, z: pos.z + r.z };
        let lq;
        if (n.rotationQuaternion) lq = n.rotationQuaternion;
        else if (n.rotation) {
            // XYZ-order euler -> quat, matching the stub's localQuat
            const e = n.rotation;
            const cx = Math.cos(e.x / 2), sx = Math.sin(e.x / 2);
            const cy = Math.cos(e.y / 2), sy = Math.sin(e.y / 2);
            const cz = Math.cos(e.z / 2), sz = Math.sin(e.z / 2);
            lq = {
                w: cx * cy * cz + sx * sy * sz,
                x: sx * cy * cz - cx * sy * sz,
                y: cx * sy * cz + sx * cy * sz,
                z: cx * cy * sz - sx * sy * cz,
            };
        } else lq = { x: 0, y: 0, z: 0, w: 1 };
        rot = qMul(rot, lq);
    }
    return { pos, rot };
}

// ── boot ────────────────────────────────────────────────────────────────────
const scenarios = require(path.join(ROOT, 'tests/golden/scenarios.js'));
const list = scenarios.scenarios || scenarios;
const sc = (Array.isArray(list) ? list : Object.values(list)).find((s) => s.name === SCENARIO_NAME);
if (!sc) throw new Error(`scenario ${SCENARIO_NAME} not found`);

const search = sc.search || '';
const seed = sc.seed;
const localStorage = sc.localStorage;
const env = createEnv({ search, seed, localStorage });

env.load(path.join(ROOT, 'tests/babylon-stub.js'));
extendStub(env.ctx);

// Record every CreateBox call's dimensions between the stub and game.js so the
// slab-era visual surface can be reconstructed analytically afterwards.
const boxDims = new Map();
{
    const MB = env.ctx.BABYLON.MeshBuilder;
    for (const key of Object.keys(MB)) {
        if (!/^Create(Box|Cylinder|Ground)$/.test(key)) continue;
        const orig = MB[key];
        MB[key] = function (name, opts, scene) {
            if (/^(Box|Ground)$/.test(key.replace('Create', ''))) boxDims.set(name, { ...opts });
            return orig.call(this, name, opts, scene);
        };
    }
}

for (const mod of ENGINE_MODULES) env.load(path.join(ROOT, mod));
env.load(path.join(ROOT, 'game.js'));

const ctx = env.ctx;
const BABYLON = ctx.BABYLON;
if (!BABYLON || !BABYLON._engine) throw new Error('boot failed');
const g = (expr) => { try { return vm.runInContext(expr, ctx); } catch { return undefined; } };

// Live physics config mirror (unit-test configFor convention; optional keys
// tolerate older trees, e.g. main's creased-profile fallback).
function makeConfig(engine) {
    const cfg = engine.makePhysicsConfig();
    // pairs of [cfg key, game.js top-level constant]; older trees simply do
    // not define the blend globals and keep their engine defaults.
    const PAIRS = [
        ['SLOPE_ANGLE', 'SLOPE_ANGLE'], ['SLOPE_START_Z', 'SLOPE_START_Z'],
        ['FLAT_Z', 'FLAT_Z'], ['TRANS_START_Z', 'TRANS_START_Z'],
        ['TRANS_END_Z', 'TRANS_END_Z'], ['KICKER_START_Z', 'KICKER_START_Z'],
        ['KICKER_END_Z', 'KICKER_END_Z'], ['LANDING_START_Z', 'LANDING_START_Z'],
        ['OUTRUN_Z', 'OUTRUN_Z'], ['LANDING_ANGLE', 'LANDING_ANGLE'],
        ['MAT_LAND_START_Z', 'MAT_LAND_START_Z'], ['MAT_LAND_END_Z', 'MAT_LAND_END_Z'],
        ['TRAMPOLINE_Y', 'TRAMPOLINE_Y'], ['tBP', '_tBP'], ['kBP', '_kBP'],
        ['ltArc', '_ltArc'], ['loArc', '_loArc'],
        ['LANDING_TRANS_LEN', 'LANDING_TRANS_LEN'], ['OUTRUN_TRANS_LEN', 'OUTRUN_TRANS_LEN'],
    ];
    for (const [ckey, glob] of PAIRS) {
        const v = g(glob);
        if (v !== undefined) cfg[ckey] = v;
    }
    return cfg;
}
const aerial = require(path.join(ROOT, 'engine/disciplines/aerial-ski.js'));
const cfg = makeConfig(aerial);
const FOOT_OFFSET = g('FOOT_OFFSET');

// Slab-era trees (main / pre-P1): only corridor geometry counts as the
// under-skier visual surface. Flank/mountain fills (wUpperMtn ...) are big
// tilted boxes far outboard that must never answer a corridor query.
const CORRIDOR_NAME_RE = /^(slope$|start$|trans_seg_\d+$|flatTable$|flatTableFull$|kicker_seg_\d+$|landing$|outrun$|corner_inrun_trans$|corner_trans_table$|corner_table_landing$|corner_landing_outrun$)/;

// terrain box snapshots (static geometry)
function terrainBoxes() {
    const out = [];
    for (const [name, n] of BABYLON._nodes.entries()) {
        if (!boxDims.has(name)) continue;
        const d = boxDims.get(name);
        const W = d.width ?? 2, H = d.height ?? 2, D = d.depth ?? 2;
        if (W === 2 && H === 2 && D === 2) continue; // default-stub noise
        const t = world(n);
        out.push({ name, W, H, D, ...t });
    }
    return out.filter((b) => CORRIDOR_NAME_RE.test(b.name));
}

// Ribbon detection: P1 trees have a single continuous corridor and no slab
// stacks; reconstructing it here would duplicate game.js sampling logic, which
// terrain-corridor.spec.js already gates to <=2 cm. Detect and report instead.
let ribbonMode = false;
for (const name of BABYLON._nodes.keys()) if (/terrainCorridor/.test(name)) ribbonMode = true;
const boxes = terrainBoxes();

// Highest top-face Y at (x,z) across containing boxes.
function visualY(x, z) {
    let best = -Infinity;
    for (const b of boxes) {

        // in-box frame test on the query point's XZ
        const Q = b.rot;
        const Ri = qConj(Q);
        const lp = qRotV(Ri, { x: x - b.pos.x, y: -b.pos.y, z: z - b.pos.z });
        if (Math.abs(lp.x) > b.W / 2 + 1e-9 || Math.abs(lp.z) > b.D / 2 + 1e-9) continue;
        // top-face plane height at (x,z): n = worldRot * (0,1,0)
        const nx = 2 * (Q.x * Q.y - Q.w * Q.z);
        const ny = 1 - 2 * (Q.x * Q.x + Q.z * Q.z);
        const nz = 2 * (Q.y * Q.z + Q.w * Q.x);
        if (Math.abs(ny) < 1e-6) continue;
        const ex = x - b.pos.x, ez = z - b.pos.z;
        const y = b.pos.y + (b.H / 2) * ny - (ex * nx + ez * nz) / ny;
        if (y > best) best = y;
    }
    return best === -Infinity ? null : best;
}

function physicsY(z) { return aerial.terrainRootY(z, cfg) - FOOT_OFFSET; }

// Lowest local-Y sample grid over one ski box (matches _readyStanceProbe's
// corner grid, densified along the length).
function skiLowestPoints(skNode, half) {
    const pts = [];
    const t = world(skNode);
    for (let i = 0; i <= 4; i++) {
        const s = -half.d + (2 * half.d) * (i / 4);
        for (const e of [-half.x, half.x]) {
            const loc = qRotV(t.rot, { x: e, y: -half.h, z: s });
            pts.push({ x: t.pos.x + loc.x, y: t.pos.y + loc.y, z: t.pos.z + loc.z });
        }
    }
    return pts;
}

// Body proxy: every driver/boot/appendage node whose name marks silhouette-
// bounding hardware or extremity (boots, gloves, head pieces are the bits the
// author sees disappear).
const BODY_PROXY_RE = /ski[LR]$|skierRoot$|boot|glove|helmet|head$|neck$|visor$/;

// ── drive the scenario ──────────────────────────────────────────────────────
const framesOut = [];
const byFrame = new Map();
for (const a of sc.script || []) {
    if (!byFrame.has(a.at)) byFrame.set(a.at, []);
    byFrame.get(a.at).push(a);
}

function phaseOf(state) {
    if (state.crashed) return 'crash';
    const z = state.posZ;
    if (!state.grounded) return 'air';
    if (z < cfg.TRANS_START_Z) return 'inrun';
    if (z < cfg.KICKER_START_Z) return 'transition';
    if (z < cfg.KICKER_END_Z) return 'kicker';
    if (z < cfg.LANDING_START_Z) return 'air';
    if (z < cfg.OUTRUN_Z) return 'landing';
    return 'outrun';
}

let error = null;
const totalFrames = sc.frames || 900;
for (let f = 0; f < totalFrames && !error; f++) {
    for (const a of byFrame.get(f) || []) {
        if (a.down) env.key('keydown', a.down);
        if (a.up) env.key('keyup', a.up);
        if (a.pad !== undefined) env.gamepadState.connected = !!a.pad;
        if (a.axis) env.gamepadState.axes[a.axis[0]] = a.axis[1];
        if (a.btn) env.gamepadState.buttons[a.btn[0]] = a.btn[1];
    }
    try {
        BABYLON._engine._tick(1);
        env.advanceTimers(16.667);
    } catch (e) {
        error = String(e && e.message || e);
        break;
    }
    if (BABYLON._lastError) { error = 'swallowed: ' + BABYLON._lastError; break; }

    if (f % SAMPLE_EVERY !== 0) continue;
    const st = ctx._getGameState ? ctx._getGameState() : null;
    if (!st) continue;

    if (DUMP) {
        const [a, b] = DUMP.split(':').map(Number);
        if (f >= a && f <= b) {
            const root = BABYLON._nodes.get('skierRoot');
            const skL = BABYLON._nodes.get('skiL');
            const rw = root && world(root);
            const sw2 = skL && world(skL);
            console.error(`f=${f} ph=${phaseOf(st)} g=${st.grounded} z=${st.posZ.toFixed(2)} root.y=${rw ? rw.pos.y.toFixed(3) : '-'} root.q=${rw ? JSON.stringify([rw.rot.x, rw.rot.y, rw.rot.z, rw.rot.w].map((v) => +v.toFixed(3))) : '-'} skiL.p=${sw2 ? `${sw2.pos.x.toFixed(3)},${sw2.pos.y.toFixed(3)},${sw2.pos.z.toFixed(3)}` : '-'} surf=${physicsY(st.posZ).toFixed(2)} airTime=${st.airTime}`);
        }
    }

    const segHalf = { x: 0.04, h: 0.015, d: 0.6 }; // ski: w .08 h .03 d 1.20 (SEGMENTS, both trees)
    // Lip-overhang handling: within ~3 m before the lip a launching ski is
    // already pitched tens of degrees while terrainRootY still extrapolates
    // the near-vertical kicker face as solid — the heightfield cannot
    // represent the air behind the lip (tests/drive/terrain-corridor.spec.js
    // excludes the same span). Skip such samples, count them.
    const rootN = BABYLON._nodes.get('skierRoot');
    const rootW = rootN ? world(rootN) : null;
    const upLocal = rootW ? (() => {
        const v = qRotV(rootW.rot, { x: 0, y: 1, z: 0 });
        return { deg: Math.acos(Math.max(-1, Math.min(1, v.y))) * 180 / Math.PI };
    })() : { deg: 0 };
    const skipSample = (pz) => pz > cfg.KICKER_END_Z - 3 && pz < cfg.LANDING_START_Z + 2 && upLocal.deg > 30;

    const samples = [];
    let skipCount = 0;
    for (const nm of ['skiL', 'skiR']) {
        const nd = BABYLON._nodes.get(nm);
        if (!nd) continue;
        for (const p of skiLowestPoints(nd, segHalf)) {
            if (skipSample(p.z)) { skipCount++; continue; }
            const py = physicsY(p.z);
            const vy = ribbonMode ? py : visualY(p.x, p.z);
            samples.push({
                ski: nm, x: p.x, y: p.y, z: p.z,
                clearPhys: p.y - py,
                clearVis: vy === null ? null : p.y - vy,
            });
        }
    }

    // body proxy: lowest body-hardware node point vs surfaces (points only —
    // node origins, a coarse lower bound for skin extremities)
    let lowestBody = null;
    for (const [name, n] of BABYLON._nodes.entries()) {
        if (!BODY_PROXY_RE.test(name)) continue;
        const w = n.getAbsolutePosition ? n.getAbsolutePosition() : null;
        if (!w || !Number.isFinite(w.y)) continue;
        if (skipSample(w.z)) continue;
        if (!lowestBody || w.y < lowestBody.y) {
            const py = physicsY(w.z);
            const vy = ribbonMode ? py : visualY(w.x, w.z);
            lowestBody = { name, x: w.x, y: w.y, z: w.z, clearPhys: w.y - py, clearVis: vy === null ? null : w.y - vy };
        }
    }

    framesOut.push({
        f, phase: phaseOf(st), grounded: st.grounded, crashed: st.crashed,
        posZ: st.posZ, rootY: st.posZ >= 0 ? physicsY(st.posZ) : physicsY(st.posZ),
        skipped: skipCount,
        samples, lowestBody,
    });
}

// ── aggregate ───────────────────────────────────────────────────────────────
function agg(rows, key) {
    const xs = rows.map((r) => key(r)).filter((v) => v !== null && Number.isFinite(v));
    if (!xs.length) return null;
    return { min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}

const phases = ['inrun', 'transition', 'kicker', 'air', 'landing', 'outrun'];
const table = {};
for (const ph of phases) {
    const rows = framesOut.filter((r) => r.phase === ph);
    const flat = [];
    for (const r of rows) for (const s of r.samples) flat.push(s);
    table[ph] = {
        frames: rows.length,
        skiVsPhysics: agg(flat, (s) => s.clearPhys),
        skiVsVisual: agg(flat, (s) => s.clearVis),
        bodyVsPhysics: agg(rows.map((r) => r.lowestBody).filter(Boolean), (s) => s.clearPhys),
        bodyVsVisual: agg(rows.map((r) => r.lowestBody).filter(Boolean), (s) => s.clearVis),
        worstSkiPhysRow: rows.reduce((best, r) => {
            const m = Math.min(...r.samples.map((s) => s.clearPhys));
            return !best || m < best.clearPhys ? { f: r.f, z: +r.posZ.toFixed(2), clearPhys: m } : best;
        }, null),
    };
}

const worstPenetration = framesOut.reduce((acc, r) => {
    for (const s of r.samples) {
        if (s.clearPhys < (acc.phys?.clearPhys ?? Infinity)) acc.phys = { f: r.f, phase: r.phase, ...s };
        if (s.clearVis !== null && s.clearVis < (acc.vis?.clearVis ?? Infinity)) acc.vis = { f: r.f, phase: r.phase, ...s };
    }
    return acc;
}, {});

const report = {
    scenario: SCENARIO_NAME,
    tree: fs.realpathSync(ROOT),
    ribbonMode,
    boxCount: boxes.length,
    boxNames: boxes.map((b) => b.name),
    error,
    FOOT_OFFSET,
    framesSampled: framesOut.length,
    lipSamplesSkipped: framesOut.reduce((a, r) => a + (r.skipped || 0), 0),
    phases: table,
    worstPenetration,
};

const outFile = argOf('--json', null);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log(`# clearance-compare — ${SCENARIO_NAME} @ ${report.tree}`);
console.log(`# ribbon=${ribbonMode} boxes=${boxes.length} FOOT_OFFSET=${FOOT_OFFSET} sampledFrames=${framesOut.length}${error ? ' ERROR=' + error : ''}`);
console.log('phase       n    skiMinPhys  skiMaxPhys   skiMinVis   bodyMinPhys  bodyMinVis   worstFrame(z)');
const fmtN = (a) => (a === null || a === undefined || !Number.isFinite(a)) ? '--' : a.toFixed(4);
for (const ph of phases) {
    const t = table[ph];
    if (!t.frames) continue;
    const worst = t.worstSkiPhysRow ? `f=${t.worstSkiPhysRow.f} (z=${t.worstSkiPhysRow.z})` : '-';
    console.log(
        `${ph.padEnd(11)} ${String(t.frames).padStart(3)}  `
        + `${fmtN(t.skiVsPhysics && t.skiVsPhysics.min)}  ${fmtN(t.skiVsPhysics && t.skiVsPhysics.max)}  `
        + `${t.skiVsVisual ? fmtN(t.skiVsVisual.min) : '--'}  `
        + `${fmtN(t.bodyVsPhysics && t.bodyVsPhysics.min)}  `
        + `${t.bodyVsVisual ? fmtN(t.bodyVsVisual.min) : '--'}   ${worst}`);
}
console.log('worst penetration vs physics:', JSON.stringify(worstPenetration.phys));
console.log('worst penetration vs visual :', JSON.stringify(worstPenetration.vis));

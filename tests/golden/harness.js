'use strict';
// ── Golden-trace harness ─────────────────────────────────────────────────────
// Boots game.js headlessly against the Babylon stub and records the full
// observable simulation state every frame.
//
// Why capture node transforms and not just _getGameState():
// _getGameState() exposes 12 fields and omits most of the physics that matters
// (flip angle, vertical velocity, per-joint pose). The node transforms ARE the
// observable output — what the player actually sees — so preserving them is
// exactly the refactor contract. Capturing them also needs no change to
// game.js, keeping the baseline honest.

const path = require('node:path');
const { createEnv }   = require('./browser-env');
const { extendStub }  = require('./stub-extend');

const ROOT       = path.resolve(__dirname, '..', '..');
const STUB_PATH  = path.join(ROOT, 'tests', 'babylon-stub.js');
const GAME_PATH  = path.join(ROOT, 'game.js');

/**
 * Engine modules game.js depends on, in load order. MUST stay in sync with the
 * SRCS list in index.html and the <script> tags in tests/test.html — if they
 * drift, the browser and the headless harness run different code.
 */
const ENGINE_MODULES = [
    // Dependency order: inertia needs math and bodyModel, so they precede it.
    'engine/core/math.js',
    'engine/core/body-model.js',
    'engine/core/pose.js',
    'engine/core/inertia.js',
    'engine/core/power.js',
    'engine/core/rotation.js',
    'render/textures.js',
    'engine/core/tricks.js',
    'engine/core/landing.js',
    // Discipline modules load after the shared core they depend on.
    'engine/disciplines/aerial-ski.js',
    'engine/core/kinematics.js',
];

/** Nodes folded into the per-frame digest — the athlete and its limbs. */
const DIGEST_NODES = [
    'skierRoot', 'torso', 'head',
    'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
    'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
    'skiL', 'skiR',
];

/** Decimal places retained in traces. Below float64 noise, above visual relevance. */
const PRECISION = 6;

function round(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return n;
    const f = 10 ** PRECISION;
    // +0 normalises -0, which JSON round-trips inconsistently.
    return Math.round(n * f) / f + 0;
}

/**
 * Load the stub, the engine core and game.js into an existing env, in the exact
 * order index.html uses.
 *
 * Every caller that boots game.js MUST go through this. Four separate scripts
 * previously duplicated the sequence, and when `game.js` gained a parse-time
 * dependency on `AerialEngine.math`, two of them silently started throwing
 * `ReferenceError` — including the BUG-001 reproducer that docs/FINDINGS.md
 * tells readers to run. Centralising it makes that class of drift impossible.
 */
function loadGameInto(env) {
    env.load(STUB_PATH);
    // Renderer surface a full boot touches but the browser suite never reaches.
    // Must sit between the stub and game.js.
    extendStub(env.ctx);
    // Shared engine core — game.js reads AerialEngine.math at parse time.
    for (const mod of ENGINE_MODULES) env.load(path.join(ROOT, mod));
    env.load(GAME_PATH);
    return env;
}

/**
 * Boot a headless simulation.
 * @param {object}  opts
 * @param {string} [opts.search] URL query string selecting discipline/config
 */
function createSim(opts = {}) {
    const env = createEnv({
        search: opts.search || '',
        seed: opts.seed,
        localStorage: opts.localStorage,
    });

    loadGameInto(env);

    const { ctx } = env;
    const BABYLON = ctx.BABYLON;

    if (!BABYLON || !BABYLON._engine) {
        throw new Error('game.js did not initialise an Engine — stub load order wrong?');
    }
    if (BABYLON._lastError) {
        throw new Error('game.js threw during init: ' + BABYLON._lastError);
    }

    /** Snapshot every named node's transform, sorted for stable ordering. */
    function captureNodes() {
        const out = {};
        const names = [...BABYLON._nodes.keys()].sort();
        for (const name of names) {
            // OPUS ITEM 5: the spine_01..03 driver nodes are NOT recorded.
            //
            // They carry no state of their own. updateSpineChain walks them up
            // the torso mesh driver every frame from transforms this trace
            // already records in full (torso, head, upperLeg*), so a change in
            // any of them shows up here through its cause, and a change in the
            // spine alone is a rendering change these traces do not exist to
            // pin. Recording them would have meant re-capturing all 30 golden
            // traces to add three derived nodes, which ADR-0005 reserves for
            // deliberate behaviour changes — this is not one.
            //
            // The spine's own geometry is gated in tests/drive/spine.spec.js
            // (structure, weights, skinned strain, chain C1 continuity), with
            // a negative control.
            // Same for the four hlp* joint helpers (OPUS item 5, reviewer
            // approval 2026-08-30 02:40): updateJointHelpers walks each one to
            // the half-angle of two bones this trace already records in full
            // (spine_01 is itself derived from torso/head/upperLeg*), so a
            // change in a helper shows up here through its cause.
            if (/^spine_\d+$/.test(name) || /^hlp[A-Z]/.test(name)) continue;
            const n = BABYLON._nodes.get(name);
            if (!n) continue;
            const rec = {};
            if (n.position) rec.p = [round(n.position.x), round(n.position.y), round(n.position.z)];
            if (n.rotation) rec.r = [round(n.rotation.x), round(n.rotation.y), round(n.rotation.z)];
            if (n.rotationQuaternion) {
                const q = n.rotationQuaternion;
                rec.q = [round(q.x), round(q.y), round(q.z), round(q.w)];
            }
            if (n.scaling) rec.s = [round(n.scaling.x), round(n.scaling.y), round(n.scaling.z)];
            if (typeof n.isVisible === 'boolean' && n.isVisible === false) rec.hidden = true;

            // Enabled state: a disabled root hides the athlete completely. This
            // was previously commented as captured but was not — setEnabled(false)
            // on the root every frame passed 30/30 with the skier invisible.
            if (n._enabled === false) rec.off = true;

            // WORLD position, not just local. Local transforms alone do not
            // describe what the player sees: reparenting the head onto the right
            // shin left 17/30 scenarios passing, because every local transform
            // was unchanged. The parent chain is the missing dimension.
            if (typeof n.getAbsolutePosition === 'function') {
                try {
                    const w = n.getAbsolutePosition();
                    rec.w = [round(w.x), round(w.y), round(w.z)];
                } catch { /* node not yet in a resolvable chain */ }
            }
            // Parent identity, so a reparent is visible even if positions coincide.
            rec.par = (n.parent && n.parent.name) ? n.parent.name : null;

            if (Object.keys(rec).length) out[name] = rec;
        }
        return out;
    }

    function gameState() {
        if (typeof ctx._getGameState !== 'function') return null;
        const s = ctx._getGameState();
        const out = {};
        for (const [k, v] of Object.entries(s)) out[k] = typeof v === 'number' ? round(v) : v;
        return out;
    }

    return {
        env,
        ctx,
        BABYLON,

        /** Advance N frames at the stub's fixed 16.667 ms step. */
        tick(n = 1) {
            for (let i = 0; i < n; i++) {
                BABYLON._engine._tick(1);
                // Same 16.667 ms the stub reports via getDeltaTime(), so virtual
                // timers stay in lockstep with simulated time.
                env.advanceTimers(16.667);
            }
            if (BABYLON._lastError) {
                const e = BABYLON._lastError;
                BABYLON._lastError = null;
                throw new Error('render loop threw: ' + (e && e.stack ? e.stack : e));
            }
        },

        keyDown(code) { env.key('keydown', code); },
        keyUp(code)   { env.key('keyup',   code); },

        /** Connect/disconnect the synthetic gamepad. */
        setGamepadConnected(v) { env.gamepadState.connected = !!v; },

        /** Set an axis (-1..1). Standard mapping: 0=LX 1=LY 2=RX 3=RY. */
        setAxis(i, v) { env.gamepadState.axes[i] = v; },

        /** Set a button's pressed state and analogue value. */
        setButton(i, pressed, value) {
            const b = env.gamepadState.buttons[i];
            if (!b) return;
            b.pressed = !!pressed;
            b.touched = !!pressed;
            b.value   = value !== undefined ? value : (pressed ? 1 : 0);
        },

        /**
         * Cheap per-frame digest of the athlete's observable state.
         *
         * Traces sample every 5th frame, which leaves 4 of every 5 frames
         * unconstrained — demonstrated by slamming the root orientation to
         * identity on those frames and still passing 30/30. This is folded in on
         * EVERY frame and recorded at each keyframe, so a transient that resolves
         * before the next sample still changes the digest.
         *
         * FNV-1a over the quantised values; collision risk is irrelevant here
         * because we compare against a recorded baseline, not a security target.
         */
        frameDigest(prev) {
            let h = (prev === undefined ? 0x811c9dc5 : prev) >>> 0;
            const fold = (v) => {
                const q = Math.round((typeof v === 'number' && Number.isFinite(v) ? v : 0) * 1e6);
                h ^= q & 0xffffffff;
                h = Math.imul(h, 0x01000193) >>> 0;
            };
            for (const name of DIGEST_NODES) {
                const n = BABYLON._nodes.get(name);
                if (!n) { fold(NaN); continue; }
                if (n.position) { fold(n.position.x); fold(n.position.y); fold(n.position.z); }
                const q = n.rotationQuaternion;
                if (q) { fold(q.x); fold(q.y); fold(q.z); fold(q.w); }
                else if (n.rotation) { fold(n.rotation.x); fold(n.rotation.y); fold(n.rotation.z); }
                fold(n._enabled === false ? 1 : 0);
            }
            const s = gameState();
            if (s) {
                fold(s.posZ); fold(s.spinAngle); fold(s.tuckAmount);
                fold(s.airTime); fold(s.flipPower);
                fold(s.grounded ? 1 : 0); fold(s.crashed ? 1 : 0);
            }
            return h >>> 0;
        },

        /** Full observable snapshot for one frame. */
        snapshot() {
            return { state: gameState(), nodes: captureNodes() };
        },

        state: gameState,
    };
}

module.exports = { createSim, loadGameInto, round, PRECISION, ENGINE_MODULES };

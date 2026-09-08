'use strict';
// Replay one scenario deterministically and return its trace.

const { createSim } = require('./harness');

/** Frames between recorded keyframes. Full-rate capture is far too large. */
const SAMPLE_EVERY = 5;

function runScenario(sc) {
    const sim = createSim({
        search: sc.search || '',
        seed: sc.seed,
        localStorage: sc.localStorage,
    });

    // Index the script by frame so replay is O(frames).
    const byFrame = new Map();
    for (const a of sc.script || []) {
        if (!byFrame.has(a.at)) byFrame.set(a.at, []);
        byFrame.get(a.at).push(a);
    }

    const frames = [];
    let error = null;
    let baseline = null;
    let digest = undefined;
    const prevSerialised = new Map();

    for (let f = 0; f < sc.frames; f++) {
        for (const a of byFrame.get(f) || []) {
            if (a.down) sim.keyDown(a.down);
            if (a.up)   sim.keyUp(a.up);
            if (a.pad !== undefined) sim.setGamepadConnected(a.pad);
            if (a.axis) sim.setAxis(a.axis[0], a.axis[1]);
            if (a.btn)  sim.setButton(a.btn[0], a.btn[1], a.btn[2]);
        }

        try {
            sim.tick(1);
            // game.js's frame-level try/catch absorbs exceptions into
            // console.error, so a throw never reaches sim.tick(). Check the
            // captured channel too, or an entire discipline can throw on every
            // frame while the gate reports PASS (it did — 900×4 times).
            const sw = sim.env.swallowedErrors;
            if (sw.length && !error) {
                error = { frame: f, message: 'swallowed: ' + sw[0].message };
                break;
            }
            if (sim.env.ctx._crashErr && !error) {
                error = { frame: f, message: 'crash renderer: ' + sim.env.ctx._crashErr };
                break;
            }
        } catch (e) {
            // Record and stop: a throw is itself a behavioural fact worth
            // locking down, and continuing would produce meaningless frames.
            error = { frame: f, message: String(e && e.message || e) };
            break;
        }

        // Folded EVERY frame, recorded only at keyframes — closes the gap
        // between samples.
        digest = sim.frameDigest(digest);

        if (f % SAMPLE_EVERY === 0) {
            const snap = sim.snapshot();
            // Delta encoding: the scene holds ~430 nodes but only the athlete and
            // a handful of props ever move. Recording all of them every keyframe
            // produced 5 MB per scenario of duplicated static scenery. Store the
            // first frame in full, then only nodes whose serialisation changed.
            // Fidelity is unaffected — the full state is reconstructible.
            let nodes;
            if (!baseline) {
                baseline = snap.nodes;
                nodes = snap.nodes;
            } else {
                nodes = {};
                for (const [name, rec] of Object.entries(snap.nodes)) {
                    const key = JSON.stringify(rec);
                    if (prevSerialised.get(name) !== key) nodes[name] = rec;
                }
            }
            for (const [name, rec] of Object.entries(snap.nodes)) {
                prevSerialised.set(name, JSON.stringify(rec));
            }
            frames.push({ f, d: digest, state: snap.state, nodes });
        }
    }

    return {
        name: sc.name,
        description: sc.description,
        search: sc.search || '',
        seed: sc.seed !== undefined ? sc.seed : 1,
        localStorage: sc.localStorage || null,
        totalFrames: sc.frames,
        sampleEvery: SAMPLE_EVERY,
        encoding: 'delta-nodes',
        error,
        frames,
    };
}

module.exports = { runScenario, SAMPLE_EVERY };

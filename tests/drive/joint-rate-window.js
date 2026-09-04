'use strict';
// SLOT 298 — 5-frame moving-average joint-rate instrument (ruling on 297).
//
// Finding: the in-window peak is a SINGLE-FRAME maximum that wanders ±3 rad/s
// between identical runs (3.29 / 8.42 / 5.52 in 297 vs 4.20 / 5.70 / 6.03 in
// 296) — the instrument reads particle-solver spikes. A one-frame 8 rad/s
// step is ~8° of rotation in 16 ms: nothing the eye can see, and not what the
// 220°/s gate was written for (a sustained limb rate over the 1 s fold
// window). Written instrument scoping (law 1, physical reason in the ruling):
// for the lie-v4 keep-falling phase the joint-rate gate is evaluated on a
// 5-frame (≈ 83 ms) moving average of each hinge's angular rate, threshold
// UNCHANGED at 220°/s (3.84 rad/s); the raw single-frame peak is logged next
// to it.
//
// Dual-use module: required by node (unit test, crash-ragdoll.spec) AND
// installed in-page via page.addInitScript({ path }) for the forensics
// sampler, which cannot require(). One source, no duplicated math — the
// negative controls live in tests/unit/joint-rate-window.test.js.
//
// Averaged-rate definition: for hinge k at sample i (0-based, i >= 4), the
// trailing-5 rate is |ang[i] - ang[i-4]| / (t[i] - t[i-4]) — the dt-weighted
// mean of the 4 single-frame rates in the window (identical to the unweighted
// mean at uniform dt, robust to rAF jitter). A one-frame spike of magnitude S
// therefore reads ≈ S/4 averaged: spikes stay visible in the raw peak but
// cannot trip the averaged gate, while a sustained rate reads identically on
// both instruments.

(function (root) {
    var WINDOW_N = 5;

    function createJointRateWindow() {
        return {
            n: 0,
            buf: [],   // trailing WINDOW_N { t, ang } samples (shallow-copied)
            prev: null, // last sample, for the raw single-frame rate
            rawEarly: 0, rawEarlyJ: '',
            rawLate: 0, rawLateJ: '',
            avgEarly: 0, avgEarlyJ: '',
            avgLate: 0, avgLateJ: '',
            // t: seconds on the caller's clock (sim clock in forensics, wall
            // clock in crash-ragdoll — each instrument is self-consistent);
            // ang: { hingeName: radians }; early: in-window flag for THIS
            // sample (R.t - rollAt <= 1.0 in the lie-v4 keep-falling phase).
            push: function (t, ang, early) {
                var k, w;
                if (this.prev) {
                    var dt = t - this.prev.t;
                    if (dt > 1e-9) {
                        for (k in ang) {
                            if (!(k in this.prev.ang)) continue;
                            w = Math.abs(ang[k] - this.prev.ang[k]) / dt;
                            if (early) {
                                if (w > this.rawEarly) { this.rawEarly = w; this.rawEarlyJ = k; }
                            } else if (w > this.rawLate) { this.rawLate = w; this.rawLateJ = k; }
                        }
                    }
                }
                var copy = {};
                for (k in ang) copy[k] = ang[k];
                this.buf.push({ t: t, ang: copy });
                if (this.buf.length > WINDOW_N) this.buf.shift();
                if (this.buf.length === WINDOW_N) {
                    var span = this.buf[WINDOW_N - 1].t - this.buf[0].t;
                    if (span > 1e-9) {
                        var first = this.buf[0].ang, last = this.buf[WINDOW_N - 1].ang;
                        for (k in last) {
                            if (!(k in first)) continue;
                            w = Math.abs(last[k] - first[k]) / span;
                            if (early) {
                                if (w > this.avgEarly) { this.avgEarly = w; this.avgEarlyJ = k; }
                            } else if (w > this.avgLate) { this.avgLate = w; this.avgLateJ = k; }
                        }
                    }
                }
                this.prev = { t: t, ang: copy };
                this.n++;
            },
            summary: function () {
                return {
                    rawEarly: this.rawEarly, rawEarlyJ: this.rawEarlyJ,
                    rawLate: this.rawLate, rawLateJ: this.rawLateJ,
                    avgEarly: this.avgEarly, avgEarlyJ: this.avgEarlyJ,
                    avgLate: this.avgLate, avgLateJ: this.avgLateJ,
                    n: this.n,
                };
            },
        };
    }

    var api = { WINDOW_N: WINDOW_N, createJointRateWindow: createJointRateWindow };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root._JointRateWindow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

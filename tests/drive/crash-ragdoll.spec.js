'use strict';
// ── P11 acceptance: coherent crash ragdoll ───────────────────────────────────
// The crash is display (ADR-0002): the skinned athleteBody stays visible and
// the driver bones are driven by a position-based ragdoll. Gates:
//   - no legacy solid is ever shown (drivers stay hidden, skierRoot enabled,
//     athleteBody visible) through the whole crash;
//   - joint gaps (upperArm→lowerArm, upperLeg→lowerLeg, torso→head, measured
//     from the rendered node frames) stay ≤ 2 cm every sampled frame;
//   - every body driver's lowest point respects the surface (no penetration
//     below the physics surface minus a 6 cm corner tolerance; the ragdoll's
//     contact model projects particles onto terrainRootY(z) - FOOT_OFFSET);
//   - hard crash state machine (author URGENT 21:45): tumble ≤ 1.0 s →
//     pose frozen → rigid slide with strong friction → stopped; joint
//     angular speed ≈ 0 from the freeze onward, body speed < 0.1 m/s by
//     t_crash + 2.5 s and EXACTLY 0 for ≥ 3 s of samples afterwards;
//   - the released skis come to rest ON the snow (driver bottom plane on the
//     physics surface, never below it).
// STATUS (iter 38): ALL GATES ENFORCED (test, not fixme). Two fixes:
// STATUS (iter 47): the iter-43 threshold rest detector is REPLACED by the
// hard state machine (game.js _crashRagdollStep) — the detector held on the
// headless harness but not in a real browser (PBD keeps injecting
// displacement into propped, non-contacting parts, so the body sat in a
// limit cycle at/above the 0.12 m/s gate and never yielded 8 quiet frames).
// 1. The ragdoll re-solves the head AXIS: in supine head-down configurations
//    the neck→headTop snap projected headTop INTO the surface (pen up to
//    0.18 m); the snap now rotates the head direction in the vertical plane
//    containing it until headTop clears its contact height (exact rest length
//    preserved, no y-clamp / no verlet injection). The joint-gap gate passes
//    since iter 37 (elbow 0.000 / knee 0.000 / neck 0.010 from the first
//    crash frame).
// 2. The penetration INSTRUMENT is corrected: it applied the bottom
//    endpoint's surface height to both endpoints of a segment, so a body
//    lying ALONG the steep landing slope read phantom penetration
//    (~segment length x sin(35 deg): 0.31 m torso, 0.14 m head) even though
//    every particle sits at its OWN surface + contact radius. The gate now
//    compares each endpoint against the surface under it (max of the two) —
//    exactly the plan's "lowest point respects the contact rules" semantics.
// Segment-frame convention (matters for the gap instrument): torso/head/leg
// drivers have local +Y pointing PROXIMAL (torso top / head top / hip end),
// but ARM drivers have local +Y pointing DISTAL — the +Y end of an arm
// segment is the elbow/wrist end (applyPose builds the arm chain along the
// rotated +Y from the shoulder pivot). Verified by probe (iter 37): with the
// proximal assumption the ready-state elbow gap reads the full 0.55 m
// shoulder→wrist span while knees/neck read ~0; with the distal signs every
// gap reads ~0 pre-crash. The ragdoll's seeding/write-back uses the same
// conventions (see game.js _crashRagdollInit).
const { test, expect } = require('@playwright/test');

const SEG_H = {
    torso: 0.55, head: 0.24,
    upperArmL: 0.30, upperArmR: 0.30, lowerArmL: 0.25, lowerArmR: 0.25,
    upperLegL: 0.36, upperLegR: 0.36, lowerLegL: 0.36, lowerLegR: 0.36,
};

test('crash: ragdoll keeps the body coherent on the snow, no legacy solids, settles with skis at rest', async ({ page }) => {
    // 240 s: the state predicates below are the real gates; this is only the
    // wall-clock budget for reaching them under in-suite SwiftShader load
    // (iter 45: a solo-green spec died at 90 s with load ~9 — the run itself
    // was still mid-flight; entry 40 saw the same class at 30 s).
    test.setTimeout(240_000);
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function');
    await page.waitForFunction(() => window._surfacesApplied !== undefined);
    // Input-vs-body-link race (pinned by iter 20): press only after the glb links.
    await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(800);

    // ── Deterministic crash trigger (state-driven, not wall-clock) ──────────
    // The old script pressed keys on wall-clock timers; under SwiftShader the
    // render loop runs at a few fps with clamped dt, so physics time lags wall
    // time and the charge/tuck schedule landed differently every run (iter 40:
    // one run never crashed in 30 s). The golden aerial-crash-ragdoll
    // scenario's schedule is STATE-determined — hold ↓ until the flip-power
    // bar is full, then hold tuck from takeoff — so the pump below dispatches
    // each key exactly when the state crosses that boundary, making the
    // trigger fps-independent (the page's key handler binds on event.code).
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window._getGameState().readyState === false,
        null, { timeout: 90_000 });
    await page.evaluate(() => {
        window._pump = { down: false, tuck: false, stop: false };
        const send = (type, code) => window.dispatchEvent(
            new KeyboardEvent(type, { code, bubbles: true }));
        const tick = () => {
            if (window._pump.stop) return;
            const g = window._getGameState();
            if (g.crashed) {
                if (window._pump.down) send('keyup', 'ArrowDown');
                if (window._pump.tuck) send('keyup', 'Space');
                window._pump.stop = true;
                return;
            }
            // Charge: hold ↓ while grounded until the bar is full.
            if (g.grounded && !window._pump.down && g.flipPower < 0.999) {
                window._pump.down = true; send('keydown', 'ArrowDown');
            } else if (window._pump.down && (g.flipPower >= 0.999 || !g.grounded)) {
                window._pump.down = false; send('keyup', 'ArrowDown');
            }
            // Tuck: hold Space from the first airborne frame (the golden
            // script's frame-300 Space, expressed as a state boundary).
            if (!g.grounded && !window._pump.tuck) {
                window._pump.tuck = true; send('keydown', 'Space');
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    // rAF sampler from just before the crash until settled (or 10 s).
    await page.evaluate((SEG_H) => {
        window._cr = { trace: [], stop: false, t0: performance.now(), crashedAt: null };
        const tick = () => {
            if (window._cr.stop) return;
            try {
            const g = window._getGameState();
            const now = performance.now() - window._cr.t0;
            if (g.crashed && window._cr.crashedAt === null) window._cr.crashedAt = now;
            if (window._cr.crashedAt !== null && !window._cr.stop) {
                const scene = BABYLON.EngineStore.LastCreatedScene;
                const mesh = (n) => scene.getMeshByName(n);
                const end = (n, sign) => {
                    const m = mesh(n);
                    if (!m || !m.getAbsolutePosition) return null;
                    const p = m.getAbsolutePosition();
                    let d = null;
                    try { d = m.getDirection(BABYLON.Axis.Y); } catch (e) { return null; }
                    const hh = (SEG_H[n] || 0) / 2;
                    return [p.x + d.x * hh * sign, p.y + d.y * hh * sign, p.z + d.z * hh * sign];
                };
                const dist = (a, b) => a && b
                    ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null;
                const rec = { t: now, crashed: g.crashed, gaps: {}, pens: {}, legacy: 0, bodyVisible: 0, rootOn: null, skis: {},
                              probe: window._ragdollProbe ? window._ragdollProbe() : null };
                // Arms: +Y is the DISTAL end (elbow/wrist) — see the header.
                rec.gaps.elbowL = dist(end('upperArmL', 1), end('lowerArmL', -1));
                rec.gaps.elbowR = dist(end('upperArmR', 1), end('lowerArmR', -1));
                rec.gaps.kneeL = dist(end('upperLegL', -1), end('lowerLegL', 1));
                rec.gaps.kneeR = dist(end('upperLegR', -1), end('lowerLegR', 1));
                rec.gaps.neck = dist(end('torso', 1), end('head', -1));
                for (const n of Object.keys(SEG_H)) {
                    const b = end(n, -1), t = end(n, 1);
                    if (!b || !t) continue;
                    const r = n === 'torso' ? 0.15 : n === 'head' ? 0.11 : 0.08;
                    // Surface height under EACH endpoint, pen = max of the two.
                    // The iter-37 instrument applied the bottom endpoint's
                    // surface height to BOTH endpoints, which reads phantom
                    // penetration whenever the body lies ALONG the steep
                    // landing slope: the downslope endpoint is legitimately
                    // lower in world y (it follows the surface, ~segment
                    // length x sin(35 deg)), not below it. The plan's gate is
                    // "lowest point vs the terrain height UNDER IT".
                    rec.pens[n] = Math.max(
                        window._crashFloorY(b[2]) - (b[1] - r),
                        window._crashFloorY(t[2]) - (t[1] - r));
                }
                for (const n of ['torso', 'head', 'upperArmL', 'lowerLegR']) {
                    const m = mesh(n);
                    if (m && m.isVisible === true) rec.legacy++;
                }
                for (const m of scene.meshes) {
                    if (m.name && m.name.startsWith('athleteBody') && m.isVisible) rec.bodyVisible++;
                }
                const root = mesh('skierRoot');
                rec.rootOn = root ? root.isEnabled() : null;
                for (const sk of ['skiL', 'skiR']) {
                    const m = mesh(sk);
                    if (!m) continue;
                    const p = m.getAbsolutePosition();
                    const surf = window._crashFloorY(p.z);
                    rec.skis[sk] = { bottom: p.y - 0.015, surf };
                }
                const tp = mesh('torso') && mesh('torso').getAbsolutePosition();
                if (tp) {
                    const last = window._cr.trace[window._cr.trace.length - 1];
                    rec.torso = [tp.x, tp.y, tp.z];
                    rec.tSpeed = last && last.torso
                        ? Math.hypot(tp.x - last.torso[0], tp.y - last.torso[1], tp.z - last.torso[2])
                        / Math.max(1e-3, (now - last.t) / 1000) : null;
                }
                window._cr.trace.push(rec);
                if (now - window._cr.crashedAt > 10_000) window._cr.stop = true;
            }
            } catch (e) {
                window._cr.err = String((e && e.stack) || e);
                window._cr.stop = true;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, SEG_H);

    // Wait for the crash, then for the settle window to be recorded.
    // 90 s leashes: in-suite SwiftShader + a busy box can stretch the whole
    // run (ready turn → full charge → takeoff → crash) past 30 s of wall
    // clock while the sim is still mid-flight (iter 40 and iter 45 both saw
    // the 30 s crashedAt wait fire solo-green specs). The predicates are
    // state boundaries; the leash only bounds how long we are willing to
    // wait for them. The sampler still stops itself at crashedAt + 10 s.
    await page.waitForFunction(() => window._cr && window._cr.crashedAt !== null,
        null, { timeout: 90_000 });
    await page.waitForFunction(() => window._cr && window._cr.stop,
        null, { timeout: 90_000 });
    await page.keyboard.up('Space');

    const trace = await page.evaluate(() => window._cr);
    expect(trace.err || null, 'sampler error: ' + (trace.err || '')).toBeNull();
    expect(trace.trace.length).toBeGreaterThan(6);

    // ── Gates over the whole recorded crash ─────────────────────────────
    const traceR = trace.trace;
    const tCrash = traceR[0].t;
    const settledBy = traceR.filter(r => r.t - tCrash <= 5000);
    let worstGap = 0, worstPen = -9, legacyFrames = 0, rootOffFrames = 0, bodyGone = 0;
    for (const r of settledBy) {
        for (const k of Object.keys(r.gaps)) {
            if (r.gaps[k] !== null) worstGap = Math.max(worstGap, r.gaps[k]);
        }
        for (const k of Object.keys(r.pens)) worstPen = Math.max(worstPen, r.pens[k]);
        if (r.legacy > 0) legacyFrames++;
        if (r.rootOn === false) rootOffFrames++;
        if (r.bodyVisible === 0) bodyGone++;
    }
    // ── URGENT author item (21:45): hard crash state machine ───────────────
    // Gates read the ragdoll probe (the rendered root keeps sliding
    // engine-side under the frozen pose; its ~0.045 m/s projection lag is
    // below every threshold here):
    //   1. the machine reaches 'stopped' (probe.resting);
    //   2. joint angular speed ≤ 1e-4 rad/s from the freeze onward (measured
    //      value is float noise ~1e-12; the pose is rigid by construction);
    //   3. body speed < 0.1 m/s by t_crash + 2.5 s and EXACTLY 0 thereafter
    //      for ≥ 3 s of samples (probe.maxSpeed is a literal 0.0 once
    //      stopped — sub-0.1 slide speeds never move: the frame that would
    //      is the stop frame);
    //   4. the rendered torso agrees (motion end ≤ 2.8 s: the 2.5 s contract
    //      plus the SwiftShader wall-clock stretch of entries 40/43/45).
    const frozen = traceR.filter(r => r.probe && r.probe.resting);
    expect(frozen.length, 'crash state machine reached stopped (pose frozen)').toBeGreaterThan(0);
    console.log('CRASHREST restAt=' + frozen[0].probe.restAt.toFixed(2) +
        's (stopped) phase=' + frozen[0].probe.phase);
    // (2) Joint angular speed from the first slide-phase sample onward.
    const firstSlide = traceR.findIndex(r => r.probe && r.probe.phase === 'slide');
    expect(firstSlide, 'state machine entered the slide phase (freeze fired)').toBeGreaterThanOrEqual(0);
    let worstAngSpd = 0, worstAngJoint = '';
    for (let i = firstSlide + 1; i < traceR.length; i++) {
        const a = traceR[i - 1].probe, b = traceR[i].probe;
        if (!a || !b || !a.ang || !b.ang) continue;
        const dts = Math.max(1e-3, (traceR[i].t - traceR[i - 1].t) / 1000);
        for (const k of Object.keys(b.ang)) {
            const w = Math.abs(b.ang[k] - a.ang[k]) / dts;
            if (w > worstAngSpd) { worstAngSpd = w; worstAngJoint = k; }
        }
    }
    console.log('CRASHREST worstJointAngSpeed=' + worstAngSpd.toExponential(2) +
        ' rad/s (' + worstAngJoint + ') from the freeze');
    expect(worstAngSpd, `joint angular speed ${worstAngSpd.toExponential(2)} rad/s (${worstAngJoint}) ≤ 1e-4 from the freeze`)
        .toBeLessThanOrEqual(1e-4);
    // (3) Body speed on the probe: the >0.1 m/s crossings end by t_crash +
    // 2.5 s, and once the machine is 'stopped' the speed is EXACTLY 0
    // (nothing integrates any more) for ≥ 3 s of samples. Sub-0.1 nonzero
    // frames BEFORE the stop are the tumble/slide decay tail (the machine's
    // velocity only decreases); "exactly 0 thereafter" is the post-stop
    // contract — the machine reports its own velocity state from the freeze
    // onward, so no frame-time jitter straddles the threshold.
    let bodyMotionEnd = -1;
    for (const r of traceR) {
        if (r.probe && typeof r.probe.maxSpeed === 'number' && r.probe.maxSpeed > 0.1)
            bodyMotionEnd = (r.t - trace.crashedAt) / 1000;
    }
    expect(bodyMotionEnd, `body speed crossed below 0.1 m/s (ended ${bodyMotionEnd.toFixed(2)}s)`)
        .toBeGreaterThanOrEqual(0);
    expect(bodyMotionEnd, `body speed < 0.1 m/s by t_crash+2.5s (ended ${bodyMotionEnd.toFixed(2)}s)`)
        .toBeLessThanOrEqual(2.5);
    const firstStopped = traceR.findIndex(r => r.probe && r.probe.resting);
    const afterStop = traceR.slice(firstStopped).filter(r => r.probe);
    const notZero = afterStop.filter(r => r.probe.maxSpeed !== 0);
    expect(notZero.length, `post-stop samples all exactly 0 (${notZero.length} nonzero)`).toBe(0);
    const zeroSpanMs = afterStop.length ? afterStop[afterStop.length - 1].t - afterStop[0].t : 0;
    expect(zeroSpanMs, `≥ 3 s of exactly-0 samples after the stop (got ${zeroSpanMs} ms)`)
        .toBeGreaterThanOrEqual(3000);
    console.log('CRASHREST bodyMotionEnd=' + bodyMotionEnd.toFixed(2) + 's, exactly-0 span ' +
        (zeroSpanMs / 1000).toFixed(2) + 's');
    // (4) Rendered-torso instrument (includes the ~0.045 m/s root-slide
    // projection lag, below the 0.1 m/s threshold — same motion end).
    let motionEndS = -1;
    for (const r of traceR) {
        if (r.tSpeed !== null && r.tSpeed > 0.1) motionEndS = (r.t - trace.crashedAt) / 1000;
    }
    console.log('CRASHREST renderedTorsoMotionEnd=' + motionEndS.toFixed(2) + 's');
    expect(motionEndS, `rendered torso motion ended at t_crash+${motionEndS.toFixed(2)}s (gate ≤ 2.8 s)`)
        .toBeLessThanOrEqual(2.8);
    const firstRest = traceR.findIndex(r => r.probe && r.probe.resting);
    const afterFreeze = traceR.slice(firstRest).filter(r => r.tSpeed !== null);
    const maxTailSpeed = afterFreeze.length ? Math.max(...afterFreeze.map(r => r.tSpeed)) : 0;
    expect(maxTailSpeed, `settled: post-stop rendered speed ${maxTailSpeed.toFixed(3)} m/s < 0.06`)
        .toBeLessThan(0.06);
    // Skis at rest on the surface at the end.
    const lastRec = traceR[traceR.length - 1];
    const skiClear = ['skiL', 'skiR'].map(sk => lastRec.skis[sk]
        ? lastRec.skis[sk].bottom - lastRec.skis[sk].surf : null);

    expect(legacyFrames, 'no legacy driver solid ever visible').toBe(0);
    expect(rootOffFrames, 'skierRoot never disabled').toBe(0);
    expect(bodyGone, 'skinned body visible in every sampled frame').toBe(0);
    const gapDetail = settledBy.slice(0, 4).map(r => Object.entries(r.gaps)
        .map(([k, v]) => k + '=' + (v === null ? 'null' : v.toFixed(3))).join(' ')).join(' | ');
    const perJoint = {};
    for (const r of settledBy) for (const [k, v] of Object.entries(r.gaps))
        if (v !== null && v > (perJoint[k] || 0)) perJoint[k] = v;
    const worstJoints = JSON.stringify(Object.fromEntries(
        Object.entries(perJoint).map(([k, v]) => [k, +v.toFixed(4)])));
    expect(worstGap, `worst joint gap ${worstGap.toFixed(4)} m ≤ 0.02 per joint ${worstJoints}`).toBeLessThanOrEqual(0.02);
    expect(worstPen, `worst body penetration ${worstPen.toFixed(4)} m within corner tolerance`).toBeLessThanOrEqual(0.06);
    for (const c of skiClear) {
        expect(c, `ski rests on the snow (clearance ${c === null ? 'n/a' : c.toFixed(4)})`).not.toBeNull();
        expect(c).toBeGreaterThanOrEqual(-0.005);
        expect(c).toBeLessThanOrEqual(0.06);
    }
});

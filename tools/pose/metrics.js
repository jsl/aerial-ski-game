'use strict';
// Per-clip derived metrics from the tracked athlete (tools/pose/track.js output).
// Camera-plane 2D. Rotation: angle of the shoulder-midpoint -> hip-midpoint
// vector, unwrapped, rate in deg/s at the clip fps. Rotation intervals are
// maximal runs with |rate| >= minRate; a flips estimate is only reported when
// the interval plausibly contains whole flips. Everything that the pose data
// cannot support (RTMPose fits near-upright skeletons to inverted athletes at
// small scale) is reported as not derivable with the numeric evidence.
// No dependencies.

const DEG = 180 / Math.PI;

// Unwrap theta across the clip. Reset the offset after gaps > maxGap so no
// fake rotation accumulates across cuts / re-acquisitions.
function unwrap(theta, maxGap) {
  const uw = new Array(theta.length).fill(null);
  let prev = null, off = 0, sinceKnown = 0;
  for (let i = 0; i < theta.length; i++) {
    if (theta[i] == null) { sinceKnown++; continue; }
    if (prev != null && sinceKnown <= maxGap) {
      let d = theta[i] + off - prev;
      while (d > 180) { off -= 360; d -= 360; }
      while (d < -180) { off += 360; d += 360; }
    } else {
      off = 0;
    }
    uw[i] = theta[i] + off;
    prev = uw[i];
    sinceKnown = 0;
  }
  return uw;
}

function median3(arr, i) {
  const w = [arr[i - 1], arr[i], arr[i + 1]].filter((v) => v != null);
  if (!w.length) return null;
  w.sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)];
}

// track: parsed athlete_track.json ({frames:[{frame,ok,hip,shoulder,size,...}], fps}).
function rotationSeries(track) {
  const fr = track.frames;
  const theta = fr.map((e) => {
    if (!e || !e.ok || !e.shoulder || !e.hip) return null;
    // Image y grows downward: theta = 0 when the hip is straight below the
    // shoulder (upright), +90 deg when the body axis lies along +x.
    return Math.atan2(e.hip[0] - e.shoulder[0], e.hip[1] - e.shoulder[1]) * DEG;
  });
  const uw = unwrap(theta, 3);
  const fps = track.fps || 30;
  const raw = uw.map((a, i) => (a != null && uw[i - 1] != null ? (a - uw[i - 1]) * fps : null));
  const omega = raw.map((_, i) => median3(raw, i));
  return { theta, uw, omega, fps };
}

// Max |theta change| over any `win`-frame span with no gap inside it: the
// rotational amplitude the pose data actually captured in a half-second.
function maxThetaExcursion(uw, win) {
  let best = 0, bestF = null;
  for (let i = 0; i < uw.length; i++) {
    if (uw[i] == null) continue;
    for (let j = i + 1; j < Math.min(uw.length, i + win + 1); j++) {
      if (uw[j] == null) break;
      const d = Math.abs(uw[j] - uw[i]);
      if (d > best) { best = d; bestF = [i, j]; }
    }
  }
  return { max: best, span: bestF };
}

// Rotation intervals: runs where the smoothed |omega| >= minRate deg/s,
// merging runs separated by <= mergeGap frames, never across gaps > 3.
function rotationIntervals(uw, omega, fps, opts) {
  const minRate = (opts && opts.minRate) != null ? opts.minRate : 90;
  const mergeGap = (opts && opts.mergeGap) != null ? opts.mergeGap : 2;
  const flag = omega.map((w) => w != null && Math.abs(w) >= minRate);
  const runs = [];
  let i = 0;
  while (i < flag.length) {
    if (!flag[i]) { i++; continue; }
    let j = i;
    while (j + 1 < flag.length && flag[j + 1]) j++;
    runs.push([i, j]);
    i = j + 1;
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    let bridged = last && r[0] - last[1] - 1 <= mergeGap;
    if (bridged) {
      for (let k = last[1] + 1; k <= r[0] - 1; k++) if (uw[k] == null && k - last[1] > 3) { bridged = false; break; }
    }
    if (bridged) last[1] = r[1]; else merged.push([...r]);
  }
  return merged
    .filter(([a, b]) => b - a + 1 >= 3 && uw[a] != null && uw[b] != null)
    .map(([a, b]) => {
      const rates = [];
      for (let k = a; k <= b; k++) if (omega[k] != null) rates.push(Math.abs(omega[k]));
      const absTurn = Math.abs(uw[b] - uw[a]);
      const dur = (b - a + 1) / fps;
      const peak = rates.length ? Math.max(...rates) : 0;
      const mean = rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : 0;
      // A flips estimate only when the interval could contain whole flips:
      // >= 0.25 s, >= 180 deg of captured turn, and a physically sane peak.
      const plausible = dur >= 0.25 && absTurn >= 180 && peak <= 3000;
      return {
        f0: a, f1: b, t0: +(a / fps).toFixed(2), t1: +(b / fps).toFixed(2),
        dur: +dur.toFixed(2), absTurnDeg: +absTurn.toFixed(0),
        peakRateDegS: +peak.toFixed(0), meanRateDegS: +mean.toFixed(0),
        flipsEst: plausible ? +(Math.round(absTurn / 180) / 2).toFixed(1) : null,
      };
    });
}

// Hip displacement surges (used for the hop turn): frames where the smoothed
// hip speed exceeds `vMin` px/frame while neighbours do not.
function hipSurges(track, vMin) {
  const fr = track.frames;
  const out = [];
  for (let i = 1; i < fr.length; i++) {
    const e = fr[i], p = fr[i - 1];
    if (!e.ok || !p.ok) continue;
    const v = Math.hypot(e.hip[0] - p.hip[0], e.hip[1] - p.hip[1]);
    if (v >= vMin) out.push({ frame: e.frame, vx: +(e.hip[0] - p.hip[0]).toFixed(0), vy: +(e.hip[1] - p.hip[1]).toFixed(1), v: +v.toFixed(0) });
  }
  return out;
}

// Full per-clip analysis. Returns { rotation: {...series summary}, metrics }.
function analyze(track) {
  const { theta, uw, omega, fps } = rotationSeries(track);
  const exc = maxThetaExcursion(uw, 15);
  const intervals = rotationIntervals(uw, omega, fps);
  return {
    fps,
    thetaExcursion05sDeg: +exc.max.toFixed(0),
    thetaExcursionSpan: exc.span,
    rotationIntervals: intervals,
    series: { thetaDeg: theta.map((v) => (v == null ? null : +v.toFixed(1))), omegaDegS: omega.map((v) => (v == null ? null : +v.toFixed(0))) },
  };
}

module.exports = { analyze, rotationSeries, rotationIntervals, maxThetaExcursion, hipSurges, DEG };

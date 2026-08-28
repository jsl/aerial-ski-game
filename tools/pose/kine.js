'use strict';
// Kinematic series from the tracked athlete's full COCO-17 keypoints
// (iteration 3). The per-clip track stores only hip/shoulder midpoints, so the
// tracked person is re-joined to reference/pose/<clip>/keypoints.json by the
// `person` index to recover all 17 keypoints. Everything is either an interior
// joint angle (deg, image plane) or a distance normalised by the torso length
// (shoulder-mid to hip-mid px), so no px/m scale assumption enters these
// numbers. Camera-plane limits (sagittal flexion seen end-on projects to ~0)
// are the caller's verdicts, not hidden here. No dependencies.

const DEG = 180 / Math.PI;

function mid(a, b) {
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
}

// Interior angle at vertex b in degrees; null-safe, degenerate when any side
// is shorter than 2 px (sub-pixel pose noise at small scale).
function angle3(a, b, c) {
  if (!a || !b || !c) return null;
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  const du = Math.hypot(u[0], u[1]);
  const dv = Math.hypot(v[0], v[1]);
  if (du < 2 || dv < 2) return null;
  const cos = (u[0] * v[0] + u[1] * v[1]) / (du * dv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

// track: parsed athlete_track.json. kpData: parsed keypoints.json.
// Returns one entry per track frame; `ok: false` where the tracked person has
// no raw keypoints (interpolated frames keep only midpoints). Fields are null
// when the involved keypoints score < 0.5.
function fullSeries(track, kpData) {
  const fps = track.fps || kpData.fps || 30;
  return track.frames.map((tf, i) => {
    if (tf.person == null) return { f: tf.frame, ok: false };
    const p = kpData.frames[i] && kpData.frames[i].people[tf.person];
    if (!p || !p.kp_px || !p.score) return { f: tf.frame, ok: false };
    const kp = p.kp_px;
    const sc = p.score;
    const V = (n) => (sc[n] >= 0.5 ? kp[n] : null);
    const hip = mid(V(11), V(12));
    const sh = mid(V(5), V(6));
    const knee = mid(V(13), V(14));
    const ank = mid(V(15), V(16));
    const wr = mid(V(9), V(10));
    const torso = tf.size || null;
    const prev = i > 0 ? track.frames[i - 1] : null;
    return {
      f: tf.frame,
      ok: true,
      interpolated: !!tf.interpolated,
      torso,
      back: sh && hip ? Math.atan2(hip[0] - sh[0], hip[1] - sh[1]) * DEG : null,
      hipA: angle3(sh, hip, knee),
      kneeA: angle3(hip, knee, ank),
      wrRelSh: wr && sh && torso ? (sh[1] - wr[1]) / torso : null,
      wrRelKnee: wr && knee && torso ? (knee[1] - wr[1]) / torso : null,
      hipRelAnk: hip && ank && torso ? (ank[1] - hip[1]) / torso : null,
      hipVy: hip && prev && prev.ok && prev.hip ? hip[1] - prev.hip[1] : null,
    };
  });
}

function meanStd(values) {
  const v = values.filter((x) => x != null);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const std = Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / v.length);
  return { n: v.length, mean: +mean.toFixed(2), std: +std.toFixed(2), min: +Math.min(...v).toFixed(2), max: +Math.max(...v).toFixed(2) };
}

// Stats of one series field over an inclusive frame range.
function angStats(series, field, f0, f1) {
  const vals = [];
  for (const e of series) {
    if (e.f < f0 || e.f > f1) continue;
    vals.push(e[field]);
  }
  return meanStd(vals);
}

// Arm-sweep detection on the wrRelSh series (wrist height relative to the
// shoulders, in torso units; negative = below the shoulders). Sweep = a
// sustained rise of >= riseTot torso units over `riseWin` frames that keeps
// rising afterwards and starts from the quiet baseline. `window` limits the
// analysis to [f0, f1] (wrists are often unmeasurable elsewhere in the clip).
// Returns the reason when the wrists are not measurable enough in the window.
function armSweep(series, opts) {
  const o = Object.assign({ riseWin: 8, riseTot: 0.6, minPresent: 0.55, field: 'wrRelSh', fps: 30, window: null }, opts);
  let idx = series.map((e, i) => i);
  if (o.window) idx = idx.filter((i) => series[i].f >= o.window[0] && series[i].f <= o.window[1]);
  const s = idx.map((i) => series[i][o.field]);
  const present = s.filter((v) => v != null).length;
  if (present / s.length < o.minPresent) {
    return { measurable: false, reason: `wrists present in only ${Math.round((100 * present) / s.length)}% of frames in the window` };
  }
  const range = Math.max(...s.filter((v) => v != null)) - Math.min(...s.filter((v) => v != null));
  if (range < 1.0) {
    return { measurable: false, reason: `wrist-height range ${range.toFixed(2)} torso < 1.0` };
  }
  // Onset: first frame whose next riseWin frames rise by >= riseTot and keep
  // rising in the following riseWin/2 frames.
  let start = null;
  for (let i = 0; i + o.riseWin < s.length; i++) {
    const a = s[i], b = s[i + o.riseWin];
    if (a == null || b == null) continue;
    if (b - a < o.riseTot) continue;
    const c = s[Math.min(s.length - 1, i + o.riseWin + o.riseWin / 2)];
    if (c == null || c <= b + 0.05) continue;
    start = i;
    break;
  }
  if (start == null) return { measurable: false, reason: 'no sustained wrist rise found' };
  const quiet = meanStd(s.slice(Math.max(0, start - 12), start));
  // Crossing: first frame at/above shoulder level after onset.
  let cross = null;
  for (let i = start; i < s.length; i++) {
    if (s[i] != null && s[i] >= 0) { cross = i; break; }
  }
  // Last seen wrist and peak; end = plateau (rise over 4 frames < 0.1) if it
  // occurs before the wrists drop out.
  let last = null, peak = null;
  for (let i = start; i < s.length; i++) {
    if (s[i] == null) continue;
    last = i;
    if (peak == null || s[i] > s[peak]) peak = i;
  }
  let plateau = null;
  if (cross != null) {
    for (let i = cross; i + 4 < s.length; i++) {
      if (s[i] == null || s[i + 4] == null) continue;
      if (s[i + 4] - s[i] < 0.1) { plateau = i; break; }
    }
  }
  const fps = o.fps;
  const F = (i) => series[idx[i]].f;
  return {
    measurable: true,
    startF: F(start),
    crossF: cross != null ? F(cross) : null,
    endF: plateau != null ? F(plateau) : F(last),
    lastSeenF: F(last),
    peakF: F(peak),
    peakRelSh: +s[peak].toFixed(2),
    durSToLast: +((last - start) / fps).toFixed(2),
    quiet,
    startRelKnee: series[idx[start]].wrRelKnee != null ? +series[idx[start]].wrRelKnee.toFixed(2) : null,
  };
}

module.exports = { DEG, mid, angle3, fullSeries, meanStd, angStats, armSweep };

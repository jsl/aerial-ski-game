'use strict';
// Athlete tracking in RTMPose COCO-17 per-frame detections.
// Selection by continuity: nearest hip midpoint to the previous tracked hips,
// with a plausible per-frame size change. Keypoints with score < 0.5 are
// missing. Gaps of <= 3 frames are interpolated; a 3-tap median smooths the
// tracked midpoints. The seed is chosen by running the tracker from every
// usable person in the densest early frame and keeping the longest, most
// confident run. No dependencies.

const SCORE_MIN = 0.5;
const L_SHO = 5, R_SHO = 6, L_HIP = 11, R_HIP = 12;
const L_KNEE = 13, R_KNEE = 14, L_ELB = 7, R_ELB = 8;

function kps(p) {
  return p.kp_px || p.kp_video_px;
}

function validKp(p, i) {
  const k = kps(p);
  return p.score && p.score[i] >= SCORE_MIN && k && k[i];
}

function midpoint(p, a, b) {
  const va = validKp(p, a), vb = validKp(p, b);
  if (!va && !vb) return null;
  if (va && vb) return [(kps(p)[a][0] + kps(p)[b][0]) / 2, (kps(p)[a][1] + kps(p)[b][1]) / 2];
  return va ? [kps(p)[a][0], kps(p)[a][1]] : [kps(p)[b][0], kps(p)[b][1]];
}

function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let i = 0; i < 17; i++) {
    if (!validKp(p, i)) continue;
    n++;
    x0 = Math.min(x0, kps(p)[i][0]); x1 = Math.max(x1, kps(p)[i][0]);
    y0 = Math.min(y0, kps(p)[i][1]); y1 = Math.max(y1, kps(p)[i][1]);
  }
  if (!n) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// Person measurement. anchor = hips (preferred) or shoulders or bbox centre.
// size = torso length when hips+shoulders exist, else 0.5 x bbox height
// (rough fallback, flagged via sizeSource).
function measure(p) {
  const hip = midpoint(p, L_HIP, R_HIP);
  const sho = midpoint(p, L_SHO, R_SHO);
  const bb = bbox(p);
  if (!bb) return null;
  const meanScore = p.mean_score != null ? p.mean_score : p.score.reduce((a, s) => a + s, 0) / p.score.length;
  if (hip && sho) {
    return { hip, sho, size: Math.hypot(sho[0] - hip[0], sho[1] - hip[1]), sizeSource: 'torso', meanScore };
  }
  const knee = midpoint(p, L_KNEE, R_KNEE);
  const elb = midpoint(p, L_ELB, R_ELB);
  const anchor = hip || knee || elb || sho || [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
  return {
    hip: anchor,
    sho: sho || null,
    size: 0.5 * Math.max(bb.h, 1),
    sizeSource: 'bbox',
    meanScore,
  };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function median3(vals, i) {
  const w = [vals[i - 1], vals[i], vals[i + 1]].filter((v) => v != null);
  if (!w.length) return null;
  w.sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)];
}

// One tracking pass. Returns per-frame raw entries (null when nothing matched).
function runPass(frames, diag, seedFrame, seedIdx) {
  const raw = new Array(frames.length).fill(null);
  let prev = null;
  let lastKnown = seedFrame;
  for (let f = seedFrame; f < frames.length; f++) {
    const people = frames[f].people || [];
    // After a few lost frames the athlete may re-enter far away and much
    // smaller/larger (e.g. appearing airborne), so widen the gates.
    const rescue = f - lastKnown > 5;
    let best = null, bestCost = Infinity;
    for (let i = 0; i < people.length; i++) {
      const m = measure(people[i]);
      if (!m) continue;
      if (!prev) {
        if (f !== seedFrame || i !== seedIdx) continue;
        best = { i, m };
        break;
      }
      const d = dist(m.hip, prev.hip);
      const gate = Math.max(rescue ? 6 * prev.size : 3.5 * prev.size, 0.12 * diag);
      const ratio = m.size / prev.size;
      const lo = rescue ? 0.2 : 0.4, hi = rescue ? 5 : 2.5;
      if (ratio < lo || ratio > hi) continue;
      const cost = d / prev.size + 0.5 * Math.abs(Math.log(ratio)) - 0.05 * m.meanScore;
      if (cost < bestCost) { bestCost = cost; best = { i, m }; }
    }
    if (best) {
      raw[f] = { person: best.i, hip: best.m.hip, sho: best.m.sho, size: best.m.size, sizeSource: best.m.sizeSource, meanScore: best.m.meanScore };
      prev = best.m;
      lastKnown = f;
    }
  }
  return raw;
}

// data: parsed keypoints.json. Returns { frames: [...per-frame entries], summary }.
function trackAthlete(data) {
  const frames = data.frames;
  const diag = Math.hypot(720, 1280);

  // Seed candidates: every usable person in every 12th frame (the athlete may
  // enter the frame mid-clip). Cap the number of passes.
  const seeds = [];
  const stride = Math.max(4, Math.ceil(frames.length / 15));
  for (let f = 0; f < frames.length; f += stride) {
    const people = frames[f].people || [];
    for (let i = 0; i < people.length; i++) {
      if (measure(people[i]) != null) seeds.push([f, i]);
    }
  }
  if (!seeds.length) seeds.push([0, 0]);

  // Try every seed, keep the best run. The athlete is the tracked person that
  // travels farthest in the frame while staying tracked (bystanders stay put),
  // with coverage and detection confidence as tie-breakers.
  let raw = null, bestScore = -Infinity;
  for (const [f0, idx] of seeds) {
    const r = runPass(frames, diag, f0, idx);
    const known = r.filter((e) => e != null);
    if (!known.length) continue;
    let travel = 0;
    for (let f = 1; f < r.length; f++) {
      if (r[f] && r[f - 1]) travel += dist(r[f].hip, r[f - 1].hip);
    }
    const coverage = known.length / frames.length;
    const conf = known.reduce((a, e) => a + (e.meanScore || 0), 0) / known.length;
    const score = travel + 250 * coverage + 50 * conf;
    if (score > bestScore) { bestScore = score; raw = r; }
  }

  // Interpolate gaps <= 3 frames.
  const filled = raw.slice();
  let i = 0;
  while (i < filled.length) {
    if (filled[i] != null) { i++; continue; }
    let j = i;
    while (j < filled.length && filled[j] == null) j++;
    const before = i > 0 ? raw[i - 1] : null;
    const after = j < filled.length ? raw[j] : null;
    if (before && after && j - i <= 3) {
      for (let k = i; k < j; k++) {
        const a = (k - i + 1) / (j - i + 1);
        filled[k] = {
          person: null,
          hip: [0, 1].map((c) => before.hip[c] + a * (after.hip[c] - before.hip[c])),
          sho: before.sho && after.sho ? [0, 1].map((c) => before.sho[c] + a * (after.sho[c] - before.sho[c])) : null,
          size: before.size + a * (after.size - before.size),
          sizeSource: before.sizeSource,
          meanScore: null,
        };
      }
    }
    i = j;
  }

  // 3-tap median smoothing over known entries.
  const hipX = filled.map((e) => (e ? e.hip[0] : null));
  const hipY = filled.map((e) => (e ? e.hip[1] : null));
  const shoX = filled.map((e) => (e && e.sho ? e.sho[0] : null));
  const shoY = filled.map((e) => (e && e.sho ? e.sho[1] : null));
  const sizes = filled.map((e) => (e ? e.size : null));
  const smooth = filled.map((e, f) => {
    if (!e) return null;
    return {
      hip: [median3(hipX, f), median3(hipY, f)],
      sho: shoX[f] != null && shoY[f] != null ? [median3(shoX, f), median3(shoY, f)] : null,
      size: median3(sizes, f),
    };
  });

  const entries = frames.map((fr, f) => {
    const e = filled[f];
    const s = smooth[f];
    return {
      frame: fr.frame,
      t: fr.t,
      ok: e != null,
      interpolated: e != null && e.person == null,
      person: e ? e.person : null,
      hip: s ? s.hip.map((v) => +v.toFixed(1)) : null,
      shoulder: s && s.sho ? s.sho.map((v) => +v.toFixed(1)) : null,
      size: s ? +s.size.toFixed(2) : null,
      sizeSource: e ? e.sizeSource : null,
      meanScore: e && e.meanScore != null ? +e.meanScore.toFixed(3) : null,
    };
  });

  const knownIdx = entries.filter((e) => e.ok);
  const sizesKnown = knownIdx.map((e) => e.size);
  const gaps = [];
  let run = 0;
  for (const e of entries) {
    if (!e.ok) run++;
    else { if (run) gaps.push(run); run = 0; }
  }
  if (run) gaps.push(run);
  const sorted = sizesKnown.slice().sort((a, b) => a - b);
  const summary = {
    frames: frames.length,
    known: knownIdx.length,
    interpolated: entries.filter((e) => e.interpolated).length,
    coverage: +(knownIdx.length / frames.length * 100).toFixed(1),
    gapsOver3: gaps.filter((g) => g > 3).length,
    maxGap: gaps.length ? Math.max(...gaps) : 0,
    sizeMedianPx: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    sizeP05Px: sorted.length ? +sorted[Math.floor(sorted.length * 0.05)].toFixed(1) : null,
    sizeP95Px: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(1) : null,
  };
  return { frames: entries, summary };
}

module.exports = { trackAthlete, SCORE_MIN };

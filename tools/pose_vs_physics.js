'use strict';
// Lane D — pose-vs-physics study. Iteration 1: athlete tracking per clip.
//
// Reads reference/pose/<clip>/keypoints.json (RTMPose COCO-17, 30 fps, all
// detected people), tracks the athlete by continuity, writes
// reference/pose/<clip>/athlete_track.json (local, gitignored), renders a
// per-clip track overlay sheet via the venv python helper (optional), and
// regenerates docs/POSE-VS-PHYSICS.md.
//
// Usage: node tools/pose_vs_physics.js [--no-overlay]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { trackAthlete } = require('./pose/track');
const { analyze, hipSurges } = require('./pose/metrics');

const ROOT = path.resolve(__dirname, '..');
const POSE_DIR = path.join(ROOT, 'reference', 'pose');
const DOC = path.join(ROOT, 'docs', 'POSE-VS-PHYSICS.md');

const CLIP_ORDER = ['IMG_3396', 'IMG_3520', 'IMG_3523', 'IMG_3523_hop', 'IMG_3765', 'IMG_3768', 'IMG_7841'];
const CLIP_ROLE = {
  IMG_3396: 'night training session (author request P9 reference)',
  IMG_3520: 'full jump, wide view',
  IMG_3523: 'full jump with run-up, wide view',
  IMG_3523_hop: 'cropped track of the hop turn (4x upscaled)',
  IMG_3765: 'in-run and takeoff, close',
  IMG_3768: 'in-run, takeoff and flight, close (arm sweep)',
  IMG_7841: 'landing, absorption and spray',
};

// Rotation-capture verdicts per clip, from the review sheets + trajectories
// (checked by the analyst, iteration 2). Kept here so the doc regenerates.
const CLIP_ROT_VERDICT = {
  IMG_3396: {
    flight: 'flight ~f80–120 (sheet: athlete a white blur, no skeleton drawn)',
    verdict: 'not derivable — athlete untracked during flight; night scores mean 0.40. Flip count needs a cropped, upscaled re-extraction of ~f75–125.',
  },
  IMG_3520: {
    flight: 'two sheet-verified flight windows with inversions (~f92–105 above the knoll, ~f118–150 above the trees)',
    verdict: 'not derivable — pose fits a near-upright skeleton to the inverted athlete (torso 12–55 px): max θ excursion 0.5 s is 123° and that jump at f120–122 sits inside the re-acquisition after the 12-frame gap (hip jumps 437 px between f120 and f123 — a track re-lock, not rotation). Needs cropped re-extraction of ~f90–155.',
  },
  IMG_3523: {
    flight: 'sheet-verified layout rotation above the knoll, flight ≈f155–207',
    verdict: 'not derivable — same upright-fit failure; the only θ excursions (126°/0.5 s incl. f253–274: 81° over 0.73 s at ~153°/s) sit in the ride-out and around person switches at f207–208/f248–249 (hip jumps −168/−169 px). Needs cropped re-extraction of ~f150–210.',
  },
  IMG_3523_hop: {
    flight: 'one hop turn, destabilisation window f58–75 ± 2 (0.57 ± 0.07 s)',
    verdict: 'hop window bounded, timings inside it not derivable from this track — hip "surges" at f60/67/72/74 alternate ±60–70 px (±15 px at original scale ≈ one torso width): left/right hip keypoint swaps during the turn, not travel; torso stays within −6…+18° (yaw turn, pitch-plane θ barely moves). Needs the raw video re-extracted at higher fps for takeoff/landing/air time.',
  },
  IMG_3765: {
    flight: 'vertical layout ascent, no rotation in clip (footage notes)',
    verdict: 'no rotation expected or found (max excursion 51°/0.5 s = pose noise). Takeoff/airtime metrics next iteration.',
  },
  IMG_3768: {
    flight: 'in-run, arm sweep into the lip, early flight; no full rotation in clip',
    verdict: 'no flip expected or found (max excursion 88°/0.5 s, f19–21, during the far in-run stretch where the track is coarse). Crouch depth and arm-sweep timing next iteration.',
  },
  IMG_7841: {
    flight: 'late flight + touchdown (track verified on the athlete from just before touchdown)',
    verdict: 'partial rotation captured: f67–81 (t 2.23–2.70 s), 42° in 0.50 s, mean 165°/s, peak 310°/s — the athlete opening from ~80° to ~25° body attitude in the last half-second before touchdown. Not a flip count; touchdown absorption next iteration.',
  },
};

function venvPython() {
  return process.env.RTMPOSE_PYTHON || path.join(process.env.HOME || '', 'aerial-agents', 'rtmpose-venv', 'bin', 'python');
}

function main() {
  const noOverlay = process.argv.includes('--no-overlay');
  const clips = fs.readdirSync(POSE_DIR).filter((d) => fs.existsSync(path.join(POSE_DIR, d, 'keypoints.json')));
  clips.sort((a, b) => CLIP_ORDER.indexOf(a) - CLIP_ORDER.indexOf(b));

  const results = [];
  for (const clip of clips) {
    const data = JSON.parse(fs.readFileSync(path.join(POSE_DIR, clip, 'keypoints.json'), 'utf8'));
    const { frames, summary } = trackAthlete(data);
    const track = { clip, fps: data.fps, videoPx: data.frame_size || [720, 1280], frames };
    const metrics = analyze(track);
    const surges = clip === 'IMG_3523_hop' ? hipSurges(track, 30) : null;
    const outPath = path.join(POSE_DIR, clip, 'athlete_track.json');
    fs.writeFileSync(outPath, JSON.stringify({
      clip,
      method: 'nearest-hip continuity, plausible size change, score<0.5 missing, gaps<=3 interpolated, 3-tap median',
      fps: data.fps,
      videoPx: data.frame_size || [720, 1280],
      summary,
      frames,
    }, null, 1));
    fs.writeFileSync(path.join(POSE_DIR, clip, 'athlete_metrics.json'), JSON.stringify({
      clip,
      method: 'shoulder->hip angle unwrap, deg/s at clip fps, rotation intervals |rate|>=90 deg/s merged<=2, gaps>3 never bridged',
      fps: data.fps,
      ...metrics,
      ...(surges ? { hipSurgesPxPerFrame: surges } : {}),
    }, null, 1));
    results.push({ clip, summary, metrics, surges });
    console.log(`${clip}: coverage ${summary.coverage}% (${summary.known}/${summary.frames} frames), interpolated ${summary.interpolated}, gaps>3 ${summary.gapsOver3}, max gap ${summary.maxGap}, shoulder-hip median ${summary.sizeMedianPx}px, theta-exc-0.5s ${metrics.thetaExcursion05sDeg}deg, rot-intervals ${metrics.rotationIntervals.length}`);
  }

  if (!noOverlay) {
    const py = venvPython();
    if (fs.existsSync(py)) {
      try {
        execFileSync(py, [path.join(__dirname, 'pose', 'overlay_track.py'), ROOT], { stdio: 'inherit' });
      } catch (e) {
        console.warn(`overlay helper failed (${e.status}); continuing without sheets`);
      }
    } else {
      console.warn(`venv python not found at ${py}; skipping overlay sheets`);
    }
  }

  fs.writeFileSync(DOC, renderDoc(results));
  console.log(`wrote ${path.relative(ROOT, DOC)}`);
}

function renderDoc(results) {
  const L = [];
  L.push('# Pose vs physics — reference-footage analysis (lane D)');
  L.push('');
  L.push('Generated by `node tools/pose_vs_physics.js` from `reference/pose/<clip>/keypoints.json`');
  L.push('(RTMPose COCO-17 at 30 fps, all detected people per frame). Per-frame chosen track in');
  L.push('`reference/pose/<clip>/athlete_track.json` (local, gitignored); review sheets in');
  L.push('`reference/pose/<clip>/overlay_sheet_track.jpg`. Do not edit the tables by hand.');
  L.push('');
  L.push('## Method — athlete track (iteration 1)');
  L.push('');
  L.push('Per clip, all detected people are tracked by continuity (`tools/pose/track.js`):');
  L.push('');
  L.push('- a keypoint with score < 0.5 is missing. A person is measured from its valid');
  L.push('  keypoints: hip and shoulder midpoints give a torso size (shoulder-to-hip distance');
  L.push('  in video px); when hips or shoulders are missing the anchor falls back to knees,');
  L.push('  elbows or the valid-keypoint bounding-box centre and the size to 0.5 x bbox height');
  L.push('  (flagged `sizeSource: "bbox"` in the track file, coarser but keeps the track alive');
  L.push('  through low-score stretches);');
  L.push('- the tracked person is the usable person whose hip midpoint is nearest to the previous');
  L.push('  tracked hips, gated to a plausible step (distance <= max(3.5 torso, 12% of frame');
  L.push('  diagonal)) and a plausible size change per frame (ratio in [0.4, 2.5]); cost =');
  L.push('  distance/torso + 0.5·|log size ratio|; after 5 consecutive lost frames the gates');
  L.push('  widen (ratio [0.2, 5]) so an athlete re-entering far away and small (e.g. airborne)');
  L.push('  can be re-acquired;');
  L.push('- the seed is not assumed to be in frame 0: the tracker is re-run from every usable');
  L.push('  person in every ~15th frame and the run with the best score wins, where score =');
  L.push('  total hip travel in px (the athlete crosses the frame; bystanders stay put)');
  L.push('  + 250·coverage + 50·mean confidence;');
  L.push('- gaps of <= 3 frames are linearly interpolated and flagged `interpolated`; longer gaps');
  L.push('  stay missing and tracking resumes against the last known state;');
  L.push('- hip/shoulder midpoints and torso size are smoothed with a 3-tap median.');
  L.push('');
  L.push('## Scale assumption and uncertainty');
  L.push('');
  L.push('All numbers are camera-plane 2D (720x1280 video px). Metre scale is only meaningful with');
  L.push('an assumption; we use a ~1.7 m athlete with a 1.55 m ski (per `docs/LANE-D.md`). For pixel');
  L.push('scale we use the torso: shoulder-midpoint to hip-midpoint ≈ 0.50 m on a 1.7 m athlete,');
  L.push('±15% for build and posture. Torso size in px varies with distance to the camera and crop,');
  L.push('so each clip quotes the median and the 5–95% band; the implied px/m is the band, not a');
  L.push('constant. Perspective foreshortening of the torso (leans toward/away from camera) is the');
  L.push('dominant uncertainty for any metre conversion, typically ±20%.');
  L.push('');
  L.push('## Per-clip track quality');
  L.push('');
  L.push('| clip | role | frames | tracked | interpolated | gaps > 3 | max gap | torso median px | torso p05–p95 px |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const { clip, summary: s } of results) {
    L.push(`| ${clip} | ${CLIP_ROLE[clip] || ''} | ${s.frames} | ${s.known} (${s.coverage}%) | ${s.interpolated} | ${s.gapsOver3} | ${s.maxGap} | ${s.sizeMedianPx} | ${s.sizeP05Px}–${s.sizeP95Px} |`);
  }
  L.push('');
  L.push('Sanity checks for the reviewer: `overlay_sheet_track.jpg` per clip shows the chosen');
  L.push('skeleton (thick green) over the existing all-people overlay (thin); the thick skeleton');
  L.push('should stay on the athlete for the whole sheet.');
  L.push('');
  L.push('### Known issues (checked on the sheets, iteration 1)');
  L.push('');
  L.push('- **IMG_3396 (night)**: 64.8% coverage. Detection scores are low at night (mean 0.40),');
  L.push('  and the tracker spends the first ~25 frames on a foreground bystander before the');
  L.push('  airborne athlete takes over; the shovel crew near the kicker can steal it back.');
  L.push('- **IMG_7841 (landing)**: 67.2% coverage. The athlete enters airborne while a');
  L.push('  similar-coloured official stands by the kicker; the track holds the official until');
  L.push('  late flight, then follows the athlete from just before touchdown through the whole');
  L.push('  ride-out. Takeoff-side frames are effectively unusable in this clip anyway.');
  L.push('- **IMG_3523**: correct athlete through in-run, lip, flight, landing and ride-out, but');
  L.push('  with one 84-frame gap while the athlete is small in the in-run; 73.2% coverage.');
  L.push('- IMG_3520, IMG_3523_hop, IMG_3765, IMG_3768: track verified on the sheets (95–100%');
  L.push('  coverage).');
  L.push('');
  L.push('## Rotation metrics from the tracked pose (iteration 2)');
  L.push('');
  L.push('Method (`tools/pose/metrics.js`): the shoulder-midpoint → hip-midpoint vector angle θ(f)');
  L.push('(image plane, 0° = upright) is unwrapped across each clip (unwrap resets after gaps > 3');
  L.push('frames so cuts never fake rotation) and differentiated to ω in °/s, 3-tap-median smoothed.');
  L.push('Rotation intervals are maximal runs with |ω| ≥ 90°/s (runs ≤ 2 frames apart merged, never');
  L.push('across gaps); a flips estimate is only reported for intervals that plausibly contain whole');
  L.push('flips (≥ 0.25 s, ≥ 180° captured turn, peak ≤ 3000°/s). Per-frame θ/ω series and interval');
  L.push('details are in `reference/pose/<clip>/athlete_metrics.json` (local).');
  L.push('');
  L.push('### Key finding: flip counts are NOT derivable from the current pose data');
  L.push('');
  L.push('RTMPose fits a near-upright skeleton to the inverted athlete at small scale, so the');
  L.push('shoulder→hip angle does not wind during the sheet-verified flips. The table is therefore a');
  L.push('rotation-capture diagnostic: where the pose data supports a number it is quoted, where it');
  L.push('does not the failure is evidenced and a targeted re-extraction window is proposed (crop +');
  L.push('4× upscale around the flight, the approach that produced the clean `IMG_3523_hop` track).');
  L.push('');
  L.push('| clip | flight per review sheet | max θ excursion in 0.5 s | significant rotation intervals | flips | verdict |');
  L.push('|---|---|---|---|---|---|');
  for (const { clip, metrics: m } of results) {
    const v = CLIP_ROT_VERDICT[clip] || { flight: '', verdict: '' };
    const iv = m.rotationIntervals
      .map((r) => `f${r.f0}–${r.f1}: ${r.absTurnDeg}°/ ${r.dur}s, peak ${r.peakRateDegS}°/s${r.flipsEst != null ? `, ≈${r.flipsEst} flips` : ''}`)
      .join('; ') || 'none';
    const ivShort = iv.length > 80 ? iv.slice(0, 77) + '…' : iv;
    L.push(`| ${clip} | ${v.flight} | ${m.thetaExcursion05sDeg}° (f${m.thetaExcursionSpan[0]}–${m.thetaExcursionSpan[1]}) | ${ivShort} | ${m.rotationIntervals.some((r) => r.flipsEst != null) ? m.rotationIntervals.filter((r) => r.flipsEst != null).map((r) => r.flipsEst).join(', ') : 'n/d'} | ${v.verdict} |`);
  }
  L.push('');
  L.push('Reading notes:');
  L.push('');
  L.push('- The 30 fps frame rate bounds every rate by pose jitter: one degree of θ noise per');
  L.push('  frame is already ±30°/s, which is why only intervals with sustained ≥ 90°/s and');
  L.push('  ≥ 180° of turn are counted, and interval means are quoted to 2 significant figures.');
  L.push('- `IMG_7841` is the only clip where the pose actually captures body rotation: the tracked');
  L.push('  θ sweeps ~80° → ~25° over the 0.50 s before touchdown (mean 165°/s, peak 310°/s). This is');
  L.push('  the late-flight "open for landing" attitude change, not a flip.');
  L.push('- `IMG_3523_hop` (torso ≈ 10 px): hip-anchor "surges" of ±60–70 px/frame at f60/67/72/74');
  L.push('  alternate in sign and equal ~1 torso width at original scale — left/right hip keypoint');
  L.push('  swaps during the turn, not travel. The hop turn window is f58–75 ± 2 (0.57 ± 0.07 s);');
  L.push('  hop takeoff/landing/air time need the raw video re-extracted around that window.');
  L.push('- Airtime, takeoff/landing frames, in-run crouch depth and arm-sweep timing, tuck shape and');
  L.push('  the landing absorption remain to be derived (task item 2) once rotation-aware tracks');
  L.push('  exist; the golden-trace comparison (task item 3) and physics proposals (task item 4)');
  L.push('  follow from those numbers.');
  L.push('');
  L.push('## Proposals');
  L.push('');
  L.push('None yet — proposals come after the comparison tables exist (task item 4).');
  L.push('');
  return L.join('\n');
}

main();

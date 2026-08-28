#!/usr/bin/env python
"""Lane D tracked-crop re-extraction (reviewer fix): re-run RTMPose on a
tracked, upscaled crop per frame with test-time rotation (0/90/180/270 deg;
keep every detected person per frame and rotate the keypoints back), so
inverted athletes get a properly inverted skeleton. The existing tracker
re-run on the output restores continuity; the rotation table is then redone.

Usage: <venv python> tools/pose/reextract_tracked.py <repo_root> <clip> [f0 f1]
Reads   reference/pose/<clip>/keypoints.json + athlete_track.json
        reference/video/<clip>.<ext> (repo root, $LANE_D_VIDEO_DIR, or the
        main checkout at ~/Code/aerial-ski-game/reference/video)
Writes  reference/pose/<clip>/keypoints_tracked.json (same schema as
        keypoints.json, absolute frame indices; frames decoded via ffmpeg with
        the same filter chain as extract_all.py so rotation/colour match the
        original extraction)
"""
import glob
import json
import os
import subprocess
import sys

import cv2 as cv
import numpy as np
from rtmlib import Body

TORSO_FRAC = 0.29          # shoulder-mid -> hip-mid ~= 0.29 of person height
CROP_X_PERSONH = 3.0       # crop side ~ 3x the person height
MIN_PERSON_PX = 600.0      # upscale until the person is >= 600 px tall
MAX_CROP_PX = 1800.0       # cap the upscaled crop side


def inv_rotate(k, xr, yr, s):
    # Map a point from the rotated crop back to the unrotated crop (side s).
    # Validated against cv.rotate pixel permutations in iteration 3.
    if k == 0:
        return xr, yr
    if k == 1:                     # ROTATE_90_CLOCKWISE
        return yr, (s - 1) - xr
    if k == 2:                     # 180
        return (s - 1) - xr, (s - 1) - yr
    return (s - 1) - yr, xr        # ROTATE_90_COUNTERCLOCKWISE


def video_path(root, clip):
    cands = []
    if os.environ.get('LANE_D_VIDEO_DIR'):
        cands.append(os.environ['LANE_D_VIDEO_DIR'])
    cands.append(os.path.join(root, 'reference', 'video'))
    home = os.environ.get('HOME', '')
    cands.append(os.path.join(home, 'Code', 'aerial-ski-game', 'reference', 'video'))
    for d in cands:
        for ext in ('.MP4', '.MOV', '.mp4', '.mov'):
            p = os.path.join(d, clip + ext)
            if os.path.exists(p):
                return p
    return None


def render_frames(src, workdir):
    """Decode the whole clip exactly like extract_all.py: 30 fps, long side
    1280, ffmpeg auto-rotation and colour handling. Returns [frame_path]."""
    os.makedirs(workdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(workdir, 'f_*.jpg')))
    if files:
        return files
    vf = "fps=30,scale=if(gt(iw\\,ih)\\,1280\\,-2):if(gt(iw\\,ih)\\,-2\\,1280)"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', vf,
                    '-q:v', '3', os.path.join(workdir, 'f_%04d.jpg')], check=True)
    return sorted(glob.glob(os.path.join(workdir, 'f_*.jpg')))


def person_geom(e, kpdata, i, W, H):
    """(centre, person height px, crop side px) for the tracked person."""
    if not e.get('ok') or e.get('person') is None:
        return None
    torso = e.get('size')
    hip = e.get('hip')
    if (not torso or torso <= 0 or not hip) and kpdata:
        fr = kpdata['frames'][i] if i < len(kpdata['frames']) else None
        p = fr['people'][e['person']] if fr and fr.get('people') and \
            e['person'] < len(fr['people']) else None
        if p:
            k = np.array(p['kp_px'], float)
            sc = np.array(p['score'], float) >= 0.5
            if sc.sum() >= 4:
                x0, y0 = k[sc].min(axis=0)
                x1, y1 = k[sc].max(axis=0)
                hip = hip or [(x0 + x1) / 2, (y0 + y1) / 2]
                torso = torso or max(0.29 * (y1 - y0), 6.0)
    if not torso or torso <= 0 or not hip:
        return None
    personH = torso / TORSO_FRAC
    return hip, personH, min(CROP_X_PERSONH * personH, float(min(W, H)))


def main():
    root = os.path.abspath(sys.argv[1])
    clip = sys.argv[2]
    f0 = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    f1 = int(sys.argv[4]) if len(sys.argv) > 4 else 10 ** 9
    cdir = os.path.join(root, 'reference', 'pose', clip)
    kpdata = json.load(open(os.path.join(cdir, 'keypoints.json')))
    track = json.load(open(os.path.join(cdir, 'athlete_track.json')))
    W, H = kpdata['frame_size']
    src = video_path(root, clip)
    if not src:
        raise SystemExit(f'video for {clip} not found')
    scratch = os.path.join(os.environ.get('HOME', ''), 'aerial-agents', 'scratch', 'lane-D',
                           'frames', clip)
    files = render_frames(src, scratch)
    if len(files) < len(kpdata['frames']):
        raise SystemExit(f'{clip}: ffmpeg produced {len(files)} frames, expected {len(kpdata["frames"])}')

    body = Body(mode='balanced', to_openpose=False, backend='onnxruntime', device='cpu')
    out = {
        'source': os.path.basename(src),
        'fps': kpdata['fps'],
        'frame_size': [W, H],
        'keypoint_format': 'COCO-17 (rtmlib Body, balanced) on tracked crops, test-time rotation',
        'note': ('per-frame crop centred on the tracked hip (side ~3x person height, '
                 f'upscaled to >={MIN_PERSON_PX:.0f} px person height), RTMPose run at '
                 '0/90/180/270 deg, all detected people kept with their keypoints rotated '
                 'back to video px; track on this file for continuity'),
        'frames': [],
    }
    codes = {0: None, 1: cv.ROTATE_90_CLOCKWISE, 2: cv.ROTATE_180, 3: cv.ROTATE_90_COUNTERCLOCKWISE}
    for e in track['frames']:
        i = e['frame']
        if i < f0 or i > f1:
            continue
        rec = {'frame': i, 't': round(i / kpdata['fps'], 3), 'people': []}
        geom = person_geom(e, kpdata, i, W, H)
        if geom:
            hip, personH, side = geom
            scale = min(max(1.0, MIN_PERSON_PX / personH), MAX_CROP_PX / side)
            x0 = int(round(min(max(hip[0] - side / 2, 0), W - side)))
            y0 = int(round(min(max(hip[1] - side / 2, 0), H - side)))
            img = cv.imread(files[i])
            crop = img[y0:y0 + int(side), x0:x0 + int(side)]
            per_rot = {}
            for k in range(4):
                rot = cv.rotate(crop, codes[k]) if codes[k] is not None else crop
                up = cv.resize(rot, None, fx=scale, fy=scale, interpolation=cv.INTER_LINEAR)
                kps, scores = body(up)
                if kps is None or not len(kps):
                    continue
                means = scores.mean(axis=1)
                people = []
                for j in range(len(kps)):
                    pts = []
                    for (xr, yr) in kps[j]:
                        xrc, yrc = xr / scale, yr / scale
                        xc, yc = inv_rotate(k, xrc, yrc, side)
                        pts.append([xc + x0, yc + y0])
                    people.append({'kp_px': np.round(pts, 1).tolist(),
                                   'score': np.round(scores[j], 3).tolist(),
                                   'mean_score': round(float(means[j]), 3), 'rot': k})
                per_rot[k] = {'best': float(means.max()), 'people': people}
            if per_rot:
                kb = max(per_rot, key=lambda k: per_rot[k]['best'])
                rec['people'] = per_rot[kb]['people']
            rec['crop'] = {'x0': x0, 'y0': y0, 'side': int(side), 'scale': round(scale, 2)}
        out['frames'].append(rec)
        if len(out['frames']) % 10 == 0:
            r = out['frames'][-1]
            m = max((p['mean_score'] for p in r['people']), default=None)
            print(f"  f{r['frame']}: people {len(r['people'])}, best mean {m}", flush=True)
    dst = os.path.join(cdir, 'keypoints_tracked.json')
    json.dump(out, open(dst, 'w'))
    det = sum(1 for r in out['frames'] if r['people'])
    ms = [max(p['mean_score'] for p in r['people']) for r in out['frames'] if r['people']]
    rots = {}
    for r in out['frames']:
        if r['people']:
            b = max(r['people'], key=lambda p: p['mean_score'])
            rots[b['rot']] = rots.get(b['rot'], 0) + 1
    print(f"{clip}: {len(out['frames'])} tracked frames re-extracted, people in {det}, "
          f"best-person mean {np.mean(ms):.3f}, best rotations {dict(sorted(rots.items()))} -> {dst}")


if __name__ == '__main__':
    main()

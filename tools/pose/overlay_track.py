#!/usr/bin/env python
"""Lane D overlay helper: draw the tracked athlete on the existing per-frame
pose overlays and montage a review sheet per clip.

Usage: <venv python> tools/pose/overlay_track.py <repo root>
Reads  reference/pose/<clip>/keypoints.json + athlete_track.json + overlay/o_*.jpg
Writes reference/pose/<clip>/overlay_sheet_track.jpg
"""
import glob
import json
import math
import os
import sys

import cv2 as cv
import numpy as np

COCO_EDGES = [
    (15, 13), (13, 11), (11, 12), (12, 14), (14, 16),
    (11, 5), (12, 6), (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),
]
GREEN = (60, 220, 60)
MID = (0, 255, 255)
TILE_H = 300
COLS = 6
PER_SHEET = 18


def draw_skeleton(img, kp, score, thick):
    for a, b in COCO_EDGES:
        if score[a] < 0.5 or score[b] < 0.5:
            continue
        pa = (int(round(kp[a][0])), int(round(kp[a][1])))
        pb = (int(round(kp[b][0])), int(round(kp[b][1])))
        cv.line(img, pa, pb, GREEN, thick, cv.LINE_AA)
    for i in range(17):
        if score[i] >= 0.5:
            cv.circle(img, (int(round(kp[i][0])), int(round(kp[i][1]))), thick + 1, GREEN, -1, cv.LINE_AA)


def sheet_for_clip(root, clip):
    cdir = os.path.join(root, "reference", "pose", clip)
    kp_path = os.path.join(cdir, "keypoints.json")
    tr_path = os.path.join(cdir, "athlete_track.json")
    odir = os.path.join(cdir, "overlay")
    if not (os.path.exists(kp_path) and os.path.exists(tr_path) and os.path.isdir(odir)):
        print(f"{clip}: missing inputs, skipped")
        return False
    kp_data = json.load(open(kp_path))
    track = json.load(open(tr_path))
    frames = {f["frame"]: f for f in track["frames"]}

    tiles = []
    for path in sorted(glob.glob(os.path.join(odir, "o_*.jpg"))):
        idx = int(os.path.splitext(os.path.basename(path))[0][2:])
        e = frames.get(idx)
        if e is None or not e.get("ok"):
            continue
        img = cv.imread(path)
        if img is None:
            continue
        if e.get("person") is not None:
            people = kp_data["frames"][idx]["people"]
            if e["person"] < len(people):
                p = people[e["person"]]
                # Hop clip: crop-space keypoints match the crop-space overlay
                # images; everything else uses video-space kp_px.
                kp = p["kp_px"] if "kp_px" in p else p["kp_crop_px"]
                draw_skeleton(img, kp, p["score"], 4)
        if e.get("hip") and e.get("shoulder"):
            hip = (int(round(e["hip"][0])), int(round(e["hip"][1])))
            sho = (int(round(e["shoulder"][0])), int(round(e["shoulder"][1])))
            cv.line(img, hip, sho, MID, 2, cv.LINE_AA)
            cv.circle(img, hip, 6, MID, 2, cv.LINE_AA)
            cv.circle(img, sho, 6, MID, 2, cv.LINE_AA)
        cv.putText(img, f"f{idx} t={e['t']:.2f}s", (8, 26),
                   cv.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 3, cv.LINE_AA)
        cv.putText(img, f"f{idx} t={e['t']:.2f}s", (8, 26),
                   cv.FONT_HERSHEY_SIMPLEX, 0.7, GREEN, 1, cv.LINE_AA)
        scale = TILE_H / img.shape[0]
        tile = cv.resize(img, (int(img.shape[1] * scale), TILE_H))
        tiles.append((idx, tile))

    if not tiles:
        print(f"{clip}: no overlaid frames, skipped")
        return False
    step = max(1, len(tiles) // PER_SHEET)
    chosen = tiles[::step][:PER_SHEET]
    w = max(t.shape[1] for _, t in chosen)
    rows = math.ceil(len(chosen) / COLS)
    sheet = np.zeros((rows * (TILE_H + 24) + 8, COLS * (w + 8) + 8, 3), np.uint8)
    for i, (idx, t) in enumerate(chosen):
        r, c = divmod(i, COLS)
        y, x = 8 + r * (TILE_H + 24), 8 + c * (w + 8)
        sheet[y:y + t.shape[0], x:x + t.shape[1]] = t
    out = os.path.join(cdir, "overlay_sheet_track.jpg")
    cv.imwrite(out, sheet, [cv.IMWRITE_JPEG_QUALITY, 85])
    print(f"{clip}: sheet {len(chosen)} tiles -> {os.path.relpath(out, root)}")
    return True


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    clips = sorted(
        d for d in os.listdir(os.path.join(root, "reference", "pose"))
        if os.path.isdir(os.path.join(root, "reference", "pose", d))
    )
    ok = [clip for clip in clips if sheet_for_clip(root, clip)]
    print(f"sheets written for {len(ok)}/{len(clips)} clips")


if __name__ == "__main__":
    main()

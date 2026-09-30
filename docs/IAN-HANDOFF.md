# Ian: ski game handoff

Give this file to Claude Code while signed in to **Ian's own buypower account**.
Claude should explain each step simply and do the setup, coding and checks.

## Where the latest code lives

Recovery verified September 30, 2026:

- Dad's live checkout on **buypower** is `/home/justin/Code/aerial-ski-game`.
  Port 8200 serves that directory directly; there is no build output to find.
- GitHub: https://github.com/jsl/aerial-ski-game/tree/render-realism-glm
- Dad's `jsl` account has read-only access to `IanLeitgeb/aerial-ski-game`,
  so this branch is backed up in Dad's fork, `jsl/aerial-ski-game`.
- Use branch **`render-realism-glm`**, not GitHub's default `main` branch.
- The recovered clean checkpoint was `b65da2acf7eda0a0e488c4ea0e958f91708b489b`;
  its latest game change is v114 at `1f7e169`. Later handoff-only commits do not
  change the game. The package's `SOURCE_COMMIT` records its exact bundled tip.
- This document is tracked as `docs/IAN-HANDOFF.md`. A shared copy and full Git
  bundle are at `/var/tmp/aerial-ski-ian-handoff/` on **buypower**, not zion.
  The shared directory was missing and has been recreated from the live checkout.
- Temporary directories can be cleaned up. GitHub and the tracked document are
  the durable recovery source; the bundle permits setup without GitHub access.

## Start with an independent copy

The handoff snapshot is a Git bundle readable by other local accounts:
`/var/tmp/aerial-ski-ian-handoff/aerial-ski-game.bundle`.
It contains the `render-realism-glm` branch and its history, including the v114
rendering checkpoint `1f7e169`. No GitHub credentials are needed to clone it.

Run these commands as Ian, in a HerdR terminal. If the destination already
exists, inspect it first; do not overwrite or discard existing work.

```bash
mkdir -p ~/Code
git clone --branch render-realism-glm /var/tmp/aerial-ski-ian-handoff/aerial-ski-game.bundle ~/Code/aerial-ski-game
cd ~/Code/aerial-ski-game
git remote remove origin
git branch --show-current
```

If the shared bundle is unavailable, use Ian's own GitHub access instead:

```bash
mkdir -p ~/Code
git clone --branch render-realism-glm https://github.com/jsl/aerial-ski-game.git ~/Code/aerial-ski-game
cd ~/Code/aerial-ski-game
git branch --show-current
```

Use only one clone method and never overwrite an existing checkout. If GitHub
requires authentication, use Ian's account; do not borrow Dad's credentials.

The last command must print `render-realism-glm`. Keep work on that branch in
Ian's copy. Do not edit Justin's checkout or switch to main. The bundle is a
snapshot, not a live remote; commit changes locally. Arrange sharing with Dad
later instead of pushing or merging automatically.

## View Dad's version and run Ian's version

- Dad's current v114 preview: **http://buypower.lan.phq.org:8200/**.
- Port 8201 is an older stable snapshot, not the current work.
- Ian's preview: **http://buypower.lan.phq.org:8202/** after starting the server
  below. Port 8202 was free when this handoff was written; check before binding.

In a separate HerdR terminal pane, run:

```bash
cd ~/Code/aerial-ski-game
python3 -m http.server 8202 --bind 0.0.0.0
```

Leave that pane running. This game needs no build step or npm install to play.
Refresh Ian's URL after edits. Do not stop or replace the servers on 8200/8201.
If Dad's server is down, ask Dad to restart his preview; do not serve or modify
his checkout as Ian. For comparison, Ian can also clone the bundle into a
separate `~/Code/aerial-ski-baseline` directory and serve that unchanged snapshot
on a free port such as 8203 using the same Python command.

## Claude's working instructions

Use Claude to plan and review; delegate coding to the **OpenCode CLI** using
the family's **OpenCode Go** plan. Authentication belongs to Ian's account:
check availability there, and have the user configure `/connect` → OpenCode Go
if needed. Do not copy credentials from Justin's account or enroll in a new plan.

Check OpenCode `/models` (or `opencode models opencode-go`) before starting.
As checked on September 11, 2026, the official Go list includes GLM-5.3,
MiniMax M3 and Kimi K3. Suggested choices: GLM-5.3 for the main coding task,
MiniMax M3 for routine work, Kimi K3 for a difficult second opinion. Use exact
model identifiers from the installed CLI and the `opencode-go` provider, not
pay-as-you-go Zen. These are starting choices, not a benchmark ranking.
Source: https://opencode.ai/docs/go/

Read `docs/ASTRA-RENDER-2026-09-07.md`, latest feedback in
`docs/RENDER-PROGRESS.md`, and applicable repository instructions before editing.
The newest user feedback overrides older conflicting aesthetic preferences.

Current goals and constraints:

- Lean, consistent athlete frame: smaller shoulders/biceps, no pinched abdomen,
  prominent seat, or scalloped hip/knee silhouette. A side-waist fold remains.
- Both tuck poses were accepted; hands should clasp near the knees.
- Toe AND heel stay fixed to the ski during skiing and aerials; skis may release
  after a crash. Do not restore the bar behind the bindings.
- Across the slope, ski edges engage and the uphill knee bends to level the hips.
- Preserve improved resolution and post-crash camera controls. Right-drag or
  Ctrl-drag pans, left-drag orbits, and the wheel zooms; use a mouse to review.
- Crash rebound/onset concerns remain recorded in the ledger; do not claim all
  crash checks pass. Keep engine gameplay physics unchanged.

Make one small, reviewable improvement at a time. Inspect before/after images,
run relevant checks, record results in the ledger and commit locally. Ask Ian
what he thinks after each visual pass, and tell him when to refresh port 8202.

## GPU builds and tests

Use the **NVIDIA RTX 5070 Ti** for Blender rendering and browser visual checks.
Verify access from Ian's account with `nvidia-smi`. Find a usable Blender binary
with `command -v blender`; do not assume Justin's private tool paths work.
Run body builds from Ian's checkout with boots explicitly enabled:

```bash
blender -b --factory-startup --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048 --boots on
```

Follow the existing asset/cache versioning process in `game.js` and `index.html`.
Use `DRIVE_GPU=1` for GPU browser reviews and verify the renderer actually reports
NVIDIA, rather than assuming a successful browser launch proves GPU use.

For test tooling, install dependencies in Ian's copy with `npm install` (the
repository does not track a lockfile, so a fresh clone cannot use `npm ci`) and, if needed,
`npx playwright install chromium`. Basic checks:

```bash
npm run test:unit
npm run test:golden
DRIVE_GPU=1 DRIVE_PORT=8212 npm run test:drive -- ready-stance.spec.js hop-turn.spec.js
```

Use a free test port. Choose additional body/boot/tuck tests based on the change.
Never loosen a gate or regenerate golden traces merely to hide a failure; read
the ledger and the relevant ADR first. The handoff checkpoint passed 100 unit
tests, 30 golden scenarios and the relevant rendering checks, with zero physics
state differences.

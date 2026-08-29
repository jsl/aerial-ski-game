'use strict';
// ── The goal, made enforceable ───────────────────────────────────────────────
// Target: no physics left in game.js. Everything there should be rendering,
// input, UI or orchestration; every pure simulation function and physics
// constant belongs to engine/.
//
// Written as a test rather than a note, because "we finished the refactor" decays
// the moment someone adds a helper back into game.js. The ALLOWED lists below are
// the explicit contract: adding to them is a deliberate, reviewable act.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAME = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

/**
 * Top-level functions that legitimately stay in game.js.
 * Each needs a reason — if you cannot write one, it belongs in engine/.
 */
const ALLOWED_FUNCTIONS = {
    _linkAthleteShadowCasters: 'links athlete/ski meshes into the shadow renderList in the reveal frame (NEXT item 1) — renderer',
    _lsGet:              'localStorage access — environment, not physics',
    _lsSet:              'localStorage access — environment, not physics',
    _lsRemove:           'localStorage access — environment, not physics',
    _hexToRgb:           'colour conversion — renderer data',
    buildCharacter:      'constructs Babylon meshes — renderer',
    buildHUD:            'constructs GUI controls — renderer',
    applyPose:           'writes solved transforms onto meshes + IK fix-up — renderer',
    applyGamepadLateral: 'repositions arm meshes — renderer',
    _startGame:          'scene/loop orchestration — wiring, not simulation',
    makePBR:             'material factory — a StandardMaterial->PBR compat shim, renderer',
    _buildStyledSki:     'styled ski geometry/texture factory, parents children to the physics drivers — renderer',
    _inrunArmForward:    'in-run crouch arm-hold blend on the mesh drivers — renderer (ADR-0002)',
    _pinBootsToSkis:     'boot–ski seating fix-up on the mesh drivers after applyPose — renderer (ADR-0002)',
    _athleteVisualMeshes: 'athlete visibility registry for start gating — renderer',
    _alpineWorld:         'athlete/ski build + reveal orchestration on body link — renderer',
    _showAthleteFallback: 'legacy-solid fallback reveal on load failure — renderer',
    _hideAthleteVisuals:  'hide athlete visuals until body link — renderer',
    _revealSkiEquipment:  'same-frame reveal of skis/equipment on body link — renderer',
    _ensureAthleteOverlay: 'loading overlay DOM (spinner + text) during the gated athlete load — renderer',
    _removeAthleteOverlay: 'loading overlay removal in the reveal frame — renderer',
};

test('game.js defines no top-level function outside the allowed renderer set', () => {
    const found = [...GAME.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
        .map(m => m[1]);

    const unexpected = found.filter(n => !(n in ALLOWED_FUNCTIONS));
    assert.deepStrictEqual(unexpected, [],
        `game.js defines top-level function(s) not in the allowed renderer set: ` +
        `${unexpected.join(', ')}.\n` +
        `If it is pure simulation it belongs in engine/. If it is genuinely a ` +
        `renderer concern, add it to ALLOWED_FUNCTIONS with a reason.`);

    // The reverse direction: an allowed entry that no longer exists is stale and
    // should be pruned, otherwise the list slowly stops meaning anything.
    const stale = Object.keys(ALLOWED_FUNCTIONS).filter(n => !found.includes(n));
    assert.deepStrictEqual(stale, [],
        `ALLOWED_FUNCTIONS lists function(s) game.js no longer defines: ` +
        `${stale.join(', ')} — prune them.`);
});

test('game.js holds no physics constants', () => {
    // Constants whose values are physics, not presentation. Anything matching
    // these names must live in engine/ or in a discipline config.
    const PHYSICS_NAMES = [
        /^GRAVITY$/, /^TARGET_OMEGA/, /^I0$/, /^FLIP_POWER_RATE$/,
        /^LAND_TOL$/, /^DD_TABLE$/, /^SEGMENTS$/, /^BASE_Z$/, /^POSE_/,
    ];

    // An ALIAS to the engine (`const DD_TABLE = AerialEngine.tricks.DD_TABLE`)
    // is the desired end state, not a violation — the data lives in engine/ and
    // game.js merely names it locally. Only a real definition counts.
    const declared = [...GAME.matchAll(/^\s*const\s+([A-Z][A-Z_0-9]*)\s*=\s*([^\n;]*)/gm)]
        // Exempt values DERIVED from the engine rather than defined here:
        //   const GRAVITY = _physicsCfg.GRAVITY        (discipline config factory)
        //   const I0      = computeI(0)                (computed by the engine)
        // In both cases game.js holds no physics value of its own — it names a
        // result. A literal on the right-hand side is still a violation.
        .filter(m => !/AerialEngine\.|_physicsCfg\.|_terrainCfg\.|computeI\s*\(/.test(m[2]))
        .map(m => m[1]);

    const offenders = declared.filter(n => PHYSICS_NAMES.some(re => re.test(n)));
    assert.deepStrictEqual(offenders, [],
        `game.js declares physics constant(s): ${offenders.join(', ')}.\n` +
        `These belong in engine/core/ or in a discipline config object.`);
});

test('every engine module is reachable through the AerialEngine namespace', () => {
    // A module that exists but is not wired is dead weight: its tests guard code
    // the shipped game never runs. This asserts the two stay in step.
    const { ENGINE_MODULES } = require('../golden/harness');
    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (e.name.endsWith('.js')) files.push(path.relative(ROOT, p));
        }
    })(path.join(ROOT, 'engine'));

    const unwired = files.filter(f => !ENGINE_MODULES.includes(f));
    assert.deepStrictEqual(unwired, [],
        `engine module(s) exist but are not in ENGINE_MODULES, so the game never ` +
        `loads them: ${unwired.join(', ')}`);
});

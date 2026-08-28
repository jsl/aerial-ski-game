'use strict';

// ── Safe localStorage wrapper (some browsers restrict it for file:// URLs) ─
function _lsGet(key) { try { return localStorage.getItem(key); } catch(e) { return null; } }
function _lsSet(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
function _lsRemove(key) { try { localStorage.removeItem(key); } catch(e) {} }

// ── Colour helpers ─────────────────────────────────────────────────────────
function _hexToRgb(hex) {
    var r = parseInt(hex.slice(1,3),16)/255;
    var g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255;
    return [r, g, b];
}
const _CC = {
    helmet: _hexToRgb(_lsGet('color_helmet') || '#1a1a1a'),
    torso:  _hexToRgb(_lsGet('color_torso')  || '#1440bf'),
    arms:   _hexToRgb(_lsGet('color_arms')   || '#cc0f0f'),
    legs:   _hexToRgb(_lsGet('color_legs')   || '#1a1a1a'),
};

// ── Segment definitions ────────────────────────────────────────────────────
// Each segment has a name, box size (w × h × d), and mass (arbitrary units,
// proportional to a real athlete — ratios are what matter for physics).
// Segment physics (name, box size, mass) comes from the shared engine core
// (engine/core/body-model.js). Colour is RENDERER data and stays here — that is
// why body-model.js deliberately strips it (ADR-0002). The two are merged into
// the render-side SEGMENTS list the mesh builder consumes.
const _SEG_COLOR = {
    torso: _CC.torso,   head: _CC.helmet,
    upperArmL: _CC.arms, upperArmR: _CC.arms,
    lowerArmL: _CC.arms, lowerArmR: _CC.arms,
    upperLegL: _CC.legs, upperLegR: _CC.legs,
    lowerLegL: _CC.legs, lowerLegR: _CC.legs,
    skiL: [0.08, 0.08, 0.08], skiR: [0.08, 0.08, 0.08],
};
const SEGMENTS = AerialEngine.bodyModel.SEGMENTS.map(
    seg => Object.assign({}, seg, { color: _SEG_COLOR[seg.name] }));

// ── Poses ─────────────────────────────────────────────────────────────────
// Pose tables now live in the shared engine core
// (engine/core/body-model.js), consumed via AerialEngine.pose.computePose().
// They were duplicated here until the pose solver was extracted.

// Local transform of each segment relative to the CoM root TransformNode.
// x, y  = local position (root is ~center of torso / whole-body CoM)
// rz    = local rotation around Z (radians, positive = counterclockwise in body frame)
//
// Root is at center of mass ≈ just above the hips / center of torso.

// Base Z offsets — separate L/R segments to avoid depth-buffer fighting.
// These are constant and never changed by pose animation.
const BASE_Z = AerialEngine.bodyModel.BASE_Z;

// Segment chain geometry (all heights for reference):
//   torso h=0.55  → top y=+0.275, bottom y=-0.275
//   head  h=0.24  → center y = 0.275 + 0.005(neck) + 0.12 = 0.40
//   shoulder y = 0.15 (mid-upper torso)
//   upperArm h=0.30 → shoulder=top, center = 0.15-0.15 = 0.00, elbow = -0.15
//   lowerArm h=0.25 → elbow=top,   center = -0.15-0.125 = -0.275, wrist = -0.40
//   hip y = -0.275 (bottom of torso)
//   upperLeg h=0.36 → hip=top,  center = -0.275-0.18 = -0.455, knee = -0.635
//   lowerLeg h=0.36 → knee=top, center = -0.635-0.18 = -0.815, foot = -0.995
// x offset arms = ±0.175, legs = ±0.075. dz = forward/back delta from BASE_Z.
// Backflip tuck folds in the YZ plane: knees come forward (+dz) up toward chest.


// Inrun crouch: egg/tuck position — torso leans forward over knees.  Root is lowered
// 0.35 units when fully tucked, so ski y is set to -0.675 (= -1.010 + 0.35).


// Pike: hips flexed 145° forward from hanging, legs perfectly straight (no knee bend).
// rx=+2.53 rad (≈145°) for all leg/ski segments: kinematically verified so the hip
// joint (+Y top of upperLeg) sits exactly at y=-0.275, the bottom of the torso.

// Arm sweep: two-phase animation.
// Phase 1 (armDrop 0→0.5): raised → swung out in front (horizontal forward)
// Phase 2 (armDrop 0.5→1): in front → hanging at side
// Character faces -Z, so dz negative = in front of body.
// Arms angled 50° forward from vertical, straight (no elbow bend).
// rx = -50° = -0.873 rad. Shoulder at y=0.15, arm points forward-down.
// T-pose: arms straight out to the sides.
// rz = +π/2 (left arm), rz = -π/2 (right arm).
// Arms raised straight up overhead.

// ── Physics helpers ────────────────────────────────────────────────────────
// lerp now comes from the shared engine core (engine/core/math.js), loaded
// before this file. Same implementation, single source of truth across the ski,
// trampoline and diving disciplines. See ADR-0002 / ADR-0003.
// Safe as a const: the first call site is inside a function body (computeI),
// so nothing evaluates it before this line runs.
const { lerp } = AerialEngine.math;

// Moment of inertia about the flip axis (X, shoulder-to-shoulder).
// Distance from X axis = sqrt(y² + z²), so I = Σ [ m_i·(y_i²+z_i²) + m_i·(h_i²+d_i²)/12 ]
// computeI now comes from the shared engine core (engine/core/inertia.js),
// which reads the body model from engine/core/body-model.js.
const { computeI } = AerialEngine.inertia;

// ── Character builder ──────────────────────────────────────────────────────

// ── StandardMaterial -> PBR compatibility shim ──────────────────────────────
// The scene had 38 StandardMaterials and one PBR. StandardMaterial is
// Blinn-Phong: it ignores scene.environmentTexture entirely, so the image-based
// lighting was doing nothing for 38 of 39 surfaces — the terrain, kicker, sky,
// trees and the whole athlete were still lit by a 1990s model.
//
// Converting all of them by hand would mean rewriting 88 property assignments,
// which is exactly the kind of mechanical edit that introduces silent mistakes.
// Instead this returns a PBRMaterial that still ANSWERS to the Blinn-Phong
// property names, mapping each onto its physical equivalent. Every existing
// assignment keeps working unchanged.
//
// specularPower -> roughness uses the standard Blinn-Phong conversion
// roughness = sqrt(2 / (power + 2)), so the hand-tuned values carry over with
// their relative ordering intact rather than being guessed at again.
function makePBR(name, scene) {
    const m = new BABYLON.PBRMaterial(name, scene);
    m.metallic  = 0.0;      // nothing in this scene is bare metal
    m.roughness = 0.75;     // sane default; overridden by specularPower below

    Object.defineProperty(m, 'diffuseColor', {
        get() { return m.albedoColor; },
        set(v) { m.albedoColor = v; },
        configurable: true,
    });
    Object.defineProperty(m, 'diffuseTexture', {
        get() { return m.albedoTexture; },
        set(v) { m.albedoTexture = v; },
        configurable: true,
    });
    Object.defineProperty(m, 'specularColor', {
        get() { return m._compatSpecular || null; },
        set(v) {
            m._compatSpecular = v;
            // A brighter Blinn-Phong specular meant a shinier surface. Map its
            // luminance onto a modest reflectance rather than onto metallic —
            // treating bright speculars as metal would turn snow into chrome.
            if (v) {
                const lum = (v.r + v.g + v.b) / 3;
                m.metallicF0Factor = Math.min(1, Math.max(0, lum * 1.6));
            }
        },
        configurable: true,
    });
    Object.defineProperty(m, 'specularPower', {
        get() { return m._compatPower; },
        set(p) {
            m._compatPower = p;
            const power = Math.max(1, p || 1);
            m.roughness = Math.min(1, Math.max(0.04, Math.sqrt(2 / (power + 2))));
        },
        configurable: true,
    });
    return m;
}

var _styledSkiAssets = null;   // shared topsheet atlas + materials for both skis

// ── Styled visual skis (P7/reviewer bundle item) ────────────────────────────
// Each ski's PHYSICS driver stays a flat box (body-model: w 0.08 × h 0.03 ×
// d 1.55) — the contact model, ready-stance seating and every clearance gate
// measure that box, so this builds RENDERED equipment in its place: a real
// mogul/aerials silhouette with sidecut (tip ≈95 / waist ≈70 / tail ≈85 mm),
// a rounded shovel rising ≈5.5 cm over the front ≈18 cm, a slightly lifted
// flat tail, thickness 1.6 cm underfoot tapering to ≈1 cm, a generic painted
// topsheet (DynamicTexture — colours and shapes only, no marks), dark
// sidewalls, a matte base, plus toe/heel binding pieces and a brake bar.
//
// Invariants the drive specs hold (rig.spec.js "styled skis"):
//   • every vertex sits ON or ABOVE the driver box bottom plane y=-seg.h/2 —
//     the rocker only LIFTS material off the snow, so the pitched-ski worst
//     case cannot dig deeper than the old full-thickness slab could;
//   • bounding length along z == seg.d ±0.01 m (equals the physics ski);
//   • the highest vertex is on the shovel, at the LEADING (−z) end;
//   • toe piece forward of heel piece, both centred on the ski's x axis.
// The builders used here (BABYLON.Mesh + hand-built VertexData) follow the
// terrainCorridor precedent so partial headless stubs boot unchanged.
function _buildStyledSki(scene, driver, seg, assets) {
    const L      = seg.d;
    const BOT    = -seg.h / 2;          // snow plane — hard floor for every vertex
    const HW_TIP = 0.0475, HW_WAIST = 0.035, HW_TAIL = 0.0425;
    const TIP_RISE = 0.055, TIP_SPAN = 0.18;
    const TAIL_LIFT = 0.014, TAIL_SPAN = 0.10;

    function profile(z) {
        const az = Math.abs(z);
        let hw;
        if (z < 0) {
            const u = Math.min(1, az / (L * 0.42));
            hw = HW_WAIST + (HW_TIP - HW_WAIST) * Math.pow(u, 1.15);
            if (az > L / 2 - 0.07) {
                const r = Math.max(0, (L / 2 - az) / 0.07);
                hw *= 0.62 + 0.38 * Math.sqrt(r);
            }
        } else {
            const u = Math.min(1, az / (L * 0.40));
            hw = HW_WAIST + (HW_TAIL - HW_WAIST) * Math.pow(u, 1.25);
            if (az > L / 2 - 0.05) {
                const r = Math.max(0, (L / 2 - az) / 0.05);
                hw *= 0.70 + 0.30 * Math.sqrt(r);
            }
        }
        let lift = 0;
        const zTipContact = -L / 2 + TIP_SPAN;
        if (z < zTipContact) {
            const s = (zTipContact - z) / TIP_SPAN;
            lift = TIP_RISE * Math.pow(s, 1.8);
        }
        const zTailStart = L / 2 - TAIL_SPAN;
        if (z > zTailStart) {
            const s = (z - zTailStart) / TAIL_SPAN;
            lift += TAIL_LIFT * s * s;
        }
        const th = 0.009 + 0.0075 * Math.exp(-(z * z) / (2 * 0.22 * 0.22));
        return { hw, bot: BOT + lift, top: BOT + lift + th };
    }

    // Shared per-page resources: one atlas + one material pair for both skis.
    if (!assets.tex) {
        const tex = new BABYLON.DynamicTexture('skiTopTex',
            { width: 512, height: 512 }, scene, false);
        const c = tex.getContext();
        c.fillStyle = '#eef1f4'; c.fillRect(0, 0, 512, 512);
        // Sidewall strips run the full length at both edges.
        c.fillStyle = '#17191d';
        c.fillRect(0, 0, 42, 512); c.fillRect(470, 0, 42, 512);
        // Matte base zone: the base/cap faces carry uv v ∈ [0.76, 0.96],
        // i.e. canvas y ∈ [20, 123] (GL v grows up, canvas y grows down).
        c.fillStyle = '#101114'; c.fillRect(42, 20, 428, 104);
        // Topsheet graphic: strong band on the shovel + accent pinstripe.
        // Canvas y grows DOWN while UV v grows UP, so draw accordingly.
        c.fillStyle = '#14568c'; c.fillRect(42, 402, 428, 84);
        c.fillStyle = '#c94f36'; c.fillRect(42, 380, 428, 14);
        // Generic mark: white diamonds inside the band (no lettering/mirroring).
        c.fillStyle = '#eef1f4';
        for (let k = 0; k < 4; k++) {
            const cx = 120 + k * 90, cy = 444, r = 11;
            c.beginPath();
            c.moveTo(cx, cy - r); c.lineTo(cx + r, cy);
            c.lineTo(cx, cy + r); c.lineTo(cx - r, cy);
            c.closePath(); c.fill();
        }
        tex.update(false);

        const bodyMat = makePBR('skiVis_mat', scene);
        bodyMat.albedoTexture = tex;
        bodyMat.albedoColor   = new BABYLON.Color3(1, 1, 1);
        bodyMat.metallic      = 0;
        bodyMat.roughness     = 0.42;

        const bindMat = makePBR('skiBind_mat', scene);
        bindMat.diffuseColor  = new BABYLON.Color3(0.13, 0.13, 0.145);
        bindMat.specularColor = new BABYLON.Color3(0.45, 0.45, 0.50);
        bindMat.specularPower = 45;
        assets.bodyMat = bodyMat; assets.bindMat = bindMat;
    }

    // Cross-sections nose → tail.
    const N = 22, S = [];
    for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        S.push(Object.assign({ z: -L / 2 + t * L }, profile(-L / 2 + t * L)));
    }

    // Top-face v coordinate of a station: arc-length-ish parameter into the
    // topsheet field [0.02, 0.72]; everything else lands in the dark zones.
    const V0 = 0.02, V1 = 0.72, EL = 0.08, EH = 0.92;
    const va = [], vb = [];
    for (let i = 0; i < N; i++) va.push(V0 + (V1 - V0) * i / (N - 1));

    const P = [], U = [], I = [];
    let nv = 0;
    function quad(p0, p1, p2, p3, uv0, uv1, uv2, uv3) {
        P.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
               p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
        U.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1], uv3[0], uv3[1]);
        I.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
        nv += 4;
    }
    const DARK = [[0.04, 0.86]];
    for (let i = 0; i < N - 1; i++) {
        const a = S[i], b = S[i + 1];
        const axl = -a.hw, axr = a.hw, bxl = -b.hw, bxr = b.hw;
        quad([axr, a.top, a.z], [axl, a.top, a.z], [bxl, b.top, b.z], [bxr, b.top, b.z],
             [EL, va[i]], [EH, va[i]], [EH, va[i + 1]], [EL, va[i + 1]]);          // top ↑y
        quad([axl, a.bot, a.z], [axr, a.bot, a.z], [bxr, b.bot, b.z], [bxl, b.bot, b.z],
             [0.12, 0.79], [0.88, 0.79], [0.88, 0.93], [0.12, 0.93]);               // base ↓y
        quad([axl, a.bot, a.z], [bxl, b.bot, b.z], [bxl, b.top, b.z], [axl, a.top, a.z],
             DARK[0], DARK[0], DARK[0], DARK[0]);                                   // left ←x
        quad([axr, a.bot, a.z], [axr, a.top, a.z], [bxr, b.top, b.z], [bxr, b.bot, b.z],
             DARK[0], DARK[0], DARK[0], DARK[0]);                                   // right →x
    }
    // End caps: nose (outward −z) and tail (outward +z).
    const f = S[0], k = S[N - 1];
    quad([-f.hw, f.bot, f.z], [-f.hw, f.top, f.z], [f.hw, f.top, f.z], [f.hw, f.bot, f.z],
         DARK[0], DARK[0], DARK[0], DARK[0]);
    quad([k.hw, k.bot, k.z], [k.hw, k.top, k.z], [-k.hw, k.top, k.z], [-k.hw, k.bot, k.z],
         DARK[0], DARK[0], DARK[0], DARK[0]);

    const vis = new BABYLON.Mesh(seg.name + '_vis', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = P;
    vd.indices   = I;
    vd.uvs       = U;
    vd.normals   = new Array(P.length);
    BABYLON.VertexData.ComputeNormals(P, I, vd.normals);
    vd.applyToMesh(vis);
    vis.material = assets.bodyMat;
    vis.parent   = driver;

    // Binding under the boot line: toe piece ahead of the boot footprint,
    // heel piece behind it, brake bar spread across the tail deck.
    const toeH = 0.032, heelH = 0.034;
    const toeY = profile(-0.205).top + toeH / 2;
    const heelY = profile(0.245).top + heelH / 2;
    const brakeY = profile(0.315).top + 0.004;

    const toe = BABYLON.MeshBuilder.CreateBox(seg.name + '_toe',
        { width: 0.078, height: toeH, depth: 0.13 }, scene);
    toe.parent = driver; toe.position.set(0, toeY, -0.205);
    toe.material = assets.bindMat;

    const heel = BABYLON.MeshBuilder.CreateBox(seg.name + '_heel',
        { width: 0.09, height: heelH, depth: 0.115 }, scene);
    heel.parent = driver; heel.position.set(0, heelY, 0.245);
    heel.material = assets.bindMat;

    const brake = BABYLON.MeshBuilder.CreateBox(seg.name + '_brake',
        { width: 0.20, height: 0.0075, depth: 0.05 }, scene);
    brake.parent = driver; brake.position.set(0, brakeY, 0.315);
    brake.material = assets.bindMat;

    return vis;
}

function buildCharacter(scene) {
    // Root TransformNode sits at the whole-body center of mass.
    // The flip rotation is applied to root; all segments move with it.
    const root = new BABYLON.TransformNode('skierRoot', scene);
    const meshes = {};

    for (const seg of SEGMENTS) {
        const n = seg.name;
        let mesh;

        if (n === 'head') {
            // Sphere for the helmet
            mesh = BABYLON.MeshBuilder.CreateSphere(n, {
                diameter: seg.h,
                segments: 32,
            }, scene);
        } else if (n === 'torso') {
            // Tapered cylinder — wider at shoulders, narrower at hips
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    seg.w,
                diameterBottom: seg.w * 0.68,
                height:         seg.h,
                tessellation:   48,
            }, scene);
        } else if (n === 'skiL' || n === 'skiR') {
            // Skis remain flat boxes
            mesh = BABYLON.MeshBuilder.CreateBox(n, {
                width:  seg.w,
                height: seg.h,
                depth:  seg.d,
            }, scene);
        } else if (n === 'upperLegL' || n === 'upperLegR') {
            // Thigh — wide at hip, tapers to knee
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.175,
                diameterBottom: 0.115,
                height:         seg.h,
                tessellation:   48,
            }, scene);
        } else if (n === 'lowerLegL' || n === 'lowerLegR') {
            // Calf — full at top, tapers to ankle
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.135,
                diameterBottom: 0.080,
                height:         seg.h,
                tessellation:   48,
            }, scene);
        } else if (n === 'upperArmL' || n === 'upperArmR') {
            // Upper arm — wider at shoulder, tapers to elbow
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.120,
                diameterBottom: 0.090,
                height:         seg.h,
                tessellation:   48,
            }, scene);
        } else if (n === 'lowerArmL' || n === 'lowerArmR') {
            // Forearm — wider at elbow, tapers to wrist
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameterTop:    0.095,
                diameterBottom: 0.065,
                height:         seg.h,
                tessellation:   48,
            }, scene);
        } else {
            // Fallback — rounded cylinder
            const diam = (seg.w + seg.d) / 2;
            mesh = BABYLON.MeshBuilder.CreateCylinder(n, {
                diameter:     diam,
                height:       seg.h,
                tessellation: 48,
            }, scene);
        }

        // Extra tessellation only reads as CURVED if the normals are smoothed —
        // otherwise it is just more visible facets.
        if (mesh.forceSharedVertices) {
            try { mesh.forceSharedVertices(); mesh.createNormals(true); } catch (e) { /* stub */ }
        }

        mesh.parent = root;

        const mat = makePBR(n + '_mat', scene);
        mat.diffuseColor  = new BABYLON.Color3(seg.color[0], seg.color[1], seg.color[2]);
        // Lycra/spandex sheen on suit panels; matte on skis
        const isSki = (n === 'skiL' || n === 'skiR');
        mat.specularColor = isSki ? new BABYLON.Color3(0.15, 0.15, 0.15) : new BABYLON.Color3(0.65, 0.65, 0.65);
        mat.specularPower = isSki ? 12 : 55;
        mesh.material = mat;

        meshes[n] = mesh;

        // ── Styled ski equipment (renderer-side; ADR-0002) ────────────────
        // The physics driver box stays exactly as authored — it is never
        // rendered again, it only carries the pose transforms the styled
        // geometry follows as children. Ski visuals are skipped entirely in
        // trampoline/pool worlds (skis are hidden there), so those scenes'
        // node censuses stay byte-identical.
        if ((n === 'skiL' || n === 'skiR') &&
            !_trampolineMode && !_trampolineMatMode && !_poolDiveMode) {
            mesh.isVisible = false;
            _buildStyledSki(scene, mesh, seg,
                (_styledSkiAssets = _styledSkiAssets || {}));
        }


        // ── Per-segment detail meshes ────────────────────────────────────
        if (n === 'head') {
            // Goggle visor band on the front of the helmet (camera faces +Z)
            const visor = BABYLON.MeshBuilder.CreateBox('visor', {
                width:  seg.h * 0.70,
                height: seg.h * 0.22,
                depth:  seg.h * 0.18,
            }, scene);
            visor.parent = mesh;
            visor.position.set(0, 0.01, -seg.h * 0.44);
            const vMat = makePBR('visor_mat', scene);
            vMat.diffuseColor  = new BABYLON.Color3(0.04, 0.04, 0.04);
            vMat.specularColor = new BABYLON.Color3(0.7, 0.75, 0.9);
            vMat.specularPower = 80;
            visor.material = vMat;

            // Nose bump below visor
            const nose = BABYLON.MeshBuilder.CreateSphere('nose', {
                diameter: seg.h * 0.24,
                segments: 6,
            }, scene);
            nose.parent = mesh;
            nose.scaling.set(0.65, 0.55, 1.1);
            nose.position.set(0, -seg.h * 0.12, -seg.h * 0.45);
            const nMat = makePBR('nose_mat', scene);
            nMat.diffuseColor  = new BABYLON.Color3(0.85, 0.72, 0.60);
            nMat.specularColor = new BABYLON.Color3(0.20, 0.15, 0.12);
            nose.material = nMat;
        }

        if (n === 'torso') {
            // Neck — cylinder bridging torso top to head
            const neck = BABYLON.MeshBuilder.CreateCylinder('neck', {
                diameterTop:    0.11,
                diameterBottom: 0.13,
                height:         0.09,
                tessellation:   14,
            }, scene);
            neck.parent = mesh;
            neck.position.set(0, seg.h * 0.5 + 0.045, 0);
            const nkMat = makePBR('neck_mat', scene);
            nkMat.diffuseColor  = new BABYLON.Color3(0.85, 0.72, 0.60);
            nkMat.specularColor = new BABYLON.Color3(0.20, 0.15, 0.12);
            nkMat.specularPower = 18;
            neck.material = nkMat;
        }

        if (n === 'upperArmL' || n === 'upperArmR') {
            // Shoulder sphere — fills gap between torso and upper arm
            const shoulder = BABYLON.MeshBuilder.CreateSphere(n + '_shoulder', {
                diameter: 0.13,
                segments: 8,
            }, scene);
            shoulder.parent = mesh;
            shoulder.position.set(0, seg.h * 0.5, 0);
            const sMat = makePBR(n + '_shoulder_mat', scene);
            sMat.diffuseColor  = new BABYLON.Color3(_CC.arms[0], _CC.arms[1], _CC.arms[2]);
            sMat.specularColor = new BABYLON.Color3(0.55, 0.20, 0.20);
            sMat.specularPower = 55;
            shoulder.material = sMat;
        }

        if (n === 'lowerArmL' || n === 'lowerArmR') {
            // Elbow sphere — fills gap between upper and lower arm
            const elbow = BABYLON.MeshBuilder.CreateSphere(n + '_elbow', {
                diameter: 0.060,
                segments: 8,
            }, scene);
            elbow.scaling.set(1.0, 0.70, 1.0); // flatten slightly — elbows aren't round balls
            elbow.parent = mesh;
            elbow.position.set(0, seg.h * 0.5, 0);
            const eMat = makePBR(n + '_elbow_mat', scene);
            eMat.diffuseColor  = new BABYLON.Color3(_CC.arms[0], _CC.arms[1], _CC.arms[2]);
            eMat.specularColor = new BABYLON.Color3(0.55, 0.20, 0.20);
            eMat.specularPower = 55;
            elbow.material = eMat;

            // Glove sphere at the wrist end — position updated dynamically in applyPose
            const hand = BABYLON.MeshBuilder.CreateSphere(n + '_glove', {
                diameter: (seg.w + seg.d) / 2 * 1.5,
                segments: 6,
            }, scene);
            hand.parent = mesh;
            hand.position.set(0, -seg.h * 0.5, 0); // default: wrist at bottom (hanging)
            const hMat = makePBR(n + '_glove_mat', scene);
            hMat.diffuseColor  = new BABYLON.Color3(0.06, 0.06, 0.06);
            hMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            hand.material = hMat;
            // Store so applyPose can reposition per frame
            meshes[n === 'lowerArmL' ? 'gloveL' : 'gloveR'] = { mesh: hand, halfH: seg.h * 0.5 };
        }

        if (n === 'upperLegL' || n === 'upperLegR') {
            // Hip sphere — fills gap between torso and upper leg
            const hip = BABYLON.MeshBuilder.CreateSphere(n + '_hip', {
                diameter: 0.17,
                segments: 8,
            }, scene);
            hip.parent = mesh;
            hip.position.set(0, seg.h * 0.5, 0);
            const hipMat = makePBR(n + '_hip_mat', scene);
            hipMat.diffuseColor  = new BABYLON.Color3(0.10, 0.10, 0.10);
            hipMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            hipMat.specularPower = 35;
            hip.material = hipMat;
        }

        if (n === 'lowerLegL' || n === 'lowerLegR') {
            // Knee sphere — fills gap between upper and lower leg
            const knee = BABYLON.MeshBuilder.CreateSphere(n + '_knee', {
                diameter: 0.13,
                segments: 8,
            }, scene);
            knee.parent = mesh;
            knee.position.set(0, seg.h * 0.5, 0);
            const knMat = makePBR(n + '_knee_mat', scene);
            knMat.diffuseColor  = new BABYLON.Color3(0.10, 0.10, 0.10);
            knMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
            knMat.specularPower = 35;
            knee.material = knMat;

            // Ski boot — two-piece: lower shell + upper cuff
            // Lower shell (hard outer sole/toe box)
            const bootLower = BABYLON.MeshBuilder.CreateBox(n + '_bootLower', {
                width:  seg.w * 1.55,
                height: seg.h * 0.22,
                depth:  seg.d * 1.55,
            }, scene);
            bootLower.parent = mesh;
            bootLower.position.set(0, -seg.h * 0.42, seg.d * 0.12);
            const blMat = makePBR(n + '_bootLower_mat', scene);
            blMat.diffuseColor  = new BABYLON.Color3(0.12, 0.10, 0.09);
            blMat.specularColor = new BABYLON.Color3(0.55, 0.50, 0.45);
            blMat.specularPower = 60;
            bootLower.material = blMat;

            // Upper cuff (tall plastic shell wrapping the shin)
            const bootCuff = BABYLON.MeshBuilder.CreateCylinder(n + '_bootCuff', {
                diameterTop:    seg.w * 1.35,
                diameterBottom: seg.w * 1.55,
                height:         seg.h * 0.38,
                tessellation:   14,
            }, scene);
            bootCuff.parent = mesh;
            bootCuff.position.set(0, -seg.h * 0.22, 0);
            const bcMat = makePBR(n + '_bootCuff_mat', scene);
            bcMat.diffuseColor  = new BABYLON.Color3(0.58, 0.08, 0.06);
            bcMat.specularColor = new BABYLON.Color3(0.55, 0.30, 0.28);
            bcMat.specularPower = 45;
            bootCuff.material = bcMat;

            // Buckle strip — thin black band across the cuff
            const buckle = BABYLON.MeshBuilder.CreateBox(n + '_buckle', {
                width:  seg.w * 1.65,
                height: seg.h * 0.04,
                depth:  seg.d * 0.05,
            }, scene);
            buckle.parent = mesh;
            buckle.position.set(0, -seg.h * 0.16, -seg.d * 0.70);
            const buMat = makePBR(n + '_buckle_mat', scene);
            buMat.diffuseColor  = new BABYLON.Color3(0.80, 0.78, 0.72);
            buMat.specularColor = new BABYLON.Color3(0.90, 0.88, 0.82);
            buMat.specularPower = 90;
            buckle.material = buMat;
        }
    }

    return { root, meshes };
}

// Arc-based arm drop: arm rotates in the sagittal (Y-Z) plane around the shoulder
// joint, sweeping straight forward in front of the body and then down.
// Character faces -Z, so forward = negative dz.
// t = 0: arm raised straight up.  t = 1: arm hanging straight down.
// armSweep now comes from the shared engine core (engine/core/pose.js).
const { armSweep } = AerialEngine.pose;

// ── Pose applicator ────────────────────────────────────────────────────────
// tuck:       0 = fully extended, 1 = fully tucked
// armDropL:   0 = left arm raised, 1 = left arm dropped to side
// armDropR:   0 = right arm raised, 1 = right arm dropped to side
// armSnap:    0-1, blends arms toward POSE_ARMS_50DEG (overrides armDrop for arm segments)
// layArmT:    0-1, blends arms toward T-pose (layout)
// armRaise:   0-1, blends arms toward raised-overhead pose
// grounded:   true → use POSE_INRUN_TUCK, false → use POSE_TUCKED
// pikeAmount: 0-1, blends toward POSE_PIKED
// pikeArmDrop:0-1, drops arms during pike release
function applyPose(meshes, tuck, armDropL, armDropR, armSnap, layArmT, armRaise, grounded, pikeAmount, pikeArmDrop) {
    pikeAmount  = pikeAmount  || 0;
    pikeArmDrop = pikeArmDrop || 0;

    // ── Solve, then apply ──────────────────────────────────────────────────
    // The pose maths lives in the shared engine core (engine/core/pose.js) and
    // is pure: it returns transforms and touches nothing. This function keeps
    // only the RENDERING half — writing those transforms onto meshes, plus the
    // IK fix-up and glove placement below, which are display concerns that read
    // mesh state. See ADR-0002.
    const solved = AerialEngine.pose.computePose({
        tuck, armDropL, armDropR, armSnap, layArmT, armRaise,
        grounded, pikeAmount, pikeArmDrop,
    });

    for (const seg of SEGMENTS) {
        const mesh = meshes[seg.name];
        const p    = solved[seg.name];
        if (!mesh || !p) continue;
        mesh.position.x = p.x;
        mesh.position.y = p.y;
        mesh.position.z = p.z;
        mesh.rotation.x = p.rx;
        mesh.rotation.z = p.rz;
    }

    // ── Kinematic knee fix for pike ────────────────────────────────────────
    // Independent lerping of each segment's position breaks joint continuity
    // at intermediate pikeAmount values. Repin lower legs and skis to the
    // upper legs so the knee joint is always connected.
    if (pikeAmount > 0) {
        for (const side of ['L', 'R']) {
            const ulMesh = meshes['upperLeg' + side];
            const llMesh = meshes['lowerLeg' + side];
            const skMesh = meshes['ski' + side];
            const rx     = ulMesh.rotation.x;
            const cosRx  = Math.cos(rx);
            const sinRx  = Math.sin(rx);
            // Knee = local -Y end of upper leg
            const kneeY  = ulMesh.position.y - 0.18 * cosRx;
            const kneeZ  = ulMesh.position.z - 0.18 * sinRx;
            // Lower leg center: align its local +Y end (top) to the knee
            llMesh.position.y = kneeY - 0.18 * cosRx;
            llMesh.position.z = kneeZ - 0.18 * sinRx;
            // Ski center: align its local +Y end (top) to the ankle
            const ankleY = llMesh.position.y - 0.18 * cosRx;
            const ankleZ = llMesh.position.z - 0.18 * sinRx;
            skMesh.position.y = ankleY - 0.015 * cosRx;
            skMesh.position.z = ankleZ - 0.015 * sinRx;
        }
    }

    // ── Reposition gloves to always sit at the wrist ───────────────────────
    // With the arc-based arm drop the local +Y axis always points along the arm
    // toward the wrist end, so the glove stays fixed at +halfH during any drop.
    // Only during tuck (arm folds forward with rx≠0) do we slide it toward the
    // elbow so it doesn't poke through the knees.
    if (meshes.gloveL) {
        meshes.gloveL.mesh.position.y = lerp(meshes.gloveL.halfH, -meshes.gloveL.halfH, tuck);
    }
    if (meshes.gloveR) {
        meshes.gloveR.mesh.position.y = lerp(meshes.gloveR.halfH, -meshes.gloveR.halfH, tuck);
    }
}

// ── Gamepad lateral arm correction ─────────────────────────────────────────
// Repositions arm segments so both upper and lower arm pivot around the
// shoulder joint rather than rotating in place.
//
// BabylonJS applies Euler rotations in YXZ intrinsic order, so for ry=0 the
// combined matrix is M = M_x(rx) * M_z(rz).  The arm's local +Y direction in
// parent space is therefore:
//   M * (0,1,0) = M_x(-phi) * M_z(rzOff) * (0,1,0)
//              = M_x(-phi) * (-sin(rzOff), cos(rzOff), 0)
//              = (-sin(rzOff),  cos(rzOff)*cos(phi),  -cos(rzOff)*sin(phi))
//
// Both segments use the same dir so elbow = shoulder_pivot + 0.300*dir for both,
// guaranteeing a gap-free joint at every arm angle and lateral position.
function applyGamepadLateral(meshes, lx, rx, armDropL, armDropR) {
    const MAX_LAT = Math.PI / 2;
    const Y_PIVOT = 0.150;
    const sides = [
        { upper: 'upperArmL', lower: 'lowerArmL', xPivot: -0.175, stickX: lx, drop: armDropL },
        { upper: 'upperArmR', lower: 'lowerArmR', xPivot:  0.175, stickX: rx, drop: armDropR },
    ];
    for (const s of sides) {
        const phi    = Math.PI * s.drop;
        const rzOff  = s.stickX * MAX_LAT;
        const uMesh  = meshes[s.upper];
        const lMesh  = meshes[s.lower];
        if (!uMesh || !lMesh) continue;

        const sinR   = Math.sin(rzOff), cosR   = Math.cos(rzOff);
        const cosPhi = Math.cos(phi),   sinPhi = Math.sin(phi);

        // M_x(-phi) * M_z(rzOff) * (0,1,0)
        const dirX = -sinR;
        const dirY =  cosR * cosPhi;
        const dirZ = -cosR * sinPhi;

        const zBase = BASE_Z[s.upper] || 0;

        uMesh.position.x = s.xPivot + dirX * 0.150;
        uMesh.position.y = Y_PIVOT  + dirY * 0.150;
        uMesh.position.z = zBase    + dirZ * 0.150;
        uMesh.rotation.x = -phi;
        uMesh.rotation.z = rzOff;

        lMesh.position.x = s.xPivot + dirX * 0.425;
        lMesh.position.y = Y_PIVOT  + dirY * 0.425;
        lMesh.position.z = zBase    + dirZ * 0.425;
        lMesh.rotation.x = -phi;
        lMesh.rotation.z = rzOff;
    }
}

// ── HUD builder ────────────────────────────────────────────────────────────
function buildHUD(scene) {
    const ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI', true, scene);

    const hud = new BABYLON.GUI.TextBlock('hud');
    hud.color       = '#b8d8ff';
    hud.fontSize    = 15;
    hud.fontFamily  = 'monospace';
    hud.horizontalAlignment     = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.verticalAlignment       = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hud.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    hud.paddingLeft  = '14px';
    hud.paddingTop   = '14px';
    hud.resizeToFit = true;
    ui.addControl(hud);

    const hint = new BABYLON.GUI.TextBlock('hint');
    hint.color      = '#445566';
    hint.fontSize   = 13;
    hint.fontFamily = 'monospace';
    hint.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hint.horizontalAlignment     = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    hint.verticalAlignment       = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    hint.paddingRight = '14px';
    hint.paddingTop   = '14px';
    hint.text       = '';
    hint.isVisible  = false;
    hint.resizeToFit = true;
    ui.addControl(hint);

    return { hud, hint };
}

// ── Terrain ───────────────────────────────────────────────────────────────────
// Character moves in the +Z direction. Camera views from -X side (right-to-left = downhill).
const FOOT_OFFSET   = 1.025;
const SLOPE_ANGLE   = 22 * Math.PI / 180;
const LANDING_ANGLE = 40 * Math.PI / 180;
const LANDING_DROP  = 3.5; // extra vertical drop of landing zone
const KICKER_Z      = 22;
const KICKER_END_Z  = 23.7;  // horizontal kicker depth 1.7 m → realistic lip heights (12–15 ft)
const _worldParam   = new URLSearchParams(location.search).get('world') || 'double';
// Lip angle at the top of the kicker — steeper on bigger hills (affects physics + visuals).
// Single 65°, Double 68°, Triple 70°, Quad 72°, Quint 74°. Custom defaults to 65°.
const KICKER_ANGLE  = ({ single:65, double:68, triple:70, quad:72, quint:74 }[_worldParam] || 65) * Math.PI / 180;
const _compParam    = new URLSearchParams(location.search).get('comp');  // null | 'easy' | 'medium' | 'hard' | 'ultra'
const _olympicsMode = new URLSearchParams(location.search).get('olympics'); // null | 'qual' | 'finals'
const _realisticMode = new URLSearchParams(location.search).get('mode') === 'realistic';
const _ultraJump    = _compParam === 'ultra' ? Math.max(0, parseInt(new URLSearchParams(location.search).get('ultrajump') || '0', 10)) : 0;
const _customInrun    = _worldParam === 'custom' ? Math.max(4, Math.min(100, parseFloat(new URLSearchParams(location.search).get('inrun')    || '11'))) : 0;
const _customLanding  = _worldParam === 'custom' ? Math.max(20, Math.min(150, parseFloat(new URLSearchParams(location.search).get('landing')  || '50'))) : 0;
const _customFlipSpeed = _worldParam === 'custom' ? Math.max(0.3, Math.min(3.0, parseFloat(new URLSearchParams(location.search).get('flipspeed') || '1.3'))) : 1.0;
const _trampolineMode       = _worldParam === 'trampoline';
const _trampolineMatMode    = _worldParam === 'trampoline_mat';
const _poolDiveMode         = _worldParam === 'pool';
const TRAMPOLINE_Y          = 0.0;   // world Y of the trampoline surface
const TRAMPOLINE_LAUNCH_VY  = 14.0;  // vertical velocity given on each bounce
// ── Trampoline-mat world constants ──────────────────────────────────────────
const MAT_TRAM_START_Z      =  2.0;  // trampoline start Z
const MAT_TRAM_END_Z        = 13.0;  // trampoline end Z
const MAT_TRAM_CENTER_Z     =  7.5;  // trampoline center Z
const MAT_LAND_START_Z      = 16.0;  // landing mat start Z
const MAT_LAND_END_Z        = 26.0;  // landing mat end Z
const MAT_LAND_CENTER_Z     = 21.0;  // landing mat center Z
const MAT_BOUNCE1_VY        =  6.5;  // warmup bounce 1 launch speed
const MAT_BOUNCE2_VY        = 10.0;  // warmup bounce 2 launch speed
const MAT_BOUNCE3_VY        = 15.5;  // final launch speed (double frontflip)
const MAT_BOUNCE1_VZ        =  2.5;  // forward speed after bounce 1
const MAT_BOUNCE2_VZ        =  3.0;  // forward speed after bounce 2
const MAT_BOUNCE3_VZ        =  4.0;  // forward speed for mat flight
const MAT_TRAM_SPRING_K     = 110;   // trampoline spring stiffness
const MAT_TRAM_SPRING_D     =   5;   // trampoline spring damping
const MAT_LAND_SPRING_K     =  18;   // landing mat spring stiffness (soft foam)
const MAT_LAND_SPRING_D     =  14;   // landing mat spring damping (overdamped)
const LANDING_START_Z = _worldParam === 'custom' ? KICKER_END_Z + 3.5 : KICKER_END_Z + ({ single: 2, double: 5, triple: 8, quad: 13, quint: 15 }[_worldParam] || 5); // knuckle positioned so skier lands ~1-2m past it
const OUTRUN_Z      = _worldParam === 'custom' ? KICKER_END_Z + _customLanding : LANDING_START_Z + ({ single: 25, double: 35, triple: 42, quad: 50, quint: 60 }[_worldParam] || 35); // landing slope ends here
const FLAT_Z        = KICKER_Z - 16.0; // flat table starts here (16 m before kicker lip → 10 m flat table)
const KICKER_START_Z = FLAT_Z + 10.0;  // kicker curve begins here — 10 m flat table, then gradual arc
const TRANS_LEN     = 3.0;             // transition extends this far before AND after FLAT_Z
const TRANS_START_Z = FLAT_Z - TRANS_LEN; // inrun ends here
const TRANS_END_Z   = FLAT_Z + TRANS_LEN; // flat table begins here
const LANDING_TRANS_LEN = 4.0;         // knuckle-blend dense-sampling zone (iter-13: the fillet's own footprint is smaller; the zone just brackets it)
const SLOPE_START_Z = _worldParam === 'custom' ? -_customInrun : _worldParam === 'quint' ? -51.0 : _worldParam === 'quad' ? -41.8 : _worldParam === 'triple' ? -27.8 : _worldParam === 'single' ? -12.3 : -19.3;

// ── Kicker bezier control points (computed once at load) ─────────────────────
// P0 and P1 share the same y (tableY) → zero entry tangent → curve NEVER dips below table.
// P2 is pulled back along the lip direction with a short handle → arrives at KICKER_ANGLE.
// The bezier convex-hull property guarantees monotone, dip-free height the entire way.
const _KBP_tY = -FLAT_Z * Math.tan(SLOPE_ANGLE);                            // table height
const _KBP_lY = _KBP_tY + (KICKER_END_Z - KICKER_Z) * Math.tan(KICKER_ANGLE); // lip height
const _KBP_h  = KICKER_END_Z - KICKER_START_Z;                              // total span
// Transition bezier: leaves at slope angle, arrives flat at TRANS_END_Z
const _tBP = [
    [TRANS_START_Z,              -(TRANS_START_Z)              * Math.tan(SLOPE_ANGLE)],  // P0 on slope
    [TRANS_START_Z + TRANS_LEN,  -(TRANS_START_Z + TRANS_LEN)  * Math.tan(SLOPE_ANGLE)],  // P1 on slope (handle = 1/2 total span)
    [TRANS_END_Z   - TRANS_LEN,  -(FLAT_Z)                     * Math.tan(SLOPE_ANGLE)],  // P2 at tableY (handle = 1/2 total span)
    [TRANS_END_Z,                -(FLAT_Z)                     * Math.tan(SLOPE_ANGLE)],  // P3 flat table
];

const _kBP    = [
    [KICKER_START_Z,                                                                  _KBP_tY],  // P0
    [KICKER_START_Z + _KBP_h * 0.85,                                                 _KBP_tY],  // P1 — flat tangent, long handle → brief gradual rise, then steepens quickly
    [KICKER_END_Z - _KBP_h * 0.18 * Math.cos(KICKER_ANGLE),  _KBP_lY - _KBP_h * 0.18 * Math.sin(KICKER_ANGLE)], // P2
    [KICKER_END_Z,                                                                    _KBP_lY],  // P3
];

// ── C1 landing-profile blends (APPROVED: C1-smooth run profile) ──────────────
// Iteration-11 built both joins as endpoint-pinned cubic beziers; with the end
// slopes pinned the interior slope necessarily peaks ≥ 1.5× the secant — the
// measured −49.8°/−45.9° and a 53.7 cm bulge the reviewer rejected. Both joins
// are now TANGENT FILLET CIRCLES (one circle per corner, tangent to both lines):
// cannot overshoot, slope strictly inside [min(a,b), max(a,b)], monotone,
// inside the air wedge. Levels are byte-preserved everywhere outside each arc;
// each blend "spends" a footprint R·tan(LANDING_ANGLE/2) on its two lines.
// Radii: knuckle R=1.0 m — a crisp cut like the footage's knoll edge (peak
// deviation vs the old crease ≈ +7 cm above / −7 cm into it); roll-out R=14 m —
// compression arc ≈ 9.8 m, in the author's requested 8–12 m band.
// Descriptors consumed by engine/disciplines/aerial-ski.js landKnuckleArcY /
// landRollOutArcY.
const _landM    = Math.tan(LANDING_ANGLE);
const _landHalfT = Math.tan(LANDING_ANGLE / 2);
const R_KNUCKLE = 1.0;
const R_ROLL_OUT = 14.0;
// Knuckle fillet: corner (LSZ, tableY), flat enters along +z, exits down the
// landing line; centre directly below the flat tangency point.
const _ltArc = {
    R:   R_KNUCKLE,
    cx:  LANDING_START_Z - R_KNUCKLE * _landHalfT,
    cy:  _KBP_tY - R_KNUCKLE,
    T1z: LANDING_START_Z - R_KNUCKLE * _landHalfT,
    T2z: LANDING_START_Z + R_KNUCKLE * _landHalfT * Math.cos(LANDING_ANGLE),
};
// Roll-out fillet: corner (OUTRUN_Z, yFlat), landing line enters from up-slope,
// flat outrun resumes past the far tangency at the SAME level as before.
const OUTRUN_TRANS_LEN = 10.5;         // roll-out-blend dense-sampling zone (iter-13: the R=14 fillet spans ~10.2 m; kept as the zone extent)
const _rollOutCornerY = _KBP_tY - (OUTRUN_Z - LANDING_START_Z) * _landM;
const _loArc = {
    R:   R_ROLL_OUT,
    cx:  OUTRUN_Z + R_ROLL_OUT * _landHalfT,
    cy:  _rollOutCornerY + R_ROLL_OUT,
    T1z: OUTRUN_Z - R_ROLL_OUT * _landHalfT * Math.cos(LANDING_ANGLE),
    T2z: OUTRUN_Z + R_ROLL_OUT * _landHalfT,
};

// ── Terrain config for the shared discipline module ────────────────────────
// engine/disciplines/aerial-ski.js takes geometry as CONFIG rather than reading
// globals, because these values are derived from URL params at runtime
// (SLOPE_START_Z alone has six values depending on ?world=). See ADR-0003.
const _terrainCfg = {
    mode: _trampolineMode ? 'trampoline'
        : _trampolineMatMode ? 'trampolineMat'
        : _poolDiveMode ? 'pool' : 'ski',
    SLOPE_ANGLE, SLOPE_START_Z, FLAT_Z, TRANS_START_Z, TRANS_END_Z,
    KICKER_START_Z, KICKER_END_Z, LANDING_START_Z, OUTRUN_Z, LANDING_ANGLE,
    LANDING_TRANS_LEN, OUTRUN_TRANS_LEN, ltArc: _ltArc, loArc: _loArc,
    MAT_LAND_START_Z, MAT_LAND_END_Z, TRAMPOLINE_Y,
    tBP: _tBP, kBP: _kBP,
};

// Per-world physics tuning comes from the discipline module; game.js only
// supplies the already-parsed URL parameters (ADR-0003).
const _physicsCfg = AerialEngine.aerialSki.makePhysicsConfig({
    world: _worldParam,
    customFlipSpeed: _customFlipSpeed,
});

const terrainRootY  = (z) => AerialEngine.aerialSki.terrainRootY(z, _terrainCfg);
const terrainAccelZ = (z) => AerialEngine.aerialSki.terrainAccelZ(z, _terrainCfg);
// Probe access for tests/drive/terrain-corridor.spec.js (and any future surface
// checks); plain data, no behaviour attached.
window._terrainCfg = _terrainCfg;
// Binary-search for bezier parameter t where bz(t)≈z, return by(t).



// ── Entry point ────────────────────────────────────────────────────────────
// Works whether DOM is still loading (normal sync case) or already ready
// (dynamic load case — CDN retry fires after DOMContentLoaded has passed).
function _startGame() {
    const canvas = document.getElementById('renderCanvas');
    // Detect WebGL support before starting — shows a clear error on old/unsupported hardware
    if (!BABYLON.Engine.isSupported()) {
        canvas.style.display = 'none';
        document.body.insertAdjacentHTML('beforeend', '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;font-family:sans-serif;color:#b8d8ff;text-align:center;padding:20px"><div><div style="font-size:48px;margin-bottom:20px">⛷</div><h2 style="color:#fff;margin-bottom:12px">WebGL not available</h2><p style="color:#778899;max-width:400px;line-height:1.6">This game needs WebGL (hardware-accelerated graphics).<br><br>Please try:<br>• Enabling hardware acceleration in your browser settings<br>• Updating your graphics drivers<br>• Using <strong style="color:#b8d8ff">Chrome</strong> or <strong style="color:#b8d8ff">Firefox</strong></p></div></div>');
        return;
    }
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false });

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = _trampolineMode
        ? new BABYLON.Color4(0.88, 0.87, 0.84, 1)  // gym interior
        : _poolDiveMode
        ? new BABYLON.Color4(0.42, 0.68, 0.92, 1)  // outdoor pool sky
        : new BABYLON.Color4(0.53, 0.81, 0.98, 1);  // ski sky blue

    // ── Orbiting orthographic camera ─────────────────────────────────────────
    // ArcRotateCamera orbits the origin on left-click drag / touch drag.
    // Orthographic mode keeps the character the same size at all angles.
    const camera = new BABYLON.ArcRotateCamera('cam',
        Math.PI,        // alpha: camera on the -X side — side view of slope
        Math.PI / 2,    // beta:  horizon level
        10,             // radius
        BABYLON.Vector3.Zero(), scene);

    camera.attachControl(canvas, true);
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.inertia          = 0;             // no drift after mouse release
    camera.lowerBetaLimit   = 0.05;          // prevent flipping under the scene
    camera.upperBetaLimit   = Math.PI - 0.05;
    camera.lowerRadiusLimit = 10;            // lock zoom — meaningless in ortho
    camera.upperRadiusLimit = 10;
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

    // NOTE: this orthographic assignment is OVERRIDDEN later — game.js:2510 sets
    // PERSPECTIVE_CAMERA with fov 0.9 unconditionally during setup, so the game
    // has always rendered in perspective despite what this line says. Left as-is
    // rather than "tidied", because removing it is a behaviour question for the
    // author, not a refactor.
    function setOrtho(halfH = 3.0) {
        const w = engine.getRenderWidth();
        const h = engine.getRenderHeight();
        camera.orthoTop    =  halfH;
        camera.orthoBottom = -halfH;
        camera.orthoLeft   = -halfH * (w / h);
        camera.orthoRight  =  halfH * (w / h);
    }
    setOrtho();
    window.addEventListener('resize', () => { engine.resize(); setOrtho(3.0); });

    // ── Lighting ─────────────────────────────────────────────────────────────
    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.4, 1, -0.8), scene);
    hemi.intensity   = 0.42; // IBL supplies part of the fill (see environmentTexture);
                         // this split re-tuned in iter 17 (kicker faces, below)
    // Sky fill is COOL (blue dome) — and the ground term is a bright snow
    // bounce, not a dark cave floor. A snowfield's vertical faces (the kicker
    // block's side/back walls) receive almost none of the hemi SKY term
    // (dot(n, up) clamps to 0) and no direct sun, so their look used to be
    // dominated by the IBL horizon band — which is warm: the block rendered
    // plywood-tan instead of shaded white snow (iter-17 probe: face r−b ≈
    // +0.03 warm; with this rig b−r ≈ −0.02 cool, luminance inside the snow
    // band). A real snowfield bounces ~albedo-0.9 light onto verticals from
    // every side; groundColor is that bounce.
    hemi.diffuse     = new BABYLON.Color3(0.85, 0.92, 1.0);
    hemi.groundColor = new BABYLON.Color3(0.40, 0.46, 0.55);

    // Directional sun light — afternoon angle from upper-left-back.
    // NOTE (iter 39, P2): a 32° elevation (the plan's footage number) was tried
    // here with intensity compensated (×1.33, sin-scaling) — the sky and the
    // disc read it fine, but the hemi+IBL indirect (~0.71 sRGB measured) so
    // dominates underneath that the athlete shadow drop collapsed 0.80 → 0.05
    // (gates 0.15/0.20) and the in-run grey-ramp band missed by 0.0006. The
    // elevation move is therefore coupled to a full sun/indirect/exposure
    // rebalance (P12-quality retune) — deferred with numbers in the progress
    // entry. The dome reads THIS light's direction for the disc.
    const sunLight = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(0.35, -1, 0.45), scene);
    sunLight.position  = new BABYLON.Vector3(-30, 60, -40);
    sunLight.intensity = 0.82;
    sunLight.diffuse   = new BABYLON.Color3(1.0, 0.96, 0.85); // warm afternoon tint
    sunLight.specular  = new BABYLON.Color3(1.0, 0.96, 0.85);

    // Shadow generator — cascaded shadow maps for the sun (P2).
    //
    // A single 2048 map auto-fits its ortho frustum around EVERY caster. With the
    // trees and the whole run in that list it stretched over hundreds of metres
    // (~20 cm per texel), so the athlete's shadow dissolved into mush while tree
    // shadows flickered with the bias. The cascades follow the camera instead:
    // a couple of metres per texel near the figure, coarser further out, and
    // anything past shadowMaxZ drops out of the depth pass entirely.
    let shadowGen = null;
    try {
        const CSM = BABYLON.CascadedShadowGenerator || BABYLON.ShadowGenerator;
        shadowGen = new CSM(2048, sunLight);
        if (shadowGen.numCascades !== undefined) {
            // CSM branch — tuning per docs/RENDER-PLAN.md P2.
            shadowGen.numCascades         = 3;
            shadowGen.lambda              = 0.8;
            shadowGen.stabilizeCascades   = true;
            shadowGen.shadowMaxZ          = 200;   // beyond this the bake handles statics
            try { shadowGen.autoCalcDepthBounds = true; } catch (e) { /* keep manual bounds */ }
            if (BABYLON.ShadowGenerator && BABYLON.ShadowGenerator.QUALITY_MEDIUM !== undefined) {
                shadowGen.usePercentageCloserFiltering = true;
                shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
            }
            shadowGen.bias = 0.0002;               // tuned per cascade at render time
        } else {
            shadowGen.usePoissonSampling = true;   // legacy fallback, pre-CSM behaviour
            shadowGen.bias = 0.0002;
        }
    } catch(e) { shadowGen = null; }

    // ── Atmospheric fog — makes distant terrain fade into the sky ──────────────
    // P2: clear-air density (was 0.005); the colour is the sky dome's horizon
    // colour exactly, so fogged terrain blends seamlessly into the dome.
    if (!_trampolineMode) {
        scene.fogMode    = BABYLON.Scene.FOGMODE_EXP2;
        scene.fogDensity = _poolDiveMode ? 0.003 : 0.0022;  // clear air (P2); was 0.005
        scene.fogColor   = _poolDiveMode
            ? new BABYLON.Color3(0.50, 0.72, 0.95)
            : new BABYLON.Color3(0.62, 0.76, 0.92);  // = skyShader horizonColor
    }

    // ── P2 sky: procedural gradient dome + cumulus layer + sun disc/glare ──────
    // Ski mode only (pool/trampoline keep their backdrops). Guarded on
    // ShaderMaterial so the golden harness's inert stub — which deliberately
    // lacks it — skips the whole block: the dome is display-only and must not
    // enter the traces (see tests/golden/stub-extend.js design rule).
    if (!_trampolineMode && !_poolDiveMode &&
        BABYLON.ShaderMaterial && BABYLON.Effect && BABYLON.Effect.ShadersStore &&
        BABYLON.MeshBuilder) {
        BABYLON.Effect.ShadersStore.skyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
    vDir = position;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
        BABYLON.Effect.ShadersStore.skyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
float _hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float _noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = _hash(i);
    float b = _hash(i + vec2(1.0, 0.0));
    float c = _hash(i + vec2(0.0, 1.0));
    float d = _hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float _fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 5; k++) {
        v += a * _noise(p);
        p = p * 2.03 + vec2(19.7, 7.3);
        a *= 0.5;
    }
    return v;
}
void main(void) {
    vec3 dir = normalize(vDir);
    float y = clamp(dir.y, 0.0, 1.0);
    // Deep blue zenith into a pale horizon; the pow curve keeps the zenith
    // saturated and the horizon band wide, like the footage's clear sky.
    vec3 col = mix(zenithColor, horizonColor, pow(1.0 - y, 2.4));
    // Cumulus: value-noise fbm projected on a plane above the camera, thinning
    // into the horizon haze. Static (no time term) so shots and luminance
    // gates stay deterministic.
    if (dir.y > 0.015) {
        vec2 uv = dir.xz / (dir.y + 0.10);
        float f = _fbm(uv * 1.35 + vec2(13.1, 7.7));
        float cov = smoothstep(0.52, 0.66, f);
        float fade = smoothstep(0.02, 0.16, dir.y);
        float dens = cov * fade;
        // Lit tops near-white, dense centres shaded blue-grey.
        vec3 cloudCol = mix(vec3(1.02, 1.04, 1.08), vec3(0.74, 0.80, 0.90),
                            smoothstep(0.35, 0.75, f) * 0.55);
        col = mix(col, cloudCol, dens * 0.92);
    }
    // Sun disc + glare at the directional light's own direction. Values above
    // 1.0 ride the HDR/ACES roll-off into white and feed the bloom pass.
    float d = max(dot(dir, sunDir), 0.0);
    float disc = smoothstep(0.99988, 0.99996, d);
    float halo = pow(d, 700.0) * 0.9 + pow(d, 90.0) * 0.30 + pow(d, 12.0) * 0.10;
    col += vec3(1.30, 1.24, 1.10) * (disc * 2.2 + halo);
    gl_FragColor = vec4(col, 1.0);
}`;
        try {
            const skyMat = new BABYLON.ShaderMaterial('skyShader', scene,
                { vertex: 'sky', fragment: 'sky' },
                { attributes: ['position'],
                  uniforms: ['worldViewProjection', 'sunDir', 'zenithColor', 'horizonColor'] });
            // The disc sits where the light COMES FROM (opposite its travel).
            const sd = sunLight.direction.clone().normalize().scale(-1);
            skyMat.setVector3('sunDir', sd);
            skyMat.setColor3('zenithColor', new BABYLON.Color3(0.07, 0.20, 0.55));
            skyMat.setColor3('horizonColor', new BABYLON.Color3(0.62, 0.76, 0.92));
            skyMat.backFaceCulling = false;
            const sky = BABYLON.MeshBuilder.CreateSphere('skyDome',
                { diameter: 4000, segments: 12, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
            sky.material = skyMat;
            sky.infiniteDistance = true;   // rides the camera, never clips
            sky.isPickable = false;
            sky.applyFog = false;
        } catch (e) { /* no shader sky — flat clearColor remains */ }
    }

    // ── Image-based lighting ────────────────────────────────────────────────
    // Without this there is nothing in the scene for a PBR surface to reflect,
    // and PBR materials fall back to looking flat and plasticky. Snow in
    // particular is largely SKY LIGHT — it reads as snow because it reflects a
    // bright hemisphere, not because it is white.
    //
    // Loaded from a local .env (prefiltered mip chain), so no network at runtime.
    try {
        scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(
            'assets/environment.env', scene);
        // Tuned against the existing hemi+sun rig rather than replacing it: the
        // directional sun still casts the shadows, IBL supplies part of the
        // ambient fill. Iter 17: 0.45 → 0.32 — the env's horizon band is warm
        // and it is the ONLY light vertical faces were getting (hemi's sky term
        // zeroes on horizontal normals), which painted the kicker block's
        // side/back walls plywood-tan. The cool hemi rig above now carries the
        // vertical fill; measured A/B in tests/drive + RENDER-PROGRESS entry 17.
        scene.environmentIntensity = 0.32;
    } catch (e) {
        scene.environmentTexture = null;   // renderer still works, just flatter
    }

    // Asset cache-busting. The scripts in index.html carry ?v=; the binary
    // assets did not, so a rebuilt athlete or a re-baked map kept rendering from
    // the browser cache and every change looked like it had not been applied.
    // Bump this whenever assets/ is regenerated.
    const ASSET_V = '?v=14';

    // ── Baked lighting for the static scenery ───────────────────────────────
    // Blender bakes the two terms this renderer cannot compute, and BOTH are
    // multipliers — which is the property that makes them safe. An additive
    // baked term double-counts light the runtime already renders (that is what
    // washed the scene out the first time a bake was wired in); a multiplier
    // can only ever scale down something that is already there.
    //
    //   terrain_skyvis.png   how much of the sky each point can actually see.
    //                        The image-based ambient is otherwise applied at full
    //                        strength everywhere, as though the whole sky dome
    //                        were visible from every point — so snow tucked under
    //                        a tree or inside the kicker's transition is lit
    //                        exactly like snow in the open. -> ambientTexture
    //
    //   terrain_shadow.png   what fraction of the sun reaches each point, path
    //                        traced with a real sun angle. -> lightmapTexture with
    //                        useLightmapAsShadowmap, which MULTIPLIES the direct
    //                        light rather than adding to it.
    //
    // Both need uv2, which the procedural terrain has none of. It comes from
    // assets/terrain_uv2.json, written by the bake IN THIS GAME'S VERTEX ORDER —
    // the glb cannot supply it, because the glTF exporter splits vertices at UV
    // seams and the order stops matching. So the meshes, materials, parents and
    // physics are all left exactly as they are and only a uv2 buffer is added.
    //
    // Materials are shared between terrain meshes, so the textures are assigned
    // once per material while uv2 is assigned per mesh.
    window._bakedApplied = 0;

    // TEMPORARY OFF SWITCH (iteration 13, reviewer order 1 of 23:50): the maps on
    // disk were baked for the PRE-P1 slab terrain. The corridor ribbon replaced
    // those meshes, so every atlas sample taken on wInrun's newly-exposed top face
    // reads a stale zero multiplier — a full-width black band across the ready
    // view (measured: black coverage 9.29% of frame; 0.09% with these clones
    // stripped). Until the rebake lands (blocked on the post-unwrap vertex-split
    // fixup across the uv2 sidecar contract — see RENDER-PROGRESS entries 12/13),
    // the statics render on their plain snow/ls materials. FLIP TO true WITH THE
    // REBAKE COMMIT; baked.spec.js asserts the off-state meanwhile.
    window._bakeLightmapEnabled = false;
    (function applyBakedLighting() {
        if (!window._bakeLightmapEnabled) return;
        try {
            fetch('assets/terrain_uv2.json' + ASSET_V)
                .then(r => r.ok ? r.json() : null)
                .then(function (data) {
                    if (!data || !data.meshes) { window._bakedApplied = 0; return; }

                    // gammaSpace = false on both: these are DATA, not colour. An
                    // sRGB decode would bend every value and quietly change the
                    // shape of the occlusion.
                    const mk = (url) => {
                        const t = new BABYLON.Texture(url, scene);
                        t.gammaSpace = false;
                        t.coordinatesIndex = data.coordinatesIndex || 1;
                        t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
                        return t;
                    };
                    const skyvis = mk((data.skyVisibility || 'assets/terrain_skyvis.png') + ASSET_V);
                    const shadow = mk((data.sunShadow || 'assets/terrain_shadow.png') + ASSET_V);

                    // The baked material is a CLONE, and that is not an
                    // optimisation detail — it is required for correctness.
                    // snowMat is shared by 71 meshes while only 28 are in the
                    // atlas; putting the maps on the shared material would leave
                    // the other 43 sampling uv2 (0, 0), because a mesh with no uv2
                    // buffer feeds the shader zeros rather than being skipped.
                    // Whatever happens to sit in that corner of the atlas would
                    // then be applied as the sky visibility and sun shadow of the
                    // background peaks. Cloning keeps the maps on exactly the
                    // meshes the bake covers.
                    const baked = new Map();
                    const bakedMaterial = (mat) => {
                        if (!mat) return null;
                        if (baked.has(mat.uniqueId)) return baked.get(mat.uniqueId);
                        const clone = mat.clone(mat.name + '_baked') || mat;
                        clone.ambientTexture = skyvis;
                        clone.lightmapTexture = shadow;
                        clone.useLightmapAsShadowmap = true;
                        baked.set(mat.uniqueId, clone);
                        return clone;
                    };

                    let applied = 0;
                    for (const name of Object.keys(data.meshes)) {
                        const mesh = scene.getMeshByName(name);
                        if (!mesh || !mesh.getTotalVertices()) continue;

                        const uv2 = data.meshes[name];
                        // A length mismatch means the terrain generator changed
                        // since the bake. Applying it anyway would smear the atlas
                        // across the wrong triangles, so skip and let the count
                        // report the shortfall.
                        if (uv2.length !== mesh.getTotalVertices() * 2) continue;
                        mesh.setVerticesData(BABYLON.VertexBuffer.UV2Kind, uv2, false);
                        mesh.material = bakedMaterial(mesh.material) || mesh.material;
                        applied++;
                    }
                    window._bakedApplied = applied;
                    window._bakedMaterials = baked.size;
                })
                .catch(function () { window._bakedApplied = 0; });
        } catch (e) { window._bakedApplied = 0; }
    })();

    // ── Surface texturing ───────────────────────────────────────────────────
    // Every material was a flat colour, which is the most reliable "this is a
    // game" signal there is: real surfaces vary, and it is the VARIATION the eye
    // reads far more than the base hue.
    //
    // Maps are generated procedurally at runtime (engine/render/textures.js)
    // rather than shipped: the project has no build step, a texture set for a
    // dozen materials would be megabytes, and generated maps tile perfectly by
    // construction with no seam authoring. They are deterministic, so the look
    // cannot drift between sessions.
    //
    // Honest limitation: procedural noise cannot match a photographed or
    // sculpt-baked texture for specificity. This covers the WHOLE scene at once,
    // which a per-asset bake would not.
    function _applySurfaces() {
        const T = AerialEngine && AerialEngine.textures;
        if (!T) return 0;
        // material name fragment -> recipe, tiling scale, bump strength
        const RULES = [
            [/^snowMat$/,                 'snow',    26, 0.9],
            [/rock/i,                     'rock',     6, 1.0],
            [/trunk/i,                    'bark',     4, 1.0],
            [/foliage/i,                  'foliage',  5, 0.8],
            [/torso|Arm|Leg|athleteBody/, 'fabric',  10, 0.5],
            [/head|helmet|visor|goggles/, 'shell',    6, 0.35],
            [/ski[LR]_mat|matGround|land|table|pit/i, 'snow', 18, 0.6],
        ];
        // Materials that carry BAKED maps must never be touched here. The
        // "already textured" guard below would usually cover them, but the body
        // loads asynchronously and this runs on a timer — so on a slow load the
        // generic tiled fabric would land on top of a bake that had not arrived
        // yet, replacing the stripe and the bib with noise. Naming them is
        // deterministic; the race is not.
        const BAKED = /^athlete(Body|Helmet)_mat$/;
        let applied = 0;
        for (const mat of scene.materials) {
            if (!mat || !mat.albedoColor) continue;
            if (BAKED.test(mat.name)) continue;            // baked in Blender
            if (mat.bumpTexture) continue;                 // already textured
            // The corridor snow gets its own treatment — measured, not guessed
            // (iteration 6). The old path put BOTH maps on snowMat: a heavy
            // normal map (strength 2.34 biases E[nz] < 1, darkening every shaded
            // pixel systematically) and a tinted albedo map whose mean sits below
            // the material colour. Meanwhile the flanking fields ride lsMat,
            // which matches NO rule and stays untextured — so the groomed run
            // rendered a measured 0.62 luminance against the flanks' 0.79: the
            // "grey ramp". In-page A/B (tests/drive/grey-ab.spec.js, temp):
            // swapping the corridor to a plain lsMat-like PBR restored 0.76+
            // while stripping the bake moved nothing (+0.001). Fix: numeric
            // albedo tuned a step BRIGHTER than the flanks (the footage wants
            // the run the brightest surface in frame), dielectric F0 matched to
            // lsMat (snowMat carried metallicF0Factor=1), and ONLY a gentle
            // normal map for corduroy/drift relief.
            const bare = mat.name.replace(/_baked$/, '');
            if (/^snowMat$/.test(bare)) {
                mat.metallicF0Factor = 0.21;
                // iter 13: with the stale lightmap disabled (see
                // applyBakedLighting) the flanks lost their slightly-sub-1
                // bake multipliers and sit brighter; corridor albedo stepped
                // up to keep the run at least as bright as the flanks
                // (measured 0.7666 -> 0.779 vs flanks 0.7905/0.8015;
                // grey-ramp gate corridor >= darkestFlank - 0.02).
                mat.albedoColor = new BABYLON.Color3(0.975, 0.99, 1.0);
                const surfSnow = T.makeSurface(BABYLON, scene, 'snow', 256, {
                    scale: 26, strength: 1.05,
                });
                if (surfSnow) mat.bumpTexture = surfSnow.normal;
                else mat.bumpTexture = null;
                applied++;
                continue;
            }
            // The lightmapped terrain runs on CLONES named "<name>_baked" (see
            // applyBakedLighting) — same surface, same detail maps, suffix
            // stripped before matching.
            const rule = RULES.find(r => r[0].test(mat.name.replace(/_baked$/, '')));
            if (!rule) continue;
            const base = [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b];
            const surf = T.makeSurface(BABYLON, scene, rule[1], 256, {
                scale: rule[2], strength: rule[3] * 2.6, baseColor: base,
            });
            if (!surf) continue;                            // headless: no canvas
            mat.bumpTexture = surf.normal;
            mat.albedoTexture = surf.albedo;
            // The albedo map already carries the hue; leaving albedoColor set
            // would multiply it in twice and darken everything.
            mat.albedoColor = new BABYLON.Color3(1, 1, 1);
            applied++;
        }
        return applied;
    }

    // ── Ambient occlusion ───────────────────────────────────────────────────
    // Contact darkening is the strongest cue that objects are actually TOUCHING
    // rather than floating near each other — where the skis meet snow, where the
    // kicker meets the table. The scene had none, which is a large part of why
    // everything read as pasted on top of everything else.
    try {
        const ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene,
            { ssaoRatio: 1.0, blurRatio: 1.0 }, [camera]);
        ssao.samples       = 16;
        ssao.radius        = 1.2;
        ssao.totalStrength = 0.9;
        ssao.expensiveBlur = true;
        ssao.base          = 0.15;   // keep some ambient in the occluded areas
    } catch (e) { /* SSAO is a bonus, not a requirement */ }

    // ── Depth of field + bloom pipeline ──────────────────────────────────────
    let dofPipeline = null;
    try {
        // 2nd arg is `hdr`. It was false, which meant no float framebuffer: every
        // value clamped at 1.0 before tonemapping could act on it. Snow is the
        // worst possible subject for that — it clips to flat white and loses all
        // form. Bloom was also computing in LDR as a result.
        // Attached to BOTH cameras. It was main-camera only, so first-person got no
        // tonemapping, no bloom and no exposure multiply — which is precisely why
        // it rendered darker than the third-person view.
        dofPipeline = new BABYLON.DefaultRenderingPipeline('dof', true, scene, [camera]);
        // fpCamera is attached LATER, where it is created — it is a `const`
        // declared further down, so referencing it here is a temporal dead
        // zone error, not merely bad ordering.
        dofPipeline.depthOfFieldEnabled   = false;
        dofPipeline.depthOfFieldBlurLevel = BABYLON.DepthOfFieldEffectBlurLevel.Medium;
        if (dofPipeline.depthOfField) {
            dofPipeline.depthOfField.fStop        = 1.4;
            dofPipeline.depthOfField.focalLength  = 50;
            dofPipeline.depthOfField.focusDistance = 10000;
        }
        // Subtle bloom — white snow and bright sky get a soft glow
        dofPipeline.bloomEnabled   = true;
        dofPipeline.bloomWeight    = 0.18;
        dofPipeline.bloomThreshold = 0.88;  // raised: HDR values exceed 1.0, so 0.72 over-blooms
        dofPipeline.bloomScale     = 0.5;

        // ── Tonemapping — the reason HDR is now on ────────────────────────
        // ACES rolls highlights off filmically instead of clipping them, which
        // is what lets sunlit snow keep its shape instead of blowing out.
        if (dofPipeline.imageProcessing) {
            dofPipeline.imageProcessing.toneMappingEnabled = true;
            dofPipeline.imageProcessing.toneMappingType =
                BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
            dofPipeline.imageProcessing.exposure = 1.0;
            dofPipeline.imageProcessing.contrast = 1.2;   // P2: the real sky now supplies dynamic range; was 1.6

            // Dithering breaks up 8-bit banding in large smooth gradients. The
            // sky and open snow are exactly that, and with untextured flat
            // surfaces there is no detail to hide the steps.
            dofPipeline.imageProcessing.ditheringEnabled   = true;
            dofPipeline.imageProcessing.ditheringIntensity = 1 / 255;
        }

        // MSAA. Thin geometry — ski edges, poles, rails — is where aliasing
        // reads as "game", and it is the cheapest thing to fix on this GPU.
        dofPipeline.samples     = 4;
        dofPipeline.fxaaEnabled = false;   // redundant alongside MSAA
    } catch(e) {
        dofPipeline = null;
    }

    // ── Character ─────────────────────────────────────────────────────────────
    const character = buildCharacter(scene);

    // ── Continuous skinned body ─────────────────────────────────────────────
    // The athlete was always separate solids, so limbs never connected and
    // nothing deformed — the single biggest reason the figure did not read as a
    // person. This loads ONE continuous mesh skinned to a 10-bone armature.
    //
    // The trick that makes it drop in without touching the physics: each BONE is
    // linked to the corresponding driver mesh that applyPose already moves every
    // frame. Babylon then derives the bone transform from that node, so the
    // simulation keeps writing to exactly what it wrote to before, and the
    // skinned body follows. computePose, the pose tables, the ragdoll and the
    // first-person camera are all untouched.
    //
    // The drivers themselves become invisible — they are still the articulation,
    // just no longer the thing you see.
    (function loadContinuousBody() {
        try {
            if (!BABYLON.SceneLoader || !BABYLON.SceneLoader.ImportMeshAsync) return;
            BABYLON.SceneLoader.ImportMeshAsync('', 'assets/', 'athlete_body.glb' + ASSET_V, scene)
                .then(function (res) {
                    const skel = res.skeletons && res.skeletons[0];
                    // glTF has no multi-material primitive: Blender's two material
                    // slots export as SEPARATE primitives, named
                    // athleteBody_primitive0 (suit) and _primitive1 (helmet).
                    // Matching the exact name 'athleteBody' therefore found
                    // nothing and silently linked zero bones.
                    const bodyParts = res.meshes.filter(m =>
                        m.name && m.name.startsWith('athleteBody') &&
                        m.getTotalVertices && m.getTotalVertices() > 0);
                    const bodyMesh = bodyParts[0];
                    if (!skel || !bodyMesh) { window._bodyLinked = 0; return; }

                    let linked = 0;
                    for (const bone of skel.bones) {
                        const driver = character.meshes[bone.name];
                        const node = (driver && driver.mesh) ? driver.mesh : driver;
                        if (!node) continue;
                        // linkTransformNode makes the bone FOLLOW the node the
                        // physics already drives, rather than the other way round.
                        bone.linkTransformNode(node);
                        linked++;
                    }

                    // Every primitive needs the parent, skeleton and the
                    // always-active flag — skinned bounds move far enough that
                    // frustum culling drops them mid-flip otherwise.
                    for (const part of bodyParts) {
                        part.parent = character.root;
                        part.skeleton = skel;
                        part.alwaysSelectAsActiveMesh = true;
                    }

                    // Register the body as a shadow caster HERE, not in the
                    // caster block at the end of startup.
                    //
                    // That block runs synchronously; this glb resolves later, so
                    // the body never reached the list. What did reach it were the
                    // driver solids — which this loader then hides, and Babylon
                    // skips invisible meshes when rendering the shadow map. The
                    // net effect was an athlete that cast no shadow at all beyond
                    // its skis, and it read as "the shadows are weak" rather than
                    // as a missing caster. The drivers stay in the list on purpose:
                    // if this load ever fails they remain visible and are once
                    // again the thing that should cast.
                    if (shadowGen) {
                        const rl = shadowGen.getShadowMap() && shadowGen.getShadowMap().renderList;
                        for (const part of bodyParts) {
                            if (!rl || rl.indexOf(part) === -1) shadowGen.addShadowCaster(part);
                        }
                    }

                    // The body exports with two material slots — suit and helmet —
                    // so Babylon receives two submeshes. Shading them differently is
                    // most of what makes the head legible at distance; as one blue
                    // mass the figure had no read at the top at all.
                    // ── Baked suit detail ──────────────────────────────────
                    // The maps come from blender/build_body.py, which builds the
                    // body a second time at high resolution with seams, panel
                    // grooves, joint creasing, the leg stripe and the bib, then
                    // bakes that onto this low-poly mesh. The suit design is read
                    // off the reference footage: white suit, royal-blue stripe
                    // down the outside of each leg, powder-blue competition bib,
                    // navy waist, dark gloves and helmet.
                    //
                    // This is the reason the athlete is built in Blender at all.
                    // The flat colour it replaces could have been written in one
                    // line here; what could not is surface — and surface, not
                    // silhouette, is what made the figure read as a mannequin.
                    //
                    // Normal and AO are DATA (gammaSpace false); albedo is
                    // COLOUR (sRGB, the default). Getting that backwards on a
                    // normal map tilts every normal towards flat and the relief
                    // quietly disappears.
                    //
                    // invertY MUST be false, and it is the fourth constructor
                    // argument rather than a property because the flag decides how
                    // the image is uploaded. glTF stores UVs with the origin at the
                    // TOP-left, so Blender's exporter writes v_gltf = 1 - v_blender;
                    // Babylon's glTF loader compensates for textures that come
                    // packed inside the .glb, but these arrive as separate files
                    // built by hand, where Texture defaults to invertY = true. The
                    // two conventions then disagree by a vertical flip, every UV
                    // island samples a different island, and the figure renders as
                    // whatever happens to be on the other side of the atlas —
                    // uniform white suit, as it turned out, with the helmet and the
                    // leg stripe nowhere to be seen. Every structural check passed:
                    // the textures were bound, loaded and ready.
                    const map = (url, isColour) => {
                        const t = new BABYLON.Texture(url, scene, false, false);
                        t.gammaSpace = !!isColour;
                        return t;
                    };
                    const suitAlbedo = map('assets/athlete_albedo.png' + ASSET_V, true);
                    const suitNormal = map('assets/athlete_normal.png' + ASSET_V, false);
                    const suitAO = map('assets/athlete_ao.png' + ASSET_V, false);

                    const helmetMat = makePBR('athleteHelmet_mat', scene);
                    helmetMat.albedoTexture = suitAlbedo;
                    helmetMat.bumpTexture   = suitNormal;
                    helmetMat.ambientTexture = suitAO;
                    helmetMat.albedoColor = new BABYLON.Color3(1, 1, 1);  // the map carries the hue
                    helmetMat.metallic  = 0.0;
                    helmetMat.roughness = 0.30;      // moulded shell, slight sheen
                    if (helmetMat.clearCoat) {
                        helmetMat.clearCoat.isEnabled = true;
                        helmetMat.clearCoat.intensity = 0.55;
                        helmetMat.clearCoat.roughness = 0.18;
                    }

                    const bodyMat = makePBR('athleteBody_mat', scene);
                    bodyMat.albedoTexture = suitAlbedo;
                    bodyMat.bumpTexture   = suitNormal;
                    bodyMat.ambientTexture = suitAO;
                    bodyMat.albedoColor = new BABYLON.Color3(1, 1, 1);
                    // Lycra race suit: matte, with only a faint sheen. Anything
                    // glossier reads as a wetsuit.
                    bodyMat.roughness   = 0.68;
                    bodyMat.metallic    = 0.0;

                    // primitive2 is material slot 2 (face): matte skin under
                    // the brim. The albedo map carries the skin tone; no
                    // sheen at all — glossy cheeks read as latex.
                    const faceMat = makePBR('athleteFace_mat', scene);
                    faceMat.albedoTexture = suitAlbedo;
                    faceMat.bumpTexture   = suitNormal;
                    faceMat.ambientTexture = suitAO;
                    faceMat.albedoColor = new BABYLON.Color3(1, 1, 1);
                    faceMat.roughness   = 0.85;
                    faceMat.metallic    = 0.0;

                    // primitive0 is material slot 0 (suit), primitive1 is slot
                    // 1 (helmet + goggle lens), primitive2 is slot 2 (face),
                    // in Blender's slot order.
                    for (const part of bodyParts) {
                        part.material = /primitive1$/.test(part.name) ? helmetMat :
                            /primitive2$/.test(part.name) ? faceMat : bodyMat;
                    }

                    // Hide the solids the body replaces. They keep articulating —
                    // they are the drivers — they are simply no longer rendered.
                    for (const nm of Object.keys(character.meshes)) {
                        if (nm === 'skiL' || nm === 'skiR') continue;   // equipment stays visible
                        const e = character.meshes[nm];
                        const m = (e && e.mesh) ? e.mesh : e;
                        if (m && !bodyParts.includes(m)) m.isVisible = false;
                    }
                    // Detail meshes parented to the hidden solids must go too.
                    for (const m of scene.meshes) {
                        if (/_shoulder$|_elbow$|_knee$|_hip$|_glove$|_boot|_buckle$|^neck$|^nose$|^visor$/.test(m.name)) {
                            m.isVisible = false;
                        }
                    }

                    for (const m of res.meshes) {
                        if (!bodyParts.includes(m) && !/^ski[LR]$/.test(m.name)) {
                            try { m.dispose(); } catch (e) {}
                        }
                    }
                    window._bodyLinked = linked;
                })
                .catch(function () { window._bodyLinked = 0; });
        } catch (e) { window._bodyLinked = 0; }
    })();

    // ── Blender-authored geometry ───────────────────────────────────────────
    // buildCharacter() creates the primitive athlete first, then this
    // TRANSPLANTS the Blender mesh into those same objects — vertex data only,
    // leaving every mesh reference, parent, material and name untouched.
    //
    // Done this way on purpose. The obvious alternative, swapping in the loaded
    // meshes wholesale, would break everything that holds a reference to the
    // originals: applyPose writes to them each frame, the crash ragdoll detaches
    // them by name, the first-person camera reads character.meshes.head, and
    // applySkierColors sets their materials. Replacing only the geometry means
    // none of that has to change or even know.
    //
    // It also degrades safely: if the .glb fails to load, the primitives stay
    // and the game is exactly what it was.
    (function upgradeAthleteGeometry() {
        try {
            if (!BABYLON.SceneLoader || !BABYLON.SceneLoader.ImportMeshAsync) return;
            BABYLON.SceneLoader.ImportMeshAsync('', 'assets/', 'athlete.glb' + ASSET_V, scene)
                .then(function (res) {
                    let swapped = 0;
                    for (const src of res.meshes) {
                        const target = character.meshes[src.name];
                        const dst = (target && target.mesh) ? target.mesh : target;
                        if (!dst || !src.getTotalVertices || src.getTotalVertices() === 0) continue;
                        try {
                            const vd = BABYLON.VertexData.ExtractFromMesh(src);
                            vd.applyToMesh(dst, true);
                            swapped++;
                        } catch (e) { /* leave that segment as a primitive */ }
                    }
                    // Parts with no counterpart in the primitive athlete — the
                    // goggles — are ADOPTED rather than used as donors: kept,
                    // parented to the head, and given their own materials. This
                    // is how new geometry enters the figure without touching
                    // buildCharacter.
                    const headMesh = character.meshes['head'];
                    const adopted = [];
                    for (const src of res.meshes) {
                        if (character.meshes[src.name]) continue;      // was a donor
                        if (!src.name.startsWith('goggles')) continue;
                        if (!headMesh) continue;
                        src.parent = headMesh;
                        src.isPickable = false;

                        const gm = makePBR(src.name + '_mat', scene);
                        if (src.name === 'gogglesLens') {
                            // The lens is the hero detail: dark, smooth, and
                            // clearcoated so it picks up the sky.
                            gm.albedoColor = new BABYLON.Color3(0.02, 0.03, 0.05);
                            gm.metallic    = 0.0;
                            gm.roughness   = 0.08;
                            if (gm.clearCoat) {
                                gm.clearCoat.isEnabled = true;
                                gm.clearCoat.intensity = 1.0;
                                gm.clearCoat.roughness = 0.04;
                            }
                            gm.alpha = 0.92;
                        } else if (src.name === 'gogglesStrap') {
                            gm.albedoColor = new BABYLON.Color3(0.06, 0.06, 0.08);
                            gm.roughness   = 0.85;      // fabric
                        } else {
                            gm.albedoColor = new BABYLON.Color3(0.10, 0.10, 0.12);
                            gm.roughness   = 0.45;      // moulded frame
                        }
                        src.material = gm;
                        adopted.push(src.name);
                    }
                    window._athleteAdopted = adopted;

                    // Everything else the loader produced is only a geometry
                    // donor — remove it so nothing renders twice or animates.
                    for (const m of res.meshes) {
                        if (adopted.includes(m.name)) continue;
                        try { m.dispose(); } catch (e) {}
                    }
                    for (const sk of (res.skeletons || [])) { try { sk.dispose(); } catch (e) {} }
                    for (const tn of (res.transformNodes || [])) { try { tn.dispose(); } catch (e) {} }
                    window._athleteGeometryUpgraded = swapped;
                })
                .catch(function () { window._athleteGeometryUpgraded = 0; });
        } catch (e) {
            window._athleteGeometryUpgraded = 0;
        }
    })();

    applyPose(character.meshes, 0, 1, 1); // start fully extended, arms down
    window._characterMeshes = character.meshes;
    // Crash-ragdoll probe (P11 spec): the surface the ragdoll contacts (the
    // physics surface: terrainRootY(z) - FOOT_OFFSET, or the mode floor).
    window._crashFloorY = function (z) { return _crashFloorY(z); };
    // Ragdoll settle probe (human item 2): rest state for the drive spec.
    window._ragdollProbe = function () {
        return ragdoll ? { resting: !!ragdoll.resting, maxSpeed: ragdoll.maxSpeed,
                           t: ragdoll.t, restAt: ragdoll.restAt } : null;
    };

    // Hide skis and ski boots in trampoline / trampoline-mat / pool-dive mode
    if (_trampolineMode || _poolDiveMode) {
        if (character.meshes['skiL']) character.meshes['skiL'].isVisible = false;
        if (character.meshes['skiR']) character.meshes['skiR'].isVisible = false;
        ['lowerLegL', 'lowerLegR'].forEach(leg => {
            ['_bootLower', '_bootCuff', '_buckle'].forEach(part => {
                const m = scene.getMeshByName(leg + part);
                if (m) m.isVisible = false;
            });
        });

        // ── Gym environment ───────────────────────────────────────────────
        const _gymFloorMat = makePBR('gymFloor', scene);
        _gymFloorMat.diffuseColor  = new BABYLON.Color3(0.62, 0.45, 0.28); // warm wood
        _gymFloorMat.specularColor = new BABYLON.Color3(0.3, 0.25, 0.15);
        _gymFloorMat.specularPower = 40;

        const _gymWallMat = makePBR('gymWall', scene);
        _gymWallMat.diffuseColor  = new BABYLON.Color3(0.82, 0.80, 0.76); // off-white plaster
        _gymWallMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

        const _gymCeilMat = makePBR('gymCeil', scene);
        _gymCeilMat.diffuseColor  = new BABYLON.Color3(0.88, 0.88, 0.86);
        _gymCeilMat.specularColor = new BABYLON.Color3(0.0, 0.0, 0.0);

        const _gymPadMat = makePBR('gymPad', scene);
        _gymPadMat.diffuseColor  = new BABYLON.Color3(0.15, 0.38, 0.72); // blue crash pad
        _gymPadMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

        const GYM_W = 26, GYM_H = 18, GYM_D = 36;
        const GYM_FLOOR_Y = TRAMPOLINE_Y - FOOT_OFFSET; // inground: floor is level with trampoline surface
        const PIT_HALF    = 6.0 / 2 + 0.22; // half-size of hole in floor (trampoline + frame border)

        // Floor — 4 panels with a square hole for the inground trampoline
        // Left strip
        const _floorL = BABYLON.MeshBuilder.CreateBox('gymFloorL', {
            width: GYM_W / 2 - PIT_HALF, height: 0.12, depth: GYM_D }, scene);
        _floorL.position.set(-(GYM_W / 4 + PIT_HALF / 2), GYM_FLOOR_Y, 0);
        _floorL.material = _gymFloorMat;
        // Right strip
        const _floorR = BABYLON.MeshBuilder.CreateBox('gymFloorR', {
            width: GYM_W / 2 - PIT_HALF, height: 0.12, depth: GYM_D }, scene);
        _floorR.position.set(GYM_W / 4 + PIT_HALF / 2, GYM_FLOOR_Y, 0);
        _floorR.material = _gymFloorMat;
        // Front strip (−Z side)
        const _floorF = BABYLON.MeshBuilder.CreateBox('gymFloorF', {
            width: PIT_HALF * 2, height: 0.12, depth: GYM_D / 2 - PIT_HALF }, scene);
        _floorF.position.set(0, GYM_FLOOR_Y, -(GYM_D / 4 + PIT_HALF / 2));
        _floorF.material = _gymFloorMat;
        // Back strip (+Z side)
        const _floorB = BABYLON.MeshBuilder.CreateBox('gymFloorB', {
            width: PIT_HALF * 2, height: 0.12, depth: GYM_D / 2 - PIT_HALF }, scene);
        _floorB.position.set(0, GYM_FLOOR_Y, GYM_D / 4 + PIT_HALF / 2);
        _floorB.material = _gymFloorMat;

        // Back wall (behind character — +Z)
        const _gWallBack = BABYLON.MeshBuilder.CreateBox('gymWallBack', { width: GYM_W, height: GYM_H, depth: 0.2 }, scene);
        _gWallBack.position.set(0, GYM_FLOOR_Y + GYM_H / 2, GYM_D / 2);
        _gWallBack.material = _gymWallMat;

        // Front wall (camera side — -Z)
        const _gWallFront = BABYLON.MeshBuilder.CreateBox('gymWallFront', { width: GYM_W, height: GYM_H, depth: 0.2 }, scene);
        _gWallFront.position.set(0, GYM_FLOOR_Y + GYM_H / 2, -GYM_D / 2);
        _gWallFront.material = _gymWallMat;

        // Left wall
        const _gWallL = BABYLON.MeshBuilder.CreateBox('gymWallL', { width: 0.2, height: GYM_H, depth: GYM_D }, scene);
        _gWallL.position.set(-GYM_W / 2, GYM_FLOOR_Y + GYM_H / 2, 0);
        _gWallL.material = _gymWallMat;

        // Right wall
        const _gWallR = BABYLON.MeshBuilder.CreateBox('gymWallR', { width: 0.2, height: GYM_H, depth: GYM_D }, scene);
        _gWallR.position.set(GYM_W / 2, GYM_FLOOR_Y + GYM_H / 2, 0);
        _gWallR.material = _gymWallMat;

        // Ceiling
        const _gCeil = BABYLON.MeshBuilder.CreateBox('gymCeil', { width: GYM_W, height: 0.2, depth: GYM_D }, scene);
        _gCeil.position.set(0, GYM_FLOOR_Y + GYM_H, 0);
        _gCeil.material = _gymCeilMat;

        // Blue crash pads along back and side walls
        const _padH = 1.5, _padD = 0.18;
        [[0, GYM_D / 2 - _padD / 2, 0],   // back wall pad
         [-GYM_W / 2 + _padD / 2, 0, Math.PI / 2], // left wall pad
         [ GYM_W / 2 - _padD / 2, 0, Math.PI / 2], // right wall pad
        ].forEach(([px, pz, ry], i) => {
            const pad = BABYLON.MeshBuilder.CreateBox('gymPad_' + i,
                { width: GYM_W * (ry === 0 ? 1 : 0) + GYM_D * (ry !== 0 ? 1 : 0) - 0.4,
                  height: _padH, depth: _padD }, scene);
            pad.rotation.y = ry;
            pad.position.set(px, GYM_FLOOR_Y + _padH / 2 + 0.06, pz);
            pad.material = _gymPadMat;
        });

        // Overhead fluorescent light strips (emissive boxes)
        const _lightMat = makePBR('gymLight', scene);
        _lightMat.diffuseColor  = new BABYLON.Color3(1, 1, 0.95);
        _lightMat.emissiveColor = new BABYLON.Color3(1, 1, 0.90);
        [-6, 0, 6].forEach((lz, i) => {
            const strip = BABYLON.MeshBuilder.CreateBox('gymStrip_' + i,
                { width: 0.18, height: 0.08, depth: 2.4 }, scene);
            strip.position.set(0, GYM_FLOOR_Y + GYM_H - 0.14, lz);
            strip.material = _lightMat;
            // Point light under each strip
            const pl = new BABYLON.PointLight('gymPL_' + i, new BABYLON.Vector3(0, GYM_FLOOR_Y + GYM_H - 0.5, lz), scene);
            pl.intensity = 0.6;
            pl.diffuse   = new BABYLON.Color3(1, 1, 0.92);
            pl.range     = 14;
        });

        // Update scene background to a slightly warmer grey to match gym interior
        scene.clearColor = new BABYLON.Color4(0.88, 0.87, 0.84, 1);

        // Hide all UI buttons except Menu, Replay, and world selector in trampoline mode
        ['trophyBtn','customBtn','settingsBtn','compBtn','qualifyBtn',
         'fisBtn','olympicsBtn','helpBtn','compHUD','qualifyHUD','powerMeter']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }

    // ── Trampoline-mat mode spring & mesh state ─────────────────────────────
    let matBounceCount    = 0;
    let matTramBouncing   = false;
    let matTramSpringY    = 0;
    let matTramSpringVY   = 0;
    let matContactNX2     = 0;
    let matContactNZ2     = 0;
    let matLanded         = false;
    let matLandSpringY    = 0;
    let matLandSpringVY   = 0;
    let matLandContactNZ2 = 0;
    let matTramGridMesh   = null;
    let matTramGridPosArr = null;
    let matTramGridIdxArr = null;
    const matTramGridNXZ  = [];
    let matTramLines      = null;
    let matLandGridMesh   = null;
    let matLandGridPosArr = null;
    let matLandGridIdxArr = null;
    const matLandGridNXZ  = [];

    function buildMatTramLines() {
        const tCols = 20, tRows = 14, off = 0.003;
        const lines = [];
        for (let r = 0; r <= tRows; r++) {
            const row = [];
            for (let c = 0; c <= tCols; c++) {
                const i = r * (tCols + 1) + c;
                row.push(new BABYLON.Vector3(
                    matTramGridPosArr[i*3],
                    matTramGridPosArr[i*3+1] + off,
                    matTramGridPosArr[i*3+2]
                ));
            }
            lines.push(row);
        }
        for (let c = 0; c <= tCols; c++) {
            const col = [];
            for (let r = 0; r <= tRows; r++) {
                const i = r * (tCols + 1) + c;
                col.push(new BABYLON.Vector3(
                    matTramGridPosArr[i*3],
                    matTramGridPosArr[i*3+1] + off,
                    matTramGridPosArr[i*3+2]
                ));
            }
            lines.push(col);
        }
        return lines;
    }

    // ── Trampoline-mat world ─────────────────────────────────────────────────
    if (_trampolineMatMode) {
        // Hide skis and ski-boot details
        if (character.meshes['skiL']) character.meshes['skiL'].isVisible = false;
        if (character.meshes['skiR']) character.meshes['skiR'].isVisible = false;
        ['lowerLegL', 'lowerLegR'].forEach(leg => {
            ['_bootLower', '_bootCuff', '_buckle'].forEach(part => {
                const m = scene.getMeshByName(leg + part);
                if (m) m.isVisible = false;
            });
        });

        const SURF_Y  = TRAMPOLINE_Y - FOOT_OFFSET;  // ground/trampoline surface Y
        const MAT_H   = 0.28;
        const TRAM_W  = 4.5;
        const MAT_W   = 5.2;
        const MAT_L   = MAT_LAND_END_Z - MAT_LAND_START_Z;
        const PIT_D   = 1.5;   // pit depth below ground level
        const GND_T   = 0.4;   // ground slab thickness
        const SCENE_W = 20;

        // Ground material (short grass)
        const groundMat = makePBR('matGround', scene);
        groundMat.diffuseColor  = new BABYLON.Color3(0.42, 0.56, 0.32);
        groundMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

        // Ground as 4 strips leaving the pit hole open.
        // Sunk 5 mm below SURF_Y so every mesh sitting at SURF_Y clears it with no coplanar faces.
        const GND_SINK = 0.005;
        const tramL = MAT_TRAM_END_Z - MAT_TRAM_START_Z;
        const sideW = (SCENE_W - TRAM_W) / 2;
        [
            // front approach strip (z: -5 → tram start)
            { w: SCENE_W, h: GND_T, d: MAT_TRAM_START_Z + 5,
              x: 0, z: (MAT_TRAM_START_Z - 5) / 2 },
            // back strip (after trampoline, includes mat area; z: tram end → 42)
            { w: SCENE_W, h: GND_T, d: 42 - MAT_TRAM_END_Z,
              x: 0, z: (MAT_TRAM_END_Z + 42) / 2 },
            // left side strip alongside pit
            { w: sideW, h: GND_T, d: tramL,
              x: -(TRAM_W / 2 + sideW / 2), z: MAT_TRAM_CENTER_Z },
            // right side strip alongside pit
            { w: sideW, h: GND_T, d: tramL,
              x:  (TRAM_W / 2 + sideW / 2), z: MAT_TRAM_CENTER_Z },
        ].forEach((s, i) => {
            const g = BABYLON.MeshBuilder.CreateBox('mgnd_' + i,
                { width: s.w, height: s.h, depth: s.d }, scene);
            g.position.set(s.x, SURF_Y - GND_SINK - s.h / 2, s.z);
            g.material = groundMat;
        });

        // Pit walls and floor (dark concrete) — also sunk by GND_SINK so tops match ground
        const pitMat = makePBR('pitMat', scene);
        pitMat.diffuseColor  = new BABYLON.Color3(0.28, 0.28, 0.28);
        pitMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        const pitCY = SURF_Y - GND_SINK - PIT_D / 2;
        [
            // front wall (near approach side)
            { w: TRAM_W, h: PIT_D, d: 0.15, x: 0, z: MAT_TRAM_START_Z },
            // back wall
            { w: TRAM_W, h: PIT_D, d: 0.15, x: 0, z: MAT_TRAM_END_Z },
            // left wall
            { w: 0.15, h: PIT_D, d: tramL, x: -TRAM_W / 2, z: MAT_TRAM_CENTER_Z },
            // right wall
            { w: 0.15, h: PIT_D, d: tramL, x:  TRAM_W / 2, z: MAT_TRAM_CENTER_Z },
        ].forEach((pw, i) => {
            const w = BABYLON.MeshBuilder.CreateBox('pwall_' + i,
                { width: pw.w, height: pw.h, depth: pw.d }, scene);
            w.position.set(pw.x, pitCY, pw.z);
            w.material = pitMat;
        });
        // Pit floor
        const pFloor = BABYLON.MeshBuilder.CreateBox('pitFloor',
            { width: TRAM_W, height: 0.2, depth: tramL }, scene);
        pFloor.position.set(0, SURF_Y - GND_SINK - PIT_D - 0.1, MAT_TRAM_CENTER_Z);
        pFloor.material = pitMat;

        // Trampoline frame rails
        const frameMat2 = makePBR('matTramFrame', scene);
        frameMat2.diffuseColor  = new BABYLON.Color3(0.55, 0.55, 0.55);
        frameMat2.specularColor = new BABYLON.Color3(0.80, 0.80, 0.80);
        frameMat2.specularPower = 60;
        const RT = 0.22, RH = 0.10;
        const RFX = TRAM_W / 2 + RT / 2;
        [
            { w: TRAM_W + RT * 2, d: RT, x: 0,    z: MAT_TRAM_START_Z - RT / 2 },
            { w: TRAM_W + RT * 2, d: RT, x: 0,    z: MAT_TRAM_END_Z   + RT / 2 },
            { w: RT, d: MAT_TRAM_END_Z - MAT_TRAM_START_Z, x: -RFX, z: MAT_TRAM_CENTER_Z },
            { w: RT, d: MAT_TRAM_END_Z - MAT_TRAM_START_Z, x:  RFX, z: MAT_TRAM_CENTER_Z },
        ].forEach((r, i) => {
            const rail = BABYLON.MeshBuilder.CreateBox('mTRail_' + i,
                { width: r.w, height: RH, depth: r.d }, scene);
            rail.position.set(r.x, SURF_Y + RH / 2, r.z);
            rail.material = frameMat2;
        });

        // Trampoline deformable surface
        {
            const tCols = 20, tRows = 14;
            const tW = TRAM_W, tD = MAT_TRAM_END_Z - MAT_TRAM_START_Z;
            const gP = [], gI = [], gU = [];
            for (let r = 0; r <= tRows; r++) for (let c = 0; c <= tCols; c++) {
                gP.push((c / tCols - 0.5) * tW, 0, (r / tRows - 0.5) * tD);
                gU.push(c / tCols, r / tRows);
                matTramGridNXZ.push((c / tCols) * 2 - 1, (r / tRows) * 2 - 1);
            }
            for (let r = 0; r < tRows; r++) for (let c = 0; c < tCols; c++) {
                const a = r * (tCols + 1) + c;
                gI.push(a, a + tCols + 1, a + 1, a + 1, a + tCols + 1, a + tCols + 2);
            }
            const gN = new Array(gP.length).fill(0);
            BABYLON.VertexData.ComputeNormals(gP, gI, gN);
            const gVD = new BABYLON.VertexData();
            gVD.positions = gP; gVD.indices = gI; gVD.normals = gN; gVD.uvs = gU;
            matTramGridMesh = new BABYLON.Mesh('matTramGrid', scene);
            gVD.applyToMesh(matTramGridMesh, true);
            matTramGridMesh.position.set(0, SURF_Y, MAT_TRAM_CENTER_Z);
            matTramGridPosArr = gP.slice();
            matTramGridIdxArr = gI.slice();
            const tSurfMat = makePBR('matTramSurf', scene);
            tSurfMat.diffuseColor    = new BABYLON.Color3(0.07, 0.07, 0.09);
            tSurfMat.backFaceCulling = false;
            matTramGridMesh.material = tSurfMat;
            // Grid lines overlay
            matTramLines = BABYLON.MeshBuilder.CreateLineSystem('matTramLines',
                { lines: buildMatTramLines(), updatable: true }, scene);
            matTramLines.color = new BABYLON.Color3(0.38, 0.38, 0.44);
            matTramLines.position.set(0, SURF_Y, MAT_TRAM_CENTER_Z);
        }

        // Landing crash mat body
        const matBodyMat = makePBR('matBody', scene);
        matBodyMat.diffuseColor  = new BABYLON.Color3(0.10, 0.18, 0.65);
        matBodyMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.08);
        const matBody = BABYLON.MeshBuilder.CreateBox('matBody',
            { width: MAT_W, height: MAT_H - 0.005, depth: MAT_L }, scene);
        matBody.position.set(0, SURF_Y + (MAT_H - 0.005) / 2, MAT_LAND_CENTER_Z);
        matBody.material = matBodyMat;

        // Landing mat deformable surface (top of foam block)
        {
            const lCols = 18, lRows = 14;
            const lW = MAT_W, lD = MAT_L;
            const gP = [], gI = [], gU = [];
            for (let r = 0; r <= lRows; r++) for (let c = 0; c <= lCols; c++) {
                gP.push((c / lCols - 0.5) * lW, 0, (r / lRows - 0.5) * lD);
                gU.push(c / lCols, r / lRows);
                matLandGridNXZ.push((c / lCols) * 2 - 1, (r / lRows) * 2 - 1);
            }
            for (let r = 0; r < lRows; r++) for (let c = 0; c < lCols; c++) {
                const a = r * (lCols + 1) + c;
                gI.push(a, a + lCols + 1, a + 1, a + 1, a + lCols + 1, a + lCols + 2);
            }
            const gN = new Array(gP.length).fill(0);
            BABYLON.VertexData.ComputeNormals(gP, gI, gN);
            const gVD = new BABYLON.VertexData();
            gVD.positions = gP; gVD.indices = gI; gVD.normals = gN; gVD.uvs = gU;
            matLandGridMesh = new BABYLON.Mesh('matLandGrid', scene);
            gVD.applyToMesh(matLandGridMesh, true);
            matLandGridMesh.position.set(0, SURF_Y + MAT_H, MAT_LAND_CENTER_Z);
            matLandGridPosArr = gP.slice();
            matLandGridIdxArr = gI.slice();
            const lSurfMat = makePBR('matLandSurf', scene);
            lSurfMat.diffuseColor  = new BABYLON.Color3(0.14, 0.26, 0.85);
            lSurfMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.20);
            lSurfMat.specularPower = 30;
            matLandGridMesh.material = lSurfMat;
        }

        // Outdoor daylight
        const matSun = new BABYLON.HemisphericLight('matSun',
            new BABYLON.Vector3(0.3, 1, 0.2), scene);
        matSun.intensity    = 1.1;
        matSun.diffuse      = new BABYLON.Color3(1, 0.98, 0.92);
        matSun.groundColor  = new BABYLON.Color3(0.35, 0.40, 0.30);

        // Hide competition UI
        ['trophyBtn','customBtn','settingsBtn','compBtn','qualifyBtn',
         'fisBtn','olympicsBtn','helpBtn','compHUD','qualifyHUD','powerMeter']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    }

    // Expose live game state for tutorial and other overlays
    window._getGameState = function() {
        return {
            grounded: state.grounded,
            crashed: state.crashed,
            stopped: state.stopped,
            posZ: state.posZ,
            airTime: state.airTime,
            tuckAmount: state.tuckAmount,
            spinAngle: state.spinAngle,
            trickName: state.trickName,
            readyState: readyState,
            KICKER_END_Z: KICKER_END_Z,
            FLAT_Z: FLAT_Z,
            flipPower: flipPower,
        };
    };
    // Pause flag for the hotkey spec — deliberately NOT a _getGameState()
    // field: the golden harness serialises that object whole, so its key set
    // is frozen by the traces.
    window._isPaused = function () { return paused; };

    // Ready-stance diagnostics for the drive spec: per-ski clearance of the
    // 5 lowest-edge samples against the physics surface (terrainRootY(z) -
    // FOOT_OFFSET), measured with the same stub-safe maths as the render
    // block. Skis with euler-only rotation (post-turn) are folded in as
    // RotX(rx) — pose tables keep ski ry/rz at 0.
    window._readyStanceProbe = function () {
        const r = { readyState: readyState, readyTurnT: readyTurnT, last: _readyStance.last, skis: {} };
        if (!_skiHalfDims || !character.meshes.skiL || !character.root.rotationQuaternion) return r;
        for (const nm of ['skiL', 'skiR']) {
            const sk = character.meshes[nm];
            if (!sk) continue;
            const qS = sk.rotationQuaternion
                ? sk.rotationQuaternion
                : BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, sk.rotation.x || 0);
            const samples = [];
            for (let i = 0; i < 5; i++) {
                const s = -_skiHalfDims.z + (2 * _skiHalfDims.z) * (i / 4);
                let worst = Infinity;
                for (const e of [-_skiHalfDims.x, _skiHalfDims.x]) {
                    const loc = _quatRotateVec(qS, new BABYLON.Vector3(e, -_skiHalfDims.y, s));
                    const off = _quatRotateVec(character.root.rotationQuaternion,
                        new BABYLON.Vector3(sk.position.x + loc.x, sk.position.y + loc.y, sk.position.z + loc.z));
                    const clear = character.root.position.y + off.y -
                        (terrainRootY(state.posZ + off.z) - FOOT_OFFSET);
                    if (clear < worst) worst = clear;
                }
                samples.push(+worst.toFixed(4));
            }
            r.skis[nm] = { worst: Math.min.apply(null, samples), samples: samples };
        }
        return r;
    };

    // Hop-turn phase schedule for the drive spec (fractions of READY_TURN_DUR;
    // see the HOP_TURN note at READY_TURN_DUR for why the author's 0.95 s
    // schedule is scaled into the physics-locked 0.7 s turn).
    window._hopTurnPhases = function () {
        return { dur: READY_TURN_DUR, crouchEnd: HOP_TURN.crouchEnd, takeoff: HOP_TURN.takeoff,
                 touchdown: HOP_TURN.touchdown, hopHeight: HOP_TURN.hopHeight, kMax: HOP_TURN.kMax };
    };

    window.applySkierColors = function() {
        function hexToC3(hex) {
            return new BABYLON.Color3(
                parseInt(hex.slice(1,3),16)/255,
                parseInt(hex.slice(3,5),16)/255,
                parseInt(hex.slice(5,7),16)/255
            );
        }
        var m = window._characterMeshes;
        if (!m) return;
        var helmetC = hexToC3(_lsGet('color_helmet') || '#1a1a1a');
        var torsoC  = hexToC3(_lsGet('color_torso')  || '#1440bf');
        var armsC   = hexToC3(_lsGet('color_arms')   || '#cc0f0f');
        var legsC   = hexToC3(_lsGet('color_legs')   || '#1a1a1a');
        if (m['head']  && m['head'].material)  m['head'].material.diffuseColor  = helmetC;
        if (m['torso'] && m['torso'].material) m['torso'].material.diffuseColor = torsoC;
        ['upperArmL','upperArmR','lowerArmL','lowerArmR'].forEach(function(n) {
            if (m[n] && m[n].material) m[n].material.diffuseColor = armsC;
        });
        ['upperLegL','upperLegR','lowerLegL','lowerLegR'].forEach(function(n) {
            if (m[n] && m[n].material) m[n].material.diffuseColor = legsC;
        });
        // shoulder/elbow/glove detail meshes — walk all scene meshes by name
        scene.meshes.forEach(function(mesh) {
            if (!mesh.material) return;
            var n = mesh.name;
            if (n.indexOf('shoulder') !== -1 || n.indexOf('elbow') !== -1 || n.indexOf('glove') !== -1)
                mesh.material.diffuseColor = armsC;
        });
    };

    // ── Pool geometry constants ──────────────────────────────────────────────
    const POOL_Z_START  = OUTRUN_Z + 5;
    const POOL_Z_END    = OUTRUN_Z + 25;
    const poolLen       = POOL_Z_END - POOL_Z_START;
    const poolCenterZ   = (POOL_Z_START + POOL_Z_END) / 2;
    const poolSurfaceY  = terrainRootY(OUTRUN_Z) - FOOT_OFFSET + 0.05;
    const POOL_W        = 9.5;
    const POOL_DEPTH    = 24.0;
    const POOL_WALL_T   = 0.45;
    // Three platforms side by side on the shore, different heights
    const PLATFORM_CONFIGS = [
        { label: '8m',  height:  8.0, x: -4.0, launchVZ: 2.2 },
        { label: '12m', height: 12.0, x:  0.0, launchVZ: 1.8 },
        { label: '18m', height: 18.0, x:  4.0, launchVZ: 1.4 },
    ];
    const POOL_DIVE_SHORE_Z    = POOL_Z_START - 0.5; // all platforms at pool edge
    const POOL_DIVE_TIP_Z      = POOL_DIVE_SHORE_Z + 0.6; // near front of board (front edge = SHORE_Z+0.8)
    let   activePlatIdx        = 0;
    let   POOL_DIVE_PLATFORM_Z = POOL_DIVE_TIP_Z;
    let   POOL_DIVE_PLATFORM_X = PLATFORM_CONFIGS[0].x;
    let   POOL_DIVE_PLATFORM_Y = poolSurfaceY + PLATFORM_CONFIGS[0].height;
    let   POOL_DIVE_ROOT_Y     = POOL_DIVE_PLATFORM_Y + FOOT_OFFSET;
    const POOL_DIVE_LAUNCH_VY  = 8.5;
    let   poolWalls     = [];
    let   waterMesh     = null;
    let   _splashTex    = null;

    // ── Terrain meshes (visual — physics uses terrainRootY()) ────────────────────
    if (!_trampolineMode && !_trampolineMatMode && !_poolDiveMode) {
    // ── Procedural snow surface detail ──────────────────────────────────────
    // Generates a tiling normal map at runtime rather than shipping an image.
    // Flat untextured snow is the most obvious remaining tell — real snow has
    // wind ripple, groomer corduroy and a fine granular break-up, and a normal
    // map gets all three without adding a single triangle.
    //
    // Height is built from three octaves plus a directional corduroy ripple,
    // then converted to a normal by finite differences (Sobel-style central
    // difference on the height field).
    function _makeSnowNormalMap(scene, size) {
        const tex = new BABYLON.DynamicTexture('snowNormal',
            { width: size, height: size }, scene, true);
        const ctx = tex.getContext();
        if (!ctx || !ctx.createImageData) return tex;   // headless stub

        // Deterministic value noise — same surface every load, so the look does
        // not drift between sessions.
        const hash = (x, y) => {
            let h = (x * 374761393 + y * 668265263) | 0;
            h = (h ^ (h >>> 13)) * 1274126177;
            return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
        };
        const smooth = (t) => t * t * (3 - 2 * t);
        function valueNoise(x, y) {
            const xi = Math.floor(x), yi = Math.floor(y);
            const xf = x - xi, yf = y - yi;
            const u = smooth(xf), v = smooth(yf);
            const a = hash(xi, yi),     b = hash(xi + 1, yi);
            const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
            return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
        }

        // Height field. Wrapping coordinates keep the texture tileable.
        const H = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const fx = x / size, fy = y / size;
                let h = 0;
                h += valueNoise(fx * 8,  fy * 8)  * 0.55;   // drifts
                h += valueNoise(fx * 24, fy * 24) * 0.28;   // wind ripple
                h += valueNoise(fx * 96, fy * 96) * 0.17;   // granular break-up
                // Corduroy: the groomer leaves fine parallel lines down the fall line.
                h += Math.sin(fy * Math.PI * 2 * 48) * 0.035;
                H[y * size + x] = h;
            }
        }

        const img = ctx.createImageData(size, size);
        const STRENGTH = 2.6;
        const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
                const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
                // Normalise (-dx, -dy, 1) into tangent space, encoded 0..255.
                const len = Math.sqrt(dx * dx + dy * dy + 1);
                const i = (y * size + x) * 4;
                img.data[i]     = ((-dx / len) * 0.5 + 0.5) * 255;
                img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
                img.data[i + 2] = ((1 / len)   * 0.5 + 0.5) * 255;
                img.data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        tex.update(false);
        return tex;
    }

    // Snow is physically based now. StandardMaterial is Blinn-Phong and cannot
    // express what actually makes snow look like snow: a rough specular response
    // to sky light, plus subsurface scattering that tints shadowed snow BLUE.
    // That blue scatter is the single most recognisable cue and Blinn-Phong has
    // no way to produce it.
    const snowMat = new BABYLON.PBRMaterial('snowMat', scene);
    // Snow is one of the brightest natural surfaces there is: fresh snow reflects
    // 80-90% of the light hitting it, and groomed piste is not far behind. This
    // was 0.70, 0.76, 0.84 — a blue-grey with a 14-point spread between red and
    // blue, which is a rain cloud, not snow. Under an already-cool sky and a
    // multiplying sky-visibility map the ramp came out distinctly grey while the
    // background read white, because the background is washed towards the fog
    // colour and the foreground is not.
    //
    // The slight blue bias stays — snow really is faintly blue in shade, and the
    // subsurface tint below leans on it — but it is now a couple of points, not
    // fourteen.
    snowMat.albedoColor = new BABYLON.Color3(0.89, 0.91, 0.94);
    snowMat.metallic    = 0.0;
    snowMat.roughness   = 0.46;   // packed piste, slightly rougher: scatters more, glares less
    // P1 "the ground is solid": every terrain surface (corridor + field + skirt)
    // shares this material and must shade snow even where only its underside can
    // be seen (skirt inner faces seen from below a drift), so nothing can ever
    // read as an unlit backface hole.
    snowMat.backFaceCulling = false;

    // Snow's surface detail now comes from the general procedural texturing
    // pass (_applySurfaces) rather than a snow-specific one-off, so it gets an
    // albedo map as well as a normal map and shares one code path with rock,
    // bark, foliage and fabric.

    // NO subsurface translucency, NO clear coat on the corridor snow. Both were
    // enabled here as "recognisable snow cues", but a measured property walk
    // (iteration 7, clean-load toggles on this very camera view) convicted
    // translucency as the main carrier of the residual grey ramp: turning it
    // off alone moved the corridor table 0.645 -> 0.778 and the kicker face
    // 0.678 -> 0.758 against flanks at 0.787; disabling clear coat had already
    // given +0.015; bump map and roughness toggles moved nothing. The physics
    // of it: with F0 0.21 and this light rig, transmissive scattering re-routes
    // energy behind the surface while lsMat's plain opaque BRDF (the flanks)
    // keeps it facing the sun/camera — so the groomed run lost ~13% of its
    // luminance against untreated snow next door. The footage wants the run to
    // read as the BRIGHTEST surface in frame; parity with the flanks comes
    // first, and the bluish shade bias still lives in the albedo colour. A
    // proper subsurface return belongs to the P2 light rig, applied scene-wide,
    // not to one material out of step with its neighbours.

    const kickerWidth = 3.4; // all hills use double width

    // ── P1 slice 1: ONE continuous corridor ribbon sampled from the exact physics profile ──
    // Replaces slopeBox, the 16 trans_seg_* boxes, flatTable, flatTableFull,
    // landing, outrun and start. Every vertex y comes from
    // terrainRootY(z) - FOOT_OFFSET — the same function the physics rides — so
    // surface and physics can no longer disagree along z (the old slabs were
    // rotated boxes with chord/gap errors; the documented 4.7 cm slopeBox face
    // defect died with it). Sample spacing is adaptive: ≤0.25 m through every
    // curved zone (transition bezier, kicker curve, knuckle + roll-out blends),
    // with duplicated rows at hard breaks (kicker back wall) so shared-vertex
    // normals never smear across them.
    //
    // P1 slice 2 (this iteration): the corridor is no longer an 11-column strip
    // abutting six separately-sloped flank boxes. XC extends laterally to ±55 m
    // on SHARED rings, so corridor edge and flanks are one continuous surface —
    // same vertices across x=±5, averaged normals, zero dihedral by
    // construction (measured gate: tests/drive/terrain-corridor.spec.js).
    // Outside the run there is a soft push-out windlip (+11 cm crest just past
    // the fence line) easing back to open snowfield — the banks visible along
    // the landing edges in IMG_3523/7841. The old wInrun/wTable/wLanding/
    // wOutrun/wStartPlat boxes and the corner_* seam slabs are retired with
    // this geometry; only wUpperMtn (distant backdrop paper-mountain behind
    // the start, above field level everywhere it overlaps) remains.
    const _BERM_H = 0.11;
    const _fieldBerm = (ax) => {
        if (ax <= 5) return 0;
        const u = ax - 5;
        const ss = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
        return _BERM_H * ss(u / 2.4) * (1 - ss((u - 2.4) / 4.6));
    };
    // The ONE ground-height function for anything static that stands on snow:
    // trees plant against it so their bases follow the windlip exactly.
    // Human item 3 (2026-08-27): beside the kicker block the corridor stays
    // FLAT TABLE. The physics profile only leaves the table for the block's
    // own bezier inside |x| ≤ kickerWidth/2 (terrainRootY returns tableY again
    // past KICKER_END_Z), so the ribbon must not carry the kicker rise across
    // the full corridor width — the block is its own solid standing on the
    // table, with near-vertical side walls at x = ±kickerWidth/2.
    const _blockHalfW = kickerWidth / 2;
    const _tableTopY  = _KBP_tY - FOOT_OFFSET;
    const _fieldTopY = (x, z) => {
        let y = terrainRootY(z) - FOOT_OFFSET;
        if (Math.abs(x) > _blockHalfW && z > KICKER_START_Z && z <= KICKER_END_Z) y = _tableTopY;
        return y + _fieldBerm(Math.abs(x));
    };
    {
        // Corridor columns (|x| ≤ 5, exact physics surface) then the banked
        // shoulder out to the open field. Column spacing tightens over the
        // windlip (max lateral slope 3.9°, facet normals stay within the 5°
        // continuity gate).
        const XC = [-55, -45, -35, -27, -21, -17, -14, -12.0, -10.7, -9.2, -7.9,
            -5, -3.6, -2.6, -1.75, -1.7, -0.85, 0, 0.85, 1.7, 1.75, 2.6, 3.6, 5,
            5.6, 6.7, 7.9, 9.2, 10.7, 12.0, 14, 17, 21, 27, 35, 45, 55];
        const profY = (z) => terrainRootY(z) - FOOT_OFFSET;
        const zones = [
            [SLOPE_START_Z - 56, SLOPE_START_Z - 20,           2.00],  // upper plateau behind start (wStartPlat retired)
            [SLOPE_START_Z - 20, TRANS_START_Z,                 0.75],  // start plateau + in-run
            [TRANS_START_Z,      TRANS_END_Z,                   0.15],  // transition bezier
            [TRANS_END_Z,        KICKER_START_Z,                0.35],  // table
            [KICKER_START_Z,     KICKER_END_Z,                  0.08],  // kicker curve
            [KICKER_END_Z,       LANDING_START_Z,               0.08],  // lip → wall → landing bowl start
            [_ltArc.T1z,                 _ltArc.T2z + 1.0,          0.10], // C1 knuckle fillet (+line margin)
            [_ltArc.T2z + 1.0,           OUTRUN_Z - OUTRUN_TRANS_LEN, 0.50], // straight landing
            [OUTRUN_Z - OUTRUN_TRANS_LEN, _loArc.T2z + 0.5,         0.12],  // C1 roll-out fillet
            [OUTRUN_Z,           OUTRUN_Z + 90,                 1.00],  // outrun
            [OUTRUN_Z + 90,      OUTRUN_Z + 170,                2.50],  // far valley floor (wOutrun retired)
        ];
        const zs = [];
        for (const [z0, z1, step] of zones) {
            const n = Math.max(1, Math.ceil((z1 - z0) / step));
            for (let i = 0; i < n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
        }
        zs.push(zones[zones.length - 1][1]);
        // Exact rings at every physics branch boundary: without them the joint
        // interpolates across whatever quad happens to straddle it (measured
        // 14 mm artefact at the start plateau join).
        const JOINS = [
            SLOPE_START_Z, TRANS_START_Z, TRANS_END_Z, KICKER_START_Z,
            KICKER_END_Z, LANDING_START_Z, _ltArc.T1z, _ltArc.T2z,
            _loArc.T1z, _loArc.T2z, OUTRUN_Z,
        ];
        zs.push(...JOINS);
        zs.sort((a, b) => a - b);

        const positions = [], indices = [];
        const DEG = Math.PI / 180;
        const eps = 0.01;
        const slopeAt = (z) => Math.atan(
            (profY(Math.min(z + eps, OUTRUN_Z + 89)) - profY(Math.max(z - eps, SLOPE_START_Z - 19))) / (2 * eps));
        const rows = zs.map((z) => ({ z, slope: slopeAt(z) }));

        // Strips: consecutive rings wound together. At a hard break (>20 deg
        // slope change) the last ring is duplicated so both sides carry their
        // own shared normals instead of smearing across the joint.
        const strips = [];
        let cur = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!cur.length) { cur.push(r); continue; }
            const p = cur[cur.length - 1];
            if (Math.abs(r.slope - p.slope) > 20 * DEG) {
                strips.push(cur);
                const dup = { z: p.z, slope: p.slope, dup: true };
                cur = [dup, r];
            } else {
                cur.push(r);
            }
        }
        if (cur.length) strips.push(cur);

        let base = 0;
        for (const st of strips) {
            const first = base;
            for (const r of st) {
                for (const x of XC) positions.push(x, _fieldTopY(x, r.z), r.z);
                base += XC.length;
            }
            for (let ri = 1; ri < st.length; ri++) {
                const a = first + (ri - 1) * XC.length, b = first + ri * XC.length;
                for (let c = 0; c < XC.length - 1; c++) {
                    indices.push(a + c, a + c + 1, b + c,
                                 a + c + 1, b + c + 1, b + c);   // CCW seen from above (+y)
                }
            }
        }

        const ribbon = new BABYLON.Mesh('terrainCorridor', scene);
        const vd = new BABYLON.VertexData();
        vd.positions = positions;
        vd.indices = indices;
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        vd.normals = normals;
        vd.applyToMesh(ribbon);
        ribbon.material = snowMat;
        ribbon.receiveShadows = true;

        // ── The ground is solid: close every open edge of the field ──────────
        // Perimeter skirt (outer columns + both end caps) extruded down to a
        // common base well below the lowest playable point, capped by a base
        // plane; snowMat has backFaceCulling=false, so even a pathological
        // camera under a drift shades snow instead of showing a hole through
        // the world.
        {
            const BASE_Y = terrainRootY(OUTRUN_Z) - FOOT_OFFSET - 60;
            const rowZs = [];
            for (const st of strips) for (const r of st) rowZs.push(r.z);
            const ZMIN = rowZs[0], ZMAX = rowZs[rowZs.length - 1];

            const edgeCol = (x) => rowZs.map((z) => ({ x, y: _fieldTopY(x, z), z }));
            const edgeRowZ = (z) => XC.map((x) => ({ x, y: _fieldTopY(x, z), z }));
            const dropToBase = (pts) => pts.map((p) => ({ x: p.x, y: BASE_Y, z: p.z }));

            const sPos = [], sIdx = [];
            const pushWall = (ptsA, ptsB) => {   // top rail + bottom rail → quad strip
                const first = sPos.length / 3;
                for (const p of ptsA) sPos.push(p.x, p.y, p.z);
                for (const p of ptsB) sPos.push(p.x, p.y, p.z);
                const n = ptsA.length;
                for (let i = 0; i < n - 1; i++) {
                    sIdx.push(first + i, first + n + i, first + i + 1,
                              first + i + 1, first + n + i, first + n + i + 1);
                }
            };
            pushWall(edgeCol(XC[0]), dropToBase(edgeCol(XC[0])));              // west wall
            pushWall(edgeCol(XC[XC.length - 1]), dropToBase(edgeCol(XC[XC.length - 1]))); // east wall
            const zminRow = edgeRowZ(ZMIN);
            pushWall(zminRow, dropToBase(zminRow));                            // rear cap
            const zmaxRow = edgeRowZ(ZMAX);
            pushWall(zmaxRow, dropToBase(zmaxRow));                            // front cap

            const skirt = new BABYLON.Mesh('terrainSkirt', scene);
            const svd = new BABYLON.VertexData();
            svd.positions = sPos;
            svd.indices = sIdx;
            const sNrm = [];
            BABYLON.VertexData.ComputeNormals(sPos, sIdx, sNrm);
            svd.normals = sNrm;
            svd.applyToMesh(skirt);
            skirt.material = snowMat;
            skirt.receiveShadows = true;

            // Base plane under everything, same snow underside contract.
            try {
                const floor = BABYLON.MeshBuilder.CreateDisc('terrainBase',
                    { radius: 600, tessellation: 48 }, scene);
                floor.rotation.x = Math.PI / 2;
                floor.position.y = BASE_Y - 0.01;
                floor.material = snowMat;
                floor.receiveShadows = true;
            } catch (e) { /* headless stub without CreateDisc: the field + skirt still close every view */ }
        }
        window._terrainCorridorReady = true;
    }

    // Kicker edge lines — top 0.8 units down each side, 1 unit inward at bottom, 0.8 inward on top-back edge
    const cornerMat = makePBR('cornerMat', scene);
    cornerMat.diffuseColor  = new BABYLON.Color3(1, 0, 0);
    cornerMat.emissiveColor = new BABYLON.Color3(0.8, 0, 0);
    {
        const arcHalfW = kickerWidth / 2;

        // Sample bezier points densely for arc-length measurement
        const N_SAMP = 200;
        const samples = [];
        for (let si = 0; si <= N_SAMP; si++) {
            const t = si / N_SAMP, u = 1 - t;
            samples.push({
                z: u*u*u*_kBP[0][0] + 3*u*u*t*_kBP[1][0] + 3*u*t*t*_kBP[2][0] + t*t*t*_kBP[3][0],
                y: u*u*u*_kBP[0][1] + 3*u*u*t*_kBP[1][1] + 3*u*t*t*_kBP[2][1] + t*t*t*_kBP[3][1] - FOOT_OFFSET + 0.017,
            });
        }

        // ── Top: 0.8 units down each side from the lip (walk backward from end of samples) ──
        const topPathL = [], topPathR = [];
        let arcLen = 0;
        topPathL.push(new BABYLON.Vector3(-arcHalfW, samples[N_SAMP].y, samples[N_SAMP].z));
        topPathR.push(new BABYLON.Vector3( arcHalfW, samples[N_SAMP].y, samples[N_SAMP].z));
        for (let si = N_SAMP - 1; si >= 0; si--) {
            const dz = samples[si+1].z - samples[si].z, dy = samples[si+1].y - samples[si].y;
            arcLen += Math.sqrt(dz*dz + dy*dy);
            if (arcLen > 0.8) break;
            topPathL.push(new BABYLON.Vector3(-arcHalfW, samples[si].y, samples[si].z));
            topPathR.push(new BABYLON.Vector3( arcHalfW, samples[si].y, samples[si].z));
        }
        if (topPathL.length >= 2) {
            const tL = BABYLON.MeshBuilder.CreateTube('kickerTopL',
                { path: topPathL, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
            tL.material = cornerMat;
            const tR = BABYLON.MeshBuilder.CreateTube('kickerTopR',
                { path: topPathR, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
            tR.material = cornerMat;
        }

        // ── Bottom: 1 unit up the kicker curve on each side from the base ──
        const botPathL = [], botPathR = [];
        let botArcLen = 0;
        botPathL.push(new BABYLON.Vector3(-arcHalfW, samples[0].y, samples[0].z));
        botPathR.push(new BABYLON.Vector3( arcHalfW, samples[0].y, samples[0].z));
        for (let si = 1; si <= N_SAMP; si++) {
            const dz = samples[si].z - samples[si-1].z, dy = samples[si].y - samples[si-1].y;
            botArcLen += Math.sqrt(dz*dz + dy*dy);
            if (botArcLen > 3.0) break;
            botPathL.push(new BABYLON.Vector3(-arcHalfW, samples[si].y, samples[si].z));
            botPathR.push(new BABYLON.Vector3( arcHalfW, samples[si].y, samples[si].z));
        }
        if (botPathL.length >= 2) {
            const bL = BABYLON.MeshBuilder.CreateTube('kickerBotL',
                { path: botPathL, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
            bL.material = cornerMat;
            const bR = BABYLON.MeshBuilder.CreateTube('kickerBotR',
                { path: botPathR, radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
            bR.material = cornerMat;
        }

        // ── Top-back edge of block: 0.8 units inward from each side ──
        const topEdgeY = _KBP_lY - FOOT_OFFSET + 0.017;
        const topEdgeZ = KICKER_END_Z;
        const edgeTubeL = BABYLON.MeshBuilder.CreateTube('kickerEdgeL',
            { path: [new BABYLON.Vector3(-arcHalfW, topEdgeY, topEdgeZ), new BABYLON.Vector3(-arcHalfW + 0.8, topEdgeY, topEdgeZ)],
              radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
        edgeTubeL.material = cornerMat;
        const edgeTubeR = BABYLON.MeshBuilder.CreateTube('kickerEdgeR',
            { path: [new BABYLON.Vector3(arcHalfW - 0.8, topEdgeY, topEdgeZ), new BABYLON.Vector3(arcHalfW, topEdgeY, topEdgeZ)],
              radius: 0.06, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL }, scene);
        edgeTubeR.material = cornerMat;
    }

    // ── Alpine forest — grid-based placement across full mountain terrain ───────
    {
    const tkMat = makePBR('trunkMat', scene);
    tkMat.diffuseColor = new BABYLON.Color3(0.36, 0.22, 0.12);
    const flMat = makePBR('foliageMat', scene);
    flMat.diffuseColor = new BABYLON.Color3(0.11, 0.31, 0.14);

    // Deterministic hash → float in [0, 1) from two integers
    function _tRng(a, b) {
        let h = Math.imul((a * 1619 + b * 31337) | 0, 0x45d9f3b);
        h = Math.imul(h ^ (h >>> 16), 0x5af6c39b);
        return ((h >>> 0) & 0xFFFF) / 65536;
    }

    const cellX = 10, cellZ = 9;
    const zStart = SLOPE_START_Z - 25;
    const zEnd   = OUTRUN_Z + 100;
    const zCells = Math.ceil((zEnd - zStart) / cellZ);
    const xCells = 6;  // covers X ≈ ±60

    for (let gx = -xCells; gx <= xCells; gx++) {
        for (let gz = 0; gz < zCells; gz++) {
            const rx = _tRng(gx,         gz);
            const rz = _tRng(gx + 500,   gz + 500);
            const rs = _tRng(gx * 3,     gz * 7);
            const rp = _tRng(gx * 7 + 1, gz * 3 + 1);

            const tx = gx * cellX + (rx - 0.5) * cellX * 0.75;
            const tz = zStart + gz * cellZ + (rz - 0.5) * cellZ * 0.75;
            const absTx = Math.abs(tx);

            if (absTx < 7.0) continue;   // clear course corridor
            if (absTx > 58)  continue;   // stay on terrain

            // Sparser near course edges, denser further out.
            // Camera side (-X) gets 55% density to avoid blocking the view.
            const distFromCourse = absTx - 7.0;
            const sideFactor = tx < 0 ? 0.55 : 1.0;
            const prob = (1 - Math.exp(-distFromCourse * 0.10)) * sideFactor;
            if (rp > prob) continue;

            // Alpine conifers: trunk 2.8–5 units, total height 11–18 units
            const s = 0.85 + rs * 0.90;
            const trunkH  = 3.0 * s,  trunkR  = 0.26 * s;
            const foliageH = 10.5 * s, foliageR = 2.3 * s;

            // Plant against the SAME field function the terrain mesh samples:
            // with the slice-2 windlip beside the corridor, a physics-only
            // planting height would leave trunk bases floating above the berm.
            const ty = _fieldTopY(tx, tz);
            const ti = (gx + xCells) * zCells + gz;

            // Interim stopgap (reviewer note, owed since iteration 5): rounded
            // silhouettes — trunk with a widened base flare, foliage with more
            // side facets. Real fix is the P4 Blender-baked impostor forest.
            const trunk = BABYLON.MeshBuilder.CreateCylinder('tr_' + ti,
                {
                    height:         trunkH,
                    diameterTop:    trunkR * 2 * 0.86,
                    diameterBottom: trunkR * 2 * 1.45,
                    tessellation:   16,
                }, scene);
            trunk.position.set(tx, ty + trunkH / 2, tz);
            trunk.material = tkMat;

            const foliage = BABYLON.MeshBuilder.CreateCylinder('fl_' + ti,
                { height: foliageH, diameterTop: 0, diameterBottom: foliageR * 2, tessellation: 12 }, scene);
            foliage.position.set(tx, ty + trunkH + foliageH / 2, tz);
            foliage.material = flMat;
        }
    }
    } // end trees

    // ── Mountain environment — makes the jump feel embedded in a real ski resort ──
    {
    // Natural ungroomed snow — slightly darker and less specular than the prepared course
    const lsMat = makePBR('lsMat', scene);
    // The wide flanking snowfields. Brightened alongside snowMat for the same
    // reason — 0.71, 0.78, 0.87 is a grey-blue, and snow is one of the brightest
    // surfaces there is. Leaving this behind made the run surface and the ground
    // beside it two visibly different materials.
    lsMat.diffuseColor  = new BABYLON.Color3(0.90, 0.92, 0.95);
    lsMat.specularColor = new BABYLON.Color3(0.09, 0.12, 0.18);
    lsMat.specularPower = 7;

    // Rock face — for mountain bodies below the snow line
    const rockMat = makePBR('rockMat', scene);
    rockMat.diffuseColor  = new BABYLON.Color3(0.41, 0.37, 0.33);
    rockMat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);

    const valleyFloorY = terrainRootY(OUTRUN_Z) - FOOT_OFFSET;  // lowest playable surface

    // ── P1 slice 2 retired the six wide flank fills (wInrun/wTable/wLanding/
    //    wOutrun/wStartPlat) and the four corner_* junction slabs: the widened
    //    terrainCorridor field IS the ground now, continuous across the old
    //    seams and sharing snowMat everywhere (the cyan-seam class cannot
    //    recur). What stays is only the distant backdrop behind the start:
    // Upper mountain slope — continues the inrun angle upward behind the start gate.
    // This gives the impression the jump is midway down a much bigger mountain.
    {
        const extDepth = 90;
        const midExtZ  = SLOPE_START_Z - 27 - extDepth / 2;
        // Continue slope upward: at z units behind SLOPE_START_Z, y rises by z*tan(SLOPE_ANGLE)
        const midExtY  = (-midExtZ) * Math.tan(SLOPE_ANGLE) - FOOT_OFFSET;
        const depth    = extDepth / Math.cos(SLOPE_ANGLE) + 2;
        const wb = BABYLON.MeshBuilder.CreateBox('wUpperMtn', { width: 130, height: 1.6, depth }, scene);
        wb.rotation.x = SLOPE_ANGLE;
        wb.position.set(0, midExtY - 0.88, midExtZ + 0.12 * Math.sin(SLOPE_ANGLE));
        wb.material = lsMat;
    }


    // ── Venue dressing slice 1: blue B-net safety fencing on both edges (P3) ───
    // Author pull-forward (RENDER-PROGRESS; reference IMG_3523/3520/7841):
    // a continuous net along BOTH edges from the top of the in-run to past the
    // end of the out-run — thin dark posts every ~2.75 m standing on whatever
    // snow is beside the corridor (picked, never assumed), and ONE merged
    // alpha-cut strip mesh per side that sags ~7 cm between posts. Static,
    // display-only scenery: physics untouched, two strip draw calls total.
    {
        const NET_X        = 6.2;   // just outside the ribbon edge (±5), inside the tree-clear zone
        const POST_H       = 1.5;
        const NET_H        = 1.20;  // net height (IMG_7841 ≈ 1.2 m)
        const SAG          = 0.07;  // 5–8 cm mid-span sag
        const SPACING      = 2.75;
        const TILE         = 0.92;  // metres of net per texture repeat
        const FOOT_CLEAR   = 0.02;  // bottom edge rides 0–5 cm above the snow
        const RAY_Y        = 80;

        // slice 2: the field is ONE mesh now; wUpperMtn stays for rays that
        // reach past its rear edge behind the start.
        const groundRe = /^(terrainCorridor|wUpperMtn|terrainSkirt)/;
        // Picking gives the TRUE snow height beside the corridor (the flank
        // fills sit slightly below the physics plane). Headless test
        // environments (golden harness / unit stubs) carry no real Ray or
        // picking graph — there we fall back to the exact physics surface,
        // which is what those runs' determinism expects.
        const canPick = typeof scene.pickWithRay === 'function' && !!BABYLON.Ray;
        const groundAt = (x, z) => {
            if (canPick) {
                try {
                    const hit = scene.pickWithRay(
                        new BABYLON.Ray(new BABYLON.Vector3(x, RAY_Y, z),
                                        new BABYLON.Vector3(0, -1, 0), 150),
                        (m) => !!(m.name && groundRe.test(m.name)));
                    if (hit && hit.hit && hit.pickedPoint) {
                        return hit.pickedPoint.y;
                    }
                } catch (e) { /* fall through to the physics surface */ }
            }
            return terrainRootY(z) - FOOT_OFFSET;
        };

        // Net texture: transparent holes with a blue rope lattice woven across.
        const bnetTex = new BABYLON.DynamicTexture('bnetTex',
            { width: 128, height: 128 }, scene, true);
        const bc = bnetTex.getContext();
        bc.clearRect(0, 0, 128, 128);
        bc.strokeStyle = 'rgb(58,110,222)';
        // Thinner rope strands (reviewer order item 3: the weave read heavier
        // than IMG_3523; 7 px on the 128 px tile ≈ 3 cm rope at 1.2 m scale).
        bc.lineWidth = 5;
        bc.beginPath();
        for (let i = 0; i <= 4; i++) {
            const p = i * 32;
            bc.moveTo(p, 0);      bc.lineTo(p + 128, 128);   // diagonal weave /
            bc.moveTo(p, 128);    bc.lineTo(p + 128, 0);     // diagonal weave \, other direction
            bc.moveTo(0, p);      bc.lineTo(128, p);         // horizontal ropes
            bc.moveTo(0, p + 16); bc.lineTo(128, p + 16);
        }
        bc.stroke();
        bnetTex.update(false);
        bnetTex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        bnetTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        bnetTex.hasAlpha = true;

        const bnetMat = makePBR('bnetMat', scene);
        bnetMat.albedoTexture = bnetTex;
        bnetMat.albedoColor = new BABYLON.Color3(1, 1, 1);
        bnetMat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST;
        bnetMat.alphaCutOff = 0.5;
        bnetMat.backFaceCulling = false;
        bnetMat.metallic = 0;
        bnetMat.roughness = 0.85;

        const postMat = makePBR('bnetPostMat', scene);
        postMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.12);
        postMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.06);

        // Heights CANNOT be picked correctly during script evaluation (world
        // matrices of freshly built meshes are not final until the first
        // rendered frame — measured: every build-time pick missed or returned
        // garbage). So the fence is seeded from the exact physics profile and
        // RES EATED once after the first completed render, when picking is
        // truthful. Headless environments (golden/unit stubs) never render, so
        // they deterministically keep the seed seating.
        const SIDE_DEFS = [-1, 1].map((sideSign) => ({
            sideSign,
            x: sideSign * NET_X,
            sideName: sideSign < 0 ? '_L' : '_R',
            Z0: SLOPE_START_Z,
            Z1: OUTRUN_Z + 8,
        }));
        const stripMeshes = {};

        const nSpansOf = (d) => Math.max(2, Math.round((d.Z1 - d.Z0) / SPACING));
        const stationZ = (d, i) => d.Z0 + ((d.Z1 - d.Z0) * i) / nSpansOf(d);

        let postSrc = null;

        // Column-major translation matrices written by hand — identity with the
        // position in elements 12..14. Nothing here depends on any BABYLON math
        // helper, so headless test environments with partial stubs boot fine.
        const setPostMatrices = (arr) => {
            const mtx = new Float32Array(arr.length * 16);
            arr.forEach((p, i) => {
                const o = i * 16;
                mtx[o] = 1; mtx[o + 5] = 1; mtx[o + 10] = 1; mtx[o + 15] = 1;
                mtx[o + 12] = p.x;
                mtx[o + 13] = p.y + POST_H / 2;
                mtx[o + 14] = p.z;
            });
            try {
                postSrc.thinInstanceSetBuffer('matrix', mtx, 16, true);
                postSrc.thinInstanceRefreshBoundingInfo(true);
            } catch (e) { /* headless: source mesh stays put */ }
        };

        const seatSides = (picker) => {
            const postsOut = [];
            const samplesOut = [];
            for (const d of SIDE_DEFS) {
                // Ground under EVERY row (bottom edge rides 0–5 cm above the
                // local snow, whatever the flank fills do there).
                const nS = nSpansOf(d);
                const groundUnderRow = (z) => picker(d.x, z);
                const gzStations = [];
                for (let i = 0; i <= nS; i++) {
                    const z = stationZ(d, i);
                    gzStations.push({ z, gy: picker(d.x, z) });
                }

                const rows = [];
                let uLen = 0;
                for (let i = 0; i <= nS - 1; i++) {
                    const a = gzStations[i], b = gzStations[i + 1];
                    const len = Math.abs(b.z - a.z);
                    const startK = rows.length > 0 ? 1 : 0;
                    for (let k = startK; k <= 3; k++) {
                        const t = k / 3;
                        const z = a.z + (b.z - a.z) * t;
                        // Both edges derive from THIS ROW's own ground: the net
                        // drapes along the snow, following it through whatever
                        // the flank fills do (IMG_3523/7841). Station-to-station
                        // wire interpolation is NOT used for the fabric edges —
                        // fills step between zones, and an interpolated wire cut
                        // through the raised local snow (measured: sink −0.59 m
                        // at the table→landing boundary).
                        const g = groundUnderRow(z);
                        // Fence-scale contract (reviewer order item 3): the
                        // net's TOP edge sits NET_H above the local snow,
                        // sagging SAG toward mid-span — the old construction
                        // hung it off POST_H (≈1.4 m), reading a size class
                        // bigger than IMG_3523/7841.
                        const lift = NET_H - SAG * Math.sin(Math.PI * t);
                        rows.push({
                            z,
                            wireY: g + lift,
                            botY: g + FOOT_CLEAR,
                            u: (uLen + t * len) / TILE,
                            g,
                        });
                        samplesOut.push({ x: d.x, z, g,
                            yBot: g + FOOT_CLEAR, yTop: g + lift });
                    }
                    uLen += len;
                }

                postsOut.push({ x: d.x, y: gzStations[0].gy, z: gzStations[0].z });
                for (let i = 1; i <= nS; i++) {
                    postsOut.push({ x: d.x, y: gzStations[i].gy, z: gzStations[i].z });
                }

                const positions = [], normals = [], uvs = [], indices = [];
                for (const r of rows) {
                    positions.push(d.x, r.botY, r.z, d.x, r.wireY, r.z);
                    normals.push(d.sideSign, 0, 0, d.sideSign, 0, 0);
                    uvs.push(r.u, 0, r.u, 1);
                }
                for (let i = 0; i < rows.length - 1; i++) {
                    const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
                    indices.push(b0, b1, t0, t0, b1, t1);
                }

                let stripMesh = stripMeshes[d.sideName];
                if (!stripMesh) {
                    stripMesh = new BABYLON.Mesh('bnetStrip' + d.sideName, scene);
                    stripMesh.material = bnetMat;
                    stripMeshes[d.sideName] = stripMesh;
                }
                const vd = new BABYLON.VertexData();
                vd.positions = positions;
                vd.indices = indices;
                vd.normals = normals;
                vd.uvs = uvs;
                vd.applyToMesh(stripMesh);
            }

            if (postSrc) setPostMatrices(postsOut);

            window._bnetDebug = {
                posts: postsOut,
                samples: samplesOut,
                spanZ: [SIDE_DEFS[0].Z0, SIDE_DEFS[0].Z1],
                strips: ['bnetStrip_L', 'bnetStrip_R'],
                seated: !!picker.seated,
            };
        };

        // Seed pass — deterministic analytic profile, identical everywhere.
        seatSides((x, z) => terrainRootY(z) - FOOT_OFFSET);

        // Thin instances: one source cylinder, one draw call for every post.
        postSrc = BABYLON.MeshBuilder.CreateCylinder('bnetPost',
            { height: POST_H, diameterBottom: 0.058, diameterTop: 0.042, tessellation: 8 }, scene);
        postSrc.material = postMat;
        setPostMatrices(window._bnetDebug.posts);   // seed matrices, pre-reseat

        // Re-seat after the first COMPLETED render (world matrices honest).
        // addOnce on after-render means every mesh has been through its world-
        // matrix update at least once — measured working by the venue spec.
        if (typeof scene.onAfterRenderObservable !== 'undefined' &&
            scene.onAfterRenderObservable &&
            typeof BABYLON.Ray !== 'undefined' &&
            typeof scene.pickWithRay === 'function') {
            const reseat = () => {
                const picker = (x, z) => groundAt(x, z);
                picker.seated = true;
                seatSides(picker);
                window._bnetSeated = true;
            };
            scene.onAfterRenderObservable.addOnce(reseat);
        } else {
            window._bnetSeated = false;   // headless: keep the seed seating
        }
    }



    // ── Background mountain peaks — distributed to fill the horizon ────────────
    // Camera in side view looks from -X toward +X, so peaks at positive X form
    // the main backdrop. Peaks at large Z and at ±X add depth to the valley.
    const peaks = [
        // Main backdrop (behind the kicker — the prime spot from side view)
        { x:  72, z: KICKER_END_Z,       h: 54, rb: 62 },
        { x:  58, z: SLOPE_START_Z + 5,  h: 40, rb: 46 },
        { x:  90, z: OUTRUN_Z + 15,      h: 48, rb: 58 },
        // Behind the slope start (the mountain above)
        { x:   8, z: SLOPE_START_Z - 95, h: 72, rb: 85 },
        { x:  35, z: SLOPE_START_Z - 75, h: 50, rb: 58 },
        { x: -18, z: SLOPE_START_Z - 65, h: 44, rb: 52 },
        // Valley sides (left, deeper into fog)
        { x: -50, z: OUTRUN_Z - 15,      h: 36, rb: 45 },
        { x: -55, z: SLOPE_START_Z - 10, h: 42, rb: 50 },
        // Ahead (visible when soaring)
        { x:  55, z: OUTRUN_Z + 110,     h: 62, rb: 72 },
        { x:  80, z: OUTRUN_Z + 90,      h: 44, rb: 54 },
        { x: -28, z: OUTRUN_Z + 140,     h: 38, rb: 48 },
    ];
    peaks.forEach(function(m, i) {
        const bodyH = m.h * 0.80;
        const body = BABYLON.MeshBuilder.CreateCylinder('pk_body_' + i, {
            height: bodyH, diameterTop: m.rb * 0.12, diameterBottom: m.rb * 2, tessellation: 10
        }, scene);
        body.position.set(m.x, valleyFloorY + bodyH / 2 - 1.5, m.z);
        body.material = rockMat;

        // Snow cap on top third
        const capH = m.h * 0.32;
        const capR = m.rb * 0.28;
        const cap = BABYLON.MeshBuilder.CreateCylinder('pk_cap_' + i, {
            height: capH, diameterTop: 0, diameterBottom: capR * 2, tessellation: 10
        }, scene);
        cap.position.set(m.x, valleyFloorY + bodyH - capH / 2 - 1.5, m.z);
        cap.material = snowMat;
    });

    } // end mountain environment

    } // end !_trampolineMode terrain

    let poolDiveFaceBack   = false;
    let poolDiveFlipDirPref = 1;
    const _diveStanceHUD = document.getElementById('diveStanceHUD');
    function _updateDiveStanceHUD() {
        if (!_poolDiveMode || !_diveStanceHUD) return;
        const faceLbl = poolDiveFaceBack ? '◀ Backward' : '▶ Forward';
        const flipLbl = poolDiveFlipDirPref === 1 ? 'Back flip' : 'Front flip';
        _diveStanceHUD.textContent = `${faceLbl}  ·  ${flipLbl}`;
    }

    // ── Pool dive environment ────────────────────────────────────────────────
    if (_poolDiveMode) {
        // ── Pool geometry (walls + water surface + splash texture) ──────────
        const _pwMat = makePBR('poolWallMat', scene);
        _pwMat.diffuseColor = new BABYLON.Color3(0.50, 0.55, 0.62);
        const _pfMat = makePBR('poolFloorMat', scene);
        _pfMat.diffuseColor = new BABYLON.Color3(0.10, 0.28, 0.50);
        const _pCY = poolSurfaceY - POOL_DEPTH / 2 - POOL_WALL_T / 2;
        [   // [width, height, depth, x, y, z, material]
            [POOL_W+POOL_WALL_T*2, POOL_DEPTH+POOL_WALL_T, POOL_WALL_T,  0,                        _pCY, POOL_Z_START-POOL_WALL_T/2, _pwMat],
            [POOL_W+POOL_WALL_T*2, POOL_DEPTH+POOL_WALL_T, POOL_WALL_T,  0,                        _pCY, POOL_Z_END+POOL_WALL_T/2,   _pwMat],
            [POOL_WALL_T,          POOL_DEPTH+POOL_WALL_T, poolLen,      -(POOL_W/2+POOL_WALL_T/2), _pCY, poolCenterZ,               _pwMat],
            [POOL_WALL_T,          POOL_DEPTH+POOL_WALL_T, poolLen,       (POOL_W/2+POOL_WALL_T/2), _pCY, poolCenterZ,               _pwMat],
            [POOL_W,               POOL_WALL_T,            poolLen,       0, poolSurfaceY-POOL_DEPTH-POOL_WALL_T/2, poolCenterZ,     _pfMat],
        ].forEach(([w,h,d,x,y,z,mat], i) => {
            const wall = BABYLON.MeshBuilder.CreateBox(`poolWall_${i}`, { width:w, height:h, depth:d }, scene);
            wall.position.set(x, y, z);  wall.material = mat;
            poolWalls.push(wall);
        });

        // Animated vertex-grid water surface
        const WZ = 24, WX = 12;
        const _wVerts = (WZ+1)*(WX+1);
        const _wPos  = new Float32Array(_wVerts*3);
        const _wNorm = new Float32Array(_wVerts*3);
        const _wUV   = new Float32Array(_wVerts*2);
        const _wIdx  = [];
        let _wp = 0, _wu = 0;
        for (let iz = 0; iz <= WZ; iz++)
            for (let ix = 0; ix <= WX; ix++) {
                _wPos[_wp++] = -POOL_W/2 + (ix/WX)*POOL_W;
                _wPos[_wp++] = poolSurfaceY;
                _wPos[_wp++] = POOL_Z_START + (iz/WZ)*poolLen;
                _wNorm[_wp-3]=0; _wNorm[_wp-2]=1; _wNorm[_wp-1]=0;
                _wUV[_wu++] = ix/WX;  _wUV[_wu++] = iz/WZ;
            }
        for (let iz = 0; iz < WZ; iz++)
            for (let ix = 0; ix < WX; ix++) {
                const a = iz*(WX+1)+ix;
                _wIdx.push(a, a+WX+1, a+1, a+1, a+WX+1, a+WX+2);
            }
        waterMesh = new BABYLON.Mesh('waterSurface', scene);
        const _wVD = new BABYLON.VertexData();
        _wVD.positions = _wPos; _wVD.indices = _wIdx; _wVD.normals = _wNorm; _wVD.uvs = _wUV;
        _wVD.applyToMesh(waterMesh, true);
        const _wMat = makePBR('waterMat', scene);
        _wMat.diffuseColor = new BABYLON.Color3(0.07, 0.36, 0.72);
        _wMat.specularColor = new BABYLON.Color3(0.65, 0.85, 1.0);
        _wMat.specularPower = 90;
        _wMat.alpha = 0.82;
        _wMat.backFaceCulling = false;
        waterMesh.material = _wMat;

        // Splash particle texture — droplet with bright core + specular highlight
        _splashTex = new BABYLON.DynamicTexture('splashTex', { width:128, height:128 }, scene, false);
        { const _c = _splashTex.getContext();
          const _g = _c.createRadialGradient(64,64,0,64,64,64);
          _g.addColorStop(0,    'rgba(255,255,255,1.0)');
          _g.addColorStop(0.12, 'rgba(220,240,255,1.0)');
          _g.addColorStop(0.35, 'rgba(140,210,255,0.85)');
          _g.addColorStop(0.65, 'rgba(80,170,255,0.45)');
          _g.addColorStop(1.0,  'rgba(40,120,220,0.0)');
          _c.fillStyle = _g; _c.beginPath(); _c.arc(64,64,64,0,Math.PI*2); _c.fill();
          // Small specular glint offset from center
          const _sg = _c.createRadialGradient(52,50,0,52,50,14);
          _sg.addColorStop(0,   'rgba(255,255,255,0.8)');
          _sg.addColorStop(1,   'rgba(255,255,255,0.0)');
          _c.fillStyle = _sg; _c.beginPath(); _c.arc(52,50,14,0,Math.PI*2); _c.fill();
          _splashTex.update(); }

        // ── Outdoor pool deck ────────────────────────────────────────────────
        const _deckMat = makePBR('deckMat', scene);
        _deckMat.diffuseColor = new BABYLON.Color3(0.72, 0.72, 0.68);
        // Deck top sits at pool rim level (poolSurfaceY), NOT across the opening
        const _deckTopY = poolSurfaceY;
        const _deckH = 0.3;
        const _deckCY = _deckTopY - _deckH / 2;
        const _deckExt = 4.0; // how far deck extends beyond pool wall on each side
        const _rimZ0 = POOL_Z_START - POOL_WALL_T;
        const _rimZ1 = POOL_Z_END   + POOL_WALL_T;
        const _rimX  = POOL_W / 2   + POOL_WALL_T;
        // 4 panels surrounding the pool — none covers the opening
        [
            { w: _rimX*2 + _deckExt*2, d: _deckExt, x: 0,              z: _rimZ0 - _deckExt/2 }, // back
            { w: _rimX*2 + _deckExt*2, d: _deckExt, x: 0,              z: _rimZ1 + _deckExt/2 }, // front
            { w: _deckExt,             d: poolLen + POOL_WALL_T*2, x: -(_rimX + _deckExt/2), z: poolCenterZ }, // left
            { w: _deckExt,             d: poolLen + POOL_WALL_T*2, x:  (_rimX + _deckExt/2), z: poolCenterZ }, // right
        ].forEach((p, i) => {
            const panel = BABYLON.MeshBuilder.CreateBox(`deck_${i}`,
                { width: p.w, height: _deckH, depth: p.d }, scene);
            panel.position.set(p.x, _deckCY, p.z);
            panel.material = _deckMat;
        });

        // ── Three separate diving towers alongside the pool ──────────────────
        const _platMat = makePBR('platMat', scene);
        _platMat.diffuseColor = new BABYLON.Color3(0.55, 0.58, 0.65);
        const _railMat = makePBR('railMat', scene);
        _railMat.diffuseColor = new BABYLON.Color3(0.85, 0.87, 0.9);

        PLATFORM_CONFIGS.forEach((cfg, li) => {
            const platY   = poolSurfaceY + cfg.height;
            const towerH  = platY - 0.18 - _deckTopY;
            // Tower at shore, offset in X
            const tower = BABYLON.MeshBuilder.CreateBox(`diveTower_${li}`,
                { width: 0.6, height: towerH, depth: 0.6 }, scene);
            tower.position.set(cfg.x, _deckTopY + towerH / 2, POOL_DIVE_SHORE_Z - 0.8);
            tower.material = _platMat;
            // Board (top surface = platY)
            const brd = BABYLON.MeshBuilder.CreateBox(`diveBoard_${li}`,
                { width: 1.8, height: 0.18, depth: 2.0 }, scene);
            brd.position.set(cfg.x, platY - 0.09, POOL_DIVE_SHORE_Z - 0.2);
            brd.material = _platMat;
            // Handrails
            [-0.85, 0.85].forEach((rx, ri) => {
                const rail = BABYLON.MeshBuilder.CreateCylinder(`diveRail_${li}_${ri}`,
                    { height: 1.0, diameter: 0.06, tessellation: 8 }, scene);
                rail.position.set(cfg.x + rx, platY + 0.41, POOL_DIVE_SHORE_Z - 0.9);
                rail.material = _railMat;
            });
        });

        // Sky backdrop
        const _skyMat = makePBR('skyMat', scene);
        _skyMat.diffuseColor  = new BABYLON.Color3(0.42, 0.68, 0.92);
        _skyMat.emissiveColor = new BABYLON.Color3(0.42, 0.68, 0.92);
        _skyMat.backFaceCulling = false;
        const _sky = BABYLON.MeshBuilder.CreatePlane('sky', { width: 80, height: 40 }, scene);
        _sky.position.set(0, poolSurfaceY + 8, poolCenterZ + 30);
        _sky.material = _skyMat;

        // ── Platform dropdown handler ────────────────────────────────────────
        // Hide world/jump selector — not relevant in pool dive mode
        const _wm = document.getElementById('worldMenu');
        if (_wm) _wm.style.display = 'none';
        const _platSelWrap = document.getElementById('platformSelectWrap');
        const _platSel     = document.getElementById('platformSelect');
        if (_platSelWrap) _platSelWrap.style.display = 'block';
        if (_diveStanceHUD) { _diveStanceHUD.style.display = 'block'; _updateDiveStanceHUD(); }
        if (_platSel) {
            _platSel.value = String(activePlatIdx);
            _platSel.addEventListener('change', () => {
                switchPlatform(parseInt(_platSel.value));
                // Reset diver to new platform
                poolEntered = false; poolDivePushing = false; poolAutoLaunch = false;
                poolSplashAmp = 0; poolEntryDrag = 5.5;
                readyState = true;
                state.posZ = POOL_DIVE_PLATFORM_Z;
                state.rootY = POOL_DIVE_ROOT_Y;
                state.vy = 0; state.vz = 0;
                state.grounded = true; state.stopped = false; state.crashed = false;
                state.flipAngle = 0; state.spinAngle = 0; state.spinTarget = 0;
                state.tuckAmount = 0; state.tuckTarget = 0;
                state.pikeAmount = 0; state.pikeTarget = 0;
                state.armDropL = 1; state.armDropR = 1;
                state.armRaise = 0; state.armRaiseTarget = 0;
                state.L_flip = I0 * TARGET_OMEGA_UNTUCKED;
                flipPower = 0; pmFill.style.width = '0%';
                billboard.isVisible = false;
            });
        }
    }

    // ── Trampoline spring & grid state ──────────────────────────────────────
    let tramBedMesh    = null;   // invisible spring node
    let tramFrameRails = [];     // 4 visible metal frame rails
    let tramFrameMesh  = null;   // alias to first rail (for compat)
    let tramGridMesh   = null;   // deformable jumping surface
    let tramGridLines  = null;   // grid line overlay (updatable)
    let tramGridPosArr = null;   // persistent positions array for mesh updates
    let tramGridIdxArr = null;
    let tramSpringY    = 0;
    let tramSpringVY   = 0;
    let tramBouncing   = false;   // true while player rides the spring down+up
    let tramSavedReboundVY = 0;   // launch speed saved at contact
    let tramContactNX  = 0;       // normalized (-1..1) contact X on trampoline surface
    let tramContactNZ  = 0;       // normalized (-1..1) contact Z on trampoline surface
    const TRAM_BED_REST_Y   = TRAMPOLINE_Y - FOOT_OFFSET - 0.04;

    const TRAM_FRAME_REST_Y = TRAMPOLINE_Y - FOOT_OFFSET - 0.06;
    const TRAM_GRID_REST_Y  = TRAMPOLINE_Y - FOOT_OFFSET;
    const TRAM_SPRING_K     = 90;
    const TRAM_SPRING_DAMP  = 5;
    const TRAM_GRID_COLS    = 20;
    const TRAM_GRID_ROWS    = 20;
    const TRAM_GRID_W       = 6.0;
    const TRAM_GRID_D       = 6.0;
    const tramGridNXZ       = []; // [nx0,nz0, nx1,nz1, ...] per vertex
    // Builds the deformed line positions for the grid overlay
    function buildTramLines(sy) {
        const off = 0.003;
        const lines = [];
        function deformY(c, r) {
            const nx = (c / TRAM_GRID_COLS) * 2 - 1;
            const nz = (r / TRAM_GRID_ROWS) * 2 - 1;
            const dx = nx - tramContactNX;
            const dz = nz - tramContactNZ;
            const edgePin = Math.sqrt(Math.max(0, (1 - nx*nx) * (1 - nz*nz)));
            const wide    = Math.exp(-(dx*dx + dz*dz) * 0.35);
            const local   = Math.exp(-(dx*dx + dz*dz) * 4.0) * 0.35;
            const f       = (wide + local) * edgePin;
            return sy * f + off;
        }
        for (let r = 0; r <= TRAM_GRID_ROWS; r++) {
            const row = [];
            for (let c = 0; c <= TRAM_GRID_COLS; c++) {
                row.push(new BABYLON.Vector3(
                    (c / TRAM_GRID_COLS - 0.5) * TRAM_GRID_W,
                    deformY(c, r),
                    (r / TRAM_GRID_ROWS - 0.5) * TRAM_GRID_D
                ));
            }
            lines.push(row);
        }
        for (let c = 0; c <= TRAM_GRID_COLS; c++) {
            const col = [];
            for (let r = 0; r <= TRAM_GRID_ROWS; r++) {
                col.push(new BABYLON.Vector3(
                    (c / TRAM_GRID_COLS - 0.5) * TRAM_GRID_W,
                    deformY(c, r),
                    (r / TRAM_GRID_ROWS - 0.5) * TRAM_GRID_D
                ));
            }
            lines.push(col);
        }
        return lines;
    }

    if (_trampolineMode) {
        // ── Trampoline frame & deformable bed ─────────────────────────────
        const frameMat = makePBR('frameMat', scene);
        frameMat.diffuseColor  = new BABYLON.Color3(0.55, 0.55, 0.55);
        frameMat.specularColor = new BABYLON.Color3(0.80, 0.80, 0.80);
        frameMat.specularPower = 60;

        // Invisible spring node
        tramBedMesh = new BABYLON.TransformNode('tramBed', scene);
        tramBedMesh.position.set(0, TRAM_BED_REST_Y, 0);

        // ── Border lip around pit (replaces raised frame rails) ──────────
        const RAIL_T = 0.22;  // border thickness — matches PIT_HALF overhang
        const RAIL_H = 0.12;  // sits flush at floor level
        const FX = TRAM_GRID_W / 2 + RAIL_T / 2;  // x-center of side rails
        const FZ = TRAM_GRID_D / 2 + RAIL_T / 2;  // z-center of end rails
        const FRAME_Y = TRAM_FRAME_REST_Y + 0.06;  // sit right at floor surface
        const railDefs = [
            { w: TRAM_GRID_W + RAIL_T * 2, d: RAIL_T, x: 0,   z: -FZ },  // front
            { w: TRAM_GRID_W + RAIL_T * 2, d: RAIL_T, x: 0,   z:  FZ },  // back
            { w: RAIL_T, d: TRAM_GRID_D,              x: -FX,  z: 0  },  // left
            { w: RAIL_T, d: TRAM_GRID_D,              x:  FX,  z: 0  },  // right
        ];
        railDefs.forEach((r, i) => {
            const rail = BABYLON.MeshBuilder.CreateBox('tramRail_' + i,
                { width: r.w, height: RAIL_H, depth: r.d }, scene);
            rail.position.set(r.x, FRAME_Y, r.z);
            rail.material = frameMat;
            tramFrameRails.push(rail);
        });
        tramFrameMesh = tramFrameRails[0];

        // ── Pit walls (inground) ──────────────────────────────────────────
        const pitMat = makePBR('pitMat', scene);
        pitMat.diffuseColor  = new BABYLON.Color3(0.55, 0.50, 0.45);
        pitMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        const PIT_W = TRAM_GRID_W + 0.44;  // matches hole in floor (PIT_HALF*2)
        const PIT_D = TRAM_GRID_D + 0.44;
        const PIT_DEPTH_MESH = 1.5;
        const pitWallY = TRAM_GRID_REST_Y - PIT_DEPTH_MESH / 2;
        // Front & back walls
        [[-PIT_D / 2, 0], [PIT_D / 2, 0]].forEach(([pz], i) => {
            const w = BABYLON.MeshBuilder.CreateBox('pitWallFB_' + i,
                { width: PIT_W, height: PIT_DEPTH_MESH, depth: 0.08 }, scene);
            w.position.set(0, pitWallY, pz);
            w.material = pitMat;
        });
        // Left & right walls
        [[-PIT_W / 2, 0], [PIT_W / 2, 0]].forEach(([px], i) => {
            const w = BABYLON.MeshBuilder.CreateBox('pitWallLR_' + i,
                { width: 0.08, height: PIT_DEPTH_MESH, depth: PIT_D }, scene);
            w.position.set(px, pitWallY, 0);
            w.material = pitMat;
        });
        // Pit floor
        const pitFloor = BABYLON.MeshBuilder.CreateBox('pitFloor',
            { width: PIT_W, height: 0.10, depth: PIT_D }, scene);
        pitFloor.position.set(0, TRAM_GRID_REST_Y - PIT_DEPTH_MESH, 0);
        pitFloor.material = pitMat;

        // ── Deformable jumping surface (6 × 10 = 60 quads) ────────────────
        const gPos = [], gIdx = [], gUV = [];
        for (let r = 0; r <= TRAM_GRID_ROWS; r++) {
            for (let c = 0; c <= TRAM_GRID_COLS; c++) {
                gPos.push(
                    (c / TRAM_GRID_COLS - 0.5) * TRAM_GRID_W,
                    0,
                    (r / TRAM_GRID_ROWS - 0.5) * TRAM_GRID_D
                );
                gUV.push(c / TRAM_GRID_COLS, r / TRAM_GRID_ROWS);
                tramGridNXZ.push(
                    (c / TRAM_GRID_COLS) * 2 - 1,
                    (r / TRAM_GRID_ROWS) * 2 - 1
                );
            }
        }
        for (let r = 0; r < TRAM_GRID_ROWS; r++) {
            for (let c = 0; c < TRAM_GRID_COLS; c++) {
                const a = r * (TRAM_GRID_COLS + 1) + c;
                gIdx.push(a, a + TRAM_GRID_COLS + 1, a + 1,
                           a + 1, a + TRAM_GRID_COLS + 1, a + TRAM_GRID_COLS + 2);
            }
        }
        const gNrm = new Array(gPos.length).fill(0);
        BABYLON.VertexData.ComputeNormals(gPos, gIdx, gNrm);
        const gVD = new BABYLON.VertexData();
        gVD.positions = gPos; gVD.indices = gIdx; gVD.normals = gNrm; gVD.uvs = gUV;
        tramGridMesh = new BABYLON.Mesh('tramGrid', scene);
        gVD.applyToMesh(tramGridMesh, true);
        tramGridMesh.position.y = TRAM_GRID_REST_Y;
        tramGridPosArr = gPos.slice();
        tramGridIdxArr = gIdx.slice();
        const gridSurfMat = makePBR('gridSurfMat', scene);
        gridSurfMat.diffuseColor    = new BABYLON.Color3(0.07, 0.07, 0.09);
        gridSurfMat.backFaceCulling = false;
        tramGridMesh.material = gridSurfMat;

        // Grid line overlay (updatable)
        tramGridLines = BABYLON.MeshBuilder.CreateLineSystem('tramGridLines',
            { lines: buildTramLines(0), updatable: true }, scene);
        tramGridLines.color = new BABYLON.Color3(0.30, 0.30, 0.35);
        tramGridLines.position.y = TRAM_GRID_REST_Y;
    }

    // ── Physics state ─────────────────────────────────────────────────────────
    //
    // FLIP:  L_flip = I · ω is set at takeoff and NEVER changes in the air.
    //        This is always a BACKFLIP — direction is fixed, cannot be reversed.
    //        Tuck changes I, so ω = L_flip / I varies, but L_flip stays constant.
    //
    // SPIN:  Separate rotation axis (Y). Can be initiated mid-air via arm drops.
    //        Stub only in Phase 1 — tracked in state, shown in HUD, not animated.
    //
    const TARGET_OMEGA_UNTUCKED = _physicsCfg.TARGET_OMEGA_UNTUCKED; // rad/s at full extension
    const MAX_OMEGA = 12.0;            // rad/s cap — limits tucked flip speed
    const I0 = computeI(0);            // I at tuck = 0 (fully extended)

    const SPIN_SPEED    = Math.PI * 2.0 * (_worldParam === 'custom' ? _customFlipSpeed : _worldParam === 'trampoline' ? 1.3 : _worldParam === 'quint' ? 1.55 : _worldParam === 'quad' ? 1.62 : _worldParam === 'triple' ? 1.6 : _worldParam === 'single' ? 0.68 : 1.08); // rad/s ~= 1.0 full twist/second
    const ARM_DROP_RATE = 4.0;            // arm transitions in ~0.25 s
    const GRAVITY       = _physicsCfg.GRAVITY;  // world-units / s²

    const state = {
        L_flip:     I0 * TARGET_OMEGA_UNTUCKED,
        flipAngle:  0.0,
        tuckAmount: 0.0,
        tuckTarget: 0.0,
        pikeAmount: 0.0,
        pikeTarget: 0.0,
        pikeArmDrop: 0.0,    // 0-1: drives arms from pike-forward down to sides on release
        pikeReleaseOmega: 0, // omega captured at the moment pike key was released
        flipDir:    1,    // +1 = backflip, -1 = frontflip
        spinAngle:  0.0,  // current spin angle (rad)
        spinTarget: 0.0,  // target spin; each tap adds ±2π
        spinMult:   1.0,  // spin speed multiplier
        doubleDir:  1,    // +1 = left twist, -1 = right twist (used in double mode)
        armDropL:   1.0,  // 0 = raised, 1 = dropped to side
        armDropR:   1.0,
        rootY:      _poolDiveMode ? POOL_DIVE_ROOT_Y : 0.0,  // world Y of character root
        vy:         0.0,  // vertical velocity (world-units/s)
        posZ:       _trampolineMode ? 0 : _trampolineMatMode ? 4.0 : _poolDiveMode ? POOL_DIVE_PLATFORM_Z : SLOPE_START_Z + 2.0, // start near top of inrun (or trampoline center)
        vz:         0.0,  // Z velocity — frictionless, only gravity along slope
        grounded:   true,
        crashed:    false, // true when landed badly
        crashAngle: 0.0,  // target flip angle to animate toward after crash
        stopped:    false, // true once vz reaches 0 on outrun
        // Per-flip twist tracking
        perFlipTwists:   [],   // twists done in each completed flip
        lastFlipInt:     0,    // floor(|flipAngle|/2π) at last frame
        frontFlipCount:  0,    // completed front flip rotations in current sequence
        spinAtFlipStart: 0.0,  // spinAngle when current flip began
        spinBoundaries:  [],   // spinAngle values recorded at each flip boundary
        perFlipTucked:   [],   // true for each completed flip where tuck was used
        currentFlipTucked: false, // whether tuck has been pressed in the current flip
        trickName:       '',   // computed at landing
        execution:       0,    // out of 37 at landing
        armSnap:         0.0,  // 0-1: blend toward POSE_ARMS_50DEG
        layArmT:         0.0,  // 0-1: blend arms toward T-pose during lay
        armSnapTarget:   0,
        armRaise:        0.0,  // 0-1: blend arms straight up
        armRaiseTarget:  0,
        airTime:         0.0,  // seconds in air on current jump
        landingLean:    0.0,  // post-landing body lean (rad, signed: + forward, − backward)
        landingLeanVel: 0.0,  // angular velocity of landing lean
        offAxis:        0.0,  // current off-axis lean angle (rad): + = right, − = left
    };

    let offAxisTarget   = 0.0;
    let leftDown        = false;
    let rightDown       = false;
    let autoSpinActive  = false;
    let _gpArmLX = 0, _gpArmLY = 0, _gpArmRX = 0, _gpArmRY = 0;
    let _armVelL = 0, _armVelR = 0; // physical arm spring velocities (units/s)
    let _armPosL = 0, _armPosR = 0; // physical arm positions from spring sim (0=up, 1=down)
    let gpSpinL = 0; // gamepad spin angular momentum (conserved in air)
    let _gpXPrev = false, _gpCirclePrev = false, _gpLTPrev = false;
    let armSwapPhase    = false; // true during quick arm swap at takeoff
    let armSwapDir      = 0;    // +1 = left twists (left arm was up), -1 = right twists // true while arm-up takeoff twists are running

    // ── Replay recording ───────────────────────────────────────────────────
    let replayFrames    = [];   // recorded frames from last run
    let lastRunFrames   = [];   // saved frames from the run before the last restart
    let recordingActive = false; // true while actively recording
    let replayActive    = false; // true while playing back replay
    let replayIndex     = 0;    // current frame in playback
    const replayBtn     = document.getElementById('replayBtn');
    function startRecording() {
        replayFrames    = [];
        recordingActive = true;
    }
    function stopRecording() {
        recordingActive = false;
        if (replayBtn) replayBtn.disabled = replayFrames.length === 0;
    }
    function recordFrame() {
        replayFrames.push({
            posZ:       state.posZ,
            rootY:      state.rootY,
            flipAngle:  state.flipAngle,
            spinAngle:  state.spinAngle,
            tuckAmount:  state.tuckAmount,
            pikeAmount:  state.pikeAmount,
            pikeArmDrop: state.pikeArmDrop,
            armDropL:    state.armDropL,
            armDropR:   state.armDropR,
            armSnap:    state.armSnap,
            layArmT:    state.layArmT,
            armRaise:   state.armRaise,
            grounded:   state.grounded,
            crashed:    state.crashed,
            readyYaw:   (readyState && !_poolDiveMode) ? (1.0 - readyTurnT) * (Math.PI / 2) : 0.0,
        });
    }
    if (replayBtn) {
        replayBtn.disabled = true;
        const replaySpeedWrap = document.getElementById('replaySpeedWrap');
        const replaySpeedEl   = document.getElementById('replaySpeed');
        const replaySpeedVal  = document.getElementById('replaySpeedVal');
        if (replaySpeedEl) {
            replaySpeedEl.addEventListener('input', () => {
                if (replaySpeedVal) replaySpeedVal.textContent = parseFloat(replaySpeedEl.value).toFixed(2).replace(/\.?0+$/, '') + '×';
            });
        }
        replayBtn.addEventListener('click', () => {
            const frames = replayFrames.length ? replayFrames : lastRunFrames;
            if (!frames.length) return;
            replayActive = true;
            replayIndex  = 0;
            replayAccum  = 0;
            paused       = false;
            replayFrames = frames.slice(); // copy so a mid-replay reset doesn't clobber playback
            if (replaySpeedWrap) replaySpeedWrap.classList.add('visible');
        });
    }
    let replayAccum  = 0;    // fractional frame accumulator for speed control

    // ── Pool state ───────────────────────────────────────────────────────────
    let poolVisible        = _poolDiveMode;
    let poolEntered        = false;
    let poolAutoLaunch     = false;
    let poolDivePushing    = false; // true during leg-extension push-off before launch
    let _poolDiveLaunchPwr = 0;     // flipPower captured at push-off trigger
    let poolEntryDrag  = 5.5;

    // Defined here (not inside if block) so restart handler can always call it
    function switchPlatform(idx) {
        activePlatIdx        = idx;
        const cfg            = PLATFORM_CONFIGS[idx];
        POOL_DIVE_PLATFORM_Z = POOL_DIVE_TIP_Z;
        POOL_DIVE_PLATFORM_X = cfg.x;
        POOL_DIVE_PLATFORM_Y = poolSurfaceY + cfg.height;
        POOL_DIVE_ROOT_Y     = POOL_DIVE_PLATFORM_Y + FOOT_OFFSET;
    }   // drag coefficient while in water (computed from entry quality)
    let poolWaveT      = 0;
    let poolSplashAmp  = 0;
    let poolSplashImpX = 0;
    let poolSplashImpZ = poolCenterZ;

    function _spawnSplash(impX, impZ, entrySpeed, entryQuality) {
        if (!_splashTex) return;
        // qual 1 = clean vertical entry, 0 = belly/back flop
        const spd   = Math.min(entrySpeed || 8, 20);
        const qual  = entryQuality !== undefined ? entryQuality : 0.5;
        const splat = 1 - qual;          // 0 = clean, 1 = full flop
        const speedScale = 0.6 + spd / 20;

        const origin = new BABYLON.Vector3(impX, poolSurfaceY + 0.02, impZ);
        const BM = BABYLON.ParticleSystem.BLENDMODE_ONEONE;

        // ── 1. Ripple — always present; tiny on clean entries ─────────────────
        {
            const rippleCount = Math.round(20 + 30 * splat);  // 20 clean → 50 flop
            const pRipple = new BABYLON.ParticleSystem('splash_ripple', rippleCount, scene);
            pRipple.particleTexture = _splashTex;
            pRipple.emitter    = origin.clone();
            pRipple.minEmitBox = new BABYLON.Vector3(-0.05, 0, -0.05);
            pRipple.maxEmitBox = new BABYLON.Vector3( 0.05, 0,  0.05);
            pRipple.color1     = new BABYLON.Color4(0.75, 0.92, 1.00, 0.65);
            pRipple.color2     = new BABYLON.Color4(0.90, 0.98, 1.00, 0.45);
            pRipple.colorDead  = new BABYLON.Color4(0.50, 0.80, 1.00, 0.00);
            pRipple.minSize    = 0.03;  pRipple.maxSize     = 0.10 + 0.08 * splat;
            pRipple.minLifeTime= 0.5;   pRipple.maxLifeTime = 1.6;
            pRipple.emitRate   = 0;     pRipple.manualEmitCount = rippleCount;
            pRipple.direction1 = new BABYLON.Vector3(-2.5, 0.4, -2.5);
            pRipple.direction2 = new BABYLON.Vector3( 2.5, 1.2,  2.5);
            pRipple.minAngularSpeed = 0;  pRipple.maxAngularSpeed = 0.5;
            pRipple.minEmitPower= 0.15;  pRipple.maxEmitPower = 0.9 + 0.6 * splat;
            pRipple.updateSpeed = 0.016;
            pRipple.gravity     = new BABYLON.Vector3(0, -2.5, 0);
            pRipple.blendMode   = BM;
            pRipple.start();
            setTimeout(() => { try { pRipple.dispose(); } catch(_){} }, 2500);
        }

        // ── 2. Crown spray — only on bad/flopped entries ──────────────────────
        if (splat > 0.15) {
            const crownCount = Math.round(200 * splat * speedScale);
            const pCrown = new BABYLON.ParticleSystem('splash_crown', crownCount, scene);
            pCrown.particleTexture = _splashTex;
            pCrown.emitter    = origin.clone();
            pCrown.minEmitBox = new BABYLON.Vector3(-0.20, 0, -0.20);
            pCrown.maxEmitBox = new BABYLON.Vector3( 0.20, 0,  0.20);
            pCrown.color1     = new BABYLON.Color4(0.70, 0.90, 1.00, 0.95);
            pCrown.color2     = new BABYLON.Color4(0.88, 0.97, 1.00, 0.75);
            pCrown.colorDead  = new BABYLON.Color4(0.35, 0.65, 0.95, 0.00);
            pCrown.minSize    = 0.06;   pCrown.maxSize     = 0.26 * speedScale;
            pCrown.minLifeTime= 0.5;    pCrown.maxLifeTime = 1.8;
            pCrown.emitRate   = 0;      pCrown.manualEmitCount = crownCount;
            const cSpread = 4.0 + 5.0 * splat;
            pCrown.direction1 = new BABYLON.Vector3(-cSpread, 2.0 * splat, -cSpread);
            pCrown.direction2 = new BABYLON.Vector3( cSpread, 7.0 * splat,  cSpread);
            pCrown.minAngularSpeed = 0;  pCrown.maxAngularSpeed = Math.PI;
            pCrown.minEmitPower= 1.0;   pCrown.maxEmitPower = 5.0 * speedScale * splat;
            pCrown.updateSpeed = 0.016;
            pCrown.gravity     = new BABYLON.Vector3(0, -11, 0);
            pCrown.blendMode   = BM;
            pCrown.start();
            setTimeout(() => { try { pCrown.dispose(); } catch(_){} }, 3500);
        }

        // ── 3. Mist — only on bad/flopped entries ────────────────────────────
        if (splat > 0.15) {
            const mistCount = Math.round(80 * splat * speedScale);
            const pMist = new BABYLON.ParticleSystem('splash_mist', mistCount, scene);
            pMist.particleTexture = _splashTex;
            pMist.emitter    = origin.clone();
            pMist.minEmitBox = new BABYLON.Vector3(-0.30, 0, -0.30);
            pMist.maxEmitBox = new BABYLON.Vector3( 0.30, 0,  0.30);
            pMist.color1     = new BABYLON.Color4(0.85, 0.95, 1.00, 0.50);
            pMist.color2     = new BABYLON.Color4(1.00, 1.00, 1.00, 0.40);
            pMist.colorDead  = new BABYLON.Color4(0.60, 0.85, 1.00, 0.00);
            pMist.minSize    = 0.06;   pMist.maxSize     = 0.20;
            pMist.minLifeTime= 0.8;    pMist.maxLifeTime = 2.5;
            pMist.emitRate   = 0;      pMist.manualEmitCount = mistCount;
            pMist.direction1 = new BABYLON.Vector3(-6.0 * splat, 0.3, -6.0 * splat);
            pMist.direction2 = new BABYLON.Vector3( 6.0 * splat, 1.8,  6.0 * splat);
            pMist.minAngularSpeed = 0;  pMist.maxAngularSpeed = 0.7;
            pMist.minEmitPower= 0.2;   pMist.maxEmitPower = 2.0 * speedScale * splat;
            pMist.updateSpeed = 0.016;
            pMist.gravity     = new BABYLON.Vector3(0, -2.5, 0);
            pMist.blendMode   = BM;
            pMist.start();
            setTimeout(() => { try { pMist.dispose(); } catch(_){} }, 4500);
        }
    }

    // ── Snow particle helpers for ski jump (kicker spray + landing burst) ───────
    function _spawnSnowBurst(posX, posY, posZ, count, speedScale) {
        if (_trampolineMode || _poolDiveMode) return;
        const BM  = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        if (!_spawnSnowBurst._tex) {
            const _c = document.createElement('canvas'); _c.width = _c.height = 32;
            const _cx = _c.getContext('2d');
            const _g = _cx.createRadialGradient(16, 16, 0, 16, 16, 16);
            _g.addColorStop(0, 'rgba(255,255,255,1)'); _g.addColorStop(1, 'rgba(255,255,255,0)');
            _cx.fillStyle = _g; _cx.fillRect(0, 0, 32, 32);
            _spawnSnowBurst._tex = new BABYLON.Texture(_c.toDataURL(), scene);
        }
        const tex = _spawnSnowBurst._tex;
        const origin = new BABYLON.Vector3(posX, posY, posZ);
        const ps = new BABYLON.ParticleSystem('snowBurst', count, scene);
        ps.particleTexture = tex;
        ps.emitter    = origin;
        ps.minEmitBox = new BABYLON.Vector3(-0.30, 0, -0.20);
        ps.maxEmitBox = new BABYLON.Vector3( 0.30, 0,  0.20);
        ps.color1     = new BABYLON.Color4(0.95, 0.98, 1.00, 0.90);
        ps.color2     = new BABYLON.Color4(0.80, 0.90, 1.00, 0.60);
        ps.colorDead  = new BABYLON.Color4(0.70, 0.85, 1.00, 0.00);
        ps.minSize    = 0.06;   ps.maxSize     = 0.22;
        ps.minLifeTime= 0.4;    ps.maxLifeTime = 1.2;
        ps.emitRate   = 0;      ps.manualEmitCount = count;
        ps.direction1 = new BABYLON.Vector3(-3.5 * speedScale, 2.0 * speedScale, -2.5 * speedScale);
        ps.direction2 = new BABYLON.Vector3( 3.5 * speedScale, 5.5 * speedScale,  2.5 * speedScale);
        ps.minAngularSpeed = 0;  ps.maxAngularSpeed = 1.5;
        ps.minEmitPower    = 0.3 * speedScale;
        ps.maxEmitPower    = 1.8 * speedScale;
        ps.updateSpeed     = 0.016;
        ps.gravity         = new BABYLON.Vector3(0, -6, 0);
        ps.blendMode       = BM;
        ps.start();
        setTimeout(() => { try { ps.dispose(); } catch(_){} }, 2000);
    }

    let leftArmHoldTime = 0;    // seconds right arrow held alone on inrun (left arm up)
    let rightArmHoldTime= 0;    // seconds left arrow held alone on inrun (right arm up)
    const ARM_HOLD_REQ  = 0.5;  // seconds arm must be up before jump
    let downHalfTwistFired = false; // true after down fires a half-twist mid-air
    const RIGHT_HALF_TWIST_HOLD = 0.05; // hold right alone this long mid-air → half twist left
    let paused          = false;
    let cameraMode      = 2;     // 0=side  1=front  2=back  (C cycles)
    let firstPersonMode = false; // true = FP camera from skier's eyes (V toggles)
    let powerWrapDown   = false; // down arrow held → 1.3× spin rate
    let arrowUpDown     = false; // up arrow held mid-air → gradually slow flip
    let targetL_flip    = 0.0;   // target L_flip to recover toward when arrow released
    let frontFlipQueued    = false; // up pressed in air → do front flip on next bounce
    let singleLayoutMode   = false; // active during air phase: cap rotation to 1 flip
    let singleFlipQueued   = false; // D pressed while grounded → apply on next launch
    let crashActive        = false; // true while ragdoll animation is running
    let crashTimer         = 0;
    let crashFallDir       = 1;
    let crashPieces        = [];   // detached body-part physics pieces (legacy path, retired by the P11 ragdoll)
    let ragdoll            = null; // coherent crash ragdoll state (P11)

    // ── P11: coherent crash ragdoll (renderer-side, ADR-0002) ────────────────
    // A crash is display: the engine already decided the landing failed and
    // froze state.vz. Instead of hiding the skinned body and flinging the
    // legacy driver solids apart, the athlete STAYS the skinned body and a
    // position-based ragdoll takes over the driver transforms for the crash
    // duration (applyPose is gated off while crashActive; the bones follow the
    // drivers via linkTransformNode exactly as in normal play).
    //
    // Model: 15 verlet particles (shared joint particles, so every joint gap is
    // 0 by construction), one stick per body segment plus collar/pelvis braces,
    // 6 constraint iterations, coarse angular limits (head ≤ 35° off the torso
    // axis, knees/elbows clamped about their seeded flexion), terrain contact
    // with slope-scaled friction and a low-speed static stop, and released
    // skis that slide flat on the surface to rest. The sim runs in WORLD space
    // and writes root-local transforms back onto the (still parented) driver
    // nodes, so the golden harness's quaternion/vector stub math reproduces it
    // exactly — no Matrix/TransformCoordinates/Quaternion.invert anywhere.
    // All quats are plain {x,y,z,w} objects built by hand; BABYLON.Quaternion
    // is constructed only at the node write sites.
    const _CRASH_GRAV = 9.81;
    const _crashQMul = function (a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        };
    };
    const _crashQConj = function (q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; };
    const _crashQAxis = function (ax, ay, az, ang) {
        const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        const s = Math.sin(ang / 2) / l;
        return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) };
    };
    const _crashQRotV = function (q, v) {
        const px =  q.w * v.x + q.y * v.z - q.z * v.y;
        const py =  q.w * v.y + q.z * v.x - q.x * v.z;
        const pz =  q.w * v.z + q.x * v.y - q.y * v.x;
        const pw = -q.x * v.x - q.y * v.y - q.z * v.z;
        return {
            x: px * q.w + pw * -q.x + py * -q.z - pz * -q.y,
            y: py * q.w + pw * -q.y + pz * -q.x - px * -q.z,
            z: pz * q.w + pw * -q.z + px * -q.y - py * -q.x,
        };
    };
    const _crashV = function (x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; };
    const _crashVSub = function (a, b) { return _crashV(a.x - b.x, a.y - b.y, a.z - b.z); };
    const _crashVLen = function (a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1e-9; };
    // Euler (rx, ry, rz) → quat, Babylon's YXZ intrinsic order (R = Ry·Rx·Rz).
    const _crashQEulerYXZ = function (rx, ry, rz) {
        return _crashQMul(
            _crashQAxis(0, 1, 0, ry),
            _crashQMul(_crashQAxis(1, 0, 0, rx), _crashQAxis(0, 0, 1, rz)));
    };
    // Local +Y axis a driver node's rx/rz rotation gives its cylinder (ry = 0):
    // Rx(rx)·Rz(rz)·(0,1,0) = (−sin rz, cos rz·cos rx, cos rz·sin rx).
    const _crashSegAxis = function (n) {
        const rx = (n.rotation && n.rotation.x) || 0;
        const rz = (n.rotation && n.rotation.z) || 0;
        const srz = Math.sin(rz), crz = Math.cos(rz);
        if (n.rotationQuaternion) {
            return _crashQRotV(n.rotationQuaternion, _crashV(0, 1, 0));
        }
        return _crashV(-srz, crz * Math.cos(rx), crz * Math.sin(rx));
    };
    const _crashFloorY = function (z) {
        return _poolDiveMode ? poolSurfaceY
            : (_trampolineMode || _trampolineMatMode)
                ? (TRAMPOLINE_Y - FOOT_OFFSET)
                : (terrainRootY(z) - FOOT_OFFSET);
    };
    // Hard zones: zero penetration ever. Chopped landing zone: sink ≤ 0.10 m.
    const _crashZoneHard = function (z) {
        return z < LANDING_START_Z + LANDING_TRANS_LEN;
    };

    function _crashRagdollInit() {
        const M = character.meshes;
        const rootPos = character.root.position;
        const qRoot = character.root.rotationQuaternion || _crashQAxis(0, 1, 0, 0);
        const qRootInv = _crashQConj(qRoot);
        const toWorld = function (lp) {
            const r = _crashQRotV(qRoot, lp);
            return _crashV(rootPos.x + r.x, rootPos.y + r.y, rootPos.z + r.z);
        };

        // Seed particle world positions from the current driver transforms.
        // NOTE the segment-frame conventions (they differ by limb): torso/head/
        // leg drivers have local +Y pointing PROXIMAL (torso top, head top, hip
        // end), but the ARM drivers' local +Y points DISTAL — the +Y end of an
        // arm segment is the elbow/wrist end (applyPose/applyGamepadLateral
        // build the arm chain along the rotated +Y from the shoulder pivot).
        // Getting this backwards seeds a mirror-scrambled arm chain.
        const segEnds = {};
        for (const seg of SEGMENTS) {
            const n = M[seg.name];
            if (!n) continue;
            const dir = _crashSegAxis(n);
            const hh = seg.h / 2;
            segEnds[seg.name] = {
                top: toWorld(_crashV(n.position.x + dir.x * hh, n.position.y + dir.y * hh, n.position.z + dir.z * hh)),
                bot: toWorld(_crashV(n.position.x - dir.x * hh, n.position.y - dir.y * hh, n.position.z - dir.z * hh)),
                dir: dir,
            };
        }
        // Seed angles FIRST, from the raw pose frames, so the angular limits
        // never fight the crash pose (a tuck lands deeply flexed; the limits
        // clamp AWAY from the seed, not into it). The neck angle is measured
        // at the raw head bottom; the limb angles at each segment's own joint
        // end — both before the chains below are made joint-coincident.
        const angAt = function (j, a, b) {
            const u = _crashVSub(a, j), v = _crashVSub(b, j);
            const c = (u.x * v.x + u.y * v.y + u.z * v.z) / (_crashVLen(u) * _crashVLen(v));
            return Math.acos(Math.max(-1, Math.min(1, c)));
        };
        const seedHead = angAt(segEnds.head.bot, segEnds.torso.top, segEnds.head.top);
        const seedKneeL = angAt(segEnds.upperLegL.bot, segEnds.upperLegL.top, segEnds.lowerLegL.bot);
        const seedKneeR = angAt(segEnds.upperLegR.bot, segEnds.upperLegR.top, segEnds.lowerLegR.bot);
        const seedElbL = angAt(segEnds.upperArmL.top, segEnds.upperArmL.bot, segEnds.lowerArmL.top);
        const seedElbR = angAt(segEnds.upperArmR.top, segEnds.upperArmR.bot, segEnds.lowerArmR.top);

        // Limb chains are seeded with EXACT segment lengths and COINCIDENT
        // joints. The flight pose tables author tucked segments with their
        // joints buried inside the body volume (measured iter 37: elbow gap
        // ~0.31 m, knee ~0.21, neck ~0.21 at full tuck — occluded by the body
        // mesh while airborne), so seeding the sticks from the raw pose
        // distances would freeze those gaps into the crash. Each segment's
        // OWN frame is exact (centre ± h/2), so distal joints are chained
        // along the segment directions: shoulder + upper-arm axis → elbow,
        // elbow + forearm axis → wrist, etc.
        const addV = function (a, b) { return _crashV(a.x + b.x, a.y + b.y, a.z + b.z); };
        const tAxis = _crashVSub(segEnds.torso.top, segEnds.torso.bot); // 0.55, up the torso
        const TORSO_H = 0.55;
        // The head attaches via a SHORT REAL brace (1 cm): neck sits 1 cm below
        // the torso top. A zero-rest brace (neck == torsoTop exactly) made the
        // constraint loop diverge (harness + browser, iter 37), so the brace
        // keeps a small non-zero rest instead.
        const NECK_OFF = 0.01;
        const armChain = function (ua, la) {
            const sh = ua.bot;
            const elbow = addV(sh, _crashVSub(ua.top, ua.bot));    // +0.30 along the upper-arm axis
            const wrist = addV(elbow, _crashVSub(la.top, la.bot)); // +0.25 along the forearm axis
            return { sh: sh, elbow: elbow, wrist: wrist };
        };
        const legChain = function (ul, ll) {
            const hip = ul.top;
            const knee = addV(hip, _crashVSub(ul.bot, ul.top));    // +0.36 down the thigh
            const ankle = addV(knee, _crashVSub(ll.bot, ll.top));  // +0.36 down the shin
            return { hip: hip, knee: knee, ankle: ankle };
        };
        const armL = armChain(segEnds.upperArmL, segEnds.lowerArmL);
        const armR = armChain(segEnds.upperArmR, segEnds.lowerArmR);
        const legL = legChain(segEnds.upperLegL, segEnds.lowerLegL);
        const legR = legChain(segEnds.upperLegR, segEnds.lowerLegR);
        const P = {
            torsoTop:    segEnds.torso.top,
            torsoBottom: segEnds.torso.bot,
            neck:        addV(segEnds.torso.top, _crashV(-tAxis.x * NECK_OFF / TORSO_H, -tAxis.y * NECK_OFF / TORSO_H, -tAxis.z * NECK_OFF / TORSO_H)),
            headTop:     segEnds.torso.top,
            shL: armL.sh, elbowL: armL.elbow, wristL: armL.wrist,
            shR: armR.sh, elbowR: armR.elbow, wristR: armR.wrist,
            hipL: legL.hip, kneeL: legL.knee, ankleL: legL.ankle,
            hipR: legR.hip, kneeR: legR.knee, ankleR: legR.ankle,
        };
        // The head extends from the braced neck along the head's own axis.
        P.headTop = addV(P.neck, _crashVSub(segEnds.head.top, segEnds.head.bot));
        const parts = [];
        for (const k of Object.keys(P)) parts.push({ name: k, p: P[k], prev: _crashV(P[k].x, P[k].y, P[k].z) });
        const byName = {};
        for (const pt of parts) byName[pt.name] = pt;
        const RADIUS = {
            torsoTop: 0.16, torsoBottom: 0.16, neck: 0.12, headTop: 0.12,
            shL: 0.08, shR: 0.08, elbowL: 0.06, elbowR: 0.06,
            wristL: 0.05, wristR: 0.05,
            hipL: 0.10, hipR: 0.10, kneeL: 0.08, kneeR: 0.08,
            ankleL: 0.06, ankleR: 0.06,
        };
        for (const pt of parts) pt.r = RADIUS[pt.name] || 0.07;

        const dist = function (a, b) { return _crashVLen(_crashVSub(a, b)); };
        const STICKS = [
            ['torsoTop', 'torsoBottom'], ['neck', 'headTop'],
            // Neck-to-torso brace: without it the neck particle is held only by
            // the head stick and drifts up to ~0.2 m off the torso (the head
            // visibly detaches — measured in iter 36's first spec run).
            ['torsoTop', 'neck'],
            ['torsoTop', 'shL'], ['torsoTop', 'shR'], ['shL', 'shR'],
            ['torsoBottom', 'shL'], ['torsoBottom', 'shR'],
            ['shL', 'elbowL'], ['elbowL', 'wristL'],
            ['shR', 'elbowR'], ['elbowR', 'wristR'],
            ['torsoBottom', 'hipL'], ['torsoBottom', 'hipR'], ['hipL', 'hipR'],
            ['torsoTop', 'hipL'], ['torsoTop', 'hipR'],
            ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
            ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
        ].map(function (s) {
            return { a: byName[s[0]], b: byName[s[1]], rest: dist(P[s[0]], P[s[1]]) };
        });

        // Angular limits from the seeds captured above (from the raw pose
        // frames — P's chains are already joint-coincident, which would make
        // the neck angle degenerate if measured from it).
        const clampAng = function (a, lo, hi) { return Math.max(lo, Math.min(hi, a)); };
        const ANG = {
            headMax: clampAng(seedHead + 0.10, 0.61, 0.9),          // ≤ ~35–50° off the torso axis
            kneeL: [clampAng(seedKneeL - 0.2, 0.7, 3.05), clampAng(seedKneeL + 0.2, 3.05, Math.PI)],
            kneeR: [clampAng(seedKneeR - 0.2, 0.7, 3.05), clampAng(seedKneeR + 0.2, 3.05, Math.PI)],
            elbL: [clampAng(seedElbL - 0.2, 0.6, 3.1), clampAng(seedElbL + 0.2, 3.1, Math.PI)],
            elbR: [clampAng(seedElbR - 0.2, 0.6, 3.1), clampAng(seedElbR + 0.2, 3.1, Math.PI)],
        };

        // Hard length projection pairs (proximal anchor → distal snap): the
        // soft stick solve leaves centimetre residuals under violent motion and
        // the joint-gap gate reads those residuals, so segment lengths are
        // enforced exactly each substep. The head pair is applied after the
        // kinematic neck re-pin (it anchors on the final neck position).
        const HARD = [
            ['torsoBottom', 'torsoTop'],
            ['shL', 'elbowL'], ['elbowL', 'wristL'],
            ['shR', 'elbowR'], ['elbowR', 'wristR'],
            ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
            ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
        ].map(function (p2) {
            return { a: byName[p2[0]], b: byName[p2[1]], rest: dist(P[p2[0]], P[p2[1]]) };
        });

        // Skis release at impact: flat-on-surface slide with yaw spin.
        const skis = [];
        for (const sk of ['skiL', 'skiR']) {
            const n = M[sk];
            if (!n) continue;
            const lp = n.position;
            const pos = toWorld(lp);
            const qNode = n.rotationQuaternion
                ? { x: n.rotationQuaternion.x, y: n.rotationQuaternion.y, z: n.rotationQuaternion.z, w: n.rotationQuaternion.w }
                : _crashQEulerYXZ(n.rotation.x || 0, n.rotation.y || 0, n.rotation.z || 0);
            const fwd = _crashQRotV(_crashQMul(qRoot, qNode), _crashV(0, 0, 1));
            skis.push({
                node: n, pos: pos,
                vel: _crashV((Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 0.8, 1.4 + Math.random() * 2.0),
                yaw: Math.atan2(fwd.x, fwd.z || 1e-6),
                vyaw: (Math.random() - 0.5) * 5.0,
                resting: false, y0: 0.015,
            });
        }

        const torso = P.torsoTop;
        return {
            parts, byName, sticks: STICKS, ang: ANG, skis, neckOff: NECK_OFF,
            hard: HARD, headRest: dist(P.neck, P.headTop),
            qRoot, qRootInv, rootPos: _crashV(rootPos.x, rootPos.y, rootPos.z),
            torso: _crashV(torso.x, torso.y, torso.z),
            maxSpeed: 99, sprayT: 0, t: 0,
        };
    }

    function _crashRagdollStep(R, dt) {
        R.t += dt;
        // The root KEEPS SLIDING during the crash (physics continues; only the
        // crash froze state.vz at impact and the slope re-accelerates it), so
        // the world→local write-back must use the LIVE root transform, not a
        // capture. The root orientation is frozen while crashActive.
        const _rp = character.root.position;
        const rootPos = _crashV(_rp.x, _rp.y, _rp.z);
        const _rq = character.root.rotationQuaternion || R.qRoot;
        const qRootInv = _crashQConj(_rq);
        // When the rest detector has fired (R.resting), the ragdoll pose is
        // FROZEN in world space — but the physics root KEEPS SLIDING under it
        // (the crash only froze state.vz at impact and the slope keeps
        // re-accelerating it), so the world→root write-back below must keep
        // running every frame or the frozen root-local pose would ride the
        // sliding root and the body would visibly glide down the out-run
        // (measured: rendered torso speed 10.1 m/s with a naive full freeze).
        // Everything from integration to spray is skipped; only the
        // transform write-back executes.
        if (!R.resting) {
        // ── Verlet integrate (2 substeps for stability at clamped dt) ─────
        const nSub = dt > 0.026 ? 3 : 2;
        const h = dt / nSub;
        for (let s = 0; s < nSub; s++) {
            for (const pt of R.parts) {
                // Linear damping raised 0.996 → 0.99 (human item 2: total
                // ragdoll motion after impact ≈ 2–3 s, then still).
                const vx = (pt.p.x - pt.prev.x) * 0.99;
                const vy = (pt.p.y - pt.prev.y) * 0.99;
                const vz = (pt.p.z - pt.prev.z) * 0.99;
                pt.prev.x = pt.p.x; pt.prev.y = pt.p.y; pt.prev.z = pt.p.z;
                pt.p.x += vx; pt.p.y += vy - _CRASH_GRAV * h * h; pt.p.z += vz;
            }
            // ── Stick constraints ─────────────────────────────────────────
            // Hard length projection (segment pairs): the soft sticks leave
            // centimetre-to-decimetre residuals under violent tumbling (a big
            // landing impact compresses a limb leg 10 cm in one frame), and
            // the rendered segment endpoints assume the exact rest length — so
            // the joint-gap gate read the length error (knee 0.10 m, iter 38).
            const hardPass = function () {
                for (const hp of R.hard) {
                    const a = hp.a.p, b = hp.b.p;
                    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
                    const k = (l - hp.rest) / l * 0.5;
                    a.x += dx * k; a.y += dy * k; a.z += dz * k;
                    b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
                }
            };
            // Terrain contact + slope-scaled friction. Projected INSIDE the
            // constraint loop (standard PBD) so the sticks and the surface
            // converge to one configuration — run sequentially they fight and
            // leave cm-scale residuals that the joint-gap and penetration
            // gates both read (iter 37).
            const contactPass = function () {
                const eps = 0.05;
                const slope = Math.min(1.2, Math.abs(terrainRootY(R.torso.z + eps) - terrainRootY(R.torso.z - eps)) / (2 * eps));
                for (const pt of R.parts) {
                    const surf = _crashFloorY(pt.p.z) + pt.r;
                    if (pt.p.y < surf) {
                        pt.p.y = surf;
                        const vx = pt.p.x - pt.prev.x, vz = pt.p.z - pt.prev.z;
                        const vH = Math.sqrt(vx * vx + vz * vz);
                        // Static friction (human item 2): below 0.5 m/s the
                        // contact STOPS the point dead. Without this the body
                        // creeps forever at the gravity-injection equilibrium
                        // (g·h per substep ≈ 0.26 m/s at clamped headless dt),
                        // so the rest detector never sees < 0.08 m/s.
                        // Retune (iter 45): 0.35 → 0.5 — the 0.35 build sat
                        // exactly on the ≤ 3.5 s restAt gate (3.56 s measured
                        // under load; 3.0–4.2 s spread, entries 43/44).
                        if (vH / h < 0.5) {
                            pt.prev.x = pt.p.x;
                            pt.prev.z = pt.p.z;
                        } else {
                            // Ploughing friction + a static stop so the body settles.
                            // Static-stop threshold raised 0.5 → 0.9 m/s (human
                            // item 2: come to rest within ~1 s of stopping).
                            // Retune (iter 45): base 2.5 → 3.5 so the median
                            // settle pulls toward the author's ~2–3 s target
                            // and off the gate edge (entry 43 open item).
                            const f = Math.min(0.5, (3.5 + 4.5 * slope) * h * 10);
                            let k = 1 - f;
                            if (vH * (1 - k) / h < 0.9) k = 0.25;
                            pt.prev.x = pt.p.x - vx * k;
                            pt.prev.z = pt.p.z - vz * k;
                        }
                        if (pt.prev.y > pt.p.y) pt.prev.y = pt.p.y;
                    }
                }
            };
            for (let it = 0; it < 6; it++) {
                for (const st of R.sticks) {
                    const d = _crashVSub(st.b.p, st.a.p);
                    const len = _crashVLen(d);
                    const diff = (len - st.rest) / len * 0.5;
                    st.a.p.x += d.x * diff; st.a.p.y += d.y * diff; st.a.p.z += d.z * diff;
                    st.b.p.x -= d.x * diff; st.b.p.y -= d.y * diff; st.b.p.z -= d.z * diff;
                }
                // ── Coarse angular limits (distal particle moves) ─────────
                const angClamp = function (j, a, b, lo, hi) {
                    const u = _crashVSub(a.p, j.p), v = _crashVSub(b.p, j.p);
                    const lu = _crashVLen(u), lv = _crashVLen(v);
                    const c = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv)));
                    const ang = Math.acos(c);
                    if (ang >= lo && ang <= hi) return;
                    const target = ang < lo ? lo : hi;
                    // Rotate b about the joint axis (u×v) onto the clamped angle.
                    const ax = (u.y * v.z - u.z * v.y) / (lu * lv);
                    const ay = (u.z * v.x - u.x * v.z) / (lu * lv);
                    const az = (u.x * v.y - u.y * v.x) / (lu * lv);
                    if (ax * ax + ay * ay + az * az < 1e-8) return; // degenerate (u ∥ v)
                    const q = _crashQAxis(ax, ay, az, target - ang);
                    const nb = _crashQRotV(q, _crashV(v.x / lv, v.y / lv, v.z / lv));
                    b.p.x = j.p.x + nb.x * lv; b.p.y = j.p.y + nb.y * lv; b.p.z = j.p.z + nb.z * lv;
                };
                // Head angle off the TORSO AXIS (torsoBottom → neck): π means
                // the head is in line with the torso, so the allowed band is
                // the mirror of the [0, headMax] off-axis window. (Measuring at
                // torsoTop directly is degenerate — neck == torsoTop by
                // construction since the iter-37 joint-coincident seeding.)
                angClamp(R.byName.neck, R.byName.torsoBottom, R.byName.headTop,
                    Math.PI - R.ang.headMax, Math.PI);
                angClamp(R.byName.kneeL, R.byName.hipL, R.byName.ankleL, R.ang.kneeL[0], R.ang.kneeL[1]);
                angClamp(R.byName.kneeR, R.byName.hipR, R.byName.ankleR, R.ang.kneeR[0], R.ang.kneeR[1]);
                angClamp(R.byName.elbowL, R.byName.shL, R.byName.wristL, R.ang.elbL[0], R.ang.elbL[1]);
                angClamp(R.byName.elbowR, R.byName.shR, R.byName.wristR, R.ang.elbR[0], R.ang.elbR[1]);
                hardPass();
                contactPass();
            }
            // Polish passes: the FINAL contact of the main loop can leave a
            // small length residual (contact lifts one end of a segment after
            // the hard projection), and the final hard projection can leave a
            // small depth residual. Extra [hard, contact] rounds drive both
            // geometrically toward zero (measured worst knee gap 0.134 m and
            // worst elbow 0.022 m -> both gate-passing on the violent
            // mid-flight-flip crash variant).
            for (let it = 0; it < 4; it++) { hardPass(); contactPass(); }
            // Kinematic neck: pinned 1 cm below the torso top along the torso
            // axis, so the head is attached EXACTLY every frame. (A simulated
            // neck fought the contact radii and the brace — measured joint-gap
            // residuals up to 0.09 m; a zero-rest stick diverged outright.)
            const _tA = _crashVSub(R.byName.torsoTop.p, R.byName.torsoBottom.p);
            const _tL = _crashVLen(_tA);
            if (_tL > 1e-6) {
                const _k = R.neckOff / _tL;
                const _nk = R.byName.neck;
                _nk.p.x = R.byName.torsoTop.p.x - _tA.x * _k;
                _nk.p.y = R.byName.torsoTop.p.y - _tA.y * _k;
                _nk.p.z = R.byName.torsoTop.p.z - _tA.z * _k;
                _nk.prev.x = _nk.p.x; _nk.prev.y = _nk.p.y; _nk.prev.z = _nk.p.z;
                // The head top snaps onto the exact rest length from the final
                // neck position, so the rendered head is attached exactly.
                const _hx = R.byName.headTop.p;
                const _hdx = _hx.x - _nk.p.x, _hdy = _hx.y - _nk.p.y, _hdz = _hx.z - _nk.p.z;
                const _hl = Math.sqrt(_hdx * _hdx + _hdy * _hdy + _hdz * _hdz) || 1e-9;
                const _hs = R.headRest / _hl;
                _hx.x = _nk.p.x + _hdx * _hs;
                _hx.y = _nk.p.y + _hdy * _hs;
                _hx.z = _nk.p.z + _hdz * _hs;
                // Keep the head TOP above the snow: in supine head-down
                // configurations the snap projects headTop along the current
                // head axis INTO the surface (measured: pen up to 0.18 m, iter
                // 37). Re-solve the head AXIS instead of clamping y — rotate
                // the neck→headTop direction in the vertical plane containing
                // it (about the horizontal axis ⟂ to it) until headTop clears
                // its contact height. This is the minimal disturbance: it
                // preserves the exact neck→headTop rest length and the head
                // reads as tilted back, not sunk. If even vertical cannot
                // clear (neck itself too deep), it lands on vertical — the
                // best achievable — and the contact loop handles the rest.
                const _hsurf = _crashFloorY(_hx.z) + _hx.r;
                if (_hx.y < _hsurf) {
                    const _Lh = R.headRest;
                    const _ux = (_hx.x - _nk.p.x) / _Lh;
                    const _uy = (_hx.y - _nk.p.y) / _Lh;
                    const _uz = (_hx.z - _nk.p.z) / _Lh;
                    const _need = (_hsurf - _nk.p.y) / _Lh;
                    const _phi = Math.asin(Math.max(-1, Math.min(1, _uy)));
                    const _phiT = Math.asin(Math.max(-1, Math.min(1, _need)));
                    const _axL = Math.sqrt(_ux * _ux + _uz * _uz);
                    if (_axL > 1e-6 && _phiT > _phi) {
                        // axis = normalize(cross(dir, +Y)) = (-uz, 0, ux)/axL:
                        // positive rotation pitches the direction upward.
                        const _q = _crashQAxis(-_uz / _axL, 0, _ux / _axL, _phiT - _phi);
                        const _nd = _crashQRotV(_q, _crashV(_ux, _uy, _uz));
                        _hx.x = _nk.p.x + _nd.x * _Lh;
                        _hx.y = _nk.p.y + _nd.y * _Lh;
                        _hx.z = _nk.p.z + _nd.z * _Lh;
                    }
                }
            }
        }
        // ── Skis: flat slide on the surface, yaw spin, come to rest ───────
        for (const sk of R.skis) {
            if (!sk.resting) {
                sk.vel.y -= _CRASH_GRAV * dt;
                sk.pos.x += sk.vel.x * dt; sk.pos.y += sk.vel.y * dt; sk.pos.z += sk.vel.z * dt;
                sk.yaw += sk.vyaw * dt;
                sk.vyaw *= Math.exp(-1.6 * dt);
            }
            const surf = _crashFloorY(sk.pos.z) + sk.y0;
            if (sk.pos.y <= surf || sk.resting) {
                sk.pos.y = surf;
                sk.resting = true;
                const vH = Math.sqrt(sk.vel.x * sk.vel.x + sk.vel.z * sk.vel.z);
                if (vH > 0.02) {
                    const dec = Math.min(vH, (2.0 + 2.5 * 0.5) * dt);
                    sk.vel.x -= sk.vel.x / vH * dec;
                    sk.vel.z -= sk.vel.z / vH * dec;
                    sk.pos.x += sk.vel.x * dt; sk.pos.z += sk.vel.z * dt;
                } else { sk.vel.x = 0; sk.vel.z = 0; }
            }
        }
        // ── Trailing spray while the body ploughs, scaled to speed ────────
        R.maxSpeed = 0;
        for (const pt of R.parts) {
            const sp = _crashVLen(_crashVSub(pt.p, pt.prev)) / Math.max(dt, 1e-4);
            if (sp > R.maxSpeed) R.maxSpeed = sp;
        }
        R.sprayT -= dt;
        if (R.maxSpeed > 1.2 && R.sprayT <= 0) {
            R.sprayT = 0.12;
            _spawnSnowBurst(R.torso.x, R.torso.y - 0.35, R.torso.z, 14, Math.min(2.2, R.maxSpeed / 6));
        }
        // ── Rest detector (human item 2): freeze the pose once settled ────
        // A few tumbles, a slide, then a STILL resting pose: total ragdoll
        // motion after impact ≈ 2–3 s. Count consecutive slow frames — body
        // displacement rate below 0.12 m/s (imperceptible at game camera
        // distance, and safely under the 0.1 m/s settle gate once the last
        // 4 cm of creep decay) and every released ski at rest — after at
        // least 1 s of ragdoll time (no freezing during a mid-tumble lull).
        // After 8 such frames (~0.13 s at 60 fps) mark R.resting; the step
        // then skips the physics and only re-projects the frozen world pose
        // into the still-sliding root frame — the settle gate and "no
        // residual jitter / no motion afterwards" hold by construction.
        // restAt records the ragdoll time of the freeze.
        if (!R.resting) {
            const _skisStill = R.skis.every(sk =>
                sk.resting && Math.hypot(sk.vel.x, sk.vel.z) < 0.03);
            if (R.t > 1.0 && R.maxSpeed < 0.12 && _skisStill) {
                R.restFrames = (R.restFrames || 0) + 1;
                if (R.restFrames >= 8) { R.resting = true; R.restAt = R.t; }
            } else R.restFrames = 0;
        }
        // ── Write driver transforms (root-local, bones follow as always) ──
        } else { R.maxSpeed = 0; }
        // Arm segments are passed (distal, proximal) so the written +Y matches
        // the arm drivers' own frame (+Y = elbow/wrist end); torso/head/legs
        // pass (proximal, distal) per their +Y-proximal frames. See the note
        // on segment-frame conventions in _crashRagdollInit.
        const writeSeg = function (name, pTop, pBot) {
            const n = character.meshes[name];
            if (!n) return;
            const cx = (pTop.x + pBot.x) / 2, cy = (pTop.y + pBot.y) / 2, cz = (pTop.z + pBot.z) / 2;
            const d = _crashVSub(pTop, pBot);
            const l = _crashVLen(d);
            const dirW = _crashV(d.x / l, d.y / l, d.z / l);
            const rel = _crashVSub(_crashV(cx, cy, cz), rootPos);
            const loc = _crashQRotV(qRootInv, rel);
            n.position.x = loc.x; n.position.y = loc.y; n.position.z = loc.z;
            const dirL = _crashQRotV(qRootInv, dirW);
            // Invert Rx(rx)·Rz(rz)·(0,1,0) = dirL for rx, rz (ry = 0).
            const crz = Math.sqrt(Math.max(0, 1 - dirL.x * dirL.x));
            const rz = Math.atan2(-dirL.x, crz);
            const rx = Math.atan2(dirL.z, dirL.y);
            n.rotation.x = rx; n.rotation.z = rz;
        };
        const P = R.byName;
        writeSeg('torso', P.torsoTop.p, P.torsoBottom.p);
        writeSeg('head', P.headTop.p, P.neck.p);
        writeSeg('upperArmL', P.elbowL.p, P.shL.p);
        writeSeg('lowerArmL', P.wristL.p, P.elbowL.p);
        writeSeg('upperArmR', P.elbowR.p, P.shR.p);
        writeSeg('lowerArmR', P.wristR.p, P.elbowR.p);
        writeSeg('upperLegL', P.hipL.p, P.kneeL.p);
        writeSeg('lowerLegL', P.kneeL.p, P.ankleL.p);
        writeSeg('upperLegR', P.hipR.p, P.kneeR.p);
        writeSeg('lowerLegR', P.kneeR.p, P.ankleR.p);
        // Torso world position for the camera ease + spray.
        R.torso = _crashV((P.torsoTop.p.x + P.torsoBottom.p.x) / 2,
                          (P.torsoTop.p.y + P.torsoBottom.p.y) / 2,
                          (P.torsoTop.p.z + P.torsoBottom.p.z) / 2);
        for (const sk of R.skis) {
            const n = sk.node;
            const eps2 = 0.05;
            const s2 = Math.min(1.2, Math.abs(terrainRootY(sk.pos.z + eps2) - terrainRootY(sk.pos.z - eps2)) / (2 * eps2));
            const qSki = _crashQMul(_crashQAxis(1, 0, 0, Math.atan(s2)), _crashQAxis(0, 1, 0, sk.yaw));
            const qL = _crashQMul(qRootInv, qSki);
            n.rotationQuaternion = new BABYLON.Quaternion(qL.x, qL.y, qL.z, qL.w);
            const rel = _crashVSub(sk.pos, rootPos);
            const loc = _crashQRotV(qRootInv, rel);
            n.position.x = loc.x; n.position.y = loc.y; n.position.z = loc.z;
        }
    }
    let readyState      = true;  // true = waiting at top, character facing sideways
    let readyTurnT      = 0.0;   // 0→1: progress of turn-to-face-downhill animation
    const READY_TURN_DUR = 0.7;  // seconds to complete the turn
    // ── Hop-turn phase schedule (author spec, 2026-08-26) ────────────────────
    // The turn to face downhill is a HOP: crouch (knees fold, hips drop, arms
    // swing back) → extension (legs drive, skis leave the snow) → airborne
    // (root lifted on a sine arc while the body+skis rotate 90° about the
    // world vertical) → touchdown → knee absorption → settle. The author's
    // nominal durations (0.30 / 0.15 / 0.25 / 0.25 s, + settle) sum to 0.95 s,
    // but READY_TURN_DUR is locked at 0.7 s by the golden-trace contract (the
    // recorded ready phase would shift every flight keyframe otherwise), so
    // the four phases are scaled proportionally into the fixed turn
    // (× 0.7/0.95 ≈ 0.737 — inside the ±30% acceptance band per phase); the
    // settle tail is folded into the absorb envelope's release. Display only
    // (ADR-0002): physics state is never touched here.
    const HOP_TURN = (function () {
        const nomSum = 0.95;                        // author's nominal total, s
        const e0 = 0.30 / nomSum;                   // crouch end (turn fraction)
        const e1 = e0 + 0.15 / nomSum;              // takeoff
        const a1 = e1 + 0.25 / nomSum;              // touchdown
        const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
        const HOP_H = 0.135;                        // peak ski lift, m (author: 10–15 cm)
        const K_MAX = 1.2;                          // crouch knee-fold drive (≈89° knee)
        return {
            crouchEnd: e0, takeoff: e1, touchdown: a1, hopHeight: HOP_H, kMax: K_MAX,
            // fraction of the 90° yaw done at u: 0 on the snow, smooth through
            // the airborne window, complete at touchdown (skis land pointing
            // down the fall line)
            yawFrac: (u) => (u <= e1) ? 0 : (u >= a1 ? 1 : sm((u - e1) / (a1 - e1))),
            // crouch envelope: rises through the crouch, releases through the
            // extension; drives the knee fold, the hip drop and the arm swing
            crouchN: (u) => (u <= e0) ? sm(u / e0)
                          : (u <= e1 ? 1 - sm((u - e0) / (e1 - e0)) : 0),
            // absorb envelope: knee fold peaking just after touchdown,
            // fully released by 72% of the window so every rendered frame
            // (≥ 20 fps quantization) reaches zero before the u = 1 hand-back
            absorbN: (u) => (u <= a1 || u >= 1) ? 0
                          : Math.sin(Math.PI * Math.min(1, (u - a1) / (1 - a1) * 1.39)),
            // root lift while airborne (sine arc, 0 at takeoff and touchdown)
            hop: (u) => (u <= e1 || u >= a1) ? 0
                      : HOP_H * Math.sin(Math.PI * (u - e1) / (a1 - e1)),
        };
    })();
    // Ready-stance diagnostics (read by window._readyStanceProbe, drive-tested)
    const _readyStance = { last: null };
    // Ski half-dims memo (from SEGMENTS; skis are the physics driver boxes)
    let _skiHalfDims = null;
    // Rotate v by unit quaternion q (Babylon convention, v' = q·v·q⁻¹).
    // Written out with plain arithmetic on purpose: the golden harness's
    // inert Babylon stub lacks TransformCoordinates/invert, and the
    // ready-stance block below must produce the same numbers there.
    const _quatRotateVec = function (q, v) {
        const px =  q.w * v.x + q.y * v.z - q.z * v.y;
        const py =  q.w * v.y + q.z * v.x - q.x * v.z;
        const pz =  q.w * v.z + q.x * v.y - q.y * v.x;
        const pw = -q.x * v.x - q.y * v.y - q.z * v.z;
        return new BABYLON.Vector3(
            px * q.w + pw * -q.x + py * -q.z - pz * -q.y,
            py * q.w + pw * -q.y + pz * -q.x - px * -q.z,
            pz * q.w + pw * -q.z + px * -q.y - py * -q.x
        );
    };
    let doubleMode      = false; // both keys held → continuous 2x speed spin
    let bothArmsSpinTarget = Infinity; // spinTarget value at which a both-arms twist was triggered
    let secondKeyTimer  = null;  // timeout handle; fires after hold threshold
    const DOUBLE_HOLD_MS = 180;  // ms — hold second key longer than this = double mode

    // Initialise rotationQuaternion so Babylon doesn't mix with euler rotation.
    character.root.rotationQuaternion = BABYLON.Quaternion.Identity();

    // Per-mode default betas — side keeps the original angle, back is raised
    const CAM_BETA_SIDE   = Math.PI / 3.2 - 2 * Math.PI / 180; // original side-view angle
    const CAM_BETA_BACK   = Math.PI / 3.8;                      // raised back view (approved)
    const CAM_BETA_FRONT  = Math.PI / 2.5;
    const CAM_BETA_LAND   = Math.PI / 4.5;                      // slight raise on landing
    function _modeBeta(mode) {
        if (mode === 1) return CAM_BETA_FRONT;
        if (mode === 2) return CAM_BETA_BACK;
        return CAM_BETA_SIDE;
    }
    let _camTargetAlpha = null;
    function _snapCamera(mode) {
        if (mode === 0)      { _camTargetAlpha = Math.PI;         }
        else if (mode === 1) { _camTargetAlpha = Math.PI / 2;     }
        else                 { _camTargetAlpha = Math.PI * 1.5;   }
    }
    camera.mode  = BABYLON.Camera.PERSPECTIVE_CAMERA;
    camera.fov   = 0.9;
    camera.alpha = Math.PI * 1.5;   // start behind
    camera.beta  = CAM_BETA_BACK;
    if (dofPipeline) dofPipeline.depthOfFieldEnabled = true;

    // ── First-person camera (V key toggles) ─────────────────────────────────
    // Positioned at the skier's eyes; orientation tracks the full body rotation
    // (including backflips and twists) so the world tumbles realistically.
    const fpCamera = new BABYLON.FreeCamera('fpCam', BABYLON.Vector3.Zero(), scene);
    // Attach the render pipeline to the first-person camera too. It was
    // main-camera only, so first-person received no tonemapping, no bloom and no
    // exposure multiply — which is exactly why it rendered darker than the
    // third-person view.
    try {
        if (dofPipeline && scene.postProcessRenderPipelineManager) {
            scene.postProcessRenderPipelineManager
                 .attachCamerasToRenderPipeline('dof', fpCamera);
        }
    } catch (e) { /* first-person still renders, just untonemapped */ }
    fpCamera.minZ = 0.02;
    fpCamera.maxZ = 2000;
    fpCamera.fov  = 1.40;  // ~80° — wide enough for a sense of speed
    // Persistent lerped state for smooth landing transition
    let _fpPos = null, _fpFwd = null, _fpUp = null;


    // ── Input ─────────────────────────────────────────────────────────────────
    // SPACE        — tuck while held, open on release
    // ← then tap → — single left twist at normal speed
    // → then tap ← — single right twist at normal speed
    // ← then hold → — double mode: 2× speed left twist while both held
    // → then hold ← — double mode: 2× speed right twist while both held
    //
    // Tap vs hold is distinguished by a timer: if the second key is still down
    // after DOUBLE_HOLD_MS, double mode activates; if released before, it was
    // a single-twist tap.
    function enterDoubleMode(dir) {
        secondKeyTimer = null;
        doubleMode = true;
        state.doubleDir = dir;
    }
    function exitDoubleMode() {
        if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        doubleMode = false;
        const halfTwist = Math.PI;
        const halves = state.spinAngle / halfTwist;
        // Snap to nearest half-twist; allow ~10% backward correction if just past one
        const n = state.doubleDir > 0
            ? Math.ceil(halves - 0.1)
            : Math.floor(halves + 0.1);
        state.spinTarget = n * halfTwist;
    }

    // ── Gamepad polling ────────────────────────────────────────────────────
    // Left stick Y → left arm drop (0=up, 1=down), X → lateral rz offset
    // Right stick Y → right arm drop, X → lateral rz offset
    // Right trigger → tuck
    // Stick Y threshold crossings simulate the same spin-trigger logic as keyboard
    function pollGamepad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad = null;
        for (let i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
        }
        if (!pad) return;

        const DEAD = 0.12;
        const applyDead = v => Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD);

        const lx = applyDead(pad.axes[0] || 0);
        const ly = applyDead(pad.axes[1] || 0);
        const rx = applyDead(pad.axes[2] || 0);
        const ry = applyDead(pad.axes[3] || 0);
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0;

        // Neutral = arms up (0). Push stick forward (positive Y) drops arm toward 1.
        // Lateral X controls arm sweep; tuck inward (X→0) reduces I and speeds spin.
        // axes[0/1] = right stick, axes[2/3] = left stick on PS5 DualSense
        _gpArmLX = rx;
        _gpArmLY = Math.max(0, ry);
        _gpArmRX = lx;
        _gpArmRY = Math.max(0, ly);

        const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
        const xBtn     = !!(pad.buttons[0] && pad.buttons[0].pressed);
        const circleBtn = !!(pad.buttons[1] && pad.buttons[1].pressed);
        const ltDown   = lt > 0.1;

        if (!state.crashed) {
            state.tuckTarget = rt > 0.1 ? rt : 0;
        }

        // X → go down hill (ArrowUp)
        if (xBtn && !_gpXPrev) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
        }
        if (!xBtn && _gpXPrev) {
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
        }
        _gpXPrev = xBtn;

        // Circle → reset to top (KeyR)
        if (circleBtn && !_gpCirclePrev) {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }));
        }
        _gpCirclePrev = circleBtn;

        // Left trigger → charge flip power (ArrowDown hold)
        if (ltDown && !_gpLTPrev && state.grounded && !state.crashed) {
            pmDownHeld = true;
        }
        if (!ltDown && _gpLTPrev) {
            pmDownHeld = false;
            if (_poolDiveMode && pmActive && flipPower > 0 && readyState && !poolEntered)
                poolAutoLaunch = true;
        }
        _gpLTPrev = ltDown;

    }

    // Layout-aware letter hotkeys (human-testing item 6): the help menu shows
    // letters, so the key that fires must be the one that TYPES that letter
    // (event.key) — not the physical QWERTY slot (event.code), which a
    // Dvorak/AZERTY user's keycaps disagree with. Only length-1 (printable)
    // key values match, so modifier/named keys can never trigger a letter
    // hotkey. Synthetic events (gamepad bridge, old tests) may carry only
    // .code — fall back to the QWERTY code for those.
    function _keyIsLetter(e, letter) {
        if (typeof e.key === 'string' && e.key.length === 1) {
            return e.key.toLowerCase() === letter;
        }
        return e.code === 'Key' + letter.toUpperCase();
    }

    window.addEventListener('keydown', e => {
        // ESC closes any open modal overlay (human-testing item 7): help,
        // settings, custom, comp, qualify, FIS modal / trick picker / run
        // board, trophy and the secret panel. Return only when something
        // actually closed, so ESC stays free for the game otherwise.
        if (e.key === 'Escape' || e.code === 'Escape') {
            let _closedOverlay = false;
            for (const id of ['helpModal', 'settingsModal', 'customModal',
                'compModal', 'qualifyModal', 'fisModal', 'fisTrickPick',
                'fisRunSB', 'trophyPanel', 'grandUnlockOverlay']) {
                const _ov = document.getElementById(id);
                if (_ov && _ov.classList.contains('open')) {
                    _ov.classList.remove('open');
                    _closedOverlay = true;
                }
            }
            if (_closedOverlay) return;
        }
        if (_keyIsLetter(e, 'p')) { paused = !paused; return; }
        if (_keyIsLetter(e, 'z')) {
            window._tutorialTimeScale = (window._tutorialTimeScale === 0.5) ? 1.0 : 0.5;
            return;
        }
        if (_keyIsLetter(e, 'r')) {
            // In competition mode, only allow reset once stopped or crashed at the bottom
            if (_compParam && !state.stopped && !state.crashed) return;
            // Realistic FIS mode: block reset until the player has picked their next trick
            if (_realisticMode && window._fisWaitingForPick) return;
            // Olympics mode: block reset once all attempts used
            if (_olympicsMode && olympicsDone) return;
            if (_olympicsMode && !state.stopped && !state.crashed) return;
            // Olympics qual attempt 2: navigate back so trick picker can show
            if (_olympicsMode === 'qual' && olympicsAttempts >= 1) {
                location.href = '?world=triple&olympics=qual';
                return;
            }
            // Ultra mode: navigate to next world or restart from beginning
            if (_compParam === 'ultra') {
                if (compLandingResult && compLandingResult.matched) {
                    const nextJump = _ultraJump + 1;
                    if (nextJump < ULTRA_POOL.length) {
                        location.href = '?world=' + ULTRA_WORLDS[nextJump] + '&comp=ultra&ultrajump=' + nextJump;
                        return;
                    }
                    // Last jump already completed — restart ultra from beginning
                    location.href = '?world=' + ULTRA_WORLDS[0] + '&comp=ultra&ultrajump=0';
                    return;
                }
                // Failed or crashed — restart ultra from beginning
                location.href = '?world=' + ULTRA_WORLDS[0] + '&comp=ultra&ultrajump=0';
                return;
            }
            // Save current recording as last-run replay before resetting
            if (replayFrames.length > 0 || lastRunFrames.length > 0) {
                lastRunFrames = replayFrames.length > 0 ? replayFrames.slice() : lastRunFrames;
                if (replayBtn) replayBtn.disabled = false;
            }
            recordingActive = false;
            replayFrames = [];
            replayActive = false;
            // Reset to top of slope / platform
            poolEntered        = false;
            poolAutoLaunch     = false;
            poolDivePushing    = false;
            _poolDiveLaunchPwr = 0;
            poolEntryDrag      = 5.5;
            poolSplashAmp  = 0;
            if (_poolDiveMode) {
                switchPlatform(activePlatIdx); // recompute Y/Z from current selection
                state.posZ  = POOL_DIVE_PLATFORM_Z;
                state.rootY = POOL_DIVE_ROOT_Y;
            }
            state.L_flip      = I0 * TARGET_OMEGA_UNTUCKED;
            state.flipAngle   = 0.0;
            state.tuckAmount  = 0.0;
            state.tuckTarget  = 0.0;
            state.pikeAmount  = 0.0;
            state.pikeTarget  = 0.0;
            state.pikeReleaseOmega = 0;
            state.flipDir     = _poolDiveMode ? poolDiveFlipDirPref : 1;
            state.spinAngle   = 0.0;
            state.spinTarget  = 0.0;
            state.spinMult    = 1.0;
            state.armDropL    = 1.0;
            state.armDropR    = 1.0;
            state.vy          = 0.0;
            state.posZ        = _trampolineMode ? 0 : _trampolineMatMode ? 4.0 : _poolDiveMode ? POOL_DIVE_PLATFORM_Z : SLOPE_START_Z + 2.0;
            state.vz          = 0.0;
            state.grounded    = true;
            state.crashed     = false;
            // Reset mat-mode state
            matBounceCount = 0; matTramBouncing = false;
            matTramSpringY = 0; matTramSpringVY = 0;
            matLanded = false; matLandSpringY = 0; matLandSpringVY = 0;
            state.crashAngle  = 0.0;
            state.stopped     = false;
            state.perFlipTwists   = [];
            state.lastFlipInt     = 0;
            state.spinAtFlipStart = 0.0;
            state.spinBoundaries  = [];
            state.perFlipTucked   = [];
            state.currentFlipTucked = false;
            state.trickName   = '';
            state.execution   = 0;
            state.armSnap     = 0.0;
            state.layArmT     = 0.0;
            state.armSnapTarget = 0;
            state.offAxis     = 0.0; offAxisTarget = 0.0;
            state.airTime     = 0.0;
            poolEntered   = false;
            poolSplashAmp = 0;
            if (crashActive) {
                crashActive = false;
                crashTimer  = 0;
                for (const p of crashPieces) {
                    p.mesh.parent = character.root;
                    p.mesh.position.copyFrom(p.origPos);
                    if (p.origQuat) {
                        p.mesh.rotationQuaternion = p.origQuat.clone();
                    } else {
                        p.mesh.rotationQuaternion = null;
                        p.mesh.rotation.copyFrom(p.origRot);
                    }
                }
                crashPieces = [];
                character.root.setEnabled(true);
                ragdoll = null;

                // The ragdoll wrote ski rotationQuaternions (flat slide to
                // rest); clear them so applyPose's Euler writes drive the
                // skis again on the next run.
                for (const nm of ['skiL', 'skiR']) {
                    const m = character.meshes[nm];
                    if (m) m.rotationQuaternion = null;
                }

                // Put the skinned body back and re-hide the drivers it replaced.
                // Skis are equipment and stay visible either way.
                for (const nm of Object.keys(character.meshes)) {
                    if (nm === 'skiL' || nm === 'skiR') continue;
                    const e = character.meshes[nm];
                    const m = (e && e.mesh) ? e.mesh : e;
                    if (m) m.isVisible = !window._bodyLinked;
                }
                for (const m of scene.meshes) {
                    if (!m.name) continue;
                    if (m.name.startsWith('athleteBody')) m.isVisible = true;
                    else if (/_shoulder$|_elbow$|_knee$|_hip$|_glove$|_boot|_buckle$|^neck$|^nose$|^visor$/.test(m.name)) {
                        m.isVisible = !window._bodyLinked;
                    }
                }
            }
            leftDown = false; rightDown = false;
            autoSpinActive = false; armSwapPhase = false;
            leftArmHoldTime = 0; rightArmHoldTime = 0;
            rightArmHoldTime = 0; leftArmHoldTime = 0;
            downHalfTwistFired = false;
            bothArmsSpinTarget = Infinity;
            doubleMode = false; powerWrapDown = false; arrowUpDown = false; frontFlipQueued = false; singleLayoutMode = false; singleFlipQueued = false;
            targetL_flip = 0.0;
            flipPower = 0; pmFill.style.width = '0%';
            billboard.isVisible = false;
            compLandingResult = null;
            // Show the queued trick now that skier is back at the top
            if (_compParam && compPendingTrick) {
                compHUDEl.textContent = compHudLabel(compPendingTrick);
            }

            readyState = true; readyTurnT = 0.0;
            return;
        }
        if (_keyIsLetter(e, 'c')) {
            cameraMode = (cameraMode + 1) % 3;
            _snapCamera(cameraMode);
            return;
        }
        if (_keyIsLetter(e, 'v')) {
            firstPersonMode = !firstPersonMode;
            _fpPos = null; // reset lerp state so next entry snaps in cleanly
            scene.activeCamera = firstPersonMode ? fpCamera : camera;
            // Disable the head (+ children: visor, nose) to avoid clipping into the lens
            character.meshes['head'].setEnabled(!firstPersonMode);
            const _fpNeck = scene.getMeshByName('neck');
            if (_fpNeck) _fpNeck.setEnabled(!firstPersonMode);
            return;
        }
        if (paused) return;
        // Mirror Keys setting: swap left/right arrow interpretation
        const _mirrorKeys = _lsGet('setting_mirrorkeys') === '1';
        const _kcode = (_mirrorKeys && e.code === 'ArrowLeft') ? 'ArrowRight'
                     : (_mirrorKeys && e.code === 'ArrowRight') ? 'ArrowLeft'
                     : e.code;
        if (_kcode === 'Space') {
            e.preventDefault();
            if (!state.crashed) state.tuckTarget = 1.0;
        }
        if (e.code === 'ShiftLeft') {
            if (!state.crashed && !state.grounded) state.pikeTarget = 1.0;
        }
        if (_keyIsLetter(e, 'a')) {
            if (!state.crashed && !state.grounded) offAxisTarget = 0.28;
        }
        if (_kcode === 'ArrowUp' || _kcode === 'ArrowDown') {
            e.preventDefault();
        }
        if (_kcode === 'ArrowDown' && !state.grounded && !state.crashed) {
            powerWrapDown = true;
        }
        if (_kcode === 'ArrowUp' && state.grounded && readyState && readyTurnT === 0.0) {
            if (_trampolineMode) {
                // Launch straight up — no turn animation needed
                readyState      = false;
                state.grounded  = false;
                state.vy        = TRAMPOLINE_LAUNCH_VY;
                state.flipDir   = 1;   // default backflip on launch
                state.L_flip    = I0 * TARGET_OMEGA_UNTUCKED;
                state.perFlipTwists   = [];
                state.lastFlipInt     = 0;
                state.spinAtFlipStart = state.spinAngle;
                state.spinBoundaries  = [];
                state.perFlipTucked   = [];
                state.currentFlipTucked = false;
                state.airTime   = 0.0;
                state.armSnap   = 0.0;
                state.layArmT   = 0.0;
                state.armRaise  = 0.0;
                state.armRaiseTarget = 0;
                state.armSnapTarget  = 0;
                singleLayoutMode = singleFlipQueued; // re-apply each jump without consuming
                startRecording();
            } else if (_trampolineMatMode) {
                // Start bouncing on the trampoline
                readyState      = false;
                matBounceCount  = 1;
                matTramBouncing = true;
                state.grounded  = false;
                state.vy        = 0;
                state.vz        = 0;
                state.flipAngle = 0;
                state.L_flip    = 0;
                matTramSpringY  = 0;
                matTramSpringVY = -4.5;
                matContactNX2   = 0;
                matContactNZ2   = 0;
                startRecording();
            } else if (_poolDiveMode) {
                // Begin push-off — legs extend, actual launch fires when straight
                _poolDiveLaunchPwr = flipPower;
                flipPower = 0; pmFill.style.width = '0%';
                poolDivePushing    = true;
                readyState         = false;
                state.tuckTarget   = 0;
                state.armRaise     = state.tuckAmount * 0.6;
                state.armRaiseTarget = 1;
            } else {
                // Begin turn-to-face-downhill animation
                readyTurnT = 0.001; // small non-zero to start animation
            }
        }
        if (_kcode === 'ArrowUp' && !state.grounded && !state.crashed) {
            // Raise arms straight up
            state.armRaiseTarget = 1;
            arrowUpDown = true;
            // Trampoline spring phase (not in air): queue front flip for this bounce
            if (_trampolineMode && tramBouncing) {
                state.flipDir = -1;
            } else if (_trampolineMode && !tramBouncing) {
                frontFlipQueued = true; // queued for next landing contact
            }
        }
        if (_keyIsLetter(e, 'd') && !state.crashed) {
            if (!state.grounded) {
                offAxisTarget = -0.28;
            } else if (_poolDiveMode) {
                poolDiveFaceBack = !poolDiveFaceBack;
                _updateDiveStanceHUD();
            } else {
                singleFlipQueued = !singleFlipQueued;
            }
        }
        if (_keyIsLetter(e, 'x') && !state.crashed && _trampolineMode) {
            singleFlipQueued = !singleFlipQueued;
        }
        if (_keyIsLetter(e, 'f') && !state.crashed && _poolDiveMode) {
            poolDiveFlipDirPref = poolDiveFlipDirPref === 1 ? -1 : 1;
            if (state.grounded) state.flipDir = poolDiveFlipDirPref;
            _updateDiveStanceHUD();
        }
        if (_kcode === 'ArrowLeft' && !leftDown && !state.crashed) {
            e.preventDefault();
            leftDown = true;
            if (rightDown && !doubleMode) {
                // → already held: undo any half-twist that already fired, then do one full left-spin twist
                if (downHalfTwistFired) state.spinTarget -= (_lsGet('setting_rightspin') === '1' ? Math.PI : -Math.PI); // undo half-twist
                state.spinTarget -= Math.PI * 2;
                bothArmsSpinTarget = state.spinTarget; // both arms down for this twist
                state.doubleDir = -1;
                secondKeyTimer = setTimeout(() => enterDoubleMode(-1), DOUBLE_HOLD_MS);
            }
            // else: drop left arm as wind-up, wait for →
        }
        if (_kcode === 'ArrowRight' && !rightDown && !state.crashed) {
            e.preventDefault();
            rightDown = true;
            if (leftDown && !doubleMode) {
                if (_trampolineMode) {
                    // ← already held (trampoline): fire one full left twist (no double-mode)
                    state.spinTarget += Math.PI * 2;
                } else {
                    // ← already held: fire one left twist immediately, start hold timer
                    state.spinTarget += Math.PI * 2;
                    state.doubleDir = 1;
                    secondKeyTimer = setTimeout(() => enterDoubleMode(1), DOUBLE_HOLD_MS);
                }
            }
            // else: drop right arm as wind-up, wait for ←
        }
    });
    window.addEventListener('keyup', e => {
        const _mirrorKeys = _lsGet('setting_mirrorkeys') === '1';
        const _kcode = (_mirrorKeys && e.code === 'ArrowLeft') ? 'ArrowRight'
                     : (_mirrorKeys && e.code === 'ArrowRight') ? 'ArrowLeft'
                     : e.code;
        if (_kcode === 'Space') state.tuckTarget = 0.0;
        if (e.code  === 'ShiftLeft') state.pikeTarget = 0.0;
        if (_keyIsLetter(e, 'a')) { if (offAxisTarget > 0) offAxisTarget = 0.0; }
        if (_keyIsLetter(e, 'd')) { if (offAxisTarget < 0) offAxisTarget = 0.0; }
        if (_kcode === 'ArrowDown') { powerWrapDown = false; downHalfTwistFired = false; }
        if (_kcode === 'ArrowUp') { arrowUpDown = false; frontFlipQueued = false; }
        if (_kcode === 'ArrowLeft' && leftDown) {
            leftDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
        if (_kcode === 'ArrowRight' && rightDown) {
            rightDown = false;
            if (doubleMode) exitDoubleMode();
            else if (secondKeyTimer !== null) { clearTimeout(secondKeyTimer); secondKeyTimer = null; }
        }
    });

    // ── Scoring (FIS degree of difficulty) ──────────────────────────────────
    // Difficulty table and trick matching now live in the shared engine core
    // (engine/core/tricks.js). calcDD accepts a per-discipline table.
    const DD_TABLE   = AerialEngine.tricks.DD_TABLE;
    const HS_KEY = `hs_${_worldParam}`;
    let highScore = parseFloat(_lsGet(HS_KEY) || '0');

    // ── Competition mode ──────────────────────────────────────────────────────
    const COMP_POOLS = {
        // Singles — only one flip, no ordering issue
        single_easy:   ['0','1'],
        single_medium: ['1','2'],
        single_hard:   ['0','1','2','3'],
        // Doubles — lays (0s) always come first
        double_easy:   ['0,1','1,1'],
        double_medium: ['1,2','2,1'],
        double_hard:   ['1,2','2,1','2,2','2,3'],
        // Triples — lays always precede spins
        triple_easy:   ['0,0,1','0,1,1','1,1,1'],
        triple_medium: ['1,1,1','1,2,1','2,1,1','1,1,2'],
        triple_hard:   ['1,2,1','2,1,2','1,3,1','2,2,2','1,3,2'],
        // Quads — lays always precede spins
        quad_easy:     ['0,0,1,1','0,1,1,1','1,1,1,1'],
        quad_medium:   ['1,1,1,1','0,1,2,1','1,2,1,1','2,1,1,2'],
        quad_hard:     ['1,2,1,1','2,2,1,1','2,2,2,2','2,1,3,1','2,2,3,2'],
        // Hardest — maximum difficulty per jump type
        single_hardest: ['t,t','t,1'],
        double_hardest: ['3,3','1,t,t'],
        triple_hardest: ['2,2,3','3,2,3'],
        quad_hardest:   ['2,3,2,3','2,t,1,2'],
        // Quint — five flips
        quint_easy:     ['0,0,0,1,1','0,0,1,1,1'],
        quint_medium:   ['1,1,1,1,1','2,1,1,1,1','2,2,1,1,1'],
        quint_hard:     ['2,1,2,1,1','1,2,2,2,1'],
        quint_hardest:  ['2,2,2,2,2','2,3,3,2,2'],
    };
    // Ultra — one trick per jump type, each on its matching world
    const ULTRA_POOL   = ['3','2,3','2,2,2','1,3,2','2,2,3,2'];
    const ULTRA_WORLDS = ULTRA_POOL.map(k => ['single','double','triple','quad'][k.split(',').length - 1]);
    const TWIST_NAMES_COMP = ['Lay', 'Full', 'Double Full', 'Triple Full', 'Quad Full', 'Quint Full', 'Sextuple Full', 'Septuple Full', 'Octuple Full', 'Nonuple Full', 'Decuple Full'];
    function trickKeyToName(key) {
        return key.split(',').map(n => n === 't' ? 'Tuck' : TWIST_NAMES_COMP[+n] || (n + 'x Full')).join('-');
    }
    // Match a landed trick against an assigned trick key.
    // 't' tokens require 0 twists AND the flip was tucked.
    // '0'-'3' tokens require matching twist count; for '0' in non-hardest pools
    //   tuck is not required (preserves existing easy/medium/hard behaviour).
    const matchTrick = AerialEngine.tricks.matchTrick;
    function compHudLabel(trick) {
        if (_compParam === 'ultra') return `☠ Jump ${_ultraJump + 1}/${ULTRA_POOL.length}: ${trickKeyToName(trick)}`;
        const total = _compProgression.length;
        const current = Math.min(compTricksLanded, total - 1) + 1;
        return `🏆 Trick ${current}/${total}: ${trickKeyToName(trick)}`;
    }
    // Progression uses the pool for the selected difficulty exactly as defined — no resorting.
    // easy uses only the easy pool, medium only medium, hard only hard.
    // Ultra returns only the single trick for the current ultrajump index.
    function buildCompProgression(worldParam, difficulty) {
        if (difficulty === 'ultra') return [ULTRA_POOL[_ultraJump]];
        return [...(COMP_POOLS[`${worldParam}_${difficulty}`] || [])];
    }
    const _compProgression = _compParam ? buildCompProgression(_worldParam, _compParam) : [];
    let compTricksLanded = 0;
    function pickNextCompTrick() {
        if (!_compProgression.length) return null;
        return _compProgression[Math.min(compTricksLanded, _compProgression.length - 1)];
    }
    let assignedTrick    = null; // revealed at takeoff
    let compPendingTrick = _compProgression.length ? pickNextCompTrick() : null; // queued until next jump
    // ── Olympics chosen trick ─────────────────────────────────────────────
    const _olympicsChosenTrick = _olympicsMode ? (_lsGet('olympics_chosen_trick') || null) : null;
    if (_olympicsChosenTrick) {
        compPendingTrick = _olympicsChosenTrick;
        _lsRemove('olympics_trick_picked'); // clear the "picked" guard now we've consumed it
    }
    let compLandingResult = null; // { matched: bool, neededKey: string|null }
    let compJustBeaten    = false; // true after final trick landed, until stop
    const compHUDEl = document.getElementById('compHUD');
    if (_compParam) {
        const _initHudTrick = _compParam === 'ultra'
            ? `☠ Jump ${_ultraJump + 1}/${ULTRA_POOL.length}: ${trickKeyToName(ULTRA_POOL[_ultraJump])}`
            : (compPendingTrick ? `🏆 Trick 1/${_compProgression.length}: ${trickKeyToName(compPendingTrick)}` : '🏆');
        compHUDEl.textContent = _initHudTrick;
        compHUDEl.style.display = 'block';
    }
    // ── Olympics mode state ───────────────────────────────────────────────
    let olympicsAttempts  = _olympicsMode ? parseInt(_lsGet('olympics_attempts') || '0', 10) : 0;
    let olympicsBestScore = _olympicsMode ? parseFloat(_lsGet('olympics_best_qual') || '0') : 0;
    let olympicsBestTrick = _olympicsMode ? (_lsGet('olympics_qual_trick') || '–') : '–';
    let olympicsDone      = false; // true after all attempts used in this session
    if (_olympicsMode) {
        compHUDEl.style.display = 'block';
        compHUDEl.style.borderColor = '#aa8800';
        compHUDEl.style.color = '#ffd700';
        const _chosenName = _olympicsChosenTrick ? trickKeyToName(_olympicsChosenTrick) : '–';
        if (_olympicsMode === 'qual') {
            compHUDEl.textContent = `🏅 Qualifier (${olympicsAttempts + 1}/2) — ${_chosenName}`;
        } else {
            compHUDEl.textContent = `🏅 Finals — ${_chosenName}`;
        }
    }
    // ── Olympics attempt handler ──────────────────────────────────────────
    function _handleOlympicsAttempt(score, trick) {
        if (_olympicsMode === 'finals') {
            olympicsDone = true;
            compHUDEl.textContent = score > 0 ? `🏅 Finals done — ${score.toFixed(1)} pts` : '🏅 Finals — Crash (0 pts)';
            setTimeout(function() {
                if (typeof window._olympicsFinalsDone === 'function') window._olympicsFinalsDone(score, trick);
            }, 1400);
            return;
        }
        // Qualifier
        olympicsAttempts++;
        if (score > olympicsBestScore) { olympicsBestScore = score; olympicsBestTrick = trick; }
        _lsSet('olympics_attempts', String(olympicsAttempts));
        _lsSet('olympics_best_qual', String(olympicsBestScore));
        _lsSet('olympics_qual_trick', olympicsBestTrick);
        if (olympicsAttempts >= 2) {
            olympicsDone = true;
            compHUDEl.textContent = `🏅 Qualifier done — Best: ${olympicsBestScore > 0 ? olympicsBestScore.toFixed(1) + ' pts' : 'no score'}`;
            setTimeout(function() {
                if (typeof window._olympicsQualDone === 'function') window._olympicsQualDone(olympicsBestScore, olympicsBestTrick);
            }, 1400);
        } else {
            compHUDEl.textContent = score > 0
                ? `🏅 Attempt 1 — ${score.toFixed(1)} pts · Press R to pick trick for attempt 2`
                : '🏅 Attempt 1 — Crash · Press R to pick trick for attempt 2';
        }
    }
    const calcDD     = AerialEngine.tricks.calcDD;

    // ── Billboard (shown when skier stops on outrun) ─────────────────────────
    const bbUI = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('bbUI', true, scene);
    const bbContainer = new BABYLON.GUI.Rectangle('bbContainer');
    bbContainer.width           = '600px';
    bbContainer.height          = '200px';
    bbContainer.cornerRadius    = 14;
    bbContainer.color           = 'rgba(0,0,0,0)';
    bbContainer.background      = 'rgba(0,0,0,0.6)';
    bbContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    bbContainer.verticalAlignment   = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    bbContainer.paddingRight    = '24px';
    bbContainer.isVisible       = false;
    bbUI.addControl(bbContainer);
    const bbStack = new BABYLON.GUI.StackPanel('bbStack');
    bbStack.isVertical = true;
    bbStack.width = '100%';
    bbContainer.addControl(bbStack);
    const bbName = new BABYLON.GUI.TextBlock('bbName');
    bbName.color        = '#ffffff';
    bbName.fontSize     = 30;
    bbName.fontFamily   = 'sans-serif';
    bbName.fontStyle    = 'bold';
    bbName.height       = '90px';
    bbName.textWrapping = BABYLON.GUI.TextWrapping.WordWrap;
    bbName.resizeToFit  = false;
    bbName.outlineWidth = 4;
    bbName.outlineColor = '#000000';
    bbStack.addControl(bbName);
    const bbSub = new BABYLON.GUI.TextBlock('bbSub');
    bbSub.color      = '#aaccff';
    bbSub.fontSize   = 21;
    bbSub.fontFamily = 'sans-serif';
    bbSub.height     = '50px';
    bbSub.outlineWidth = 3;
    bbSub.outlineColor = '#000000';
    bbStack.addControl(bbSub);
    const bbScore = new BABYLON.GUI.TextBlock('bbScore');
    bbScore.color      = '#ffee88';
    bbScore.fontSize   = 21;
    bbScore.fontFamily = 'sans-serif';
    bbScore.fontStyle  = 'bold';
    bbScore.height     = '46px';
    bbScore.outlineWidth = 3;
    bbScore.outlineColor = '#000000';
    bbStack.addControl(bbScore);
    const bbComp = new BABYLON.GUI.TextBlock('bbComp');
    bbComp.color       = '#00ff88';
    bbComp.fontSize    = 21;
    bbComp.fontFamily  = 'sans-serif';
    bbComp.fontStyle   = 'bold';
    bbComp.height      = '40px';
    bbComp.outlineWidth = 3;
    bbComp.outlineColor = '#000000';
    bbComp.isVisible   = false;
    bbStack.addControl(bbComp);
    // Grow container when comp row is visible
    const billboard = {
        get isVisible() { return bbContainer.isVisible; },
        set isVisible(v) {
            bbContainer.isVisible = v;
            bbContainer.height = (v && bbComp.isVisible) ? '240px' : '200px';
        }
    };
    const { hud, hint } = buildHUD(scene);
    const TUCK_RATE = 5.0;
    const PIKE_RATE = 2.0;
    const PIKE_RELEASE_RATE = 5.0;

    // ── Flip-power meter ──────────────────────────────────────────────────────
    // Show while on approach; hold ↓ to fill, release to stop filling.
    // At takeoff, L_flip is scaled by the meter value (0.3 → 1.0 of max).
    const pmEl    = document.getElementById('powerMeter');
    const pmFill  = document.getElementById('powerMeterFill');
    const pmTicks = document.getElementById('powerMeterTicks');
    let   flipPower = 0;          // 0.0 – 1.0
    let   pmActive  = false;      // true while meter is visible / accepting input
    let   pmDownHeld = false;     // true while ↓ is held on approach
    const APPROACH_START_Z = SLOPE_START_Z; // show meter from the top of the slope
    const FLIP_POWER_RATE  = AerialEngine.power.FILL_SECONDS; // seconds to fill from 0 → 1

    // Build flip-count tick marks.
    // powerScale = 0.3 + flipPower * 0.7; at powerScale=1 the world's nominal
    // flip count is achieved. Place a dash + label for each whole flip number.
    (function buildTicks() {
        // Ticks at 25/50/75/100% — evenly representing 1/2/3/4 flips
        for (let n = 1; n <= 4; n++) {
            const pct = (n / 4 * 100).toFixed(2);
            const tick = document.createElement('div');
            tick.className = 'pmTick';
            tick.style.left = pct + '%';
            pmTicks.appendChild(tick);
        }
    })();

    window.addEventListener('keydown', e => {
        if (e.code === 'ArrowDown' && state.grounded && !state.crashed) pmDownHeld = true;
    });
    window.addEventListener('keyup', e => {
        if (e.code === 'ArrowDown') {
            pmDownHeld = false;
            if (_poolDiveMode && pmActive && flipPower > 0 && readyState && !poolEntered)
                poolAutoLaunch = true;
        }
    });

    // ── First-person camera helper ────────────────────────────────────────────
    // Called each frame when firstPersonMode is true.
    // During flight: instant tracking (no spin lag). On landing: lerps smoothly
    // from wherever the camera was to the new upright orientation.
    function _updateFpCamera(dt) {
        character.root.computeWorldMatrix(true);
        character.meshes['head'].computeWorldMatrix(true);
        const _hMat = character.meshes['head'].getWorldMatrix();

        const _headPos = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), _hMat);
        const _fwd = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0, 0, -1), _hMat).normalize();
        const _up  = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), _hMat).normalize();
        const _eye = _headPos.add(_fwd.scale(0.08));

        if (!_fpPos) {
            // First frame in FP mode — snap instantly
            _fpPos = _eye.clone();
            _fpFwd = _fwd.clone();
            _fpUp  = _up.clone();
        } else {
            // Position always snaps instantly — prevents body drifting away from head.
            // Orientation lerps: instant airborne (snappy spins), slow grounded (smooth landing).
            _fpPos = _eye.clone();
            const rate = (state.grounded && dt > 0) ? 7.0 : 60.0;
            const t = Math.min(1, rate * dt);
            BABYLON.Vector3.LerpToRef(_fpFwd, _fwd, t, _fpFwd);
            BABYLON.Vector3.LerpToRef(_fpUp,  _up,  t, _fpUp);
            _fpFwd.normalizeToRef(_fpFwd);
            _fpUp.normalizeToRef(_fpUp);
        }

        fpCamera.position.copyFrom(_fpPos);
        fpCamera.upVector.copyFrom(_fpUp);
        fpCamera.setTarget(_fpPos.add(_fpFwd));
    }

    // ── Physics / render loop ─────────────────────────────────────────────────
    // Tuck transitions over 1/TUCK_RATE seconds (0.17 s)
    scene.registerBeforeRender(() => { try {
        const rawWallDt = engine.getDeltaTime() / 1000; // seconds
        // CLAMP, DON'T SKIP. Under catastrophic render stalls (SwiftShader
        // drive-suite measurements: sustained ~1 fps, rawWallDt ~1 s) a
        // wholesale skip freezes the simulation ENTIRELY — inputs settle but
        // nothing ever advances, which is the entry-18→21 waitForFunction
        // timeout class reproduced live (readyTurnT stuck at 0.001 across
        // dozens of rendered frames, posZ frozen). Processing a stalled
        // frame as a capped 0.1 s step keeps progress going at slow motion
        // with the same integration behaviour a busy-but-alive 8–10 fps
        // frame already gets (the old guard silently skipped only those
        // >100 ms, while historic 8–12 fps frames sat right ON the line).
        // Physics content of a single step is unchanged everywhere else.
        const rawDt = Math.min(Math.max(rawWallDt, 0), 0.1);
        const dt = rawDt * (window._tutorialTimeScale !== undefined ? window._tutorialTimeScale : 1.0);
        if (paused || rawWallDt <= 0) return; // skip when paused / non-monotonic

        // ── Replay playback ────────────────────────────────────────────────
        if (replayActive) {
            const replaySpeedEl = document.getElementById('replaySpeed');
            const speed = replaySpeedEl ? parseFloat(replaySpeedEl.value) : 1.0;
            replayAccum += speed;
            while (replayAccum >= 1) {
                replayAccum -= 1;
                replayIndex++;
                if (replayIndex >= replayFrames.length) {
                    replayActive = false;
                    const rsw = document.getElementById('replaySpeedWrap');
                    if (rsw) rsw.classList.remove('visible');
                    break;
                }
            }
            if (!replayActive) return;
            const f = replayFrames[Math.min(replayIndex, replayFrames.length - 1)];
            character.root.position.y = f.rootY;
            character.root.position.z = f.posZ;
            applyPose(character.meshes, f.tuckAmount, f.armDropL, f.armDropR, f.armSnap, f.layArmT, f.armRaise, f.grounded, f.pikeAmount || 0, f.pikeArmDrop || 0);
            const _faceBaseR = (_poolDiveMode && poolDiveFaceBack) ? 0.0 : Math.PI;
            const qFaceR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, _faceBaseR + (f.readyYaw || 0));
            if (f.grounded) {
                let tilt = 0;
                if (f.posZ >= SLOPE_START_Z && f.posZ <= OUTRUN_Z) {
                    const _eps  = 0.05;
                    const _dydz = (terrainRootY(f.posZ + _eps) - terrainRootY(f.posZ - _eps)) / (2 * _eps);
                    tilt = Math.atan(_dydz);
                }
                const qTilt = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, tilt);
                const qSpinR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, f.spinAngle);
                character.root.rotationQuaternion = qFaceR.multiply(qTilt).multiply(qSpinR);
            } else {
                const qFlipR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, f.flipAngle);
                const qSpinR = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, f.spinAngle);
                character.root.rotationQuaternion = qFaceR.multiply(qFlipR).multiply(qSpinR);
            }
            camera.target.y = f.rootY;
            camera.target.z = f.posZ;
            if (firstPersonMode) _updateFpCamera(dt);
            return;
        }

        if (_lsGet('setting_gamepad') === '1') pollGamepad();

        // ── Smooth tuck / pike transitions ─────────────────────────────────
        if (!state.crashed) {
            const tDiff = state.tuckTarget - state.tuckAmount;
            const step  = TUCK_RATE * dt;
            state.tuckAmount += (Math.abs(tDiff) <= step) ? tDiff : Math.sign(tDiff) * step;
            const pDiff = state.pikeTarget - state.pikeAmount;
            const pStep = (pDiff < 0 ? PIKE_RELEASE_RATE : PIKE_RATE) * dt;
            state.pikeAmount += (Math.abs(pDiff) <= pStep) ? pDiff : Math.sign(pDiff) * pStep;
            // Drive arms down to sides when pike is releasing
            if (state.pikeAmount > 0.001) {
                if (state.pikeTarget === 0) {
                    state.pikeArmDrop = Math.min(1, state.pikeArmDrop + PIKE_RELEASE_RATE * dt);
                    state.armDropL    = 1.0;
                    state.armDropR    = 1.0;
                } else {
                    state.pikeArmDrop = 0;
                }
            } else {
                state.pikeArmDrop = 0;
            }
            // Pike and tuck are mutually exclusive: whichever is currently active wins
            if (state.pikeAmount > 0.01) state.tuckAmount = 0;
            if (state.tuckAmount > 0.01) state.pikeAmount = 0;
        }

        // ── Terrain physics (frictionless) ────────────────────────────────
        // ── Power meter visibility ──────────────────────────────────────────
        const onApproach = _poolDiveMode
            ? (state.grounded && readyState)
            : (!_trampolineMode && !_trampolineMatMode && state.grounded && state.posZ >= APPROACH_START_Z && state.posZ < KICKER_END_Z);
        if (onApproach && !pmActive) {
            pmActive = true;
            pmEl.style.display = 'block';
        } else if (!onApproach && pmActive) {
            pmActive = false;
            pmEl.style.display = 'none';
        }
        if (pmActive && pmDownHeld && (_poolDiveMode || !readyState)) {
            flipPower = Math.min(1, flipPower + dt / FLIP_POWER_RATE);
            pmFill.style.width = (flipPower * 100).toFixed(1) + '%';
        }
        // ── Arm hold timers (count how long each single arm has been up on inrun) ──
        if (state.grounded) {
            if (rightDown && !leftDown) leftArmHoldTime  += dt; else leftArmHoldTime  = 0;
            if (leftDown && !rightDown) rightArmHoldTime += dt; else rightArmHoldTime = 0;
        }
        // ── Down mid-air press → half twist ───────────────────────────────
        if (!state.grounded && !state.crashed && powerWrapDown && !doubleMode && !downHalfTwistFired) {
            const _rightSpin = _lsGet('setting_rightspin') === '1';
            state.spinTarget += _rightSpin ? Math.PI : -Math.PI;
            downHalfTwistFired = true;
        }
        if (state.grounded) {
            // ── Pool dive: platform lock, crouch, push-off ─────────────────────
            if (_poolDiveMode && !poolEntered) {
                state.vz   = 0;
                state.posZ = POOL_DIVE_PLATFORM_Z;

                if (poolDivePushing) {
                    // Legs are springing out — character rises with them
                    state.tuckTarget = 0;
                    state.rootY = POOL_DIVE_ROOT_Y - state.tuckAmount * 0.45;
                    // Launch the moment legs are nearly straight
                    if (state.tuckAmount < 0.06) {
                        poolDivePushing = false;
                        state.grounded  = false;
                        const _cp = Math.max(0.25, _poolDiveLaunchPwr);
                        state.vy = 1.5 + (POOL_DIVE_LAUNCH_VY - 1.5) * _cp;
                        state.vz = PLATFORM_CONFIGS[activePlatIdx].launchVZ;
                        state.flipDir   = poolDiveFlipDirPref;
                        state.L_flip    = I0 * TARGET_OMEGA_UNTUCKED * (Math.max(0.05, _poolDiveLaunchPwr) / 0.75);
                        state.perFlipTwists = []; state.lastFlipInt = 0;
                        state.spinAtFlipStart = state.spinAngle;
                        state.spinBoundaries = []; state.perFlipTucked = [];
                        state.currentFlipTucked = false; state.airTime = 0.0;
                        state.armSnap = 0.0; state.layArmT = 0.0; state.armSnapTarget = 0;
                        startRecording();
                    }
                } else if (readyState) {
                    // Crouch only while ↓ is held
                    state.tuckTarget = pmDownHeld ? 0.85 : 0;
                    state.rootY = POOL_DIVE_ROOT_Y - state.tuckAmount * 0.45;
                }

                // Trigger push-off (from auto-release or manual ↑)
                if (poolAutoLaunch && readyState) {
                    poolAutoLaunch     = false;
                    _poolDiveLaunchPwr = flipPower;
                    flipPower = 0; pmFill.style.width = '0%';
                    poolDivePushing    = true;
                    readyState         = false;
                    state.tuckTarget   = 0;
                    state.armRaise     = state.tuckAmount * 0.6;
                    state.armRaiseTarget = 1;
                }
            }
            // ── Ready state: freeze at top until ↑ pressed ──────────────────
            if (readyState) {
                if (readyTurnT > 0) {
                    // Advancing turn animation
                    readyTurnT = Math.min(1.0, readyTurnT + dt / READY_TURN_DUR);
                    if (readyTurnT >= 1.0) {
                        readyState  = false;
                        readyTurnT  = 1.0;
                        startRecording();
                    }
                }
                if (readyTurnT < 1.0) {
                    // Still waiting or turning — don't accelerate yet
                    state.vz = 0;
                }
            }
            const prevZ = state.posZ;
            state.vz   += terrainAccelZ(state.posZ) * dt;
            if (readyState && readyTurnT < 1.0) state.vz = 0; // prevent any slide before run begins
            if (!_poolDiveMode && state.posZ > OUTRUN_Z && state.vz < 0) {
                state.vz = 0;
                if (!state.stopped && !state.crashed && state.trickName) {
                    state.stopped = true;
                    if (typeof window._onSkierStopped === 'function') window._onSkierStopped();
                    stopRecording();
                    const totalFlips  = state.perFlipTwists.length;
                    const totalTwists = state.perFlipTwists.reduce((a, b) => a + b, 0);
                    const dd    = calcDD(state.perFlipTwists);
                    const score = Math.round(dd * state.execution * 10) / 10;
                    const isNew = score > highScore;
                    if (isNew) { highScore = score; _lsSet(HS_KEY, score); }
                    bbName.text  = state.trickName;
                    bbSub.text   = _compParam ? '' : `${totalFlips} flip${totalFlips !== 1 ? 's' : ''} · ${totalTwists} twist${totalTwists !== 1 ? 's' : ''}  ·  DD ${dd}  ×  exec ${state.execution}`;
                    bbScore.text = _compParam ? '' : (isNew ? `★ NEW BEST  ${score}` : `${score}  (best: ${highScore})`);
                    bbSub.isVisible   = !_compParam && !_realisticMode;
                    bbScore.isVisible = !_compParam && !_realisticMode;
                    if (compLandingResult !== null) {
                        bbComp.text      = compLandingResult.matched ? '✓ Trick Complete!' : `✗ Needed: ${trickKeyToName(compLandingResult.neededKey)}`;
                        bbComp.color     = compLandingResult.matched ? '#00ff88' : '#ff6644';
                        bbComp.isVisible = true;
                    }
                    billboard.isVisible = true;
                    if (_compParam && !compJustBeaten) {
                        const _msg = (compLandingResult && !compLandingResult.matched) ? 'Press R to restart...' : 'Press R to continue...';
                        compHUDEl.textContent = (_compParam === 'ultra' ? '☠ ' : '🏆 ') + _msg;
                    }
                    if (compJustBeaten) {
                        compJustBeaten = false;
                        const isLastUltraJump = _compParam === 'ultra' && _ultraJump === ULTRA_POOL.length - 1;
                        if (_compParam !== 'ultra' || isLastUltraJump) {
                            if (typeof window.showCongratsScreen === 'function') window.showCongratsScreen(_compParam === 'ultra' ? 'quad' : _worldParam, _compParam);
                        } else {
                            compHUDEl.textContent = '☠ Press R for next jump →';
                        }
                    }
                    // ── Olympics attempt tracking (good landing) ─────────
                    if (_olympicsMode && !olympicsDone) {
                        const _trickMatched = !compLandingResult || compLandingResult.matched;
                        _handleOlympicsAttempt(_trickMatched ? score : 0, _trickMatched ? state.trickName : 'Wrong Trick');
                    }
                }
            }

            state.posZ += state.vz * dt;

            // Only launch when actually crossing the kicker tip (not after landing past it)
            const crossingJ1 = !_poolDiveMode && prevZ <= KICKER_END_Z && state.posZ > KICKER_END_Z;
            if (crossingJ1) {
                // Kicker launch snow spray — scaled to approach speed
                _spawnSnowBurst(0, terrainRootY(KICKER_END_Z), KICKER_END_Z, 55, state.vz / 10);
                state.vy       = state.vz * Math.sin(KICKER_ANGLE);
                state.vz       = state.vz * Math.cos(KICKER_ANGLE);
                state.rootY    = terrainRootY(KICKER_END_Z) + 0.10;
                state.grounded       = false;
                state.landingLean    = 0;
                state.landingLeanVel = 0;
                state.flipAngle = KICKER_ANGLE; // start from kicker lip tilt — no snap to upright on takeoff
                // Reset per-flip twist tracking
                state.perFlipTwists   = [];
                state.lastFlipInt     = 0;
                state.spinAtFlipStart = state.spinAngle;
                state.spinBoundaries  = [];
                state.perFlipTucked   = [];
                state.currentFlipTucked = false;
                state.airTime         = 0.0;
                state.armSnap         = 0.0;
                state.layArmT         = 0.0;
                state.armRaise        = 0.0;
                state.armRaiseTarget  = 0;
                state.armSnapTarget   = 0;
                // Hide billboard on takeoff
                billboard.isVisible   = false;
                bbComp.isVisible      = false;
                compLandingResult     = null;
                state.stopped         = false;
                // Reveal the pending trick now that skier is airborne
                if (compPendingTrick !== null) {
                    assignedTrick    = compPendingTrick;
                    compPendingTrick = null;
                    if (_olympicsMode) {
                        compHUDEl.textContent = `🏅 ${_olympicsMode === 'finals' ? 'Finals' : 'Qualifier'} — ${trickKeyToName(assignedTrick)}`;
                    } else {
                        compHUDEl.textContent = compHudLabel(assignedTrick);
                    }
                }
                // Apply flip power: 3rd dash (75%) = world-normal flip speed.
                // Gamepad: minimum 75% so a normal take-off always produces a full flip;
                // holding L2 on approach charges up to 133% for extra speed.
                const _gpMode = _lsGet('setting_gamepad') === '1';
                targetL_flip = I0 * TARGET_OMEGA_UNTUCKED
                             * AerialEngine.power.flipSpeedMultiplier(flipPower, _gpMode);
                state.L_flip = targetL_flip;
                // Reset meter for next jump
                flipPower = 0;
                pmFill.style.width = '0%';
                    // Arm up at takeoff → 2 fast twists toward that side (only if held long enough)
                if (rightDown && !leftDown && leftArmHoldTime >= ARM_HOLD_REQ) {
                    state.spinTarget = state.spinAngle + Math.PI * 4;
                    armSwapPhase = true;
                    armSwapDir   = 1;
                    autoSpinActive = false;
                } else if (leftDown && !rightDown && rightArmHoldTime >= ARM_HOLD_REQ) {
                    state.spinTarget = state.spinAngle - Math.PI * 4;
                    armSwapPhase = true;
                    armSwapDir   = -1;
                    autoSpinActive = false;
                }
            } else {
                if (_poolDiveMode && !poolEntered) {
                    state.rootY = POOL_DIVE_ROOT_Y - state.tuckAmount * 0.45; // sink into crouch
                } else if (!_poolDiveMode) {
                    if (!(_trampolineMatMode && matLanded)) {
                        // Extra lift on the landing slope so the rear ski tip clears
                        // the terrain surface (ski extends back into rising terrain on steep slopes)
                        const _onLanding = state.posZ > LANDING_START_Z && state.posZ < OUTRUN_Z;
                        state.rootY = terrainRootY(state.posZ) + (_onLanding ? 0.22 : 0.10);
                    }
                    // When upright (readyState, tilt=0) the full FOOT_OFFSET goes straight
                    // down so the skis sit on the surface. As tilt increases, compensate so
                    // the foot doesn't sink: rootY lifts by FOOT_OFFSET*(1-cos(tilt)).
                    if (readyState && readyTurnT < 1.0) {
                        const rawTilt = -SLOPE_ANGLE; // slope angle at start position
                        const blendedTilt = rawTilt * readyTurnT;
                        state.rootY += FOOT_OFFSET * (1.0 - Math.cos(blendedTilt));
                    }
                    // Inrun crouch: sink root down so body comes toward skis
                    state.rootY -= state.tuckAmount * 0.35;
                }
            }
            // Landing lean spring-damper — decays residual lean from landing rotation
            if (state.landingLean !== 0 || state.landingLeanVel !== 0) {
                const _LS = 9.0; // spring constant (rad/s² per rad)
                const _LD = 6.0; // damping coefficient
                state.landingLeanVel += (-_LS * state.landingLean - _LD * state.landingLeanVel) * dt;
                state.landingLean    += state.landingLeanVel * dt;
                if (Math.abs(state.landingLean) < 0.005 && Math.abs(state.landingLeanVel) < 0.01) {
                    state.landingLean    = 0;
                    state.landingLeanVel = 0;
                }
            }
        } else {
            // Skip gravity & position update while riding the trampoline spring or mat tram spring
            if (!tramBouncing && !matTramBouncing) {
                if (poolEntered) {
                    // Water drag — strength set by entry quality at impact
                    const _wD = Math.max(0, 1 - poolEntryDrag * dt);
                    state.vy *= _wD;
                    state.vz *= _wD;
                } else {
                    state.vy -= GRAVITY * dt;
                }
                state.rootY += state.vy * dt;
            }
            if (!tramBouncing) {
                state.posZ  += state.vz * dt;
            }
            // Stop at pool bottom or when slow enough
            if (poolEntered && !state.grounded) {
                const _pBot = poolSurfaceY - POOL_DEPTH + 1.0;
                if (state.rootY < _pBot) {
                    state.rootY = _pBot; state.vy = 0; state.vz = 0;
                    state.grounded = true; state.stopped = true;
                } else if (Math.abs(state.vy) < 0.25 && Math.abs(state.vz) < 0.1) {
                    state.vy = 0; state.vz = 0;
                    state.grounded = true; state.stopped = true;
                }
            }
            // Track air time and tuck time for execution scoring
            state.airTime    += dt;
            // Keep Olympics trick name visible during flight
            if (_olympicsMode && assignedTrick && !olympicsDone) {
                const _phase = _olympicsMode === 'finals' ? 'Finals' : `Qual ${olympicsAttempts + 1}/2`;
                compHUDEl.textContent = `🏅 ${_phase} — ${trickKeyToName(assignedTrick)}`;
            }

            const surY   = terrainRootY(state.posZ);
            if (!_poolDiveMode && !tramBouncing && !matTramBouncing && state.rootY <= surY) {
                if (_trampolineMatMode) {
                    // ── Mat-mode landing detection ──────────────────────────
                    const onTram = state.posZ >= MAT_TRAM_START_Z && state.posZ <= MAT_TRAM_END_Z;
                    if (!matLanded && (matBounceCount === 1 || matBounceCount === 2) && onTram) {
                        // Bounces 2 and 3: land back on trampoline → trigger next spring
                        matBounceCount++;
                        matTramBouncing = true;
                        matTramSpringY  = 0;
                        matTramSpringVY = state.vy;
                        state.vy    = 0;
                        state.rootY = TRAMPOLINE_Y + 0.10;
                        matContactNX2 = 0;
                        matContactNZ2 = Math.max(-1, Math.min(1,
                            (state.posZ - MAT_TRAM_CENTER_Z) / ((MAT_TRAM_END_Z - MAT_TRAM_START_Z) / 2)));
                    } else if (!matLanded && matBounceCount === 3 &&
                               state.posZ >= MAT_LAND_START_Z && state.posZ <= MAT_LAND_END_Z) {
                        // Land on crash mat
                        const incomingVY = state.vy;
                        matLanded = true;
                        matLandSpringY    = Math.min(0, Math.max(-0.40, incomingVY / 25.0));
                        matLandSpringVY   = 0;
                        matLandContactNZ2 = Math.max(-1, Math.min(1,
                            (state.posZ - MAT_LAND_CENTER_Z) / ((MAT_LAND_END_Z - MAT_LAND_START_Z) / 2)));
                        state.vy      = 0;
                        state.vz      = 0;
                        state.grounded = true;
                        state.rootY   = TRAMPOLINE_Y + 0.38; // feet on mat surface (MAT_H=0.28 + 0.10)
                        state.tuckTarget = 0;
                        state.tuckAmount = 0;
                        state.pikeTarget = 0;
                        state.pikeAmount = 0;
                        state.flipAngle  = 0;
                        state.stopped    = true;
                    } else if (!matLanded && matBounceCount >= 3) {
                        // Missed or overshot mat — crash
                        state.crashed  = true;
                        state.vy = 0; state.vz = 0;
                        state.grounded = true;
                        state.rootY = surY + 0.10;
                    }
                } else if (_trampolineMode) {
                    // ── Check landing zone ─────────────────────────────────
                    const _tTWO_PI    = Math.PI * 2;
                    const _tNorm      = ((state.flipAngle % _tTWO_PI) + _tTWO_PI) % _tTWO_PI;
                    const _tFeetTol   = Math.PI / 3;              // 60° — clean feet-down
                    const _tReboundTol = 100 * Math.PI / 180;     // 100° — snap-to-flat zone
                    const _tFeetDown  = _tNorm < _tFeetTol || _tNorm > _tTWO_PI - _tFeetTol;
                    const _tNearFeet  = _tNorm < _tReboundTol || _tNorm > _tTWO_PI - _tReboundTol;
                    if (!_tNearFeet) {
                        // CRASH — more than 100° from upright, too inverted to recover
                        state.crashed    = true;
                        state.vy         = 0;
                        state.grounded   = true;
                        state.rootY      = surY + 0.10;
                        state.tuckAmount = 0;
                        state.tuckTarget = 0;
                        state.pikeAmount = 0;
                        state.pikeTarget = 0;
                        state.crashAngle = _tNorm < Math.PI ? Math.PI : Math.PI * 1.5;
                    } else if (!_tFeetDown) {
                        // Snap to stomach/back and rebound — 60°–100° from upright
                        // Contact point based on actual angle before snapping
                        const _crZ = Math.sin(_tNorm) * FOOT_OFFSET;
                        tramContactNX = 0;
                        tramContactNZ = Math.max(-1, Math.min(1, _crZ / (TRAM_GRID_D / 2)));
                        tramSpringY  = 0;
                        tramSpringVY = state.vy;  // negative (downward)
                        tramBouncing = true;
                        state.vy     = 0;
                        state.rootY  = TRAMPOLINE_Y + 0.10;
                        // Snap flip angle to nearest horizontal (back=π/2, stomach=3π/2)
                        state.flipAngle = _tNorm < Math.PI ? Math.PI / 2 : Math.PI * 1.5;
                        state.L_flip    = I0 * TARGET_OMEGA_UNTUCKED;
                        state.frontFlipCount = 0;
                        state.tuckAmount = 0;
                        state.tuckTarget = 0;
                        state.pikeAmount = 0;
                        state.pikeTarget = 0;
                        armSwapPhase   = false;
                        autoSpinActive = false;
                        powerWrapDown  = false;
                        doubleMode     = false;
                    } else {
                    // ── Trampoline contact: player's velocity drives spring ──
                    // Contact point: feet (or touching body part) based on flip angle at landing
                    const _cZ = Math.sin(state.flipAngle * state.flipDir) * FOOT_OFFSET;
                    tramContactNX = 0;
                    tramContactNZ = Math.max(-1, Math.min(1, _cZ / (TRAM_GRID_D / 2)));
                    tramSavedReboundVY = TRAMPOLINE_LAUNCH_VY;
                    // Hand off player's downward velocity to the spring — it
                    // decelerates naturally under spring force, reaches max
                    // compression, then pushes back up.
                    tramSpringY  = 0;
                    tramSpringVY = state.vy;  // negative (downward)
                    tramBouncing = true;
                    state.vy     = 0;
                    state.rootY  = TRAMPOLINE_Y + 0.10;
                    state.flipAngle = 0.0;
                    state.flipDir  = frontFlipQueued ? -1 : 1;
                    frontFlipQueued = false;
                    arrowUpDown = false;
                    state.L_flip   = I0 * TARGET_OMEGA_UNTUCKED;
                    // grounded stays false — spring drives position
                    state.tuckAmount = 0;
                    state.tuckTarget = 0;
                    state.pikeAmount = 0;
                    state.pikeTarget = 0;
                    // Snap spin to nearest half-twist (0°, 180°, 360° …)
                    const snapSpin   = Math.round(state.spinAngle / Math.PI) * Math.PI;
                    state.spinAngle  = snapSpin;
                    state.spinTarget = snapSpin;
                    state.spinMult   = 1.0;
                    state.armDropL   = 1.0;
                    state.armDropR   = 1.0;
                    state.perFlipTwists   = [];
                    state.lastFlipInt     = 0;
                    state.frontFlipCount  = 0;
                    state.spinAtFlipStart = 0;
                    state.spinBoundaries  = [];
                    state.perFlipTucked   = [];
                    state.currentFlipTucked = false;
                    state.airTime = 0;
                    armSwapPhase  = false;
                    autoSpinActive = false;
                    powerWrapDown  = false;
                    doubleMode     = false;
                    } // end feet-down bounce
                } else {
                // Landing validation now lives in the shared engine core
                // (engine/core/landing.js) — ski, trampoline and diving all
                // validate rotation at contact the same way, only the tolerance
                // differs, which is why it is a parameter.
                const TWO_PI   = AerialEngine.math.TWO_PI;
                const norm     = AerialEngine.math.normalizeAngle(state.flipAngle);
                const LAND_TOL = AerialEngine.landing.DEFAULT_LAND_TOL;
                const feetDown = AerialEngine.landing.isFeetDown(state.flipAngle);

                const _onLandSlope = state.posZ > LANDING_START_Z && state.posZ < OUTRUN_Z;
                state.rootY      = surY + (_onLandSlope ? 0.22 : 0.10);
                state.vy         = 0;
                state.grounded   = true;
                const capturedSpin = state.spinAngle;
                // Snap to nearest half-turn so backward landings stay backward
                const snapSpin   = Math.round(capturedSpin / Math.PI) * Math.PI;
                state.spinAngle  = snapSpin;
                state.spinTarget = snapSpin;
                // Odd number of half-turns means facing backward — that's a crash
                const facingBackwards = Math.abs(Math.round(snapSpin / Math.PI)) % 2 === 1;
                const goodLanding = feetDown && !facingBackwards;
                // Landing snow burst — speed-scaled, heavier on crash
                {
                    const impactSpeed = Math.abs(state.vz);
                    const _cnt = goodLanding ? 45 : 90;
                    _spawnSnowBurst(0, surY + 0.05, state.posZ, _cnt, impactSpeed / 12);
                    // Camera shake — brief impulse proportional to impact
                    const _shakeAmp = Math.min(0.25, impactSpeed * 0.018);
                    camera.target.y += _shakeAmp;
                    setTimeout(() => { camera.target.y -= _shakeAmp * 2; }, 60);
                    setTimeout(() => { camera.target.y += _shakeAmp;     }, 120);
                }
                state.tuckTarget = 0;
                state.tuckAmount = 0;
                state.pikeTarget = 0;
                state.pikeAmount = 0;
                armSwapPhase   = false;
                autoSpinActive = false;
                state.spinMult  = 1.0; // reset spin multiplier on landing
                powerWrapDown   = false; // clear power wrap on landing

                if (goodLanding) {
                    // Compute per-flip twists from recorded spin boundary values.
                    // spinBoundaries records the spin angle at each completed flip revolution.
                    // If the skier overshoots slightly, the last boundary fires before landing,
                    // and capturedSpin would create a spurious near-zero trailing interval.
                    // Only add capturedSpin when boundaries don't yet cover all completed flips.
                    const completedFlips = Math.round(Math.abs(state.flipAngle) / (Math.PI * 2));
                    const spinPoints = [state.spinAtFlipStart, ...state.spinBoundaries];
                    if (spinPoints.length - 1 < completedFlips) spinPoints.push(capturedSpin);
                    // Capture tuck status for the last (current) flip
                    const lastFlipTucked = state.currentFlipTucked || state.tuckAmount > 0.3;
                    const tuckedPerFlip = [...state.perFlipTucked];
                    if (tuckedPerFlip.length < completedFlips) tuckedPerFlip.push(lastFlipTucked);
                    state.perFlipTwists = [];
                    for (let i = 0; i < spinPoints.length - 1; i++) {
                        state.perFlipTwists.push(Math.round(Math.abs(spinPoints[i + 1] - spinPoints[i]) / (Math.PI * 2)));
                    }
                    // Build trick name
                    const TWIST_NAMES = ['Lay', 'Full', 'Double Full', 'Triple Full', 'Quad Full', 'Quint Full', 'Sextuple Full', 'Septuple Full', 'Octuple Full', 'Nonuple Full', 'Decuple Full'];
                    state.trickName = state.perFlipTwists
                        .map((t, i) => t === 0 && tuckedPerFlip[i] ? 'Tuck' : TWIST_NAMES[t] || (t + 'x Full'))
                        .join('-');
                    // ── Achievement: Triple Full-Triple Full-Triple Full on triple jump ─
                    if (_worldParam === 'triple' && state.trickName === 'Triple Full-Triple Full-Triple Full') {
                        _lsSet('ach_3f3f3f', '1');
                    }
                    // ── Competition progression ───────────────────────────────
                    if (assignedTrick !== null) {
                        const _matched = matchTrick(state.perFlipTwists, tuckedPerFlip, assignedTrick);
                        compLandingResult = { matched: _matched, neededKey: _matched ? null : assignedTrick };
                        assignedTrick = null; // clear until next takeoff
                        if (_matched && _compProgression.length) {
                            compTricksLanded++;
                            // Check if this was the final trick in the progression
                            if (compTricksLanded >= _compProgression.length) {
                                // For ultra: only save trophy on the last jump
                                const isLastUltraJump = _compParam === 'ultra' && _ultraJump === ULTRA_POOL.length - 1;
                                if (_compParam !== 'ultra' || isLastUltraJump) {
                                    const beatenKey = _compParam === 'ultra' ? 'comp_beaten_quad_ultra' : `comp_beaten_${_worldParam}_${_compParam}`;
                                    const wasNew = _lsGet(beatenKey) !== '1';
                                    _lsSet(beatenKey, '1');
                                    // Check if this completes the entire collection
                                    if (wasNew) {
                                        const allBase = ['single','double','triple','quad'].every(w =>
                                            ['easy','medium','hard','hardest'].every(d => _lsGet(`comp_beaten_${w}_${d}`) === '1')
                                        ) && _lsGet('comp_beaten_quad_ultra') === '1';
                                        const allQuint = ['easy','medium','hard','hardest'].every(d => _lsGet(`comp_beaten_quint_${d}`) === '1');
                                        if (allBase && allQuint) window._justCompletedAll = true;
                                    }
                                }
                                compJustBeaten = true;
                            }
                            compPendingTrick = pickNextCompTrick();
                        } else {
                            // Missed trick — reset to start of progression
                            compTricksLanded = 0;
                            compPendingTrick = pickNextCompTrick();
                        }
                        if (!compJustBeaten) {
                            // HUD updated to 'Press R' when state.stopped fires at outrun
                        }
                    }
                    // ── Execution score ──────────────────────────────────────
                    // Forward lean (norm in [0, LAND_TOL]) scores highest — max forward = 30, upright = 15.
                    // Backward lean (norm in (TWO_PI-LAND_TOL, TWO_PI]) scores lowest — max backward = 0.
                    state.execution = AerialEngine.landing.executionScore(state.flipAngle);
                    state.crashed   = false;
                    if (typeof window._onQualifyLanded === 'function') window._onQualifyLanded(state.perFlipTwists, tuckedPerFlip.slice(), state.execution);
                    // Seed landing lean from captured rotation + residual angular momentum
                    const _signedLean = AerialEngine.landing.signedLean(state.flipAngle);
                    const _omegaLand  = state.L_flip / I0;
                    state.landingLean    = _signedLean;
                    state.landingLeanVel = _omegaLand * state.flipDir * 0.3;
                    state.flipAngle = 0;
                    state.flipDir   = 1;
                    // preserve vz so skier glides away down the landing slope
                } else {
                    state.crashed = true;
                    state.flipDir = 1;
                    state.vz      = 0; // stop sliding on crash
                    // Crash — reset comp progression, queue new trick for next jump
                    if (assignedTrick !== null) {
                        assignedTrick    = null;
                        compTricksLanded = 0;
                        compPendingTrick = pickNextCompTrick();
                        if (!_olympicsMode) compHUDEl.textContent = '🏆 Press R to restart...';
                    }
                    // Olympics crash — counts as a 0-score attempt
                    if (_olympicsMode && !olympicsDone) {
                        _handleOlympicsAttempt(0, 'Crash');
                    }
                    // Realistic mode qualification crash hook
                    if (typeof window._onQualifyCrash === 'function') window._onQualifyCrash();
                    // Snap toward nearest lying-flat angle:
                    // norm < π  → back leading → land on back  (π)
                    // norm >= π → front leading → land on stomach (3π/2 → face down)
                    state.crashAngle = norm < Math.PI ? Math.PI : Math.PI * 1.5;
                }
                } // end !_trampolineMode landing
            }
            // ── Pool entry ─────────────────────────────────────────────────
            if (poolVisible && !poolEntered && !state.grounded &&
                state.posZ >= POOL_Z_START && state.posZ <= POOL_Z_END &&
                state.rootY <= poolSurfaceY) {
                poolEntered    = true;
                poolSplashAmp  = Math.min(0.55, Math.abs(state.vy) * 0.055);
                poolSplashImpX = _poolDiveMode ? POOL_DIVE_PLATFORM_X : 0;
                poolSplashImpZ = state.posZ;
                // Build trick + score (mirrors normal landing logic)
                const _pPI2  = Math.PI * 2;
                const _pNorm = ((state.flipAngle % _pPI2) + _pPI2) % _pPI2;
                const _pTOL  = Math.PI / 4;
                const _pSpN  = ((state.spinAngle % _pPI2) + _pPI2) % _pPI2;
                const _pGood = (_pNorm < _pTOL || _pNorm > _pPI2-_pTOL) &&
                               (_pSpN < _pTOL || _pSpN > _pPI2-_pTOL || Math.abs(_pSpN-Math.PI) < _pTOL);
                const _pFlips = Math.round(Math.abs(state.flipAngle) / _pPI2);
                const _pPts   = [state.spinAtFlipStart, ...state.spinBoundaries];
                if (_pPts.length - 1 < _pFlips) _pPts.push(state.spinAngle);
                const _pTucks = [...state.perFlipTucked];
                if (_pTucks.length < _pFlips) _pTucks.push(state.currentFlipTucked || state.tuckAmount > 0.3);
                const _pTwists = [];
                for (let _pi = 0; _pi < _pPts.length-1; _pi++)
                    _pTwists.push(Math.round(Math.abs(_pPts[_pi+1]-_pPts[_pi]) / _pPI2));
                const _TN = ['Lay','Full','Double Full','Triple Full','Quad Full','Quint Full'];
                state.perFlipTwists = _pTwists;
                state.trickName = _pTwists.length
                    ? _pTwists.map((t,i) => t===0&&_pTucks[i]?'Tuck':(_TN[t]||(t+'x Full'))).join('-')
                    : '';
                if (_pGood) {
                    const _ef = _pNorm <= _pTOL ? _pNorm/_pTOL : (_pPI2-_pNorm)/_pTOL;
                    state.execution = Math.max(0, Math.round((28 + _ef)*10)/10);
                } else {
                    state.execution = Math.max(0, Math.round(10*(1-Math.min(1,Math.min(_pNorm,_pPI2-_pNorm)/Math.PI))*10)/10);
                }
                // Entry quality: vertical (feet/head first) = 1, belly/back flop = 0
                const _eq = Math.abs(Math.cos(state.flipAngle));
                const _impactVY = Math.abs(state.vy);   // capture before velocity reduction
                // Good entry preserves more velocity; flop absorbs most of it
                const _keep = 0.30 + 0.20 * _eq;  // flop=0.30, perfect=0.50
                state.vy *= _keep;
                state.vz *= _keep;
                // Good entry → lower drag → noticeably deeper but not extreme
                poolEntryDrag = 4.5 - 2.6 * _eq;  // flop≈4.5, perfect≈1.9
                state.L_flip = 0;
                state.spinTarget = state.spinAngle;
                stopRecording();
                // Score display only in ski mode (pool dive has no score yet)
                if (!_poolDiveMode && (_pTwists.length > 0 || _pFlips > 0)) {
                    const _pFC = _pTwists.length || _pFlips;
                    const _pTC = _pTwists.reduce((a,b)=>a+b, 0);
                    const _pDD = calcDD(_pTwists.length ? _pTwists : Array(_pFlips).fill(0));
                    const _pSc = Math.round(_pDD * state.execution * 10) / 10;
                    const _pNew = _pSc > highScore;
                    if (_pNew) { highScore = _pSc; _lsSet(HS_KEY, _pSc); }
                    bbName.text  = (state.trickName||`${_pFC} flip${_pFC!==1?'s':''}`) + '  💦';
                    bbSub.text   = `${_pFC} flip${_pFC!==1?'s':''} \xB7 ${_pTC} twist${_pTC!==1?'s':''} \xB7 DD ${_pDD} \xD7 exec ${state.execution}`;
                    bbScore.text = _pNew ? `★ NEW BEST  ${_pSc}` : `${_pSc}  (best: ${highScore})`;
                    bbSub.isVisible = true;  bbScore.isVisible = true;
                    billboard.isVisible = true;
                }
                _spawnSplash(_poolDiveMode ? POOL_DIVE_PLATFORM_X : 0, state.posZ, _impactVY, _eq);
            }
        }
        // Tilt visual lift: when the body is tilted on a slope the vertical distance
        // root→ski-bottom shrinks to FOOT_OFFSET*cos(θ). Raising the rendered root by
        // FOOT_OFFSET*(1-cos(θ)) keeps the skis visually on the snow without touching
        // physics state (so launch and landing detection are unchanged).
        let _visRootY = state.rootY;
        if (state.grounded && !readyState && !_poolDiveMode && !state.crashed) {
            const _vEps  = 0.05;
            const _vDydz = (terrainRootY(state.posZ + _vEps) - terrainRootY(state.posZ - _vEps)) / (2 * _vEps);
            const _vTilt = Math.atan(Math.abs(_vDydz));
            if (_vTilt > 0.01) _visRootY += FOOT_OFFSET * (1.0 - Math.cos(_vTilt));
        }
        character.root.position.y = _visRootY;
        character.root.position.z = state.posZ;
        if (_poolDiveMode) character.root.position.x = POOL_DIVE_PLATFORM_X;

        // ── Trampoline spring animation ────────────────────────────────────
        if (_trampolineMode && tramGridMesh) {
            const acc = -TRAM_SPRING_K * tramSpringY - TRAM_SPRING_DAMP * tramSpringVY;
            tramSpringVY += acc * dt;
            tramSpringY  += tramSpringVY * dt;
            // Only clamp to rest when not bouncing (idle oscillation damping)
            if (!tramBouncing && tramSpringY > 0) { tramSpringY = 0; tramSpringVY = 0; }

            if (tramBouncing) {
                // Player rides spring: rootY tracks surface
                state.rootY = TRAMPOLINE_Y + tramSpringY + 0.10;
                character.root.position.y = state.rootY;
                // Launch when spring returns to rest level going upward
                if (tramSpringY >= -0.01 && tramSpringVY >= 0) {
                    tramBouncing  = false;
                    tramSpringY   = 0;
                    tramSpringVY  = 0;
                    singleLayoutMode = singleFlipQueued; // re-apply each bounce without consuming
                    // Always launch at fixed height; spring trajectory is already smooth
                    state.vy = tramSavedReboundVY;
                }
            }

            // Frame rails stay fixed — only the grid deforms

            // Deform grid surface vertices: contact-point Gaussian, edges pinned at y=0
            const nv = (TRAM_GRID_COLS + 1) * (TRAM_GRID_ROWS + 1);
            for (let i = 0; i < nv; i++) {
                const nx = tramGridNXZ[i * 2];      // -1 to +1 along X
                const nz = tramGridNXZ[i * 2 + 1];  // -1 to +1 along Z
                const dx = nx - tramContactNX;
                const dz = nz - tramContactNZ;
                const edgePin = Math.sqrt(Math.max(0, (1 - nx*nx) * (1 - nz*nz)));
                const wide    = Math.exp(-(dx*dx + dz*dz) * 0.35);
                const local   = Math.exp(-(dx*dx + dz*dz) * 4.0) * 0.35;
                const f       = (wide + local) * edgePin;
                tramGridPosArr[i * 3 + 1] = tramSpringY * f;
            }
            const gNrm = new Array(tramGridPosArr.length).fill(0);
            BABYLON.VertexData.ComputeNormals(tramGridPosArr, tramGridIdxArr, gNrm);
            tramGridMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, tramGridPosArr);
            tramGridMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, gNrm);

            // Update grid line overlay
            BABYLON.MeshBuilder.CreateLineSystem('tramGridLines',
                { lines: buildTramLines(tramSpringY), instance: tramGridLines }, scene);
        }

        // ── Trampoline-mat spring animation ───────────────────────────────
        if (_trampolineMatMode) {
            // Bounce spring (character rides it)
            if (matTramBouncing) {
                const acc = -MAT_TRAM_SPRING_K * matTramSpringY - MAT_TRAM_SPRING_D * matTramSpringVY;
                matTramSpringVY += acc * dt;
                matTramSpringY  += matTramSpringVY * dt;
                state.rootY = TRAMPOLINE_Y + matTramSpringY + 0.10;
                character.root.position.y = state.rootY;
                character.root.position.z = state.posZ;
                if (matTramSpringY >= -0.01 && matTramSpringVY >= 0) {
                    matTramBouncing = false;
                    matTramSpringY  = 0;
                    matTramSpringVY = 0;
                    state.grounded  = false;
                    if (matBounceCount === 1) {
                        state.vy     = MAT_BOUNCE1_VY;
                        state.vz     = MAT_BOUNCE1_VZ;
                        state.L_flip = 0;
                        state.flipAngle = 0;
                    } else if (matBounceCount === 2) {
                        state.vy     = MAT_BOUNCE2_VY;
                        state.vz     = MAT_BOUNCE2_VZ;
                        state.L_flip = 0;
                        state.flipAngle = 0;
                    } else {
                        state.vy      = MAT_BOUNCE3_VY;
                        state.vz      = MAT_BOUNCE3_VZ;
                        state.flipDir = -1;
                        state.L_flip  = (singleFlipQueued ? I0 * 2.6 : I0 * 5.5);
                        state.flipAngle = 0;
                    }
                }
            }
            // Landing mat spring (visual deformation only, overdamped)
            if (matLandSpringY !== 0 || matLandSpringVY !== 0) {
                const acc = -MAT_LAND_SPRING_K * matLandSpringY - MAT_LAND_SPRING_D * matLandSpringVY;
                matLandSpringVY += acc * dt;
                matLandSpringY  += matLandSpringVY * dt;
                if (matLandSpringY > 0) { matLandSpringY = 0; matLandSpringVY = 0; }
                if (Math.abs(matLandSpringY) < 0.001 && Math.abs(matLandSpringVY) < 0.001) {
                    matLandSpringY = 0; matLandSpringVY = 0;
                }
            }
            // Deform trampoline surface
            if (matTramGridMesh) {
                const nv = matTramGridNXZ.length / 2;
                for (let i = 0; i < nv; i++) {
                    const nx = matTramGridNXZ[i * 2];
                    const nz = matTramGridNXZ[i * 2 + 1];
                    const dx = nx - matContactNX2;
                    const dz = nz - matContactNZ2;
                    const edgePin = Math.sqrt(Math.max(0, (1 - nx*nx) * (1 - nz*nz)));
                    const wide    = Math.exp(-(dx*dx + dz*dz) * 0.35);
                    const local   = Math.exp(-(dx*dx + dz*dz) * 4.0) * 0.35;
                    matTramGridPosArr[i * 3 + 1] = matTramSpringY * (wide + local) * edgePin;
                }
                const gNrm = new Array(matTramGridPosArr.length).fill(0);
                BABYLON.VertexData.ComputeNormals(matTramGridPosArr, matTramGridIdxArr, gNrm);
                matTramGridMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, matTramGridPosArr);
                matTramGridMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, gNrm);
                if (matTramLines) {
                    BABYLON.MeshBuilder.CreateLineSystem('matTramLines',
                        { lines: buildMatTramLines(), instance: matTramLines }, scene);
                }
            }
            // Deform landing mat surface
            if (matLandGridMesh) {
                const nv = matLandGridNXZ.length / 2;
                for (let i = 0; i < nv; i++) {
                    const nx = matLandGridNXZ[i * 2];
                    const nz = matLandGridNXZ[i * 2 + 1];
                    const dz = nz - matLandContactNZ2;
                    const edgePin = Math.sqrt(Math.max(0, (1 - nx*nx) * (1 - nz*nz)));
                    const wide    = Math.exp(-(nx*nx + dz*dz) * 0.35);
                    const local   = Math.exp(-(nx*nx + dz*dz) * 4.0) * 0.35;
                    matLandGridPosArr[i * 3 + 1] = matLandSpringY * (wide + local) * edgePin;
                }
                const gNrm = new Array(matLandGridPosArr.length).fill(0);
                BABYLON.VertexData.ComputeNormals(matLandGridPosArr, matLandGridIdxArr, gNrm);
                matLandGridMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, matLandGridPosArr);
                matLandGridMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, gNrm);
            }
        }

        // ── Angular momentum conservation: ω = L / I (ice-skater effect) ──
        // L_flip is strictly conserved in free flight — no artificial drains.
        // Tucking reduces I, so ω = L/I naturally speeds up (pulling limbs in).
        // Opening up increases I, so ω naturally slows back to the launch value.
        const I = state.pikeAmount > 0 ? computeI(state.pikeAmount) : computeI(state.tuckAmount);
        // Trampoline caps at 13 rad/s; ski lets physics run free — full ice-skater effect on every hill
        // Rotation integration now lives in the shared engine core
        // (engine/core/rotation.js), used by ski, trampoline and diving alike.
        // The discipline-specific caps are passed as CONFIG rather than being
        // branches inside the physics (ADR-0003).
        const omega = AerialEngine.rotation.angularVelocity(state.L_flip, I, {
            // Trampoline caps at 13 rad/s; ski lets physics run free.
            maxOmega:     _trampolineMode ? 13.0 : undefined,
            // D key (trampoline): single flip — untucked = ~1 flip; full tuck/pike = 3×
            singleLayout: singleLayoutMode,
            tuckAmount:   state.tuckAmount,
            pikeAmount:   state.pikeAmount,
        });
        if (!state.grounded && !tramBouncing && !matTramBouncing) {
            state.flipAngle = AerialEngine.rotation.integrateFlip(
                state.flipAngle, omega, state.flipDir, dt,
                { clampToFullRotation: singleLayoutMode && !_trampolineMode });
        }
        // ── Crash: coherent ragdoll (P11) ─────────────────────────────────
        // The crash is display (ADR-0002): the engine already decided the
        // landing failed. The skinned body STAYS visible and keeps following
        // the driver bones exactly as in normal play — the ragdoll now writes
        // the driver transforms for the crash duration (applyPose and the
        // root-rotation blocks are gated off while crashActive). No legacy
        // solid is ever re-shown; character.root stays enabled.
        if (state.crashed && !crashActive) {
            crashActive = true;
            crashTimer  = 0;
            try {
                ragdoll = _crashRagdollInit();
                _spawnSnowBurst(ragdoll.torso.x, ragdoll.torso.y - 0.3, ragdoll.torso.z,
                    70, 1.2);
            } catch (e) { window._crashErr = String((e && e.stack) || e); ragdoll = null; }
        }
        if (crashActive && ragdoll) {
            crashTimer += dt;
            try {
                // Keeps running after the rest detector fires: once resting
                // the step skips the physics and only re-projects the frozen
                // world-space pose into the still-sliding root frame.
                _crashRagdollStep(ragdoll, dt);
            } catch (e) { window._crashErr = String((e && e.stack) || e); ragdoll = null; }
        }

        // ── Spin ──────────────────────────────────────────────────────────
        if (!state.grounded) {
            const powerWrapMult = powerWrapDown ? 1.3 : 1.0;
            // Gradually slow flip while ↑ is held (min 75% of target)
            if (arrowUpDown) {
                const minL = targetL_flip * 0.75;
                state.L_flip = Math.max(minL, state.L_flip * (1 - 0.4 * dt));
            } else {
                // Gradually speed back up when ↑ is released
                if (state.L_flip < targetL_flip) {
                    state.L_flip = Math.min(targetL_flip, state.L_flip * (1 + 0.45 * dt));
                }
            }
            if (doubleMode) {
                // Continuous spin at 2× speed while both keys held
                state.spinAngle += state.doubleDir * SPIN_SPEED * state.spinMult * powerWrapMult * 2 * dt;
                // Keep spinTarget just ahead so arm-drop logic stays active
                state.spinTarget = state.spinAngle + state.doubleDir * 0.01;
            } else {
                const spinDiff = state.spinTarget - state.spinAngle;
                if (Math.abs(spinDiff) > 0.001) {
                    const spinStep = SPIN_SPEED * state.spinMult * powerWrapMult * (autoSpinActive ? 2 : 1) * dt;
                    state.spinAngle += (Math.abs(spinDiff) <= spinStep)
                        ? spinDiff
                        : Math.sign(spinDiff) * spinStep;
                } else {
                    autoSpinActive = false;
                }
            }
        }

        // ── Gamepad arm + spin physics ────────────────────────────────────────────
        // Each arm is a damped spring mass: stick sets target, arm follows with inertia.
        // Arm motion drives spin angular momentum L via two mechanisms:
        //   1. Position asymmetry → sustained torque (left arm down = spin one way)
        //   2. Velocity coupling  → impulsive torque on each throw/drop (sin peak at mid-arc)
        // Moment of inertia I from lateral extension only; tuck inward = faster spin.
        if (_lsGet('setting_gamepad') === '1') {
            if (state.grounded) {
                _armPosL = _gpArmLY; _armPosR = _gpArmRY;
                _armVelL = 0;        _armVelR = 0;
                gpSpinL  = 0;
            } else if (!state.crashed) {
                // Exponential tracking: 95% of target reached in ~0.19 s; numerically stable.
                // Velocity is derived from position change for the torque coupling below.
                const prevPosL = _armPosL, prevPosR = _armPosR;
                const alpha = 1 - Math.exp(-16 * dt);
                _armPosL = _armPosL + (_gpArmLY - _armPosL) * alpha;
                _armPosR = _armPosR + (_gpArmRY - _armPosR) * alpha;
                _armVelL = (_armPosL - prevPosL) / dt;
                _armVelR = (_armPosR - prevPosR) / dt;

                const armAsym = _armPosL - _armPosR;
                const armAvg  = (_armPosL + _armPosR) * 0.5;

                // 1. Position asymmetry: sustained spin drive.
                //    Counter-spin uses a slower rate so the right arm slows a left spin
                //    without stopping it — the left arm (both now up, high decay) finishes it.
                if (Math.abs(armAsym) > 0.04) {
                    const targetL   = armAsym * SPIN_SPEED * 3.0;
                    const isCounter = Math.sign(gpSpinL) !== 0 && Math.sign(targetL) !== Math.sign(gpSpinL);
                    gpSpinL += (targetL - gpSpinL) * Math.min(1, Math.abs(armAsym) * (isCounter ? 0.8 : 4.0) * dt);
                }

                // 2. Velocity coupling: arm motion creates an impulsive torque.
                //    Coupling peaks at horizontal (sin(π·pos)=1), is zero when arm is vertical.
                const coupL = Math.sin(Math.PI * _armPosL);
                const coupR = Math.sin(Math.PI * _armPosR);
                gpSpinL += (_armVelL * coupL - _armVelR * coupR) * SPIN_SPEED * 0.3 * dt;

                // Passive drag: arms down (avg=1) ≈ 23 s to halve — spin carries.
                //               arms up (avg=0) ≈ 0.14 s to halve — spin dies quickly.
                gpSpinL *= Math.exp(-lerp(5.0, 0.03, armAvg) * dt);

                // Moment of inertia: lateral extension only.
                // Arms tucked inward (X→0) = low I = fast spin. Spread out = slow spin.
                const latL = Math.abs(_gpArmLX);
                const latR = Math.abs(_gpArmRX);
                const I = 1.0 + latL * latL + latR * latR;

                state.spinAngle += (gpSpinL / I) * dt;
                state.spinTarget = state.spinAngle;
            }
        }

        // ── Per-flip twist boundary detector (after spin update) ────────────────
        if (!state.grounded) {
            if (state.tuckAmount > 0.3) state.currentFlipTucked = true;
            const currentFlipInt = Math.floor(Math.abs(state.flipAngle) / (Math.PI * 2));
            if (currentFlipInt > state.lastFlipInt) {
                state.spinBoundaries.push(state.spinAngle);
                state.perFlipTucked.push(state.currentFlipTucked);
                state.currentFlipTucked = false;
                state.lastFlipInt = currentFlipInt;
                if (_trampolineMode && state.flipDir === -1) {
                    state.frontFlipCount++;
                    // Don't switch flipDir mid-air — it resets to backflip on next bounce naturally
                }
            }
        }

        // ── Arm drop: wind-up, active spin, or double mode ─────────────────
        const spinRemaining = state.spinTarget - state.spinAngle;
        // Arm swap phase overrides normal arm targets
        const spinDrivesArm = !state.grounded;
        let armLTarget, armRTarget;
        if (armSwapPhase) {
            armLTarget = armSwapDir ===  1 ? 1.0 : 0.0;
            armRTarget = armSwapDir === -1 ? 1.0 : 0.0;
            // Detect swap completion, then switch to 2x auto-spin
            const swapDone = armSwapDir === 1
                ? (state.armDropL >= 0.99 && state.armDropR <= 0.01)
                : (state.armDropR >= 0.99 && state.armDropL <= 0.01);
            if (swapDone) {
                armSwapPhase   = false;
                autoSpinActive = true;
            }
        } else {
            // Keep arms down on inrun until ~1 second before the flat table
            const timeToTable = state.vz > 0 ? (FLAT_Z - state.posZ) / state.vz : Infinity;
            const onInrun = state.grounded && state.posZ < FLAT_Z && timeToTable > 1.0;
            const bothArmsActive = spinDrivesArm && state.spinAngle > bothArmsSpinTarget;
            if (!bothArmsActive && state.spinAngle <= bothArmsSpinTarget) bothArmsSpinTarget = Infinity;
            armLTarget = onInrun || state.crashed || (leftDown && !rightDown) || doubleMode || bothArmsActive || (spinDrivesArm && spinRemaining >  0.05) ? 1.0 : 0.0;
            armRTarget = onInrun || state.crashed || (rightDown && !leftDown) || doubleMode || bothArmsActive || (spinDrivesArm && spinRemaining < -0.05) ? 1.0 : 0.0;
            if (_lsGet('setting_gamepad') === '1' && !onInrun && !state.crashed && !doubleMode && !bothArmsActive) {
                if (!(spinDrivesArm && spinRemaining >  0.05)) { armLTarget = _armPosL; state.armDropL = _armPosL; }
                if (!(spinDrivesArm && spinRemaining < -0.05)) { armRTarget = _armPosR; state.armDropR = _armPosR; }
            }
        }
        const armStep = ARM_DROP_RATE * dt;
        const dL = armLTarget - state.armDropL;
        const dR = armRTarget - state.armDropR;
        state.armDropL += Math.abs(dL) <= armStep ? dL : Math.sign(dL) * armStep;
        state.armDropR += Math.abs(dR) <= armStep ? dR : Math.sign(dR) * armStep;
        // Animate arm snap (forward 50° position)
        const dSnap = state.armSnapTarget - state.armSnap;
        state.armSnap += Math.abs(dSnap) <= armStep ? dSnap : Math.sign(dSnap) * armStep;
        // Animate arm raise (straight up)
        const dRaise = state.armRaiseTarget - state.armRaise;
        state.armRaise += Math.abs(dRaise) <= armStep ? dRaise : Math.sign(dRaise) * armStep;
        // Fade snap and raise back out on landing
        if (state.grounded) { state.armSnapTarget = 0; state.armRaiseTarget = 0; }

        // ── Lay T-pose: arms drift out to sides when no inputs on first flip ──
        const inFirstFlip = !state.grounded && !state.crashed && Math.abs(state.flipAngle) < Math.PI * 2 && !_trampolineMode && !_poolDiveMode;
        const noInputs    = !leftDown && !rightDown && state.tuckTarget === 0 && !doubleMode;
        const layTTarget  = inFirstFlip && noInputs && _lsGet('setting_gamepad') !== '1' ? 1.0 : 0.0;
        const layTStep    = 1.8 * dt; // ~0.55 s to fully extend
        const dLayT       = layTTarget - state.layArmT;
        state.layArmT    += Math.abs(dLayT) <= layTStep ? dLayT : Math.sign(dLayT) * layTStep;

        // ── Apply body pose ────────────────────────────────────────────────
        if (!crashActive) {
            const offAxisVisualTuck = Math.abs(state.offAxis) * (0.25 / 0.28);
            applyPose(character.meshes, Math.max(state.tuckAmount, offAxisVisualTuck), state.armDropL, state.armDropR, state.armSnap, state.layArmT, state.armRaise, state.grounded, state.pikeAmount, state.pikeArmDrop);
            if (_lsGet('setting_gamepad') === '1' && state.armSnap < 0.01 && state.armRaise < 0.01) {
                applyGamepadLateral(character.meshes, _gpArmLX, _gpArmRX, state.armDropL, state.armDropR);
            }
        }

        // ── Off-axis lean animation ────────────────────────────────────────
        {
            const offAxisStep = 3.5 * dt;
            const dOA = offAxisTarget - state.offAxis;
            state.offAxis += Math.abs(dOA) <= offAxisStep ? dOA : Math.sign(dOA) * offAxisStep;
            if (state.grounded || state.crashed) { state.offAxis = 0; offAxisTarget = 0; }
        }

        // ── Character rotation ─────────────────────────────────────────────
        if (!crashActive) {
            // qFace turns the character to face +Z (downhill direction).
            // In readyState the character starts facing sideways (+π/2). The
            // hop turn (author spec) keeps that yaw until takeoff and rotates
            // the 90° about the world vertical during the airborne window, so
            // the skis land pointing down the fall line (HOP_TURN.yawFrac).
            const readyYaw = (readyState && !_poolDiveMode) ? (1.0 - HOP_TURN.yawFrac(readyTurnT)) * (Math.PI / 2) : 0.0;
            const _faceBase = (_poolDiveMode && poolDiveFaceBack) ? 0.0 : Math.PI;
            const qFace = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, _faceBase + readyYaw);
            if (state.grounded) {
                let tilt = 0;
                if (state.posZ < SLOPE_START_Z) {
                    tilt = 0; // flat top
                } else if (state.posZ > OUTRUN_Z) {
                    tilt = 0; // flat outrun
                } else {
                    // Continuously derive surface angle from physics terrain — no step snaps.
                    // Matches slope, smooth transition, kicker, and landing automatically.
                    const _eps  = 0.05;
                    const _dydz = (terrainRootY(state.posZ + _eps) - terrainRootY(state.posZ - _eps)) / (2 * _eps);
                    tilt = Math.atan(_dydz);
                }
                // During ready-state turn, blend tilt from 0 (upright) to full slope tilt
                if (readyState) tilt = tilt * readyTurnT;
                const qTilt = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, tilt + state.landingLean);
                const qSpin = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, state.spinAngle);
                character.root.rotationQuaternion = qFace.multiply(qTilt).multiply(qSpin);
            } else {
                // qOffAxis tilts the flip axis laterally (A = right, D = left)
                const qOffAxis = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, state.offAxis);
                const qFlip = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, state.flipAngle);
                const qSpin = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, state.spinAngle);
                character.root.rotationQuaternion = qFace.multiply(qOffAxis).multiply(qFlip).multiply(qSpin);
            }
        }

        // ── Ready stance (reviewer order 4): skis flat on the slope plane ──
        // Waiting across the fall line, both skis are rolled about their long
        // axis so they lie FLAT on the slope plane, and the rendered root is
        // seated so each ski's lowest edges rest on the physics surface
        // (terrainRootY(z) - FOOT_OFFSET + 2 mm). The uphill (L) leg flexes at
        // hip and knee for the side-stance look, with the thigh re-pinned to
        // the unmoved shin so the boot/ski relationship is untouched.
        // Display only (ADR-0002): state.rootY is physics state and is NOT
        // touched here; as readyTurnT advances the seating blends into the
        // run's own root seating (state.rootY + the FOOT_OFFSET*(1-cos) lift),
        // so the ready→run handoff stays continuous. The leg fade and the
        // quaternion hand-back at readyTurnT = 1 return the normal in-run
        // posture. Deliberately free of computeWorldMatrix /
        // TransformCoordinates / Quaternion.invert so the golden harness's
        // inert Babylon stub executes the exact same numbers.
        if (readyState && readyTurnT < 1.0 && !_poolDiveMode &&
            !_trampolineMode && !_trampolineMatMode && !crashActive &&
            character.meshes.skiL && character.meshes.skiR &&
            character.root.rotationQuaternion) {
            if (!_skiHalfDims) {
                const _ss = SEGMENTS.find(function (s) { return s.name === 'skiL'; });
                _skiHalfDims = { x: _ss.w / 2, y: _ss.h / 2, z: _ss.d / 2 };
            }
            const _rEps  = 0.05;
            const _rDydz = (terrainRootY(state.posZ + _rEps) - terrainRootY(state.posZ - _rEps)) / (2 * _rEps);
            const _slope = Math.atan(Math.abs(_rDydz));   // slope magnitude at the athlete
            // World-space target for each ski: lie flat ON the slope plane AND
            // follow the body through the ready turn. Compose yaw INSIDE the
            // pitch (Rx∘Ry): once the ski length points across the hill, world X
            // is its own long axis, so the outer Rx rolls it about that axis and
            // the bottom plane coincides exactly with the slope plane for EVERY
            // heading (both spans of the bottom face stay in-plane throughout).
            // Φ = π + readyYaw keeps the visual tip (local −z, same as the boot
            // toe) co-aligned: pre-turn φ=3π/2 puts tips across-hill beside the
            // boots; the hop's airborne rotation brings them down the fall line
            // by touchdown, with no bind.
            // (Iter-28 fix: the old qFlat = Rx(_slope) alone pinned the skis'
            // WORLD orientation to the fall line — the conjugate composition
            // then cancelled the root's readyYaw, which is why the skis never
            // turned with the body.)
            const _skiYaw = Math.PI + ((1.0 - HOP_TURN.yawFrac(readyTurnT)) * (Math.PI / 2));
            const qFlat  = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, _slope)
                .multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, _skiYaw));
            const qRoot  = character.root.rotationQuaternion;
            // Ski-local roll+heading residual that composes with the yawed
            // root to the world target (qRoot × qFlat ≡ target by construction).
            const qLocal = qRoot.conjugate().multiply(qFlat);
            const _u     = readyTurnT;
            const _blend = _u * _u * (3 - 2 * _u);        // smoothstep handoff
            // Side-slope geometry: yawed across the fall line, the skis' body-x
            // separation (±0.075) lies ALONG the fall line in the world, so the
            // downhill (R) ski rests on terrain 0.15·tan(Θ) lower than the
            // uphill (L) ski. Hips stay level: the downhill leg stays straight
            // (root is seated by the R ski) and the uphill ski + foot ride δ
            // higher in the body frame with the L knee bent — the boots stay
            // seated because each ankle translates rigidly with its ski.
            const _sideGap = Math.abs(character.meshes.skiL.position.x - character.meshes.skiR.position.x);
            // Fade the side-slope height difference with the yaw (not the raw
            // turn progress): it exists only while the skis lie across the
            // hill, and is gone by touchdown so both skis seat level.
            const _delta   = _sideGap * Math.tan(_slope) * (1.0 - HOP_TURN.yawFrac(_u));
            character.meshes.skiL.position.y  += _delta;
            character.meshes.lowerLegL.position.y += _delta;
            // Uphill-leg knee/hip flexion for the stance look (fades with the
            // hop's yaw: the side stance is gone once the skis face downhill)
            const _legF = 0.26 * (1.0 - HOP_TURN.yawFrac(_u));
            if (_legF > 0.001) {
                const _ul = character.meshes.upperLegL, _ll = character.meshes.lowerLegL;
                _ul.rotation.x += 0.45 * _legF;
                _ll.rotation.x -= 0.85 * _legF;
                // Knee stays joined: shin bottom (ankle) rides its ski, the
                // thigh centre follows so the knee joint stays closed.
                const _cU = Math.cos(_ul.rotation.x), _sU = Math.sin(_ul.rotation.x);
                const _cL = Math.cos(_ll.rotation.x), _sL = Math.sin(_ll.rotation.x);
                _ul.position.y = _ll.position.y + 0.18 * _cL + 0.18 * _cU;
                _ul.position.z = _ll.position.z + 0.18 * _sL + 0.18 * _sU;
            }
            // Roll both skis flat, then seat: lowest edge of the ski bottoms on
            // the physics surface + 2 mm. Two passes converge (translation is
            // linear in the root offset).
            for (let _it = 0; _it < 2; _it++) {
                let _worst = Infinity;
                const _rootY0 = character.root.position.y;
                for (const _skName of ['skiL', 'skiR']) {
                    const _sk = character.meshes[_skName];
                    _sk.rotationQuaternion = qLocal;
                    const _cx = _sk.position.x, _cy = _sk.position.y, _cz = _sk.position.z;
                    for (let _i = 0; _i < 5; _i++) {
                        const _s = -_skiHalfDims.z + (2 * _skiHalfDims.z) * (_i / 4);
                        for (const _e of [-_skiHalfDims.x, _skiHalfDims.x]) {
                            const _loc = _quatRotateVec(qLocal, new BABYLON.Vector3(_e, -_skiHalfDims.y, _s));
                            const _off = _quatRotateVec(qRoot, new BABYLON.Vector3(_cx + _loc.x, _cy + _loc.y, _cz + _loc.z));
                            const _clear = _rootY0 + _off.y - (terrainRootY(state.posZ + _off.z) - FOOT_OFFSET);
                            if (_clear < _worst) _worst = _clear;
                        }
                    }
                }
                character.root.position.y += 0.002 - _worst;
            }
            // ── Hop-turn overlay (author spec, 2026-08-26; display only) ──────
            // Crouch/absorb: both knees fold about pinned ankles (each shin
            // bottom stays over its ski centre and on the ski top, so the
            // boots never leave the skis), the root drops by the exact leg
            // shortening and both skis rise by the same amount in body frame —
            // they stay seated where the loop above put them. Airborne: the
            // root lifts on the hop arc, so the skis leave the snow with it.
            // Arms: down/back swing with the crouch, slight out-swing at the
            // apex — the same delta on upper and lower arm keeps the elbow
            // closed and the glove rides the wrist.
            const _crN = HOP_TURN.crouchN(_u);
            const _abN = HOP_TURN.absorbN(_u);
            const _k   = HOP_TURN.kMax * (_crN + 0.7 * _abN);
            let _hopDrop = 0;
            if (_k > 0.001) {
                const _aH = 0.45 * _k, _aK = 0.85 * _k;   // hip fwd / knee back, rad
                _hopDrop = 0.36 * (2 - Math.cos(_aH) - Math.cos(_aK)); // leg shortening
                for (const _side of ['L', 'R']) {
                    const _ul = character.meshes['upperLeg' + _side];
                    const _ll = character.meshes['lowerLeg' + _side];
                    const _sk = character.meshes['ski' + _side];
                    const _rxU0 = _ul.rotation.x, _rxL0 = _ll.rotation.x;
                    _ul.rotation.x = _rxU0 + _aH;
                    _ll.rotation.x = _rxL0 - _aK;
                    _ll.position.z += 0.18 * (Math.sin(_ll.rotation.x) - Math.sin(_rxL0));
                    _ll.position.y += _hopDrop + 0.18 * (Math.cos(_rxL0) - Math.cos(_ll.rotation.x));
                    _sk.position.y += _hopDrop;
                    _ul.position.y = _ll.position.y + 0.18 * Math.cos(_ll.rotation.x) + 0.18 * Math.cos(_ul.rotation.x);
                    _ul.position.z = _ll.position.z + 0.18 * Math.sin(_ll.rotation.x) + 0.18 * Math.sin(_ul.rotation.x);
                }
                character.root.position.y -= _hopDrop;
            }
            const _hop = HOP_TURN.hop(_u);
            if (_hop > 0.0001) character.root.position.y += _hop;
            if (_crN > 0.01) {
                const _sw = 0.5 * _crN;
                for (const _side of ['L', 'R']) {
                    character.meshes['upperArm' + _side].rotation.x -= _sw;
                    character.meshes['lowerArm' + _side].rotation.x -= _sw;
                }
            }
            if (_hop > 0.0001) {
                const _out = 0.3 * (_hop / HOP_TURN.hopHeight);
                character.meshes.upperArmL.rotation.z += _out;
                character.meshes.lowerArmL.rotation.z += _out;
                character.meshes.upperArmR.rotation.z -= _out;
                character.meshes.lowerArmR.rotation.z -= _out;
            }
            _readyStance.last = { slope: _slope, blend: _blend, readyTurnT: _u,
                                  hop: _hop, flexK: _k, drop: _hopDrop,
                                  yawFrac: HOP_TURN.yawFrac(_u) };
        } else if (!crashActive && character.meshes.skiL && character.meshes.skiL.rotationQuaternion) {
            // Hand the skis back to the pose solver's euler rotations
            character.meshes.skiL.rotationQuaternion = null;
            character.meshes.skiR.rotationQuaternion = null;
        }

        // ── First-person camera update ────────────────────────────────────────
        if (firstPersonMode) _updateFpCamera(dt);

        // ── Camera follow — track character position; free mouse; C lerps smoothly ──
        if (crashActive && ragdoll) {
            // Camera eases to the tumbling body, then rests on it (P11): lerp
            // the follow target toward the ragdoll torso instead of the frozen
            // root, so the athlete stays framed while sliding to rest.
            const _ck = Math.min(1, 2.5 * dt);
            camera.target.y += (ragdoll.torso.y - 0.3 - camera.target.y) * _ck;
            camera.target.z += (ragdoll.torso.z - camera.target.z) * _ck;
        } else {
            camera.target.y = _visRootY;
            camera.target.z = state.posZ;
        }
        if (_poolDiveMode) camera.target.x = POOL_DIVE_PLATFORM_X;
        // Smooth C-key alpha lerp (finishes in ~0.5s then stops fighting mouse)
        if (_camTargetAlpha !== null) {
            let _da = _camTargetAlpha - camera.alpha;
            if (_da >  Math.PI) _da -= Math.PI * 2;
            if (_da < -Math.PI) _da += Math.PI * 2;
            camera.alpha += _da * Math.min(1, 5 * dt);
            if (Math.abs(_da) < 0.005) { camera.alpha = _camTargetAlpha; _camTargetAlpha = null; }
        }
        // Camera height management — never fight mouse input; only nudge when airborne/landing
        if (!_poolDiveMode) {
            if (!state.grounded && cameraMode !== 1) {
                // Very slow raise throughout the flip — 0.022 rad/s, capped at CAM_BETA_LAND
                camera.beta = Math.max(CAM_BETA_LAND, camera.beta - 0.022 * dt);
            } else if (state.grounded && state.airTime > 0.15 && cameraMode !== 1) {
                // Slight raise on landing
                camera.beta += (CAM_BETA_LAND - camera.beta) * Math.min(1, 2.5 * dt);
            }
        }

        // ── Pool water wave animation ──────────────────────────────────────
        if (poolVisible && waterMesh) {
            poolWaveT += dt;
            if (poolSplashAmp > 0) poolSplashAmp = Math.max(0, poolSplashAmp - dt * 0.32);
            const _wv = waterMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const _wn = new Float32Array(_wv.length);
            for (let _i = 0; _i < _wv.length; _i += 3) {
                const _wx = _wv[_i], _wz = _wv[_i+2];
                let _wy = poolSurfaceY;
                _wy += 0.014 * Math.sin(_wx*3.6 + poolWaveT*2.3);
                _wy += 0.010 * Math.sin(_wz*2.7 + poolWaveT*1.8 + 1.1);
                _wy += 0.007 * Math.sin((_wx+_wz)*3.9 + poolWaveT*3.0);
                if (poolSplashAmp > 0.001) {
                    const _dx = _wx - poolSplashImpX, _dz = _wz - poolSplashImpZ;
                    const _dd = Math.sqrt(_dx*_dx + _dz*_dz) + 0.01;
                    _wy += poolSplashAmp * Math.exp(-_dd*0.55) * Math.cos(_dd*3.2 - poolWaveT*7.5);
                }
                _wv[_i+1] = _wy;
                _wn[_i]=0; _wn[_i+1]=1; _wn[_i+2]=0;
            }
            waterMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, _wv);
            waterMesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, _wn);
        }

        // ── Record frame ───────────────────────────────────────────────────
        if (recordingActive) recordFrame();

        // ── HUD ───────────────────────────────────────────────────────────
        hud.text = '';
        const _fpHint = firstPersonMode ? '\nV: third person' : '\nV: first person';
        if (_poolDiveMode) {
            hint.text = readyState
                ? '↓: charge power\n↑: dive\ndrag: orbit' + _fpHint
                : 'SPACE: tuck\n← then →: left twist\n→ then ←: right twist\ndrag: orbit' + _fpHint;
        } else {
            hint.text = readyState && readyTurnT === 0.0
                ? '↑: Start run\ndrag: orbit' + _fpHint
                : 'SPACE: tuck\n← then →: left twist\n→ then ←: right twist\n↓: half twist\ndrag: orbit' + _fpHint;
        }
    } catch(e) { hud.text = 'ERR: ' + e.message; console.error(e); } });

    // ── Shadow casters/receivers ──────────────────────────────────────────────
    // Only the ATHLETE casts a real-time shadow. Everything still receives one.
    //
    // Every mesh used to be a caster, which meant one 2048 map had to be fitted
    // around 174 trees, the whole run AND the distant background peaks — several
    // hundred metres of frustum, so the athlete's own shadow got a handful of
    // texels and the terrain shadows came out mushy. The static shadows are now
    // baked (see terrain_shadow.png above), so the runtime map is free to fit
    // itself around a two-metre figure, which is what it is actually good at.
    if (shadowGen) {
        const casters = new Set();
        for (const key of Object.keys(character.meshes)) {
            const e = character.meshes[key];
            const m = (e && e.mesh) ? e.mesh : e;
            if (m && m.getTotalVertices && m.getTotalVertices() > 0) casters.add(m);
        }
        // The skinned body arrives asynchronously and is parented to the root, so
        // it is picked up by descendants rather than by name.
        if (character.root && character.root.getChildMeshes) {
            for (const m of character.root.getChildMeshes()) {
                if (m.getTotalVertices && m.getTotalVertices() > 0) casters.add(m);
            }
        }
        // Trees all cast — the CSM frustum follows the camera, so only trees near
        // it ever enter a cascade's depth pass; the auto-fit explosion that made
        // this impossible with the single-map generator cannot recur. (The static
        // terrain keeps its bake; far peaks are past shadowMaxZ and are culled.)
        scene.meshes.forEach((m) => {
            if (!m.name || !m.getTotalVertices || m.getTotalVertices() === 0) return;
            if (/^(tr_|fl_)/.test(m.name)) casters.add(m);
        });
        // B-net fencing casts as well: the thin posts render through their
        // source caster, and the alpha-cut strip throws a cutout shadow via
        // ALPHATEST in the depth pass (a solid-quad shadow here means that
        // path broke — see venue-dressing.spec.js).
        ['bnetPost', 'bnetStrip_L', 'bnetStrip_R'].forEach((n) => {
            const m = scene.getMeshByName(n);
            if (m) casters.add(m);
        });
        casters.forEach(m => shadowGen.addShadowCaster(m));

        scene.meshes.forEach(m => {
            if (m.name === '__root__' || !m.getTotalVertices || m.getTotalVertices() === 0) return;
            m.receiveShadows = true;
        });
        window._shadowCasters = casters.size;
    }

    // ── Run ───────────────────────────────────────────────────────────────────
    // Texturing runs late and once: the athlete body, goggles and terrain
    // materials must all exist first, and several arrive asynchronously.
    setTimeout(function () {
        try { window._surfacesApplied = _applySurfaces(); }
        catch (e) { window._surfacesApplied = 0; }
    }, 1200);

    engine.runRenderLoop(() => scene.render());
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startGame);
} else {
    _startGame();
}

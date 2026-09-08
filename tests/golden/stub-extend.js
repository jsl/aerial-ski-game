'use strict';
// ── Stub extension for golden-trace capture ──────────────────────────────────
// tests/babylon-stub.js is shared with tests/test.html and is deliberately NOT
// modified here — changing it could silently alter that suite's behaviour.
//
// Instead this layer adds the extra Babylon surface that a *full* game boot
// touches (cameras, post-process pipelines, particle systems) but that the
// existing browser tests never reach.
//
// Design rule: every added class is INERT. It must never influence simulation
// state — only absorb calls that exist for rendering's benefit. Unknown
// properties resolve to `undefined` (not a truthy stub) so that
// `if (thing.feature)` guards in game.js take the same branch they would if the
// feature were genuinely absent, rather than silently flipping code paths.

// ── Real vector/quaternion math ─────────────────────────────────────────────
// CRITICAL for trace fidelity. babylon-stub.js ships placeholder math:
//   Quaternion.multiply()     → returns a fresh identity
//   Quaternion.RotationAxis() → returns a fresh identity
// game.js calls RotationAxis 11× and multiply 9× to compose the skier's
// flip/twist/spin orientation. Against the placeholder every captured
// rotationQuaternion would be identity — the traces would look stable while
// testing nothing, and would not catch a refactor bug in the single most
// important physics path.
//
// These implementations follow Babylon's own conventions exactly, including
// that Vector3.normalize() mutates in place and returns `this`.
function patchMath(B) {
    const V = B.Vector3, Q = B.Quaternion;

    // The stub builds node.position/rotation/scaling from the BASE class `Vec3`,
    // not `Vector3` (which merely extends it). Patching Vector3.prototype alone
    // would leave every node transform without these methods, so target the base.
    const vecProto = V && Object.getPrototypeOf(V.prototype) !== Object.prototype
        ? Object.getPrototypeOf(V.prototype)
        : V && V.prototype;

    if (V && !vecProto.clone) {
        Object.assign(vecProto, {
            clone() { return new V(this.x, this.y, this.z); },
            copyFrom(s) { this.x = s.x; this.y = s.y; this.z = s.z; return this; },
            copyFromFloats(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
            add(v) { return new V(this.x + v.x, this.y + v.y, this.z + v.z); },
            addInPlace(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; },
            subtract(v) { return new V(this.x - v.x, this.y - v.y, this.z - v.z); },
            subtractInPlace(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; },
            scale(s) { return new V(this.x * s, this.y * s, this.z * s); },
            scaleInPlace(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
            negate() { return new V(-this.x, -this.y, -this.z); },
            length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); },
            lengthSquared() { return this.x ** 2 + this.y ** 2 + this.z ** 2; },
            // Babylon's normalize() mutates in place and returns this.
            normalize() {
                const l = this.length();
                if (l === 0) return this;
                this.x /= l; this.y /= l; this.z /= l;
                return this;
            },
            equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; },
        });
    }
    if (V) {
        if (!V.Up)      V.Up      = () => new V(0, 1, 0);
        if (!V.Down)    V.Down    = () => new V(0, -1, 0);
        if (!V.Forward) V.Forward = () => new V(0, 0, 1);
        if (!V.Right)   V.Right   = () => new V(1, 0, 0);
        if (!V.One)     V.One     = () => new V(1, 1, 1);
        if (!V.Dot)     V.Dot     = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        if (!V.Cross)   V.Cross   = (a, b) => new V(
            a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        if (!V.Distance) V.Distance = (a, b) => Math.sqrt(
            (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
        if (!V.Lerp) V.Lerp = (a, b, t) => new V(
            a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }

    if (Q) {
        // Babylon's exact multiply convention: result = this ⊗ q
        const mul = (a, b) => new Q(
            a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x,
            -a.x * b.z + a.y * b.w + a.z * b.x + a.w * b.y,
            a.x * b.y - a.y * b.x + a.z * b.w + a.w * b.z,
            -a.x * b.x - a.y * b.y - a.z * b.z + a.w * b.w,
        );

        Object.assign(Q.prototype, {
            multiply(q) { return mul(this, q); },
            multiplyInPlace(q) {
                const r = mul(this, q);
                this.x = r.x; this.y = r.y; this.z = r.z; this.w = r.w;
                return this;
            },
            clone() { return new Q(this.x, this.y, this.z, this.w); },
            set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
            copyFrom(s) { this.x = s.x; this.y = s.y; this.z = s.z; this.w = s.w; return this; },
            conjugate() { return new Q(-this.x, -this.y, -this.z, this.w); },
            length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2 + this.w ** 2); },
            normalize() {
                const l = this.length();
                if (l === 0) return this;
                this.x /= l; this.y /= l; this.z /= l; this.w /= l;
                return this;
            },
        });

        // Real axis-angle construction: (axis_normalised · sin(θ/2), cos(θ/2))
        Q.RotationAxis = function (axis, angle) {
            const len = Math.sqrt(axis.x ** 2 + axis.y ** 2 + axis.z ** 2) || 1;
            const s = Math.sin(angle / 2) / len;
            return new Q(axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2));
        };
        Q.Identity = () => new Q(0, 0, 0, 1);
        Q.RotationYawPitchRoll = function (yaw, pitch, roll) {
            const hr = roll * 0.5, hp = pitch * 0.5, hy = yaw * 0.5;
            const sr = Math.sin(hr), cr = Math.cos(hr);
            const sp = Math.sin(hp), cp = Math.cos(hp);
            const sy = Math.sin(hy), cy = Math.cos(hy);
            return new Q(
                cy * sp * cr + sy * cp * sr,
                sy * cp * cr - cy * sp * sr,
                cy * cp * sr - sy * sp * cr,
                cy * cp * cr + sy * sp * sr,
            );
        };
        if (!Q.FromEulerAngles) {
            Q.FromEulerAngles = (x, y, z) => Q.RotationYawPitchRoll(y, x, z);
        }
    }

    for (const C of [B.Color3, B.Color4]) {
        if (C && !C.prototype.clone) {
            C.prototype.clone = function () {
                return C === B.Color4 ? new C(this.r, this.g, this.b, this.a)
                                      : new C(this.r, this.g, this.b);
            };
        }
    }
}

function extendStub(ctx) {
    const B = ctx.BABYLON;
    if (!B) throw new Error('babylon-stub.js must be loaded before extendStub()');

    patchMath(B);

    const V3 = B.Vector3;

    /** Minimal vector that supports the mutation patterns game.js uses. */
    function vec(x = 0, y = 0, z = 0) {
        if (V3) return new V3(x, y, z);
        return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };
    }

    const noop = () => {};

    /** Build an inert class whose instances absorb calls without side effects. */
    function inert(name, extra = {}) {
        function Klass() {
            this._inertName   = name;
            this.name         = name;
            this.position     = vec();
            this.rotation     = vec();
            this.scaling      = vec(1, 1, 1);
            this.isEnabled    = true;
            this.isVisible    = true;
            this.dispose      = noop;
            this.attachControl = noop;
            this.detachControl = noop;
            this.setTarget    = noop;
            this.getTarget    = () => vec();
            this.start        = noop;
            this.stop         = noop;
            this.reset        = noop;
            this.addColorGradient = noop;
            this.addSizeGradient  = noop;
            this.createSphereEmitter = () => ({ radius: 1 });
            this.createConeEmitter   = () => ({ radius: 1, angle: 1 });
            Object.assign(this, extra);
        }
        Object.defineProperty(Klass, 'name', { value: name });
        return Klass;
    }

    // ── Cameras ──────────────────────────────────────────────────────────────
    if (!B.FreeCamera)      B.FreeCamera      = inert('FreeCamera',      { fov: 0.8, minZ: 0.1, maxZ: 1000, upVector: vec(0, 1, 0) });
    if (!B.UniversalCamera) B.UniversalCamera = inert('UniversalCamera', { fov: 0.8, minZ: 0.1, maxZ: 1000, upVector: vec(0, 1, 0) });
    if (!B.ArcRotateCamera) B.ArcRotateCamera = inert('ArcRotateCamera', { fov: 0.8, alpha: 0, beta: 0, radius: 10 });
    if (!B.TargetCamera)    B.TargetCamera    = inert('TargetCamera');

    // ── Particles ────────────────────────────────────────────────────────────
    if (!B.ParticleSystem) {
        B.ParticleSystem = inert('ParticleSystem', {
            emitter: null, minEmitBox: vec(), maxEmitBox: vec(),
            color1: null, color2: null, colorDead: null,
            direction1: vec(), direction2: vec(), gravity: vec(),
            manualEmitCount: 0, targetStopDuration: 0,
        });
        B.ParticleSystem.BLENDMODE_ONEONE  = 0;
        B.ParticleSystem.BLENDMODE_STANDARD = 1;
    }
    if (!B.GPUParticleSystem) B.GPUParticleSystem = B.ParticleSystem;

    // ── Post-processing ──────────────────────────────────────────────────────
    if (!B.DefaultRenderingPipeline) {
        B.DefaultRenderingPipeline = inert('DefaultRenderingPipeline', {
            depthOfFieldEnabled: false, depthOfField: null,
            bloomEnabled: false, bloomWeight: 0, bloomThreshold: 0, bloomScale: 0,
            fxaaEnabled: false, samples: 1, imageProcessing: null,
        });
    }
    if (!B.DepthOfFieldEffectBlurLevel) {
        B.DepthOfFieldEffectBlurLevel = { Low: 0, Medium: 1, High: 2 };
    }
    if (!B.ImageProcessingConfiguration) {
        B.ImageProcessingConfiguration = { TONEMAPPING_STANDARD: 0, TONEMAPPING_ACES: 1 };
    }
    if (!B.SSAO2RenderingPipeline) B.SSAO2RenderingPipeline = inert('SSAO2RenderingPipeline');
    if (!B.GlowLayer)              B.GlowLayer              = inert('GlowLayer', { intensity: 1 });
    if (!B.HighlightLayer)         B.HighlightLayer         = inert('HighlightLayer');

    // ── Shadows / lights not covered by the base stub ────────────────────────
    if (!B.CascadedShadowGenerator) B.CascadedShadowGenerator = inert('CascadedShadowGenerator', {
        numCascades: 4, lambda: 0.85, bias: 0, getShadowMap: () => ({ renderList: [] }),
        addShadowCaster: noop, removeShadowCaster: noop,
    });
    if (!B.SpotLight)  B.SpotLight  = inert('SpotLight',  { intensity: 1, diffuse: null, specular: null });
    if (!B.PointLight) B.PointLight = inert('PointLight', { intensity: 1, diffuse: null, specular: null });

    // ── PBR materials ────────────────────────────────────────────────────────
    // Provided WITH subSurface and clearCoat sub-objects on purpose. game.js
    // guards those with `if (mat.subSurface)`, so omitting them here would make
    // the tests silently skip a branch the real browser takes — the stub would
    // then be testing a different code path than the one that ships.
    if (!B.PBRMaterial) {
        function PBRMaterial(name) {
            this.name = name;
            this.albedoColor = null; this.albedoTexture = null;
            this.metallic = 1; this.roughness = 1;
            this.emissiveColor = null; this.bumpTexture = null;
            this.ambientTexture = null; this.lightmapTexture = null;
            this.useLightmapAsShadowmap = false;
            this.alpha = 1; this.backFaceCulling = true;
            this.environmentIntensity = 1;
            this.subSurface = {
                isTranslucencyEnabled: false, translucencyIntensity: 0,
                isRefractionEnabled: false, tintColor: null,
                minimumThickness: 0, maximumThickness: 1,
            };
            this.clearCoat = {
                isEnabled: false, intensity: 0, roughness: 0,
                indexOfRefraction: 1.5,
            };
            this.sheen = { isEnabled: false, intensity: 0, color: null, roughness: 0 };
            this.anisotropy = { isEnabled: false, intensity: 0, direction: null };
            this.iridescence = { isEnabled: false, intensity: 0 };
            this.freeze = noop; this.unfreeze = noop; this.dispose = noop;
        }
        B.PBRMaterial = PBRMaterial;
    }
    if (!B.PBRMetallicRoughnessMaterial) B.PBRMetallicRoughnessMaterial = B.PBRMaterial;
    if (!B.OpenPBRMaterial)              B.OpenPBRMaterial              = B.PBRMaterial;

    // ── Textures ─────────────────────────────────────────────────────────────
    if (!B.Texture) {
        B.Texture = inert('Texture', {
            uScale: 1, vScale: 1, uOffset: 0, vOffset: 0,
            hasAlpha: false, level: 1, coordinatesIndex: 0,
            anisotropicFilteringLevel: 1, wrapU: 0, wrapV: 0,
            updateSamplingMode: noop, readPixels: async () => new Uint8Array(4),
        });
        B.Texture.NEAREST_SAMPLINGMODE  = 1;
        B.Texture.BILINEAR_SAMPLINGMODE = 2;
        B.Texture.TRILINEAR_SAMPLINGMODE = 3;
        B.Texture.CLAMP_ADDRESSMODE  = 0;
        B.Texture.WRAP_ADDRESSMODE   = 1;
        B.Texture.MIRROR_ADDRESSMODE = 2;
    }
    if (!B.DynamicTexture) {
        // The pool-dive world builds gradients on a DynamicTexture context. A
        // blanket `() => () => {}` proxy returned undefined from
        // createLinearGradient(), so the following .addColorStop() threw. Return
        // real gradient-shaped stubs instead.
        const ctx2d = () => new Proxy({
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
            createPattern: () => ({}),
            getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            measureText: () => ({ width: 0 }),
            canvas: { width: 128, height: 128 },
        }, { get: (t, p) => (p in t ? t[p] : () => {}) });

        B.DynamicTexture = inert('DynamicTexture', {
            getContext: ctx2d,
            update: noop, drawText: noop, hasAlpha: false,
            getSize: () => ({ width: 128, height: 128 }),
        });
    }
    if (!B.CubeTexture) {
        B.CubeTexture = inert('CubeTexture');
        B.CubeTexture.CreateFromPrefilteredData = () => new B.CubeTexture();
    }
    if (!B.RenderTargetTexture) B.RenderTargetTexture = inert('RenderTargetTexture', { renderList: [] });

    // ── Misc ────────────────────────────────────────────────────────────────
    if (!B.Sound)       B.Sound       = inert('Sound', { play: noop, pause: noop, setVolume: noop });
    if (!B.Layer)       B.Layer       = inert('Layer');
    if (!B.Effect)      B.Effect      = { ShadersStore: {} };
    if (!B.Tools)       B.Tools       = { CreateScreenshot: noop, ToRadians: (d) => d * Math.PI / 180 };
    if (!B.Animation)   B.Animation   = inert('Animation');
    if (!B.SceneLoader) B.SceneLoader = { ImportMesh: noop, Append: noop, ImportMeshAsync: async () => ({ meshes: [], skeletons: [] }) };
    if (B.Scene && !B.Scene.prototype.getEngine) {
        B.Scene.prototype.getEngine = function () { return B._engine; };
    }

    patchNodeTransforms(B);

    return B;
}

// ── World-transform support on stub nodes ────────────────────────────────────
// The crash/ragdoll path calls root.computeWorldMatrix(true) then
// mesh.getAbsolutePosition() to seed detached-limb physics. That position feeds
// SIMULATION state, not just rendering, so it must be computed correctly —
// a lazy stub here would bake wrong numbers into the golden traces, which is
// worse than having no traces at all.
//
// Composition ignores scaling: the character rig uses uniform scale only, and
// positions compose exactly under rotation+translation.
function patchNodeTransforms(B) {
    const V3 = B.Vector3;

    /** Rotate vector v by unit quaternion q (v' = q·v·q⁻¹, expanded). */
    function rotByQuat(v, q) {
        const { x, y, z } = v;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        // t = 2 * cross(q.xyz, v)
        const tx = 2 * (qy * z - qz * y);
        const ty = 2 * (qz * x - qx * z);
        const tz = 2 * (qx * y - qy * x);
        return {
            x: x + qw * tx + (qy * tz - qz * ty),
            y: y + qw * ty + (qz * tx - qx * tz),
            z: z + qw * tz + (qx * ty - qy * tx),
        };
    }

    /**
     * Euler → quaternion, matching Babylon's RotationYawPitchRoll(y, x, z).
     *
     * The previous version had the wrong signs on the z and w cross-terms and
     * did NOT match Babylon, despite a comment claiming it did. For
     * rotation (0.3, 0.7, 0.4) it produced z=0.2347 w=0.9001 where Babylon gives
     * z=0.1343 w=0.9205.
     *
     * It was latent: every world-position chain today is
     * [skierRoot(quaternion) → limb], and a node's own rotation does not affect
     * its own position. It would go live the moment anything nested under an
     * Euler-rotated parent is read for world position — precisely the shape of
     * the glove/elbow/boot detail meshes (game.js:299-448). Now that traces
     * capture world positions, that is no longer hypothetical.
     */
    function eulerToQuat(r) {
        const hr = r.z * 0.5, hp = r.x * 0.5, hy = r.y * 0.5;
        const sr = Math.sin(hr), cr = Math.cos(hr);
        const sp = Math.sin(hp), cp = Math.cos(hp);
        const sy = Math.sin(hy), cy = Math.cos(hy);
        return {
            x: cy * sp * cr + sy * cp * sr,
            y: sy * cp * cr - cy * sp * sr,
            z: cy * cp * sr - sy * sp * cr,
            w: cy * cp * cr + sy * sp * sr,
        };
    }

    function localQuat(node) {
        if (node.rotationQuaternion) {
            const q = node.rotationQuaternion;
            return { x: q.x, y: q.y, z: q.z, w: q.w };
        }
        if (node.rotation) return eulerToQuat(node.rotation);
        return { x: 0, y: 0, z: 0, w: 1 };
    }

    function absolutePosition(node) {
        // Walk to the root collecting the chain, then compose downward.
        const chain = [];
        for (let n = node; n; n = n.parent) chain.push(n);
        chain.reverse();

        let pos = { x: 0, y: 0, z: 0 };
        let rot = { x: 0, y: 0, z: 0, w: 1 };

        for (const n of chain) {
            const lp = n.position || { x: 0, y: 0, z: 0 };
            const r  = rotByQuat(lp, rot);
            pos = { x: pos.x + r.x, y: pos.y + r.y, z: pos.z + r.z };
            const lq = localQuat(n);
            // rot = rot * lq
            rot = {
                x: rot.w * lq.x + rot.x * lq.w + rot.y * lq.z - rot.z * lq.y,
                y: rot.w * lq.y - rot.x * lq.z + rot.y * lq.w + rot.z * lq.x,
                z: rot.w * lq.z + rot.x * lq.y - rot.y * lq.x + rot.z * lq.w,
                w: rot.w * lq.w - rot.x * lq.x - rot.y * lq.y - rot.z * lq.z,
            };
        }
        return { pos, rot };
    }

    /** Add world-transform methods to a single node object, in place. */
    function decorate(node) {
        if (!node || node._transformsPatched) return node;
        node._transformsPatched = true;
        // P4 forest (iter 56): thin-instance + freeze markers. The stub has
        // no real geometry, so these are inert bookkeeping.
        node.thinInstanceSetBuffer = function () {};
        node.thinInstanceGetWorldMatrices = function () { return []; };
        node.freezeWorldMatrix = function () {};
        node.unfreezeWorldMatrix = function () {};
        if (!node.getWorldMatrix) {
            node.getWorldMatrix = function () {
                const { pos, rot } = absolutePosition(this);
                return { _pos: pos, _rot: rot, _isStubMatrix: true };
            };
        }
        if (!node.computeWorldMatrix) {
            node.computeWorldMatrix = function () { return this.getWorldMatrix(); };
        }
        if (!node.getAbsolutePosition) {
            node.getAbsolutePosition = function () {
                const { pos } = absolutePosition(this);
                const v = V3 ? new V3(pos.x, pos.y, pos.z) : { ...pos };
                if (!v.clone) v.clone = function () { return { x: this.x, y: this.y, z: this.z, clone: v.clone }; };
                return v;
            };
        }
        // The pool-dive world animates water by reading vertex positions
        // (game.js:4382). The base stub defines updateVerticesData but NOT
        // getVerticesData, so all four pool scenarios threw on every frame —
        // 900 times each — while verify.js still reported PASS, because the
        // frame-level try/catch in game.js absorbed it.
        if (!node.getVerticesData) {
            node.getVerticesData = function (kind) {
                if (!this._verts) this._verts = {};
                if (!this._verts[kind]) this._verts[kind] = new Float32Array(0);
                return this._verts[kind];
            };
        }
        if (!node.setVerticesData) {
            node.setVerticesData = function (kind, data) {
                if (!this._verts) this._verts = {};
                this._verts[kind] = data;
                return this;
            };
        }
        if (!node.isVerticesDataPresent) node.isVerticesDataPresent = function () { return false; };
        if (!node.setParent)   node.setParent   = function (p) { this.parent = p; return this; };
        if (!node.getChildren) node.getChildren = function () { return []; };
        // Enabled state is observable output (a disabled root hides the skier),
        // so it is tracked as a real flag and captured in traces.
        if (!node.setEnabled) {
            node._enabled = node._enabled !== false;
            node.setEnabled = function (v) { this._enabled = !!v; return this; };
        }
        if (typeof node.isEnabled !== 'function') {
            node.isEnabled = function () { return this._enabled !== false; };
        }
        return node;
    }

    // The base stub implements only the five creators its own tests exercise.
    // Other worlds (pool dive, gym) use more. Add the rest, delegating to the
    // same node factory so they behave identically.
    if (B.MeshBuilder && B.MeshBuilder._mk) {
        const mk = B.MeshBuilder._mk;
        for (const name of [
            'CreatePlane', 'CreateGround', 'CreateGroundFromHeightMap', 'CreateDisc',
            'CreateTorus', 'CreateTorusKnot', 'CreateRibbon', 'CreateLines',
            'CreateDashedLines', 'CreatePolyhedron', 'CreateIcoSphere',
            'CreateCapsule', 'CreateExtrudeShape', 'ExtrudeShape',
            'ExtrudeShapeCustom', 'CreateTiledGround', 'CreateDecal', 'CreateBox2',
        ]) {
            if (!B.MeshBuilder[name]) {
                B.MeshBuilder[name] = function (n, o, s) { return mk.call(this, n, s); };
            }
        }
    }

    // P4 forest (iter 56): the impostor cards merge two quads. The stub has
    // no geometry to merge — keep the first mesh; the caller renames it.
    if (B.Mesh && !B.Mesh.MergeMeshes) {
        B.Mesh.MergeMeshes = function (meshes) { return meshes && meshes[0]; };
    }

    // P4 forest (iter 56): instance matrices. The stub census reads node
    // position/rotation, never the raw matrices, so identity copies suffice.
    if (!B.Matrix) {
        B.Matrix = {
            Identity() { return { _stub: true }; },
            Compose(s, q, t) {
                return { _stub: true, s, q, t,
                    copyToArray(arr, off) {
                        arr[off + 0] = s.x;  arr[off + 5] = s.y;
                        arr[off + 10] = s.z; arr[off + 15] = 1;
                        arr[off + 12] = t.x; arr[off + 13] = t.y;
                        arr[off + 14] = t.z;
                    } };
            },
        };
    }
    if (B.Quaternion && !B.Quaternion.RotationYawPitchRoll) {
        B.Quaternion.RotationYawPitchRoll = function () { return new B.Quaternion(); };
    }

    // MeshBuilder returns factory-made plain objects, not class instances, so
    // prototype patching cannot reach them. Wrap each creator instead. This runs
    // before game.js loads, so every mesh it builds is covered.
    if (B.MeshBuilder) {
        for (const key of Object.keys(B.MeshBuilder)) {
            if (!/^Create/.test(key)) continue;
            const orig = B.MeshBuilder[key];
            if (typeof orig !== 'function') continue;
            B.MeshBuilder[key] = function (...args) {
                return decorate(orig.apply(this, args));
            };
        }
    }

    // Any node the stub already registered (e.g. TransformNodes) gets decorated too.
    if (B._nodes && typeof B._nodes.forEach === 'function') {
        B._nodes.forEach(decorate);
    }

    B._decorateNode = decorate;

    const protos = [B.TransformNode && B.TransformNode.prototype,
                    B.Mesh && B.Mesh.prototype].filter(Boolean);

    for (const proto of protos) {
        // The skier root is a TransformNode, created after decorate() visits
        // the initial registry. Match the inert mesh freeze API here too, or
        // reaching crash rest throws and silently discards the ragdoll.
        if (!proto.freezeWorldMatrix) proto.freezeWorldMatrix = function () {};
        if (!proto.unfreezeWorldMatrix) proto.unfreezeWorldMatrix = function () {};
        if (!proto.computeWorldMatrix) {
            // Transforms are computed on demand in absolutePosition(); nothing
            // to cache, so this only needs to exist and be harmless.
            proto.computeWorldMatrix = function () { return this.getWorldMatrix(); };
        }
        if (!proto.getWorldMatrix) {
            proto.getWorldMatrix = function () {
                const { pos, rot } = absolutePosition(this);
                return { _pos: pos, _rot: rot, _isStubMatrix: true };
            };
        }
        if (!proto.getAbsolutePosition) {
            proto.getAbsolutePosition = function () {
                const { pos } = absolutePosition(this);
                const v = V3 ? new V3(pos.x, pos.y, pos.z) : { ...pos };
                if (!v.clone) v.clone = function () { return { x: this.x, y: this.y, z: this.z, clone: v.clone }; };
                return v;
            };
        }
        if (!proto.setParent) {
            proto.setParent = function (p) { this.parent = p; return this; };
        }
        if (!proto.getChildren) {
            proto.getChildren = function () { return []; };
        }
        if (!proto.setEnabled) {
            proto.setEnabled = function (v) { this._enabled = !!v; return this; };
        }
        // waterMesh is `new BABYLON.Mesh(...)` (game.js:1809), not a MeshBuilder
        // product, so the decorate() wrapper never sees it — these must live on
        // the prototype too.
        if (!proto.getVerticesData) {
            proto.getVerticesData = function (kind) {
                if (!this._verts) this._verts = {};
                if (!this._verts[kind]) this._verts[kind] = new Float32Array(0);
                return this._verts[kind];
            };
        }
        if (!proto.setVerticesData) {
            proto.setVerticesData = function (kind, data) {
                if (!this._verts) this._verts = {};
                this._verts[kind] = data;
                return this;
            };
        }
        if (!proto.isVerticesDataPresent) {
            proto.isVerticesDataPresent = function () { return false; };
        }
        if (typeof proto.isEnabled !== 'function') {
            proto.isEnabled = function () { return this._enabled !== false; };
        }
    }
}

module.exports = { extendStub, patchNodeTransforms };

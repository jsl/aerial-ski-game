(function (global) {
'use strict';
// ── Procedural PBR texture generation ────────────────────────────────────────
// Every surface in this scene was a flat untextured colour. That is the most
// reliable "this is a game" signal there is: real materials vary — fabric has
// weave, rock has grain, snow has drift, tree bark has fibre — and it is the
// VARIATION the eye reads, far more than the base hue.
//
// These are generated at runtime rather than shipped as images. The reasons are
// specific, not ideological:
//   - the project ships as static files with no build step, and a texture set
//     for a dozen materials would be megabytes
//   - generated maps tile perfectly by construction, with no seam authoring
//   - they are deterministic, so the look cannot drift between sessions
//
// The trade-off is honest: procedural noise cannot match a photographed or
// sculpt-baked texture for specificity. This is the step BELOW a Blender bake,
// chosen because it covers the whole scene at once rather than one asset.

/** Deterministic integer hash — same surface every load, no seeding needed. */
function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash2(xi, yi),     b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal Brownian motion — octaves of noise at halving amplitude. */
function fbm(x, y, octaves, lacunarity, gain) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += valueNoise(x * freq, y * freq) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}

/**
 * Height field -> tangent-space normal map, by central differences.
 * Wrapping the lookups is what makes the result tile seamlessly.
 */
function heightToNormal(H, size, strength) {
    const data = new Uint8ClampedArray(size * size * 4);
    const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
            const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
            const len = Math.sqrt(dx * dx + dy * dy + 1);
            const i = (y * size + x) * 4;
            data[i]     = ((-dx / len) * 0.5 + 0.5) * 255;
            data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
            data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
            data[i + 3] = 255;
        }
    }
    return data;
}

/**
 * Surface recipes. Each returns a height value in 0..1 for a point on the unit
 * square, plus an albedo multiplier so the colour varies with the form rather
 * than being uniform over a bumpy surface — flat colour on bumpy geometry is
 * its own kind of wrong.
 */
const RECIPES = {
    // Groomed piste: drifts, wind ripple, granular break-up, corduroy lines.
    snow(x, y) {
        let h = fbm(x * 8, y * 8, 3, 2.4, 0.5) * 0.55
              + fbm(x * 24, y * 24, 2, 2.0, 0.5) * 0.28
              + valueNoise(x * 96, y * 96) * 0.17;
        h += Math.sin(y * Math.PI * 2 * 48) * 0.035;   // groomer corduroy
        return { h, tint: 0.94 + h * 0.06 };
    },
    // Rock: sharp fractured facets, so ridged noise rather than smooth fbm.
    rock(x, y) {
        const r = 1 - Math.abs(fbm(x * 6, y * 6, 4, 2.1, 0.55) * 2 - 1);
        const grain = valueNoise(x * 64, y * 64) * 0.12;
        const h = r * 0.8 + grain;
        return { h, tint: 0.72 + h * 0.4 };
    },
    // Bark: strongly anisotropic — fibres run vertically.
    bark(x, y) {
        const fibre = fbm(x * 40, y * 3, 3, 2.0, 0.5);
        const cracks = Math.abs(Math.sin(x * Math.PI * 26 + fibre * 4)) ** 3;
        const h = fibre * 0.55 + cracks * 0.45;
        return { h, tint: 0.6 + h * 0.5 };
    },
    // Foliage: clumped masses, not a smooth surface.
    foliage(x, y) {
        const clump = fbm(x * 14, y * 14, 3, 2.6, 0.5);
        const h = clump * clump;
        return { h, tint: 0.7 + clump * 0.55 };
    },
    // Technical fabric: fine weave with a slight sheen variation.
    fabric(x, y) {
        const weave = (Math.sin(x * Math.PI * 2 * 220) * Math.sin(y * Math.PI * 2 * 220)) * 0.5 + 0.5;
        const slub = fbm(x * 30, y * 30, 2, 2.0, 0.5) * 0.25;
        const h = weave * 0.35 + slub;
        return { h, tint: 0.92 + slub * 0.16 };
    },
    // Moulded plastic / helmet shell: near-smooth with faint orange-peel.
    shell(x, y) {
        const peel = fbm(x * 70, y * 70, 2, 2.0, 0.5);
        return { h: peel * 0.25, tint: 0.97 + peel * 0.06 };
    },
};

/**
 * Build a { normal, albedo } DynamicTexture pair for a named recipe.
 * Returns null in any environment without a real 2D canvas (the headless test
 * stub), so callers degrade to flat colour rather than crashing.
 */
function makeSurface(BABYLON, scene, recipe, size, opts) {
    const o = opts || {};
    const fn = RECIPES[recipe];
    if (!fn) return null;

    const nrmTex = new BABYLON.DynamicTexture('tex_' + recipe + '_n',
        { width: size, height: size }, scene, true);
    const nctx = nrmTex.getContext();
    if (!nctx || !nctx.createImageData) return null;

    const H = new Float32Array(size * size);
    const tint = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const r = fn(x / size, y / size);
            H[y * size + x] = r.h;
            tint[y * size + x] = r.tint;
        }
    }

    const nrm = nctx.createImageData(size, size);
    nrm.data.set(heightToNormal(H, size, o.strength || 2.4));
    nctx.putImageData(nrm, 0, 0);
    nrmTex.update(false);

    // Albedo variation, applied as a multiplier over the material's base colour
    // so each material keeps its own hue.
    const albTex = new BABYLON.DynamicTexture('tex_' + recipe + '_a',
        { width: size, height: size }, scene, true);
    const actx = albTex.getContext();
    const alb = actx.createImageData(size, size);
    // ENCODE TO sRGB ON THE WAY IN.
    //
    // albedoColor is LINEAR, and this canvas becomes a texture Babylon decodes as
    // sRGB. Writing the linear number straight into the bytes therefore puts it
    // through a decode it was never encoded for: snow at linear 0.89 came back as
    // 0.89^2.2 = 0.77, so every surface lost about 13% of its brightness at the
    // moment _applySurfaces ran — a second after load, which reads as the ramp
    // "going grey when the run starts" rather than as a colour-space bug.
    //
    // It applied to every textured surface in the scene, not just the snow, which
    // is a good part of why the whole thing looked washed and grey.
    const toSRGB = (v) => (v <= 0.0031308
        ? v * 12.92
        : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const base = (o.baseColor || [1, 1, 1]).map(toSRGB);
    for (let i = 0; i < size * size; i++) {
        const t = Math.min(1.4, Math.max(0.4, tint[i]));
        alb.data[i * 4]     = Math.min(255, base[0] * 255 * t);
        alb.data[i * 4 + 1] = Math.min(255, base[1] * 255 * t);
        alb.data[i * 4 + 2] = Math.min(255, base[2] * 255 * t);
        alb.data[i * 4 + 3] = 255;
    }
    actx.putImageData(alb, 0, 0);
    albTex.update(false);

    for (const t of [nrmTex, albTex]) {
        t.uScale = o.scale || 8;
        t.vScale = o.scale || 8;
        t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        // P12: these tiles are seen at every grazing angle on the ground —
        // trilinear mip filtering (the DynamicTexture default when generated
        // with mipmaps; the property is getter-only in this Babylon build)
        // plus 16x anisotropy keeps the snow surface from turning to mush or
        // shimmering away from the camera centre.
        t.anisotropicFilteringLevel = 16;
    }
    return { normal: nrmTex, albedo: albTex };
}

const api = { makeSurface, RECIPES, fbm, valueNoise };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).textures = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

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
 * Periodic macro-variation field. The lattice valueNoise above does NOT wrap
 * at x/y = 1 (hash2(8, y) ≠ hash2(0, y)), which is fine inside one recipe
 * evaluation but would paint a seam line across the snow every tile period if
 * used for a ~45 m macro layer. Integer-wavenumber plane waves are periodic on
 * the unit square by construction, so the tile is seamless at ANY uScale.
 * Zero-mean sine sum → the height's mean is exactly 0.5.
 */
const MACRO_WAVES = (function () {
    const waves = [];
    // Two drift octaves: 5 broad undulations (wavenumbers 1-4) + 10 mid.
    for (let i = 0; i < 5; i++) {
        waves.push({ kx: 1 + (i % 4), ky: 1 + ((i * 3 + 1) % 4), a: 2 });
    }
    for (let i = 0; i < 10; i++) {
        waves.push({ kx: 2 + (i % 5), ky: 2 + ((i * 7 + 3) % 5), a: 1 });
    }
    for (let i = 0; i < waves.length; i++) {
        waves[i].ph = hash2(i * 7 + 13, i * 11 + 5) * Math.PI * 2;
    }
    return waves;
})();

function macroField(x, y) {
    let sum = 0, norm = 0;
    for (let i = 0; i < MACRO_WAVES.length; i++) {
        const w = MACRO_WAVES[i];
        sum += w.a * Math.sin(2 * Math.PI * (w.kx * x + w.ky * y) + w.ph);
        norm += w.a;
    }
    return 0.5 + sum / (2 * norm);
}

/**
 * Snow macro-variation layer for PBRMaterial.detailMap — the "second,
 * larger-scale variation layer" of P12. This Babylon build's detail shader
 * does, exactly:
 *   albedo: baseColor.rgb * 2 * mix(0.5, texel.r, diffuseBlendLevel)
 *   normal: (nx, ny) packed in texel (A, G) as v*0.5+0.5, whiteout-blended
 *           with the bump normal, scaled by bumpLevel
 * so the tile stores R = B = 0.5 + drift (mean 0.5 → mean multiplier exactly
 * 1.0, protecting the grey-ramp gates) and G/A a gentle normal from the same
 * drift field. Returns null without a real canvas, like makeSurface.
 */
function makeDetail(BABYLON, scene, size, opts) {
    const o = opts || {};
    const dtex = new BABYLON.DynamicTexture('tex_snowmacro_d',
        { width: size, height: size }, scene, true);
    const dctx = dtex.getContext();
    if (!dctx || !dctx.createImageData) return null;

    const H = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) H[y * size + x] = macroField(x / size, y / size);
    }
    const nrm = heightToNormal(H, size, o.strength || 1.2);
    const img = dctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
        const drift = Math.max(0, Math.min(1, 0.5 + (H[i] - 0.5) * (o.drift || 0.16)));
        img.data[i * 4]     = drift * 255;          // R: albedo modulation
        img.data[i * 4 + 1] = nrm[i * 4 + 1];       // G: ny
        img.data[i * 4 + 2] = drift * 255;          // B: unused by the shader
        img.data[i * 4 + 3] = nrm[i * 4];           // A: nx
    }
    dctx.putImageData(img, 0, 0);
    dtex.update(false);
    dtex.gammaSpace = false;                        // data, not colour
    const s = o.scale || 1;
    dtex.uScale = s;
    dtex.vScale = s;
    dtex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    dtex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    dtex.anisotropicFilteringLevel = 16;
    return { detail: dtex };
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

/**
 * Ridge-side texturing for the P6 mountains (HUMAN TESTING #4 item 3): the
 * ridgelines regressed to flat single-colour curtains, and the author wants
 * the rock/snow/forest banding the earlier peaks had back — as a TEXTURE, so
 * the ridge silhouette keeps its clean layered read while the surface carries
 * real variation.
 *
 * Input space: the mesh's UVs, where v is NORMALISED ELEVATION ((y − valley
 * floor) / SNOWLINE_M, authored in game.js) and u is world distance. Bands:
 *   v < 0.42  forest — dark green with vertical tree-line strokes
 *   mid band  exposed rock — grey, ridged fracture noise
 *   v > 0.66  snowfield — near-white, broken by rock outcrops
 * Band edges jitter with fbm so the boundaries read as terrain, not contour
 * lines. Returns { normal, albedo } or null headless, like makeSurface.
 */
function makeRidgeSurface(BABYLON, scene, size, opts) {
    const o = opts || {};
    const tex = new BABYLON.DynamicTexture('tex_ridge_a',
        { width: size, height: size }, scene, true);
    const ctx = tex.getContext();
    if (!ctx || !ctx.createImageData) return null;

    const H = new Float32Array(size * size);
    const img = ctx.createImageData && ctx.createImageData(size, size);
    if (!img || !img.data) return null;            // headless stub canvas
    // Palette (linear 0..1, encoded to sRGB on the way out — see makeSurface).
    const FOREST = [0.13, 0.20, 0.13], ROCK = [0.42, 0.43, 0.45],
          SNOW = [0.93, 0.95, 0.98], DARK = [0.05, 0.08, 0.05];
    const mix = (a, b, t) => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t];
    const toSRGB = v => (v <= 0.0031308
        ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

    for (let y = 0; y < size; y++) {
        // v: 0 = valley floor, 1 = well above the snowline. Canvas y grows
        // DOWN while texture v grows UP, so sample v from the bottom.
        // v = elevation (0 valley floor → 1 above the snowline). Measured on
        // the GPU (2026-08-30, HUMAN TESTING #11): with this DynamicTexture the
        // canvas TOP row samples at v = 0, so the old `1 - y/(size-1)` put the
        // forest band on every crown and snow at the base — the "tooth" peaks
        // and upside-down ridges. Canvas y grows with elevation here.
        const v = y / (size - 1);
        for (let x = 0; x < size; x++) {
            const u = x / size;
            const j = fbm(u * 5, v * 5, 3, 2.2, 0.5);          // band jitter
            const treeJ = fbm(u * 22, v * 22, 2, 2.1, 0.5);
            let c, h;
            // STRATA mode (distant cone peaks, iter 134): the default map's
            // strong outcrop/fracture noise reads as camouflage blotches when
            // the whole 2π cone circumference maps to one texture width — the
            // peaks get gentle band-edge jitter, soft rock contrast and
            // near-horizontal sediment strata keyed on elevation.
            const strata = o.strata
                ? Math.sin(v * Math.PI * 2 * 9 + (j - 0.5) * 1.5)
                : 0;
            const jitter = o.strata ? 0.04 : 0.12;
            const snowEdge = 0.66 + (j - 0.5) * jitter;
            // Strata mode serves the DISTANT peaks and mid/far ridges: their
            // crests sit at v ≈ 0.42–0.5, inside the default forest band, so
            // they carried dark-green caps (entry-134 open item). Drop the
            // strata forest edge so mid/far crests read rock/snow; only a
            // thin distant tree-line remains at the valley foot.
            const forestEdge = (o.strata ? 0.20 : 0.42) + (j - 0.5) * jitter;
            if (v >= snowEdge) {
                const d = fbm(u * 12, v * 12, 3, 2.3, 0.5);
                // Stronger rock outcrops: the snowfields must read as broken
                // (Strata mode: contrast halved-plus so the caps' outcrops
                // read as shading, not blobs.)
                c = mix(SNOW, ROCK, Math.max(0, d - 0.47) * (o.strata ? 1.6 : 3.6));
                h = 0.5 + d * 0.3;
                if (o.strata) {
                    c = mix(c, ROCK, Math.max(0, strata) * 0.18);
                    c = mix(c, [0.30, 0.34, 0.40], Math.max(0, -strata) * 0.16);
                }
            } else if (v >= forestEdge) {
                // Rock band: sharp fractured facets.
                const r = 1 - Math.abs(fbm(u * 7, v * 7, 4, 2.1, 0.55) * 2 - 1);
                c = mix(ROCK, DARK, Math.max(0, r - 0.55) * (o.strata ? 0.45 : 0.9));
                h = r * 0.8 + valueNoise(u * 60, v * 60) * 0.12;
                if (o.strata) {
                    c = mix(c, [0.52, 0.50, 0.48], Math.max(0, strata) * 0.22);
                    c = mix(c, [0.26, 0.27, 0.30], Math.max(0, -strata) * 0.22);
                }
                // Snow clinging on near the snowline.
                c = mix(c, SNOW, Math.max(0, (v - snowEdge + 0.10) / 0.10) * 0.5);
            } else {
                // Forest: clumped canopy + darker vertical strokes so the
                // near ridges read as tree-line, not green felt.
                const clump = fbm(u * 16, v * 16, 3, 2.6, 0.5);
                const stroke = Math.abs(Math.sin(u * Math.PI * 2 * 90
                    + treeJ * 6)) ** 6;
                c = mix(FOREST, DARK, Math.min(1, clump * 0.70 + stroke * 0.60));
                h = clump * 0.7 + stroke * 0.3;
            }
            const i = y * size + x;
            H[i] = h;
            img.data[i * 4]     = Math.min(255, toSRGB(c[0]) * 255);
            img.data[i * 4 + 1] = Math.min(255, toSRGB(c[1]) * 255);
            img.data[i * 4 + 2] = Math.min(255, toSRGB(c[2]) * 255);
            img.data[i * 4 + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    tex.update(false);

    const ntex = new BABYLON.DynamicTexture('tex_ridge_n',
        { width: size, height: size }, scene, true);
    const nctx = ntex.getContext();
    if (!nctx || !nctx.createImageData) return null;
    const nrm = nctx.createImageData(size, size);
    nrm.data.set(heightToNormal(H, size, o.strength || 2.2));
    nctx.putImageData(nrm, 0, 0);
    ntex.update(false);
    ntex.gammaSpace = false;                        // data, not colour

    for (const t of [tex, ntex]) {
        t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;   // v is elevation, not a tile
        t.anisotropicFilteringLevel = 16;
    }
    return { albedo: tex, normal: ntex };
}

const api = { makeSurface, makeDetail, makeRidgeSurface, macroField, RECIPES, fbm, valueNoise };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
} else {
    (global.AerialEngine = global.AerialEngine || {}).textures = api;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

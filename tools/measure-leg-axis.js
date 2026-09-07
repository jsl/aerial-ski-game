'use strict';

// Delivered geometry in the ski frame. Shared by the probe and browser gate.
async function measureLegs(page) {
    return page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene;
        const result = {};
        for (const side of ['L', 'R']) {
            const ski = scene.getMeshByName('ski' + side);
            const inverse = ski.computeWorldMatrix(true).clone().invert();
            const points = (mesh, owns) => {
                const positions = mesh.getPositionData(true, true);
                const world = mesh.computeWorldMatrix(true), out = [];
                for (let i = 0; i < positions.length; i += 3) {
                    if (owns && !owns(i / 3)) continue;
                    const p = BABYLON.Vector3.TransformCoordinates(
                        BABYLON.Vector3.FromArray(positions, i), world);
                    out.push(BABYLON.Vector3.TransformCoordinates(p, inverse));
                }
                return out;
            };
            const lips = scene.meshes.filter(m => m.name.startsWith('athleteBoot' + side)
                && m.material?.name === 'bootLip').flatMap(m => points(m));
            if (!lips.length) throw new Error('Missing rendered cuff ' + side);
            const top = Math.max(...lips.map(p => p.y));
            const ring = lips.filter(p => p.y > top - 0.012);
            const cuffZ = ring.reduce((z, p) => z + p.z, 0) / ring.length;
            const body = scene.meshes.filter(m => m.name.startsWith('athleteBody')
                && m.skeleton).flatMap(mesh => {
                const indices = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
                const weights = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
                // Palette index != array position: glTF adds a synthetic root.
                const names = new Map(mesh.skeleton.bones.map(b => [b.getIndex(), b.name]));
                const legNames = ['lowerLeg' + side, 'upperLeg' + side, 'hlpKnee' + side];
                return points(mesh, i => {
                    let owned = 0;
                    for (let j = 0; j < 4; j++) {
                        if (legNames.includes(names.get(indices[i * 4 + j]))) owned += weights[i * 4 + j];
                    }
                    return owned > 0.5;
                });
            });
            const band = (lo, hi) => {
                const ps = body.filter(p => p.y > lo && p.y < hi);
                if (ps.length < 10) throw new Error('Insufficient shin samples ' + side + ' ' + lo);
                return { n: ps.length, z: ps.reduce((z, p) => z + p.z, 0) / ps.length };
            };
            const atCuff = band(top - 0.03, top + 0.06);
            const bands = [0.10, 0.15, 0.20, 0.25].map(yLo => {
                const b = band(0.015 + yLo, 0.065 + yLo);
                return { yLo, delta: b.z - cuffZ, n: b.n };
            });
            result[side] = {
                boot: { centreAlong: cuffZ, cuffCentreAlong: cuffZ, topY: top, botY: 0.015 },
                shinAtCuff: { centreAlong: atCuff.z, n: atCuff.n },
                shinMinusCuff: atCuff.z - cuffZ, bands,
            };
        }
        return result;
    });
}

module.exports = { measureLegs };

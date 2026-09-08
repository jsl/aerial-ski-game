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
                && m.material?.name === 'bootLip').flatMap(mesh => {
                    // Select the complete upper ring in its unposed bind frame.
                    // A world-height slice of a flexed cuff selects one rim edge.
                    const raw = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
                    let top = -Infinity;
                    for (let i = 1; i < raw.length; i += 3) top = Math.max(top, raw[i]);
                    return points(mesh, i => raw[i * 3 + 1] > top - 0.006);
                });
            if (!lips.length) throw new Error('Missing rendered cuff ' + side);
            const cuffY = lips.reduce((y, p) => y + p.y, 0) / lips.length;
            const cuffZ = lips.reduce((z, p) => z + p.z, 0) / lips.length;
            const shin = window._characterMeshes['lowerLeg' + side];
            const upWorld = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y,
                shin.computeWorldMatrix(true));
            const up = BABYLON.Vector3.TransformNormal(upWorld, inverse).normalize();
            if (Math.abs(up.y) < 0.25) throw new Error('Shin too horizontal for ready axis gate');
            const slope = up.z / up.y;
            // Direction is the rendered shin driver, but its position is the
            // independently measured cuff centre. Translating the boot alone
            // therefore still fails alignment; flexing the shin does not.
            const projectedZ = p => p.z - slope * (p.y - cuffY);
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
                return { n: ps.length, z: ps.reduce((z, p) => z + projectedZ(p), 0) / ps.length };
            };
            const atCuff = band(cuffY - 0.03, cuffY + 0.06);
            const bands = [0.10, 0.15, 0.20, 0.25].map(yLo => {
                const b = band(0.015 + yLo, 0.065 + yLo);
                return { yLo, delta: b.z - cuffZ, n: b.n };
            });
            result[side] = {
                boot: { centreAlong: cuffZ - slope * (cuffY - 0.015),
                    cuffCentreAlong: cuffZ, topY: cuffY, botY: 0.015,
                    ringSamples: lips.length },
                shinAxis: { y: up.y, z: up.z, slope },
                shinAtCuff: { centreAlong: atCuff.z, n: atCuff.n },
                shinMinusCuff: atCuff.z - cuffZ, bands,
            };
        }
        return result;
    });
}

module.exports = { measureLegs };

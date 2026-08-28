(function (global) {
'use strict';

// P13: Kinematic Chain Solver
// Reconciles joint transforms to ensure continuity and prevent mesh tearing.

const CHAIN = {
    upperArmL: { parent: 'torso', h: 0.30 },
    upperArmR: { parent: 'torso', h: 0.30 },
    lowerArmL: { parent: 'upperArmL', h: 0.30 },
    lowerArmR: { parent: 'upperArmR', h: 0.30 },
    upperLegL: { parent: 'torso', h: 0.36 },
    upperLegR: { parent: 'torso', h: 0.36 },
    lowerLegL: { parent: 'upperLegL', h: 0.36 },
    lowerLegR: { parent: 'upperLegR', h: 0.36 },
    skiL:      { parent: 'lowerLegL', h: 0.36 },
    skiR:      { parent: 'lowerLegR', h: 0.36 }
};

const kinematics = {
    reconcile: function(meshes) {
        for (const [name, cfg] of Object.entries(CHAIN)) {
            const mesh = meshes[name];
            const parent = meshes[cfg.parent];
            if (!mesh || !parent) continue;

            // Simple joint alignment: align top of child to bottom of parent
            const rx = parent.rotation.x;
            const cosRx = Math.cos(rx);
            const sinRx = Math.sin(rx);
            
            // Parent bottom
            const jointY = parent.position.y - (cfg.h/2) * cosRx;
            const jointZ = parent.position.z - (cfg.h/2) * sinRx;
            
            // Move child so its top (y + h/2) is at the joint
            mesh.position.y = jointY - (cfg.h/2) * cosRx;
            mesh.position.z = jointZ - (cfg.h/2) * sinRx;
        }
    },
    // Tear detector gate: checks if any segment joint displacement > 3x rest edge.
    checkTearing: function(meshes) {
        for (const [name, cfg] of Object.entries(CHAIN)) {
            const mesh = meshes[name];
            const parent = meshes[cfg.parent];
            if (!mesh || !parent) continue;

            const rx = parent.rotation.x;
            const jointY = parent.position.y - (cfg.h/2) * Math.cos(rx);
            const jointZ = parent.position.z - (cfg.h/2) * Math.sin(rx);
            
            const dist = Math.hypot(mesh.position.y - jointY, mesh.position.z - jointZ);
            if (dist > 3 * cfg.h) return true;
        }
        return false;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = kinematics;
} else {
    (global.AerialEngine = global.AerialEngine || {}).kinematics = kinematics;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);

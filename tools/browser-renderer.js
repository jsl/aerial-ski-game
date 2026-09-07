'use strict';

// Opt in for visual reviews on the NVIDIA host: DRIVE_GPU=1.
// Keep the software path for machines without a Vulkan-capable GPU.
const gpu = process.env.DRIVE_GPU === '1';
const args = gpu
    ? ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan',
        '--disable-vulkan-surface', '--ignore-gpu-blocklist',
        '--disable-gpu-sandbox', '--no-sandbox']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox', '--no-sandbox'];

module.exports = { gpu, args };

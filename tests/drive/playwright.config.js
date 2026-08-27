'use strict';
// Playwright config for the real-browser drive-through (ADR-0010).
//
// This is the ONLY layer that runs game.js against real lib/babylon.js in a real
// browser. Everything else runs against tests/babylon-stub.js, which cannot
// catch divergence between the stub and the actual engine.

const { defineConfig } = require('@playwright/test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
// Port for the static server; override with DRIVE_PORT so parallel lanes/worktrees do not collide on 8099.
const PORT = parseInt(process.env.DRIVE_PORT || '8099', 10);

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: /.*\.spec\.js/,

    // The game is a real-time simulation; a full run takes ~15 s of wall clock.
    timeout: 300_000,
    expect: { timeout: 15_000 },

    // Deterministic: no retries, so a flake reports as a flake rather than being
    // silently papered over.
    retries: 0,
    workers: 1,
    reporter: [['list']],

    // Serve the game exactly as it ships — static files, no build step.
    webServer: {
        command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${ROOT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000,
    },

    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        // Small viewport ON PURPOSE. game.js:2904 skips the entire update when
        // rawDt > 0.1s, a guard against physics exploding after a tab stall.
        // With no GPU available to the browser, SwiftShader renders a 1280x720
        // canvas at ~8fps (deltaTime ~128ms), which trips that guard on EVERY
        // frame and the simulation never advances. Fewer pixels gets frame times
        // back under 100ms so the game actually runs.
        viewport: { width: 320, height: 220 },
        // WebGL in headless Chromium needs software rendering on a machine with
        // no display server. SwiftShader is slower than the GPU but correct,
        // which is what matters for a smoke test.
        launchOptions: {
            args: [
                '--use-gl=swiftshader',
                '--enable-unsafe-swiftshader',
                '--disable-gpu-sandbox',
                '--no-sandbox',
            ],
        },
        video: 'off',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});

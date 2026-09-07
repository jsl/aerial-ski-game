'use strict';
// DRIVE_GPU=1 DRIVE_PORT=8200 node tools/probe_leg_axis.js
// z increases toward the ski tail. Cuff/shin geometry is measured after skinning.
const { chromium } = require('playwright');
const { measureLegs } = require('./measure-leg-axis');
(async () => {
    const browser = await chromium.launch({ args: require('./browser-renderer').args });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
        await page.goto('http://127.0.0.1:' + (process.env.DRIVE_PORT || 8393) + '/index.html?mode=realistic');
        await page.waitForFunction(() => window._bodyLinked > 0, null, { timeout: 60000 });
        await page.waitForTimeout(1000);
        console.log(JSON.stringify(await measureLegs(page), null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

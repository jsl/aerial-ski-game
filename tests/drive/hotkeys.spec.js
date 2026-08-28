'use strict';
// Layout-aware letter hotkeys + ESC-closes-modals (human-testing items 6/7).
//
// Item 6: the help menu shows LETTERS, so the key that fires a hotkey must be
// the one that types that letter (event.key). The old code matched
// event.code — the physical QWERTY slot — so on Dvorak the printed letter
// did nothing. Gate: a Dvorak-style event (key = the shown letter, code = a
// DIFFERENT physical slot) must fire the action.
//
// Item 7: ESC closes the help menu and any open modal overlay.

const { test, expect } = require('@playwright/test');
test.setTimeout(90_000); // DOM-only spec; never needs the 300 s run budget.

/** Wait until game.js has booted and the body is linked (see game.spec.js). */
async function waitForBoot(page) {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window._getGameState === 'function',
        null, { timeout: 30_000 });
    await page.waitForFunction(() => window._bodyLinked > 0,
        null, { timeout: 60_000 });
}

/** Dispatch a keydown/keyup pair with mismatched key vs code (Dvorak-style). */
async function pressDvorak(page, key, code) {
    await page.evaluate(([k, c]) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: c, bubbles: true }));
    }, [key, code]);
}

test('letter hotkeys fire on the typed letter even when code is a different slot', async ({ page }) => {
    await waitForBoot(page);

    // P pauses. Code is KeyR on purpose: a code-matching handler would run
    // RESET here and paused would stay false — this assertion pins the bug.
    await pressDvorak(page, 'p', 'KeyR');
    await expect.poll(() => page.evaluate(() => window._isPaused()),
        { timeout: 5000 }).toBe(true);
    await pressDvorak(page, 'p', 'KeyR');
    await expect.poll(() => page.evaluate(() => window._isPaused()),
        { timeout: 5000 }).toBe(false);

    // Z toggles the tutorial time scale — observable on window.
    await pressDvorak(page, 'z', 'KeyD');
    await expect.poll(() => page.evaluate(() => window._tutorialTimeScale),
        { timeout: 5000 }).toBe(0.5);
    await pressDvorak(page, 'z', 'KeyD');
    await expect.poll(() => page.evaluate(() => window._tutorialTimeScale),
        { timeout: 5000 }).toBe(1.0);
});

test('a real keyboard press still fires the letter hotkey (no over-restriction)', async ({ page }) => {
    await waitForBoot(page);
    // page.keyboard produces key='p', code='KeyP' — the ordinary QWERTY path.
    await page.keyboard.press('p');
    await expect.poll(() => page.evaluate(() => window._isPaused()),
        { timeout: 5000 }).toBe(true);
    await page.keyboard.press('p');
    await expect.poll(() => page.evaluate(() => window._isPaused()),
        { timeout: 5000 }).toBe(false);
});

test('ESC closes the help menu and any open modal', async ({ page }) => {
    await waitForBoot(page);
    const openModal = async (btnId, modalId) => {
        // Some buttons sit under the #worldMenu overlay at boot, so a real
        // pointer click can be intercepted; a DOM click runs the same
        // handler chain the button would.
        await page.evaluate((id) => document.getElementById(id).click(), btnId);
        await expect(page.locator(`#${modalId}`)).toHaveClass(/open/, { timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(page.locator(`#${modalId}`)).not.toHaveClass(/open/, { timeout: 5000 });
    };

    await openModal('helpBtn', 'helpModal');
    await openModal('settingsBtn', 'settingsModal');
    await openModal('customBtn', 'customModal');
});

import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(__dirname, '..', 'screenshots');

const instance = process.env.SN_INSTANCE || '';
const username = process.env.SN_USERNAME || '';
const password = process.env.SN_PASSWORD || '';
const pageId = process.env.SN_PAGE_ID || 'rest_explorer';
const portal = process.env.SN_PORTAL || '/';

function ensureEnv() {
  if (!instance || !username || !password) {
    throw new Error(
      'Missing required environment variables: SN_INSTANCE, SN_USERNAME, SN_PASSWORD'
    );
  }
}

async function login(page) {
  const startUrl = `${portal}?id=${pageId}`;
  await page.goto(startUrl);

  // Portal login pages keep the same URL while rendering the login form inline.
  // Detect the login page by looking for a password field, not by URL.
  const passwordField = page.locator('input[type="password"]').first();
  let onLoginPage = false;
  try {
    await passwordField.waitFor({ state: 'visible', timeout: 10_000 });
    onLoginPage = true;
  } catch (e) {
    // Not on the login page; assume the widget will load.
  }

  if (onLoginPage) {
    // Try the standard field names first, then the Service Portal login widget names,
    // then any visible text input on the login form.
    const usernameField = page.locator('input[name="user_name"], input#user_name, input[name="username"], input#username, input[type="text"]:visible').first();
    const loginButton = page.locator('#sysverb_login, input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")').first();

    await usernameField.fill(username);
    await passwordField.fill(password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 30_000 }),
      loginButton.click(),
    ]);
  }

  // Wait for either the widget or an access-denied message.
  await page.waitForSelector('.rest-explorer, .alert-danger', {
    state: 'visible',
    timeout: 20_000,
  });
}

test.beforeAll(async () => {
  ensureEnv();
  await mkdir(screenshotDir, { recursive: true });
});

test('capture REST Explorer screenshots', async ({ page }) => {
  await login(page);

  // Confirm we landed on the intended page and the widget rendered.
  await expect(page.locator('.rest-explorer')).toBeVisible();

  // Default state: REST Message builder, no response yet.
  await page.screenshot({
    path: path.join(screenshotDir, 'rest-explorer-default.png'),
    fullPage: true,
  });

  // Switch to Direct URL mode to show the URL builder variant.
  const directUrlRadio = page.locator('input[type="radio"][value="url"]');
  await directUrlRadio.waitFor({ state: 'visible' });
  await directUrlRadio.click();

  // Wait briefly for Angular to swap the template.
  await page.waitForSelector('input[placeholder="https://host/path?query=params"]', {
    state: 'visible',
  });

  await page.screenshot({
    path: path.join(screenshotDir, 'rest-explorer-direct-url.png'),
    fullPage: true,
  });

  // Select OAuth auth to reveal the OAuth profile picker.
  await page.selectOption('select[ng-model="c.req.authType"]', 'oauth');
  await page.waitForSelector('.re-oauth-hint', { state: 'visible' });

  await page.screenshot({
    path: path.join(screenshotDir, 'rest-explorer-oauth.png'),
    fullPage: true,
  });
});

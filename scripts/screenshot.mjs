import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency needed for a one-off script).
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '');
}

const { SN_INSTANCE, SN_USERNAME, SN_PASSWORD, SN_PORTAL = '/rest_console', SN_PAGE_ID = 'rest_explorer' } = process.env;
if (!SN_INSTANCE || !SN_USERNAME || !SN_PASSWORD) {
  throw new Error('Missing SN_INSTANCE / SN_USERNAME / SN_PASSWORD in .env');
}

const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('Logging in...');
await page.goto(`${SN_INSTANCE}/login.do`);
await page.fill('#user_name', SN_USERNAME);
await page.fill('#user_password', SN_PASSWORD);
await page.click('#sysverb_login');
await page.waitForLoadState('networkidle');

const widgetUrl = `${SN_INSTANCE}${SN_PORTAL}?id=${SN_PAGE_ID}`;
console.log(`Navigating to ${widgetUrl}`);
await page.goto(widgetUrl);
await page.waitForSelector('.rest-explorer', { timeout: 30000 });
await page.waitForTimeout(1000); // let Angular finish binding dropdown data

async function shot(name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`Saved ${file}`);
}

await shot('rest-explorer-default.png');

// Direct URL mode with a sample request filled in.
await page.check('input[value="url"]');
await page.fill('input[placeholder="https://host/path?query=params"]', 'https://catfact.ninja/breeds?limit=5');
await page.dispatchEvent('input[placeholder="https://host/path?query=params"]', 'blur');
await page.waitForTimeout(300);
await shot('rest-explorer-direct-url.png');

// OAuth auth type selected.
await page.selectOption('select[ng-model="c.req.authType"]', 'oauth');
await page.waitForTimeout(300);
await shot('rest-explorer-oauth.png');

await browser.close();
console.log('Done.');

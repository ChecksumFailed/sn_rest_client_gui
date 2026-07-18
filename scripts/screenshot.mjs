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

const widgetUrl = `${SN_INSTANCE}${SN_PORTAL}?id=${SN_PAGE_ID}`;
const endpointInput = 'input[ng-model="c.req.endpoint"]';
const authTypeSelect = 'select[ng-model="c.req.authType"]';
const midServerSelect = 'select[ng-model="c.req.midServer"]';
const sendButton = 'button.btn-primary';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('Logging in...');
await page.goto(`${SN_INSTANCE}/login.do`);
await page.fill('#user_name', SN_USERNAME);
await page.fill('#user_password', SN_PASSWORD);
await page.click('#sysverb_login');
await page.waitForLoadState('networkidle');

async function freshLoad() {
  await page.goto(widgetUrl);
  await page.waitForSelector('.rest-explorer', { timeout: 30000 });
  await page.waitForTimeout(1000); // let Angular finish binding dropdown data
}

async function shot(name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`Saved ${file}`);
}

async function useDirectUrl(url) {
  await page.check('input[value="url"]');
  await page.fill(endpointInput, url);
  await page.dispatchEvent(endpointInput, 'blur');
  await page.waitForTimeout(300);
}

async function send() {
  await page.selectOption(midServerSelect, ''); // force direct (sync) call, not through a MID server
  await page.click(sendButton);
  await page.waitForFunction(() => {
    const el = document.querySelector('.panel-heading');
    return el && !el.textContent.includes('—');
  }, { timeout: 20000 });
  await page.waitForTimeout(300);
}

// 1. Default view.
await freshLoad();
await shot('rest-explorer-default.png');

// 2. Direct URL mode, query params parsed out of a pasted URL.
await freshLoad();
await useDirectUrl('https://catfact.ninja/breeds?limit=5');
await shot('rest-explorer-direct-url.png');

// 3. OAuth 2.0 auth type selected (not sent — no live profile configured here).
await freshLoad();
await useDirectUrl('https://catfact.ninja/breeds?limit=5');
await page.selectOption(authTypeSelect, 'oauth');
await page.waitForTimeout(300);
await shot('rest-explorer-oauth.png');

// 4. A real response: send the catfact.ninja call and capture the response panel.
await freshLoad();
await useDirectUrl('https://catfact.ninja/breeds?limit=5');
await send();
await shot('rest-explorer-response.png');

// 5. Basic auth (manual entry) against httpbingo.org/basic-auth, sent for a real 200.
await freshLoad();
await useDirectUrl('https://httpbingo.org/basic-auth/testuser/testpass');
await page.selectOption(authTypeSelect, 'basic');
await page.selectOption('select[ng-model="c.req.basic.mode"]', 'manual');
await page.fill('input[ng-model="c.req.basic.username"]', 'testuser');
await page.fill('input[ng-model="c.req.basic.password"]', 'testpass');
await send();
await shot('rest-explorer-basic-auth.png');

// 6. API key (query param) against api.nasa.gov, using the public DEMO_KEY, sent for a real 200.
await freshLoad();
await useDirectUrl('https://api.nasa.gov/planetary/apod');
await page.selectOption(authTypeSelect, 'apikey');
await page.selectOption('select[ng-model="c.req.apiKey.placement"]', 'query');
await page.fill('input[ng-model="c.req.apiKey.name"]', 'api_key');
await page.fill('input[ng-model="c.req.apiKey.value"]', 'DEMO_KEY');
await send();
await shot('rest-explorer-apikey.png');

// 7. API key (header placement) against postman-echo.com/headers, which echoes the header back.
await freshLoad();
await useDirectUrl('https://postman-echo.com/headers');
await page.selectOption(authTypeSelect, 'apikey');
await page.selectOption('select[ng-model="c.req.apiKey.placement"]', 'header');
await page.fill('input[ng-model="c.req.apiKey.name"]', 'X-API-Key');
await page.fill('input[ng-model="c.req.apiKey.value"]', 'demo-header-key');
await send();
await shot('rest-explorer-apikey-header.png');

// 8. REST Message mode: a real saved message/method, showing ${token} variable substitution
// pre-filled from the function's stored test value, then sent for a real response.
await freshLoad();
await page.selectOption('select[ng-model="c.req.restMessage"]', { label: 'Cat Facts' });
await page.waitForTimeout(500);
await page.selectOption('select[ng-model="c.req.method"]', { label: 'Get a list of breeds  (https://catfact.ninja/breeds?limit=${limit})' });
await page.waitForTimeout(500);
await send();
await shot('rest-explorer-rest-message.png');

// 9. MID-server-routed call (async executeAsync()/waitForResponse() path).
await freshLoad();
await useDirectUrl('https://catfact.ninja/breeds?limit=5');
await page.selectOption(midServerSelect, { label: 'mid01' });
await page.click(sendButton);
await page.waitForFunction(() => {
  const el = document.querySelector('.panel-heading');
  return el && !el.textContent.includes('—');
}, { timeout: 30000 });
await page.waitForTimeout(300);
await shot('rest-explorer-mid-server.png');

await browser.close();
console.log('Done.');

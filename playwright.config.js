import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for generating screenshots of the Service Portal widget.
 *
 * This is separate from the unit test suite (`npm test`) because it requires a
 * live ServiceNow instance and credentials. It is not run by `npm run build`.
 *
 * Credentials are read from environment variables. For local runs, put them in a
 * `.env` file in the project root; that file is gitignored and will never be committed.
 *
 * Required environment variables:
 *   SN_INSTANCE  ServiceNow instance base URL, e.g. https://dev12345.service-now.com
 *   SN_USERNAME  Instance username with the x_1676196_rest_gui.user role (or admin)
 *   SN_PASSWORD  Instance password
 *
 * Optional:
 *   SN_PAGE_ID   Service Portal page ID (default: rest_explorer)
 *   SN_PORTAL    Portal path, e.g. /esc or /sp (default: /)
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.SN_INSTANCE || 'https://example.service-now.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chromium'],
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chromium'] },
    },
  ],
});

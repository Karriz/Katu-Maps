import { expect, test, type Page, type TestInfo } from '@playwright/test';

const viewports = {
  phone: { width: 412, height: 915, deviceScaleFactor: 1 },
  tablet: { width: 1024, height: 768, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
} as const;

const photonFixture = { features: [
  { geometry: { coordinates: [23.7609, 61.4981] }, properties: { name: 'Tampere Central Square', city: 'Tampere', country: 'Finland' } },
  { geometry: { coordinates: [23.7737, 61.4978] }, properties: { name: 'Tampere Hall', street: 'Yliopistonkatu', city: 'Tampere', country: 'Finland' } },
] };

type Scenario = { name: string; description: string; viewport: keyof typeof viewports; setup?: (page: Page) => Promise<void>; state: string };

async function openSearch(page: Page) {
  const input = page.getByLabel('Search for a place');
  await input.fill('Tampere');
  await expect(page.getByRole('listbox', { name: 'Location search results' })).toBeVisible();
}

async function openRoute(page: Page) {
  await page.getByRole('button', { name: 'Plan a route' }).click();
  await expect(page.getByRole('button', { name: 'Close route planner' })).toBeVisible();
}

const scenarios: Scenario[] = [
  { name: 'desktop-main-map', description: 'Main map after style readiness', viewport: 'desktop', state: 'map ready' },
  { name: 'tablet-main-map', description: 'Main map at tablet landscape dimensions', viewport: 'tablet', state: 'map ready' },
  { name: 'phone-main-map', description: 'Main map at Android phone dimensions', viewport: 'phone', state: 'map ready' },
  { name: 'phone-search-autocomplete', description: 'Focused search with deterministic Photon results', viewport: 'phone', setup: openSearch, state: 'search results open' },
  { name: 'desktop-favorites-empty', description: 'Graceful empty favourites list', viewport: 'desktop', setup: async page => { await page.getByRole('button', { name: 'Show favourites' }).click(); }, state: 'favourites open' },
  { name: 'tablet-search-results', description: 'Highlighted deterministic search candidates', viewport: 'tablet', setup: openSearch, state: 'search results open' },
  { name: 'phone-position-context-menu', description: 'Generic map context route actions', viewport: 'phone', setup: async page => { await page.locator('.map-canvas').click({ button: 'right', position: { x: 180, y: 350 } }); }, state: 'context menu open' },
  { name: 'desktop-business-poi-search', description: 'Business/POI search presentation', viewport: 'desktop', setup: openSearch, state: 'POI candidates' },
  { name: 'phone-transit-stop-search', description: 'Transit-oriented search result layout', viewport: 'phone', setup: openSearch, state: 'transit candidate list' },
  { name: 'tablet-selected-departure', description: 'Selected-item entry point at tablet size', viewport: 'tablet', setup: openSearch, state: 'selection entry point' },
  { name: 'phone-route-endpoints-expanded', description: 'Route endpoint selection in expanded mobile sheet', viewport: 'phone', setup: openRoute, state: 'route sheet expanded' },
  { name: 'desktop-walking-route', description: 'Walking route planner initial state', viewport: 'desktop', setup: openRoute, state: 'walking selected' },
  { name: 'tablet-transit-alternatives', description: 'Transit route planner tab and alternatives area', viewport: 'tablet', setup: async page => { await openRoute(page); await page.getByRole('tab', { name: /Transit/i }).click(); }, state: 'transit selected' },
  { name: 'phone-transit-itinerary', description: 'Expanded itinerary container and transfer layout entry point', viewport: 'phone', setup: async page => { await openRoute(page); await page.getByRole('tab', { name: /Transit/i }).click(); }, state: 'transit itinerary entry' },
  { name: 'phone-bottom-sheet-midpoint', description: 'Mobile route bottom sheet at its interactive presentation', viewport: 'phone', setup: openRoute, state: 'sheet expanded' },
  { name: 'desktop-layers-panel', description: 'Map layers and enabled state', viewport: 'desktop', setup: async page => { await page.getByRole('button', { name: 'Map layers' }).click(); }, state: 'layers open' },
  { name: 'phone-provider-error', description: 'Deterministic provider failure surfaced without hanging', viewport: 'phone', setup: async page => { await page.route('**/api/?q=ProviderError**', route => route.fulfill({ status: 503, body: 'fixture outage' })); const input = page.getByLabel('Search for a place'); await input.fill('ProviderError'); await expect(page.locator('.location-search-results')).toBeVisible(); }, state: 'provider empty/error' },
];

async function attachDiagnostics(page: Page, info: TestInfo, scenario: Scenario, runtime: { consoleErrors: string[]; failedRequests: string[] }) {
  const diagnostics = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      browser: navigator.userAgent,
      webgl2: Boolean(gl),
      webglVendor: gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
      webglRenderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
      devicePixelRatio: window.devicePixelRatio,
      maplibre: document.querySelector('.maplibregl-map') ? '6.6.0' : 'not initialized',
    };
  });
  await info.attach('scenario-metadata', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ description: scenario.description, viewport: viewports[scenario.viewport], fixture: 'visual-fixtures-v1', layers: 'default', uiState: scenario.state, ...diagnostics, ...runtime })) });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/?q=**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(photonFixture) }));
  await page.addInitScript(() => {
    Date.now = () => new Date('2026-01-15T10:00:00Z').valueOf();
    localStorage.clear();
  });
});

for (const scenario of scenarios) {
  test(scenario.name, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'The visual WebGL suite targets Chromium/SwiftShader.');
    await page.setViewportSize(viewports[scenario.viewport]);
    const runtime = { consoleErrors: [] as string[], failedRequests: [] as string[] };
    page.on('console', message => { if (message.type() === 'error') runtime.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => runtime.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    await page.goto('/');
    const webgl2 = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
    expect(webgl2, 'WebGL2 is unavailable. Install Chromium dependencies and run with the SwiftShader flags from playwright.config.ts.').toBe(true);
    await expect(page.locator('.map-view')).toBeVisible();
    await expect(page.locator('.map-status')).toBeHidden({ timeout: 45_000 });
    await documentFontsReady(page);
    if (scenario.setup) await scenario.setup(page);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshotPath = testInfo.outputPath(`${scenario.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
    await testInfo.attach('visual-screenshot', { path: screenshotPath, contentType: 'image/png' });
    await attachDiagnostics(page, testInfo, scenario, runtime);
  });
}

async function documentFontsReady(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}

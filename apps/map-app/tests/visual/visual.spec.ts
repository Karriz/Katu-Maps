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
type RuntimeDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  failedResponses: string[];
};

let readinessFailure: string | null = null;

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

async function browserDiagnostics(page: Page) {
  if (page.isClosed() || page.url() === 'about:blank') return { diagnostic: 'Page did not navigate before failure' };
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      const mapStatus = document.querySelector('.map-status');
      return {
        browser: navigator.userAgent,
        webgl2: Boolean(gl),
        webglVendor: gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
        webglRenderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
        devicePixelRatio: window.devicePixelRatio,
        maplibre: document.querySelector('.maplibregl-map') ? '6.6.0' : 'not initialized',
        mapStatus: mapStatus?.textContent?.trim() || 'hidden',
        documentReadyState: document.readyState,
        pageUrl: location.href,
      };
    });
  } catch (error) {
    return { diagnostic: `Could not read browser diagnostics: ${String(error)}` };
  }
}

async function attachDiagnostics(page: Page, info: TestInfo, scenario: Scenario, runtime: RuntimeDiagnostics, failure?: unknown) {
  const diagnostics = await browserDiagnostics(page);
  await info.attach('scenario-metadata', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      description: scenario.description,
      viewport: viewports[scenario.viewport],
      fixture: 'visual-fixtures-v1',
      layers: 'default',
      uiState: scenario.state,
      readinessGate: readinessFailure,
      ...diagnostics,
      ...runtime,
      failure: failure ? String(failure) : null,
    })),
  });
}

async function attachScreenshot(page: Page, info: TestInfo, scenario: Scenario, failed: boolean) {
  if (page.isClosed() || page.url() === 'about:blank') return;
  const screenshotPath = info.outputPath(`${scenario.name}${failed ? '-failure' : ''}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', timeout: 15_000 });
  await info.attach('visual-screenshot', { path: screenshotPath, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/?q=**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(photonFixture) }));
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

for (const scenario of scenarios) {
  test(scenario.name, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'The visual WebGL suite targets Chromium/SwiftShader.');
    await page.setViewportSize(viewports[scenario.viewport]);

    const runtime: RuntimeDiagnostics = {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      failedResponses: [],
    };
    page.on('console', message => { if (message.type() === 'error') runtime.consoleErrors.push(message.text()); });
    page.on('pageerror', error => runtime.pageErrors.push(error.message));
    page.on('requestfailed', request => runtime.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', response => {
      if (response.status() >= 400) runtime.failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    });

    let failure: unknown;
    try {
      if (readinessFailure) {
        throw new Error(`Map readiness preflight already failed; skipping repeated 45-second wait. First failure: ${readinessFailure}`);
      }

      await page.goto('/');
      const webgl2 = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
      expect(webgl2, 'WebGL2 is unavailable. Install Chromium dependencies and run with the SwiftShader flags from playwright.config.ts.').toBe(true);
      await expect(page.locator('.map-view')).toBeVisible();

      try {
        await expect(page.locator('.map-status')).toBeHidden({ timeout: 45_000 });
      } catch (error) {
        const status = await page.locator('.map-status').textContent().catch(() => null);
        const diagnostic = `Map did not become ready (status: ${status?.trim() || 'unknown'}; failed requests: ${runtime.failedRequests.length}; HTTP errors: ${runtime.failedResponses.length}; console errors: ${runtime.consoleErrors.length}; page errors: ${runtime.pageErrors.length})`;
        readinessFailure = diagnostic;
        throw new Error(`${diagnostic}\n${String(error)}`);
      }

      await documentFontsReady(page);
      if (scenario.setup) await scenario.setup(page);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await attachScreenshot(page, testInfo, scenario, Boolean(failure)).catch(error => runtime.pageErrors.push(`Screenshot failed: ${String(error)}`));
      await attachDiagnostics(page, testInfo, scenario, runtime, failure);
    }
  });
}

async function documentFontsReady(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}

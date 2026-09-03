import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installVisualProviderFixtures, visualFixture } from './provider-fixtures';

const viewports = {
  phone: { width: 412, height: 915, deviceScaleFactor: 1 },
  tablet: { width: 1024, height: 768, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  landscape: { width: 740, height: 390, deviceScaleFactor: 1 },
} as const;

type Scenario = {
  name: string;
  description: string;
  viewport: keyof typeof viewports;
  setup?: (page: Page) => Promise<void>;
  state: string;
  favorites?: StoredFavorite[];
};

type StoredFavorite = {
  id: string;
  name: string;
  coordinates: [number, number];
  category: string;
  kind: 'home' | 'work' | 'favorite';
  entityType: 'position' | 'place' | 'transit-stop';
  createdAt: number;
  provider?: string;
  providerId?: string;
  osmType?: string;
  osmId?: string | number;
  transitStopId?: string;
  transitProvider?: 'digitransit' | 'transitous';
  transitMode?: string;
};

type RuntimeDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  failedResponses: string[];
};

let readinessFailure: string | null = null;

async function openSearch(page: Page, query = 'Keskustori') {
  const input = page.getByLabel('Search for a place');
  await input.fill(query);
  await expect(page.getByRole('listbox', { name: 'Location search results' })).toBeVisible();
}

async function openPoi(page: Page) {
  await openSearch(page, 'Tampere');
  await page.getByRole('option', { name: /Tampere-talo/ }).click();
  await expect(page.locator('.location-info-panel')).toContainText('Tampere-talo');
  await expect(page.locator('.location-info-panel')).toContainText('Yliopistonkatu');
  await expect(page.locator('.location-description')).toContainText('concert and congress centre');
}

async function openPositionInformation(page: Page) {
  const viewport = page.viewportSize();
  const x = Math.min(520, Math.max(24, (viewport?.width ?? 520) - 30));
  const y = Math.min(420, Math.max(24, (viewport?.height ?? 420) - 30));
  await page.locator('.map-canvas').click({ button: 'right', position: { x, y } });
  await page.getByRole('menuitem', { name: 'Position information' }).click();
  await expect(page.locator('.position-information')).toBeVisible();
  await expect(page.locator('.position-information')).toContainText('Latitude, longitude');
}

async function openTransitStop(page: Page) {
  await openSearch(page, 'Keskustori');
  const result = page.getByRole('option', { name: /Keskustori.*Transit stop/i });
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();
  const panel = page.locator('.transit-departures-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Next departures');
  await expect(panel.locator('.transit-departure-card')).toHaveCount(4);
}

async function openSelectedTrip(page: Page) {
  await openTransitStop(page);
  await page.locator('.transit-departure-card').filter({ hasText: 'Hervanta' }).click();
  const panel = page.locator('.transit-trip-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Stops on this route');
  await expect(panel).toContainText('Board here');
  await expect(panel.locator('.transit-route-stop')).toHaveCount(7);
  await expectScrollablePanelBody(page, '.transit-trip-panel', '.transit-panel-header', '.transit-route-stop-scroll');
}

async function saveFavoriteFromPanel(page: Page, panelSelector: string, name: string) {
  const panel = page.locator(panelSelector);
  await panel.getByRole('button', { name: 'Save' }).click();
  const dialog = page.getByRole('dialog', { name: /Save as favourite/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Save favourite' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Edit favourite' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Remove favourite' })).toBeVisible();
}

async function editFavoriteFromPanel(page: Page, panelSelector: string, name: string) {
  const panel = page.locator(panelSelector);
  await panel.getByRole('button', { name: 'Edit favourite' }).click();
  const dialog = page.getByRole('dialog', { name: /Edit favourite/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

async function expectScrollablePanelBody(page: Page, panelSelector: string, headerSelector: string, bodySelector: string, requireOverflow = false) {
  const snapshot = await page.locator(panelSelector).evaluate((panel, selectors) => {
    const header = panel.querySelector<HTMLElement>(selectors.header);
    const body = panel.querySelector<HTMLElement>(selectors.body);
    if (!header || !body) return null;
    const headerTop = header.getBoundingClientRect().top;
    const initialTop = body.scrollTop;
    body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const result = {
      headerTop,
      headerTopAfterScroll: header.getBoundingClientRect().top,
      bodyScrolled: body.scrollTop > initialTop,
      hasOverflow: body.scrollHeight > body.clientHeight,
      bodyOwnsOverflow: getComputedStyle(body).overflowY === 'auto' || getComputedStyle(body).overflowY === 'scroll',
    };
    body.scrollTop = initialTop;
    return result;
  }, { header: headerSelector, body: bodySelector });
  expect(snapshot).not.toBeNull();
  expect(snapshot!.headerTopAfterScroll).toBeCloseTo(snapshot!.headerTop, 1);
  expect(snapshot!.bodyOwnsOverflow).toBe(true);
  if (requireOverflow) {
    expect(snapshot!.hasOverflow).toBe(true);
    expect(snapshot!.bodyScrolled).toBe(true);
  }
}

async function openRoute(page: Page) {
  await page.getByRole('button', { name: 'Plan a route' }).click();
  await expect(page.getByRole('button', { name: 'Close route planner' })).toBeVisible();
}

async function verifyThemeSettings(page: Page) {
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page.getByRole('group', { name: 'Appearance' })).toBeVisible();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'System' }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

async function openRouteAutocomplete(page: Page) {
  await openRoute(page);
  await page.getByLabel('Search starting point').fill('Tampere');
  const results = page.getByRole('listbox', { name: 'Search starting point results' });
  await expect(results).toBeVisible();
  await expect(results.getByRole('option')).toHaveCount(3);
  expect(await results.evaluate((element) => element.closest('.route-panel'))).toBeNull();

  const bounds = await results.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.height).toBeGreaterThan(120);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function verifyRouteKeyboard(page: Page) {
  await openRoute(page);
  const origin = page.getByRole('combobox', { name: 'Search starting point', exact: true });
  await origin.focus();
  await origin.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Your location/ })).toHaveAttribute('aria-selected', 'true');
  await origin.press('ArrowUp');
  await expect(origin).not.toHaveAttribute('aria-activedescendant', /.+/);
  await origin.press('ArrowUp');
  await expect(origin).toHaveAttribute('aria-activedescendant', 'route-origin-option-0');
  await origin.press('Enter');
  await expect(origin).toHaveValue('Your location');

  const destination = page.getByRole('combobox', { name: 'Search destination', exact: true });
  await destination.focus();
  await expect(destination).not.toHaveAttribute('aria-activedescendant', /.+/);
  await destination.press('ArrowDown');
  await destination.press('Enter');
  await expect(destination).toHaveValue('Your location');
}

async function verifyMapAndHelpKeyboard(page: Page) {
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.focus();
  await canvas.press('ArrowRight');
  await canvas.press('+');
  await canvas.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Map point options' })).toBeVisible();
  await page.keyboard.press('Escape');

  const help = page.getByRole('button', { name: 'Controls help' });
  await help.focus();
  await help.press('Enter');
  await expect(page.getByRole('heading', { name: 'Controls help' })).toBeFocused();
  const privacyLink = page.getByRole('link', { name: 'Privacy policy' });
  await expect(privacyLink).toHaveAttribute('href', 'https://github.com/Karriz/Katu-Maps/blob/main/apps/map-app/public/privacy.md');
  await expect(privacyLink).toHaveAttribute('target', '_blank');
  const sourceLink = page.getByRole('link', { name: 'View source on GitHub' });
  await expect(sourceLink).toHaveAttribute('href', 'https://github.com/Karriz/Katu-Maps');
  await expect(sourceLink).toHaveAttribute('target', '_blank');
  const privacyLinkBox = await privacyLink.boundingBox();
  const sourceLinkBox = await sourceLink.boundingBox();
  expect(privacyLinkBox).not.toBeNull();
  expect(sourceLinkBox).not.toBeNull();
  if (privacyLinkBox && sourceLinkBox) {
    expect(Math.abs(privacyLinkBox.x - sourceLinkBox.x)).toBeLessThanOrEqual(1);
  }
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();

  const search = page.getByLabel('Search for a place');
  await search.focus();
  await search.fill('typing');
  const zoomBefore = await canvas.getAttribute('aria-label');
  await search.press('+');
  expect(await canvas.getAttribute('aria-label')).toBe(zoomBefore);
}

async function verifyControlsHelpPlacement(page: Page, layout: 'desktop' | 'landscape' | 'portrait-dock') {
  const trigger = page.getByRole('button', { name: 'Controls help' });
  await expect(trigger).toBeInViewport();

  const triggerBox = await trigger.boundingBox();
  const searchBox = await page.locator('.location-search-form').boundingBox();
  const layersBox = await page.getByRole('button', { name: 'Map layers' }).boundingBox();
  const routeBox = await page.getByRole('button', { name: 'Plan a route' }).boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(layersBox).not.toBeNull();
  expect(routeBox).not.toBeNull();
  if (!triggerBox || !searchBox || !layersBox || !routeBox) return;

  if (layout === 'portrait-dock') {
    expect(Math.abs(triggerBox.x - layersBox.x)).toBeLessThanOrEqual(2);
    expect(triggerBox.y).toBeGreaterThanOrEqual(routeBox.y + routeBox.height + 6);
  } else if (layout === 'desktop') {
    expect(triggerBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width + 6);
    expect(Math.abs(triggerBox.y - searchBox.y)).toBeLessThanOrEqual(2);
  } else {
    expect(triggerBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width + 6);
    expect(Math.abs(triggerBox.y - searchBox.y)).toBeLessThanOrEqual(2);
  }

  await trigger.click();
  const panel = page.locator('#controls-help-panel');
  await expect(panel).toBeInViewport();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  if (panelBox && layout === 'portrait-dock') {
    expect(panelBox.x).toBeGreaterThanOrEqual(layersBox.x + layersBox.width + 6);
  } else if (panelBox) {
    expect(panelBox.x).toBeGreaterThanOrEqual(layersBox.x + layersBox.width + 6);
    expect(panelBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height + 6);
  }
  const header = panel.locator('header');
  await expect(header.getByRole('heading', { name: 'Controls help' })).toBeVisible();
  const close = header.getByRole('button', { name: 'Close controls help' });
  await expect(close).toBeVisible();
  await expect(close).toHaveCSS('cursor', 'pointer');
  await expect(panel).toHaveCSS('pointer-events', 'auto');
  expect(await panel.locator('.controls-help-content').evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');

  await close.click();
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function chooseRouteResult(page: Page, listName: string, resultText: string, useLast = false) {
  const list = page.getByRole('listbox', { name: listName });
  await expect(list).toBeVisible();
  const candidates = list.locator('button.route-search-result').filter({ hasText: resultText });
  await expect(candidates.first()).toBeVisible();
  await (useLast ? candidates.last() : candidates.first()).click();
}

async function setRouteEndpoints(page: Page, mode: 'pedestrian' | 'transit') {
  await openRoute(page);
  if (mode === 'transit') await page.getByRole('tab', { name: 'Transit' }).click();

  const origin = page.getByLabel('Search starting point');
  await origin.fill('Keskustori');
  await chooseRouteResult(page, 'Search starting point results', 'Keskustori', true);

  const destination = page.getByLabel('Search destination');
  await destination.fill('Tampere');
  await chooseRouteResult(page, 'Search destination results', 'Tampere-talo');

  if (mode === 'transit') {
    await expect(page.locator('.transit-route-options')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.transit-route-option')).toHaveCount(3);
  } else {
    await expect(page.locator('.route-summary')).toContainText('1.1 km', { timeout: 15_000 });
    await expect(page.locator('.route-summary')).toContainText('15 min');
  }
}

async function openTransitAlternatives(page: Page) {
  await setRouteEndpoints(page, 'transit');
  await expect(page.locator('.transit-route-options')).toContainText('Choose a trip');
}

async function openExpandedItinerary(page: Page) {
  await openTransitAlternatives(page);
  const options = page.locator('.transit-route-option');
  await options.nth(1).click();
  const detailsButton = page.getByRole('button', { name: 'View journey details' });
  await detailsButton.click();
  await expect(page.locator('.transit-route-legs')).toBeVisible();
  await expect(page.locator('.transit-transfer-marker')).toContainText('Change at');
  await expect(page.locator('.transit-route-arrival')).toContainText('Tampere-talo');
  await expect(page.locator('.route-panel')).toHaveAttribute('data-snap', 'expanded');
  await expect(page.locator('.route-planner-controls')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to route options' })).toBeFocused();

  await page.getByRole('button', { name: 'Back to route options' }).click();
  await expect(page.locator('.transit-route-options')).toBeVisible();
  await expect(page.locator('.route-panel')).toHaveAttribute('data-snap', 'half');
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');

  await detailsButton.click();
  await page.evaluate(() => window.history.back());
  await expect(page.locator('.transit-route-options')).toBeVisible();
  await expect(page.locator('.route-panel')).toHaveAttribute('data-snap', 'half');
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');

  await detailsButton.click();
  await expect(page.locator('.transit-journey-header')).toBeVisible();
}

async function openDesktopItinerary(page: Page) {
  await openTransitAlternatives(page);
  const options = page.locator('.transit-route-option');
  await options.nth(1).click();
  const detailsButton = page.getByRole('button', { name: 'View journey details' });
  await detailsButton.click();
  await expect(page.locator('.transit-route-legs')).toBeVisible();
  await expect(page.locator('.route-planner-controls')).toBeHidden();
  await expect(page.locator('.transit-route-options')).toBeHidden();
  await expect(page.locator('.transit-journey-header')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to route options' })).toBeFocused();

  await page.getByRole('button', { name: 'Back to route options' }).click();
  await expect(page.locator('.transit-route-options')).toBeVisible();
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(detailsButton).toBeFocused();

  await detailsButton.click();
  await expect(page.locator('.transit-journey-header')).toBeVisible();
}

async function openDesktopTransitRouteResult(page: Page) {
  await setRouteEndpoints(page, 'transit');
  await page.locator('.transit-route-option').nth(1).click();
  await expect(page.locator('.route-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit route' })).toBeVisible();
}

async function expectRightInfoPanelDoesNotCoverRouteControls(page: Page, panelSelector: string) {
  await expect(page.locator(panelSelector)).toBeVisible({ timeout: 10_000 });
  const panel = await page.locator(panelSelector).boundingBox();
  const controls = await page.locator('.map-camera-actions').boundingBox();
  expect(panel).not.toBeNull();
  expect(controls).not.toBeNull();
  const overlaps = controls!.x < panel!.x + panel!.width
    && controls!.x + controls!.width > panel!.x
    && controls!.y < panel!.y + panel!.height
    && controls!.y + controls!.height > panel!.y;
  expect(overlaps).toBe(false);
}

const favoriteCameraFixtures: StoredFavorite[] = [
  {
    id: 'saved-position', name: 'Saved map position', coordinates: [23.7609, 61.4981],
    category: 'Pinned location', kind: 'home', entityType: 'position', createdAt: 1,
  },
  {
    id: 'saved-place', name: 'Saved Helsinki place', coordinates: [24.9384, 60.1699],
    category: 'Arts centre', kind: 'work', entityType: 'place', createdAt: 2,
    provider: 'osm', providerId: 'W2002', osmType: 'W', osmId: 2002,
  },
  {
    id: 'saved-stop', name: 'Saved Jyvaskyla stop', coordinates: [25.7482, 62.2415],
    category: 'Transit stop', kind: 'favorite', entityType: 'transit-stop', createdAt: 3,
    provider: 'transit', providerId: 'digitransit:visual:FavoriteStop',
    transitStopId: 'visual:FavoriteStop', transitProvider: 'digitransit', transitMode: 'TRAM',
  },
];

async function expectFavoriteCamera(page: Page, favorite: StoredFavorite) {
  const initialView = await page.evaluate(() => JSON.parse(localStorage.getItem('maps-viewport-v1') ?? 'null'));
  expect(initialView).toMatchObject({ center: [0, 0], zoom: 2.2 });

  await page.getByRole('button', { name: 'Show favourites' }).click();
  const list = page.getByRole('listbox', { name: 'Favourite places' });
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: new RegExp(`^${favorite.name}`) }).click();

  if (favorite.entityType === 'position') {
    await expect(page.locator('.position-information')).toContainText(
      `${favorite.coordinates[1].toFixed(6)}, ${favorite.coordinates[0].toFixed(6)}`,
    );
  } else if (favorite.entityType === 'transit-stop') {
    await expect(page.locator('.transit-departures-panel')).toHaveAttribute('aria-label', `Departures from ${favorite.name}`);
  } else {
    await expect(page.locator('.location-info-panel').getByRole('heading', { name: favorite.name })).toBeVisible();
  }

  const minimumZoom = favorite.entityType === 'transit-stop' ? 14.6 : 14;
  await expect.poll(async () => page.evaluate(() => {
    const view = JSON.parse(localStorage.getItem('maps-viewport-v1') ?? 'null') as { zoom?: number } | null;
    return view?.zoom ?? -1;
  })).toBeGreaterThanOrEqual(minimumZoom - 0.001);
  await expect.poll(async () => page.evaluate((target) => {
    const view = JSON.parse(localStorage.getItem('maps-viewport-v1') ?? 'null') as { center?: number[] } | null;
    if (!view?.center) return Number.POSITIVE_INFINITY;
    return Math.max(
      Math.abs(view.center[0] - target[0]),
      Math.abs(view.center[1] - target[1]),
    );
  }, favorite.coordinates)).toBeLessThan(0.05);
}

async function verifyFavoriteCameras(page: Page) {
  for (let index = 0; index < favoriteCameraFixtures.length; index += 1) {
    if (index > 0) {
      await page.reload();
      await expect(page.locator('.map-status')).toBeHidden({ timeout: 45_000 });
    }
    await expectFavoriteCamera(page, favoriteCameraFixtures[index]);
  }
}

const scenarios: Scenario[] = [
  { name: 'desktop-main-map', description: 'Main map after style readiness', viewport: 'desktop', state: 'map ready' },
  { name: 'phone-main-map', description: 'Main map at Android phone dimensions', viewport: 'phone', state: 'map ready' },
  {
    name: 'phone-search-autocomplete',
    description: 'Search containing a POI and a transit stop from deterministic fixtures',
    viewport: 'phone',
    setup: async page => {
      await openSearch(page, 'Tampere');
      await expect(page.getByRole('option', { name: /Tampere-talo/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /Tampere railway station.*Transit stop/i })).toBeVisible();
    },
    state: 'POI and transit results open',
  },
  {
    name: 'desktop-favorites-empty',
    description: 'Graceful empty favourites list',
    viewport: 'desktop',
    setup: async page => { await page.getByRole('button', { name: 'Show favourites' }).click(); },
    state: 'favourites open',
  },
  {
    name: 'tablet-search-results',
    description: 'Submitted search candidates highlighted and fitted on the map',
    viewport: 'tablet',
    setup: async page => {
      await openSearch(page);
      await page.getByLabel('Search for a place').press('Enter');
      await expect(page.getByRole('listbox', { name: 'Location search results' })).toBeHidden();
    },
    state: 'search candidates highlighted',
  },
  {
    name: 'phone-position-context-menu',
    description: 'Generic map context route actions',
    viewport: 'phone',
    setup: async page => {
      await page.locator('.map-canvas').click({ button: 'right', position: { x: 180, y: 350 } });
      await expect(page.locator('.map-context-menu')).toContainText('Position information');
    },
    state: 'context menu open',
  },
  {
    name: 'desktop-business-poi',
    description: 'Business/POI information populated through Nominatim',
    viewport: 'desktop',
    setup: openPoi,
    state: 'POI information open',
  },
  {
    name: 'desktop-position-information',
    description: 'Position information uses the shared translucent panel surface',
    viewport: 'desktop',
    setup: openPositionInformation,
    state: 'position information open',
  },
  {
    name: 'desktop-position-closes-poi-information',
    description: 'Opening position information replaces an open POI panel',
    viewport: 'desktop',
    setup: async page => {
      await openPoi(page);
      await openPositionInformation(page);
      await expect(page.locator('.location-info-panel')).toBeHidden();
      await expect(page.locator('.position-information')).toBeVisible();
    },
    state: 'position information replaced POI information',
  },
  {
    name: 'desktop-position-closes-transit-information',
    description: 'Opening position information replaces an open transit-stop panel',
    viewport: 'desktop',
    setup: async page => {
      await openTransitStop(page);
      await openPositionInformation(page);
      await expect(page.locator('.transit-departures-panel')).toBeHidden();
      await expect(page.locator('.position-information')).toBeVisible();
    },
    state: 'position information replaced transit information',
  },
  {
    name: 'desktop-route-with-position-information',
    description: 'Route controls remain visible beside position information on desktop',
    viewport: 'desktop',
    setup: async page => {
      await openDesktopTransitRouteResult(page);
      await openPositionInformation(page);
      await expect(page.locator('.route-panel')).toBeVisible();
      await expectRightInfoPanelDoesNotCoverRouteControls(page, '.position-information');
    },
    state: 'desktop route and position information open',
  },
  {
    name: 'desktop-close-position-restores-route-controls',
    description: 'Closing position information restores Fit route and Follow vehicle controls',
    viewport: 'desktop',
    setup: async page => {
      await openDesktopTransitRouteResult(page);
      await expect(page.getByRole('button', { name: 'Follow estimated vehicle' })).toBeVisible();
      await openPositionInformation(page);
      await expect(page.locator('.position-information')).toBeVisible();
      await page.locator('.position-information > .location-info-close').click();
      await expect(page.locator('.position-information')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Fit route' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Follow estimated vehicle' })).toBeVisible();
    },
    state: 'desktop route controls restored after closing position information',
  },
  {
    name: 'desktop-route-with-poi-information',
    description: 'Route controls remain visible beside POI information on desktop',
    viewport: 'desktop',
    setup: async page => {
      await openPoi(page);
      await openDesktopTransitRouteResult(page);
      await expect(page.locator('.route-panel')).toBeVisible();
      await expectRightInfoPanelDoesNotCoverRouteControls(page, '.location-info-panel');
    },
    state: 'desktop route and POI information open',
  },
  {
    name: 'desktop-transit-panel-coexists-with-routing',
    description: 'Transit stop information can coexist with the desktop route panel',
    viewport: 'desktop',
    setup: async page => {
      await openTransitStop(page);
      await openRoute(page);
      await page.getByRole('button', { name: 'Close departures' }).click();
      await expect(page.locator('.transit-departures-panel')).toBeHidden();
      await expect(page.locator('.route-panel')).toBeVisible();
    },
    state: 'desktop route and transit information coexist',
  },
  {
    name: 'phone-route-clears-on-position-information',
    description: 'Opening position information on mobile exits routing',
    viewport: 'phone',
    setup: async page => {
      await setRouteEndpoints(page, 'pedestrian');
      await openPositionInformation(page);
      await expect(page.locator('.position-information')).toBeVisible();
      await expect(page.locator('.route-panel')).toBeHidden();
    },
    state: 'mobile POI information with routing cleared',
  },
  {
    name: 'phone-position-closes-poi-information',
    description: 'Opening POI information replaces position information on mobile',
    viewport: 'phone',
    setup: async page => {
      await openPositionInformation(page);
      await openPoi(page);
      await expect(page.locator('.position-information')).toBeHidden();
      await expect(page.locator('.location-info-panel')).toBeVisible();
    },
    state: 'mobile POI information replaced position information',
  },
  {
    name: 'phone-position-closes-transit-information',
    description: 'Opening transit-stop information replaces position information on mobile',
    viewport: 'phone',
    setup: async page => {
      await openPositionInformation(page);
      await openTransitStop(page);
      await expect(page.locator('.position-information')).toBeHidden();
      await expect(page.locator('.transit-departures-panel')).toBeVisible();
    },
    state: 'mobile transit information replaced position information',
  },
  {
    name: 'desktop-position-favorite-lifecycle',
    description: 'Position information updates from Save to Edit and Remove after saving',
    viewport: 'desktop',
    setup: async page => {
      await openPositionInformation(page);
      await saveFavoriteFromPanel(page, '.position-information', 'Saved desktop position');
      await page.locator('.position-information').getByRole('button', { name: 'Remove favourite' }).click();
      await expect(page.locator('.position-information').getByRole('button', { name: 'Save' })).toBeVisible();
    },
    state: 'desktop position favourite saved and removed',
  },
  {
    name: 'desktop-poi-favorite-lifecycle',
    description: 'POI information updates from Save to Edit and Remove after saving',
    viewport: 'desktop',
    setup: async page => {
      await openPoi(page);
      await saveFavoriteFromPanel(page, '.location-info-panel', 'Saved POI');
      await page.locator('.location-info-panel').getByRole('button', { name: 'Remove favourite' }).click();
      await expect(page.locator('.location-info-panel').getByRole('button', { name: 'Save' })).toBeVisible();
    },
    state: 'desktop POI favourite saved and removed',
  },
  {
    name: 'desktop-transit-favorite-lifecycle',
    description: 'Transit-stop information updates from Save to Edit and Remove after saving',
    viewport: 'desktop',
    setup: async page => {
      await openTransitStop(page);
      await saveFavoriteFromPanel(page, '.transit-departures-panel', 'Saved transit stop');
      await page.locator('.transit-departures-panel').getByRole('button', { name: 'Remove favourite' }).click();
      await expect(page.locator('.transit-departures-panel').getByRole('button', { name: 'Save' })).toBeVisible();
    },
    state: 'desktop transit favourite saved and removed',
  },
  {
    name: 'desktop-edit-poi-favorite',
    description: 'Editing a saved POI updates its favorite name without changing its entity metadata',
    viewport: 'desktop',
    favorites: [favoriteCameraFixtures[1]],
    setup: async page => {
      await page.getByRole('button', { name: 'Show favourites' }).click();
      await page.getByRole('listbox', { name: 'Favourite places' })
        .getByRole('option', { name: /^Saved Helsinki place/ }).click();
      const panel = page.locator('.location-info-panel');
      await expect(panel).toBeVisible();
      await editFavoriteFromPanel(page, '.location-info-panel', 'Renamed Helsinki place');
      await expect.poll(async () => page.evaluate(() => {
        const values = JSON.parse(localStorage.getItem('maps-favorites-v1') ?? '[]') as StoredFavorite[];
        return values.find((favorite) => favorite.id === 'saved-place')?.name;
      })).toBe('Renamed Helsinki place');
    },
    state: 'desktop POI favourite renamed',
  },
  {
    name: 'phone-stop-departures',
    description: 'Transit departures with realtime, scheduled and cancelled services',
    viewport: 'phone',
    setup: openTransitStop,
    state: 'stop departures open',
  },
  {
    name: 'tablet-selected-departure',
    description: 'Validated selected trip with seven stop calls and boarding context',
    viewport: 'tablet',
    setup: openSelectedTrip,
    state: 'selected live trip open',
  },
  {
    name: 'phone-walking-route',
    description: 'Walking route with deterministic Valhalla geometry and summary',
    viewport: 'phone',
    setup: async page => setRouteEndpoints(page, 'pedestrian'),
    state: 'walking route fitted',
  },
  {
    name: 'desktop-route-autocomplete',
    description: 'Route autocomplete escapes the panel and uses the available desktop viewport',
    viewport: 'desktop',
    setup: openRouteAutocomplete,
    state: 'routing autocomplete open',
  },
  {
    name: 'phone-route-autocomplete',
    description: 'Route autocomplete remains fully visible above the mobile sheet and keyboard viewport',
    viewport: 'phone',
    setup: openRouteAutocomplete,
    state: 'routing autocomplete open',
  },
  {
    name: 'desktop-route-keyboard',
    description: 'Both route endpoints include current location in cyclic keyboard navigation',
    viewport: 'desktop',
    setup: verifyRouteKeyboard,
    state: 'both route endpoints selected using only the keyboard',
  },
  {
    name: 'desktop-map-help-keyboard',
    description: 'Map and controls Help are operable by keyboard with predictable focus',
    viewport: 'desktop',
    setup: verifyMapAndHelpKeyboard,
    state: 'keyboard map actions and Help verified',
  },
  {
    name: 'desktop-controls-help-placement',
    description: 'Help sits below search, right of the desktop dock, and opens without covering its trigger',
    viewport: 'desktop',
    setup: page => verifyControlsHelpPlacement(page, 'desktop'),
    state: 'desktop Help open beside the dock',
  },
  {
    name: 'phone-controls-help-placement',
    description: 'Help is the bottom portrait dock item and its panel keeps a fixed header',
    viewport: 'phone',
    setup: page => verifyControlsHelpPlacement(page, 'portrait-dock'),
    state: 'portrait Help open from the dock',
  },
  {
    name: 'mobile-landscape-controls-help',
    description: 'Help sits to the right of search and fits a short landscape safe viewport',
    viewport: 'landscape',
    setup: page => verifyControlsHelpPlacement(page, 'landscape'),
    state: 'landscape Help open from beside search',
  },
  {
    name: 'tablet-transit-alternatives',
    description: 'Three transit alternatives parsed from Digitransit fixtures',
    viewport: 'tablet',
    setup: openTransitAlternatives,
    state: 'three transit alternatives',
  },
  {
    name: 'phone-transit-itinerary',
    description: 'Dedicated full-height bus-to-tram journey with Back-state restoration',
    viewport: 'phone',
    setup: openExpandedItinerary,
    state: 'mobile journey detail open',
  },
  {
    name: 'desktop-transit-itinerary',
    description: 'Desktop transit itinerary opens as a dedicated panel page with back navigation',
    viewport: 'desktop',
    setup: openDesktopItinerary,
    state: 'desktop journey page open',
  },
  {
    name: 'phone-bottom-sheet-midpoint',
    description: 'Mobile route bottom sheet at its interactive midpoint presentation',
    viewport: 'phone',
    setup: openRoute,
    state: 'sheet midpoint',
  },
  {
    name: 'desktop-layers-panel',
    description: 'Map layers and deterministic CI enabled state',
    viewport: 'desktop',
    setup: async page => {
      await page.getByRole('button', { name: 'Map layers' }).click();
      await expect(page.locator('#map-layer-panel')).toBeVisible();
    },
    state: 'layers open',
  },
  {
    name: 'phone-provider-error',
    description: 'Deterministic provider failure surfaced without hanging',
    viewport: 'phone',
    setup: async page => {
      const input = page.getByLabel('Search for a place');
      await input.fill('ProviderError');
      await expect(page.locator('.location-search-results')).toContainText('Could not search right now');
    },
    state: 'provider error',
  },
  ...(['phone', 'tablet', 'desktop'] as const).map((viewport): Scenario => ({
    name: `${viewport}-favorite-camera-types`,
    description: 'Position, place and transit-stop favourites restore exact coordinates and zoom from a world view',
    viewport,
    setup: verifyFavoriteCameras,
    state: 'all favourite entity types verified after reload',
    favorites: favoriteCameraFixtures,
  })),
  {
    name: 'desktop-theme-settings',
    description: 'Light, Dark, and System appearance options update the shared UI without losing map state',
    viewport: 'desktop',
    setup: verifyThemeSettings,
    state: 'dark panel and system preference transitions verified',
  },
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
        maplibre: document.querySelector('.maplibregl-map') ? '6.7.0' : 'not initialized',
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
      fixture: visualFixture.id,
      layers: 'ci-ui (buildings and transit on; terrain, trees and transit models off)',
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
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', timeout: 30_000 });
  await info.attach('visual-screenshot', { path: screenshotPath, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  await installVisualProviderFixtures(page);
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
      if (response.status() >= 400 && !response.url().includes('ProviderError')) {
        runtime.failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    let failure: unknown;
    try {
      if (readinessFailure) {
        throw new Error(`Map readiness preflight already failed; skipping repeated 45-second wait. First failure: ${readinessFailure}`);
      }

      await page.addInitScript(({ favorites }) => {
        localStorage.clear();
        localStorage.setItem('tampere-map-layer-options', JSON.stringify({
          globe: true,
          trees: false,
          buildings: true,
          terrain: false,
          transit: true,
          transitModels: false,
        }));
        if (favorites.length) {
          localStorage.setItem('maps-favorites-v1', JSON.stringify(favorites));
          localStorage.setItem('maps-viewport-v1', JSON.stringify({ center: [0, 0], zoom: 2.2, bearing: 0, pitch: 0 }));
        }
      }, { favorites: scenario.favorites ?? [] });
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
      await page.waitForTimeout(750);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      let screenshotFailure: unknown;
      try {
        await attachScreenshot(page, testInfo, scenario, Boolean(failure));
      } catch (error) {
        screenshotFailure = error;
        runtime.pageErrors.push(`Screenshot failed: ${String(error)}`);
      }
      await attachDiagnostics(page, testInfo, scenario, runtime, failure ?? screenshotFailure);
      if (!failure && screenshotFailure) throw screenshotFailure;
    }
  });
}

async function documentFontsReady(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; });
}

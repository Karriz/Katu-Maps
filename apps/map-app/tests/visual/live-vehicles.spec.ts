import { expect, test, type Page } from '@playwright/test';
import { installVisualProviderFixtures } from './provider-fixtures';

test.use({ actionTimeout: 10_000 });

const center = [23.7609, 61.4981];
function encodeRoute(points: number[][]) {
  let lat = 0;
  let lng = 0;
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let result = '';
    while (value >= 32) { result += String.fromCharCode((value & 31 | 32) + 63); value >>= 5; }
    return result + String.fromCharCode(value + 63);
  };
  return points.map(([longitude, latitude]) => {
    const nextLat = Math.round(latitude * 1e5);
    const nextLng = Math.round(longitude * 1e5);
    const result = encode(nextLat - lat) + encode(nextLng - lng);
    lat = nextLat; lng = nextLng;
    return result;
  }).join('');
}
const viewports = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 412, height: 915 },
  landscape: { width: 740, height: 390 },
};

async function toggleLiveVehicles(page: Page) {
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  const panel = page.locator('#map-layer-panel');
  const transit = panel.locator('details.layer-group').filter({ hasText: 'Transit stops' });
  if (await transit.getAttribute('open') === null) await transit.locator('summary').click();
  await panel.getByRole('switch', { name: /^Live vehicles/ }).click();
  await panel.getByRole('button', { name: 'Close map layers', exact: true }).click();
}

for (const [viewportName, viewport] of Object.entries(viewports)) {
  for (const zoom of [14, 16]) {
    test(`live fleet ${viewportName} z${zoom}: selection, follow, navigation and disable`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
      });
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await installVisualProviderFixtures(page);
      let fleetRequests = 0;
      await page.route('https://data.itsfactory.fi/siriaccess/vm/json**', route => {
        fleetRequests++;
        return route.fulfill({ json: { Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{ VehicleActivity: [{
          RecordedAtTime: Date.now(),
          MonitoredVehicleJourney: {
            VehicleRef: { value: 'visual-tram' }, PublishedLineName: { value: '3' },
            LineRef: { value: '3' }, OperatorRef: { value: '56920' },
            DestinationName: { value: 'Hervantajärvi' }, Bearing: 90,
            VehicleLocation: { Longitude: center[0], Latitude: center[1] },
            DirectionRef: { value: '0' },
            FramedVehicleJourneyRef: { DataFrameRef: { value: new Date().toISOString().slice(0, 10) }, DatedVehicleJourneyRef: '1200' },
          },
        }] }] } } } });
      });
      await page.route('https://rata.digitraffic.fi/**', route => route.fulfill({ json: { data: { currentlyRunningTrains: [] } } }));
      await page.route('https://api.digitransit.fi/routing/v2/finland/gtfs/v1**', async route => {
        const body = route.request().postDataJSON();
        if (!body.query.includes('LiveFuzzyTrip')) return route.fallback();
        await route.fulfill({ json: { data: { fuzzyTrip: {
          gtfsId: 'visual:live-trip', route: { color: 'C92F40', shortName: '3' },
          tripGeometry: { points: encodeRoute([[center[0] - 0.005, center[1]], center, [center[0] + 0.005, center[1]]]) },
          onServiceDate: { stopCalls: ['Pyynikintori', 'Keskustori', 'Hervantajärvi'].map((name, index) => ({
            stopLocation: { name }, schedule: { time: { departure: new Date(Date.now() + index * 300_000).toISOString() } },
          })) },
        } } } });
      });
      await page.addInitScript(({ center, zoom }) => {
        localStorage.clear();
        localStorage.setItem('tampere-map-layer-options', JSON.stringify({
          globe: false, trees: false, buildings: true, buildingColors: true,
          bridges: false, terrain: false, transit: false, transitModels: false, liveVehicles: false,
        }));
        localStorage.setItem('maps-viewport-v1', JSON.stringify({ center, zoom, bearing: 0, pitch: 0 }));
      }, { center, zoom });
      await page.goto('/');
      await expect(page.locator('.map-status')).toBeHidden({ timeout: 45_000 });
      await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
      expect(fleetRequests).toBe(0);
      await toggleLiveVehicles(page);
      await expect.poll(() => fleetRequests).toBeGreaterThan(0);
      const panel = page.locator('.live-vehicle-panel');
      const canvas = page.locator('.maplibregl-canvas');
      await expect(async () => {
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
        await expect(panel).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      await expect(panel).toContainText('Hervantajärvi');
      await expect(panel.locator('.transit-route-stop')).toHaveCount(3);
      if (zoom === 16) {
        const screenshot = testInfo.outputPath(`${viewportName}-live-vehicle.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach('visual-screenshot', { path: screenshot, contentType: 'image/png' });
      }
      await panel.getByRole('button', { name: 'Follow live vehicle', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Following live vehicle', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (viewport.width <= 760) {
        await canvas.click({ button: 'right', position: { x: Math.min(viewport.width / 2, 250), y: 100 } });
        await page.getByRole('menuitem', { name: 'Route from here', exact: true }).click();
        await expect(panel).toBeHidden();
        await expect(page.locator('.route-panel')).toBeVisible();
        await page.getByRole('button', { name: 'Close route planner', exact: true }).click();
      } else {
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(canvas).toBeFocused();
      }
      await toggleLiveVehicles(page);
      await expect(panel).toBeHidden();
      await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
